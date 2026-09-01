// #4596 — станок закрыл смену: недоделанное переносится, не дожидаясь конца дня.
//
// ТЗ (issue #4596): «спланировать следующий день, не дожидаясь окончания предыдущего. Если есть
// событие закрытия смены в текущем дне, то невыполненные целиком или частично задания этого станка
// должны быть перенесены в следующий день процедурой урегулирования. Урегулирование может быть
// запущено несколько раз, для каждого станка по отдельности по мере закрытия смен».
//
// Мерка одна: ДЕНЬ ДЛЯ СТАНКА КОНЧИЛСЯ — либо он прошёл (просрочка), либо станок закрыл смену
// (`dayIsOverForSlitter`). Дальше решение прежнее, #4346/#4564: задание встаёт перед следующим
// заданием своего станка (в норме это следующий день), частично выполненное разделяется.
//
// Run with: node experiments/atex-production-planning-4596.test.js

process.env.TZ = 'UTC';

var api = require('../download/atex/js/production-planning.js');
var planning = api.planning;
var Controller = api.Controller;

var passed = 0, total = 0;
function assertEqual(actual, expected, name) {
    total++;
    var a = JSON.stringify(actual), e = JSON.stringify(expected);
    var ok = a === e;
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name + (ok ? '' : ' (ожидалось ' + e + ', получено ' + a + ')'));
    if (ok) passed++; else process.exitCode = 1;
}
function tsAt(y, m, d, hh, mm) { return Math.floor(Date.UTC(y, m - 1, d, hh, mm, 0) / 1000); }
function ids(list) { return (list || []).map(function(c) { return c.id; }); }

var TODAY = 20260803;                  // понедельник 03.08.2026
var TOMORROW_MS = new Date(2026, 7, 4, 0, 0, 0, 0).getTime();
var NOW_MS = new Date(2026, 7, 3, 15, 0, 0, 0).getTime();   // 15:00 — смены уже закрываются
var SHIFT_START = 480;                 // 08:00

// ── 1) события смены → станки, закрывшие смену сегодня ────────────────────────
// Читаем ТОТ ЖЕ отчёт, что пульт (slitter_shift_events), и берём из журнала один факт:
// последнее событие смены станка ЗА ЭТОТ ДЕНЬ — закрытие или открытие.
var eventRows = [
    { event_id: '1', event_when: String(tsAt(2026, 8, 3, 8, 0)), event_type: 'Начало смены', slitter_id: '2' },
    { event_id: '2', event_when: String(tsAt(2026, 8, 3, 14, 40)), event_type: 'Конец смены', slitter_id: '2' },
    { event_id: '3', event_when: String(tsAt(2026, 8, 3, 8, 0)), event_type: 'Начало смены', slitter_id: '1' },
    // Станок 3: смену закрыли и снова открыли (доработка) — закрытой она не считается.
    { event_id: '4', event_when: String(tsAt(2026, 8, 3, 8, 0)), event_type: 'Начало смены', slitter_id: '3' },
    { event_id: '5', event_when: String(tsAt(2026, 8, 3, 12, 0)), event_type: 'Конец смены', slitter_id: '3' },
    { event_id: '6', event_when: String(tsAt(2026, 8, 3, 12, 30)), event_type: 'Начало смены', slitter_id: '3' },
    // Станок 4: закрытие ВЧЕРА — сегодняшний день оно не закрывает.
    { event_id: '7', event_when: String(tsAt(2026, 8, 2, 16, 0)), event_type: 'Конец смены', slitter_id: '4' },
    // Старое событие без ссылки «Слиттер» (#3522): станок — метка в «Примечаниях».
    { event_id: '8', event_when: String(tsAt(2026, 8, 3, 13, 10)), event_type: 'Конец смены',
      event_notes: 'Станок 5 · 03.08.2026' },
    // Прочие события журнала планированию не нужны.
    { event_id: '9', event_when: String(tsAt(2026, 8, 3, 9, 0)), event_type: 'Резка', slitter_id: '2', event_value: '3' }
];
var events = planning.rowsToShiftEvents(eventRows);
assertEqual(events.map(function(e) { return e.id; }), ['1', '2', '3', '4', '5', '6', '7', '8'],
    'rowsToShiftEvents оставляет только открытие/закрытие смены («Резка» отброшена)');

