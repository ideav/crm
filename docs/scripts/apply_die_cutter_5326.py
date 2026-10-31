#!/usr/bin/env python3
# Пульт высечки (ideav/crm#5326, шаг 8 Фазы 2 atex): схема ИТС, справочники и отчёты.
#
# Что делает (каждый шаг идемпотентен — повторный запуск ничего не дублирует):
#   1. структура: docs/atex_p2_die_cutter_schema_5326.json одним вызовом `_d_schema` —
#      справочник «Пункт чек-листа ИТС», подчинённая заданию высечки «Отметка чек-листа ИТС»,
#      «Вызов ИТС» (станок, задание, оператор, причина, статус);
#   2. пункты чек-листа ИТС из --checklist "пункт;пункт;…" (без ключа — не трогаются:
#      перечень даёт заказчик, #5318);
#   3. отчёты, которые читает download/atex-p2/js/die-cutter.js:
#        die_cutter_jobs — задания высечки плоско: станок, нож (ручьёв), вал, мастер-рулон
#                          (длина, остаток, формат), позиция и заказ (размер этикетки, сырьё);
#        die_cutter_runs — движения пробега всех ножей с id ножа и задания: «Движение
#                          пробега» подчинено ножу, object/ без родителя его не отдаёт.
#
# Запуск:
#   TOKEN=<X-Authorization> DB=https://ideav.ru/ateh1 python3 docs/scripts/apply_die_cutter_5326.py [--dry-run] [--checklist "…;…"]
#
# Конструктор отчётов (docs/kb/report-building.md):
#   POST _m_new/22?JSON&up=1          t22=<имя>            → { id: queryId }
#   POST _m_new/28?JSON&up=queryId    t28=<tableId|reqId>  t100=<имя колонки>
#   POST _m_set/<colId>?JSON          t104=85 (abn_ID)

import os, sys, json, urllib.request, urllib.parse, urllib.error

DB = os.environ.get('DB', 'https://ideav.ru/ateh1').rstrip('/')
TOKEN = os.environ.get('TOKEN', '')
DRY = '--dry-run' in sys.argv
SCHEMA = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'atex_p2_die_cutter_schema_5326.json')
ABN_ID = 85

JOB = 'Задание высечки'
POS = 'Заказанное количество'
ORDER = 'Заказ'
DIE = 'Нож'
RUN = 'Движение пробега'
MR = 'Мастер-рулон'

