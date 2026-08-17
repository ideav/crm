// Рамка действия — ОДИН объект на весь путь одного нажатия (issue #4770, #4772).
//
// ЗАЧЕМ. Одно нажатие оператора даёт два расчёта плана: запись действия и выравнивание дня следом.
// Контекст между ними передавался полем за полем, и каждое поле стоило тикета (#4574/#4582 manual и
// dayKeys, #4577 unfrozenDayKeys, #4555 fromCutId, #4736 manualShift, #4749 права мерки, #4765 сама
// мерка, #4768 цель действия). Тест держит новую механику:
//   1) таблица PP_ACTION_FRAME описывает ВСЕ поля рамки, встречающиеся в коде, и у каждого сказано,
//      едет оно в фазу 2 или остаётся, и почему;
//   2) перенос идёт ПО ТАБЛИЦЕ — и в опции выравнивания, и в scope раскладки (там же переименование
//      fromCutId → keepBeforeCutId);
//   3) рамка САМА называет свои дни: перенос 🗓, удаление и перестановка больше не зависят от того,
//      вспомнил ли обработчик поставить unfrozenDayKeys (#4770);
//   4) поле, которого нет в таблице, названо вслух (иначе оно молча не доедет);
//   5) ↑↓ и перетаскивание внутри дня получают ОДНУ рамку — точка сдвига считается и уезжает в
//      пересчёт, а замороженный день впереди останавливает оба действия (#4772);
//   6) мерка недобора строит scope тем же переносом, что и запись (#4749/#4765).
//
// Run with: node experiments/atex-pp-4770-action-frame.test.js

process.env.TZ = 'Europe/Moscow';
global.window = { db: 'testdb', xsrf: 'x' };

var fs = require('fs');
var path = require('path');
var mod = require('../download/atex/js/production-planning.js');
var planning = mod.planning;
var Controller = mod.Controller;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}
function assertEqual(got, want, name) {
    assert(JSON.stringify(got) === JSON.stringify(want), name, 'получено ' + JSON.stringify(got));
}

var FIELDS = planning.actionFrameFields();
var byName = {};
FIELDS.forEach(function(f) { byName[f.name] = f; });

// ── 1. Таблица покрывает все поля рамки, встречающиеся в коде ────────────────────────────────
(function() {
    var src = fs.readFileSync(path.join(__dirname, '..', 'download', 'atex', 'js',
        'production-planning', '20-controller.js'), 'utf8');
    var found = {};
    var re = /\b(?:moveScope|tailScope|settleScope|levelOpts)\.([A-Za-z_$][\w$]*)/g;
    var m;
    while ((m = re.exec(src))) found[m[1]] = true;
    var reAssign = /\bscope\.([A-Za-z_$][\w$]*)\s*=/g;
    while ((m = reAssign.exec(src))) found[m[1]] = true;
    // Права мерки выводятся из рамки (ppLevelingOptsFrom), полями рамки они не являются.
    delete found.manual; delete found.dayKeys;
    var undeclared = Object.keys(found).filter(function(n) { return !byName[n]; });
    assert(Object.keys(found).length >= 8, 'поля рамки найдены в исходнике',
        'найдено: ' + Object.keys(found).sort().join(' '));
    assert(undeclared.length === 0, 'каждое поле рамки объявлено в PP_ACTION_FRAME',
        undeclared.join(', '));

    var noWhy = FIELDS.filter(function(f) { return !f.why || String(f.why).length < 20; });
    assert(noWhy.length === 0, 'у каждого поля таблицы объявлена ПРИЧИНА',
        noWhy.map(function(f) { return f.name; }).join(', '));
    var carriedNoScope = FIELDS.filter(function(f) { return f.carry && !f.scope; });
    assert(carriedNoScope.length === 0, 'у каждого едущего поля названо имя в раскладке',
        carriedNoScope.map(function(f) { return f.name; }).join(', '));
})();

