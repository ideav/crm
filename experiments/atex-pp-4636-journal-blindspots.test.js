// issue #4636: У ЖУРНАЛА (#4618) БЫЛО ТРИ СЛЕПЫХ ПЯТНА.
//
// Боевое (ateh, 06.08.2026). Диспетчер: «4532, перетащил на день раньше, опять часть резок
// выкинул. Смотри таблицу Журнал — там что-то появилось». Журнал ДЕЙСТВИТЕЛЬНО записал сессию
// перетаскивания, и она была ЧИСТОЙ:
//
//   SESSION       операций: updates 7, creates 3, deletes 0
//   RUNS_CHANGE   663894  100 → 8   + CHAIN_CREATE продолжение на 92
//   CHAIN_BALANCE цепочек затронуто 7, баланс сошёлся у 7, сломан у 0
//
// А пять сломанных заказов (4532, 4616, 4618, 4619, 4620) в журнал не попали ВООБЩЕ. Разбирать
// пришлось по косвенным свидетелям — «Тайминг», доля обеспечения, примечание технолога.
//
// ТРИ ДЫРЫ, по одной на каждый путь записи мимо `applySplitPlan`:
//   1. ГЕНЕРАЦИЯ создаёт задания напрямую (`_m_new`) — четыре 🔒-задания с ОДНИМ проходом
//      (4616/4618/4619/4620) родились там, и появление их было не отследить;
//   2. РУЧНАЯ ПРАВКА проходов (`applyCutPasses`) пишет «Кол-во резок план» через `_m_set`;
//   3. ПЕРЕНОС ДНЯ внутри applySplitPlan не логировался поимённо: в сессии стояло «updates 7», а
//      какие записи переехали и куда — не сказано. Ровно то, о чём был тикет.
//
//   A — PLAN_MOVE: смена дня записывается «день ДД.ММ.ГГГГ → ДД.ММ.ГГГГ»;
//   B — PLAN_MOVE не шумит: старт не менялся → события нет;
//   C — сдвиг ВНУТРИ дня отличается от переезда в другой день;
//   D — RUNS_CHANGE и PLAN_MOVE независимы: у записи, где сменилось и то и другое, оба события;
//   E — CHAIN_BALANCE по-прежнему считает работу (регресс #4618);
//   F — врезки на месте: генерация, ручная правка, перенос — все три пути пишут в журнал.
//
// Run with: node experiments/atex-pp-4636-journal-blindspots.test.js

process.env.TZ = 'Europe/Moscow';
global.window = { db: 'ateh', xsrf: 'x' };
var fs = require('fs');
var P = require('../download/atex/js/production-planning.js').planning;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

// Стаб контроллера: журнал пишет через ctx.post — перехватываем и смотрим, ЧТО он записал.
function makeCtx() {
    // Имя ОБЯЗАТЕЛЬНО: журнал ищет таблицу и колонки ПО ИМЕНАМ (id в коде не зашиты).
    var meta = { id: '665850', val: 'Журнал', reqs: [
        { id: '665852', val: 'Сессия' }, { id: '665854', val: 'Действие' }, { id: '665856', val: 'Событие' },
        { id: '665858', val: 'Задание' }, { id: '665860', val: 'Заказ' }, { id: '665862', val: 'Станок' },
        { id: '665864', val: 'День' }, { id: '665866', val: 'Было' }, { id: '665868', val: 'Стало' },
        { id: '665870', val: 'Детали' }, { id: '665872', val: 'Пользователь' }
    ] };
    var rows = [];
    return {
        _metaAll: [meta], rows: rows, _ppOp: 'applySplitPlan', userName: 'claude',
        post: function(path, fields) {
            rows.push({ event: fields.t665856, cut: fields.t665858, day: fields.t665864,
                        before: fields.t665866, after: fields.t665868, details: fields.t665870 });
            return Promise.resolve({});
        }
    };
}
function C(id, runs, ts) { return { id: String(id), plannedRuns: runs, firstPartId: '', planStartTs: ts }; }
var D = function (y, m, d, hh) { return Math.floor(new Date(y, m - 1, d, hh || 8, 0, 0).getTime() / 1000); };

function run(snapshot, ops) {
    var ctx = makeCtx();
    return P.journalApplyDetails(ctx, snapshot, ops).then(function() { return ctx.rows; });
}
function ofEvent(rows, ev) { return rows.filter(function (r) { return r.event === ev; }); }

var chain = Promise.resolve();

