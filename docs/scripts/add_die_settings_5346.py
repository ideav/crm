#!/usr/bin/env python3
# Нормы наладки и скорости высечки по листу «План» заказчика (ideav/crm#5346), «Настройка» (269):
#   DIE_SLEEVE_CHANGE_MN=20   смена втулки при том же вале и ноже, мин
#   DIE_SPEED_SHORT_M_MIN=28  скорость вырубки коротких роликов, м/мин
#   DIE_SHORT_ROLL_M=50       ролик короче — короткий, м
#   DIE_KNIFE_CHANGE_MN=60    смена ножа на том же валу (решение владельца 01.11.2026) — значение
#                             существующего ключа заменяется.
# Новые ключи создаются; существующий ключ из SET меняется, если значение другое.
#
# Запуск (только база Фазы 2):
#   TOKEN=<X-Authorization> DB=https://ideav.ru/ateh1 python3 docs/scripts/add_die_settings_5346.py [--dry-run]

import os, sys, json, urllib.request, urllib.parse, urllib.error

DB = os.environ.get('DB', 'https://ideav.ru/ateh1').rstrip('/')
TOKEN = os.environ.get('TOKEN', '')
DRY = '--dry-run' in sys.argv
TYPE = 'ATEH'

SETTINGS = [
    ('DIE_SLEEVE_CHANGE_MN', '20'),
    ('DIE_SPEED_SHORT_M_MIN', '28'),
    ('DIE_SHORT_ROLL_M', '50'),
]
SET = [
    ('DIE_KNIFE_CHANGE_MN', '60'),
]


def call(method, path, fields=None):
    data = urllib.parse.urlencode(fields).encode() if fields is not None else None
    r = urllib.request.Request(f'{DB}/{path}', data=data, method=method,
                               headers={'X-Authorization': TOKEN, 'Accept': 'application/json'})
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
            body = resp.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', 'replace')
    try:
        return json.loads(body)
    except ValueError:
        raise SystemExit(f'{method} {path}: не JSON: {body[:300]}')


def alias_of(e):
    fa = e.get('field_attrs') or {}
    return fa.get('alias') or e.get('alias') or ''


def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    if not TOKEN:
        raise SystemExit('нет TOKEN')
    meta = call('GET', 'metadata?JSON')
    table = next(t for t in meta if str(t.get('val')).strip() == 'Настройка')
    tid = str(table['id'])
    reqs = {(alias_of(r) or str(r.get('val'))).strip(): str(r['id']) for r in table.get('reqs', [])}
    t_type, t_val = reqs['Тип'], reqs['Значение']
    listing = call('GET', f'object/{tid}/?JSON_KV&LIMIT=0,5000')
    have = {str(o['val']).strip(): o for o in (listing.get('object') or [])}
    values = listing.get('reqs') or {}  # {id записи: {id реквизита: значение}}
    xsrf = '' if DRY else call('GET', 'xsrf?JSON=1').get('_xsrf', '')
    for key, value in SET:
        o = have.get(key)
        if not o:
            SETTINGS.append((key, value))
            continue
        cur = str((values.get(str(o['id'])) or {}).get(t_val, '')).strip()
        if cur == value:
            print(f'{key}: уже {value} (id {o["id"]})')
            continue
        print(f'{key}: {cur or "пусто"} -> {value}: ' + ('сухой прогон' if DRY else 'меняем'))
        if not DRY:
            res = call('POST', f'_m_set/{o["id"]}?JSON', {f't{t_val}': value, '_xsrf': xsrf})
            print('  ->', json.dumps(res, ensure_ascii=False))
    for key, value in SETTINGS:
        if key in have:
            print(f'{key}: уже есть (id {have[key]["id"]})')
            continue
        print(f'{key} = {value}: ' + ('сухой прогон' if DRY else 'создаём'))
        if DRY:
            continue
        res = call('POST', f'_m_new/{tid}?JSON&up=1', {f't{tid}': key, f't{t_type}': TYPE, f't{t_val}': value, '_xsrf': xsrf})
        print('  ->', json.dumps(res, ensure_ascii=False))


if __name__ == '__main__':
    main()
