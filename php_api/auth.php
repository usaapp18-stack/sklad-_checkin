<?php
if (!defined('PVZ_APP')) {
    http_response_code(403);
    exit('Direct access prohibited.');
}

const DEFAULT_LEGACY_ORG_ID = 'org-default';

function hashSessionToken(string $token): string {
    return hash('sha256', $token);
}

function setCsrfCookieToken(): string {
    $token = bin2hex(random_bytes(32));
    setAppCookie('pvz_csrf', $token, 30 * 24 * 60 * 60, false);
    return $token;
}

function getOrgSetting(AppDb $db, string $organizationId, string $key, $fallback = null) {
    try {
        $row = $db->queryOne(
            "SELECT value FROM org_settings WHERE organization_id = ? AND {$db->qi('key')} = ?",
            [$organizationId, $key]
        );
        if ($row && !empty($row['value'])) {
            $decoded = json_decode($row['value'], true);
            if ($decoded !== null || json_last_error() === JSON_ERROR_NONE) {
                return $decoded;
            }
        }
        if ($organizationId === DEFAULT_LEGACY_ORG_ID) {
            $legacy = $db->queryOne(
                "SELECT value FROM settings WHERE {$db->qi('key')} = ?",
                [$key]
            );
            if ($legacy && !empty($legacy['value'])) {
                $decoded = json_decode($legacy['value'], true);
                if ($decoded !== null || json_last_error() === JSON_ERROR_NONE) {
                    return $decoded;
                }
            }
        }
    } catch (Throwable $e) {
        // Fallback silently
    }
    return $fallback;
}

function setOrgSetting(AppDb $db, string $organizationId, string $key, $value): void {
    $serialized = is_string($value) ? $value : json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $db->upsert('org_settings', [
        'organization_id' => $organizationId,
        'key' => $key,
        'value' => $serialized,
        'updated_at' => gmdate('Y-m-d H:i:s'),
    ], ['organization_id', 'key'], ['value', 'updated_at']);
}

function logAudit(
    AppDb $db,
    ?array $currentUser,
    ?string $userId,
    string $action,
    string $entity,
    ?string $entityId,
    ?array $details = null,
    ?string $organizationId = null
): void {
    try {
        $id = 'aud-' . uuidv4();
        $ip = getClientIp();
        $ua = $_SERVER['HTTP_USER_AGENT'] ?? null;
        $detailsStr = $details !== null ? json_encode($details, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) : null;
        $resolvedOrgId = $organizationId ?? ($currentUser['organizationId'] ?? null);

        $db->execute(
            'INSERT INTO audit_logs (id, organization_id, user_id, action, entity, entity_id, ip, user_agent, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [$id, $resolvedOrgId, $userId, $action, $entity, $entityId, $ip, $ua, $detailsStr]
        );
    } catch (Throwable $e) {
        // Non-blocking audit log
    }
}

function checkRateLimit(AppDb $db, string $bucketPrefix, int $maxAttempts, int $windowSeconds, string $limitMessage): void {
    $ip = getClientIp();
    $bucketKey = $bucketPrefix . ':' . hash('sha256', $ip);
    $now = time();

    $row = $db->queryOne('SELECT count, reset_at FROM rate_limits WHERE bucket_key = ?', [$bucketKey]);
    if (!$row || $now > (int)$row['reset_at']) {
        $db->upsert('rate_limits', [
            'bucket_key' => $bucketKey,
            'count' => 1,
            'reset_at' => $now + $windowSeconds,
        ], ['bucket_key'], ['count', 'reset_at']);
        return;
    }

    $count = (int)$row['count'];
    $resetAt = (int)$row['reset_at'];
    if ($count >= $maxAttempts) {
        $retryAfter = max(1, $resetAt - $now);
        header('Retry-After: ' . $retryAfter);
        $mins = (int)ceil($retryAfter / 60);
        jsonError('RATE_LIMIT_EXCEEDED', str_replace('{mins}', (string)$mins, $limitMessage), 429);
    }

    $db->execute('UPDATE rate_limits SET count = count + 1 WHERE bucket_key = ?', [$bucketKey]);
}

