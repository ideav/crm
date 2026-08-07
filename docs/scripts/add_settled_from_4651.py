#!/usr/bin/env python3
# issue #4651 (из #4650): реквизит «ID выполненной части» таблицы «Производственная резка» (1078)
# и разовая простановка ссылки уже разделённым половинам.
#
# ЗАЧЕМ. «Урегулировать» делит частично выполненное задание по факту (#4564): выполненная часть —
# исходная запись, остаток — новая. Цепочки дробления между ними НЕТ по построению (выполненная
# часть выходит из цепочки, остаток становится новой головой), поэтому подпись #4617 на карточках
# не появляется, и диспетчер читает две записи одного заказа в разных днях как «резка перекинулась
# на другой день» (боевое: заказ 4608 — 667620 «300 x 27» 07.08 и 669318 «300 x 18» 11.08).
# Рабочее место рисует подпись по ЯВНОЙ ссылке остатка на выполненную часть; для этого нужен
# реквизит. Пока его нет в схеме, код молча деградирует (подписи просто не будет).
#
# ЧТО ДЕЛАЕТ:
#   1) создаёт тип SHORT «ID выполненной части» и вешает его реквизитом на таблицу 1078
#      (если реквизита ещё нет — проверяет по имени, повторный запуск ничего не портит);
#   2) проставляет ссылку УЖЕ разделённым половинам. Кандидатов ищет по данным и КАЖДОГО показывает:
#      остаток — запись без «Начато»/факта, у которой есть более ранний сосед ТОГО ЖЕ заказа и той
#      же ширины ролика, закрытый («Закончено») и с «Кол-во резок факт» > 0, равным его же «Кол-во
#      резек план» (ровно то, что оставляет разделение). Неоднозначные (несколько кандидатов на
#      одну запись) НЕ пишутся и называются в отчёте — гадать нельзя.
#   Новые разделения ссылку ставят сами (splitPartiallyDoneCuts → applySplitPlan, PR к #4651).
#
# Запуск (база — ИЗ ТИКЕТА; для #4650 это ateh):
#   TOKEN=<сессионный X-Authorization> python3 docs/scripts/add_settled_from_4651.py            # dry-run
#   TOKEN=... python3 docs/scripts/add_settled_from_4651.py --apply                             # записать
#   TOKEN=... DB=https://ideav.ru/ateh1 python3 docs/scripts/add_settled_from_4651.py --apply   # вторая база
#   TOKEN=... python3 docs/scripts/add_settled_from_4651.py --apply --pair 669318:667620        # явная пара

import os, sys, json, urllib.request, urllib.parse, collections

DB = os.environ.get('DB', 'https://ideav.ru/ateh').rstrip('/')
TOKEN = os.environ.get('TOKEN', '')
APPLY = '--apply' in sys.argv
CUT_TABLE = 1078
REQ_NAME = 'ID выполненной части'
DBNAME = DB.rsplit('/', 1)[-1]
XSRF = ''


def _req(method, path, fields=None):
    data = urllib.parse.urlencode(fields).encode() if fields is not None else None
    headers = {'X-Authorization': TOKEN, 'Cookie': 'idb_%s=%s' % (DBNAME, TOKEN),
               'Accept': 'application/json'}
    r = urllib.request.Request(DB + '/' + path, data=data, headers=headers, method=method)
    with urllib.request.urlopen(r, timeout=300) as resp:
        body = resp.read().decode('utf-8', 'replace')
    try:
        return json.loads(body)
    except Exception:
        raise SystemExit('НЕ JSON от %s %s (валиден ли токен?):\n%s' % (method, path, body[:300]))


def get(path):
    return _req('GET', path)


def post(path, fields):
    f = dict(fields)
    f['token'] = TOKEN
    f['_xsrf'] = XSRF
    res = _req('POST', path, f)
    if isinstance(res, list) and res and isinstance(res[0], dict) and res[0].get('error'):
        raise SystemExit('ОШИБКА %s: %s' % (path, res[0]['error']))
    return res


def req_id_by_name(meta, name):
    for r in (meta.get('reqs') or []):
        if str(r.get('val') or '').strip() == name:
            return str(r.get('id'))
    return None


def explicit_pairs():
    out = []
    for i, a in enumerate(sys.argv):
        if a == '--pair' and i + 1 < len(sys.argv):
            rest, done = sys.argv[i + 1].split(':', 1)
            out.append((rest.strip(), done.strip()))
    return out


