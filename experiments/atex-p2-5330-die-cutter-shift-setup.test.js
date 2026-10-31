// ideav/crm#5330 (решения владельца по #5328, п.2 и п.3) — смена и факт наладки в пульте высечки.
//
// Что проверяется (ядро download/atex-p2/js/die-cutter.js и декларация схемы):
//   1. «Событие смены высечки» — самостоятельная таблица со ссылками «Задание высечки» и
//      «Станок высечки» (как «Событие смены» 1082 Фазы 1), не подчинённая заданию;
//   2. смена открыта, если последнее из событий «Начало смены»/«Конец смены» станка —
//      «Начало смены»; день и оператор не важны (смена принадлежит станку);
//   3. при закрытой смене пульт не даёт действий, которые пишут данные; задания видно;
//   4. наладка: начинается событием «Смена ножа»/«Смена вала»/«Наладка», заканчивается
//      «Наладка завершена» с минутами в событии; факт задания — сумма минут; незакрытая
//      наладка закрывается первым съёмом;
//   5. поля события: задание, станок, оператор, минуты наладки — по декларации.
//
// Run with: node experiments/atex-p2-5330-die-cutter-shift-setup.test.js

process.env.TZ = 'UTC';
var fs = require('fs');
var path = require('path');

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

var DC = require('../download/atex-p2/js/die-cutter.js').core;
var LP = require('../download/atex/js/label-production.js').core;

// ── 1. декларация: событие — самостоятельная таблица со ссылками ──────────────────────────
(function() {
    var schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'atex_phase2_schema.json'), 'utf8'));
    var top = {}, childOf = {};
    (function walk(list, parent) {
        (list || []).forEach(function(t) {
            if (parent) childOf[t.name] = parent; else top[t.name] = t;
            walk(t.children, t.name);
        });
    })(schema.tables, null);
    var ev = top['Событие смены высечки'];
    assert(!!ev && !childOf['Событие смены высечки'], '«Событие смены высечки» — таблица верхнего уровня, не подчинена заданию',
        childOf['Событие смены высечки'] ? '(подчинена «' + childOf['Событие смены высечки'] + '»)' : '');
    var refs = {};
    ((ev && ev.fields) || []).forEach(function(f) { refs[f.name] = f.ref || f.type || ''; });
    assert(refs['Задание высечки'] === 'Задание высечки', 'у события ссылка «Задание высечки»');
    assert(refs['Станок высечки'] === 'Станок высечки', 'у события ссылка «Станок высечки»');
    assert(refs['Длительность наладки, мин'] === 'NUMBER', 'у события число «Длительность наладки, мин»');
    var cfg = LP.PRODUCTION_CONFIGS[LP.PRODUCT_KIND.LABEL].tables;
    assert(same([cfg.dieEvent.reqs.job, cfg.dieEvent.reqs.machine, cfg.dieEvent.reqs.setupMinutes],
        ['Задание высечки', 'Станок высечки', 'Длительность наладки, мин']), 'конфигурация «этикетка»: поля события job/machine/setupMinutes');
    assert(!cfg.dieJob.reqs.events, 'у задания высечки нет табличной части событий');
    var seed = fs.readFileSync(path.join(__dirname, '..', 'docs', 'scripts', 'apply_label_schema_5301.py'), 'utf8');
    var line = (seed.match(/'Тип события высечки':[\s\S]*?\]/) || [''])[0];
    ['Начало смены', 'Конец смены', 'Наладка', 'Наладка завершена'].forEach(function(n) {
        assert(line.indexOf("'" + n + "'") >= 0, 'справочник «Тип события высечки» заводит «' + n + '»');
    });
})();

// ── 2. смена станка ─────────────────────────────────────────────────────────────────────
var T0 = Date.UTC(2026, 9, 31, 5, 0, 0) / 1000;   // 08:00 МСК
function ev(id, date, type, extra) {
    var e = { id: String(id), date: date, type: type, machineId: 'M1', jobId: '', operator: 'Иванов', notes: '', minutes: 0 };
    Object.keys(extra || {}).forEach(function(k) { e[k] = extra[k]; });
    return e;
}
(function() {
    assert(DC.shiftState([], 'M1').open === false, 'событий нет — смена закрыта');
    var s = DC.shiftState([ev(1, T0, 'Начало смены')], 'M1');
    assert(s.open === true && s.since === T0, 'последнее — «Начало смены»: открыта с его времени');
    assert(DC.shiftState([ev(1, T0, 'Начало смены'), ev(2, T0 + 3600, 'Конец смены')], 'M1').open === false, 'последнее — «Конец смены»: закрыта');
    assert(DC.shiftState([ev(2, T0 + 3600, 'Конец смены'), ev(1, T0, 'Начало смены')], 'M1').open === false, 'порядок — по времени, а не по списку');
    assert(DC.shiftState([ev(1, T0, 'Конец смены'), ev(2, T0, 'Начало смены')], 'M1').open === true, 'одно время — решает больший id');
    assert(DC.shiftState([ev(1, T0, 'Начало смены', { machineId: 'M2' })], 'M1').open === false, 'событие другого станка не открывает смену');
    assert(DC.shiftState([ev(1, T0 - 3 * 86400, 'Начало смены', { operator: 'Петров' }), ev(2, T0, 'Брак')], 'M1').open === true,
        'смена открыта три дня назад другим оператором — открыта (день и оператор не важны)');
    assert(DC.shiftState([ev(1, T0, ' начало смены ')], 'M1').open === true, 'тип сверяется без регистра и пробелов');
})();

