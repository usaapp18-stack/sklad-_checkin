<?php
if (!defined('PVZ_APP')) {
    http_response_code(403);
    exit('Direct access prohibited.');
}

function uuidv4(): string {
    $data = random_bytes(16);
    $data[6] = chr((ord($data[6]) & 0x0f) | 0x40);
    $data[8] = chr((ord($data[8]) & 0x3f) | 0x80);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
}

function nowIso(): string {
    return (new DateTimeImmutable('now', new DateTimeZone('UTC')))->format('Y-m-d\TH:i:s.000\Z');
}

function toIsoString(?string $value): ?string {
    if ($value === null || trim($value) === '') {
        return null;
    }
    try {
        $dt = new DateTimeImmutable($value, new DateTimeZone('UTC'));
        return $dt->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\TH:i:s.000\Z');
    } catch (Throwable $e) {
        return $value;
    }
}

function getTodayMoscowDate(): string {
    $dt = new DateTimeImmutable('now', new DateTimeZone('Europe/Moscow'));
    return $dt->format('Y-m-d');
}

function getMoscowTimeParts(): array {
    $dt = new DateTimeImmutable('now', new DateTimeZone('Europe/Moscow'));
    return [
        'timeStr' => $dt->format('H:i'),
        'dateStr' => $dt->format('Y-m-d'),
        'hour' => (int)$dt->format('H'),
        'minute' => (int)$dt->format('i'),
        'displayTime' => $dt->format('H:i:s'),
        'displayDateTime' => $dt->format('d.m.Y H:i'),
    ];
}

function formatDateRu(?string $iso): string {
    if (!$iso) return '';
    try {
        $dt = new DateTimeImmutable($iso, new DateTimeZone('UTC'));
        return $dt->setTimezone(new DateTimeZone('Europe/Moscow'))->format('d.m.Y');
    } catch (Throwable $e) {
        return substr($iso, 0, 10);
    }
}

function formatDateDDMMYYYY(?string $dateStr): string {
    if (!$dateStr) return '';
    $clean = substr($dateStr, 0, 10);
    $parts = explode('-', $clean);
    if (count($parts) === 3) {
        return "{$parts[2]}-{$parts[1]}-{$parts[0]}";
    }
    return $dateStr;
}

function isValidCalendarDate(string $dateStr): bool {
    if (!preg_match('/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/', $dateStr)) {
        return false;
    }
    $dt = DateTimeImmutable::createFromFormat('Y-m-d', $dateStr);
    return $dt !== false && $dt->format('Y-m-d') === $dateStr;
}

function normalizePhone(string $input): string {
    $digits = preg_replace('/\D/', '', $input);
    if (strlen($digits) === 11 && ($digits[0] === '7' || $digits[0] === '8')) {
        return '+7' . substr($digits, 1);
    }
    if (strlen($digits) === 10) {
        return '+7' . $digits;
    }
    return trim($input);
}

