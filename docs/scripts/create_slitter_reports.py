#!/usr/bin/env python3
# Создание защищённых отчётов (report/) для РМ «Пульт слиттера» (download/atex/js/slitter.js).
#
# Зачем: слиттер сейчас читает данные сырыми `object/{table}/?JSON_OBJ` и джойнит на
# клиенте (loadCuts / loadShiftEvents / loadSlitters / loadMaterialWidths). Эти отчёты
# дают защищённый слой report/ — изоляция данных по ролям и серверные джойны.
#
# Что создаёт (если отчёта с таким именем ещё нет — идемпотентно):
#   slitter_cuts          — очередь заданий станка (взамен loadCuts + loadMaterialWidths)
#   slitter_shift_events  — лог событий смены (взамен loadShiftEvents)
#   slitters_list         — справочник станков (взамен loadSlitters)
#
# ID реквизитов НЕ хардкодятся: резолвятся по именам из живого GET metadata?JSON
# (ID зависят от сборки базы — поэтому slitter.js и резолвит их по имени в рантайме).
#
# Запуск (curl в окружении нет — берём python3 stdlib):
#   TOKEN=<актуальный сессионный X-Authorization>  DB=https://ideav.ru/ateh \
#   python3 docs/scripts/create_slitter_reports.py
#   (по умолчанию DB=https://ideav.ru/ateh; --dry-run — только показать план, без записи)
#
# Соглашения конструктора (docs/integram-reports.md §5, docs/integram-app-workflow.md):
#   POST _m_new/22?JSON&up=1          t22=<имя>            → { id: queryId }
#   POST _m_new/28?JSON&up=queryId    t28=<tableId|reqId>  t100=<имя колонки>  → { id: colId }
#   POST _m_set/<colId>?JSON          t104=85 (abn_ID)  |  t84=DATETIME (формат)
#   t28 = ID таблицы            → главное значение (label)
#   t28 = ID таблицы + t104=85  → ID записи
#   t28 = ID реквизита          → значение реквизита (для ref — имя цели)
#   t28 = ID реквизита + t104=85→ ID цели ссылки (abn_ID)
#   Колонки с t100 — фильтруемы снаружи через FR_/TO_.

import os, sys, json, urllib.request, urllib.parse, urllib.error

DB = os.environ.get('DB', 'https://ideav.ru/ateh').rstrip('/')
TOKEN = os.environ.get('TOKEN', '')
DRY = '--dry-run' in sys.argv

# ── Спецификация отчётов ──────────────────────────────────────────────────────
# col = (имя_в_отчёте t100, источник, функция t104|None, формат t84|None)
#   источник: {'table': '<имя таблицы>'}                 → главное значение / id записи
#             {'req': '<имя реквизита>', 'in': '<табл>'}  → реквизит таблицы (по умолч. in=мастер)
ABN_ID = 85          # функция abn_ID (id записи / id цели ссылки)
DT = 'DATETIME'

REPORTS = {
    # Очередь заданий станка. Мастер — «Задание в производство» (старое имя «Производственная резка»).
    'slitter_cuts': {
        'master': ['Задание в производство', 'Производственная резка'],
        'cols': [
            ('cut_id',           {'table': 'Задание в производство'}, ABN_ID, None),
            ('cut_plan_date',    {'table': 'Задание в производство'}, None,   DT),   # гл. значение = «Дата план» (штамп)
            ('cut_slitter_id',   {'req': 'Слиттер'},                  ABN_ID, None), # FR_ фильтр очереди по станку
            ('cut_slitter',      {'req': 'Слиттер'},                  None,   None),
            ('cut_batch_id',     {'req': 'Партия сырья'},             ABN_ID, None),
            ('cut_batch',        {'req': 'Партия сырья'},             None,   None),
            ('cut_sequence',     {'req': 'Очередность'},              None,   None),
            ('cut_planned_runs', {'req': 'Кол-во резок план'},        None,   None), # фолбэк «Кол-во план» (см. RESOLVE_ALT)
            ('cut_run_length',   {'req': 'Метраж, м'},                None,   None),
            ('cut_started',      {'req': 'Начато'},                   None,   DT),
            ('cut_in_work',      {'req': 'В работе'},                 None,   None), # булев — занимает станок
            ('cut_finished',     {'req': 'Закончено'},                None,   DT),
            ('cut_winding',      {'req': 'Тип намотки'},              None,   None),
            ('cut_leader',       {'req': 'Лидер'},                    None,   None), # #3623/#3629: был пустой
            # Авто-джойн через «Партия сырья» → «Вид сырья» (как cut_planning). Снимает loadMaterialWidths/resolveCutWidth:
            ('cut_material_id',  {'req': 'Вид сырья', 'in': 'Партия сырья'}, ABN_ID, None),
            ('cut_material',     {'req': 'Вид сырья', 'in': 'Партия сырья'}, None,   None),
            ('cut_material_width',{'req': 'Ширина, мм', 'in': 'Вид сырья'},  None,   None), # 3 хопа — проверить живьём
        ],
    },
    # Лог событий смены. Мастер — «Событие смены» (подчинён резке: up=cutId).
    'slitter_shift_events': {
        'master': ['Событие смены'],
        'cols': [
            ('event_id',      {'table': 'Событие смены'}, ABN_ID, None),
            ('event_when',    {'table': 'Событие смены'}, None,   DT),   # гл. значение = дата/время события
            ('event_type',    {'req': 'Тип события'},     None,   None),
            ('event_type_id', {'req': 'Тип события'},     ABN_ID, None),
            ('event_user_id', {'req': 'Пользователь'},    ABN_ID, None), # FR_ фильтр по оператору
            ('event_user',    {'req': 'Пользователь'},    None,   None),
            ('event_value',   {'req': 'Значение'},        None,   None),
            ('event_notes',   {'req': 'Примечания'},      None,   None),
            # Ссылка на задание. Если реквизит-ref «Задание в производство» есть в сборке — abn_ID;
            # иначе связь только через подчинение (up) — резолвится при проверке живьём.
            ('event_cut_id',  {'req': 'Задание в производство', 'optional': True}, ABN_ID, None),
        ],
    },
    # Справочник станков.
    'slitters_list': {
        'master': ['Слиттер'],
        'cols': [
            ('slitter_id',   {'table': 'Слиттер'}, ABN_ID, None),
            ('slitter_name', {'table': 'Слиттер'}, None,   None),
        ],
    },
}
# Если основного имени реквизита нет — пробуем альтернативу (разные сборки/issue).
RESOLVE_ALT = {'Кол-во резок план': ['Кол-во план']}

