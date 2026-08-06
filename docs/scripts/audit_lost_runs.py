#!/usr/bin/env python3
# issue #4616: РАЗБОР «потерянных резок» в заказах — читает и объясняет, ничего не пишет.
#
# «Опять обнаружил потерянные резки в заказах» — тикет этого класса приходит регулярно (#4552,
# #4598, #4616, #4617), и каждый раз разбор одинаковый: пройти цепочку «заказ → позиции → задания →
# проходы» и понять, что именно случилось. Причины РАЗНЫЕ, и на глаз они неотличимы:
#
#   • задания нет вовсе — заказ не спланирован (или запись пропала);
#   • проходы срезаны — потеря (класс #4598: неатомарная запись плана);
#   • проходы целы, но задание РАЗБИТО ПО ДНЯМ на несколько записей — не потеря (#4617);
#   • часть работы уже сделана — «Кол-во резок факт» и разделение по факту (#4564);
#   • позиция недообеспечена планом — выпуск меньше заказанного (§15 SUPPLY_CONSERVED, #4536).
#
# Скрипт называет причину по КАЖДОМУ заказу и показывает цифры, на которых вердикт держится.
# Ничего не чинит: правит либо рабочее место, либо разовый скрипт под конкретную причину
# (например docs/scripts/restore_lost_runs_4598.py для среза проходов).
#
# Запуск:
#   TOKEN=<сессионный X-Authorization> python3 docs/scripts/audit_lost_runs.py 4522 4257 4538
#   TOKEN=... DB=https://ideav.ru/ateh1 python3 docs/scripts/audit_lost_runs.py        # все заказы
#   python3 docs/scripts/audit_lost_runs.py --selftest                                 # без сети
#
# Имя базы берётся ИЗ ТИКЕТА: ateh и ateh1 — разные живые базы, промах базой стоит целого разбора.

import os, sys, json, math, re, urllib.request, urllib.parse, collections

DB = os.environ.get('DB', 'https://ideav.ru/ateh').rstrip('/')
TOKEN = os.environ.get('TOKEN', '')
DBNAME = DB.rsplit('/', 1)[-1]


def _req(path):
    headers = {'X-Authorization': TOKEN, 'Cookie': 'idb_%s=%s' % (DBNAME, TOKEN),
               'Accept': 'application/json'}
    r = urllib.request.Request(DB + '/' + path, headers=headers, method='GET')
    with urllib.request.urlopen(r, timeout=300) as resp:
        body = resp.read().decode('utf-8', 'replace')
    try:
        return json.loads(body)
    except Exception:
        raise SystemExit('НЕ JSON от GET %s (валиден ли токен?):\n%s' % (path, body[:300]))


def num(v):
    try:
        return float(str(v).strip())
    except Exception:
        return 0.0


def filled(v):
    return str(v or '').strip() != ''


def timing_runs(timing):
    """Сколько проходов обещает ХРАНИМЫЙ «Тайминг» задания (свидетель #4552). None — не сказано."""
    m = re.search(r'Плановых проходов:\s*(\d+)', str(timing or ''))
    return int(m.group(1)) if m else None


