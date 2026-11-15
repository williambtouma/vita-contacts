export function asciiDigits(value) {
    return String(value ?? '').replace(/[٠-٩۰-۹]/g, char => String(char.charCodeAt(0) % 16));
}

export function parsePhone(value, region, library = globalThis.libphonenumber) {
    const cleaned = asciiDigits(value).trim().replace(/[\s().\-–—\u200e\u200f\u061c]/g, '').replace(/^00/, '+');
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
