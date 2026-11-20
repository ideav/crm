#!/usr/bin/env python3
# ideav/crm#5551: фактическая длина этикетки ножа.
#
# Что делает (повторный запуск безопасен):
#   «Тип ножа»: новая колонка «Длина этикетки факт, мм» (SIGNED). Значения заполняет импорт базы ножей
#   («Импорт из 1С» → «База ножей») из колонки «Длинна этикетки _1» листа «Ножи» — у типов, где поле пусто.
#   Откат: колонку удалить _d_del_req.
# Колонку die_actual_length отчёта label_packer докатывает create_report_label_packer_5348.py (идемпотентен).
#
# Запуск (только база Фазы 2):
#   TOKEN=<X-Authorization> DB=https://ideav.ru/ateh1 python3 docs/scripts/migrate_knife_actual_length_5551.py [--dry-run]

import os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import apply_label_schema_5301 as A

FIELD = 'Длина этикетки факт, мм'


def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    if not A.TOKEN:
        raise SystemExit('Нужен TOKEN=<X-Authorization> в окружении.')
    print(f'База: {A.DB}{"  (dry-run)" if A.DRY else ""}')
    A.XSRF = A._req('GET', 'xsrf?JSON=1').get('_xsrf', '')
    meta = A._req('GET', 'metadata?JSON=1')
    meta = meta if isinstance(meta, list) else [meta]
    die_type = next((t for t in meta if str(t.get('val', '')).strip().lower() == 'тип ножа'), None)
    if not die_type:
        raise SystemExit('нет таблицы «Тип ножа»')
    names = {((r.get('field_attrs') or {}).get('alias') or r.get('val', '')).strip().lower() for r in die_type.get('reqs') or []}
    if FIELD.lower() in names:
        print(f'«{FIELD}» уже есть')
        return
    print(f'«Тип ножа» + «{FIELD}» (SIGNED)')
    if not A.DRY:
        A.apply_schema({'tables': [{'name': 'Тип ножа', 'fields': [{'name': FIELD, 'type': 'SIGNED'}]}]})
    print('Готово.' if not A.DRY else 'Dry-run: ничего не записано.')


if __name__ == '__main__':
    main()
