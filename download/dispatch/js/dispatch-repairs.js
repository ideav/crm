/* Диспетчеризация: экран «Заявки на ремонт». Заявка создаётся из тревоги и уходит в сервисную организацию; сервис отмечает ход работ. */
(function () {
    'use strict';
    var P = window.Dsp, C = P.core;
    var opened = false;
    function card(M, p) {
        var can = P.canWrite('Заявка на ремонт') && p.status !== 'Выполнена', o = M.objBy[p.obj] || {}, z = M.zoneBy[p.zone] || {};
        var st = P.select(['Новая', 'Передана в сервис', 'Выполнена'], p.status), doneI = P.el('textarea', { rows: 2 }); doneI.value = p.done || '';
        st.disabled = doneI.disabled = !can;
        var errBox = P.el('div', {});
        var body = P.el('div', {}, [
            P.el('div', { 'class': 'dsp-kv', html: '<span>Объект</span><span><b>' + P.esc(p.obj) + '</b> ' + P.esc(o.address || '') + '</span>' }),
            P.el('div', { 'class': 'dsp-kv', html: '<span>Зона</span><span>' + P.esc(p.zone + ' ' + (z.title || '')) + '</span>' }),
            P.el('div', { 'class': 'dsp-kv', html: '<span>Контакт на объекте</span><span>' + P.esc(P.short(o.resp) + ', ' + (o.phone || '')) + '</span>' }),
            P.el('div', { 'class': 'dsp-kv', html: '<span>Из тревоги</span><span>' + P.esc(p.alarm || '') + ', ' + P.esc(C.toDmy(p.date)) + '</span>' }),
            P.el('p', { text: p.text }), P.field('Статус', st), P.field('Что сделано', doneI), errBox]);
        var btns = [{ text: 'Закрыть окно' }];
        if (can) btns.push({ text: 'Сохранить', cls: 'dsp-primary', fn: function (close) {
            if (st.value === 'Выполнена' && !String(doneI.value).trim()) { errBox.innerHTML = ''; errBox.appendChild(P.el('div', { 'class': 'dsp-warnbox dsp-e', text: 'Опишите, что сделано.' })); return false; }
            var f = { 'Статус заявки': st.value, 'Что сделано': doneI.value }; if (st.value === 'Выполнена') f['Дата выполнения'] = P.TODAY;
            P.update(p.id, f).then(function () { P.toast('Заявка ' + p.code + ' сохранена'); close(); P.refresh(); }, function (er) { P.toast(er.message, true); });
            return false;
        } });
        P.modal('Заявка на ремонт ' + p.code, body, btns, true);
    }
    function render(host, M) {
        host.innerHTML = '';
        host.appendChild(P.el('div', {}, P.head('Заявки на ремонт', 'Заявка создаётся из тревоги одной кнопкой: объект, зона и показания подставляются сами. Сервисная организация видит только заявки, без партий и журнала.')));
        if (!M.repairs) { host.appendChild(P.el('p', { 'class': 'dsp-muted', text: 'Раздел закрыт ролью.' })); return; }
        var rows = M.repairs.slice().sort(function (a, b) { return (a.status === 'Выполнена') - (b.status === 'Выполнена') || (b.date < a.date ? -1 : 1); });
        host.appendChild(P.el('div', { 'class': 'dsp-kpis' }, [
            P.kpi('в работе', String(rows.filter(function (p) { return p.status !== 'Выполнена'; }).length), 'передано в сервис', 'warn'),
            P.kpi('выполнено', String(rows.filter(function (p) { return p.status === 'Выполнена'; }).length), 'за ноябрь', 'good')]));
        host.appendChild(P.table([
            { t: 'Заявка', html: function (p) { return '<b>' + P.esc(p.code) + '</b><br><span class="dsp-muted">' + P.esc(C.toDmy(p.date)) + '</span>'; } },
            { t: 'Объект и зона', html: function (p) { return P.esc(p.obj) + '<br><span class="dsp-muted">' + P.esc(p.zone) + '</span>'; } },
            { t: 'Неисправность', k: 'text' },
            { t: 'Статус', html: function (p) { return P.badge(p.status, P.REP_KIND[p.status]); } },
            { t: 'Что сделано', html: function (p) { return P.esc(p.done || '') + (p.doneDate ? '<br><span class="dsp-muted">' + P.esc(C.toDmy(p.doneDate)) + '</span>' : ''); } }
        ], rows, { onrow: function (p) { card(M, p); }, rowCls: function (p) { return p.status === 'Новая' ? 'dsp-row-bad' : ''; }, empty: 'Заявок нет' }));
        var h = P.hash(), p = h.code && rows.filter(function (x) { return x.code === h.code; })[0];
        if (p && !opened) { opened = true; card(M, p); }
    }
    P.mount(render);
})();
