<?php
if (!defined('PVZ_APP')) {
    http_response_code(403);
    exit('Direct access prohibited.');
}

function notifyOrgManagers(AppDb $db, string $organizationId, string $title, string $text): void {
    try {
        $mgrs = $db->queryAll(
            "SELECT id FROM users WHERE active_organization_id = ? AND role = 'manager' AND status = 'active'",
            [$organizationId]
        );
        foreach ($mgrs as $m) {
            $db->execute(
                'INSERT INTO notifications (id, organization_id, user_id, title, text, type, source) VALUES (?, ?, ?, ?, ?, ?, ?)',
                ['notif-' . uuidv4(), $organizationId, $m['id'], $title, $text, 'system', 'system']
            );
        }
    } catch (Throwable $e) {
        // Non-blocking
    }
}

function getOrganizationById(AppDb $db, string $organizationId): ?array {
    $row = $db->queryOne(
        'SELECT id, name, slug, inn, timezone, owner_user_id, created_at FROM organizations WHERE id = ?',
        [$organizationId]
    );
    if (!$row) return null;
    return [
        'id' => $row['id'],
        'name' => $row['name'],
        'slug' => $row['slug'] ?: null,
        'inn' => $row['inn'] ?: null,
        'timezone' => $row['timezone'] ?: 'Europe/Moscow',
        'ownerUserId' => $row['owner_user_id'] ?: null,
        'createdAt' => toIsoString($row['created_at'] ?? null),
    ];
}

function getOrganizationSubscription(AppDb $db, string $organizationId): ?array {
    $row = $db->queryOne(
        'SELECT id, organization_id, tariff_id, status, billing_period_months,
                trial_started_at, trial_ends_at, current_period_start, current_period_end,
                trial_day4_notified_at, expired_notified_at, selected_tariff_id, selected_period_months
         FROM subscriptions
         WHERE organization_id = ?',
        [$organizationId]
    );
    if (!$row) return null;

    $now = new DateTimeImmutable('now', new DateTimeZone('UTC'));
    $status = $row['status'];

    if ($status === 'trial' && !empty($row['trial_ends_at'])) {
        try {
            $trialEnd = new DateTimeImmutable($row['trial_ends_at']);
            if ($trialEnd <= $now) {
                $status = 'expired_readonly';
                $nowIso = nowIso();
                $db->execute(
                    "UPDATE subscriptions SET status = 'expired_readonly', expired_notified_at = COALESCE(expired_notified_at, ?), updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'trial'",
                    [$nowIso, $row['id']]
                );
                $db->execute(
                    'INSERT INTO subscription_history (id, organization_id, subscription_id, previous_status, new_status, tariff_id, billing_period_months, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                    ['subh-' . uuidv4(), $organizationId, $row['id'], 'trial', 'expired_readonly', $row['tariff_id'], (int)($row['billing_period_months'] ?: 1), 'TRIAL_EXPIRED']
                );
                if (empty($row['expired_notified_at'])) {
                    notifyOrgManagers(
                        $db,
                        $organizationId,
                        'Пробный период завершён',
                        '7-дневный пробный период завершён. Кабинет переведён в режим чтения, ваши данные сохранены. Оформите подписку, чтобы продолжить вносить изменения.'
                    );
                }
            }
        } catch (Throwable $e) {}
    } elseif ($status === 'active' && !empty($row['current_period_end'])) {
        try {
            $periodEnd = new DateTimeImmutable($row['current_period_end']);
            if ($periodEnd <= $now) {
                $status = 'expired_readonly';
                $nowIso = nowIso();
                $db->execute(
                    "UPDATE subscriptions SET status = 'expired_readonly', expired_notified_at = COALESCE(expired_notified_at, ?), updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'active'",
                    [$nowIso, $row['id']]
                );
                $db->execute(
                    'INSERT INTO subscription_history (id, organization_id, subscription_id, previous_status, new_status, tariff_id, billing_period_months, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                    ['subh-' . uuidv4(), $organizationId, $row['id'], 'active', 'expired_readonly', $row['tariff_id'], (int)($row['billing_period_months'] ?: 1), 'PERIOD_EXPIRED']
                );
                if (empty($row['expired_notified_at'])) {
                    notifyOrgManagers(
                        $db,
                        $organizationId,
                        'Срок действия подписки истёк',
                        'Оплаченный период подписки завершился. Доступен просмотр и выгрузка данных; для продолжения работы продлите подписку.'
                    );
                }
            }
        } catch (Throwable $e) {}
    }

    $tariffId = isValidTariffId($row['tariff_id']) ? $row['tariff_id'] : 'business';
    $tariffCfg = getTariffById($tariffId);
    $endAnchor = $status === 'trial' ? ($row['trial_ends_at'] ?? null) : ($row['current_period_end'] ?? null);

    $daysRemaining = null;
    $hoursRemaining = null;
    if ($endAnchor) {
        try {
            $endDt = new DateTimeImmutable($endAnchor);
            $diffSec = max(0, $endDt->getTimestamp() - $now->getTimestamp());
            $hoursRemaining = (int)ceil($diffSec / 3600);
            $daysRemaining = (int)ceil($diffSec / 86400);
        } catch (Throwable $e) {}
    }

    $showTrialDay4Warning = false;
    if ($status === 'trial' && !empty($row['trial_started_at'])) {
        try {
            $startDt = new DateTimeImmutable($row['trial_started_at']);
            if (($now->getTimestamp() - $startDt->getTimestamp()) >= 3 * 86400) {
                $showTrialDay4Warning = true;
            }
        } catch (Throwable $e) {}
    }

    return [
        'id' => $row['id'],
        'organizationId' => $row['organization_id'],
        'tariffId' => $tariffId,
        'tariffName' => $tariffCfg['name'],
        'status' => $status,
        'billingPeriodMonths' => normalizeBillingPeriod($row['billing_period_months']),
        'maxLocations' => $tariffCfg['maxLocations'],
        'maxStaff' => $tariffCfg['maxStaff'],
        'trialStartedAt' => toIsoString($row['trial_started_at'] ?? null),
        'trialEndsAt' => toIsoString($row['trial_ends_at'] ?? null),
        'currentPeriodStart' => toIsoString($row['current_period_start'] ?? null),
        'currentPeriodEnd' => toIsoString($row['current_period_end'] ?? null),
        'daysRemaining' => $daysRemaining,
        'hoursRemaining' => $hoursRemaining,
        'showTrialDay4Warning' => $showTrialDay4Warning,
        'isReadOnly' => $status === 'expired_readonly',
        'selectedTariffId' => isValidTariffId($row['selected_tariff_id'] ?? null) ? $row['selected_tariff_id'] : null,
        'selectedPeriodMonths' => !empty($row['selected_period_months']) ? normalizeBillingPeriod($row['selected_period_months']) : null,
    ];
}

