/* PIM: выгрузка в шаблон площадки или B2B-сети. Предпросмотр пакета (что в порядке, что с ошибкой и почему), файл CSV/Excel, журнал «что кому отдано, какая версия карточки». */
(function () {
    'use strict';
    var W = window.Pim, C = W.core, S = { tab: 'make', chan: '', cat: '', all: false }, M = null;

    function dl(name, text, mime) {
        var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: mime })); a.download = name; document.body.appendChild(a); a.click(); a.remove();
    }
    function build() {
        var ch = M.chan(S.chan), cards = M.products.filter(function (p) { return (S.all || p.status === 'Готово к выгрузке') && (!S.cat || p.category === S.cat); });
        return { ch: ch, cards: cards, ex: C.buildExport(cards, ch, M.chanAttrs, M) };
    }
    function stamp(name) { return W.TODAY + '-' + name.replace(/[^A-Za-zА-Яа-я0-9]+/g, '_'); }
    function nextNo(chan) { return M.journal.filter(function (j) { return j['Площадка'] === chan; }).length + 1; }

    function record(b, format, host) {
        if (!W.caps().feed) return Promise.resolve();
        var no = nextNo(b.ch.name), name = b.ch.name + ' ' + W.TODAY + ' №' + no, ops = [];
        ops.push({ op: 'new', id: 'Выгрузка', up: 1, fields: { 'Выгрузка': name, 'Площадка': b.ch.name, 'Дата выгрузки': W.TODAY, 'Автор': W.ctx.user || '', 'Формат': format, 'Строк': String(b.ex.ok.length), 'Ошибок': String(b.ex.bad.length), 'Получатель': b.ch.name + (b.ch.type === 'B2B-сеть' ? ' (по почте закупщику)' : ' (файл в личный кабинет)'), 'Комментарий': S.cat ? 'Категория: ' + S.cat : '' } });
        b.ex.ok.forEach(function (r) { ops.push({ op: 'new', id: 'Строка выгрузки', up: ':id0', fields: { 'Строка выгрузки': r.p.sku, 'Товар': r.p.sku, 'Версия': String(r.p.version), 'Результат': 'Сформирована' } }); });
        b.ex.bad.forEach(function (r) { ops.push({ op: 'new', id: 'Строка выгрузки', up: ':id0', fields: { 'Строка выгрузки': r.p.sku, 'Товар': r.p.sku, 'Версия': String(r.p.version), 'Результат': 'Не выгружена', 'Причина': r.reasons[0] } }); });
        return W.batch(ops).then(function (res) { M.journal.push({ _id: res[0].id, 'Выгрузка': name, 'Площадка': b.ch.name, 'Дата выгрузки': W.dmy(W.TODAY), 'Автор': W.ctx.user, 'Формат': format, 'Строк': String(b.ex.ok.length), 'Ошибок': String(b.ex.bad.length), 'Получатель': b.ch.name }); W.toast('Выгрузка записана в журнал: ' + name); render(host); });
    }

    function make(host) {
        var chs = W.select(M.channels.map(function (c) { return [c.name, c.name]; }), S.chan); chs.addEventListener('change', function () { S.chan = chs.value; render(host); });
        var cat = W.select([['', 'Все категории']].concat(Object.keys(M.categories).map(function (c) { return [c, c]; })), S.cat); cat.addEventListener('change', function () { S.cat = cat.value; render(host); });
        var all = W.el('input', { type: 'checkbox' }); all.checked = S.all; all.addEventListener('change', function () { S.all = all.checked; render(host); });
        host.appendChild(W.el('div', { 'class': 'pim-bar' }, [W.field('Площадка / сеть', chs), W.field('Категория', cat), W.el('label', { 'class': 'pim-field' }, [W.el('span', { text: 'Включая карточки не в статусе «Готово»' }), all])]));
        var b = build(), n = b.cards.length;
        host.appendChild(W.el('p', { 'class': 'pim-sub', text: 'Шаблон: ' + (b.ch.format || '—') + '. Лимит названия ' + b.ch.titleLimit + ' симв., минимум фото ' + b.ch.minPhotos + '. Справочник атрибутов площадки демонстрационный, обмен по API не подключён (' + (b.ch.api || '') + ').' }));
        host.appendChild(W.el('div', { 'class': 'pim-kpis' }, [W.el('div', { 'class': 'pim-kpi', html: '<small>В пакете</small><b>' + n + '</b>' }), W.el('div', { 'class': 'pim-kpi', html: '<small>В порядке</small><b style="color:var(--w-green)">' + b.ex.ok.length + '</b>' }),
            W.el('div', { 'class': 'pim-kpi', html: '<small>С ошибками</small><b style="color:' + (b.ex.bad.length ? 'var(--w-red)' : 'inherit') + '">' + b.ex.bad.length + '</b>' })]));
        var name = stamp(b.ch.name);
        var bar = W.el('div', { 'class': 'pim-bar' });
        bar.appendChild(W.btn('Скачать CSV (' + b.ex.ok.length + ' строк)', function () { if (!b.ex.ok.length) { W.toast('Нет корректных строк', true); return; } dl(name + '.csv', C.toCsv(b.ex.columns, b.ex.ok.map(function (r) { return r.cells; })), 'text/csv;charset=utf-8'); record(b, 'CSV', host); }, 'pim-primary'));
        bar.appendChild(W.btn('Скачать Excel (.xls)', function () { if (!b.ex.ok.length) { W.toast('Нет корректных строк', true); return; } dl(name + '.xls', C.toSpreadsheetXml(b.ex.columns, b.ex.ok.map(function (r) { return r.cells; }), b.ch.name), 'application/vnd.ms-excel'); record(b, 'XLS', host); }));
        if (b.ex.bad.length) bar.appendChild(W.btn('Отчёт об ошибках (CSV)', function () { dl(name + '-errors.csv', C.toCsv(['Артикул', 'Название', 'Готовность, %', 'Причины'], b.ex.bad.map(function (r) { return [r.p.sku, r.p.name, r.pct, r.reasons.join('; ')]; })), 'text/csv;charset=utf-8'); }));
        if (!W.caps().feed) bar.appendChild(W.el('span', { 'class': 'pim-sub', text: 'Журнал выгрузок ведут роли с правом записи в него; файл скачивается без записи.' }));
        host.appendChild(bar);
        if (b.ex.bad.length) {
            host.appendChild(W.el('h2', { text: 'Строки с ошибками - не попадут в файл' }));
            host.appendChild(W.table([{ k: 'sku', t: 'Артикул' }, { k: 'pct', t: '%', num: true }, { k: 'why', t: 'Причина' }], b.ex.bad.map(function (r) { return { id: r.p.id, sku: r.p.sku, pct: r.pct, why: r.reasons.join('; ') }; }), { rowCls: function () { return 'pim-row-bad'; }, onrow: function (r) { W.go('catalog', 'card=' + r.id); } }));
        }
        host.appendChild(W.el('h2', { text: 'Что попадёт в файл' }));
        host.appendChild(W.el('div', { 'class': 'pim-tablewrap' }, [W.el('table', { 'class': 'pim-table' }, [W.el('thead', {}, [W.el('tr', {}, b.ex.columns.map(function (c) { return W.el('th', { text: c }); }))]),
            W.el('tbody', {}, b.ex.ok.slice(0, 15).map(function (r) { return W.el('tr', {}, r.cells.map(function (c) { return W.el('td', { text: c }); })); }))])]));
        if (b.ex.ok.length > 15) host.appendChild(W.el('p', { 'class': 'pim-sub', text: 'Показаны первые 15 из ' + b.ex.ok.length + ' строк.' }));
    }

    function journal(host) {
        var rows = M.journal.slice().sort(function (a, b) { return W.iso(b['Дата выгрузки']) < W.iso(a['Дата выгрузки']) ? -1 : W.iso(b['Дата выгрузки']) > W.iso(a['Дата выгрузки']) ? 1 : 0; });
        host.appendChild(W.el('p', { 'class': 'pim-sub', text: 'Что кому отдано и в какой версии карточки. Строка журнала - один файл; клик показывает позиции.' }));
        host.appendChild(W.table([{ k: 'Выгрузка', t: 'Выгрузка' }, { k: 'Дата выгрузки', t: 'Дата' }, { k: 'Автор', t: 'Автор' }, { k: 'Формат', t: 'Формат' }, { k: 'Строк', t: 'Строк', num: true }, { k: 'Ошибок', t: 'Ошибок', num: true }, { k: 'Получатель', t: 'Кому отдано' }], rows, {
            rowCls: function (r) { return C.num(r['Ошибок']) > 2 ? 'pim-row-warn' : ''; },
            onrow: function (r) {
                var ls = M.journalLines.filter(function (l) { return l._up === r._id; });
                W.modal(r['Выгрузка'], W.table([{ k: 'Строка выгрузки', t: 'Артикул' }, { k: 'Версия', t: 'Версия', num: true }, { k: 'Результат', t: 'Результат' }, { k: 'Причина', t: 'Причина' }], ls, { rowCls: function (x) { return /Отклон|Не выгруж/.test(x['Результат']) ? 'pim-row-bad' : ''; } }));
            } }));
    }

    function render(host) {
        host.innerHTML = '';
        host.appendChild(W.el('h1', { text: 'Выгрузка и журнал' }));
        host.appendChild(W.tabs([['make', 'Сформировать файл'], ['log', 'Журнал выгрузок']], S.tab, function (t) { S.tab = t; render(host); }));
        if (S.tab === 'make') make(host); else journal(host);
    }
    W.mount(function (host) { return W.loadModel().then(function (m) { M = m; S.chan = M.channels[1] ? M.channels[1].name : M.channels[0].name; render(host); }); });
})();
