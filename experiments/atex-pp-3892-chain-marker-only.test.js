// Цепочка дробления определяется ТОЛЬКО явным «ID первой части» (#3892).
//
// Решение заказчика 31.07.2026: «С #3892 каждая часть разбитого задания несёт явный ID первой
// части, и по нему группировка точная. Но записи, созданные до этого, маркера не имеют — забить на
// них вообще, я их удалю, не надо тащить в коде эту хрень». Проверено на боевой ateh: в таблице
// «Задание в производство» 158 записей, маркер стои́т у всех 158 — легаси-данных нет.
//
// ЧТО УБРАНО. Запасное правило «одинаковая конфигурация (станок|сырьё|намотка|ножи) + смежные
// календарные дни + тот же заказ = одна цепочка». Оно ГАДАЛО: две РАЗНЫЕ резки одной конфигурации в
// соседние дни склеивались в одно логическое задание — голова уезжала на ранний день, а «Упорядочить»
// пропускал всю «цепочку» как одну запись (issue #3892 и был об этом).
//
//   A — две записи одной конфигурации и заказа в смежные дни БЕЗ маркера цепочкой НЕ считаются;
//   B — записи с ОДНИМ маркером — цепочка (регресс #3892: маркер работает);
//   C — запись без маркера названа в журнале (ТЗ §14: молча не гадаем и молча не игнорируем);
//   D — значки смежности «←/→» на карточках тоже по маркеру, а не по конфигурации.
//
// Run with: node experiments/atex-pp-3892-chain-marker-only.test.js

process.env.TZ = 'UTC';
global.window = { db: 'ateh', xsrf: 'x' };
var P = require('../download/atex/js/production-planning.js').planning;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

var D0 = Math.floor(new Date(2026, 6, 30, 8, 0, 0).getTime() / 1000), DAY = 86400;
// Одна и та же конфигурация и заказ — по прежнему правилу это склеивалось в цепочку.
function cut(id, dayOff, firstPartId) {
    return { id: id, slitter: { id: '1' }, materialId: 'M1', winding: 'OUT',
             knifeWidths: [110, 110, 55], knifeCount: 3, rollerWidth: 110,
             plannedRuns: 3, isFoil: false, orderId: 'ORD-7', status: '',
             planDate: String(D0 + dayOff * DAY),
             firstPartId: firstPartId === undefined ? '' : firstPartId };
}
function ids(res) { return (res.cuts || []).map(function (c) { return String(c.id); }).sort(); }

// ── A: без маркера — две самостоятельные записи ─────────────────────────────────────────────
(function () {
    var res = P.mergeContinuationChains([cut('A1', 0), cut('A2', 1)]);
    assert(ids(res).join(',') === 'A1,A2',
        'A: две записи без маркера остались самостоятельными — конфигурация цепочкой не считается',
        '(' + ids(res).join(',') + ')');
    assert((res.deletes || []).length === 0,
        'A: и ни одна из них не помечена на удаление как «звено»', '(' + (res.deletes || []).join(',') + ')');
    var chain = (res.chainByLogical || {})['A1'] || [];
    assert(chain.length <= 1, 'A: цепочки у неё нет', '(' + chain.join(',') + ')');
})();

// ── B: маркер — цепочка (регресс #3892) ─────────────────────────────────────────────────────
(function () {
    var res = P.mergeContinuationChains([cut('B1', 0, 'B1'), cut('B2', 1, 'B1')]);
    assert(ids(res).join(',') === 'B1',
        'B: части с одним «ID первой части» слиты в одно логическое задание', '(' + ids(res).join(',') + ')');
    assert((res.chainByLogical['B1'] || []).join(',') === 'B1,B2',
        'B: цепочка = голова + продолжение', '(' + (res.chainByLogical['B1'] || []).join(',') + ')');
    assert(Number((res.cuts[0] || {}).plannedRuns) === 6,
        'B: проходы цепочки суммированы', '(' + (res.cuts[0] || {}).plannedRuns + ')');
})();

// ── C: запись без маркера названа в журнале ─────────────────────────────────────────────────
(function () {
    var warned = [];
    var orig = console.warn;
    console.warn = function () { warned.push(Array.prototype.slice.call(arguments).join(' ')); };
    try { P.mergeContinuationChains([cut('C1', 0), cut('C2', 1, 'C2')]); } finally { console.warn = orig; }
    var msg = warned.join(' | ');
    assert(/C1/.test(msg) && /перв/i.test(msg),
        'C: запись без «ID первой части» названа поимённо — данные чинятся, а не угадываются',
        '(' + (msg.slice(0, 140) || 'ни одного предупреждения') + ')');
    assert(!/C2/.test(msg), 'C: про запись С маркером не ругаемся');
})();

// ── D: значки смежности «←/→» — по маркеру ──────────────────────────────────────────────────
(function () {
    var a = cut('D1', 0), b = cut('D2', 1);                       // одна конфигурация, маркеров нет
    assert(P.isDaySplitSibling(a, b) === false,
        'D: без маркера соседи по дням — РАЗНЫЕ задания, значка «←/→» нет');
    var h = cut('D3', 0, 'D3'), t = cut('D4', 1, 'D3');
    assert(P.isDaySplitSibling(h, t) === true,
        'D: части одной цепочки (общий маркер) — значок есть');
    var badges = P.daySplitBadges(a, 0, b, 1, null, null);
    assert(badges.fromPrev === false, 'D: daySplitBadges тоже смотрит на маркер');
    assert(P.daySplitBadges(h, 0, t, 1, null, null).fromPrev === true,
        'D: и ставит «←» у продолжения своей цепочки');
})();

console.log('\n' + passed + '/' + total + ' проверок пройдено');
if (passed !== total) process.exitCode = 1;
