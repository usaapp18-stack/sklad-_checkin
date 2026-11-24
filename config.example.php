<?php
if (!defined('PVZ_APP')) {
    http_response_code(403);
    exit('Direct access prohibited.');
}

return [
    // Драйвер БД: 'sqlite' (работает сразу на Бегет без создания БД) или 'mysql'
    'db_driver' => 'sqlite',
    'sqlite_path' => __DIR__ . '/data/skladin.sqlite',

    // Настройки MySQL (используются только при db_driver === 'mysql')
    'mysql' => [
        'host' => 'localhost',
        'port' => 3306,
        'dbname' => '',
        'user' => '',
        'password' => '',
    ],

    // Опциональный пароль для начального администратора (+79266137222).
    // Новые руководители всегда могут зарегистрироваться через /register.
    'initial_admin_password' => '',

    // Интеграция с Telegram (можно настроить позже в ЛК руководителя)
    'telegram_bot_token' => '',
    'telegram_manager_chat_id' => '',

    // Платёжный шлюз ЮKassa (опционально, для онлайн-оплаты картой и СБП)
    'yookassa_shop_id' => '',
    'yookassa_secret_key' => '',
    'yookassa_webhook_secret' => '',

    // Контакты и аналитика публичной витрины (опционально)
    'contact_email' => '',
    'contact_phone' => '',
    'contact_telegram' => '',
    'company_name' => 'SKLADIN',
    'yandex_metrika_id' => '',

    // Секретный ключ для запуска автозадач по расписанию через Cron Бегет
    'cron_secret' => '',
];
