#!/usr/bin/env python3
# Пульт высечки: «Простой» и выбор мастер-рулона (ideav/crm#5339). Повторный запуск ничего не дублирует.
#
# Что делает:
#   1. накатывает `_d_schema` по таблице «Событие смены высечки» из docs/atex_phase2_schema.json:
#      числовое поле «Длительность, мин» — минуты события «Простой»;
#   2. накатывает права docs/atex_p2_die_cutter_roll_5339.json: роль «Оператор» пишет ссылку
#      «Задание высечки» у «Мастер-рулона» (выбор рулона в пульте = резерв рулона под задание).
#
# Запуск (только база Фазы 2):
#   TOKEN=<X-Authorization> DB=https://ideav.ru/ateh1 python3 docs/scripts/migrate_die_cutter_5339.py [--dry-run]

import os, sys, json, urllib.request, urllib.parse, urllib.error

DB = os.environ.get('DB', 'https://ideav.ru/ateh1').rstrip('/')
TOKEN = os.environ.get('TOKEN', '')
DRY = '--dry-run' in sys.argv
HERE = os.path.dirname(os.path.abspath(__file__))
SCHEMA = os.path.join(HERE, '..', 'atex_phase2_schema.json')
GRANTS = os.path.join(HERE, '..', 'atex_p2_die_cutter_roll_5339.json')
EVENT = 'Событие смены высечки'


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


def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    with open(SCHEMA, encoding='utf-8') as f:
        decl = [t for t in json.load(f)['tables'] if t['name'] == EVENT]
    if not decl:
        raise SystemExit(f'в {SCHEMA} нет таблицы «{EVENT}»')
    with open(GRANTS, encoding='utf-8') as f:
        grants = json.load(f)
    print('  _d_schema:', ', '.join(x['name'] for x in decl[0]['fields']))
    for role in grants['roles']:
        for g in role['grants']:
            print(f"  {role['name']}: {g['table']} → {g.get('field', '')} {g['level']}")
    if DRY:
        return
    if not TOKEN:
        raise SystemExit('нет TOKEN')
    xsrf = call('GET', 'xsrf?JSON=1').get('_xsrf', '')
    for spec in ({'tables': decl}, grants):
        res = call('POST', '_d_schema?JSON', {'json': json.dumps(spec, ensure_ascii=False), '_xsrf': xsrf})
        print(json.dumps(res, ensure_ascii=False))
        if not res.get('ok'):
            raise SystemExit('_d_schema отказал')


if __name__ == '__main__':
    main()
