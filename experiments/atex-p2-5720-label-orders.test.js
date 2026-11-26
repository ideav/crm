// ideav/crm#5720 — «Заказы этикетки»: сырьё из заказа 1С, допуски ножей по ступеням,
// не списанные, форма (круг/прямоугольник), отличия альтернативных ножей.
// rules: none (defect #5720)
// Run with: node experiments/atex-p2-5720-label-orders.test.js

process.env.TZ = 'UTC';
var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}
var lp = require('../download/atex/js/label-production.js').core;
var lo = require('../download/atex-p2/js/label-orders.js').core;

// 1. Ступени допуска
assert(lp.dieSizeTolerance(19.9) === 0.1, 'допуск 19,9 -> 0,1');
assert(lp.dieSizeTolerance(10) === 0.1, 'допуск 10 -> 0,1');
assert(lp.dieSizeTolerance(20) === 0.5, 'допуск 20 -> 0,5');
assert(lp.dieSizeTolerance(32.9) === 0.5, 'допуск 32,9 -> 0,5');
assert(lp.dieSizeTolerance(33) === 0.9, 'допуск 33 -> 0,9');
assert(lp.dieSizeTolerance(120) === 0.9, 'допуск 120 -> 0,9');
assert(isNaN(lp.dieSizeTolerance('')) && isNaN(lp.dieSizeTolerance(0)), 'без размера допуска нет');

function die(o) {
    return Object.assign({ id: o.no, no: o.no, width: 50, length: 50, base: '1:Бумага', streams: 4, labelsPerRepeat: 4, selectable: true, writtenOff: false,
        state: 'Рабочий', typeName: '', revs: 0, cylinder: '', repeatMm: '', usedFormat: '', sleeveWidth: 76 }, o);
}
var pos = { width: 18, length: 40, base: 'Бумага', orderStreams: 1, knifeType: '' };

// 2. nearestDies: ступени по каждой стороне
var dies = [
    die({ no: 'a', width: 18.1, length: 40.4 }),
    die({ no: 'b', width: 18.2, length: 40 }),
    die({ no: 'c', width: 18, length: 40.95 })
];
var near = lo.nearestDies(pos, dies).map(function(d) { return d.no; });
assert(near.length === 1 && near[0] === 'a', 'nearestDies: ступени на каждую сторону', JSON.stringify(near));
assert(lo.nearestDies({ width: 25, length: 25, base: 'Бумага' }, [die({ no: 'x', width: 25.5, length: 24.5 }), die({ no: 'y', width: 25.6, length: 25 })]).map(function(d) { return d.no; }).join() === 'x',
    '20..<33: 0,5 включено, 0,6 нет');
assert(lo.nearestDies({ width: 40, length: 90, base: 'Бумага' }, [die({ no: 'z', width: 40.9, length: 90 })]).length === 1, '>=33: 0,9 включено');
assert(lo.nearestDies({ width: 40, length: 90, base: 'Бумага' }, [die({ no: 'z', width: 41.5, length: 90 })]).length === 0, 'нет ножа в допуске -> пустой список');

// 3. Списанные
var wo = [die({ no: 'w', width: 18, length: 40, state: 'Списан', writtenOff: true, selectable: false }),
    die({ no: 'r', width: 18, length: 40, state: 'Резерв', selectable: false }),
    die({ no: 'e', width: 18, length: 40, state: 'На экспертизе', selectable: false })];
var res = lo.nearestDies(pos, wo).map(function(d) { return d.no; });
assert(res.indexOf('w') === -1 && res.indexOf('r') !== -1 && res.indexOf('e') !== -1, 'списанный исключён, Резерв и На экспертизе в списке', res.join());

