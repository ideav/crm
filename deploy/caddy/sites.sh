#!/bin/sh
# Собирает /etc/caddy/sites.caddy из вхостов ispmanager (#5573, docs/custom-domain.md).
# Для каждого <VirtualHost …:443>: имена ServerName/ServerAlias, сертификат = SSLCertificateFile
# (+ SSLCertificateChainFile, если задан) и ключ — копируются в /etc/caddy/certs/.
# Вхост только с :80 получает блок http://. Порты за Caddy (8443/8080, apache-behind-caddy.sh) —
# те же 443/80: сторож пересобирает список уже после переключения. Запуск: после правок в панели и по таймеру продления.
set -eu
VHOSTS=${VHOSTS:-/etc/apache2/vhosts}
OUT=${OUT:-/etc/caddy/sites.caddy}
CERTS=${CERTS:-/etc/caddy/certs}
mkdir -p "$CERTS"
tmp=$(mktemp)
for f in "$VHOSTS"/*/*.conf; do
	awk -v certs="$CERTS" '
	function flush() {
		if (names == "") return
		if ((port == "443" || port == "8443") && crt != "" && key != "") {
			pem = certs "/" first ".pem"; k = certs "/" first ".key"
			printf "%s|%s|%s|%s|%s|%s\n", "tls", names, crt, chain, key, first
		} else if (port == "80" || port == "8080") {
			printf "%s|%s\n", "http", names
		}
	}
	/<VirtualHost/ { match($0, /:[0-9]+>/); port = substr($0, RSTART + 1, RLENGTH - 2); names = ""; first = ""; crt = ""; chain = ""; key = "" }
	/^[ \t]*ServerName[ \t]/ { first = $2; names = (names == "" ? $2 : names ", " $2) }
	/^[ \t]*ServerAlias[ \t]/ { for (i = 2; i <= NF; i++) names = (names == "" ? $i : names ", " $i) }
	/^[ \t]*SSLCertificateFile[ \t]/ { crt = $2; gsub(/"/, "", crt) }
	/^[ \t]*SSLCertificateChainFile[ \t]/ { chain = $2; gsub(/"/, "", chain) }
	/^[ \t]*SSLCertificateKeyFile[ \t]/ { key = $2; gsub(/"/, "", key) }
	/<\/VirtualHost>/ { flush(); names = "" }
	' "$f"
done | sort -u > "$tmp.list"

# Хосты с :443 — блок с сертификатом; хосты только с :80 — блок http://.
: > "$tmp"
grep '^tls|' "$tmp.list" | while IFS='|' read -r _ names crt chain key first; do
	pem="$CERTS/$first.pem"
	if [ -n "$chain" ] && [ -f "$chain" ]; then { cat "$crt"; echo; cat "$chain"; echo; } > "$pem.all"; else { cat "$crt"; echo; } > "$pem.all"; fi
	# Caddy ждёт сертификат сайта первым, а файлы ispmanager бывают без перевода строки в конце и с цепочкой в любом порядке.
	# Раскладываем цепочку по одному сертификату: без CA:TRUE — в начало, остальные — следом.
	rm -f "$pem.part"*
	awk -v p="$pem.part" '/BEGIN CERTIFICATE/{n++} n{print > (p n)}' "$pem.all"
	: > "$pem"
	for c in "$pem.part"*; do openssl x509 -in "$c" -noout -text | grep -q "CA:TRUE" || cat "$c" >> "$pem"; done
	for c in "$pem.part"*; do openssl x509 -in "$c" -noout -text | grep -q "CA:TRUE" && cat "$c" >> "$pem"; done
	rm -f "$pem.part"* "$pem.all"
	install -m 600 "$key" "$CERTS/$first.key"
	# Только имена из сертификата: на остальные Caddy стал бы выпускать свой (www.<технический хост>).
	san=$(openssl x509 -in "$pem" -noout -ext subjectAltName 2>/dev/null | tr ',' '\n' | sed -n 's/.*DNS://p' | tr -d ' ')
	keep=""
	for n in $(echo "$names" | tr ',' ' '); do
		if echo "$san" | grep -qx "$n"; then keep="${keep:+$keep, }$n"; else echo "skip $n: нет в сертификате $first" >&2; fi
	done
	[ -n "$keep" ] || continue
	printf '%s {\n\ttls %s %s\n\timport apache\n}\n\n' "$keep" "$pem" "$CERTS/$first.key" >> "$tmp"
done
tlsnames=$(grep '^tls|' "$tmp.list" | cut -d'|' -f2 | tr ',' '\n' | tr -d ' ' | sort -u)
grep '^http|' "$tmp.list" | while IFS='|' read -r _ names; do
	first=$(echo "$names" | cut -d, -f1 | tr -d ' ')
	echo "$tlsnames" | grep -qx "$first" && continue
	hn=$(echo "$names" | sed 's/\([^, ][^,]*\)/http:\/\/\1/g')
	printf '%s {\n\timport apache_http\n}\n\n' "$hn" >> "$tmp"
done
chown -R caddy:caddy "$CERTS" 2>/dev/null || true
# Ни одного сайта — разбор вхостов сломался: прежний список не трогаем, иначе сторож снял бы все сайты.
if ! grep -q '{$' "$tmp"; then
	rm -f "$tmp" "$tmp.list"
	echo "sites.sh: в $VHOSTS не найдено ни одного сайта, $OUT не изменён" >&2
	exit 1
fi
mv "$tmp" "$OUT"
chmod 644 "$OUT"   # mktemp создаёт 600, а Caddy работает от пользователя caddy
rm -f "$tmp.list"
echo "sites.caddy: $(grep -c '{$' "$OUT") blocks"
