import {asciiDigits, parsePhone} from './phone.mjs';
import {extractFiles} from './import.mjs';

const $ = id => document.getElementById(id);
const display = new Intl.DisplayNames(['ar'], {type: 'region'});
const countryName = code => code ? display.of(code) : '—';
const gulf = ['AE', 'SA', 'OM', 'KW', 'QA', 'BH'];
const countries = [...gulf, ...libphonenumber.getCountries().filter(code => !gulf.includes(code))
    .sort((a, b) => countryName(a).localeCompare(countryName(b), 'ar'))];
const pageSize = 50;
let csrf = '';
let contacts = [];
let pending = [];
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
    return [...new Set(contacts.flatMap(contact => contact[key]))].sort((a, b) => a.localeCompare(b, 'ar'));
}
function filtered() {
    const query = $('search').value.trim().toLocaleLowerCase();
    const digits = asciiDigits(query).replace(/[^\d]/g, '');
    return contacts.filter(row => (!query || row.name.toLocaleLowerCase().includes(query) ||
        (digits && !/\p{L}/u.test(query) && row.phone.includes(digits))) &&
        (!$('country-filter').value || row.country === $('country-filter').value) &&
        (!$('category-filter').value || row.categories.includes($('category-filter').value)) &&
        (!$('tag-filter').value || row.tags.includes($('tag-filter').value)));
}
function drawContacts() {
    const rows = filtered();
    const total = Math.max(1, Math.ceil(rows.length / pageSize));
    page = Math.min(page, total - 1);
    $('count').textContent = `${rows.length} من ${contacts.length} سجل`;
    $('page').textContent = `${page + 1} / ${total}`;
    $('prev').disabled = page === 0;
    $('next').disabled = page + 1 === total;
    $('export').disabled = !rows.length;
    const table = $('contacts');
    table.replaceChildren();
    for (const row of rows.slice(page * pageSize, (page + 1) * pageSize)) {
        const tr = appendRow(table, [row.name, row.phone, countryName(row.country),
            row.categories.join('، '), row.tags.join('، '), button('تعديل', () => openEditor(row))]);
        tr.cells[1].className = 'phone';
    }
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
    options($('country-filter'), [...new Set(rows.map(r => r.country).filter(Boolean))], 'كل الدول', countryName);
    options($('category-filter'), distinctLabel('categories'), 'كل التصنيفات');
    options($('tag-filter'), distinctLabel('tags'), 'كل التاغات');
    drawContacts();
}

