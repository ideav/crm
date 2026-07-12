// Tests for ideav/crm#4188 — «Разобраться, где именно пусты колонки наладки #3698 и почему — вывести ID в трейс».
//
// Симптом (лог из #4188): после «Сгенерировать» панель «Качество плана» кричит
//   «колонки наладки #3698 («Наладка ножей, мин» / «Сырье/намотка, мин») пусты …».
// Причина (по логу): ошибка ТРАНЗИТНАЯ. runGenerateCuts делает reload()+render() СРАЗУ после
// создания записей, но ДО autoSequenceQueue — а колонки наладки пишет именно последующий
// autoSequenceQueue → applySplitPlan → persistCutSetupColumns. Свежесозданные задания ещё без
// колонок → hasStored=false → плашка. Финальный рендер (после пересборки) ошибки уже не даёт.
//
// storedSetupTotals раньше отдавал только агрегат hasStored — трасса не могла назвать, КАКИЕ ИМЕННО
// задания пусты. Фикс #4188: storedSetupTotals дополнительно отдаёт emptyWindow/emptyAll — перечень
// { id, dayKey, slitter, plannedRuns } пустых заданий; renderQueue выводит их ID + контекст операции
// (self._ppOp) в консоль. formatEmptySetupIds — компактная строка перечня для трассы.
//
// Run with: node experiments/atex-production-planning-4188.test.js

process.env.TZ = 'UTC';
var api = require('../download/atex/js/production-planning.js');
var planning = api.planning;
var Controller = api.Controller;

var passed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) passed++;
    else { console.log('  expected:', JSON.stringify(expected)); console.log('  actual:  ', JSON.stringify(actual)); process.exitCode = 1; }
}
function assert(cond, name) { assertEqual(!!cond, true, name); }

var d1 = String(Math.floor(Date.UTC(2026, 6, 1) / 1000));   // 2026-07-01 → 20260701
var d2 = String(Math.floor(Date.UTC(2026, 6, 2) / 1000));   // 2026-07-02
var d3 = String(Math.floor(Date.UTC(2026, 6, 3) / 1000));   // 2026-07-03
function dk(s) { return planning.planDateDayKey(s); }
function cut(id, planDate, k, m, extra) {
    var c = { id: id, planDate: planDate,
              storedKnifeSetupMin: (k == null ? '' : String(k)),
              storedMaterialWindingMin: (m == null ? '' : String(m)) };
    if (extra) for (var key in extra) c[key] = extra[key];
    return c;
}

// ── 1) Все задания без колонок наладки → emptyAll = ВСЕ (как транзитный рендер runGenerateCuts) ──
(function () {
    var ctrl = Object.create(Controller.prototype);
    ctrl.cuts = [
        cut('a', d1, '', '', { slitter: { id: '1' }, plannedRuns: 4 }),
        cut('b', d1, null, null, { slitter: { id: '2' }, plannedRuns: 0 }),   // 0 проходов = setup-only хвост
        cut('c', d2, '', null, { slitter: { id: '1' }, plannedRuns: 3 })
    ];
    var res = ctrl.storedSetupTotals(null, null);
    assert(res.hasStored === false, '#4188 свежие задания без колонок → hasStored=false (плашка)');
    assertEqual(res.emptyAll.map(function (e) { return e.id; }), ['a', 'b', 'c'],
        '#4188 emptyAll перечисляет ВСЕ пустые задания (это «где именно пусто»)');
    assertEqual(res.emptyAll[0], { id: 'a', dayKey: dk(d1), slitter: '1', plannedRuns: 4 },
        '#4188 элемент пустого = { id, dayKey, slitter, plannedRuns } — станок/день/сегмент для трассы');
    assertEqual(res.emptyAll[1].plannedRuns, 0, '#4188 setup-only хвост (0 проходов) виден в перечне пустых');
})();

