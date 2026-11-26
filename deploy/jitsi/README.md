# Jitsi Meet для видеовстреч портала курсов (ideav/courses#200)

Портал `ideav.ru/courses` встраивает комнату Jitsi через iframe (`download/courses/js/meet.js`).
Ключ входа (JWT HS256) выдаёт `courses-meet.php` (`include/courses_meet.php`); без ключа сервер
Jitsi в комнату не пускает. Модератор — тот, у кого в ключе `context.user.moderator = "true"`.

## Сервер

Два режима встречи (выбирает ведущий при создании): «Беседа» — говорят все, до 5 человек;
«Лекция» — говорят ведущий и один вызванный участник, остальные слушают (до ~100 человек). В лекции
работает модерация звука и видео Jitsi: слушатель поднимает руку, ведущий в панели «Эфир» жмёт
«Дать слово», у предыдущего выступающего слово забирается.

| | Беседа до 5 | Лекция до 100 | Лекция до 100 + запись на сервере |
|---|---|---|---|
| CPU / RAM | 2 vCPU, 4 ГБ | 4 vCPU, 8 ГБ | **8 vCPU, 16 ГБ** |
| Диск | 20 ГБ | 40 ГБ | **100–160 ГБ SSD** (система ~20 ГБ, записи до выгрузки) |
| Канал | 50 Мбит/с | **от 300 Мбит/с, безлимитный трафик** (~100 Мбит/с при 360p, ~300 при 720p; 45–135 ГБ за час) | то же |

- Ubuntu 24.04 с Docker, виртуализация KVM или выделенный сервер. Сервер — в РФ: через него идут
  имена, IP-адреса, чат, звук и видео участников, на нём лежат записи (152-ФЗ).
- Порты: TCP 443 (и 80 для сертификата), **UDP 10000** (медиа).
- DNS: поддомен, например `meet.ideav.ru`.
- Запись (Jibri) берёт звук через PulseAudio внутри контейнера: модуль ядра `snd-aloop` не нужен.
- Одновременно пишется одна встреча на один контейнер Jibri (~4 vCPU, 4 ГБ на каждый следующий).
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

## Запись на сервере

Ведущий включает запись кнопкой Jitsi «Начать запись» (участникам она недоступна: jicofo
принимает запрос только от модератора). Контейнер Jibri входит в комнату невидимым участником и
пишет её в mp4 1280×720. После остановки Jibri вызывает `finalize-recording.sh`: файл уходит в
Kinescope, ссылка — порталу (у ведущего в «Управлении встречей» появляется «Записи встречи»),
каталог записи удаляется. Выгрузка идёт в фоне, Jibri сразу готов к следующей записи.

В `env.meet` добавить:

```ini
ENABLE_RECORDING=1
JIBRI_FINALIZE_RECORDING_SCRIPT_PATH=/config/finalize-recording.sh
```

Файлы и права (контейнеры работают от uid 1000):

```bash
CFG=~/.jitsi-meet-cfg
mkdir -p $CFG/storage/jibri
cp finalize-recording.sh $CFG/jibri/ && chmod +x $CFG/jibri/finalize-recording.sh
cat > $CFG/jibri/record.env <<EOF
KINESCOPE_TOKEN=<токен API Kinescope: Настройки → API-токены>
KINESCOPE_PARENT_ID=<id проекта или папки Kinescope для записей>
PORTAL_URL=https://ideav.ru/courses-meet.php
RECORD_SECRET=<64 hex, тот же, что meet.record_secret в courses-pay.json>
EOF
chmod 600 $CFG/jibri/record.env
sudo chown -R 1000:1000 $CFG/storage $CFG/jibri
docker compose -f docker-compose.yml -f jibri.yml up -d
```

`id` проекта — `GET https://api.kinescope.io/v1/projects` с тем же токеном, поле `id`.

Записи и журнал `finalize.log` лежат в `$CFG/storage/jibri/recordings`. mp4 удаляется сразу после
выгрузки в Kinescope; в каталоге остаётся `kinescope.json` с id и ссылкой, пока портал не примет
сообщение. Если Kinescope или портал не ответили, каталог остаётся, причина — в `finalize.log`.
Повтор всех оставшихся (раз в час из cron на хосте подбирает хвосты сам):

```bash
docker compose -f docker-compose.yml -f jibri.yml exec -T jibri /config/finalize-recording.sh --all
```

- Выгруженное видео повторно не выгружается: повторяется только сообщение порталу. Если ответ
  Kinescope потерялся в сети после приёма файла, видео в Kinescope окажется дважды.
- Портал отказал по существу (400/404: встреча удалена, ссылка не того вида) — каталог помечается
  `.rejected` и больше не повторяется; ссылка — в `finalize.log` и `kinescope.json`.
- Запись, которую Jibri ещё пишет, повтор не трогает: `metadata.json` появляется по окончании.

Значок Jitsi в углу записи убирается строкой `interfaceConfig.SHOW_JITSI_WATERMARK = false;` в
`$CFG/web/custom-interface_config.js`.

## Портал

В `/var/www/www-root/data/courses-pay.json` (конфиг оплаты курсов, `COURSES_PAY_CONFIG`) — раздел:

```json
"meet": {"domain": "meet.ideav.ru", "sub": "meet.jitsi", "app_id": "ideav-courses", "secret": "<секрет>", "ttl": 120,
         "record_secret": "<секрет записи>"}
```

- `record_secret` — подпись сообщений о готовой записи (HMAC-SHA256 от `room|video|link|ts`, не
  старше часа); без него сообщения отклоняются (503 `record_off`). Принимаются только ссылки
  `https://kinescope.io/…` и только для существующей встречи; записи видит ведущий.

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
- Лекция: слушатель не может включить микрофон и камеру сам; после «Дать слово» может, у прежнего
  выступающего микрофон выключается и снова не включается. Проверить с 5+ участниками и замерить
  исходящий трафик и CPU видеомоста (на локальном стенде в WSL медиа до видеомоста не доходит).
- Ведущий жмёт «Заблокировать» — ученика выбрасывает из комнаты, повторный вход: «Ведущий закрыл вам
  вход на эту встречу».
- Запись: ведущий включает, говорит минуту с камерой, останавливает. Через минуту-две в
  «Управлении встречей» — «Запись от …», по ссылке в Kinescope есть картинка и звук; в
  `finalize.log` — «выгружено» и «портал получил ссылку». Размер файла за час записи — замерить
  (`ls -l` до выгрузки) и при необходимости поправить объём диска.
