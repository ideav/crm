#!/usr/bin/env python3
# issue #4598: разовый возврат ПОТЕРЯННЫХ проходов заданиям ateh.
#
# Что случилось: `applySplitPlan` писал план фазами `updates → creates` и не атомарно — сбой на
# создании продолжения оставлял голову с проходами СЕГМЕНТА, а остаток не рождался никогда.
# Порядок фаз исправлен (creates → updates), но уже испорченные записи надо вернуть руками.
#
# КОГО ЧИНИМ (жёсткий отбор, иначе заденем законное разделение #4564):
#   • «Кол-во резок план» МЕНЬШЕ числа из хранимого «Тайминга» («Плановых проходов: N»);
#   • «Начато» и «Кол-во резок факт» ПУСТЫ (работа не начиналась);
#   • «Закончено» ПУСТО (не выполнено).
# Задание с фактом — это разделённое #4564, у него план и обязан равняться факту: НЕ ТРОГАЕМ.
#
# СКОЛЬКО ВОЗВРАЩАЕМ — только когда ДВА независимых свидетеля сошлись:
#   1) хранимый «Тайминг» задания («Плановых проходов: N»);
#   2) НЕДОСТАЧА позиции по правилу §15 С УЧЁТОМ СОСЕДЕЙ: сколько проходов не хватает заказу
#      сверх того, что уже дают ВСЕ покрывающие его задания.
# Свидетели разошлись → задание НЕ пишется и называется в отчёте (нет данных — не выдумываем).
#
# Почему второго свидетеля надо считать именно так. У ГОЛОВЫ законно разбитого по дням задания
# «Тайминг» описывает ЦЕЛУЮ резку, а проходы — только её сегмент: остаток лежит в записи-
# продолжении. Наивная мерка «ceil(заказ / полосы)» приняла бы такую голову за потерю и удвоила
# выпуск (боевое: 655706 заказа 4455 — 139 + 61 у соседа = 3000, ровно заказ; 660163 заказа 4507 —
# 17 + 3 = 300). Недостача, посчитанная по ВСЕМ заданиям позиции, у таких голов равна нулю, и они
# сами отсеиваются.
#
# ПИШЕМ ТОЛЬКО «Кол-во резок план» (16403). «Длительность, минут» и «Резка и Лидер» намеренно НЕ
# трогаем: их считает упаковщик (#4499/#4529), и после правки план надо пересобрать в РМ
# («Упорядочить» / «↻ Пересчитать наладку») — там же дни разложатся под возвращённые проходы.
#
# Запуск:
#   TOKEN=<сессионный X-Authorization> python3 docs/scripts/restore_lost_runs_4598.py            # dry-run
#   TOKEN=... python3 docs/scripts/restore_lost_runs_4598.py --apply                             # записать

import os, sys, json, math, re, urllib.request, urllib.parse, collections

DB = os.environ.get('DB', 'https://ideav.ru/ateh').rstrip('/')
TOKEN = os.environ.get('TOKEN', '')
APPLY = '--apply' in sys.argv
REQ_PLANNED_RUNS = 16403          # «Кол-во резок план» таблицы 1078
DBNAME = DB.rsplit('/', 1)[-1]


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


# `_xsrf` обязателен для POST `_m_*` даже при токене в заголовке (docs/kb/00-start.md):
# без него сервер отвечает 400 [{"error":"Неверный или устаревший токен CSRF"}].
XSRF = ''


def post(path, fields):
    f = dict(fields)
    f['token'] = TOKEN
    f['_xsrf'] = XSRF
    return _req('POST', path, f)


