<?php
if (!defined('PVZ_APP')) {
    http_response_code(403);
    exit('Direct access prohibited.');
}

function getDefaultWarehousePositions(): array {
    return [
        'Начальник склада',
        'Кладовщик',
        'Сборщик',
        'Упаковщик',
        'Сборщик/упаковщик',
        'Грузчик',
        'Приемщик',
        'Охранник',
        'Администратор',
        'Разнорабочий',
        'Работник склада',
    ];
}

function getWarehousePositions(AppDb $db, string $organizationId): array {
    $custom = getOrgSetting($db, $organizationId, 'warehouse_positions', []);
    $merged = array_merge(getDefaultWarehousePositions(), is_array($custom) ? $custom : []);
    return array_values(array_unique(array_filter(array_map('strval', $merged))));
}

function mapLocationRow(array $row): array {
    $assignedStaff = [];
    if (!empty($row['assigned_staff_ids'])) {
        $decoded = json_decode($row['assigned_staff_ids'], true);
        if (is_array($decoded)) {
            $assignedStaff = $decoded;
        } else {
            $assignedStaff = array_values(array_filter(array_map('trim', explode(',', (string)$row['assigned_staff_ids']))));
        }
    }

    $zones = ['Приёмка', 'Сборка', 'Упаковка', 'Отгрузка', 'Зона хранения'];
    if (!empty($row['zones'])) {
        $decodedZones = json_decode($row['zones'], true);
        if (is_array($decodedZones)) {
            $zones = $decodedZones;
        } else {
            $zones = array_values(array_filter(array_map('trim', explode(',', (string)$row['zones']))));
        }
    }

    return [
        'id' => $row['id'],
        'organizationId' => $row['organization_id'] ?: null,
        'code' => $row['code'],
        'name' => $row['name'],
        'address' => $row['address'] ?? '',
        'active' => (bool)($row['active'] ?? 1),
        'isArchived' => (bool)($row['is_archived'] ?? 0),
        'archivedAt' => !empty($row['archived_at']) ? toIsoString($row['archived_at']) : null,
        'assignedStaffIds' => $assignedStaff,
        'contactPhone' => $row['contact_phone'] ?? '',
        'notes' => $row['notes'] ?? '',
        'latitude' => $row['latitude'] !== null && $row['latitude'] !== '' ? (float)$row['latitude'] : null,
        'longitude' => $row['longitude'] !== null && $row['longitude'] !== '' ? (float)$row['longitude'] : null,
        'radiusMeters' => $row['radius_meters'] !== null && $row['radius_meters'] !== '' ? (int)$row['radius_meters'] : 300,
        'qrSecret' => !empty($row['qr_secret']) ? $row['qr_secret'] : 'SKLAD-' . ($row['code'] ?: $row['id']),
        'zones' => $zones,
        'createdAt' => toIsoString($row['created_at'] ?? null) ?? nowIso(),
        'updatedAt' => toIsoString($row['updated_at'] ?? null),
    ];
}

function getStoredLocations(AppDb $db, string $organizationId): array {
    $rows = $db->queryAll(
        'SELECT id, organization_id, code, name, address, active, is_archived, archived_at, contact_phone, notes,
                assigned_staff_ids, latitude, longitude, radius_meters, qr_secret, zones, created_at, updated_at
         FROM locations
         WHERE organization_id = ?
         ORDER BY created_at ASC, name ASC',
        [$organizationId]
    );
    $list = array_map('mapLocationRow', $rows);
    try {
        setOrgSetting($db, $organizationId, 'locations', $list);
    } catch (Throwable $e) {}
    return $list;
}

function saveSingleLocation(AppDb $db, array $loc, string $organizationId): void {
    $assignedJson = json_encode($loc['assignedStaffIds'] ?? [], JSON_UNESCAPED_UNICODE);
    $zonesJson = json_encode($loc['zones'] ?? ['Приёмка', 'Сборка', 'Упаковка', 'Отгрузка', 'Зона хранения'], JSON_UNESCAPED_UNICODE);
    $qrSecret = !empty($loc['qrSecret']) ? $loc['qrSecret'] : 'SKLAD-' . ($loc['code'] ?: $loc['id']);
    $createdDb = gmdate('Y-m-d H:i:s');
    if (!empty($loc['createdAt'])) {
        try {
            $createdDb = (new DateTimeImmutable((string)$loc['createdAt']))->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s');
        } catch (Throwable $e) {}
    }

    $db->upsert('locations', [
        'id' => $loc['id'],
        'organization_id' => $organizationId,
        'code' => $loc['code'],
        'name' => $loc['name'],
        'address' => $loc['address'] ?? '',
        'active' => !empty($loc['active']) ? 1 : 0,
        'is_archived' => !empty($loc['isArchived']) ? 1 : 0,
        'archived_at' => $loc['archivedAt'] ?? null,
        'contact_phone' => $loc['contactPhone'] ?? '',
        'notes' => $loc['notes'] ?? '',
        'assigned_staff_ids' => $assignedJson,
        'latitude' => $loc['latitude'] ?? null,
        'longitude' => $loc['longitude'] ?? null,
        'radius_meters' => $loc['radiusMeters'] ?? 300,
        'qr_secret' => $qrSecret,
        'zones' => $zonesJson,
        'created_at' => $createdDb,
        'updated_at' => gmdate('Y-m-d H:i:s'),
    ], ['id'], [
        'code', 'name', 'address', 'active', 'is_archived', 'archived_at',
        'contact_phone', 'notes', 'assigned_staff_ids', 'latitude', 'longitude',
        'radius_meters', 'qr_secret', 'zones', 'updated_at',
    ]);
}