var closed = planning.shiftClosedSlitters(events, TODAY, { slitterIdByLabel: { 'Станок 5': '5' } });
assertEqual(Object.keys(closed).sort(), ['2', '5'],
    '#4596 смену СЕГОДНЯ закрыли станки 2 (по ссылке) и 5 (по метке «Примечаний»)');
assertEqual(closed['2'], tsAt(2026, 8, 3, 14, 40), 'запомнили момент закрытия — его показывает форма');
assertEqual(planning.shiftClosedSlitters(events, TODAY)['5'], undefined,
    'без карты подписей старое событие приписать некому — станок не считается закрытым');

// ── 2) «день для станка кончился» — один предикат ─────────────────────────────
assertEqual([
    planning.dayIsOverForSlitter(20260802, '1', TODAY, closed),   // вчера — для всех
    planning.dayIsOverForSlitter(TODAY, '2', TODAY, closed),      // сегодня, смена закрыта
    planning.dayIsOverForSlitter(TODAY, '1', TODAY, closed),      // сегодня, смена идёт
    planning.dayIsOverForSlitter(20260804, '2', TODAY, closed)    // завтра — ещё не начался
], [true, true, false, false], '#4596 день кончился: прошедший — для всех, сегодняшний — у закрывших смену');

// ── 3) группы отклонений: сегодняшнее недоделанное у станка с закрытой сменой ──
var cuts = [
    // Станок 2 (смена закрыта в 14:40): не начато, начато частично, выполнено.
    { id: 'c2a', slitter: { id: '2' }, plannedRuns: 10, actualRuns: 0,
      planDate: String(tsAt(2026, 8, 3, 8, 0)), startDate: '', endDate: '' },
    { id: 'c2b', slitter: { id: '2' }, plannedRuns: 20, actualRuns: 8,
      planDate: String(tsAt(2026, 8, 3, 10, 0)), startDate: String(tsAt(2026, 8, 3, 10, 5)), endDate: '' },
    { id: 'c2done', slitter: { id: '2' }, plannedRuns: 5, actualRuns: 5,
      planDate: String(tsAt(2026, 8, 3, 9, 0)), startDate: String(tsAt(2026, 8, 3, 9, 5)),
      endDate: String(tsAt(2026, 8, 3, 9, 50)) },
    // Следующее задание станка 2 — завтра: именно перед ним встанут приезжие.
    { id: 'c2next', slitter: { id: '2' }, plannedRuns: 30, actualRuns: 0,
      planDate: String(tsAt(2026, 8, 4, 8, 0)), startDate: '', endDate: '' },
    // Станок 1 (смена ИДЁТ): сегодняшнее недоделанное — не отклонение, его не трогаем.
    { id: 'c1today', slitter: { id: '1' }, plannedRuns: 12, actualRuns: 3,
      planDate: String(tsAt(2026, 8, 3, 8, 0)), startDate: String(tsAt(2026, 8, 3, 8, 10)), endDate: '' },
    // Обычная просрочка станка 1 — правило прежнее.
    { id: 'c1late', slitter: { id: '1' }, plannedRuns: 10, actualRuns: 0,
      planDate: String(tsAt(2026, 7, 31, 8, 0)), startDate: '', endDate: '' },
    { id: 'c1next', slitter: { id: '1' }, plannedRuns: 10, actualRuns: 0,
      planDate: String(tsAt(2026, 8, 4, 8, 0)), startDate: '', endDate: '' }
];
var groups = planning.deviationGroups(cuts, TODAY, { shiftClosedSlitters: closed });
assertEqual(ids(groups.shiftClosed), ['c2a', 'c2b'],
    '#4596 сегодняшнее невыполненное станка с закрытой сменой — отдельная группа (по плановому времени)');
assertEqual(ids(groups.overdue), ['c1late'], 'просрочка прежняя — сегодняшнее в неё не попадает');
assertEqual([ids(groups.early), ids(groups.earlyRun)], [[], []],
    'выполненное в свой день и работа при открытой смене отклонениями не считаются');
assertEqual(ids(planning.deviationGroups(cuts, TODAY).shiftClosed), [],
    'без карты закрытых смен группа пуста — поведение до #4596');

