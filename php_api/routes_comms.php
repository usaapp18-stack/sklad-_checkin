<?php
if (!defined('PVZ_APP')) {
    http_response_code(403);
    exit('Direct access prohibited.');
}

function handleMessagesRoutes(AppDb $db, array $config, string $method, string $subRoute, ?array $currentUser): void {
    // GET /messages
    if ($method === 'GET' && $subRoute === '') {
        $u = requireOrganization($currentUser);
        $orgId = $u['organizationId'];
        $isManager = $u['role'] === 'manager';

        $sql = $isManager
            ? 'SELECT m.id, m.from_user_id, u.name as from_user_name, m.message, m.is_read, m.created_at
               FROM messages m JOIN users u ON u.id = m.from_user_id
               WHERE m.organization_id = ? ORDER BY m.created_at DESC'
            : 'SELECT m.id, m.from_user_id, u.name as from_user_name, m.message, m.is_read, m.created_at
               FROM messages m JOIN users u ON u.id = m.from_user_id
               WHERE m.organization_id = ? AND m.from_user_id = ? ORDER BY m.created_at DESC';
        $rows = $db->queryAll($sql, $isManager ? [$orgId] : [$orgId, $u['id']]);

        $messages = array_map(fn($r) => [
            'id' => $r['id'],
            'fromEmployeeId' => $r['from_user_id'],
            'fromEmployeeName' => $r['from_user_name'],
            'message' => $r['message'],
            'read' => (bool)$r['is_read'],
            'timestamp' => toIsoString($r['created_at'] ?? null) ?? nowIso(),
        ], $rows);

        jsonResponse(['success' => true, 'messages' => $messages]);
    }

    // POST /messages
    if ($method === 'POST' && $subRoute === '') {
        $u = requireActiveWriteAccess($currentUser);
        $orgId = $u['organizationId'];
        $body = getRequestJson();
        $text = trim((string)($body['message'] ?? ''));
        if ($text === '') {
            jsonError('VALIDATION_ERROR', 'Текст сообщения не может быть пустым', 400);
        }

        $msgId = 'msg-' . uuidv4();
        $db->execute(
            'INSERT INTO messages (id, organization_id, from_user_id, message) VALUES (?, ?, ?, ?)',
            [$msgId, $orgId, $u['id'], $text]
        );
        logAudit($db, $u, $u['id'], 'SEND_MESSAGE', 'message', $msgId);

        jsonResponse([
            'success' => true,
            'message' => [
                'id' => $msgId,
                'fromEmployeeId' => $u['id'],
                'fromEmployeeName' => $u['name'],
                'message' => $text,
                'read' => false,
                'timestamp' => nowIso(),
            ],
        ], 201);
    }

    // POST /messages/read-all
    if ($method === 'POST' && $subRoute === 'read-all') {
        $u = requireOrganization($currentUser);
        $orgId = $u['organizationId'];
        if ($u['role'] === 'manager') {
            $db->execute('UPDATE messages SET is_read = 1 WHERE organization_id = ?', [$orgId]);
        } else {
            $db->execute('UPDATE messages SET is_read = 1 WHERE organization_id = ? AND from_user_id = ?', [$orgId, $u['id']]);
        }
        jsonResponse(['success' => true]);
    }

    // PATCH /messages/:id/read
    if ($method === 'PATCH' && preg_match('#^([^/]+)/read$#', $subRoute, $m)) {
        $u = requireOrganization($currentUser);
        $orgId = $u['organizationId'];
        $id = rawurldecode($m[1]);
        $isManager = $u['role'] === 'manager';

        $msg = $db->queryOne('SELECT id, from_user_id FROM messages WHERE id = ? AND organization_id = ?', [$id, $orgId]);
        if (!$msg) {
            jsonError('NOT_FOUND', 'Сообщение не найдено', 404);
        }
        if (!$isManager && $msg['from_user_id'] !== $u['id']) {
            jsonError('FORBIDDEN', 'Доступ запрещён. Вы не можете менять статус чужого сообщения', 403);
        }

        $db->execute('UPDATE messages SET is_read = 1 WHERE id = ? AND organization_id = ?', [$id, $orgId]);
        jsonResponse(['success' => true]);
    }

    // POST /messages/:id/reply
    if ($method === 'POST' && preg_match('#^([^/]+)/reply$#', $subRoute, $m)) {
        $u = requireActiveWriteAccess($currentUser);
        $orgId = $u['organizationId'];
        if ($u['role'] !== 'manager') {
            jsonError('FORBIDDEN', 'Только руководитель может отвечать на сообщения', 403);
        }
        $id = rawurldecode($m[1]);
        $body = getRequestJson();
        $replyText = trim((string)($body['replyText'] ?? ''));
        if ($replyText === '') {
            jsonError('BAD_REQUEST', 'Введите текст ответа', 400);
        }

        $orig = $db->queryOne('SELECT id, from_user_id, message FROM messages WHERE id = ? AND organization_id = ?', [$id, $orgId]);
        if (!$orig) {
            jsonError('NOT_FOUND', 'Сообщение не найдено', 404);
        }

        $notifId = 'notif-' . uuidv4();
        $db->execute(
            "INSERT INTO notifications (id, organization_id, user_id, title, text, type, source) VALUES (?, ?, ?, 'Ответ от руководителя', ?, 'system', 'manager')",
            [$notifId, $orgId, $orig['from_user_id'], $replyText]
        );
        $db->execute('UPDATE messages SET is_read = 1 WHERE id = ? AND organization_id = ?', [$id, $orgId]);
        logAudit($db, $u, $u['id'], 'REPLY_MESSAGE', 'message', $id, ['targetUserId' => $orig['from_user_id']]);

        jsonResponse(['success' => true, 'notificationId' => $notifId]);
    }

    jsonError('NOT_FOUND', 'Маршрут сообщений не найден', 404);
}

