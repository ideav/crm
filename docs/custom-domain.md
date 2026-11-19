# Свой домен базы

Владелец базы открывает её по своему адресу, например `https://crm.company.ru/`. Адреса внутри — без
префикса `/<база>`: `https://crm.company.ru/table/42`. На своём домене доступна только эта база.

## На пальцах

1. ЛК → карточка базы → «Свой домен» → ввести `crm.company.ru` → «Подключить».
2. У себя в DNS добавить запись, которую показал ЛК:
   - поддомен: `crm.company.ru CNAME <база>.domains.ideav.ru`;
   - корневой домен (`company.ru`): `A <адрес приёмника>` и `TXT _integram.company.ru <токен>`.
3. «Проверить» → «Оплатить месяц» (490 ₽) или «Год» (4 900 ₽) — списывается с баланса ЛК.
   На тарифе «Масштабируемый» один домен входит в тариф.
4. Первый заход на `https://crm.company.ru/` выпускает сертификат Let's Encrypt (несколько секунд).

После окончания оплаты домен работает ещё 7 дней, затем показывает страницу «Домен не оплачен» со
ссылкой на `ideav.ru/<база>`. Данные базы не затрагиваются.

## Справочник

### Путь запроса

```
браузер → Caddy :443 (on-demand TLS) → Apache 127.0.0.1:8443 (Host: ideav.ru) → index.php
```

Caddy для чужого хоста ставит `X-Integram-Domain: <хост>` (и `X-Integram-Edge: <секрет>`, если
задан `INTEGRAM_EDGE_SECRET`) и переписывает `/` в `/_root` (иначе Apache отдал бы лендинг
`index.html`). `Cd_route()` (`include/custom_domain.php`) вызывается в `index.php` до разбора
`REQUEST_URI`:

| Запрос на своём домене | Что видит ядро |
|---|---|
| `/`, `/_root` | `/<база>` |
| `/table/42` | `/<база>/table/42` |
| `/<база>/_m_save/5` (XHR, POST) | как есть |
| `/<база>/table/42`, переход браузера (GET, `Sec-Fetch-Mode: navigate`) | 302 на `/table/42` |

В ответе ядра `href/src/action/formaction="/<база>/…"` и заголовок `Location` переписываются на
чистые адреса. Статика (`/js`, `/css`, `/download/<база>`, `/start.html`) отдаётся Apache как на
ideav.ru. Кука сессии `idb_<база>` ставится без `domain` — сессия на своём домене отдельная.

### Данные

| Что | Где |
|---|---|
| Домен базы | реквизит `Domain` типа DB (271) в базе `my`; id ищется по имени (`Cd_req_id`) |
| Оплата | запись Payment (957) под пользователем: сумма 490/4900, Type (1085) = `bal2dom`, Paid (967) = unix-время, Notes (1075) = `<домен> (<база>)` |
| Срок | 490 ₽ → 31 день, 4 900 ₽ → 366 дней от даты платежа; периоды раздаются доменам по id записи базы |
| Тариф | «Масштабируемый» (1148) — первый домен бесплатно (`CD_FOREVER`) |
| Реестр | `logs/custom_domains.json`: `хост → {db, user, until, verified}`; производный кэш, пересобирается `Cd_registry_rebuild()` при каждом действии ЛК |

### Действия (база `my`, POST с `_xsrf`, ответ JSON)

| Действие | Параметры | Что делает |
|---|---|---|
| `/my/_domain_status?db=` | — | состояние: `none`, `dns_pending`, `not_paid`, `active`, `grace`, `expired`; DNS-записи для подсказки |
| `/my/_domain_set?db=` | `domain` | привязать домен (или заменить), сразу проверить DNS |
| `/my/_domain_check?db=` | — | проверить DNS; прошла — домен в реестре (`dns_ok: true`) |
| `/my/_domain_pay?db=` | `period=month\|year` | списать 490/4 900 ₽ с баланса (285), записать платёж |
| `/my/_domain_del?db=` | — | отвязать домен |
| `/my/_domain_ok?domain=` | — | проверка Caddy перед выпуском сертификата: 200 — домен в реестре и оплачен (с учётом 7 дней), иначе 404. Без БД и сессии |

### Настройки

Константы в `include/custom_domain.local.php` (вне git) или переменные окружения:

