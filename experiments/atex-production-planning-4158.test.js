// Regression for ideav/crm#4158 — продолжение дробления «не привязано к заказу»:
// эрозия/утечка Обеспечения при ПЕРЕ-разбиении (второй симптом #4155; первый — пустая
// «Партия сырья» — закрыт #4157).
//
// Два механизма (см. issue #4158):
//   (b) ОСНОВНОЙ — эрозия покрытия при СХЛОПЫВАНИИ цепочки. applySplitPlan делит ТЕКУЩЕЕ
//       (уже ужатое прошлым разбиением) обеспечение головы, а create-путь (единственный, кто
//       правит обеспечение головы) при схлопывании НЕ запускается (creates XOR deletes на
//       голову). Доли удаляемых продолжений исчезали → Σ рулонов цепочки < спроса позиции.
//   (a) УЗКИЙ — сегмент с нулевой долей (floor=0 и метраж→0) не получал Обеспечение вовсе →
//       задание-продолжение без привязки к позиции заказа.
//
// Инвариант КОНСЕРВАЦИИ: Σ рулонов/метража Обеспечения по всем сегментам цепочки после
// пере-разбиения == Σ до него (== спросу позиции заказа).
//
// Run with: node experiments/atex-production-planning-4158.test.js

process.env.TZ = 'UTC';
global.window = { db: 'testdb', xsrf: 'x' };
var Controller = require('../download/atex/js/production-planning.js').Controller;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

function meta(id, pairs) { return { id: String(id), reqs: pairs.map(function(p) { return { id: String(p[0]), val: p[1] }; }) }; }
var cutMeta = meta(100, [
    ['190', 'Вид сырья'], ['191', 'Слиттер'], ['192', 'Партия сырья'], ['193', 'Кол-во план'],
    ['194', 'Статус'], ['196', 'Тип намотки'], ['198', 'Лидер'], ['197', 'Метраж, м'],
    ['199', 'Длительность, минут'], ['200', 'Резка и Лидер'], ['188', 'ID первой части'],
    ['189', 'Зафиксировано']
]);
var fbMeta  = meta(300, [['301', 'Ширина, мм'], ['302', 'Кол-во полос'], ['303', 'Кол-во рулонов'], ['304', 'Кол-во план'], ['305', 'В работе']]);
var supMeta = meta(400, [['401', 'Метраж, м'], ['402', 'Кол-во рулонов'], ['403', 'В работе'], ['404', 'Статус'], ['405', 'Партия ГП']]);
var ROLLS = 't402', FOOT = 't401';

function baseController() {
    var root = { getAttribute: function() { return 'testdb'; } };
    var c = new Controller(root);
    c.meta.cut = cutMeta; c.meta.finishedBatch = fbMeta; c.meta.supply = supMeta;
    c.opTimes = { WIND_100: 2, WIND_1000: 20, KNIFE: 30, MATERIAL_WINDING: 15, BETWEEN_CUTS: 1 };
    c.changeTimes = { BETWEEN_CUTS: 1, KNIFE: 30, MATERIAL_WINDING: 15 };
    c.resolveLeaderId = function(l) { return l ? ('LID_' + l) : ''; };
    c.reload = function() { return Promise.resolve(); };
    c.persistCutSetupColumns = function() { return Promise.resolve(); };
    c.setBusy = function() {}; c.showProgress = function() {}; c.hideProgress = function() {};
    c.render = function() {}; c.notify = function() {}; c.updateProgress = function() {};
    c.footageBySupply = {};
    var posts = [];
    c.post = function(path, fields) { posts.push({ path: path, fields: fields || {} }); return Promise.resolve({ obj: 'NEW_' + posts.length }); };
    c._posts = posts;
    return c;
}
function pathsOf(posts, re) { return posts.filter(function(p) { return re.test(p.path); }); }
function cut(id, extra) {
    var base = { id: id, length: 450, materialId: 'MW308', status: 'В работе', slitter: { id: 'S1' },
                 batchId: '74929', winding: 'OUT', leaders: ['MONO'], plannedRuns: 8, firstPartId: 'H', isFoil: false };
    return Object.assign(base, extra || {});
}

