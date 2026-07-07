// #4068 (резерв хвоста дня под дедлайн-фольгу) — СНЯТ в #4085 (модель #3985).
//
// Механизм computeFoilDeadlineReservation + пробный второй проход упаковки удалён. Фольга у своего
// срока теперь обеспечивается локальным штрафом FOIL_NOTEND_COST_MN в слое размещения (перебор точек
// вставки), а не резервированием минут в конце дня. Поведение «фольга оседает в конец дня» проверяется
// в atex-production-planning-4085-slot-placement.test.js и -4085-slot-flag.test.js. Здесь фиксируем,
// что механизм #4068 действительно снят (иначе дрейф вернулся бы незаметно).
//
// Run with: node experiments/atex-production-planning-4068.test.js

var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0, total = 0;
function assert(cond, name) { total++; console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name); if (cond) passed++; else process.exitCode = 1; }

assert(typeof planning.computeFoilDeadlineReservation === 'undefined',
    '#4085: computeFoilDeadlineReservation удалён из экспорта (резерв #4068 снят — фольга штрафом в слое размещения)');

console.log('\n' + passed + '/' + total + ' passed');