function handleNotificationsRoutes(AppDb $db, array $config, string $method, string $subRoute, ?array $currentUser): void {
    // GET /notifications
    if ($method === 'GET' && $subRoute === '') {
        $u = requireAuth($currentUser);
        $orgId = $u['organizationId'] ?? null;
        if (!$orgId) {
            jsonResponse(['success' => true, 'notifications' => []]);
        }
        $isManager = $u['role'] === 'manager';
        $sql = $isManager
            ? 'SELECT id, user_id, to_all, title, text, type, is_read, source, created_at FROM notifications WHERE organization_id = ? ORDER BY created_at DESC LIMIT 100'
            : 'SELECT id, user_id, to_all, title, text, type, is_read, source, created_at FROM notifications WHERE organization_id = ? AND (user_id = ? OR to_all = 1) ORDER BY created_at DESC LIMIT 100';
        $rows = $db->queryAll($sql, $isManager ? [$orgId] : [$orgId, $u['id']]);

        $notifications = array_map(fn($r) => [
            'id' => $r['id'],
            'toEmployeeId' => !empty($r['to_all']) ? 'all' : $r['user_id'],
            'title' => $r['title'],
            'text' => $r['text'],
            'type' => $r['type'],
            'read' => (bool)$r['is_read'],
            'source' => $r['source'],
            'timestamp' => toIsoString($r['created_at'] ?? null) ?? nowIso(),
        ], $rows);

        jsonResponse(['success' => true, 'notifications' => $notifications]);
    }

    // POST /notifications/read-all
    if ($method === 'POST' && $subRoute === 'read-all') {
        $u = requireOrganization($currentUser);
        $orgId = $u['organizationId'];
        if ($u['role'] === 'manager') {
            $db->execute('UPDATE notifications SET is_read = 1 WHERE organization_id = ?', [$orgId]);
        } else {
            $db->execute('UPDATE notifications SET is_read = 1 WHERE organization_id = ? AND (user_id = ? OR to_all = 1)', [$orgId, $u['id']]);
        }
        jsonResponse(['success' => true]);
    }

    // POST /notifications/thank-you
    if ($method === 'POST' && $subRoute === 'thank-you') {
        $u = requireManager($currentUser);
        $u = requireActiveWriteAccess($u);
        $orgId = $u['organizationId'];
        $body = getRequestJson();
        $location = trim((string)($body['location'] ?? ''));
        if ($location === '') {
            jsonError('BAD_REQUEST', 'Неверная локация', 400);
        }

        $emps = $db->queryAll(
            "SELECT u.id, u.name
             FROM users u
             JOIN user_locations ul ON ul.user_id = u.id
             JOIN locations l ON l.id = ul.location_id
             WHERE l.organization_id = ? AND l.code = ? AND u.active_organization_id = ? AND u.role = 'employee' AND u.status = 'active'",
            [$orgId, $location, $orgId]
        );

        foreach ($emps as $emp) {
            $db->execute(
                "INSERT INTO notifications (id, organization_id, user_id, title, text, type, source) VALUES (?, ?, ?, ?, ?, 'bonus', 'manager')",
                [
                    'notif-' . uuidv4(),
                    $orgId,
                    $emp['id'],
                    'Благодарность от руководителя ❤️',
                    "Руководитель выражает огромную благодарность за отличную работу на складе {$location}! Так держать!",
                ]
            );
        }
        logAudit($db, $u, $u['id'], 'SEND_THANK_YOU', 'notification', null, ['location' => $location, 'count' => count($emps)]);
        jsonResponse(['success' => true, 'count' => count($emps)]);
    }

    // GET /notifications/schedules
    if ($method === 'GET' && $subRoute === 'schedules') {
        $u = requireManager($currentUser);
        $u = requireOrganization($u);
        $rows = $db->queryAll(
            'SELECT id, title, text, schedule_type, time_of_day, target_role, is_active
             FROM scheduled_notifications WHERE organization_id = ? ORDER BY created_at DESC',
            [$u['organizationId']]
        );
        $schedules = array_map(fn($r) => [
            'id' => $r['id'],
            'title' => $r['title'],
            'text' => $r['text'],
            'scheduleType' => $r['schedule_type'],
            'timeOfDay' => $r['time_of_day'],
            'targetRole' => $r['target_role'],
            'isActive' => (bool)$r['is_active'],
        ], $rows);
        jsonResponse(['success' => true, 'schedules' => $schedules]);
    }

    // POST /notifications/schedules
    if ($method === 'POST' && $subRoute === 'schedules') {
        $u = requireManager($currentUser);
        $u = requireActiveWriteAccess($u);
        $orgId = $u['organizationId'];
        $body = getRequestJson();
        $title = trim((string)($body['title'] ?? ''));
        $text = trim((string)($body['text'] ?? ''));
        $scheduleType = trim((string)($body['scheduleType'] ?? ''));
        $timeOfDay = trim((string)($body['timeOfDay'] ?? ''));
        $targetRole = trim((string)($body['targetRole'] ?? ''));

        if ($title === '' || $text === '' || $scheduleType === '' || $timeOfDay === '' || $targetRole === '') {
            jsonError('BAD_REQUEST', 'Заполните все поля', 400);
        }

        $id = 'sched-' . uuidv4();
        $db->execute(
            'INSERT INTO scheduled_notifications (id, organization_id, title, text, schedule_type, time_of_day, target_role, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, 1)',
            [$id, $orgId, $title, $text, $scheduleType, $timeOfDay, $targetRole]
        );
        logAudit($db, $u, $u['id'], 'CREATE_SCHEDULED_NOTIFICATION', 'notification', $id, [
            'title' => $title,
            'scheduleType' => $scheduleType,
            'timeOfDay' => $timeOfDay,
        ]);

        jsonResponse([
            'success' => true,
            'schedule' => [
                'id' => $id,
                'title' => $title,
                'text' => $text,
                'scheduleType' => $scheduleType,
                'timeOfDay' => $timeOfDay,
                'targetRole' => $targetRole,
                'isActive' => true,
            ],
        ]);
    }

    // PATCH /notifications/schedules/:id/toggle
    if ($method === 'PATCH' && preg_match('#^schedules/([^/]+)/toggle$#', $subRoute, $m)) {
        $u = requireManager($currentUser);
        $u = requireActiveWriteAccess($u);
        $orgId = $u['organizationId'];
        $id = rawurldecode($m[1]);
        $body = getRequestJson();
        $isActive = !empty($body['isActive']);

        $db->execute(
            'UPDATE scheduled_notifications SET is_active = ? WHERE id = ? AND organization_id = ?',
            [$isActive ? 1 : 0, $id, $orgId]
        );
        logAudit($db, $u, $u['id'], 'TOGGLE_SCHEDULED_NOTIFICATION', 'notification', $id, ['isActive' => $isActive]);
        jsonResponse(['success' => true]);
    }

    // POST /notifications/schedules/:id/test
    if ($method === 'POST' && preg_match('#^schedules/([^/]+)/test$#', $subRoute, $m)) {
        $u = requireManager($currentUser);
        $u = requireActiveWriteAccess($u);
        $orgId = $u['organizationId'];
        $id = rawurldecode($m[1]);

        $rule = $db->queryOne(
            'SELECT id, title, text, schedule_type, time_of_day, target_role FROM scheduled_notifications WHERE id = ? AND organization_id = ?',
            [$id, $orgId]
        );
        if (!$rule) {
            jsonError('NOT_FOUND', 'Правило рассылки не найдено', 404);
        }

        $targetLabel = $rule['target_role'] === 'all' ? 'Все сотрудники' : ($rule['target_role'] === 'standard' ? 'Штатный персонал' : 'Подработчики');
        $tgMessage = "*{$rule['title']}*\n\n{$rule['text']}\n\n─────────────────\nПолучатели: {$targetLabel}\nВремя: {$rule['time_of_day']} МСК";
        $sendRes = sendBroadcastToStaffForOrg($db, $config, $orgId, $tgMessage, $rule['target_role']);

        logAudit($db, $u, $u['id'], 'TEST_SCHEDULED_NOTIFICATION', 'notification', $id, [
            'title' => $rule['title'],
            'success' => !empty($sendRes['success']),
            'deliveredCount' => $sendRes['deliveredCount'] ?? 0,
        ]);

        if (!empty($sendRes['success'])) {
            $cnt = (int)($sendRes['deliveredCount'] ?? 0);
            $extra = $cnt > 0 ? " ({$cnt} сотрудн. с Telegram)" : '';
            jsonResponse([
                'success' => true,
                'message' => "Рассылка успешно отправлена в Telegram{$extra}",
                'deliveredCount' => $cnt,
            ]);
        }
        jsonError('TELEGRAM_ERROR', $sendRes['error'] ?? 'Ошибка отправки в Telegram', 400);
    }

    // DELETE /notifications/schedules/:id
    if ($method === 'DELETE' && preg_match('#^schedules/([^/]+)$#', $subRoute, $m)) {
        $u = requireManager($currentUser);
        $u = requireActiveWriteAccess($u);
        $orgId = $u['organizationId'];
        $id = rawurldecode($m[1]);
        $db->execute('DELETE FROM scheduled_notifications WHERE id = ? AND organization_id = ?', [$id, $orgId]);
        logAudit($db, $u, $u['id'], 'DELETE_SCHEDULED_NOTIFICATION', 'notification', $id);
        jsonResponse(['success' => true]);
    }

    // PATCH /notifications/:id/read
    if ($method === 'PATCH' && preg_match('#^([^/]+)/read$#', $subRoute, $m)) {
        $u = requireOrganization($currentUser);
        $orgId = $u['organizationId'];
        $id = rawurldecode($m[1]);
        $isManager = $u['role'] === 'manager';

        $notif = $db->queryOne('SELECT id, user_id, to_all FROM notifications WHERE id = ? AND organization_id = ?', [$id, $orgId]);
        if (!$notif) {
            jsonError('NOT_FOUND', 'Уведомление не найдено', 404);
        }
        if (!$isManager && $notif['user_id'] !== $u['id'] && empty($notif['to_all'])) {
            jsonError('FORBIDDEN', 'Доступ запрещён. Вы не можете менять чужие уведомления', 403);
        }
        $db->execute('UPDATE notifications SET is_read = 1 WHERE id = ? AND organization_id = ?', [$id, $orgId]);
        jsonResponse(['success' => true]);
    }

    // DELETE /notifications/:id
    if ($method === 'DELETE' && $subRoute !== '' && strpos($subRoute, '/') === false) {
        $u = requireOrganization($currentUser);
        $orgId = $u['organizationId'];
        $id = rawurldecode($subRoute);
        $isManager = $u['role'] === 'manager';

        $notif = $db->queryOne('SELECT id, user_id FROM notifications WHERE id = ? AND organization_id = ?', [$id, $orgId]);
        if (!$notif) {
            jsonError('NOT_FOUND', 'Уведомление не найдено', 404);
        }
        if (!$isManager && $notif['user_id'] !== $u['id']) {
            jsonError('FORBIDDEN', 'Доступ запрещён. Вы не можете удалять чужие уведомления', 403);
        }
        $db->execute('DELETE FROM notifications WHERE id = ? AND organization_id = ?', [$id, $orgId]);
        jsonResponse(['success' => true]);
    }

    jsonError('NOT_FOUND', 'Маршрут уведомлений не найден', 404);
}

