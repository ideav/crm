/* BI-сводка: загрузки. Свежесть каждого источника, журнал, загрузка файла по сохранённому формату с отказами по строкам, откат загрузки. */
(function () {
    'use strict';
    var B = window.Bisys, C = B.core;
    var st = { src: 'Ozon', dataFor: '', text: '', fileName: '', res: null, srcTab: '' };
    var CODE = { '1С:Розница': '1С', 'Ozon': 'OZ' };

    function hhmm() { var d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
    function statusBadge(s) { return B.badge(s, s === 'Успешно' ? 'ok' : s === 'С отказами' ? 'warn' : 'crit'); }
    function fmtOf(M, src) { var s = M.sources.filter(function (x) { return x.name === src; })[0]; var f = s && M.formats.filter(function (x) { return x.name === s.format; })[0]; return f ? C.parseFormat(f) : null; }

    function showLoad(M, l) {
        var body = B.el('div', {}, [B.el('div', { 'class': 'bi-kv', html: '<span>Источник</span><b>' + B.esc(l.source) + '</b>' }), B.el('div', { 'class': 'bi-kv', html: '<span>Когда</span><b>' + C.toDmy(l.date) + ' ' + B.esc(l.time) + ', ' + B.esc(l.who) + '</b>' }),
            B.el('div', { 'class': 'bi-kv', html: '<span>Данные за</span><b>' + C.toDmy(l.dataFor) + '</b>' }), B.el('div', { 'class': 'bi-kv', html: '<span>Файл</span><b>' + B.esc(l.file) + '</b>' }),
            B.el('div', { 'class': 'bi-kv', html: '<span>Строк в файле / принято / отвергнуто</span><b>' + l.rows + ' / ' + l.acc + ' / ' + l.rej + '</b>' })]);
        var rej = B.el('div', { text: 'Загрузка отказов…' }); body.appendChild(rej);
        var tid = B.tid('Отвергнутая строка');
        (tid ? B.get('object/' + tid + '/?JSON_OBJ&NAMED&F_U=' + l.rid) : Promise.resolve([])).then(function (j) {
            rej.innerHTML = '';
            if (!Array.isArray(j) || !j.length) { rej.appendChild(B.el('p', { 'class': 'bi-muted', text: 'Отвергнутых строк нет.' })); return; }
            rej.appendChild(B.el('h3', { text: 'Отвергнутые строки' }));
            rej.appendChild(B.table([{ t: 'Строка', num: true, k: 'Номер строки файла' }, { t: 'Причина', k: 'Причина отказа' }, { t: 'Содержимое', html: function (x) { return '<code>' + B.esc(x['Содержимое строки']) + '</code>'; } }], j));
        }).catch(function () { rej.textContent = 'Отказы недоступны роли.'; });
        var own = M.docs.filter(function (d) { return d.loadRid === l.rid; }).length;
        var btns = [{ text: 'Закрыть' }];
        if (B.canWrite('Загрузка') && B.canWrite('Документ источника') && l.date === B.TODAY && own) btns.unshift({ text: 'Откатить загрузку (' + own + ' док.)', cls: 'bi-danger', fn: function (close) {
            B.batch(C.rollbackOps(l.rid, M.docs)).then(function () { B.toast('Загрузка ' + l.name + ' откачена: документы удалены'); close(); B.reload(); }).catch(function (e) { B.toast(e.message, true); });
            return false;
        } });
        B.modal('Загрузка ' + l.name, body, btns, true);
    }

    function uploadPanel(M) {
        var fileSrc = M.sources.filter(function (s) { var f = fmtOf(M, s.name); return f && f.cols[0] && f.cols[0].field === 'Документ источника' && CODE[s.name]; });
        if (!fileSrc.length) return null;
        if (!st.dataFor) st.dataFor = C.addDays(B.TODAY, -1);
        var srcSel = B.select(fileSrc.map(function (s) { return s.name; }), st.src); srcSel.onchange = function () { st.src = srcSel.value; st.res = null; st.text = ''; B.render(); };
        var date = B.el('input', { type: 'date' }); date.value = st.dataFor; date.onchange = function () { st.dataFor = date.value; check(M); B.render(); };
        var file = B.el('input', { type: 'file', accept: '.csv,.txt' });
        file.onchange = function () { var f = file.files[0]; if (!f) return; var rd = new FileReader(); rd.onload = function () { st.text = rd.result; st.fileName = f.name; check(M); B.render(); }; rd.readAsText(f, 'utf-8'); };
        var fmt = fmtOf(M, st.src);
        var box = B.el('div', { 'class': 'bi-card' }, [B.el('h3', { text: 'Загрузить файл по сохранённому формату' }),
            B.el('p', { 'class': 'bi-muted', text: 'Формат «' + fmt.name + '»: колонки ' + fmt.cols.map(function (c) { return c.file; }).join(', ') + '. Проверки: ' + fmt.rules.join('; ') + '.' }),
            B.el('div', { 'class': 'bi-bar' }, [B.field('Источник', srcSel), B.field('Данные за', date), B.field('Файл CSV', file),
                st.src === 'Ozon' ? B.btn('Демо-файл Ozon за 25.11', function () { st.text = C.demoOzonCsv(); st.fileName = 'ozon_orders_2026-11-25.csv'; st.dataFor = '2026-11-25'; check(M); B.render(); }, 'bi-primary') : null])]);
        if (st.res) {
            var r = st.res;
            if (r.missingCols.length) box.appendChild(B.el('div', { 'class': 'bi-warnbox bi-e', text: 'В файле нет колонок формата: ' + r.missingCols.join(', ') }));
            else {
                box.appendChild(B.el('div', { 'class': 'bi-warnbox ' + (r.rejected.length ? 'bi-w' : 'bi-g'), text: st.fileName + ': строк ' + r.total + ', принято ' + r.accepted.length + ', отвергнуто ' + r.rejected.length + ' · сумма принятых ' + B.money(r.accepted.reduce(function (s, a) { return s + a.sum; }, 0)) }));
                if (r.rejected.length) box.appendChild(B.table([{ t: 'Строка', num: true, k: 'line' }, { t: 'Причина отказа', k: 'why' }, { t: 'Содержимое', html: function (x) { return '<code>' + B.esc(x.raw) + '</code>'; } }], r.rejected));
                var save = B.btn('Загрузить ' + r.accepted.length + ' строк', function () { save.disabled = true; commit(M, r).catch(function (e) { B.toast(e.message, true); save.disabled = false; }); }, 'bi-primary');
                if (!B.canWrite('Загрузка') || !B.canWrite('Документ источника')) { save.disabled = true; save.title = 'Загружает аналитик данных'; }
                if (!r.accepted.length) save.disabled = true;
                box.appendChild(B.el('div', { 'class': 'bi-bar' }, [save, B.el('span', { 'class': 'bi-muted', text: 'Отвергнутые строки сохранятся в журнале с причиной; их можно исправить в файле и загрузить повторно.' })]));
            }
        }
        return box;
    }
    function check(M) {
        if (!st.text) { st.res = null; return; }
        var ex = {}; M.docs.forEach(function (d) { ex[d.no] = 1; });
        st.res = C.checkFile(st.text, fmtOf(M, st.src), { subs: M.subs.map(function (s) { return s.name; }), existing: ex, from: st.dataFor, to: st.dataFor });
    }
    function commit(M, r) {
        var code = CODE[st.src], base = 'ЗГ-' + code + '-' + st.dataFor.slice(5, 7) + st.dataFor.slice(8, 10);
        var name = M.loadByName[base] ? C.nextCode(M.loads.map(function (l) { return l.name; }).filter(function (n) { return n.indexOf(base + '-') === 0; }), base + '-', 1) : base;
        var ops = [{ op: 'new', id: 'Загрузка', up: 1, fields: { 'Загрузка': name, 'Источник данных': st.src, 'Дата загрузки': B.TODAY, 'Время загрузки': hhmm(), 'Данные за': st.dataFor, 'Имя файла': st.fileName, 'Строк в файле': r.total, 'Принято строк': r.accepted.length, 'Отвергнуто строк': r.rejected.length, 'Статус загрузки': r.rejected.length ? 'С отказами' : 'Успешно', 'Кто загрузил': B.ctx.user } }];
        r.accepted.forEach(function (a) { ops.push({ op: 'new', id: 'Документ источника', up: 1, fields: { 'Документ источника': a.no, 'Дата документа': a.date, 'Подразделение': a.sub, 'Источник данных': st.src, 'Загрузка': ':id0', 'Вид документа': a.kind, 'Сумма документа': a.sum, 'Себестоимость документа': a.cost, 'Позиций в документе': a.pos } }); });
        r.rejected.forEach(function (x) { ops.push({ op: 'new', id: 'Отвергнутая строка', up: ':id0', fields: { 'Отвергнутая строка': x.why.slice(0, 60), 'Номер строки файла': x.line, 'Причина отказа': x.why, 'Содержимое строки': x.raw } }); });
        return B.batch(ops).then(function (j) {
            var bad = (j.results || []).filter(function (x) { return !x.ok; }).length;
            B.toast('Загрузка ' + name + ': принято ' + r.accepted.length + ', отвергнуто ' + r.rejected.length + (bad ? ', ошибок записи ' + bad : ''), !!bad);
            st.res = null; st.text = ''; B.reload();
        });
    }

    function render(host, M) {
        host.appendChild(B.el('h1', { text: 'Загрузки источников' }));
        host.appendChild(B.el('p', { 'class': 'bi-sub', text: 'Каждый источник грузится по своему сохранённому формату: без программиста, одной кнопкой. Журнал показывает, что пришло, когда и сколько строк отвергнуто с причиной.' }));
        host.appendChild(B.freshBar(M));
        host.appendChild(B.el('div', { 'class': 'bi-cards' }, M.fresh.list.map(function (f) {
            var s = M.sources.filter(function (x) { return x.name === f.name; })[0] || {};
            return B.el('div', { 'class': 'bi-card' + (f.fresh ? '' : ' bi-bad') }, [B.el('h3', { html: B.esc(f.name) + ' ' + (f.fresh ? B.badge('свежий', 'ok') : B.badge('не загружен', 'crit')) }),
                B.el('div', { 'class': 'bi-muted', text: (s.sys || '') + ' · ' + (s.way || '') }),
                B.el('div', { 'class': 'bi-kv', html: '<span>Расписание</span><b>' + B.esc(f.freq + ', ' + f.at) + '</b>' }),
                B.el('div', { 'class': 'bi-kv', html: '<span>Данные по</span><b>' + (f.dataFor ? C.toDmy(f.dataFor) : '—') + '</b>' }),
                B.el('div', { 'class': 'bi-kv', html: '<span>Последняя попытка</span><b>' + (f.last ? C.toDmy(f.last.date) + ' ' + B.esc(f.last.time) + ' ' + statusBadge(f.last.status) : '—') + '</b>' }),
                f.failed ? B.el('div', { 'class': 'bi-warnbox bi-e', text: 'Ошибка загрузки ' + f.last.name + ': откройте её в журнале' }) : null]);
        })));
        var up = uploadPanel(M); if (up) host.appendChild(up);
        host.appendChild(B.el('h2', { text: 'Журнал загрузок' }));
        host.appendChild(B.tabs([['', 'Все']].concat(M.sources.map(function (s) { return [s.name, s.name]; })), st.srcTab, function (k) { st.srcTab = k; B.render(); }));
        var list = M.loads.filter(function (l) { return !st.srcTab || l.source === st.srcTab; }).sort(function (a, b) { return (a.date + a.time) < (b.date + b.time) ? 1 : -1; });
        host.appendChild(B.table([
            { t: 'Загрузка', html: function (l) { return '<b>' + B.esc(l.name) + '</b><div class="bi-muted">' + B.esc(l.file) + '</div>'; } },
            { t: 'Источник', k: 'source' }, { t: 'Когда', html: function (l) { return C.toDmy(l.date) + ' ' + B.esc(l.time); } }, { t: 'Данные за', html: function (l) { return C.toDmy(l.dataFor); } },
            { t: 'Принято', num: true, html: function (l) { return String(l.acc); } }, { t: 'Отвергнуто', num: true, html: function (l) { return l.rej ? B.badge(String(l.rej), 'warn') : '0'; } },
            { t: 'Статус', html: function (l) { return statusBadge(l.status); } }
        ], list.slice(0, 20), { onrow: function (l) { showLoad(M, l); }, rowCls: function (l) { return l.status === 'Ошибка' ? 'bi-row-bad' : ''; } }));
        var h = B.hash(); if (h.load && M.loadByName[h.load]) { var l = M.loadByName[h.load]; history.replaceState(null, '', location.pathname); showLoad(M, l); }
    }
    B.mount(render);
})();
