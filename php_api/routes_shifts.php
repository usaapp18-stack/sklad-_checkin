<?php
if (!defined('PVZ_APP')) {
    http_response_code(403);
    exit('Direct access prohibited.');
}

function getDefaultRatesConfig(): array {
    return [
        'day12' => 3500,
        'night12' => 4000,
        'standard8' => 2800,
        'part6' => 2100,
        'part4' => 1400,
        'daily24' => 7000,
        'standard' => 3500,
        '400+' => 3800,
        '500+' => 4200,
        '8h' => 2800,
        '4h' => 1400,
        'partTimeShiftRate' => 2100,
        'nightBonus' => 500,
        'seniorBonus' => 500,
        'partTimeBonus' => 0,
        'shiftTypes' => [
            ['code' => 'day12', 'name' => 'Дневная смена (12ч)', 'baseRate' => 3500, 'isArchived' => false],
            ['code' => 'night12', 'name' => 'Ночная смена (12ч)', 'baseRate' => 4000, 'isArchived' => false],
            ['code' => 'standard8', 'name' => 'Стандартная (8ч)', 'baseRate' => 2800, 'isArchived' => false],
            ['code' => 'part6', 'name' => 'Подработка (6ч)', 'baseRate' => 2100, 'isArchived' => false],
            ['code' => 'part4', 'name' => 'Подработка (4ч)', 'baseRate' => 1400, 'isArchived' => false],
            ['code' => 'daily24', 'name' => 'Суточная (24ч)', 'baseRate' => 7000, 'isArchived' => false],
        ],
        'partTimeShiftTypes' => [
            ['code' => 'part4', 'name' => 'Подработка (4ч)', 'baseRate' => 1400, 'isArchived' => false],
            ['code' => 'part6', 'name' => 'Подработка (6ч)', 'baseRate' => 2100, 'isArchived' => false],
            ['code' => 'pt_standard', 'name' => 'Смена подработчика (полная)', 'baseRate' => 2800, 'isArchived' => false],
        ],
        'bonuses' => [
            ['code' => 'seniorBonus', 'name' => 'Доплата Старшему (Ст.С.)', 'value' => 500, 'isArchived' => false, 'target' => 'senior'],
            ['code' => 'partTimeBonus', 'name' => 'Доплата Подработчику', 'value' => 0, 'isArchived' => false, 'target' => 'part_time'],
        ],
    ];
}

function getDefaultHoursForShift(string $shiftType): int {
    if ($shiftType === 'standard8' || $shiftType === '8h') return 8;
    if ($shiftType === 'part4' || $shiftType === '4h') return 4;
    if ($shiftType === 'part6') return 6;
    if ($shiftType === 'daily24') return 22;
    return 11;
}

function normalizeCheckinShiftType(string $shiftType): string {
    return match ($shiftType) {
        'rate400' => '400+',
        'rate500' => '500+',
        'shift8h' => '8h',
        'shift4h' => '4h',
        default => $shiftType,
    };
}

function getActiveShiftRate(AppDb $db, string $userId, string $shiftType, string $organizationId): float {
    try {
        $uRow = $db->queryOne(
            'SELECT is_part_time, is_senior, pay_type, hourly_rate, shift_rate FROM users WHERE id = ?',
            [$userId]
        );
        if (!$uRow) return 3500;
        $isPartTime = !empty($uRow['is_part_time']);

        if (($uRow['pay_type'] ?? '') === 'shift' && (float)($uRow['shift_rate'] ?? 0) > 0) {
            return (float)$uRow['shift_rate'];
        }
        if (($uRow['pay_type'] ?? 'hourly') === 'hourly' && (float)($uRow['hourly_rate'] ?? 0) > 0) {
            return (float)round(getDefaultHoursForShift($shiftType) * (float)$uRow['hourly_rate']);
        }

        $storedRates = getOrgSetting($db, $organizationId, 'rates', []);
        $rates = array_merge(getDefaultRatesConfig(), is_array($storedRates) ? $storedRates : []);
        $shiftTypes = is_array($rates['shiftTypes'] ?? null) ? $rates['shiftTypes'] : [];

        $foundRate = null;
        foreach ($shiftTypes as $st) {
            if (($st['code'] ?? '') === $shiftType) {
                $foundRate = (float)($st['baseRate'] ?? 3500);
                break;
            }
        }
        $baseRate = $foundRate ?? (float)($rates[$shiftType] ?? 3500);

        if ($isPartTime && ($shiftType === 'standard' || $shiftType === 'day12')) {
            $baseRate = (float)($rates['partTimeShiftRate'] ?? $baseRate);
        }
        return $baseRate;
    } catch (Throwable $e) {
        return 3500;
    }
}

