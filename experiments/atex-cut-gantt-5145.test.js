// Regression test for ideav/crm#5145 — «С опозданием» у выполненных в срок.
//
// Жалоба заказчика (скриншот от 14.10.2026, ideav.ru/ateh/cut-gantt): задания стоят в плане
// и выполнены раньше срока, но гантт красит их «С опозданием».
//
// Причина: дедлайн окраски считался как «план + намотка» (cut_duration), а план строится и
// рисуется как «наладка + „Резка и Лидер“» (cut_time). Типовая наладка 30+15 мин = +45 мин
// красного у идеально выполненного задания. Живые случаи 14.10.2026:
//   • id 950633 (Станок 3): план 08:00, наладка 30, резка+лидер 90 → окно до 10:00;
//     финиш 09:18:39 — в окне, но был «С опозданием» (дедлайн 08:00+60=09:00);
//   • id 953233 (Станок 2): план 10:11, наладка 15, резка+лидер 308 → окно до 15:34;
//     в 13:11 ещё в работе — но был «С опозданием» (дедлайн 10:11+132=12:23);
//   • id 946622 (Станок 1): план 08:00, наладка 15, резка+лидер 19 → окно до 08:34;
//     финиш 09:00:11 — ПОЗЖЕ окна, «С опозданием» честно и после фикса.
//
// Правило (уточнено заказчиком 14.10.2026, второй раунд): «С опозданием» = сорван СРОК
// ГОТОВНОСТИ ЗАКАЗА (due_date): финиш/«сейчас» в ДЕНЬ срока или раньше — не опоздание
// (дедлайн = конец дня срока; опоздание меряем днями, как планировщик #4064). «Старт
// просрочен» (план уехал, срок не сорван) — янтарный, не красный. Срока нет — дедлайн =
// конец планового окна задания (наладка + «Резка и Лидер»); легаси без cut_time — прежнее
// окно «план + намотка» (согласовано с баром #3705). Геометрия бара (окно, обед-зазоры
// #3846/#4007) не меняется.
//
// Run with: node experiments/atex-cut-gantt-5145.test.js

process.env.TZ = 'Europe/Moscow';

var g = require('../download/atex/js/cut-gantt.js').gantt;
var mc = require('../download/atex/js/machine-calendar.js').calendar;

var passed = 0, total = 0;
function assertEqual(actual, expected, name) {
    total++;
    var a = JSON.stringify(actual), e = JSON.stringify(expected);
    var ok = a === e;
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name + (ok ? '' : ' (ожидалось ' + e + ', получено ' + a + ')'));
    if (ok) passed++; else process.exitCode = 1;
}

var NOW = g.parseDateTimeMs('2026-10-14 13:11');

// Строка отчёта cut_planning в живом формате (unix-секунды, десятичные минуты).
// 1791954000 = 14.10.2026 08:00 МСК; ontop — переопределения полей.
function liveRow(over) {
    return Object.assign({
        cut_id: '950633', cut_slitter: 'Станок 3', cut_slitter_id: '103',
        cut_plan_date: '1791954000',           // 14.10 08:00
        cut_start_date: '1791958717',          // 09:18:37
        cut_end_date: '1791958719',            // 09:18:39
        cut_status: '', cut_duration: '60',
        cut_time: '90.00', cut_knife_setup_min: '30.00', cut_material_winding_min: '0.00',
        order_no: '5964', client_order_no: '3652', cut_material: 'MW308'
    }, over || {});
}

// Полный конвейер Ганта: строки отчёта → задания → наладка из хранимых колонок.
function cutFromRow(row) {
    var cut = g.rowsToCuts([row])[0];
    return g.attachSetupMinutes([cut], {})[0];
}

// ── 1) Выполнен в пределах планового окна → «В срок» (был красным) ──
var inWindow = cutFromRow(liveRow());
assertEqual(g.cutStatus(inWindow, NOW).key, 'on-time',
    '#5145 финиш внутри окна (наладка+резка+лидер) → в срок');

// Дедлайн окраски = конец планового окна: 08:00 + (наладка 30 + резка/лидер 90) = 10:00.
assertEqual(g.cutTimeRange(inWindow).deadlineMs, g.parseDateTimeMs('2026-10-14 10:00'),
    '#5145 дедлайн (тултип и окраска) = план + наладка + «Резка и Лидер»');

