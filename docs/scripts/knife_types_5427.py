#!/usr/bin/env python3
# Справочник «Тип ножа» и ссылка на него из «Ножа» (ideav/crm#5427).
#
# Источники (файлы заказчика, в репо не кладутся — передаются аргументами):
#   TYPES — «Типы ножей.xlsx»: Наименование | Код | Угол заточки | Расстояние между ручьями |
#           Межэтикеточное расстояние (каталог типов из 1С);
#   LIST  — «Список ножей с типами.xlsx»: Наименование | Статус | Тип ножей | Номер | … —
#           какой тип у какого ножа (по номеру).
#
# Что делает:
#   1. заводит таблицу «Тип ножа» (справочник, unique=1); реквизиты — те же термины, что у
#      «Ножа» (Ширина/Длина этикетки, Ручьёв, Этикеток на раппорте, М/э, Между ручьями,
#      Ширина кромки, Вал, форматы, Ширина втулки, Угол заточки, Основа сырья) + «Код 1С»;
#   2. записи: по строке каталога (одноимённые строки сливаются, коды — через запятую);
#      ножи, которым тип не нашёлся, группируются по (ширина, длина, угол, между ручьями,
#      м/э) — на группу заводится тип «Ш х Д (угол/ручьи/м.э)»;
#   3. значения типа: из каталога — размер (из наименования), угол, между ручьями, м/э, код;
#      прочие поля — самое частое значение у ножей этого типа;
#   4. в «Нож» добавляется колонка-ссылка «Тип ножа» (единственный выбор) и заполняется:
#      тип из LIST по номеру, иначе подбор по параметрам. Колонки «Ножа» НЕ удаляются
#      (их читают label-production.js / label-import-core.js) — это отдельный шаг.
# Повторный запуск ничего не дублирует: существующие записи/ссылки сравниваются (БЫЛО -> СТАЛО).
#
# Запуск:
#   TOKEN=<X-Authorization> DB=https://ideav.ru/ateh1 python3 docs/scripts/knife_types_5427.py \
#       TYPES.xlsx LIST.xlsx [--dry-run] [--report report.md]

import os, re, sys, json, zipfile, urllib.request, urllib.parse, urllib.error
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict

DB = os.environ.get('DB', 'https://ideav.ru/ateh1').rstrip('/')
TOKEN = os.environ.get('TOKEN', '')
ARGS = [a for a in sys.argv[1:] if not a.startswith('--')]
DRY = '--dry-run' in sys.argv
REPORT = sys.argv[sys.argv.index('--report') + 1] if '--report' in sys.argv else None
if REPORT in ARGS:
    ARGS.remove(REPORT)

KNIFE, TYPE, CODE = 'Нож', 'Тип ножа', 'Код 1С'
# Реквизиты «Ножа», которые уходят в тип (по имени — id в ateh и ateh1 разные).
TYPE_REQS = ['Ширина этикетки, мм', 'Длина этикетки, мм', 'Ручьёв', 'Этикеток на раппорте',
             'М/э расстояние, мм', 'Между ручьями, мм', 'Ширина кромки, мм', 'Вал',
             'Минимальный формат, мм', 'Оптимальный формат, мм', 'Исп. формат, мм',
             'Ширина втулки, мм', 'Угол заточки', 'Основа сырья']
W, L, ANG, SG, LG = TYPE_REQS[0], TYPE_REQS[1], 'Угол заточки', 'Между ручьями, мм', 'М/э расстояние, мм'


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
        pass
    try:  # ядро не экранирует «\» из данных: «… \13 ручьев» в каталоге
        return json.loads(re.sub(r'\\(?![\\"/bfnrtu])', r'\\\\', body))
    except ValueError:
        raise SystemExit(f'{method} {path}: не JSON: {body[:300]}')