function handleCheckinsRoutes(AppDb $db, array $config, string $method, string $subRoute, ?array $currentUser): void {
    // POST /checkins/alerts or /checkins/checkin-alerts or /checkin-alerts
    if ($method === 'POST' && in_array($subRoute, ['alerts', 'checkin-alerts'], true)) {
        $u = requireOrganization($currentUser);
        $orgId = $u['organizationId'];
        $today = getTodayMoscowDate();

        $activeLocs = $db->queryAll(
            'SELECT code, name FROM locations WHERE organization_id = ? AND active = 1 AND is_archived = 0',
            [$orgId]
        );
        $checkedRows = $db->queryAll(
            'SELECT DISTINCT location_code FROM checkins WHERE organization_id = ? AND date = ?',
            [$orgId, $today]
        );
        $checkedSet = [];
        foreach ($checkedRows as $c) {
            $checkedSet[$c['location_code']] = true;
        }

        $missing = [];
        foreach ($activeLocs as $loc) {
            if (!isset($checkedSet[$loc['code']])) {
                $missing[] = $loc['code'];
            }
        }

        jsonResponse([
            'success' => true,
            'missing' => $missing,
            'checkedCount' => count($checkedSet),
            'totalCount' => count($activeLocs),
        ]);
    }

    // GET /checkins
    if ($method === 'GET' && $subRoute === '') {
        $u = requireOrganization($currentUser);
        $orgId = $u['organizationId'];
        $isManager = $u['role'] === 'manager';
        $dateParam = isset($_GET['date']) ? trim((string)$_GET['date']) : '';

        $sql = 'SELECT c.id, c.user_id, u.name as employee_name, c.location_code as location,
                       c.shift_type, c.date, c.checked_in_at, c.check_out_at, c.worked_hours,
                       c.break_minutes, c.qr_verified, c.geo_verified, c.zone, c.notes,
                       c.edit_count, c.base_rate,
                       (SELECT COUNT(*) FROM checkin_cancellations cc WHERE cc.user_id = c.user_id AND cc.date = c.date) as cancel_count,
                       s.id as sales_id, s.photo_cash, s.photo_card, s.print_cash, s.print_card,
                       s.lamination_cash, s.lamination_card, s.total as sales_total, s.bonus as sales_bonus,
                       s.submitted_at as sales_submitted_at
                FROM checkins c
                JOIN users u ON u.id = c.user_id
                LEFT JOIN sales s ON s.checkin_id = c.id';

        $where = ['c.organization_id = ?'];
        $params = [$orgId];

        if (!$isManager) {
            $where[] = 'c.user_id = ?';
            $params[] = $u['id'];
        }
        if ($dateParam !== '') {
            if (!isValidCalendarDate($dateParam)) {
                jsonError('INVALID_DATE', 'Некорректный формат даты', 400);
            }
            $where[] = 'c.date = ?';
            $params[] = $dateParam;
        }

        $sql .= ' WHERE ' . implode(' AND ', $where) . ' ORDER BY c.date DESC, c.checked_in_at DESC';
        $rows = $db->queryAll($sql, $params);

        $records = array_map(function ($r) {
            $sales = null;
            if (!empty($r['sales_id'])) {
                $sales = [
                    'cash' => (float)($r['photo_cash'] ?? 0) + (float)($r['print_cash'] ?? 0) + (float)($r['lamination_cash'] ?? 0),
                    'card' => (float)($r['photo_card'] ?? 0) + (float)($r['print_card'] ?? 0) + (float)($r['lamination_card'] ?? 0),
                    'photo' => ['cash' => (float)($r['photo_cash'] ?? 0), 'card' => (float)($r['photo_card'] ?? 0)],
                    'print' => ['cash' => (float)($r['print_cash'] ?? 0), 'card' => (float)($r['print_card'] ?? 0)],
                    'lamination' => ['cash' => (float)($r['lamination_cash'] ?? 0), 'card' => (float)($r['lamination_card'] ?? 0)],
                    'total' => (float)($r['sales_total'] ?? 0),
                    'bonus' => (float)($r['sales_bonus'] ?? 0),
                ];
            }
            return [
                'id' => $r['id'],
                'employeeId' => $r['user_id'],
                'employeeName' => $r['employee_name'],
                'location' => $r['location'],
                'shiftType' => $r['shift_type'],
                'date' => $r['date'],
                'checkedInAt' => $r['checked_in_at'],
                'checkOutAt' => $r['check_out_at'] ?: null,
                'workedHours' => $r['worked_hours'] !== null ? (float)$r['worked_hours'] : null,
                'breakMinutes' => $r['break_minutes'] !== null ? (int)$r['break_minutes'] : null,
                'qrVerified' => (bool)$r['qr_verified'],
                'geoVerified' => (bool)$r['geo_verified'],
                'zone' => $r['zone'] ?: null,
                'notes' => $r['notes'] ?: null,
                'editCount' => (int)($r['edit_count'] ?? 0),
                'cancelCount' => (int)($r['cancel_count'] ?? 0),
                'baseRate' => $r['base_rate'] !== null ? (float)$r['base_rate'] : null,
                'sales' => $sales,
                'salesSubmittedAt' => toIsoString($r['sales_submitted_at'] ?? null),
            ];
        }, $rows);

        $cancelledDates = [];
        if (!$isManager) {
            $cancelRows = $db->queryAll(
                'SELECT date FROM checkin_cancellations WHERE user_id = ? AND organization_id = ?',
                [$u['id'], $orgId]
            );
            $cancelledDates = array_map(fn($c) => $c['date'], $cancelRows);
        }

        jsonResponse(['success' => true, 'records' => $records, 'cancelledDates' => $cancelledDates]);
    }

    // POST /checkins/checkout
    if ($method === 'POST' && $subRoute === 'checkout') {
        $u = requireActiveWriteAccess($currentUser);
        $orgId = $u['organizationId'];
        $isManager = $u['role'] === 'manager';
        $body = getRequestJson();

        $checkinId = $body['checkinId'] ?? null;
        if (!empty($checkinId)) {
            $targetCheckin = $db->queryOne('SELECT * FROM checkins WHERE id = ? AND organization_id = ?', [$checkinId, $orgId]);
        } else {
            $targetCheckin = $db->queryOne(
                'SELECT * FROM checkins WHERE user_id = ? AND date = ? AND organization_id = ?',
                [$u['id'], getTodayMoscowDate(), $orgId]
            );
        }

        if (!$targetCheckin) {
            jsonError('NOT_FOUND', 'Активная смена не найдена', 404);
        }
        if (!$isManager && $targetCheckin['user_id'] !== $u['id']) {
            jsonError('FORBIDDEN', 'Нет доступа к этой смене', 403);
        }

        $finalCheckOut = !empty($body['checkOutAt']) ? (string)$body['checkOutAt'] : nowIso();
        $finalBreak = isset($body['breakMinutes']) && is_numeric($body['breakMinutes']) ? (int)$body['breakMinutes'] : 60;
        $finalHours = isset($body['workedHours']) && is_numeric($body['workedHours']) ? (float)$body['workedHours'] : null;
        $nextNotes = array_key_exists('notes', $body) ? ($body['notes'] ?: null) : ($targetCheckin['notes'] ?? null);

        $db->execute(
            'UPDATE checkins SET check_out_at = ?, break_minutes = ?, worked_hours = ?, notes = ? WHERE id = ? AND organization_id = ?',
            [$finalCheckOut, $finalBreak, $finalHours, $nextNotes, $targetCheckin['id'], $orgId]
        );

        if ($orgId === DEFAULT_LEGACY_ORG_ID) {
            $empRow = $db->queryOne('SELECT name FROM users WHERE id = ?', [$targetCheckin['user_id']]);
            $empName = $empRow['name'] ?? 'Работник';
            $msk = getMoscowTimeParts();
            $hoursText = $finalHours !== null ? "{$finalHours} ч" : 'зафиксировано';
            sendTelegramForOrg(
                $db,
                $config,
                $orgId,
                "🔴 *Смена завершена (Check-out)*\n👤 Работник: *{$empName}*\n📍 Склад: *{$targetCheckin['location_code']}*\n⏱ Отработано: *{$hoursText}*\n⏰ Время: *{$msk['displayTime']} (МСК)*"
            );
        }

        jsonResponse(['success' => true, 'checkinId' => $targetCheckin['id'], 'checkOutAt' => $finalCheckOut, 'workedHours' => $finalHours]);
    }

    // POST /checkins
    if ($method === 'POST' && $subRoute === '') {
        $u = requireActiveWriteAccess($currentUser);
        $orgId = $u['organizationId'];
        $isManager = $u['role'] === 'manager';
        $body = getRequestJson();

        $location = trim((string)($body['location'] ?? ''));
        $shiftType = trim((string)($body['shiftType'] ?? ''));
        $dateParam = isset($body['date']) ? trim((string)$body['date']) : '';
        $qrVerified = !empty($body['qrVerified']);
        $geoVerified = !empty($body['geoVerified']);
        $zone = array_key_exists('zone', $body) ? ($body['zone'] !== null && $body['zone'] !== '' ? (string)$body['zone'] : null) : null;
        $notes = array_key_exists('notes', $body) ? ($body['notes'] !== null && $body['notes'] !== '' ? (string)$body['notes'] : null) : null;

        if ($location === '' || $shiftType === '') {
            jsonError('VALIDATION_ERROR', 'Локация и тип смены обязательны', 400);
        }
        if ($dateParam !== '' && !isValidCalendarDate($dateParam)) {
            jsonError('VALIDATION_ERROR', 'Некорректная дата (требуется ГГГГ-ММ-ДД)', 400);
        }

        $today = getTodayMoscowDate();
        $targetUserId = ($isManager && !empty($body['employeeId'])) ? (string)$body['employeeId'] : $u['id'];
        $targetDate = $today;
        if ($dateParam !== '') {
            if (!$isManager && $dateParam !== $today) {
                jsonError('FORBIDDEN_DATE', 'Сотрудники могут отмечать явку только за текущий день', 403);
            }
            $targetDate = $dateParam;
        }

        $targetUser = $db->queryOne(
            'SELECT id, name, status, role FROM users WHERE id = ? AND active_organization_id = ?',
            [$targetUserId, $orgId]
        );
        if (!$targetUser) {
            jsonError('USER_NOT_FOUND', 'Сотрудник не найден в текущей организации', 404);
        }
        if ($targetUser['status'] === 'blocked' || $targetUser['status'] === 'archived') {
            jsonError('USER_INACTIVE', 'Сотрудник заблокирован или архивирован', 403);
        }

        if (!$isManager) {
            $locCheck = $db->queryOne(
                'SELECT l.id FROM locations l
                 JOIN user_locations ul ON ul.location_id = l.id
                 WHERE ul.user_id = ? AND l.organization_id = ? AND l.code = ?',
                [$targetUserId, $orgId, $location]
            );
            if (!$locCheck) {
                jsonError('FORBIDDEN_LOCATION', "Сотрудник не имеет доступа к локации «{$location}». Обратитесь к руководителю.", 403);
            }
        } else {
            $locRow = $db->queryOne('SELECT id FROM locations WHERE organization_id = ? AND code = ?', [$orgId, $location]);
            $locId = $locRow['id'] ?? null;
            if (!$locId) {
                $locId = 'loc-' . uuidv4();
                $db->execute(
                    'INSERT INTO locations (id, organization_id, code, name) VALUES (?, ?, ?, ?)',
                    [$locId, $orgId, $location, "Склад {$location}"]
                );
            }
            $db->upsert('user_locations', ['user_id' => $targetUserId, 'location_id' => $locId], ['user_id', 'location_id'], []);
        }

        $cleanShiftType = normalizeCheckinShiftType($shiftType);
        $checkinId = 'rec-' . uuidv4();
        $now = nowIso();
        $effectiveCheckinTime = ($isManager && $targetDate !== $today) ? "{$targetDate}T06:00:00.000Z" : $now;
        $finalEditCount = 0;
        $persistedQr = $qrVerified;
        $persistedGeo = $geoVerified;

        $db->transaction(function (AppDb $tx) use (
            $targetUserId, $cleanShiftType, $orgId, $targetDate, $location, $zone, $notes,
            $qrVerified, $geoVerified, $isManager, $effectiveCheckinTime,
            &$checkinId, &$finalEditCount, &$persistedQr, &$persistedGeo
        ) {
            $baseRate = getActiveShiftRate($tx, $targetUserId, $cleanShiftType, $orgId);
            $existingRows = $tx->queryAll(
                'SELECT id, edit_count, check_out_at, zone, qr_verified, geo_verified, notes
                 FROM checkins WHERE user_id = ? AND date = ? ORDER BY checked_in_at DESC',
                [$targetUserId, $targetDate]
            );

            if (!empty($existingRows)) {
                $primary = $existingRows[0];
                for ($i = 1; $i < count($existingRows); $i++) {
                    $tx->execute('DELETE FROM sales WHERE checkin_id = ?', [$existingRows[$i]['id']]);
                    $tx->execute('DELETE FROM checkins WHERE id = ?', [$existingRows[$i]['id']]);
                }

                $checkinId = $primary['id'];
                $currentEditCount = (int)($primary['edit_count'] ?? 0);

                if (!$isManager && !empty($primary['check_out_at'])) {
                    throw new RuntimeException('SHIFT_ALREADY_CLOSED');
                }
                if (!$isManager && $currentEditCount >= 1) {
                    throw new RuntimeException('EDIT_LIMIT_EXCEEDED');
                }

                $finalEditCount = $isManager ? $currentEditCount : $currentEditCount + 1;
                $nextZone = $zone !== null ? $zone : ($primary['zone'] ?? null);
                $nextQr = !empty($primary['qr_verified']) || $qrVerified;
                $nextGeo = !empty($primary['geo_verified']) || $geoVerified;
                $persistedQr = $nextQr;
                $persistedGeo = $nextGeo;
                $nextNotes = $notes !== null ? $notes : ($primary['notes'] ?? null);

                $tx->execute(
                    'UPDATE checkins
                     SET organization_id = ?, location_code = ?, shift_type = ?, edit_count = ?, base_rate = ?,
                         zone = ?, qr_verified = ?, geo_verified = ?, notes = ?, checked_in_at = ?
                     WHERE id = ?',
                    [$orgId, $location, $cleanShiftType, $finalEditCount, $baseRate, $nextZone, $nextQr ? 1 : 0, $nextGeo ? 1 : 0, $nextNotes, $effectiveCheckinTime, $checkinId]
                );
            } else {
                $finalEditCount = 0;
                $tx->execute(
                    'INSERT INTO checkins (id, organization_id, user_id, location_code, shift_type, date, checked_in_at, edit_count, base_rate, zone, qr_verified, geo_verified, notes)
                     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)',
                    [$checkinId, $orgId, $targetUserId, $location, $cleanShiftType, $targetDate, $effectiveCheckinTime, $baseRate, $zone, $qrVerified ? 1 : 0, $geoVerified ? 1 : 0, $notes]
                );
            }
        });

        $shiftLabels = [
            'day12' => 'Дневная смена (12ч)',
            'night12' => 'Ночная смена (12ч)',
            'standard8' => 'Стандартная (8ч)',
            'part4' => 'Подработка (4ч)',
            'part6' => 'Подработка (6ч)',
            'daily24' => 'Суточная (24ч)',
            'standard' => 'Дневная смена (12ч)',
            '400+' => 'Дневная (усиленная)',
            '500+' => 'Смена (пиковая)',
            '8h' => '8 часов',
            '4h' => '4 часа',
        ];
        if ($orgId === DEFAULT_LEGACY_ORG_ID) {
            $shiftLabel = $shiftLabels[$cleanShiftType] ?? $cleanShiftType;
            $msk = getMoscowTimeParts();
            $zoneStr = $zone ? " ({$zone})" : '';
            sendTelegramForOrg(
                $db,
                $config,
                $orgId,
                "🟢 *Check-in зафиксирован!*\n👤 Сотрудник: *{$targetUser['name']}*\n📍 Склад: *{$location}*{$zoneStr}\n⏱ Смена: *{$shiftLabel}*\n📅 Дата: *{$targetDate}*\n⏰ Время: *{$msk['displayTime']} (МСК)*"
            );
        }

        logAudit($db, $u, $u['id'], 'CHECKIN', 'checkin', $checkinId, [
            'userId' => $targetUserId,
            'location' => $location,
            'shiftType' => $cleanShiftType,
            'zone' => $zone,
            'date' => $targetDate,
        ]);

        jsonResponse([
            'success' => true,
            'checkin' => [
                'id' => $checkinId,
                'employeeId' => $targetUserId,
                'employeeName' => $targetUser['name'],
                'location' => $location,
                'shiftType' => $cleanShiftType,
                'date' => $targetDate,
                'checkedInAt' => $effectiveCheckinTime,
                'editCount' => $finalEditCount,
                'zone' => $zone,
                'qrVerified' => $persistedQr,
                'geoVerified' => $persistedGeo,
                'sales' => null,
            ],
        ]);
    }

    // PATCH or DELETE /checkins/:id
    if ($subRoute !== '' && strpos($subRoute, '/') === false) {
        $id = rawurldecode($subRoute);

        if ($method === 'PATCH') {
            $u = requireActiveWriteAccess($currentUser);
            $orgId = $u['organizationId'];
            if ($u['role'] !== 'manager') {
                jsonError('FORBIDDEN', 'Только руководитель может изменять смены', 403);
            }
            $body = getRequestJson();
            $shiftType = $body['shiftType'] ?? null;
            $location = $body['location'] ?? null;
            $date = $body['date'] ?? null;
            $hasZone = array_key_exists('zone', $body);
            $zone = $body['zone'] ?? null;

            if ($date && !isValidCalendarDate((string)$date)) {
                jsonError('INVALID_DATE', 'Некорректный формат даты', 400);
            }

            $found = true;
            $db->transaction(function (AppDb $tx) use ($id, $orgId, $shiftType, $location, $date, $hasZone, $zone, &$found) {
                $cur = $tx->queryOne('SELECT id, user_id, date, shift_type FROM checkins WHERE id = ? AND organization_id = ?', [$id, $orgId]);
                if (!$cur) {
                    $found = false;
                    return;
                }
                $updates = [];
                $params = [];
                if (!empty($shiftType)) {
                    $cleanShift = normalizeCheckinShiftType((string)$shiftType);
                    $updates[] = 'shift_type = ?';
                    $params[] = $cleanShift;
                    $updates[] = 'base_rate = ?';
                    $params[] = getActiveShiftRate($tx, $cur['user_id'], $cleanShift, $orgId);
                }
                if (!empty($location)) {
                    $updates[] = 'location_code = ?';
                    $params[] = (string)$location;
                }
                if ($hasZone) {
                    $updates[] = 'zone = ?';
                    $params[] = $zone !== null && $zone !== '' ? (string)$zone : null;
                }
                if (!empty($date)) {
                    if ($date !== $cur['date']) {
                        $conflicts = $tx->queryAll('SELECT id FROM checkins WHERE user_id = ? AND date = ? AND id <> ?', [$cur['user_id'], $date, $id]);
                        foreach ($conflicts as $c) {
                            $tx->execute('DELETE FROM sales WHERE checkin_id = ?', [$c['id']]);
                            $tx->execute('DELETE FROM checkins WHERE id = ?', [$c['id']]);
                        }
                    }
                    $updates[] = 'date = ?';
                    $params[] = (string)$date;
                }

                if (!empty($updates)) {
                    $params[] = $id;
                    $params[] = $orgId;
                    $tx->execute('UPDATE checkins SET ' . implode(', ', $updates) . ' WHERE id = ? AND organization_id = ?', $params);
                }
            });

            if (!$found) {
                jsonError('NOT_FOUND', 'Запись Check-in не найдена', 404);
            }
            jsonResponse(['success' => true]);
        }

        if ($method === 'DELETE') {
            $u = requireActiveWriteAccess($currentUser);
            $orgId = $u['organizationId'];
            $isManager = $u['role'] === 'manager';
            $today = getTodayMoscowDate();

            $checkin = $db->queryOne(
                'SELECT id, user_id, date, edit_count, check_out_at FROM checkins WHERE id = ? AND organization_id = ?',
                [$id, $orgId]
            );
            if (!$checkin) {
                jsonError('NOT_FOUND', 'Запись Check-in не найдена', 404);
            }

            if (!$isManager) {
                if ($checkin['user_id'] !== $u['id']) {
                    jsonError('FORBIDDEN', 'Нельзя отменить чужую смену', 403);
                }
                if ($checkin['date'] !== $today) {
                    jsonError('FORBIDDEN_PAST_DATE', 'Сотрудник может отменить check-in только за сегодняшний день', 403);
                }
                if (!empty($checkin['check_out_at'])) {
                    jsonError('SHIFT_ALREADY_CLOSED', 'Нельзя отменить уже завершённую смену (Check-out). Обратитесь к руководителю.', 403);
                }
                if ((int)($checkin['edit_count'] ?? 0) >= 1) {
                    jsonError('EDIT_LIMIT_EXCEEDED', 'Работник может изменять или отменять смену только один раз. Для дальнейших изменений обратитесь к руководителю.', 403);
                }
                $cancelRow = $db->queryOne(
                    'SELECT COUNT(*) as cnt FROM checkin_cancellations WHERE user_id = ? AND date = ?',
                    [$u['id'], $checkin['date']]
                );
                if ((int)($cancelRow['cnt'] ?? 0) >= 1) {
                    jsonError('CANCEL_LIMIT_EXCEEDED', 'Работник может отменить Check-in только один раз. В случае необходимости обратитесь к руководителю, чтобы руководитель сам внёс изменение.', 403);
                }
            }

            $db->transaction(function (AppDb $tx) use ($isManager, $orgId, $u, $checkin, $id) {
                if (!$isManager) {
                    $tx->execute(
                        'INSERT INTO checkin_cancellations (id, organization_id, user_id, date) VALUES (?, ?, ?, ?)',
                        ['canc-' . uuidv4(), $orgId, $u['id'], $checkin['date']]
                    );
                } else {
                    $tx->execute(
                        'DELETE FROM checkin_cancellations WHERE user_id = ? AND date = ?',
                        [$checkin['user_id'], $checkin['date']]
                    );
                }
                $tx->execute('DELETE FROM sales WHERE checkin_id = ?', [$id]);
                $tx->execute('DELETE FROM checkins WHERE id = ? AND organization_id = ?', [$id, $orgId]);
            });

            logAudit($db, $u, $u['id'], 'CANCEL_CHECKIN', 'checkin', $id);
            jsonResponse(['success' => true]);
        }
    }

    jsonError('NOT_FOUND', 'Маршрут смен не найден', 404);
}

