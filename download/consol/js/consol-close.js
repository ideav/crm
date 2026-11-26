/* Консолидация: «Закрытие и версии» - чек-лист закрытия периода, фиксация версии отчётности, сравнение версий с объяснением, какая корректировка изменила цифру. */
(function () {
    'use strict';
    var P = window.Consol, C = P.core;
    var st = { per: '', a: '', b: '' };

    function current(M, per) {
        var cons = P.consFor(M, per, false);
        return { key: 'cur:' + per, name: per + ' · текущие данные', period: per, snap: C.snapshot(cons), adjs: M.adjs.filter(function (a) { return a.period === per && a.status === 'Утверждена'; }).map(function (a) { return a.num; }), cons: cons };
    }
    function sources(M) {
        var list = M.versions.map(function (v) { return { key: 'v:' + v.id, name: v.name + ' (' + v.at.slice(0, 10) + ')', period: v.period, snap: v.snap, adjs: v.adjs, v: v }; });
        M.periods.filter(function (p) { return p.status !== 'Закрыт'; }).forEach(function (p) { list.push(current(M, p.name)); });
        return list;
    }
    function freezeDlg(host, M, chk, cur) {
        var vs = M.versions.filter(function (v) { return v.period === st.per; }), n = vs.reduce(function (m, v) { return Math.max(m, v.n); }, 0) + 1;
        var reason = P.input('textarea', chk.ready ? '' : 'Предварительная версия. Не выполнено: ' + chk.failed.map(function (s) { return s.title.toLowerCase() + ' (' + s.info + ')'; }).join('; '), { rows: 3 }), to = P.input('text', '');
        P.modal('Зафиксировать ' + st.per + ' · версия ' + n, P.el('div', {}, [
            chk.ready ? P.el('p', { 'class': 'consol-good-t', text: '✓ Все шаги закрытия выполнены' }) : P.el('div', { 'class': 'consol-warnbox consol-e', text: 'Шаги закрытия не выполнены - версия будет помечена как предварительная, причина запишется в версию.' }),
            P.field('Причина версии', reason), P.field('Кому отправлена', to),
            P.el('p', { 'class': 'consol-muted', text: 'В версию войдут итоги по статьям и список утверждённых корректировок: ' + (cur.adjs.join(', ') || 'нет') + '. Изменить версию потом нельзя - только выпустить следующую.' })
        ]), [{ text: 'Отмена' }, { text: 'Зафиксировать', cls: 'consol-primary', fn: function (close, b) {
            if (!reason.value.trim()) { P.toast('Укажите причину версии', true); return false; }
            b.disabled = true;
            P.create('Версия отчётности', { 'Версия отчётности': st.per + ' · версия ' + n, 'Период': st.per, 'Номер версии': n, 'Зафиксирована': P.nowStr(), 'Зафиксировал': P.myName(M), 'Причина версии': reason.value.trim(), 'Кому отправлена': to.value.trim(), 'Корректировки в версии': cur.adjs.join(', '), 'Снимок': JSON.stringify(cur.snap) })
                .then(function () { close(); P.toast('Версия ' + n + ' зафиксирована'); st.a = ''; st.b = ''; P.reload(function (M2) { render(host, M2); }); }).catch(function (e) { b.disabled = false; P.toast(e.message, true); });
            return false;
        } }]);
    }
    function render(host, M) {
        host.innerHTML = '';
        st.per = st.per || P.hash().per || M.cur;
        var per = M.periodBy[st.per], locked = P.locked(M, st.per);
        host.appendChild(P.el('h1', { text: 'Закрытие периода и версии отчётности' }));
        host.appendChild(P.el('p', { 'class': 'consol-sub', text: 'Отчётность уходит банку и собственникам зафиксированной версией. Если цифры меняются после отправки - выпускается следующая версия, и сравнение показывает, что изменилось и какой корректировкой.' }));
        var sel = P.select(M.periods.map(function (p) { return [p.name, p.name + (p.status === 'Закрыт' ? ' (закрыт)' : '')]; }), st.per); sel.onchange = function () { st.per = sel.value; st.a = ''; st.b = ''; render(host, M); };
        var cur = current(M, st.per), pairs = P.pairsFor(M, st.per), pc = {};
        M.cos.forEach(function (c) { var p = M.pkgOf(c.code, st.per); pc[c.code] = p && M.lines.some(function (l) { return l.pkg === p.id; }) ? P.controlsFor(M, p) : []; });
        var chk = C.closeChecklist({ perimeter: M.cos.map(function (c) { return c.code; }), pkgs: M.pkgs.filter(function (p) { return p.period === st.per; }), pkgControls: pc, pairs: pairs, adjs: M.adjs.filter(function (a) { return a.period === st.per; }), cons: cur.cons });
        var bar = [P.field('Период', sel), P.el('span', { 'class': 'consol-grow' }), P.el('div', { html: locked ? P.badge('период закрыт: правка пакетов и корректировок запрещена', 'muted') : P.badge('период открыт', 'info') })];
        if (P.canWrite('Версия отчётности') && !locked) bar.push(P.btn('Зафиксировать версию', function () { freezeDlg(host, M, chk, cur); }, 'consol-primary'));
        if (P.canWrite('Период') && !locked) {
            var cb = P.btn('Закрыть период', function () { cb.disabled = true; P.update(per.id, { 'Статус периода': 'Закрыт' }).then(function () { P.toast(st.per + ' закрыт'); P.reload(function (M2) { render(host, M2); }); }).catch(function (e) { cb.disabled = false; P.toast(e.message, true); }); });
            cb.disabled = !chk.ready; if (!chk.ready) cb.title = 'Закрыть можно, когда все шаги зелёные'; bar.push(cb);
        }
        host.appendChild(P.el('div', { 'class': 'consol-bar' }, bar));
        host.appendChild(P.el('h2', { text: 'Чек-лист закрытия' + (locked ? '' : ': срок отчётности ' + P.d(per.rep)) }));
        host.appendChild(P.el('ol', { 'class': 'consol-steps' }, chk.steps.map(function (s) { return P.el('li', { 'class': s.ok ? 'consol-step-ok' : 'consol-step-no' }, [P.el('b', { text: (s.ok ? '✓ ' : '✕ ') + s.title }), P.el('span', { text: s.info })]); })));
        var vs = M.versions.filter(function (v) { return v.period === st.per; });
        host.appendChild(P.el('h2', { text: 'Версии ' + st.per }));
        host.appendChild(P.table([{ t: 'Версия', html: function (v) { return '<b>' + P.esc(v.name) + '</b>'; } }, { t: 'Зафиксирована', html: function (v) { return P.esc(v.at + ', ' + v.by); } },
            { t: 'Причина', k: 'reason' }, { t: 'Кому', k: 'to' }, { t: 'Прибыль группы', num: true, html: function (v) { return P.fmt(v.snap._profit); } }, { t: 'Корректировок', num: true, html: function (v) { return String(v.adjs.length); } }], vs, { empty: 'Версий ещё нет: зафиксируйте первую перед отправкой банку' }));
        /* сравнение */
        var src = sources(M), by = {}; src.forEach(function (s) { by[s.key] = s; });
        if (!st.a || !by[st.a] || !st.b || !by[st.b]) {
            if (vs.length >= 2) { st.a = 'v:' + vs[vs.length - 2].id; st.b = 'v:' + vs[vs.length - 1].id; }
            else { var prevV = M.versions.filter(function (v) { return v.period !== st.per; }); st.a = vs.length ? 'v:' + vs[vs.length - 1].id : prevV.length ? 'v:' + prevV[prevV.length - 1].id : src[0].key; st.b = by['cur:' + st.per] ? 'cur:' + st.per : src[src.length - 1].key; }
        }
        var sa = P.select(src.map(function (s) { return [s.key, s.name]; }), st.a), sb = P.select(src.map(function (s) { return [s.key, s.name]; }), st.b);
        sa.onchange = function () { st.a = sa.value; render(host, M); }; sb.onchange = function () { st.b = sb.value; render(host, M); };
        host.appendChild(P.el('h2', { text: 'Сравнение версий' }));
        host.appendChild(P.el('div', { 'class': 'consol-bar' }, [P.field('Было', sa), P.field('Стало', sb)]));
        var A = by[st.a], B = by[st.b];
        var adjB = M.adjs.filter(function (x) { return B.adjs.indexOf(x.num) >= 0; });
        var cmp = C.compareSnap(A.snap, B.snap, M.arts, A.period === B.period ? adjB : [], A.adjs);
        host.appendChild(P.el('div', { 'class': 'consol-kpis' }, [P.kpi('Прибыль было', P.fmt(cmp.profitA), A.name), P.kpi('Прибыль стало', P.fmt(cmp.profitB), B.name, cmp.profitB < cmp.profitA ? 'warn' : ''),
            P.kpi('Изменилось статей', String(cmp.rows.length), A.period === B.period ? (cmp.fresh.length ? 'новые корректировки: ' + cmp.fresh.join(', ') : 'корректировки те же') : 'разные периоды')]));
        host.appendChild(P.table([{ t: 'Статья', html: function (r) { return '<small class="consol-muted">' + P.esc(r.code) + '</small> ' + P.esc(r.name); } },
            { t: 'Было', num: true, html: function (r) { return P.fmt(r.a); } }, { t: 'Стало', num: true, html: function (r) { return P.fmt(r.b); } },
            { t: 'Изменение', num: true, html: function (r) { return '<b class="' + (r.diff < 0 ? 'consol-red' : '') + '">' + (r.diff > 0 ? '+' : '') + P.fmt(r.diff) + '</b>'; } },
            { t: 'Почему', html: function (r) { return r.why.length ? r.why.map(function (n) { var a = M.adjs.filter(function (x) { return x.num === n; })[0]; return '<b>' + P.esc(n) + '</b> ' + P.esc(a ? a.title : '') + (a ? '<br><small class="consol-muted">' + P.esc(a.basis) + '</small>' : ''); }).join('<br>') : '<span class="consol-muted">' + (A.period === B.period ? 'изменились данные пакетов' : 'другой период') + '</span>'; } }
        ], cmp.rows, { empty: 'Версии совпадают' }));
    }
    P.mount(render);
})();