// ── 4) урегулирование: недоделанное едет в СЛЕДУЮЩИЙ день ─────────────────────
// Место прежнее (#4574): перед следующим заданием станка, а оно отходит на минуту дальше.
// У станка 2 следующее задание стои́т завтра — значит недоделанное уезжает на завтра.
var settle = planning.deviationSettlePlan(cuts, groups, {
    todayKey: TODAY, shiftStartMin: SHIFT_START, shiftEndMin: 970,
    shiftClosedSlitters: closed,
    freeDayMsFor: function() { return TOMORROW_MS; }
});
var moveById = {};
settle.moves.forEach(function(m) { moveById[m.id] = m; });
assertEqual(moveById['c2a'], { id: 'c2a', planStart: tsAt(2026, 8, 4, 8, 0), reason: 'before-next' },
    '#4596 невыполненное целиком уезжает на время следующего задания станка — завтра 08:00');
assertEqual(moveById['c2next'], { id: 'c2next', planStart: tsAt(2026, 8, 4, 8, 0) + 120, reason: 'shift-next' },
    '#4574 следующее задание отходит на две минуты — за приезжими c2a и остатком c2b');
assertEqual(moveById['c1today'], undefined,
    '#4596 станок с ОТКРЫТОЙ сменой не тронут — его день ещё идёт');
assertEqual(moveById['c1late'], { id: 'c1late', planStart: tsAt(2026, 8, 4, 8, 0), reason: 'before-next' },
    'просроченное станка 1 встаёт перед своим следующим заданием — правило #4346 не изменилось');

assertEqual(settle.splits.map(function(sp) {
    return { id: sp.id, done: sp.doneRuns, rest: sp.restRuns, restAt: sp.restPlanStart, at: sp.donePlanStart };
}), [{ id: 'c2b', done: 8, rest: 12, restAt: tsAt(2026, 8, 4, 8, 0) + 60, at: tsAt(2026, 8, 3, 10, 5) }],
    '#4564 частично выполненное разделено: 8 проходов остаются в своём дне, остаток 12 — назавтра');
assertEqual(planning.planDateDayKey(settle.splits[0].doneCloseTs), TODAY,
    '#4572 выполненная часть закрывается в СВОЙ фактический день');

// ── 5) следующего задания у станка нет — ближайший день, и это НЕ сегодня ─────
// «Куда положить, когда сдвигать не от чего»: сегодняшний день станку с закрытой сменой больше
// не предлагается (dayOpenForWork), поэтому freeDayMsFor отдаёт завтра.
(function() {
    var lonely = [cuts[0]];   // c2a: у станка 2 других заданий нет
    var g = planning.deviationGroups(lonely, TODAY, { shiftClosedSlitters: closed });
    var s = planning.deviationSettlePlan(lonely, g, {
        todayKey: TODAY, shiftStartMin: SHIFT_START, shiftClosedSlitters: closed,
        freeDayMsFor: function(sid) {
            assertEqual(sid, '2', 'свободный день спрашивается у станка задания');
            return TOMORROW_MS;
        }
    });
    assertEqual(s.moves, [{ id: 'c2a', planStart: Math.floor(TOMORROW_MS / 1000) + SHIFT_START * 60,
                            reason: 'free-day' }],
        '#4596 нет следующего задания → начало смены ближайшего открытого дня');
})();

// ── 6) контроллер: закрытая смена закрывает СЕГОДНЯШНИЙ день этого станка ─────
(function() {
    var c = Object.create(Controller.prototype);
    c.meta = { calendar: { id: '123162' }, freeze: { id: '633483' } };
    c.freezeByDay = {};
    c.calendarByDay = {};
    c.downtimesBySlitter = {};
    c.daySettings = {};
    c.slitters = [{ id: '1', label: 'Станок 1' }, { id: '2', label: 'Станок 2' }, { id: '5', label: 'Станок 5' }];
    c.shiftEvents = events;
    c.nowMs = function() { return NOW_MS; };
    c.dayIsWorking = function() { return true; };

    var todayMs = new Date(2026, 7, 3, 0, 0, 0, 0).getTime();
    assertEqual(c.dayOpenForWork('2', todayMs), false,
        '#4596 станок закрыл смену — сегодняшний день для него закрыт');
    assertEqual(c.dayOpenForWork('1', todayMs), true,
        'у станка с открытой сменой сегодняшний день по-прежнему открыт');
    assertEqual(c.dayOpenForWork('2', TOMORROW_MS), true, 'завтра станок 2 снова работает');
    assertEqual(c.nearestFreeDayMs('2'), TOMORROW_MS,
        '#4596 «ближайший свободный день» станка с закрытой сменой — завтра, а не сегодня');

    // Кнопка «Отклонения»: сегодняшнее недоделанное станка с закрытой сменой считается вместе
    // с просроченным (решение по ним одно), но названо отдельно.
    c.cuts = cuts;
    var st = c.deviationState();
    assertEqual([st.n, st.s, st.m, st.k, st.total], [3, 2, 0, 0, 3],
        '#4596 «не выполнено, а день кончился» = просроченные + со станков с закрытой сменой');
    assertEqual(c.shiftClosedNote(), 'Смена закрыта: Станок 2 · 14:40, Станок 5 · 13:10',
        '#4596 форма называет станки и время закрытия смены');
})();

