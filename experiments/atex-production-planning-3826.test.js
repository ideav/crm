// Unit tests for #3826 — follow-up к #3820/#3815 (EDD): «Фольга не была затянута в 23-е число,
// хотя могла бы быть».
//
// Симптом (боевой скрин): фольга со «Сроком изготовления» 23.06 стояла на 24.06, хотя в дне 23
// было место. Причина: фольга всегда в конце дня (#3717) → в выборе задания дня ключ начинался
// с isFoil, поэтому ЛЮБАЯ нефольга бралась раньше любой фольги. По-дневная раскладка тянула
// вперёд будущую (срок 24) нефольгу, та съедала хвост дня 23, и фольга своего срока (23)
// переливалась на день 24. Нефольга-«вперёд» вытесняла фольгу-«своего-срока» с её дня.
//
// Фикс (splitMachineQueue, ветка gapFill): если на день приходится фольга своего срока (срок ≤
// дня), хвост дня резервируется под работу своего срока — сперва нефольга своего срока, затем
// крупнейшая ЦЕЛИКОМ влезающая фольга своего срока (фольга — в конце дня, #3717). Будущую
// нефольгу тянем вперёд только когда фольги на дне ещё нет (тогда фольга уедет на след. день в
// конец — правило не нарушается). Фольгу крупнее целого дня дробим (заполняя остаток).
//
// Run with: node experiments/atex-production-planning-3826.test.js

process.env.TZ = 'Europe/Moscow';

var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0;
function assert(cond, name) {
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}

var BASE = new Date(2026, 5, 23, 0, 0, 0).getTime();   // день 0 = 23.06, день 1 = 24.06
var K = { d23: 20260623, d24: 20260624, d25: 20260625 };

// runs=1, perPass=min (длительность). times нулевые → setup 0, точные размеры. Окно дня = cap.
function cut(id, mat, min, foil, runs) {
    runs = runs || 1;
    return { id: id, slitter: { id: 'm' }, materialId: mat, winding: foil ? 'IN' : 'OUT',
        knifeWidths: [mat.length], knifeCount: 1, plannedRuns: runs,
        planDate: String(Math.floor(BASE / 1000)), sequence: null, isFoil: !!foil, _min: min, _runs: runs };
}
function plan(cuts, dueKeyByCut, cap) {
    var perPass = {}; cuts.forEach(function(c){ perPass[c.id] = c._min / c._runs; });
    var anchor = {}; cuts.forEach(function(c){ anchor[String(c.id)] = 0; });
    var ops = planning.planCutOperations(cuts, {
        perPassByCut: perPass, dayStartMin: 0, dayEndMin: cap,
        times: { BETWEEN_CUTS: 0, MATERIAL_WINDING: 0, KNIFE: 0 },
        planBaseMidnightMs: BASE, preserveOrder: false, gapFill: true,
        dayAnchorByCut: anchor, dueKeyByCut: dueKeyByCut
    });
    // собрать все сегменты (updates+creates) с днём, порядком, фольга?
    var byId = {}; cuts.forEach(function(c){ byId[c.id] = c; });
    var segs = [];
    ops.updates.forEach(function(u){ segs.push({ id: u.cutId, day: Math.floor((Number(u.planStartTs) - Math.floor(BASE / 1000)) / 86400), seq: u.sequence, foil: !!(byId[u.cutId] && byId[u.cutId].isFoil) }); });
    (ops.creates || []).forEach(function(cr){ var pid = String(cr.parentCutId); segs.push({ id: pid + '~cont', day: Math.floor((Number(cr.planStartTs) - Math.floor(BASE / 1000)) / 86400), seq: cr.sequence, foil: !!(byId[pid] && byId[pid].isFoil) }); });
    segs.sort(function(a, b){ return a.day - b.day || a.seq - b.seq; });
    return segs;
}
function dayOfHead(segs, id){ for (var i = 0; i < segs.length; i++) if (segs[i].id === id) return segs[i].day; return null; }
// «фольга в конце каждого дня»: в пределах дня после фольги не идёт нефольга.
function foilAtEndEachDay(segs){
    var sawFoil = {};
    for (var i = 0; i < segs.length; i++) {
        var s = segs[i];
        if (s.foil) sawFoil[s.day] = true;
        else if (sawFoil[s.day]) return false;   // нефольга после фольги в этом дне
    }
    return true;
}

