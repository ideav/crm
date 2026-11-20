// ideav/crm#5551 — разбор числа мастер-рулонов из комментария 1С на живых строках файла «Заказы этикеток 16.11».
//   P1  ширина диапазоном «0,246-270 х 2000 (П) - 17 шт» — строка не теряется (заказ 6514: 2 + 4 + 17 = 23);
//   P2  строки «со склада высечки» без количества не считаются;
//   P3  рулоны не стандартной длины («0,240 х 1000 (П) - 1 шт») пересчитываются в МР длины из настройки:
//       3 шт × 1000 м = 1,5 МР по 2000 м (заказ 6539).
// rules: none (defect #5551)
// Фикстуры обезличены. Run with: node experiments/atex-p2-5551-mr-comment-parse.test.js

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

var LI = require('../download/atex-p2/js/label-import-core.js');

var c6514 = 'MONOCHROME 0045 TT/HM/YG 0,312 х 2000 (П) - 2 шт\n' +
    'MONOCHROME 0045 TT/HM/YG 0,318 х 2000 (П) - 4 шт\n' +
    '0046 TT /F/YG 0,315 х 2000 (П) - со склада высечки, шт смена ножа\n' +
    '0046 TT /F/YG 0,266 х 2000 (П),  0045 TT/HM/YG 0,258 х 2000 (П) со склада высечки\n' +
    'MONOCHROME 0045 TT/HM/YG 0,246-270 х 2000 (П) - 17 шт';
assert(JSON.stringify(LI.mrCountFromComment(c6514)) === '[2,4,17]', 'P1/P2: 6514 → [2, 4, 17]', JSON.stringify(LI.mrCountFromComment(c6514)));

var c6539 = 'сработать три вида сырья с РЕТ подложкой по 1 км\n' +
    'MONOCHROME 0074 SG/HM/PE 0,240 х 1000 (П) - 1 шт\n' +
    'MONOCHROME 0075 PP/A/PE 0,240 х 1000 (П) - 1 шт, \n' +
    'MONOCHROME 0076 PP/A/PE 0,240 х 1000 (П) - 1 шт';
assert(JSON.stringify(LI.mrCountFromComment(c6539)) === '[1,1,1]', 'P3: 6539 → [1, 1, 1] штук');

// Сверка: нож 5 ручьёв × 8 на раппорте, вал 330,2 мм; 1000 рул × 5000 → 20,64 МР
var mr = { types: { 'нож а': { streams: 5, perRepeat: 8, repeatMm: 330.2 } }, mrLength: 2000 };
var r1 = LI.checkMasterRolls({ label: { perRoll: 5000 }, rolls: 1000, knifeType: 'Нож А', comment: c6514 }, mr);
assert(r1.calc === 20.64 && r1.file === 23, 'P1: 6514 — в файле 23 МР (не 6)', JSON.stringify(r1));

// 6539: те же 3 шт по 1000 м = 1,5 МР по 2000 м
var mr2 = { types: { 'нож б': { streams: 1, perRepeat: 1, repeatMm: 1000 } }, mrLength: 2000 };
var r2 = LI.checkMasterRolls({ label: { perRoll: 3000 }, rolls: 1, knifeType: 'Нож Б', comment: c6539 }, mr2);
assert(r2.file === 1.5 && r2.calc === 1.5 && r2.warning === '', 'P3: 6539 — 3 шт × 1000 м = 1,5 МР, совпадает с расчётом 1,5', JSON.stringify(r2));

console.log('\n' + passed + '/' + total + ' passed');
