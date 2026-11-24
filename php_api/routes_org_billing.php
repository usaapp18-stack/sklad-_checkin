<?php
if (!defined('PVZ_APP')) {
    http_response_code(403);
    exit('Direct access prohibited.');
}

function handleOrganizationRoutes(AppDb $db, array $config, string $method, string $subRoute, ?array $currentUser): void {
    // GET /organization
    if ($method === 'GET' && $subRoute === '') {
        $u = requireAuth($currentUser);
        $orgId = $u['organizationId'] ?? null;
        if (!$orgId) {
            jsonResponse([
                'success' => true,
                'organization' => null,
                'subscription' => null,
                'usage' => ['locationsCount' => 0, 'staffCount' => 0],
            ]);
        }
        $organization = getOrganizationById($db, $orgId);
        $subscription = getOrganizationSubscription($db, $orgId);
        $usage = getOrganizationUsage($db, $orgId);
        jsonResponse([
            'success' => true,
            'organization' => $organization,
            'subscription' => $subscription,
            'usage' => $usage,
        ]);
    }

    // POST /organization
    if ($method === 'POST' && $subRoute === '') {
        $u = requireManager($currentUser);
        if (!empty($u['organizationId'])) {
            jsonError('ORGANIZATION_EXISTS', 'Организация уже создана для вашей учётной записи', 409);
        }

        $body = getRequestJson();
        $name = trim((string)($body['name'] ?? ''));
        if (mb_strlen($name) < 2 || mb_strlen($name) > 120) {
            jsonError('VALIDATION_ERROR', 'Укажите название организации (от 2 до 120 символов)', 400);
        }
        $inn = isset($body['inn']) ? mb_substr(trim((string)$body['inn']), 0, 20) : null;
        $timezone = !empty($body['timezone']) ? mb_substr(trim((string)$body['timezone']), 0, 64) : 'Europe/Moscow';
        $selectedPlan = $body['selectedPlan'] ?? null;
        $selectedPeriod = $body['selectedPeriod'] ?? 1;

        $res = createOrganizationWithTrial($db, [
            'ownerUserId' => $u['id'],
            'name' => $name,
            'inn' => $inn,
            'timezone' => $timezone,
            'selectedTariffId' => isValidTariffId($selectedPlan) ? $selectedPlan : 'business',
            'selectedPeriodMonths' => normalizeBillingPeriod($selectedPeriod),
        ]);

        logAudit(
            $db,
            $u,
            $u['id'],
            'CREATE_ORGANIZATION',
            'organization',
            $res['organization']['id'],
            ['name' => $res['organization']['name'], 'trialEndsAt' => $res['subscription']['trialEndsAt'] ?? null],
            $res['organization']['id']
        );

        jsonResponse([
            'success' => true,
            'organization' => $res['organization'],
            'subscription' => $res['subscription'],
            'usage' => ['locationsCount' => 0, 'staffCount' => 0],
        ], 201);
    }

    // PATCH /organization
    if ($method === 'PATCH' && $subRoute === '') {
        $u = requireManager($currentUser);
        $u = requireOrganization($u);
        $orgId = $u['organizationId'];
        $body = getRequestJson();

        $updates = ['updated_at = CURRENT_TIMESTAMP'];
        $params = [];

        if (array_key_exists('name', $body)) {
            $name = trim((string)$body['name']);
            if (mb_strlen($name) < 2 || mb_strlen($name) > 120) {
                jsonError('VALIDATION_ERROR', 'Укажите название организации (от 2 до 120 символов)', 400);
            }
            $updates[] = 'name = ?';
            $params[] = $name;
        }
        if (array_key_exists('inn', $body)) {
            $inn = trim((string)$body['inn']);
            if (mb_strlen($inn) > 20) {
                jsonError('VALIDATION_ERROR', 'Некорректная длина ИНН', 400);
            }
            $updates[] = 'inn = ?';
            $params[] = $inn !== '' ? $inn : null;
        }
        if (array_key_exists('timezone', $body)) {
            $tz = trim((string)$body['timezone']);
            $updates[] = 'timezone = ?';
            $params[] = $tz !== '' ? mb_substr($tz, 0, 64) : 'Europe/Moscow';
        }

        $params[] = $orgId;
        $db->execute('UPDATE organizations SET ' . implode(', ', $updates) . ' WHERE id = ?', $params);

        $organization = getOrganizationById($db, $orgId);
        logAudit($db, $u, $u['id'], 'UPDATE_ORGANIZATION', 'organization', $orgId, [
            'name' => $body['name'] ?? null,
            'inn' => $body['inn'] ?? null,
            'timezone' => $body['timezone'] ?? null,
        ]);

        jsonResponse(['success' => true, 'organization' => $organization]);
    }

    // GET /organization/usage
    if ($method === 'GET' && $subRoute === 'usage') {
        $u = requireOrganization($currentUser);
        $orgId = $u['organizationId'];
        $usage = getOrganizationUsage($db, $orgId);
        $sub = getOrganizationSubscription($db, $orgId);
        jsonResponse([
            'success' => true,
            'usage' => [
                'locationsCount' => $usage['locationsCount'],
                'staffCount' => $usage['staffCount'],
                'maxLocations' => $sub['maxLocations'] ?? 1,
                'maxStaff' => $sub['maxStaff'] ?? 2,
                'tariffId' => $sub['tariffId'] ?? 'start',
                'tariffName' => $sub['tariffName'] ?? 'Старт',
            ],
        ]);
    }

    jsonError('NOT_FOUND', 'Маршрут организации не найден', 404);
}