function handleSalesRoutes(AppDb $db, array $config, string $method, string $subRoute, ?array $currentUser): void {
    if ($method === 'POST' && $subRoute === '') {
        $u = requireActiveWriteAccess($currentUser);
        $orgId = $u['organizationId'];
        $body = getRequestJson();
        $sales = $body['sales'] ?? null;
        if (!is_array($sales)) {
            jsonError('VALIDATION_ERROR', 'Неверные данные выручки', 400);
        }

        $isManager = $u['role'] === 'manager';
        if (!$isManager && !empty($u['isPartTime'])) {
            jsonError('PART_TIME_SALES_PROHIBITED', 'Подработчикам запрещено вносить данные о продажах', 403);
        }

        $today = getTodayMoscowDate();
        $targetUserId = ($isManager && !empty($body['employeeId'])) ? (string)$body['employeeId'] : $u['id'];
        $dateParam = isset($body['date']) ? trim((string)$body['date']) : '';
        $targetDate = $today;
        if ($dateParam !== '') {
            if (!isValidCalendarDate($dateParam)) {
                jsonError('VALIDATION_ERROR', 'Некорректная дата (требуется ГГГГ-ММ-ДД)', 400);
            }
            if (!$isManager && $dateParam !== $today) {
                jsonError('FORBIDDEN_DATE', 'Сотрудники могут вносить выручку только за текущую смену', 403);
            }
            $targetDate = $dateParam;
        }

        $checkinRow = $db->queryOne(
            'SELECT id FROM checkins WHERE user_id = ? AND date = ? AND organization_id = ?',
            [$targetUserId, $targetDate, $orgId]
        );
        if (!$checkinRow) {
            jsonError('CHECKIN_REQUIRED', 'Ввод выручки невозможен без предварительной отметки Check-in за выбранную дату!', 400);
        }
        $checkinId = $checkinRow['id'];

        $photoCash = max(0.0, (float)($sales['photo']['cash'] ?? 0));
        $photoCard = max(0.0, (float)($sales['photo']['card'] ?? 0));
        $printCash = max(0.0, (float)($sales['print']['cash'] ?? 0));
        $printCard = max(0.0, (float)($sales['print']['card'] ?? 0));
        $lamCash = max(0.0, (float)($sales['lamination']['cash'] ?? 0));
        $lamCard = max(0.0, (float)($sales['lamination']['card'] ?? 0));

        $totalCash = array_key_exists('cash', $sales) ? max(0.0, (float)$sales['cash']) : ($photoCash + $printCash + $lamCash);
        $totalCard = array_key_exists('card', $sales) ? max(0.0, (float)$sales['card']) : ($photoCard + $printCard + $lamCard);
        $totalSales = (isset($sales['total']) && (float)$sales['total'] > 0 && !array_key_exists('cash', $sales) && !array_key_exists('card', $sales))
            ? (float)$sales['total']
            : ($totalCash + $totalCard);
        $bonus = (float)round($totalSales * 0.05);

        $saleId = 'sale-' . uuidv4();
        $db->transaction(function (AppDb $tx) use ($checkinId, $orgId, $targetUserId, $targetDate, $totalCash, $totalCard, $totalSales, $bonus, &$saleId) {
            $existing = $tx->queryOne('SELECT id FROM sales WHERE checkin_id = ?', [$checkinId]);
            if ($existing) {
                $saleId = $existing['id'];
                $tx->execute(
                    'UPDATE sales
                     SET organization_id = ?, photo_cash = ?, photo_card = ?, print_cash = 0, print_card = 0,
                         lamination_cash = 0, lamination_card = 0, total = ?, bonus = ?, submitted_at = CURRENT_TIMESTAMP
                     WHERE id = ?',
                    [$orgId, $totalCash, $totalCard, $totalSales, $bonus, $saleId]
                );
            } else {
                $tx->execute(
                    'INSERT INTO sales (id, organization_id, checkin_id, user_id, date, photo_cash, photo_card, print_cash, print_card, lamination_cash, lamination_card, total, bonus)
                     VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, ?, ?)',
                    [$saleId, $orgId, $checkinId, $targetUserId, $targetDate, $totalCash, $totalCard, $totalSales, $bonus]
                );
            }
        });

        logAudit($db, $u, $u['id'], 'SUBMIT_SALES', 'sales', $saleId, [
            'checkinId' => $checkinId,
            'userId' => $targetUserId,
            'total' => $totalSales,
            'bonus' => $bonus,
            'date' => $targetDate,
        ]);

        jsonResponse([
            'success' => true,
            'sales' => [
                'id' => $saleId,
                'checkinId' => $checkinId,
                'total' => $totalSales,
                'bonus' => $bonus,
                'submittedAt' => nowIso(),
            ],
        ]);
    }

    jsonError('NOT_FOUND', 'Маршрут выручки не найден', 404);
}

