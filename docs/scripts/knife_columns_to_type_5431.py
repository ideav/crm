#!/usr/bin/env python3
# Параметры ножа живут только в «Типе ножа» (ideav/crm#5431): колонки параметров удаляются из «Ножа».
#
# Что делает (по шагам, каждый печатает БЫЛО -> СТАЛО):
#   1. проверка: у каждого ножа с непустыми параметрами есть «Тип ножа» — иначе стоп, ничего не пишется;
#   2. резервная копия: значения удаляемых колонок всех ножей (+ тип) -> JSON-файл (--backup);
#   3. колонки отчётов, которые смотрят на удаляемые колонки «Ножа» (на ateh1 13.11.2026:
#      die_tasks, die_cutter_jobs, die_planning, label_packer — ручьи, форматы, м/э), переводятся
#      на те же колонки «Типа ножа» (_m_set t28); в отчёт добавляется скрытая колонка ссылки
#      «Тип ножа», чтобы ядро соединяло Нож -> Тип ножа по ней (docs/kb/report-building.md §2);
#   4. сверка отчётов: колонка, которая была непустой, не должна опустеть — иначе стоп до удаления;
#   5. _d_del_req удаляемых колонок «Ножа» (forced=1).
# Расхождения «нож != тип» (103 ножа на ateh1) не переносятся: решение владельца — актуален тип.
# Повторный запуск безопасен: удалённых колонок нет — шаги 3–5 ничего не делают.
#
# Запуск (сначала сухой прогон):
#   TOKEN=<X-Authorization> DB=https://ideav.ru/ateh1 python3 docs/scripts/knife_columns_to_type_5431.py --dry-run
#   TOKEN=<X-Authorization> DB=https://ideav.ru/ateh1 python3 docs/scripts/knife_columns_to_type_5431.py --backup knives_5431.json

import os, sys, json, urllib.request, urllib.parse, urllib.error

DB = os.environ.get('DB', 'https://ideav.ru/ateh1').rstrip('/')
TOKEN = os.environ.get('TOKEN', '')
DRY = '--dry-run' in sys.argv
BACKUP = sys.argv[sys.argv.index('--backup') + 1] if '--backup' in sys.argv else 'knife_columns_5431_backup.json'
KNIFE, TYPE = 'Нож', 'Тип ножа'
LINK_COL = 'die_type'
# Колонки параметров: имя у «Ножа» -> имя у «Типа ножа».
PARAMS = {name: name for name in [
    'Ширина этикетки, мм', 'Длина этикетки, мм', 'Ручьёв', 'Этикеток на раппорте', 'М/э расстояние, мм',
    'Между ручьями, мм', 'Ширина кромки, мм', 'Вал', 'Минимальный формат, мм', 'Оптимальный формат, мм',
    'Исп. формат, мм', 'Ширина втулки, мм', 'Угол заточки', 'Основа сырья']}
PARAMS['Основа'] = 'Основа сырья'
XSRF = ''


def call(method, path, fields=None):
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
        raise SystemExit(f'{method} {path}: не JSON: {body[:300]}')


def post(path, fields):
    return call('POST', path, dict(fields, _xsrf=XSRF))


def alias(r):
    fa = r.get('field_attrs') or {}
    return fa.get('alias') or r.get('alias') or ''


def col_name(r):
    return (alias(r) or r.get('val') or '').strip()


def kv(tid):
    """object/{t}/?JSON_KV -> {id: {'val', 'reqs'}}."""
    j = call('GET', f'object/{tid}/?JSON_KV&LIMIT=0,100000') or {}
    reqs = j.get('reqs') or {}
    return {str(o['id']): {'val': str(o.get('val') or ''), 'reqs': reqs.get(str(o['id'])) or {}} for o in (j.get('object') or [])}


def num(s):
    try:
        return float(str(s).replace(',', '.').replace('°', '').strip())
    except ValueError:
        return None


def same(a, b):
    a, b = str(a or '').strip(), str(b or '').strip()
    na, nb = num(a), num(b)
    return a == b or (na is not None and nb is not None and abs(na - nb) < 1e-9)


def schema(meta):
    """-> (die, typ, link_id, [(имя, id колонки ножа, id колонки типа)])."""
    die = next((t for t in meta if (t.get('val') or '').strip() == KNIFE), None)
    typ = next((t for t in meta if (t.get('val') or '').strip() == TYPE), None)
    if not die or not typ:
        raise SystemExit(f'нет таблицы «{KNIFE}» или «{TYPE}» (сначала docs/scripts/knife_types_5427.py)')
    link = next((r for r in die['reqs'] if str(r.get('ref') or '') == str(typ['id'])), None)
    if not link:
        raise SystemExit(f'в «{KNIFE}» нет ссылки на «{TYPE}» (сначала docs/scripts/knife_types_5427.py)')
    type_by = {col_name(r): str(r['id']) for r in typ['reqs']}
    pairs = []
    for r in die['reqs']:
        name = col_name(r)
        if name in PARAMS:
            to = type_by.get(PARAMS[name])
            if not to:
                raise SystemExit(f'у «{TYPE}» нет колонки «{PARAMS[name]}» — некуда переносить «{name}»')
            pairs.append((name, str(r['id']), to))
    return die, typ, str(link['id']), pairs