function getOrganizationUsage(AppDb $db, string $organizationId): array {
    $locRow = $db->queryOne(
        'SELECT COUNT(*) as cnt FROM locations WHERE organization_id = ? AND (is_archived IS NULL OR is_archived = 0)',
        [$organizationId]
    );
    $staffRow = $db->queryOne(
        "SELECT COUNT(*) as cnt FROM users WHERE active_organization_id = ? AND role = 'employee' AND status NOT IN ('archived', 'deleted')",
        [$organizationId]
    );
    return [
        'locationsCount' => (int)($locRow['cnt'] ?? 0),
        'staffCount' => (int)($staffRow['cnt'] ?? 0),
    ];
}

function checkLocationQuota(AppDb $db, string $organizationId): array {
    $sub = getOrganizationSubscription($db, $organizationId);
    $usage = getOrganizationUsage($db, $organizationId);
    $tariffId = $sub['tariffId'] ?? 'start';
    $tariff = getTariffById($tariffId);
    $max = $sub['maxLocations'] ?? $tariff['maxLocations'];
    $current = $usage['locationsCount'];
    $allowed = $current < $max;
    return [
        'allowed' => $allowed,
        'current' => $current,
        'max' => $max,
        'tariffId' => $tariffId,
        'tariffName' => $tariff['name'],
        'message' => $allowed ? null : "Достигнут лимит вашего тарифа «{$tariff['name']}»: {$current} из {$max} ПВЗ/складов. Перейдите на более высокий тариф или архивируйте неиспользуемый объект.",
    ];
}

function checkStaffQuota(AppDb $db, string $organizationId): array {
    $sub = getOrganizationSubscription($db, $organizationId);
    $usage = getOrganizationUsage($db, $organizationId);
    $tariffId = $sub['tariffId'] ?? 'start';
    $tariff = getTariffById($tariffId);
    $max = $sub['maxStaff'] ?? $tariff['maxStaff'];
    $current = $usage['staffCount'];
    $allowed = $current < $max;
    return [
        'allowed' => $allowed,
        'current' => $current,
        'max' => $max,
        'tariffId' => $tariffId,
        'tariffName' => $tariff['name'],
        'message' => $allowed ? null : "Достигнут лимит вашего тарифа «{$tariff['name']}»: {$current} из {$max} сотрудников. Перейдите на более высокий тариф или архивируйте неактивных сотрудников.",
    ];
}

