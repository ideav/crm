/* MDM: Журнал слияний. Кто, когда, что слил и почему; подтверждение руководителем НСИ (четыре глаза) и откат по снимку «до». */
(function () {
    'use strict';
    var P = window.Mdm, C = P.core;
    var flt = '';

    function render(host, M) {
        host.innerHTML = '';
        P.head('Журнал слияний', 'Каждое слияние записывается с долей совпадения, причиной и снимком записей «до». Методолог предлагает, руководитель службы НСИ подтверждает; подтверждённое слияние можно откатить.').forEach(function (e) { host.appendChild(e); });
        if (!M.mergesReadable) { host.appendChild(P.el('p', { 'class': 'mdm-empty', text: 'Журнал слияний вашей роли недоступен.' })); return; }
        var cnt = function (s) { return M.merges.filter(function (m) { return m.status === s; }).length; };
        host.appendChild(P.el('div', { 'class': 'mdm-kpis' }, [P.kpi('Ждут подтверждения', String(cnt('Предложено')), 'предложил методолог', cnt('Предложено') ? 'warn' : 'good'), P.kpi('Подтверждено', String(cnt('Подтверждено'))), P.kpi('Откачено', String(cnt('Откачено')), 'ошибочные слияния, вернули как было'), P.kpi('Отклонено', String(cnt('Отклонено')))]));
        var sel = P.select([['', 'Все статусы'], 'Предложено', 'Подтверждено', 'Откачено', 'Отклонено'], flt);
        sel.addEventListener('change', function () { flt = sel.value; render(host, M); });
        host.appendChild(P.el('div', { 'class': 'mdm-bar' }, [P.field('Статус', sel)]));
        var rows = M.merges.filter(function (m) { return !flt || m.status === flt; }).sort(function (a, b) { return a.no < b.no ? 1 : -1; });
        host.appendChild(P.table([
            { t: '№', html: function (m) { return '<b>' + P.esc(m.no) + '</b>'; } },
            { t: 'Справочник', k: 'kind' },
            { t: 'Золотая запись', html: function (m) { var g = M.byCode[m.golden]; return P.esc(m.golden) + (g ? '<div class="mdm-muted">' + P.esc(g.name) + '</div>' : ''); } },
            { t: 'Поглощены', k: 'absorbed' },
            { t: 'Доля', num: true, html: function (m) { return P.scoreBadge(m.score, M.params.dupThreshold); } },
            { t: 'Предложил', html: function (m) { return P.esc(m.by) + '<div class="mdm-muted">' + C.ruDate(m.dp) + '</div>'; } },
            { t: 'Решение', html: function (m) { return P.statusBadge(m.status) + (m.conf ? '<div class="mdm-muted">' + P.esc(m.conf) + ', ' + C.ruDate(m.dd) + '</div>' : ''); } }
        ], rows, { onrow: function (m) { open(host, M, m); }, rowCls: function (m) { return m.status === 'Предложено' ? 'mdm-row-warn' : ''; } }));
        var h = P.hash(); if (h.no) { var m = M.merges.filter(function (x) { return x.no === h.no; })[0]; if (m) { history.replaceState(null, '', location.pathname); open(host, M, m); } }
    }
    function open(host, M, m) {
        var body = P.el('div', {}), snap = [], chosen = {};
        try { snap = JSON.parse(m.snap || '[]'); } catch (e) { snap = []; }
        try { chosen = JSON.parse(m.fields || '{}'); } catch (e) { chosen = {}; }
        body.appendChild(P.el('p', { html: P.statusBadge(m.status) + ' ' + P.esc(m.kind) + ': золотая <b>' + P.esc(m.golden) + '</b>, поглощены ' + P.esc(m.absorbed) }));
        body.appendChild(P.el('div', { 'class': 'mdm-why', html: '<b>Почему дубль (' + m.score + '%):</b> ' + P.esc(m.reason) }));
        var codes = [m.golden].concat(String(m.absorbed || '').split(/,\s*/)).filter(Boolean);
        body.appendChild(P.el('h3', { text: 'Записи сейчас', style: 'margin-top:12px' }));
        body.appendChild(P.el('div', { 'class': 'mdm-members' }, codes.map(function (c) { var r = M.byCode[c]; return P.el('div', { html: r ? P.recLine(r) + ' ' + P.statusBadge(r.status) + (r.mergedInto ? ' <span class="mdm-muted">слита в ' + P.esc(r.mergedInto) + '</span>' : '') : P.esc(c) + ' - нет доступа' }); })));
        var ks = Object.keys(chosen);
        if (ks.length) body.appendChild(P.el('div', { 'class': 'mdm-why', html: '<b>Поля золотой записи:</b> ' + ks.map(function (k) { return P.esc(k) + ' = «' + P.esc(chosen[k].value) + '» (' + P.esc(chosen[k].source || '') + ')'; }).join('; ') }));
        if (snap.length) body.appendChild(P.el('div', { 'class': 'mdm-why', html: '<b>Снимок «до»:</b> ' + snap.map(function (s) { var r = M.nom.concat(M.kon).filter(function (x) { return x.id === s.id; })[0]; return P.esc(r ? r.code : s.id) + ' - ' + P.esc(s.status); }).join('; ') }));
        var R = M.rights, can = P.canWrite('Слияние');
        var act = function (fn, msg) { return function (close) { fn().then(function () { close(); P.toast(msg); P.rerender(render); }).catch(function (e) { P.toast(e.message, true); }); return false; }; };
        P.modal('Слияние ' + m.no, body, [
            { text: 'Закрыть' },
            can && R.confirm && m.status === 'Предложено' ? { text: 'Отклонить', fn: act(function () { return P.update(m.id, { 'Статус слияния': 'Отклонено', 'Подтвердил': P.ctx.user, 'Дата решения': P.TODAY }); }, 'Слияние отклонено') } : null,
            can && R.confirm && m.status === 'Предложено' ? { text: 'Подтвердить слияние', cls: 'mdm-primary', fn: act(function () { return P.confirmMerge(M, m); }, 'Слияние подтверждено, записи помечены') } : null,
            can && R.confirm && m.status === 'Подтверждено' && snap.length ? { text: 'Откатить', cls: 'mdm-danger', fn: act(function () { return P.rollbackMerge(M, m); }, 'Откат выполнен: записи вернулись в состояние «до»') } : null
        ], true);
        if (m.status === 'Предложено' && !R.confirm) body.appendChild(P.el('div', { 'class': 'mdm-warnbox mdm-w', text: 'Подтверждает руководитель службы НСИ - правило «четырёх глаз».' }));
    }
    P.mount(render);
})();
