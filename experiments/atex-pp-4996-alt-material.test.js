// #4996 — альтернативное название Вида сырья в планировании производства.
//
// В отчёт cut_planning добавили колонку alt_material. Разбор (rowsToPlanning) кладёт
// её в отдельное поле materialAlt — обычное имя остаётся на месте, потому что на нём
// стоит детект фольги (isFoil) и fallback-и. resolveCutMaterials показывает альт
// вместо имени из справочника «Вид сырья» и вместо отчётного; альта нет — как раньше.
//
// Run with: node experiments/atex-pp-4996-alt-material.test.js

var M = require('../download/atex/js/production-planning.js');
var planning = M.planning;

var passed = 0, total = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    total++;
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; return; }
    console.log('  expected:', JSON.stringify(expected));
    console.log('  actual:  ', JSON.stringify(actual));
    process.exitCode = 1;
}

// Строка отчёта cut_planning?JSON_KV — поля с боевого примера из тикета #4996.
function row(over) {
    var base = {
        cut_id: '625865',
        cut_material_id: '2208',
        cut_material: 'MWR113L',
        cut_winding: 'OUT',
        cut_roller_width: '110.00',
        cut_length: '1000.00',
        cut_planned_runs: '10'
    };
    Object.keys(over || {}).forEach(function(k) { base[k] = over[k]; });
    return base;
}

function cutByAlt(over) {
    var p = planning.rowsToPlanning([row(over)]);
    return (p.cuts || []).filter(function(c) { return String(c.id) === '625865'; })[0] || {};
}

// ── разбор строки: альт — в отдельное поле, обычное имя не трогаем ──
var c = cutByAlt({ alt_material: 'MCHR ZNAK 3 Special' });
assertEqual(c.materialAlt, 'MCHR ZNAK 3 Special', '#4996: alt_material разбирается в materialAlt');
assertEqual(c.materialName, 'MWR113L', '#4996: обычное имя остаётся в materialName (isFoil и фолбэки на нём)');
assertEqual(cutByAlt({}).materialAlt, '', '#4996: колонки нет — materialAlt пусто');

// ── фольга определяется по обычному имени, а не по альту ──
assertEqual(cutByAlt({ cut_material: 'Плёнка фольгированная MFA', alt_material: 'MCHR ZNAK 3 Special' }).isFoil,
    true, '#4996: isFoil по-прежнему считает обычное имя cut_material');

// ── resolveCutMaterials: альт старше справочника «Вид сырья» и отчётного имени ──
function resolveInst(cuts) {
    var inst = Object.create(M.Controller.prototype);
    inst.cuts = cuts;
    inst.supplies = [{ cutId: '1', positionId: 'p1' }, { cutId: '2', positionId: 'p1' }];
    inst.genPositions = [{ id: 'p1', materialId: '2208' }];
    inst.materialNameById = { '2208': 'ИМЯ ИЗ СПРАВОЧНИКА' };
    inst.healCutBatches = function() {};   // граница: партии сырья тут не участвуют
    return inst;
}
var cuts = [
    { id: '1', materialId: '', materialName: 'MWR113L', materialAlt: 'MCHR ZNAK 3 Special' },
    { id: '2', materialId: '', materialName: 'MWR113L', materialAlt: '' },
    { id: '3', materialId: '', materialName: '', materialAlt: 'АЛЬТ БЕЗ ОБЕСПЕЧЕНИЯ' }
];
M.Controller.prototype.resolveCutMaterials.call(resolveInst(cuts));
assertEqual(cuts[0].materialName, 'MCHR ZNAK 3 Special',
    '#4996: есть альт — показываем его, а не имя из справочника');
assertEqual(cuts[0].materialId, '2208', '#4996: резолв материала при этом работает как раньше');
assertEqual(cuts[1].materialName, 'ИМЯ ИЗ СПРАВОЧНИКА',
    '#4996: альта нет — имя из справочника, прежнее поведение');
assertEqual(cuts[2].materialName, 'АЛЬТ БЕЗ ОБЕСПЕЧЕНИЯ',
    '#4996: альт показывается и у задания без обеспечений (запас)');

console.log('\n' + passed + '/' + total + ' assertions passed');
if (passed !== total) process.exitCode = 1;