// 4. Форма
var round = die({ no: 'D51', width: 51, length: 51, typeName: 'D х 51 (76)' });
var sq = die({ no: 'S51', width: 51, length: 51, typeName: '51 х 51 (76)' });
var p51 = { width: 51, length: 51, base: 'Бумага', knifeType: '51 х 51 (80)' };
assert(lo.nearestDies(p51, [round, sq]).map(function(d) { return d.no; }).join() === 'S51', 'квадратной этикетке круглый нож не предлагается');
var p51r = { width: 51, length: 51, base: 'Бумага', knifeType: 'D х 51 (80)' };
assert(lo.nearestDies(p51r, [round, sq]).map(function(d) { return d.no; }).join() === 'D51', 'круглой этикетке только круглый');
var pk = lp.pickDie(p51, [round], {});
assert(pk.ok === false && /форма/.test(pk.reason), 'pickDie: круглый к квадратной - нет ножа', pk.reason);
assert(lp.pickDie(p51r, [round, sq], {}).die.no === 'D51', 'pickDie: круглой выбирается круглый');
var ml = lo.manualDieList(p51, [round, sq]);
assert(ml.filter(function(d) { return d.no === 'D51'; })[0].shapeMismatch === true && ml.filter(function(d) { return d.no === 'S51'; })[0].shapeMismatch === false, 'ручной список помечает несовпадение формы');
assert(lo.manualDieList(pos, [die({ no: 'f', width: 18.5, length: 40 })])[0].outOfTolerance === true, 'ручной список помечает вне допуска');
assert(lo.manualDieList(pos, wo).some(function(d) { return d.writtenOff; }), 'ручной список несёт признак списан');

// 5. pickDie: ступени в близких, настройка не отброшена
var base1 = { width: 18, length: 40, base: 'Бумага', orderStreams: 1 };
var n1 = die({ no: 'n1', width: 18.3, length: 40, streams: 1, labelsPerRepeat: 1 });
assert(lp.pickDie(base1, [n1], { sizeTolerance: 0.5 }).ok === false, 'pickDie: настройка 0,5, но ступень для 18 мм - 0,1');
var n2 = die({ no: 'n2', width: 18.1, length: 40, streams: 1, labelsPerRepeat: 1 });
var r2 = lp.pickDie(base1, [n2], { sizeTolerance: 0.5 });
assert(r2.ok && r2.near, 'pickDie: 18,1 при настройке 0,5 - близкий');
assert(lp.pickDie(base1, [n2], { sizeTolerance: 0.05 }).ok === false, 'pickDie: настройка по-прежнему сужает допуск');

// 6. Отличия альтернативных ножей
var cur = die({ no: 'cur', streams: 4, labelsPerRepeat: 4, cylinder: '80', repeatMm: 254, usedFormat: '210', sleeveWidth: 76, typeName: '50 х 50 (76)' });
var alt = die({ no: 'alt', streams: 3, labelsPerRepeat: 4, cylinder: '80', repeatMm: 254, usedFormat: '160', sleeveWidth: 80, base: '2:Пластик', state: 'Резерв', selectable: false, typeName: 'D х 50 (80)' });
var diffs = lo.dieDiffs(pos, cur, alt).reduce(function(m, o) { m[o.key] = o; return m; }, {});
assert(diffs.streams && diffs.streams.ref === '4' && diffs.streams.alt === '3', 'отличие: ручьёв');
assert(diffs.base && diffs.state && diffs.usedFormat && diffs.sleeve && diffs.shape, 'отличия: основа, состояние, исп. формат, втулка, форма');
assert(!diffs.perRepeat && !diffs.cylinder, 'совпадающее не показывается');
assert(diffs.shape.alt === 'круг' && diffs.shape.ref === 'прямоуг.', 'форма: круг против прямоуг.');
var same = die({ no: 'same', streams: 4, labelsPerRepeat: 4, cylinder: '80', repeatMm: 254, usedFormat: '210', sleeveWidth: 76, typeName: '50 х 50 (76)' });
assert(lo.dieDiffs(pos, cur, same).length === 0, 'идентичный нож без отличий');