function handleStaffRoutes(AppDb $db, array $config, string $method, string $subRoute, ?array $currentUser): void {
    // GET /staff/positions
    if ($method === 'GET' && $subRoute === 'positions') {
        $u = requireOrganization($currentUser);
        jsonResponse(['success' => true, 'positions' => getWarehousePositions($db, $u['organizationId'])]);
    }

    // POST /staff/positions
    if ($method === 'POST' && $subRoute === 'positions') {
        $u = requireManager($currentUser);
        $u = requireActiveWriteAccess($u);
        $orgId = $u['organizationId'];
        $body = getRequestJson();
        $cleanName = trim((string)($body['name'] ?? ''));
        if ($cleanName === '') {
            jsonResponse(['success' => false, 'error' => ['message' => 'Название должности обязательно']], 400);
        }
        $positions = getWarehousePositions($db, $orgId);
        if (!in_array($cleanName, $positions, true)) {
            $positions[] = $cleanName;
            setOrgSetting($db, $orgId, 'warehouse_positions', $positions);
        }
        jsonResponse(['success' => true, 'positions' => $positions]);
    }

    // GET /staff
    if ($method === 'GET' && $subRoute === '') {
        $u = requireOrganization($currentUser);
        $orgId = $u['organizationId'];
        $isManager = $u['role'] === 'manager';

        $usersSql = $isManager
            ? "SELECT id, login, password_plain, name, role, status, is_part_time, is_senior, telegram_username, position, pay_type, hourly_rate, shift_rate, night_rate, created_at, updated_at
               FROM users WHERE active_organization_id = ? AND role = 'employee' ORDER BY name ASC"
            : "SELECT id, name, role, status, is_part_time, is_senior, telegram_username, position, pay_type, hourly_rate, shift_rate, night_rate
               FROM users WHERE active_organization_id = ? AND role = 'employee' AND status = 'active' ORDER BY name ASC";
        $userRows = $db->queryAll($usersSql, [$orgId]);

        $locRows = $db->queryAll(
            'SELECT ul.user_id, l.code
             FROM user_locations ul
             JOIN locations l ON l.id = ul.location_id
             WHERE l.organization_id = ?',
            [$orgId]
        );
        $locMap = [];
        foreach ($locRows as $lr) {
            $locMap[$lr['user_id']][] = $lr['code'];
        }

        $staffList = [];
        foreach ($userRows as $row) {
            $item = [
                'id' => $row['id'],
                'name' => $row['name'],
                'role' => $row['role'],
                'status' => $row['status'],
                'isPartTime' => (bool)$row['is_part_time'],
                'isSenior' => (bool)$row['is_senior'],
                'hasAccess' => $row['status'] === 'active',
                'telegramUsername' => $row['telegram_username'] ?: null,
                'position' => $row['position'] ?: 'Работник склада',
                'payType' => $row['pay_type'] ?: 'hourly',
                'hourlyRate' => $row['hourly_rate'] !== null ? (float)$row['hourly_rate'] : 350,
                'shiftRate' => $row['shift_rate'] !== null ? (float)$row['shift_rate'] : 3500,
                'nightRate' => $row['night_rate'] !== null ? (float)$row['night_rate'] : 0,
                'locations' => $locMap[$row['id']] ?? [],
            ];
            if ($isManager) {
                $item['login'] = $row['login'];
                if (!empty($row['password_plain'])) {
                    $item['password'] = $row['password_plain'];
                }
                $item['registeredAt'] = toIsoString($row['created_at'] ?? null);
            }
            $staffList[] = $item;
        }
        jsonResponse(['success' => true, 'staff' => $staffList]);
    }

    // POST /staff
    if ($method === 'POST' && $subRoute === '') {
        $u = requireManager($currentUser);
        $u = requireActiveWriteAccess($u);
        $orgId = $u['organizationId'];

        $quota = checkStaffQuota($db, $orgId);
        if (!$quota['allowed']) {
            jsonError('QUOTA_EXCEEDED', $quota['message'] ?: 'Достигнут лимит сотрудников по вашему тарифу', 403);
        }

        $body = getRequestJson();
        $name = trim((string)($body['name'] ?? ''));
        $cleanLogin = trim((string)($body['login'] ?? ''));
        $cleanPassword = trim((string)($body['password'] ?? ''));
        $locations = is_array($body['locations'] ?? null) ? array_values(array_filter(array_map('trim', $body['locations']))) : [];

        if ($name === '' || $cleanLogin === '' || $cleanPassword === '') {
            jsonError('VALIDATION_ERROR', 'Имя, логин и пароль обязательны', 400);
        }
        if (empty($locations)) {
            jsonError('VALIDATION_ERROR', 'Необходимо указать хотя бы одну локацию', 400);
        }

        $dup = $db->queryOne('SELECT id FROM users WHERE LOWER(login) = LOWER(?)', [$cleanLogin]);
        if ($dup) {
            jsonError('LOGIN_EXISTS', 'Сотрудник с таким логином уже зарегистрирован', 409);
        }

        $isPartTime = !empty($body['isPartTime']);
        $isSenior = !empty($body['isSenior']);
        $telegramUsername = isset($body['telegramUsername']) && trim((string)$body['telegramUsername']) !== '' ? trim((string)$body['telegramUsername']) : null;
        $pos = !empty($body['position']) ? trim((string)$body['position']) : 'Работник склада';
        $pType = ($body['payType'] ?? '') === 'shift' ? 'shift' : 'hourly';
        $hRate = isset($body['hourlyRate']) ? (float)$body['hourlyRate'] : 350;
        $sRate = isset($body['shiftRate']) ? (float)$body['shiftRate'] : 3500;
        $nRate = isset($body['nightRate']) ? (float)$body['nightRate'] : 0;

        $userId = 'emp-' . uuidv4();
        $passwordHash = password_hash($cleanPassword, PASSWORD_BCRYPT, ['cost' => 10]);

        $db->transaction(function (AppDb $tx) use ($userId, $cleanLogin, $passwordHash, $cleanPassword, $name, $orgId, $isPartTime, $isSenior, $telegramUsername, $pos, $pType, $hRate, $sRate, $nRate, $locations) {
            $tx->execute(
                "INSERT INTO users (
                    id, login, password_hash, password_plain, name, role, status, active_organization_id,
                    is_part_time, is_senior, telegram_username, position, pay_type, hourly_rate, shift_rate, night_rate
                 ) VALUES (?, ?, ?, ?, ?, 'employee', 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [$userId, $cleanLogin, $passwordHash, $cleanPassword, $name, $orgId, $isPartTime ? 1 : 0, $isSenior ? 1 : 0, $telegramUsername, $pos, $pType, $hRate, $sRate, $nRate]
            );
            $tx->execute(
                "INSERT INTO organization_members (id, organization_id, user_id, org_role, status) VALUES (?, ?, ?, 'employee', 'active')",
                ['mem-' . uuidv4(), $orgId, $userId]
            );

            foreach ($locations as $locCode) {
                $locRow = $tx->queryOne('SELECT id FROM locations WHERE organization_id = ? AND code = ?', [$orgId, $locCode]);
                $locId = $locRow['id'] ?? null;
                if (!$locId) {
                    $locId = 'loc-' . uuidv4();
                    $tx->execute(
                        'INSERT INTO locations (id, organization_id, code, name) VALUES (?, ?, ?, ?)',
                        [$locId, $orgId, $locCode, "Склад {$locCode}"]
                    );
                }
                $tx->upsert('user_locations', ['user_id' => $userId, 'location_id' => $locId], ['user_id', 'location_id'], []);
            }

            $tx->execute(
                "INSERT INTO notifications (id, organization_id, user_id, title, text, type, source) VALUES (?, ?, ?, ?, ?, 'system', 'manager')",
                [
                    'notif-' . uuidv4(),
                    $orgId,
                    $userId,
                    'Добро пожаловать в команду!',
                    "Ваша учетная запись активирована. Логин: \"{$cleanLogin}\". Должность: {$pos}. Доступные склады: " . implode(', ', $locations) . '.',
                ]
            );
        });

        logAudit($db, $u, $u['id'], 'CREATE_STAFF', 'user', $userId, [
            'name' => $name,
            'login' => $cleanLogin,
            'locations' => $locations,
            'isSenior' => $isSenior,
            'position' => $pos,
            'payType' => $pType,
        ]);

        jsonResponse([
            'success' => true,
            'staff' => [
                'id' => $userId,
                'name' => $name,
                'login' => $cleanLogin,
                'password' => $cleanPassword,
                'role' => 'employee',
                'status' => 'active',
                'isPartTime' => $isPartTime,
                'isSenior' => $isSenior,
                'hasAccess' => true,
                'position' => $pos,
                'payType' => $pType,
                'hourlyRate' => $hRate,
                'shiftRate' => $sRate,
                'nightRate' => $nRate,
                'locations' => $locations,
            ],
        ], 201);
    }

    // PATCH or DELETE /staff/:id
    if ($subRoute !== '' && strpos($subRoute, '/') === false) {
        $id = rawurldecode($subRoute);

        if ($method === 'PATCH') {
            $u = requireManager($currentUser);
            $u = requireActiveWriteAccess($u);
            $orgId = $u['organizationId'];
            $body = getRequestJson();

            if (array_key_exists('locations', $body) && (!is_array($body['locations']) || empty($body['locations']))) {
                jsonError('VALIDATION_ERROR', 'Необходимо указать хотя бы одну локацию', 400);
            }

            $userRow = $db->queryOne('SELECT id, status FROM users WHERE id = ? AND active_organization_id = ?', [$id, $orgId]);
            if (!$userRow) {
                jsonError('NOT_FOUND', 'Сотрудник не найден', 404);
            }

            $newStatus = $body['status'] ?? null;
            if ($newStatus !== null && !in_array($newStatus, ['active', 'blocked', 'archived', 'deactivated'], true)) {
                jsonError('VALIDATION_ERROR', 'Некорректный статус сотрудника', 400);
            }

            if ($userRow['status'] === 'archived' && $newStatus === 'active') {
                $quota = checkStaffQuota($db, $orgId);
                if (!$quota['allowed']) {
                    jsonError('QUOTA_EXCEEDED', $quota['message'] ?: 'Достигнут лимит сотрудников по вашему тарифу', 403);
                }
            }

            if (!empty($body['login'])) {
                $conflict = $db->queryOne('SELECT id FROM users WHERE LOWER(login) = LOWER(?) AND id != ?', [trim((string)$body['login']), $id]);
                if ($conflict) {
                    jsonError('LOGIN_EXISTS', 'Такой логин уже занят', 409);
                }
            }

            $db->transaction(function (AppDb $tx) use ($body, $id, $orgId, $newStatus) {
                $updates = ['updated_at = CURRENT_TIMESTAMP'];
                $params = [];

                if (!empty($body['name'])) {
                    $updates[] = 'name = ?';
                    $params[] = trim((string)$body['name']);
                }
                if (!empty($body['login'])) {
                    $updates[] = 'login = ?';
                    $params[] = trim((string)$body['login']);
                }
                if (!empty($body['password']) && trim((string)$body['password']) !== '') {
                    $cleanPw = trim((string)$body['password']);
                    $updates[] = 'password_hash = ?';
                    $params[] = password_hash($cleanPw, PASSWORD_BCRYPT, ['cost' => 10]);
                    $updates[] = 'password_plain = ?';
                    $params[] = $cleanPw;
                }
                if (array_key_exists('isPartTime', $body)) {
                    $updates[] = 'is_part_time = ?';
                    $params[] = !empty($body['isPartTime']) ? 1 : 0;
                }
                if (array_key_exists('isSenior', $body)) {
                    $updates[] = 'is_senior = ?';
                    $params[] = !empty($body['isSenior']) ? 1 : 0;
                }
                if ($newStatus !== null) {
                    $canonicalStatus = $newStatus === 'deactivated' ? 'blocked' : $newStatus;
                    $updates[] = 'status = ?';
                    $params[] = $canonicalStatus;
                    $tx->execute(
                        'UPDATE organization_members SET status = ? WHERE organization_id = ? AND user_id = ?',
                        [$canonicalStatus, $orgId, $id]
                    );
                    if ($canonicalStatus === 'blocked' || $canonicalStatus === 'archived') {
                        $tx->execute('DELETE FROM sessions WHERE user_id = ?', [$id]);
                    }
                }
                if (array_key_exists('telegramUsername', $body)) {
                    $tg = trim((string)$body['telegramUsername']);
                    $updates[] = 'telegram_username = ?';
                    $params[] = $tg !== '' ? $tg : null;
                }
                if (array_key_exists('position', $body)) {
                    $pos = trim((string)$body['position']);
                    $updates[] = 'position = ?';
                    $params[] = $pos !== '' ? $pos : 'Работник склада';
                }
                if (array_key_exists('payType', $body) && in_array($body['payType'], ['hourly', 'shift'], true)) {
                    $updates[] = 'pay_type = ?';
                    $params[] = $body['payType'];
                }
                if (array_key_exists('hourlyRate', $body)) {
                    $updates[] = 'hourly_rate = ?';
                    $params[] = (float)$body['hourlyRate'];
                }
                if (array_key_exists('shiftRate', $body)) {
                    $updates[] = 'shift_rate = ?';
                    $params[] = (float)$body['shiftRate'];
                }
                if (array_key_exists('nightRate', $body)) {
                    $updates[] = 'night_rate = ?';
                    $params[] = (float)$body['nightRate'];
                }

                $params[] = $id;
                $params[] = $orgId;
                $tx->execute('UPDATE users SET ' . implode(', ', $updates) . ' WHERE id = ? AND active_organization_id = ?', $params);

                if (!empty($body['locations']) && is_array($body['locations'])) {
                    $tx->execute('DELETE FROM user_locations WHERE user_id = ?', [$id]);
                    foreach ($body['locations'] as $locCode) {
                        $cleanCode = trim((string)$locCode);
                        if ($cleanCode === '') continue;
                        $locRow = $tx->queryOne('SELECT id FROM locations WHERE organization_id = ? AND code = ?', [$orgId, $cleanCode]);
                        $locId = $locRow['id'] ?? null;
                        if (!$locId) {
                            $locId = 'loc-' . uuidv4();
                            $tx->execute(
                                'INSERT INTO locations (id, organization_id, code, name) VALUES (?, ?, ?, ?)',
                                [$locId, $orgId, $cleanCode, "Склад {$cleanCode}"]
                            );
                        }
                        $tx->upsert('user_locations', ['user_id' => $id, 'location_id' => $locId], ['user_id', 'location_id'], []);
                    }
                }
            });

            logAudit($db, $u, $u['id'], 'UPDATE_STAFF', 'user', $id, [
                'name' => $body['name'] ?? null,
                'login' => $body['login'] ?? null,
                'status' => $newStatus,
                'locations' => $body['locations'] ?? null,
            ]);
            jsonResponse(['success' => true]);
        }

        if ($method === 'DELETE') {
            $u = requireManager($currentUser);
            $u = requireActiveWriteAccess($u);
            $orgId = $u['organizationId'];
            $isHard = ($_GET['hard'] ?? '') === 'true';

            $userRow = $db->queryOne('SELECT id, name FROM users WHERE id = ? AND active_organization_id = ?', [$id, $orgId]);
            if (!$userRow) {
                jsonError('NOT_FOUND', 'Сотрудник не найден', 404);
            }

            if ($isHard) {
                $body = getRequestJson();
                if (($body['confirmation'] ?? '') !== 'DELETE USER') {
                    jsonError('CONFIRMATION_REQUIRED', 'Для безвозвратного удаления требуется явное подтверждение: confirmation="DELETE USER"', 400);
                }
                $db->transaction(function (AppDb $tx) use ($id, $orgId) {
                    $tx->execute('DELETE FROM sessions WHERE user_id = ?', [$id]);
                    $tx->execute('DELETE FROM user_locations WHERE user_id = ?', [$id]);
                    $tx->execute('DELETE FROM messages WHERE from_user_id = ? AND organization_id = ?', [$id, $orgId]);
                    $tx->execute('DELETE FROM notifications WHERE user_id = ? AND organization_id = ?', [$id, $orgId]);
                    $tx->execute('DELETE FROM sales WHERE user_id = ? AND organization_id = ?', [$id, $orgId]);
                    $tx->execute('DELETE FROM checkins WHERE user_id = ? AND organization_id = ?', [$id, $orgId]);
                    $tx->execute('DELETE FROM organization_members WHERE user_id = ? AND organization_id = ?', [$id, $orgId]);
                    $tx->execute('DELETE FROM users WHERE id = ? AND active_organization_id = ?', [$id, $orgId]);
                });
                logAudit($db, $u, $u['id'], 'HARD_DELETE_STAFF', 'user', $id, ['name' => $userRow['name']]);
            } else {
                $db->execute("UPDATE users SET status = 'archived', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND active_organization_id = ?", [$id, $orgId]);
                $db->execute("UPDATE organization_members SET status = 'archived' WHERE user_id = ? AND organization_id = ?", [$id, $orgId]);
                $db->execute('DELETE FROM sessions WHERE user_id = ?', [$id]);
                logAudit($db, $u, $u['id'], 'ARCHIVE_STAFF', 'user', $id, ['name' => $userRow['name']]);
            }

            jsonResponse(['success' => true]);
        }
    }

    jsonError('NOT_FOUND', 'Маршрут персонала не найден', 404);
}

