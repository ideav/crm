/* Сверка: «глазами аудитора». Прогоны с итогом и утверждением, закрытые расхождения с основанием и проверяющим, журнал действий, закрытие периода. */
(function () {
    'use strict';
    var P = window.Rc, C = P.core;
    var st = { tab: 'runs', run: '', who: '' };
    var host, M;
    function runCard(r) {
        var ds = M.discs.filter(function (d) { return d.run === r.code; }), j = M.journal.filter(function (x) { return x.obj === r.code || x.obj === r.fileB || x.obj === r.fileL || ds.some(function (d) { return d.code === x.obj; }); });
        var body = P.el('div', {}, [
            P.el('div', { 'class': 'rc-grid2' }, [P.el('div', {}, [P.el('div', { 'class': 'rc-kv', html: '<span>Пара</span><span>' + P.esc(r.pair) + '</span>' }), P.el('div', { 'class': 'rc-kv', html: '<span>Файлы</span><span>' + P.esc(r.fileB) + ', ' + P.esc(r.fileL) + '</span>' }), P.el('div', { 'class': 'rc-kv', html: '<span>Строк банк / учёт</span><span>' + r.rowsB + ' / ' + r.rowsL + '</span>' })]),
                P.el('div', {}, [P.el('div', { 'class': 'rc-kv', html: '<span>Сошлось</span><span>' + String(r.pct).replace('.', ',') + '% (' + r.matched + ' строк)</span>' }), P.el('div', { 'class': 'rc-kv', html: '<span>Запустил</span><span>' + P.esc(r.by) + ' ' + C.toDmy(r.date) + ' ' + P.esc(r.time) + '</span>' }), P.el('div', { 'class': 'rc-kv', html: '<span>Статус</span><span>' + P.esc(r.status) + (r.approvedBy ? ', утвердил ' + P.esc(r.approvedBy) : '') + '</span>' })])]),
            P.el('h3', { text: 'Расхождения прогона' }),
            P.table([{ t: 'Код', k: 'code' }, { t: 'Причина', k: 'reason' }, { t: 'Разница', num: 1, html: function (d) { return P.money(d.diff); } }, { t: 'Статус', k: 'status' }, { t: 'Основание', html: function (d) { return '<span class="rc-muted">' + P.esc(d.basis) + '</span>'; } }, { t: 'Закрыл / проверил', html: function (d) { return d.closedBy ? P.esc(d.closedBy) + ' ' + C.toDmy(d.closedAt) + (d.checkedBy ? ' / ' + P.esc(d.checkedBy) + ' ' + C.toDmy(d.checkedAt) : '') : ''; } }], ds, { empty: 'Без расхождений' }),
            P.el('h3', { text: 'Журнал по прогону' }), journal(j)]);
        var btns = [{ text: 'Закрыть' }];
        if (r.status !== 'Утверждён' && P.role === 'controller' && P.canWrite('Прогон сверки')) btns.push({ text: 'Утвердить прогон', cls: 'rc-primary', fn: function () { P.batch([{ op: 'set', id: r.id, fields: { 'Статус прогона': 'Утверждён', 'Утвердил': P.ctx.user } }, P.logOp('Утверждение прогона', r.code, 'Прогон утверждён')]).then(function () { P.toast('Прогон утверждён'); return P.model(); }).then(function (m2) { M = m2; render(); }); } });
        P.modal('Прогон ' + r.code, body, btns, true);
    }
    function journal(rows) { return P.table([{ t: 'Дата', html: function (x) { return C.toDmy(x.date) + ' ' + P.esc(x.time); } }, { t: 'Кто', k: 'who' }, { t: 'Действие', k: 'action' }, { t: 'Объект', k: 'obj' }, { t: 'Подробности', html: function (x) { return '<span class="rc-muted">' + P.esc(x.details) + '</span>'; } }], rows, { empty: 'Записей нет' }); }
    function periods(box) {
        M.periods.forEach(function (p) {
            var errs = C.lockErrors(p, M.discs), open = M.discs.filter(function (d) { return d.date >= p.from && d.date <= p.to && d.status !== C.ST.DONE; });
            var kids = [P.el('h3', { text: p.name }), P.el('div', { 'class': 'rc-kv', html: '<span>Статус</span><span>' + P.badge(p.status, p.status === 'Закрыт' ? 'ok' : 'info') + '</span>' })];
            if (p.status === 'Закрыт') kids.push(P.el('p', { 'class': 'rc-muted', text: 'Закрыл ' + p.closedBy + ' ' + C.toDmy(p.closedAt) + '. Правки записей и расхождений периода запрещены.' }));
            else {
                kids.push(P.el('p', { 'class': 'rc-muted', text: errs.length ? errs[0] + ' - закрыть период пока нельзя.' : 'Все расхождения закрыты и проверены - период можно закрыть.' }));
                if (P.role === 'controller' && P.canWrite('Период сверки')) {
                    var b = P.btn('Закрыть период', function () { P.batch([{ op: 'set', id: p.id, fields: { 'Статус периода': 'Закрыт', 'Закрыл период': P.ctx.user, 'Дата закрытия периода': P.TODAY } }, P.logOp('Закрытие периода', p.name, 'Период закрыт')]).then(function () { P.toast('Период закрыт'); return P.model(); }).then(function (m2) { M = m2; render(); }); }, 'rc-primary');
                    b.disabled = !!errs.length; kids.push(b);
                }
                if (open.length) kids.push(P.el('p', { 'class': 'rc-muted', text: 'Незакрытые: ' + open.slice(0, 6).map(function (d) { return d.code; }).join(', ') + (open.length > 6 ? ' и ещё ' + (open.length - 6) : '') }));
            }
            box.appendChild(P.el('div', { 'class': 'rc-card' + (errs.length && p.status !== 'Закрыт' ? ' rc-bad' : '') }, kids));
        });
    }
    function render() {
        host.innerHTML = '';
        P.head('Журнал и аудит', 'Воспроизводимость сверки: какие файлы (с хэшем) загрузил кто и когда, по каким правилам сопоставлено, кто закрыл расхождение, на каком основании и кто проверил. Закрытый период правок не принимает.').forEach(function (n) { host.appendChild(n); });
        host.appendChild(P.tabs([['runs', 'Прогоны'], ['closed', 'Закрытые расхождения'], ['log', 'Журнал'], ['files', 'Загруженные файлы'], ['period', 'Периоды']], st.tab, function (t) { st.tab = t; render(); }));
        if (st.tab === 'runs') host.appendChild(P.table([{ t: 'Прогон', k: 'code' }, { t: 'Пара', k: 'pair' }, { t: 'Дата', html: function (r) { return C.toDmy(r.date) + ' ' + P.esc(r.time); } }, { t: 'Строк', num: 1, html: function (r) { return String(r.rowsB + r.rowsL); } }, { t: 'Сошлось, %', num: 1, html: function (r) { return String(r.pct).replace('.', ','); } }, { t: 'Мс', k: 'ms', num: 1 }, { t: 'Запустил', k: 'by' }, { t: 'Статус', html: function (r) { return P.badge(r.status, r.status === 'Утверждён' ? 'ok' : 'warn') + (r.approvedBy ? ' <span class="rc-muted">' + P.esc(r.approvedBy) + '</span>' : ''); } }],
            M.runs.slice().sort(function (a, b) { return a.date + a.time < b.date + b.time ? 1 : -1; }), { onrow: runCard }));
        if (st.tab === 'closed') host.appendChild(P.table([{ t: 'Код', k: 'code' }, { t: 'Причина', k: 'reason' }, { t: 'Контрагент', k: 'cp' }, { t: 'Разница', num: 1, html: function (d) { return P.money(d.diff); } }, { t: 'Основание', html: function (d) { return '<span class="rc-muted">' + P.esc(d.basis) + '</span>'; } }, { t: 'Закрыл', html: function (d) { return P.esc(d.closedBy) + ' ' + C.toDmy(d.closedAt); } }, { t: 'Проверил', html: function (d) { return P.esc(d.checkedBy) + ' ' + C.toDmy(d.checkedAt); } }],
            M.discs.filter(function (d) { return d.status === C.ST.DONE; }).sort(function (a, b) { return a.checkedAt < b.checkedAt ? 1 : -1; })));
        if (st.tab === 'log') {
            var who = P.select([['', 'Все']].concat(Object.keys(M.journal.reduce(function (m, x) { m[x.who] = 1; return m; }, {})).map(function (w) { return [w, w]; })), st.who); who.onchange = function () { st.who = who.value; render(); };
            host.appendChild(P.el('div', { 'class': 'rc-bar' }, [P.field('Кто', who)]));
            host.appendChild(journal(M.journal.filter(function (x) { return !st.who || x.who === st.who; }).sort(function (a, b) { return a.date + a.time < b.date + b.time ? 1 : -1; }).slice(0, 300)));
        }
        if (st.tab === 'files') host.appendChild(P.table([{ t: 'Файл', k: 'name' }, { t: 'Формат', k: 'format' }, { t: 'Загружен', html: function (l) { return C.toDmy(l.date) + ' ' + P.esc(l.time); } }, { t: 'Кто', k: 'by' }, { t: 'Строк', k: 'rows', num: 1 }, { t: 'Ошибок', k: 'errors', num: 1 }, { t: 'Хэш', html: function (l) { return '<span class="rc-mono">' + P.esc(l.hash) + '</span>'; } }],
            M.loads.slice().sort(function (a, b) { return a.date + a.time < b.date + b.time ? 1 : -1; })));
        if (st.tab === 'period') { var box = P.el('div', { 'class': 'rc-cards' }); periods(box); host.appendChild(box); }
    }
    P.mount(function (h, m) { host = h; M = m; render(); });
})();
