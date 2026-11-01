#!/bin/bash
# «Упаковка этикетки» (ideav/crm#5348): правка ТОЛЬКО серверного templates/custom/ateh1/main.html базы ateh1
# (общий templates/main.html и templates/atex/* не меняются). Идемпотентно; перед правкой - бэкап.
#   1. 'label-packer' - в FULLSCREEN_ACTIONS: пульт без левого меню (#4783 п.2);
#   2. pad-home.js получает для label-packer действие 'packer': планшет упаковочного места открывается
#      и в «Упаковке», и в «Упаковке этикетки» (без этого pad-home.js уводит оператора на /packer,
#      потому что pad-guard.js знает у места одно рабочее место).
# Запуск на сервере: bash patch_ateh1_main_label_packer_5348.sh [/путь/к/main.html]
set -e
F="${1:-/var/www/www-root/data/www/ideav.ru/templates/custom/ateh1/main.html}"
BAK="/root/bak-5348-$(date +%F)"
mkdir -p "$BAK"
[ -f "$BAK/main.html" ] || cp -p "$F" "$BAK/main.html"
if ! grep -q "'label-packer'\]" "$F"; then
  sed -i "s/\['slitter', 'packer', 'sleeve-cutter', 'die-cutter'\]/['slitter', 'packer', 'sleeve-cutter', 'die-cutter', 'label-packer']/" "$F"
fi
if ! grep -q "PAD_HOME_ACTION" "$F"; then
  sed -i "s/home.setAttribute('data-pad-action', action);/var PAD_HOME_ACTION = { 'label-packer': 'packer' };\n                home.setAttribute('data-pad-action', PAD_HOME_ACTION[action] || action);/" "$F"
fi
grep -n "label-packer\|PAD_HOME_ACTION" "$F"
