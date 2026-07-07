// Тесты #4085 (Стадия 5) — флаг SLOT_PLACEMENT включает живой слой размещения (модель #3985).
//
// Слой врезан в buildSequenceOps/runGenerateCuts за ФЛАГОМ контроллера slotPlacementOn(): читает
// «Настройку» SLOT_PLACEMENT. По умолчанию (нет настройки) — ВЫКЛ → прежний путь (chooseSlitterBySetup/
// rebalance/orderCuts), контракт неизменен (это доказывает полный existing-прогон, 100/100 зелёных).
// Здесь проверяем сам гейт: как читается настройка. Живое поведение флаг-ON — на ateh (report/object
// таймаутят в этой среде).
//
// Run with: node experiments/atex-production-planning-4085-slot-flag.test.js

var Controller = require('../download/atex/js/production-planning.js').Controller;

var passed = 0, total = 0;
function assert(cond, name) { total++; console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name); if (cond) passed++; else process.exitCode = 1; }

function slotOn(daySettings) { return Controller.prototype.slotPlacementOn.call({ daySettings: daySettings }); }

assert(Controller && typeof Controller.prototype.slotPlacementOn === 'function', '#4085: slotPlacementOn определён на контроллере');
assert(slotOn({ SLOT_PLACEMENT: '1' }) === true, '#4085: SLOT_PLACEMENT="1" → слой ВКЛ');
assert(slotOn({ SLOT_PLACEMENT: 1 }) === true, '#4085: SLOT_PLACEMENT=1 (число) → ВКЛ');
assert(slotOn({ SLOT_PLACEMENT: ' 1 ' }) === true, '#4085: пробелы вокруг "1" тримятся → ВКЛ');
assert(slotOn({ SLOT_PLACEMENT: '0' }) === false, '#4085: SLOT_PLACEMENT="0" → ВЫКЛ');
assert(slotOn({ SLOT_PLACEMENT: 'да' }) === false, '#4085: произвольное значение → ВЫКЛ (только "1" включает)');
assert(slotOn({}) === false, '#4085: настройка отсутствует → ВЫКЛ (безопасный дефолт — прежний путь)');
assert(slotOn(undefined) === false, '#4085: нет daySettings вовсе → ВЫКЛ (без падения)');

console.log('\n' + passed + '/' + total + ' passed');