function validateTariffDowngrade(AppDb $db, string $organizationId, string $targetTariffId): array {
    $target = getTariffById($targetTariffId);
    $usage = getOrganizationUsage($db, $organizationId);
    if ($usage['locationsCount'] > $target['maxLocations']) {
        return [
            'allowed' => false,
            'reason' => "На тарифе «{$target['name']}» доступно до {$target['maxLocations']} ПВЗ/складов, но сейчас активно {$usage['locationsCount']}. Сначала архивируйте лишние объекты.",
        ];
    }
    if ($usage['staffCount'] > $target['maxStaff']) {
        return [
            'allowed' => false,
            'reason' => "На тарифе «{$target['name']}» доступно до {$target['maxStaff']} сотрудников, но сейчас активно {$usage['staffCount']}. Сначала архивируйте лишних сотрудников.",
        ];
    }
    return ['allowed' => true];
}

function createOrganizationWithTrial(AppDb $db, array $params): array {
    $orgId = 'org-' . uuidv4();
    $cleanName = mb_substr(trim((string)$params['name']), 0, 120);
    $cleanInn = !empty($params['inn']) ? mb_substr(trim((string)$params['inn']), 0, 20) : null;
    $timezone = !empty($params['timezone']) ? trim((string)$params['timezone']) : 'Europe/Moscow';
    $selectedTariff = isValidTariffId($params['selectedTariffId'] ?? null) ? $params['selectedTariffId'] : 'business';
    $selectedPeriod = normalizeBillingPeriod($params['selectedPeriodMonths'] ?? 1);

    $now = new DateTimeImmutable('now', new DateTimeZone('UTC'));
    $trialStartIso = $now->format('Y-m-d\TH:i:s.000\Z');
    $trialEndIso = $now->modify('+7 days')->format('Y-m-d\TH:i:s.000\Z');
    $subId = 'sub-' . uuidv4();
    $trialTariffId = 'maximum';

    $db->transaction(function (AppDb $tx) use ($orgId, $cleanName, $cleanInn, $timezone, $params, $subId, $trialTariffId, $selectedPeriod, $trialStartIso, $trialEndIso) {
        $tx->execute(
            'INSERT INTO organizations (id, name, inn, timezone, owner_user_id) VALUES (?, ?, ?, ?, ?)',
            [$orgId, $cleanName, $cleanInn, $timezone, $params['ownerUserId']]
        );
        $tx->execute(
            "INSERT INTO organization_members (id, organization_id, user_id, org_role, status) VALUES (?, ?, ?, 'owner', 'active')",
            ['mem-' . uuidv4(), $orgId, $params['ownerUserId']]
        );
        $tx->execute(
            'UPDATE users SET active_organization_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [$orgId, $params['ownerUserId']]
        );
        $tx->execute(
            "INSERT INTO subscriptions (id, organization_id, tariff_id, status, billing_period_months, trial_started_at, trial_ends_at, selected_tariff_id, selected_period_months)
             VALUES (?, ?, ?, 'trial', ?, ?, ?, ?, ?)",
            [$subId, $orgId, $trialTariffId, $selectedPeriod, $trialStartIso, $trialEndIso, $selectedTariff, $selectedPeriod]
        );
        $tx->execute(
            "INSERT INTO subscription_history (id, organization_id, subscription_id, previous_status, new_status, tariff_id, billing_period_months, reason, actor_user_id)
             VALUES (?, ?, ?, NULL, 'trial', ?, ?, 'TRIAL_STARTED', ?)",
            ['subh-' . uuidv4(), $orgId, $subId, $trialTariffId, $selectedPeriod, $params['ownerUserId']]
        );
        $tx->execute(
            "INSERT INTO notifications (id, organization_id, user_id, title, text, type, source) VALUES (?, ?, ?, ?, ?, 'system', 'system')",
            [
                'notif-' . uuidv4(),
                $orgId,
                $params['ownerUserId'],
                'Добро пожаловать в SKLADIN!',
                'Пробный период 7 дней активирован до ' . formatDateRu($trialEndIso) . '. Начните с добавления первого склада и команды.',
            ]
        );
    });

    return [
        'organization' => getOrganizationById($db, $orgId),
        'subscription' => getOrganizationSubscription($db, $orgId),
    ];
}