# ── HTTP ──────────────────────────────────────────────────────────────────────
def _req(method, path, fields=None):
    url = f'{DB}/{path}'
    data = None
    if fields is not None:
        data = urllib.parse.urlencode(fields).encode()
    headers = {'X-Authorization': TOKEN, 'Cookie': f'idb_ateh={TOKEN}', 'Accept': 'application/json'}
    r = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(r, timeout=30) as resp:
        body = resp.read().decode('utf-8', 'replace')
    try:
        return json.loads(body)
    except Exception:
        raise SystemExit(f'НЕ JSON от {method} {path} (нужен валидный токен?):\n{body[:300]}')

def get_xsrf():
    return _req('GET', 'xsrf?JSON=1').get('_xsrf', '')

XSRF = ''
def post(path, fields):
    f = dict(fields); f['token'] = TOKEN; f['_xsrf'] = XSRF
    return _req('POST', path, f)

# ── Метаданные: резолв ID таблиц и реквизитов по именам ────────────────────────
META = []
def load_meta():
    global META
    m = _req('GET', 'metadata?JSON')
    META = m if isinstance(m, list) else (m.get('items') or m.get('types') or [m])

def find_table(names):
    names = names if isinstance(names, list) else [names]
    for nm in names:
        for t in META:
            if str(t.get('val', '')).strip().lower() == nm.strip().lower():
                return t
    raise SystemExit(f'В metadata не найдена таблица: {names}')

def table_id(names):
    return str(find_table(names).get('id'))

def req_id(table_names, req_name, optional=False):
    t = find_table(table_names)
    cand = [req_name] + RESOLVE_ALT.get(req_name, [])
    for nm in cand:
        for r in (t.get('reqs') or []):
            if str(r.get('val', '')).strip().lower() == nm.strip().lower():
                return str(r.get('id'))
    if optional:
        return None
    raise SystemExit(f'В таблице «{find_table(table_names).get("val")}» нет реквизита: {cand}')

def existing_reports():
    # object/22 — список всех отчётов (записи таблицы «Запрос»). Имя = главное значение.
    rows = _req('GET', 'object/22/?JSON_OBJ&LIMIT=0,5000')
    out = {}
    for rec in (rows or []):
        name = (rec.get('r') or [''])[0]
        if name:
            out[str(name).strip()] = str(rec.get('i'))
    return out

# ── Создание одного отчёта ─────────────────────────────────────────────────────
def build_report(name, spec, existing):
    master = spec['master']
    if name in existing:
        print(f'  ∙ {name}: уже существует (queryId={existing[name]}) — пропускаю')
        return existing[name]
    plan = []  # (t100, t28, t104, t84)
    for t100, src, fn, fmt in spec['cols']:
        if 'table' in src:
            t28 = table_id(src['table'])
        else:
            in_tbl = src.get('in', master)
            t28 = req_id(in_tbl, src['req'], optional=src.get('optional'))
            if t28 is None:
                print(f'      ~ колонка {t100}: реквизит «{src["req"]}» не найден (optional) — пропущена')
                continue
        plan.append((t100, t28, fn, fmt))
    print(f'  ∙ {name}: мастер={find_table(master).get("val")} ({table_id(master)}), колонок={len(plan)}')
    for t100, t28, fn, fmt in plan:
        extra = (f' t104={fn}' if fn else '') + (f' t84={fmt}' if fmt else '')
        print(f'      - {t100:20} t28={t28}{extra}')
    if DRY:
        return None
    q = post('_m_new/22?JSON&up=1', {'t22': name})
    qid = str(q.get('id') or q.get('obj'))
    print(f'      → queryId={qid}')
    for t100, t28, fn, fmt in plan:
        c = post(f'_m_new/28?JSON&up={qid}', {'t28': t28, 't100': t100})
        cid = str(c.get('id') or c.get('obj'))
        if fn:
            post(f'_m_set/{cid}?JSON', {'t104': str(fn)})
        if fmt:
            post(f'_m_set/{cid}?JSON', {'t84': fmt})
    print(f'      ✓ {name} создан')
    return qid

def main():
    if not TOKEN:
        raise SystemExit('Нужен TOKEN=<сессионный X-Authorization> в окружении.')
    global XSRF
    load_meta()
    print(f'DB={DB}  таблиц в metadata={len(META)}  dry_run={DRY}')
    existing = {} if DRY else existing_reports()
    if not DRY:
        XSRF = get_xsrf()
    result = {}
    for name, spec in REPORTS.items():
        result[name] = build_report(name, spec, existing)
    print('\nИтог (queryId по отчётам):')
    print(json.dumps(result, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    main()