// ── 2) Окно ещё идёт (до 15:34), в 13:11 задания нет в работе → «Старт просрочен» (было «С опозданием» с 12:23);
//       начатое в 12:00 → «В работе» до конца окна ──
var running = cutFromRow(liveRow({
    cut_id: '953233', cut_slitter: 'Станок 2', cut_slitter_id: '102',
    cut_plan_date: '1791961860',           // 10:11
    cut_start_date: '', cut_end_date: '',
    cut_duration: '132', cut_time: '308.00', cut_knife_setup_min: '0.00', cut_material_winding_min: '15.00',
    order_no: '5933', client_order_no: ''
}));
assertEqual(g.cutStatus(running, NOW).key, 'late-start',
    '#5145 окно до 15:34, в 13:11 не начато → «Старт просрочен», не «С опозданием»');
assertEqual(g.cutStatus(Object.assign({}, running, { startDate: '2026-10-14 12:00' }), NOW).key, 'running',
    '#5145 начато в 12:00, окно до 15:34 идёт → «В работе»');

// ── 3) Граница: финиш ровно в конце окна → в срок; минута позже → опоздание ──
function bounded(endIso) {
    return cutFromRow(liveRow({
        cut_start_date: '1791954000', cut_end_date: String(g.parseDateTimeMs(endIso) / 1000),
        cut_duration: '34', cut_time: '34.00', cut_knife_setup_min: '0.00', cut_material_winding_min: '0.00'
    }));
}
assertEqual(g.cutStatus(bounded('2026-10-14 08:34'), NOW).key, 'on-time',
    '#5145 финиш ровно в конце планового окна → в срок');
assertEqual(g.cutStatus(bounded('2026-10-14 08:35'), NOW).key, 'late',
    '#5145 финиш на минуту позже конца окна → с опозданием');

// ── 4) Срок готовности заказа (due_date) — главный дедлайн (уточнение заказчика 14.10.2026:
//       «5924 стоит в плане сегодня, дата готовности сегодня, а он красный»). Финиш в ДЕНЬ
//       срока или раньше — не опоздание, даже если плановое окно резки уже прошло. ──
function dueRow(over) {
    return cutFromRow(liveRow(Object.assign({
        cut_id: '946622', cut_slitter: 'Станок 1', cut_slitter_id: '101',
        cut_duration: '9', cut_time: '19.00', cut_knife_setup_min: '0.00', cut_material_winding_min: '15.00',
        cut_start_date: '1791957610', cut_end_date: '1791957611',   // 09:00:10–09:00:11, окно до 08:34
        order_no: '5924', client_order_no: '3634', cut_material: 'MWR113L'
    }, over || {})));
}
assertEqual(g.cutStatus(dueRow({ due_date: '14.10.2026' }), NOW).key, 'on-time',
    '#5145 финиш сегодня, срок готовности сегодня → в срок (окно резки не при чём)');
assertEqual(g.cutStatus(dueRow({ due_date: '21.10.2026' }), NOW).key, 'on-time',
    '#5145 финиш за неделю до срока (живой случай 5977) → в срок');
assertEqual(g.cutStatus(dueRow({ due_date: '13.10.2026' }), NOW).key, 'late',
    '#5145 финиш 14.10 при сроке 13.10 → с опозданием (сорван срок заказа)');
// Граница дня: 23:59 дня срока — в срок, полночь следующего — опоздание.
var dueDayEnd = g.parseDateTimeMs('15.10.2026') - 60000;   // 23:59 14.10
assertEqual(g.cutStatus(dueRow({ due_date: '14.10.2026', cut_end_date: String(dueDayEnd / 1000) }), NOW).key, 'on-time',
    '#5145 финиш 23:59 дня срока → в срок');
assertEqual(g.cutStatus(dueRow({ due_date: '14.10.2026', cut_end_date: String((dueDayEnd + 60000) / 1000) }), NOW).key, 'late',
    '#5145 финиш 00:00 следующего дня → с опозданием');
// Незавершённые: срок ещё не прошёл → не красная (окно прошло — «Старт просрочен»); срок прошёл → красная.
var undoneDue = cutFromRow(liveRow({
    cut_id: '958553', cut_slitter: 'Станок 2', cut_slitter_id: '102',
    cut_plan_date: String(g.parseDateTimeMs('13.10.2026 08:00') / 1000),   // план вчера
    cut_start_date: '', cut_end_date: '',
    cut_duration: '45', cut_time: '105.00', cut_knife_setup_min: '0.00', cut_material_winding_min: '0.00'
}));
assertEqual(g.cutStatus(undoneDue, NOW).key, 'late',
    '#5145 срока нет, плановое окно вчера прошло, не начато → с опозданием (fallback: окно — единственный дедлайн)');
