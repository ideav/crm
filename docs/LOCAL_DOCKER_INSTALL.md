# Локальная установка Интеграм в Docker

Этот вариант поднимает Интеграм на машине клиента без ручной настройки PHP,
Apache и MariaDB. Установщик спрашивает master-пароль, генерирует локальный
сертификат и запускает контейнеры.

## Требования

- Docker Engine с Docker Compose.
- Свободные порты `8080` и `8443`.
- Доступ к репозиторию с исходниками.

## Быстрый запуск

```bash
bash scripts/install-local-docker.sh
```

Скрипт создаёт `.env.local`, `docker/certs/local.crt` и
`docker/certs/local.key`, затем выполняет `docker compose up -d --build`.

Откройте:

```text
https://localhost:8443
```

Данные первого входа:

```text
База: my
Логин: admin
Пароль: master-пароль, введённый при установке
```

Браузер покажет предупреждение о certificate, потому что по умолчанию
используется самоподписанный сертификат для `localhost`. Для рабочей установки
замените `docker/certs/local.crt` и `docker/certs/local.key` сертификатом
клиента и перезапустите контейнер:

```bash
docker compose --env-file .env.local restart app
```

## Ручной запуск

```bash
cp .env.docker.example .env.local
```

Заполните в `.env.local` минимум:

```text
INTEGRAM_MASTER_PASSWORD=...
INTEGRAM_DB_PASSWORD=...
INTEGRAM_DB_ROOT_PASSWORD=...
INTEGRAM_SALT=...
```

Создайте или положите сертификат:

```bash
mkdir -p docker/certs
openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" \
  -keyout docker/certs/local.key \
  -out docker/certs/local.crt
```

Запустите:

```bash
docker compose --env-file .env.local up -d --build
```

## Обновление и остановка

```bash
docker compose --env-file .env.local pull
docker compose --env-file .env.local up -d --build
docker compose --env-file .env.local logs -f app
```

Остановить сервис:

```bash
docker compose --env-file .env.local down
```

Данные остаются в Docker volumes `integram-local_integram-db`,
`integram-local_integram-download`, `integram-local_integram-templates` и
`integram-local_integram-logs`.

## Резервная копия базы

```bash
docker compose --env-file .env.local exec db \
  mariadb-dump -u root -p ideav > integram-local.sql
```

Восстановление:

```bash
docker compose --env-file .env.local exec -T db \
  mariadb -u root -p ideav < integram-local.sql
```
