// #4518 — ПРЕДПРОСМОТР «УПОРЯДОЧИТЬ» МЕРИТ ПЛАН ЧИСЛАМИ УПАКОВЩИКА (одна арифметика).
//
// СИМПТОМ (issue #4518, боевой лог, сборка ?118.95). «Упорядочить» показал 21 строку изменений,
// из которых десяток — сдвиги на 2–8 минут внутри одного дня («только время старта»), а лог той же
// кнопки писал ДРУГИЕ числа:
//     [pp] ⚠️ #4444: план упаковщика разошёлся с хранимой наладкой — предпросмотр показан СВЕДЁННЫМ
//                    встык (столько же запишет «Применить»). Заданий: 16.
//     [pp] ⚙️ #4402 предпросмотр «Упорядочить»: переставлено 23
//     [pp-opt] ПЕРЕМЕЩЕНИЯ: 23
//        649125: 30.07 09:08 → 30.07 09:12   (в «Деталях» — 09:08 → 09:10)
//        649076: 30.07 08:49 → 30.07 08:51   (в «Деталях» строки нет вовсе)
//
// ПРИЧИНА. Предпросмотр считал колонки наладки ЗАНОВО (`computeCutSetupUpdates` без `planCols`) —
// вторым расчётом поверх плана упаковщика. День от этого выходил «несведённым», #4444 переписывал
// старты, и оператор получал десяток правок, которых упаковщик не делал. «Применить» при этом
// пишет колонки УПАКОВЩИКА (#4499) — то есть показанное и записываемое считались по-разному.
//
// ПРАВИЛО (#4499, ТЗ §13): сумма минут дня и старты — ОДНА арифметика, её делает упаковщик.
// Предпросмотр берёт `ops.*.planCols` ровно как «Применить».
//
// Что проверяем:
//   A — карта колонок предпросмотра = колонки упаковщика; сегменты дробления адресуются `preview:N`
//       по `createdFrom` (создание без головы в очереди не сбивает нумерацию);
//   B — `planStartDayKey`: переезд на другой день отличим от сдвига времени;
//   C — подпись строки «Деталей» называет то, что реально поменялось (день/станок/время);
//   D — `movedCount` разбора = числу строк списка (панель и «Детали» не спорят).
//
// Run with: node experiments/atex-pp-4518-preview-one-arithmetic.test.js

process.env.TZ = 'Europe/Moscow';
global.window = { db: 'ateh1', xsrf: 'x' };
var P = require('../download/atex/js/production-planning.js').planning;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

function ts(d, h, m) { return Math.floor(new Date(2026, 6, d, h, m, 0).getTime() / 1000); }
function cut(id, o) {
    o = o || {};
    return { id: String(id), materialName: o.mat || 'MR194', winding: o.wind || 'OUT',
             materialId: '1', slitter: { id: String(o.sid || '1282'), label: 'Станок 3' },
             planDate: String(o.ts), number: String(o.ts), plannedRuns: o.runs || 2,
             firstPartId: String(id), knifeWidths: [30, 30], knifeCount: 2,
             storedKnifeSetupMin: '30', storedMaterialWindingMin: '15', storedCutAndLeaderMin: '20' };
}

// ── A. Колонки предпросмотра — от упаковщика, сегменты адресуются по createdFrom ──────────────
(function () {
    var cuts = [cut('A', { ts: ts(30, 8, 0) }), cut('B', { ts: ts(30, 9, 0) })];
    var ops = {
        updates: [{ cutId: 'A', planStartTs: ts(30, 8, 0), planCols: { knife: 30, material: 15, cutTime: 19 } },
                  { cutId: 'B', planStartTs: ts(30, 9, 4), planCols: { knife: 0, material: 15, cutTime: 22 } }],
        creates: [{ parentCutId: 'НЕТ-ТАКОЙ', planStartTs: ts(31, 8, 0), plannedRuns: 3,
                    planCols: { knife: 30, material: 0, cutTime: 40 } },          // головы нет — сегмента не будет
                  { parentCutId: 'B', planStartTs: ts(31, 8, 0), plannedRuns: 5,
                    planCols: { knife: 0, material: 15, cutTime: 55 } }],
        deletes: []
    };
    var projected = P.projectPlanOnCuts(cuts, ops, { slitterById: {} });
    assert(projected.createdIds.length === 1 && String(projected.createdFrom) === '1',
        'A1 сегмент построен из ВТОРОГО создания — createdFrom это фиксирует',
        '(createdIds ' + projected.createdIds + ', createdFrom ' + projected.createdFrom + ')');
    // Ту же карту строит предпросмотр: id задания → колонки упаковщика, `preview:1` → колонки СВОЕГО создания.
    var byCut = {};
    (ops.updates || []).forEach(function (u) { if (u.planCols) byCut[String(u.cutId)] = u.planCols; });
    projected.createdIds.forEach(function (pid, i) {
        var cr = ops.creates[projected.createdFrom[i]];
        if (cr && cr.planCols) byCut[String(pid)] = cr.planCols;
    });
    assert(byCut['preview:1'] && byCut['preview:1'].cutTime === 55,
        'A2 колонки сегмента взяты у СВОЕГО создания, а не у пропущенного соседа',
        '(' + JSON.stringify(byCut['preview:1']) + ')');
    assert(byCut['A'].cutTime === 19 && byCut['B'].knife === 0,
        'A3 колонки заданий — ровно те, что посчитал упаковщик', '(' + JSON.stringify(byCut) + ')');
})();

