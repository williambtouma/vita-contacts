import {asciiDigits, parsePhone, parseUAEPhone} from './phone.mjs?v=3';
import {extractFiles} from './import.mjs?v=2';
import {mappingFields, mapTable, normalizeDOB, profileError, profileFields, profileValues} from './contact-fields.mjs?v=4';

const $ = id => document.getElementById(id);
const display = new Intl.DisplayNames(['ar'], {type: 'region'});
const countryName = code => code ? display.of(code) : '—';
const gulf = ['AE', 'SA', 'OM', 'KW', 'QA', 'BH'];
const countries = [...gulf, ...libphonenumber.getCountries().filter(code => !gulf.includes(code))
    .sort((a, b) => countryName(a).localeCompare(countryName(b), 'ar'))];
const pageSize = 50;
let csrf = '';
let contacts = [];
let contactView = 'active';
const selected = new Set();
let bulkRequest;
let bulkWorking = false;
let pending = [];
let mapping;
let category = '';
let report = [];
let page = 0;
let reviewPage = 0;
let editing;
let working = false;
let sourceUrl;

function notice(message) {
    $('notice').textContent = message;
    $('notice').hidden = !message;
}
function bind(id, event, handler) {
    $(id).addEventListener(event, async event => {
        try {
            await handler(event);
        } catch (error) {
            notice(error.message);
        }
    });
}
async function api(action, body) {
    const response = await fetch('api.php?action=' + action, body === undefined ? {} : {
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'X-CSRF-Token': csrf},
        body: JSON.stringify(body)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'تعذّر إكمال الطلب');
    csrf = result.csrf || csrf;
    return result;
}
function options(select, values, empty, label = value => value) {
    const current = select.value;
    const option = (text, value) => {
        const item = document.createElement('option');
        item.value = value;
        item.textContent = text;
        return item;
    };
    select.replaceChildren(option(empty, ''), ...values.map(value => option(label(value), value)));
    select.value = values.includes(current) ? current : '';
}
function appendRow(table, values) {
    const row = table.insertRow();
    values.forEach(value => {
        const cell = row.insertCell();
        if (value instanceof Node) cell.append(value);
        else cell.textContent = value ?? '';
    });
    return row;
}
function button(text, handler) {
    const result = document.createElement('button');
    result.textContent = text;
    result.type = 'button';
    result.addEventListener('click', handler);
    return result;
}
function distinctLabel(key) {
    return [...new Set(viewContacts().flatMap(contact => contact[key]))].sort((a, b) => a.localeCompare(b, 'ar'));
}
function viewContacts() {
    return contacts.filter(row => Boolean(row.deleted_at) === (contactView === 'trash'));
}

function showView(view) {
    for (const control of document.querySelectorAll('[data-view]')) {
        if (control.dataset.view === view) control.setAttribute('aria-current', 'page');
        else control.removeAttribute('aria-current');
        $(control.dataset.view + '-panel').hidden = control.dataset.view !== view;
    }
}

