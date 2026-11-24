<?php
declare(strict_types=1);

define('PVZ_APP', true);

// Security headers
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: strict-origin-when-cross-origin');
header('Permissions-Policy: geolocation=(self), camera=(self), microphone=()');
header('X-Frame-Options: SAMEORIGIN');

// Strict same-origin CORS when Origin header is present
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$host = $_SERVER['HTTP_HOST'] ?? '';
if ($origin !== '' && $host !== '') {
    $originHost = parse_url($origin, PHP_URL_HOST);
    $originPort = parse_url($origin, PHP_URL_PORT);
    $originAuthority = $originHost . ($originPort ? ':' . $originPort : '');
    if ($originHost && (strcasecmp($originAuthority, $host) === 0 || strcasecmp($originHost, explode(':', $host)[0]) === 0)) {
        header('Access-Control-Allow-Origin: ' . $origin);
        header('Access-Control-Allow-Credentials: true');
        header('Vary: Origin');
    }
}
header('Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-CSRF-Token, X-Cron-Key, X-Yookassa-Webhook-Token');

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// Load configuration (user config.php or safe defaults from config.example.php)
$config = [];
if (file_exists(__DIR__ . '/config.php')) {
    $loaded = require __DIR__ . '/config.php';
    if (is_array($loaded)) {
        $config = $loaded;
    }
} elseif (file_exists(__DIR__ . '/config.example.php')) {
    $loaded = require __DIR__ . '/config.example.php';
    if (is_array($loaded)) {
        $config = $loaded;
    }
}

require_once __DIR__ . '/php_api/helpers.php';
require_once __DIR__ . '/php_api/db.php';
require_once __DIR__ . '/php_api/auth.php';
require_once __DIR__ . '/php_api/services.php';
require_once __DIR__ . '/php_api/routes_org_billing.php';
require_once __DIR__ . '/php_api/routes_staff_locs.php';
require_once __DIR__ . '/php_api/routes_shifts.php';
require_once __DIR__ . '/php_api/routes_comms.php';

try {
    $db = new AppDb($config);
    $db->initSchemaAndSeed($config);
} catch (Throwable $e) {
    jsonError('DB_ERROR', 'Ошибка подключения к базе данных. Проверьте настройки в config.php.', 500);
}

$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');

// Legacy action parameter compatibility (/api.php?action=telegram_notify)
$legacyAction = $_GET['action'] ?? '';
if ($legacyAction === 'telegram_notify') {
    try {
        $currentUser = authenticateRequest($db, $config);
        verifyCsrfAndOrigin($method, 'v1/telegram/notify', $currentUser);
        handleTelegramRoutes($db, $config, $method, 'notify', $currentUser);
    } catch (Throwable $e) {
        jsonError('INTERNAL_ERROR', 'Внутренняя ошибка сервера', 500);
    }
}

// Extract and normalize route path
$rawRoute = '';
if (isset($_GET['__route__'])) {
    $rawRoute = (string)$_GET['__route__'];
} else {
    $uriPath = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
    $rawRoute = preg_replace('#^/(api/)?#', '', $uriPath);
}

$routePath = trim($rawRoute, '/');
$trimmedRoute = preg_replace('#^v1/#', '', $routePath);

// Throttled lightweight maintenance every 5 minutes (unless handled explicitly by /cron/tick)
if ($trimmedRoute !== 'cron/tick') {
    try {
        $lastMaint = $db->queryOne("SELECT value FROM settings WHERE {$db->qi('key')} = ?", ['last_maintenance_at']);
        $lastTs = $lastMaint ? (int)$lastMaint['value'] : 0;
        if (time() - $lastTs >= 300) {
            $db->upsert('settings', [
                'key' => 'last_maintenance_at',
                'value' => (string)time(),
                'updated_at' => gmdate('Y-m-d H:i:s'),
            ], ['key'], ['value', 'updated_at']);
            runScheduledMaintenance($db, $config, false);
        }
    } catch (Throwable $e) {
        // Non-blocking
    }
}

