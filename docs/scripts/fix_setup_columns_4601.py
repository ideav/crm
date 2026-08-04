#!/usr/bin/env python3
# issue #4601: разовая правка колонок «Длительность, минут» и «Резка и Лидер» у заданий,
# которые кнопка «↻ Пересчитать наладку» ВИДИТ, но не чинит (счётчик застревает).
#
# Появились они после возврата потерянных проходов (#4598): скрипт возврата намеренно писал
# ТОЛЬКО «Кол-во резек план», оставляя тайминг упаковщику, — а упаковщик до них не дошёл.
# «Упорядочить» это бы переписало, но оно вправе ещё и переназначать станки (#4001), а трогать
# порядок ради двух колонок нельзя.
#
# ЧТО ПИШЕМ: ровно две колонки, у заданий, где (Резка и Лидер − Длительность) / BETWEEN_CUTS
# не равно «Кол-во резок план». Ни порядок, ни дни, ни станки не трогаем.
#
# ОТКУДА ЧИСЛА: НЕ своей формулой. Значения берём из ХРАНИМОГО «Тайминга» задания — его писало
# само приложение, и он содержит «Намотка: <норма> * <проходы> = <минуты>» и «Лидер: ...».
# Правило записи то же, что у splitSegTimingFields: «Длительность» = ceil(намотка),
# «Резка и Лидер» = «Длительность» + лидер. Пишем, ТОЛЬКО если число проходов в «Тайминге»
# совпадает с текущим «Кол-во резок план» (иначе текст описывает другой мир — не наш случай).
#
# Запуск:
#   TOKEN=<сессионный X-Authorization> python3 docs/scripts/fix_setup_columns_4601.py           # dry-run
#   TOKEN=... python3 docs/scripts/fix_setup_columns_4601.py --apply

import os, sys, json, math, re, urllib.request, urllib.parse

DB = os.environ.get('DB', 'https://ideav.ru/ateh').rstrip('/')
TOKEN = os.environ.get('TOKEN', '')
APPLY = '--apply' in sys.argv
DBNAME = DB.rsplit('/', 1)[-1]
REQ_DURATION = 26584        # «Длительность, минут»
REQ_CUT_AND_LEADER = 96778  # «Резка и Лидер»
XSRF = ''


def _req(method, path, fields=None):
    data = urllib.parse.urlencode(fields).encode() if fields is not None else None
    headers = {'X-Authorization': TOKEN, 'Cookie': 'idb_%s=%s' % (DBNAME, TOKEN),
               'Accept': 'application/json'}
    r = urllib.request.Request(DB + '/' + path, data=data, headers=headers, method=method)
    with urllib.request.urlopen(r, timeout=300) as resp:
        return json.loads(resp.read().decode('utf-8', 'replace'))


def post(path, fields):
    f = dict(fields); f['token'] = TOKEN; f['_xsrf'] = XSRF
    return _req('POST', path, f)


def main():
    if not TOKEN:
        raise SystemExit('нужен TOKEN=<сессионный X-Authorization>')
    cuts = _req('GET', 'report/cut_planning?JSON_KV&LIMIT=0,5000')
    by_cut = {}
    for r in cuts:
        by_cut.setdefault(r['cut_id'], r)

    plan, refused = [], []
    for cid, c in sorted(by_cut.items()):
        try:
            runs = int(float(c.get('cut_planned_runs') or 0))
            dur = float(c.get('cut_duration') or 0)
            ct = float(c.get('cut_time') or 0)
        except Exception:
            continue
        if runs <= 0:
            continue
        timing = c.get('cut_timing') or ''
        m_runs = re.search(r'Плановых проходов:\s*(\d+)', timing)
        m_wind = re.search(r'Намотка:\s*[\d.,]+\s*\*\s*(\d+)\s*=\s*([\d.,]+)', timing)
        m_lead = re.search(r'Лидер:\s*[\d.,]+\s*\*\s*(\d+)\s*=\s*([\d.,]+)', timing)
        if not (m_runs and m_wind and m_lead):
            continue
        lead_min = float(m_lead.group(2).replace(',', '.'))
        wind_min = float(m_wind.group(2).replace(',', '.'))
        told = int(m_runs.group(1))
        # сколько проходов описывают ХРАНИМЫЕ колонки
        per_run_lead = lead_min / told if told else 0
        implied = (ct - dur) / per_run_lead if per_run_lead else None
        if implied is None or abs(implied - runs) < 0.01:
            continue                                  # колонки уже про текущие проходы
        want_dur = math.ceil(wind_min)
        want_ct = int(round(want_dur + lead_min))
        row = (cid, c.get('order_no'), runs, told, dur, ct, want_dur, want_ct)
        # «Тайминг» обязан описывать ТЕКУЩЕЕ число проходов, иначе это не наш случай
        (plan if told == runs else refused).append(row)

    print('=== #4601: привести колонки к числу проходов (база %s) ===' % DB)
    for cid, order, runs, told, dur, ct, wd, wc in plan:
        print('  задание %-8s заказ %-6s проходов %-4s | «Длительность» %s → %s, «Резка и Лидер» %s → %s'
              % (cid, order, runs, dur, wd, ct, wc))
    print('  ИТОГО заданий: %d' % len(plan))
    if refused:
        print('\n  НЕ ТРОГАЮ — «Тайминг» описывает другое число проходов (нужен глаз человека):')
        for cid, order, runs, told, dur, ct, wd, wc in refused:
            print('    задание %-8s заказ %-6s проходов %s, «Тайминг» про %s' % (cid, order, runs, told))
    if not APPLY:
        print('\nDRY-RUN. Записать: добавьте --apply')
        return

    global XSRF
    XSRF = _req('GET', 'xsrf?JSON').get('_xsrf', '')
    if not XSRF:
        raise SystemExit('не получен _xsrf — POST будет отвергнут')
    for cid, order, runs, told, dur, ct, wd, wc in plan:
        resp = post('_m_set/%s?JSON' % cid, {'t%d' % REQ_DURATION: str(wd),
                                             't%d' % REQ_CUT_AND_LEADER: str(wc)})
        err = resp[0].get('error') if isinstance(resp, list) and resp and isinstance(resp[0], dict) else None
        if err:
            raise SystemExit('задание %s НЕ записано: %s' % (cid, err))
        print('  записано: %s → «Длительность» %s, «Резка и Лидер» %s' % (cid, wd, wc))


if __name__ == '__main__':
    main()
