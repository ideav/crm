#!/usr/bin/env python3
# Перенос количества втулок в реквизит «Кол-во» партии сырья (ideav/crm#4655).
#
# ЗАЧЕМ. Количество втулок в карточках «Партия сырья» (1074) исторически лежит в
# реквизитах, которые для втулок ничего не значат: у 27 «настоящих» карточек — в
# «Остаток, м²», у 6 старых заглушек — в «Остаток, м». Решение по #4655: количество
# втулок живёт в реквизите «Кол-во» (670848). Рабочее место /atex/intake читает и
# пишет ТОЛЬКО его и помечает неперененесённые карточки, а не считает их нулём.
#
# ЧТО ДЕЛАЕТ (идемпотентно — карточку с непустым «Кол-во» не трогает):
#   • «Кол-во» = прежнее количество; исходный реквизит очищается — число живёт в
#     одном месте;
#   • «Ед.изм.» проставляется ТОЛЬКО если пусто, по правилу объекта: у втулки задана
#     «Ширина втулки, мм» → шт, иначе → Метр. Уже проставленную человеком единицу
#     миграция не переписывает: расхождение правила с данными — повод разобраться
#     с данными (например, у втулки 104603 «PE Cores 25,6*35*100» ширина не
#     заполнена, хотя её карточка ведётся в штуках), а не молча сменить меру.
#
# ЗАГЛУШКИ (--stubs). Шесть карточек без склада с «Остаток, м» = 1 000 000 — не
# реальный запас, а «бесконечный» остаток. Их читает отчёт sleeve_batches_active
# (колонка remaining_m ← «Остаток, м»), по которому планировщик подбирает партию
# втулок для «Задачи на втулки». Очистка «Остаток, м» у них ОСТАВИТ ПЛАНИРОВЩИК
# БЕЗ ПАРТИЙ ВТУЛОК, пока отчёт не переведут на «Кол-во». Поэтому по умолчанию
# скрипт их не трогает; ключ --stubs включает перенос осознанно.
#
# Запуск (сначала всегда --dry-run — он печатает полный план «было → стало»):
#   TOKEN=<сессионный X-Authorization> DB=https://ideav.ru/ateh \
#   python3 docs/scripts/migrate_sleeve_qty_4655.py --dry-run
#   python3 docs/scripts/migrate_sleeve_qty_4655.py [--stubs]

import os, sys, json, urllib.request, urllib.parse

DB = os.environ.get('DB', 'https://ideav.ru/ateh').rstrip('/')
TOKEN = os.environ.get('TOKEN', '')
DRY = '--dry-run' in sys.argv
STUBS = '--stubs' in sys.argv

CARD_TABLE = 'Партия сырья'
SLEEVE_TABLE = 'Диаметр втулки'
UNIT_TABLE = 'Ед.изм.'
R_SLEEVE, R_AREA, R_METERS, R_QTY, R_UNIT = (
    'Диаметр втулки', 'Остаток, м²', 'Остаток, м', 'Кол-во', 'Ед.изм.')
SLEEVE_WIDTH = 'Ширина втулки, мм'
UNIT_PIECES, UNIT_METERS = 'шт', 'Метр'

# ── HTTP ──────────────────────────────────────────────────────────────────────
def _req(method, path, fields=None):
    data = urllib.parse.urlencode(fields).encode() if fields is not None else None
    r = urllib.request.Request(f'{DB}/{path}', data=data,
                               headers={'X-Authorization': TOKEN, 'Accept': 'application/json'},
                               method=method)
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
def table(name):
    for t in META:
        if str(t.get('val', '')).strip().lower() == name.strip().lower():
            return t
    raise SystemExit(f'В metadata не найдена таблица «{name}»')

def req_id(tbl, name):
    for r in (tbl.get('reqs') or []):
        if str(r.get('val', '')).strip().lower() == name.strip().lower():
            return str(r.get('id'))
    raise SystemExit(f'В таблице «{tbl["val"]}» нет реквизита «{name}»')

def col_index(tbl, name):
    order = [str(tbl['id'])] + [str(r['id']) for r in (tbl.get('reqs') or [])]
    return order.index(req_id(tbl, name))

def num(value):
    text = str(value if value is not None else '').replace(' ', '').replace(',', '.')
    try:
        return float(text)
    except ValueError:
        return 0.0

