// Regression test for ideav/crm#4017 — «Так и нет захлёста» (продолжение #4006 п.2).
//
// Корень: loadDaySettings читает «Настройку» по БЕЛОМУ СПИСКУ ключей. #3992 переименовал
// лимиты захлёста в MAX_OVERWORK_CUTS_MN / MAX_OVERWORK_TUNE_MN (суффикс _MN — задокументирован
// как основной в docs/atex_planning_tz.md §5.1) и научил resolveOverworkLimits читать _MN
// (с откатом на старые имена). Но БЕЛЫЙ СПИСОК в loadDaySettings обновить забыли — он пропускал
// только старые MAX_OVERWORK_CUTS / MAX_OVERWORK_TUNE. Оператор задаёт настройку по докам
// (MAX_OVERWORK_CUTS_MN=5) → loadDaySettings её ОТБРАСЫВАЕТ до попадания в daySettings →
// resolveOverworkLimits видит пусто → захлёст ВЫКЛ → упаковщик копит день строго до cutEndMin
// и лишний проход всегда уезжает назавтра, СКОЛЬКО НИ РЕГЕНЕРИРУЙ (не «старый план», а баг чтения).
//
// #3992-тест проверял resolveWorkingWindow/resolveOverworkLimits на cfg, где _MN УЖЕ лежит —
// то есть мимо loadDaySettings, где и терялся ключ. Этот тест гоняет ИМЕННО loadDaySettings.
//
// Run with: node experiments/atex-production-planning-4017.test.js

process.env.TZ = 'UTC';
global.window = global.window || { db: 'ateh' };
var mod = require('../download/atex/js/production-planning.js');
var planning = mod.planning;
var Controller = mod.Controller;

var passed = 0, failed = 0;
function assert(cond, name) {
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) { passed++; } else { failed++; process.exitCode = 1; }
}
function eq(a, b, name) { assert(a === b, name + ' (' + JSON.stringify(a) + ' === ' + JSON.stringify(b) + ')'); }

// «Настройка» как строки object/<id> (r[0]=ключ, r[1]=тип-БД, r[2]=значение).
function row(key, val, type) { return { r: [key, type || '', String(val)] }; }
function fakeCtrl(rows) {
    return {
        db: 'ateh',
        meta: { settings: { id: '269' } },
        getJson: function() { return Promise.resolve(rows); }
    };
}

// ---------------------------------------------------------------------------
// Часть 1 — loadDaySettings пропускает НОВЫЕ ключи _MN (до фикса отбрасывал → захлёст выкл).
console.log('\n== #4017: loadDaySettings читает MAX_OVERWORK_*_MN ==');
var ctlNew = fakeCtrl([
    row('DAY_START_HOUR', '08:00'),
    row('DAY_END_HOUR', '16:30'),
    row('TOTAL_INTERVALS', '20'),
    row('MAX_OVERWORK_CUTS_MN', '5'),
    row('MAX_OVERWORK_TUNE_MN', '10')
]);

// Часть 2 — старые имена по-прежнему грузятся (обратная совместимость).
var ctlOld = fakeCtrl([
    row('DAY_START_HOUR', '08:00'),
    row('DAY_END_HOUR', '16:30'),
    row('MAX_OVERWORK_CUTS', '7'),
    row('MAX_OVERWORK_TUNE', '12')
]);

// Часть 3 — настройка не задана: захлёст выкл (контроль для сравнения эффекта).
var ctlNone = fakeCtrl([
    row('DAY_START_HOUR', '08:00'),
    row('DAY_END_HOUR', '16:30'),
    row('TOTAL_INTERVALS', '20')
]);

// Часть 5 — низкий лимит захлёста НАСТРОЙКИ (для контраста поведения setup-хвоста).
var ctlTuneLow = fakeCtrl([
    row('DAY_START_HOUR', '08:00'),
    row('DAY_END_HOUR', '16:30'),
    row('MAX_OVERWORK_CUTS_MN', '5'),
    row('MAX_OVERWORK_TUNE_MN', '5')
]);