function activatePaidSubscription(AppDb $db, string $organizationId, string $tariffId, int $periodMonths, ?string $actorUserId = null, string $reason = 'PAYMENT_CONFIRMED'): ?array {
    $existing = $db->queryOne('SELECT id, status, current_period_end FROM subscriptions WHERE organization_id = ?', [$organizationId]);
    $now = new DateTimeImmutable('now', new DateTimeZone('UTC'));
    $baseDate = $now;
    if ($existing && $existing['status'] === 'active' && !empty($existing['current_period_end'])) {
        try {
            $curEnd = new DateTimeImmutable($existing['current_period_end']);
            if ($curEnd > $now) {
                $baseDate = $curEnd;
            }
        } catch (Throwable $e) {}
    }

    $periodStartIso = $now->format('Y-m-d\TH:i:s.000\Z');
    $periodEndIso = $baseDate->modify("+{$periodMonths} months")->format('Y-m-d\TH:i:s.000\Z');

    if (!$existing) {
        $subId = 'sub-' . uuidv4();
        $db->execute(
            "INSERT INTO subscriptions (id, organization_id, tariff_id, status, billing_period_months, current_period_start, current_period_end, selected_tariff_id, selected_period_months)
             VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?)",
            [$subId, $organizationId, $tariffId, $periodMonths, $periodStartIso, $periodEndIso, $tariffId, $periodMonths]
        );
        $db->execute(
            "INSERT INTO subscription_history (id, organization_id, subscription_id, previous_status, new_status, tariff_id, billing_period_months, reason, actor_user_id)
             VALUES (?, ?, ?, NULL, 'active', ?, ?, ?, ?)",
            ['subh-' . uuidv4(), $organizationId, $subId, $tariffId, $periodMonths, $reason, $actorUserId]
        );
    } else {
        $db->execute(
            "UPDATE subscriptions
             SET tariff_id = ?, status = 'active', billing_period_months = ?, current_period_start = ?, current_period_end = ?, selected_tariff_id = ?, selected_period_months = ?, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?",
            [$tariffId, $periodMonths, $periodStartIso, $periodEndIso, $tariffId, $periodMonths, $existing['id']]
        );
        $db->execute(
            "INSERT INTO subscription_history (id, organization_id, subscription_id, previous_status, new_status, tariff_id, billing_period_months, reason, actor_user_id)
             VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?)",
            ['subh-' . uuidv4(), $organizationId, $existing['id'], $existing['status'], $tariffId, $periodMonths, $reason, $actorUserId]
        );
    }

    $tariffName = getTariffById($tariffId)['name'];
    notifyOrgManagers(
        $db,
        $organizationId,
        "Подписка «{$tariffName}» активна",
        "Оплата подтверждена. Тариф «{$tariffName}» активен до " . formatDateRu($periodEndIso) . '.'
    );

    return getOrganizationSubscription($db, $organizationId);
}

// =========================================================================
// Payments Service
// =========================================================================

function getPaymentProvidersStatus(array $config): array {
    $yookassaConfigured = !empty($config['yookassa_shop_id']) && !empty($config['yookassa_secret_key']);
    return [
        [
            'method' => 'card',
            'label' => 'Банковская карта (МИР / Visa / Mastercard)',
            'configured' => $yookassaConfigured,
            'provider' => 'yookassa',
            'reason' => $yookassaConfigured ? null : 'Платёжный шлюз ЮKassa не подключён: задайте yookassa_shop_id и yookassa_secret_key в config.php.',
        ],
        [
            'method' => 'sbp',
            'label' => 'СБП (Система быстрых платежей)',
            'configured' => $yookassaConfigured,
            'provider' => 'yookassa',
            'reason' => $yookassaConfigured ? null : 'Оплата через СБП не подключена: требуются учётные данные шлюза ЮKassa или СБП.',
        ],
        [
            'method' => 'invoice',
            'label' => 'Безналичный счёт для юрлиц и ИП',
            'configured' => true,
            'provider' => 'manual_invoice',
        ],
        [
            'method' => 'yandex_split',
            'label' => 'Оплата частями (Яндекс Сплит)',
            'configured' => false,
            'provider' => 'yandex_split',
            'reason' => 'Модуль Яндекс Сплит не подключён: требуются ключ продавца и договор Яндекс Пэй.',
        ],
    ];
}