function handleBillingRoutes(AppDb $db, array $config, string $method, string $subRoute, ?array $currentUser): void {
    // GET /billing/plans
    if ($method === 'GET' && $subRoute === 'plans') {
        jsonResponse([
            'success' => true,
            'plans' => getTariffPlans(),
            'periods' => getBillingPeriods(),
            'providers' => getPaymentProvidersStatus($config),
        ]);
    }

    // GET /billing/subscription
    if ($method === 'GET' && $subRoute === 'subscription') {
        $u = requireOrganization($currentUser);
        $orgId = $u['organizationId'];
        jsonResponse([
            'success' => true,
            'subscription' => getOrganizationSubscription($db, $orgId),
            'usage' => getOrganizationUsage($db, $orgId),
            'payments' => listOrganizationPayments($db, $orgId),
            'providers' => getPaymentProvidersStatus($config),
        ]);
    }

    // POST /billing/select-hint
    if ($method === 'POST' && $subRoute === 'select-hint') {
        $u = requireManager($currentUser);
        $u = requireOrganization($u);
        $orgId = $u['organizationId'];
        $body = getRequestJson();
        $tariffId = $body['tariffId'] ?? null;
        if (!isValidTariffId($tariffId)) {
            jsonError('VALIDATION_ERROR', 'Некорректный тариф', 400);
        }
        $cleanPeriod = normalizeBillingPeriod($body['periodMonths'] ?? 1);
        $db->execute(
            'UPDATE subscriptions SET selected_tariff_id = ?, selected_period_months = ?, updated_at = CURRENT_TIMESTAMP WHERE organization_id = ?',
            [$tariffId, $cleanPeriod, $orgId]
        );
        jsonResponse([
            'success' => true,
            'subscription' => getOrganizationSubscription($db, $orgId),
        ]);
    }

    // POST /billing/checkout
    if ($method === 'POST' && $subRoute === 'checkout') {
        $u = requireManager($currentUser);
        $u = requireOrganization($u);
        $orgId = $u['organizationId'];
        $orgName = $u['organization']['name'] ?? 'Организация SKLADIN';
        $body = getRequestJson();

        $tariffId = $body['tariffId'] ?? '';
        $periodMonths = (int)($body['periodMonths'] ?? 0);
        $paymentMethod = $body['paymentMethod'] ?? '';

        if (!isValidTariffId($tariffId) || !in_array($periodMonths, [1, 3, 6, 12], true) || !in_array($paymentMethod, ['card', 'sbp', 'invoice', 'yandex_split'], true)) {
            jsonError('VALIDATION_ERROR', 'Некорректные параметры оплаты', 400);
        }

        $downgradeCheck = validateTariffDowngrade($db, $orgId, $tariffId);
        if (!$downgradeCheck['allowed']) {
            jsonError('DOWNGRADE_BLOCKED', $downgradeCheck['reason'], 400);
        }

        if ($paymentMethod === 'yandex_split') {
            jsonError('PROVIDER_NOT_CONFIGURED', 'Оплата через Яндекс Сплит не подключена (отсутствуют настройки мерчанта Яндекс Пэй). Выберите другой способ оплаты.', 503);
        }

        $calc = calculateTariffPrice($tariffId, $periodMonths);
        $tariff = getTariffById($tariffId);

        if ($paymentMethod === 'invoice') {
            $paymentId = 'pay-' . uuidv4();
            $todayCompact = gmdate('Ymd');
            $invoiceNumber = 'СЧ-' . $todayCompact . '-' . strtoupper(substr($paymentId, -4));
            $reqBody = is_array($body['companyRequisites'] ?? null) ? $body['companyRequisites'] : [];
            $reqPayload = [
                'companyName' => mb_substr(trim((string)($reqBody['companyName'] ?? $orgName)), 0, 180) ?: $orgName,
                'inn' => mb_substr(trim((string)($reqBody['inn'] ?? '')), 0, 20),
                'kpp' => mb_substr(trim((string)($reqBody['kpp'] ?? '')), 0, 20),
                'address' => mb_substr(trim((string)($reqBody['address'] ?? '')), 0, 300),
            ];

            $db->execute(
                "INSERT INTO payments (
                    id, organization_id, user_id, tariff_id, period_months, discount_percent,
                    amount_rub, payment_method, provider, status, invoice_number, company_requisites, metadata
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, 'invoice', 'manual_invoice', 'pending', ?, ?, ?)",
                [
                    $paymentId,
                    $orgId,
                    $u['id'],
                    $calc['tariffId'],
                    $calc['months'],
                    $calc['discountPercent'],
                    $calc['finalPriceRub'],
                    $invoiceNumber,
                    json_encode($reqPayload, JSON_UNESCAPED_UNICODE),
                    json_encode(['tariffName' => $tariff['name'], 'note' => 'Awaiting bank settlement confirmation'], JSON_UNESCAPED_UNICODE),
                ]
            );

            $paymentOut = [
                'id' => $paymentId,
                'tariffId' => $calc['tariffId'],
                'periodMonths' => $calc['months'],
                'discountPercent' => $calc['discountPercent'],
                'amountRub' => $calc['finalPriceRub'],
                'paymentMethod' => 'invoice',
                'provider' => 'manual_invoice',
                'status' => 'pending',
                'invoiceNumber' => $invoiceNumber,
                'companyRequisites' => $reqPayload,
                'createdAt' => nowIso(),
            ];

            logAudit($db, $u, $u['id'], 'CREATE_CHECKOUT', 'payment', $paymentId, [
                'tariffId' => $tariffId,
                'periodMonths' => $periodMonths,
                'paymentMethod' => $paymentMethod,
                'amountRub' => $calc['finalPriceRub'],
            ]);

            jsonResponse(['success' => true, 'payment' => $paymentOut], 201);
        }

        // card / sbp via YooKassa v3 API
        $shopId = trim((string)($config['yookassa_shop_id'] ?? ''));
        $secretKey = trim((string)($config['yookassa_secret_key'] ?? ''));
        if ($shopId === '' || $secretKey === '') {
            $msg = $paymentMethod === 'sbp'
                ? 'Оплата через СБП временно недоступна: не настроены реквизиты платёжного провайдера (ЮKassa / СБП). Вы можете сформировать счёт на оплату.'
                : 'Онлайн-оплата картой не подключена: не заданы ключи платёжного провайдера ЮKassa в config.php. Вы можете сформировать счёт на оплату.';
            jsonError('PROVIDER_NOT_CONFIGURED', $msg, 503);
        }

        $paymentId = 'pay-' . uuidv4();
        $idempotenceKey = uuidv4();
        $authHeader = 'Basic ' . base64_encode($shopId . ':' . $secretKey);
        $amountFormatted = number_format((float)$calc['finalPriceRub'], 2, '.', '');

        $defaultReturn = getBaseUrl() . '/app?billing=return';
        $returnUrl = $defaultReturn;
        if (!empty($body['returnUrl']) && is_string($body['returnUrl'])) {
            $candidate = trim($body['returnUrl']);
            $p = parse_url($candidate);
            $curHost = explode(':', $_SERVER['HTTP_HOST'] ?? '')[0];
            if (!empty($p['scheme']) && in_array(strtolower($p['scheme']), ['http', 'https'], true) && !empty($p['host']) && strcasecmp($p['host'], $curHost) === 0) {
                $returnUrl = $candidate;
            }
        }

        $payload = [
            'amount' => [
                'value' => $amountFormatted,
                'currency' => 'RUB',
            ],
            'capture' => true,
            'confirmation' => [
                'type' => 'redirect',
                'return_url' => $returnUrl,
            ],
            'description' => "SKLADIN: тариф «{$tariff['name']}» на {$calc['months']} мес. ({$orgName})",
            'metadata' => [
                'internal_payment_id' => $paymentId,
                'organization_id' => $orgId,
                'tariff_id' => $calc['tariffId'],
                'period_months' => (string)$calc['months'],
            ],
            'payment_method_data' => [
                'type' => $paymentMethod === 'sbp' ? 'sbp' : 'bank_card',
            ],
        ];

        $res = httpJsonRequest('POST', 'https://api.yookassa.ru/v3/payments', $payload, [
            'Authorization' => $authHeader,
            'Idempotence-Key' => $idempotenceKey,
            'Content-Type' => 'application/json',
        ]);

        $data = $res['data'];
        if (!$res['ok'] || empty($data['id'])) {
            $desc = is_array($data) ? ($data['description'] ?? null) : null;
            jsonError('PROVIDER_ERROR', $desc ?: 'Платёжный шлюз отклонил создание платежа. Попробуйте позже.', 502);
        }

        $confirmationUrl = $data['confirmation']['confirmation_url'] ?? null;
        $providerPaymentId = (string)$data['id'];

        $db->execute(
            "INSERT INTO payments (
                id, organization_id, user_id, tariff_id, period_months, discount_percent,
                amount_rub, payment_method, provider, provider_payment_id, status, confirmation_url, metadata
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'yookassa', ?, 'pending', ?, ?)",
            [
                $paymentId,
                $orgId,
                $u['id'],
                $calc['tariffId'],
                $calc['months'],
                $calc['discountPercent'],
                $calc['finalPriceRub'],
                $paymentMethod,
                $providerPaymentId,
                $confirmationUrl,
                json_encode(['idempotenceKey' => $idempotenceKey]),
            ]
        );

        $paymentOut = [
            'id' => $paymentId,
            'tariffId' => $calc['tariffId'],
            'periodMonths' => $calc['months'],
            'discountPercent' => $calc['discountPercent'],
            'amountRub' => $calc['finalPriceRub'],
            'paymentMethod' => $paymentMethod,
            'provider' => 'yookassa',
            'status' => 'pending',
            'confirmationUrl' => $confirmationUrl,
            'createdAt' => nowIso(),
        ];

        logAudit($db, $u, $u['id'], 'CREATE_CHECKOUT', 'payment', $paymentId, [
            'tariffId' => $tariffId,
            'periodMonths' => $periodMonths,
            'paymentMethod' => $paymentMethod,
            'amountRub' => $calc['finalPriceRub'],
        ]);

        jsonResponse(['success' => true, 'payment' => $paymentOut], 201);
    }

    // POST /billing/webhooks/yookassa
    if ($method === 'POST' && $subRoute === 'webhooks/yookassa') {
        $shopId = trim((string)($config['yookassa_shop_id'] ?? ''));
        $secretKey = trim((string)($config['yookassa_secret_key'] ?? ''));
        $configuredWebhookSecret = trim((string)($config['yookassa_webhook_secret'] ?? ''));

        if ($shopId === '' || $secretKey === '') {
            jsonResponse(['success' => false, 'message' => 'YooKassa credentials are not configured'], 503);
        }

        if ($configuredWebhookSecret !== '') {
            $token = getHeader('x-yookassa-webhook-token') ?? ($_GET['token'] ?? '');
            if (!is_string($token) || $token === '' || !hash_equals($configuredWebhookSecret, $token)) {
                jsonResponse(['success' => false, 'message' => 'Invalid webhook secret'], 403);
            }
        }

        $body = getRequestJson();
        $eventType = (string)($body['event'] ?? '');
        $providerPaymentId = (string)($body['object']['id'] ?? '');
        if ($eventType === '' || $providerPaymentId === '') {
            jsonResponse(['success' => false, 'message' => 'Invalid webhook payload'], 400);
        }

        $externalEventId = "yk:{$eventType}:{$providerPaymentId}";
        $dup = $db->queryOne('SELECT id FROM payment_events WHERE external_event_id = ?', [$externalEventId]);
        if ($dup) {
            jsonResponse(['success' => true, 'message' => 'Duplicate event ignored'], 200);
        }

        $authHeader = 'Basic ' . base64_encode($shopId . ':' . $secretKey);
        $verifyRes = httpJsonRequest('GET', 'https://api.yookassa.ru/v3/payments/' . rawurlencode($providerPaymentId), null, [
            'Authorization' => $authHeader,
        ]);

        $verifiedPayment = $verifyRes['ok'] ? $verifyRes['data'] : null;
        $signatureValid = is_array($verifiedPayment) && ($verifiedPayment['id'] ?? '') === $providerPaymentId;

        $localPayment = $db->queryOne(
            'SELECT id, organization_id, user_id, tariff_id, period_months, amount_rub, status FROM payments WHERE provider_payment_id = ?',
            [$providerPaymentId]
        );

        $db->execute(
            "INSERT INTO payment_events (id, provider, external_event_id, payment_id, event_type, payload_json, signature_valid)
             VALUES (?, 'yookassa', ?, ?, ?, ?, ?)",
            [
                'pevt-' . uuidv4(),
                $externalEventId,
                $localPayment['id'] ?? null,
                $eventType,
                json_encode($body, JSON_UNESCAPED_UNICODE),
                $signatureValid ? 1 : 0,
            ]
        );

        if (!$signatureValid || !$localPayment) {
            jsonResponse(['success' => false, 'message' => 'Payment verification failed or unknown payment'], 400);
        }

        $remoteStatus = (string)($verifiedPayment['status'] ?? '');
        $remoteAmount = (float)($verifiedPayment['amount']['value'] ?? 0);
        $expectedAmount = (float)($localPayment['amount_rub'] ?? 0);

        if ($remoteStatus === 'succeeded' && abs($remoteAmount - $expectedAmount) < 0.01) {
            if ($localPayment['status'] !== 'succeeded') {
                $paidAt = nowIso();
                $db->execute(
                    "UPDATE payments SET status = 'succeeded', paid_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                    [$paidAt, $localPayment['id']]
                );
                activatePaidSubscription(
                    $db,
                    $localPayment['organization_id'],
                    isValidTariffId($localPayment['tariff_id']) ? $localPayment['tariff_id'] : 'business',
                    normalizeBillingPeriod($localPayment['period_months'] ?? 1),
                    $localPayment['user_id'] ?? null,
                    'YOOKASSA_PAYMENT_' . $localPayment['id']
                );
            }
        } elseif ($remoteStatus === 'canceled') {
            $db->execute(
                "UPDATE payments SET status = 'canceled', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'",
                [$localPayment['id']]
            );
        }

        jsonResponse(['success' => true, 'message' => 'Webhook processed'], 200);
    }

    jsonError('NOT_FOUND', 'Маршрут биллинга не найден', 404);
}