def main():
    if not TOKEN:
        raise SystemExit('нужен TOKEN=<сессионный X-Authorization>')
    cuts = get('report/cut_planning?JSON_KV&LIMIT=0,5000')
    strips = get('report/cut_strips?JSON_KV&LIMIT=0,5000')
    poss = get('report/positions_list?JSON_KV&LIMIT=0,2000')

    sq = {}
    for s in strips:
        sq[(s['cut_id'], s['gp_id'])] = int(float(s.get('strip_qty') or 0))
    demand = {p['position_id']: float(p.get('position_qty') or 0) for p in poss}

    by_cut, links = {}, collections.defaultdict(list)
    produced = collections.defaultdict(float)      # выпуск позиции ВСЕМИ покрывающими заданиями
    for r in cuts:
        by_cut[r['cut_id']] = r
        per = sq.get((r['cut_id'], r.get('supply_finished_batch_id')))
        pid = r.get('supply_position_id')
        if pid and per:
            links[r['cut_id']].append((pid, per))
            produced[pid] += per * int(float(r.get('cut_planned_runs') or 0))

    plan, refused = [], []
    for cid, c in sorted(by_cut.items()):
        if (c.get('cut_start_date') or '').strip() or (c.get('cut_runs_fact') or '').strip():
            continue                                    # начато / есть факт — это #4564, не наш случай
        if (c.get('cut_end_date') or '').strip():
            continue                                    # выполнено
        m = re.search(r'Плановых проходов:\s*(\d+)', c.get('cut_timing') or '')
        if not m:
            continue
        told, now = int(m.group(1)), int(float(c.get('cut_planned_runs') or 0))
        if told <= now:
            continue
        # второй свидетель: недостача позиции по §15 (с учётом соседей) → сколько проходов добавить
        add = 0
        for pid, per in links[cid]:
            short = demand.get(pid, 0) - produced.get(pid, 0)
            if short > 0.001 and per > 0:
                add = max(add, math.ceil(short / per))
        need = now + add if add > 0 else 0
        row = (cid, c.get('order_no'), now, told, need)
        (plan if need == told else refused).append(row)

    print('=== #4598: вернуть проходы (база %s) ===' % DB)
    for cid, order, now, told, need in plan:
        print('  задание %-8s заказ %-6s  «Кол-во резок план» %s → %s   '
              '(свидетели сошлись: «Тайминг» %s, недостача заказа %s)'
              % (cid, order, now, told, told, need))
    print('  ИТОГО заданий: %d' % len(plan))
    covered = [r for r in refused if r[4] == 0]
    disputed = [r for r in refused if r[4] != 0]
    if covered:
        print('\n  НЕ ТРОГАЮ — остаток УЖЕ создан соседним заданием (законное разбиение по дням,')
        print('  «Тайминг» головы описывает целую резку, а её проходы — только сегмент):')
        for cid, order, now, told, need in covered:
            print('    задание %-8s заказ %-6s план %s, «Тайминг» %s, недостачи по заказу нет'
                  % (cid, order, now, told))
    if disputed:
        print('\n  НЕ ТРОГАЮ — свидетели разошлись (нужен глаз человека):')
        for cid, order, now, told, need in disputed:
            # Третий свидетель, полезный именно у ЦЕПОЧЕК: доля обеспечения САМОЙ записи.
            # «Кол-во рулонов» её «Обеспечения» ÷ «Кол-во полос» партии = сколько проходов эта
            # запись обязана нести по уже поделённому обеспечению.
            share = []
            c = by_cut[cid]
            per = sq.get((cid, c.get('supply_finished_batch_id')))
            rolls = c.get('supply_rolls')
            if per and rolls not in (None, ''):
                share.append('по своей доле обеспечения %s рул. ÷ %s полос = %s'
                             % (rolls, per, math.ceil(float(rolls) / per)))
            print('    задание %-8s заказ %-6s план %s, «Тайминг» %s, по недостаче нужно %s%s'
                  % (cid, order, now, told, need, ('; ' + '; '.join(share)) if share else ''))
    # ── ЦЕПОЧКИ: потеря сразу на нескольких звеньях одного задания ────────────────────────────
    # У разорванного по дням задания «Тайминг» головы описывает ЦЕЛУЮ резку, а проходы каждой
    # записи — её сегмент. Когда проходы срезаны, а обеспечение уже поделено, цель КАЖДОЙ записи
    # говорит её собственная доля: «Кол-во рулонов» ÷ «Кол-во полос». Пишем только если сошлись
    # ТРИ свидетеля: Σ долей == «Тайминг» головы, и добавка закрывает недостачу §15 ровно.
    chains = collections.defaultdict(list)
    for cid, c in by_cut.items():
        head = (c.get('cut_first_part') or '').strip() or cid
        chains[head].append(cid)
    chain_plan = []
    for head, members in sorted(chains.items()):
        if len(members) < 2 or head not in by_cut:
            continue
        if any((by_cut[m].get('cut_start_date') or '').strip() or (by_cut[m].get('cut_runs_fact') or '').strip()
               or (by_cut[m].get('cut_end_date') or '').strip() for m in members):
            continue
        m = re.search(r'Плановых проходов:\s*(\d+)', by_cut[head].get('cut_timing') or '')
        if not m:
            continue
        told = int(m.group(1))
        now_sum = sum(int(float(by_cut[x].get('cut_planned_runs') or 0)) for x in members)
        if now_sum >= told:
            continue
        targets, ok = {}, True
        for x in members:
            c = by_cut[x]
            per = sq.get((x, c.get('supply_finished_batch_id')))
            rolls = c.get('supply_rolls')
            if not per or rolls in (None, '') or len(links[x]) != 1:
                ok = False; break
            targets[x] = math.ceil(float(rolls) / per)
        if not ok or sum(targets.values()) != told:
            continue
        short = 0
        for pid, per in links[head]:
            short = max(short, demand.get(pid, 0) - produced.get(pid, 0))
        if abs(short - (told - now_sum) * (links[head][0][1])) > 0.001:
            continue                      # добавка не совпала с недостачей §15 — не наш случай
        chain_plan.append((head, members, told, now_sum, targets))

    if chain_plan:
        print('\n=== ЦЕПОЧКИ: проходы срезаны на нескольких звеньях ===')
        for head, members, told, now_sum, targets in chain_plan:
            print('  цепочка %s (заказ %s): было %s проходов, должно %s'
                  % (head, by_cut[head].get('order_no'), now_sum, told))
            for x in members:
                print('     звено %-8s %s → %s   (его доля обеспечения %s рул. ÷ %s полос)'
                      % (x, by_cut[x].get('cut_planned_runs'), targets[x],
                         by_cut[x].get('supply_rolls'), sq.get((x, by_cut[x].get('supply_finished_batch_id')))))

    if not APPLY:
        print('\nDRY-RUN. Записать: добавьте --apply')
        return
    global XSRF
    XSRF = get('xsrf?JSON').get('_xsrf', '')
    if not XSRF:
        raise SystemExit('не получен _xsrf (GET xsrf?JSON) — POST будет отвергнут')
    for cid, order, now, told, need in plan:
        resp = post('_m_set/%s?JSON' % cid, {'t%d' % REQ_PLANNED_RUNS: str(told)})
        err = resp[0].get('error') if isinstance(resp, list) and resp and isinstance(resp[0], dict) else None
        if err:
            raise SystemExit('задание %s НЕ записано: %s' % (cid, err))
        print('  записано: %s → %s проходов' % (cid, told))
    for head, members, told, now_sum, targets in chain_plan:
        for x in members:
            if targets[x] == int(float(by_cut[x].get('cut_planned_runs') or 0)):
                continue
            resp = post('_m_set/%s?JSON' % x, {'t%d' % REQ_PLANNED_RUNS: str(targets[x])})
            err = resp[0].get('error') if isinstance(resp, list) and resp and isinstance(resp[0], dict) else None
            if err:
                raise SystemExit('звено %s НЕ записано: %s' % (x, err))
            print('  записано: звено %s цепочки %s → %s проходов' % (x, head, targets[x]))
    print('\nГотово. В РМ «Планирование производства» нажмите «Упорядочить» — план разложит '
          'возвращённые проходы по дням и пересчитает колонки.')


if __name__ == '__main__':
    main()