function drawDashboard() {
    const counts = new Map();
    let active = 0;
    for (const row of contacts) {
        if (row.deleted_at) continue;
        active++;
        for (const category of row.categories) counts.set(category, (counts.get(category) || 0) + 1);
    }
    $('stat-active').textContent = active.toLocaleString('ar');
    $('stat-trash').textContent = (contacts.length - active).toLocaleString('ar');
    $('stat-categories').textContent = counts.size.toLocaleString('ar');
    const summary = $('category-summary');
    summary.replaceChildren();
    if (!counts.size) {
        summary.textContent = 'لا توجد تصنيفات بعد.';
        return;
    }
    for (const [label, count] of [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ar')).slice(0, 8)) {
        const item = button(label, () => {
            $('search').value = '';
            $('dob-filter').value = '';
            $('dob-ignore-year').checked = false;
            switchContactView('active');
            $('category-filter').value = label;
            clearSelection();
            showView('contacts');
        });
        const total = document.createElement('span');
        total.textContent = count.toLocaleString('ar');
        item.append(total);
        summary.append(item);
    }
}

function setContactFilters() {
    options($('country-filter'), [...new Set(viewContacts().map(row => row.country).filter(Boolean))], 'كل الدول', countryName);
    options($('category-filter'), distinctLabel('categories'), 'كل التصنيفات');
    options($('tag-filter'), distinctLabel('tags'), 'كل التاغات');
}

function clearSelection() {
    selected.clear();
    page = 0;
    drawContacts();
}

function switchContactView(view) {
    contactView = view;
    for (const id of ['country-filter', 'category-filter', 'tag-filter']) $(id).value = '';
    setContactFilters();
    clearSelection();
}

function filtered() {
    const query = $('search').value.trim().toLocaleLowerCase();
    const digits = asciiDigits(query).replace(/[^\d]/g, '');
    const dob = $('dob-filter').value;
    const withoutYear = $('dob-ignore-year').checked;
    return viewContacts().filter(row => (!query || row.name.toLocaleLowerCase().includes(query) ||
        (digits && !/\p{L}/u.test(query) && row.phone.includes(digits))) &&
        (!$('country-filter').value || row.country === $('country-filter').value) &&
        (!$('category-filter').value || row.categories.includes($('category-filter').value)) &&
        (!$('tag-filter').value || row.tags.includes($('tag-filter').value)) &&
        (!dob || (withoutYear ? row.dob?.slice(5) === dob.slice(5) : row.dob === dob)));
}
function drawContacts() {
    const rows = filtered();
    const total = Math.max(1, Math.ceil(rows.length / pageSize));
    page = Math.min(page, total - 1);
    const trash = contactView === 'trash';
    const visible = rows.slice(page * pageSize, (page + 1) * pageSize);
    $('count').textContent = `${rows.length} من ${viewContacts().length} سجل`;
    $('page').textContent = `${page + 1} / ${total}`;
    $('prev').disabled = page === 0;
    $('next').disabled = page + 1 === total;
    $('export').disabled = !rows.length;
    $('export').hidden = trash;
    $('add').hidden = trash;
    $('view-active').setAttribute('aria-pressed', String(!trash));
    $('view-trash').setAttribute('aria-pressed', String(trash));
    const table = $('contacts');
    table.replaceChildren();
    for (const row of visible) {
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'select-record';
        checkbox.setAttribute('aria-label', 'تحديد ' + (row.name || row.phone));
        checkbox.checked = selected.has(row.id);
        checkbox.addEventListener('change', () => {
            if (checkbox.checked) selected.add(row.id);
            else selected.delete(row.id);
            updateSelection(rows, visible);
        });
        const tr = appendRow(table, [checkbox, row.name, row.nationality, row.emid, row.phone, row.email, row.dob, row.gender, countryName(row.country),
            row.categories.join('، '), row.tags.join('، '), trash ? '' : button('تعديل', () => openEditor(row))]);
        tr.cells[0].className = 'selection-cell';
        tr.cells[4].className = 'phone';
    }
    $('contacts-empty').hidden = rows.length !== 0;
    updateSelection(rows, visible);
}

function updateSelection(rows, visible) {
    const count = selected.size;
    const pageCount = visible.filter(row => selected.has(row.id)).length;
    const trash = contactView === 'trash';
    $('selected-count').textContent = count ? `تم تحديد ${count} سجل` : '';
    $('select-page').checked = visible.length > 0 && pageCount === visible.length;
    $('select-page').indeterminate = pageCount > 0 && pageCount < visible.length;
    $('select-page').disabled = !visible.length || bulkWorking;
    $('select-filtered').disabled = !rows.length || count === rows.length || bulkWorking;
    $('clear-selection').hidden = !count;
    $('soft-delete').hidden = trash;
    $('restore-selected').hidden = !trash;
    for (const id of ['soft-delete', 'permanent-delete', 'restore-selected']) $(id).disabled = !count || bulkWorking;
}

function requestBulk(mode, ids = [...selected]) {
    if (!ids.length || bulkWorking) return;
    bulkRequest = {mode, ids, view: contactView};
    const permanent = mode === 'permanent';
    $('bulk-title').textContent = permanent ? 'حذف نهائي' : mode === 'restore' ? 'استرجاع السجلات' : 'نقل إلى المحذوفات';
    $('bulk-message').textContent = permanent
        ? `سيتم حذف ${ids.length} سجل من قاعدة البيانات نهائياً. لا يمكن استرجاعها. هل تؤكد الحذف؟`
        : mode === 'restore' ? `استرجاع ${ids.length} سجل إلى جهات الاتصال النشطة؟`
            : `نقل ${ids.length} سجل إلى المحذوفات؟ يمكنك استرجاعها لاحقاً.`;
    $('bulk-confirm').textContent = permanent ? 'تأكيد الحذف النهائي' : 'تأكيد';
    $('bulk-confirm').className = permanent ? 'danger' : 'primary';
    $('bulk-error').textContent = '';
    $('bulk-dialog').showModal();
    $('bulk-cancel').focus();
}
async function loadContacts() {
    const rows = [];
    let batch;
    let after = 0;
    do {
        ({rows: batch} = await api('list', {after}));
        for (const row of batch) rows.push(row);
        if (batch.length) after = batch.at(-1).id;
    } while (batch.length === 1000);
    contacts = rows;
    setContactFilters();
    selected.clear();
    drawDashboard();
    drawContacts();
}

function drawReview(renderRows = true) {
    const archived = new Set(contacts.filter(row => row.deleted_at).map(row => row.phone));
    const existing = new Set(contacts.filter(row => !row.deleted_at).map(row => row.phone));
    const seen = new Set(existing);
    const counts = {valid: 0, duplicate: 0, invalid: 0, details: 0, archived: 0};
    for (const row of pending) {
        row.parsed = parseUAEPhone(row.raw);
        row.state = row.parsed.state;
        row.detailsError = profileError({...profileValues(row), dob: ''});
        if (row.state === 'valid' && archived.has(row.parsed.phone)) row.state = 'archived';
        if (row.state === 'valid' && row.detailsError) row.state = 'details';
        if (row.state === 'valid') {
            if (seen.has(row.parsed.phone)) row.state = 'duplicate';
            seen.add(row.parsed.phone);
        }
        counts[row.state]++;
    }
    const selection = $('review-filter').value;
    const rows = pending.filter(row => selection ? row.state === selection : !['invalid', 'archived'].includes(row.state));
    const total = Math.max(1, Math.ceil(rows.length / pageSize));
    reviewPage = Math.min(reviewPage, total - 1);
    $('review-count').textContent = `صالحة ${counts.valid} · مكررة ${counts.duplicate} · مستبعدة تلقائياً ${counts.invalid} · موجودة بالمحذوفات ${counts.archived} · بيانات تحتاج تصحيح ${counts.details}`;
    $('review-page').textContent = `${reviewPage + 1} / ${total}`;
    $('review-prev').disabled = reviewPage === 0;
    $('review-next').disabled = reviewPage + 1 === total;
    $('save').disabled = working || counts.valid + counts.duplicate === 0;
    const table = $('review-rows');
    if (!renderRows) {
        for (const tr of table.rows) {
            tr.cells[8].textContent = rowStatus(tr.pendingRow);
            tr.cells[8].className = tr.pendingRow.state;
        }
        return;
    }
    table.replaceChildren();
    for (const row of rows.slice(reviewPage * pageSize, (reviewPage + 1) * pageSize)) {
        const name = document.createElement('input');
        name.value = row.name;
        name.maxLength = 200;
        name.setAttribute('aria-label', 'الاسم');
        name.disabled = working;
        name.addEventListener('input', () => row.name = name.value);
        const phone = document.createElement('input');
        phone.value = row.raw;
        phone.dir = 'ltr';
        phone.disabled = working;
        phone.setAttribute('aria-label', 'رقم الهاتف');
        phone.addEventListener('input', () => {
            row.raw = phone.value;
            drawReview(false);
        });
        const fields = profileFields.map(({key, ar}) => {
            const input = document.createElement('input');
            input.value = row[key] || '';
            input.setAttribute('aria-label', ar);
            input.disabled = working;
            input.addEventListener('input', () => {
                row[key] = key === 'dob' ? normalizeDOB(input.value, 'DMY') : input.value;
                drawReview(false);
            });
            if (key === 'dob') input.addEventListener('blur', () => input.value = row[key]);
            return input;
        });
        const status = rowStatus(row);
        const remove = button('استبعاد', () => {
            pending = pending.filter(other => other !== row);
            drawReview();
        });
        remove.disabled = working;
        const tr = appendRow(table, [button(row.source.label, () => openSource(row.source)), name, phone, ...fields, status, remove]);
        tr.pendingRow = row;
        tr.cells[2].className = 'phone';
        tr.cells[8].className = row.state;
    }
}
function rowStatus(row) {
    if (row.state === 'archived') return 'الرقم موجود في المحذوفات. يمكن استرجاعه من جهات الاتصال.';
    return row.parsed.reason || row.detailsError || (row.state === 'duplicate' ? 'مكرر · ستُضاف التصنيفات' : 'صالح') + ' · ' + row.parsed.phone;
}
function openSource(source) {
    $('source-label').textContent = source.label;
    $('source-text').textContent = source.text || '';
    const image = $('source-image');
    image.hidden = !source.image;
    if (source.image) {
        sourceUrl = URL.createObjectURL(source.image);
        image.src = sourceUrl;
    }
    $('source-dialog').showModal();
}
function openEditor(row) {
    editing = row;
    const form = $('edit-form');
    form.reset();
    form.elements.name.value = row?.name || '';
    form.elements.phone.value = row?.phone || '';
    form.elements.country.value = row?.country || '';
    for (const {key} of profileFields) form.elements[key].value = row?.[key] || '';
    form.elements.categories.value = row?.categories.join('\n') || '';
    form.elements.tags.value = row?.tags.join('\n') || '';
    $('delete').hidden = !row;
    $('edit-error').textContent = '';
    $('editor-title').textContent = row ? 'تعديل السجل' : 'إضافة سجل';
    $('editor').showModal();
}
function lines(value) {
    return [...new Set(value.split(/\r?\n/).map(part => part.trim()).filter(Boolean))];
}
async function enter() {
    $('login').hidden = true;
    $('archive').hidden = false;
    $('logout').hidden = false;
    await loadContacts();
}
options($('editor-country'), countries, 'اختيار الدولة', countryName);
for (const id of ['search', 'country-filter', 'category-filter', 'tag-filter', 'dob-filter', 'dob-ignore-year']) {
    bind(id, 'input', clearSelection);
}
bind('prev', 'click', () => { page--; drawContacts(); });
bind('next', 'click', () => { page++; drawContacts(); });
bind('review-prev', 'click', () => { reviewPage--; drawReview(); });
bind('review-next', 'click', () => { reviewPage++; drawReview(); });
bind('review-filter', 'change', () => { reviewPage = 0; drawReview(); });
bind('login', 'submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('button');
    submit.disabled = true;
    try {
        await api('login', Object.fromEntries(new FormData(form)));
        form.reset();
        notice('');
        await enter();
    } finally {
        submit.disabled = false;
    }
});
bind('logout', 'click', async () => {
    await api('logout', {});
    location.reload();
});
bind('export', 'click', () => {
    const rows = filtered().map(row => [row.name, row.nationality, row.emid, row.phone, row.email, row.dob || '', row.gender, countryName(row.country), row.categories.join('، '), row.tags.join('، ')]);
    const sheet = XLSX.utils.aoa_to_sheet([['Name', 'Nationality', 'EMID', 'Mobile #', 'Email', 'DOB', 'Gender', 'Phone country', 'Categories', 'Tags'], ...rows]);
    sheet['!cols'] = [26, 20, 24, 20, 32, 15, 16, 24, 35, 35].map(wch => ({wch}));
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'Contacts');
    XLSX.writeFile(book, 'VITA-Contacts.xlsx');
});
bind('add', 'click', () => openEditor());
bind('close-editor', 'click', () => $('editor').close());
for (const control of document.querySelectorAll('[data-view]')) {
    control.addEventListener('click', () => showView(control.dataset.view));
}
bind('contacts-import', 'click', () => showView('import'));
bind('view-active', 'click', () => switchContactView('active'));
bind('view-trash', 'click', () => switchContactView('trash'));
bind('select-page', 'change', event => {
    for (const row of filtered().slice(page * pageSize, (page + 1) * pageSize)) {
        if (event.currentTarget.checked) selected.add(row.id);
        else selected.delete(row.id);
    }
    drawContacts();
});
bind('select-filtered', 'click', () => {
    for (const row of filtered()) selected.add(row.id);
    drawContacts();
});
bind('clear-selection', 'click', clearSelection);
bind('soft-delete', 'click', () => requestBulk('soft'));
bind('restore-selected', 'click', () => requestBulk('restore'));
bind('permanent-delete', 'click', () => requestBulk('permanent'));
bind('delete', 'click', () => {
    if (!editing) return;
    $('editor').close();
    requestBulk('soft', [editing.id]);
});
bind('bulk-cancel', 'click', () => $('bulk-dialog').close());
bind('bulk-dialog', 'cancel', event => {
    if (bulkWorking) event.preventDefault();
});
bind('bulk-form', 'submit', async event => {
    event.preventDefault();
    if (bulkWorking || !bulkRequest) return;
    bulkWorking = true;
    $('bulk-confirm').disabled = true;
    $('bulk-cancel').disabled = true;
    $('bulk-error').textContent = '';
    try {
        const result = await api('bulk', bulkRequest);
        $('bulk-dialog').close();
        const action = bulkRequest.mode === 'restore' ? 'استرجاع' : bulkRequest.mode === 'soft' ? 'نقل إلى المحذوفات' : 'حذف نهائي';
        notice(`تم تنفيذ ${action} على ${result.affected} سجل.`);
        await loadContacts();
        if (pending.length) drawReview();
    } catch (error) {
        if ($('bulk-dialog').open) $('bulk-error').textContent = error.message;
        else notice(error.message);
    } finally {
        bulkWorking = false;
        $('bulk-confirm').disabled = false;
        $('bulk-cancel').disabled = false;
        drawContacts();
    }
});
bind('edit-form', 'submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = Object.fromEntries(new FormData(form));
    const parsed = parsePhone(fields.phone, fields.country);
    if (parsed.state !== 'valid') {
        $('edit-error').textContent = parsed.reason;
        return;
    }
    if (!editing && contacts.some(row => row.phone === parsed.phone)) {
        $('edit-error').textContent = 'رقم الهاتف موجود في سجل آخر.';
        return;
    }
    const row = {...profileValues(fields), name: fields.name.trim(), phone: parsed.phone, country: parsed.country,
        categories: lines(fields.categories), tags: lines(fields.tags)};
    const invalid = profileError(row);
    if (invalid) {
        $('edit-error').textContent = invalid;
        return;
    }
    const submit = form.querySelector('button');
    submit.disabled = true;
    try {
        await api(editing ? 'edit' : 'add', editing ? {...row, id: editing.id} : row);
        $('editor').close();
        await loadContacts();
        if (pending.length) drawReview();
    } catch (error) {
        $('edit-error').textContent = error.message;
    } finally {
        submit.disabled = false;
    }
});
bind('import-form', 'submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    if (working || ((pending.length || mapping) && !confirm('استبدال نتائج المراجعة الحالية بملفات جديدة؟'))) return;
    const inputs = [...form.elements];
    const fields = new FormData(form);
    const label = fields.get('category').trim();
    if (!label) throw new Error('أدخل تصنيف الدفعة.');
    working = true;
    inputs.forEach(input => input.disabled = true);
    $('review').hidden = true;
    $('mapping-form').hidden = true;
    pending = [];
    mapping = undefined;
    try {
        const result = await extractFiles(fields.getAll('files'), notice);
        category = label;
        report = result.reports;
        if (result.sheets.length) {
            mapping = result;
            drawMapping(result.sheets);
            notice(report.join('\n'));
        } else {
            startReview(result.rows);
        }
    } finally {
        working = false;
        inputs.forEach(input => input.disabled = false);
        drawReview();
    }
});
function startReview(rows) {
    pending = rows.map(row => ({...row, name: [...row.name].slice(0, 200).join('')}));
    reviewPage = 0;
    $('review-filter').value = '';
    $('review').hidden = !pending.length;
    notice(report.join('\n') || (pending.length ? 'راجع السجلات قبل الحفظ.' : 'لم تُكتشف سجلات.'));
    drawReview();
}

