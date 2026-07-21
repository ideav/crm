// #4308 — рабочее место выгрузки/загрузки заказов и заданий (export.js).
//
// Юнит-тесты ЧИСТОГО ядра: проверка целостности файла (buildIntegrityReport), имя файла,
// разбор ссылок. Сеть/DOM/удаление-пересоздание — контроллерные, проверяются в браузере.
//
// Run with: node experiments/atex-export-4308.test.js

var exp = require('../download/atex/js/export.js');

var passed = 0, total = 0;
function assert(cond, name) { total++; console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name); if (cond) passed++; else process.exitCode = 1; }
function eq(a, b, name) { assert(JSON.stringify(a) === JSON.stringify(b), name + (JSON.stringify(a) === JSON.stringify(b) ? '' : ' (got ' + JSON.stringify(a) + ')')); }

// ── refIdPart / isRefCell ───────────────────────────────────────────────────────────────────────
eq(exp.refIdPart('1234:Задание №5'), '1234', '#4308: refIdPart «id:Label» → id');
eq(exp.refIdPart('12,34:A,B'), '12,34', '#4308: refIdPart мультиссылки → «id1,id2»');
eq(exp.refIdPart('600'), '600', '#4308: refIdPart скаляра → как есть');
assert(exp.isRefCell('7:Клиент') === true, '#4308: isRefCell ссылки');
assert(exp.isRefCell('OUT') === false, '#4308: isRefCell скаляра — false');

// ── exportFileName ──────────────────────────────────────────────────────────────────────────────
var d = new Date(2026, 6, 21, 9, 5);   // 2026-07-21 09:05 (локальное)
eq(exp.exportFileName(d, { orders: true, tasks: true }), '2026-07-21_09-05_заказы_задания.json', '#4308: имя файла оба дерева');
eq(exp.exportFileName(d, { orders: true, tasks: false }), '2026-07-21_09-05_заказы.json', '#4308: имя файла только заказы');
eq(exp.exportFileName(d, { orders: false, tasks: true }), '2026-07-21_09-05_задания.json', '#4308: имя файла только задания');

// ── Полный самодостаточный файл (заказы+задания) — целостность OK ───────────────────────────────
function pkg(tables, extra) {
    var counts = {}; Object.keys(tables).forEach(function(k) { counts[k] = tables[k].records.length; });
    return Object.assign({ format: exp.FORMAT, version: exp.SCHEMA_VERSION, tables: tables, counts: counts }, extra || {});
}
// (реальные id Integram — числовые; ссылки хранятся как «id:Подпись»)
(function () {
    var p = pkg({
        order: { records: [{ id: '10', up: '1', values: {} }] },
        position: { records: [{ id: '20', up: '10', values: {} }] },
        cut: { records: [{ id: '30', up: '1', values: { 'ID первой части': '30' } }] },
        batch: { records: [{ id: '40', up: '30', values: { 'ID заказа': '10' } }] },
        supply: { records: [{ id: '50', up: '20', values: { 'Партия ГП': '40:Партия' } }] }
    });
    var r = exp.buildIntegrityReport(p);
    assert(r.ok, '#4308: самодостаточный файл (заказы+задания, все ссылки резолвятся) — OK');
    eq(r.trees, { orders: true, tasks: true }, '#4308: определены оба дерева');
    eq(r.errors, [], '#4308: без ошибок');
})();

// ── Задания без заказов — НЕ самодостаточен (Обеспечение висит на позиции) ───────────────────────
(function () {
    var p = pkg({
        cut: { records: [{ id: '30', up: '1', values: {} }] },
        supply: { records: [{ id: '50', up: '20', values: { 'Партия ГП': '40:x' } }] }
    });
    var r = exp.buildIntegrityReport(p);
    assert(!r.ok, '#4308: задания без заказов — целостность НЕ ОК');
    assert(r.errors.some(function(e) { return /не самодостаточен/i.test(e); }), '#4308: ошибка «файл не самодостаточен»');
})();

// ── Битые ссылки: supply ссылается на несуществующую резку/партию ───────────────────────────────
(function () {
    var p = pkg({
        order: { records: [{ id: '10', up: '1', values: {} }] },
        position: { records: [{ id: '20', up: '10', values: {} }] },
        cut: { records: [{ id: '30', up: '1', values: {} }] },
        batch: { records: [{ id: '40', up: '30', values: {} }] },
        supply: { records: [{ id: '50', up: '20', values: { 'Партия ГП': '99:нет' } }] }
    });
    var r = exp.buildIntegrityReport(p);
    assert(!r.ok, '#4308: битая ссылка supply→Партия ГП — НЕ ОК');
    assert(r.errors.some(function(e) { return /ссыл/i.test(e); }), '#4308: ошибка о битых ссылках');
})();

// ── Висячий родитель: позиция ссылается на несуществующий заказ ─────────────────────────────────
(function () {
    var p = pkg({
        order: { records: [{ id: '10', up: '1', values: {} }] },
        position: { records: [{ id: '20', up: '99', values: {} }] }
    });
    var r = exp.buildIntegrityReport(p);
    assert(!r.ok, '#4308: позиция с несуществующим заказом-родителем — НЕ ОК');
    assert(r.errors.some(function(e) { return /родитель/i.test(e); }), '#4308: ошибка о родителе (up)');
})();

// ── Несовпадение счётчиков ──────────────────────────────────────────────────────────────────────
(function () {
    var p = pkg({ order: { records: [{ id: '10', up: '1', values: {} }] } });
    p.counts.order = 5;   // соврали
    var r = exp.buildIntegrityReport(p);
    assert(!r.ok && r.errors.some(function(e) { return /заявлено 5/.test(e); }), '#4308: несовпадение счётчиков — ошибка');
})();

// ── Чужой формат ────────────────────────────────────────────────────────────────────────────────
(function () {
    var r = exp.buildIntegrityReport({ format: 'что-то', tables: {} });
    assert(!r.ok && r.errors.some(function(e) { return /формат/i.test(e); }), '#4308: чужой формат файла — ошибка');
})();

// ── Только заказы — самодостаточно ──────────────────────────────────────────────────────────────
(function () {
    var p = pkg({
        order: { records: [{ id: '10', up: '1', values: {} }, { id: '11', up: '1', values: {} }] },
        position: { records: [{ id: '20', up: '10', values: {} }, { id: '21', up: '11', values: {} }] }
    });
    var r = exp.buildIntegrityReport(p);
    assert(r.ok, '#4308: только заказы (заказ+позиции) — самодостаточно, OK');
    eq(r.trees, { orders: true, tasks: false }, '#4308: дерево только orders');
})();

console.log('\n' + passed + '/' + total + ' passed');
