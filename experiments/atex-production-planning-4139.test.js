// Тесты ideav/crm#4139 — внутридневная пересортировка очереди станка.
//
// Симптом (выгрузка плана 01–08.07): на Станке 1 одна и та же конфигурация попадает в день
// ДВАЖДЫ, разорванная чужим сырьём — 02.07 «MW308/8 → MWR113L/8 → MW308/8», 07.07 «MW308/15 →
// MR194/15 → MW308/15». Переналадка станка 690 мин при достижимых 600.
//
// Причина: слой размещения (#4085) вставляет резки по одной по минимуму штрафа вставки и
// СОБРАННЫЙ ДЕНЬ БОЛЬШЕ НЕ ЧИНИТ. Жадная вставка оставляет «осиротевшие» резки вдали от их группы.
//
// Фикс #4139: после реальной упаковки (день каждой резки уже назначен) очередь станка
// пересортировывается ВНУТРИ дней. День и состав дня не меняются → штрафы срока (§8 п.4/5) те же.
// Цель — sequencingCost (#3996), а НЕ голые минуты: минимум минут разгоняет РОСТ числа полос
// вопреки #3130. Оптимум сквозной (DP по цепочке дней): подневная жадность даёт суммарно худшую
// очередь, потому что перестановка дня меняет вход в следующий день.
// Инварианты: фольга последняя в дне (#3717); резка, переползающая на следующий день (день-сплит,
// #3635 п.5), остаётся последней; ни одна резка не уезжает на более поздний день.
//
// Run with: node experiments/atex-production-planning-4139.test.js

process.env.TZ = 'UTC';
var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}

var BASE = Date.UTC(2026, 6, 1);
function kw(n, w) { var a = []; for (var i = 0; i < n; i++) a.push(w + i * 0.5); return a; }
function cut(id, mat, knives, o) {
    o = o || {};
    return { id: id, slitter: { id: o.m || 'm1' }, materialId: mat, winding: o.wind || 'OUT', batchId: '',
             knifeWidths: kw(knives, o.base || (60 - knives)), knifeCount: knives,
             rollerWidth: o.roller == null ? 880 : o.roller, plannedRuns: o.runs || 1,
             isFoil: !!o.foil, dueKey: o.due };
}
function ids(seq) { return seq.map(function (c) { return c.id; }).join(' '); }
function realCost(seq) {
    var t = 0;
    for (var i = 1; i < seq.length; i++) t += planning.changeoverCost(seq[i - 1], seq[i], undefined);
    return t;
}
function days(seq, dayByCut) { return seq.map(function (c) { return dayByCut[c.id]; }); }

// ── 1) Подпись конфигурации: что делает резки взаимозаменяемыми ────────────────────────────────
(function () {
    var a = cut('a', 'MW308', 8), b = cut('b', 'MW308', 8);
    assert(planning.cutConfigSig(a) === planning.cutConfigSig(b), '#4139 sig: одинаковые ножи/сырьё/намотка → одна подпись');
    assert(planning.changeoverCost(a, b, undefined) === 0, '#4139 sig: одна подпись ⇒ переход БЕСПЛАТЕН (основание схлопывать в узел)');

    assert(planning.cutConfigSig(cut('c', 'MR194', 8)) !== planning.cutConfigSig(a), '#4139 sig: другое сырьё → другая подпись');
    assert(planning.cutConfigSig(cut('d', 'MW308', 15)) !== planning.cutConfigSig(a), '#4139 sig: другой набор ножей → другая подпись');
    assert(planning.cutConfigSig(cut('e', 'MW308', 8, { wind: 'IN' })) !== planning.cutConfigSig(a), '#4139 sig: другая намотка → другая подпись');
    // ширина ролика: её СУЖЕНИЕ — тоже смена ножей (changeoverParts), значит взаимозаменяемости нет
    assert(planning.cutConfigSig(cut('f', 'MW308', 8, { roller: 800 })) !== planning.cutConfigSig(a), '#4139 sig: другая ширина ролика → другая подпись');
})();

// ── 2) Реальный симптом со Станка 1 (02.07): MW308/8 → MWR113L/8 → MW308/8 ─────────────────────
(function () {
    var a1 = cut('a1', 'MW308', 8), b1 = cut('b1', 'MWR113L', 8), a2 = cut('a2', 'MW308', 8);
    var run = [a1, b1, a2];
    var dayByCut = { a1: 0, b1: 0, a2: 0 };
    var out = planning.resequenceWithinDays(run, dayByCut, {}, null, undefined);
    assert(!!out, '#4139: разорванный блок MW308 — пересортировка нашла улучшение');
    // без заправки станка (prev=null) начало очереди не закреплено, поэтому «a1 a2 b1» и «b1 a1 a2»
    // равноценны (обе 15 мин) — существенно ровно то, что MW308 перестал быть разорванным
    assert(Math.abs(out.indexOf(a1) - out.indexOf(a2)) === 1, '#4139: MW308 склеен (' + ids(run) + ' → ' + ids(out) + ')');
    assert(realCost(out) === 15 && realCost(run) === 30, '#4139: реальная переналадка упала 30 → 15 мин (одна смена сырья вместо двух)');
})();