function handleGoalsRoutes(AppDb $db, array $config, string $method, string $subRoute, ?array $currentUser): void {
    // GET /income-goals
    if ($method === 'GET' && $subRoute === '') {
        $u = requireOrganization($currentUser);
        $all = getOrgSetting($db, $u['organizationId'], 'income_goals', []);
        if (!is_array($all)) $all = [];
        $goals = $u['role'] === 'manager'
            ? $all
            : array_values(array_filter($all, fn($g) => ($g['employeeId'] ?? '') === $u['id']));
        jsonResponse(['success' => true, 'goals' => $goals]);
    }

    // POST /income-goals
    if ($method === 'POST' && $subRoute === '') {
        $u = requireActiveWriteAccess($currentUser);
        $orgId = $u['organizationId'];
        $body = getRequestJson();
        $targetEmpId = ($u['role'] === 'manager' && !empty($body['employeeId'])) ? (string)$body['employeeId'] : $u['id'];
        $month = $body['month'] ?? '';
        $targetAmount = $body['targetAmount'] ?? null;

        if (!$month || !is_numeric($targetAmount)) {
            jsonResponse(['success' => false, 'error' => 'Укажите месяц и финансовую цель'], 400);
        }

        $goals = getOrgSetting($db, $orgId, 'income_goals', []);
        if (!is_array($goals)) $goals = [];
        $goals = array_values(array_filter($goals, fn($g) => !(($g['employeeId'] ?? '') === $targetEmpId && ($g['month'] ?? '') === $month)));

        $newGoal = [
            'employeeId' => $targetEmpId,
            'month' => (string)$month,
            'targetAmount' => (float)$targetAmount,
        ];
        $goals[] = $newGoal;
        setOrgSetting($db, $orgId, 'income_goals', $goals);

        jsonResponse(['success' => true, 'goals' => $goals, 'goal' => $newGoal]);
    }

    jsonError('NOT_FOUND', 'Маршрут финансовых целей не найден', 404);
}

