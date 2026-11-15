<?php
declare(strict_types=1);

function whatsappResults(array $response, array $phones): array {
    $requested = array_fill_keys($phones, true);
    $statuses = [];
    $conflicts = [];
    foreach (($response['contacts'] ?? []) as $row) {
        if (!is_array($row)) continue;
        $input = $row['input'] ?? null;
        if (!is_string($input) || !preg_match('/^\+?[1-9]\d{1,14}$/D', $input)) continue;
        $phone = ltrim($input, '+');
        if (!isset($requested[$phone])) continue;
        $status = match ($row['status'] ?? null) {
            'valid' => 'yes',
            'invalid' => 'no',
            default => null,
        };
        if ($status === null || isset($conflicts[$phone])) continue;
        if (isset($statuses[$phone]) && $statuses[$phone] !== $status) {
            unset($statuses[$phone]);
            $conflicts[$phone] = true;
        } else {
            $statuses[$phone] = $status;
        }
    }
    return $statuses;
}

function whatsappLookup(string $token, array $phones): array {
    if (!function_exists('curl_init')) {
        reply(['error' => 'فعّل امتداد PHP cURL على الاستضافة أولاً.'], 503);
    }
    $curl = curl_init('https://gate.whapi.cloud/contacts');
    curl_setopt_array($curl, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_TIMEOUT => 18,
        CURLOPT_HTTPHEADER => ['Accept: application/json', 'Content-Type: application/json', 'Authorization: Bearer ' . $token],
        CURLOPT_POSTFIELDS => json_encode(['contacts' => $phones], JSON_THROW_ON_ERROR),
    ]);
    $raw = curl_exec($curl);
    $status = curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
    curl_close($curl);
    if ($raw === false || $status !== 200) {
        $message = match ($status) {
            401, 403 => 'Whapi رفض الاتصال. تحقق من توكن القناة وحالة الربط.',
            402, 429 => 'Whapi أوقف الفحص بسبب حد الخطة أو عدد الطلبات. بقيت النتائج المحفوظة.',
            default => 'تعذّر الاتصال بخدمة فحص واتساب. جرّب لاحقاً.',
        };
        reply(['error' => $message], 502);
    }
    $response = json_decode($raw, true);
    if (!is_array($response) || !is_array($response['contacts'] ?? null)) {
        reply(['error' => 'وصل رد غير متوقع من خدمة فحص واتساب.'], 502);
    }
    return whatsappResults($response, $phones);
}
