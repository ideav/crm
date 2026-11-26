#!/usr/bin/env python3
# «Сырьё из заказа» в таблице «Заказы этикетки» (ideav/crm#5720): колонки отчёта label_positions.
#
#   Примечание       — «Примечание» позиции, скрыта (t107=1): только псевдоним прим1с для формул;
#   Сырьё из заказа  — вычисляемая (SQL): сырьё из номенклатуры 1С — слово после первого «шт.»,
#                      кроме «намотка», «вт», «каучук», «акрил» (как lp.orderMaterial); ставится сразу
#                      после колонки «Сырьё», чтобы сравнивать глазами;
#   Номенклатура 1С  — вычисляемая: текст после «Номенклатура 1С:» до «;» (так пишет импорт 1С);
#                      без префикса — примечание до « · ». Её читает карточка позиции.
#
# Идемпотентно (колонка с таким именем есть — не трогается), печатает БЫЛО → СТАЛО. После записи
# читает отчёт: ошибка отчёта — созданные колонки удаляются; значения «Сырьё из заказа» сверяются с
# тем же правилом на Python по колонке «Номенклатура 1С».
#
# Запуск:
#   TOKEN=<X-Authorization> DB=https://ideav.ru/ateh1 python3 docs/scripts/add_order_material_cols_5720.py [--dry-run]

import os, re, sys, json, urllib.request, urllib.parse, urllib.error

DB = os.environ.get('DB', 'https://ideav.ru/ateh1').rstrip('/')
TOKEN = os.environ.get('TOKEN', '')
DRY = '--dry-run' in sys.argv
REPORT, POS, NOTE, AFTER = 'label_positions', 'Заказанное количество', 'Примечание', 'Сырьё'
ALIAS = 'прим1с'
PREFIX = 'Номенклатура 1С:'
NOM = ("IF(LOCATE('{p}', {a}) > 0, TRIM(SUBSTRING_INDEX(SUBSTRING_INDEX({a}, '{p}', -1), ';', 1)), "
       "TRIM(SUBSTRING_INDEX({a}, ' · ', 1)))").format(p=PREFIX, a=ALIAS)
TOK = "SUBSTRING_INDEX(TRIM(SUBSTRING({n}, LOCATE('шт.', {n}) + 3)), ' ', 1)".format(n=NOM)
MAT = "IF(LOCATE('шт.', {n}) = 0, '', IF({t} REGEXP '^(намотка|вт|каучук|акрил)', '', {t}))".format(n=NOM, t=TOK)
XSRF = ''


def req(method, path, fields=None):
    data = urllib.parse.urlencode(fields).encode() if fields is not None else None
    r = urllib.request.Request(f'{DB}/{path}', data=data, method=method,
                               headers={'X-Authorization': TOKEN, 'Accept': 'application/json'})
    try:
        with urllib.request.urlopen(r, timeout=120) as resp:
            body = resp.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', 'replace')
    try:
        return json.loads(body)
    except ValueError:
        return {'error': 'не JSON: ' + body[:400]}


def post(path, fields):
    res = req('POST', path, dict(fields, _xsrf=XSRF))
    if isinstance(res, dict) and res.get('error'):
        raise SystemExit(f'{path}: {res}')
    return res


def mat_py(nom):
    nom = nom or ''
    i = nom.find('шт.')
    if i < 0:
        return ''
    tok = nom[i + 3:].strip().split(' ')[0]
    return '' if re.match(r'(?i)^(намотка|вт|каучук|акрил)', tok) else tok