function listOrganizationPayments(AppDb $db, string $organizationId): array {
    $rows = $db->queryAll(
        'SELECT id, tariff_id, period_months, discount_percent, amount_rub, payment_method, provider,
                status, invoice_number, confirmation_url, created_at, paid_at
         FROM payments
         WHERE organization_id = ?
         ORDER BY created_at DESC
         LIMIT 30',
        [$organizationId]
    );
    return array_map(fn($r) => [
        'id' => $r['id'],
        'tariffId' => $r['tariff_id'] ?: 'business',
        'periodMonths' => (int)($r['period_months'] ?: 1),
        'discountPercent' => (int)($r['discount_percent'] ?: 0),
        'amountRub' => (float)($r['amount_rub'] ?: 0),
        'paymentMethod' => $r['payment_method'] ?: 'card',
        'provider' => $r['provider'],
        'status' => $r['status'] ?: 'pending',
        'invoiceNumber' => $r['invoice_number'] ?: null,
        'confirmationUrl' => $r['confirmation_url'] ?: null,
        'createdAt' => toIsoString($r['created_at'] ?? null) ?? nowIso(),
        'paidAt' => toIsoString($r['paid_at'] ?? null),
    ], $rows);
}

// =========================================================================
// Telegram Service
// =========================================================================

function getDefaultTelegramTemplates(): array {
    return [
        'checkin' => [
            'id' => 'checkin',
            'name' => 'Отметка Check-in',
            'description' => 'Уведомление руководителю о начале смены сотрудником',
            'variables' => ['{employeeName}', '{location}', '{shiftType}', '{date}'],
            'template' => "🔔 *Новая отметка Check-in!*\n\n👤 *Сотрудник:* {employeeName}\n📍 *Склад:* {location}\n🕒 *Смена:* {shiftType}\n📅 *Дата:* {date}",
        ],
        'daily_report' => [
            'id' => 'daily_report',
            'name' => 'Ежедневный сводный отчет (21:15)',
            'description' => 'Вечерняя сводка по продажам, выручке и премиям',
            'variables' => ['{date}', '{staffList}', '{totalRevenue}', '{totalBonus}', '{totalCash}', '{totalCard}'],
            'template' => "💰 *Отчёт по продажам на {date}*\n\n{staffList}\n\n─────────────────\n💵 Итог дня: *{totalRevenue} ₽*\n🎁 Премия: *{totalBonus} ₽*\n💵 Наличные: *{totalCash} ₽*\n💳 Безналичные: *{totalCard} ₽*",
        ],
        'swap_status' => [
            'id' => 'swap_status',
            'name' => 'Решение по замене смены',
            'description' => 'Уведомление при согласовании или отклонении заявки биржи',
            'variables' => ['{status}', '{date}', '{location}', '{requesterName}', '{candidateName}'],
            'template' => "📋 *Решение по замене смены: {status}*\n📅 Дата: *{date}* ({location})\n👤 Передал: *{requesterName}*\n👤 Принял: *{candidateName}*",
        ],
        'thank_you' => [
            'id' => 'thank_you',
            'name' => 'Благодарность сотруднику',
            'description' => 'Отправка благодарности сотруднику смены от руководителя',
            'variables' => ['{location}'],
            'template' => "❤️ *Благодарность от руководителя*\nРуководитель выражает огромную благодарность за отличную работу на складе {location}! Так держать!",
        ],
    ];
}

function escapeTelegramMarkdown(string $text): string {
    return preg_replace('/([_*[\]()~`>#+\-=|{}.!\\\\])/', '\\\\$1', $text);
}

function getTelegramSettingsForOrg(AppDb $db, array $config, string $organizationId): array {
    $stored = getOrgSetting($db, $organizationId, 'telegram_settings', null);
    if (is_array($stored) && (!empty($stored['botToken']) || !empty($stored['managerChatId']))) {
        return [
            'botToken' => (string)($stored['botToken'] ?? ''),
            'managerChatId' => (string)($stored['managerChatId'] ?? ''),
            'botUsername' => (string)($stored['botUsername'] ?? ''),
            'updatedAt' => $stored['updatedAt'] ?? null,
        ];
    }
    if ($organizationId === DEFAULT_LEGACY_ORG_ID) {
        return [
            'botToken' => (string)($config['telegram_bot_token'] ?? ''),
            'managerChatId' => (string)($config['telegram_manager_chat_id'] ?? ''),
            'botUsername' => '',
            'updatedAt' => null,
        ];
    }
    return ['botToken' => '', 'managerChatId' => '', 'botUsername' => '', 'updatedAt' => null];
}