function handleSchedulesRoutes(AppDb $db, array $config, string $method, string $subRoute, ?array $currentUser): void {
    // GET /schedules
    if ($method === 'GET' && $subRoute === '') {
        $u = requireOrganization($currentUser);
        $schedules = getOrgSetting($db, $u['organizationId'], 'planned_schedules', []);
        jsonResponse(['success' => true, 'schedules' => is_array($schedules) ? $schedules : []]);
    }

    // GET /schedules/templates
    if ($method === 'GET' && $subRoute === 'templates') {
        $u = requireOrganization($currentUser);
        $templates = getOrgSetting($db, $u['organizationId'], 'schedule_templates', []);
        jsonResponse(['success' => true, 'templates' => is_array($templates) ? $templates : []]);
    }

    // POST /schedules/templates
    if ($method === 'POST' && $subRoute === 'templates') {
        $u = requireManager($currentUser);
        $u = requireActiveWriteAccess($u);
        $orgId = $u['organizationId'];
        $body = getRequestJson();

        if (empty($body['name']) || empty($body['location']) || empty($body['scenarioType'])) {
            jsonResponse(['success' => false, 'error' => 'Заполните обязательные поля шаблона'], 400);
        }

        $templates = getOrgSetting($db, $orgId, 'schedule_templates', []);
        if (!is_array($templates)) $templates = [];
        $templateId = !empty($body['id']) ? (string)$body['id'] : ('tpl-' . uuidv4());

        $newTemplate = [
            'id' => $templateId,
            'name' => trim((string)$body['name']),
            'location' => trim((string)$body['location']),
            'scenarioType' => $body['scenarioType'],
            'mainStaffIds' => is_array($body['mainStaffIds'] ?? null) ? $body['mainStaffIds'] : [],
            'partTimeStaffIds' => is_array($body['partTimeStaffIds'] ?? null) ? $body['partTimeStaffIds'] : [],
            'defaultShiftType' => $body['defaultShiftType'] ?? 'day12',
            'notes' => isset($body['notes']) ? trim((string)$body['notes']) : '',
            'createdAt' => nowIso(),
        ];

        $templates = array_values(array_filter($templates, fn($t) => ($t['id'] ?? '') !== $templateId));
        $templates[] = $newTemplate;
        setOrgSetting($db, $orgId, 'schedule_templates', $templates);

        jsonResponse(['success' => true, 'templates' => $templates, 'template' => $newTemplate]);
    }

    // DELETE /schedules/templates/:id
    if ($method === 'DELETE' && str_starts_with($subRoute, 'templates/')) {
        $u = requireManager($currentUser);
        $u = requireActiveWriteAccess($u);
        $orgId = $u['organizationId'];
        $tplId = rawurldecode(substr($subRoute, strlen('templates/')));

        $templates = getOrgSetting($db, $orgId, 'schedule_templates', []);
        if (!is_array($templates)) $templates = [];
        $templates = array_values(array_filter($templates, fn($t) => ($t['id'] ?? '') !== $tplId));
        setOrgSetting($db, $orgId, 'schedule_templates', $templates);

        jsonResponse(['success' => true, 'templates' => $templates]);
    }

    // POST /schedules
    if ($method === 'POST' && $subRoute === '') {
        $u = requireManager($currentUser);
        $u = requireActiveWriteAccess($u);
        $orgId = $u['organizationId'];
        $body = getRequestJson();

        $schedules = getOrgSetting($db, $orgId, 'planned_schedules', []);
        if (!is_array($schedules)) $schedules = [];

        if (isset($body['batch']) && is_array($body['batch'])) {
            $replaceMonth = $body['replaceMonth'] ?? null;
            $replaceLocation = $body['replaceLocation'] ?? null;

            if (!empty($replaceMonth)) {
                $schedules = array_values(array_filter($schedules, function ($s) use ($replaceMonth, $replaceLocation) {
                    $matchMonth = str_starts_with((string)($s['date'] ?? ''), (string)$replaceMonth);
                    $matchLoc = $replaceLocation ? (($s['location'] ?? '') === $replaceLocation) : true;
                    return !($matchMonth && $matchLoc);
                }));
            } else {
                foreach ($body['batch'] as $item) {
                    $schedules = array_values(array_filter($schedules, function ($s) use ($item) {
                        return !(($s['date'] ?? '') === ($item['date'] ?? '') && ($s['location'] ?? '') === ($item['location'] ?? '') && ($s['employeeId'] ?? '') === ($item['employeeId'] ?? ''));
                    }));
                }
            }

            foreach ($body['batch'] as $item) {
                $conflict = false;
                foreach ($schedules as $s) {
                    if (($s['employeeId'] ?? '') === ($item['employeeId'] ?? '') && ($s['date'] ?? '') === ($item['date'] ?? '') && ($s['location'] ?? '') !== ($item['location'] ?? '')) {
                        $conflict = true;
                        break;
                    }
                }
                if (!$conflict) {
                    $item['id'] = $item['id'] ?? ('sch-' . uuidv4());
                    $item['createdAt'] = $item['createdAt'] ?? nowIso();
                    $schedules[] = $item;
                }
            }

            setOrgSetting($db, $orgId, 'planned_schedules', $schedules);
            jsonResponse(['success' => true, 'schedules' => $schedules]);
        }

        $date = $body['date'] ?? '';
        $location = $body['location'] ?? '';
        $employeeId = $body['employeeId'] ?? '';
        if (!$date || !$location || !$employeeId) {
            jsonResponse(['success' => false, 'error' => 'Укажите дату, склад и сотрудника'], 400);
        }

        foreach ($schedules as $s) {
            if (($s['employeeId'] ?? '') === $employeeId && ($s['date'] ?? '') === $date && ($s['location'] ?? '') !== $location) {
                $empName = $body['employeeName'] ?? 'Сотрудник';
                jsonResponse([
                    'success' => false,
                    'error' => "Сотрудник {$empName} уже назначен на смену на складе \"{$s['location']}\" на {$date}. Один сотрудник не может работать на двух складах одновременно.",
                ], 400);
            }
        }

        $schedules = array_values(array_filter($schedules, fn($s) => !(($s['date'] ?? '') === $date && ($s['location'] ?? '') === $location && ($s['employeeId'] ?? '') === $employeeId)));
        $newShift = [
            'id' => 'sch-' . uuidv4(),
            'date' => $date,
            'location' => $location,
            'employeeId' => $employeeId,
            'employeeName' => $body['employeeName'] ?? 'Сотрудник',
            'shiftType' => $body['shiftType'] ?? 'day12',
            'note' => isset($body['note']) ? trim((string)$body['note']) : '',
            'createdAt' => nowIso(),
        ];
        $schedules[] = $newShift;
        setOrgSetting($db, $orgId, 'planned_schedules', $schedules);

        jsonResponse(['success' => true, 'schedules' => $schedules, 'item' => $newShift]);
    }

    // POST /schedules/slot
    if ($method === 'POST' && $subRoute === 'slot') {
        $u = requireManager($currentUser);
        $u = requireActiveWriteAccess($u);
        $orgId = $u['organizationId'];
        $body = getRequestJson();
        $date = $body['date'] ?? '';
        $location = $body['location'] ?? '';
        if (!$date || !$location) {
            jsonResponse(['success' => false, 'error' => 'Укажите дату и склад'], 400);
        }

        $shiftList = is_array($body['shifts'] ?? null) ? $body['shifts'] : [];
        $schedules = getOrgSetting($db, $orgId, 'planned_schedules', []);
        if (!is_array($schedules)) $schedules = [];

        foreach ($shiftList as $sh) {
            if (empty($sh['employeeId'])) continue;
            foreach ($schedules as $s) {
                if (($s['employeeId'] ?? '') === $sh['employeeId'] && ($s['date'] ?? '') === $date && ($s['location'] ?? '') !== $location) {
                    $empName = $sh['employeeName'] ?? 'Сотрудник';
                    jsonResponse([
                        'success' => false,
                        'error' => "Сотрудник {$empName} уже назначен на смену на складе \"{$s['location']}\" на {$date}. Один сотрудник не может работать на двух складах одновременно.",
                    ], 400);
                }
            }
        }

        $schedules = array_values(array_filter($schedules, fn($s) => !(($s['date'] ?? '') === $date && ($s['location'] ?? '') === $location)));
        foreach ($shiftList as $sh) {
            if (empty($sh['employeeId'])) continue;
            $schedules[] = [
                'id' => $sh['id'] ?? ('sch-' . uuidv4()),
                'date' => $date,
                'location' => $location,
                'employeeId' => $sh['employeeId'],
                'employeeName' => $sh['employeeName'] ?? 'Сотрудник',
                'shiftType' => $sh['shiftType'] ?? 'day12',
                'note' => isset($sh['note']) ? trim((string)$sh['note']) : '',
                'createdAt' => nowIso(),
            ];
        }

        setOrgSetting($db, $orgId, 'planned_schedules', $schedules);
        jsonResponse(['success' => true, 'schedules' => $schedules]);
    }

    // POST /schedules/publish
    if ($method === 'POST' && $subRoute === 'publish') {
        $u = requireManager($currentUser);
        $u = requireActiveWriteAccess($u);
        $orgId = $u['organizationId'];
        $body = getRequestJson();
        $month = $body['month'] ?? '';
        $location = $body['location'] ?? null;
        $count = $body['count'] ?? null;
        $publishedAt = nowIso();

        try {
            $title = trim('📅 Опубликован график смен ' . ($month ? "на {$month}" : ''));
            $text = 'Руководитель утвердил и разослал график смен' . ($location ? " для склада {$location}" : '') . '. Проверьте свои запланированные смены в календаре!';
            $db->execute(
                "INSERT INTO notifications (id, organization_id, to_all, title, text, type, location, source)
                 VALUES (?, ?, 1, ?, ?, 'status_update', ?, 'manager')",
                ['notif-' . uuidv4(), $orgId, $title, $text, $location ?: null]
            );
        } catch (Throwable $e) {}

        jsonResponse(['success' => true, 'publishedAt' => $publishedAt, 'count' => $count]);
    }

    // DELETE /schedules/:id
    if ($method === 'DELETE' && $subRoute !== '' && strpos($subRoute, '/') === false) {
        $u = requireManager($currentUser);
        $u = requireActiveWriteAccess($u);
        $orgId = $u['organizationId'];
        $scheduleId = rawurldecode($subRoute);

        $schedules = getOrgSetting($db, $orgId, 'planned_schedules', []);
        if (!is_array($schedules)) $schedules = [];
        $schedules = array_values(array_filter($schedules, fn($s) => ($s['id'] ?? '') !== $scheduleId));
        setOrgSetting($db, $orgId, 'planned_schedules', $schedules);

        jsonResponse(['success' => true, 'schedules' => $schedules]);
    }

    jsonError('NOT_FOUND', 'Маршрут графика смен не найден', 404);
}