def xlsx_rows(path):
    """Строки первого листа как списки строк (без зависимостей: xlsx = zip с XML)."""
    ns = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
    z = zipfile.ZipFile(path)
    ss = []
    if 'xl/sharedStrings.xml' in z.namelist():
        for si in ET.fromstring(z.read('xl/sharedStrings.xml')).iter(ns + 'si'):
            ss.append(''.join(t.text or '' for t in si.iter(ns + 't')))
    rows = []
    for r in ET.fromstring(z.read('xl/worksheets/sheet1.xml')).iter(ns + 'row'):
        cells = {}
        for c in r.iter(ns + 'c'):
            col = re.match('[A-Z]+', c.get('r')).group()
            v, t = c.find(ns + 'v'), c.get('t')
            if t == 'inlineStr':
                val = ''.join(e.text or '' for e in c.iter(ns + 't'))
            elif v is None:
                val = ''
            else:
                val = ss[int(v.text)] if t == 's' else v.text
            cells[ord(col) - 65 if len(col) == 1 else 99] = val.strip()
        rows.append([cells.get(i, '') for i in range(max(cells, default=-1) + 1)])
    return rows


def num(s):
    try:
        return float(str(s).replace(',', '.').replace('°', '').strip())
    except ValueError:
        return None


def fmt(x):
    """Число как в каталоге: без хвостовых нулей, запятая."""
    return '?' if x is None else ('%g' % x).replace('.', ',')


def size_of(name):
    """«100 х 150 (70/4/2,4)» -> (100, 150); «D 20 (80)» -> (20, 20)."""
    m = re.match(r'\s*D\s*([\d.,]+)', name)
    if m:
        return num(m.group(1)), num(m.group(1))
    m = re.match(r'\s*([\d.,]+)\s*[хx]\s*([\d.,]+)', name)
    return (num(m.group(1)), num(m.group(2))) if m else (None, None)


def close(a, b, eps):
    return a is not None and b is not None and abs(a - b) <= eps


def load_catalog(path):
    """Наименование -> {'codes': [...], 'rows': [(угол, ручьи, м/э)], 'w', 'l'}."""
    by = defaultdict(dict)  # наименование -> {(угол, ручьи, м/э): [коды]}
    for r in xlsx_rows(path)[1:]:
        r += [''] * (5 - len(r))
        name, code, ang, sg, lg = r[:5]
        if name:
            by[name].setdefault((num(ang), num(sg), num(lg)), []).extend([code] if code else [])
    cat = {}
    for name, variants in by.items():
        w, l = size_of(name)
        for params, codes in variants.items():
            # Одноимённые строки с одинаковыми параметрами — один тип (коды через запятую);
            # с разными — отдельные типы, к имени добавляется код: «30 х 20 (70) [000000339]».
            key = name if len(variants) == 1 else '%s [%s]' % (name, codes[0] if codes else fmt(params[2]))
            cat[key] = {'codes': codes, 'rows': [params], 'w': w, 'l': l, 'new': False, 'base': name}
    return cat


def load_list(path):
    """Номер ножа -> [наименования типа] (у номера бывает две строки)."""
    by = defaultdict(list)
    for r in xlsx_rows(path)[1:]:
        r += [''] * (6 - len(r))
        if r[4] == 'Нож' and r[3] and r[2]:
            by[r[3].strip()].append(r[2])
    return by


def knife_key(k):
    return (num(k[W]), num(k[L]), num(k[ANG]), num(k[SG]), num(k[LG]))


def fits(e, key):
    w, l, ang, sg, lg = key
    return close(e['w'], w, 0.6) and close(e['l'], l, 0.6) and any(
        a == ang and close(s, sg, 0.01) and close(g, lg, 0.03) for a, s, g in e['rows'])


def param_dist(row, key):
    """Насколько строка каталога (угол, ручьи, м/э) далека от ножа: угол важнее всего."""
    ang, sg, lg = row
    d = lambda a, b: abs(a - b) if a is not None and b is not None else 50
    return 100 * (ang != key[2]) + d(sg, key[3]) + d(lg, key[4])


def profile(knives):
    """Самое частое (ручьёв, вал) у ножей типа — для выбора из нескольких подходящих."""
    c = Counter((k['Ручьёв'], k['Вал']) for k in knives)
    return c.most_common(1)[0][0] if c else None