function sendTelegramWithToken(string $text, string $token, string $chatId): array {
    if ($token === '' || $chatId === '') {
        return ['success' => true, 'simulated' => true];
    }
    $url = 'https://api.telegram.org/bot' . urlencode($token) . '/sendMessage';
    $res = httpJsonRequest('POST', $url, [
        'chat_id' => $chatId,
        'text' => $text,
        'parse_mode' => 'Markdown',
    ], ['Content-Type' => 'application/json']);

    if (!$res['ok'] || empty($res['data']['ok'])) {
        $res = httpJsonRequest('POST', $url, [
            'chat_id' => $chatId,
            'text' => $text,
        ], ['Content-Type' => 'application/json']);
    }

    if (!$res['ok'] || empty($res['data']['ok'])) {
        return [
            'success' => false,
            'error' => $res['data']['description'] ?? $res['error'] ?? 'Ошибка Telegram API',
        ];
    }
    return ['success' => true];
}

function sendTelegramForOrg(AppDb $db, array $config, string $organizationId, string $text, ?string $chatId = null): array {
    $cfg = getTelegramSettingsForOrg($db, $config, $organizationId);
    $targetChat = $chatId ?: $cfg['managerChatId'];
    return sendTelegramWithToken($text, $cfg['botToken'], $targetChat);
}

function generateDailySalesReportTextForOrg(AppDb $db, string $organizationId, ?string $targetDate = null): string {
    $dt = new DateTimeImmutable('now', new DateTimeZone('Europe/Moscow'));
    $dateToQuery = $targetDate ?: $dt->format('Y-m-d');
    $displayDate = formatDateDDMMYYYY($dateToQuery);
    $displayDate = str_replace('-', '.', $displayDate);

    $shiftLabels = [
        'day12' => 'День 12ч (08:00–20:00)',
        'night12' => 'Ночь 12ч (20:00–08:00)',
        'standard8' => 'Смена 8ч',
        'part6' => 'Подработка 6ч',
        'part4' => 'Подработка 4ч',
        'daily24' => 'Сутки 24ч',
        'standard' => 'Дневная смена',
        '400+' => 'Расширенная',
        '500+' => 'Полная',
        '8h' => '8 часов',
        '6h' => '6 часов',
        '4h' => '4 часа',
        'shift8h' => '8 часов',
        'shift4h' => '4 часа',
    ];

    $staffRows = $db->queryAll(
        "SELECT id, name FROM users WHERE active_organization_id = ? AND role = 'employee' AND status = 'active' ORDER BY name ASC",
        [$organizationId]
    );
    $checkinRows = $db->queryAll(
        'SELECT user_id, location_code, shift_type FROM checkins WHERE organization_id = ? AND date = ?',
        [$organizationId, $dateToQuery]
    );
    $salesRows = $db->queryAll(
        'SELECT user_id, total, photo_cash, photo_card, print_cash, print_card, lamination_cash, lamination_card, bonus FROM sales WHERE organization_id = ? AND date = ?',
        [$organizationId, $dateToQuery]
    );

    $checkinMap = [];
    foreach ($checkinRows as $c) $checkinMap[$c['user_id']] = $c;
    $salesMap = [];
    foreach ($salesRows as $s) $salesMap[$s['user_id']] = $s;

    $totalRevenue = 0.0;
    $totalCash = 0.0;
    $totalCard = 0.0;
    $totalBonus = 0.0;
    $lines = ["💰 *Отчёт по продажам на {$displayDate}*\n"];

    if (empty($staffRows)) {
        $lines[] = '_(Активных сотрудников в системе нет)_';
    } else {
        foreach ($staffRows as $emp) {
            $safeName = escapeTelegramMarkdown($emp['name']);
            $checkin = $checkinMap[$emp['id']] ?? null;
            if (!$checkin) {
                $lines[] = "🔴 {$safeName} — нет check-in";
            } else {
                $shiftLabel = $shiftLabels[$checkin['shift_type']] ?? $checkin['shift_type'];
                $sale = $salesMap[$emp['id']] ?? null;
                if ($sale) {
                    $empTotal = (float)$sale['total'];
                    $empCash = (float)$sale['photo_cash'] + (float)$sale['print_cash'] + (float)$sale['lamination_cash'];
                    $empCard = (float)$sale['photo_card'] + (float)$sale['print_card'] + (float)$sale['lamination_card'];
                    $empBonus = (float)$sale['bonus'];
                    $totalRevenue += $empTotal;
                    $totalCash += $empCash;
                    $totalCard += $empCard;
                    $totalBonus += $empBonus;
                    $lines[] = "🟢 {$safeName} ({$shiftLabel}, {$checkin['location_code']}): *" . number_format($empTotal, 0, '.', ' ') . " ₽* (нал: " . number_format($empCash, 0, '.', ' ') . " / б/нал: " . number_format($empCard, 0, '.', ' ') . ")";
                } else {
                    $lines[] = "🟡 {$safeName} ({$shiftLabel}, {$checkin['location_code']}) — нет продаж";
                }
            }
        }
    }

    $lines[] = "\n─────────────────";
    $lines[] = '💵 Итог дня: *' . number_format($totalRevenue, 0, '.', ' ') . ' ₽*';
    $lines[] = '🎁 Премия: *' . number_format($totalBonus, 0, '.', ' ') . ' ₽*';
    $lines[] = '💵 Наличные: *' . number_format($totalCash, 0, '.', ' ') . ' ₽*';
    $lines[] = '💳 Безналичные: *' . number_format($totalCard, 0, '.', ' ') . ' ₽*';

    return implode("\n", $lines);
}

