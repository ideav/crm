#!/usr/bin/env python3
# ideav/crm#5551: расчётное число мастер-рулонов у позиции и переименование колонки ножа.
#
# Что делает (повторный запуск безопасен):
#   1. «Тип ножа»: колонка «Этикеток на раппорте» → «Ручьев / (этикеток) на раппорте» (_d_save по типу
#      колонки; значения не меняются, код принимает оба имени);
#   2. «Заказанное количество»: новая колонка «Мастер-рулонов расчётное» (SIGNED) — дробное МР позиции
#      (метраж вырубки / длина МР), его пишет «Заказы этикетки» при подборе ножа;
#   3. журнал «до» — JOURNAL (по умолчанию рядом со скриптом): прежнее имя колонки и есть ли новая.
#      Откат: _d_save с прежним именем; колонку 2 удалить _d_del_req.
# Колонку отчёта label_positions («МР расчётное») и гранты Диспетчера накатывают
# create_report_label_positions_5324.py и apply_die_planning_grants_5320.py (оба идемпотентны).
#
# Запуск (только база Фазы 2):
#   TOKEN=<X-Authorization> DB=https://ideav.ru/ateh1 python3 docs/scripts/migrate_mr_calc_5551.py [--dry-run]

import os, sys, json

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import apply_label_schema_5301 as A

OLD, NEW = 'Этикеток на раппорте', 'Ручьев / (этикеток) на раппорте'
MR_FIELD = 'Мастер-рулонов расчётное'
JOURNAL = os.environ.get('JOURNAL', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'migrate_mr_calc_5551_before.json'))


def find(table, name):
    for r in table.get('reqs') or []:
        alias = (r.get('field_attrs') or {}).get('alias') or ''
        if (alias or r.get('val', '')).strip().lower() == name.lower():
            return r
    return None


def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    if not A.TOKEN:
        raise SystemExit('Нужен TOKEN=<X-Authorization> в окружении.')
    print(f'База: {A.DB}{"  (dry-run)" if A.DRY else ""}')
    A.XSRF = A._req('GET', 'xsrf?JSON=1').get('_xsrf', '')
    meta = A._req('GET', 'metadata?JSON=1')
    meta = meta if isinstance(meta, list) else [meta]
    by = {str(t.get('val', '')).strip().lower(): t for t in meta}
    die_type, position = by.get('тип ножа'), by.get('заказанное количество')
    if not die_type or not position:
        raise SystemExit('нет таблицы «Тип ножа» или «Заказанное количество»')

    old, new = find(die_type, OLD), find(die_type, NEW)
    journal = {'dieTypeOld': old and {'id': old['id'], 'orig': old['orig'], 'type': old.get('type'), 'val': old['val']},
               'dieTypeNewExists': bool(new), 'mrFieldExists': bool(find(position, MR_FIELD))}
    if not A.DRY:
        with open(JOURNAL, 'w', encoding='utf-8') as f:
            json.dump(journal, f, ensure_ascii=False, indent=1)
        print(f'журнал «до»: {JOURNAL}')

    print('\n[1] Переименование колонки «Типа ножа»')
    if new:
        print(f'  ∙ «{NEW}» уже есть')
    elif not old:
        raise SystemExit(f'нет колонки «{OLD}»')
    else:
        print(f'  «{OLD}» → «{NEW}» (тип колонки {old["orig"]})')
        if not A.DRY:
            res = A.post(f'_d_save/{old["orig"]}?JSON', {'val': NEW, 't': str(old.get('type') or '')})
            print('  ->', json.dumps(res, ensure_ascii=False)[:200])

    print(f'\n[2] «Заказанное количество» → «{MR_FIELD}»')
    if find(position, MR_FIELD):
        print('  ∙ уже есть')
    else:
        spec = {'tables': [{'name': 'Заказанное количество', 'fields': [{'name': MR_FIELD, 'type': 'SIGNED'}]}]}
        print('  + SIGNED')
        if not A.DRY:
            A.apply_schema(spec)
    print('\nГотово.' if not A.DRY else '\nDry-run: ничего не записано.')


if __name__ == '__main__':
    main()