| Имя | По умолчанию | Смысл |
|---|---|---|
| `INTEGRAM_DOMAIN_CNAME_SUFFIX` | `domains.ideav.ru` | цель CNAME: `<база>.<суффикс>` |
| `INTEGRAM_DOMAIN_EDGE_IP` | — | адрес для A-записи корневого домена; пусто — корневые домены не принимаются |
| `INTEGRAM_EDGE_SECRET` | — | секрет заголовка `X-Integram-Edge` (то же значение — в `/etc/caddy/env`) |
| `INTEGRAM_DOMAIN_RESERVED` | домены платформы | эти домены и их поддомены привязать нельзя |
| `INTEGRAM_DOMAIN_REGISTRY` | `logs/custom_domains.json` | путь реестра |

## Выкладка на ideav.ru

Файлы — `deploy/caddy/`. Порядок:

1. **Ядро:** `index.php`, `include/custom_domain.php`, `js/cabinet.js`, `css/my-cabinet.css`,
   `templates/custom/my/main.html`. `include/custom_domain.local.php`:
   ```php
   <?php
   define("INTEGRAM_DOMAIN_EDGE_IP", "92.242.60.37");
   define("INTEGRAM_EDGE_SECRET", "<случайная строка>");
   ```
2. **Реквизит `Domain`** в базе `my` (один раз):
   ```sql
   INSERT INTO my (up, ord, t, val) VALUES (0, 0, 3, 'Domain');           -- тип: короткая строка
   INSERT INTO my (up, ord, t, val)
     SELECT 271, MAX(ord) + 1, LAST_INSERT_ID(), '' FROM my WHERE up = 271; -- реквизит типа DB
   ```
3. **DNS:** `*.domains.ideav.ru A 92.242.60.37` (зона ideav.ru на reg.ru).
4. **Caddy:** `/usr/local/bin/caddy` (релиз с GitHub, сверка sha512), пользователь `caddy`,
   `deploy/caddy/Caddyfile` → `/etc/caddy/Caddyfile`, `caddy.service` → `/etc/systemd/system/`,
   `/etc/caddy/env`: `INTEGRAM_EDGE_SECRET=<та же строка>`, скрипты — в `/etc/caddy/bin/`.
5. **Переключение:** бэкап `/etc/apache2` → `sh /etc/caddy/bin/apache-behind-caddy.sh` (Apache
   уходит на 127.0.0.1:8080/8443) → `systemctl enable --now caddy`. Перерыв — время перезапуска
   Apache и старта Caddy, секунды.
6. **Сторож и продление:** cron `* * * * * sh /etc/caddy/bin/apache-behind-caddy.sh --guard`.
   Он возвращает вхост за Caddy после правки сайта в панели ispmanager и подхватывает продлённые
   ispmanager сертификаты (sites.sh сравнивает собранный `sites.caddy` с текущим).

Откат: остановить Caddy, вернуть `/etc/apache2` из бэкапа, `systemctl restart apache2`, убрать
строку сторожа из cron.

## Грабли

- **Cloudflare в режиме прокси (оранжевое облако)** — CNAME не виден, проверка не проходит и
  сертификат не выпускается. Нужен режим «DNS only».
- **Запись CAA без `letsencrypt.org`** — Let's Encrypt откажет в сертификате.
- **Сайт с редиректом «если не HTTPS» в `.htaccess`** (mvp.care, excel-to-app.ru) зациклился бы,
  ходи Caddy в Apache по HTTP. Поэтому Caddy ходит в Apache по HTTPS (`127.0.0.1:8443`, SNI = имя
  сайта), и для Apache соединение остаётся HTTPS.
- **Адрес клиента** без `mod_remoteip` был бы 127.0.0.1 у всех — лимиты входа и QR по IP сработали
  бы на всех сразу. `remoteip-caddy.conf` берёт адрес из `X-Forwarded-For` только от 127.0.0.1.
- **PHP на ideav.ru — CGI под suexec**: переменные `SetEnv` до PHP не доходят, настройки — константами
  в `include/custom_domain.local.php`.
- **Файлы сертификатов ispmanager** бывают без перевода строки в конце; склеенные с цепочкой без
  разделителя они не читаются. `sites.sh` склеивает через перевод строки и ставит сертификат сайта
  первым.
