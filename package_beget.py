import os
import shutil
import zipfile
import subprocess


def clean_build_artifacts():
    print("Cleaning old build artifacts and caches...")
    for path in ["dist", "dev-dist", "site_beget.zip", "public/site_beget.zip", "public/beget_deploy.tar.gz", "beget_deploy.tar.gz"]:
        if os.path.isdir(path):
            shutil.rmtree(path, ignore_errors=True)
        elif os.path.isfile(path):
            try:
                os.remove(path)
            except OSError:
                pass


def build_project():
    clean_build_artifacts()
    print("Running npm run build...")
    subprocess.run(["npm", "run", "build"], check=True)


def create_zip():
    zip_path = "site_beget.zip"
    print(f"Packaging files into {zip_path}...")

    if not os.path.isdir("dist"):
        raise RuntimeError("dist directory does not exist after npm run build")

    # Ensure latest root .htaccess and api.php exist
    if os.path.exists(".htaccess"):
        shutil.copy2(".htaccess", "dist/.htaccess")
    elif os.path.exists("public/.htaccess"):
        shutil.copy2("public/.htaccess", "dist/.htaccess")

    if not os.path.exists("api.php"):
        raise RuntimeError("api.php is missing")

    if not os.path.isdir("php_api"):
        raise RuntimeError("php_api directory is missing")

    # Never package runtime DBs, local secrets, or backup archives
    exclude_files = {
        "pvz_database.json",
        "db.json",
        "config.php",
        ".env",
        ".env.local",
        ".git",
        "site_beget.zip",
        "beget_deploy.tar.gz",
    }

    instruction_text = """=============================================================
  ИНСТРУКЦИЯ ПО РАЗВЕРТЫВАНИЮ SKLADIN НА ХОСТИНГЕ BEGET (PHP)
=============================================================

Архив содержит готовую продакшн-сборку (React SPA + PHP 8.1+ API Engine).
Ни Node.js, ни сторонний сервер не требуются — достаточно обычного
виртуального PHP-хостинга Бегет.

ШАГ 1. ЗАГРУЗКА И РАСПАКОВКА
1. Войдите в панель управления Бегет -> «Файловый менеджер».
2. Откройте корневую папку вашего сайта:
   /ваш_логин/ваш_домен/public_html/
3. Загрузите архив site_beget.zip и распакуйте его в public_html
   (в корне public_html должны оказаться index.html, api.php, .htaccess,
   папки assets/ и php_api/).
4. В разделе «Сайты» панели Бегет выберите версию PHP 8.1, 8.2 или 8.3.

ШАГ 2. БАЗА ДАННЫХ (SQLITE ИЗ КОРОБКИ ИЛИ MYSQL)
- Вариант А — SQLite (рекомендуется для быстрого старта, по умолчанию):
  Ничего настраивать не нужно. При первом открытии сайта PHP-бэкенд
  автоматически создаст защищённую папку /data/.htaccess и базу
  /data/skladin.sqlite со всеми таблицами.
- Вариант Б — MySQL в панели Бегет:
  1. Создайте базу MySQL в панели Бегет (раздел «MySQL»).
  2. Переименуйте config.example.php -> config.php.
  3. Укажите 'db_driver' => 'mysql' и заполните блок 'mysql'
     (host, dbname, user, password). Таблицы создадутся автоматически.

ШАГ 3. ПОЧТА / TELEGRAM / ЮKASSA (ПО ЖЕЛАНИЮ)
- Переименуйте config.example.php в config.php (если ещё не сделали).
- Telegram-бота и Chat ID можно привязать прямо в ЛК руководителя
  (раздел «Автоматизация» -> «Настройка Telegram»).
- Для онлайн-оплаты картой/СБП укажите yookassa_shop_id и
  yookassa_secret_key в config.php, а вебхук ЮKassa направьте на:
  https://ваш-домен.ru/api/v1/billing/webhooks/yookassa

ШАГ 4. АВТОЗАДАЧИ ПО РАСПИСАНИЮ (CRON БЕГЕТ, ПО ЖЕЛАНИЮ)
Чтобы срабатывали отложенные рассылки и проверки подписок точно по времени:
1. Задайте 'cron_secret' => 'случайная_строка' в config.php.
2. В разделе «Crontab» панели Бегет добавьте задачу (каждую минуту * * * * *):
   curl -fsS "https://ваш-домен.ru/api/v1/cron/tick?key=случайная_строка" >/dev/null 2>&1

ОБНОВЛЕНИЕ САЙТА В БУДУЩЕМ:
- Не загружайте и не перезаписывайте файл config.php и папку data/.
- База данных и настройки останутся в полной сохранности.
"""

    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zipf:
        # 1. Frontend dist/ -> archive root
        for root, dirs, files in os.walk("dist"):
            dirs[:] = [d for d in dirs if d not in ("data", ".git", "__pycache__")]
            for file in files:
                if (
                    file in exclude_files
                    or file.endswith(".sqlite")
                    or file.endswith(".db")
                    or file.endswith(".tar.gz")
                    or file.endswith(".zip")
                ):
                    continue
                file_path = os.path.join(root, file)
                archive_name = os.path.relpath(file_path, "dist")
                zipf.write(file_path, archive_name)

        # 2. PHP entry point
        zipf.write("api.php", "api.php")

        # 3. PHP API modules (including php_api/.htaccess)
        for root, dirs, files in os.walk("php_api"):
            dirs[:] = [d for d in dirs if d != "__pycache__"]
            for file in files:
                if file.endswith(".pyc") or file.endswith("~"):
                    continue
                file_path = os.path.join(root, file)
                archive_name = os.path.relpath(file_path, ".")
                zipf.write(file_path, archive_name)

        # 4. Sanitized config template (NEVER live config.php)
        if os.path.exists("config.example.php"):
            zipf.write("config.example.php", "config.example.php")

        # 5. Deployment instruction & docs
        zipf.writestr("ИНСТРУКЦИЯ_БЕГЕТ.txt", instruction_text.encode("utf-8"))
        if os.path.exists("ИНФО-ПРОЕКТА.md"):
            zipf.write("ИНФО-ПРОЕКТА.md", "ИНФО-ПРОЕКТА.md")

    size = os.path.getsize(zip_path)
    print(f"Built clean final {zip_path} ({size} bytes)")


if __name__ == "__main__":
    build_project()
    create_zip()
