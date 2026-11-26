#!/usr/bin/env python3
# Физические валы с серийным номером (ideav/crm#5720), как ножи у «Типа ножа»:
#   «Вал» (зубья, раппорт) — типоразмер; «Серийный номер вала» — физический вал: номер + ссылка «Вал».
#   Планирование высечки само выбирает свободный в это время вал нужного типоразмера и пишет его в
#   «Задание высечки» → «Серийный номер вала»; пульт высечки показывает оператору, какой вал взять.
#
# Шаги (идемпотентно, печатает БЫЛО → СТАЛО):
#   1. удалить пустой реквизит «Количество» у «Вала» (заводился ранее в #5720, модель отменена);
#   2. таблица «Серийный номер вала» (первая колонка — номер, уникальна) + ссылка «Вал»;
#   3. ссылка «Серийный номер вала» в «Задании высечки»;
#   4. по одному валу на каждый «Вал» без серийных — порядковые номера 1, 2, … (по возрастанию зубьев);
#      настоящие номера владелец впишет поверх, лишние валы — новыми записями;
#   5. колонки shaft_id / shaft_no в отчётах die_planning и die_cutter_jobs.
#
# Запуск:
#   TOKEN=<X-Authorization> DB=https://ideav.ru/ateh1 python3 docs/scripts/add_shaft_serials_5720.py [--dry-run]

import os, sys, json, urllib.request, urllib.parse, urllib.error

DB = os.environ.get('DB', 'https://ideav.ru/ateh1').rstrip('/')
TOKEN = os.environ.get('TOKEN', '')
DRY = '--dry-run' in sys.argv
CYL, SERIAL, JOB, OLD = 'Вал', 'Серийный номер вала', 'Задание высечки', 'Количество'
SHORT, ABN_ID = '3', 85
REPORTS = ['die_planning', 'die_cutter_jobs']
XSRF = ''


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


def num(v):
    try:
        return float(str(v).replace(',', '.'))
    except ValueError:
        return 0.0


