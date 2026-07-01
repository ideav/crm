# Установка Интеграм без Docker (путь 2, вручную)

Ставим на обычный LAMP: **Apache + PHP (mod_php) + MariaDB**. Инструкция для
Ubuntu 22.04/24.04 или Debian 12; на других дистрибутивах отличаются только
команды установки пакетов и пути к конфигам Apache.

Ориентир по версиям (протестированный образ): **PHP 8.2, MariaDB 11.x**. Подойдёт
PHP 8.1+ и MariaDB 10.6+/MySQL 8 — важны расширения `mysqli`, `mbstring`, `zip`, `curl`.

Все команды выполняются с правами root (или через `sudo`).

## 1. Установка пакетов

```bash
sudo apt update
sudo apt install -y apache2 mariadb-server \
  libapache2-mod-php php-mysql php-mbstring php-zip php-curl \
  openssl unzip
```

Включите нужные модули Apache и запустите службы:

```bash
sudo a2enmod rewrite ssl
sudo systemctl enable --now apache2 mariadb
```

Проверьте, что расширения PHP на месте:

```bash
php -m | grep -E 'mysqli|mbstring|zip|curl'
```

Должны напечататься все четыре.

## 2. Файлы приложения

Распакуйте архив в каталог сайта (пример — `/var/www/integram`):

```bash
sudo mkdir -p /var/www/integram
sudo tar -xzf integram-local-*.tar.gz -C /var/www/integram
cd /var/www/integram
```

Создайте каталог логов и раздайте права веб-серверу на каталоги, куда приложение
пишет (логи, загрузки, пользовательские шаблоны):

```bash
sudo mkdir -p logs templates/custom download
sudo chown -R www-data:www-data logs download templates/custom
```

## 3. База данных

Создайте базу и пользователя. Замените `ПАРОЛЬ_БД` на свой (запомните — он
понадобится в п. 4):

```bash
sudo mariadb <<'SQL'
CREATE DATABASE IF NOT EXISTS ideav CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'ideav'@'127.0.0.1' IDENTIFIED BY 'ПАРОЛЬ_БД';
GRANT ALL PRIVILEGES ON ideav.* TO 'ideav'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL
```

Загрузите начальную схему (создаёт рабочие таблицы `my`/`ru`/`en`, метаданные и
администратора). Файл лежит в архиве:

```bash
sudo mariadb ideav < docker/mysql/010-integram-bootstrap.sql
```

Проверка — должны появиться таблицы:

```bash
sudo mariadb ideav -e "SHOW TABLES;"
```

Ожидается три таблицы: `my`, `ru`, `en`.

## 4. Настройки через переменные окружения

Приложение читает конфиг **только из переменных окружения** (файла настроек нет).
Под mod_php переменные задаются в `/etc/apache2/envvars` — оттуда их видит PHP.

В архиве есть готовый шаблон `local/files/apache-envvars.snippet`. Скопируйте его
содержимое в конец `/etc/apache2/envvars`, подставив свои значения:

```bash
sudo nano /etc/apache2/envvars
```

Обязательные строки (значения — ваши):

```bash
export INTEGRAM_DB_HOST=127.0.0.1
export INTEGRAM_DB_PORT=3306
export INTEGRAM_DB_NAME=ideav
export INTEGRAM_DB_USER=ideav
export INTEGRAM_DB_PASSWORD='ПАРОЛЬ_БД'          # тот же, что в п. 3
export INTEGRAM_MASTER_PASSWORD='master-пароль'  # пароль администратора Интеграма
export INTEGRAM_SALT='случайная-длинная-строка'  # напр. вывод: openssl rand -hex 24
export INTEGRAM_ADMIN_EMAIL='admin@example.local'
```

Сгенерировать надёжный SALT:

```bash
openssl rand -hex 24
```

Значения в одинарных кавычках, без пробелов вокруг `=`. Остальные переменные
(SMTP, капча и т.п.) не обязательны для запуска.

## 5. Виртуальный хост Apache

В архиве есть готовый шаблон `local/files/apache-integram.conf`. Скопируйте его в
конфиги Apache и, при необходимости, поправьте путь `DocumentRoot` и `ServerName`:

```bash
sudo cp local/files/apache-integram.conf /etc/apache2/sites-available/integram.conf
sudo nano /etc/apache2/sites-available/integram.conf   # проверьте DocumentRoot и ServerName
```

Включите сайт (и при желании отключите дефолтный):

```bash
sudo a2ensite integram
sudo a2dissite 000-default
```

Шаблон уже содержит защиту каталогов загрузок от исполнения кода (важно, не
удаляйте эти блоки) и маршрутизацию через `index.php`.

## 6. TLS-сертификат

Для HTTPS-хоста создайте самоподписанный сертификат (или положите сертификат
клиента по путям из vhost):

```bash
sudo mkdir -p /etc/integram/certs
sudo openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" \
  -keyout /etc/integram/certs/local.key \
  -out /etc/integram/certs/local.crt
sudo chmod 600 /etc/integram/certs/local.key
```

Если HTTPS не нужен — уберите или закомментируйте блок `<VirtualHost *:443>` в
конфиге и работайте по HTTP.

## 7. Запуск и проверка

```bash
sudo apache2ctl configtest        # должно быть "Syntax OK"
sudo systemctl restart apache2
```

Проверьте ответ:

```bash
curl -kI https://localhost/        # или http://localhost/ если без TLS
```

Ожидается `HTTP/... 200` или `302`. Если получаете `500` — смотрите лог:

```bash
sudo tail -n 50 /var/log/apache2/error.log
```

## 8. Первый вход

Откройте в браузере адрес сервера:

```
https://<адрес-сервера>/
```

Откроется страница входа. Нажмите **«Войти»** и введите:

- **Логин:** `admin`
- **Пароль:** значение `INTEGRAM_MASTER_PASSWORD` из п. 4.

Вы попадёте в рабочую область `my`. (Прямая ссылка на область — `https://<адрес-сервера>/my`.)

## 9. Резервная копия базы

```bash
sudo mariadb-dump ideav > integram-backup.sql          # создать копию
sudo mariadb ideav < integram-backup.sql               # восстановить
```

## Если что-то пошло не так

| Симптом | Причина / что делать |
|---------|----------------------|
| `HTTP 500`, в error.log «Couldn't connect» | Неверные `INTEGRAM_DB_*` в `/etc/apache2/envvars`, или переменные не подхватились — после правки envvars нужен **полный** `systemctl restart apache2` (не reload). |
| Форма входа не принимает пароль | `INTEGRAM_MASTER_PASSWORD` не совпадает с введённым; проверьте кавычки/пробелы в envvars и перезапустите Apache. |
| `HTTP 404` на все страницы | Не включён `mod_rewrite` или в vhost нет `FallbackResource /index.php` / `AllowOverride All`. |
| Пустая страница, в логе «Call to undefined function mysqli_connect» | Не установлен `php-mysql`; поставьте и перезапустите Apache. |
| `SHOW TABLES` пусто | Не загрузился `010-integram-bootstrap.sql` — повторите п. 3. |
| Права: ошибки записи в `logs`/`download` | Повторите `chown -R www-data:www-data logs download templates/custom`. |

Проверить, что PHP реально видит переменные (диагностика): временно положите в корень
`env-check.php` с `<?php var_dump(getenv('INTEGRAM_DB_NAME'));` откройте его в браузере,
затем **удалите файл**. Должно показать `ideav`, а не `false`.
