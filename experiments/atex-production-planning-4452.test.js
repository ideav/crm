// #4452 — «Задание должно иметь партию»: лечение пустой «Партии сырья» и цена пустоты.
//
// ЧТО ЛОВИМ. Отчёт cut_planning «Партию сырья» не отдаёт (rowsToPlanning → batchId:''), она
// приходит отдельным чтением записи (#4155). Задание, у которого её нет, стои́т в очереди с
// batchId='' — а changeoverParts считает смену сырья по `prev.batchId !== next.batchId`, и
// пустая партия даёт ЛОЖНУЮ смену сырья с КАЖДЫМ соседом (MATERIAL_WINDING на ровном месте).
// Отсюда заголовок тикета: «данные о партии утеряны … лишнее время переналадки».
//
// Run with: node experiments/atex-production-planning-4452.test.js

process.env.TZ = 'UTC';
global.window = { db: 'testdb', xsrf: 'x' };
var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

var TIMES = { MATERIAL_WINDING: 15, KNIFE: 30 };
function cut(over) {
    var c = { id: '1', materialId: 'MW411', winding: 'IN', batchId: '', knifeWidths: [100, 100],
              knifeCount: 2, rollerWidth: 0, plannedRuns: 3 };
    Object.keys(over || {}).forEach(function(k) { c[k] = over[k]; });
    return c;
}
function codes(parts) { return (parts || []).map(function(p) { return p.code; }).sort().join(','); }

// ── 1. Партия в цену переналадки не входит (#4481) ───────────────────────────────────────────
// Правило изменено решением заказчика 29.07.2026: поставить другой рулон ТОГО ЖЕ сырья времени
// не требует, поэтому пустая или другая партия наладки не создаёт. Инвариант CUT_BATCH при этом
// остаётся: партия — учётные данные (какой рулон режем) и тай-брейк «не перемонтировать рулон».
(function() {
    var prev = cut({ id: 'A', batchId: '900' });
    var next = cut({ id: 'B', batchId: '' });          // партия утеряна
    assert(codes(planning.changeoverParts(prev, next, TIMES)) === '',
        '#4481: пустая партия у соседа переналадки НЕ создаёт');

    var same = cut({ id: 'B', batchId: '900' });
    assert(codes(planning.changeoverParts(prev, same, TIMES)) === '',
        'КОНТРОЛЬ: та же партия у обоих — переналадки нет');

    var otherMat = cut({ id: 'B', batchId: '900', materialId: 'MR194' });
    assert(codes(planning.changeoverParts(prev, otherMat, TIMES)) === 'MATERIAL_WINDING',
        'КОНТРОЛЬ: смена самого СЫРЬЯ переналадку по-прежнему создаёт');
})();

// ── 2. Резольвер: партия цепочки дробления ───────────────────────────────────────────────────
// Сегменты одной резки режут ОДИН физический рулон: партия сегмента = партии головы.
(function() {
    var head = cut({ id: '10', batchId: '900' });
    var tail = cut({ id: '11', batchId: '' });          // продолжение дня N+1, партия пуста
    var r = planning.healCutBatches([head, tail], { chainHeadById: { '10': '10', '11': '10' } });
    assert(tail.batchId === '900', 'продолжение дробления получает партию ГОЛОВЫ цепочки', '(' + tail.batchId + ')');
    assert(r.healed.length === 1 && r.healed[0].source === 'chain', 'источник лечения — цепочка', '(' + JSON.stringify(r.healed) + ')');
    assert(codes(planning.changeoverParts(head, tail, TIMES)) === '',
        'после лечения голова→продолжение не стои́т смены сырья');
})();

(function() {
    var head = cut({ id: '10', batchId: '' });
    var mid = cut({ id: '11', batchId: '901' });        // партия сохранилась у СРЕДНЕГО сегмента
    var tail = cut({ id: '12', batchId: '' });
    planning.healCutBatches([head, mid, tail], { chainHeadById: { '10': '10', '11': '10', '12': '10' } });
    assert(head.batchId === '901' && tail.batchId === '901',
        'партия берётся у ЛЮБОГО сегмента цепочки, если у головы её нет', '(' + head.batchId + '/' + tail.batchId + ')');
})();

// ── 3. Резольвер: «Расход сырья» — что задание реально списывает ─────────────────────────────
(function() {
    var c = cut({ id: '20', batchId: '' });
    var r = planning.healCutBatches([c], { consumptionByCut: { '20': [{ id: 's1', batchId: '', m2: 0 }, { id: 's2', batchId: '902', m2: 120 }] } });
    assert(c.batchId === '902', 'партия восстановлена из «Расхода сырья»', '(' + c.batchId + ')');
    assert(r.healed[0].source === 'consumption', 'источник лечения — расход', '(' + r.healed[0].source + ')');
})();

