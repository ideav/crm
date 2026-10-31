#!/usr/bin/env python3
# Отчёты раскроя джамбо (ideav/crm#5315, шаг 6 Фазы 2 atex):
#
#   die_tasks   — задания высечки плоско: формат ножа (мин/опт/исп), сырьё позиции, метраж,
#                 план-старт, статус, мастер-рулон. Из них «Раскрой джамбо» считает
#                 потребность в форматах: сырьё лежит у позиции заказа (подчинённой заказу),
#                 формат — у ножа, и одним чтением object/ их не собрать.
#   jumbo_tasks — полосы раскроя всех заданий первичной резки: «Полоса раскроя» подчинена
#                 заданию, а object/ без родителя подчинённые записи не отдаёт.
#
# ID реквизитов не хардкодятся — резолвятся по именам (псевдоним или имя типа) из живого
# GET metadata?JSON. Идемпотентно: отчёт с таким именем дополняется недостающими колонками.
#
# Запуск:
#   TOKEN=<X-Authorization> DB=https://ideav.ru/ateh1 python3 docs/scripts/create_reports_jumbo_5315.py [--dry-run]
#
# Соглашения конструктора (docs/kb/report-building.md):
#   POST _m_new/22?JSON&up=1          t22=<имя>            → { id: queryId }
#   POST _m_new/28?JSON&up=queryId    t28=<tableId|reqId>  t100=<имя колонки>
#   POST _m_set/<colId>?JSON          t104=85 (abn_ID)

import os, sys, json, urllib.request, urllib.parse, urllib.error

DB = os.environ.get('DB', 'https://ideav.ru/ateh1').rstrip('/')
TOKEN = os.environ.get('TOKEN', '')
DRY = '--dry-run' in sys.argv
ABN_ID = 85

JOB = 'Задание высечки'
POS = 'Заказанное количество'
DIE = 'Нож'
CUT = 'Задание первичной резки'
STRIP = 'Полоса раскроя'

# Колонка: (t100, источник, t104). Источник — ('table', имя) или ('req', таблица, реквизит).
# Первая колонка задаёт главную таблицу отчёта.
REPORTS = {
    'die_tasks': [
        ('job_id', ('table', JOB), ABN_ID),
        ('job_start', ('table', JOB), None),
        ('job_status', ('req', JOB, 'Статус задания этикетки'), None),
        ('footage', ('req', JOB, 'Метраж, м'), None),
        ('master_roll_id', ('req', JOB, 'Мастер-рулон'), ABN_ID),
        ('machine', ('req', JOB, 'Станок высечки'), None),
        ('position_id', ('req', JOB, 'Позиция заказа'), ABN_ID),
        ('die_id', ('req', JOB, 'Нож'), ABN_ID),
        ('die_no', ('table', DIE), None),
        ('min_format', ('req', DIE, 'Минимальный формат, мм'), None),
        ('opt_format', ('req', DIE, 'Оптимальный формат, мм'), None),
        ('used_format', ('req', DIE, 'Исп. формат, мм'), None),
        ('material_id', ('req', POS, 'Сырьё этикетки'), ABN_ID),
        ('material', ('req', POS, 'Сырьё этикетки'), None),
    ],
    'jumbo_tasks': [
        ('strip_id', ('table', STRIP), ABN_ID),
        ('strip_format', ('table', STRIP), None),
        ('strip_count', ('req', STRIP, 'Количество полос'), None),
        ('strip_purpose', ('req', STRIP, 'Назначение полосы'), None),
        ('job_id', ('table', CUT), ABN_ID),
    ],
}

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


def source_id(meta, src):
    if src[0] == 'table':
        return str(find(meta, src[1])['id'])
    return str(find(find(meta, src[1]).get('reqs') or [], src[2])['id'])


def ensure(meta, reports, name, cols):
    plan = [(t100, source_id(meta, src), fn) for t100, src, fn in cols]
    qid = next((str(r['i']) for r in reports if str((r.get('r') or [''])[0]).strip() == name), None)
    have = set()
    if qid:
        rpt = get(f'report/{qid}?JSON=1')
        have = {str(c.get('name') or c.get('val') or '').strip() for c in (rpt.get('columns') or [])}
    todo = [c for c in plan if c[0] not in have]
    print(f'{name}: ' + (f'есть (queryId={qid})' if qid else 'нет — будет создан') +
          f', колонок к созданию: {len(todo)}')
    for t100, t28, fn in todo:
        print(f'  + {t100} t28={t28}' + (f' t104={fn}' if fn else ''))
    if DRY:
        return
    if not qid:
        qid = str(post('_m_new/22?JSON&up=1', {'t22': name}).get('id'))
        print(f'  → queryId={qid}')
    for t100, t28, fn in todo:
        created = post(f'_m_new/28?JSON&up={qid}', {'t28': t28, 't100': t100})
        cid = str(created.get('id') or created.get('obj'))
        if fn:
            post(f'_m_set/{cid}?JSON', {'t104': str(fn)})
    rows = get(f'report/{name}?JSON_KV&LIMIT=0,3')
    print(f'report/{name}: {json.dumps(rows, ensure_ascii=False)[:600]}')


def main():
    global XSRF
    if not TOKEN:
        raise SystemExit('Нужен TOKEN=<X-Authorization>')
    meta = get('metadata?JSON')
    reports = get('object/22/?JSON_OBJ&LIMIT=0,5000') or []
    if not DRY:
        XSRF = get('xsrf?JSON')['_xsrf']
    for name, cols in REPORTS.items():
        ensure(meta, reports, name, cols)
    if DRY:
        print('Сухой прогон: ничего не записано.')


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()
