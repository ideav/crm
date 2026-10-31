#!/usr/bin/env python3
# «Событие смены высечки» — самостоятельная таблица (ideav/crm#5330, решение владельца по #5328 п.2/п.3).
#
# Что делает (повторный запуск ничего не дублирует):
#   1. снимает табличную часть «Событие смены высечки» у «Задания высечки» (_d_del_req) — если у
#      события есть записи, подчинённые заданию, останавливается: их сначала надо перенести;
#   2. накатывает таблицу «Событие смены высечки» из docs/atex_phase2_schema.json (_d_schema):
#      ссылки «Задание высечки», «Станок высечки», число «Длительность наладки, мин»;
#   3. заводит в «Тип события высечки» недостающие «Начало смены», «Конец смены», «Наладка»,
#      «Наладка завершена».
#
# Запуск (только база Фазы 2):
#   TOKEN=<X-Authorization> DB=https://ideav.ru/ateh1 python3 docs/scripts/migrate_die_cutter_events_5330.py [--dry-run]

import os, sys, json, urllib.request, urllib.parse, urllib.error

DB = os.environ.get('DB', 'https://ideav.ru/ateh1').rstrip('/')
TOKEN = os.environ.get('TOKEN', '')
DRY = '--dry-run' in sys.argv
SCHEMA = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'atex_phase2_schema.json')
JOB, EVENT, TYPE = 'Задание высечки', 'Событие смены высечки', 'Тип события высечки'
NEW_TYPES = ['Начало смены', 'Конец смены', 'Наладка', 'Наладка завершена']
XSRF = ''


def call(method, path, fields=None):
    if fields is not None:
        fields = dict(fields, _xsrf=XSRF)
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
    hit = [t for t in meta if str(t.get('val', '')).strip().lower() == name.lower()]
    if not hit:
        raise SystemExit(f'в базе нет таблицы «{name}»')
    return hit[0]


def main():
    global XSRF
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    if not TOKEN:
        raise SystemExit('нет TOKEN')
    XSRF = call('GET', 'xsrf?JSON=1').get('_xsrf', '')
    meta = call('GET', 'metadata?JSON=1')
    job, ev, typ = table(meta, JOB), table(meta, EVENT), table(meta, TYPE)

    # 1. табличная часть у задания
    arr = [r for r in job.get('reqs') or [] if str(r.get('arr_id') or '') == str(ev['id'])]
    if arr:
        rows = call('GET', f'object/{ev["id"]}/?JSON_KV&LIMIT=0,100000')
        under_job = [o for o in (rows.get('object') or []) if str(o.get('up')) not in ('1', '0', '')]
        if under_job:
            raise SystemExit(f'у «{EVENT}» {len(under_job)} записей под заданиями — сначала перенести')
        print(f'  снять табличную часть: реквизит {arr[0]["id"]} у «{JOB}»')
        if not DRY:
            print('   ', call('POST', f'_d_del_req/{arr[0]["id"]}?JSON=1', {'forced': '1'}))
    else:
        print('  табличной части уже нет')

    # 2. поля события по декларации
    with open(SCHEMA, encoding='utf-8') as f:
        decl = [t for t in json.load(f)['tables'] if t['name'] == EVENT]
    if not decl:
        raise SystemExit(f'в {SCHEMA} нет таблицы «{EVENT}» верхнего уровня')
    print('  _d_schema:', ', '.join(x['name'] for x in decl[0]['fields']))
    if not DRY:
        res = call('POST', '_d_schema?JSON', {'json': json.dumps({'tables': decl}, ensure_ascii=False)})
        if not res.get('ok'):
            print(json.dumps(res, ensure_ascii=False, indent=1))
            raise SystemExit('_d_schema отказал')
        print(f'   создано {res.get("created")}, обновлено {res.get("updated")}, было {res.get("existing")}')

    # 3. типы событий
    have = {str(o.get('val', '')).strip().lower() for o in (call('GET', f'object/{typ["id"]}/?JSON_KV&LIMIT=0,1000').get('object') or [])}
    for name in NEW_TYPES:
        if name.lower() in have:
            continue
        print(f'  тип события «{name}»')
        if not DRY:
            res = call('POST', f'_m_new/{typ["id"]}?JSON=1', {'up': '1', f't{typ["id"]}': name})
            if not (isinstance(res, dict) and (res.get('id') or res.get('obj'))):
                raise SystemExit(f'«{name}» не записан: {res}')


if __name__ == '__main__':
    main()