// ── Тест (b): СХЛОПЫВАНИЕ цепочки [H,B] → 1 сегмент. Без фикса доля B (40 рул.) исчезает,
// голова остаётся с ужатыми 60 → покрытие позиции 60 из 100 («неполное»). Фикс возвращает
// долю удаляемого продолжения в головное обеспечение (консервация: 100). ──
(function() {
    var c = baseController();
    c.cuts = [ cut('H', { firstPartId: 'H' }), cut('B', { firstPartId: 'H', plannedRuns: 3 }) ];
    // прошлое разбиение: голова ужата до 60, продолжение B несёт 40 (той же позиции P1)
    c.supplies = [
        { id: 'SUP_H', cutId: 'H', positionId: 'P1', finishedBatchId: 'FBH', rolls: 60, footage: 600 },
        { id: 'SUP_B', cutId: 'B', positionId: 'P1', finishedBatchId: 'FBB', rolls: 40, footage: 400 }
    ];
    c.loadStripsForCut = function() { return Promise.resolve([{ id: 'FBH', width: 154, qty: 5, orderId: 'O1' }]); };
    var ops = { updates: [{ cutId: 'H', sequence: 1, planStartTs: 1751778540, plannedRuns: 11 }], creates: [], deletes: ['B'] };
    c.applySplitPlan(ops).then(function() {
        var posts = c._posts;
        var setH = pathsOf(posts, /_m_set\/SUP_H\?/);
        var restored = setH.length ? Number(setH[setH.length - 1].fields[ROLLS]) : 60;
        console.log('  [b] _m_set SUP_H rolls =', restored, '(footage=' + (setH.length ? setH[setH.length - 1].fields[FOOT] : '—') + ')');
        assert(restored === 100, '(b) СХЛОПЫВАНИЕ: доля удаляемого B (40) возвращена в головное обеспечение (60→100)', '(rolls=' + restored + ')');
        // инвариант консервации: Σ рулонов выживших сегментов позиции P1 == 100
        var finalHeadRolls = setH.length ? Number(setH[setH.length - 1].fields[ROLLS]) : 60;   // B удаляется → 0
        assert(finalHeadRolls === 100, '(b) КОНСЕРВАЦИЯ: Σ рулонов цепочки по позиции P1 сохранён (==100)', '(Σ=' + finalHeadRolls + ')');
        // метраж тоже консервируется
        var restFoot = setH.length ? Number(setH[setH.length - 1].fields[FOOT]) : 600;
        assert(restFoot === 1000, '(b) КОНСЕРВАЦИЯ метража: 600→1000 (600+400)', '(footage=' + restFoot + ')');
    }).catch(function(e) { assert(false, '(b) threw', String(e && e.stack || e)); });
})();

// ── Тест (a): РОСТ до 2 сегментов, у продолжения нулевая доля (rolls 0, метраж 0). Без фикса
// Обеспечение продолжения НЕ создаётся → задание не привязано к заказу. Фикс создаёт связующее
// 0-рулонное Обеспечение (up=позиция). ──
(function() {
  setTimeout(function() {
    var c = baseController();
    c.cuts = [ cut('H', { firstPartId: 'H', plannedRuns: 10 }) ];
    c.supplies = [ { id: 'SUP_H', cutId: 'H', positionId: 'P1', finishedBatchId: 'FBH', rolls: 1, footage: 0 } ];
    c.loadStripsForCut = function() { return Promise.resolve([{ id: 'FBH', width: 154, qty: 5, orderId: 'O1' }]); };
    // segRuns = [10 (голова), 1 (продолжение)] → splitSupplyShares(1,0,[10,1]) = [{1,0},{0,0}]: у продолжения 0/0
    var ops = { updates: [{ cutId: 'H', sequence: 1, planStartTs: 1751778540, plannedRuns: 10 }],
                creates: [{ parentCutId: 'H', sequence: 2, planStartTs: 1752040800, plannedRuns: 1 }], deletes: [] };
    c.applySplitPlan(ops).then(function() {
        var posts = c._posts;
        var contSup = pathsOf(posts, /_m_new\/400\?.*up=P1/);
        console.log('  [a] создано Обеспечений продолжения (up=P1):', contSup.length,
            contSup.length ? '(rolls=' + JSON.stringify(contSup[0].fields[ROLLS]) + ')' : '');
        assert(contSup.length === 1, '(a) НУЛЕВАЯ ДОЛЯ: продолжение всё равно получает связующее Обеспечение (привязка к позиции)', '(' + contSup.length + ')');
    }).catch(function(e) { assert(false, '(a) threw', String(e && e.stack || e)); });
  }, 150);
})();

