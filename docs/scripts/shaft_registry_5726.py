#!/usr/bin/env python3
# Реестр валов ИТС (ideav/crm#5726) — «Серийный номер вала» по актуальному списку владельца.
#   Номер вала «зубья/экземпляр» (96/1 … 148/1); красные в списке (изношены) остаются в реестре,
#   но «Не ставить в работу» — планировщик высечки их не берёт (die-planning-core.js, #5726).
#
# Шаги (идемпотентно, печатает БЫЛО → СТАЛО):
#   1. реквизиты «Не ставить в работу» (BOOLEAN) и «Примечание» (MEMO, общий термин) у «Серийного номера вала»;
#   2. порядковые заглушки #5720 (1…10, по одной на типоразмер) переименовываются в «<зубья>/1» — id
#      остаются, ссылки из заданий не рвутся; остальные валы реестра создаются;
#   3. «Не ставить в работу» и «Примечание» — по реестру; валы вне реестра печатаются, не удаляются.
#
# Запуск:
#   TOKEN=<X-Authorization> DB=https://ideav.ru/ateh1 python3 docs/scripts/shaft_registry_5726.py [--dry-run]

import os, sys, json, urllib.request, urllib.parse, urllib.error

DB = os.environ.get('DB', 'https://ideav.ru/ateh1').rstrip('/')
TOKEN = os.environ.get('TOKEN', '')
DRY = '--dry-run' in sys.argv
CYL, SERIAL, OFF, NOTE = 'Вал', 'Серийный номер вала', 'Не ставить в работу', 'Примечание'
BOOLEAN, MEMO = '11', '12'
XSRF = ''

# Реестр из crm#5726 (реестр валов.xlsx): номер, «Не ставить в работу» (красные), комментарий («ок» не пишется)
WORN = 'Не используется сильно изношен'
REGISTRY = [
    ('66/1', False, ''), ('74/1', False, ''),
    ('96/1', False, 'Сторона привода имеет структуру с бороздами от неравномерной выроботки(сглаженную после длительной '
                    'правильной эксплуатации)0,48 на краю, середина разновысотная'),
    ('96/2', False, ''), ('96/3', False, ''), ('96/4', False, ''), ('98/1', False, ''),
    ('104/1', False, ''), ('104/2', False, ''),
    ('116/1', True, WORN), ('116/2', False, ''), ('116/3', False, ''),
    ('132/1', True, 'Не используется. Сторона привода сильно изношена'), ('132/2', False, ''),
    ('134/1', False, ''), ('142/1', False, ''), ('148/1', False, ''),
]


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


def post(path, fields):
    if DRY:
        return {}
    res = req('POST', path, dict(fields, _xsrf=XSRF))
    if isinstance(res, dict) and res.get('error'):
        raise SystemExit(f'{path}: {res}')
    return res


def table(meta, name):
    return next((x for x in meta if str(x.get('val', '')).strip() == name), None)


def field(t, name):
    for r in (t or {}).get('reqs') or []:
        alias = str((r.get('field_attrs') or {}).get('alias') or '').strip()
        if str(r.get('val', '')).strip() == name or alias == name:
            return r
    return None


def on(v):
    return str(v or '').strip().lower() not in ('', '0', '-1', 'нет', 'false')