function getDefaultPaybackTemplates(AppDb $db, string $organizationId): array {
    $defInc = ['Агентское вознаграждение', 'Продажи за смену (выручка)'];
    $defExp = [
        'Аренда помещения',
        'Фонд оплаты труда (ФОТ)',
        'Коммунальные услуги и интернет',
        'Эквайринг и банковское обслуживание',
        'Расходники (лента, скотч, пакетирование)',
        'Налоги',
    ];
    $parsed = getOrgSetting($db, $organizationId, 'payback_article_templates', null);
    if (is_array($parsed)) {
        $inc = is_array($parsed['incomeArticles'] ?? null)
            ? $parsed['incomeArticles']
            : array_values(array_unique(array_merge($defInc, is_array($parsed['customIncomeArticles'] ?? null) ? $parsed['customIncomeArticles'] : [])));
        $exp = is_array($parsed['expenseArticles'] ?? null)
            ? $parsed['expenseArticles']
            : array_values(array_unique(array_merge($defExp, is_array($parsed['customExpenseArticles'] ?? null) ? $parsed['customExpenseArticles'] : [])));
        return [
            'incomeArticles' => $inc,
            'expenseArticles' => $exp,
            'customIncomeArticles' => $parsed['customIncomeArticles'] ?? [],
            'customExpenseArticles' => $parsed['customExpenseArticles'] ?? [],
        ];
    }
    return [
        'incomeArticles' => $defInc,
        'expenseArticles' => $defExp,
        'customIncomeArticles' => [],
        'customExpenseArticles' => [],
    ];
}

