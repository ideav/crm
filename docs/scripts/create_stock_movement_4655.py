#!/usr/bin/env python3
# Журнал складских операций «Движение сырья» для РМ /atex/intake (ideav/crm#4655).
#
# Что делает (каждый шаг идемпотентен — повторный запуск ничего не дублирует):
#   1. таблица «Движение сырья»: главное значение — колонка «дата/время» (момент операции);
#   2. колонки журнала: Операция, Вид сырья (ссылка), Диаметр втулки (ссылка), Со склада,
#      На склад, Кол-во, Ед.изм. (ссылка), Было, Стало, Причина, Примечание, Пользователь;
#   3. гранты: журнал — WRITE ролям «Диспетчер» и «Оператор»; справочники «Склад» и
#      «Ед.изм.» — READ тем же ролям (без грантов их выпадающие списки пусты).
#
# Склады хранятся ТЕКСТОМ: тип ссылки в Интеграме определяется целевой таблицей,
# поэтому двух ссылок на «Склад» («Со склада» и «На склад») в одной записи не бывает.
# Имена типов задаются с префиксом «Движение сырья.», а имя колонки — псевдонимом
# (_d_alias): так журнал не занимает под себя глобальные имена типов. Тот же приём
# использует таблица «Журнал» (665850, issue #4618).
#
# Запуск:
#   TOKEN=<сессионный X-Authorization> DB=https://ideav.ru/ateh \
#   python3 docs/scripts/create_stock_movement_4655.py [--dry-run]
#
# Соглашения DDL — docs/kb/schema.md; гранты — docs/kb/roles.md.

import os, sys, json, urllib.request, urllib.parse

DB = os.environ.get('DB', 'https://ideav.ru/ateh').rstrip('/')
TOKEN = os.environ.get('TOKEN', '')
DRY = '--dry-run' in sys.argv

TABLE_NAME = 'Движение сырья'
TYPE_PREFIX = TABLE_NAME + '.'

SHORT, MEMO, SIGNED, DATETIME = 3, 12, 14, 4

# (имя колонки в таблице, базовый тип | ('ref', <таблица-цель>))
COLUMNS = [
    ('Операция',        SHORT),
    ('Вид сырья',       ('ref', 'Вид сырья')),
    ('Диаметр втулки',  ('ref', 'Диаметр втулки')),
    ('Со склада',       SHORT),
    ('На склад',        SHORT),
    ('Кол-во',          SIGNED),
    ('Ед.изм.',         ('ref', 'Ед.изм.')),
    ('Было',            SIGNED),
    ('Стало',           SIGNED),
    ('Причина',         SHORT),
    ('Примечание',      MEMO),
    ('Пользователь',    SHORT),
]

# Роли, которым рабочее место доступно (меню «Приёмка» / «Приёмка сырья»).
ROLES = ['Диспетчер', 'Оператор']
# Справочники, без READ-гранта на которые списки склада и единицы измерения пусты.
READ_ONLY_TABLES = ['Склад', 'Ед.изм.']

WRITE, READ = '54', '53'

# ── HTTP ──────────────────────────────────────────────────────────────────────
def _req(method, path, fields=None):
    data = urllib.parse.urlencode(fields).encode() if fields is not None else None
    headers = {'X-Authorization': TOKEN, 'Accept': 'application/json'}
    r = urllib.request.Request(f'{DB}/{path}', data=data, headers=headers, method=method)
    with urllib.request.urlopen(r, timeout=30) as resp:
        body = resp.read().decode('utf-8', 'replace')
    try:
        return json.loads(body)
    except Exception:
        raise SystemExit(f'НЕ JSON от {method} {path} (нужен валидный токен?):\n{body[:300]}')

XSRF = ''
def post(path, fields):
    f = dict(fields); f['token'] = TOKEN; f['_xsrf'] = XSRF
    res = _req('POST', path, f)
    if isinstance(res, dict) and (res.get('error') or res.get('err')):
        raise SystemExit(f'Ошибка {path}: {res.get("error") or res.get("err")}')
    return res

# ── Метаданные ────────────────────────────────────────────────────────────────
META = []
def load_meta():
    global META
    m = _req('GET', 'metadata?JSON')
    META = m if isinstance(m, list) else [m]

def find_table(name, required=True):
    for t in META:
        if str(t.get('val', '')).strip().lower() == name.strip().lower():
            return t
    if required:
        raise SystemExit(f'В metadata не найдена таблица «{name}»')
    return None

