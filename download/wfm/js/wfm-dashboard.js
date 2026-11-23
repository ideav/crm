/* WFM: Сводка. По подразделениям: план/факт табеля, нарушения проверок ТК, покрытие, статус графика. */
(function () {
    'use strict';
    var W = window.Wfm, C = W.core, state = { month: '2026-11', region: '', tab: 'cards' };
    var MONTHS = [['2026-10', 'Октябрь 2026'], ['2026-11', 'Ноябрь 2026'], ['2026-12', 'Декабрь 2026']];

    function tabelStats(tabels, month, tol) {
        var mine = tabels.filter(function (t) { return C.toIso(t['Период']).slice(0, 7) === month; });
        return Promise.all(mine.map(function (t) {
            return W.rows('Запись табеля', t._id).then(function (z) {
                var plan = 0, fact = 0, diff = 0;
                z.forEach(function (r) { plan += C.num(r['Часы план']); fact += C.num(r['Часы факт']); if (Math.abs(C.num(r['Часы факт']) - C.num(r['Часы план'])) > tol) diff++; });
                return { dept: t['Подразделение'], status: t['Статус табеля'], plan: plan, fact: fact, diff: diff };
            });
        }));
    }
    function render(host, m, tabels, stats) {
        host.innerHTML = '';
        var regionOf = W.map(m.depts, 'Подразделение');
        var depts = W.pickDept(m).filter(function (d) { return !state.region || regionOf[d]['Регион'] === state.region; });
        var regions = {}; m.depts.forEach(function (d) { regions[d['Регион']] = 1; });
        var bar = W.el('div', { 'class': 'wfm-bar' }, [
            W.field('Период', (function () { var s = W.select(MONTHS, state.month); s.onchange = function () { state.month = s.value; load(host); }; return s; })()),
            W.field('Регион', (function () { var s = W.select([['', 'Все']].concat(Object.keys(regions).map(function (r) { return [r, r]; })), state.region); s.onchange = function () { state.region = s.value; render(host, m, tabels, stats); }; return s; })())
        ]);
        var rows = depts.map(function (d) {
            var v = W.violations(m, d, state.month), st = stats.filter(function (s) { return s.dept === d; })[0] || {};
            var g = m.graphs.filter(function (x) { return x['Подразделение'] === d && C.toIso(x['Период']).slice(0, 7) === state.month; })[0];
            var cov = v.filter(function (x) { return x.type === 'coverage'; }), other = v.filter(function (x) { return x.type !== 'coverage'; });
            return { dept: d, region: regionOf[d]['Регион'], graph: g ? g['Статус графика'] : 'нет графика', plan: st.plan || 0, fact: st.fact || 0, diff: st.diff || 0, tstatus: st.status || '',
                viol: v, rest: other, cov: cov };
        });
        host.appendChild(W.el('h1', { text: 'Сводка' }));
        host.appendChild(W.el('p', { 'class': 'wfm-sub', text: 'Нарушения проверок ТК считаются по графику смен сразу при составлении, а не в конце месяца.' }));
        host.appendChild(bar);
        host.appendChild(W.tabs([['cards', 'Подразделения'], ['viol', 'Нарушения'], ['cov', 'Покрытие']], state.tab, function (t) { state.tab = t; render(host, m, tabels, stats); }));
        if (state.tab === 'cards') {
            host.appendChild(W.el('div', { 'class': 'wfm-cards' }, rows.map(function (r) {
                var kv = function (k, v) { return W.el('div', { 'class': 'wfm-kv' }, [W.el('span', { text: k }), W.el('span', { html: v })]); };
                return W.el('div', { 'class': 'wfm-card' + (r.viol.length ? ' wfm-bad' : ''), 'data-dept': r.dept }, [
                    W.el('h3', { text: r.dept }),
                    kv('Регион', W.esc(r.region)), kv('График', W.badge(r.graph, r.graph === 'Опубликован' ? 'ok' : 'warn')),
                    kv('План, ч', W.right(r.plan)), kv('Факт, ч', W.right(r.fact)), kv('Расхождений выше допуска', String(r.diff)),
                    kv('Нарушений', W.badge(String(r.viol.length), r.viol.length ? 'crit' : 'ok')),
                    W.el('p', {}, [W.el('a', { href: W.url('schedule') + '#dept=' + encodeURIComponent(r.dept) + '&month=' + state.month, text: 'Открыть график' })])
                ]);
            })));
        } else {
            var list = [];
            rows.forEach(function (r) { r.viol.forEach(function (v) { if (state.tab === 'viol' || v.type === 'coverage') list.push({ dept: r.dept, text: W.violationText(m, v), type: W.REASONS[v.type], date: v.date }); }); });
            if (state.tab === 'cov') list = list.filter(function (x) { return x.type === W.REASONS.coverage; });
            else list = list.filter(function (x) { return x.type !== W.REASONS.coverage; });
            host.appendChild(W.table([{ k: 'dept', t: 'Подразделение' }, { k: 'type', t: 'Что нарушено' }, { k: 'text', t: 'Подробности' }], list, {
                empty: 'Нарушений нет', onrow: function (r) { location.href = W.url('schedule') + '#dept=' + encodeURIComponent(r.dept) + '&month=' + state.month; } }));
        }
    }
    function load(host) {
        host.textContent = 'Загрузка...';
        W.loadSchedule().then(function (m) {
            return W.rows('Табель').then(function (tabels) { return tabelStats(tabels, state.month, m.rules.tolerance).then(function (st) { render(host, m, tabels, st); }); });
        }).catch(W.fail);
    }
    W.mount(load);
})();