// ── 1) Фольга своего срока, влезающая в день, НЕ вытесняется будущей нефольгой ──
// cap 250. N1(срок23 нефольга 100), N2(срок24 нефольга 100), F(срок23 ФОЛЬГА 100).
// Баг: день0 = N1,N2 (тянули N2 вперёд), F(срок23) → день1. Фикс: день0 = N1,F(в конце); N2 → день1.
var s1 = plan([ cut('N1', 'MA', 100), cut('N2', 'MB', 100), cut('F', 'FA', 100, true) ],
    { N1: K.d23, N2: K.d24, F: K.d23 }, 250);
assert(dayOfHead(s1, 'F') === 0, '#3826: фольга срока 23 встала на день 0 (а не на день 1)');
assert(dayOfHead(s1, 'N2') === 1, '#3826: будущая нефольга срока 24 ушла на день 1 (не съела хвост дня 0)');
assert(foilAtEndEachDay(s1), '#3826: фольга — в конце каждого дня (#3717 сохранён)');

// ── 2) Несколько фольг своего срока: крупнейшая влезающая — в хвост, остаток — на завтра в конец ──
// cap 250. N1(срок23 нефольга 120). Fbig(срок23 фольга 135), Fsml(срок23 фольга 100).
// День0: N1(120)+Fsml(100)=220 ≤250 (Fsml влезает), Fbig(135) — на день1 в конец.
var s2 = plan([ cut('N1', 'MA', 120), cut('Fbig', 'FB', 135, true), cut('Fsml', 'FB', 100, true) ],
    { N1: K.d23, Fbig: K.d23, Fsml: K.d23 }, 250);
assert(foilAtEndEachDay(s2), '#3826: фольга в конце каждого дня при двух фольгах');
assert(dayOfHead(s2, 'Fsml') === 0 && dayOfHead(s2, 'Fbig') === 1,
    '#3826: влезающая фольга (Fsml) — на день 0, крупная (Fbig) — на день 1');

// ── 3) Нет фольги своего срока → поведение прежнее (будущую нефольгу тянем вперёд, заполняя день) ──
// cap 250. N1(срок23 100), N2(срок24 100), N3(срок24 100). День0 = N1,N2 (тянем вперёд), N3 → день1.
var s3 = plan([ cut('N1', 'MA', 100), cut('N2', 'MB', 100), cut('N3', 'MC', 100) ],
    { N1: K.d23, N2: K.d24, N3: K.d24 }, 250);
assert(dayOfHead(s3, 'N1') === 0 && dayOfHead(s3, 'N2') === 0,
    '#3826: без фольги — будущая нефольга по-прежнему тянется вперёд (день 0 заполнен)');

// ── 4) Фольга крупнее целого дня — дробится, заполняя остаток (не оставляет день пустым) ──
// cap 200. N1(срок23 нефольга 50), F(срок23 фольга 500 — больше дня, 10 проходов×50). День0 = N1 + начало F.
var s4 = plan([ cut('N1', 'MA', 50), cut('F', 'FA', 500, true, 10) ], { N1: K.d23, F: K.d23 }, 200);
assert(dayOfHead(s4, 'F') === 0, '#3826: огромная фольга дробится с дня 0 (день не простаивает)');
assert(foilAtEndEachDay(s4), '#3826: огромная фольга — в конце дня 0 (нефольга после неё не идёт)');

// ── 5) Обратная совместимость: без сроков (dueKey не задан) — фольга просто в конце (#3717), без EDD ──
var s5 = plan([ cut('N1', 'MA', 100), cut('F', 'FA', 100, true), cut('N2', 'MB', 100) ], {}, 250);
assert(foilAtEndEachDay(s5), '#3826: без сроков фольга всё равно в конце дня (#3717)');

console.log('\n' + passed + ' passed');