function sendBroadcastToStaffForOrg(AppDb $db, array $config, string $organizationId, string $text, string $targetRole = 'all'): array {
    $cfg = getTelegramSettingsForOrg($db, $config, $organizationId);
    if (empty($cfg['botToken'])) {
        return ['success' => true, 'deliveredCount' => 0, 'staffCount' => 0];
    }

    // Sync recent chat IDs from Telegram getUpdates
    $knownChats = [];
    $updRes = httpJsonRequest('GET', 'https://api.telegram.org/bot' . urlencode($cfg['botToken']) . '/getUpdates?timeout=1');
    if ($updRes['ok'] && !empty($updRes['data']['ok']) && is_array($updRes['data']['result'] ?? null)) {
        foreach ($updRes['data']['result'] as $upd) {
            $msg = $upd['message'] ?? $upd['edited_message'] ?? $upd['channel_post'] ?? null;
            if (!$msg) continue;
            $chatId = $msg['chat']['id'] ?? null;
            if (!$chatId) continue;
            if (!empty($msg['from']['username'])) {
                $knownChats[strtolower(ltrim(trim($msg['from']['username']), '@'))] = (string)$chatId;
            }
            if (!empty($msg['chat']['username'])) {
                $knownChats[strtolower(ltrim(trim($msg['chat']['username']), '@'))] = (string)$chatId;
            }
        }
    }

    $query = "SELECT id, name, telegram_username FROM users WHERE active_organization_id = ? AND role = 'employee' AND status = 'active' AND telegram_username IS NOT NULL AND TRIM(telegram_username) != ''";
    if ($targetRole === 'standard') {
        $query .= ' AND is_part_time = 0';
    } elseif ($targetRole === 'part_time') {
        $query .= ' AND is_part_time = 1';
    }

    $staff = $db->queryAll($query, [$organizationId]);
    $delivered = 0;
    $sentChats = [];

    foreach ($staff as $emp) {
        $raw = trim((string)$emp['telegram_username']);
        if ($raw === '') continue;
        if (preg_match('/^-?\d+$/', $raw)) {
            $target = $raw;
        } else {
            $clean = strtolower(ltrim($raw, '@'));
            $target = $knownChats[$clean] ?? ('@' . $clean);
        }
        if (isset($sentChats[$target])) continue;
        $sentChats[$target] = true;
        $sendRes = sendTelegramWithToken($text, $cfg['botToken'], $target);
        if (!empty($sendRes['success'])) {
            $delivered++;
        }
    }

    if (!empty($cfg['managerChatId']) && !isset($sentChats[$cfg['managerChatId']])) {
        sendTelegramWithToken($text, $cfg['botToken'], $cfg['managerChatId']);
    }

    return [
        'success' => true,
        'deliveredCount' => $delivered,
        'staffCount' => count($staff),
    ];
}

