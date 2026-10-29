#!/usr/bin/env python3
# Перевод базы, где уже накатана первая редакция docs/atex_phase2_schema.json, на текущую
# (ideav/crm#5306). Нужен только там, где у «Ножа» есть «Раппорт, мм» или ссылка на
# «Сырьё этикетки»; на чистой базе скрипт ничего не удаляет и сводится к apply.
#
# Шаги (повторный запуск безопасен):
#   1. прочитать значения, которые меняют тип: «Основа» сырья (текст), «Вид движения
#      пробега» (текст), сырьё ножа (ссылка → основа этого сырья);
#   2. удалить реквизиты прежней редакции: «Нож» → «Раппорт, мм» и «Сырьё этикетки»,
#      «Сырьё этикетки» → «Основа» (текст), «Движение пробега» → «Вид движения пробега» (текст);
#   3. накатить текущую схему и справочники (apply_label_schema_5301.py);
#   4. вернуть значения шага 1 ссылками на справочники «Основа сырья» и «Вид движения пробега».
#
# Запуск:
#   TOKEN=<X-Authorization> DB=https://ideav.ru/ateh1 python3 docs/scripts/migrate_label_schema_5306.py [--dry-run]

import os, sys, json, urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import apply_label_schema_5301 as A

DRY = A.DRY


def meta():
    m = A._req('GET', 'metadata?JSON=1')
    return m if isinstance(m, list) else [m]


def find_table(m, name):
    for t in m:
        if str(t.get('val', '')).strip().lower() == name.lower():
            return t
    return None


def find_req(table, name):
    for r in (table or {}).get('reqs') or []:
        alias = (r.get('field_attrs') or {}).get('alias') or ''
        if (alias or r.get('val', '')).strip().lower() == name.lower():
            return r
    return None


def records(table_name, up=None):
    q = f'object/{urllib.parse.quote(table_name)}?JSON_OBJ&NAMED&LIMIT=0,5000' + (f'&F_U={up}' if up else '')
    res = A._req('GET', q)
    return res if isinstance(res, list) else []


def ref_val(v):
    if isinstance(v, dict):
        return str(v.get('val') or '')
    return str(v or '')


def main():
    if not A.TOKEN:
        raise SystemExit('Нужен TOKEN=<X-Authorization> в окружении.')
    print(f'База: {A.DB}{"  (dry-run)" if DRY else ""}')
    A.XSRF = A._req('GET', 'xsrf?JSON=1').get('_xsrf', '')
    m = meta()
    die_t, mat_t, run_t = find_table(m, 'Нож'), find_table(m, 'Сырьё этикетки'), find_table(m, 'Движение пробега')

    # Что удалять: реквизит есть и он прежнего вида.
    old = []
    for table, name, is_old in (
        (die_t, 'Раппорт, мм', lambda r: True),
        (die_t, 'Сырьё этикетки', lambda r: bool(r.get('ref'))),
        (mat_t, 'Основа', lambda r: not r.get('ref')),
        (run_t, 'Вид движения пробега', lambda r: not r.get('ref')),
    ):
        r = find_req(table, name)
        if r and is_old(r):
            old.append((table['val'], name, str(r['id'])))

    print('\n[1] Значения прежней редакции')
    mat_base, die_base, run_kind = {}, {}, {}
    if any(o[1] == 'Основа' for o in old) or any(o[1] == 'Сырьё этикетки' for o in old):
        for rec in records('Сырьё этикетки'):
            mat_base[str(rec['id'])] = str(rec.get('Основа') or '').strip()
    if any(o[1] == 'Сырьё этикетки' for o in old):
        for rec in records('Нож'):
            mid = rec.get('Сырьё этикетки')
            if isinstance(mid, dict) and mid.get('id'):
                die_base[str(rec['id'])] = mat_base.get(str(mid['id']), '')
    if any(o[1] == 'Вид движения пробега' for o in old):
        for die in records('Нож'):
            for rec in records('Движение пробега', die['id']):
                run_kind[str(rec['id'])] = str(rec.get('Вид движения пробега') or '').strip()
    print(f'  основа у сырья: {mat_base}\n  основа у ножей (по их сырью): {die_base}\n  вид движений пробега: {run_kind}')

    print('\n[2] Реквизиты прежней редакции')
    if not old:
        print('  ∙ нет — база уже в текущей редакции')
    for table, name, rid in old:
        print(f'  − «{table}» → «{name}» (реквизит {rid})')
        if not DRY:
            res = A.post(f'_d_del_req/{rid}?JSON=1', {'forced': '1'})
            if isinstance(res, dict) and (res.get('error') or res.get('err')):
                raise SystemExit(f'Ошибка удаления {rid}: {res.get("error") or res.get("err")}')

    print('\n[3] Текущая схема и справочники')
    with open(A.SCHEMA, encoding='utf-8') as f:
        spec = json.load(f)
    A.apply_schema(spec)
    names = {str(t.get('val', '')).strip().lower() for t in meta()}
    for table, rows in A.SEEDS.items():
        if DRY and table.lower() not in names:
            print(f'  + {table}: таблицы ещё нет — {len(rows)} записей после наката')
            continue
        A.seed(table, rows)

    print('\n[4] Значения — ссылками')
    sets = [(i, {'Основа': v}) for i, v in mat_base.items() if v] + \
           [(i, {'Основа': v}) for i, v in die_base.items() if v] + \
           [(i, {'Вид движения пробега': v}) for i, v in run_kind.items() if v]
    for rid, fields in sets:
        print(f'  ~ {rid}: {fields}')
        if not DRY:
            res = A.post(f'_m_set/{rid}?JSON', {'fields': json.dumps(fields, ensure_ascii=False)})
            if isinstance(res, dict) and (res.get('error') or res.get('err')):
                raise SystemExit(f'Ошибка записи {rid}: {res.get("error") or res.get("err")}')

    print('\nГотово.' if not DRY else '\nDry-run: ничего не записано.')


if __name__ == '__main__':
    main()
