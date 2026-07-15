# Продакшн ideav.ru на ISPmanager: что панель не делает сама

Боевой `ideav.ru` работает под ISPmanager (docroot `/var/www/www-root/data/www/ideav.ru/`).
Панель **генерирует vhost сама**, поэтому два блока из `local/files/apache-integram.conf`
(и `docker/apache/integram.conf`) на прод **автоматически не попадают**. Их нужно донести
руками — иначе получаем два разных класса проблем, оба уже наступали.

Оба блока — `<Directory>`/`FallbackResource`/`DirectoryIndex` — это **vhost-уровень**,
в `.htaccess` их не воспроизвести; кроме роутинга (см. ниже), который специально вынесен в
`.htaccess`, потому что панельный vhost его не даёт.

## 1. Маршрутизация БД (фронт-контроллер)

Панельный vhost **не содержит** `FallbackResource /index.php`. Без него все URL баз данных
(`/<db>/<action>`, напр. `/asmoseo/table/42`) не доходят до движка `index.php` → «Invalid
database» на `/` и 404 на `/<db>/...`, весь сайт лежит.

На проде роутинг держится в **веб-корневом `.htaccess`** фронт-контроллером:

```apache
DirectoryIndex index.html
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_FILENAME} !-d
  RewriteRule ^ index.php [L,QSA]
</IfModule>
```

⚠️ Этот `.htaccess` приезжает из билда лендинга (`ideav/backlogram`, `public/.htaccess` → `dist/`)
и **перезаписывает** веб-корневой файл на каждом деплое маркетинга, а `index.php` в тот билд не
входит. Поэтому фронт-контроллер обязан жить в `public/.htaccess` и никогда не сводиться к
headers-only — иначе очередной деплой лендинга снова уронит все БД. История: инцидент
2026-07-15, `ideav/backlogram` PR #423, issue #422.

Эквивалент в vhost (если предпочесть панельные доп.директивы вместо `.htaccess`) —
`FallbackResource /index.php` + `DirectoryIndex index.html start.html index.php`.

## 2. Защита каталогов загрузок от исполнения кода (RCE)

`download/` и `templates/custom/` — это папки, куда `dir_admin` пишет пользовательские файлы.
Загрузка `.php/.asp/.jsp/...` в `dir_admin` блокируется (первый барьер), но на прод-vhost нужен
и второй — Apache-запрет исполнения, как в `apache-integram.conf`.

Проверка по факту (2026-07-15): `templates/` на проде уже отдаёт **403** на прямой доступ
(защита есть). А у `download/` явного Apache-запрета скриптов **нет** — там всё идёт через
app-роутинг, `.php` внешне не исполняется, но defense-in-depth отсутствует.

Добавь в ISPmanager для домена `ideav.ru` **дополнительные директивы Apache** (или включаемый
vhost-фрагмент):

```apache
<Directory /var/www/www-root/data/www/ideav.ru/download>
    Options -ExecCGI
    <FilesMatch "\.(php|php[0-9]*|phps|phtml|pht|phar|cgi|pl|fcgi|fpl|asp|jsp|sh)$">
        Require all denied
    </FilesMatch>
</Directory>
<Directory /var/www/www-root/data/www/ideav.ru/templates/custom>
    Options -ExecCGI
    <FilesMatch "\.(php|php[0-9]*|phps|phtml|pht|phar|cgi|pl|fcgi|fpl|asp|jsp|sh)$">
        Require all denied
    </FilesMatch>
</Directory>
```

После правки: `apache2ctl configtest` → `systemctl reload apache2`.

## Проверка

```bash
# Роутинг БД жив:
curl -s -o /dev/null -w '%{http_code}\n' 'https://ideav.ru/asmoseo/table/42?F_I=145'   # ожид. 200 (таблица)
# Публичные ассеты отдаются, листинг закрыт:
curl -s -o /dev/null -w '%{http_code}\n' 'https://ideav.ru/download/xyz/xyz-analiz.html' # 200
curl -s -o /dev/null -w '%{http_code}\n' 'https://ideav.ru/download/'                     # 403
```

Точный тест исполнения (разово, по SSH, не через dir_admin): положить безобидный
`<?php echo 'X';` в `download/`, дёрнуть его — ответ **не** должен содержать `X` (файл
должен отдаться как текст или 403), затем удалить файл.