function authenticateRequest(AppDb $db, array $config): ?array {
    $authHeader = getHeader('authorization') ?? '';
    $token = null;
    if (str_starts_with($authHeader, 'Bearer ')) {
        $token = trim(substr($authHeader, 7));
    } elseif (!empty($_COOKIE['pvz_session'])) {
        $token = (string)$_COOKIE['pvz_session'];
    }

    if (!$token) {
        return null;
    }

    $tokenHash = hashSessionToken($token);
    $session = $db->queryOne(
        'SELECT s.user_id, s.expires_at, u.login, u.email, u.phone, u.name, u.role, u.status,
                u.active_organization_id, u.is_part_time, u.is_senior, u.telegram_username,
                u.position, u.pay_type, u.hourly_rate, u.shift_rate, u.night_rate
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ?',
        [$tokenHash]
    );

    if (!$session) {
        return null;
    }

    try {
        $exp = new DateTimeImmutable($session['expires_at']);
        if ($exp < new DateTimeImmutable('now', new DateTimeZone('UTC'))) {
            $db->execute('DELETE FROM sessions WHERE token_hash = ?', [$tokenHash]);
            return null;
        }
    } catch (Throwable $e) {
        return null;
    }

    if ($session['status'] === 'blocked' || $session['status'] === 'archived') {
        return null;
    }

    $organizationId = $session['active_organization_id'] ?: null;
    $orgRole = null;

    if ($organizationId) {
        $mem = $db->queryOne(
            'SELECT org_role, status FROM organization_members WHERE organization_id = ? AND user_id = ?',
            [$organizationId, $session['user_id']]
        );
        if ($mem && $mem['status'] === 'active') {
            $orgRole = $mem['org_role'] ?: $session['role'];
        } else {
            $orgRole = $session['role'];
        }
    } else {
        $fallbackMem = $db->queryOne(
            "SELECT organization_id, org_role FROM organization_members WHERE user_id = ? AND status = 'active' LIMIT 1",
            [$session['user_id']]
        );
        if ($fallbackMem) {
            $organizationId = $fallbackMem['organization_id'];
            $orgRole = $fallbackMem['org_role'] ?: $session['role'];
        }
    }

    $organization = $organizationId ? getOrganizationById($db, $organizationId) : null;
    $subscription = $organizationId ? getOrganizationSubscription($db, $organizationId) : null;

    $locations = [];
    if ($organizationId) {
        $locRows = $db->queryAll(
            'SELECT l.code FROM locations l
             JOIN user_locations ul ON ul.location_id = l.id
             WHERE ul.user_id = ? AND l.organization_id = ?',
            [$session['user_id'], $organizationId]
        );
        $locations = array_map(fn($r) => $r['code'], $locRows);
    }

    return [
        'id' => $session['user_id'],
        'login' => $session['login'],
        'email' => $session['email'] ?: null,
        'phone' => $session['phone'] ?: null,
        'name' => $session['name'],
        'role' => $session['role'],
        'status' => $session['status'],
        'organizationId' => $organizationId,
        'orgRole' => $orgRole,
        'organization' => $organization,
        'subscription' => $subscription,
        'isPartTime' => (bool)$session['is_part_time'],
        'isSenior' => (bool)$session['is_senior'],
        'telegramUsername' => $session['telegram_username'] ?: null,
        'position' => $session['position'] ?: 'Работник склада',
        'payType' => ($session['pay_type'] === 'shift') ? 'shift' : 'hourly',
        'hourlyRate' => $session['hourly_rate'] !== null ? (float)$session['hourly_rate'] : 350,
        'shiftRate' => $session['shift_rate'] !== null ? (float)$session['shift_rate'] : 3500,
        'nightRate' => $session['night_rate'] !== null ? (float)$session['night_rate'] : 0,
        'locations' => $locations,
        'sessionToken' => $token,
    ];
}

function requireAuth(?array $user): array {
    if (!$user) {
        jsonError('UNAUTHORIZED', 'Требуется авторизация в системе', 401);
    }
    return $user;
}

function requireManager(?array $user): array {
    $u = requireAuth($user);
    if ($u['role'] !== 'manager') {
        jsonError('FORBIDDEN', 'Доступ разрешен только руководителю', 403);
    }
    return $u;
}

function requireOrganization(?array $user): array {
    $u = requireAuth($user);
    if (empty($u['organizationId'])) {
        jsonError('ORGANIZATION_REQUIRED', 'Для начала работы создайте организацию в рабочем кабинете', 409);
    }
    return $u;
}

function requireActiveWriteAccess(?array $user): array {
    $u = requireOrganization($user);
    $sub = $u['subscription'] ?? null;
    if ($sub && (($sub['status'] ?? '') === 'expired_readonly' || !empty($sub['isReadOnly']))) {
        jsonError(
            'SUBSCRIPTION_EXPIRED_READONLY',
            'Срок действия пробного периода или подписки истёк. Включён режим только для чтения. Оформите подписку, чтобы вносить изменения.',
            403
        );
    }
    return $u;
}