function getThreeMonthsCutoffDate(): string {
    $dt = new DateTimeImmutable('now', new DateTimeZone('Europe/Moscow'));
    $firstOfMonth = $dt->modify('first day of this month')->modify('-3 months');
    return $firstOfMonth->format('Y-m-d');
}

function getStoredSwaps(AppDb $db, string $organizationId): array {
    $cutoff = getThreeMonthsCutoffDate();
    try {
        $db->execute('DELETE FROM shift_swaps WHERE organization_id = ? AND date < ?', [$organizationId, $cutoff]);
    } catch (Throwable $e) {}

    $rows = $db->queryAll(
        'SELECT id, date, shift_type, location, requester_id, requester_name,
                candidate_id, candidate_name, reason, status, resolved_at, created_at
         FROM shift_swaps
         WHERE organization_id = ? AND date >= ?
         ORDER BY date DESC, created_at DESC',
        [$organizationId, $cutoff]
    );

    $swaps = array_map(fn($r) => [
        'id' => $r['id'],
        'date' => $r['date'],
        'shiftType' => $r['shift_type'] ?: 'day12',
        'location' => $r['location'],
        'requesterId' => $r['requester_id'],
        'requesterName' => $r['requester_name'],
        'candidateId' => $r['candidate_id'] ?: null,
        'candidateName' => $r['candidate_name'] ?: null,
        'reason' => $r['reason'] ?? '',
        'status' => $r['status'] ?: 'open',
        'resolvedAt' => !empty($r['resolved_at']) ? toIsoString($r['resolved_at']) : null,
        'createdAt' => toIsoString($r['created_at'] ?? null) ?? nowIso(),
    ], $rows);

    try {
        setOrgSetting($db, $organizationId, 'shift_swaps', $swaps);
    } catch (Throwable $e) {}

    return $swaps;
}