function handleLocationsRoutes(AppDb $db, array $config, string $method, string $subRoute, ?array $currentUser): void {
    // GET /locations
    if ($method === 'GET' && $subRoute === '') {
        $u = requireOrganization($currentUser);
        jsonResponse(['success' => true, 'locations' => getStoredLocations($db, $u['organizationId'])]);
    }

    // POST /locations
    if ($method === 'POST' && $subRoute === '') {
        $u = requireManager($currentUser);
        $u = requireActiveWriteAccess($u);
        $orgId = $u['organizationId'];

        $quota = checkLocationQuota($db, $orgId);
        if (!$quota['allowed']) {
            jsonError('QUOTA_EXCEEDED', $quota['message'] ?: 'Достигнут лимит тарифа по количеству складов/ПВЗ', 403);
        }

        $currentLocs = getStoredLocations($db, $orgId);
        $body = getRequestJson();
        $cleanName = is_string($body['name'] ?? null) ? mb_substr(trim($body['name']), 0, 30) : '';
        if ($cleanName === '') {
            jsonResponse(['success' => false, 'error' => 'Укажите название склада.'], 400);
        }

        foreach ($currentLocs as $loc) {
            if (mb_strtolower(trim($loc['name'])) === mb_strtolower($cleanName)) {
                jsonResponse([
                    'success' => false,
                    'error' => "Склад с названием «{$cleanName}» уже существует. Названия складов должны быть уникальными.",
                ], 400);
            }
        }

        $rawCode = isset($body['code']) && is_string($body['code']) ? trim($body['code']) : '';
        $finalCode = mb_strtoupper($rawCode !== '' ? mb_substr($rawCode, 0, 18) : 'СК-' . (count($currentLocs) + 1));

        $newLoc = [
            'id' => 'sklad-' . time() . '-' . bin2hex(random_bytes(2)),
            'organizationId' => $orgId,
            'code' => $finalCode,
            'name' => $cleanName,
            'address' => trim((string)($body['address'] ?? '')),
            'active' => array_key_exists('active', $body) ? (bool)$body['active'] : true,
            'isArchived' => false,
            'assignedStaffIds' => is_array($body['assignedStaffIds'] ?? null) ? $body['assignedStaffIds'] : [],
            'contactPhone' => trim((string)($body['contactPhone'] ?? '')),
            'notes' => trim((string)($body['notes'] ?? '')),
            'latitude' => isset($body['latitude']) && $body['latitude'] !== '' && $body['latitude'] !== null ? (float)$body['latitude'] : null,
            'longitude' => isset($body['longitude']) && $body['longitude'] !== '' && $body['longitude'] !== null ? (float)$body['longitude'] : null,
            'radiusMeters' => !empty($body['radiusMeters']) ? (int)$body['radiusMeters'] : 300,
            'qrSecret' => !empty($body['qrSecret']) ? trim((string)$body['qrSecret']) : "SKLAD-{$finalCode}-" . substr($orgId, -4),
            'zones' => is_array($body['zones'] ?? null) ? $body['zones'] : ['Приёмка', 'Сборка', 'Упаковка', 'Отгрузка', 'Зона хранения'],
            'createdAt' => gmdate('Y-m-d H:i:s'),
        ];

        saveSingleLocation($db, $newLoc, $orgId);
        $updatedList = getStoredLocations($db, $orgId);
        logAudit($db, $u, $u['id'], 'CREATE_LOCATION', 'location', $newLoc['id'], ['code' => $newLoc['code'], 'name' => $newLoc['name']]);

        jsonResponse(['success' => true, 'location' => $newLoc, 'locations' => $updatedList]);
    }

    // PUT or DELETE /locations/:id
    if ($subRoute !== '' && strpos($subRoute, '/') === false) {
        $locIdParam = $subRoute;
        $locIdDecoded = rawurldecode($locIdParam);

        $u = requireManager($currentUser);
        $u = requireActiveWriteAccess($u);
        $orgId = $u['organizationId'];
        $currentLocs = getStoredLocations($db, $orgId);

        $targetIdx = null;
        foreach ($currentLocs as $idx => $l) {
            if (
                $l['id'] === $locIdParam ||
                $l['id'] === $locIdDecoded ||
                $l['code'] === $locIdParam ||
                $l['code'] === $locIdDecoded ||
                strtoupper($l['code']) === strtoupper($locIdParam) ||
                strtoupper($l['code']) === strtoupper($locIdDecoded) ||
                strtolower($l['id']) === strtolower($locIdParam)
            ) {
                $targetIdx = $idx;
                break;
            }
        }

        if ($targetIdx === null) {
            jsonResponse(['success' => false, 'error' => 'Склад не найден.'], 404);
        }

        if ($method === 'PUT') {
            $target = $currentLocs[$targetIdx];
            $body = getRequestJson();

            if (!empty($target['isArchived']) && ($body['isArchived'] ?? null) === false) {
                $quota = checkLocationQuota($db, $orgId);
                if (!$quota['allowed']) {
                    jsonError('QUOTA_EXCEEDED', $quota['message'] ?: 'Достигнут лимит тарифа по количеству активных складов/ПВЗ', 403);
                }
            }

            if (array_key_exists('name', $body)) {
                $cleanName = mb_substr(trim((string)$body['name']), 0, 30);
                if ($cleanName === '') {
                    jsonResponse(['success' => false, 'error' => 'Укажите название склада.'], 400);
                }
                foreach ($currentLocs as $idx => $l) {
                    if ($idx !== $targetIdx && mb_strtolower(trim($l['name'])) === mb_strtolower($cleanName)) {
                        jsonResponse(['success' => false, 'error' => "Склад с названием «{$cleanName}» уже существует. Названия складов должны быть уникальными."], 400);
                    }
                }
                $target['name'] = $cleanName;
            }
            if (array_key_exists('code', $body)) {
                $cleanCode = mb_strtoupper(mb_substr(trim((string)$body['code']), 0, 18));
                if ($cleanCode !== '') {
                    $target['code'] = $cleanCode;
                }
            }
            if (array_key_exists('address', $body)) $target['address'] = trim((string)$body['address']);
            if (array_key_exists('active', $body)) $target['active'] = (bool)$body['active'];

            if (array_key_exists('isArchived', $body)) {
                $target['isArchived'] = (bool)$body['isArchived'];
                if ($target['isArchived']) {
                    $target['archivedAt'] = !empty($body['archivedAt']) ? $body['archivedAt'] : nowIso();
                    $target['active'] = false;
                } else {
                    $target['archivedAt'] = null;
                    $target['active'] = true;
                }
            }

            if (is_array($body['assignedStaffIds'] ?? null)) $target['assignedStaffIds'] = $body['assignedStaffIds'];
            if (array_key_exists('contactPhone', $body)) $target['contactPhone'] = trim((string)$body['contactPhone']);
            if (array_key_exists('notes', $body)) $target['notes'] = trim((string)$body['notes']);
            if (array_key_exists('latitude', $body)) {
                $target['latitude'] = $body['latitude'] !== null && $body['latitude'] !== '' ? (float)$body['latitude'] : null;
            }
            if (array_key_exists('longitude', $body)) {
                $target['longitude'] = $body['longitude'] !== null && $body['longitude'] !== '' ? (float)$body['longitude'] : null;
            }
            if (array_key_exists('radiusMeters', $body)) $target['radiusMeters'] = (int)$body['radiusMeters'];
            if (array_key_exists('qrSecret', $body)) $target['qrSecret'] = trim((string)$body['qrSecret']);
            if (is_array($body['zones'] ?? null)) $target['zones'] = $body['zones'];

            saveSingleLocation($db, $target, $orgId);
            $updatedList = getStoredLocations($db, $orgId);

            logAudit($db, $u, $u['id'], $target['isArchived'] ? 'ARCHIVE_LOCATION' : 'UPDATE_LOCATION', 'location', $target['id'], [
                'code' => $target['code'],
                'name' => $target['name'],
                'isArchived' => $target['isArchived'],
            ]);

            jsonResponse(['success' => true, 'locations' => $updatedList]);
        }

        if ($method === 'DELETE') {
            $targetLoc = $currentLocs[$targetIdx];
            $db->execute('DELETE FROM locations WHERE organization_id = ? AND id = ?', [$orgId, $targetLoc['id']]);
            $updatedList = getStoredLocations($db, $orgId);

            logAudit($db, $u, $u['id'], 'DELETE_LOCATION', 'location', $targetLoc['id'], [
                'code' => $targetLoc['code'],
                'name' => $targetLoc['name'],
            ]);

            jsonResponse(['success' => true, 'locations' => $updatedList]);
        }
    }

    jsonError('NOT_FOUND', 'Маршрут складов не найден', 404);
}