// ── A. Переезд в другой день записывается поимённо (боевой случай #4636).
chain = chain.then(function () {
    return run([C(663847, 56, D(2026, 8, 7))],
               { updates: [{ cutId: '663847', planStartTs: D(2026, 8, 6), plannedRuns: 56 }], creates: [], deletes: [] })
        .then(function (rows) {
            var mv = ofEvent(rows, 'PLAN_MOVE');
            assert(mv.length === 1 && /день 07\.08\.2026 → 06\.08\.2026/.test(mv[0].details),
                'A: перенос на день раньше записан «день 07.08.2026 → 06.08.2026»',
                mv.length ? mv[0].details : JSON.stringify(rows));
            assert(mv.length === 1 && String(mv[0].cut) === '663847',
                'A2: событие названо номером задания');
        });
});

// ── B. Не шумим: старт не менялся — события нет.
chain = chain.then(function () {
    return run([C(1, 10, D(2026, 8, 7))],
               { updates: [{ cutId: '1', planStartTs: D(2026, 8, 7), plannedRuns: 10 }], creates: [], deletes: [] })
        .then(function (rows) {
            assert(ofEvent(rows, 'PLAN_MOVE').length === 0,
                'B: старт не изменился — PLAN_MOVE не пишется', JSON.stringify(rows.map(function(r){return r.event;})));
        });
});

// ── C. Сдвиг ВНУТРИ дня отличается от переезда: день тот же, время другое.
chain = chain.then(function () {
    return run([C(2, 10, D(2026, 8, 7, 8))],
               { updates: [{ cutId: '2', planStartTs: D(2026, 8, 7, 14), plannedRuns: 10 }], creates: [], deletes: [] })
        .then(function (rows) {
            var mv = ofEvent(rows, 'PLAN_MOVE');
            assert(mv.length === 1 && /в дне 07\.08\.2026/.test(mv[0].details),
                'C: сдвиг внутри дня назван сдвигом, а не переездом', mv.length ? mv[0].details : '—');
        });
});

// ── D. Сменились и день, и проходы — оба события, независимо.
chain = chain.then(function () {
    return run([C(3, 100, D(2026, 8, 10))],
               { updates: [{ cutId: '3', planStartTs: D(2026, 8, 11), plannedRuns: 8 }], creates: [], deletes: [] })
        .then(function (rows) {
            assert(ofEvent(rows, 'RUNS_CHANGE').length === 1 && ofEvent(rows, 'PLAN_MOVE').length === 1,
                'D: и RUNS_CHANGE, и PLAN_MOVE — события независимы',
                JSON.stringify(rows.map(function (r) { return r.event; })));
        });
});

// ── E. Регресс #4618: баланс работы по-прежнему считается и кричит при потере.
chain = chain.then(function () {
    return run([C(4, 20, D(2026, 8, 7))],
               { updates: [{ cutId: '4', planStartTs: D(2026, 8, 7), plannedRuns: 8 }], creates: [], deletes: [] })
        .then(function (rows) {
            var bal = ofEvent(rows, 'CHAIN_BALANCE');
            assert(bal.some(function (b) { return /РАБОТА НЕ СОХРАНЕНА/.test(b.details); }),
                'E: потеря 12 проходов по-прежнему видна в CHAIN_BALANCE',
                JSON.stringify(bal.map(function (b) { return b.details; })));
        });
});

// ── F. Все три пути записи журналируются (иначе слепое пятно вернётся).
chain = chain.then(function () {
    var src = fs.readFileSync(__dirname + '/../download/atex/js/production-planning/20-controller.js', 'utf8');
    assert(/#4636[\s\S]{0,600}event: 'CUT_CREATE'/.test(src),
        'F: ГЕНЕРАЦИЯ пишет CUT_CREATE (задания рождаются мимо applySplitPlan)');
    assert(/#4636[\s\S]{0,600}event: 'RUNS_MANUAL'/.test(src),
        'F2: РУЧНАЯ ПРАВКА проходов пишет RUNS_MANUAL (applyCutPasses пишет напрямую _m_set)');
    assert(/planStartTs: Number\(c\.planDate\)/.test(src),
        'F3: снимок несёт плановый старт — иначе перенос дня не с чем сравнить');
    var jr = fs.readFileSync(__dirname + '/../download/atex/js/production-planning/01-journal.js', 'utf8');
    assert(/event: 'PLAN_MOVE'/.test(jr), 'F4: ПЕРЕНОС ДНЯ пишется событием PLAN_MOVE');
});

chain.then(function () {
    console.log('\n' + passed + '/' + total + ' пройдено');
}).catch(function (e) {
    console.log('ERROR: ' + (e && e.stack ? e.stack : e));
    process.exitCode = 1;
});