// 7. Сырьё из заказа
var note = 'Номенклатура 1С: 85 х 38 5000 шт. П/Гл каучук намотка внутрь вт 76 (П); короб 3; комментарий 1С: срочно';
assert(lp.orderNomenclatureFromNote(note) === '85 х 38 5000 шт. П/Гл каучук намотка внутрь вт 76 (П)', 'номенклатура вынута из Примечания');
assert(lp.orderNomenclatureFromNote('короб 3') === '', 'нет номенклатуры -> пусто');
var om = lp.orderMaterial(lp.orderNomenclatureFromNote(note));
assert(om.material === 'П/Гл' && om.glue === 'каучук', 'сырьё и клей', JSON.stringify(om));
var imp = null;
try { imp = require('../download/atex-p2/js/label-import-core.js'); } catch (e) { imp = null; }
if (imp && imp.parseNomenclature) {
    ['85 х 38 5000 шт. П/Гл каучук намотка внутрь вт 76 (П)', 'D х 40 2000 шт. П/П акрил', '27 х 44 7/1500 шт. намотка внутрь', 'D-20 2000 шт. каучук'].forEach(function(s) {
        var a = imp.parseNomenclature(s), b = lp.orderMaterial(s);
        assert(a && a.material === b.material && a.glue === b.glue, 'как в импорте: ' + s);
    });
} else console.log('SKIP — label-import-core не загрузился в Node');
var row = lo.positionFromRow({ 'РулоновID': '1', 'Ширина, мм': '18', 'Длина, мм': '40', 'Сырьё': '0043 SG/HM/YG', 'Примечание': note, 'Тип ножей': 'D х 40 (76)' }, {});
assert(row.orderNomenclature.indexOf('П/Гл') !== -1 && row.shape === 'round', 'positionFromRow: номенклатура из Примечания, форма из типа ножей');
var info = lo.orderMaterialInfo({ orderNomenclature: '1 х 1 5 шт. П/Гл', material: '0043 SG/HM/YG', base: 'Бумага' });
assert(info.differs === true && info.shown === 'П/Гл', 'подсветка: не совпало с сырьём позиции');
assert(lo.orderMaterialInfo({ orderNomenclature: '1 х 1 5 шт. SG/HM', material: '0043 SG/HM/YG' }).differs === false, 'совпало с названием сырья - без подсветки');
// 8. Живые «Тип ножей» ateh1 без «х» (parseKnifeType их не разбирает)
var LIVE_ROUND = ['D 52 (80)', 'D 20 (70)', 'D 15 (80)', 'D 20 (80) (13 ручьёв)', 'D 20 (70 13/3/3.446)', 'D 20 (70| 3,02/8/6)'];
LIVE_ROUND.forEach(function(t) {
    assert(lp.parseKnifeType(t).ok === false, 'parseKnifeType не разбирает «' + t + '»');
    assert(lp.isRoundKnifeType(t) === true && lp.knifeShape(t) === 'round', 'круглый: «' + t + '»');
});
['85 х 38 (80)', '10 х 10 (70)', '100 х 100', '18 х 18 (80)15 ручъев'].forEach(function(t) { assert(lp.isRoundKnifeType(t) === false && lp.knifeShape(t) === 'rect', 'прямоугольный: «' + t + '»'); });
var d52 = die({ no: 'D52', width: 52, length: 52, typeName: 'D 52 (80)' });
var r52 = die({ no: 'R52', width: 52, length: 52, typeName: '52 х 52 (80)' });
var sqPos = { width: 52, length: 52, base: 'Бумага', knifeType: '52 х 52 (80)' };
assert(lo.nearestDies(sqPos, [d52, r52]).map(function(d) { return d.no; }).join() === 'R52', 'живой D 52 (80) не предлагается квадратной этикетке');
assert(lp.pickDie(sqPos, [d52], {}).ok === false, 'pickDie: D 52 (80) не берётся для квадратной');
var rdPos = lo.positionFromRow({ 'РулоновID': '9', 'Ширина, мм': '20', 'Длина, мм': '20', 'Тип ножей': 'D 20 (80) (13 ручьёв)' }, {});
assert(rdPos.shape === 'round', 'позиция с «D 20 (80) (13 ручьёв)» круглая');
var d20 = die({ no: 'D20', width: 20, length: 20, typeName: 'D 20 (80)' }), r20 = die({ no: 'R20', width: 20, length: 20, typeName: '20 х 20 (80)' });
assert(lo.nearestDies(rdPos, [d20, r20]).map(function(d) { return d.no; }).join() === 'D20', 'круглой позиции живого вида — только круглый нож');
console.log('\n' + passed + '/' + total);