function drawReview(renderRows = true) {
    const existing = new Set(contacts.map(r => r.phone));
    const seen = new Set(existing);
    const counts = {valid: 0, duplicate: 0, missing: 0, invalid: 0};
    for (const row of pending) {
        row.parsed = parsePhone(row.raw, row.region);
        row.state = row.parsed.state;
        if (row.state === 'valid') {
            if (seen.has(row.parsed.phone)) row.state = 'duplicate';
            seen.add(row.parsed.phone);
        }
        counts[row.state]++;
    }
    const selection = $('review-filter').value;
    const rows = pending.filter(row => !selection || row.state === selection);
    const total = Math.max(1, Math.ceil(rows.length / pageSize));
    reviewPage = Math.min(reviewPage, total - 1);
    $('review-count').textContent = `صالحة ${counts.valid} · مكررة ${counts.duplicate} · بحاجة لتحديد الدولة ${counts.missing} · غير صالحة ${counts.invalid}`;
    $('review-page').textContent = `${reviewPage + 1} / ${total}`;
    $('review-prev').disabled = reviewPage === 0;
    $('review-next').disabled = reviewPage + 1 === total;
    $('save').disabled = working || counts.valid + counts.duplicate === 0;
    $('remove-invalid').disabled = working || counts.invalid === 0;
    const table = $('review-rows');
    if (!renderRows) {
        for (const tr of table.rows) {
            tr.cells[4].textContent = rowStatus(tr.pendingRow);
            tr.cells[4].className = tr.pendingRow.state;
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
        const country = document.createElement('select');
        country.setAttribute('aria-label', 'دولة الرقم المحلي');
        options(country, countries, 'اختيار الدولة', countryName);
        country.value = row.region;
        country.disabled = working;
        country.addEventListener('change', () => {
            row.region = country.value;
            drawReview();
        });
        const status = rowStatus(row);
        const remove = button('استبعاد', () => {
            pending = pending.filter(other => other !== row);
            drawReview();
        });
        remove.disabled = working;
        const tr = appendRow(table, [button(row.source.label, () => openSource(row.source)), name, phone, country, status, remove]);
        tr.pendingRow = row;
        tr.cells[4].className = row.state;
    }
}
function rowStatus(row) {
    return row.parsed.reason || (row.state === 'duplicate' ? 'مكرر · ستُضاف التصنيفات' : 'صالح') + ' · ' + row.parsed.phone;
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
for (const id of ['region', 'editor-country']) options($(id), countries, 'اختيار الدولة', countryName);
for (const id of ['search', 'country-filter', 'category-filter', 'tag-filter']) {
    bind(id, 'input', () => { page = 0; drawContacts(); });
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
    const rows = filtered().map(row => [row.name, row.phone, countryName(row.country), row.categories.join('، '), row.tags.join('، ')]);
    const sheet = XLSX.utils.aoa_to_sheet([['الاسم', 'رقم الهاتف', 'الدولة', 'التصنيفات', 'التاغات'], ...rows]);
    sheet['!cols'] = [26, 20, 24, 35, 35].map(wch => ({wch}));
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'Contacts');
    XLSX.writeFile(book, 'VITA-Contacts.xlsx');
});
bind('add', 'click', () => openEditor());
bind('close-editor', 'click', () => $('editor').close());
bind('delete', 'click', async () => {
    if (!editing || !confirm('حذف هذا السجل من الأرشيف؟')) return;
    try {
        await api('delete', {id: editing.id});
        $('editor').close();
        await loadContacts();
    } catch (error) {
        $('edit-error').textContent = error.message;
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
    const row = {name: fields.name.trim(), phone: parsed.phone, country: parsed.country,
        categories: lines(fields.categories), tags: lines(fields.tags)};
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
bind('show-import', 'click', () => {
    $('import-panel').hidden = !$('import-panel').hidden;
    if (!$('import-panel').hidden) $('import-panel').scrollIntoView({behavior: 'smooth'});
});
bind('import-form', 'submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    if (working || (pending.length && !confirm('استبدال نتائج المراجعة الحالية بملفات جديدة؟'))) return;
    const inputs = [...form.elements];
    const fields = new FormData(form);
    const label = fields.get('category').trim();
    if (!label) throw new Error('أدخل تصنيف الدفعة.');
    working = true;
    inputs.forEach(input => input.disabled = true);
    $('review').hidden = true;
    try {
        const result = await extractFiles(fields.getAll('files'), notice);
        category = label;
        pending = result.rows.map(row => ({...row, name: row.name.slice(0, 200), region: fields.get('region')}));
        report = result.reports;
        reviewPage = 0;
        $('review-filter').value = '';
        $('review').hidden = !pending.length;
        notice(report.join('\n') || (pending.length ? 'انتهت القراءة. راجع السجلات قبل الحفظ.' : 'لم تُكتشف سجلات.'));
    } finally {
        working = false;
        inputs.forEach(input => input.disabled = false);
        drawReview();
    }
});
bind('remove-invalid', 'click', () => {
    pending = pending.filter(row => row.state !== 'invalid');
    drawReview();
});
bind('source-dialog', 'close', () => {
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    sourceUrl = undefined;
    $('source-image').removeAttribute('src');
});
bind('save', 'click', async () => {
    if (working) return;
    const rows = pending.filter(row => row.parsed.state === 'valid');
    const submit = $('import-form').querySelector('button');
    working = true;
    submit.disabled = true;
    drawReview();
    let saved = 0;
    try {
        for (let i = 0; i < rows.length; i += 500) {
            const batch = rows.slice(i, i + 500);
            await api('import', {rows: batch.map(row => ({name: row.name.trim(), phone: row.parsed.phone,
                country: row.parsed.country, categories: [category], tags: []}))});
            saved += batch.length;
            const completed = new Set(batch);
            pending = pending.filter(row => !completed.has(row));
        }
        notice([`تمت معالجة ${saved} سجل صالح، بما فيها الأرقام المكررة.`, ...report].join('\n'));
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