// ── 2) Окно [С;По] сужает перечень пустых (emptyWindow), emptyAll — весь горизонт ──
(function () {
    var ctrl = Object.create(Controller.prototype);
    ctrl.cuts = [
        cut('a', d1, null, null, { slitter: { id: '1' }, plannedRuns: 1 }),
        cut('b', d2, null, null, { slitter: { id: '1' }, plannedRuns: 1 }),
        cut('c', d3, null, null, { slitter: { id: '1' }, plannedRuns: 1 })
    ];
    var res = ctrl.storedSetupTotals(dk(d1), dk(d2));   // окно [01.07; 02.07]
    assertEqual(res.emptyWindow.map(function (e) { return e.id; }), ['a', 'b'],
        '#4188 emptyWindow — только пустые в окне [С;По]');
    assertEqual(res.emptyAll.map(function (e) { return e.id; }), ['a', 'b', 'c'],
        '#4188 emptyAll — все пустые за горизонт');
})();

// ── 3) ЧАСТИЧНО пусто: часть заданий с колонками, часть без → hasStored=true, но emptyWindow не пуст ──
// (панель молча занижает суммы наладки на пустых — трасса #4188 их называет).
(function () {
    var ctrl = Object.create(Controller.prototype);
    ctrl.cuts = [
        cut('filled', d1, 30, 0, { slitter: { id: '1' }, plannedRuns: 5 }),   // с колонками
        cut('empty', d1, null, null, { slitter: { id: '2' }, plannedRuns: 4 }) // без колонок
    ];
    var res = ctrl.storedSetupTotals(null, null);
    assert(res.hasStored === true, '#4188 частично пусто → hasStored=true (плашки нет), но пустые есть');
    assertEqual(res.emptyWindow.map(function (e) { return e.id; }), ['empty'],
        '#4188 частичный случай: emptyWindow называет НЕзаписанные задания (суммы наладки занижены)');
    assertEqual(res.window.taskCount, 2, '#4188 taskCount по-прежнему считает все задания окна');
})();

// ── 4) Хранимый «0» ≠ пусто: заполненный ноль (план без наладки) НЕ попадает в перечень пустых ──
(function () {
    var ctrl = Object.create(Controller.prototype);
    ctrl.cuts = [
        cut('zero', d1, 0, 0, { slitter: { id: '1' }, plannedRuns: 2 }),      // ЗАПОЛНЕНО нулём
        cut('blank', d1, null, null, { slitter: { id: '1' }, plannedRuns: 2 }) // ПУСТО (не записано)
    ];
    var res = ctrl.storedSetupTotals(null, null);
    assert(res.hasStored === true, '#4188 хранимый «0» = заполнено → hasStored=true');
    assertEqual(res.emptyWindow.map(function (e) { return e.id; }), ['blank'],
        '#4188 «0» НЕ пусто (это план без наладки); пусто = только незаписанные колонки');
})();

// ── 5) formatEmptySetupIds — компактная строка перечня для трассы ──
(function () {
    var list = [
        { id: '507315', dayKey: 20260701, slitter: '1', plannedRuns: 4 },
        { id: '507316', dayKey: 20260701, slitter: '2', plannedRuns: 0 },   // setup-only хвост
        { id: '507317', dayKey: 20260702, slitter: '', plannedRuns: 3 }     // станок неизвестен
    ];
    assertEqual(planning.formatEmptySetupIds(list),
        '507315@20260701/ст.1, 507316@20260701/ст.2/0прох, 507317@20260702',
        '#4188 формат: id@день/ст.N/0прох; 0 проходов и пустой станок отражены');
    // cap ограничивает явный список и добавляет «…ещё K».
    assertEqual(planning.formatEmptySetupIds(list, 2),
        '507315@20260701/ст.1, 507316@20260701/ст.2/0прох, …ещё 1',
        '#4188 при cap печатаются первые K, остаток свёрнут «…ещё N»');
    assertEqual(planning.formatEmptySetupIds([]), '', '#4188 пустой список → пустая строка');
})();

console.log('\n' + passed + ' assertions passed.');
