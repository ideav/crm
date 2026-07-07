// Тесты #4085 (Стадия 6) — слой размещения #3985 ПО УМОЛЧАНИЮ ВКЛЮЧЁН; SLOT_PLACEMENT=0 — рубильник.
//
// После снятия дрейфа (EDD/жёсткая фольга/резерв #4068) слой размещения стал живым путём по умолчанию.
// slotPlacementOn() возвращает true, если «Настройка» SLOT_PLACEMENT НЕ равна явному "0". Значение "0" —
// аварийный откат на прежний путь (без EDD/жёсткой фольги/резерва; порядок только по переналадке/полосам).
//
// Run with: node experiments/atex-production-planning-4085-slot-flag.test.js

var Controller = require('../download/atex/js/production-planning.js').Controller;

var passed = 0, total = 0;
function assert(cond, name) { total++; console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name); if (cond) passed++; else process.exitCode = 1; }

function slotOn(daySettings) { return Controller.prototype.slotPlacementOn.call({ daySettings: daySettings }); }

assert(Controller && typeof Controller.prototype.slotPlacementOn === 'function', '#4085: slotPlacementOn определён на контроллере');
// Дефолт ВКЛ: настройка отсутствует → слой размещения работает.
assert(slotOn({}) === true, '#4085: настройка отсутствует → слой ВКЛ (дефолт #3985)');
assert(slotOn(undefined) === true, '#4085: нет daySettings вовсе → слой ВКЛ (без падения)');
assert(slotOn({ SLOT_PLACEMENT: '1' }) === true, '#4085: SLOT_PLACEMENT="1" → ВКЛ');
assert(slotOn({ SLOT_PLACEMENT: 'да' }) === true, '#4085: любое НЕ "0" → ВКЛ (дефолт)');
// Аварийный рубильник: только явный "0" выключает.
assert(slotOn({ SLOT_PLACEMENT: '0' }) === false, '#4085: SLOT_PLACEMENT="0" → ВЫКЛ (откат на прежний путь)');
assert(slotOn({ SLOT_PLACEMENT: 0 }) === false, '#4085: SLOT_PLACEMENT=0 (число) → ВЫКЛ');
assert(slotOn({ SLOT_PLACEMENT: ' 0 ' }) === false, '#4085: пробелы вокруг "0" тримятся → ВЫКЛ');

console.log('\n' + passed + '/' + total + ' passed');
