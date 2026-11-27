/* Адаптация персонала: «Маршруты». Свой маршрут на должность: шаги, роль исполнителя, отсчёт от оффера или выхода, смещение в днях; проверка перед сохранением; копия маршрута под новую должность. */
(function () {
    'use strict';
    var P = window.Onb, C = P.core;
    var st = { route: '', draft: null, dirty: false };
    var TYPES = ['Заявка', 'Задача', 'Встреча', 'Контрольная точка'], BASIS = ['от выхода', 'от оффера'];

    function draftOf(rt) { return rt.steps.map(function (s) { return Object.assign({}, s, { orig: s }); }); }
    function sample(M) { var d = M.today + 7; while (C.dow(d) !== 1) d++; return { start: d, offer: d - 10 }; }
    function save(host, M, rt) {
        var v = C.validateRoute(st.draft.filter(function (s) { return !s.del; }), rt.prob);
        if (!v.ok) { P.toast(v.errors[0], true); return; }
        var ops = [];
        st.draft.forEach(function (s) {
            var f = { 'Шаг маршрута': s.name.trim(), 'Маршрут адаптации': rt.id, 'Роль шага': s.role, 'Отсчёт шага': s.basis, 'Смещение, дн': s.offset, 'Порядок шага': s.order, 'Тип шага': s.type, 'Скрыт от новичка': s.hidden ? 1 : 0 };
            if (s.del && s.id) ops.push({ op: 'del', id: s.id });
            else if (s.del) return;
            else if (!s.id) ops.push({ op: 'new', id: 'Шаг маршрута', up: 1, fields: f });
            else { var o = s.orig; if (o.name !== s.name || o.role !== s.role || o.basis !== s.basis || o.offset !== C.num(s.offset) || o.order !== C.num(s.order) || o.type !== s.type || o.hidden !== s.hidden) ops.push({ op: 'save', id: s.id, fields: f }); }
        });
        if (!ops.length) { P.toast('Изменений нет'); return; }
        P.batch(ops).then(function () { st.draft = null; st.dirty = false; P.reload(function (M2) { render(host, M2); P.toast('Маршрут сохранён: ' + ops.length + ' изм. Действует для следующих запусков.'); }); }).catch(function (e) { P.toast(e.message, true); });
    }
    function copy(host, M, rt) {
        var name = P.input('text', rt.name + ' (копия)'), err = P.el('div', {});
        P.modal('Копия маршрута', P.el('div', {}, [P.field('Название нового маршрута', name), err]), [{ text: 'Отмена' }, { text: 'Создать копию', cls: 'ob-primary', fn: function (close) {
            var nm = name.value.trim();
            if (!nm || M.routeBy[nm]) { err.innerHTML = '<div class="ob-warnbox ob-e">' + (nm ? 'Маршрут с таким названием уже есть' : 'Укажите название') + '</div>'; return false; }
            var ops = [{ op: 'new', id: 'Маршрут адаптации', up: 1, fields: { 'Маршрут адаптации': nm, 'Описание маршрута': 'Копия «' + rt.name + '»', 'Испытательный срок, дн': rt.prob } }];
            rt.steps.forEach(function (s) { ops.push({ op: 'new', id: 'Шаг маршрута', up: 1, fields: { 'Шаг маршрута': s.name, 'Маршрут адаптации': ':id0', 'Роль шага': s.role, 'Отсчёт шага': s.basis, 'Смещение, дн': s.offset, 'Порядок шага': s.order, 'Тип шага': s.type, 'Скрыт от новичка': s.hidden ? 1 : 0, 'Подсказка шага': s.hint || '' } }); });
            P.batch(ops).then(function () { close(); st.route = nm; st.draft = null; P.reload(function (M2) { render(host, M2); P.toast('Создан маршрут ' + nm); }); }).catch(function (e) { P.toast(e.message, true); });
            return false;
        } }]);
    }
    function render(host, M) {
        host.innerHTML = '';
        host.appendChild(P.el('h1', { text: 'Маршруты адаптации' }));
        host.appendChild(P.el('p', { 'class': 'ob-sub', text: 'У склада, офиса и продаж свой порядок: правьте шаги, исполнителей и сроки прямо здесь. Срок считается от даты оффера или выхода (минус - «до выхода»); если выпал на выходной, подготовка сдвигается на пятницу, шаги после выхода - на понедельник.' }));
        if (!M.routes.length) { host.appendChild(P.el('p', { text: 'Маршрутов нет' })); return; }
        if (!st.route || !M.routeBy[st.route]) st.route = M.routes[0].name;
        var rt = M.routeBy[st.route], canW = P.canWrite('Шаг маршрута');
        host.appendChild(P.tabs(M.routes.map(function (r) { return [r.name, r.name, r.steps.length]; }), st.route, function (k) { if (st.dirty && k !== st.route) { P.toast('Сначала сохраните или отмените правки', true); return; } st.route = k; st.draft = null; render(host, M); }));
        if (!st.draft) st.draft = draftOf(rt);
        var used = M.positions.filter(function (p) { return p.route === rt.name; }).map(function (p) { return p.name; });
        var smp = sample(M);
        host.appendChild(P.el('p', { html: P.esc(rt.descr || '') + '<br><small class="ob-muted">Должности: ' + P.esc(used.join(', ') || 'нет') + '. Испытательный ' + rt.prob + ' дн. Колонка «Пример» - сроки для новичка с выходом в пн ' + C.fmtD(smp.start) + ' (оффер ' + C.fmtDM(smp.offer) + ').</small>' }));
        function inp(s, k, type, opts) {
            var el = opts ? P.select(opts, s[k]) : P.input(type, s[k]);
            if (type === 'checkbox') { el.checked = !!s[k]; }
            el.disabled = !canW;
            el.onchange = function () { s[k] = type === 'checkbox' ? el.checked : type === 'number' ? C.num(el.value) : el.value; st.dirty = true; render(host, M); };
            return P.el('span', { 'class': 'ob-edit' }, [el]);
        }
        var live = st.draft.filter(function (s) { return !s.del; }).sort(function (a, b) { return C.num(a.order) - C.num(b.order); });
        host.appendChild(P.table([
            { t: '№', node: function (s) { return inp(s, 'order', 'number'); } },
            { t: 'Шаг', node: function (s) { return inp(s, 'name', 'text'); } },
            { t: 'Исполнитель (роль)', node: function (s) { var r = M.roleBy[s.role]; return P.el('div', {}, [inp(s, 'role', '', M.roles.map(function (x) { return x.name; })), P.el('small', { 'class': 'ob-muted', text: r && r.exec ? ' ' + r.exec : r ? ' по новичку' : '' })]); } },
            { t: 'Тип', node: function (s) { return inp(s, 'type', '', TYPES); } },
            { t: 'Отсчёт', node: function (s) { return inp(s, 'basis', '', BASIS); } },
            { t: 'Дней', node: function (s) { return inp(s, 'offset', 'number'); } },
            { t: 'Скрыт', node: function (s) { return inp(s, 'hidden', 'checkbox'); } },
            { t: 'Пример', html: function (s) { var d = C.dueDate(s, smp.offer, smp.start); return d === null ? '' : C.fmtDM(d) + ' ' + C.wd(d); } },
            { t: '', node: function (s) { return canW ? P.btn('×', function () { s.del = true; st.dirty = true; render(host, M); }, 'ob-small ob-danger') : P.el('span', {}); } }
        ], live, { rowCls: function (s) { return s.id ? '' : 'ob-row-hl'; } }));
        var v = C.validateRoute(live, rt.prob);
        v.errors.forEach(function (e) { host.appendChild(P.el('div', { 'class': 'ob-warnbox ob-e', text: e })); });
        v.warns.forEach(function (e) { host.appendChild(P.el('div', { 'class': 'ob-warnbox ob-warn', text: e })); });
        if (!canW) { host.appendChild(P.el('p', { 'class': 'ob-muted', text: 'Маршрут правит HR; вам - только просмотр.' })); return; }
        var maxO = live.reduce(function (m, s) { return Math.max(m, C.num(s.order)); }, 0);
        host.appendChild(P.el('div', { 'class': 'ob-bar' }, [
            P.btn('+ Шаг', function () { st.draft.push({ id: '', name: 'Новый шаг', role: 'HR', basis: 'от выхода', offset: 1, order: maxO + 1, type: 'Задача', hidden: false }); st.dirty = true; render(host, M); }),
            P.btn('Сохранить маршрут', function () { save(host, M, rt); }, 'ob-primary'),
            st.dirty ? P.btn('Отменить правки', function () { st.draft = null; st.dirty = false; render(host, M); }) : null,
            P.el('span', { 'class': 'ob-grow' }),
            P.btn('Копия маршрута', function () { copy(host, M, rt); })]));
        host.appendChild(P.el('p', { 'class': 'ob-muted', text: 'Правка маршрута действует для следующих запусков; новички, уже идущие по маршруту, остаются со своим планом.' }));
    }
    P.mount(render);
})();
