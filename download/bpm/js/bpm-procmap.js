/* BPM: Карта процесса из журнала фактических событий, а не из рисунка: частоты, время на шаге, пути вне спецификации. */
(function () {
    'use strict';
    var P = window.Bpm, C = P.core;
    var state = { proc: 'Согласование договора', req: '' };
    function render(host, M) {
        host.appendChild(P.el('div', {}, P.head('Карта из журнала', 'Как процесс идёт в жизни: каждое ребро — сколько заявок прошло и сколько они ждали на шаге. Красное — переходы, которых нет в спецификации (решали вручную, в мессенджере).')));
        var ps = P.select(M.procs.map(function (p) { return [p.name, p.name]; }), state.proc);
        ps.onchange = function () { state.proc = ps.value; host.innerHTML = ''; render(host, M); };
        host.appendChild(P.el('div', { 'class': 'bpm-bar' }, [P.field('Процесс', ps), P.el('div', { 'class': 'bpm-grow' }), P.btn('Загрузить BPMN и сравнить «как нарисовано / как идёт»', function () { P.option('Импорт BPMN и карта отклонений', '12–16'); })]));
        var reqs = {}; M.reqs.forEach(function (r) { if (r.proc === state.proc) reqs[r.n] = 1; });
        var ev = M.events.filter(function (e) { return reqs[e.req]; });
        var spec = { steps: M.spec.steps, transitions: M.spec.transitions.filter(function (t) { return t.proc === state.proc; }) };
        var map = C.buildMap(ev, spec), off = map.edges.filter(function (e) { return e.offSpec; });
        var maxH = Math.max.apply(null, map.steps.map(function (s) { return s.avgH; }).concat([1]));
        var maxC = Math.max.apply(null, map.edges.map(function (e) { return e.count; }).concat([1]));
        host.appendChild(P.el('div', { 'class': 'bpm-kpis' }, [
            P.kpi('Событий в журнале', String(ev.length), Object.keys(reqs).length + ' заявок'),
            P.kpi('Путей вне спецификации', String(off.length), off.reduce(function (s, e) { return s + e.count; }, 0) + ' заявок прошли вручную', off.length ? 'bad' : 'good'),
            P.kpi('Переходов без использования', String(map.unused.length), 'есть в спецификации, в жизни не встречались', map.unused.length ? 'warn' : ''),
            P.kpi('Дольше всего ждут', map.steps.length ? P.esc(map.steps.slice().sort(function (a, b) { return b.avgH - a.avgH; })[0].step) : '—', map.steps.length ? 'в среднем ' + P.fmt(map.steps.slice().sort(function (a, b) { return b.avgH - a.avgH; })[0].avgH / 24, 1) + ' сут.' : '')
        ]));
        var steps = M.stepList.filter(function (s) { return s.proc === state.proc; });
        var dw = P.map(map.steps, 'step');
        host.appendChild(P.el('div', { 'class': 'bpm-flow' }, steps.map(function (s) {
            var out = map.edges.filter(function (e) { return e.from === s.name; }), d = dw[s.name];
            return P.el('div', { 'class': 'bpm-node' + (s.kind === 'Конечное' ? ' bpm-node-end' : '') }, [
                P.el('div', { 'class': 'bpm-node-h', html: '<b>' + P.esc(s.name) + '</b> <span class="bpm-muted">' + P.esc(s.kind === 'Конечное' ? 'конечное' : s.exec === 'Инициатор' ? 'инициатор' : P.who(s.exec)) + '</span>' }),
                d ? P.el('div', { 'class': 'bpm-dwell' }, [P.el('div', { 'class': 'bpm-bar-track' }, [P.el('div', { 'class': 'bpm-bar-fill ' + (d.avgH > 48 ? 'bpm-r' : d.avgH > 24 ? 'bpm-a' : 'bpm-g'), style: 'width:' + Math.max(4, Math.round(d.avgH / maxH * 100)) + '%' })]), P.el('small', { text: 'на шаге в среднем ' + P.fmt(d.avgH, 0) + ' ч (' + d.n + ' прохождений)' })]) : null,
                P.el('ul', { 'class': 'bpm-edges' }, out.map(function (e) {
                    return P.el('li', { 'class': e.offSpec ? 'bpm-edge-off' : '', title: e.reqs.slice(0, 12).join(', ') }, [
                        P.el('span', { 'class': 'bpm-edge-w', style: 'width:' + Math.max(6, Math.round(e.count / maxC * 60)) + 'px' }),
                        P.el('span', { html: '→ ' + P.esc(e.to) + ' <b>×' + e.count + '</b>' + (e.offSpec ? ' ' + P.badge('вне спецификации', 'crit') : '') + (e.manual && !e.offSpec ? ' ' + P.badge('вручную ' + e.manual, 'warn') : '') })
                    ]);
                }))
            ]);
        })));
        if (off.length) {
            host.appendChild(P.el('h2', { text: 'Пути вне спецификации' }));
            host.appendChild(P.table([{ t: 'Переход', html: function (e) { return P.esc(e.from) + ' → <b>' + P.esc(e.to) + '</b>'; } }, { k: 'count', t: 'Заявок', num: true }, { t: 'Ждали на шаге', num: true, html: function (e) { return P.fmt(e.avgH / 24, 1) + ' сут.'; } }, { t: 'Заявки', html: function (e) { return e.reqs.map(P.esc).join(', '); } }], off));
            host.appendChild(P.el('p', { 'class': 'bpm-sub', text: 'Это и есть «случаи, которых нет на схеме»: в Camunda каждый — инцидент и вызов разработчика. Здесь ответственный решает по заявке сразу, а переход встаёт в спецификацию после одобрения сторон («Правки процесса»).' }));
        }
        if (map.unused.length) host.appendChild(P.el('p', { 'class': 'bpm-muted', text: 'Переходы спецификации без единого прохождения: ' + map.unused.map(function (t) { return t.from + ' → ' + t.to; }).join('; ') + '.' }));
        host.appendChild(P.el('h2', { text: 'Цепочка заявки: причина → решение → правка' }));
        var q = P.select(Object.keys(reqs).sort().reverse().map(function (n) { return [n, n + ' · ' + M.reqBy[n].subj]; }), state.req || (reqs['ДГ-2026-0457'] ? 'ДГ-2026-0457' : Object.keys(reqs)[0]));
        var tl = P.el('div');
        function show() { state.req = q.value; tl.innerHTML = ''; if (M.reqBy[q.value]) tl.appendChild(P.timeline(M, M.reqBy[q.value])); }
        q.onchange = show;
        host.appendChild(P.el('div', { 'class': 'bpm-bar' }, [P.field('Заявка', q)]));
        host.appendChild(tl); show();
    }
    P.mount(render);
})();
