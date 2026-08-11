// #4726 (решение заказчика 11.08.2026): «УРЕГУЛИРОВАТЬ НЕ РАССУЖДАЕТ. Его дело — сдвинуть паровоз
// после урегулированного задания, соблюдая ПОТОЛОК ДНЯ и ПОСЛЕДОВАТЕЛЬНОСТЬ заданий, и больше
// ничего».
//
// Пересборка очереди (`autoSequenceQueue` → `planCutOperations`) перебирает места и двигает
// соседей по всему станку. Боевое 11.08.2026, ateh: за 31 минуту 13 сессий записи, 155 перемещений
// между днями, 34 переполнения (до +85 мин), задания ходили по кругу (666229: 13.08 → 14.08 →
// 13.08 → 14.08), и в итоге дни остались недобранными — 426 и 407 при потолке 455.
//
// Правило проверяем по ИСХОДНИКУ: путь «Урегулировать» не должен звать пересборку вовсе. Проверка
// поведенческим тестом тут ничего не стои́т — она подтвердила бы то, что происходит внутри одного
// стаба, а вопрос ровно в том, какой механизм зовётся.
//
// Run with: node experiments/atex-pp-4726-settle-no-resequence.test.js

var fs = require('fs');
var path = require('path');

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

var src = fs.readFileSync(path.resolve(__dirname, '../download/atex/js/production-planning/20-controller.js'), 'utf8');

// Тело `settleDeviations` — от объявления до следующего метода прототипа.
var start = src.indexOf('AtexProductionPlanning.prototype.settleDeviations = function');
assert(start > 0, 'метод «Урегулировать» найден в контроллере');
var rest = src.slice(start + 10);
var end = rest.indexOf('AtexProductionPlanning.prototype.');
var body = rest.slice(0, end > 0 ? end : rest.length);

// ── Чего в нём быть НЕ ДОЛЖНО ────────────────────────────────────────────────────────────
assert(body.indexOf('autoSequenceQueue(') === -1,
    '«Урегулировать» НЕ зовёт пересборку очереди — она перебирает места и двигает соседей');
assert(body.indexOf('autoSequenceQueueAfterMerge(') === -1,
    'и не заходит в общую точку пересборки в обход неё');
assert(!/planCutOperations\s*\(/.test(body),
    'и не строит план заново напрямую');

// ── Что в нём быть ОБЯЗАНО ───────────────────────────────────────────────────────────────
assert(/reconcilePlanStarts\s*\(/.test(body),
    'сдвиг паровоза: старты сводятся ВСТЫК по хранимым минутам — день и порядок не меняются');
assert(/levelOverfilledAfterWrite\s*\(/.test(body),
    'потолок дня: если после сдвига день вылез за смену, последнее задание рвётся, остаток уезжает');

// Порядок шагов: сначала стыкуем, потом режем по потолку — иначе резать нечего.
assert(body.indexOf('reconcilePlanStarts') < body.indexOf('levelOverfilledAfterWrite'),
    'сдвиг идёт ПЕРЕД выравниванием по потолку');

// Рамки действия остаются: свои станки и разморозка своих дней (#4574/#4577).
assert(/settleMoveScope\s*\(/.test(body), 'рамки действия (станки, дни) по-прежнему собираются');
assert(/warnUnderfilledAfterSettle\s*\(/.test(body),
    'недобранный день после урегулирования по-прежнему называется оператору');

console.log('\n' + passed + ' проверок прошли из ' + total);