function drawMapping(sheets) {
    const container = $('mapping-sheets');
    container.replaceChildren();
    sheets.forEach((sheet, index) => {
        const group = document.createElement('fieldset');
        const title = document.createElement('legend');
        title.textContent = sheet.label;
        const fields = document.createElement('div');
        fields.className = 'fields';
        const controls = {};
        function addControl(key, text, input) {
            const label = document.createElement('label');
            input.name = index + '-' + key;
            controls[key] = input;
            label.append(text, input);
            fields.append(label);
        }
        const include = document.createElement('input');
        include.type = 'checkbox';
        include.checked = true;
        addControl('include', 'استيراد هذه الورقة', include);
        const header = document.createElement('input');
        header.type = 'checkbox';
        header.checked = true;
        addControl('header', 'أول صف عناوين', header);
        for (const field of mappingFields) {
            addControl(field.key, field.ar, document.createElement('select'));
        }
        const dates = document.createElement('select');
        options(dates, ['DMY', 'MDY'], 'اختر ترتيب التاريخ', value => value === 'DMY' ? 'DD/MM/YYYY' : 'MM/DD/YYYY');
        dates.options[0].remove();
        dates.value = 'DMY';
        addControl('dates', 'ترتيب التاريخ النصّي', dates);
        const width = sheet.rows.reduce((max, row) => Math.max(max, row.length), 0);
        const columns = Array.from({length: width}, (_, i) => String(i));
        function fillColumns(suggest) {
            for (const field of mappingFields) {
                const select = controls[field.key];
                options(select, columns, field.key === 'phone' ? 'اختر عموداً' : 'تجاهل الحقل', value => {
                    const i = Number(value);
                    const letter = XLSX.utils.encode_col(i);
                    const heading = header.checked ? String(sheet.rows[0]?.[i] ?? '').trim() : '';
                    const sample = sheet.rows.slice(header.checked ? 1 : 0, 5).map(row => row[i]).find(value => value !== '' && value != null);
                    return [letter, heading, sample == null ? '' : String(sample).slice(0, 65)].filter(Boolean).join(' · ');
                });
                if (suggest && header.checked) {
                    const match = sheet.rows[0].findIndex(value => field.match.test(String(value).replace(/[^\p{L}\p{N}]/gu, '')));
                    if (match >= 0) select.value = String(match);
                }
            }
        }
        fillColumns(true);
        header.addEventListener('change', () => fillColumns(false));
        include.addEventListener('change', () => {
            for (const [key, control] of Object.entries(controls)) {
                if (key !== 'include') control.disabled = !include.checked;
            }
        });
        group.append(title, fields);
        container.append(group);
    });
    $('mapping-form').hidden = false;
}
bind('mapping-form', 'submit', event => {
    event.preventDefault();
    if (!mapping) return;
    const result = mapping;
    const data = new FormData(event.currentTarget);
    const mapped = [...result.rows];
    for (const [index, sheet] of result.sheets.entries()) {
        if (!data.has(index + '-include')) continue;
        const columns = {};
        for (const {key} of mappingFields) {
            const value = data.get(index + '-' + key);
            if (value !== '') columns[key] = Number(value);
        }
        if (columns.phone === undefined) throw new Error('اختر عمود رقم الموبايل في ' + sheet.label);
        if (new Set(Object.values(columns)).size !== Object.keys(columns).length) {
            throw new Error('اختر عموداً مختلفاً لكل حقل في ' + sheet.label);
        }
        for (const row of mapTable(sheet, columns, data.has(index + '-header'), data.get(index + '-dates'))) mapped.push(row);
    }
    mapping = undefined;
    $('mapping-form').hidden = true;
    $('mapping-sheets').replaceChildren();
    startReview(mapped);
});
bind('source-dialog', 'close', () => {
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    sourceUrl = undefined;
    $('source-image').removeAttribute('src');
});
bind('save', 'click', async () => {
    if (working) return;
    drawReview(false);
    const rows = pending.filter(row => row.state === 'valid' || row.state === 'duplicate');
    const submit = $('import-form').querySelector('button');
    working = true;
    submit.disabled = true;
    drawReview();
    let saved = 0;
    let archived = 0;
    try {
        for (let i = 0; i < rows.length; i += 500) {
            const batch = rows.slice(i, i + 500);
            const result = await api('import', {rows: batch.map(row => ({...profileValues(row), name: row.name.trim(), phone: row.parsed.phone,
                country: row.parsed.country, categories: [category], tags: []}))});
            archived += result.archived || 0;
            saved += batch.length - (result.archived || 0);
            const completed = new Set(batch);
            pending = pending.filter(row => !completed.has(row));
        }
        notice([`تمت معالجة ${saved} سجل صالح، بما فيها الأرقام المكررة.`, ...(archived ? [`تم تجاوز ${archived} سجلاً موجوداً في المحذوفات.`] : []), ...report].join('\n'));
    } catch (error) {
        notice(`تمت معالجة ${saved} سجل قبل توقف الحفظ. ${error.message}`);
    } finally {
        working = false;
        submit.disabled = false;
        await loadContacts();
        $('review').hidden = !pending.length;
        drawReview();
    }
});

try {
    const result = await api('status');
    if (result.loggedIn) await enter();
    else $('login').hidden = false;
} catch (error) {
    notice(error.message);
}