function handleApplicationsRoutes(AppDb $db, array $config, string $method, string $subRoute, ?array $currentUser): void {
    // GET /applications
    if ($method === 'GET' && $subRoute === '') {
        $u = requireManager($currentUser);
        $u = requireOrganization($u);
        $orgId = $u['organizationId'];
        $rows = $db->queryAll(
            'SELECT id, name, telegram_username, status, note, assigned_login, created_at, updated_at
             FROM applications WHERE organization_id = ? ORDER BY created_at DESC',
            [$orgId]
        );
        $apps = array_map(fn($r) => [
            'id' => $r['id'],
            'name' => $r['name'],
            'telegramUsername' => $r['telegram_username'] ?: null,
            'status' => $r['status'],
            'note' => $r['note'] ?: null,
            'generatedLogin' => $r['assigned_login'] ?: null,
            'submittedAt' => toIsoString($r['created_at'] ?? null) ?? nowIso(),
            'createdAt' => toIsoString($r['created_at'] ?? null) ?? nowIso(),
            'decidedAt' => toIsoString($r['updated_at'] ?? null),
        ], $rows);

        jsonResponse(['success' => true, 'applications' => $apps]);
    }

    // POST /applications
    if ($method === 'POST' && $subRoute === '') {
        checkRateLimit($db, 'application', 5, 600, 'Слишком много заявок с вашего адреса. Попробуйте через {mins} мин.');
        $body = getRequestJson();
        $name = trim((string)($body['name'] ?? ''));
        $telegramUsername = isset($body['telegramUsername']) && trim((string)$body['telegramUsername']) !== '' ? trim((string)$body['telegramUsername']) : null;
        $requestedOrgId = isset($body['organizationId']) ? trim((string)$body['organizationId']) : '';

        if ($name === '') {
            jsonError('VALIDATION_ERROR', 'Имя обязательно', 400);
        }

        $resolvedOrgId = $currentUser['organizationId'] ?? null;
        if (!$resolvedOrgId && $requestedOrgId !== '') {
            $orgRow = $db->queryOne('SELECT id FROM organizations WHERE id = ? OR slug = ?', [$requestedOrgId, $requestedOrgId]);
            if ($orgRow) {
                $resolvedOrgId = $orgRow['id'];
            }
        }
        if (!$resolvedOrgId) {
            $defRow = $db->queryOne('SELECT id FROM organizations WHERE id = ?', [DEFAULT_LEGACY_ORG_ID]);
            $resolvedOrgId = $defRow['id'] ?? null;
        }

        $appId = 'app-' . uuidv4();
        $db->execute(
            "INSERT INTO applications (id, organization_id, name, telegram_username, status) VALUES (?, ?, ?, ?, 'pending')",
            [$appId, $resolvedOrgId, $name, $telegramUsername]
        );

        jsonResponse([
            'success' => true,
            'applicationId' => $appId,
            'message' => 'Заявка успешно отправлена на рассмотрение руководителю',
        ], 201);
    }

    // PATCH /applications/:id
    if ($method === 'PATCH' && $subRoute !== '' && strpos($subRoute, '/') === false) {
        $u = requireManager($currentUser);
        $u = requireActiveWriteAccess($u);
        $orgId = $u['organizationId'];
        $id = rawurldecode($subRoute);
        $body = getRequestJson();

        $action = $body['action'] ?? '';
        if (!in_array($action, ['accept', 'reject'], true)) {
            jsonError('VALIDATION_ERROR', 'Неверное действие по заявке', 400);
        }
        $note = isset($body['note']) && trim((string)$body['note']) !== '' ? trim((string)$body['note']) : null;
        $generatedLogin = trim((string)($body['generatedLogin'] ?? ''));
        $generatedPassword = trim((string)($body['generatedPassword'] ?? ''));
        $assignedLocations = is_array($body['assignedLocations'] ?? null) ? $body['assignedLocations'] : [];
        $isSenior = !empty($body['isSenior']);

        $app = $db->queryOne(
            'SELECT id, name, telegram_username, status FROM applications WHERE id = ? AND organization_id = ?',
            [$id, $orgId]
        );
        if (!$app) {
            jsonError('NOT_FOUND', 'Заявка не найдена', 404);
        }

        if ($action === 'accept') {
            $quota = checkStaffQuota($db, $orgId);
            if (!$quota['allowed']) {
                jsonError('QUOTA_EXCEEDED', $quota['message'] ?: 'Достигнут лимит сотрудников по вашему тарифу', 403);
            }
            if ($generatedLogin === '' || $generatedPassword === '') {
                jsonError('CREDENTIALS_REQUIRED', 'Для одобрения требуется логин и пароль', 400);
            }
            $existingUser = $db->queryOne('SELECT id FROM users WHERE LOWER(login) = LOWER(?)', [$generatedLogin]);
            if ($existingUser) {
                jsonError('LOGIN_EXISTS', "Логин «{$generatedLogin}» уже занят", 409);
            }

            $newUserId = 'emp-' . uuidv4();
            $hash = password_hash($generatedPassword, PASSWORD_BCRYPT, ['cost' => 10]);

            $db->transaction(function (AppDb $tx) use ($newUserId, $generatedLogin, $hash, $generatedPassword, $app, $orgId, $isSenior, $assignedLocations, $note, $id) {
                $tx->execute(
                    "INSERT INTO users (id, login, password_hash, password_plain, name, role, status, active_organization_id, is_part_time, is_senior, telegram_username)
                     VALUES (?, ?, ?, ?, ?, 'employee', 'active', ?, 0, ?, ?)",
                    [$newUserId, $generatedLogin, $hash, $generatedPassword, $app['name'], $orgId, $isSenior ? 1 : 0, $app['telegram_username']]
                );
                $tx->execute(
                    "INSERT INTO organization_members (id, organization_id, user_id, org_role, status) VALUES (?, ?, ?, 'employee', 'active')",
                    ['mem-' . uuidv4(), $orgId, $newUserId]
                );
                foreach ($assignedLocations as $locCode) {
                    $locRow = $tx->queryOne('SELECT id FROM locations WHERE organization_id = ? AND code = ?', [$orgId, $locCode]);
                    if ($locRow) {
                        $tx->upsert('user_locations', ['user_id' => $newUserId, 'location_id' => $locRow['id']], ['user_id', 'location_id'], []);
                    }
                }
                $tx->execute(
                    "UPDATE applications SET status = 'approved', note = ?, assigned_login = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?",
                    [$note, $generatedLogin, $id, $orgId]
                );
                $tx->execute(
                    "INSERT INTO notifications (id, organization_id, user_id, title, text, type, source) VALUES (?, ?, ?, ?, ?, 'system', 'manager')",
                    [
                        'notif-' . uuidv4(),
                        $orgId,
                        $newUserId,
                        'Заявка одобрена!',
                        "Ваша заявка на регистрацию одобрена. Ваш логин: \"{$generatedLogin}\".",
                    ]
                );
            });

            logAudit($db, $u, $u['id'], 'APPROVE_APPLICATION', 'application', $id, ['newUserId' => $newUserId, 'login' => $generatedLogin]);
        } else {
            $db->execute(
                "UPDATE applications SET status = 'rejected', note = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?",
                [$note, $id, $orgId]
            );
            logAudit($db, $u, $u['id'], 'REJECT_APPLICATION', 'application', $id, ['note' => $note]);
        }

        jsonResponse(['success' => true]);
    }

    jsonError('NOT_FOUND', 'Маршрут заявок не найден', 404);
}