function runScheduledMaintenance(AppDb $db, array $config, bool $runCronTasks = false): void {
    try {
        $db->execute('DELETE FROM sessions WHERE expires_at < ?', [nowIso()]);
        $db->execute('DELETE FROM rate_limits WHERE reset_at < ?', [time()]);

        $subs = $db->queryAll(
            "SELECT id, organization_id, status, trial_started_at, trial_ends_at, current_period_end, trial_day4_notified_at
             FROM subscriptions WHERE status IN ('trial', 'active')"
        );
        $now = new DateTimeImmutable('now', new DateTimeZone('UTC'));
        foreach ($subs as $row) {
            if (($row['status'] === 'trial' && !empty($row['trial_ends_at']) && new DateTimeImmutable($row['trial_ends_at']) <= $now) ||
                ($row['status'] === 'active' && !empty($row['current_period_end']) && new DateTimeImmutable($row['current_period_end']) <= $now)) {
                getOrganizationSubscription($db, $row['organization_id']);
                continue;
            }
            if ($row['status'] === 'trial' && empty($row['trial_day4_notified_at']) && !empty($row['trial_started_at'])) {
                $started = new DateTimeImmutable($row['trial_started_at']);
                if (($now->getTimestamp() - $started->getTimestamp()) >= 3 * 86400) {
                    $db->execute(
                        'UPDATE subscriptions SET trial_day4_notified_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND trial_day4_notified_at IS NULL',
                        [nowIso(), $row['id']]
                    );
                    notifyOrgManagers(
                        $db,
                        $row['organization_id'],
                        'Пробный период подходит к концу',
                        'До завершения бесплатного 7-дневного периода осталось менее 4 дней (до ' . formatDateRu($row['trial_ends_at'] ?? null) . '). Выберите тариф, чтобы сохранить непрерывный доступ.'
                    );
                }
            }
        }

        if ($runCronTasks) {
            $msk = getMoscowTimeParts();
            $timeStr = $msk['timeStr'];
            $dateStr = $msk['dateStr'];
            $rules = $db->queryAll(
                'SELECT id, organization_id, title, text, schedule_type, time_of_day, target_role
                 FROM scheduled_notifications WHERE time_of_day = ? AND is_active = 1 AND organization_id IS NOT NULL',
                [$timeStr]
            );
            foreach ($rules as $rule) {
                $orgId = $rule['organization_id'];
                $markerKey = "cron_notif_{$rule['id']}_{$dateStr}";
                $already = getOrgSetting($db, $orgId, $markerKey, null);
                if ($already) continue;
                setOrgSetting($db, $orgId, $markerKey, ['sentAt' => nowIso()]);

                $uSql = "SELECT id FROM users WHERE active_organization_id = ? AND role = 'employee' AND status = 'active'";
                if ($rule['target_role'] === 'standard') $uSql .= ' AND is_part_time = 0';
                elseif ($rule['target_role'] === 'part_time') $uSql .= ' AND is_part_time = 1';
                $emps = $db->queryAll($uSql, [$orgId]);
                foreach ($emps as $emp) {
                    $db->execute(
                        "INSERT INTO notifications (id, organization_id, user_id, title, text, type, source) VALUES (?, ?, ?, ?, ?, 'system', 'scheduler')",
                        ['notif-' . uuidv4(), $orgId, $emp['id'], $rule['title'], $rule['text']]
                    );
                }
                $targetLabel = $rule['target_role'] === 'all' ? 'Все сотрудники' : ($rule['target_role'] === 'standard' ? 'Штатный персонал' : 'Подработчики');
                $tgMsg = "*{$rule['title']}*\n\n{$rule['text']}\n\n─────────────────\nПолучатели: {$targetLabel}\nВремя: {$rule['time_of_day']} МСК";
                $bRes = sendBroadcastToStaffForOrg($db, $config, $orgId, $tgMsg, $rule['target_role']);
                $db->execute(
                    'INSERT INTO bot_logs (id, organization_id, action, initiated_by, status, details) VALUES (?, ?, ?, ?, ?, ?)',
                    [
                        'rst-' . uuidv4(),
                        $orgId,
                        'scheduled_broadcast',
                        'Планировщик',
                        !empty($bRes['success']) ? 'success' : 'error',
                        "Рассылка \"{$rule['title']}\" ({$targetLabel}, доставлено: " . (int)($bRes['deliveredCount'] ?? 0) . " сотрудн.).",
                    ]
                );
            }
        }
    } catch (Throwable $e) {
        // Non-blocking
    }
}
