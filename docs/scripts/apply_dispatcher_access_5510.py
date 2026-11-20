#!/usr/bin/env python3
# Диспетчер Фазы 2 (ideav/crm#5510): пункты меню и права рабочих мест «Импорт из 1С»,
# «Ножи и валы», «Раскрой джамбо», «Склад мастер-рулонов» по docs/atex_p2_dispatcher_access_5510.json:
#   - roles[] — одним вызовом `_d_schema` (существующее право находится по роли и объекту,
#     меняется его уровень и флаги);
#   - menu[] — записи таблицы Меню (151) роли; пункт с тем же адресом уже есть — пропускается.
# --dry-run ничего не пишет: читает базу и печатает БЫЛО/СТАЛО по каждому праву и пункту меню.
# Повторный запуск ничего не дублирует.
#
# Запуск (только база Фазы 2):
#   TOKEN=<X-Authorization> DB=https://ideav.ru/ateh1 python3 docs/scripts/apply_dispatcher_access_5510.py [--dry-run]

import os, sys, json, urllib.request, urllib.parse, urllib.error

DB = os.environ.get('DB', 'https://ideav.ru/ateh1').rstrip('/')
TOKEN = os.environ.get('TOKEN', '')
DRY = '--dry-run' in sys.argv
SPEC = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'atex_p2_dispatcher_access_5510.json')
T_ROLE, T_MENU, T_GRANT, T_QUERY = '42', '151', '116', '22'
F_MENU_HREF, F_MENU_ICON = 't153', 't391'


def call(method, path, fields=None):
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


def rows(table, up=None):
    q = f'object/{table}/?JSON&LIMIT=0,5000' + (f'&F_U={up}' if up else '')
    j = call('GET', q)
    return j.get('object') or [], j.get('reqs') or {}


def find_role(name):
    objs, _ = rows(T_ROLE)
    for o in objs:
        if o['val'] == name:
            return o['id']
    raise SystemExit(f'нет роли «{name}»')


def object_ids(meta, reports):
    # Имя таблицы → id и имя отчёта → id: так права роли (ссылки на объекты) сводятся с описанием.
    tables = {}
    for t in meta:
        tables.setdefault(t['val'], str(t['id']))
    return tables, {o['val']: str(o['id']) for o in reports}


def grant_line(g):
    obj = f"отчёт {g['report']}" if g.get('report') else f"«{g['table']}»"
    return obj + (' + удаление' if g.get('delete') else '')


def plan(spec):
    meta = call('GET', 'metadata?JSON=1')
    reports, _ = rows(T_QUERY)
    tables, reps = object_ids(meta, reports)
    out = []
    for role in spec['roles']:
        rid = find_role(role['name'])
        objs, reqs = rows(T_GRANT, rid)
        have = {str(o.get('ref')): reqs.get(o['id'], {}) for o in objs}
        print(f"\nРоль «{role['name']}» ({rid}) — права, БЫЛО → СТАЛО:")
        for g in role['grants']:
            oid = reps.get(g['report']) if g.get('report') else tables.get(g['table'])
            if not oid:
                raise SystemExit(f'в базе нет объекта {grant_line(g)}')
            cur = have.get(oid)
            was = 'нет' if cur is None else cur.get('136', '?') + (' + удаление' if cur.get('56') == '1' else '')
            now = g['level'] + (' + удаление' if g.get('delete') else '')
            mark = '  ' if was == now else '→ '
            print(f"  {mark}{grant_line(g)} [{oid}]: {was} → {now}")
    for role_name in sorted({m['role'] for m in spec['menu']}):
        rid = find_role(role_name)
        objs, reqs = rows(T_MENU, rid)
        hrefs = {reqs.get(o['id'], {}).get(F_MENU_HREF[1:], '') for o in objs}
        print(f"\nРоль «{role_name}» ({rid}) — меню:")
        for m in spec['menu']:
            if m['role'] != role_name:
                continue
            if m['href'] in hrefs:
                print(f"     «{m['name']}» ({m['href']}): есть")
            else:
                print(f"  → «{m['name']}» ({m['href']}): нет → добавить")
                out.append((rid, m))
    return out


def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    if not TOKEN:
        raise SystemExit('нет TOKEN')
    with open(SPEC, encoding='utf-8') as f:
        spec = json.load(f)
    missing_menu = plan(spec)
    if DRY:
        print('\n--dry-run: ничего не записано')
        return
    xsrf = call('GET', 'xsrf?JSON=1').get('_xsrf', '')
    res = call('POST', '_d_schema?JSON', {'json': json.dumps({'roles': spec['roles']}, ensure_ascii=False), '_xsrf': xsrf})
    print('\n_d_schema:', json.dumps({k: res.get(k) for k in ('ok', 'created', 'updated', 'existing', 'errors')}, ensure_ascii=False))
    if not res.get('ok'):
        raise SystemExit('_d_schema отказал — см. errors выше')
    for rid, m in missing_menu:
        r = call('POST', f'_m_new/{T_MENU}?JSON=1', {'up': rid, f't{T_MENU}': m['name'], F_MENU_HREF: m['href'],
                                                    F_MENU_ICON: m['icon'], '_xsrf': xsrf})
        print(f"меню «{m['name']}»: {json.dumps(r, ensure_ascii=False)[:200]}")
    print('\nПосле записи:')
    plan(spec)


if __name__ == '__main__':
    main()
