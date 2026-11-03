#!/usr/bin/env bash
# SSH-туннель к MySQL для внешнего SQL-клиента (issue #5373, docs/ext-views.md).
# Учётка туннеля (по умолчанию dbtunnel): без командной строки, без пароля, только проброс
# на сервер MySQL. Ключ пользователя открывает ровно один адрес — DB_HOST:DB_PORT.
#
#   sudo scripts/ext-ssh-tunnel.sh setup                 # завести учётку и блок sshd
#   sudo scripts/ext-ssh-tunnel.sh add-key <файл .pub>   # выдать ключ
#   sudo scripts/ext-ssh-tunnel.sh list                  # выданные ключи
#   sudo scripts/ext-ssh-tunnel.sh remove-key <текст>    # отозвать ключ (по комментарию или части ключа)
#
# Переменные: TUNNEL_USER (dbtunnel), DB_HOST (127.0.0.1), DB_PORT (3306) — адрес MySQL со стороны
# этого сервера; те же значения задаются ядру как INTEGRAM_EXT_SSH_USER и INTEGRAM_EXT_DB_HOST/_PORT.
set -euo pipefail

TUNNEL_USER="${TUNNEL_USER:-dbtunnel}"
DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-3306}"
SSHD_CONF="/etc/ssh/sshd_config.d/ext-tunnel.conf"
HOME_DIR="/home/$TUNNEL_USER"
KEYS="$HOME_DIR/.ssh/authorized_keys"

die() { echo "ext-ssh-tunnel: $*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || die "запускать от root (sudo)"

setup() {
    if ! id "$TUNNEL_USER" >/dev/null 2>&1; then
        useradd --create-home --shell /usr/sbin/nologin "$TUNNEL_USER"
    fi
    passwd -l "$TUNNEL_USER" >/dev/null           # вход только по ключу
    install -d -m 700 -o "$TUNNEL_USER" -g "$TUNNEL_USER" "$HOME_DIR/.ssh"
    [ -f "$KEYS" ] || install -m 600 -o "$TUNNEL_USER" -g "$TUNNEL_USER" /dev/null "$KEYS"
    cat > "$SSHD_CONF" <<EOF
# SSH-туннель к MySQL для внешнего SQL-клиента (crm scripts/ext-ssh-tunnel.sh)
Match User $TUNNEL_USER
    PasswordAuthentication no
    KbdInteractiveAuthentication no
    AllowTcpForwarding local
    PermitOpen $DB_HOST:$DB_PORT
    X11Forwarding no
    AllowAgentForwarding no
    PermitTTY no
    GatewayPorts no
    ForceCommand /usr/sbin/nologin
EOF
    sshd -t || { rm -f "$SSHD_CONF"; die "sshd -t не принял конфиг — он удалён, sshd не перезапущен"; }
    check_conf
    systemctl reload ssh 2>/dev/null || systemctl reload sshd
    echo "учётка $TUNNEL_USER готова: туннель только на $DB_HOST:$DB_PORT"
}

# Блок Match из подключаемого файла не должен задеть других пользователей: проверка до reload
check_conf() {
    local host; host="$(hostname)"
    sshd -T -C "user=$TUNNEL_USER,host=$host,addr=127.0.0.1" | grep -qi "^permitopen $DB_HOST:$DB_PORT" \
        || die "sshd не применил PermitOpen к $TUNNEL_USER — проверьте Include в /etc/ssh/sshd_config"
    if sshd -T -C "user=root,host=$host,addr=127.0.0.1" | grep -qi "^forcecommand /usr/sbin/nologin"; then
        rm -f "$SSHD_CONF"
        die "блок Match задел других пользователей — конфиг удалён, sshd не перезапущен"
    fi
}

add_key() {
    local file="${1:-}"
    [ -f "$file" ] || die "нет файла ключа: $file"
    [ -f "$KEYS" ] || die "сначала: $0 setup"
    local key; key="$(grep -E '^(ssh-(ed25519|rsa)|ecdsa-sha2-[a-z0-9-]+|sk-[a-z0-9@.-]+) ' "$file" | head -n1)"
    [ -n "$key" ] || die "в $file нет открытого ключа SSH"
    if grep -qF "$(echo "$key" | awk '{print $2}')" "$KEYS"; then
        echo "ключ уже выдан"; return
    fi
    echo "restrict,port-forwarding,permitopen=\"$DB_HOST:$DB_PORT\",command=\"/usr/sbin/nologin\" $key" >> "$KEYS"
    chown "$TUNNEL_USER:$TUNNEL_USER" "$KEYS"; chmod 600 "$KEYS"
    echo "ключ выдан: $(echo "$key" | awk '{print $3}')"
}

case "${1:-}" in
    setup) setup ;;
    add-key) add_key "${2:-}" ;;
    list) [ -f "$KEYS" ] && awk '{print NR": "$NF}' "$KEYS" ;;
    remove-key)
        [ -n "${2:-}" ] || die "укажите комментарий или часть ключа"
        grep -vF -- "$2" "$KEYS" > "$KEYS.new" || true
        echo "удалено ключей: $(( $(wc -l < "$KEYS") - $(wc -l < "$KEYS.new") ))"
        mv "$KEYS.new" "$KEYS"; chown "$TUNNEL_USER:$TUNNEL_USER" "$KEYS"; chmod 600 "$KEYS" ;;
    *) sed -n '2,13p' "$0"; exit 1 ;;
esac