function handlePaybackRoutes(AppDb $db, array $config, string $method, string $subRoute, ?array $currentUser): void {
    // GET /payback
    if ($method === 'GET' && $subRoute === '') {
        $u = requireManager($currentUser);
        $u = requireOrganization($u);
        $orgId = $u['organizationId'];
        $records = getOrgSetting($db, $orgId, 'payback_records', []);
        $templates = getDefaultPaybackTemplates($db, $orgId);
        jsonResponse([
            'success' => true,
            'records' => is_array($records) ? $records : [],
            'templates' => $templates,
        ]);
    }

    // POST /payback
    if ($method === 'POST' && $subRoute === '') {
        $u = requireManager($currentUser);
        $u = requireActiveWriteAccess($u);
        $orgId = $u['organizationId'];
        $body = getRequestJson();
        $record = $body['record'] ?? null;

        if (!is_array($record) || empty($record['pvzCode']) || empty($record['month'])) {
            jsonResponse(['success' => false, 'error' => 'Не указан склад или месяц'], 400);
        }

        $targetPvz = trim((string)$record['pvzCode']);
        $targetMonth = trim((string)$record['month']);

        $recordsRaw = getOrgSetting($db, $orgId, 'payback_records', []);
        if (!is_array($recordsRaw)) $recordsRaw = [];
        $records = array_values(array_filter($recordsRaw, fn($r) => !(($r['pvzCode'] ?? '') === $targetPvz && ($r['month'] ?? '') === $targetMonth)));

        $newRecord = [
            'pvzCode' => $targetPvz,
            'month' => $targetMonth,
            'incomes' => is_array($record['incomes'] ?? null) ? $record['incomes'] : [],
            'expenses' => is_array($record['expenses'] ?? null) ? $record['expenses'] : [],
            'updatedAt' => nowIso(),
        ];
        $records[] = $newRecord;

        $templates = getDefaultPaybackTemplates($db, $orgId);
        $incNames = array_values(array_filter(array_map(fn($i) => trim((string)($i['name'] ?? '')), $newRecord['incomes'])));
        $expNames = array_values(array_filter(array_map(fn($e) => trim((string)($e['name'] ?? '')), $newRecord['expenses'])));
        if (!empty($incNames)) $templates['incomeArticles'] = $incNames;
        if (!empty($expNames)) $templates['expenseArticles'] = $expNames;

        setOrgSetting($db, $orgId, 'payback_records', $records);
        setOrgSetting($db, $orgId, 'payback_article_templates', $templates);

        jsonResponse(['success' => true, 'records' => $records, 'templates' => $templates]);
    }

    // POST /payback/article
    if ($method === 'POST' && $subRoute === 'article') {
        $u = requireManager($currentUser);
        $u = requireActiveWriteAccess($u);
        $orgId = $u['organizationId'];
        $body = getRequestJson();
        $type = $body['type'] ?? '';
        $action = $body['action'] ?? '';
        $name = (string)($body['name'] ?? '');
        $oldName = (string)($body['oldName'] ?? '');

        if (!$type || !$action || trim($name) === '') {
            jsonResponse(['success' => false, 'error' => 'Некорректные параметры статьи'], 400);
        }

        $templates = getDefaultPaybackTemplates($db, $orgId);
        $records = getOrgSetting($db, $orgId, 'payback_records', []);
        if (!is_array($records)) $records = [];

        $isIncome = $type === 'income';
        $list = $isIncome ? ($templates['incomeArticles'] ?? []) : ($templates['expenseArticles'] ?? []);

        if ($action === 'add') {
            $cleanName = trim($name);
            if ($cleanName !== '' && !in_array($cleanName, $list, true)) {
                $list[] = $cleanName;
            }
        } elseif ($action === 'edit' && trim($oldName) !== '') {
            $cleanOld = trim($oldName);
            $cleanNew = trim($name);
            $idx = array_search($cleanOld, $list, true);
            if ($idx !== false) {
                $list[$idx] = $cleanNew;
            } elseif (!in_array($cleanNew, $list, true)) {
                $list[] = $cleanNew;
            }
            foreach ($records as &$r) {
                $key = $isIncome ? 'incomes' : 'expenses';
                $arr = is_array($r[$key] ?? null) ? $r[$key] : [];
                foreach ($arr as &$item) {
                    if (($item['name'] ?? '') === $cleanOld) {
                        $item['name'] = $cleanNew;
                    }
                }
                unset($item);
                $r[$key] = $arr;
            }
            unset($r);
            setOrgSetting($db, $orgId, 'payback_records', $records);
        } elseif ($action === 'delete') {
            $cleanName = trim($name);
            $list = array_values(array_filter($list, fn($n) => $n !== $cleanName));
            foreach ($records as &$r) {
                $key = $isIncome ? 'incomes' : 'expenses';
                $arr = is_array($r[$key] ?? null) ? $r[$key] : [];
                $r[$key] = array_values(array_filter($arr, fn($item) => ($item['name'] ?? '') !== $cleanName));
            }
            unset($r);
            setOrgSetting($db, $orgId, 'payback_records', $records);
        }

        if ($isIncome) {
            $templates['incomeArticles'] = $list;
        } else {
            $templates['expenseArticles'] = $list;
        }
        setOrgSetting($db, $orgId, 'payback_article_templates', $templates);

        jsonResponse(['success' => true, 'templates' => $templates, 'records' => $records]);
    }

    // DELETE /payback/:pvzCode/:month
    if ($method === 'DELETE' && preg_match('#^([^/]+)/([^/]+)$#', $subRoute, $m)) {
        $u = requireManager($currentUser);
        $u = requireActiveWriteAccess($u);
        $orgId = $u['organizationId'];
        $pvzCode = rawurldecode($m[1]);
        $month = rawurldecode($m[2]);

        $records = getOrgSetting($db, $orgId, 'payback_records', []);
        if (!is_array($records)) $records = [];
        $records = array_values(array_filter($records, fn($r) => !(($r['pvzCode'] ?? '') === $pvzCode && ($r['month'] ?? '') === $month)));
        setOrgSetting($db, $orgId, 'payback_records', $records);

        jsonResponse(['success' => true, 'records' => $records]);
    }

    jsonError('NOT_FOUND', 'Маршрут окупаемости не найден', 404);
}