function jsonResponse(array $payload, int $status = 200): void {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function jsonError(string $code, string $message, int $status = 400): void {
    jsonResponse([
        'success' => false,
        'error' => [
            'code' => $code,
            'message' => $message,
        ],
    ], $status);
}

function getRequestJson(): array {
    static $parsed = null;
    if ($parsed !== null) return $parsed;
    $raw = file_get_contents('php://input');
    if ($raw === false || trim($raw) === '') {
        $parsed = $_POST ?: [];
        return $parsed;
    }
    $decoded = json_decode($raw, true);
    $parsed = is_array($decoded) ? $decoded : [];
    return $parsed;
}

function getRequestHeadersLower(): array {
    static $cache = null;
    if ($cache !== null) return $cache;
    $headers = [];
    if (function_exists('getallheaders')) {
        foreach (getallheaders() as $k => $v) {
            $headers[strtolower($k)] = $v;
        }
    }
    foreach ($_SERVER as $k => $v) {
        if (str_starts_with($k, 'HTTP_')) {
            $name = strtolower(str_replace('_', '-', substr($k, 5)));
            if (!isset($headers[$name])) {
                $headers[$name] = $v;
            }
        }
    }
    if (!isset($headers['authorization'])) {
        if (!empty($_SERVER['HTTP_AUTHORIZATION'])) {
            $headers['authorization'] = $_SERVER['HTTP_AUTHORIZATION'];
        } elseif (!empty($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) {
            $headers['authorization'] = $_SERVER['REDIRECT_HTTP_AUTHORIZATION'];
        }
    }
    $cache = $headers;
    return $cache;
}

function getHeader(string $name): ?string {
    $headers = getRequestHeadersLower();
    return $headers[strtolower($name)] ?? null;
}

function getClientIp(): string {
    if (!empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
        $parts = explode(',', $_SERVER['HTTP_X_FORWARDED_FOR']);
        $candidate = trim($parts[0]);
        if (filter_var($candidate, FILTER_VALIDATE_IP)) {
            return $candidate;
        }
    }
    return $_SERVER['REMOTE_ADDR'] ?? 'unknown';
}

function isHttpsRequest(): bool {
    if (!empty($_SERVER['HTTPS']) && strtolower($_SERVER['HTTPS']) !== 'off') {
        return true;
    }
    if (!empty($_SERVER['HTTP_X_FORWARDED_PROTO']) && strtolower(trim(explode(',', $_SERVER['HTTP_X_FORWARDED_PROTO'])[0])) === 'https') {
        return true;
    }
    if (!empty($_SERVER['SERVER_PORT']) && (int)$_SERVER['SERVER_PORT'] === 443) {
        return true;
    }
    return false;
}

function getBaseUrl(): string {
    $scheme = isHttpsRequest() ? 'https' : 'http';
    $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
    // Sanitize host header to prevent host-header injection
    $host = preg_replace('/[^a-zA-Z0-9.\-:\[\]]/', '', $host);
    return "{$scheme}://{$host}";
}

function setAppCookie(string $name, string $value, int $maxAgeSeconds, bool $httpOnly): void {
    $isHttps = isHttpsRequest();
    $expires = gmdate('D, d M Y H:i:s \G\M\T', time() + $maxAgeSeconds);
    $parts = [
        rawurlencode($name) . '=' . rawurlencode($value),
        'Expires=' . $expires,
        'Max-Age=' . $maxAgeSeconds,
        'Path=/',
    ];
    if ($httpOnly) {
        $parts[] = 'HttpOnly';
    }
    if ($isHttps) {
        $parts[] = 'Secure';
        $parts[] = 'SameSite=None';
        $parts[] = 'Partitioned';
    } else {
        $parts[] = 'SameSite=Lax';
    }
    header('Set-Cookie: ' . implode('; ', $parts), false);
}

function clearAppCookie(string $name, bool $httpOnly): void {
    $isHttps = isHttpsRequest();
    $parts = [
        rawurlencode($name) . '=',
        'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
        'Max-Age=0',
        'Path=/',
    ];
    if ($httpOnly) {
        $parts[] = 'HttpOnly';
    }
    if ($isHttps) {
        $parts[] = 'Secure';
        $parts[] = 'SameSite=None';
        $parts[] = 'Partitioned';
    } else {
        $parts[] = 'SameSite=Lax';
    }
    header('Set-Cookie: ' . implode('; ', $parts), false);
}

function getTariffPlans(): array {
    return [
        [
            'id' => 'start',
            'name' => 'Старт',
            'subtitle' => 'Для одного склада или ПВЗ с небольшой командой',
            'maxLocations' => 1,
            'maxStaff' => 2,
            'monthlyPriceRub' => 1900,
        ],
        [
            'id' => 'business',
            'name' => 'Бизнес',
            'subtitle' => 'Для двух объектов и слаженной смены до 5 человек',
            'maxLocations' => 2,
            'maxStaff' => 5,
            'monthlyPriceRub' => 3900,
            'recommended' => true,
        ],
        [
            'id' => 'maximum',
            'name' => 'Максимум',
            'subtitle' => 'Для сети складов, фулфилмента и крупных команд',
            'maxLocations' => 30,
            'maxStaff' => 150,
            'monthlyPriceRub' => 4900,
        ],
    ];
}

function getBillingPeriods(): array {
    return [
        ['months' => 1, 'label' => '1 месяц', 'shortLabel' => '1 мес', 'discountPercent' => 0],
        ['months' => 3, 'label' => '3 месяца', 'shortLabel' => '3 мес', 'discountPercent' => 5],
        ['months' => 6, 'label' => '6 месяцев', 'shortLabel' => '6 мес', 'discountPercent' => 10],
        ['months' => 12, 'label' => '12 месяцев', 'shortLabel' => '12 мес', 'discountPercent' => 20],
    ];
}

function getTariffById(string $id): array {
    foreach (getTariffPlans() as $plan) {
        if ($plan['id'] === $id) return $plan;
    }
    return getTariffPlans()[1]; // business
}

function isValidTariffId($val): bool {
    return in_array($val, ['start', 'business', 'maximum'], true);
}

function normalizeBillingPeriod($val): int {
    $n = (int)$val;
    return in_array($n, [1, 3, 6, 12], true) ? $n : 1;
}

function calculateTariffPrice(string $tariffId, int $months): array {
    $plan = getTariffById($tariffId);
    $period = ['months' => 1, 'discountPercent' => 0];
    foreach (getBillingPeriods() as $p) {
        if ($p['months'] === $months) {
            $period = $p;
            break;
        }
    }
    $baseTotal = $plan['monthlyPriceRub'] * $period['months'];
    $discount = $period['discountPercent'];
    $finalPrice = ($baseTotal * (100 - $discount)) / 100;
    return [
        'tariffId' => $plan['id'],
        'months' => $period['months'],
        'monthlyPriceRub' => $plan['monthlyPriceRub'],
        'baseTotalRub' => $baseTotal,
        'discountPercent' => $discount,
        'finalPriceRub' => $finalPrice,
        'effectiveMonthlyRub' => $finalPrice / $period['months'],
        'savingsRub' => $baseTotal - $finalPrice,
    ];
}

/**
 * Restricted outbound HTTP client (only allows HTTPS requests to allowlisted API hosts).
 */
function httpJsonRequest(string $method, string $url, ?array $body = null, array $headers = []): array {
    $parsed = parse_url($url);
    $scheme = strtolower($parsed['scheme'] ?? '');
    $host = strtolower($parsed['host'] ?? '');
    $allowedHosts = ['api.telegram.org', 'api.yookassa.ru'];
    if ($scheme !== 'https' || !in_array($host, $allowedHosts, true)) {
        return ['ok' => false, 'status' => 403, 'data' => null, 'error' => 'Host not allowed'];
    }

    $payloadStr = $body !== null ? json_encode($body, JSON_UNESCAPED_UNICODE) : null;
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        $curlHeaders = [];
        foreach ($headers as $k => $v) {
            $curlHeaders[] = "{$k}: {$v}";
        }
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CUSTOMREQUEST => strtoupper($method),
            CURLOPT_TIMEOUT => 10,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_HTTPHEADER => $curlHeaders,
        ]);
        if ($payloadStr !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, $payloadStr);
        }
        $raw = curl_exec($ch);
        $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err = curl_error($ch);
        curl_close($ch);
        if ($raw === false) {
            return ['ok' => false, 'status' => 0, 'data' => null, 'error' => $err ?: 'Network error'];
        }
        $data = json_decode($raw, true);
        return [
            'ok' => $status >= 200 && $status < 300,
            'status' => $status,
            'data' => is_array($data) ? $data : null,
            'error' => null,
        ];
    }

    $headerLines = [];
    foreach ($headers as $k => $v) {
        $headerLines[] = "{$k}: {$v}";
    }
    $ctx = stream_context_create([
        'http' => [
            'method' => strtoupper($method),
            'header' => implode("\r\n", $headerLines),
            'content' => $payloadStr ?? '',
            'timeout' => 10,
            'ignore_errors' => true,
        ],
    ]);
    $raw = @file_get_contents($url, false, $ctx);
    $status = 0;
    if (isset($http_response_header[0]) && preg_match('/\s(\d{3})\s/', $http_response_header[0], $m)) {
        $status = (int)$m[1];
    }
    if ($raw === false) {
        return ['ok' => false, 'status' => $status, 'data' => null, 'error' => 'Network error'];
    }
    $data = json_decode($raw, true);
    return [
        'ok' => $status >= 200 && $status < 300,
        'status' => $status,
        'data' => is_array($data) ? $data : null,
        'error' => null,
    ];
}
