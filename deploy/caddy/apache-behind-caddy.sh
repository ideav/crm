#!/bin/sh
# Apache за Caddy (#5573, docs/custom-domain.md). Идемпотентно:
#   - Listen 80/443 → 127.0.0.1:8080 / 127.0.0.1:8443 (apache2.conf);
#   - вхосты ispmanager <публичный IP>:80/443 → 127.0.0.1:8080/8443;
#   - mod_remoteip: адрес клиента из X-Forwarded-For от Caddy;
#   - пересборка /etc/caddy/sites.caddy, configtest, reload обоих.
# Без аргументов — применить (и ничего не делать, если уже применено и сайты не менялись).
# Режим --guard (cron раз в минуту): то же, но молча, если правок нет. ispmanager при правке сайта в
# панели переписывает вхост с публичным адресом — сторож возвращает его за Caddy.
set -eu
IP=${APACHE_PUBLIC_IP:-192.168.0.74}
CONF=/etc/apache2/apache2.conf
VH=/etc/apache2/vhosts
DIR=$(dirname "$0")
changed=0

if grep -qE '^Listen (80|443)$' "$CONF"; then
	sed -i -E 's/^Listen 80$/Listen 127.0.0.1:8080/; s/^Listen 443$/Listen 127.0.0.1:8443 https/' "$CONF"
	changed=1
fi
if grep -rlqE "<VirtualHost $IP:(80|443)>" "$VH"; then
	grep -rlE "<VirtualHost $IP:(80|443)>" "$VH" | xargs sed -i -E "s/<VirtualHost $IP:80>/<VirtualHost 127.0.0.1:8080>/; s/<VirtualHost $IP:443>/<VirtualHost 127.0.0.1:8443>/"
	changed=1
fi
if [ ! -f /etc/apache2/conf-enabled/remoteip-caddy.conf ]; then
	cat > /etc/apache2/conf-available/remoteip-caddy.conf <<'EOF'
# #5573: Apache за Caddy — адрес клиента из X-Forwarded-For только от локального Caddy.
RemoteIPHeader X-Forwarded-For
RemoteIPInternalProxy 127.0.0.1
EOF
	a2enmod -q remoteip >/dev/null
	a2enconf -q remoteip-caddy >/dev/null
	changed=1
fi

# Сайты: пересобрать sites.caddy и сравнить с текущим.
old=$(cat /etc/caddy/sites.caddy 2>/dev/null || true)
sh "$DIR/sites.sh" >/dev/null 2>&1
[ "$old" = "$(cat /etc/caddy/sites.caddy)" ] || changed=1

if [ "$changed" = 0 ]; then
	[ "${1:-}" = "--guard" ] || echo "nothing to do"
	exit 0
fi
apache2ctl configtest
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
systemctl reload apache2 || systemctl restart apache2
systemctl reload caddy 2>/dev/null || true
logger -t apache-behind-caddy "applied (#5573)"
echo "applied"