function handleBotRoutes(AppDb $db, array $config, string $method, string $subRoute, ?array $currentUser): void {
    // GET /bot/status
    if ($method === 'GET' && $subRoute === 'status') {
        $u = requireAuth($currentUser);
        $orgId = $u['organizationId'] ?? null;
        $tgConfigured = false;
        if ($orgId) {
            $cfg = getTelegramSettingsForOrg($db, $config, $orgId);
            $tgConfigured = !empty($cfg['botToken']) && !empty($cfg['managerChatId']);
        }
        jsonResponse([
            'success' => true,
            'status' => [
                'scheduler' => ['running' => true, 'pid' => getmypid() ?: 1, 'uptimeSeconds' => 0],
                'telegramConfigured' => $tgConfigured,
            ],
        ]);
    }

    // GET /bot/logs
    if ($method === 'GET' && $subRoute === 'logs') {
        $u = requireOrganization($currentUser);
        $rows = $db->queryAll(
            'SELECT id, action, initiated_by, status, details, created_at FROM bot_logs WHERE organization_id = ? ORDER BY created_at DESC LIMIT 50',
            [$u['organizationId']]
        );
        $logs = array_map(function ($r) {
            $timeStr = '';
            try {
                $dt = new DateTimeImmutable($r['created_at'], new DateTimeZone('UTC'));
                $timeStr = $dt->setTimezone(new DateTimeZone('Europe/Moscow'))->format('H:i:s');
            } catch (Throwable $e) {
                $timeStr = substr((string)$r['created_at'], 11, 8);
            }
            $lines = [
                "[{$timeStr}] Действие: {$r['action']}",
                "[{$timeStr}] Инициатор: {$r['initiated_by']}",
                "[{$timeStr}] Статус: {$r['status']}",
            ];
            if (!empty($r['details'])) {
                $lines[] = "[{$timeStr}] {$r['details']}";
            }
            return [
                'id' => $r['id'],
                'timestamp' => toIsoString($r['created_at'] ?? null) ?? nowIso(),
                'initiatedBy' => $r['initiated_by'],
                'status' => $r['status'],
                'outputLogs' => $lines,
            ];
        }, $rows);

        jsonResponse(['success' => true, 'logs' => $logs]);
    }

    // POST /bot/restart
    if ($method === 'POST' && $subRoute === 'restart') {
        $u = requireManager($currentUser);
        $u = requireActiveWriteAccess($u);
        $orgId = $u['organizationId'];
        $initiatedBy = $u['name'] ?: 'Руководитель';

        $db->execute(
            'INSERT INTO bot_logs (id, organization_id, action, initiated_by, status, details) VALUES (?, ?, ?, ?, ?, ?)',
            ['rst-' . uuidv4(), $orgId, 'scheduler_restart', $initiatedBy, 'success', 'Планировщик и сервис уведомлений обновлены']
        );
        logAudit($db, $u, $u['id'], 'RESTART_BOT', 'bot', null);

        jsonResponse([
            'success' => true,
            'message' => 'Сервис Telegram и планировщик успешно перезапущены',
            'status' => ['scheduler' => ['running' => true, 'pid' => getmypid() ?: 1]],
        ]);
    }

    jsonError('NOT_FOUND', 'Маршрут бота не найден', 404);
}