assertEqual(g.cutStatus(Object.assign({}, undoneDue, { dueDate: '13.10.2026' }), NOW).key, 'late',
    '#5145 срок готовности вчера, не выполнено → с опозданием');
assertEqual(g.cutStatus(Object.assign({}, undoneDue, { dueDate: '15.10.2026' }), NOW).key, 'late-start',
    '#5145 срок готовности завтра, план вчера → «Старт просрочен»');

// ── 5) Геометрия бара не меняется: окно = наладка + резка/лидер (#4572/#4334 не задеты) ──
assertEqual(g.cutBarSpanMin(running, g.cutSetupMin(running).total, null, null), 323,
    '#5145 подпись бара незавершённой = наладка 15 + резка/лидер 308');
assertEqual(g.cutBarTime(running, g.cutSetupMin(running).total, null, null), '10:11-15:34 (323 мин)',
    '#5145 бар незавершённой = плановое окно, совпадает с дедлайном');
assertEqual(g.cutBarSpanMin(inWindow, g.cutSetupMin(inWindow).total, null, null), 79,
    '#5145 у выполненной бар по-прежнему укорочен фактом до 09:18:39 (#4572)');

// ── 6) Легаси без cut_time: прежнее окно «план + намотка» ──
var legacy = { planDate: '2026-06-10 08:00', duration: 60, leaderMin: 2,
    startDate: '2026-06-10 08:00', endDate: '2026-06-10 08:40' };
assertEqual(g.cutStatus(legacy, NOW).key, 'on-time',
    '#5145 легаси: финиш до план+намотка → в срок (как было)');
var legacyLate = { planDate: '2026-06-10 08:00', duration: 60, leaderMin: 2,
    endDate: '2026-06-10 09:30' };
assertEqual(g.cutStatus(legacyLate, NOW).key, 'late',
    '#5145 легаси: финиш позже план+намотка → с опозданием (окно прежнее, #3705)');

// ── 7) Нет тайминга (cut_time=0, намотка 0) — дедлайна нет, красным не красим ──
var noTiming = cutFromRow(liveRow({
    cut_duration: '0', cut_time: '0.00', cut_knife_setup_min: '15.00',
    cut_start_date: '', cut_end_date: String(g.parseDateTimeMs('2026-10-14 16:00') / 1000)
}));
assertEqual(g.cutStatus(noTiming, NOW).key, 'done',
    '#5145 без плановых минут резки дедлайна нет → «Завершено», не «С опозданием»');

// ── 8) Сценарий #4334 живым окном: факт красит, план не двигает ──
var startedEarly = { planDate: '2026-06-10 10:00', cutTimeMin: 60, setupKnifeMin: 30, setupMaterialMin: 15,
    startDate: '2026-06-10 08:00' };
assertEqual(g.cutStatus(startedEarly, g.parseDateTimeMs('2026-06-10 11:00')).key, 'running',
    '#5145 начата раньше плана, окно (до 11:45) идёт → «В работе»');
var doneInWindow = { planDate: '2026-06-10 10:00', cutTimeMin: 60, setupKnifeMin: 30, setupMaterialMin: 15,
    startDate: '2026-06-10 10:00', endDate: '2026-06-10 11:30' };
assertEqual(g.cutStatus(doneInWindow, NOW).key, 'on-time',
    '#5145 сделана в окне (10:00–11:45) → «В срок»');

// ── 9) «Календарь занятости станков»: тот же дедлайн ──
var mcCuts = mc.rowsToCuts([liveRow()]);
assertEqual([mcCuts[0].cutTimeMin, mcCuts[0].storedKnifeMin, mcCuts[0].storedMaterialMin], [90, 30, 0],
    '#5145 machine-calendar: rowsToCuts читает cut_time и наладку');
assertEqual(mc.cutCalendarStatus(mcCuts[0], NOW).key, 'on-time',
    '#5145 machine-calendar: финиш внутри окна → в срок');
assertEqual(mc.rowsToCuts([liveRow({ due_date: '14.10.2026' })])[0].dueDate, '14.10.2026',
    '#5145 machine-calendar: rowsToCuts читает срок готовности заказа');
var mcDue = mc.rowsToCuts([liveRow({
    cut_id: '946622', cut_duration: '9', cut_time: '19.00',
    cut_knife_setup_min: '0.00', cut_material_winding_min: '15.00',
    cut_start_date: '1791957610', cut_end_date: '1791957611', due_date: '14.10.2026'
})])[0];
assertEqual(mc.cutCalendarStatus(mcDue, NOW).key, 'on-time',
    '#5145 machine-calendar: финиш в день срока готовности → в срок');
