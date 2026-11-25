#!/bin/bash
# Запись встречи на сервере Jitsi (ideav/courses#200): после остановки записи Jibri вызывает
#   finalize-recording.sh <каталог записи>
# Скрипт выгружает mp4 в Kinescope, сообщает ссылку порталу (courses-meet.php, action=recorded)
# и удаляет файл. Не вышло — каталог остаётся, повтор: finalize-recording.sh --all
#
# Настройки — файл рядом со скриптом record.env (или путь в MEET_RECORD_CONF):
#   KINESCOPE_TOKEN=     токен API Kinescope (Настройки → API-токены)
#   KINESCOPE_PARENT_ID= id проекта или папки Kinescope, куда кладутся записи
#   PORTAL_URL=          https://ideav.ru/courses-meet.php
#   RECORD_SECRET=       тот же секрет, что meet.record_secret в конфиге портала
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
CONF=${MEET_RECORD_CONF:-$HERE/record.env}
REC_DIR=${JIBRI_RECORDING_DIR:-/storage/recordings}
LOG=$REC_DIR/finalize.log
KINESCOPE_URL=https://uploader.kinescope.io/v2/video

log() { echo "$(date '+%F %T') $*" >> "$LOG"; }

# Jibri ждёт конца скрипта и до того не берёт новую запись — выгрузка уходит в фон
if [ "${1:-}" != "--run" ] && [ "${1:-}" != "--all" ]; then
    setsid nohup "$0" --run "${1:-}" >> "$LOG" 2>&1 < /dev/null &
    exit 0
fi

# shellcheck disable=SC1090
. "$CONF" || { log "нет настроек $CONF"; exit 1; }

one() {
    local dir=${1%/} mp4 room meta up video link ts sig body
    [ -d "$dir" ] || return 0
    mkdir "$dir/.lock" 2>/dev/null || return 0
    mp4=$(ls "$dir"/*.mp4 2>/dev/null | head -n 1)
    meta=$dir/metadata.json
    if [ -z "$mp4" ] || [ ! -f "$meta" ]; then log "$dir: нет mp4 или metadata.json"; rmdir "$dir/.lock"; return 1; fi
    room=$(jq -r '.meeting_url // ""' "$meta" | sed 's#[?#].*##; s#.*/##' | tr 'A-Z' 'a-z')
    # загрузка повторно не делается: у Kinescope нет защиты от дублей
    up=$dir/kinescope.json
    if [ ! -s "$up" ]; then
        if ! curl -sS --fail-with-body -X POST "$KINESCOPE_URL" \
            -H "Authorization: Bearer $KINESCOPE_TOKEN" -H "X-Parent-ID: $KINESCOPE_PARENT_ID" \
            -H "X-Video-Title: $room $(date -r "$mp4" '+%F %H:%M')" -H "X-File-Name: $(basename "$mp4")" \
            -H 'Content-Type: video/mp4' -T "$mp4" -o "$up.tmp" \
            || ! jq -e '.data.id and .data.play_link' "$up.tmp" > /dev/null; then
            log "$dir: Kinescope не принял: $(head -c 300 "$up.tmp" 2>/dev/null)"; rm -f "$up.tmp"; rmdir "$dir/.lock"; return 1
        fi
        mv "$up.tmp" "$up"
        log "$dir: выгружено в Kinescope $(jq -r .data.id "$up")"
    fi
    video=$(jq -r .data.id "$up"); link=$(jq -r .data.play_link "$up"); ts=$(date +%s)
    sig=$(printf '%s' "$room|$video|$link|$ts" | openssl dgst -sha256 -hmac "$RECORD_SECRET" -r | cut -d' ' -f1)
    body=$(jq -nc --arg room "$room" --arg video "$video" --arg link "$link" --arg ts "$ts" --arg sig "$sig" \
        '{action:"recorded", room:$room, video:$video, link:$link, ts:$ts, sig:$sig}')
    if curl -sS --fail -X POST "$PORTAL_URL" -H 'X-Requested-With: XMLHttpRequest' -H 'Content-Type: application/json' \
        --data "$body" | jq -e '.ok == true' > /dev/null; then
        log "$dir: портал получил ссылку $link"
        rm -rf "$dir"
        return 0
    fi
    log "$dir: портал не принял ссылку, файл оставлен"; rmdir "$dir/.lock"; return 1
}

if [ "$1" = "--all" ]; then
    rc=0
    for d in "$REC_DIR"/*/; do one "$d" || rc=1; done
    exit $rc
fi
one "$2"