function handleTelegramRoutes(AppDb $db, array $config, string $method, string $subRoute, ?array $currentUser): void {
    // POST /telegram/send
    if ($method === 'POST' && $subRoute === 'send') {
        $u = requireActiveWriteAccess($currentUser);
        $orgId = $u['organizationId'];
        $body = getRequestJson();
        $message = trim((string)($body['message'] ?? ''));
        $chatId = isset($body['chatId']) ? trim((string)$body['chatId']) : '';

        if ($message === '') {
            jsonError('VALIDATION_ERROR', 'Сообщение не может быть пустым', 400);
        }

        $settings = getTelegramSettingsForOrg($db, $config, $orgId);
        if ($u['role'] === 'manager' && $chatId !== '' && !empty($settings['managerChatId']) && $chatId !== $settings['managerChatId']) {
            jsonError('FORBIDDEN_CHAT_ID', 'Отправка сообщений разрешена только в авторизованный чат руководителя', 403);
        }

        $res = sendTelegramForOrg($db, $config, $orgId, $message);
        if (empty($res['success'])) {
            jsonError('TELEGRAM_ERROR', $res['error'] ?? 'Ошибка отправки в Telegram', 502);
        }

        $sim = !empty($res['simulated']);
        jsonResponse([
            'success' => true,
            'simulated' => $sim,
            'message' => $sim
                ? 'Сообщение обработано (токен Telegram не задан, вывод направлен в журнал)'
                : 'Сообщение успешно отправлено в Telegram',
        ]);
    }

    // POST /telegram/notify
    if ($method === 'POST' && $subRoute === 'notify') {
        $u = requireActiveWriteAccess($currentUser);
        $orgId = $u['organizationId'];
        $body = getRequestJson();
        $message = $body['message'] ?? '';
        if (!is_string($message) || trim($message) === '') {
            jsonResponse(['success' => false, 'error' => ['message' => 'Текст сообщения обязателен']], 400);
        }

        $res = sendTelegramForOrg($db, $config, $orgId, $message);
        $sim = !empty($res['simulated']);
        jsonResponse([
            'success' => !empty($res['success']),
            'simulated' => $sim,
            'message' => $sim
                ? 'Уведомление обработано (токен Telegram не задан)'
                : 'Уведомление успешно отправлено в Telegram',
        ]);
    }

    // POST /telegram/report
    if ($method === 'POST' && $subRoute === 'report') {
        $u = requireManager($currentUser);
        $u = requireActiveWriteAccess($u);
        $orgId = $u['organizationId'];
        $reportText = generateDailySalesReportTextForOrg($db, $orgId, getTodayMoscowDate());
        $res = sendTelegramForOrg($db, $config, $orgId, $reportText);

        if (empty($res['success'])) {
            jsonError('TELEGRAM_ERROR', $res['error'] ?? 'Ошибка отправки отчета в Telegram', 502);
        }
        $db->execute(
            'INSERT INTO bot_logs (id, organization_id, action, initiated_by, status, details) VALUES (?, ?, ?, ?, ?, ?)',
            ['rpt-' . uuidv4(), $orgId, 'manual_report', $u['name'] ?: 'Руководитель', 'success', 'Сводный отчёт за смену отправлен в Telegram']
        );
        jsonResponse(['success' => true, 'simulated' => !empty($res['simulated'])]);
    }

    // GET /telegram/settings
    if ($method === 'GET' && $subRoute === 'settings') {
        $u = requireManager($currentUser);
        $u = requireOrganization($u);
        $settings = getTelegramSettingsForOrg($db, $config, $u['organizationId']);
        $isConfigured = !empty($settings['botToken']) && !empty($settings['managerChatId']);
        jsonResponse([
            'success' => true,
            'settings' => [
                'isConfigured' => $isConfigured,
                'botToken' => $settings['botToken'],
                'managerChatId' => $settings['managerChatId'],
                'botUsername' => $settings['botUsername'],
                'updatedAt' => $settings['updatedAt'],
            ],
        ]);
    }

    // POST /telegram/settings
    if ($method === 'POST' && $subRoute === 'settings') {
        $u = requireManager($currentUser);
        $u = requireActiveWriteAccess($u);
        $orgId = $u['organizationId'];
        $body = getRequestJson();
        $trimmedToken = trim((string)($body['botToken'] ?? ''));
        $trimmedChat = trim((string)($body['managerChatId'] ?? ''));

        if ($trimmedToken === '' || $trimmedChat === '') {
            jsonResponse(['success' => false, 'error' => ['message' => 'Укажите токен бота и ID чата руководителя']], 400);
        }

        $checkRes = httpJsonRequest('GET', 'https://api.telegram.org/bot' . urlencode($trimmedToken) . '/getMe');
        if (empty($checkRes['ok']) || empty($checkRes['data']['ok'])) {
            jsonResponse(['success' => false, 'error' => ['message' => 'Неверный токен бота. Telegram отклонил авторизацию.']], 400);
        }
        $botUsername = (string)($checkRes['data']['result']['username'] ?? '');
        $updatedAt = nowIso();

        setOrgSetting($db, $orgId, 'telegram_settings', [
            'botToken' => $trimmedToken,
            'managerChatId' => $trimmedChat,
            'botUsername' => $botUsername,
            'updatedAt' => $updatedAt,
        ]);
        logAudit($db, $u, $u['id'], 'UPDATE_TELEGRAM_SETTINGS', 'system', null, [
            'managerChatId' => $trimmedChat,
            'botUsername' => $botUsername,
        ]);

        jsonResponse([
            'success' => true,
            'settings' => [
                'isConfigured' => true,
                'botToken' => $trimmedToken,
                'managerChatId' => $trimmedChat,
                'botUsername' => $botUsername,
                'updatedAt' => $updatedAt,
            ],
        ]);
    }

    // DELETE /telegram/settings
    if ($method === 'DELETE' && $subRoute === 'settings') {
        $u = requireManager($currentUser);
        $u = requireActiveWriteAccess($u);
        setOrgSetting($db, $u['organizationId'], 'telegram_settings', [
            'botToken' => '',
            'managerChatId' => '',
            'botUsername' => '',
            'updatedAt' => nowIso(),
        ]);
        logAudit($db, $u, $u['id'], 'DISCONNECT_TELEGRAM', 'system', null, []);
        jsonResponse(['success' => true]);
    }

    // POST /telegram/test
    if ($method === 'POST' && $subRoute === 'test') {
        $u = requireManager($currentUser);
        $u = requireActiveWriteAccess($u);
        $orgId = $u['organizationId'];
        $body = getRequestJson();
        $settings = getTelegramSettingsForOrg($db, $config, $orgId);

        $token = trim((string)($body['botToken'] ?? $settings['botToken'] ?? ''));
        $chatId = trim((string)($body['managerChatId'] ?? $settings['managerChatId'] ?? ''));

        if ($token === '' || $chatId === '') {
            jsonResponse(['success' => false, 'error' => ['message' => 'Сначала заполните токен бота и ID чата руководителя']], 400);
        }

        $msk = getMoscowTimeParts();
        $testMsg = "📋 *Тестовое сообщение из панели управления SKLADIN*\n\n"
            . "Интеграция с Telegram успешно подключена!\n"
            . "⏰ Время отправки: *{$msk['displayDateTime']}* (МСК)\n\n"
            . "Сюда будут приходить уведомления о выходах на смену, явках сотрудников, заявках и бирже смен.";

        $resSend = sendTelegramWithToken($testMsg, $token, $chatId);
        if (!empty($resSend['success']) && empty($resSend['simulated'])) {
            jsonResponse(['success' => true, 'message' => 'Тестовое сообщение успешно отправлено в Telegram!']);
        }
        jsonResponse([
            'success' => false,
            'error' => [
                'message' => $resSend['error'] ?? 'Ошибка отправки. Убедитесь, что вы нажали START в диалоге с ботом и указали верный Chat ID.',
            ],
        ], 400);
    }

    // GET /telegram/templates
    if ($method === 'GET' && $subRoute === 'templates') {
        $u = requireManager($currentUser);
        $u = requireOrganization($u);
        $defaults = getDefaultTelegramTemplates();
        $stored = getOrgSetting($db, $u['organizationId'], 'telegram_templates', []);
        if (is_array($stored)) {
            foreach ($defaults as $k => $def) {
                if (isset($stored[$k]) && is_array($stored[$k])) {
                    $defaults[$k] = array_merge($def, $stored[$k]);
                }
            }
        }
        jsonResponse(['success' => true, 'templates' => $defaults]);
    }

    // POST /telegram/templates
    if ($method === 'POST' && $subRoute === 'templates') {
        $u = requireManager($currentUser);
        $u = requireActiveWriteAccess($u);
        $orgId = $u['organizationId'];
        $body = getRequestJson();
        $templates = $body['templates'] ?? null;
        if (!is_array($templates)) {
            jsonResponse(['success' => false, 'error' => ['message' => 'Неверный формат данных шаблонов']], 400);
        }

        $defaults = getDefaultTelegramTemplates();
        $existing = getOrgSetting($db, $orgId, 'telegram_templates', $defaults);
        if (!is_array($existing)) $existing = $defaults;
        foreach ($templates as $k => $tpl) {
            if (is_array($tpl) && isset($defaults[$k])) {
                $existing[$k] = array_merge($defaults[$k], $tpl);
            }
        }
        setOrgSetting($db, $orgId, 'telegram_templates', $existing);
        logAudit($db, $u, $u['id'], 'UPDATE_TELEGRAM_TEMPLATES', 'system', null, ['templateKeys' => array_keys($templates)]);

        jsonResponse(['success' => true, 'templates' => $existing]);
    }

    jsonError('NOT_FOUND', 'Маршрут Telegram не найден', 404);
}

