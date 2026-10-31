#!/usr/bin/env python3
# Настройки планирования высечки (ideav/crm#5320): нормы и окно смены в «Настройке» (269).
# Ключи и значения по умолчанию - SETTINGS ниже; в коде рабочего места те же значения
# (download/atex-p2/js/die-planning-core.js, SETTING_KEYS), так что запись нужна для правки норм
# без выкладки кода. Код настройки (тип) - ATEH, как у остальных ключей Фазы 2.
# Идемпотентно: существующий ключ не трогается.
#
# Запуск (только база Фазы 2):
#   TOKEN=<X-Authorization> DB=https://ideav.ru/ateh1 python3 docs/scripts/add_die_settings_5320.py [--dry-run]

import os, sys, json, urllib.request, urllib.parse, urllib.error

DB = os.environ.get('DB', 'https://ideav.ru/ateh1').rstrip('/')
TOKEN = os.environ.get('TOKEN', '')
DRY = '--dry-run' in sys.argv
TYPE = 'ATEH'

SETTINGS = [
    ('DIE_CYLINDER_CHANGE_MN', '90'),   # смена вала, мин
    ('DIE_KNIFE_CHANGE_MN', '20'),      # смена ножа на том же валу, мин
    ('DIE_SPEED_M_MIN', '44'),          # скорость вырубки, м/мин (одна на все станки)
    ('DIE_DAY_START_MIN', '480'),       # начало смены, минут от полуночи (08:00)
    ('DIE_DAY_CAPACITY_MN', '455'),     # ёмкость смены, мин
    ('DIE_HORIZON_DAYS', '14'),         # горизонт плана для загрузки ножей и валов, дней
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
    have = {str(o['val']).strip(): o for o in (call('GET', f'object/{tid}/?JSON_KV&LIMIT=0,5000').get('object') or [])}
    xsrf = '' if DRY else call('GET', 'xsrf?JSON=1').get('_xsrf', '')
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