function saveSingleSwap(AppDb $db, array $swap, string $organizationId): void {
    $createdDb = gmdate('Y-m-d H:i:s');
    if (!empty($swap['createdAt'])) {
        try {
            $createdDb = (new DateTimeImmutable((string)$swap['createdAt']))->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s');
        } catch (Throwable $e) {}
    }

    $db->upsert('shift_swaps', [
        'id' => $swap['id'],
        'organization_id' => $organizationId,
        'date' => $swap['date'],
        'shift_type' => $swap['shiftType'] ?: 'day12',
        'location' => $swap['location'],
        'requester_id' => $swap['requesterId'],
        'requester_name' => $swap['requesterName'],
        'candidate_id' => $swap['candidateId'] ?? null,
        'candidate_name' => $swap['candidateName'] ?? null,
        'reason' => $swap['reason'] ?? null,
        'status' => $swap['status'] ?: 'open',
        'resolved_at' => $swap['resolvedAt'] ?? null,
        'created_at' => $createdDb,
        'updated_at' => gmdate('Y-m-d H:i:s'),
    ], ['id'], [
        'date', 'shift_type', 'location', 'requester_id', 'requester_name',
        'candidate_id', 'candidate_name', 'reason', 'status', 'resolved_at', 'updated_at',
    ]);
}

