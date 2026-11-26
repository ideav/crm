/* Консолидация: «Статус пакетов» - периметр группы, кто сдал пакет, какие контроли красные, сколько дней просрочки. Первый клик демо. */
(function () {
    'use strict';
    var P = window.Consol, C = P.core;
    var st = { per: '' };
    var CTL_ICON = { ok: '✓', warn: '!', error: '✕' };
    function chips(res) {
        return res.map(function (c) { return '<span class="consol-chip consol-chip-' + c.state + '" title="' + P.esc(c.title + ': ' + c.msg) + '">' + CTL_ICON[c.state] + ' ' + P.esc(c.code === 'IC' ? 'ВГО' : c.code === 'BAL' ? 'баланс' : c.code === 'PNL' ? 'прибыль' : c.code === 'OPEN' ? 'начало' : c.code === 'OTHER' ? 'прочие' : c.code === 'MAP' ? 'счета' : 'знаки') + '</span>'; }).join(' ');
    }
    function render(host, M) {
        host.innerHTML = '';
        st.per = st.per || P.hash().per || M.cur;
        var per = M.periodBy[st.per];
        host.appendChild(P.el('h1', { text: 'Статус пакетов группы' }));
        host.appendChild(P.el('p', { 'class': 'consol-sub', text: 'Периметр консолидации и пакеты обществ за период. Контроли считаются сразу при загрузке пакета: баланс, прибыль, сальдо на начало, доля «прочих», внутригруппа против контрагента. Нажмите на строку - откроется пакет общества.' }));
        var sel = P.select(M.periods.map(function (p) { return [p.name, p.name + (p.status === 'Закрыт' ? ' (закрыт)' : '')]; }), st.per);
        sel.onchange = function () { st.per = sel.value; render(host, M); };
        host.appendChild(P.el('div', { 'class': 'consol-bar' }, [P.field('Период', sel), P.el('span', { 'class': 'consol-grow' }),
            P.el('div', { 'class': 'consol-muted', html: 'Срок сдачи пакетов <b>' + P.d(per.due) + '</b> · отчётность группы для банка <b>' + P.d(per.rep) + '</b>' })]));
        var rows = M.cos.map(function (c) {
            var pkg = M.pkgOf(c.code, st.per) || { company: c.code, period: st.per, status: 'Не начат', id: '' };
            var res = pkg.id ? P.controlsFor(M, pkg) : [];
            var hasLines = pkg.id && M.lines.some(function (l) { return l.pkg === pkg.id; });
            var rem = M.remarks.filter(function (r) { return r.pkg === pkg.id && r.status !== 'Снято'; });
            return { c: c, pkg: pkg, res: hasLines ? res : [], late: P.late(M, pkg), rem: rem, red: hasLines && res.some(function (x) { return x.state === 'error'; }), warn: hasLines && res.some(function (x) { return x.state === 'warn'; }) };
        });
        var acc = rows.filter(function (r) { return r.pkg.status === 'Принят'; }).length, late = rows.filter(function (r) { return r.late > 0; });
        var red = rows.filter(function (r) { return r.red || r.warn; }).length;
        var left = C.workdaysLate(P.TODAY, per.rep);
        host.appendChild(P.el('div', { 'class': 'consol-kpis' }, [
            P.kpi('Пакеты приняты', acc + ' из ' + rows.length, 'остальные не дают закрыть период', acc < rows.length ? 'warn' : 'good'),
            P.kpi('Просрочена сдача', String(late.length), late.length ? late.map(function (r) { return r.c.code + ' ' + r.late + ' раб. дн.'; }).join(', ') : 'все в срок', late.length ? 'bad' : 'good'),
            P.kpi('Пакеты с замечаниями контролей', String(red), 'красные и жёлтые контроли', red ? 'warn' : 'good'),
            P.kpi('До отчётности банку', per.status === 'Закрыт' ? 'закрыт' : left + ' раб. дн.', 'срок ' + P.d(per.rep), per.status !== 'Закрыт' && left <= 3 ? 'bad' : '')
        ]));
        host.appendChild(P.table([
            { t: 'Общество', html: function (r) { return '<b>' + P.esc(r.c.name) + '</b><br><small class="consol-muted">' + P.esc(r.c.code + ' · ' + r.c.city + ' · ИНН ' + r.c.inn) + '</small>'; } },
            { t: 'Доля, метод', html: function (r) { return P.esc(r.c.share + '% · ' + (r.c.role === 'Материнская' ? 'материнская' : r.c.method.toLowerCase())); } },
            { t: 'Бухгалтер', html: function (r) { return P.esc(r.c.acc); } },
            { t: 'Статус пакета', html: function (r) { return P.badge(r.pkg.status, C.statusKind(r.pkg.status)) + (r.late ? ' ' + P.badge('просрочка ' + r.late + ' раб. дн.', 'bad') : '') + (r.pkg.sent ? '<br><small class="consol-muted">отправлен ' + P.esc(r.pkg.sent) + '</small>' : ''); } },
            { t: 'Контроли', html: function (r) { return r.res.length ? chips(r.res) : '<span class="consol-muted">пакет не загружен</span>'; } },
            { t: 'Замечания', html: function (r) { return r.rem.length ? r.rem.map(function (x) { return '<span class="consol-badge consol-bad" title="' + P.esc(x.text) + '">' + P.esc(x.title) + '</span>'; }).join(' ') : ''; } }
        ], rows, { onrow: function (r) { location.href = P.url('package') + '#co=' + encodeURIComponent(r.c.code) + '&per=' + encodeURIComponent(st.per); },
            rowCls: function (r) { return r.red || r.late ? 'consol-r-breach' : r.warn ? 'consol-r-warn' : ''; } }));
        host.appendChild(P.el('div', { 'class': 'consol-note', html: 'Значки контролей: <span class="consol-chip consol-chip-ok">✓</span> сходится, <span class="consol-chip consol-chip-warn">!</span> предупреждение (не мешает отправке), <span class="consol-chip consol-chip-error">✕</span> блокирует отправку. Наведите курсор - причина.' }));
    }
    P.mount(render);
})();
