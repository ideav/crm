#!/usr/bin/env python3
# Пульт высечки ставит статусы позиции и заказа этикетки (ideav/crm#5358, Фаза 2 atex) - права и справочник.
#
# Что делает (повторный запуск ничего не дублирует):
#   1. значение «Выполнена» в справочнике «Статус позиции» (у Оператора нет прав создавать записи
#      справочника, а label-status-core.js создаёт его только при отсутствии);
#   2. проверяет «Выполнен» в справочнике «Статус заказа» (без него заказ не закрывается);
#   3. права роли «Оператор» из docs/atex_p2_die_cutter_status_5358.json.
#
# Запуск (только база Фазы 2):
#   TOKEN=<X-Authorization> DB=https://ideav.ru/ateh1 python3 docs/scripts/apply_die_cutter_status_5358.py [--dry-run]

import os, sys, json, urllib.request, urllib.parse, urllib.error

DB = os.environ.get('DB', 'https://ideav.ru/ateh1').rstrip('/')
TOKEN = os.environ.get('TOKEN', '')
DRY = '--dry-run' in sys.argv
HERE = os.path.dirname(os.path.abspath(__file__))
GRANTS = os.path.join(HERE, '..', 'atex_p2_die_cutter_status_5358.json')
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


def dict_values(meta, name):
    t = [x for x in meta if str(x.get('val', '')).strip().lower() == name.lower()]
    if not t:
        raise SystemExit(f'в базе нет таблицы «{name}»')
    objs = call('GET', f'object/{t[0]["id"]}/?JSON_KV&LIMIT=0,1000').get('object') or []
    return t[0]['id'], {str(o.get('val', '')).strip().lower() for o in objs}


def main():
    global XSRF
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    if not TOKEN:
        raise SystemExit('нет TOKEN')
    XSRF = call('GET', 'xsrf?JSON=1').get('_xsrf', '')
    meta = call('GET', 'metadata?JSON=1')

    tid, have = dict_values(meta, 'Статус позиции')
    done = bool(have & {'выполнена', 'выполнено'})
    print('1. «Статус позиции» → «Выполнена»: ' + ('есть' if done else 'будет создано'))
    if not DRY and not done:
        res = call('POST', f'_m_new/{tid}?JSON=1', {'up': '1', f't{tid}': 'Выполнена'})
        if not (isinstance(res, dict) and (res.get('id') or res.get('obj'))):
            raise SystemExit(f'«Выполнена» не записана: {res}')

    _, have = dict_values(meta, 'Статус заказа')
    if not have & {'выполнен', 'выполнено'}:
        raise SystemExit('2. в «Статус заказа» нет «Выполнен» - заведите значение вручную')
    print('2. «Статус заказа» → «Выполнен»: есть')

    with open(GRANTS, encoding='utf-8') as f:
        grants = json.load(f)
    print('3. права: ' + '; '.join(f"{r['name']} ({len(r['grants'])})" for r in grants['roles']))
    if not DRY:
        res = call('POST', '_d_schema?JSON', {'json': json.dumps(grants, ensure_ascii=False)})
        if not res.get('ok'):
            print(json.dumps(res, ensure_ascii=False, indent=1))
            raise SystemExit('_d_schema отказал')
        print(f'   создано {res.get("created")}, обновлено {res.get("updated")}, было {res.get("existing")}')
    else:
        print('Сухой прогон: ничего не записано.')


if __name__ == '__main__':
    main()
