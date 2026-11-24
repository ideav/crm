/* Взыскание: Воронка просрочки и правила ступеней. Пороги, исключения «ключевых клиентов», стоп-отгрузка правятся на экране, реестр пересчитывается. */
(function () {
    'use strict';
    var W = window.Dbt, C = W.core, M = W.M;
    var state = { tab: 'board' };

    function board(host) {
        var cols = W.STAGE_ORDER.map(function (code) {
            var st = M.stageBy[code]; if (!st) return null;
            var rows = code === 'before' ? [] : M.rows.filter(function (r) { return r.stageCode === code; }).sort(function (a, b) { return b.overdue - a.overdue; });
            return W.el('div', { 'class': 'dbt-col' }, [
                W.el('h3', { html: '<span>' + W.esc(st.name) + '</span>' + W.badge(String(rows.length), st.color) }),
                W.el('div', { 'class': 'dbt-mini', text: code === 'restructuring' ? 'График платежей, пока он выполняется' : code === 'before' ? 'Просрочки нет' : 'с ' + st.from + '-го дня просрочки' }),
                W.el('div', { 'class': 'dbt-mini', text: st.action + ' · ' + st.owner })
            ].concat(rows.slice(0, 8).map(function (r) {
                return W.el('div', { 'class': 'dbt-chip', onclick: function () { location.href = W.url('registry') + '#client=' + encodeURIComponent(r.name); } }, [
                    W.el('div', { html: (r.key ? '<span class="dbt-key">★</span> ' : '') + '<b>' + W.esc(r.name) + '</b>' }),
                    W.el('div', { 'class': 'dbt-mini', text: W.money(r.overdue) + ' ₽ · ' + r.maxDays + ' дн.' + (r.stop ? ' · СТОП' : '') })]);
            })).concat(rows.length > 8 ? [W.el('div', { 'class': 'dbt-mini', text: 'и ещё ' + (rows.length - 8) })] : []));
        }).filter(Boolean);
        return W.el('div', { 'class': 'dbt-board' }, cols);
    }

    function saveAnd(host, p, msg) {
        return p.then(function () { W.toast(msg); return M.reload(); }).then(function () { render(host); }).catch(function (e) { W.toast(e.message, true); });
    }
    var OWNERS = ['Система', 'Менеджер', 'Кредитный контролёр', 'Юрист'];
    var PROFILE_NAME = { soft: 'Мягкий', strict: 'Жёсткий' };
    function stages(host) {
        var can = W.canWrite('Ступень'), custom = M.S.profile === 'custom', dayCan = can && custom;
        var order = M.stagesBase.filter(function (s) { return s.byAge; }).sort(function (a, b) { return a.from - b.from; });
        var rows = order.map(function (s) {
            var eff = M.stageBy[s.code] || s;
            var inp = W.el('input', { type: 'number', min: 0, value: custom ? s.from : eff.from, 'aria-label': 'С дня просрочки: ' + s.name, 'class': 'dbt-in', disabled: !dayCan || s.code === 'before' });
            var act = W.el('input', { type: 'text', value: s.action, 'aria-label': 'Что делаем: ' + s.name, 'class': 'dbt-in dbt-in-wide', disabled: !can });
            var own = W.select(OWNERS, s.owner); own.disabled = !can; own.setAttribute('aria-label', 'Кто: ' + s.name);
            return { s: s, inp: inp, act: act, own: own };
        });
        var tbl = W.table([
            { t: 'Ступень', html: function (r) { return W.badge(r.s.name, r.s.color); } },
            { t: 'С какого дня просрочки', html: function () { return ''; } },
            { t: 'Что делаем', html: function () { return ''; } },
            { t: 'Кто', html: function () { return ''; } }], rows);
        [].slice.call(tbl.querySelectorAll('tbody tr')).forEach(function (tr, i) { tr.children[1].appendChild(rows[i].inp); tr.children[2].appendChild(rows[i].act); tr.children[3].appendChild(rows[i].own); });
        var save = W.btn('Сохранить ступени и пересчитать реестр', function () {
            var prev = 0, ops = [], bad = '';
            rows.forEach(function (r) {
                var f = {}, v = Math.round(C.num(r.inp.value));
                if (r.s.code !== 'before' && custom) { if (v <= prev) bad = 'Дни ступеней должны возрастать: «' + r.s.name + '»'; prev = v; if (v !== r.s.from) f['С дня просрочки'] = v; }
                if (r.act.value !== r.s.action) f['Действие'] = r.act.value;
                if (r.own.value !== r.s.owner) f['Исполнитель'] = r.own.value;
                if (Object.keys(f).length) ops.push(M.set(r.s.id, f));
            });
            if (bad) { W.toast(bad, true); return; }
            if (!ops.length) { W.toast('Ничего не изменилось'); return; }
            saveAnd(host, Promise.all(ops), 'Ступени сохранены, реестр пересчитан');
        }, 'dbt-primary');
        var note = custom ? 'Ступень определяется возрастом самого старого долга. Измените день, действие или исполнителя и сохраните: клиенты перейдут между ступенями без участия программиста.'
            : 'Сейчас действует профиль границ «' + PROFILE_NAME[M.S.profile] + '» (экран «Настройки»): показаны его дни. Действия и исполнителей править можно; свои дни — после переключения профиля на «Свои границы».';
        return W.el('div', {}, [W.el('h2', { text: 'Ступени воронки' }), W.el('p', { 'class': 'dbt-sub', text: note }), tbl, can ? W.el('p', {}, [save]) : W.el('p', { 'class': 'dbt-mini', text: 'Править ступени может финансовый директор.' })]);
    }
    function rules(host) {
        var can = W.canWrite('Правило');
        var items = M.ruleRows.map(function (r) {
            var inp = W.el('input', { type: 'number', value: C.num(r['Значение правила']), 'class': 'dbt-in', disabled: !can, 'aria-label': r['Правило'] });
            return { r: r, inp: inp };
        });
        var tbl = W.table([{ t: 'Правило', html: function (x) { return '<b>' + W.esc(x.r['Правило']) + '</b><div class="dbt-mini">' + W.esc(x.r['Комментарий']) + '</div>'; } }, { t: 'Значение', html: function () { return ''; } }, { t: 'Единица', html: function (x) { return W.esc(x.r['Единица']); } }], items);
        [].slice.call(tbl.querySelectorAll('tbody tr')).forEach(function (tr, i) { tr.children[1].appendChild(items[i].inp); });
        var save = W.btn('Сохранить правила', function () {
            var ops = [];
            items.forEach(function (x) { if (C.num(x.inp.value) !== C.num(x.r['Значение правила'])) ops.push(M.set(x.r._id, { 'Значение правила': x.inp.value })); });
            if (!ops.length) { W.toast('Ничего не изменилось'); return; }
            saveAnd(host, Promise.all(ops), 'Правила сохранены, решения о стоп-отгрузке пересчитаны');
        }, 'dbt-primary');
        // стоп-решения
        var need = M.rows.filter(function (r) { return r.dec.stop && !r.stop; }), keep = M.rows.filter(function (r) { return r.dec.needDirector; });
        var MODE = { days: 'с N-го дня просрочки', sum: 'от суммы просрочки', either: 'день или сумма', both: 'и день, и сумма', limit: 'по лимиту клиента', any: 'любое из условий: день, сумма, лимит' };
        return W.el('div', {}, [W.el('h2', { text: 'Правила стоп-отгрузки' }), W.el('p', { 'class': 'dbt-sub', text: 'Условие стопа (экран «Настройки»): ' + MODE[M.S.stopMode] + '. Ключевые клиенты: ' + (M.S.keyAuto ? 'стоп как у всех.' : 'решает директор.') + ' Ниже — пороги.' }), tbl, can ? W.el('p', {}, [save]) : W.el('p', { 'class': 'dbt-mini', text: 'Править правила может финансовый директор.' }),
            W.el('p', { html: 'По текущим правилам: нужен стоп — <b>' + need.length + '</b> клиентов, решение за директором (ключевые) — <b>' + keep.length + '</b>.' }),
            need.length ? W.table([{ t: 'Клиент', k: 'name' }, { t: 'Почему', html: function (r) { return W.esc(r.dec.reasons.join('; ')); } }], need) : null]);
    }
    function whitelist(host) {
        var can = W.canWrite('Клиент');
        var list = Object.keys(M.clients).map(function (k) { return M.clients[k]; }).sort(function (a, b) { return (b.key ? 1 : 0) - (a.key ? 1 : 0) || (a.name < b.name ? -1 : 1); });
        var tbl = W.table([
            { t: 'Ключевой клиент', html: function () { return ''; } }, { t: 'Клиент', html: function (c) { return W.esc(c.name); } }, { t: 'Менеджер', html: function (c) { return W.esc(W.shortFio(c.mgr)); } },
            { t: 'Лимит долга, ₽', num: true, html: function (c) { return W.money(c.limit); } }, { t: 'Долг, ₽', num: true, html: function (c) { var r = M.byName[c.name]; return r ? W.money(r.debt) : ''; } }], list);
        [].slice.call(tbl.querySelectorAll('tbody tr')).forEach(function (tr, i) {
            var c = list[i], cb = W.el('input', { type: 'checkbox', 'aria-label': 'Ключевой клиент: ' + c.name, disabled: !can }); cb.checked = c.key;
            cb.onchange = function () { saveAnd(host, M.set(c.id, { 'Ключевой клиент': cb.checked ? 1 : '' }), cb.checked ? 'Клиент в белом списке: стоп только по решению директора' : 'Клиент убран из белого списка'); };
            tr.children[0].appendChild(cb);
        });
        return W.el('div', {}, [W.el('h2', { text: 'Белый список «ключевых клиентов»' }), W.el('p', { 'class': 'dbt-sub', text: 'Для ключевых клиентов система не ставит стоп-отгрузку сама, а предлагает решение директору.' }), tbl]);
    }
    function render(host) {
        host.innerHTML = '';
        host.appendChild(W.el('h1', { text: 'Воронка и правила' }));
        host.appendChild(W.el('p', { 'class': 'dbt-sub', text: 'Пять ступеней: напоминание, звонок, стоп-отгрузка, претензия, суд. Дни и исключения настраиваются здесь.' }));
        host.appendChild(W.tabs([['board', 'Воронка'], ['stages', 'Ступени'], ['rules', 'Правила стопа'], ['white', 'Ключевые клиенты']], state.tab, function (t) { state.tab = t; render(host); }));
        host.appendChild(state.tab === 'board' ? board(host) : state.tab === 'stages' ? stages(host) : state.tab === 'rules' ? rules(host) : whitelist(host));
    }
    W.mount(function (host) { return W.loadModel().then(function () { render(host); }); });
})();