def main():
    global XSRF
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    if not TOKEN:
        raise SystemExit('нет TOKEN')
    meta = req('GET', 'metadata?JSON=1')
    pos = next((x for x in meta if str(x.get('val', '')).strip() == POS), None)
    note = next((r for r in (pos or {}).get('reqs') or [] if str(r.get('val', '')).strip() == NOTE), None)
    if not note:
        raise SystemExit(f'нет «{NOTE}» у «{POS}»')
    reports = req('GET', 'object/22/?JSON_OBJ&LIMIT=0,5000') or []
    qid = next((str(r['i']) for r in reports if str((r.get('r') or [''])[0]).strip() == REPORT), None)
    if not qid:
        raise SystemExit(f'нет отчёта {REPORT}')
    rep = req('GET', f'report/{qid}?JSON=1')
    have = [str(c.get('name') or c.get('val') or '').strip() for c in (rep.get('columns') or [])]
    print(f'{REPORT} (queryId={qid}): колонок {len(have)}; «{AFTER}» — {have.index(AFTER) + 1 if AFTER in have else "нет"}-я')
    plan = [
        (NOTE, {'t28': str(note['id']), 't100': NOTE, 't101': ALIAS, 't107': '1'}),
        ('Сырьё из заказа', {'t28': '0', 't100': 'Сырьё из заказа', 't101': MAT}),
        ('Номенклатура 1С', {'t28': '0', 't100': 'Номенклатура 1С', 't101': NOM}),
    ]
    for name, f in plan:
        print(f'  «{name}»: ' + ('есть — без изменений' if name in have else 'БЫЛО нет → СТАЛО есть' +
              (' (скрыта, псевдоним ' + ALIAS + ')' if f.get('t107') else '') + (f'\n      SQL: {f["t101"]}' if f['t28'] == '0' else '')))
    if DRY:
        print('Сухой прогон: ничего не записано.')
        return
    XSRF = req('GET', 'xsrf?JSON=1').get('_xsrf', '')
    created = {}
    for name, f in plan:
        if name in have:
            continue
        res = post(f'_m_new/28?JSON&up={qid}', f)
        created[name] = str(res.get('id') or res.get('obj'))
    # «Сырьё из заказа» — сразу после «Сырьё»
    recs = req('GET', f'report/{qid}?JSON=1').get('columns') or []
    order = [str(c.get('name') or c.get('val') or '').strip() for c in recs]
    if 'Сырьё из заказа' in created and AFTER in order:
        want = order.index(AFTER) + 2
        post(f'_m_ord/{created["Сырьё из заказа"]}?JSON', {'order': str(want)})
        print(f'  «Сырьё из заказа»: позиция {want} (после «{AFTER}»)')
    rows = req('GET', f'report/{REPORT}?JSON_KV&LIMIT=0,10000')
    if not isinstance(rows, list):
        for name in ('Сырьё из заказа', 'Номенклатура 1С'):
            if name in created:
                post(f'_m_del/{created[name]}?JSON', {})
        raise SystemExit(f'отчёт после правки отвечает ошибкой — вычисляемые колонки удалены: {json.dumps(rows, ensure_ascii=False)[:400]}')
    with_nom = [r for r in rows if str(r.get('Номенклатура 1С') or '').strip()]
    bad = [r for r in with_nom if str(r.get('Сырьё из заказа') or '') != mat_py(str(r.get('Номенклатура 1С')))]
    tally = {}
    for r in rows:
        v = str(r.get('Сырьё из заказа') or '')
        tally[v] = tally.get(v, 0) + 1
    print(f'report/{REPORT}: строк {len(rows)}, с номенклатурой 1С {len(with_nom)}, расхождений с правилом {len(bad)}')
    print('  «Сырьё из заказа»: ' + json.dumps(tally, ensure_ascii=False))
    for r in bad[:5]:
        print('  расхождение: ' + json.dumps({k: r.get(k) for k in ('Сырьё', 'Сырьё из заказа', 'Номенклатура 1С')}, ensure_ascii=False))
    final = [str(c.get('name') or c.get('val') or '').strip() for c in (req('GET', f'report/{qid}?JSON=1').get('columns') or [])]
    print('  порядок колонок: ' + ', '.join(final))


if __name__ == '__main__':
    main()