def assign(knives, cat, listed):
    """Каждому ножу — имя типа и источник: list | params | params? | new."""
    by_list = defaultdict(list)
    for k in knives:
        listed_names = set(listed.get(k['num'], []))
        names = sorted(n for n, e in cat.items() if e.get('base') in listed_names)
        if len(names) > 1:  # две строки на номер или разделённый тип: решают параметры
            key = knife_key(k)
            names = [n for n in names if fits(cat[n], key)] or names
            names.sort(key=lambda n: param_dist(cat[n]['rows'][0], key))
        if names:
            k['type'], k['src'] = names[0], 'list'
            by_list[names[0]].append(k)
    for k in knives:
        if 'type' in k:
            continue
        cands = [n for n, e in cat.items() if fits(e, knife_key(k))]
        if len(cands) > 1:  # сначала ближайший размер: 102 х 120,5 против 102 х 121
            dist = {n: abs(cat[n]['w'] - num(k[W])) + abs(cat[n]['l'] - num(k[L])) for n in cands}
            cands = [n for n in cands if dist[n] - min(dist.values()) < 1e-9]
        if len(cands) > 1:
            same = [n for n in cands if profile(by_list[n]) == (k['Ручьёв'], k['Вал'])]
            if len(same) != 1:
                same = [n for n in cands if re.search(r'\b%s\s*руч' % k['Ручьёв'], n)]
            if len(same) == 1:
                cands = same
            else:
                cands.sort(key=lambda n: (-len(by_list[n]), len(n)))
                k['src'] = 'params?'
        if cands:
            k['type'] = cands[0]
            k.setdefault('src', 'params')
    groups = defaultdict(list)
    for k in knives:
        if 'type' not in k:
            groups[knife_key(k)].append(k)
    for (w, l, ang, sg, lg), ks in sorted(groups.items(), key=lambda g: str(g[0])):
        name = '%s х %s (%s/%s/%s)' % (fmt(w), fmt(l), fmt(ang), fmt(sg), fmt(lg))
        if name in cat:
            name += ' (новый)'
        cat[name] = {'codes': [], 'rows': [(ang, sg, lg)], 'w': w, 'l': l, 'new': True}
        for k in ks:
            k['type'], k['src'] = name, 'new'


def dot(x):
    return '' if x is None else '%g' % x


def type_values(name, e, knives):
    """Значения реквизитов типа: каталог — размер/угол/ручьи/м.э/код, прочее — мода по ножам."""
    vals = {}
    for f in TYPE_REQS:
        c = Counter(k[f] for k in knives if k[f] != '')
        vals[f] = c.most_common(1)[0][0] if c else ''
    row = e['rows'][0]
    if len(e['rows']) > 1 and knives:  # одноимённые строки каталога: та, что у большинства ножей
        c = Counter(r for r in e['rows'] for k in knives
                    if r[0] == num(k[ANG]) and close(r[1], num(k[SG]), 0.01) and close(r[2], num(k[LG]), 0.03))
        row = c.most_common(1)[0][0] if c else row
    ang, sg, lg = row
    if e['w'] is not None:
        vals[W], vals[L] = dot(e['w']), dot(e['l'])
    if ang is not None:
        vals[ANG] = '%s°' % dot(ang)
    # Каталог округляет до сотых (2,27 при 2,267 у ножей): мода ножей в пределах допуска остаётся.
    for f, v, eps in ((SG, sg, 0.01), (LG, lg, 0.03)):
        if v is not None and not close(num(vals[f]), v, eps):
            vals[f] = dot(v)
    vals[CODE] = ', '.join(e['codes'])
    return vals


def same(a, b):
    a, b = str(a).split(':')[0].strip(), str(b).split(':')[0].strip()
    na, nb = num(a), num(b)
    return a == b or (na is not None and nb is not None and abs(na - nb) < 1e-9)


REF_TEXT = {}  # id записи-цели ссылки -> её текст (для отчёта)


def read_rows(tid, meta_t):
    """Записи таблицы: [{'id', 'num', <имя реквизита>: значение}] (ссылка — 'id:текст' -> id)."""
    names = {int(r['num']): r['val'] for r in meta_t.get('reqs', [])}
    out = []
    for o in call('GET', f'object/{tid}?JSON_OBJ&LIMIT=0,10000') or []:
        rec = {'id': str(o['i']), 'num': str(o['r'][0]).strip()}
        for i, v in enumerate(o['r'][1:], 1):
            if i in names:
                s = str(v) if v is not None else ''
                if re.match(r'^\d+:', s):
                    ref_id, REF_TEXT[ref_id] = s.split(':', 1)[0], s.split(':', 1)[1]
                    s = ref_id
                rec[names[i]] = s
        out.append(rec)
    return out