function verifyCsrfAndOrigin(string $method, string $routePath, ?array $user): void {
    if (in_array($method, ['GET', 'HEAD', 'OPTIONS'], true)) {
        return;
    }

    $exemptPrefixes = [
        'v1/auth/login',
        'auth/login',
        'v1/auth/register-manager',
        'auth/register-manager',
        'v1/auth/csrf-token',
        'auth/csrf-token',
        'v1/public/contact',
        'public/contact',
        'v1/billing/webhooks/',
        'billing/webhooks/',
        'v1/cron/tick',
        'cron/tick',
    ];
    foreach ($exemptPrefixes as $prefix) {
        if (str_starts_with($routePath, $prefix)) {
            return;
        }
    }
    if ($routePath === 'v1/applications' || $routePath === 'applications') {
        return;
    }

    // Check Origin against Host when Origin header is present
    $origin = getHeader('origin');
    $host = $_SERVER['HTTP_HOST'] ?? '';
    if ($origin && $host) {
        $originHost = parse_url($origin, PHP_URL_HOST);
        $originPort = parse_url($origin, PHP_URL_PORT);
        $originAuthority = $originHost . ($originPort ? ':' . $originPort : '');
        if ($originHost && strcasecmp($originAuthority, $host) !== 0 && strcasecmp($originHost, explode(':', $host)[0]) !== 0) {
            jsonError('CSRF_INVALID', 'Недопустимый источник запроса (Origin)', 403);
        }
    }

    $authHeader = getHeader('authorization') ?? '';
    if (str_starts_with($authHeader, 'Bearer ')) {
        return;
    }

    $cookieToken = $_COOKIE['pvz_csrf'] ?? '';
    $headerToken = getHeader('x-csrf-token') ?? '';

    if ($cookieToken && $headerToken && hash_equals($cookieToken, $headerToken)) {
        return;
    }

    if ($user) {
        if ($headerToken && $cookieToken && !hash_equals($cookieToken, $headerToken)) {
            jsonError('CSRF_INVALID', 'Ошибка CSRF-валидации запроса', 403);
        }
        return;
    }

    jsonError('CSRF_INVALID', 'Ошибка CSRF-валидации запроса', 403);
}

