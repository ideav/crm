/* MDM: Качество и правила. Метрики «было/стало» (доля дублей, время заведения, автосопоставление) и правила похожести, которые методолог правит без программиста. */
(function () {
    'use strict';
    var P = window.Mdm, C = P.core;
    var draft = null;

    function live(M, rules, thr) {
        var g = C.findDuplicates(M.nom, rules ? rules[P.NOM] : M.rules[P.NOM], P.NOM, thr || M.params.dupThreshold);
        var gk = C.findDuplicates(M.kon, rules ? rules[P.KON] : M.rules[P.KON], P.KON, thr || M.params.dupThreshold);
        var late = M.reqs.filter(function (r) { return C.slaState(r, P.TODAY).state === 'late'; }).length;
        return { name: 'Сейчас', date: P.TODAY, total: M.nom.filter(C.active).length, dup: C.dupShare(M.nom, g), dupK: C.dupShare(M.kon, gk), groups: g.length, groupsK: gk.length, days: C.entryDays(M.reqs), auto: C.mapStats(M.maps).autoPct, late: late };
    }
    function render(host, M) {
        host.innerHTML = '';
        P.head('Качество и правила', 'Замеры до проекта и на пилоте против живых цифр справочника. Ниже - правила похожести: веса полей и пороги, по которым ищутся дубли и работает подсказка при вводе.').forEach(function (e) { host.appendChild(e); });
        var now = live(M), hist = M.quality.concat([now]), first = M.quality[0];
        host.appendChild(P.el('div', { 'class': 'mdm-kpis' }, [
            P.kpi('Доля дублей номенклатуры', P.pct(now.dup), first ? 'было ' + P.pct(first.dup) + ' · цель ' + P.pct(M.params.dupTarget) : '', now.dup <= M.params.dupTarget ? 'good' : now.dup > 10 ? 'bad' : 'warn'),
            P.kpi('Дубли контрагентов', P.pct(now.dupK), now.groupsK + ' групп', now.dupK ? 'warn' : 'good'),
            P.kpi('Время заведения позиции', String(now.days).replace('.', ',') + ' дн.', first ? 'было ' + String(first.days).replace('.', ',') + ' дн.' : '', now.days <= M.params.slaDays ? 'good' : 'warn'),
            P.kpi('Автосопоставление прайсов', P.pct(now.auto), 'критерий - не менее 85%', now.auto >= 85 ? 'good' : 'warn'),
            P.kpi('Просрочено заявок', String(now.late), first ? 'было ' + first.late : '', now.late ? 'bad' : 'good')]));
        var bars = P.el('div', { 'class': 'mdm-bars' });
        [['dup', 'Доля дублей, %', 50, true], ['days', 'Время заведения, раб. дн.', 6, true], ['auto', 'Автосопоставление, %', 100, false], ['late', 'Просрочено заявок', 12, true]].forEach(function (b) {
            bars.appendChild(P.el('div', { 'class': 'mdm-card' }, [P.el('h3', { text: b[1] })].concat(hist.map(function (h) {
                var v = h[b[0]], w = Math.max(2, Math.min(100, 100 * v / b[2])), good = b[3] ? h === now && v < hist[0][b[0]] : h === now && v > hist[0][b[0]];
                return P.el('div', { 'class': 'mdm-barrow' }, [P.el('span', { text: h === now ? 'Сейчас' : C.ruDate(h.date), title: h.name }), P.el('div', { 'class': 'mdm-bar-track' }, [P.el('div', { 'class': 'mdm-bar-fill' + (h === now ? (good ? ' mdm-g' : ' mdm-a') : ''), style: 'width:' + w + '%' })]), P.el('b', { text: String(v).replace('.', ',') })]);
            }))));
        });
        host.appendChild(bars);
        host.appendChild(P.el('p', { 'class': 'mdm-muted', text: hist.slice(0, -1).map(function (h) { return C.ruDate(h.date) + ' - ' + h.name; }).join(' · ') }));
        if (P.canWrite('Замер качества')) host.appendChild(P.btn('Зафиксировать замер «сейчас»', function () {
            P.create('Замер качества', { 'Замер качества': 'Замер ' + C.ruDate(P.TODAY), 'Дата замера': P.TODAY, 'Записей в справочнике': now.total, 'Доля дублей': now.dup, 'Время заведения позиции': now.days, 'Доля автосопоставления': now.auto, 'Просрочено заявок': now.late })
                .then(function () { P.toast('Замер сохранён'); P.rerender(render); }).catch(function (e) { P.toast(e.message, true); });
        }));
        rulesBlock(host, M);
    }
    function rulesBlock(host, M) {
        var can = P.canWrite('Правило похожести'), canP = P.canWrite('Параметр НСИ');
        draft = { rules: M.ruleRows.map(function (r) { return Object.assign({}, r); }), params: M.paramRows.map(function (p) { return Object.assign({}, p); }) };
        host.appendChild(P.el('h2', { text: 'Правила похожести' }));
        host.appendChild(P.el('p', { 'class': 'mdm-sub', text: can ? 'Поменяйте вес поля или порог и нажмите «Проверить» - система покажет, сколько групп дублей станет, не сохраняя. Сохранение меняет правила для всех экранов.' : 'Правила правит методолог НСИ; вам они видны для справки.' }));
        var wrap = P.el('div', { 'class': 'mdm-two mdm-rules' });
        [P.NOM, P.KON].forEach(function (k) {
            var rows = draft.rules.filter(function (r) { return r.kind === k; });
            wrap.appendChild(P.el('div', { 'class': 'mdm-card' }, [P.el('h3', { text: k })].concat(rows.map(function (r) {
                var w = P.input('number', r.w, { min: 0, max: 100, step: 5, disabled: can ? false : 'disabled' }); w.addEventListener('input', function () { r.w = C.num(w.value); });
                var on = P.el('input', { type: 'checkbox', checked: r.on ? 'checked' : false, disabled: can ? false : 'disabled' }); on.addEventListener('change', function () { r.on = on.checked; });
                return P.el('div', { 'class': 'mdm-kv' }, [P.el('span', { html: P.esc(r.field) + ' <span class="mdm-muted">(' + P.esc(r.how) + ')</span>' }), P.el('span', {}, [P.el('label', {}, [on, ' ']), w])]);
            }))));
        });
        host.appendChild(wrap);
        var pc = P.el('div', { 'class': 'mdm-card mdm-rules', style: 'margin-top:14px' }, [P.el('h3', { text: 'Параметры' })].concat(draft.params.map(function (p) {
            var v = P.input('number', p.value, { min: 0, max: 100, step: 1, disabled: canP ? false : 'disabled' }); v.addEventListener('input', function () { p.value = C.num(v.value); });
            return P.el('div', { 'class': 'mdm-kv', title: p.note }, [P.el('span', { html: P.esc(p.name) + '<div class="mdm-muted">' + P.esc(p.note) + '</div>' }), v]);
        })));
        host.appendChild(pc);
        var res = P.el('div', {});
        host.appendChild(P.el('div', { 'class': 'mdm-bar' }, [P.btn('Проверить', function () { preview(M, res); }), can ? P.btn('Сохранить правила', function () { save(M); }, 'mdm-primary') : null]));
        host.appendChild(res);
    }
    function draftRules() { return C.parseRules(draft.rules); }
    function draftParams() { var m = {}; draft.params.forEach(function (p) { m[p.name] = p.value; }); return C.parseParams(m); }
    function preview(M, res) {
        var now = live(M), nx = live(M, draftRules(), draftParams().dupThreshold);
        res.innerHTML = '';
        res.appendChild(P.table([{ t: 'Показатель', k: 'k' }, { t: 'Сейчас', k: 'a', num: true }, { t: 'С новыми правилами', k: 'b', num: true }], [
            { k: 'Групп дублей номенклатуры', a: now.groups, b: nx.groups }, { k: 'Доля дублей номенклатуры', a: P.pct(now.dup), b: P.pct(nx.dup) },
            { k: 'Групп дублей контрагентов', a: now.groupsK, b: nx.groupsK }, { k: 'Доля дублей контрагентов', a: P.pct(now.dupK), b: P.pct(nx.dupK) }]));
    }
    function save(M) {
        var ops = [];
        draft.rules.forEach(function (r) { var o = M.ruleRows.filter(function (x) { return x.id === r.id; })[0]; if (o && (o.w !== r.w || o.on !== r.on)) ops.push({ op: 'set', id: r.id, fields: { 'Вес поля': r.w, 'Правило включено': r.on ? 1 : -1 } }); });
        if (P.canWrite('Параметр НСИ')) draft.params.forEach(function (p) { var o = M.paramRows.filter(function (x) { return x.id === p.id; })[0]; if (o && o.value !== p.value) ops.push({ op: 'set', id: p.id, fields: { 'Значение параметра': p.value } }); });
        if (!ops.length) { P.toast('Изменений нет'); return; }
        P.batch(ops).then(function () { P.toast('Правила сохранены: ' + ops.length + ' изм.'); P.rerender(render); }).catch(function (e) { P.toast(e.message, true); });
    }
    P.mount(render);
})();
