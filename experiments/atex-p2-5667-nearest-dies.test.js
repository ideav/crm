// ideav/crm#5667 — «Заказы этикетки»: выбрать другой нож из 6 ближайших по размеру.
//
//   1. nearestDies: ножи в состоянии «Нож подбирается» на основе сырья позиции, по близости
//      размера (сумма отклонений сторон), дальше пробег и номер; не больше 6; допуск не
//      ограничивает (список — для ручного выбора);
//   2. dieKnifeType: «Тип ножей» позиции из ножа — имя его «Типа ножа», если оно разбирается
//      как тип 1С, иначе «Ш х Д (втулка)» из параметров типа; без размера или втулки — пусто;
//   3. manualDieWrite: выбор ножа из списка пишет в позицию и нож (Подбор ножа = вручную),
//      и «Тип ножей» — меняются оба;
//   4. buildDies несёт имя типа ножа (typeName) — его показывает список «Нож / Тип ножа».
//
// rules: none (defect #5667)
// Run with: node experiments/atex-p2-5667-nearest-dies.test.js

process.env.TZ = 'UTC';
var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

var LO = require('../download/atex-p2/js/label-orders.js').core;

function die(id, w, l, extra) {
    var d = { id: id, no: String(id), width: w, length: l, base: 'ПП', streams: 3, selectable: true, revs: 0, sleeveWidth: 70, typeName: w + ' x ' + l + ' (70)' };
    Object.keys(extra || {}).forEach(function(k) { d[k] = extra[k]; });
    return d;
}
function ids(list) { return (list || []).map(function(d) { return d.id; }).join(','); }
var POS = { id: 'p1', width: 100, length: 72, base: 'ПП', orderStreams: 1, knifeType: '100 x 71,5 (70)', pick: 'близкий', dieId: '1' };

// ── 1. Шесть ближайших ───────────────────────────────────────────────────────
(function() {
    assert(typeof LO.nearestDies === 'function', 'core.nearestDies есть');
    if (typeof LO.nearestDies !== 'function') return;
    var dies = [
        die('1', 100, 71.5),                 // 0,5
        die('2', 100, 75),                   // 3
        die('3', 98, 72, { revs: 500 }),     // 2
        die('4', 98, 72, { revs: 10 }),      // 2, меньший пробег
        die('5', 100, 72.2, { base: 'Бумага' }),      // другая основа
        die('6', 100, 72.1, { selectable: false }),   // не подбирается
        die('7', 110, 80),                   // 18
        die('8', 101, 73),                   // 2
        die('9', 95, 70),                    // 7
        die('10', 120, 90),                  // 38
        die('11', 'x', 72)                   // без размера
    ];
    var list = LO.nearestDies(POS, dies);
    assert(list.length === 6, 'не больше 6', ids(list));
    assert(ids(list) === '1,8,4,3,2,9', 'по близости, при равной — меньший пробег, затем номер', ids(list));
    assert(list.every(function(d) { return d.base === 'ПП' && d.selectable; }), 'только основа позиции и «Нож подбирается»');
    assert(list[0].deviation === 0.5, 'у варианта — отклонение размера, мм', String(list[0].deviation));
    var three = LO.nearestDies(POS, dies, 3);
    assert(ids(three) === '1,8,4', 'лимит задаётся', ids(three));
    var noBase = LO.nearestDies({ width: 100, length: 72, base: '' }, dies);
    assert(noBase.some(function(d) { return d.id === '5'; }), 'основа у сырья не задана — основу не фильтруем', ids(noBase));
    assert(LO.nearestDies({ width: '', length: 72, base: 'ПП' }, dies).length === 0, 'нет размера позиции — списка нет');
})();

// ── 2. Тип ножей из ножа ─────────────────────────────────────────────────────
(function() {
    assert(typeof LO.dieKnifeType === 'function', 'core.dieKnifeType есть');
    if (typeof LO.dieKnifeType !== 'function') return;
    assert(LO.dieKnifeType(die('1', 100, 71.5)) === '100 x 71.5 (70)', 'имя типа ножа, если разбирается', LO.dieKnifeType(die('1', 100, 71.5)));
    var odd = LO.dieKnifeType(die('2', 100, 71.5, { typeName: 'Тип 653' }));
    assert(odd === '100 х 71,5 (70)', 'имя не разбирается — из параметров типа', odd);
    assert(LO.dieKnifeType(die('3', 100, 71.5, { typeName: '', sleeveWidth: '' })) === '', 'нет втулки и имени — пусто');
})();

