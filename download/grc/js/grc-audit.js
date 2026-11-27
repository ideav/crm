/* GRC: журнал подтверждений и выгрузка для аудитора - кто, когда и чем подтвердил контроль, сверка цепочки отпечатков. */
(function () {
    'use strict';
    var P = window.Grc, C = P.core;
    var f = { from: '2026-07-01', to: '2026-11-30', tab: 'rows', q: '' };

    function lastFp(M) { var m = {}; M.journal.forEach(function (e) { if (e.action === C.DONE || e.action === C.FAIL) m[e.request] = e; }); return m; }
    function render(host, M) {
        var v = C.verifyChain(M.journal), badBy = {}; v.bad.forEach(function (c) { badBy[c] = 1; });
        var fp = lastFp(M);
        M.reqs.forEach(function (r) { var e = fp[r.code]; r.fp = e ? e.fp : ''; r.jcode = e ? e.code : ''; });
        var rows = C.auditRows(M.reqs, M.ctrlBy, M.camps, f.from, f.to);
        rows.forEach(function (x) { x.broken = !!badBy[x.jcode]; });
        host.innerHTML = '';
        P.head('Журнал и выгрузка для аудитора', 'Каждый ответ владельца - запись журнала с отпечатком, который зависит от предыдущей записи. Правка задним числом рвёт цепочку и видна при сверке.').forEach(function (n) { host.appendChild(n); });
        var bad = v.bad.map(function (c) { return M.journal.filter(function (e) { return e.code === c; })[0]; });
        host.appendChild(P.el('div', { 'class': 'grc-chain ' + (v.ok ? 'grc-chain-ok' : 'grc-chain-bad') }, [
            P.el('b', { text: v.ok ? 'Цепочка журнала сходится' : 'Цепочка журнала не сходится: ' + v.bad.length + ' ' + C.plural(v.bad.length, 'запись', 'записи', 'записей') + ' изменены после подписи' }),
            P.el('div', { text: v.total + ' записей, ' + v.chains + ' ' + C.plural(v.chains, 'цепочка', 'цепочки', 'цепочек') + ' (по владельцам контролей).' })].concat(bad.map(function (e) {
            var r = M.reqs.filter(function (q) { return q.code === e.request; })[0];
            return P.el('div', { 'class': 'grc-line', html: '<b>' + P.esc(e.code) + '</b> · запрос ' + P.esc(e.request) + ' · ' + P.esc(r ? r.ownerName : e.owner) + ' · «' + P.esc(e.action) + '» с датой ' + C.toDmy(e.date) + ' ' + P.esc(e.time) + ': содержимое не совпадает с отпечатком' });
        }))));
        var from = P.input('date', f.from), to = P.input('date', f.to), q = P.input('text', f.q, { placeholder: 'Контроль, владелец, запрос' });
        from.onchange = function () { f.from = from.value; render(host, M); }; to.onchange = function () { f.to = to.value; render(host, M); }; q.onchange = function () { f.q = q.value; render(host, M); };
        var cols = [['control', 'Контроль'], ['name', 'Название'], ['risk', 'Риск'], ['period', 'Период'], ['owner', 'Исполнитель'], ['result', 'Результат'], ['reason', 'Причина'], ['file', 'Файл'], ['when', 'Время ответа'], ['fp', 'Отпечаток']];
        host.appendChild(P.el('div', { 'class': 'grc-bar' }, [P.field('Период с', from), P.field('по', to), P.field('Поиск', q), P.el('span', { 'class': 'grc-grow' }),
            P.btn('Выгрузка для аудитора (CSV)', function () { P.download('Подтверждения контролей ' + C.toDmy(f.from) + '-' + C.toDmy(f.to) + '.csv', C.toCsv(cols, rows)); }, 'grc-primary')]));
        host.appendChild(P.tabs([['rows', 'Контроль - период - исполнитель - файл - время'], ['journal', 'Журнал целиком']], f.tab, function (t) { f.tab = t; render(host, M); }));
        var s = f.q.toLowerCase(), hit = function (t) { return !s || t.toLowerCase().indexOf(s) >= 0; };
        if (f.tab === 'rows') {
            host.appendChild(P.table([
                { t: 'Контроль', html: function (x) { return '<b>' + P.esc(x.control) + '</b> ' + P.esc(x.name); } }, { t: 'Период', k: 'period' }, { t: 'Исполнитель', k: 'owner' },
                { t: 'Результат', html: function (x) { return P.badge(x.result, x.result === C.DONE ? 'ok' : x.result === C.FAIL ? 'crit' : 'mute') + (x.reason ? '<br><small>' + P.esc(x.reason) + '</small>' : ''); } },
                { t: 'Файл', html: function (x) { return x.fileUrl ? '<a href="' + P.esc(x.fileUrl) + '" target="_blank" rel="noopener">' + P.esc(x.file) + '</a>' : ''; } },
                { t: 'Время ответа', k: 'when' },
                { t: 'Отпечаток', html: function (x) { return x.fp ? '<code>' + P.esc(x.fp) + '</code>' + (x.broken ? ' ' + P.badge('правка задним числом', 'crit') : '') : ''; } }
            ], rows.filter(function (x) { return hit(x.control + ' ' + x.name + ' ' + x.owner); }), { rowCls: function (x) { return x.broken ? 'grc-row-bad' : ''; } }));
        } else {
            host.appendChild(P.table([{ t: 'Запись', k: 'code' }, { t: 'Дата', html: function (e) { return C.toDmy(e.date) + ' ' + P.esc(e.time); } }, { t: 'Запрос', k: 'request' },
                { t: 'Действие', k: 'action' }, { t: 'Автор', k: 'author' }, { t: 'Содержание', k: 'content' },
                { t: 'Отпечаток', html: function (e) { return '<code>' + P.esc(e.fp) + '</code>' + (badBy[e.code] ? ' ' + P.badge('не сходится', 'crit') : ''); } }],
                M.journal.filter(function (e) { return e.date >= f.from && e.date <= f.to && hit(e.request + ' ' + e.owner + ' ' + e.author + ' ' + e.content); }).slice().reverse(),
                { rowCls: function (e) { return badBy[e.code] ? 'grc-row-bad' : ''; } }));
        }
    }
    P.mount(function (host, M) { render(host, M); });
})();