def main():
    if not TOKEN:
        raise SystemExit('нужен TOKEN=<сессионный X-Authorization>')
    global XSRF
    print('=== #4651: «%s» в таблице %s (база %s) ===' % (REQ_NAME, CUT_TABLE, DB))

    meta = get('object/%s/?JSON_META' % CUT_TABLE)
    if isinstance(meta, list):
        meta = meta[0] if meta else {}
    existing = req_id_by_name(meta, REQ_NAME)
    if existing:
        print('  реквизит уже есть: t%s — схему не трогаю' % existing)
    else:
        print('  реквизита нет — создаю (тип SHORT + _d_req + _d_alias)')
        if APPLY:
            XSRF = get('xsrf?JSON').get('_xsrf', '')
            type_id = post('_d_new?JSON=1', {'t': '3', 'val': REQ_NAME}).get('obj')
            req = post('_d_req/%s?JSON=1' % CUT_TABLE, {'t': str(type_id)})
            existing = str(req.get('id'))
            post('_d_alias/%s?JSON=1' % existing, {'val': REQ_NAME})
            print('  создан: тип %s, реквизит t%s' % (type_id, existing))

    # ── кандидаты на простановку ссылки уже разделённым половинам ────────────────────────────
    cuts = get('report/cut_planning?JSON_KV&LIMIT=0,5000')
    by_cut = {}
    for r in cuts:
        by_cut.setdefault(r['cut_id'], r)

    def num(v):
        try:
            return float(str(v).strip() or 0)
        except ValueError:
            return 0.0

    # выполненные части: закрыты, факт > 0 и план == факту (разделение сравняло их)
    done_by_key = collections.defaultdict(list)
    for cid, c in by_cut.items():
        if not str(c.get('cut_end_date') or '').strip():
            continue
        fact, plan = num(c.get('cut_runs_fact')), num(c.get('cut_planned_runs'))
        if fact <= 0 or fact != plan:
            continue
        done_by_key[(str(c.get('order_no') or ''), str(c.get('cut_roller_width') or ''))].append(cid)

    pairs, disputed = list(explicit_pairs()), []
    seen_rest = {r for r, _ in pairs}
    for cid, c in sorted(by_cut.items()):
        if cid in seen_rest:
            continue
        if str(c.get('cut_end_date') or '').strip() or str(c.get('cut_start_date') or '').strip():
            continue                                   # остаток чист: ни «Начато», ни «Закончено»
        if num(c.get('cut_runs_fact')) > 0:
            continue
        key = (str(c.get('order_no') or ''), str(c.get('cut_roller_width') or ''))
        cands = [d for d in done_by_key.get(key, [])
                 if str(by_cut[d].get('cut_plan_date') or '') < str(c.get('cut_plan_date') or '')]
        if len(cands) == 1:
            pairs.append((cid, cands[0]))
        elif len(cands) > 1:
            disputed.append((cid, cands))

    print('\n  ПАРЫ (остаток → выполненная часть):')
    for rest, done in pairs:
        r, d = by_cut.get(rest, {}), by_cut.get(done, {})
        print('    %-8s (%s пр., %s) → %-8s (%s пр., %s)  заказ %s'
              % (rest, r.get('cut_planned_runs'), r.get('cut_plan_date'),
                 done, d.get('cut_planned_runs'), d.get('cut_plan_date'), r.get('order_no')))
    print('    ИТОГО: %d' % len(pairs))
    if disputed:
        print('\n  НЕ ТРОГАЮ — кандидатов больше одного (заказ резался несколько раз, гадать нельзя;')
        print('  укажите вручную: --pair <остаток>:<выполненная часть>):')
        for rest, cands in disputed:
            print('    остаток %-8s ← %s' % (rest, ', '.join(cands)))

    if not APPLY:
        print('\nDRY-RUN. Записать: добавьте --apply')
        return
    if not existing:
        raise SystemExit('реквизита нет и создать не удалось — писать некуда')
    if not XSRF:
        XSRF = get('xsrf?JSON').get('_xsrf', '')
    for rest, done in pairs:
        post('_m_set/%s?JSON' % rest, {'t%s' % existing: str(done)})
        print('  записано: %s → %s' % (rest, done))
    print('ГОТОВО: %d записей' % len(pairs))


if __name__ == '__main__':
    main()