// ── 7) журнал событий не прочитан или усечён — говорим вслух ─────────────────
// Молчаливый «никто смену не закрывал» здесь недопустим: он читается как факт, а на деле мы
// просто не видим журнала (нет гранта роли на отчёт) или видим не весь (#4371 — лимит отчёта).
function loaderCase(getJson) {
    var c = Object.create(Controller.prototype);
    c.slitters = [{ id: '2', label: 'Станок 2' }];
    c.nowMs = function() { return NOW_MS; };
    c.notified = [];
    c.paths = [];
    c.notify = function(msg, kind) { c.notified.push(kind); };
    c.getJson = function(path) { c.paths.push(path); return getJson(path); };
    var log = console.log, err = console.error;
    console.log = function() {}; console.error = function() {};
    return c.loadShiftEvents().then(function() {
        console.log = log; console.error = err;
        return c;
    }, function(e) { console.log = log; console.error = err; throw e; });
}

var closedRow = { event_id: '1', event_when: String(tsAt(2026, 8, 3, 14, 40)),
    event_type: 'Конец смены', slitter_id: '2' };

loaderCase(function() { return Promise.reject(new Error('403 Forbidden')); }).then(function(c) {
    assertEqual([c.shiftEvents.length, c.shiftEventsError, c.notified],
        [0, '403 Forbidden', ['warning']],
        '#4596 отчёт недоступен → пусто, причина сохранена, оператору сказано');
    // Усечённый журнал: строк ровно по лимиту — свежих событий в нём может не быть.
    var many = [];
    for (var i = 0; i < 5000; i++) many.push(closedRow);
    return loaderCase(function() { return Promise.resolve(many); });
}).then(function(c) {
    assertEqual([/усечённым/.test(c.shiftEventsError), c.notified], [true, ['warning']],
        '#4371 журнал пришёл ровно по лимиту — усечение названо, а не скрыто');
    return loaderCase(function() { return Promise.resolve([closedRow]); });
}).then(function(c) {
    assertEqual([c.shiftEventsError, c.notified, Object.keys(c.shiftClosedSlittersToday())],
        ['', [], ['2']],
        'нормальный ответ — ни ошибок, ни тостов, станок 2 закрыл смену');
    // #4833: окно журнала расширено до «сегодня + вчера» (станок, закрывший смену вчера
    // вечером, для просроченных «не в смене»), по-прежнему ОДНИМ запросом.
    assertEqual(c.paths.length === 1 && /FR_event_when=%3E02\.08\.2026/.test(c.paths[0]), true,
        '#4596/#4833 журнал запрашивается ЗА СЕГОДНЯ И ВЧЕРА (FR_event_when=>ДД.ММ.ГГГГ), одним запросом');
    // Фильтр отдал пусто, а в журнале сегодняшние события ЕСТЬ — фильтр сломан, об этом орём
    // и работаем на полном списке (молчаливое «никто смену не закрывал» недопустимо).
    return loaderCase(function(path) {
        return Promise.resolve(/FR_event_when/.test(path) ? [] : [closedRow]);
    });
}).then(function(c) {
    assertEqual([/фильтр по дате/.test(c.shiftEventsError), c.notified,
                 Object.keys(c.shiftClosedSlittersToday()), c.paths.length],
        [true, ['warning'], ['2'], 2],
        '#4596 фильтр отдал пусто при живых событиях — сказано вслух, взят полный журнал');
    // Пусто и по фильтру, и целиком — это норма: смен сегодня ещё не открывали.
    return loaderCase(function() { return Promise.resolve([]); });
}).then(function(c) {
    assertEqual([c.shiftEventsError, c.notified, c.paths.length], ['', [], 2],
        'событий сегодня нет — молчим (перепроверили журналом целиком и успокоились)');
    console.log('\n' + passed + '/' + total + ' passed');
}).catch(function(e) {
    process.exitCode = 1;
    console.log('FAIL — необработанная ошибка загрузчика: ' + (e && e.message || e));
});