// ── 2b) Заправка станка (prev, #3853) закрепляет начало очереди ────────────────────────────────
(function () {
    var a1 = cut('a1', 'MW308', 8), b1 = cut('b1', 'MWR113L', 8), a2 = cut('a2', 'MW308', 8);
    var prev = cut('prev', 'MW308', 8);   // станок уже заправлен MW308 → начинать надо с MW308
    var out = planning.resequenceWithinDays([a1, b1, a2], { a1: 0, b1: 0, a2: 0 }, {}, prev, undefined);
    assert(!!out && ids(out) === 'a1 a2 b1', '#4139 заправка: prev=MW308 → очередь начинается с MW308 (a1 a2 b1)');
})();

// ── 3) Улучшать нечего → null (порядок слоя размещения уважаем) ────────────────────────────────
(function () {
    var run = [cut('a1', 'MW308', 8), cut('a2', 'MW308', 8), cut('b1', 'MWR113L', 8)];
    var out = planning.resequenceWithinDays(run, { a1: 0, a2: 0, b1: 0 }, {}, null, undefined);
    assert(out === null, '#4139: уже оптимально → null, очередь не трогаем');
})();

// ── 4) Фольга остаётся последней в дне (#3717) ─────────────────────────────────────────────────
(function () {
    // фольга в СЕРЕДИНЕ входа; склейка MW308 не имеет права утащить её вперёд
    var f = cut('f', 'MB', 8, { foil: true });
    var run = [cut('a1', 'MW308', 8), f, cut('a2', 'MW308', 8)];
    var out = planning.resequenceWithinDays(run, { a1: 0, f: 0, a2: 0 }, {}, null, undefined);
    assert(!!out, '#4139 фольга: улучшение найдено');
    assert(out[out.length - 1].id === 'f', '#4139 фольга: осталась последней в дне (#3717)');
    assert(ids(out) === 'a1 a2 f', '#4139 фольга: MW308 склеен ПЕРЕД фольгой');
})();

// ── 5) День-сплит: резка, переползающая на следующий день, остаётся последней (#3635 п.5) ──────
(function () {
    var a1 = cut('a1', 'MW308', 8), b1 = cut('b1', 'MWR113L', 8), a2 = cut('a2', 'MW308', 8);
    var run = [a1, b1, a2];
    // a2 переползает на день 1 → закреплена последней, склейка невозможна без разрыва сплита
    var out = planning.resequenceWithinDays(run, { a1: 0, b1: 0, a2: 0 }, { a2: true }, null, undefined);
    assert(out === null || out[out.length - 1].id === 'a2', '#4139 день-сплит: переползающая резка осталась последней');
})();

// ── 6) Состав и номер дня не меняются → штрафы срока те же ─────────────────────────────────────
(function () {
    var run = [cut('a1', 'MW308', 8), cut('b1', 'MR194', 8), cut('a2', 'MW308', 8),
               cut('c1', 'MW411', 15), cut('b2', 'MR194', 8)];
    var dayByCut = { a1: 0, b1: 0, a2: 0, c1: 1, b2: 1 };
    var out = planning.resequenceWithinDays(run, dayByCut, {}, null, undefined);
    assert(!!out, '#4139 дни: улучшение найдено');
    assert(JSON.stringify(days(out, dayByCut)) === JSON.stringify([0, 0, 0, 1, 1]),
        '#4139 дни: резки дня 0 остались в дне 0, дня 1 — в дне 1 (сроки не трогаются)');
    assert(out.length === run.length, '#4139 дни: ни одна резка не потеряна');
})();