// ── B. День старта отличим от времени старта ─────────────────────────────────────────────────
(function () {
    assert(P.planStartDayKey(ts(30, 14, 7)) === 20260730 && P.planStartDayKey(ts(31, 14, 7)) === 20260731,
        'B1 planStartDayKey даёт календарный день YYYYMMDD',
        '(' + P.planStartDayKey(ts(30, 14, 7)) + ', ' + P.planStartDayKey(ts(31, 14, 7)) + ')');
    assert(P.planStartDayKey(0) === null && P.planStartDayKey('') === null,
        'B2 пусто/мусор → null (нечего сравнивать)');
})();

// ── C/D. Разбор изменений: подписи и счётчик ─────────────────────────────────────────────────
(function () {
    var snapshot = [
        cut('sameDay', { ts: ts(30, 9, 8) }),                       // сдвиг внутри дня
        cut('nextDay', { ts: ts(30, 14, 7) }),                      // уезжает на завтра
        cut('machine', { ts: ts(30, 10, 0) }),                      // меняет станок, время то же
        cut('both', { ts: ts(30, 11, 0) }),                         // станок + другой день
        cut('intact', { ts: ts(30, 12, 0) })                        // не тронуто
    ];
    var ops = { updates: [
        { cutId: 'sameDay', planStartTs: ts(30, 9, 10) },
        { cutId: 'nextDay', planStartTs: ts(31, 14, 7) },
        { cutId: 'machine', planStartTs: ts(30, 10, 0), slitterId: '1279' },
        { cutId: 'both', planStartTs: ts(31, 15, 32), slitterId: '1277' }
    ], creates: [], deletes: [] };
    var slitterById = { '1282': { label: 'Станок 3' }, '1279': { label: 'Станок 2' }, '1277': { label: 'Станок 1' } };
    var projected = P.projectPlanOnCuts(snapshot, ops, { slitterById: slitterById });
    var changes = P.planChangeRows(snapshot, projected.cuts, [], { slitterById: slitterById, tabIndexById: {} });
    var by = changes.byId;

    assert(by['sameDay'].dayChanged === false && by['nextDay'].dayChanged === true,
        'C1 переезд на другой день помечен, сдвиг внутри дня — нет',
        '(sameDay ' + by['sameDay'].dayChanged + ', nextDay ' + by['nextDay'].dayChanged + ')');

    var label = P.planChangeRest;   // ровно та подпись, что видит оператор в «Деталях»
    assert(label(by['sameDay']) === 'только время старта', 'C2 сдвиг внутри дня — «только время старта»',
        '(' + label(by['sameDay']) + ')');
    assert(label(by['nextDay']) === 'только день', 'C3 уехало на завтра — про день, а не «только время старта»',
        '(' + label(by['nextDay']) + ')');
    assert(label(by['machine']) === 'только станок', 'C4 сменился только станок', '(' + label(by['machine']) + ')');
    assert(label(by['both']) === 'станок и день', 'C5 станок + другой день названы оба',
        '(' + label(by['both']) + ')');
    // Минуты наладки поменялись — подпись про них, а не про станок/день (прежнее поведение #4417).
    var withTiming = P.planChangeRows(snapshot, projected.cuts,
        [{ cutId: 'machine', knife: 30, material: 15, cutTime: 20, wasKnife: '0', wasMaterial: '15', wasCutTime: '20' }],
        { slitterById: slitterById, tabIndexById: {} });
    assert(/наладка ножей 0 → 30 мин/.test(label(withTiming.byId['machine'])),
        'C6 есть изменения минут — подпись про них', '(' + label(withTiming.byId['machine']) + ')');

    assert(changes.movedCount === changes.rows.filter(function (r) { return r.kind === 'moved'; }).length
        && changes.movedCount === 4,
        'D1 movedCount = числу строк «Переставлено» (панель и «Детали» об одном и том же)',
        '(movedCount ' + changes.movedCount + ', строк ' + changes.rows.length + ')');
    assert(!by['intact'], 'D2 нетронутое задание в разбор не попадает');
})();

console.log('\n' + passed + '/' + total + ' passed');