function handleSwapsRoutes(AppDb $db, array $config, string $method, string $subRoute, ?array $currentUser): void {
    // GET /swaps
    if ($method === 'GET' && $subRoute === '') {
        $u = requireOrganization($currentUser);
        jsonResponse(['success' => true, 'swaps' => getStoredSwaps($db, $u['organizationId'])]);
    }

    // POST /swaps
    if ($method === 'POST' && $subRoute === '') {
        $u = requireActiveWriteAccess($currentUser);
        $orgId = $u['organizationId'];
        $body = getRequestJson();
        $swaps = getStoredSwaps($db, $orgId);

        if (($body['action'] ?? '') === 'claim' && !empty($body['swapId'])) {
            $targetIdx = null;
            foreach ($swaps as $idx => $s) {
                if ($s['id'] === $body['swapId']) {
                    $targetIdx = $idx;
                    break;
                }
            }
            if ($targetIdx === null) {
                jsonResponse(['success' => false, 'error' => 'Заявка на смену не найдена'], 404);
            }
            if ($swaps[$targetIdx]['status'] !== 'open') {
                jsonResponse(['success' => false, 'error' => 'Эта смена уже забрана другим сотрудником'], 400);
            }

            $swaps[$targetIdx]['status'] = 'claimed';
            $swaps[$targetIdx]['candidateId'] = $u['id'];
            $swaps[$targetIdx]['candidateName'] = $u['name'];
            saveSingleSwap($db, $swaps[$targetIdx], $orgId);
            $updated = getStoredSwaps($db, $orgId);
            $formattedDate = formatDateDDMMYYYY($swaps[$targetIdx]['date']);

            try {
                $db->execute(
                    "INSERT INTO notifications (id, organization_id, user_id, title, text, type, source) VALUES (?, ?, ?, ?, ?, 'system', 'system')",
                    [
                        'notif-' . uuidv4(),
                        $orgId,
                        $swaps[$targetIdx]['requesterId'],
                        '🙋 Отклик на вашу смену!',
                        "{$u['name']} откликнулся на вашу смену {$formattedDate} ({$swaps[$targetIdx]['location']}). Зайдите на Биржу смен, чтобы подтвердить договоренность.",
                    ]
                );
            } catch (Throwable $e) {}

            if ($orgId === DEFAULT_LEGACY_ORG_ID) {
                sendTelegramForOrg($db, $config, $orgId, "🙋 Отклик на Бирже смен!\n\n{$u['name']} откликнулся на смену {$formattedDate} ({$swaps[$targetIdx]['location']}).");
            }

            jsonResponse(['success' => true, 'swap' => $swaps[$targetIdx], 'swaps' => $updated]);
        }

        $date = trim((string)($body['date'] ?? ''));
        $location = trim((string)($body['location'] ?? ''));
        if ($date === '' || $location === '') {
            jsonResponse(['success' => false, 'error' => 'Укажите дату и склад смены'], 400);
        }

        foreach ($swaps as $s) {
            if ($s['requesterId'] === $u['id'] && $s['date'] === $date && $s['status'] !== 'rejected' && $s['status'] !== 'cancelled') {
                $formattedDate = formatDateDDMMYYYY($date);
                jsonResponse([
                    'success' => false,
                    'error' => "У вас уже есть активная заявка на бирже на дату {$formattedDate}. Можно выставлять не более одной смены на одну дату.",
                ], 400);
            }
        }

        $newSwap = [
            'id' => 'swp-' . uuidv4(),
            'date' => $date,
            'shiftType' => $body['shiftType'] ?? 'day12',
            'location' => $location,
            'requesterId' => $u['id'],
            'requesterName' => $u['name'],
            'reason' => isset($body['reason']) ? trim((string)$body['reason']) : '',
            'status' => 'open',
            'createdAt' => nowIso(),
        ];
        saveSingleSwap($db, $newSwap, $orgId);
        $updated = getStoredSwaps($db, $orgId);
        $formattedDate = formatDateDDMMYYYY($date);

        try {
            $db->execute(
                "INSERT INTO notifications (id, organization_id, to_all, title, text, type, source) VALUES (?, ?, 1, ?, ?, 'system', 'system')",
                [
                    'notif-' . uuidv4(),
                    $orgId,
                    '🔄 Новая открытая смена на Бирже!',
                    "{$u['name']} ищет замену на {$formattedDate} (склад {$location}). Кто готов выйти — откройте Биржу смен!",
                ]
            );
        } catch (Throwable $e) {}

        if ($orgId === DEFAULT_LEGACY_ORG_ID) {
            sendTelegramForOrg($db, $config, $orgId, "🔄 *Новая смена на Бирже смен!*\n\n{$u['name']} ищет замену на {$formattedDate} ({$location}).");
        }

        jsonResponse(['success' => true, 'swap' => $newSwap, 'swaps' => $updated]);
    }

    // PATCH, PUT, DELETE /swaps/:id
    if ($subRoute !== '' && strpos($subRoute, '/') === false) {
        $swapId = rawurldecode($subRoute);
        $u = requireActiveWriteAccess($currentUser);
        $orgId = $u['organizationId'];
        $isManager = $u['role'] === 'manager';

        $swaps = getStoredSwaps($db, $orgId);
        $targetIdx = null;
        foreach ($swaps as $idx => $s) {
            if ($s['id'] === $swapId) {
                $targetIdx = $idx;
                break;
            }
        }
        if ($targetIdx === null) {
            jsonResponse(['success' => false, 'error' => 'Заявка не найдена'], 404);
        }

        $swap = $swaps[$targetIdx];

        if ($method === 'PATCH') {
            if (!$isManager && $swap['requesterId'] !== $u['id']) {
                jsonResponse(['success' => false, 'error' => 'Только автор заявки или руководитель могут подтверждать замену'], 403);
            }
            $body = getRequestJson();
            $action = $body['action'] ?? '';
            $formattedDate = formatDateDDMMYYYY($swap['date']);

            if ($action === 'approve' || $action === 'confirm') {
                $swap['status'] = 'approved';
                $swap['resolvedAt'] = nowIso();
                if (!empty($swap['candidateId'])) {
                    try {
                        $db->execute(
                            "INSERT INTO notifications (id, organization_id, user_id, title, text, type, source) VALUES (?, ?, ?, ?, ?, 'system', 'system')",
                            [
                                'notif-' . uuidv4(),
                                $orgId,
                                $swap['candidateId'],
                                '✅ Замена утверждена! (Договорились)',
                                "Подмена на смену {$formattedDate} ({$swap['location']}) подтверждена. Смена закреплена за вами.",
                            ]
                        );
                    } catch (Throwable $e) {}
                    if ($orgId === DEFAULT_LEGACY_ORG_ID) {
                        sendTelegramForOrg($db, $config, $orgId, "✅ *Замена утверждена!*\n\nСмена на {$formattedDate} ({$swap['location']}) закреплена за сотрудником.");
                    }
                }
            } elseif ($action === 'reject') {
                $prevCandidate = $swap['candidateId'] ?? null;
                $swap['candidateId'] = null;
                $swap['candidateName'] = null;
                $swap['status'] = 'open';
                if ($prevCandidate && $orgId === DEFAULT_LEGACY_ORG_ID) {
                    sendTelegramForOrg($db, $config, $orgId, "Замена на {$formattedDate} ({$swap['location']}) отклонена. Смена снова открыта на бирже.");
                }
            }

            saveSingleSwap($db, $swap, $orgId);
            jsonResponse(['success' => true, 'swap' => $swap, 'swaps' => getStoredSwaps($db, $orgId)]);
        }

        if ($method === 'PUT') {
            if (!$isManager && $swap['requesterId'] !== $u['id']) {
                jsonResponse(['success' => false, 'error' => 'Редактировать заявку может только руководитель или её создатель'], 403);
            }
            $body = getRequestJson();
            if (array_key_exists('date', $body)) $swap['date'] = $body['date'];
            if (array_key_exists('shiftType', $body)) $swap['shiftType'] = $body['shiftType'];
            if (array_key_exists('location', $body)) $swap['location'] = $body['location'];
            if (array_key_exists('reason', $body)) $swap['reason'] = trim((string)$body['reason']);

            if ($isManager) {
                if (array_key_exists('status', $body)) $swap['status'] = $body['status'];
                if (array_key_exists('candidateId', $body)) $swap['candidateId'] = $body['candidateId'] ?: null;
                if (array_key_exists('candidateName', $body)) $swap['candidateName'] = $body['candidateName'] ?: null;
                if (array_key_exists('requesterId', $body)) $swap['requesterId'] = $body['requesterId'];
                if (array_key_exists('requesterName', $body)) $swap['requesterName'] = $body['requesterName'];
            } elseif (in_array($body['status'] ?? '', ['cancelled', 'open'], true)) {
                $swap['status'] = $body['status'];
            }

            if (!empty($body['clearCandidate']) || (($body['status'] ?? '') === 'open' && ($isManager || $swap['requesterId'] === $u['id']))) {
                $swap['candidateId'] = null;
                $swap['candidateName'] = null;
            }

            saveSingleSwap($db, $swap, $orgId);
            jsonResponse(['success' => true, 'swap' => $swap, 'swaps' => getStoredSwaps($db, $orgId)]);
        }

        if ($method === 'DELETE') {
            if (!$isManager && $swap['requesterId'] !== $u['id']) {
                jsonResponse(['success' => false, 'error' => 'Вы можете отменять только свои заявки'], 403);
            }
            $db->execute('DELETE FROM shift_swaps WHERE id = ? AND organization_id = ?', [$swapId, $orgId]);
            jsonResponse(['success' => true, 'swaps' => getStoredSwaps($db, $orgId)]);
        }
    }

    jsonError('NOT_FOUND', 'Маршрут биржи смен не найден', 404);
}

