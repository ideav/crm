/* Диспетчеризация: экран «Журнал для проверки». Отклонения по зонам за период: кто и за сколько отреагировал, акт и решение; печать в PDF. */
(function () {
    'use strict';
    var P = window.Dsp, C = P.core;
    var f = { from: '2026-11-01', to: '2026-11-26', obj: '', cls: '' };
    function render(host, M) {
        host.innerHTML = '';
        var j = C.journal(M.alarms.filter(function (a) { return (!f.obj || a.obj === f.obj) && (!f.cls || a.cls === f.cls); }), M.acts || [], function (a) { return M.modeOfZone(a.zone); }, f.from, f.to);
        var doors = (M.devs || []).filter(function (d) { var z = M.zoneBy[d.zone] || {}; return d.date >= f.from && d.date <= f.to && (!f.obj || z.obj === f.obj) && C.classify(d, M.modeOfZone(d.zone) || {}) === 'Открытая дверь'; }).length;
        host.appendChild(P.el('div', {}, P.head('Журнал для проверки', 'Температурные отклонения по зонам за период: граница, длительность, кто реагировал и за какое время, акт и решение по партиям. Для проверяющего и заказчика-производителя - только чтение.')));
        host.appendChild(P.el('div', { 'class': 'dsp-print-only', html: '<b>ООО «ВладФарм». Журнал температурных отклонений</b><br>Период ' + P.esc(C.toDmy(f.from) + ' - ' + C.toDmy(f.to)) + (f.obj ? ', объект ' + P.esc(f.obj) : ', все объекты') + '. Сформирован ' + P.esc(C.toDmy(P.TODAY) + ' ' + P.CLOCK) + ', пользователь ' + P.esc(P.ctx.user) + '.' }));
        var from = P.input('date', f.from), to = P.input('date', f.to);
        var obj = P.select([['', 'все объекты']].concat(M.objs.map(function (o) { return [o.name, o.name]; })), f.obj);
        var cls = P.select([['', 'тревоги и предупреждения'], ['Тревога', 'только тревоги'], ['Предупреждение', 'только предупреждения']], f.cls);
        [from, to, obj, cls].forEach(function (c) { c.onchange = function () { f.from = from.value || f.from; f.to = to.value || f.to; f.obj = obj.value; f.cls = cls.value; render(host, M); }; });
        host.appendChild(P.el('div', { 'class': 'dsp-bar' }, [P.field('С', from), P.field('По', to), P.field('Объект', obj), P.field('События', cls), P.el('div', { 'class': 'dsp-grow' }), P.btn('Печать / PDF', function () { window.print(); }, 'dsp-primary')]));
        host.appendChild(P.el('div', { 'class': 'dsp-kpis' }, [
            P.kpi('событий в журнале', String(j.total), 'тревог: ' + j.alarms + (M.devs ? ', открытий двери в допуске: ' + doors : '')),
            P.kpi('медиана реакции', j.medianTook === null ? '-' : C.durText(j.medianTook), 'от срабатывания до принятия'),
            P.kpi('реакция позже срока', String(j.late), 'или не принято', j.late ? 'warn' : 'good'),
            P.kpi('тревог без утверждённого акта', String(j.noAct), 'с актом и решением: ' + j.withAct, j.noAct ? 'bad' : 'good')]));
        host.appendChild(P.table([
            { t: 'Дата, время', html: function (r) { return P.esc(C.toDmy(r.alarm.date) + ' ' + r.alarm.time); } },
            { t: 'Объект, зона', html: function (r) { var z = M.zoneBy[r.alarm.zone] || {}; return P.esc(r.alarm.obj) + '<br><span class="dsp-muted">' + P.esc(r.alarm.zone + ' ' + (z.mode || '')) + '</span>'; } },
            { t: 'Событие', html: function (r) { return P.badge(r.alarm.cls, P.CLS_KIND[r.alarm.cls]) + '<br><span class="dsp-muted">' + P.esc(r.alarm.code) + '</span>'; } },
            { t: 'Пик, длительность', num: true, html: function (r) { return P.esc(P.deg(r.alarm.peak)) + '<br>' + r.alarm.minutes + ' мин'; } },
            { t: 'Отреагировал', html: function (r) { return P.esc(P.short(r.alarm.resp)) + '<br>' + (r.took === null ? '<span class="dsp-t-overdue">не принято</span>' : '<span class="' + (r.late ? 'dsp-t-late' : 'dsp-t-ok') + '">за ' + C.durText(r.took) + '</span>'); } },
            { t: 'Что сделано', html: function (r) { return P.esc(r.alarm.done || '') + (r.alarm.moved ? ' <span class="dsp-muted">(товар перенесён)</span>' : ''); } },
            { t: 'Акт', html: function (r) { return r.act ? P.esc(r.act.code) + '<br>' + P.badge(r.act.status, P.ACT_KIND[r.act.status]) : (r.needAct ? '<span class="dsp-t-overdue">нет акта</span>' : '<span class="dsp-muted">не нужен</span>'); } }
        ], j.rows, { rowCls: function (r) { return r.needAct && !r.approved ? 'dsp-row-warn' : ''; }, empty: 'За период отклонений нет' }));
    }
    P.mount(render);
})();