// ── 4. Резольвер: FIFO активной партии этого вида сырья (выбор генерации) ────────────────────
var GEN_BATCHES = [
    { id: '801', materialId: 'MW411', dateKey: 20260610, remainder: 500, active: 'X' },
    { id: '802', materialId: 'MW411', dateKey: 20260501, remainder: 0, active: 'X' },   // остатка нет
    { id: '803', materialId: 'MW411', dateKey: 20260605, remainder: 300, active: '0' }, // не в работе
    { id: '804', materialId: 'MW308', dateKey: 20260101, remainder: 900, active: 'X' }  // другое сырьё
];
(function() {
    var c = cut({ id: '30', batchId: '' });
    var r = planning.healCutBatches([c], { genBatches: GEN_BATCHES });
    assert(c.batchId === '801', 'нет ни цепочки, ни расхода → FIFO активной партии своего сырья с остатком', '(' + c.batchId + ')');
    assert(r.healed[0].source === 'fifo', 'источник лечения — FIFO', '(' + r.healed[0].source + ')');
})();

// ── 5. Не разрешилось — ОРЁМ, а не подставляем (crm no-silent-fallback) ──────────────────────
(function() {
    var noMat = cut({ id: '40', batchId: '', materialId: '' });
    var r = planning.healCutBatches([noMat], { genBatches: GEN_BATCHES });
    assert(noMat.batchId === '', 'без «Вида сырья» партия НЕ выдумывается');
    assert(r.unresolved.length === 1 && r.unresolved[0].cutId === '40' && !!r.unresolved[0].reason,
        'неразрешённое задание попадает в отчёт с причиной', '(' + JSON.stringify(r.unresolved) + ')');
})();

(function() {
    var c = cut({ id: '41', batchId: '', materialId: 'MR194' });   // сырья нет среди партий
    var r = planning.healCutBatches([c], { genBatches: GEN_BATCHES });
    assert(c.batchId === '' && r.unresolved.length === 1,
        'нет активной партии этого сырья с остатком → в отчёт, а не молча');
})();

// ── 6. Идемпотентность: у кого партия есть — не трогаем ──────────────────────────────────────
(function() {
    var c = cut({ id: '50', batchId: '900' });
    var r = planning.healCutBatches([c], { genBatches: GEN_BATCHES });
    assert(c.batchId === '900' && r.healed.length === 0 && r.unresolved.length === 0,
        'заполненная партия остаётся своей, лечение — no-op');
})();

// ── 7. Проводка в контроллере: что лечим — то и пишем, что стои́т — то не трогаем ─────────────
// Страж отличает восстановленную партию от хранимой по source: 'own' переписывать нечем, всё
// остальное обязано доехать до базы. Снимок хранимого (batchIdStored) — то, по чему запись плана
// решает «изменилось или нет»: без него вылеченное значение осталось бы только в памяти.
(function() {
    var Controller = require('../download/atex/js/production-planning.js').Controller;
    var c = Object.create(Controller.prototype);
    c.cuts = [
        { id: '60', batchId: '900', materialId: 'MW411', winding: 'IN', slitter: { id: '1' }, plannedRuns: 2, knifeWidths: [100] },
        { id: '61', batchId: '', materialId: 'MW411', winding: 'IN', slitter: { id: '1' }, plannedRuns: 2, knifeWidths: [100] }
    ];
    c.genBatches = GEN_BATCHES;
    c.consumptionByCut = {};
    var r = c.healCutBatches();

    assert(c.cuts[0].batchIdStored === '900' && c.cuts[1].batchIdStored === '',
        'снимок ХРАНИМОГО сделан до лечения (иначе запись решит «не изменилось»)',
        '(' + c.cuts[0].batchIdStored + '/' + JSON.stringify(c.cuts[1].batchIdStored) + ')');
    assert(c.cuts[1].batchId === '801' && r.healed.length === 1, 'пустая партия вылечена в памяти', '(' + c.cuts[1].batchId + ')');

    var own = c.resolveBatchForCut('60');
    assert(own.batchId === '900' && own.source === 'own', 'у задания со своей партией источник = own (запись не нужна)', '(' + JSON.stringify(own) + ')');
    var healed = c.resolveBatchForCut('61');
    assert(healed.batchId === '801' && healed.source === 'fifo', 'вылеченное задание отдаёт партию и НЕ-own источник — страж её запишет', '(' + JSON.stringify(healed) + ')');
    var absent = c.resolveBatchForCut('999');
    assert(absent.batchId === '' && /нет в загруженной очереди/.test(absent.reason), 'неизвестное задание — с причиной, а не молча', '(' + absent.reason + ')');

    assert(codes(planning.changeoverParts(c.cuts[0], c.cuts[1], TIMES)) === '',
        '#4481: РАЗНЫЕ партии одного сырья переналадки не стоят (лечение партии — про учёт, не про время)');
})();

console.log('\n' + passed + '/' + total + ' passed');
