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

export function normalizeDOB(value, order = 'DMY', date1904 = false) {
    if (typeof value === 'number') {
        const date = globalThis.XLSX.SSF.parse_date_code(value, {date1904});
        if (!date) return String(value);
        value = [date.y, date.m, date.d].map((part, i) => String(part).padStart(i ? 2 : 4, '0')).join('-');
    }
    const raw = asciiDigits(value).trim();
    if (!raw) return '';
    const iso = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
    const local = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
    if (!iso && !local) return raw;
    const [, year, month, day] = iso || [null, local[3], local[order === 'MDY' ? 1 : 2], local[order === 'MDY' ? 2 : 1]];
    return year + '-' + month.padStart(2, '0') + '-' + day.padStart(2, '0');
}

export function profileValues(row) {
    return Object.fromEntries(profileFields.map(({key}) => [key, String(row[key] ?? '').trim()]));
}

export function profileError(row) {
    const {dob, email} = row;
    if (dob) {
        const date = new Date(dob + 'T00:00:00Z');
        if (!/^[1-9]\d{3}-\d{2}-\d{2}$/.test(dob) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== dob) {
            return 'تاريخ الميلاد غير صالح. استخدم YYYY-MM-DD.';
        }
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'صيغة البريد الإلكتروني غير صالحة.';
    const long = profileFields.find(({key, max}) => [...(row[key] || '')].length > max);
    return long ? long.ar + ' يتجاوز الطول المسموح.' : '';
}

export function mapTable(table, columns, hasHeader, dateOrder) {
    return table.rows.slice(hasHeader ? 1 : 0).flatMap(row => {
        const value = key => columns[key] === undefined ? '' : row[columns[key]] ?? '';
        const raw = String(value('phone')).trim();
        if (!mappingFields.some(({key}) => String(value(key)).trim())) return [];
        const contact = {
            name: String(value('name')).trim(), raw,
            ...Object.fromEntries(profileFields.map(({key}) => [key, String(value(key)).trim()])),
            source: {label: table.label, text: row.join(' | ')}
        };
        contact.dob = normalizeDOB(value('dob'), dateOrder, table.date1904);
        return [contact];
    });
}
