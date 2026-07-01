# Установка Интеграм в Docker (путь 1, рекомендуемый)

Всё поднимается в контейнерах: PHP + Apache для приложения и MariaDB для базы.
Ручная настройка PHP/Apache/БД не нужна. Время установки — 5–15 минут (зависит от
скорости скачивания образов).

## 1. Требования к серверу

- ОС Linux (Ubuntu 22.04/24.04, Debian 12 — проверенные варианты).
- Установленные **Docker Engine** и **Docker Compose** (плагин `docker compose`).
- Свободные порты **8080** и **8443** (можно изменить, см. п. 6).
- Доступ в интернет для скачивания образов `php:8.2-apache` и `mariadb:11.4`
  при первой сборке.

Проверка, что Docker готов:

```bash
docker --version
docker compose version
```

Обе команды должны напечатать версию. Если `docker compose version` выдаёт ошибку —
установите плагин Compose (пакет `docker-compose-plugin`) и повторите.

## 2. Распаковка

Скопируйте присланный архив на сервер и распакуйте:

```bash
mkdir -p ~/integram
tar -xzf integram-local-*.tar.gz -C ~/integram
cd ~/integram
```

(Если прислан `.zip` — распакуйте `unzip integram-local-*.zip -d ~/integram`.)

После распаковки в текущей папке должны быть `Dockerfile`, `compose.yaml`,
`scripts/` и остальные файлы из раздела «Что в архиве» README.

## 3. Запуск установщика

```bash
bash scripts/install-local-docker.sh
```

Скрипт:

1. Спросит **master-пароль** (введите дважды, минимум 8 символов) — это пароль
   администратора Интеграма.
2. Сгенерирует случайные пароли БД и `SALT`, запишет их в файл `.env.local`.
3. Создаст самоподписанный TLS-сертификат в `docker/certs/`.
4. Соберёт образ и запустит контейнеры (`docker compose up -d --build`).

Дождитесь строки о том, что Интеграм запускается, и адреса `https://localhost:8443`.

## 4. Первый вход

Откройте в браузере на сервере (или через проброшенный порт):

```
https://localhost:8443
```

Браузер предупредит о сертификате (он самоподписанный) — это ожидаемо, продолжите.

Откроется страница входа. Нажмите **«Войти»** и введите:

- **Логин:** `admin`
- **Пароль:** master-пароль, введённый в п. 3.

Вы попадёте в рабочую область `my`. (Прямая ссылка на область — `https://localhost:8443/my`.)

Если открываете не с самого сервера, замените `localhost` на IP/домен сервера и
убедитесь, что порт 8443 доступен (см. п. 6 про порты и файрвол).

## 5. Проверка, что всё работает

```bash
# статус контейнеров — оба должны быть "Up" (app и db)
docker compose --env-file .env.local ps

# логи приложения (Ctrl+C для выхода) — не должно быть фатальных ошибок PHP/Apache
docker compose --env-file .env.local logs -f app
```

Быстрая проверка HTTP-ответа:

```bash
curl -k -I https://localhost:8443/
```

Ожидается ответ `HTTP/... 200` (или `302` редирект на форму входа).

## 6. Порты и доступ снаружи

Порты задаются в `.env.local`:

```
INTEGRAM_HTTP_PORT=8080
INTEGRAM_HTTPS_PORT=8443
```

Чтобы работать на стандартных портах, поставьте `80` и `443`, затем перезапустите
(п. 8). Откройте нужные порты в файрволе, например:

```bash
sudo ufw allow 8443/tcp
```

## 7. Сертификат для рабочей эксплуатации

По умолчанию используется самоподписанный сертификат для `localhost`. Для рабочей
установки положите сертификат клиента вместо сгенерированного:

```bash
cp ваш.crt docker/certs/local.crt
cp ваш.key docker/certs/local.key
docker compose --env-file .env.local restart app
```

**Если у сервера нет домена (доступ по IP).** Доверенный сертификат от Let's Encrypt
для голого IP получить нельзя — остаётся самоподписанный. Чтобы браузер не блокировал
вход с ошибкой `ERR_CERT_AUTHORITY_INVALID`, выпустите сертификат с этим IP в SAN и
добавьте его `.crt` в доверенные на машинах пользователей:

```bash
openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
  -subj "/CN=185.221.155.204" \
  -addext "subjectAltName=IP:185.221.155.204" \
  -keyout docker/certs/local.key -out docker/certs/local.crt
docker compose --env-file .env.local restart app
```

Затем на каждой машине пользователя добавьте `local.crt` в доверенные корневые
(Windows: правый клик по файлу → «Установить сертификат» → «Локальный компьютер» →
«Доверенные корневые центры сертификации»). Как временная мера — принять предупреждение
в браузере вручную.

Начиная с #3962 фронтенд обращается к API по той же схеме, что и открытая страница,
поэтому если TLS не нужен — установку можно открыть по `http://<адрес>:8080/` и
работать без сертификата вообще.

## 8. Почта для сброса пароля

Ссылка «Забыли пароль?» на странице входа отправляет пользователю письмо с новым
паролем. Чтобы она работала, задайте SMTP в `.env.local` (полный список — в
`local/files/env.example`) и перезапустите:

```
INTEGRAM_SMTP_HOST=ssl://smtp.yandex.ru
INTEGRAM_SMTP_PORT=465
INTEGRAM_SMTP_USERNAME=box@yourdomain.ru
INTEGRAM_SMTP_PASSWORD=пароль-приложения
INTEGRAM_SMTP_FROM=Integram
```

```bash
docker compose --env-file .env.local up -d
```

Без реальных `SMTP_USERNAME`/`SMTP_PASSWORD` вход работает, но письма не отправляются.
Для Яндекс.Почты используйте **пароль приложения**, а не пароль аккаунта. Для отладки
поставьте `INTEGRAM_SMTP_DEBUG=true` — детали SMTP появятся в
`docker compose --env-file .env.local logs app`.

## 9. Обновление, остановка, бэкап

Перезапуск после изменения настроек:

```bash
docker compose --env-file .env.local up -d --build
```

Остановить (данные сохраняются в Docker-томах):

```bash
docker compose --env-file .env.local down
```

Резервная копия базы:

```bash
docker compose --env-file .env.local exec db \
  mariadb-dump -u root -p ideav > integram-backup.sql
```

Восстановление из копии:

```bash
docker compose --env-file .env.local exec -T db \
  mariadb -u root -p ideav < integram-backup.sql
```

Данные хранятся в томах `integram-local_integram-db`,
`integram-local_integram-download`, `integram-local_integram-templates`,
`integram-local_integram-logs` и переживают перезапуск/пересборку.

## Если что-то пошло не так

| Симптом | Что проверить |
|---------|---------------|
| `docker compose version` — ошибка | Не установлен плагин Compose (`docker-compose-plugin`). |
| Контейнер `db` перезапускается | Мало памяти/места на диске; смотрите `docker compose --env-file .env.local logs db`. |
| Страница не открывается снаружи | Порт закрыт в файрволе (п. 6) или заняты 8080/8443 — поменяйте порты. |
| «Couldn't connect» в логах app | БД ещё поднимается — подождите; если не проходит, смотрите логи `db`. |
| Порт занят (`address already in use`) | Измените `INTEGRAM_HTTP_PORT`/`INTEGRAM_HTTPS_PORT` в `.env.local`, перезапустите. |

При обращении к нам пришлите вывод `docker compose --env-file .env.local ps` и
последние строки `... logs app`.
