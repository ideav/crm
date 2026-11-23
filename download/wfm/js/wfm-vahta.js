/* WFM: Вахта. Лента вахт бригад на год, накопленные часы к норме учётного периода (год), прогноз, допуски. */
(function () {
    'use strict';
    var W = window.Wfm, C = W.core, S = { tab: 'tape' }, D = {};
    var FROM = '2026-01-01', TO = '2027-03-31', SPAN = C.diffDays(FROM, TO) + 1;

    function permitState(until) { return until < W.TODAY ? ['crit', 'истёк'] : (until <= C.addDays(W.TODAY, 30) ? ['warn', 'истекает'] : ['ok', 'действует']); }
    function stats(e) {
        var vs = D.vahtas.filter(function (v) { return v['Бригада'] === e['Бригада']; });
        var st = W.vahtaStats(e, D.F.recs, vs.map(function (v) { return { start: C.toIso(v['Прибытие на объект']), end: C.toIso(v['Убытие с объекта']), status: v['Статус вахты'] }; }), D.cal, D.rules,
            vs.length ? C.num(vs[0]['Часов в день по плану']) : 12, W.FACT_DAY);
        return st;
    }
    function empRows() {
        return D.emps.filter(function (e) { return e['Бригада']; }).map(function (e) {
            var st = stats(e), p = D.permits.filter(function (x) { return x['Сотрудник'] === e['Сотрудник']; });
            var worst = p.reduce(function (w, x) { var s = permitState(C.toIso(x['Действует до']))[0]; return s === 'crit' || (s === 'warn' && w !== 'crit') ? s : w; }, 'ok');
            return { e: e, fio: e['ФИО'], pos: e['Должность'], brig: e['Бригада'], acc: C.round2(st.acc), norm: C.round2(st.norm), ahead: C.round2(st.ahead), forecast: C.round2(st.forecast), over: C.round2(st.overtime), permits: worst };
        });
    }
    function tape(host) {
        var brigs = D.brigs.map(function (b) { return b['Бригада']; });
        var wrap = W.el('div', {});
        brigs.forEach(function (b) {
            var track = W.el('div', { 'class': 'wfm-track', 'data-brig': b });
            D.vahtas.filter(function (v) { return v['Бригада'] === b; }).forEach(function (v) {
                var a = C.toIso(v['Прибытие на объект']), z = C.toIso(v['Убытие с объекта']), left = Math.max(0, C.diffDays(FROM, a)), right = Math.min(SPAN, C.diffDays(FROM, z) + 1);
                if (right <= 0 || left >= SPAN) return;
                var cls = v['Статус вахты'] === 'План' ? 'wfm-seg-plan' : (v['Статус вахты'] === 'На вахте' ? '' : 'wfm-seg-rest');
                track.appendChild(W.el('div', { 'class': 'wfm-seg ' + cls, style: 'left:' + (left / SPAN * 100) + '%;width:' + ((right - left) / SPAN * 100) + '%', title: v['Вахта'] + ': ' + v['Прибытие на объект'] + ' - ' + v['Убытие с объекта'] + ' (' + v['Статус вахты'] + ')' }));
            });
            wrap.appendChild(W.el('div', { 'class': 'wfm-lane' }, [W.el('strong', { text: b }), track]));
        });
        var months = W.el('div', { 'class': 'wfm-lane' }, [W.el('span'), W.el('div', { style: 'display:flex;font-size:11px;color:var(--w-muted)' }, (function () {
            var m = []; for (var d = FROM; d <= TO; d = C.addDays(d.slice(0, 7) + '-28', 5).slice(0, 7) + '-01') { var n = new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7), 0)).getUTCDate(); m.push(W.el('span', { style: 'flex:' + n, text: d.slice(5, 7) + '.' + d.slice(2, 4) })); }
            return m; })())]);
        wrap.appendChild(months);
        wrap.appendChild(W.el('div', { 'class': 'wfm-legend', html: 'Синий - на вахте, зелёный - завершена, жёлтый - по плану; промежутки - межвахтовый отдых. Лента: январь 2026 - март 2027.' }));
        return wrap;
    }
    function card(r) {
        var p = D.permits.filter(function (x) { return x['Сотрудник'] === r.e['Сотрудник']; });
        var body = W.el('div', {}, [W.el('p', { text: r.e['Сотрудник'] + ', ' + r.pos + ', ' + r.brig }),
            W.el('div', { 'class': 'wfm-kv' }, [W.el('span', { text: 'Накоплено на ' + C.toDmy(W.FACT_DAY) }), W.el('b', { text: W.right(r.acc) + ' ч' })]),
            W.el('div', { 'class': 'wfm-kv' }, [W.el('span', { text: 'Норма на дату' }), W.el('b', { text: W.right(r.norm) + ' ч' })]),
            W.el('div', { 'class': 'wfm-kv' }, [W.el('span', { text: 'Опережение (не сверхурочные)' }), W.el('b', { text: (r.ahead > 0 ? '+' : '') + W.right(r.ahead) + ' ч' })]),
            W.el('div', { 'class': 'wfm-kv' }, [W.el('span', { text: 'Прогноз на 31.12.2026' }), W.el('b', { text: W.right(r.forecast) + ' ч' })]),
            W.el('div', { 'class': 'wfm-kv' }, [W.el('span', { text: 'Прогноз сверхурочных к норме года ' + W.right(D.rules.yearNorm) }), W.el('b', { text: (r.over > 0 ? '+' : '') + W.right(r.over) + ' ч' })]),
            W.el('h3', { text: 'Допуски' }), W.el('ul', { 'class': 'wfm-list' }, p.map(function (x) { var s = permitState(C.toIso(x['Действует до'])); return W.el('li', { html: W.esc(x['Допуск']) + ' до ' + W.esc(x['Действует до']) + ' ' + W.badge(s[1], s[0]) }); }))]);
        W.modal(r.fio, body);
    }
    function addVahta(host, row) {
        var brig = W.select(D.brigs.map(function (b) { return b['Бригада']; }), row ? row['Бригада'] : ''), a = W.el('input', { type: 'date', value: row ? C.toIso(row['Прибытие на объект']) : '' }), z = W.el('input', { type: 'date', value: row ? C.toIso(row['Убытие с объекта']) : '' });
        var st = W.select(D.statuses, row ? row['Статус вахты'] : 'План'), days = W.el('input', { type: 'number', value: row ? row['Рабочих дней по плану'] : 28 }), hrs = W.el('input', { type: 'number', step: '0.5', value: row ? C.num(row['Часов в день по плану']) : 12 });
        W.modal(row ? 'Вахта: ' + row['Вахта'] : 'Добавить вахту', W.el('div', {}, [W.field('Бригада', brig), W.field('Прибытие на объект', a), W.field('Убытие с объекта', z), W.field('Статус вахты', st), W.field('Рабочих дней по плану', days), W.field('Часов в день по плану', hrs)]),
            [{ text: 'Отмена' }, { text: 'Сохранить', cls: 'wfm-primary', keep: true, fn: function (close) {
                if (!a.value || !z.value || z.value < a.value) { W.toast('Проверьте даты вахты', true); return false; }
                var f = { 'Бригада': brig.value, 'Прибытие на объект': a.value, 'Убытие с объекта': z.value, 'Статус вахты': st.value, 'Рабочих дней по плану': days.value, 'Часов в день по плану': hrs.value };
                var p = row ? W.post('_m_set/' + row._id + '?JSON', { fields: f }) : (f['Вахта'] = brig.value.replace('Бригада «', '').replace('»', '') + ' — ' + a.value, W.post('_m_new/' + W.tid('Вахта') + '?JSON', { up: 1, fields: f }));
                p.then(function () { W.toast('Сохранено'); close(); return W.rows('Вахта').then(function (v) { D.vahtas = v; render(host); }); }).catch(function (e) { W.toast(e.message, true); });
                return false; } }]);
    }
    function render(host) {
        host.innerHTML = '';
        host.appendChild(W.el('h1', { text: 'Вахта' }));
        host.appendChild(W.el('p', { 'class': 'wfm-sub', text: 'Вахта 30/30: 12 часов в день, 28 рабочих дней из 30 (по 2 дня в пути). Учётный период - год.' }));
        host.appendChild(W.tabs([['tape', 'Лента и накопленные часы'], ['permits', 'Допуски'], ['list', 'Вахты']], S.tab, function (t) { S.tab = t; render(host); }));
        if (S.tab === 'tape') {
            host.appendChild(tape(host));
            host.appendChild(W.el('h2', { text: 'Накопленные часы к норме' }));
            host.appendChild(W.table([{ k: 'fio', t: 'Сотрудник' }, { k: 'pos', t: 'Должность' }, { k: 'brig', t: 'Бригада' }, { k: 'acc', t: 'Накоплено, ч', num: 1 }, { k: 'norm', t: 'Норма на дату, ч', num: 1 }, { k: 'ahead', t: 'Опережение, ч', num: 1 },
                { k: 'forecast', t: 'Прогноз на 31.12, ч', num: 1 }, { k: 'over', t: 'Прогноз сверхурочных, ч', num: 1 }, { k: 'permits', t: 'Допуски', html: function (r) { return r.permits === 'ok' ? W.badge('в порядке', 'ok') : W.badge(r.permits === 'crit' ? 'есть истёкшие' : 'истекают', r.permits); } }],
                empRows(), { onrow: card }));
        } else if (S.tab === 'permits') {
            var rows = D.permits.map(function (x) { var s = permitState(C.toIso(x['Действует до'])); return { p: x['Допуск'], n: x['Номер'], u: x['Действует до'], iso: C.toIso(x['Действует до']), fio: x['ФИО'], tab: x['Сотрудник'], st: s }; }).sort(function (a, b) { return a.iso < b.iso ? -1 : 1; });
            host.appendChild(W.table([{ k: 'fio', t: 'Сотрудник' }, { k: 'p', t: 'Допуск' }, { k: 'n', t: 'Номер' }, { k: 'u', t: 'Действует до' }, { k: 'st', t: 'Состояние', html: function (r) { return W.badge(r.st[1], r.st[0]); } }], rows,
                { rowCls: function (r) { return r.st[0] === 'crit' ? 'wfm-row-bad' : (r.st[0] === 'warn' ? 'wfm-row-warn' : ''); }, empty: 'Допусков нет' }));
        } else {
            var edit = W.canWrite('Вахта');
            if (edit) host.appendChild(W.el('div', { 'class': 'wfm-bar' }, [W.btn('Добавить вахту', function () { addVahta(host); }, 'wfm-primary')]));
            var vr = D.vahtas.slice().sort(function (a, b) { return C.toIso(a['Прибытие на объект']) < C.toIso(b['Прибытие на объект']) ? -1 : 1; });
            host.appendChild(W.table([{ k: 'Вахта', t: 'Вахта' }, { k: 'Бригада', t: 'Бригада' }, { k: 'Прибытие на объект', t: 'Прибытие' }, { k: 'Убытие с объекта', t: 'Убытие' }, { k: 'Статус вахты', t: 'Статус' }, { k: 'Рабочих дней по плану', t: 'Раб. дней', num: 1 }, { k: 'Часов в день по плану', t: 'Часов в день', num: 1 }], vr,
                { onrow: edit ? function (r) { addVahta(host, r); } : null }));
        }
    }
    W.mount(function (host) {
        return Promise.all([W.rows('Вахта'), W.rows('Бригада'), W.rows('Сотрудник'), W.loadFacts(), W.rows('Календарь'), W.rows('Правило'), W.rows('Статус'), W.report('Допуски').catch(function () { return []; })]).then(function (r) {
            D.vahtas = r[0]; D.brigs = r[1]; D.emps = r[2]; D.F = r[3]; D.cal = W.calendar(r[4]); D.rules = W.rules(r[5]);
            D.statuses = r[6].filter(function (s) { return (s['Область'] || '').indexOf('Вахта') >= 0; }).map(function (s) { return s['Статус']; }); D.permits = r[7];
            render(host);
        });
    });
})();