def main():
    global XSRF
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    if not TOKEN:
        raise SystemExit('нет TOKEN')
    if not DRY:
        XSRF = req('GET', 'xsrf?JSON=1').get('_xsrf', '')
    print(f'=== #5726: реестр валов, база {DB}' + (' (сухой прогон)' if DRY else '') + ' ===')
    meta = req('GET', 'metadata?JSON=1')
    cyl, ser = table(meta, CYL), table(meta, SERIAL)
    if not cyl or not ser or not field(ser, CYL):
        raise SystemExit(f'нет «{CYL}» / «{SERIAL}» со ссылкой на вал — сначала add_shaft_serials_5720.py')
    ser_id = str(ser['id'])

    # 1. реквизиты
    note_term = next((str(r.get('orig')) for t in meta for r in (t.get('reqs') or [])
                      if str(r.get('val', '')).strip() == NOTE and str(r.get('type')) == MEMO and r.get('orig')), '')
    for name, base, term in ((OFF, BOOLEAN, ''), (NOTE, MEMO, note_term)):
        if field(ser, name):
            print(f'«{SERIAL}» · «{name}»: есть — без изменений')
            continue
        print(f'«{SERIAL}» · «{name}»: БЫЛО нет → СТАЛО есть' + (f' (общий термин {term})' if term else ''))
        if not term:
            term = str(post('_d_new?JSON=1', {'t': base, 'val': name}).get('obj') or '')
        post(f'_d_req/{ser_id}?JSON=1', {'t': term})
    if DRY and not (field(ser, OFF) and field(ser, NOTE)):
        rq = {CYL: str(field(ser, CYL)['id']), OFF: 'OFF', NOTE: 'NOTE'}
    else:
        ser = table(req('GET', 'metadata?JSON=1'), SERIAL)
        rq = {k: str(field(ser, k)['id']) for k in (CYL, OFF, NOTE)}

    # 2–3. валы
    cyls = req('GET', f'object/{cyl["id"]}/?JSON_KV&LIMIT=0,500').get('object') or []
    cyl_by_teeth = {str(o['val']).strip(): str(o['id']) for o in cyls}
    data = req('GET', f'object/{ser_id}/?JSON_KV&LIMIT=0,2000')
    reqs = data.get('reqs') or {}
    rows = []
    for o in data.get('object') or []:
        r = reqs.get(str(o['id'])) or {}
        rows.append({'id': str(o['id']), 'no': str(o['val']).strip(), 'cyl': str(r.get('ref_' + rq[CYL], '')).split(':')[-1].strip(),
                     'off': on(r.get(rq[OFF])), 'note': str(r.get(rq[NOTE]) or '').strip()})
    by_no = {x['no']: x for x in rows}
    used = set()
    for no, off, note in REGISTRY:
        teeth = no.split('/')[0]
        cid = cyl_by_teeth.get(teeth)
        if not cid:
            raise SystemExit(f'вал {no}: нет типоразмера «{CYL}» {teeth}')
        cur = by_no.get(no)
        if not cur and no.endswith('/1'):
            # порядковая заглушка #5720 этого типоразмера: номер — одно число
            cur = next((x for x in rows if x['cyl'] == cid and x['no'].isdigit() and x['id'] not in used), None)
            if cur:
                print(f'  {no}: номер БЫЛО «{cur["no"]}» → СТАЛО «{no}» (id {cur["id"]})')
                # первая колонка — только _m_save: _m_set на ядре ideav.ru отвечает "id":"" и не меняет (docs/kb/crud.md)
                res = post(f'_m_save/{cur["id"]}?JSON', {f't{ser_id}': no})
                if not DRY and not str((res or {}).get('id') or (res or {}).get('obj') or ''):
                    raise SystemExit(f'вал {no}: _m_save не переименовал запись {cur["id"]}: {res}')
        if not cur:
            print(f'  {no}: БЫЛО нет → СТАЛО есть' + (', не ставить в работу' if off else '') + (f', примечание «{note[:40]}…»' if note else ''))
            f = {f't{ser_id}': no, f't{rq[CYL]}': cid}
            if off:
                f[f't{rq[OFF]}'] = '1'
            if note:
                f[f't{rq[NOTE]}'] = note
            post(f'_m_new/{ser_id}?JSON&up=1', f)
            continue
        used.add(cur['id'])
        if cur['cyl'] != cid:
            raise SystemExit(f'вал {no} (id {cur["id"]}) ссылается не на «{CYL}» {teeth} — разберите вручную')
        f = {}
        if cur['off'] != off:
            print(f'  {no}: «{OFF}» БЫЛО {"да" if cur["off"] else "нет"} → СТАЛО {"да" if off else "нет"}')
            f[f't{rq[OFF]}'] = '1' if off else '0'
        if note and cur['note'] != note:
            print(f'  {no}: «{NOTE}» БЫЛО «{cur["note"][:40]}» → СТАЛО «{note[:40]}…»')
            f[f't{rq[NOTE]}'] = note
        if f:
            post(f'_m_set/{cur["id"]}?JSON', f)
        elif by_no.get(no):
            print(f'  {no}: без изменений')
    names = {r[0] for r in REGISTRY}
    for x in rows:
        if x['id'] not in used and x['no'] not in names:
            print(f'  вне реестра: «{x["no"]}» (id {x["id"]}) — не трогаю')
    print('Сухой прогон: ничего не записано.' if DRY else 'Готово.')


if __name__ == '__main__':
    main()
