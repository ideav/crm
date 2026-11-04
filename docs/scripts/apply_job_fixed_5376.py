#!/usr/bin/env python3
# «Зафиксировано» задания высечки (ideav/crm#5376): реквизит BOOLEAN у «Задания высечки»
# (docs/atex_p2_job_fixed_schema_5376.json, одним вызовом `_d_schema`). Колонку `fixed` отчёта
# `die_planning` после этого добавляет docs/scripts/create_report_die_planning_5320.py (идемпотентно).
# Идемпотентно: реквизит уже есть — `_d_schema` ничего не меняет.
#
# Запуск:
#   TOKEN=<X-Authorization> DB=https://ideav.ru/ateh1 python3 docs/scripts/apply_job_fixed_5376.py [--dry-run]

import os, sys, json, urllib.request, urllib.parse, urllib.error

DB = os.environ.get('DB', 'https://ideav.ru/ateh1').rstrip('/')
TOKEN = os.environ.get('TOKEN', '')
DRY = '--dry-run' in sys.argv
SCHEMA = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'atex_p2_job_fixed_schema_5376.json')
TABLE, FIELD = 'Задание высечки', 'Зафиксировано'


def req(method, path, fields=None):
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


def field_of(meta):
    t = next((x for x in meta if str(x.get('val', '')).strip() == TABLE), None)
    if not t:
        raise SystemExit(f'нет таблицы «{TABLE}»')
    f = next((r for r in t.get('reqs') or [] if str(r.get('val', '')).strip() == FIELD), None)
    return t, f


def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    if not TOKEN:
        raise SystemExit('нет TOKEN')
    t, f = field_of(req('GET', 'metadata?JSON=1'))
    print(f'«{TABLE}» (id {t["id"]}): «{FIELD}» — ' + (f'есть (id {f["id"]}, тип {f.get("type")})' if f else 'нет'))
    if f or DRY:
        return
    spec = json.load(open(SCHEMA, encoding='utf-8'))
    xsrf = req('GET', 'xsrf?JSON=1').get('_xsrf', '')
    res = req('POST', '_d_schema?JSON', {'json': json.dumps(spec, ensure_ascii=False), 'token': TOKEN, '_xsrf': xsrf})
    print(json.dumps(res, ensure_ascii=False))
    if not res.get('ok'):
        raise SystemExit('_d_schema отказал; база не менялась, если ответ 400')
    t, f = field_of(req('GET', 'metadata?JSON=1'))
    print(f'после: «{FIELD}» — ' + (f'есть (id {f["id"]}, тип {f.get("type")})' if f else 'НЕТ'))


if __name__ == '__main__':
    main()
