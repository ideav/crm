// ideav/crm#5425 — нормативы переналадки Фазы 2 (высечка), согласованы с заказчиком:
//   замена втулки — 12 мин (DIE_SLEEVE_CHANGE_MN);
//   замена ножа — 30 мин (DIE_KNIFE_CHANGE_MN);
//   замена вала (меняется вместе с ножом) — 60 мин (DIE_CYLINDER_CHANGE_MN);
//   запуск туррели (полная наладка) — 120 мин (DIE_TURRET_CYLINDER_CHANGE_MN).
// Проверяется поведение: умолчания, минуты наладки по виду смены на обычном станке и туррели,
// первая наладка пустого станка, обратное чтение вида наладки по записанным минутам.
// Run with: node experiments/atex-p2-5425-changeover-norms.test.js
'use strict';

var total = 0, passed = 0;
function assert(cond, msg, extra) {
    total++;
    if (cond) { passed++; console.log('PASS — ' + msg); }
    else { console.log('FAIL — ' + msg + (extra !== undefined ? '  ' + extra : '')); process.exitCode = 1; }
}

var P = require('../download/atex-p2/js/die-planning-core.js').core;
var S = P.readSettings([], 'ateh1');
function J(id, o) {
    return Object.assign({ id: String(id), positionId: 'p' + id, dieId: 'k1', cylinderId: 'c1', cylinder: '96',
        materialId: 'm1', footage: 3000, rolls: 1, sleeve: 'Втулка картонная (40мм/3мм/1000мм)', sleeveWidth: 100 }, o || {});
}
var T = { id: 'T', name: 'туррель', stopMaterials: [], turret: true };
var M = { id: 'M', name: 'обычный', stopMaterials: [] };
var a = J(1);
var knife = J(2, { dieId: 'k2' });
var cyl = J(3, { dieId: 'k3', cylinderId: 'c3' });
var sleeve = J(4, { sleeve: '3" (76 мм)' });

assert(S.sleeveChange === 12 && S.knifeChange === 30 && S.cylinderChange === 60 && S.turretCylinderChange === 120,
    'умолчания: втулка 12, нож 30, вал 60, туррель 120', JSON.stringify(S));

[[M, 'обычный станок', 60], [T, 'туррель', 120]].forEach(function(c) {
    var m = c[0];
    var got = [P.setupMinutes(a, sleeve, S, m), P.setupMinutes(a, knife, S, m), P.setupMinutes(a, cyl, S, m),
        P.setupMinutes(null, a, S, m), P.setupMinutes(a, J(5), S, m)];
    assert(got.join() === [12, 30, c[2], c[2], 0].join(),
        c[1] + ': втулка 12, нож 30, вал ' + c[2] + ', пустой станок ' + c[2] + ', та же оснастка 0', got.join());
    [[12, 'sleeve'], [30, 'knife'], [c[2], 'cylinder'], [0, 'none']].forEach(function(k) {
        assert(P.kindOfSetup(k[0], S, m) === k[1], c[1] + ': записанные ' + k[0] + ' мин — ' + k[1], P.kindOfSetup(k[0], S, m));
    });
});

console.log('\n' + passed + '/' + total + ' passed');