function handlePublicRoutes(AppDb $db, array $config, string $method, string $subRoute): void {
    // GET /public/config
    if ($method === 'GET' && $subRoute === 'config') {
        $email = trim((string)($config['contact_email'] ?? ''));
        $phone = trim((string)($config['contact_phone'] ?? ''));
        $tg = trim((string)($config['contact_telegram'] ?? ''));
        $company = trim((string)($config['company_name'] ?? 'SKLADIN')) ?: 'SKLADIN';
        $metrika = trim((string)($config['yandex_metrika_id'] ?? ''));

        jsonResponse([
            'success' => true,
            'config' => [
                'brandName' => 'SKLADIN',
                'contactEmail' => $email,
                'contactPhone' => $phone,
                'contactTelegram' => $tg,
                'legalEntityName' => $company,
                'yandexMetrikaId' => $metrika,
                'hasRealContacts' => ($email !== '' || $phone !== '' || $tg !== ''),
            ],
        ]);
    }

    // POST /public/contact
    if ($method === 'POST' && $subRoute === 'contact') {
        checkRateLimit($db, 'public_contact', 6, 900, 'Слишком много обращений с одного адреса. Попробуйте через {mins} мин.');
        $body = getRequestJson();

        $name = trim((string)($body['name'] ?? ''));
        $contact = trim((string)($body['contact'] ?? ''));
        $topic = trim((string)($body['topic'] ?? ''));
        $message = trim((string)($body['message'] ?? ''));
        $acceptPrivacy = $body['acceptPrivacy'] ?? false;
        $website = trim((string)($body['website'] ?? ''));

        if (mb_strlen($name) < 2 || mb_strlen($name) > 150) {
            jsonError('VALIDATION_ERROR', 'Укажите ваше имя', 400);
        }
        if (mb_strlen($contact) < 3 || mb_strlen($contact) > 150) {
            jsonError('VALIDATION_ERROR', 'Укажите телефон, Email или Telegram', 400);
        }
        if (mb_strlen($topic) < 2 || mb_strlen($topic) > 120) {
            jsonError('VALIDATION_ERROR', 'Выберите тему обращения', 400);
        }
        if (mb_strlen($message) < 5 || mb_strlen($message) > 2000) {
            jsonError('VALIDATION_ERROR', 'Напишите сообщение (минимум 5 символов)', 400);
        }
        if ($acceptPrivacy !== true) {
            jsonError('VALIDATION_ERROR', 'Необходимо согласие на обработку персональных данных', 400);
        }

        // Honeypot spam check
        if ($website !== '') {
            jsonResponse(['success' => true, 'message' => 'Сообщение принято']);
        }

        $id = 'lead-' . uuidv4();
        $ip = getClientIp();

        $db->execute(
            "INSERT INTO contact_leads (id, name, contact, topic, message, consent_accepted, ip, status)
             VALUES (?, ?, ?, ?, ?, 1, ?, 'new')",
            [$id, $name, $contact, $topic, $message, $ip]
        );

        $tgToken = trim((string)($config['telegram_bot_token'] ?? ''));
        $tgChat = trim((string)($config['telegram_manager_chat_id'] ?? ''));
        if ($tgToken !== '' && $tgChat !== '') {
            $msgText = "📩 *Новое обращение с сайта SKLADIN*\n\n"
                . "👤 Имя: *" . escapeTelegramMarkdown($name) . "*\n"
                . "📞 Контакт: *" . escapeTelegramMarkdown($contact) . "*\n"
                . "🏷 Тема: *" . escapeTelegramMarkdown($topic) . "*\n"
                . "💬 Сообщение:\n" . escapeTelegramMarkdown($message);
            sendTelegramWithToken($msgText, $tgToken, $tgChat);
        }

        jsonResponse([
            'success' => true,
            'leadId' => $id,
            'message' => 'Обращение отправлено. Мы ответим по указанному контакту в рабочее время.',
        ], 201);
    }

    // GET /public/robots
    if ($method === 'GET' && $subRoute === 'robots') {
        $baseUrl = getBaseUrl();
        header('Content-Type: text/plain; charset=utf-8');
        echo implode("\n", [
            'User-agent: *',
            'Allow: /',
            'Allow: /features',
            'Allow: /pricing',
            'Allow: /about',
            'Allow: /contacts',
            'Allow: /faq',
            'Allow: /demo',
            'Allow: /privacy',
            'Allow: /terms',
            'Allow: /register',
            'Disallow: /app',
            'Disallow: /app/',
            'Disallow: /api/',
            '',
            "Sitemap: {$baseUrl}/sitemap.xml",
        ]);
        exit;
    }

    // GET /public/sitemap
    if ($method === 'GET' && $subRoute === 'sitemap') {
        $baseUrl = htmlspecialchars(getBaseUrl(), ENT_XML1, 'UTF-8');
        $nowDate = gmdate('Y-m-d');
        $paths = [
            ['path' => '/', 'priority' => '1.0', 'freq' => 'weekly'],
            ['path' => '/features', 'priority' => '0.9', 'freq' => 'weekly'],
            ['path' => '/pricing', 'priority' => '0.9', 'freq' => 'weekly'],
            ['path' => '/demo', 'priority' => '0.8', 'freq' => 'weekly'],
            ['path' => '/register', 'priority' => '0.8', 'freq' => 'monthly'],
            ['path' => '/about', 'priority' => '0.7', 'freq' => 'monthly'],
            ['path' => '/faq', 'priority' => '0.7', 'freq' => 'monthly'],
            ['path' => '/contacts', 'priority' => '0.7', 'freq' => 'monthly'],
            ['path' => '/privacy', 'priority' => '0.3', 'freq' => 'yearly'],
            ['path' => '/terms', 'priority' => '0.3', 'freq' => 'yearly'],
        ];
        $urls = [];
        foreach ($paths as $item) {
            $loc = $baseUrl . ($item['path'] === '/' ? '' : $item['path']);
            $urls[] = "  <url>\n    <loc>{$loc}</loc>\n    <lastmod>{$nowDate}</lastmod>\n    <changefreq>{$item['freq']}</changefreq>\n    <priority>{$item['priority']}</priority>\n  </url>";
        }
        header('Content-Type: application/xml; charset=utf-8');
        echo "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n"
            . implode("\n", $urls)
            . "\n</urlset>";
        exit;
    }

    jsonError('NOT_FOUND', 'Публичный маршрут не найден', 404);
}

