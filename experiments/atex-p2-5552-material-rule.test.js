// ideav/crm#5552 — сырьё позиции без марки в комментарии определяется по правилу планировщика
// («Сырье» в «Плане на производство»): П/Гл — 43, ЭКО — 44, ТОП — 45, Vellum — 56,
// П/П: каучук 47 / матовый 55, акрил 52 / матовый 53. Марка в комментарии важнее правила.
// Run with: node experiments/atex-p2-5552-material-rule.test.js
var passed = 0, total = 0;
function assert(cond, name) { total++; console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name); if (cond) passed++; else process.exitCode = 1; }
var LI = require('../download/atex-p2/js/label-import-core.js');

var mats = [['1', '0043 SG/HM/YG'], ['2', '0044 TE/HM/YG'], ['3', '0045 TT/HM/YG'], ['4', '0047 PP/HM/G'], ['5', '0052 PP/A/G'],
    ['6', '0053 PP/A/G'], ['7', '0055 PP/HM/G'], ['8', '0056 VP/HM/YG'], ['9', '0060 SG/HM/YG'], ['10', 'ПП белый каучук']]
    .map(function(m) { return { id: m[0], name: m[1], base: /PP|ПП/.test(m[1]) ? 'ПП' : 'Бумага', glue: '' }; });
function pick(nom, code) {
    var r = LI.matchMaterial(LI.parseNomenclature(nom), mats, code);
    return r.ok ? r.name : 'FAIL: ' + r.reason;
}
assert(pick('80 х 100 4000 шт. П/Гл каучук вт 76 (П)') === '0043 SG/HM/YG', 'П/Гл → 0043');
assert(pick('80 х 100 4000 шт. п/гл каучук вт 76') === '0043 SG/HM/YG', 'регистр обозначения не важен');
assert(pick('58 х 73 3000 шт. ЭКО каучук вт 76 (П)') === '0044 TE/HM/YG', 'ЭКО → 0044');
assert(pick('58 х 40 5000 шт. ТОП каучук вт 76 (П)') === '0045 TT/HM/YG', 'ТОП → 0045');
assert(pick('16 х 16 5000 шт. Vellum каучук вт 76 (П)') === '0056 VP/HM/YG', 'Vellum → 0056');
assert(pick('18 х 18 20000 шт. П/П каучук вт 76 (П)') === '0047 PP/HM/G', 'П/П каучук → 0047');
assert(pick('D-20 10000 шт. П/П вт 76 (П)') === '0047 PP/HM/G', 'П/П без клея → каучук, 0047');
assert(pick('105 х 115 1000 шт. П/П матовый каучук вт 40 (П)') === '0055 PP/HM/G', 'П/П матовый каучук → 0055');
assert(pick('15 х 15 20000 шт. П/П акрил вт 40 (П)') === '0052 PP/A/G', 'П/П акрил → 0052');
assert(pick('15 х 15 10000 шт. П/П матовый акрил вт 76 (П)') === '0053 PP/A/G', 'П/П матовый акрил → 0053');
assert(pick('58 х 60 1500 шт. П/Гл каучук вт 76 (П)', '0060 SG/HM/YG') === '0060 SG/HM/YG', 'марка из комментария важнее правила');
assert(LI.materialNumber(LI.parseNomenclature('10 х 10 100 шт. неизвестно вт 76')) === 0, 'неизвестное обозначение — правила нет');
var noRule = LI.matchMaterial(LI.parseNomenclature('15 х 15 100 шт. П/П акрил вт 40'), mats.filter(function(m) { return m.id !== '5'; }), '');
assert(!noRule.ok, 'марки с нужным номером нет в справочнике — сырьё не угадывается');
console.log(passed + '/' + total);