// ── 2. Перенос идёт по таблице ───────────────────────────────────────────────────────────────
(function() {
    var self = { cuts: [] };
    var frame = {
        manualShift: { fromBySlitter: { '1': 1000 } },
        pinCutIds: ['7'], pinDayPosByCut: { '7': 'end' },
        wholeDayCutIds: ['7'],            // #4693: в фазу 2 НЕ едет
        withinSlitterIds: ['1'], fromCutId: '9', trainOnly: true
    };
    var opts = planning.levelingOptsFrom(self, frame);
    FIELDS.forEach(function(f) {
        if (frame[f.name] === undefined) return;
        if (f.carry) assert(opts[f.name] !== undefined, 'в выравнивание едет ' + f.name);
        else assert(opts[f.name] === undefined, 'в выравнивании нет ' + f.name + ' (' + f.why.slice(0, 40) + '…)');
    });

    var scope = planning.levelingScopeFrom(opts, ['1', '2']);
    assertEqual(scope.withinSlitterIds, ['1', '2'], 'станки в scope берутся у вызывающего (#4732)');
    assert(scope.trainOnly === true, 'выравнивание всегда паровоз (trainOnly)');
    assert(scope.keepBeforeCutId === '9', 'fromCutId переименован в keepBeforeCutId (#4555)');
    assert(scope.fromCutId === undefined, 'старого имени в scope раскладки нет');
    assertEqual(scope.pinCutIds, ['7'], 'цель действия доезжает до раскладки (#4768)');
    assert(scope.wholeDayCutIds === undefined, 'резерв «целиком» до раскладки выравнивания не едет (#4693)');

    // Пустые значения поля не создают: иначе фаза 2 решит, что цель у действия есть.
    var empty = planning.levelingOptsFrom({ cuts: [] }, { pinCutIds: [], fromCutId: '', withinSlitterIds: [] });
    assert(empty === null, 'пустая рамка даёт null (автоматический путь мерит как прежде)',
        JSON.stringify(empty));
})();

// ── 3. Автоматика ручных прав не получает ────────────────────────────────────────────────────
(function() {
    var auto = planning.levelingOptsFrom({ cuts: [] }, { withinSlitterIds: ['1'] });
    assert(planning.actionFrameIsManual({ withinSlitterIds: ['1'] }) === false,
        '«Упорядочить · Станок» — рамка НЕ ручная');
    assert(auto && auto.manual === undefined, 'автоматика не получает manual',
        JSON.stringify(auto));
    assert(auto && auto.dayKeys === undefined, 'автоматика не получает dayKeys');
    assert(planning.actionFrameIsManual({ manualShift: { fromBySlitter: {} } }) === true,
        'право сдвига делает рамку ручной (#4736)');
    assert(planning.actionFrameIsManual({ pinCutIds: ['7'] }) === true,
        'названная цель делает рамку ручной (#4768)');
})();

// ── 4. Рамка сама называет свои дни (#4770) ──────────────────────────────────────────────────
(function() {
    // 17.08.2026 08:00 МСК и 18.08.2026 08:00 МСК
    var d17 = Math.floor(new Date(2026, 7, 17, 8, 0, 0).getTime() / 1000);
    var d18 = Math.floor(new Date(2026, 7, 18, 8, 0, 0).getTime() / 1000);
    var self = { cuts: [
        { id: '7', planDate: d18, slitter: { id: '1' } },
        { id: '8', planDate: d17, slitter: { id: '1' } }
    ] };

    // Перенос 🗓: задание уже лежит в выбранном дне (18.08), точка сдвига — исходный день (17.08).
    var moveDays = planning.actionFrameDayKeys(self, {
        pinCutIds: ['7'], manualShift: { fromBySlitter: { '1': d17 } }
    }).sort();
    assertEqual(moveDays, ['20260817', '20260818'],
        'перенос 🗓 называет и целевой день, и точку сдвига — без отдельного unfrozenDayKeys');

    // Удаление: записи уже нет, единственный след — точка сдвига.
    var delDays = planning.actionFrameDayKeys(self, { manualShift: { fromBySlitter: { '1': d17 } } });
    assertEqual(delDays, ['20260817'], 'удаление называет день точки сдвига');

    // Автоматика дней не называет — мерка остаётся прежней.
    assertEqual(planning.actionFrameDayKeys(self, { withinSlitterIds: ['1'] }), [],
        'автоматика дней не называет');

    // Явный список действия сохраняется (пересчёт наладки, #4582) и дополняется своим днём.
    var explicit = planning.actionFrameDayKeys(self, {
        unfrozenDayKeys: ['20260819'], manualShift: { fromBySlitter: { '1': d17 } }
    }).sort();
    assertEqual(explicit, ['20260817', '20260819'],
        'явные дни действия сохраняются и дополняются днём точки сдвига');

    var opts = planning.levelingOptsFrom(self, { pinCutIds: ['7'], manualShift: { fromBySlitter: { '1': d17 } } });
    assert(opts.manual === true, 'у ручного действия мерка получает ручные права (#4574)');
    assertEqual(opts.dayKeys.slice().sort(), ['20260817', '20260818'],
        'мерка видит дни действия даже за окном фильтра (#4582)');
    assertEqual(opts.unfrozenDayKeys.slice().sort(), ['20260817', '20260818'],
        'те же дни разморожены для записи (#4577)');
})();

