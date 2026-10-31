#!/usr/bin/env python3
# Отчёт `label_positions` — позиции заказов этикетки одной выборкой (ideav/crm#5324).
#
# Зачем: «Заказанное количество» подчинено «Заказу», а `object/` без родителя подчинённые
# записи не отдаёт. Рабочее место «Заказы этикетки» (download/atex-p2/js/label-orders.js)
# показывает этот отчёт гридом integram-table и читает его для подбора ножей.
# Отбор «Вид продукции = этикетка» — в определении отчёта («Значение (от)» колонки
# «Вид продукции»): позиции рулонов Фазы 1 в выборку не попадают.
#
# Колонки (t100 → источник); *_id — abn_ID, грид их скрывает:
#   position_id, Рулонов            — запись «Заказанного количества» и её главное значение
#   Заказ, order_id, Клиент         — вышестоящий «Заказ», его номер и клиент
#   остальные                       — реквизиты позиции
#
# ID реквизитов не хардкодятся — резолвятся по именам (псевдоним или имя типа) из живого
# GET metadata?JSON. Идемпотентно: отчёт с таким именем дополняется недостающими колонками.
#
# Запуск:
#   TOKEN=<X-Authorization> DB=https://ideav.ru/ateh1 python3 docs/scripts/create_report_label_positions_5324.py [--dry-run]
#
# Соглашения конструктора (docs/integram-reports.md §5):
#   POST _m_new/22?JSON&up=1          t22=<имя>            → { id: queryId }
#   POST _m_new/28?JSON&up=queryId    t28=<tableId|reqId>  t100=<имя колонки>
#   POST _m_set/<colId>?JSON          t104=85 (abn_ID), t102=<значение от> (отбор)

import os, sys, json, urllib.request, urllib.parse, urllib.error

DB = os.environ.get('DB', 'https://ideav.ru/ateh1').rstrip('/')
TOKEN = os.environ.get('TOKEN', '')
DRY = '--dry-run' in sys.argv
REPORT = 'label_positions'
BASE = 'Заказанное количество'
PARENT = 'Заказ'
ABN_ID = 85
KIND = 'этикетка'

# (t100, источник, t104, t102): источник — ('table', имя), ('req', реквизит позиции)
# или ('preq', реквизит заказа)
COLS = [
    ('position_id', ('table', BASE), ABN_ID, None),
    ('Заказ', ('table', PARENT), None, None),
    ('order_id', ('table', PARENT), ABN_ID, None),
    ('Клиент', ('preq', 'Клиент'), None, None),
    ('Заказ клиента', ('req', 'Заказ клиента'), None, None),
    ('Артикул', ('req', 'Артикул'), None, None),
    ('Ширина, мм', ('req', 'Ширина этикетки, мм'), None, None),
    ('Длина, мм', ('req', 'Длина этикетки, мм'), None, None),
    ('Ручьёв', ('req', 'Ручьёв в заказе'), None, None),
    ('Шт в рулоне', ('req', 'Этикеток в рулоне'), None, None),
    ('Рулонов', ('table', BASE), None, None),
    ('Сырьё', ('req', 'Сырьё этикетки'), None, None),
    ('material_id', ('req', 'Сырьё этикетки'), ABN_ID, None),
    ('Тип ножей', ('req', 'Тип ножей'), None, None),
    ('Нож', ('req', 'Нож'), None, None),
    ('die_id', ('req', 'Нож'), ABN_ID, None),
    ('Подбор ножа', ('req', 'Подбор ножа'), None, None),
    ('Мин. партия', ('req', 'Мин. партия, шт'), None, None),
    ('ИТС нужен', ('req', 'Нужно подтверждение ИТС'), None, None),
    ('ИТС подтв.', ('req', 'Подтверждено ИТС'), None, None),
    ('Втулка, мм', ('req', 'Ширина втулки, мм'), None, None),
    ('Диаметр втулки', ('req', 'Диаметр втулки'), None, None),
    ('sleeve_id', ('req', 'Диаметр втулки'), ABN_ID, None),
    ('Намотка', ('req', 'Тип намотки'), None, None),
    ('Срок', ('req', 'Срок изготовления'), None, None),
    ('Статус', ('req', 'Статус позиции'), None, None),
    ('Примечание', ('req', 'Примечание'), None, None),
    ('product_kind', ('req', 'Вид продукции'), None, KIND),
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
    parent = find(meta, PARENT)
    plan = []
    for t100, (kind, name), fn, flt in COLS:
        if kind == 'table':
            t28 = find(meta, name)['id']
        elif kind == 'preq':
            t28 = find(parent.get('reqs') or [], name)['id']
        else:
            t28 = find(base.get('reqs') or [], name)['id']
        plan.append((t100, str(t28), fn, flt))

    reports = get('object/22/?JSON_OBJ&LIMIT=0,5000') or []
    qid = next((str(r['i']) for r in reports if str((r.get('r') or [''])[0]).strip() == REPORT), None)
    have = set()
    if qid:
        rpt = get(f'report/{qid}?JSON=1')
        have = {str(c.get('name') or c.get('val') or '').strip() for c in (rpt.get('columns') or [])}
    todo = [c for c in plan if c[0] not in have]
    print(f'{REPORT}: ' + (f'есть (queryId={qid})' if qid else 'нет — будет создан') +
          f', колонок к созданию: {len(todo)}')
    for t100, t28, fn, flt in todo:
        print(f'  + {t100} t28={t28}' + (f' t104={fn}' if fn else '') + (f' t102={flt}' if flt else ''))
    if DRY:
        print('Сухой прогон: ничего не записано.')
        return
    XSRF = get('xsrf?JSON')['_xsrf']
    if not qid:
        qid = str(post('_m_new/22?JSON&up=1', {'t22': REPORT}).get('id'))
        print(f'  → queryId={qid}')
    for t100, t28, fn, flt in todo:
        created = post(f'_m_new/28?JSON&up={qid}', {'t28': t28, 't100': t100})
        cid = str(created.get('id') or created.get('obj'))
        extra = {}
        if fn:
            extra['t104'] = str(fn)
        if flt:
            extra['t102'] = flt
        if extra:
            post(f'_m_set/{cid}?JSON', extra)
    rows = get(f'report/{REPORT}?JSON_KV&LIMIT=0,3')
    print(f'report/{REPORT}: {json.dumps(rows, ensure_ascii=False)[:800]}')


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()