def main():
    global META, XSRF
    if not TOKEN:
        raise SystemExit('Нужен TOKEN=<сессионный X-Authorization> в окружении.')
    print(f'База: {DB}{"  (dry-run)" if DRY else ""}')
    XSRF = _req('GET', 'xsrf?JSON=1').get('_xsrf', '')
    META = _req('GET', 'metadata?JSON')

    cards = table(CARD_TABLE)
    i_sleeve, i_area, i_meters, i_qty, i_unit = (
        col_index(cards, R_SLEEVE), col_index(cards, R_AREA), col_index(cards, R_METERS),
        col_index(cards, R_QTY), col_index(cards, R_UNIT))
    rid_area, rid_meters = req_id(cards, R_AREA), req_id(cards, R_METERS)
    rid_qty, rid_unit = req_id(cards, R_QTY), req_id(cards, R_UNIT)

    # Ширина втулки по id записи справочника: задана → штуки, нет → метраж.
    sleeves = table(SLEEVE_TABLE)
    i_width = col_index(sleeves, SLEEVE_WIDTH)
    width_by_id = {str(rec['i']): num((rec.get('r') or [])[i_width])
                   for rec in _req('GET', f'object/{sleeves["id"]}/?JSON_OBJ&LIMIT=0,2000')}

    units = table(UNIT_TABLE)
    unit_by_name = {str((rec.get('r') or [''])[0]).strip().lower(): str(rec['i'])
                    for rec in _req('GET', f'object/{units["id"]}/?JSON_OBJ&LIMIT=0,200')}

    rows = _req('GET', f'object/{cards["id"]}/?JSON_OBJ&LIMIT=0,5000')
    plan, skipped, stubs = [], 0, 0
    for rec in rows or []:
        r = rec.get('r') or []
        sleeve_ref = str(r[i_sleeve] or '')
        if not sleeve_ref:
            continue                                   # риббон — «Кол-во» не использует
        if str(r[i_qty] or '').strip():
            skipped += 1
            continue                                   # уже перенесена
        sleeve_id = sleeve_ref.split(':')[0]
        area, meters = num(r[i_area]), num(r[i_meters])
        if area > 0:
            source, qty = R_AREA, area
        elif meters > 0:
            source, qty = R_METERS, meters
        else:
            continue                                   # нечего переносить
        is_stub = source == R_METERS
        if is_stub and not STUBS:
            stubs += 1
            continue
        stored_unit = str(r[i_unit] or '')
        unit_name = UNIT_PIECES if width_by_id.get(sleeve_id, 0) > 0 else UNIT_METERS
        plan.append({
            'id': str(rec['i']), 'label': sleeve_ref.split(':', 1)[-1][:42],
            'source': source, 'qty': qty,
            'unit': stored_unit.split(':', 1)[-1] if stored_unit else unit_name,
            'unit_id': '' if stored_unit else unit_by_name.get(unit_name.lower(), ''),
            'clear': rid_area if source == R_AREA else rid_meters,
        })

    print(f'\nК переносу: {len(plan)} · уже перенесено: {skipped}'
          + (f' · заглушек пропущено: {stubs} (--stubs, чтобы включить)' if stubs else ''))
    for p in plan:
        print(f'  {p["id"]:>8}  {p["label"]:<44} {p["source"]} {p["qty"]:>12,.3f} → «Кол-во», Ед.изм.={p["unit"]}')
    if stubs:
        print('\n  ВНИМАНИЕ: заглушки без склада читает отчёт sleeve_batches_active (remaining_m ←'
              '\n  «Остаток, м») — по нему планировщик подбирает партию втулок. Переносить их можно'
              '\n  только вместе с переводом отчёта на «Кол-во».')
    if DRY or not plan:
        print('\nDry-run: ничего не записано.' if DRY else '\nПереносить нечего.')
        return

    for p in plan:
        fields = {f't{rid_qty}': p['qty'], f't{p["clear"]}': ''}
        if p['unit_id']:
            fields[f't{rid_unit}'] = p['unit_id']
        post(f'_m_set/{p["id"]}?JSON', fields)
    print(f'\nГотово: перенесено карточек {len(plan)}.')

if __name__ == '__main__':
    main()