function handleAvailabilityRoutes(AppDb $db, array $config, string $method, string $subRoute, ?array $currentUser): void {
    // GET /availability
    if ($method === 'GET' && $subRoute === '') {
        $u = requireOrganization($currentUser);
        $list = getOrgSetting($db, $u['organizationId'], 'staff_availability', []);
        jsonResponse(['success' => true, 'availability' => is_array($list) ? $list : []]);
    }

    // POST /availability
    if ($method === 'POST' && $subRoute === '') {
        $u = requireActiveWriteAccess($currentUser);
        $orgId = $u['organizationId'];
        $body = getRequestJson();
        $date = $body['date'] ?? '';
        $type = $body['type'] ?? '';
        if (!$date || !$type) {
            jsonResponse(['success' => false, 'error' => 'Укажите дату и категорию пожелания'], 400);
        }

        $list = getOrgSetting($db, $orgId, 'staff_availability', []);
        if (!is_array($list)) $list = [];
        $list = array_values(array_filter($list, fn($a) => !(($a['employeeId'] ?? '') === $u['id'] && ($a['date'] ?? '') === $date)));

        $newReq = [
            'id' => 'avail-' . uuidv4(),
            'employeeId' => $u['id'],
            'employeeName' => $u['name'],
            'date' => $date,
            'type' => $type,
            'comment' => isset($body['comment']) ? trim((string)$body['comment']) : '',
            'createdAt' => nowIso(),
            'status' => 'pending',
        ];
        $list[] = $newReq;
        setOrgSetting($db, $orgId, 'staff_availability', $list);

        jsonResponse(['success' => true, 'availability' => $list, 'item' => $newReq]);
    }

    if ($subRoute !== '' && strpos($subRoute, '/') === false) {
        $availId = rawurldecode($subRoute);

        // PATCH /availability/:id
        if ($method === 'PATCH') {
            $u = requireManager($currentUser);
            $u = requireActiveWriteAccess($u);
            $orgId = $u['organizationId'];
            $body = getRequestJson();
            $status = $body['status'] ?? 'approved';

            $list = getOrgSetting($db, $orgId, 'staff_availability', []);
            if (!is_array($list)) $list = [];
            foreach ($list as &$item) {
                if (($item['id'] ?? '') === $availId) {
                    $item['status'] = $status;
                }
            }
            unset($item);
            setOrgSetting($db, $orgId, 'staff_availability', $list);
            jsonResponse(['success' => true, 'availability' => $list]);
        }

        // DELETE /availability/:id
        if ($method === 'DELETE') {
            $u = requireActiveWriteAccess($currentUser);
            $orgId = $u['organizationId'];
            $list = getOrgSetting($db, $orgId, 'staff_availability', []);
            if (!is_array($list)) $list = [];
            foreach ($list as $item) {
                if (($item['id'] ?? '') === $availId && $u['role'] !== 'manager' && ($item['employeeId'] ?? '') !== $u['id']) {
                    jsonResponse(['success' => false, 'error' => 'Вы можете удалять только свои пожелания'], 403);
                }
            }
            $list = array_values(array_filter($list, fn($a) => ($a['id'] ?? '') !== $availId));
            setOrgSetting($db, $orgId, 'staff_availability', $list);
            jsonResponse(['success' => true, 'availability' => $list]);
        }
    }

    jsonError('NOT_FOUND', 'Маршрут пожеланий не найден', 404);
}

function handleRatesRoutes(AppDb $db, array $config, string $method, string $subRoute, ?array $currentUser): void {
    // GET /rates
    if ($method === 'GET' && $subRoute === '') {
        $u = requireOrganization($currentUser);
        $stored = getOrgSetting($db, $u['organizationId'], 'rates', []);
        $rates = array_merge(getDefaultRatesConfig(), is_array($stored) ? $stored : []);
        jsonResponse(['success' => true, 'rates' => $rates]);
    }

    // POST /rates
    if ($method === 'POST' && $subRoute === '') {
        $u = requireManager($currentUser);
        $u = requireActiveWriteAccess($u);
        $body = getRequestJson();
        setOrgSetting($db, $u['organizationId'], 'rates', $body);
        jsonResponse(['success' => true, 'rates' => $body]);
    }

    jsonError('NOT_FOUND', 'Маршрут ставок не найден', 404);
}
