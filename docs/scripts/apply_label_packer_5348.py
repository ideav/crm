#!/usr/bin/env python3
# «Упаковка этикетки» (ideav/crm#5348, шаг 10 Фазы 2 atex) - схема, права и меню.
#
# Что делает (повторный запуск ничего не дублирует):
#   1. поля упаковки у «Партии ГП этикетки» по docs/atex_phase2_schema.json (_d_schema только по этой
#      таблице): «Упаковано, рулонов», «Склад НК, рулонов», «Примечание», «Упаковочное место»;
#   2. значение «Упаковка» в справочнике «Тип события высечки» (журнал смены - «Событие смены высечки»);
#   3. права роли «Оператор» из docs/atex_p2_label_packer_5348.json;
#   4. пункт меню «Упаковка этикетки» (/label-packer) у ролей «Оператор» и admin.
# Отчёт label_packer создаёт create_report_label_packer_5348.py (после п.1).
#
# Запуск (только база Фазы 2):
#   TOKEN=<X-Authorization> DB=https://ideav.ru/ateh1 python3 docs/scripts/apply_label_packer_5348.py [--dry-run]

import os, sys, json, urllib.request, urllib.parse, urllib.error

DB = os.environ.get('DB', 'https://ideav.ru/ateh1').rstrip('/')
TOKEN = os.environ.get('TOKEN', '')
DRY = '--dry-run' in sys.argv
HERE = os.path.dirname(os.path.abspath(__file__))
SCHEMA = os.path.join(HERE, '..', 'atex_phase2_schema.json')
GRANTS = os.path.join(HERE, '..', 'atex_p2_label_packer_5348.json')
GP, TYPE = 'Партия ГП этикетки', 'Тип события высечки'
EVENT_TYPE = 'Упаковка'
MENU = {'name': 'Упаковка этикетки', 'href': 'label-packer', 'icon': '<i class="pi pi-box"></i>'}
MENU_ROLES = {'145': 'admin', '1621': 'Оператор'}
MENU_TABLE = '151'
XSRF = ''


def call(method, path, fields=None):
    if fields is not None:
        fields = dict(fields, _xsrf=XSRF)
    data = urllib.parse.urlencode(fields).encode() if fields is not None else None
    r = urllib.request.Request(f'{DB}/{path}', data=data, method=method,
                               headers={'X-Authorization': TOKEN, 'Accept': 'application/json'})
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
            body = resp.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', 'replace')
    try:
        return json.loads(body)
    except ValueError:
        raise SystemExit(f'{method} {path}: не JSON: {body[:300]}')


def schema(spec):
    res = call('POST', '_d_schema?JSON', {'json': json.dumps(spec, ensure_ascii=False)})
    if not res.get('ok'):
        print(json.dumps(res, ensure_ascii=False, indent=1))
        raise SystemExit('_d_schema отказал')
    print(f'   создано {res.get("created")}, обновлено {res.get("updated")}, было {res.get("existing")}')


def main():
    global XSRF
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    if not TOKEN:
        raise SystemExit('нет TOKEN')
    XSRF = call('GET', 'xsrf?JSON=1').get('_xsrf', '')
    meta = call('GET', 'metadata?JSON=1')

    # 1. поля партии
    with open(SCHEMA, encoding='utf-8') as f:
        decl = [t for t in json.load(f)['tables'] if t['name'] == GP]
    print('1. поля «%s»: %s' % (GP, ', '.join(x['name'] for x in decl[0]['fields'])))
    if not DRY:
        schema({'tables': decl})

    # 2. тип события
    typ = [t for t in meta if str(t.get('val', '')).strip().lower() == TYPE.lower()]
    if not typ:
        raise SystemExit(f'в базе нет таблицы «{TYPE}»')
    have = {str(o.get('val', '')).strip().lower() for o in (call('GET', f'object/{typ[0]["id"]}/?JSON_KV&LIMIT=0,1000').get('object') or [])}
    print('2. тип события «%s»: %s' % (EVENT_TYPE, 'есть' if EVENT_TYPE.lower() in have else 'будет создан'))
    if not DRY and EVENT_TYPE.lower() not in have:
        res = call('POST', f'_m_new/{typ[0]["id"]}?JSON=1', {'up': '1', f't{typ[0]["id"]}': EVENT_TYPE})
        if not (isinstance(res, dict) and (res.get('id') or res.get('obj'))):
            raise SystemExit(f'«{EVENT_TYPE}» не записан: {res}')

    # 3. права
    with open(GRANTS, encoding='utf-8') as f:
        grants = json.load(f)
    print('3. права: ' + '; '.join(f"{r['name']} ({len(r['grants'])})" for r in grants['roles']))
    if not DRY:
        schema(grants)

    # 4. меню
    for role_id, role_name in MENU_ROLES.items():
        rows = call('GET', f'object/{MENU_TABLE}/?JSON_OBJ&F_U={role_id}&LIMIT=0,200') or []
        if any(len(x.get('r') or []) > 1 and str(x['r'][1]).strip() == MENU['href'] for x in rows):
            print(f'4. меню {role_name}: пункт уже есть')
            continue
        print(f'4. меню {role_name}: добавляю «{MENU["name"]}»')
        if DRY:
            continue
        res = call('POST', f'_m_new/{MENU_TABLE}?JSON=1&up={role_id}', {
            f't{MENU_TABLE}': MENU['name'], 't153': MENU['href'], 't391': MENU['icon']})
        if not (isinstance(res, dict) and (res.get('id') or res.get('obj'))):
            raise SystemExit(f'пункт меню не записан: {res}')
    if DRY:
        print('Сухой прогон: ничего не записано.')


if __name__ == '__main__':
    main()
