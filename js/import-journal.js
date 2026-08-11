// ЖУРНАЛ ПЕРЕНОСА — общий инструмент для всех импортёров (issue #4704).
//
// Любой перенос данных извне (Excel → модель дэшборда, Excel → таблицы, выгрузка 1С, миграция)
// упирается в одно и то же: часть содержимого перенести нельзя — формула на внешний источник,
// строка без ключа, нераспознанный тип, объединённая ячейка. Это не ошибка импортёра и не повод
// молчать: оператор должен увидеть ПОЛНЫЙ список того, что осталось за бортом, а разработчик —
// получить его готовым тикетом.
//
// Поэтому журнал живёт ОДИН на все импортёры и здесь, а не внутри конкретного конвертора:
//   • единый формат записи — источник, адрес, что, почему;
//   • единые виды (`KINDS`) с человеческими заголовками — их набор пополняется здесь, и новый
//     импортёр получает их даром;
//   • единая сборка markdown, готового к прямой вставке в issue репозитория;
//   • единая сводка «перенесено N, осталось M» — её показывает экран.
//
// Импортёр не форматирует и не сортирует ничего сам: он только добавляет записи.
//
(function () {
    'use strict';

    // Виды непереносимого. Заголовок — то, как раздел называется в issue; hint — почему так вышло.
    // Новый вид добавляется СЮДА, а не в код импортёра: иначе у каждого свои формулировки и
    // разработчик по тикету не понимает, одна это беда или три разных.
    var KINDS = {
        'formula':      { title: 'Формулы, которые не перенеслись',
                          hint: 'формула ссылается за пределы переносимой области' },
        'unnamed-row':  { title: 'Строки без имени',
                          hint: 'ключ записи взять неоткуда' },
        'merge':        { title: 'Объединённые ячейки',
                          hint: 'приёмник не воспроизводит объединения' },
        'unknown-type': { title: 'Нераспознанные значения',
                          hint: 'тип значения не сопоставлен с колонкой приёмника' },
        'skipped':      { title: 'Пропущено осознанно',
                          hint: 'содержимое не относится к переносимой модели' },
        'other':        { title: 'Прочее', hint: '' }
    };

    // Журнал одного переноса. context: { tool, source, target } — чем переносили, откуда, куда.
    function createJournal(context) {
        var ctx = context || {};
        var entries = [];
        var counters = { moved: 0 };

        // Запись: { kind, where, address, what, why }.
        //   where   — лист/таблица/файл, в котором нашлось;
        //   address — точное место (ячейка, строка, id) — по нему находят глазами;
        //   what    — исходное содержимое КАК ЕСТЬ, без пересказа;
        //   why     — почему не перенеслось, человеческим языком.
        function add(entry) {
            var e = entry || {};
            var kind = KINDS[e.kind] ? e.kind : 'other';
            entries.push({
                kind: kind,
                where: e.where == null ? '' : String(e.where),
                address: e.address == null ? '' : String(e.address),
                what: e.what == null ? '' : String(e.what),
                why: e.why == null ? (KINDS[kind].hint || '') : String(e.why)
            });
            return entries.length;
        }

        // Сколько перенеслось — считает импортёр, журнал только хранит: без этого числа список
        // непереносимого читается как «всё сломалось».
        function moved(n) { counters.moved = Number(n) || 0; return counters.moved; }

        function all() { return entries.slice(); }
        function count() { return entries.length; }
        function byKind() {
            var out = {};
            entries.forEach(function (e) { (out[e.kind] = out[e.kind] || []).push(e); });
            return out;
        }
        function summary() {
            return { moved: counters.moved, skipped: entries.length, byKind: (function () {
                var c = {}; entries.forEach(function (e) { c[e.kind] = (c[e.kind] || 0) + 1; }); return c;
            })() };
        }

        // Markdown для issue. Заголовок называет инструмент и источник — по тикету должно быть
        // понятно, что и чем переносили, без переписки.
        function toIssueMarkdown() {
            var title = 'Не перенеслось: ' + (ctx.source || 'источник не назван');
            var out = ['## ' + title, ''];
            if (ctx.tool) out.push('Инструмент: `' + ctx.tool + '`' + (ctx.target ? ', приёмник: ' + ctx.target : ''), '');
            var s = summary();
            out.push('Перенесено записей: **' + s.moved + '**, осталось за бортом: **' + s.skipped + '**.', '');
            if (!entries.length) { out.push('Перенеслось всё.'); return out.join('\n'); }
            var groups = byKind();
            Object.keys(groups).forEach(function (kind) {
                out.push('### ' + KINDS[kind].title + ' — ' + groups[kind].length, '');
                out.push('| где | адрес | что | почему |');
                out.push('|---|---|---|---|');
                groups[kind].forEach(function (e) {
                    out.push('| ' + cell(e.where) + ' | `' + e.address + '` | `' + cell(e.what) + '` | ' + cell(e.why) + ' |');
                });
                out.push('');
            });
            return out.join('\n');
        }
        function cell(s) { return String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\n+/g, ' '); }

        // Строки для записи журнала в таблицу базы (у кого она есть): плоско, без markdown.
        function toRows() {
            return entries.map(function (e) {
                return { tool: ctx.tool || '', source: ctx.source || '', kind: e.kind,
                         where: e.where, address: e.address, what: e.what, why: e.why };
            });
        }

        return { add: add, moved: moved, all: all, count: count, byKind: byKind,
                 summary: summary, toIssueMarkdown: toIssueMarkdown, toRows: toRows, context: ctx };
    }

    var api = { createJournal: createJournal, KINDS: KINDS };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (typeof window !== 'undefined') window.ImportJournal = api;
})();
