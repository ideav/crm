/* MDM: Поиск дублей. Группы похожих записей с долей совпадения и объяснением, выбор золотой записи поле за полем, слияние с журналом. */
(function () {
    'use strict';
    var P = window.Mdm, C = P.core;
    var st = { kind: P.NOM, found: false, thr: 0 };

    function render(host, M) {
        var h = P.hash(); if (h.kind === 'kon') st.kind = P.KON; if (h.run) st.found = true;
        if (!st.thr) st.thr = M.params.dupThreshold;
        host.innerHTML = '';
        P.head('Поиск дублей', 'Справочник собран из 1С:УТ, 1С:ERP филиала и Excel склада. Система сравнивает записи по правилам похожести (артикул, бренд, наименование после нормализации; для контрагентов - ИНН, КПП, наименование) и объясняет, почему считает их дублями.').forEach(function (e) { host.appendChild(e); });
        host.appendChild(P.tabs([[P.NOM, 'Номенклатура (' + M.nom.filter(C.active).length + ')'], [P.KON, 'Контрагенты (' + M.kon.filter(C.active).length + ')']], st.kind, function (k) { st.kind = k; render(host, M); }));
        if (!st.found) {
            host.appendChild(P.el('div', { 'class': 'mdm-start' }, [
                P.el('p', { html: 'Живых записей: <b>' + P.list(M, st.kind).filter(C.active).length + '</b> из ' + M.systems.filter(function (s) { return s.prio < 5; }).length + ' систем. Порог дубля: <b>' + st.thr + '%</b> (правится методологом на экране «Качество и правила»).' }),
                P.btn('Найти дубли', function () { st.found = true; render(host, M); }, 'mdm-primary')
            ]));
            return;
        }
        var t0 = Date.now(), groups = P.groups(M, st.kind, st.thr), ms = Date.now() - t0, list = P.list(M, st.kind);
        var extra = 0; groups.forEach(function (g) { extra += g.members.length - 1; });
        var money = 0, moneyGroups = 0;
        if (st.kind === P.KON && M.canMoney) groups.forEach(function (g) { var a = 0, d = 0; g.members.forEach(function (m) { a += m.advance || 0; d += m.debt || 0; }); if (a && d) { money += Math.min(a, d); moneyGroups++; } });
        var thrSel = P.select([['75', '75%'], ['80', '80%'], ['85', '85%'], ['90', '90%'], ['95', '95%']], String(st.thr));
        thrSel.addEventListener('change', function () { st.thr = +thrSel.value; render(host, M); });
        host.appendChild(P.el('div', { 'class': 'mdm-bar' }, [P.field('Порог похожести', thrSel), P.el('div', { 'class': 'mdm-grow' }),
            P.btn('Выгрузить группы (CSV)', function () { exportCsv(groups); })]));
        var kp = [P.kpi('Групп дублей', String(groups.length), 'найдено за ' + ms + ' мс', groups.length ? 'bad' : 'good'), P.kpi('Лишних записей', String(extra), C.dupShare(list, groups) + '% справочника', extra ? 'warn' : 'good'),
            P.kpi('Из разных систем', String(groups.filter(function (g) { return g.sources.length > 1; }).length), 'групп, где один объект заведён в 2-3 системах')];
        if (st.kind === P.KON && M.canMoney) kp.push(P.kpi('Аванс не зачтён', P.money(money), moneyGroups + ' контрагент: аванс на одной карточке, долг на другой', money ? 'bad' : 'good'));
        if (st.kind === P.KON) { var bad = list.filter(function (r) { return C.active(r) && r['ИНН'] && !C.validInn(r['ИНН']); }); kp.push(P.kpi('ИНН с ошибкой', String(bad.length), bad.map(function (r) { return r.name; }).join(', ') || 'контрольная сумма сходится у всех', bad.length ? 'warn' : 'good')); }
        host.appendChild(P.el('div', { 'class': 'mdm-kpis' }, kp));
        if (!groups.length) { host.appendChild(P.el('p', { 'class': 'mdm-empty', text: 'Дублей выше порога нет.' })); return; }
        /* сначала группы, где дубль держит деньги (аванс на одной карточке, долг на другой) */
        var hurts = function (g) { var a = 0, d = 0; g.members.forEach(function (m) { a += m.advance || 0; d += m.debt || 0; }); return a && d ? 1 : 0; };
        groups.slice().sort(function (x, y) { return hurts(y) - hurts(x); }).forEach(function (g) { host.appendChild(card(host, M, g)); });
    }
    function card(host, M, g) {
        var a = 0, d = 0; g.members.forEach(function (m) { a += m.advance || 0; d += m.debt || 0; });
        var pend = P.pendingFor(M, g.members.map(function (m) { return m.code; }));
        var mem = P.el('div', { 'class': 'mdm-members' }, g.members.map(function (m) {
            var money = m.advance ? ' ' + P.badge('аванс ' + P.money(m.advance), 'warn') : m.debt ? ' ' + P.badge('долг ' + P.money(m.debt), 'crit') : '';
            return P.el('div', { html: P.recLine(m) + money });
        }));
        mem.appendChild(P.el('div', { 'class': 'mdm-why', html: '<b>Почему дубль:</b> ' + P.esc(g.reason) }));
        if (a && d) mem.appendChild(P.el('div', { 'class': 'mdm-warnbox mdm-e', text: 'Аванс ' + P.money(a) + ' висит на одной карточке, а долг ' + P.money(d) + ' - на другой: зачесть их нельзя, пока карточки не слиты.' }));
        if (pend) mem.appendChild(P.el('div', { 'class': 'mdm-warnbox mdm-w', text: 'Слияние ' + pend.no + ' уже предложено (' + pend.by + ', ' + C.ruDate(pend.dp) + ') и ждёт подтверждения руководителя НСИ в журнале.' }));
        var act = P.el('div', {}, [P.btn(pend ? 'Открыть' : 'Разобрать', function () { openGroup(host, M, g); }, pend ? '' : 'mdm-primary')]);
        return P.el('div', { 'class': 'mdm-group' + (a && d ? ' mdm-money' : '') }, [P.el('div', { 'class': 'mdm-score', html: g.score + '%<small>' + g.members.length + ' записи · ' + g.sources.length + ' сист.</small>' }), mem, act]);
    }
    function val(m, f) { return f === 'Наименование' ? m.name : m[f]; }
    function openGroup(host, M, g) {
        var fields = P.FIELDS[g.kind], gold = C.suggestGolden(g.members, M.prio), chosen = C.mergeFields(g.members, gold, fields, M.prio);
        var body = P.el('div', {});
        function draw() {
            body.innerHTML = '';
            body.appendChild(P.el('p', { 'class': 'mdm-muted', text: 'Золотая запись предложена по приоритету источника (' + M.systems.map(function (s) { return s.name + ' - ' + s.prio; }).join(', ') + '), затем по числу документов. Щёлкните по ячейке, чтобы взять значение поля из другой записи.' }));
            var thead = P.el('tr', {}, [P.el('th', { text: 'Поле' })].concat(g.members.map(function (m) {
                var r = P.el('input', { type: 'radio', name: 'gold', checked: m === gold ? 'checked' : false, onchange: function () { gold = m; chosen = C.mergeFields(g.members, gold, fields, M.prio); draw(); } });
                return P.el('th', {}, [P.el('label', {}, [r, ' золотая']), P.el('div', { 'class': 'mdm-muted', text: m.code + ' · ' + m.source })]);
            })));
            var rows = fields.concat(['Документов', 'Заведена']).map(function (f) {
                var vals = g.members.map(function (m) { return f === 'Документов' ? m.docs : f === 'Заведена' ? C.ruDate(m.date) + ', ' + m.who : val(m, f) || ''; });
                var differ = vals.filter(function (v, i, a) { return a.indexOf(v) === i; }).length > 1;
                return P.el('tr', {}, [P.el('td', { html: '<b>' + P.esc(f) + '</b>' })].concat(g.members.map(function (m, i) {
                    if (fields.indexOf(f) < 0) return P.el('td', { 'class': 'mdm-muted', text: vals[i] });
                    var picked = chosen[f] && chosen[f].from === m.id;
                    return P.el('td', { 'class': 'mdm-pick' + (picked ? ' mdm-picked' : '') + (differ && !picked ? ' mdm-diff' : ''), text: vals[i] || '-', title: 'Взять это значение',
                        onclick: function () { if (!vals[i]) return; chosen[f] = { value: vals[i], from: m.id, source: m.source }; draw(); } });
                })));
            });
            if (g.kind === P.KON && M.canMoney) rows.push(P.el('tr', {}, [P.el('td', { html: '<b>Аванс / долг</b>' })].concat(g.members.map(function (m) { return P.el('td', { text: (m.advance ? 'аванс ' + P.money(m.advance) : '') + (m.debt ? ' долг ' + P.money(m.debt) : '') || '-' }); }))));
            body.appendChild(P.el('div', { 'class': 'mdm-tablewrap' }, [P.el('table', { 'class': 'mdm-table mdm-cmp' }, [P.el('thead', {}, [thead]), P.el('tbody', {}, rows)])]));
            body.appendChild(P.el('h3', { text: 'Объяснение по парам', style: 'margin-top:14px' }));
            var byId = {}; g.members.forEach(function (m) { byId[m.id] = m; });
            body.appendChild(P.el('ul', { 'class': 'mdm-why' }, g.pairs.map(function (p) { return P.el('li', { html: '<b>' + p.score + '%</b> ' + P.esc(byId[p.a].code) + ' ↔ ' + P.esc(byId[p.b].code) + ': ' + P.esc(p.reason) }); })));
            body.appendChild(P.el('p', { 'class': 'mdm-muted', text: 'После слияния: золотая запись получает статус «Эталон», остальные - «Дубль (слит)» со ссылкой на неё; их коды в исходных системах остаются в таблице соответствий. Всё пишется в журнал со снимком «до» - слияние можно откатить.' }));
        }
        draw();
        var R = M.rights, can = P.canWrite('Слияние');
        var pend = P.pendingFor(M, g.members.map(function (m) { return m.code; }));
        P.modal('Группа дублей: ' + g.score + '%', body, [
            { text: 'Закрыть' },
            can && R.propose && !R.confirm && !pend ? { text: 'Предложить слияние', cls: 'mdm-primary', fn: function (close) { go(false, close); return false; } } : null,
            can && R.confirm && !pend ? { text: 'Слить', cls: 'mdm-primary', fn: function (close) { go(true, close); return false; } } : null,
            pend ? { text: 'К журналу (' + pend.no + ')', fn: function () { location.href = P.nav('journal', 'no=' + pend.no); } } : null
        ], true);
        function go(confirm, close) {
            P.applyMerge(M, g, gold.id, chosen, confirm).then(function (plan) {
                close(); P.toast(confirm ? 'Слито: ' + plan.golden.code + ' ← ' + plan.absorbed.map(function (m) { return m.code; }).join(', ') : 'Слияние предложено, ждёт подтверждения руководителя НСИ');
                P.rerender(render);
            }).catch(function (e) { P.toast(e.message, true); });
        }
    }
    function exportCsv(groups) {
        var rows = []; groups.forEach(function (g, i) { g.members.forEach(function (m) { rows.push([i + 1, g.score, m.code, m.name, m['Артикул'] || m['ИНН'] || '', m.source, m.srcCode, g.reason]); }); });
        P.download('дубли-' + (st.kind === P.KON ? 'контрагенты' : 'номенклатура') + '.csv', C.toCsv(['Группа', 'Доля, %', 'Код НСИ', 'Наименование', 'Артикул/ИНН', 'Система', 'Код в системе', 'Почему'], rows));
    }
    P.mount(render);
})();
