#!/bin/bash
# Запись встречи на сервере Jitsi (ideav/courses#200): после остановки записи Jibri вызывает
#   finalize-recording.sh <каталог записи>
# Скрипт выгружает mp4 в Kinescope и сразу удаляет файл, затем сообщает ссылку порталу
# (courses-meet.php, action=recorded) и удаляет каталог. Повтор оставшегося: finalize-recording.sh --all
#
# Настройки — файл рядом со скриптом record.env (или путь в MEET_RECORD_CONF):
#   KINESCOPE_TOKEN=     токен API Kinescope (Настройки → API-токены)
#   KINESCOPE_PARENT_ID= id проекта или папки Kinescope, куда кладутся записи
#   PORTAL_URL=          https://ideav.ru/courses-meet.php
#   RECORD_SECRET=       тот же секрет, что meet.record_secret в конфиге портала
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
CONF=${MEET_RECORD_CONF:-$HERE/record.env}
if [ "${1:-}" = "--all" ] || [ "${1:-}" = "--run" ]; then MODE=$1; DIR=${2:-}; else MODE=--start; DIR=${1:-}; fi
# каталог записей — родитель каталога этой записи (у --all — из JIBRI_RECORDING_DIR)
if [ "$MODE" = "--all" ]; then REC_DIR=${JIBRI_RECORDING_DIR:-/storage/recordings}; else REC_DIR=$(dirname "${DIR%/}"); fi
LOG=$REC_DIR/finalize.log
KINESCOPE_URL=https://uploader.kinescope.io/v2/video

log() { echo "$(date '+%F %T') $*" >> "$LOG" 2>/dev/null || echo "$(date '+%F %T') $*" >&2; }

# Jibri ждёт конца скрипта и до того не берёт новую запись — выгрузка уходит в фон
if [ "$MODE" = "--start" ]; then
    OUT=$LOG; { : >> "$OUT"; } 2>/dev/null || OUT=/dev/null
    setsid nohup "$0" --run "$DIR" >> "$OUT" 2>&1 < /dev/null &
    exit 0
fi

# shellcheck disable=SC1090
. "$CONF" || { log "нет настроек $CONF"; exit 1; }
for v in KINESCOPE_TOKEN KINESCOPE_PARENT_ID PORTAL_URL RECORD_SECRET; do
    [ -n "${!v:-}" ] || { log "в $CONF не задано $v"; exit 1; }
done
export RECORD_SECRET

# одна запись под блокировкой каталога: Jibri и повтор --all не берут её одновременно
one() {
    local dir=${1%/} rc
    # metadata.json Jibri пишет по окончании записи: без него запись ещё идёт или не удалась
    [ -f "$dir/metadata.json" ] || return 0
    [ ! -e "$dir/.rejected" ] || return 0
    # повисшая блокировка (процесс убит) старше 6 часов снимается
    find "$dir" -maxdepth 1 -name .lock -mmin +360 -exec rmdir {} \; 2>/dev/null
    mkdir "$dir/.lock" 2>/dev/null || return 0
    deliver "$dir"; rc=$?
    [ ! -d "$dir/.lock" ] || rmdir "$dir/.lock"
    return $rc
}

deliver() {
    local dir=$1 mp4 room meta up video link ts sig body code
    meta=$dir/metadata.json
    room=$(jq -r '.meeting_url // ""' "$meta" | sed 's#[?#].*##; s#.*/##' | tr 'A-Z' 'a-z')
    up=$dir/kinescope.json
    if [ ! -s "$up" ]; then
        mp4=$(ls "$dir"/*.mp4 2>/dev/null | head -n 1)
        [ -n "$mp4" ] || { log "$dir: нет mp4"; return 1; }
        # mp4 моложе 2 минут — Jibri мог ещё не дописать
        [ -z "$(find "$mp4" -mmin -2)" ] || [ "$MODE" = "--run" ] || return 0
        if ! curl -sS --fail-with-body --connect-timeout 30 -X POST "$KINESCOPE_URL" \
            -H @<(printf 'Authorization: Bearer %s\n' "$KINESCOPE_TOKEN") -H "X-Parent-ID: $KINESCOPE_PARENT_ID" \
            -H "X-Video-Title: $room $(date -r "$mp4" '+%F %H:%M')" -H "X-File-Name: $(basename "$mp4")" \
            -H 'Content-Type: video/mp4' -T "$mp4" -o "$up.tmp" \
            || ! jq -e '.data.id and .data.play_link' "$up.tmp" > /dev/null; then
            log "$dir: Kinescope не принял: $(head -c 300 "$up.tmp" 2>/dev/null)"; rm -f "$up.tmp"; return 1
        fi
        mv "$up.tmp" "$up"
        # видео уже в Kinescope — файл на диске больше не нужен
        rm -f "$dir"/*.mp4
        log "$dir: выгружено в Kinescope $(jq -r .data.id "$up")"
    fi
    video=$(jq -r .data.id "$up"); link=$(jq -r .data.play_link "$up"); ts=$(date +%s)
    sig=$(printf '%s' "$room|$video|$link|$ts" | python3 -c 'import hmac,hashlib,os,sys; print(hmac.new(os.environ["RECORD_SECRET"].encode(), sys.stdin.buffer.read(), hashlib.sha256).hexdigest())')
    body=$(jq -nc --arg room "$room" --arg video "$video" --arg link "$link" --arg ts "$ts" --arg sig "$sig" \
        '{action:"recorded", room:$room, video:$video, link:$link, ts:$ts, sig:$sig}')
    code=$(curl -sS --connect-timeout 30 --max-time 120 -o "$dir/portal.txt" -w '%{http_code}' -X POST "$PORTAL_URL" \
        -H 'X-Requested-With: XMLHttpRequest' -H 'Content-Type: application/json' --data "$body")
    if [ "$code" = 200 ] && jq -e '.ok == true' "$dir/portal.txt" > /dev/null 2>&1; then
        log "$dir: портал получил ссылку $link"
        rm -rf "$dir"
        return 0
    fi
    if [ "$code" = 400 ] || [ "$code" = 404 ]; then
        # портал отказал по существу (ссылка, встреча) — повтор не поможет; видео остаётся в Kinescope
        touch "$dir/.rejected"
        log "$dir: портал отказал ($code $(head -c 200 "$dir/portal.txt")), видео в Kinescope: $link"
        return 1
    fi
    log "$dir: портал не ответил ($code), ссылка будет отправлена при повторе"
    return 1
}

if [ "$MODE" = "--all" ]; then
    rc=0
    for d in "$REC_DIR"/*/; do [ -d "$d" ] && { one "$d" || rc=1; }; done
    exit $rc
fi
one "$DIR"