assertEqual(mc.cutCalendarStatus(Object.assign({}, mcDue, { dueDate: '13.10.2026' }), NOW).key, 'late',
    '#5145 machine-calendar: финиш после дня срока → с опозданием');
var mcRunning = mc.rowsToCuts([liveRow({
    cut_id: '953233', cut_plan_date: '1791961860', cut_start_date: '', cut_end_date: '',
    cut_duration: '132', cut_time: '308.00', cut_knife_setup_min: '0.00', cut_material_winding_min: '15.00'
})])[0];
assertEqual(mc.cutCalendarStatus(mcRunning, NOW).key, 'late-start',
    '#5145 machine-calendar: окно до 15:34, в 13:11 не начато → «Старт просрочен»');
assertEqual(mc.cutCalendarStatus(Object.assign({}, mcRunning, { startDate: '2026-10-14 12:00' }), NOW).key, 'running',
    '#5145 machine-calendar: начато в 12:00, окно идёт → «В работе»');
var mcLegacy = mc.cutCalendarStatus({ planDate: '2026-06-11 08:00', endDate: '2026-06-11 09:30', duration: 60 },
    Date.parse('2026-06-11T09:40:00Z'));
assertEqual(mcLegacy.key, 'late', '#5145 machine-calendar: легаси без cut_time — прежнее окно');

// ── 10) Режим продаж (роль «Менеджер…»): план к сроку, выполнено — зелёным (#5145) ──
assertEqual(g.isSalesManagerRole('Менеджер по продажам'), true, '#5145 роль «Менеджер по продажам» → режим продаж');
assertEqual(g.isSalesManagerRole('Менеджер'), true, '#5145 роль «Менеджер» → режим продаж');
assertEqual(g.isSalesManagerRole('менеджер  по продажам'), true, '#5145 регистр и двойной пробел не мешают');
assertEqual(g.isSalesManagerRole('Диспетчер'), false, '#5145 «Диспетчер» → производственный режим');
assertEqual(g.isSalesManagerRole('Руководитель'), false, '#5145 «Руководитель» → производственный режим');
assertEqual(g.isSalesManagerRole('Начальник смены'), false, '#5145 «Начальник…» → не менеджер');
assertEqual(g.isSalesManagerRole(''), false, '#5145 пустая роль → производственный режим');

// Выполнено — всегда зелёное, даже позже планового окна (живой случай 5924: финиш 09:00, окно до 08:34).
var mgrDone = dueRow({ due_date: '14.10.2026' });
assertEqual(g.cutStatus(mgrDone, NOW, true), { key: 'done', label: 'Выполнено' },
    '#5145 менеджер: выполнено → «Выполнено» (зелёное)');
// Запланировано в срок: план сегодня, срок сегодня, окно кончается в пределах дня срока.
var mgrPlanned = cutFromRow(liveRow({
    cut_id: '953233', cut_plan_date: '1791961860', cut_start_date: '', cut_end_date: '',
    cut_duration: '132', cut_time: '308.00', cut_knife_setup_min: '0.00', cut_material_winding_min: '15.00',
    due_date: '14.10.2026'
}));
assertEqual(g.cutStatus(mgrPlanned, NOW, true), { key: 'planned', label: 'Запланировано в срок' },
    '#5145 менеджер: окно до 15:34 в день срока → «Запланировано в срок» (синее)');
// Запланировано с задержкой: конец планового окна за днём срока (срок вчера, план сегодня).
var mgrLate = cutFromRow(liveRow({ due_date: '13.10.2026', cut_start_date: '', cut_end_date: '' }));
assertEqual(g.cutStatus(mgrLate, NOW, true), { key: 'late', label: 'Запланировано с задержкой' },
    '#5145 менеджер: план сегодня при сроке вчера → «Запланировано с задержкой» (красное)');
// Срок не заполнен → «Запланировано в срок» (мерять не от чего, не красим).
assertEqual(g.cutStatus(Object.assign({}, mgrLate, { dueDate: '' }), NOW, true).key, 'planned',
    '#5145 менеджер: нет срока готовности → не красим');
// Начатое (running) и незавершённое для менеджера — по плану: та же развилка срок/окно.
assertEqual(g.cutStatus(Object.assign({}, mgrLate, { startDate: '2026-10-14 09:00' }), NOW, true).key, 'late',
    '#5145 менеджер: начатое при сроке вчера → тоже «Запланировано с задержкой»');

console.log('\n' + passed + '/' + total + ' passed');
if (passed !== total) process.exitCode = 1;
