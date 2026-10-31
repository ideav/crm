#!/usr/bin/env python3
# Права на рабочее место «Планирование высечки» (ideav/crm#5320): одним вызовом `_d_schema`
# накатывает docs/atex_p2_die_planning_grants_5320.json:
#   - Диспетчер: запись - задание высечки, «Задание высечки» в мастер-рулоне (резерв), движения
#     мастер-рулона, задачи на втулки; чтение - позиции и заказы, оснастка, сырьё, джамбо, настройки;
#   - Руководитель: чтение тех же таблиц.
# Повторный запуск ничего не дублирует (`_d_schema` находит существующее по имени).
#
# Запуск (только база Фазы 2):
#   TOKEN=<X-Authorization> DB=https://ideav.ru/ateh1 python3 docs/scripts/apply_die_planning_grants_5320.py [--dry-run]

import os, sys, json, urllib.request, urllib.parse, urllib.error

DB = os.environ.get('DB', 'https://ideav.ru/ateh1').rstrip('/')
TOKEN = os.environ.get('TOKEN', '')
DRY = '--dry-run' in sys.argv
SPEC = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'atex_p2_die_planning_grants_5320.json')


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
    with open(SPEC, encoding='utf-8') as f:
        spec = json.load(f)
    if DRY:
        for role in spec['roles']:
            for g in role['grants']:
                print(f"  {role['name']}: {g['table']}{' → ' + g['field'] if g.get('field') else ''} {g['level']}")
        return
    if not TOKEN:
        raise SystemExit('нет TOKEN')
    xsrf = call('GET', 'xsrf?JSON=1').get('_xsrf', '')
    res = call('POST', '_d_schema?JSON', {'json': json.dumps(spec, ensure_ascii=False), '_xsrf': xsrf})
    print(json.dumps(res, ensure_ascii=False, indent=1))
    if not res.get('ok'):
        raise SystemExit('_d_schema отказал — см. errors выше')


if __name__ == '__main__':
    main()
