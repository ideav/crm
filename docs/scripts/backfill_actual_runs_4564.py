#!/usr/bin/env python3
# issue #4564: разовая простановка «Кол-во резок факт» (реквизит 657315 таблицы 1078
# «Задание в производство») — новая колонка становится ЕДИНСТВЕННЫМ источником числа
# выполненных проходов для пульта слиттера и планирования. Журнал событий смены на этот
# вопрос больше не отвечает, поэтому его надо прочитать один раз — здесь.
#
# Кому что проставляется (решение заказчика, #4564):
#   • ВЫПОЛНЕННЫМ («Закончено» заполнено)          → «Кол-во резок факт» = «Кол-во резок план»;
#   • НАЧАТЫМ невыполненным («Начато» есть,
#     «Закончено» пусто)                            → число событий «Резка» этого задания
#                                                     (справочник «Тип события», таблица 1082);
#   • не начатым                                    → ничего (факт = 0 по смыслу).
# Задание, у которого «Кол-во резок факт» уже непусто, пропускается — скрипт идемпотентен
# и повторный запуск ничего не переписывает.
#
# Сверка перед записью: у начатых число событий «Резка» сверяется со ВТОРЫМ свидетелем —
# «Погонаж факт, м» ÷ «Метраж, м» (та же арифметика, что actualRunsFromMeterage, #3433).
# Свидетели разошлись → задание НЕ пишется и называется в отчёте (правило «нет данных →
# орать, а не подставлять молча»).
#
# Запуск (curl в окружении нет — python3 stdlib):
#   TOKEN=<сессионный X-Authorization> DB=https://ideav.ru/ateh \
#   python3 docs/scripts/backfill_actual_runs_4564.py            # dry-run, только показать
#   ... --apply                                                  # записать (_m_set)

import os, sys, json, urllib.request, urllib.parse

DB = os.environ.get('DB', 'https://ideav.ru/ateh').rstrip('/')
TOKEN = os.environ.get('TOKEN', '')
APPLY = '--apply' in sys.argv

CUT_TABLE = 1078        # «Задание в производство»
EVENT_TABLE = 1082      # «Событие смены»
REQ_ACTUAL_RUNS = 657315  # «Кол-во резок факт» (#4564)
PASS_EVENT = 'Резка'    # значение справочника «Тип события» (1193): отметка выполненного прохода


def _req(method, path, fields=None):
    data = urllib.parse.urlencode(fields).encode() if fields is not None else None
    dbname = DB.rstrip('/').rsplit('/', 1)[-1]
    headers = {'X-Authorization': TOKEN, 'Cookie': 'idb_%s=%s' % (dbname, TOKEN),
               'Accept': 'application/json'}
    r = urllib.request.Request(DB + '/' + path, data=data, headers=headers, method=method)
    with urllib.request.urlopen(r, timeout=180) as resp:
        body = resp.read().decode('utf-8', 'replace')
    try:
        return json.loads(body)
    except Exception:
        raise SystemExit('НЕ JSON от %s %s (нужен валидный токен?):\n%s' % (method, path, body[:300]))


XSRF = ''


def post(path, fields):
    f = dict(fields)
    f['token'] = TOKEN
    f['_xsrf'] = XSRF
    return _req('POST', path, f)


# object/{t}/?JSON_OBJ отдаёт r[] как [главное значение, реквизит_1, реквизит_2, …];
# порядковый номер реквизита — ключ в obj_meta.reqs, поэтому индекс в r[] равен ему же.
def idx_map(table_id):
    meta = _req('GET', 'obj_meta/%d?JSON' % table_id)
    return dict((str(r['val']), int(ordn)) for ordn, r in (meta.get('reqs') or {}).items())


def cell(row, i):
    v = row[i] if i < len(row) else ''
    return '' if v is None else str(v).strip()


def ref_id(s):
    return s.split(':', 1)[0] if ':' in s else s


def ref_val(s):
    return s.split(':', 1)[1] if ':' in s else s


def num(s):
    try:
        return float(str(s).replace(',', '.'))
    except Exception:
        return 0.0


def main():
    global XSRF
    if not TOKEN:
        raise SystemExit('Нужен TOKEN=<сессионный X-Authorization>')

    cm = idx_map(CUT_TABLE)
    em = idx_map(EVENT_TABLE)
    i_start, i_end = cm['Начато'], cm['Закончено']
    i_plan, i_fact = cm['Кол-во резок план'], cm['Кол-во резок факт']
    i_len, i_meter = cm['Метраж, м'], cm['Погонаж факт, м']
    e_cut, e_type = em['Задание в производство'], em['Тип события']

    cuts = _req('GET', 'object/%d/?JSON_OBJ&LIMIT=0,20000' % CUT_TABLE)
    events = _req('GET', 'object/%d/?JSON_OBJ&LIMIT=0,50000' % EVENT_TABLE)

    # Проходы из журнала — ПОСЛЕДНИЙ раз: дальше их источник «Кол-во резок факт».
    passes = {}
    for ev in events:
        r = ev.get('r') or []
        if ref_val(cell(r, e_type)) != PASS_EVENT:
            continue
        cut_id = ref_id(cell(r, e_cut))
        if cut_id:
            passes[cut_id] = passes.get(cut_id, 0) + 1

    writes, skipped, conflicts = [], [], []
    for c in cuts:
        r = c.get('r') or []
        cut_id = str(c.get('i'))
        started, finished = cell(r, i_start), cell(r, i_end)
        plan, fact = cell(r, i_plan), cell(r, i_fact)
        if fact not in ('', '0'):
            skipped.append((cut_id, fact))
            continue
        if finished:
            if plan not in ('', '0'):
                writes.append((cut_id, int(num(plan)), 'выполнено → план'))
            continue
        if not started:
            continue
        by_events = passes.get(cut_id, 0)
        run_len, meterage = num(cell(r, i_len)), num(cell(r, i_meter))
        by_meter = round(meterage / run_len) if run_len > 0 and meterage > 0 else None
        if by_meter is not None and by_meter != by_events:
            conflicts.append((cut_id, by_events, by_meter, plan))
            continue
        if by_events > 0:
            writes.append((cut_id, by_events, 'начато → событий «Резка»'))

    print('заданий: %d, событий: %d (из них «Резка»: %d у %d заданий)'
          % (len(cuts), len(events), sum(passes.values()), len(passes)))
    print('к записи: %d | пропущено (факт уже стоит): %d | расхождение свидетелей: %d'
          % (len(writes), len(skipped), len(conflicts)))
    for cut_id, by_events, by_meter, plan in conflicts:
        print('  ⚠ %s: событий «Резка» = %d, погонаж÷метраж = %d, план = %s — НЕ пишем'
              % (cut_id, by_events, by_meter, plan))
    for cut_id, value, why in writes:
        print('  %s ← %d (%s)' % (cut_id, value, why))

    if not APPLY:
        print('\n--dry-run: ничего не записано (добавьте --apply)')
        return
    XSRF = _req('GET', 'xsrf?JSON=1').get('_xsrf', '')
    done = 0
    for cut_id, value, _why in writes:
        resp = post('_m_set/%s?JSON' % cut_id, {'t%d' % REQ_ACTUAL_RUNS: str(value)})
        if isinstance(resp, list) and resp and isinstance(resp[0], dict) and resp[0].get('error'):
            print('  ✗ %s: %s' % (cut_id, resp[0]['error']))
            continue
        done += 1
    print('\nзаписано: %d из %d' % (done, len(writes)))


if __name__ == '__main__':
    main()