function handleHealthRoutes(AppDb $db, array $config, string $method, string $subRoute): void {
    $dbOk = true;
    $dbErr = null;
    try {
        $db->queryOne('SELECT 1');
    } catch (Throwable $e) {
        $dbOk = false;
        $dbErr = 'Database unavailable';
    }
    $engine = $db->driver === 'mysql' ? 'mysql_pdo' : 'sqlite3_pdo';

    if ($method === 'GET' && $subRoute === '') {
        $tgConfigured = !empty($config['telegram_bot_token']);
        jsonResponse([
            'status' => $dbOk ? 'ok' : 'degraded',
            'database' => [
                'status' => $dbOk ? 'ok' : 'error',
                'engine' => $engine,
            ],
            'telegram' => [
                'status' => $tgConfigured ? 'configured' : 'not_configured',
                'managerId' => !empty($config['telegram_manager_chat_id']) ? 'configured' : 'default',
            ],
            'scheduler' => [
                'running' => true,
                'mode' => 'php_cron_and_request_hook',
            ],
            'timestamp' => nowIso(),
        ], $dbOk ? 200 : 503);
    }

    if ($method === 'GET' && $subRoute === 'db') {
        jsonResponse(
            $dbOk ? ['status' => 'ok', 'engine' => $engine] : ['status' => 'error', 'error' => $dbErr],
            $dbOk ? 200 : 503
        );
    }

    if ($method === 'GET' && $subRoute === 'telegram') {
        jsonResponse([
            'configured' => !empty($config['telegram_bot_token']),
            'managerId' => !empty($config['telegram_manager_chat_id']) ? 'configured' : 'not_configured',
        ]);
    }

    jsonError('NOT_FOUND', 'Health маршрут не найден', 404);
}

function handleCronRoutes(AppDb $db, array $config, string $method, string $subRoute): void {
    if (!in_array($method, ['GET', 'POST'], true) || $subRoute !== 'tick') {
        jsonError('NOT_FOUND', 'Cron маршрут не найден', 404);
    }
    $secret = trim((string)($config['cron_secret'] ?? ''));
    if ($secret !== '') {
        $provided = (string)(getHeader('x-cron-key') ?? ($_GET['key'] ?? ''));
        if ($provided === '' || !hash_equals($secret, $provided)) {
            jsonError('FORBIDDEN', 'Неверный ключ планировщика', 403);
        }
    }
    runScheduledMaintenance($db, $config, true);
    jsonResponse(['success' => true, 'timestamp' => nowIso()]);
}
