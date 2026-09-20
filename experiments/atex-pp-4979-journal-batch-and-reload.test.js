// issue #4979: ОДНО ПЕРЕМЕЩЕНИЕ ЗАДАНИЯ — 142 ЗАПИСИ В БД И ЧЕТЫРЕ ПЕРЕЧИТЫВАНИЯ ОЧЕРЕДИ.
//
// Боевое (ateh1, 20.09.2026, лог в тикете). Диспетчер поменял местами два задания на Станке 1.
// Клиент отправил 142 команды `_m_*` и четыре раза перечитал очередь целиком. Разбор лога:
//
//   30 из 142 запросов — строки «Журнала» (#4618), таблица 665850. Пишутся ПО ОДНОЙ,
//      последовательно и намеренно вне пула записи (01-journal.js «чтобы не занимать пул»).
//      По меткам самих строк: 1789915706 → 1789915713, то есть СЕМЬ СЕКУНД на трассировку.
//   4 × reload() — каждый тянет loadCutStrips + loadPlanning (отчёт cut_planning, 1,06 МБ) +
//      loadSleeveBatches + loadShiftEvents + loadPackState + loadSleeveTasks = 24 запроса.
//      Втулки, упаковка, смены и партии записью плана НЕ меняются: в самом коде они помечены
//      как обновляемые «вместе с очередью» (#4596/#4774), то есть оппортунистически.
//
// Что закрывает этот тест:
//   A — строки журнала уходят ОДНИМ батчем (`object/{tid}?JSON&import=1`), а не по одной;
//   B — строка SESSION по-прежнему пишется СРАЗУ и отдельно: #4618 держит её как единственного
//       свидетеля, если действие умрёт на полпути, — батч уйдёт уже после работы;
//   C — `;` в «Деталях» экранируется, иначе поле разъезжается по колонкам (проверено на боевой:
//       «точка с запятой; внутри» легло в «Детали» + «Пользователь»);
//   D — батч отбит сервером → строки дописываются по одной; журнал не теряется (#4645);
//   E — промежуточные фазы перечитывают ТОЛЬКО план, не трогая соседние источники;
//   F — `reloadPlan({strips:false})` не тянет полосы там, где цепочки не менялись.
//
// Run with: node experiments/atex-pp-4979-journal-batch-and-reload.test.js

process.env.TZ = 'Europe/Moscow';
global.window = { db: 'ateh1', xsrf: 'x' };
var M = require('../download/atex/js/production-planning.js');
var P = M.planning;
var Controller = M.Controller;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

// Метаданные «Журнала» — как в базе ateh1 (id 665850). Имена обязательны: журнал ищет таблицу и
// колонки ПО ИМЕНАМ, id в коде не зашиты.
function journalMetaFixture() {
    return { id: '665850', val: 'Журнал', reqs: [
        { id: '665852', val: 'Сессия' }, { id: '665854', val: 'Действие' }, { id: '665856', val: 'Событие' },
        { id: '665858', val: 'Задание' }, { id: '665860', val: 'Заказ' }, { id: '665862', val: 'Станок' },
        { id: '665864', val: 'День' }, { id: '665866', val: 'Было' }, { id: '665868', val: 'Стало' },
        { id: '665870', val: 'Детали' }, { id: '665872', val: 'Пользователь' }
    ] };
}

// Стаб контроллера: считаем ОТДЕЛЬНО построчные `_m_new` и батчевые `import=1`.
function makeCtx(opts) {
    opts = opts || {};
    var ctx = {
        _metaAll: [journalMetaFixture()], _ppOp: 'applySplitPlan', userName: 'claude',
        singles: [], batches: [],
        post: function(path, fields) {
            ctx.singles.push({ path: path, fields: fields });
            return Promise.resolve({ obj: '1' });
        },
        postImport: function(tableId, text) {
            ctx.batches.push({ tableId: tableId, text: text });
            return opts.batchFails ? Promise.reject(new Error('отбито сервером')) : Promise.resolve({});
        },
        notify: function() {}
    };
    return ctx;
}
function dataLines(text) {
    return String(text).split(/\r?\n/).filter(function(s) { return s !== '' && s !== 'DATA'; });
}

var chain = Promise.resolve();
function step(fn) { chain = chain.then(fn); }

