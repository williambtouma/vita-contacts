export function asciiDigits(value) {
    return String(value ?? '').replace(/[٠-٩۰-۹]/g, char => String(char.charCodeAt(0) % 16));
}

function cleanPhone(value) {
    return asciiDigits(value).trim().replace(/[\s().\-–—\u200e\u200f\u061c]/g, '').replace(/^00/, '+');
}

export function parseUAEPhone(value, library = globalThis.libphonenumber) {
    const cleaned = cleanPhone(value);
    if (!/^\+?\d+$/.test(cleaned)) {
        return {state: 'invalid', reason: 'الرقم فارغ أو يحتوي على رموز غير صالحة'};
    }
    if (cleaned.startsWith('+') && !cleaned.startsWith('+971')) {
        return {state: 'invalid', reason: 'كود الدولة ليس 971'};
    }
    const digits = cleaned.replace(/^\+/, '');
    const international = cleaned.startsWith('+') || (digits.startsWith('971') && digits.length > 9);
    const canonical = international ? '+' + digits : '+971' + digits.replace(/^0/, '');
    const result = library.parsePhoneNumberFromString(canonical, {extract: false});
    if (result?.country !== 'AE' || result.number !== canonical || !result.isValid()) {
        return {state: 'invalid', reason: 'طول الرقم أو البادئة غير صالحَين للإمارات'};
    }
    return {state: 'valid', phone: result.number, country: 'AE'};
}

export function parsePhone(value, region, library = globalThis.libphonenumber) {
    const cleaned = cleanPhone(value);
    if (!/^\+?\d+$/.test(cleaned) || cleaned.replace('+', '').length < 5 || cleaned.replace('+', '').length > 15) {
        return {state: 'invalid', reason: 'الرقم يحتوي رموزاً غير صالحة أو طوله غير صحيح'};
    }
    if (!cleaned.startsWith('+') && !region) {
        return {state: 'missing', reason: 'حدّد الدولة أو أضف + قبل رمز الاتصال'};
    }
    const result = library.parsePhoneNumberFromString(cleaned, {defaultCountry: region || undefined, extract: false});
    if (!result?.isValid()) {
        return {state: 'invalid', reason: 'الطول أو البادئة غير صالحَين حسب خطة الترقيم'};
    }
    return {state: 'valid', phone: result.number, country: result.country || ''};
}
