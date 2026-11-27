/* MDC: Правила тревог. Порог и длительность настраиваются на глазах: правило прогоняется по отклонениям за неделю, видно, сколько тревог останется. */
(function () {
    'use strict';
    var P = window.Mdc, C = P.core;
    var st = { rule: '', draft: null };
    var DAYS = []; for (var d = '2026-11-19'; d <= '2026-11-26'; d = C.addDays(d, 1)) DAYS.push(d);
    function weekCount(M, r) { return M.devs ? C.replay(M.devs, r).count : M.incidents.filter(function (i) { return i.rule === r.name; }).length; }
    function bars(M, r, o) {
        var a = C.replay(M.devs, r).byDay, b = C.replay(M.devs, r, o).byDay;
        var max = Math.max.apply(null, [1].concat(DAYS.map(function (d) { return a[d] || 0; })));
        return P.el('div', { 'class': 'mdc-days', role: 'img', 'aria-label': 'Тревог по дням: серым сейчас, синим с новыми настройками' }, DAYS.map(function (d) {
            var x = a[d] || 0, y = b[d] || 0;
            return P.el('div', { title: C.toShort(d) + ': сейчас ' + x + ', станет ' + y }, [P.el('div', { 'class': 'mdc-pair' }, [P.el('div', { 'class': 'mdc-b', style: 'height:' + (x / max * 100) + '%' }), P.el('div', { 'class': 'mdc-a', style: 'height:' + (y / max * 100) + '%' })]), P.el('span', { text: C.toShort(d) })]);
        }));
    }
    function editor(host, M, r) {
        var can = P.canWrite('Правило тревоги');
        var u = r.unit === 'сигнал' ? '' : r.unit;
        var thr = P.input('number', r.threshold, { step: '0.1' }), mins = P.input('number', r.minutes, { min: 0, step: 1 });
        var react = P.input('number', r.react, { min: 1, step: 1 }), esc = P.input('number', r.escalate, { min: 0, step: 1 });
        var rep = P.el('input', { type: 'checkbox' }); rep.checked = r.repair;
        var act = P.el('input', { type: 'checkbox' }); act.checked = r.active;
        [thr, mins, react, esc, rep, act].forEach(function (c) { c.disabled = !can; });
        var out = P.el('div', {});
        function recalc() {
            out.innerHTML = '';
            if (!M.devs) { out.appendChild(P.el('p', { 'class': 'mdc-muted', text: 'Прогон по истории отклонений доступен ролям, которые видят данные шлюза.' })); return; }
            var o = { threshold: thr.value, minutes: mins.value }, nd = C.noiseDelta(M.devs, r, o);
            out.appendChild(P.el('div', { 'class': 'mdc-bar' }, [
                P.el('div', {}, [P.el('div', { 'class': 'mdc-muted', text: 'тревог за неделю сейчас' }), P.el('span', { 'class': 'mdc-big', text: String(nd.before) })]),
                P.el('span', { 'class': 'mdc-arrow', text: '→' }),
                P.el('div', {}, [P.el('div', { 'class': 'mdc-muted', text: 'с новыми настройками' }), P.el('span', { 'class': 'mdc-big', style: 'color:var(--p-blue)', text: String(nd.after) })]),
                P.el('div', { 'class': 'mdc-muted', style: 'max-width:340px', text: nd.removed > 0 ? 'Отсеется ' + nd.removed + ' (' + nd.pct + '%): в среднем ' + P.fmt(nd.after / P.WEEK_DAYS, 1) + ' тревоги в сутки вместо ' + P.fmt(nd.before / P.WEEK_DAYS, 1) + '.' : nd.removed < 0 ? 'Тревог станет больше на ' + (-nd.removed) + '.' : 'Число тревог не изменится.' })
            ]));
            out.appendChild(bars(M, r, o));
            out.appendChild(P.el('div', { 'class': 'mdc-legend' }, [P.el('span', {}, [P.el('i', { style: 'background:rgba(100,116,139,.45)' }), 'сейчас']), P.el('span', {}, [P.el('i', { style: 'background:var(--p-blue)' }), 'с новыми настройками'])]));
            var kept = C.replay(M.devs, r, o).list.slice(-5).reverse();
            if (kept.length) out.appendChild(P.el('p', { 'class': 'mdc-muted', text: 'Останутся, например: ' + kept.map(function (d) { return d.eq + ' ' + C.toShort(d.date) + ' ' + d.time + ' (' + P.val(d.peak) + (u ? ' ' + u : '') + ', ' + d.minutes + ' мин)'; }).join('; ') + '.' }));
        }
        [thr, mins].forEach(function (c) { c.addEventListener('input', recalc); });
        var card = P.el('div', { 'class': 'mdc-card' }, [
            P.el('h3', { text: r.name }), P.el('p', { 'class': 'mdc-muted', text: r.text || '' }),
            P.el('div', { 'class': 'mdc-bar' }, [
                P.field('Параметр', P.el('div', { text: r.param + ' ' + r.cond })),
                P.field('Порог' + (u ? ', ' + u : ''), thr), P.field('Дольше, мин', mins, '0 - тревога на любое превышение'),
                P.field('Срок реакции, мин', react), P.field('Эскалация через, мин', esc),
                P.el('label', { 'class': 'mdc-check' }, [rep, 'создавать заявку']), P.el('label', { 'class': 'mdc-check' }, [act, 'правило активно'])]),
            out]);
        if (can) card.appendChild(P.el('div', { 'class': 'mdc-bar' }, [P.btn('Сохранить правило', function () {
            var f = { 'Порог': thr.value, 'Дольше, мин': mins.value, 'Срок реакции, мин': react.value, 'Эскалация через, мин': esc.value, 'Создавать заявку': rep.checked ? 1 : 0, 'Правило активно': act.checked ? 1 : 0 };
            P.update(r.id, f).then(function () { P.toast('Правило сохранено: действует для новых отклонений'); P.refresh(); }, function (er) { P.toast(er.message, true); });
        }, 'mdc-primary'), P.el('span', { 'class': 'mdc-muted', text: 'Прошлые инциденты не пересчитываются: правило действует с момента сохранения.' })]));
        else card.appendChild(P.el('p', { 'class': 'mdc-muted', text: 'Правила меняет главный инженер; здесь можно примерить настройки без сохранения.' }));
        if (!can) [thr, mins].forEach(function (c) { c.disabled = false; });
        host.appendChild(card);
        recalc();
    }
    function render(host, M) {
        host.innerHTML = '';
        host.appendChild(P.el('div', {}, P.head('Правила тревог', 'Что считать инцидентом: параметр, порог, сколько минут держится, важность, срок реакции и эскалация. Правило прогоняется по отклонениям шлюза за неделю - до сохранения видно, сколько тревог останется.')));
        var counted = M.rules.map(function (r) { return { r: r, n: weekCount(M, r) }; }).sort(function (a, b) { return b.n - a.n; });
        if (!st.rule) st.rule = counted.length ? counted[0].r.name : '';
        var noisy = counted[0];
        if (noisy && noisy.n > 50) host.appendChild(P.el('div', { 'class': 'mdc-hint', html: '<b>' + noisy.n + ' тревог за неделю</b> дало правило «' + P.esc(noisy.r.name) + '» - это ' + Math.round(noisy.n / Math.max(1, counted.reduce(function (s, x) { return s + x.n; }, 0)) * 100) + '% всех тревог, почти все закрыты как ложные. Поставьте «Дольше, мин» = 10 и посмотрите, что останется.' }));
        host.appendChild(P.el('div', { 'class': 'mdc-cards', style: 'margin-bottom:16px' }, counted.map(function (x) {
            var r = x.r, u = r.unit === 'сигнал' ? '' : ' ' + r.unit;
            return P.el('div', { 'class': 'mdc-card mdc-rule' + (r.name === st.rule ? ' mdc-on' : ''), tabindex: '0', role: 'button', onclick: function () { st.rule = r.name; render(host, M); } }, [
                P.el('div', { 'class': 'mdc-kv' }, [P.el('b', { text: r.name }), P.el('span', { html: P.badge(r.severity, P.SEV_KIND[r.severity]) })]),
                P.el('div', { 'class': 'mdc-muted', text: r.param + ' ' + r.cond + ' ' + P.val(r.threshold) + u + (r.minutes ? ', дольше ' + r.minutes + ' мин' : ', сразу') }),
                P.el('div', { 'class': 'mdc-kv' }, [P.el('span', { text: 'реакция ' + r.react + ' мин' + (r.repair ? ', заявка' : '') + (r.active ? '' : ', выключено') }), P.el('b', { text: x.n + ' за неделю' })])
            ]);
        })));
        var r = M.ruleBy[st.rule]; if (r) editor(host, M, r);
    }
    P.mount(render);
})();