// ── 5. Необъявленное поле названо вслух ──────────────────────────────────────────────────────
(function() {
    assertEqual(planning.actionFrameUndeclared({ pinCutIds: ['7'], manual: true, dayKeys: [] }), [],
        'объявленные поля и права мерки нарушением не считаются');
    assertEqual(planning.actionFrameUndeclared({ newRightFrom4999: true }), ['newRightFrom4999'],
        'поле вне таблицы опознаётся');

    var said = [];
    var origErr = console.error;
    console.error = function() { said.push(Array.prototype.slice.call(arguments).join(' ')); };
    var opts;
    try {
        opts = planning.levelingOptsFrom({ cuts: [] }, { pinCutIds: ['7'], newRightFrom4999: true });
    } finally { console.error = origErr; }
    assert(said.some(function(s) { return s.indexOf('#4770') >= 0 && s.indexOf('newRightFrom4999') >= 0; }),
        'о необъявленном поле сказано в консоль с его именем', said.join(' | '));
    assert(opts && opts.newRightFrom4999 === undefined, 'необъявленное поле в фазу 2 не едет');
})();

// ── 6. ↑↓ и перетаскивание внутри дня — одна рамка (#4772) ───────────────────────────────────
function swapStub(extra) {
    var self = {
        busy: false, meta: { cut: { id: '1078' } },
        cuts: [], writes: [], notes: [], recalc: [],
        setBusy: function() {}, render: function() {}, _manualMoveDirty: {},
        notify: function(m, k) { self.notes.push({ m: m, k: k }); },
        post: function(url, fields) { self.writes.push({ url: url, fields: fields }); return Promise.resolve({}); },
        reload: function() { return Promise.resolve(); },
        recalcSetupTiming: function(sid, opts) { self.recalc.push({ sid: sid, opts: opts }); return Promise.resolve(true); }
    };
    Object.keys(extra || {}).forEach(function(k) { self[k] = extra[k]; });
    return self;
}

(function() {
    var d17 = Math.floor(new Date(2026, 7, 17, 8, 0, 0).getTime() / 1000);
    var a = { id: 'A', slitter: { id: '101' }, planDate: String(d17), startDate: '' };
    var b = { id: 'B', slitter: { id: '101' }, planDate: String(d17 + 3600), startDate: '' };

    var up = swapStub({ cuts: [a, b] });
    var drag = swapStub({ cuts: [a, b] });
    return Controller.prototype.moveCutInDay.call(up, [a, b], 0, 1).then(function() {
        return Controller.prototype.reorderCutInDay.call(drag, [a, b], 'B', 'A');
    }).then(function() {
        assert(up.recalc.length === 1 && drag.recalc.length === 1,
            'обе перестановки зовут пересчёт наладки');
        var upShift = up.recalc[0].opts && up.recalc[0].opts.manualShift;
        var dragShift = drag.recalc[0].opts && drag.recalc[0].opts.manualShift;
        assert(!!upShift, '↑↓ несёт точку сдвига в пересчёт (#4772)',
            JSON.stringify(up.recalc[0].opts));
        assertEqual(upShift, dragShift, '↑↓ и перетаскивание дают ОДНУ точку сдвига');
        assert(up.recalc[0].opts.auto === true && drag.recalc[0].opts.auto === true,
            'оба пересчёта автоматические (кнопки оператор не жмёт)');
    });
})();

