import {asciiDigits} from './phone.mjs';

export const profileFields = [
    {key: 'nationality', label: 'Nationality', ar: 'الجنسية', max: 120, match: /^(nationality|citizenship|الجنسية|جنسيه)$/i},
    {key: 'emid', label: 'EMID', ar: 'الهوية الإماراتية', max: 32, match: /^(emid|eid|emiratesid(number)?|الهويةالإماراتية|رقمالهوية)$/i},
    {key: 'email', label: 'Email', ar: 'البريد الإلكتروني', max: 254, match: /^(email(address)?|البريدالإلكتروني|ايميل)$/i},
    {key: 'dob', label: 'DOB', ar: 'تاريخ الميلاد', max: 32, match: /^(dob|birthdate|dateofbirth|تاريخالميلاد|المواليد)$/i},
    {key: 'gender', label: 'Gender', ar: 'الجنس', max: 60, match: /^(gender|sex|الجنس|النوع)$/i}
];
export const mappingFields = [
    {key: 'name', ar: 'الاسم', match: /^(full(name)?|name|patientname|customername|الاسم|اسم|الاسمالكامل)$/i},
    {key: 'phone', ar: 'رقم الموبايل', match: /^(phone(number)?|mobile(number|no)?|telephone|whatsapp|contactnumber|الموبايل|رقمالموبايل|الهاتف|رقمالهاتف|الجوال|رقمالجوال)$/i},
    ...profileFields
];

export const tagHeader = /^(?:tags?|labels?|التاغات|التاغ|تاغات|تاغ|الوسوم|وسوم|وسم)\p{N}*$/iu;

const dubaiDate = new Intl.DateTimeFormat('sv-SE', {timeZone: 'Asia/Dubai'});

function dateParts(year, month, day) {
    const value = [year, month, day].map((part, index) => String(part).padStart(index ? 2 : 4, '0')).join('-');
    return validDOB(value) ? value : '';
}

export function validDOB(value) {
    if (!/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value + 'T00:00:00Z');
    const today = dubaiDate.format(new Date());
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value && value <= today;
}

export function normalizeDOB(value, order = 'DMY', date1904 = false) {
    if (typeof value === 'number') {
        const date = globalThis.XLSX.SSF.parse_date_code(value, {date1904});
        return date ? dateParts(date.y, date.m, date.d) : '';
    }
    const raw = asciiDigits(value).trim().replace(/(?:T|\s+)\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:\s*(?:AM|PM|Z|[+-]\d{2}:?\d{2}))?$/i, '');
    const iso = raw.match(/^(\d{4})([-/.])(\d{1,2})\2(\d{1,2})$/);
    if (iso) return dateParts(iso[1], iso[3], iso[4]);
    const local = raw.match(/^(\d{1,2})([-/.])(\d{1,2})\2(\d{4})$/);
    if (!local) return '';
    const [, first, , second, year] = local;
    if (Number(first) > 12 || Number(second) > 12) {
        return Number(first) > 12 ? dateParts(year, second, first) : dateParts(year, first, second);
    }
    return order === 'MDY' ? dateParts(year, first, second) : dateParts(year, second, first);
}

export function profileValues(row) {
    return Object.fromEntries(profileFields.map(({key}) => [key, String(row[key] ?? '').trim()]));
}

export function profileError(row) {
    const {dob, email} = row;
    if (dob && !validDOB(dob)) return 'تاريخ الميلاد غير صالح.';
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'صيغة البريد الإلكتروني غير صالحة.';
    const long = profileFields.find(({key, max}) => [...(row[key] || '')].length > max);
    return long ? long.ar + ' يتجاوز الطول المسموح.' : '';
}

export function parseTags(value) {
    const tags = new Map();
    for (const part of value) {
        const tag = String(part ?? '').trim();
        if (tag && !tags.has(tag.toLowerCase())) tags.set(tag.toLowerCase(), tag);
    }
    return [...tags.values()];
}

export function tagsError(tags) {
    if (tags.length > 100) return 'الحد الأقصى 100 تاغ لكل سجل.';
    return tags.some(tag => [...tag].length > 120) ? 'أحد التاغات يتجاوز 120 حرفاً.' : '';
}

export function mapTable(table, columns, hasHeader, dateOrder, tagColumns = []) {
    return table.rows.slice(hasHeader ? 1 : 0).flatMap(row => {
        const value = key => columns[key] === undefined ? '' : row[columns[key]] ?? '';
        const raw = String(value('phone')).trim();
        const tags = parseTags(tagColumns.map(index => row[index]));
        if (!tags.length && !mappingFields.some(({key}) => String(value(key)).trim())) return [];
        const contact = {
            name: String(value('name')).trim(), raw, tags,
            ...Object.fromEntries(profileFields.map(({key}) => [key, String(value(key)).trim()])),
            source: {label: table.label, text: row.join(' | ')}
        };
        contact.dob = normalizeDOB(value('dob'), dateOrder, table.date1904);
        return [contact];
    });
}