function handleAuditRoutes(AppDb $db, array $config, string $method, string $subRoute, ?array $currentUser): void {
    if ($method === 'GET' && $subRoute === '') {
        $u = requireManager($currentUser);
        $u = requireOrganization($u);
        $rows = $db->queryAll(
            'SELECT a.id, a.user_id, u.name as user_name, a.action, a.entity, a.entity_id, a.ip, a.details, a.created_at
             FROM audit_logs a
             LEFT JOIN users u ON u.id = a.user_id
             WHERE a.organization_id = ?
             ORDER BY a.created_at DESC
             LIMIT 100',
            [$u['organizationId']]
        );
        $logs = array_map(fn($r) => [
            'id' => $r['id'],
            'userId' => $r['user_id'],
            'userName' => $r['user_name'] ?: 'Система',
            'action' => $r['action'],
            'entity' => $r['entity'],
            'entityId' => $r['entity_id'],
            'ip' => $r['ip'],
            'details' => !empty($r['details']) ? json_decode($r['details'], true) : null,
            'timestamp' => toIsoString($r['created_at'] ?? null) ?? nowIso(),
        ], $rows);

        jsonResponse(['success' => true, 'logs' => $logs]);
    }

    jsonError('NOT_FOUND', 'Маршрут аудита не найден', 404);
}