def check_and_backup(die, typ, link, pairs):
    knives, types = kv(die['id']), kv(typ['id'])
    lost, differ, backup = [], 0, {}
    for kid, k in knives.items():
        ref = str(k['reqs'].get(f'ref_{link}') or '')
        tid = ref.split(':', 1)[1].split(',')[0].strip() if ':' in ref else ''
        vals = {n: str(k['reqs'].get(d) or '') for n, d, _ in pairs}
        backup[kid] = {'num': k['val'], 'type': tid, 'values': vals}
        if not tid and any(v.strip() for v in vals.values()):
            lost.append(k['val'])
        elif tid in types and any(v.strip() and not same(v, types[tid]['reqs'].get(t)) for (n, d, t), v in zip(pairs, vals.values())):
            differ += 1
    print(f'ножей: {len(knives)}, типов: {len(types)}; ножей, расходящихся с типом: {differ} (актуален тип, значения ножа уходят в копию)')
    if lost:
        raise SystemExit(f'у {len(lost)} ножей с параметрами нет типа — их значения пропали бы: {", ".join(lost[:20])}. Ничего не записано.')
    with open(BACKUP, 'w', encoding='utf-8') as f:
        json.dump({'db': DB, 'columns': [{'name': n, 'die_req': d, 'type_req': t} for n, d, t in pairs], 'knives': backup},
                  f, ensure_ascii=False, indent=1)
    print(f'копия значений: {BACKUP}')


def report_plan(pairs, link):
    """-> [{qid, name, repoint: [(колонка, имя, было, стало)], add_link}] для отчётов, смотрящих на колонки «Ножа»."""
    to = {d: t for _, d, t in pairs}
    names = {d: n for n, d, _ in pairs}
    plan = []
    for rep in call('GET', 'object/22/?JSON_OBJ&LIMIT=0,5000') or []:
        cols = call('GET', f'object/28/?JSON_OBJ&F_U={rep["i"]}&LIMIT=0,1000') or []
        src = lambda c: str((c.get('r') or [''])[0] or '').split(':')[0]
        hits = [(str(c['i']), str(c['r'][1]), src(c), to[src(c)]) for c in cols if src(c) in to]
        if hits:
            plan.append({'qid': str(rep['i']), 'name': str(rep['r'][0]), 'repoint': hits,
                         'add_link': not any(src(c) == link for c in cols)})
            for cid, cname, was, now in hits:
                print(f'  отчёт {rep["r"][0]}: колонка {cname} ({cid}) t28 {was} «{KNIFE} → {names[was]}» -> {now} «{TYPE} → {names[was]}»')
    return plan


def report_rows(plan):
    return {p['qid']: call('GET', f'report/{p["qid"]}?JSON_KV&LIMIT=0,100000') for p in plan}


def emptied(before, after, plan):
    """Колонки, которые после перевода опустели там, где были заполнены: [(отчёт, колонка, строк)]."""
    out = []
    for p in plan:
        b, a = before.get(p['qid']), after.get(p['qid'])
        if not isinstance(b, list) or not isinstance(a, list):
            out.append((p['name'], '(отчёт не прочитан)', 0))
            continue
        for _, cname, _, _ in p['repoint']:
            filled_b = sum(1 for r in b if str(r.get(cname) or '').strip())
            filled_a = sum(1 for r in a if str(r.get(cname) or '').strip())
            print(f'  {p["name"]}.{cname}: строк {len(b)} -> {len(a)}, заполнено {filled_b} -> {filled_a}')
            if filled_a < filled_b or len(a) != len(b):
                out.append((p['name'], cname, filled_b - filled_a))
    return out


def main():
    global XSRF
    if not TOKEN:
        raise SystemExit('Нужен TOKEN=<X-Authorization>')
    die, typ, link, pairs = schema(call('GET', 'metadata?JSON'))
    print(f'«{KNIFE}» {die["id"]}, «{TYPE}» {typ["id"]}, ссылка {link}')
    if not pairs:
        print(f'у «{KNIFE}» колонок параметров нет — всё уже сделано.')
        return
    print(f'колонки «{KNIFE}» к удалению ({len(pairs)}): ' + ', '.join(f'{n} ({d})' for n, d, _ in pairs))
    check_and_backup(die, typ, link, pairs)
    plan = report_plan(pairs, link)
    print(f'отчётов к переводу на «{TYPE}»: {len(plan)}' + ''.join(
        f'\n  {p["name"]}: + скрытая колонка {LINK_COL} (ссылка «{TYPE}»)' for p in plan if p['add_link']))
    before = report_rows(plan)
    if DRY:
        print('Сухой прогон: ничего не записано.')
        return
    XSRF = call('GET', 'xsrf?JSON').get('_xsrf', '')
    for p in plan:
        if p['add_link']:
            res = post(f'_m_new/28?JSON&up={p["qid"]}', {'t28': link, 't100': LINK_COL})
            cid = str(res.get('id') or res.get('obj') or '')
            if not cid:
                raise SystemExit(f'{p["name"]}: колонка {LINK_COL} не создана: {res}')
            post(f'_m_set/{cid}?JSON', {'t107': '1'})
        for cid, cname, _, now in p['repoint']:
            post(f'_m_set/{cid}?JSON', {'t28': now})
    bad = emptied(before, report_rows(plan), plan)
    if bad:
        raise SystemExit('после перевода отчёты потеряли данные — колонки «Ножа» НЕ удалены: ' +
                         '; '.join(f'{r}.{c} (-{n})' for r, c, n in bad))
    for name, rid, _ in pairs:
        res = post(f'_d_del_req/{rid}?JSON=1', {'forced': '1'})
        print(f'  удалена «{KNIFE} → {name}» ({rid}): {json.dumps(res, ensure_ascii=False)[:120]}')
    left = schema(call('GET', 'metadata?JSON'))[3]
    print('готово: у «Ножа» колонок параметров ' + (f'осталось {len(left)}' if left else 'нет'))


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()
