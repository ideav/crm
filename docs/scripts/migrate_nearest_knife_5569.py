#!/usr/bin/env python3
# ideav/crm#5569: подбор ближайшего ножа и отметка «нужно заказать нож». База Фазы 2 (ateh1).
#
# Что делает (повторный запуск безопасен):
#   1. «Заказанное количество»: новая колонка «Нужно заказать нож» (BOOLEAN) — ручная отметка
#      менеджера в «Заказах этикетки»; позиция с отметкой в планирование высечки не идёт;
#   2. «Настройка» (269): LABEL_DIE_SIZE_TOLERANCE_MM = 1,65 — допуск размера ножа к этикетке, мм.
#      Без точного ножа подбор берёт ближайший, у которого каждая сторона отличается не больше
#      допуска. Число — из листа «Ножи» файла заказчика «План на производство ВЫСЕЧКА.xlsx»:
#      наибольшее отклонение факта от номинала у 715 ножей — 1,1 мм по длине («100 х 150» →
#      148,9; ширина — до 0,5 мм; выброс 728069 «50 х 80» → 69 не в счёт — ошибка строки),
#      × 1,5 = 1,65 (решение владельца 19.11.2026). Существующее значение меняется на 1,65.
# Колонку отчёта label_positions («Заказать нож») добавляет create_report_label_positions_5324.py.
# Откат: колонку 1 удалить _d_del_req; настройку 2 — удалить запись или поставить 0 (точный подбор).
#
# Запуск:
#   TOKEN=<X-Authorization> DB=https://ideav.ru/ateh1 python3 docs/scripts/migrate_nearest_knife_5569.py [--dry-run]

import os, sys, json

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import apply_label_schema_5301 as A

FIELD = 'Нужно заказать нож'
SETTING, VALUE, TYPE = 'LABEL_DIE_SIZE_TOLERANCE_MM', '1,65', 'ATEH'


def alias_of(r):
    return ((r.get('field_attrs') or {}).get('alias') or r.get('alias') or '').strip()


def find(table, name):
    for r in table.get('reqs') or []:
        if (alias_of(r) or str(r.get('val', ''))).strip().lower() == name.lower():
            return r
    return None


def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    if not A.TOKEN:
        raise SystemExit('Нужен TOKEN=<X-Authorization> в окружении.')
    print(f'База: {A.DB}{"  (dry-run)" if A.DRY else ""}')
    if not A.DRY:
        A.XSRF = A._req('GET', 'xsrf?JSON=1').get('_xsrf', '')
    meta = A._req('GET', 'metadata?JSON')
    meta = meta if isinstance(meta, list) else [meta]
    by = {str(t.get('val', '')).strip().lower(): t for t in meta}
    position, settings = by.get('заказанное количество'), by.get('настройка')
    if not position or not settings:
        raise SystemExit('нет таблицы «Заказанное количество» или «Настройка»')

    print(f'\n[1] «Заказанное количество» → «{FIELD}»')
    if find(position, FIELD):
        print('  ∙ уже есть')
    else:
        print('  + BOOLEAN')
        if not A.DRY:
            A.apply_schema({'tables': [{'name': 'Заказанное количество', 'fields': [{'name': FIELD, 'type': 'BOOLEAN'}]}]})

    print(f'\n[2] «Настройка» → {SETTING} = {VALUE}')
    tid = str(settings['id'])
    t_type, t_val = find(settings, 'Тип'), find(settings, 'Значение')
    if not t_type or not t_val:
        raise SystemExit('у «Настройки» нет колонок «Тип» / «Значение»')
    t_type, t_val = str(t_type['id']), str(t_val['id'])
    listing = A._req('GET', f'object/{tid}/?JSON_KV&LIMIT=0,5000')
    values = listing.get('reqs') or {}
    rows = [o for o in (listing.get('object') or []) if str(o.get('val', '')).strip() == SETTING]
    if not rows:
        print('  + создаём')
        if not A.DRY:
            res = A.post(f'_m_new/{tid}?JSON&up=1', {f't{tid}': SETTING, f't{t_type}': TYPE, f't{t_val}': VALUE})
            print('  ->', json.dumps(res, ensure_ascii=False)[:200])
    for o in rows:
        cur = str((values.get(str(o['id'])) or {}).get(t_val, '')).strip()
        if cur == VALUE:
            print(f'  ∙ уже {VALUE} (id {o["id"]})')
            continue
        print(f'  {cur or "пусто"} → {VALUE} (id {o["id"]})')
        if not A.DRY:
            res = A.post(f'_m_set/{o["id"]}?JSON', {f't{t_val}': VALUE})
            print('  ->', json.dumps(res, ensure_ascii=False)[:200])
    print('\nГотово.' if not A.DRY else '\nDry-run: ничего не записано.')


if __name__ == '__main__':
    main()
