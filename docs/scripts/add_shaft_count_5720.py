#!/usr/bin/env python3
# Сколько валов одного номера в цехе (ideav/crm#5720): реквизит «Количество» у «Вала».
#   Планирование высечки не ставит один вал на два станка одновременно; валов номера — столько,
#   сколько записано в «Количество» (пусто — один; в цехе от 1 до 4, реже больше).
#   Тип «Количество» берётся существующий (по имени; `_d_new` идемпотентен), реквизит — `_d_req`
#   (идемпотентен по типу). Значения скрипт не пишет: их вносит владелец по каждому номеру вала.
#   Печатает БЫЛО → СТАЛО по реквизиту и текущие значения по валам.
#
# Запуск:
#   TOKEN=<X-Authorization> DB=https://ideav.ru/ateh1 python3 docs/scripts/add_shaft_count_5720.py [--dry-run]

import os, sys, json, urllib.request, urllib.parse, urllib.error

DB = os.environ.get('DB', 'https://ideav.ru/ateh1').rstrip('/')
TOKEN = os.environ.get('TOKEN', '')
DRY = '--dry-run' in sys.argv
CYLINDER, FIELD = 'Вал', 'Количество'
NUMBER = '13'   # базовый тип NUMBER


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


def table(meta, name):
    t = next((x for x in meta if str(x.get('val', '')).strip() == name and x.get('reqs') is not None), None)
    t = t or next((x for x in meta if str(x.get('val', '')).strip() == name), None)
    if not t:
        raise SystemExit(f'нет таблицы «{name}»')
    return t


def field_of(t, name):
    for r in t.get('reqs') or []:
        alias = str((r.get('field_attrs') or {}).get('alias') or '').strip()
        if str(r.get('val', '')).strip() == name or alias == name:
            return str(r['id'])
    return ''


def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    if not TOKEN:
        raise SystemExit('нет TOKEN')
    meta = req('GET', 'metadata?JSON=1')
    cyl = table(meta, CYLINDER)
    rid = field_of(cyl, FIELD)
    print(f'«{CYLINDER}» ({cyl["id"]}) · реквизит «{FIELD}»: БЫЛО {"есть (" + rid + ")" if rid else "нет"} → СТАЛО есть')
    if not rid and not DRY:
        xsrf = req('GET', 'xsrf?JSON=1').get('_xsrf', '')
        typ = req('POST', '_d_new?JSON=1', {'t': NUMBER, 'val': FIELD, '_xsrf': xsrf})
        type_id = str(typ.get('obj') or '')
        if not type_id:
            raise SystemExit(f'_d_new «{FIELD}»: {typ}')
        res = req('POST', f'_d_req/{cyl["id"]}?JSON=1', {'t': type_id, '_xsrf': xsrf})
        rid = str(res.get('id') or '')
        if not rid:
            raise SystemExit(f'_d_req: {res}')
        print(f'  создан реквизит {rid} (тип {type_id})')
    listing = req('GET', f'object/{cyl["id"]}/?JSON_KV&LIMIT=0,500')
    vals = listing.get('reqs') or {}
    for o in listing.get('object') or []:
        v = str((vals.get(str(o['id'])) or {}).get(rid, '')).strip() if rid else ''
        print(f'  вал {o["val"]}: «{FIELD}» = «{v}»' + ('' if v else ' (пусто — один вал)'))
    if DRY:
        print('Сухой прогон: ничего не записано.')


if __name__ == '__main__':
    main()