// ── 3. действия при закрытой смене ─────────────────────────────────────────────────────────
(function() {
    var WRITE = ['pull', 'pulls', 'sync', 'die', 'cylinder', 'setup', 'setupDone', 'scrap', 'checklist', 'call', 'done'];
    var closed = DC.jobActions({ done: false, shiftOpen: false, setupOpen: false, stale: true });
    assert(WRITE.every(function(a) { return closed.indexOf(a) < 0; }), 'смена закрыта — ни одного пишущего действия', JSON.stringify(closed));
    assert(closed.indexOf('refresh') >= 0, 'смена закрыта — «Обновить» есть');
    var open = DC.jobActions({ done: false, shiftOpen: true, setupOpen: false, stale: false });
    ['pull', 'pulls', 'die', 'cylinder', 'setup', 'scrap', 'checklist', 'call', 'done'].forEach(function(a) {
        assert(open.indexOf(a) >= 0, 'смена открыта — есть «' + a + '»');
    });
    assert(open.indexOf('setupDone') < 0 && open.indexOf('sync') < 0, 'наладки нет и хвостов нет — «Наладка завершена»/«Дописать» не показаны');
    var tuning = DC.jobActions({ done: false, shiftOpen: true, setupOpen: true, stale: true });
    assert(tuning.indexOf('setupDone') >= 0 && tuning.indexOf('setup') < 0, 'идёт наладка — «Наладка завершена» вместо «Наладка»');
    assert(tuning.indexOf('sync') >= 0, 'хвосты есть — «Дописать»');
    var done = DC.jobActions({ done: true, shiftOpen: true, setupOpen: false, stale: false });
    assert(done.indexOf('pull') < 0 && done.indexOf('done') < 0 && done.indexOf('checklist') >= 0, 'задание выполнено — съёмов и «Готово» нет, чек-лист есть');
})();

// ── 4. наладка ──────────────────────────────────────────────────────────────────────────
(function() {
    var J = 'J1';
    function je(id, date, type, extra) { return ev(id, date, type, Object.assign({ jobId: J }, extra || {})); }
    assert(same(DC.setupState([], J), { open: false, since: 0, fact: 0 }), 'событий нет — наладки нет');
    var st = DC.setupState([je(1, T0, 'Смена вала')], J);
    assert(st.open === true && st.since === T0, 'смена вала начинает наладку');
    st = DC.setupState([je(1, T0, 'Смена вала'), je(2, T0 + 600, 'Смена ножа')], J);
    assert(st.open === true && st.since === T0, 'вторая смена оснастки во время наладки не сдвигает её начало');
    st = DC.setupState([je(1, T0, 'Наладка'), je(2, T0 + 1500, 'Наладка завершена', { minutes: 25 })], J);
    assert(st.open === false && st.fact === 25, '«Наладка завершена» закрывает; факт — минуты из события');
    st = DC.setupState([je(1, T0, 'Смена ножа'), je(2, T0 + 1200, 'Наладка завершена', { minutes: 20 }),
        je(3, T0 + 7200, 'Смена вала'), je(4, T0 + 8100, 'Наладка завершена', { minutes: 15 })], J);
    assert(st.open === false && st.fact === 35, 'две наладки за задание — факт суммой');
    st = DC.setupState([je(1, T0, 'Наладка'), je(2, T0 + 60, 'Брак'), ev(3, T0 + 120, 'Наладка завершена', { jobId: 'J2', minutes: 2 })], J);
    assert(st.open === true, 'события других заданий и не-наладочные события наладку не закрывают');
    assert(DC.setupMinutes(T0, T0 + 1530) === 26 && DC.setupMinutes(T0, T0 + 1529) === 25, 'минуты наладки — по серверному времени, целые (NUMBER)');
    assert(DC.setupMinutes(T0, T0 - 10) === 0, 'время назад — ноль, не минус');
    // незакрытая наладка закрывается первым съёмом
    var close = DC.setupCloseOnPull([je(1, T0, 'Смена вала')], J, T0 + 900);
    assert(!!close && close.minutes === 15 && /съём/.test(close.notes), 'съём при незакрытой наладке закрывает её (15 мин, примечание о съёме)');
    assert(DC.setupCloseOnPull([je(1, T0, 'Наладка'), je(2, T0 + 60, 'Наладка завершена', { minutes: 1 })], J, T0 + 900) === null,
        'наладка закрыта — съём ничего не дописывает');
})();

// ── 5. поля события ─────────────────────────────────────────────────────────────────────
(function() {
    var t = { id: '1000020', reqs: { type: '11', operator: '12', notes: '13', job: '14', machine: '15', setupMinutes: '16' } };
    var p = DC.eventParams(t, { now: T0, typeId: '7', userId: '462', notes: 'тест', jobId: 'J1', machineId: 'M1', minutes: 12 });
    assert(same(p, { t1000020: String(T0), t11: '7', t12: '462', t13: 'тест', t14: 'J1', t15: 'M1', t16: '12' }),
        'событие наладки: время, тип, оператор, примечание, задание, станок, минуты', JSON.stringify(p));
    var shift = DC.eventParams(t, { now: T0, typeId: '8', userId: '462', machineId: 'M1' });
    assert(!('t14' in shift) && shift.t15 === 'M1' && !('t16' in shift), 'событие смены: станок есть, задания и минут нет');
})();

console.log('\n' + passed + '/' + total + ' passed');