def main():
    global XSRF
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    if not TOKEN:
        raise SystemExit('нет TOKEN')
    if not DRY:
        XSRF = req('GET', 'xsrf?JSON=1').get('_xsrf', '')
    meta = req('GET', 'metadata?JSON=1')
    cyl, job = table(meta, CYL), table(meta, JOB)
    if not cyl or not job:
        raise SystemExit(f'нет таблиц «{CYL}» / «{JOB}»')
    cyl_id = str(cyl['id'])

    # 1. «Количество» у «Вала»
    old = field(cyl, OLD)
    if old:
        vals = req('GET', f'object/{cyl_id}/?JSON_KV&LIMIT=0,500').get('reqs') or {}
        filled = [k for k, v in vals.items() if str((v or {}).get(str(old['id']), '')).strip()]
        if filled:
            raise SystemExit(f'«{OLD}» у «{CYL}» заполнено у {len(filled)} записей — не удаляю, разберите вручную')
        print(f'«{CYL}» · «{OLD}» ({old["id"]}): БЫЛО есть (пусто) → СТАЛО нет')
        if not DRY:
            post(f'_d_del_req/{old["id"]}?JSON=1', {})
    else:
        print(f'«{CYL}» · «{OLD}»: нет — без изменений')

    # 2. «Серийный номер вала» + ссылка «Вал»
    ser = table(meta, SERIAL)
    print(f'таблица «{SERIAL}»: ' + (f'есть ({ser["id"]}) — без изменений' if ser else 'БЫЛО нет → СТАЛО есть'))
    if DRY and not ser:
        print('Сухой прогон: дальше — ссылки, порядковые номера по валам и колонки отчётов.')
        cyls = sorted(req('GET', f'object/{cyl_id}/?JSON_KV&LIMIT=0,500').get('object') or [], key=lambda o: num(o['val']))
        for i, o in enumerate(cyls, 1):
            print(f'  вал {o["val"]}: серийный № БЫЛО — → СТАЛО {i}')
        print('Сухой прогон: ничего не записано.')
        return
    if not ser:
        ser_id = str(post('_d_new?JSON=1', {'t': SHORT, 'val': SERIAL, 'unique': '1'}).get('obj') or '')
        if not ser_id:
            raise SystemExit('_d_new не вернул id таблицы')
    else:
        ser_id = str(ser['id'])
    meta = req('GET', 'metadata?JSON=1')
    ser = table(meta, SERIAL)
    if not field(ser, CYL):
        print(f'«{SERIAL}» · ссылка «{CYL}»: БЫЛО нет → СТАЛО есть')
        if not DRY:
            ref = str(post(f'_d_ref/{cyl_id}?JSON=1', {}).get('obj') or '')
            post(f'_d_req/{ser_id}?JSON=1', {'t': ref})
    # 3. ссылка в «Задании высечки»
    if not field(job, SERIAL):
        print(f'«{JOB}» · ссылка «{SERIAL}»: БЫЛО нет → СТАЛО есть')
        if not DRY:
            ref = str(post(f'_d_ref/{ser_id}?JSON=1', {}).get('obj') or '')
            post(f'_d_req/{job["id"]}?JSON=1', {'t': ref})
    meta = req('GET', 'metadata?JSON=1')
    ser, job = table(meta, SERIAL), table(meta, JOB)
    ser_cyl = str(field(ser, CYL)['id'])

    # 4. порядковые номера
    serials = req('GET', f'object/{ser_id}/?JSON_KV&LIMIT=0,2000')
    have = {}
    for o in serials.get('object') or []:
        v = str(((serials.get('reqs') or {}).get(str(o['id'])) or {}).get(ser_cyl, '')).split(':')[0].strip()
        have.setdefault(v, []).append(str(o['val']))
    used = [num(v) for vs in have.values() for v in vs]
    nxt = int(max(used)) if used else 0
    cyls = sorted(req('GET', f'object/{cyl_id}/?JSON_KV&LIMIT=0,500').get('object') or [], key=lambda o: num(o['val']))
    for o in cyls:
        cur = have.get(str(o['id']))
        if cur:
            print(f'  вал {o["val"]}: серийные {", ".join(cur)} — без изменений')
            continue
        nxt += 1
        print(f'  вал {o["val"]}: серийный № БЫЛО — → СТАЛО {nxt}')
        post(f'_m_new/{ser_id}?JSON&up=1', {f't{ser_id}': str(nxt), f't{ser_cyl}': str(o['id'])})

    # 5. колонки отчётов
    job_ser = str(field(job, SERIAL)['id'])
    reports = req('GET', 'object/22/?JSON_OBJ&LIMIT=0,5000') or []
    for name in REPORTS:
        qid = next((str(r['i']) for r in reports if str((r.get('r') or [''])[0]).strip() == name), None)
        if not qid:
            print(f'отчёт {name}: нет — пропущен')
            continue
        cols = req('GET', f'report/{qid}?JSON=1').get('columns') or []
        names = {str(c.get('name') or c.get('val') or '').strip() for c in cols}
        for t100, fn in (('shaft_id', ABN_ID), ('shaft_no', None)):
            if t100 in names:
                print(f'отчёт {name} · {t100}: есть — без изменений')
                continue
            print(f'отчёт {name} · {t100}: БЫЛО нет → СТАЛО есть')
            created = post(f'_m_new/28?JSON&up={qid}', {'t28': job_ser, 't100': t100})
            cid = str(created.get('id') or created.get('obj'))
            if fn:
                post(f'_m_set/{cid}?JSON', {'t104': str(fn)})
    rows = req('GET', 'report/die_planning?JSON_KV&LIMIT=0,2')
    print('report/die_planning: ' + json.dumps(rows, ensure_ascii=False)[:300])


if __name__ == '__main__':
    main()