// ── 7) Приёмка ДВОЙНАЯ: реальные минуты наладки не растут ──────────────────────────────────────
// Property-фаззинг: что бы ни вернула пересортировка, changeoverCost не выше входного,
// sequencingCost строго ниже, состав дней сохранён, фольга в конце каждого дня.
(function () {
    var MATS = ['MW308', 'MWR113L', 'MR194', 'MW411'], KN = [8, 15, 22, 29];
    var seed = 20260710;
    function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
    var trials = 800, changedN = 0, realOk = true, dayOk = true, foilOk = true, setOk = true;
    for (var t = 0; t < trials; t++) {
        var n = 3 + Math.floor(rnd() * 7), run = [], dayByCut = {};
        for (var i = 0; i < n; i++) {
            var c = cut('c' + i, MATS[Math.floor(rnd() * 4) % 4], KN[Math.floor(rnd() * 4) % 4],
                        { wind: rnd() < 0.3 ? 'IN' : 'OUT', foil: rnd() < 0.1 });
            run.push(c);
        }
        // фольгу — в конец каждого дня, как это делает упаковщик
        var d = 0, perDay = 1 + Math.floor(rnd() * 3);
        run.forEach(function (c, k) { dayByCut[c.id] = Math.floor(k / perDay); });
        var groups = {};
        run.forEach(function (c) { (groups[dayByCut[c.id]] = groups[dayByCut[c.id]] || []).push(c); });
        run = [];
        Object.keys(groups).sort(function (x, y) { return x - y; }).forEach(function (k) {
            var g = groups[k];
            run = run.concat(g.filter(function (c) { return !c.isFoil; }), g.filter(function (c) { return c.isFoil; }));
        });

        var out = planning.resequenceWithinDays(run, dayByCut, {}, null, undefined);
        if (!out) continue;
        changedN++;
        if (realCost(out) > realCost(run) + 1e-9) realOk = false;
        if (out.length !== run.length) setOk = false;
        var before = {}, after = {};
        run.forEach(function (c) { (before[dayByCut[c.id]] = before[dayByCut[c.id]] || []).push(c.id); });
        out.forEach(function (c) { (after[dayByCut[c.id]] = after[dayByCut[c.id]] || []).push(c.id); });
        Object.keys(before).forEach(function (k) {
            if (before[k].slice().sort().join() !== (after[k] || []).slice().sort().join()) dayOk = false;
        });
        var curDay = null, seenFoil = false;
        out.forEach(function (c) {
            if (dayByCut[c.id] !== curDay) { curDay = dayByCut[c.id]; seenFoil = false; }
            if (c.isFoil) seenFoil = true; else if (seenFoil) foilOk = false;
        });
    }
    assert(changedN > 0, '#4139 fuzz: пересортировка сработала на ' + changedN + ' из ' + trials + ' случайных очередей');
    assert(realOk, '#4139 fuzz: реальные минуты наладки НИКОГДА не выросли (двойная приёмка)');
    assert(setOk, '#4139 fuzz: ни одна резка не потеряна и не задвоена');
    assert(dayOk, '#4139 fuzz: состав каждого дня сохранён → штрафы срока не меняются');
    assert(foilOk, '#4139 fuzz: фольга последняя в каждом дне (#3717)');
})();

// ── 8) Сквозь planCutOperations: проход включён по умолчанию, выключается флагом ───────────────
(function () {
    // корпус, на котором слой размещения оставляет разорванный блок (найден перебором)
    var cuts = [cut('c0', 'MWR113L', 15, { runs: 1 }), cut('c1', 'MR194', 8, { runs: 1 }),
                cut('c2', 'MWR113L', 8, { runs: 1 }), cut('c3', 'MR194', 8, { runs: 1 })];
    var pp = { c0: 90, c1: 60, c2: 60, c3: 60 };
    function opts(extra) {
        var o = { weights: {}, dayStartMin: 480, dayEndMin: 970, lunchStartMin: 740, lunchDurationMin: 40,
                  planBaseMidnightMs: BASE, slotPlacement: true, perPassByCut: pp, slitterIds: ['m1'] };
        for (var k in extra) o[k] = extra[k];
        return o;
    }
    function order(ops) {
        return ops.updates.slice().sort(function (a, b) { return (a.planStartTs || 0) - (b.planStartTs || 0) || a.sequence - b.sequence; })
            .map(function (u) { return u.cutId; }).filter(function (v, i, arr) { return arr.indexOf(v) === i; });
    }
    var byId = {}; cuts.forEach(function (c) { byId[c.id] = c; });
    function cost(o) { var t = 0; for (var i = 1; i < o.length; i++) t += planning.changeoverCost(byId[o[i - 1]], byId[o[i]], undefined); return t; }

    var on = order(planning.planCutOperations(cuts, opts({})));
    var off = order(planning.planCutOperations(cuts, opts({ intraDayResequence: false })));
    assert(cost(on) <= cost(off), '#4139 e2e: с проходом переналадка не хуже (' + cost(off) + ' → ' + cost(on) + ' мин)');
    assert(on.length === cuts.length && off.length === cuts.length, '#4139 e2e: все резки на месте');

    // preserveOrder (ручной порядок оператора) проход НЕ трогает
    var keep = planning.planCutOperations(cuts, opts({ preserveOrder: true, slotPlacement: false }));
    assert(keep.updates.length > 0, '#4139 e2e: preserveOrder — путь не тронут, ops строятся');
})();

console.log('\n' + passed + '/' + total + ' passed');