def ddl(path, fields, xsrf, what):
    res = call('POST', path + '?JSON', dict(fields, _xsrf=xsrf))
    got = res.get('obj') or res.get('id') if isinstance(res, dict) else None
    print(f'  {what} -> {json.dumps(res, ensure_ascii=False)[:200]}')
    if not got:
        raise SystemExit(f'{what}: нет id в ответе')
    return str(got)


def ensure_type_table(tables, kmeta, xsrf):
    """Таблица «Тип ножа» с реквизитами; возвращает её metadata (None — сухой прогон без таблицы)."""
    t = next((x for x in tables if str(x.get('val')).strip() == TYPE and str(x.get('up')) == '0'), None)
    have = {r['val'] for r in (t or {}).get('reqs', [])}
    need = [CODE] + TYPE_REQS
    miss = [f for f in need if f not in have]
    if t and not miss:
        return call('GET', f'metadata/{t["id"]}?JSON=1')
    print(('таблица «%s» есть, ' % TYPE if t else 'таблицы «%s» нет, ' % TYPE) +
          'добавить реквизиты: ' + ', '.join(miss) + (' — сухой прогон' if DRY else ''))
    if DRY:
        return call('GET', f'metadata/{t["id"]}?JSON=1') if t else None
    tid = str(t['id']) if t else ddl('_d_new', {'t': '3', 'val': TYPE, 'unique': '1'}, xsrf, f'таблица {TYPE}')
    kreq = {r['val']: r for r in kmeta['reqs']}
    for f in miss:
        if f == CODE:
            term = ddl('_d_new', {'t': '3', 'val': CODE}, xsrf, f'термин {CODE}')
        else:
            term = kreq[f].get('ref_id') or kreq[f]['orig']
        ddl(f'_d_req/{tid}', {'t': term}, xsrf, f'реквизит {f}')
    return call('GET', f'metadata/{tid}?JSON=1')


def ensure_knife_ref(kmeta, tmeta, xsrf):
    """Колонка-ссылка «Тип ножа» в «Ноже» (единственный выбор); возвращает id реквизита."""
    r = next((r for r in kmeta['reqs'] if str(r.get('ref')) == str(tmeta['id'])), None) if tmeta else None
    if r:
        return str(r['id'])
    print(f'в «{KNIFE}» нет колонки «{TYPE}» — ' + ('сухой прогон' if DRY else 'добавляем'))
    if DRY:
        return None
    ref = ddl(f'_d_ref/{tmeta["id"]}', {}, xsrf, f'ссылка на {TYPE}')
    return ddl(f'_d_req/{kmeta["id"]}', {'t': ref}, xsrf, f'колонка {TYPE} в {KNIFE}')


