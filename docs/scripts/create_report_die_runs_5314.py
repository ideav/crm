#!/usr/bin/env python3
# Отчёт `die_runs` — все движения пробега ножей одной выборкой (ideav/crm#5314).
#
# Зачем: «Движение пробега» подчинено «Ножу», а `object/` без родителя подчинённые записи
# не отдаёт. Рабочее место «Ножи и валы» (download/atex/js/dies.js) читает этот отчёт один
# раз и считает пробег каждого ножа (`dieMileageIndex` в label-production.js): сумма
# движений за всю жизнь ножа. С фильтром FR_die_id — история одного ножа.
#
# Колонки (t100 → источник):
#   run_id    — id записи «Движение пробега» (abn_ID)
#   run_date  — главное значение записи (DATETIME)
#   die_id    — id ножа (вышестоящая запись, abn_ID) — по нему FR_-фильтр
#   die_no    — номер ножа (главное значение «Ножа»)
#   run_kind  — Вид движения пробега
#   meters    — Метры пробега
#   job_id    — id задания высечки (abn_ID)
#   operator  — Оператор
#
# ID реквизитов не хардкодятся — резолвятся по именам (псевдоним или имя типа) из живого
# GET metadata?JSON. Идемпотентно: отчёт с таким именем дополняется недостающими колонками.
#
# Запуск:
#   TOKEN=<X-Authorization> DB=https://ideav.ru/ateh1 python3 docs/scripts/create_report_die_runs_5314.py [--dry-run]
#
# Соглашения конструктора (docs/integram-reports.md §5, create_slitter_reports.py):
#   POST _m_new/22?JSON&up=1          t22=<имя>            → { id: queryId }
#   POST _m_new/28?JSON&up=queryId    t28=<tableId|reqId>  t100=<имя колонки>
#   POST _m_set/<colId>?JSON          t104=85 (abn_ID)

import os, sys, json, urllib.request, urllib.parse, urllib.error

DB = os.environ.get('DB', 'https://ideav.ru/ateh1').rstrip('/')
TOKEN = os.environ.get('TOKEN', '')
DRY = '--dry-run' in sys.argv
REPORT = 'die_runs'
BASE = 'Движение пробега'
PARENT = 'Нож'
ABN_ID = 85

# (t100, источник, t104): источник — ('table', имя) или ('req', имя реквизита базы)
COLS = [
    ('run_id', ('table', BASE), ABN_ID),
    ('run_date', ('table', BASE), None),
    ('die_id', ('table', PARENT), ABN_ID),
    ('die_no', ('table', PARENT), None),
    ('run_kind', ('req', 'Вид движения пробега'), None),
    ('meters', ('req', 'Метры пробега'), None),
    ('job_id', ('req', 'Задание высечки'), ABN_ID),
    ('operator', ('req', 'Оператор'), None),
]

XSRF = ''


def _req(method, path, fields=None):
    data = urllib.parse.urlencode(fields).encode() if fields is not None else None
    headers = {'X-Authorization': TOKEN, 'Accept': 'application/json'}
    r = urllib.request.Request(f'{DB}/{path}', data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
            body = resp.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', 'replace')
    try:
        return json.loads(body)
    except ValueError:
        raise SystemExit(f'{method} {path}: не JSON: {body[:300]}')


def get(path):
    return _req('GET', path)


def post(path, fields):
    return _req('POST', path, dict(fields, _xsrf=XSRF))


def norm(s):
    return str(s or '').strip().lower()


def alias_of(e):
    fa = e.get('field_attrs') or {}
    if fa.get('alias'):
        return fa['alias']
    if e.get('alias'):
        return e['alias']
    try:
        return (json.loads(e.get('attrs') or '{}') or {}).get('alias') or ''
    except ValueError:
        return ''


def find(entries, name):
    for e in entries:
        if norm(alias_of(e)) == norm(name):
            return e
    for e in entries:
        if norm(e.get('val')) == norm(name):
            return e
    raise SystemExit(f'не найдено: «{name}»')


def main():
    global XSRF
    if not TOKEN:
        raise SystemExit('Нужен TOKEN=<X-Authorization>')
    meta = get('metadata?JSON')
    base = find(meta, BASE)
    plan = []
    for t100, (kind, name), fn in COLS:
        t28 = find(meta, name)['id'] if kind == 'table' else find(base.get('reqs') or [], name)['id']
        plan.append((t100, str(t28), fn))

    reports = get('object/22/?JSON_OBJ&LIMIT=0,5000') or []
    qid = next((str(r['i']) for r in reports if str((r.get('r') or [''])[0]).strip() == REPORT), None)
    have = set()
    if qid:
        rpt = get(f'report/{qid}?JSON=1')
        have = {str(c.get('name') or c.get('val') or '').strip() for c in (rpt.get('columns') or [])}
    todo = [c for c in plan if c[0] not in have]
    print(f'{REPORT}: ' + (f'есть (queryId={qid})' if qid else 'нет — будет создан') +
          f', колонок к созданию: {len(todo)}')
    for t100, t28, fn in todo:
        print(f'  + {t100} t28={t28}' + (f' t104={fn}' if fn else ''))
    if DRY:
        print('Сухой прогон: ничего не записано.')
        return
    XSRF = get('xsrf?JSON')['_xsrf']
    if not qid:
        qid = str(post('_m_new/22?JSON&up=1', {'t22': REPORT}).get('id'))
        print(f'  → queryId={qid}')
    for t100, t28, fn in todo:
        created = post(f'_m_new/28?JSON&up={qid}', {'t28': t28, 't100': t100})
        cid = str(created.get('id') or created.get('obj'))
        if fn:
            post(f'_m_set/{cid}?JSON', {'t104': str(fn)})
    rows = get(f'report/{REPORT}?JSON_KV&LIMIT=0,3')
    print(f'report/{REPORT}: {json.dumps(rows, ensure_ascii=False)[:600]}')


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()
