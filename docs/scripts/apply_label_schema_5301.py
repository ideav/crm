#!/usr/bin/env python3
# Таблицы производства этикетки (Фаза 2 atex, шаг 1 состава решения; ideav/crm#5301).
#
# Что делает (каждый шаг идемпотентен — повторный запуск ничего не дублирует):
#   1. структура: docs/atex_phase2_schema.json одним вызовом `_d_schema` — таблицы §3.2
#      состава, поля этикетки у «Заказанного количества», колонка `product_kind` отчёта
#      `positions_list` (её читает фильтр планирования резок, download/atex/js/label-production.js);
#   2. начальные данные справочников: «Вид продукции», «Состояние ножа», «Тип события
#      высечки», «Станок высечки» — недостающие записи по имени.
#
# `_d_schema` проверяет описание целиком ДО записи: термин с тем же именем и другим типом,
# вторая ссылка на одну таблицу и т.п. — ответ 400, база не меняется (docs/kb/schema-json.md).
#
# Запуск:
#   TOKEN=<сессионный X-Authorization> DB=https://ideav.ru/ateh \
#   python3 docs/scripts/apply_label_schema_5301.py [--dry-run]
#
# --dry-run: читает метаданные и записи справочников и печатает, что будет создано.

import os, sys, json, urllib.request, urllib.parse, urllib.error

DB = os.environ.get('DB', 'https://ideav.ru/ateh').rstrip('/')
TOKEN = os.environ.get('TOKEN', '')
DRY = '--dry-run' in sys.argv
SCHEMA = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'atex_phase2_schema.json')

# Справочник → [(главное значение, {поле: значение})]
SEEDS = {
    'Вид продукции': [('рулон', {}), ('этикетка', {})],
    # Состояния — как в базе ножей заказчика (лист «Ножи», колонка «Состояние ножа»);
    # «Заточка» — состояние на время заточки (§1.1 состава). Подбирается только «Рабочий».
    'Состояние ножа': [
        ('Рабочий', {'Нож подбирается': 1}),
        ('Резерв', {}),
        ('На экспертизе', {}),
        ('Заточка', {}),
        ('Списан', {}),
    ],
    'Тип события высечки': [(n, {}) for n in
                            ('Смена вала', 'Смена ножа', 'Смена мастер-рулона', 'Брак', 'Простой',
                             'Начало смены', 'Конец смены', 'Наладка', 'Наладка завершена')],
    # Виды движения пробега ножа (RUN_KIND в download/atex/js/label-production.js).
    'Вид движения пробега': [(n, {}) for n in ('вырубка', 'заточка', 'начальный остаток')],
    # Виды движения мастер-рулона (MOVE_KIND в download/atex-p2/js/master-rolls-core.js).
    'Вид движения мастер-рулона': [(n, {}) for n in ('приход', 'расход', 'инвентаризация', 'списание')],
    # Основа сырья — как в базе ножей заказчика (лист «Ножи», колонка «сырье»).
    'Основа сырья': [('Бумага', {}), ('ПП', {})],
    # Станки из плана высечки заказчика (колонка «Машина»); пятый — открытый вопрос §11.2.
    'Станок высечки': [(n, {}) for n in ('1 высечка', '2 высечка', '3 высечка', '4 высечка')],
}

# ── HTTP ──────────────────────────────────────────────────────────────────────
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
    except Exception:
        raise SystemExit(f'НЕ JSON от {method} {path} (нужен валидный токен?):\n{body[:300]}')

XSRF = ''
def post(path, fields):
    f = dict(fields); f['token'] = TOKEN; f['_xsrf'] = XSRF
    return _req('POST', path, f)

def table_names(meta):
    return {str(t.get('val', '')).strip().lower() for t in meta}

def flat(tables):
    for t in tables:
        yield t
        yield from flat(t.get('children') or [])

# ── Шаг 1: структура ──────────────────────────────────────────────────────────
def apply_schema(spec):
    meta = _req('GET', 'metadata?JSON=1')
    have = table_names(meta if isinstance(meta, list) else [meta])
    for t in flat(spec['tables']):
        mark = '∙ есть  ' if t['name'].strip().lower() in have else '+ новая '
        print(f'  {mark} «{t["name"]}»' + (f' (+{len(t.get("fields") or [])} полей)' if t.get('fields') else ''))
    if DRY:
        return
    res = post('_d_schema?JSON', {'json': json.dumps(spec, ensure_ascii=False)})
    if not res.get('ok'):
        print(json.dumps(res, ensure_ascii=False, indent=1))
        raise SystemExit('_d_schema отказал — см. errors выше; база не менялась, если ответ 400')
    print(f'  создано {res.get("created")}, обновлено {res.get("updated")}, было {res.get("existing")}')
    for w in res.get('warnings') or []:
        print(f'  ⚠ {w}')

# ── Шаг 2: начальные данные ───────────────────────────────────────────────────
def seed(table, rows):
    existing = _req('GET', f'object/{urllib.parse.quote(table)}?JSON_OBJ&NAMED&LIMIT=0,500')
    names = {str(r.get(table, '')).strip().lower() for r in (existing if isinstance(existing, list) else [])}
    for name, fields in rows:
        if name.lower() in names:
            print(f'  ∙ {table}: «{name}» уже есть')
            continue
        print(f'  + {table}: «{name}»' + (f' {fields}' if fields else ''))
        if DRY:
            continue
        body = dict(fields); body[table] = name
        res = post(f'_m_new/{urllib.parse.quote(table)}?JSON', {'up': '1', 'fields': json.dumps(body, ensure_ascii=False)})
        if isinstance(res, dict) and (res.get('error') or res.get('err')):
            raise SystemExit(f'Ошибка записи «{name}» в «{table}»: {res.get("error") or res.get("err")}')

def main():
    global XSRF
    if not TOKEN:
        raise SystemExit('Нужен TOKEN=<сессионный X-Authorization> в окружении.')
    with open(SCHEMA, encoding='utf-8') as f:
        spec = json.load(f)
    print(f'База: {DB}{"  (dry-run)" if DRY else ""}')
    XSRF = _req('GET', 'xsrf?JSON=1').get('_xsrf', '')

    print('\n[1] Структура (docs/atex_phase2_schema.json)')
    apply_schema(spec)

    print('\n[2] Начальные данные')
    for table, rows in SEEDS.items():
        if DRY and table.strip().lower() not in table_names(_req('GET', 'metadata?JSON=1')):
            print(f'  + {table}: таблицы ещё нет — {len(rows)} записей после наката')
            continue
        seed(table, rows)

    print('\nГотово.' if not DRY else '\nDry-run: ничего не записано.')

if __name__ == '__main__':
    main()
