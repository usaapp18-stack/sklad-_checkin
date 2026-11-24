import os
import shutil
import zipfile
import subprocess

def clean_build_artifacts():
    print("Cleaning old build artifacts and caches...")
    for path in ["dist", "dev-dist", "public/site_beget.zip", "public/beget_deploy.tar.gz", "beget_deploy.tar.gz"]:
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
    
    # Ensure vital files exist and are up to date in dist/ before archiving
    if os.path.exists(".htaccess"):
        shutil.copy(".htaccess", "dist/.htaccess")
    elif os.path.exists("public/.htaccess"):
        shutil.copy("public/.htaccess", "dist/.htaccess")

    if os.path.exists("api.php"):
        shutil.copy("api.php", "dist/api.php")

    # Exclude files that could overwrite database/configs on Beget
    exclude_files = {
        "pvz_database.json",
        "db.json",
        "config.php",
        ".env",
        ".git",
        "site_beget.zip",
        "beget_deploy.tar.gz",
        "push-sw.js"
    }

    instruction_text = """=============================================================
  ИНСТРУКЦИЯ ПО РАЗВЕРТЫВАНИЮ НА ВИРТУАЛЬНОМ ХОСТИНГЕ BEGET
=============================================================

Архив содержит готовую сборку (SPA + PHP API Engine) для вашего сайта на Beget.

ШАГИ УСТАНОВКИ:
1. Войдите в панель управления Beget (beget.com).
2. Перейдите в раздел «Файловый менеджер».
3. Откройте папку вашего сайта:
   /ваш_логин/ваш_домен/public_html/
4. Нажмите «Загрузить файлы» и выберите этот архив (site_beget.zip).
5. Нажмите правой кнопкой мыши по архиву -> «Распаковать».
   Все файлы (index.html, assets, api.php, .htaccess и т.д.) окажутся в public_html.
6. В панели Beget в разделе «Сайты» убедитесь, что для сайта выбрана версия PHP 8.1, 8.2 или 8.3.
7. Если вы запускаете сайт ВПЕРВЫЕ:
   - Переименуйте config.example.php в config.php
   - Telegram-бота и ваш Chat ID можно легко привязать прямо из ЛК руководителя в разделе «Автоматизация» -> «Telegram» (или в config.php).
8. Если вы ОБНОВЛЯЕТЕ существующий сайт:
   - База данных (pvz_database.json) и config.php НЕ перезаписываются!
   - Все ваши ПВЗ, сотрудники, привязка Telegram-бота и история остаются в полной сохранности.

Сайт готов к работе!
"""
    with open("ИНСТРУКЦИЯ_БЕГЕТ.txt", "w", encoding="utf-8") as f:
        f.write(instruction_text)
    
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
        # Add dist directory contents to archive root
        for root, dirs, files in os.walk("dist"):
            for file in files:
                if file in exclude_files or file.endswith(".sqlite") or file.endswith(".db") or file.endswith(".tar.gz") or file.endswith(".zip"):
                    continue
                file_path = os.path.join(root, file)
                archive_name = os.path.relpath(file_path, "dist")
                zipf.write(file_path, archive_name)
        
        # Add instructions and documentation
        if os.path.exists("ИНСТРУКЦИЯ_БЕГЕТ.txt"):
            zipf.write("ИНСТРУКЦИЯ_БЕГЕТ.txt", "ИНСТРУКЦИЯ_БЕГЕТ.txt")
        if os.path.exists("BEGET_DEPLOYMENT_RULES.md"):
            zipf.write("BEGET_DEPLOYMENT_RULES.md", "BEGET_DEPLOYMENT_RULES.md")
        if os.path.exists("ИНФО-ПРОЕКТА.md"):
            zipf.write("ИНФО-ПРОЕКТА.md", "ИНФО-ПРОЕКТА.md")
            
        # Add config.example.php template for new installations without overwriting existing config.php
        if os.path.exists("config.php"):
            zipf.write("config.php", "config.example.php")
            
    print(f"Built clean final site_beget.zip (size: {os.path.getsize(zip_path)} bytes)")

if __name__ == "__main__":
    build_project()
    create_zip()