function handleAuthRoutes(AppDb $db, array $config, string $method, string $subRoute, ?array $currentUser): void {
    // GET /auth/csrf-token
    if ($method === 'GET' && $subRoute === 'csrf-token') {
        $csrf = setCsrfCookieToken();
        jsonResponse(['success' => true, 'csrfToken' => $csrf]);
    }

    // POST /auth/register-manager
    if ($method === 'POST' && $subRoute === 'register-manager') {
        checkRateLimit($db, 'login', 15, 900, 'Слишком много попыток входа. Попробуйте через {mins} мин.');
        $body = getRequestJson();

        $fullName = trim((string)($body['fullName'] ?? ''));
        $email = strtolower(trim((string)($body['email'] ?? '')));
        $phone = trim((string)($body['phone'] ?? ''));
        $password = (string)($body['password'] ?? '');
        $acceptPrivacy = $body['acceptPrivacy'] ?? false;
        $acceptTerms = $body['acceptTerms'] ?? false;

        if (mb_strlen($fullName) < 2 || mb_strlen($fullName) > 150) {
            jsonError('VALIDATION_ERROR', 'Укажите ФИО (минимум 2 символа)', 400);
        }
        if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 180) {
            jsonError('VALIDATION_ERROR', 'Укажите корректный Email', 400);
        }
        if (strlen($password) < 6 || strlen($password) > 128) {
            jsonError('VALIDATION_ERROR', 'Пароль должен содержать не менее 6 символов', 400);
        }
        if ($acceptPrivacy !== true) {
            jsonError('VALIDATION_ERROR', 'Необходимо согласие на обработку персональных данных', 400);
        }
        if ($acceptTerms !== true) {
            jsonError('VALIDATION_ERROR', 'Необходимо принять условия пользовательского соглашения', 400);
        }

        $normalizedPhone = normalizePhone($phone);
        if (strlen(preg_replace('/\D/', '', $normalizedPhone)) < 11) {
            jsonError('VALIDATION_ERROR', 'Введите корректный номер телефона в формате +7...', 400);
        }

        $dup = $db->queryOne(
            'SELECT id FROM users
             WHERE LOWER(email) = LOWER(?)
                OR phone = ?
                OR LOWER(login) = LOWER(?)
                OR login = ?',
            [$email, $normalizedPhone, $email, $normalizedPhone]
        );
        if ($dup) {
            jsonError('ACCOUNT_EXISTS', 'Пользователь с таким Email или номером телефона уже зарегистрирован. Выполните вход.', 409);
        }

        $userId = 'mgr-' . uuidv4();
        $passwordHash = password_hash($password, PASSWORD_BCRYPT, ['cost' => 10]);
        $now = nowIso();

        $db->execute(
            'INSERT INTO users (
                id, login, password_hash, name, email, phone, role, status,
                active_organization_id, is_part_time, is_senior, position,
                consent_privacy_at, consent_terms_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, 0, ?, ?, ?)',
            [$userId, $normalizedPhone, $passwordHash, $fullName, $email, $normalizedPhone, 'manager', 'active', 'Начальник склада', $now, $now]
        );

        $sessionToken = uuidv4();
        $tokenHash = hashSessionToken($sessionToken);
        $expiresAt = (new DateTimeImmutable('+30 days', new DateTimeZone('UTC')))->format('Y-m-d\TH:i:s.000\Z');
        $db->execute(
            'INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)',
            ['sess-' . uuidv4(), $userId, $tokenHash, $expiresAt]
        );

        setAppCookie('pvz_session', $sessionToken, 30 * 24 * 60 * 60, true);
        $csrfToken = setCsrfCookieToken();
        logAudit($db, null, $userId, 'REGISTER_MANAGER', 'user', $userId, ['email' => $email, 'phone' => $normalizedPhone], null);

        jsonResponse([
            'success' => true,
            'token' => $sessionToken,
            'csrfToken' => $csrfToken,
            'user' => [
                'id' => $userId,
                'login' => $normalizedPhone,
                'email' => $email,
                'phone' => $normalizedPhone,
                'name' => $fullName,
                'role' => 'manager',
                'status' => 'active',
                'organization_id' => null,
                'org_role' => null,
                'organization' => null,
                'subscription' => null,
                'is_part_time' => false,
                'is_senior' => false,
                'position' => 'Начальник склада',
                'pay_type' => 'hourly',
                'hourly_rate' => 350,
                'shift_rate' => 3500,
                'night_rate' => 0,
                'locations' => [],
            ],
        ], 201);
    }

    // POST /auth/login
    if ($method === 'POST' && $subRoute === 'login') {
        checkRateLimit($db, 'login', 15, 900, 'Слишком много попыток входа. Попробуйте через {mins} мин.');
        $body = getRequestJson();
        $cleanLogin = trim((string)($body['login'] ?? ''));
        $password = (string)($body['password'] ?? '');

        if ($cleanLogin === '' || $password === '') {
            jsonError('VALIDATION_ERROR', 'Логин и пароль не могут быть пустыми', 400);
        }

        $normalizedPhone = normalizePhone($cleanLogin);
        $user = $db->queryOne(
            "SELECT id, login, email, phone, password_hash, name, role, status, active_organization_id,
                    is_part_time, is_senior, telegram_username, position, pay_type, hourly_rate, shift_rate, night_rate
             FROM users
             WHERE LOWER(login) = LOWER(?)
                OR login = ?
                OR LOWER(COALESCE(email, '')) = LOWER(?)
                OR COALESCE(phone, '') = ?",
            [$cleanLogin, $normalizedPhone, $cleanLogin, $normalizedPhone]
        );

        if (!$user || !password_verify($password, $user['password_hash'])) {
            jsonError('INVALID_CREDENTIALS', 'Неверный логин или пароль', 401);
        }

        if ($user['status'] === 'blocked' || $user['status'] === 'archived') {
            jsonError('ACCOUNT_BLOCKED', 'Учетная запись заблокирована или архивирована', 403);
        }

        $organizationId = $user['active_organization_id'] ?: null;
        $orgRole = null;
        if ($organizationId) {
            $mem = $db->queryOne(
                'SELECT org_role FROM organization_members WHERE organization_id = ? AND user_id = ?',
                [$organizationId, $user['id']]
            );
            $orgRole = $mem ? $mem['org_role'] : $user['role'];
        } else {
            $mem = $db->queryOne(
                "SELECT organization_id, org_role FROM organization_members WHERE user_id = ? AND status = 'active' LIMIT 1",
                [$user['id']]
            );
            if ($mem) {
                $organizationId = $mem['organization_id'];
                $orgRole = $mem['org_role'];
            }
        }

        $organization = $organizationId ? getOrganizationById($db, $organizationId) : null;
        $subscription = $organizationId ? getOrganizationSubscription($db, $organizationId) : null;

        $sessionToken = uuidv4();
        $tokenHash = hashSessionToken($sessionToken);
        $expiresAt = (new DateTimeImmutable('+30 days', new DateTimeZone('UTC')))->format('Y-m-d\TH:i:s.000\Z');
        $db->execute(
            'INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)',
            ['sess-' . uuidv4(), $user['id'], $tokenHash, $expiresAt]
        );

        $locations = [];
        if ($organizationId) {
            $locRows = $db->queryAll(
                'SELECT l.code FROM locations l
                 JOIN user_locations ul ON ul.location_id = l.id
                 WHERE ul.user_id = ? AND l.organization_id = ?',
                [$user['id'], $organizationId]
            );
            $locations = array_map(fn($r) => $r['code'], $locRows);
        }

        setAppCookie('pvz_session', $sessionToken, 30 * 24 * 60 * 60, true);
        $csrfToken = setCsrfCookieToken();
        logAudit($db, null, $user['id'], 'LOGIN', 'user', $user['id'], ['role' => $user['role'], 'login' => $user['login']], $organizationId);

        jsonResponse([
            'success' => true,
            'token' => $sessionToken,
            'csrfToken' => $csrfToken,
            'user' => [
                'id' => $user['id'],
                'login' => $user['login'],
                'email' => $user['email'] ?: null,
                'phone' => $user['phone'] ?: null,
                'name' => $user['name'],
                'role' => $user['role'],
                'status' => $user['status'],
                'organization_id' => $organizationId,
                'org_role' => $orgRole,
                'organization' => $organization,
                'subscription' => $subscription,
                'is_part_time' => (bool)$user['is_part_time'],
                'is_senior' => (bool)$user['is_senior'],
                'telegram_username' => $user['telegram_username'] ?: null,
                'position' => $user['position'] ?: 'Работник склада',
                'pay_type' => $user['pay_type'] ?: 'hourly',
                'hourly_rate' => $user['hourly_rate'] !== null ? (float)$user['hourly_rate'] : 350,
                'shift_rate' => $user['shift_rate'] !== null ? (float)$user['shift_rate'] : 3500,
                'night_rate' => $user['night_rate'] !== null ? (float)$user['night_rate'] : 0,
                'locations' => $locations,
            ],
        ]);
    }

    // POST /auth/logout
    if ($method === 'POST' && $subRoute === 'logout') {
        $u = requireAuth($currentUser);
        if (!empty($u['sessionToken'])) {
            $db->execute('DELETE FROM sessions WHERE token_hash = ?', [hashSessionToken($u['sessionToken'])]);
        }
        clearAppCookie('pvz_session', true);
        clearAppCookie('pvz_csrf', false);
        logAudit($db, $u, $u['id'], 'LOGOUT', 'user', $u['id']);
        jsonResponse(['success' => true, 'message' => 'Успешный выход из системы']);
    }

    // GET /auth/me
    if ($method === 'GET' && $subRoute === 'me') {
        $u = requireAuth($currentUser);
        $csrfToken = !empty($_COOKIE['pvz_csrf']) ? (string)$_COOKIE['pvz_csrf'] : setCsrfCookieToken();
        jsonResponse([
            'success' => true,
            'csrfToken' => $csrfToken,
            'user' => [
                'id' => $u['id'],
                'login' => $u['login'],
                'email' => $u['email'],
                'phone' => $u['phone'],
                'name' => $u['name'],
                'role' => $u['role'],
                'status' => $u['status'],
                'organization_id' => $u['organizationId'],
                'org_role' => $u['orgRole'],
                'organization' => $u['organization'],
                'subscription' => $u['subscription'],
                'is_part_time' => $u['isPartTime'],
                'is_senior' => $u['isSenior'],
                'telegram_username' => $u['telegramUsername'],
                'position' => $u['position'],
                'pay_type' => $u['payType'],
                'hourly_rate' => $u['hourlyRate'],
                'shift_rate' => $u['shiftRate'],
                'night_rate' => $u['nightRate'],
                'locations' => $u['locations'],
            ],
        ]);
    }

    jsonError('NOT_FOUND', 'Маршрут авторизации не найден', 404);
}
