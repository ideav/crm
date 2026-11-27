/* ТОиР: операции записи, общие для экранов: наряд с резервом запчастей, закрытие наряда, ответ по дефекту. */
(function () {
    'use strict';
    var T = window.Toir, C = T.core, el = T.el;
    T.EXEC = [['slesar-zakharov', 'Ремонтная бригада Захарова'], ['slesar-orlov', 'Ремонтная бригада Орлова'], ['naladchik-fedorov', 'Наладчики (Фёдоров)'], ['electric-kip', 'Участок КИПиА'], ['obhodchik', 'Бригада Ц2 (Лапин)'], ['obhodchik2', 'Бригада Ц1 (Гусев)']];
    T.teamOf = function (login) { var x = T.EXEC.filter(function (e) { return e[0] === login; })[0]; return x ? x[1] : login; };
    /* Проверка запчастей по норме вида работ против свободного остатка. */
    T.partsCheck = function (M, work) {
        return (M.norms[work] || []).map(function (n) { var p = M.parts[n.part] || { stock: 0, reserved: 0, lead: 0 }, free = C.free(p); return { part: n.part, qty: n.qty, free: free, ok: free >= n.qty, lead: p.lead, unit: p.unit || '' }; });
    };
    T.partsHtml = function (chk) {
        if (!chk.length) return '<span class="toir-muted">без запчастей</span>';
        return chk.map(function (c) { return (c.ok ? '<span class="toir-green">✓</span> ' : '<span class="toir-red">нет</span> ') + T.esc(c.part) + ' — ' + T.fmt(c.qty, c.qty % 1 ? 1 : 0) + ' ' + T.esc(c.unit) + ' <small class="toir-muted">(свободно ' + T.fmt(c.free, c.free % 1 ? 1 : 0) + (c.ok ? '' : ', поставка ' + c.lead + ' дн.') + ')</small>'; }).join('<br>');
    };
    /* Наряд: номер, запись, резерв запчастей (свободное — «Зарезервирована», нехватка — «Нет на складе»), статус дефекта. */
    T.makeOrder = function (M, o) {
        var no = C.nextNo('Н-', M.orders.map(function (x) { return x.name; }), 4), eq = M.eqBy[o.eq] || {};
        var f = { 'Наряд': no, 'Оборудование': o.eq, 'Цех': eq.shop, 'Вид работ': o.work, 'Исполнитель наряда': o.exec, 'Бригада': T.teamOf(o.exec), 'Плановая дата наряда': o.plan, 'Статус наряда': 'Запланирован' };
        if (o.defect) f['Дефект'] = o.defect; if (o.ppr) f['ППР'] = o.ppr; if (o.stop) f['Останов'] = o.stop;
        return T.create('Наряд', f).then(function (id) {
            M.orders.push({ id: id, name: no, defect: o.defect || '', ppr: o.ppr || '', eq: o.eq, shop: eq.shop, work: o.work, stop: o.stop || '', exec: o.exec, team: T.teamOf(o.exec), plan: o.plan, status: 'Запланирован', hours: 0, done: '', exported: '' });
            var chain = Promise.resolve();
            T.partsCheck(M, o.work).forEach(function (c) {
                chain = chain.then(function () {
                    var p = M.parts[c.part], st = c.ok ? 'Зарезервирована' : 'Нет на складе';
                    return T.create('Запчасть наряда', { 'Наряд': no, 'Запчасть': c.part, 'Цех': eq.shop, 'Количество': c.qty, 'Статус резерва': st }).then(function (pid) {
                        (M.orderParts[no] = M.orderParts[no] || []).push({ id: pid, part: c.part, qty: c.qty, status: st });
                        if (c.ok && p) { p.reserved += c.qty; return T.update(p.id, { 'В резерве': p.reserved }); }
                    });
                });
            });
            if (o.defect && M.defBy[o.defect]) chain = chain.then(function () {
                var d = M.defBy[o.defect], ans = 'Наряд ' + no + ' на ' + C.ru(o.plan) + ', ' + T.teamOf(o.exec);
                d.status = 'В ремонте'; d.answer = ans; d.work = o.work;
                var df = { 'Статус дефекта': 'В ремонте', 'Ответ автору': ans, 'Вид работ': o.work }; if (o.stop) { df['Останов'] = o.stop; d.stop = o.stop; }
                return T.update(d.id, df);
            });
            return chain.then(function () { return no; });
        });
    };
    /* Окно «В ремонт»: вид работ, исполнитель, дата, запчасти по норме против склада. */
    T.orderDialog = function (M, o, done) {
        var works = Object.keys(M.works).sort(), w = T.select([['', '— вид работ —']].concat(works), o.work || '');
        var ex = T.select(T.EXEC.map(function (e) { return [e[0], e[1]]; }), o.exec || 'slesar-zakharov');
        var dt = T.input('date', o.plan || C.addDays(T.TODAY, 1));
        var chk = el('div', { 'class': 'toir-note' });
        var upd = function () { var c = T.partsCheck(M, w.value), wk = M.works[w.value]; chk.innerHTML = (wk ? 'Норма ' + T.h(wk.hours) + ', ' + T.esc(wk.prof) + (wk.stop === 'Да' ? ', нужен останов' : '') + '<br>' : '') + T.partsHtml(c); chk.className = 'toir-note' + (c.some(function (x) { return !x.ok; }) ? ' toir-note-warn' : ''); };
        w.addEventListener('change', upd); upd();
        var body = el('div', {}, [el('p', { 'class': 'toir-sub', text: o.eq + (o.defect ? ' · ' + o.defect : '') + (o.stop ? ' · ' + o.stop : '') }), T.field('Вид работ', w), T.field('Исполнитель', ex), T.field('Плановая дата', dt), chk]);
        T.modal('В ремонт: наряд', body, [{ text: 'Отмена' }, { text: 'Создать наряд и зарезервировать', cls: 'toir-primary', fn: function () {
            if (!w.value) { T.toast('Выберите вид работ', true); return false; }
            return T.makeOrder(M, { eq: o.eq, defect: o.defect, ppr: o.ppr, stop: o.stop, work: w.value, exec: ex.value, plan: dt.value }).then(function (no) { T.toast('Наряд ' + no + ' создан, запчасти по норме зарезервированы'); if (done) done(no); });
        } }]);
    };
})();