# ── Чистый разбор: из трёх выгрузок делает вердикт по заказам ─────────────────────────────────
# cuts   — report/cut_planning: cut_id, order_no, cut_planned_runs, cut_runs_fact, cut_start_date,
#          cut_end_date, cut_timing, cut_first_part, supply_position_id, supply_finished_batch_id
# strips — report/cut_strips:   cut_id, gp_id, strip_qty («Кол-во полос» партии — штук за ОДИН проход)
# poss   — report/positions_list: position_id, position_qty, order_no
# orders — список номеров заказов (пусто = все, у кого нашлось расхождение)
def audit(cuts, strips, poss, orders=None):
    want = set(str(o).strip() for o in (orders or []) if str(o).strip())
    per_run = {}
    for s in strips:
        per_run[(str(s.get('cut_id')), str(s.get('gp_id')))] = num(s.get('strip_qty'))

    demand, pos_order = {}, {}
    for p in poss:
        pid = str(p.get('position_id'))
        demand[pid] = num(p.get('position_qty'))
        pos_order[pid] = str(p.get('order_no') or '').strip()

    by_cut = {}
    produced = collections.defaultdict(float)          # выпуск позиции ВСЕМИ покрывающими заданиями
    links = collections.defaultdict(list)              # cut_id → [(position_id, штук за проход)]
    for c in cuts:
        cid = str(c.get('cut_id'))
        by_cut[cid] = c
        pid = str(c.get('supply_position_id') or '').strip()
        per = per_run.get((cid, str(c.get('supply_finished_batch_id'))), 0.0)
        if pid and per > 0:
            links[cid].append((pid, per))
            produced[pid] += per * num(c.get('cut_planned_runs'))

    # Заказ → его задания и позиции.
    cuts_by_order = collections.defaultdict(list)
    for cid, c in by_cut.items():
        cuts_by_order[str(c.get('order_no') or '').strip()].append(cid)
    poss_by_order = collections.defaultdict(list)
    for pid, o in pos_order.items():
        poss_by_order[o].append(pid)

    targets = sorted(want) if want else sorted(set(list(cuts_by_order.keys()) + list(poss_by_order.keys())))
    out = []
    for order in targets:
        if order == '':
            continue
        cids = sorted(cuts_by_order.get(order, []), key=lambda x: (str(by_cut[x].get('cut_plan_date') or ''), x))
        pids = sorted(poss_by_order.get(order, []))

        # Цепочки дробления: голова + продолжения («ID первой части»).
        chains = collections.defaultdict(list)
        for cid in cids:
            head = str(by_cut[cid].get('cut_first_part') or '').strip() or cid
            chains[head].append(cid)

        runs_plan = sum(int(num(by_cut[c].get('cut_planned_runs'))) for c in cids)
        runs_fact = sum(int(num(by_cut[c].get('cut_runs_fact'))) for c in cids)
        started = [c for c in cids if filled(by_cut[c].get('cut_start_date'))]
        done = [c for c in cids if filled(by_cut[c].get('cut_end_date'))]

        # Свидетель «Тайминг»: что задание обещало по проходам, когда его считали.
        told = 0
        told_known = False
        for head, members in chains.items():
            t = timing_runs(by_cut[head].get('cut_timing')) if head in by_cut else None
            if t is not None:
                told += t
                told_known = True

        # Недостача заказа: сколько штук позиции не хватает по ИТОГОВОМУ плану (§15).
        short_pcs, short_runs = 0.0, 0
        for pid in pids:
            gap = demand.get(pid, 0.0) - produced.get(pid, 0.0)
            if gap > 0.001:
                short_pcs += gap
                per = max([p for c in cids for (q, p) in links[c] if q == pid] or [0])
                if per > 0:
                    short_runs = max(short_runs, int(math.ceil(gap / per)))

        if not cids:
            verdict = 'ЗАДАНИЙ НЕТ — заказ не спланирован (или записи пропали)'
        elif told_known and runs_plan < told:
            verdict = ('ПРОХОДЫ СРЕЗАНЫ: в плане %d, «Тайминг» обещал %d — класс #4598, '
                       'чинит docs/scripts/restore_lost_runs_4598.py' % (runs_plan, told))
        elif short_runs > 0:
            verdict = ('НЕДООБЕСПЕЧЕН: не хватает %d шт. ≈ %d проходов (§15 SUPPLY_CONSERVED)'
                       % (round(short_pcs), short_runs))
        elif any(len(m) > 1 for m in chains.values()):
            parts = max(len(m) for m in chains.values())
            verdict = ('НЕ ПОТЕРЯНО: задание разбито по дням на %d части, проходы целы (#4617)' % parts)
        elif done:
            verdict = 'ВЫПОЛНЕНО (есть «Закончено»)'
        elif started:
            verdict = 'В РАБОТЕ (есть «Начато»)'
        else:
            verdict = 'РАСХОЖДЕНИЙ НЕ ВИДНО'

        out.append({
            'order': order, 'cuts': cids, 'chains': {h: sorted(m) for h, m in chains.items()},
            'runs_plan': runs_plan, 'runs_fact': runs_fact, 'timing_runs': told if told_known else None,
            'short_pcs': round(short_pcs), 'short_runs': short_runs,
            'positions': pids, 'verdict': verdict,
        })
    return out


def report(rows, by_cut=None):
    print('=== Разбор «потерянных резок» (база %s) ===' % DB)
    for r in rows:
        print('\nЗаказ %s — %s' % (r['order'], r['verdict']))
        print('  проходов в плане: %d%s%s' % (
            r['runs_plan'],
            (', факт %d' % r['runs_fact']) if r['runs_fact'] else '',
            (', «Тайминг» обещал %s' % r['timing_runs']) if r['timing_runs'] is not None else ''))
        for head, members in sorted(r['chains'].items()):
            if len(members) > 1:
                print('  цепочка %s: %s' % (head, ' + '.join(members)))
        if r['cuts']:
            print('  задания: %s' % ', '.join(r['cuts']))
        else:
            print('  задания: НЕТ')
        if r['short_runs']:
            print('  недостача: %d шт. ≈ %d проходов' % (r['short_pcs'], r['short_runs']))
    print('\nЗаказов разобрано: %d' % len(rows))