try {
    $currentUser = authenticateRequest($db, $config);
    verifyCsrfAndOrigin($method, $routePath, $currentUser);

    $segments = $trimmedRoute === '' ? [] : explode('/', $trimmedRoute);
    $resource = $segments[0] ?? '';
    $subRoute = count($segments) > 1 ? implode('/', array_slice($segments, 1)) : '';

    switch ($resource) {
        case 'auth':
            handleAuthRoutes($db, $config, $method, $subRoute, $currentUser);
            break;
        case 'organization':
            handleOrganizationRoutes($db, $config, $method, $subRoute, $currentUser);
            break;
        case 'billing':
            handleBillingRoutes($db, $config, $method, $subRoute, $currentUser);
            break;
        case 'public':
            handlePublicRoutes($db, $config, $method, $subRoute);
            break;
        case 'health':
            handleHealthRoutes($db, $config, $method, $subRoute);
            break;
        case 'cron':
            handleCronRoutes($db, $config, $method, $subRoute);
            break;
        case 'staff':
            handleStaffRoutes($db, $config, $method, $subRoute, $currentUser);
            break;
        case 'locations':
            handleLocationsRoutes($db, $config, $method, $subRoute, $currentUser);
            break;
        case 'applications':
            handleApplicationsRoutes($db, $config, $method, $subRoute, $currentUser);
            break;
        case 'checkins':
            handleCheckinsRoutes($db, $config, $method, $subRoute, $currentUser);
            break;
        case 'checkin-alerts':
            handleCheckinsRoutes($db, $config, $method, 'checkin-alerts', $currentUser);
            break;
        case 'sales':
            handleSalesRoutes($db, $config, $method, $subRoute, $currentUser);
            break;
        case 'schedules':
            handleSchedulesRoutes($db, $config, $method, $subRoute, $currentUser);
            break;
        case 'swaps':
            handleSwapsRoutes($db, $config, $method, $subRoute, $currentUser);
            break;
        case 'availability':
            handleAvailabilityRoutes($db, $config, $method, $subRoute, $currentUser);
            break;
        case 'rates':
            handleRatesRoutes($db, $config, $method, $subRoute, $currentUser);
            break;
        case 'messages':
            handleMessagesRoutes($db, $config, $method, $subRoute, $currentUser);
            break;
        case 'notifications':
            handleNotificationsRoutes($db, $config, $method, $subRoute, $currentUser);
            break;
        case 'income-goals':
        case 'goals':
            handleGoalsRoutes($db, $config, $method, $subRoute, $currentUser);
            break;
        case 'payback':
            handlePaybackRoutes($db, $config, $method, $subRoute, $currentUser);
            break;
        case 'bot':
            handleBotRoutes($db, $config, $method, $subRoute, $currentUser);
            break;
        case 'telegram':
            handleTelegramRoutes($db, $config, $method, $subRoute, $currentUser);
            break;
        case 'audit-logs':
            handleAuditRoutes($db, $config, $method, $subRoute, $currentUser);
            break;
        default:
            jsonError('NOT_FOUND', 'Конечная точка API не найдена', 404);
    }
} catch (RuntimeException $re) {
    if ($re->getMessage() === 'SHIFT_ALREADY_CLOSED') {
        jsonError('SHIFT_ALREADY_CLOSED', 'Смена за выбранную дату уже завершена (Check-out). Для изменений обратитесь к руководителю.', 403);
    }
    if ($re->getMessage() === 'EDIT_LIMIT_EXCEEDED') {
        jsonError('EDIT_LIMIT_EXCEEDED', 'Работник может изменять свою отмеченную смену только один раз. В случае необходимости обратитесь к руководителю, чтобы руководитель сам внёс изменение.', 403);
    }
    jsonError('INTERNAL_ERROR', 'Внутренняя ошибка сервера', 500);
} catch (Throwable $e) {
    jsonError('INTERNAL_ERROR', 'Внутренняя ошибка сервера', 500);
}
