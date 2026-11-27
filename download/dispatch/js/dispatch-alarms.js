/* Диспетчеризация: экран «Тревоги». Все тревоги и предупреждения с маршрутом, реакцией, заявкой и актом. */
(function () {
    'use strict';
    var P = window.Dsp, C = P.core;
    var f = { st: 'open', obj: '' }, opened = false, hashRead = false;
    function render(host, M) {
        host.innerHTML = '';
        var h = P.hash();
        if (!hashRead) { hashRead = true; if (h.obj !== undefined) { f.obj = h.obj; f.st = 'all'; } if (h.code) f.st = 'all'; }
        host.appendChild(P.el('div', {}, P.head('Тревоги', 'Тревога создаётся режимом хранения зоны: граница, допуск на открытую дверь, время до тревоги. Ответственный - по часам работы объекта и графику дежурств, эскалация - по сроку реакции.')));
        var st = P.select([['open', 'открытые'], ['all', 'все за ноябрь'], ['noact', 'тревоги без утверждённого акта']], f.st);
        var obj = P.select([['', 'все объекты']].concat(M.objs.map(function (o) { return [o.name, o.name]; })), f.obj);
        st.onchange = function () { f.st = st.value; render(host, M); };
        obj.onchange = function () { f.obj = obj.value; render(host, M); };
        host.appendChild(P.el('div', { 'class': 'dsp-bar' }, [P.field('Показать', st), P.field('Объект', obj), P.el('div', { 'class': 'dsp-grow' })]));
        var rows = M.alarms.filter(function (a) {
            if (f.obj && a.obj !== f.obj) return false;
            if (f.st === 'open') return C.isOpen(a);
            if (f.st === 'noact') return a.cls === 'Тревога' && !(M.actByAlarm[a.code] && M.actByAlarm[a.code].status === 'Утверждён');
            return true;
        }).sort(function (x, y) { return C.stamp(y.date, y.time) - C.stamp(x.date, x.time); });
        var extra = [
            { t: 'Заявка', html: function (a) { var p = M.repairByAlarm[a.code]; return p ? P.esc(p.code) + '<br>' + P.badge(p.status, P.REP_KIND[p.status]) : ''; } },
            { t: 'Акт', html: function (a) { var x = M.actByAlarm[a.code]; return x ? P.esc(x.code) + '<br>' + P.badge(x.status, P.ACT_KIND[x.status]) : (a.cls === 'Тревога' ? '<span class="dsp-t-overdue">нет акта</span>' : ''); } }];
        host.appendChild(P.table(P.alarmCols(M, M.acts ? extra : []), rows, { onrow: function (a) { P.alarmCard(M, a); }, rowCls: function (a) { return P.rowCls(M, a); }, empty: 'Тревог нет' }));
        if (h.code && M.alarmBy[h.code] && !opened) { opened = true; P.alarmCard(M, M.alarmBy[h.code]); }
    }
    P.mount(render);
})();
