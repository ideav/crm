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
            print('    задание %-8s заказ %-6s план %s, «Тайминг» %s, по недостаче нужно %s'
                  % (cid, order, now, told, need))
    if not APPLY:
        print('\nDRY-RUN. Записать: добавьте --apply')
        return
    for cid, order, now, told, need in plan:
        _req('POST', '_m_set/%s?JSON' % cid, {'t%d' % REQ_PLANNED_RUNS: str(told),
                                              'token': TOKEN, '_xsrf': ''})
        print('  записано: %s → %s проходов' % (cid, told))
    print('\nГотово. В РМ «Планирование производства» нажмите «Упорядочить» — план разложит '
          'возвращённые проходы по дням и пересчитает колонки.')


if __name__ == '__main__':
    main()