Promise.all([
    Controller.prototype.loadDaySettings.call(ctlNew),
    Controller.prototype.loadDaySettings.call(ctlOld),
    Controller.prototype.loadDaySettings.call(ctlNone),
    Controller.prototype.loadDaySettings.call(ctlTuneLow)
]).then(function() {
    // Ключ _MN дошёл до daySettings (до фикса — undefined, отброшен белым списком).
    eq(ctlNew.daySettings.MAX_OVERWORK_CUTS_MN, '5', 'MAX_OVERWORK_CUTS_MN попал в daySettings');
    eq(ctlNew.daySettings.MAX_OVERWORK_TUNE_MN, '10', 'MAX_OVERWORK_TUNE_MN попал в daySettings');

    var wNew = planning.resolveWorkingWindow(ctlNew.daySettings);
    eq(wNew.maxOverworkCutsMin, 5, 'окно: захлёст резки = 5 (из _MN через loadDaySettings)');
    eq(wNew.maxOverworkTuneMin, 10, 'окно: захлёст настройки = 10 (из _MN через loadDaySettings)');

    var wOld = planning.resolveWorkingWindow(ctlOld.daySettings);
    eq(wOld.maxOverworkCutsMin, 7, 'обратная совместимость: старый MAX_OVERWORK_CUTS=7 грузится');
    eq(wOld.maxOverworkTuneMin, 12, 'обратная совместимость: старый MAX_OVERWORK_TUNE=12 грузится');

    var wNone = planning.resolveWorkingWindow(ctlNone.daySettings);
    eq(wNone.maxOverworkCutsMin, null, 'настройка не задана → захлёст выкл (null)');

    // -----------------------------------------------------------------------
    // Часть 4 — сквозной эффект захлёста (сценарий #4017): последняя резка дня,
    // окно резки 40 мин, проход 3.25 мин (намотка+лидер). БЕЗ захлёста влезает
    // floor(40/3.25)=12 проходов (день кончается на проход раньше, остаток → завтра);
    // С захлёстом MAX_OVERWORK_CUTS_MN=5 → окно+нахлёст 45 мин → floor(45/3.25)=13.
    console.log('\n== #4017: захлёст добирает 13-й проход в тот же день ==');
    function runsOnDay0(win) {
        var segs = planning.splitMachineQueue([{ id: 'c1', plannedRuns: 20 }], {
            dayStartMin: 0, dayEndMin: 40, dayEndHourMin: 50,
            maxOverworkCutsMin: win.maxOverworkCutsMin, maxOverworkTuneMin: win.maxOverworkTuneMin,
            leader: 0, perPassByCut: { c1: 3.25 }, runsByCut: { c1: 20 }
        });
        return segs.filter(function(s) { return s.dayOffset === 0; })
                   .reduce(function(a, s) { return a + (Number(s.runs) || 0); }, 0);
    }
    // Окна с той же геометрией (cutEnd−start=40), лимит захлёста из loadDaySettings.
    var winOn = { maxOverworkCutsMin: wNew.maxOverworkCutsMin, maxOverworkTuneMin: wNew.maxOverworkTuneMin };  // 5/10
    var winOff = { maxOverworkCutsMin: wNone.maxOverworkCutsMin, maxOverworkTuneMin: wNone.maxOverworkTuneMin }; // null
    eq(runsOnDay0(winOff), 12, 'захлёст выкл → 12 проходов на дне (13-й уезжает назавтра)');
    eq(runsOnDay0(winOn), 13, 'захлёст 5 мин → 13 проходов на дне (лишний проход добран, #4017)');

    // -----------------------------------------------------------------------
    // Часть 5 — MAX_OVERWORK_TUNE_MN тоже работает: потолок нахлёста НАСТРОЙКИ (availFor 'tune').
    // Резка A забивает день впритык (клок=40=cutEnd). У резки B — смена сырья (setup 8 мин),
    // ни один проход в остаток не влезает. setup-хвост кладётся в день A, ТОЛЬКО если он кончается
    // ≤ cutEndMin + MAX_OVERWORK_TUNE_MN. TUNE=10 → потолок 50, хвост 8 влезает (сегмент setupOnly
    // на дне 0). TUNE=5 → потолок 45, остаток окна 0, хвост 8 > нахлёста 5 → НЕ кладём (вся B назавтра).
    console.log('\n== #4017: MAX_OVERWORK_TUNE_MN управляет нахлёстом настройки в хвост дня ==');
    var setupTailTimes = { KNIFE: 30, MATERIAL_WINDING: 8, BETWEEN_CUTS: 0 };
    var cutA = { id: 'A', materialId: 'M1', winding: 'OUT', batchId: '1' };  // забивает день
    var cutB = { id: 'B', materialId: 'M2', winding: 'OUT', batchId: '1' };  // смена сырья → setup 8
    function hasSetupTailOnDay0(win) {
        var segs = planning.splitMachineQueue([cutA, cutB], {
            dayStartMin: 0, dayEndMin: 40, dayEndHourMin: 50,
            maxOverworkCutsMin: win.maxOverworkCutsMin, maxOverworkTuneMin: win.maxOverworkTuneMin,
            leader: 0, times: setupTailTimes,
            perPassByCut: { A: 10, B: 10 }, runsByCut: { A: 4, B: 10 }
        });
        return segs.some(function(s) {
            return s.dayOffset === 0 && Number(s.runs) === 0 && Number(s.setupMin) > 0;
        });
    }
    var wTuneHi = planning.resolveWorkingWindow(ctlNew.daySettings);      // CUTS_MN=5, TUNE_MN=10
    var wTuneLo = planning.resolveWorkingWindow(ctlTuneLow.daySettings);  // CUTS_MN=5, TUNE_MN=5
    eq(wTuneHi.maxOverworkTuneMin, 10, 'окно: TUNE_MN=10 из loadDaySettings');
    eq(wTuneLo.maxOverworkTuneMin, 5, 'окно: TUNE_MN=5 из loadDaySettings');
    assert(hasSetupTailOnDay0(wTuneHi) === true, 'TUNE_MN=10 → настройка (8 мин) кладётся в хвост дня (нахлёст ≤ 10)');
    assert(hasSetupTailOnDay0(wTuneLo) === false, 'TUNE_MN=5 → настройка (8 мин) НЕ влезает в нахлёст 5 → вся резка назавтра');

    console.log('\n' + passed + ' passed, ' + failed + ' failed');
    if (failed) process.exitCode = 1;
}).catch(function(err) {
    console.error('FAIL — исключение:', err && err.stack || err);
    process.exitCode = 1;
});