def req_alias(req):
    try:
        return str((json.loads(req.get('attrs') or '{}') or {}).get('alias') or '')
    except Exception:
        return ''

def has_column(table, name):
    wanted = name.strip().lower()
    for r in (table.get('reqs') or []):
        if str(r.get('val', '')).strip().lower() == wanted or req_alias(r).strip().lower() == wanted:
            return str(r.get('id'))
    return None

# ── Шаг 1: таблица ────────────────────────────────────────────────────────────
def ensure_table():
    table = find_table(TABLE_NAME, required=False)
    if table:
        print(f'  ∙ таблица «{TABLE_NAME}» уже есть (id={table["id"]})')
        return table
    print(f'  + таблица «{TABLE_NAME}» (главное значение — дата/время)')
    if DRY:
        return None
    res = post('_d_new?JSON=1', {'t': str(DATETIME), 'val': TABLE_NAME})
    tid = str(res.get('obj') or res.get('id'))
    print(f'      → id={tid}')
    load_meta()
    return find_table(TABLE_NAME)

# ── Шаг 2: колонки ────────────────────────────────────────────────────────────
def ensure_column(table, name, spec):
    if table and has_column(table, name):
        print(f'  ∙ колонка «{name}» уже есть')
        return
    if isinstance(spec, tuple):                      # ссылка на справочник
        target = find_table(spec[1])
        print(f'  + ссылка «{name}» → {spec[1]} ({target["id"]})')
        if DRY:
            return
        ref = post(f'_d_ref/{target["id"]}?JSON=1', {})
        type_id = str(ref.get('obj') or ref.get('id'))
    else:                                            # обычная колонка
        type_name = TYPE_PREFIX + name
        print(f'  + колонка «{name}» (тип «{type_name}», базовый {spec})')
        if DRY:
            return
        new_type = post('_d_new?JSON=1', {'t': str(spec), 'val': type_name})
        type_id = str(new_type.get('obj') or new_type.get('id'))

    req = post(f'_d_req/{table["id"]}?JSON=1', {'t': type_id})
    req_id = str(req.get('id'))                      # именно id, не obj (docs/kb/schema.md)
    if not isinstance(spec, tuple):
        post(f'_d_alias/{req_id}?JSON=1', {'val': name})
    print(f'      → реквизит {req_id}')

# ── Шаг 3: гранты ─────────────────────────────────────────────────────────────
def role_id(name):
    rows = _req('GET', 'object/42/?JSON_OBJ&LIMIT=0,200')
    for rec in rows or []:
        if str((rec.get('r') or [''])[0]).strip().lower() == name.strip().lower():
            return str(rec.get('i'))
    raise SystemExit(f'Роль «{name}» не найдена')

def granted_objects(rid):
    rows = _req('GET', f'object/116/?JSON_OBJ&LIMIT=0,500&F_U={rid}')
    return {str((rec.get('r') or [''])[0]).split(':')[0] for rec in rows or []}

def ensure_grant(role_name, rid, obj_id, obj_name, level):
    have = granted_objects(rid)
    label = 'WRITE' if level == WRITE else 'READ'
    if str(obj_id) in have:
        print(f'  ∙ {role_name}: грант на «{obj_name}» уже есть')
        return
    print(f'  + {role_name}: {label} на «{obj_name}» ({obj_id})')
    if DRY:
        return
    post('_m_new/116?JSON=1', {'up': rid, 't116': str(obj_id), 't136': level})

def main():
    global XSRF
    if not TOKEN:
        raise SystemExit('Нужен TOKEN=<сессионный X-Authorization> в окружении.')
    print(f'База: {DB}{"  (dry-run)" if DRY else ""}')
    XSRF = _req('GET', 'xsrf?JSON=1').get('_xsrf', '')
    load_meta()

    print('\n[1] Таблица')
    table = ensure_table()

    print('\n[2] Колонки')
    for name, spec in COLUMNS:
        ensure_column(table, name, spec)
        if table and not DRY:
            load_meta()
            table = find_table(TABLE_NAME)

    print('\n[3] Гранты')
    journal = find_table(TABLE_NAME, required=False)
    for role_name in ROLES:
        rid = role_id(role_name)
        if journal:
            ensure_grant(role_name, rid, journal['id'], TABLE_NAME, WRITE)
        for dict_name in READ_ONLY_TABLES:
            d = find_table(dict_name)
            ensure_grant(role_name, rid, d['id'], dict_name, READ)

    print('\nГотово.' if not DRY else '\nDry-run: ничего не записано.')

if __name__ == '__main__':
    main()
