/* WFM: График отпусков. Лента по подразделению, проверки (часть 14+ дней, пересечения, запретный период, вахта), очередь согласования, остатки. */
(function () {
    'use strict';
    var W = window.Wfm, C = W.core, S = { graph: '', dept: '', tab: 'tape' }, D = {};
    var TXT = { minpart: 'Нет части не короче 14 дней', overlap: 'Одновременно в отпуске больше лимита', forbidden: 'Отпуск в запретный период', onsite: 'Отпуск поверх вахты' };

    function graphRec() { return D.graphs.filter(function (g) { return g['График отпусков'] === S.graph; })[0]; }
    function rowsOf() {
        return (D.rows[S.graph] || []).map(function (r) {
            var e = D.emps[r['Сотрудник']] || {};
            return { id: r._id, emp: r['Сотрудник'], start: C.toIso(r['Строка отпуска']), end: C.toIso(r['Конец отпуска']), days: C.num(r['Дней']), status: r['Статус отпуска'], dept: e['Подразделение'] || '', fio: e['ФИО'] || r['Сотрудник'], kind: r['Вид отпуска'], why: r['Причина'], rec: r };
        }).filter(function (r) { return !S.dept || r.dept === S.dept; });
    }
    function checks(rows) {
        var limits = {}, forb = {};
        D.depts.forEach(function (d) { limits[d['Подразделение']] = C.num(d['Макс. в отпуске одновременно']); forb[d['Подразделение']] = [C.toIso(d['Запрет отпусков с']), C.toIso(d['Запрет отпусков по'])]; });
        var onSite = {}, year = String(graphRec()['Год']);
        if (D.vahtas.length) D.emps && Object.keys(D.emps).forEach(function (t) {
            var e = D.emps[t]; if (!e['Бригада']) return;
            var vs = D.vahtas.filter(function (v) { return v['Бригада'] === e['Бригада']; }).map(function (v) { return C.toIso(v['Прибытие на объект']); }).sort();
            var cy = D.cycles[(D.brigs[e['Бригада']] || {})['Цикл вахты']]; if (!vs.length || !cy) return;
            onSite[t] = C.vahtaPeriods(vs[0], C.num(cy['Дней на объекте']), C.num(cy['Дней межвахтового отдыха']), year + '-01-01', year + '-12-31');
        });
        return C.vacationChecks(rows, { minPart: D.rules.minPart, limits: limits, forbidden: forb, onSite: onSite });
    }
    function vtext(v) {
        var n = function (t) { return D.emps[t] ? D.emps[t]['ФИО'] : t; };
        if (v.type === 'minpart') return n(v.emp) + ': части ' + v.parts.join('+') + ' дн.';
        if (v.type === 'overlap') return v.dept + ': ' + C.toDmy(v.from) + ' - ' + C.toDmy(v.to) + ', одновременно ' + v.max + ' при лимите ' + v.limit + ' (' + v.emps.map(n).join(', ') + ')';
        if (v.type === 'forbidden') return n(v.emp) + ': ' + C.toDmy(v.start) + ' - ' + C.toDmy(v.end) + ' пересекает запрет ' + C.toDmy(v.from) + ' - ' + C.toDmy(v.to);
        return n(v.emp) + ': ' + C.toDmy(v.start) + ' - ' + C.toDmy(v.end) + ' поверх вахты';
    }
    function decide(r, host, ok) {
        var why = W.el('input', { type: 'text', placeholder: 'Причина отклонения' });
        function go(close) {
            if (!ok && !why.value.trim()) { W.toast('Укажите причину', true); return false; }
            var f = { 'Статус отпуска': ok ? 'Утверждён' : 'Отклонён' }; if (!ok) f['Причина'] = why.value.trim();
            W.post('_m_set/' + r.id + '?JSON', { fields: f }).then(function () { r.rec['Статус отпуска'] = f['Статус отпуска']; if (f['Причина']) r.rec['Причина'] = f['Причина']; W.toast(ok ? 'Утверждено' : 'Отклонено'); close(); render(host); })
                .catch(function (e) { W.toast(e.message, true); });
            return false;
        }
        W.modal(ok ? 'Утвердить отпуск' : 'Отклонить отпуск', W.el('div', {}, [W.el('p', { text: r.fio + ': ' + C.toDmy(r.start) + ' - ' + C.toDmy(r.end) + ' (' + r.days + ' дн.)' }), ok ? null : W.field('Причина', why)]),
            [{ text: 'Отмена' }, { text: ok ? 'Утвердить' : 'Отклонить', cls: ok ? 'wfm-primary' : 'wfm-danger', keep: true, fn: go }]);
    }
    function render(host) {
        host.innerHTML = ''; var g = graphRec(), year = +g['Год'], rows = rowsOf(), v = checks(rows), badEmp = {};
        v.forEach(function (x) { if (x.emp) badEmp[x.emp] = 1; if (x.emps) x.emps.forEach(function (e) { badEmp[e] = 1; }); });
        host.appendChild(W.el('h1', { text: 'График отпусков' }));
        var gs = W.select(D.graphs.map(function (x) { return x['График отпусков']; }), S.graph); gs.onchange = function () { S.graph = gs.value; render(host); };
        var ds = W.select([['', 'Все']].concat(D.depts.map(function (d) { return d['Подразделение']; })), S.dept); ds.onchange = function () { S.dept = ds.value; render(host); };
        host.appendChild(W.el('div', { 'class': 'wfm-bar' }, [W.field('График', gs), W.field('Подразделение', ds), W.el('span', { html: 'Статус: ' + W.badge(g['Статус графика отпусков'], 'warn') + ' срок утверждения ' + W.esc(g['Срок утверждения'] || '-') })]));
        host.appendChild(W.tabs([['tape', 'Лента'], ['check', 'Проверка (' + v.length + ')'], ['queue', 'Очередь согласования'], ['bal', 'Остатки']], S.tab, function (t) { S.tab = t; render(host); }));
        if (S.tab === 'tape') {
            var from = year + '-01-01', span = C.diffDays(from, year + '-12-31') + 1, by = {};
            rows.forEach(function (r) { (by[r.emp] = by[r.emp] || []).push(r); });
            Object.keys(by).sort().forEach(function (t) {
                var track = W.el('div', { 'class': 'wfm-track' });
                by[t].forEach(function (r) {
                    var l = Math.max(0, C.diffDays(from, r.start)), rr = Math.min(span, C.diffDays(from, r.end) + 1); if (rr <= l) return;
                    track.appendChild(W.el('div', { 'class': 'wfm-seg ' + (r.status === 'Отклонён' ? 'wfm-seg-rej' : (badEmp[r.emp] ? 'wfm-seg-bad' : (r.status === 'Утверждён' ? '' : 'wfm-seg-plan'))), style: 'left:' + (l / span * 100) + '%;width:' + ((rr - l) / span * 100) + '%', title: C.toDmy(r.start) + ' - ' + C.toDmy(r.end) + ', ' + r.days + ' дн., ' + r.status }));
                });
                host.appendChild(W.el('div', { 'class': 'wfm-lane' }, [W.el('span', { text: by[t][0].fio, title: by[t][0].dept }), track]));
            });
            host.appendChild(W.el('div', { 'class': 'wfm-legend', text: 'Синий - утверждён, жёлтый - на согласовании или пожелание, красный - сотрудник с нарушением, серый - отклонён.' }));
        } else if (S.tab === 'check') {
            host.appendChild(W.el('ul', { 'class': 'wfm-list wfm-vac-viol' }, v.map(function (x) { return W.el('li', { html: '<b>' + W.esc(TXT[x.type]) + '</b>: ' + W.esc(vtext(x)) }); })));
            if (!v.length) host.appendChild(W.el('p', { 'class': 'wfm-sub', text: 'Нарушений нет.' }));
        } else if (S.tab === 'queue') {
            var q = rows.filter(function (r) { return r.status === 'На согласовании' || r.status === 'Пожелание'; }), can = W.canWrite('Строка отпуска');
            host.appendChild(W.table([{ k: 'fio', t: 'Сотрудник' }, { k: 'dept', t: 'Подразделение' }, { k: 'start', t: 'С', html: function (r) { return C.toDmy(r.start); } }, { k: 'end', t: 'По', html: function (r) { return C.toDmy(r.end); } }, { k: 'days', t: 'Дней', num: 1 }, { k: 'status', t: 'Статус' },
                { k: 'x', t: '', html: function (r) { return can ? '<button class="wfm-btn wfm-ok-btn" data-id="' + r.id + '">Утвердить</button> <button class="wfm-btn wfm-no-btn" data-id="' + r.id + '">Отклонить</button>' : ''; } }], q, { empty: 'Очередь пуста' }));
            host.querySelectorAll('.wfm-ok-btn,.wfm-no-btn').forEach(function (b) {
                b.onclick = function () { var r = rows.filter(function (x) { return x.id === b.getAttribute('data-id'); })[0]; decide(r, host, b.className.indexOf('wfm-ok-btn') >= 0); };
            });
        } else {
            var bal = Object.keys(D.emps).sort().filter(function (t) { return !S.dept || D.emps[t]['Подразделение'] === S.dept; }).map(function (t) {
                var e = D.emps[t], mine = rows.filter(function (r) { return r.emp === t; }), ent = C.num(e['Положено дней отпуска']), carry = C.num(e['Неиспользовано на 01.01.2027, дн']);
                return { fio: e['ФИО'], dept: e['Подразделение'], ent: ent, carry: carry, planned: mine.filter(function (r) { return r.status !== 'Отклонён'; }).reduce(function (s, r) { return s + r.days; }, 0), left: C.vacationBalance(ent, carry, mine) };
            });
            host.appendChild(W.table([{ k: 'fio', t: 'Сотрудник' }, { k: 'dept', t: 'Подразделение' }, { k: 'ent', t: 'Положено, дн', num: 1 }, { k: 'carry', t: 'Перенос с прошлых лет, дн', num: 1 }, { k: 'planned', t: 'Запланировано, дн', num: 1 }, { k: 'left', t: 'Не запланировано, дн', num: 1 }], bal,
                { rowCls: function (r) { return r.left >= 14 ? 'wfm-row-warn' : ''; } }));
        }
    }
    W.mount(function (host) {
        return Promise.all([W.rows('График отпусков'), W.rows('Сотрудник'), W.rows('Подразделение'), W.rows('Правило'), W.rows('Вахта').catch(function () { return []; }), W.rows('Бригада').catch(function () { return []; }), W.rows('Цикл вахты').catch(function () { return []; })]).then(function (r) {
            D.graphs = r[0].sort(function (a, b) { return a['Год'] < b['Год'] ? 1 : -1; }); D.emps = W.map(r[1], 'Сотрудник'); D.depts = r[2]; D.rules = W.rules(r[3]); D.vahtas = r[4]; D.brigs = W.map(r[5], 'Бригада'); D.cycles = W.map(r[6], 'Цикл вахты');
            S.graph = D.graphs[0]['График отпусков'];
            return Promise.all(D.graphs.map(function (g) { return W.rows('Строка отпуска', g._id); })).then(function (rows) { D.rows = {}; D.graphs.forEach(function (g, i) { D.rows[g['График отпусков']] = rows[i]; }); render(host); });
        });
    });
})();
