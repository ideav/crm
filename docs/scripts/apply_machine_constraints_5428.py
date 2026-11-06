#!/usr/bin/env python3
# Ограничения станков высечки (ideav/crm#5428) — реквизиты станка, у каждого станка свои:
#   1. реквизиты «Станка высечки» из docs/atex_p2_machine_constraints_schema_5428.json (`_d_schema`,
#      идемпотентно: есть — не меняются);
#   2. значения по номеру станка (номер — начало имени: «2 высечка»):
#        2-й станок         — «Мин. вал» 96, «Макс. вал» 104, «Стоп-лист основы» = ПП;
#        станок с туррелью  — «Мин. метраж серии, м» 40000, «Макс. намотка ролика, м» 350,
#                             «Втулка не уже диаметра» = да.
#      Печатает БЫЛО → СТАЛО по каждому полю; совпадающее не пишет.
# Колонки `article` и `material_base` отчёта `die_planning` после этого добавляет
# docs/scripts/create_report_die_planning_5320.py (идемпотентно).
#
# Запуск:
#   TOKEN=<X-Authorization> DB=https://ideav.ru/ateh1 python3 docs/scripts/apply_machine_constraints_5428.py [--dry-run]

import os, sys, json, urllib.request, urllib.parse, urllib.error

DB = os.environ.get('DB', 'https://ideav.ru/ateh1').rstrip('/')
TOKEN = os.environ.get('TOKEN', '')
DRY = '--dry-run' in sys.argv
SCHEMA = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'atex_p2_machine_constraints_schema_5428.json')
MACHINE, BASE = 'Станок высечки', 'Основа сырья'
FIELDS = ['Мин. вал', 'Стоп-лист основы', 'Мин. метраж серии, м', 'Макс. намотка ролика, м', 'Втулка не уже диаметра']
# номер станка → {реквизит: значение}; 'turret' — станки с признаком «Туррель». 'base:<имя>' — id основы по имени.
VALUES = {
    '2': {'Мин. вал': '96', 'Макс. вал': '104', 'Стоп-лист основы': 'base:пп'},
    'turret': {'Мин. метраж серии, м': '40000', 'Макс. намотка ролика, м': '350', 'Втулка не уже диаметра': '1'},
}


def req(method, path, fields=None):
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


def table(meta, name):
    t = next((x for x in meta if str(x.get('val', '')).strip() == name), None)
    if not t:
        raise SystemExit(f'нет таблицы «{name}»')
    return t


def reqs_of(t):
    return {str(r.get('val', '')).strip(): str(r['id']) for r in t.get('reqs') or []}


def listing(tid):
    res = req('GET', f'object/{tid}/?JSON_KV&LIMIT=0,5000')
    return res.get('object') or [], res.get('reqs') or {}


def plain(v):
    # мульти-ссылка в JSON_KV — «id,id:подписи» или «id:подпись»; сравниваем по id
    s = str(v if v is not None else '').strip()
    return s.split(':')[0] if ':' in s else s


def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    if not TOKEN:
        raise SystemExit('нет TOKEN')
    meta = req('GET', 'metadata?JSON=1')
    have = reqs_of(table(meta, MACHINE))
    missing = [f for f in FIELDS if f not in have]
    print(f'«{MACHINE}»: нет реквизитов: {", ".join(missing) or "—"}')
    xsrf = '' if DRY else req('GET', 'xsrf?JSON=1').get('_xsrf', '')
    if missing:
        if DRY:
            print('Сухой прогон: реквизиты не созданы — ниже план значений (БЫЛО пусто).')
            have.update({f: '?' + f for f in missing})
        else:
            spec = json.load(open(SCHEMA, encoding='utf-8'))
            res = req('POST', '_d_schema?JSON', {'json': json.dumps(spec, ensure_ascii=False), 'token': TOKEN, '_xsrf': xsrf})
            print(json.dumps(res, ensure_ascii=False))
            if not res.get('ok'):
                raise SystemExit('_d_schema отказал; база не менялась, если ответ 400')
            meta = req('GET', 'metadata?JSON=1')
            have = reqs_of(table(meta, MACHINE))
    mt = table(meta, MACHINE)
    bases, _ = listing(table(meta, BASE)['id'])
    base_id = {str(b['val']).strip().lower(): str(b['id']) for b in bases}
    machines, vals = listing(mt['id'])
    turret_req = have.get('Туррель', '')
    for m in machines:
        mid, name = str(m['id']), str(m['val']).strip()
        cur = vals.get(mid) or {}
        want = dict(VALUES.get(name.split(' ')[0], {}))
        if turret_req and str(cur.get(turret_req, '')).strip().lower() not in ('', '0', 'нет', 'false'):
            want.update(VALUES['turret'])
        for field, value in want.items():
            if value.startswith('base:'):
                value = base_id.get(value[5:])
                if not value:
                    raise SystemExit(f'нет основы «{want[field][5:]}» в «{BASE}»')
            rid = have[field]
            old = plain(cur.get(rid, ''))
            same = old == value
            try:
                same = same or float(old) == float(value)   # «104.00» = «104»
            except ValueError:
                pass
            print(f'  {name} · {field}: БЫЛО «{old}» → СТАЛО «{value}»' + (' (без изменений)' if same else ''))
            if same or DRY:
                continue
            res = req('POST', f'_m_set/{mid}?JSON', {f't{rid}': value, '_xsrf': xsrf})
            if isinstance(res, dict) and res.get('error'):
                raise SystemExit(f'_m_set {mid}: {res}')
    if DRY:
        print('Сухой прогон: ничего не записано.')


if __name__ == '__main__':
    main()