// ── Тест (c): грубая регрессия РОСТА — обычное разбиение головы 100 рул. на 2 сегмента
// (runs 6/4) консервирует: голова→60, продолжение→40 (Σ=100). ──
(function() {
  setTimeout(function() {
    var c = baseController();
    c.cuts = [ cut('H', { firstPartId: 'H', plannedRuns: 10 }) ];
    c.supplies = [ { id: 'SUP_H', cutId: 'H', positionId: 'P1', finishedBatchId: 'FBH', rolls: 100, footage: 1000 } ];
    c.loadStripsForCut = function() { return Promise.resolve([{ id: 'FBH', width: 154, qty: 5, orderId: 'O1' }]); };
    var ops = { updates: [{ cutId: 'H', sequence: 1, planStartTs: 1751778540, plannedRuns: 6 }],
                creates: [{ parentCutId: 'H', sequence: 2, planStartTs: 1752040800, plannedRuns: 4 }], deletes: [] };
    c.applySplitPlan(ops).then(function() {
        var posts = c._posts;
        var setH = pathsOf(posts, /_m_set\/SUP_H\?/);
        var headRolls = setH.length ? Number(setH[setH.length - 1].fields[ROLLS]) : 100;
        var contSup = pathsOf(posts, /_m_new\/400\?.*up=P1/);
        var contRolls = contSup.length ? Number(contSup[0].fields[ROLLS]) : 0;
        console.log('  [c] голова rolls =', headRolls, '+ продолжение rolls =', contRolls, '= ' + (headRolls + contRolls));
        assert(headRolls + contRolls === 100, '(c) РОСТ консервирует: голова + продолжение = 100', '(Σ=' + (headRolls + contRolls) + ')');
    }).catch(function(e) { assert(false, '(c) threw', String(e && e.stack || e)); });
  }, 300);
})();

// ── Тест (d): ЧАСТИЧНОЕ схлопывание [H,B,C]→2 сегмента (H + реюз B), C удаляется. Доля C (20)
// возвращается в голову (50→70), реюзнутое B (30) НЕ трогается. Σ выживших = 70+30 = 100. ──
(function() {
  setTimeout(function() {
    var c = baseController();
    c.cuts = [ cut('H', { firstPartId: 'H' }), cut('B', { firstPartId: 'H', plannedRuns: 3 }), cut('C', { firstPartId: 'H', plannedRuns: 2 }) ];
    c.supplies = [
        { id: 'SUP_H', cutId: 'H', positionId: 'P1', finishedBatchId: 'FBH', rolls: 50, footage: 500 },
        { id: 'SUP_B', cutId: 'B', positionId: 'P1', finishedBatchId: 'FBB', rolls: 30, footage: 300 },
        { id: 'SUP_C', cutId: 'C', positionId: 'P1', finishedBatchId: 'FBC', rolls: 20, footage: 200 }
    ];
    c.loadStripsForCut = function() { return Promise.resolve([{ id: 'FBH', width: 154, qty: 5, orderId: 'O1' }]); };
    var ops = { updates: [{ cutId: 'H', sequence: 1, planStartTs: 1751778540, plannedRuns: 6 },
                          { cutId: 'B', sequence: 2, planStartTs: 1752040800, plannedRuns: 4 }],
                creates: [], deletes: ['C'] };
    c.applySplitPlan(ops).then(function() {
        var posts = c._posts;
        var setH = pathsOf(posts, /_m_set\/SUP_H\?/);
        var headRolls = setH.length ? Number(setH[setH.length - 1].fields[ROLLS]) : 50;
        var setB = pathsOf(posts, /_m_set\/SUP_B\?/);
        var bRolls = setB.length ? Number(setB[setB.length - 1].fields[ROLLS]) : 30;   // реюз B не трогаем → хранимые 30
        console.log('  [d] голова', headRolls, '+ реюз B', bRolls, '= ' + (headRolls + bRolls), '(C=20 поглощён головой; _m_set SUP_B:', setB.length + ')');
        assert(headRolls === 70, '(d) ЧАСТИЧНОЕ схлопывание: доля удаляемого C (20) поглощена головой (50→70)', '(rolls=' + headRolls + ')');
        assert(setB.length === 0, '(d) реюзнутое продолжение B НЕ переписывается (свою долю хранит)', '(_m_set SUP_B=' + setB.length + ')');
        assert(headRolls + bRolls === 100, '(d) КОНСЕРВАЦИЯ: Σ рулонов выживших сегментов позиции P1 == 100', '(Σ=' + (headRolls + bRolls) + ')');
        console.log('\n  Итог: ' + passed + '/' + total + ' проверок пройдено.');
    }).catch(function(e) { assert(false, '(d) threw', String(e && e.stack || e)); });
  }, 450);
})();