# Колонка: (t100, источник, t104). Источник — ('table', имя) или ('req', таблица, реквизит).
# Первая колонка задаёт главную таблицу отчёта.
REPORTS = {
    'die_cutter_jobs': [
        ('job_id', ('table', JOB), ABN_ID),
        ('job_start', ('table', JOB), None),
        ('job_status', ('req', JOB, 'Статус задания этикетки'), None),
        ('pulls_plan', ('req', JOB, 'Съёмов план'), None),
        ('pulls_fact', ('req', JOB, 'Съёмов факт'), None),
        ('footage', ('req', JOB, 'Метраж, м'), None),
        ('setup', ('req', JOB, 'Наладка, мин'), None),
        ('machine_id', ('req', JOB, 'Станок высечки'), ABN_ID),
        ('machine', ('req', JOB, 'Станок высечки'), None),
        ('die_id', ('req', JOB, 'Нож'), ABN_ID),
        ('die_no', ('req', JOB, 'Нож'), None),
        ('die_streams', ('req', DIE, 'Ручьёв'), None),
        ('cylinder_id', ('req', JOB, 'Вал'), ABN_ID),
        ('cylinder', ('req', JOB, 'Вал'), None),
        ('master_roll_id', ('req', JOB, 'Мастер-рулон'), ABN_ID),
        ('master_roll', ('req', JOB, 'Мастер-рулон'), None),
        ('roll_length', ('req', MR, 'Длина, м'), None),
        ('roll_rest', ('req', MR, 'Остаток, м'), None),
        ('roll_format', ('req', MR, 'Формат, мм'), None),
        ('position_id', ('req', JOB, 'Позиция заказа'), ABN_ID),
        ('order_no', ('table', ORDER), None),
        ('label_width', ('req', POS, 'Ширина этикетки, мм'), None),
        ('label_length', ('req', POS, 'Длина этикетки, мм'), None),
        ('labels_per_roll', ('req', POS, 'Этикеток в рулоне'), None),
        ('material', ('req', POS, 'Сырьё этикетки'), None),
    ],
    'die_cutter_runs': [
        ('run_id', ('table', RUN), ABN_ID),
        ('run_date', ('table', RUN), None),
        ('meters', ('req', RUN, 'Метры пробега'), None),
        ('kind', ('req', RUN, 'Вид движения пробега'), None),
        ('job_id', ('req', RUN, 'Задание высечки'), ABN_ID),
        ('die_id', ('table', DIE), ABN_ID),
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


# ── Шаг 1: структура ──────────────────────────────────────────────────────────
def apply_schema():
    with open(SCHEMA, encoding='utf-8') as f:
        spec = json.load(f)
    if DRY:
        print('  _d_schema: ' + ', '.join(t['name'] for t in spec['tables']))
        return
    res = post('_d_schema?JSON', {'json': json.dumps(spec, ensure_ascii=False)})
    if not res.get('ok'):
        print(json.dumps(res, ensure_ascii=False, indent=1))
        raise SystemExit('_d_schema отказал — см. errors выше')
    print(f'  создано {res.get("created")}, обновлено {res.get("updated")}, было {res.get("existing")}')
    for w in res.get('warnings') or []:
        print(f'  ⚠ {w}')


# ── Шаг 2: пункты чек-листа ───────────────────────────────────────────────────
def seed_checklist(meta, items):
    t = find(meta, 'Пункт чек-листа ИТС')
    d = get(f'object/{t["id"]}/?JSON_KV&LIMIT=0,500')
    have = {norm(o.get('val')) for o in (d.get('object') or [])}
    for name in items:
        if norm(name) in have:
            print(f'  ∙ «{name}» уже есть')
            continue
        print(f'  + «{name}»')
        if not DRY:
            post(f'_m_new/{t["id"]}?JSON&up=1', {f't{t["id"]}': name})


# ── Шаг 3: отчёты ─────────────────────────────────────────────────────────────
def ensure(meta, reports, name, cols):
    plan = [(t100, source_id(meta, src), fn) for t100, src, fn in cols]
    qid = next((str(r['i']) for r in reports if str((r.get('r') or [''])[0]).strip() == name), None)
    have = set()
    if qid:
        rpt = get(f'report/{qid}?JSON=1')
        have = {str(c.get('name') or c.get('val') or '').strip() for c in (rpt.get('columns') or [])}
    todo = [c for c in plan if c[0] not in have]
    print(f'{name}: ' + (f'есть (queryId={qid})' if qid else 'нет — будет создан') + f', колонок к созданию: {len(todo)}')
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
    checklist = []
    if '--checklist' in sys.argv:
        i = sys.argv.index('--checklist')
        checklist = [s.strip() for s in (sys.argv[i + 1] if i + 1 < len(sys.argv) else '').split(';') if s.strip()]
    print(f'База: {DB}{"  (dry-run)" if DRY else ""}')
    XSRF = get('xsrf?JSON')['_xsrf']
    print('\n[1] Структура (docs/atex_p2_die_cutter_schema_5326.json)')
    apply_schema()
    meta = get('metadata?JSON')
    if checklist:
        print('\n[2] Пункты чек-листа ИТС')
        seed_checklist(meta, checklist)
    print('\n[3] Отчёты')
    reports = get('object/22/?JSON_OBJ&LIMIT=0,5000') or []
    for name, cols in REPORTS.items():
        ensure(meta, reports, name, cols)
    print('\nГотово.' if not DRY else '\nDry-run: ничего не записано.')


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()
