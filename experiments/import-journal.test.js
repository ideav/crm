// Журнал переноса — общий инструмент всех импортёров (issue #4704).
//
// Проверяем то, ради чего он вынесен из конкретного конвертора: единый формат записи, единые
// названия видов, сводка «перенесено / осталось» и текст, который можно вставить в issue как есть.
//
// Run with: node experiments/import-journal.test.js

var IJ = require('../js/import-journal.js');

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

var j = IJ.createJournal({ tool: 'dash-import', source: 'Лангемак — финмодель', target: 'модель дэшборда' });
j.add({ kind: 'formula', where: 'лист «Лист1»', address: 'C9', what: '=C8*I1',
        why: 'ссылка на параметр вне переносимой области' });
j.add({ kind: 'unnamed-row', where: 'лист «Лист1»', address: 'C6', what: 'строка с числами без подписи' });
j.add({ kind: 'merge', where: 'лист «Лист1»', address: 'A76:B76', what: 'объединённые ячейки' });
j.moved(70);

// ── Формат записи ────────────────────────────────────────────────────────────────────────
assert(j.count() === 3, 'записи копятся', String(j.count()));
var first = j.all()[0];
assert(['kind', 'where', 'address', 'what', 'why'].every(function (k) { return k in first; }),
    'у записи ровно поля общего формата: вид, где, адрес, что, почему', JSON.stringify(Object.keys(first)));
assert(j.all()[1].why === IJ.KINDS['unnamed-row'].hint,
    'причину можно не писать — подставляется общая формулировка вида', j.all()[1].why);
assert(j.add({ kind: 'выдуманный-вид', what: 'x' }) === 4 && j.all()[3].kind === 'other',
    'неизвестный вид не теряется и не ломает разбор — уходит в «Прочее»');

// ── Сводка ───────────────────────────────────────────────────────────────────────────────
var s = j.summary();
assert(s.moved === 70 && s.skipped === 4, 'сводка называет и перенесённое, и оставшееся', JSON.stringify(s));
assert(s.byKind.formula === 1 && s.byKind.merge === 1, 'сводка разложена по видам', JSON.stringify(s.byKind));

// ── Текст для issue ──────────────────────────────────────────────────────────────────────
var md = j.toIssueMarkdown();
assert(/^## Не перенеслось: Лангемак — финмодель/.test(md), 'заголовок называет источник');
assert(/Инструмент: `dash-import`, приёмник: модель дэшборда/.test(md),
    'issue называет инструмент и приёмник — без переписки понятно, что и чем переносили');
assert(/Перенесено записей: \*\*70\*\*, осталось за бортом: \*\*4\*\*/.test(md),
    'сводка идёт ПЕРЕД списком: список без неё читается как «всё сломалось»');
assert(md.indexOf('### ' + IJ.KINDS.formula.title + ' — 1') !== -1,
    'раздел назван общим заголовком вида и числом записей');
assert(/\| лист «Лист1» \| `C9` \| `=C8\*I1` \| ссылка на параметр вне переносимой области \|/.test(md),
    'строка таблицы: где, адрес, исходное содержимое, причина');

// Труба в тексте не должна ломать markdown-таблицу.
var j2 = IJ.createJournal({ tool: 't', source: 'f' });
j2.add({ kind: 'formula', where: 'л', address: 'A1', what: 'IF(a|b)', why: 'причина|с трубой' });
assert(/`IF\(a\\\|b\)`/.test(j2.toIssueMarkdown()), 'вертикальная черта в содержимом экранируется');

// Пустой журнал — это тоже ответ, а не пустая страница.
var j3 = IJ.createJournal({ tool: 't', source: 'f' });
j3.moved(12);
assert(/Перенеслось всё\./.test(j3.toIssueMarkdown()), 'пустой журнал прямо говорит «перенеслось всё»');

// ── Строки для таблицы журнала в базе ────────────────────────────────────────────────────
var rows = j.toRows();
assert(rows.length === 4 && rows[0].tool === 'dash-import' && rows[0].source === 'Лангемак — финмодель',
    'плоские строки для записи журнала в базу несут инструмент и источник', JSON.stringify(rows[0]));

console.log('\n' + passed + ' проверок прошли из ' + total);