// ── 3. Выбор из списка пишет нож и тип ножей ─────────────────────────────────
(function() {
    assert(typeof LO.manualDieWrite === 'function', 'core.manualDieWrite есть');
    if (typeof LO.manualDieWrite !== 'function') return;
    var dies = [die('1', 100, 71.5), die('2', 100, 75, { typeName: '100 x 75 (76)' })];
    var r = LO.manualDieWrite(POS, '2', dies, { mrLength: 2000, dieSizeTolerance: 1.65 });
    assert(r.plan.die.ok && r.plan.die.die.id === '2' && r.plan.die.pick === 'вручную', 'нож из списка — ручной выбор', JSON.stringify({ id: r.plan.die.die && r.plan.die.die.id, pick: r.plan.die.pick }));
    assert(r.write.die === '2' && r.write.diePick === 'вручную', 'в запись — нож и «Подбор ножа»', JSON.stringify(r.write));
    assert(r.write.knifeType === '100 x 75 (76)', 'в запись — «Тип ножей» выбранного ножа', JSON.stringify(r.write.knifeType));
    var same = LO.manualDieWrite(Object.assign({}, POS, { knifeType: '100 x 75 (76)' }), '2', dies, {});
    assert(!('knifeType' in same.write), 'тип ножей уже тот — не пишем');
})();

// ── 4. buildDies несёт имя типа ──────────────────────────────────────────────
(function() {
    var t = { die: { reqs: { labelWidth: 'w', labelLength: 'l' } } };
    var built = LO.buildDies([{ id: '1', val: '653822', reqs: { w: '100', l: '71.5' }, typeName: '100 x 71,5 (70)' }], t, {}, {}, null);
    assert(built[0].typeName === '100 x 71,5 (70)', 'typeName в ноже', JSON.stringify(built[0].typeName));
})();

// ── 5. «Выбрать нож вручную»: точного размера нет — ближайшие варианты ──────
// Заказ 5730, этикетка 102 × 111: окно было пустым («Ножей этого размера в базе нет»).
(function() {
    assert(typeof LO.manualDieList === 'function', 'core.manualDieList есть');
    if (typeof LO.manualDieList !== 'function') return;
    var pos = { width: 102, length: 111, base: 'ПП' };
    var dies = [
        die('1', 100, 110),                          // 3
        die('2', 102, 110, { base: 'Бумага' }),      // 1, другая основа — видна, но помечена
        die('3', 103, 111, { selectable: false }),   // 1, не подбирается — видна, помечена
        die('4', 105, 115),                          // 7
        die('5', 90, 100),                           // 23
        die('6', 110, 120),                          // 17
        die('7', 101, 112),                          // 2
        die('8', 150, 150)                           // 87
    ];
    var list = LO.manualDieList(pos, dies);
    assert(list.length === 6, 'точного нет — 6 ближайших', ids(list));
    assert(ids(list) === '2,3,7,1,4,6', 'по близости размера, любая основа и состояние', ids(list));
    assert(list[0].otherBase === true && list[1].otherBase === false, 'другая основа помечена', JSON.stringify(list.map(function(d) { return d.otherBase; })));
    var exact = [die('10', 102, 111), die('11', 102, 111, { revs: 5 }), die('12', 102, 111, { base: 'Бумага' })].concat(dies);
    var withExact = LO.manualDieList(pos, exact);
    assert(withExact.slice(0, 3).every(function(d) { return d.deviation === 0; }), 'точные — первыми', ids(withExact));
    assert(withExact.length === 6, 'вместе с точными — не больше 6, когда точных меньше 6', ids(withExact));
    var many = [];
    for (var i = 0; i < 8; i++) many.push(die('e' + i, 102, 111));
    assert(LO.manualDieList(pos, many.concat(dies)).length === 8, 'точных больше 6 — показываются все точные', String(LO.manualDieList(pos, many.concat(dies)).length));
})();

console.log('\n' + passed + '/' + total + ' passed');
