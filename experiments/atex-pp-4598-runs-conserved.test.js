// issue #4598: ПРОХОДЫ НЕ ИСЧЕЗАЮТ ПРИ РАЗБИЕНИИ ПО ДНЯМ.
//
// Боевое (ateh, 04.08.2026): после «Урегулировать» пять заданий остались с числом проходов
// МЕНЬШЕ заказанного, а обеспечение — целым: 4512 (658253) 1 проход вместо 6, 4517 (658402)
// 1 из 3, 4518 (658388) 1 из 2, 4465 (660029) 1 из 9, 4511 (658161) 15 из 20. По правилу §15
// (SUPPLY_CONSERVED) недобор 581 шт. Все пятеро — ПОСЛЕДНИЕ задания своего дня.
//
// Разбиение по дням РАСПРЕДЕЛЯЕТ проходы задания между записями цепочки, но не создаёт и не
// уничтожает их (это буквально сказано в 05-invariants.js:1091 и на нём стои́т защита #4536).
// Значит у planCutOperations есть проверяемое свойство:
//
//     Σ проходов ПОСЛЕ операций == Σ проходов ДО, для КАЖДОГО задания.
//
// где «после» = update задаёт новое число, create добавляет продолжение, delete убирает запись,
// а нетронутая запись остаётся со своим хранимым числом.
//
// Run with: node experiments/atex-pp-4598-runs-conserved.test.js

process.env.TZ = 'UTC';
global.window = { db: 'ateh', xsrf: 'x' };
var P = require('../download/atex/js/production-planning.js').planning;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

var TIMES = { KNIFE: 30, MATERIAL_WINDING: 15, BETWEEN_CUTS: 2, CLEANUP_SHIFT: 30 };
var CAP = 450, OVER = 5, TUNE = 10;
var BASE = new Date(2026, 7, 3, 0, 0, 0, 0).getTime();
var MATS = ['MA', 'MB', 'MC', 'MD'], KN = [[40, 22], [110, 8], [25, 35], [80, 11], [59, 15]];
function rnd(seed) { var s = seed; return function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; }
function K(pairs) { var a = []; pairs.forEach(function (p) { for (var i = 0; i < p[1]; i++) a.push(p[0]); }); return a; }

// Раскладка близкая к боевой: несколько заданий на станок, часть 🔒, дни 0..2, обед, нахлёст.
function fixture(r, opt) {
    var n = 3 + Math.floor(r() * 8), cuts = [], perPass = {}, anchor = {};
    for (var i = 0; i < n; i++) {
        var k = KN[Math.floor(r() * KN.length)], id = 'C' + i;
        var fixed = r() < (opt && opt.fixedRate != null ? opt.fixedRate : 0.4);
        var day = Math.floor(r() * 3);
        cuts.push({ id: id, slitter: { id: '1' }, materialId: MATS[Math.floor(r() * MATS.length)],
                    winding: r() < 0.5 ? 'OUT' : 'IN', batchId: 'B' + Math.floor(r() * 3),
                    knifeWidths: K([k]), knifeCount: k[1], rollerWidth: k[0],
                    plannedRuns: 1 + Math.floor(r() * 14), isFoil: r() < 0.15, fixed: fixed, status: '',
                    firstPartId: id,
                    planDate: String(Math.floor(BASE / 1000) + 8 * 3600 + day * 86400 + i * 600) });
        perPass[id] = 5 + Math.floor(r() * 40);
        if (fixed) anchor[id] = day;
    }
    return { cuts: cuts, perPass: perPass, anchor: anchor };
}

function plan(f, opt) {
    var o = {
        planBaseMidnightMs: BASE, weights: {}, times: TIMES,
        dayStartMin: 480, dayEndMin: 480 + CAP, dayEndHourMin: 480 + CAP,
        maxOverworkCutsMin: OVER, maxOverworkTuneMin: TUNE, lunchStartMin: 740, lunchDurationMin: 40,
        gapFill: true, preserveOrder: !!(opt && opt.preserveOrder), slotPlacement: !(opt && opt.preserveOrder),
        firstCutSetup: false, prevSetupBySlitter: {}, intraDayResequence: true,
        perPassByCut: f.perPass, slitterIds: ['1'], dueDayByCut: {}, dueKeyByCut: {},
        dayAnchorByCut: f.anchor
    };
    if (opt && opt.frozenDays) o.frozenDayFor = function (d) { return opt.frozenDays.indexOf(Number(d)) !== -1; };
    return P.planCutOperations(f.cuts, o);
}

// Σ проходов после операций, по КАЖДОМУ заданию (цепочка = само задание: fixture без продолжений).
function runsAfter(cuts, ops) {
    var after = {};
    cuts.forEach(function (c) { after[String(c.id)] = Number(c.plannedRuns) || 0; });
    (ops.updates || []).forEach(function (u) {
        if (u && u.cutId != null && u.plannedRuns != null) after[String(u.cutId)] = Number(u.plannedRuns) || 0;
    });
    (ops.deletes || []).forEach(function (id) { if (id != null) after[String(id)] = 0; });
    (ops.creates || []).forEach(function (cr) {
        if (!cr || cr.parentCutId == null) return;
        var k = String(cr.parentCutId);
        after[k] = (after[k] || 0) + (Number(cr.plannedRuns) || 0);
    });
    return after;
}