# ── Самопроверка вердиктов на фикстурах (без сети) ────────────────────────────────────────────
def selftest():
    ok = fail = 0

    def check(cond, name):
        nonlocal ok, fail
        print(('  ok   ' if cond else '  FAIL ') + name)
        if cond:
            ok += 1
        else:
            fail += 1

    strips = [{'cut_id': 'C1', 'gp_id': 'B1', 'strip_qty': 29},
              {'cut_id': 'C2', 'gp_id': 'B1', 'strip_qty': 29},
              {'cut_id': 'C3', 'gp_id': 'B3', 'strip_qty': 10},
              {'cut_id': 'C4', 'gp_id': 'B4', 'strip_qty': 10}]

    # 1. Разбитое по дням задание: проходы целы, недостачи нет → НЕ потеря (#4617).
    poss = [{'position_id': 'P1', 'position_qty': 145, 'order_no': '4580'}]
    cuts = [{'cut_id': 'C1', 'order_no': '4580', 'cut_planned_runs': 1, 'cut_timing': 'Плановых проходов: 5',
             'cut_first_part': '', 'supply_position_id': 'P1', 'supply_finished_batch_id': 'B1'},
            {'cut_id': 'C2', 'order_no': '4580', 'cut_planned_runs': 4, 'cut_timing': '',
             'cut_first_part': 'C1', 'supply_position_id': 'P1', 'supply_finished_batch_id': 'B1'}]
    r = audit(cuts, strips, poss, ['4580'])[0]
    check('НЕ ПОТЕРЯНО' in r['verdict'], 'разбитое по дням задание потерей не считается')
    check(r['runs_plan'] == 5 and r['timing_runs'] == 5, 'проходы цепочки суммируются (1 + 4 = 5)')

    # 2. Проходы срезаны: «Тайминг» обещал больше, чем лежит в плане (#4598).
    cuts2 = [{'cut_id': 'C1', 'order_no': '4455', 'cut_planned_runs': 1, 'cut_timing': 'Плановых проходов: 5',
              'cut_first_part': '', 'supply_position_id': 'P1', 'supply_finished_batch_id': 'B1'}]
    r2 = audit(cuts2, strips, [{'position_id': 'P1', 'position_qty': 145, 'order_no': '4455'}], ['4455'])[0]
    check('ПРОХОДЫ СРЕЗАНЫ' in r2['verdict'], 'срез проходов виден по «Таймингу»')

    # 3. Заданий нет вовсе — заказ не спланирован.
    r3 = audit([], strips, [{'position_id': 'P9', 'position_qty': 100, 'order_no': '4999'}], ['4999'])[0]
    check('ЗАДАНИЙ НЕТ' in r3['verdict'], 'заказ без заданий назван прямо')

    # 4. Недообеспечение: план даёт меньше, чем заказано, а «Тайминг» молчит (§15).
    cuts4 = [{'cut_id': 'C3', 'order_no': '4442', 'cut_planned_runs': 2, 'cut_timing': '',
              'cut_first_part': '', 'supply_position_id': 'P4', 'supply_finished_batch_id': 'B3'}]
    r4 = audit(cuts4, strips, [{'position_id': 'P4', 'position_qty': 100, 'order_no': '4442'}], ['4442'])[0]
    check('НЕДООБЕСПЕЧЕН' in r4['verdict'] and r4['short_runs'] == 8,
          'недостача считается в штуках и переводится в проходы (100 − 20 = 80 шт. ÷ 10 = 8)')

    # 5. Всё сходится — не выдумываем нарушение.
    cuts5 = [{'cut_id': 'C4', 'order_no': '4001', 'cut_planned_runs': 10, 'cut_timing': 'Плановых проходов: 10',
              'cut_first_part': '', 'supply_position_id': 'P5', 'supply_finished_batch_id': 'B4'}]
    r5 = audit(cuts5, strips, [{'position_id': 'P5', 'position_qty': 100, 'order_no': '4001'}], ['4001'])[0]
    check('РАСХОЖДЕНИЙ НЕ ВИДНО' in r5['verdict'], 'ровный заказ обвинений не получает')

    # 6. Выполненное и начатое не путаем с потерей.
    cuts6 = [{'cut_id': 'C4', 'order_no': '4002', 'cut_planned_runs': 10, 'cut_runs_fact': 10,
              'cut_start_date': '1785000000', 'cut_end_date': '1785003600', 'cut_timing': 'Плановых проходов: 10',
              'cut_first_part': '', 'supply_position_id': 'P6', 'supply_finished_batch_id': 'B4'}]
    r6 = audit(cuts6, strips, [{'position_id': 'P6', 'position_qty': 100, 'order_no': '4002'}], ['4002'])[0]
    check('ВЫПОЛНЕНО' in r6['verdict'] and r6['runs_fact'] == 10, 'выполненный заказ назван выполненным')

    print('\n%d/%d проверок пройдено' % (ok, ok + fail))
    return 0 if fail == 0 else 1


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('-')]
    if '--selftest' in sys.argv:
        raise SystemExit(selftest())
    if not TOKEN:
        raise SystemExit('нужен TOKEN=<сессионный X-Authorization> (или --selftest для проверки логики)')
    cuts = _req('report/cut_planning?JSON_KV&LIMIT=0,5000')
    strips = _req('report/cut_strips?JSON_KV&LIMIT=0,5000')
    poss = _req('report/positions_list?JSON_KV&LIMIT=0,2000')
    rows = audit(cuts, strips, poss, args)
    if not args:
        rows = [r for r in rows if 'РАСХОЖДЕНИЙ НЕ ВИДНО' not in r['verdict']]
    report(rows)


if __name__ == '__main__':
    main()