// ── 7. Замороженный день впереди останавливает и ↑↓ (#4772/#4736) ────────────────────────────
(function() {
    var d17 = Math.floor(new Date(2026, 7, 17, 8, 0, 0).getTime() / 1000);
    var d18 = Math.floor(new Date(2026, 7, 18, 8, 0, 0).getTime() / 1000);
    var a = { id: 'A', slitter: { id: '101' }, planDate: String(d17), startDate: '' };
    var b = { id: 'B', slitter: { id: '101' }, planDate: String(d17 + 3600), startDate: '' };
    var ahead = { id: 'C', slitter: { id: '101' }, planDate: String(d18), startDate: '' };
    var frozen = swapStub({
        cuts: [a, b, ahead],
        meta: { cut: { id: '1078' }, freeze: { id: '999' } },
        freezeByDay: { '20260818': true },
        dayIsFrozen: function(ts) {
            var n = Number(ts); if (!isFinite(n) || n <= 0) return false;
            var dt = new Date(n * 1000);
            return dt.getDate() === 18 && dt.getMonth() === 7;
        }
    });
    return Controller.prototype.moveCutInDay.call(frozen, [a, b], 0, 1).then(function(res) {
        assert(res === false, '↑↓ с замороженным днём впереди не выполняется');
        assert(frozen.writes.length === 0, 'до записи дело не доходит (отказ ДО первой команды)');
        assert(frozen.recalc.length === 0, 'пересчёт не запускается');
        assert(frozen.notes.some(function(n) { return /заморож/i.test(n.m) && /18\.08/.test(n.m); }),
            'оператору названы замороженные дни', JSON.stringify(frozen.notes));
    });
})();

// ── 8. Мерка недобора строит scope тем же переносом, что и запись (#4749/#4765) ───────────────
(function() {
    var seen = null;
    var self = {
        slitters: [{ id: '1' }, { id: '2' }],
        cuts: [], filter: { date: '2026-08-17' },
        workingWindow: function() { return { startMin: 480, cutEndMin: 975, lunchStartMin: 740, lunchDurationMin: 30 }; },
        buildSequenceOps: function(cuts, strategy, preserveOrder, scope) {
            seen = { preserveOrder: preserveOrder, scope: scope };
            return { ops: { dayFill: [] } };
        }
    };
    var frame = {
        manualShift: { fromBySlitter: { '1': 1000 } },
        pinCutIds: ['7'], weightPositionCutIds: [], unfrozenDayKeys: ['20260817'],
        withinSlitterIds: ['1'], manual: true, dayKeys: ['20260817']
    };
    Controller.prototype.plannerUnderfilledDays.call(self, frame);
    assert(seen !== null, 'мерка строит собственную раскладку');
    assert(seen.preserveOrder === true, 'мерка меряет ПАРОВОЗОМ, как и запись (#4732)');
    assertEqual(seen.scope.manualShift, frame.manualShift, 'права действия доехали до мерки (#4749)');
    assertEqual(seen.scope.pinCutIds, ['7'], 'цель действия доехала до мерки (#4768/#4770)');
    assertEqual(seen.scope.unfrozenDayKeys, ['20260817'], 'дни действия доехали до мерки (#4577)');
    assertEqual(seen.scope.withinSlitterIds, ['1', '2'],
        'замок станков у мерки СВОЙ — все станки сразу (#4749)');
    assert(seen.scope.trainOnly === true, 'мерка судит тот же паровоз');
})();

process.on('exit', function() {
    console.log('\n' + passed + '/' + total + ' проверок пройдено');
});
