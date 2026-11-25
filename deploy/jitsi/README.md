# Jitsi Meet для видеовстреч портала курсов (ideav/courses#200)

Портал `ideav.ru/courses` встраивает комнату Jitsi через iframe (`download/courses/js/meet.js`).
Ключ входа (JWT HS256) выдаёт `courses-meet.php` (`include/courses_meet.php`); без ключа сервер
Jitsi в комнату не пускает. Модератор — тот, у кого в ключе `context.user.moderator = "true"`.

## Сервер

- 2 vCPU, 4 ГБ RAM (2 ГБ — со swap), 15 ГБ диска, Ubuntu 22.04/24.04 или AlmaLinux 8 с Docker.
- Порты: TCP 443 (и 80 для сертификата), **UDP 10000** (медиа). Канал от 50 Мбит/с.
- DNS: поддомен, например `meet.ideav.ru`.
- Встреча вдвоём идёт напрямую между браузерами (P2P), на 3–5 человек — через видеомост сервера.

## Установка

[docker-jitsi-meet](https://github.com/jitsi/docker-jitsi-meet), релиз `stable-11509-1` (проверено с ним):

```bash
curl -sL https://github.com/jitsi/docker-jitsi-meet/archive/refs/tags/stable-11509-1.tar.gz | tar xz
cd docker-jitsi-meet-stable-11509-1
cp env.example .env && ./gen-passwords.sh
cat env.meet >> .env            # файл env.meet — ниже, с секретом и доменом
mkdir -p ~/.jitsi-meet-cfg/{web,transcripts,prosody/config,prosody/prosody-plugins-custom,jicofo,jvb,jigasi,jibri}
docker compose up -d
```

`env.meet`:

```ini
PUBLIC_URL=https://meet.ideav.ru
HTTP_PORT=80
HTTPS_PORT=443
ENABLE_LETSENCRYPT=1
LETSENCRYPT_DOMAIN=meet.ideav.ru
LETSENCRYPT_EMAIL=<почта администратора>
TZ=Europe/Moscow
# вход только по ключу портала
ENABLE_AUTH=1
AUTH_TYPE=jwt
ENABLE_GUESTS=0
JWT_APP_ID=ideav-courses
JWT_APP_SECRET=<64 hex, тот же, что meet.secret в courses-pay.json>
JWT_ACCEPTED_ISSUERS=ideav-courses
JWT_ACCEPTED_AUDIENCES=jitsi
# модератора назначает ключ, а не порядок входа
XMPP_MUC_MODULES=token_affiliation
JICOFO_ENABLE_AUTH=0
ENABLE_AUTO_OWNER=0
```

Если 443 уже занят (Apache/nginx/Caddy), Jitsi ставится на `HTTP_PORT=8000`/`HTTPS_PORT=8443`
без `ENABLE_LETSENCRYPT`, а сайт `meet.<домен>` проксирует на `http://127.0.0.1:8000` с WebSocket
(`/xmpp-websocket`, `/colibri-ws/`). UDP 10000 проксировать не нужно — он открывается напрямую.
Если сервер за NAT, добавить `JVB_ADVERTISE_IPS=<внешний IP>`.

Секрет: `head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'`.

## Портал

В `/var/www/www-root/data/courses-pay.json` (конфиг оплаты курсов, `COURSES_PAY_CONFIG`) — раздел:

```json
"meet": {"domain": "meet.ideav.ru", "sub": "meet.jitsi", "app_id": "ideav-courses", "secret": "<секрет>", "ttl": 120}
```

- `domain` — адрес, с которого браузер грузит `external_api.js` и комнату;
- `sub` — XMPP-домен Jitsi (`XMPP_DOMAIN`, по умолчанию в docker-jitsi-meet `meet.jitsi`);
- `ttl` — срок ключа в секундах. Ключ нужен только для входа: участник, вошедший по ключу, остаётся
  в комнате и после его истечения; выгнанный ведущим и заблокированный нового ключа не получает.
  Ключ, выданный меньше `ttl` секунд назад, ещё пускает: заблокированный в первые 2 минуты после
  входа может один раз переподключиться — ведущий выгоняет его снова кнопкой Jitsi.

Без раздела `meet` точка `courses-meet.php` отвечает 503 `meet_off`, кнопка «Встречи» показывает
«Видеовстречи пока не включены».

Встречи хранятся файлами `<store_dir>/meet/<id>.json` (`store_dir` — из того же конфига).

## Проверка после установки

- `https://meet.ideav.ru/<любая комната>` без ключа → «token required».
- Портал: ведущий создаёт встречу, входит — у него в меню «…» есть «Выгнать» и «Запись» (локальная,
  в файл на компьютер ведущего, Chrome/Edge); ученик входит участником, без модераторских кнопок.
- Ведущий жмёт «Заблокировать» — ученика выбрасывает из комнаты, повторный вход: «Ведущий закрыл вам
  вход на эту встречу».