// ── A. Батч вместо тридцати запросов ────────────────────────────────────────────────────────
step(function() {
    var ctx = makeCtx();
    P.journalBegin(ctx, 'applySplitPlan');
    var rows = [];
    for (var i = 0; i < 30; i++) rows.push({ event: 'PLAN_MOVE', cut: 800000 + i, details: 'день 21.09.2026 → 22.09.2026' });
    return P.planJournalRows(ctx, rows).then(function() {
        assert(ctx.singles.length === 0, 'A1: до сброса очереди ни одного построчного `_m_new`', 'singles=' + ctx.singles.length);
        return P.journalFlush(ctx);
    }).then(function() {
        assert(ctx.batches.length === 1, 'A2: тридцать строк журнала уходят ОДНИМ батчем', 'батчей=' + ctx.batches.length);
        assert(ctx.singles.length === 0, 'A3: построчных `_m_new` не осталось', 'singles=' + ctx.singles.length);
        var lines = ctx.batches.length ? dataLines(ctx.batches[0].text) : [];
        assert(lines.length === 30, 'A4: в батче ровно тридцать строк данных', 'строк=' + lines.length);
        assert(ctx.batches.length && /^DATA\r?\n/.test(ctx.batches[0].text), 'A5: файл начинается строкой DATA');
        assert(lines.every(function(l) { return /;$/.test(l); }), 'A6: каждая строка данных закрыта завершающим «;»');
        assert(ctx.batches.length && String(ctx.batches[0].tableId) === '665850', 'A7: батч адресован таблице «Журнал»');
    });
});

// ── B. SESSION — свидетель намерения, пишется сразу (#4618) ─────────────────────────────────
step(function() {
    var ctx = makeCtx();
    P.journalBegin(ctx, 'applySplitPlan');
    return P.planJournal(ctx, { event: 'SESSION', details: 'операций: updates 19' }, { immediate: true })
        .then(function() {
            assert(ctx.singles.length === 1, 'B1: SESSION уходит СРАЗУ отдельным запросом, не в очередь',
                'singles=' + ctx.singles.length);
            assert(/_m_new\/665850/.test(ctx.singles[0].path), 'B2: и именно в «Журнал»', ctx.singles[0].path);
            assert(ctx.batches.length === 0, 'B3: батч на этот момент ещё не отправлен');
        });
});

// ── C. Экранирование «;» — иначе поле разъезжается по колонкам ──────────────────────────────
step(function() {
    var meta = journalMetaFixture();
    var text = P.journalBatchText(meta, [
        { t665850: '1789915706', t665856: 'RUNS_CHANGE', t665870: 'точка с запятой; внутри', t665872: 'claude' }
    ]);
    var line = dataLines(text)[0] || '';
    assert(line.indexOf('\\;') >= 0, 'C1: «;» внутри значения экранирован как «\\;»', line);
    // Колонок = главное значение + 11 реквизитов; завершающий «;» даёт нужный «лишний» разделитель.
    var cols = line.replace(/\\;/g, '\u0001').split(';');
    assert(cols.length === 13, 'C2: строка разбирается ровно на 12 значений + завершающий разделитель',
        'колонок=' + cols.length);
    assert(cols[10] === 'точка с запятой\u0001 внутри', 'C3: «Детали» остались одним полем', cols[10]);
    assert(cols[11] === 'claude', 'C4: «Пользователь» не съехал в соседнюю колонку', cols[11]);
});

// ── D. Батч отбит — журнал дописывается по одной, не теряется (#4645) ───────────────────────
step(function() {
    var ctx = makeCtx({ batchFails: true });
    P.journalBegin(ctx, 'applySplitPlan');
    return P.planJournalRows(ctx, [
        { event: 'PLAN_MOVE', cut: 1, details: 'а' },
        { event: 'PLAN_MOVE', cut: 2, details: 'б' },
        { event: 'CHAIN_DELETE', cut: 3, details: 'в' }
    ]).then(function() { return P.journalFlush(ctx); }).then(function() {
        assert(ctx.batches.length === 1, 'D1: батч был попробован', 'батчей=' + ctx.batches.length);
        assert(ctx.singles.length === 3, 'D2: после отказа все три строки дописаны по одной',
            'singles=' + ctx.singles.length);
    });
});