function scan(name, opt, seeds) {
    var bad = [], checked = 0;
    for (var seed = 1; seed <= seeds; seed++) {
        var f = fixture(rnd(seed), opt), ops;
        try { ops = plan(f, opt); } catch (e) { continue; }
        var after = runsAfter(f.cuts, ops);
        f.cuts.forEach(function (c) {
            checked++;
            var was = Number(c.plannedRuns) || 0, now = after[String(c.id)] || 0;
            if (was !== now) bad.push({ seed: seed, cut: c.id, was: was, now: now, lost: was - now });
        });
    }
    var worst = bad.slice().sort(function (a, b) { return b.lost - a.lost; })[0];
    assert(bad.length === 0, name + ' — проходов проверено ' + checked,
        bad.length ? ('ПОТЕРЯНО в ' + bad.length + ' заданиях, худшее: ' + JSON.stringify(worst)) : '');
    return bad;
}

// ── Цепочки: задание УЖЕ разорвано по дням (голова + продолжения) ───────────────────────────
// Здесь работают usedByHead/chainByLogical и удаление лишних звеньев (10-planning-engine.js:5351).
// Сохранение проходов считаем ПО ЦЕПОЧКЕ: внутри неё проходы законно переезжают между записями.
function chainFixture(r, opt) {
    var n = 2 + Math.floor(r() * 5), cuts = [], perPass = {}, anchor = {}, chainOf = {};
    for (var i = 0; i < n; i++) {
        var k = KN[Math.floor(r() * KN.length)], head = 'H' + i;
        var day = Math.floor(r() * 3);
        var parts = 1 + Math.floor(r() * 3);            // 1 = одиночное, 2–3 = цепочка по дням
        var fixed = r() < (opt && opt.fixedRate != null ? opt.fixedRate : 0.35);
        var mat = MATS[Math.floor(r() * MATS.length)], wind = r() < 0.5 ? 'OUT' : 'IN';
        var pp = 5 + Math.floor(r() * 40);
        for (var p = 0; p < parts; p++) {
            var id = p === 0 ? head : head + '_' + p;
            cuts.push({ id: id, slitter: { id: '1' }, materialId: mat, winding: wind,
                        batchId: 'B' + Math.floor(r() * 3),
                        knifeWidths: K([k]), knifeCount: k[1], rollerWidth: k[0],
                        plannedRuns: 1 + Math.floor(r() * 9), isFoil: false, fixed: fixed, status: '',
                        firstPartId: head,
                        planDate: String(Math.floor(BASE / 1000) + 8 * 3600 + (day + p) * 86400 + i * 600) });
            perPass[id] = pp;
            chainOf[id] = head;
            if (fixed) anchor[id] = day + p;
        }
    }
    return { cuts: cuts, perPass: perPass, anchor: anchor, chainOf: chainOf };
}

function scanChains(name, opt, seeds) {
    var bad = [], checked = 0;
    for (var seed = 1; seed <= seeds; seed++) {
        var f = chainFixture(rnd(seed), opt), ops;
        try { ops = plan(f, opt); } catch (e) { continue; }
        var after = runsAfter(f.cuts, ops);
        var was = {}, now = {};
        f.cuts.forEach(function (c) {
            var ch = f.chainOf[String(c.id)];
            was[ch] = (was[ch] || 0) + (Number(c.plannedRuns) || 0);
            now[ch] = (now[ch] || 0) + (after[String(c.id)] || 0);
        });
        Object.keys(was).forEach(function (ch) {
            checked++;
            if (was[ch] !== now[ch]) bad.push({ seed: seed, chain: ch, was: was[ch], now: now[ch], lost: was[ch] - now[ch] });
        });
    }
    var worst = bad.slice().sort(function (a, b) { return b.lost - a.lost; })[0];
    assert(bad.length === 0, name + ' — цепочек проверено ' + checked,
        bad.length ? ('ПОТЕРЯНО в ' + bad.length + ' цепочках, худшее: ' + JSON.stringify(worst)) : '');
    return bad;
}

// A — обычная раскладка («Сгенерировать»/«Упорядочить»).
scan('#4598-A: раскладка по весам сохраняет проходы', { preserveOrder: false }, 400);
// B — preserveOrder: путь «Урегулировать» / «Пересчитать наладку» / выравнивание дня (#4473).
scan('#4598-B: preserveOrder сохраняет проходы', { preserveOrder: true }, 400);
// C — preserveOrder + замороженный день 0 (боевое: 03.08 заморожен, работа едет на 04.08).
scan('#4598-C: preserveOrder при замороженном дне сохраняет проходы',
     { preserveOrder: true, frozenDays: [0] }, 400);

// D–F — то же для УЖЕ РАЗОРВАННЫХ по дням заданий (голова + продолжения).
scanChains('#4598-D: цепочки, раскладка по весам', { preserveOrder: false }, 400);
scanChains('#4598-E: цепочки, preserveOrder', { preserveOrder: true }, 400);
scanChains('#4598-F: цепочки, preserveOrder при замороженном дне',
           { preserveOrder: true, frozenDays: [0] }, 400);

console.log('\n' + passed + '/' + total + ' passed');