def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    if not TOKEN or len(ARGS) != 2:
        raise SystemExit('нужны TOKEN и два файла: TYPES.xlsx LIST.xlsx')
    cat, listed = load_catalog(ARGS[0]), load_list(ARGS[1])
    tables = call('GET', 'metadata?JSON=1')
    kid = next(str(t['id']) for t in tables if str(t.get('val')).strip() == KNIFE and str(t.get('up')) == '0')
    kmeta = call('GET', f'metadata/{kid}?JSON=1')
    knives = read_rows(kid, kmeta)
    assign(knives, cat, listed)
    xsrf = '' if DRY else call('GET', 'xsrf?JSON=1').get('_xsrf', '')
    tmeta = ensure_type_table(tables, kmeta, xsrf)
    treq = {r['val']: str(r['id']) for r in (tmeta or {}).get('reqs', [])}
    existing = {r['num']: r for r in read_rows(tmeta['id'], tmeta)} if tmeta else {}
    of_type = defaultdict(list)
    for k in knives:
        of_type[k['type']].append(k)
    rec_id, stat = {}, Counter()
    for name, e in sorted(cat.items()):
        vals = type_values(name, e, of_type[name])
        old = existing.get(name)
        if old:
            rec_id[name] = old['id']
            diff = {f: v for f, v in vals.items() if not same(old.get(f, ''), v)}
            if not diff:
                stat['тип без изменений'] += 1
                continue
            print(f'тип «{name}» ({old["id"]}): ' + '; '.join(
                f'{f}: {old.get(f, "") or "пусто"} -> {v or "пусто"}' for f, v in diff.items()))
            stat['тип обновлён'] += 1
            if not DRY:
                call('POST', f'_m_set/{old["id"]}?JSON', dict({f't{treq[f]}': v for f, v in diff.items()}, _xsrf=xsrf))
            continue
        stat['тип создан'] += 1
        if DRY:
            rec_id[name] = f'<{name}>'
            continue
        fields = {f't{treq[f]}': v for f, v in vals.items() if v != ''}
        res = call('POST', f'_m_new/{tmeta["id"]}?JSON&up=1', dict(fields, **{f't{tmeta["id"]}': name, '_xsrf': xsrf}))
        if not res.get('obj'):
            raise SystemExit(f'тип «{name}»: {res}')
        rec_id[name] = str(res['obj'])
    ref = ensure_knife_ref(kmeta, tmeta, xsrf)
    for k in knives:
        stat['нож: ' + k['src']] += 1
        cur = k.get(TYPE, '')
        want = rec_id[k['type']]
        if cur == want:
            stat['нож без изменений'] += 1
            continue
        stat['нож: ссылка ' + ('меняется' if cur else 'ставится')] += 1
        if cur:
            print(f'нож {k["num"]} ({k["id"]}): тип {cur} -> {want}')
        if not DRY:
            res = call('POST', f'_m_set/{k["id"]}?JSON', {f't{ref}': want, '_xsrf': xsrf})
            if isinstance(res, dict) and res.get('error'):
                raise SystemExit(f'нож {k["num"]}: {res}')
    for s, n in sorted(stat.items()):
        print(f'{s}: {n}')
    if REPORT:
        write_report(cat, knives, of_type)


def write_report(cat, knives, of_type):
    """Отчёт для владельца: новые типы, неоднозначный подбор, расхождения нож ≠ тип."""
    out = ['# Тип ножа: отчёт заполнения (#5427)', '']
    src = Counter(k['src'] for k in knives)
    out += ['Ножей: %d; тип из списка — %d, по параметрам — %d, по параметрам неоднозначно — %d, '
            'новый тип — %d. Типов: %d (из каталога %d, новых %d).' % (
                len(knives), src['list'], src['params'], src['params?'], src['new'], len(cat),
                sum(not e['new'] for e in cat.values()), sum(e['new'] for e in cat.values())), '']
    out += ['## Новые типы (нет в каталоге)', '', '| Тип | Ножи |', '|---|---|']
    out += ['| %s | %s |' % (n, ', '.join(k['num'] for k in of_type[n])) for n, e in sorted(cat.items()) if e['new']]
    out += ['', '## Подбор по параметрам неоднозначен (взят тип с большим числом ножей)', '',
            '| Нож | Тип |', '|---|---|']
    out += ['| %s | %s |' % (k['num'], k['type']) for k in knives if k['src'] == 'params?']
    out += ['', '## Расхождения «нож ≠ тип» (у ножа значение остаётся своё)', '']
    vals = {n: type_values(n, e, of_type[n]) for n, e in cat.items()}
    rows, per = [], Counter()
    for k in sorted(knives, key=lambda k: k['type']):
        d = [f for f in TYPE_REQS if k[f] != '' and vals[k['type']][f] != '' and not same(k[f], vals[k['type']][f])]
        for f in d:
            per[f] += 1
        if d:
            rows.append('| %s | %s | %s |' % (k['num'], k['type'], '; '.join(
                '%s: %s ≠ %s' % (f, REF_TEXT.get(k[f], k[f]), REF_TEXT.get(vals[k['type']][f], vals[k['type']][f])) for f in d)))
    out += ['| Поле | Ножей |', '|---|---|'] + ['| %s | %d |' % (f, n) for f, n in per.most_common()]
    out += ['', '| Нож | Тип | Нож ≠ тип |', '|---|---|---|'] + rows
    with open(REPORT, 'w', encoding='utf-8') as f:
        f.write('\n'.join(out) + '\n')
    print('отчёт:', REPORT)


if __name__ == '__main__':
    main()