// ── G. Новое действие не съедает очередь предыдущего ────────────────────────────────────────
// splitPartiallyDoneCuts копит строки и делегирует работу applySplitPlan, который открывает
// СВОЮ сессию. Если journalBegin просто заводит пустую очередь, строки первого действия
// исчезают — молчащий журнал хуже отсутствующего (#4645).
step(function() {
    var ctx = makeCtx();
    P.journalBegin(ctx, 'splitPartiallyDoneCuts');
    return P.planJournalRows(ctx, [
        { event: 'SETTLE_SPLIT', cut: 11, details: 'было 5 → сделано 2, остаток 3' },
        { event: 'SETTLE_SPLIT', cut: 12, details: 'было 4 → сделано 4, остаток 0' }
    ]).then(function() {
        P.journalBegin(ctx, 'applySplitPlan');   // второе действие поверх первого
        assert(ctx.batches.length + ctx.singles.length > 0,
            'G1: строки первого действия отправлены, а не выброшены',
            'батчей=' + ctx.batches.length + ' singles=' + ctx.singles.length);
        var lines = ctx.batches.length ? dataLines(ctx.batches[0].text) : [];
        assert(lines.length === 2, 'G2: отправлены обе строки SETTLE_SPLIT', 'строк=' + lines.length);
        assert((ctx._journalQueue || []).length === 0, 'G3: новая очередь пуста и готова к своему действию');
    });
});

// ── E/F. Перечитывание: план отдельно от соседних источников ────────────────────────────────
function makeSelf() {
    var calls = [];
    // Прототип настоящий: reload() зовёт this.reloadPlan(), и подмена должна это видеть.
    var self = Object.create(Controller.prototype);
    self._pendingPlan = { anything: true };
    self.resolveCutMaterials = function() { calls.push('resolveCutMaterials'); };
    ['loadCutStrips', 'loadPlanning', 'loadSleeveBatches', 'loadShiftEvents', 'loadPackState', 'loadSleeveTasks']
        .forEach(function(name) {
            self[name] = function() { calls.push(name); return Promise.resolve(); };
        });
    self.calls = calls;
    return self;
}
var ENVIRONMENT = ['loadSleeveBatches', 'loadShiftEvents', 'loadPackState', 'loadSleeveTasks'];

// Шов — САМ reload(): именно его подменяют тесты соседних тикетов (atex-production-planning-4480
// и др.), поэтому промежуточные фазы обязаны ходить через него, а не мимо.
step(function() {
    var self = makeSelf();
    return Controller.prototype.reload.call(self, { environment: false }).then(function() {
        assert(self.calls.indexOf('loadPlanning') >= 0, 'E1: промежуточный reload перечитывает очередь');
        assert(self.calls.indexOf('loadCutStrips') >= 0, 'E2: и полосы — цепочки могли смениться');
        var env = ENVIRONMENT.filter(function(n) { return self.calls.indexOf(n) >= 0; });
        assert(env.length === 0, 'E3: соседние источники (втулки/упаковка/смены/партии) НЕ трогаются',
            'дёрнуто: ' + env.join(', '));
        assert(self._pendingPlan === null, 'E4: непринятый пересчёт сбрасывается, как в полном reload()');
    });
});

step(function() {
    var self = makeSelf();
    return Controller.prototype.reload.call(self, { environment: false, strips: false }).then(function() {
        assert(self.calls.indexOf('loadCutStrips') < 0, 'F1: strips:false — полосы не перечитываются',
            self.calls.join(', '));
        assert(self.calls.indexOf('loadPlanning') >= 0, 'F2: очередь всё равно перечитывается');
    });
});

step(function() {
    var self = makeSelf();
    return Controller.prototype.reload.call(self).then(function() {
        var missing = ENVIRONMENT.filter(function(n) { return self.calls.indexOf(n) < 0; });
        assert(missing.length === 0, 'F3: полный reload() по-прежнему обновляет соседние источники',
            'не дёрнуто: ' + missing.join(', '));
        assert(self.calls.indexOf('loadPlanning') >= 0, 'F4: и очередь');
    });
});

chain.then(function() {
    console.log('\n' + passed + ' / ' + total);
    if (passed !== total) process.exitCode = 1;
}).catch(function(err) {
    console.error('FAIL — тест упал исключением:', err && err.stack || err);
    process.exitCode = 1;
});
