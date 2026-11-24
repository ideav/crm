/* PSA: общие компоненты экранов (ячейки загрузки, полоса недель, форма брони с проверкой при вводе). */
(function () {
    'use strict';
    var P = window.Psa, C = P.core;
    var CLS_LABEL = { free: 'свободен', ok: 'норма', high: 'почти полная', warn: 'овербукинг', crit: 'перегрузка', away: 'отсутствие', holiday: 'нерабочая неделя' };
    P.CLS_LABEL = CLS_LABEL;
    P.legend = function () {
        var items = [['free', 'меньше 50%'], ['ok', '50-90%'], ['high', '90-100%'], ['warn', '100-110%'], ['crit', 'больше 110%'], ['away', 'в отпуске'], ['holiday', 'нерабочая неделя']];
        return P.el('div', { 'class': 'psa-legend' }, items.map(function (i) { return P.el('span', {}, [P.el('i', { 'class': 'psa-h-' + i[0] }), i[1]]); }).concat([P.el('span', {}, [P.el('i', { 'class': 'psa-h-free psa-h-pend' }), 'пунктир: есть бронь на согласовании'])]));
    };
    P.cellText = function (l) {
        if (l.base === 0) return '–';
        if (l.cap === 0) return l.plan > 0 ? 'отп!' : 'отп';
        return String(Math.round(l.pct));
    };
    P.cellTitle = function (e, l) {
        var t = e.name + ', неделя с ' + C.toShort(l.week) + ': план ' + C.round1(l.plan) + ' ч из ' + C.round1(l.cap) + ' ч';
        if (l.absent > 0) t += ' (отпуск или больничный: ' + C.round1(l.absent) + ' ч)';
        l.items.forEach(function (i) { t += '\n' + i.project + ': ' + i.hours + ' ч' + (i.status === 'Запрошена' ? ' (на согласовании)' : ''); });
        return t;
    };
    /* Полоса недель брони с цветом загрузки: node. */
    P.loadStrip = function (M, emp, list, weeks) {
        var wrap = P.el('div', { 'class': 'psa-preview' });
        weeks.forEach(function (w) {
            var l = C.loadWeek(emp, w, list, M.hol, M.abs[emp.name] || [], { pending: true }), cls = C.loadClass(l, M.rules);
            wrap.appendChild(P.el('span', { 'class': 'psa-h-' + cls, title: P.cellTitle(emp, l), html: P.esc(P.cellText(l)) + '<small>' + C.toShort(w) + '</small>' }));
        });
        return wrap;
    };
    /* Результат проверки брони при вводе: узлы с ошибками и предупреждениями. */
    P.checkBox = function (res) {
        var box = P.el('div', {});
        res.errors.forEach(function (t) { box.appendChild(P.el('div', { 'class': 'psa-warnbox psa-e', text: t })); });
        res.warnings.forEach(function (t, i) { if (res.warnings.indexOf(t) === i) box.appendChild(P.el('div', { 'class': 'psa-warnbox psa-w', text: t })); });
        if (!res.errors.length && !res.warnings.length) box.appendChild(P.el('div', { 'class': 'psa-warnbox psa-g', text: 'Перегрузки нет: бронь укладывается в ёмкость по календарю.' }));
        return box;
    };
    P.pickProjects = function (M) {
        var mine = M.myProjects.length ? M.myProjects : M.projects;
        return mine.filter(function (p) { return p.contract !== 'Внутренний' || !M.myProjects.length; });
    };
    P.headOf = function (M, emp) { var p = M.pools.filter(function (x) { return x.name === emp.pool; })[0]; return p ? p.head : ''; };
    P.requester = function (M) { return M.myProjects.length ? M.myProjects[0].pm : (P.ctx.user || ''); };
    P.nextBookId = function (M) {
        var max = 0; M.bookings.forEach(function (b) { var n = parseInt(String(b.id).replace(/\D/g, ''), 10); if (n > max) max = n; });
        return 'BR-' + String(max + 1).padStart(4, '0');
    };
    /* Форма новой брони. o: {emp, project, from, to, hpw, kind, role, onSaved} */
    P.bookingForm = function (M, o) {
        o = o || {};
        var projSel = P.select(P.pickProjects(M).map(function (p) { return [p.name, p.code + ' ' + p.name]; }), o.project || (P.pickProjects(M)[0] || {}).name);
        var empSel = P.select(M.emps.map(function (e) { return [e.name, e.name + ' (' + e.pool + ', ' + e.grade + ')']; }), o.emp || M.emps[0].name);
        var kind = P.select([['Мягкая', 'Мягкая (с истечением)'], ['Жёсткая', 'Жёсткая']], o.kind || 'Мягкая');
        var from = P.input('date', o.from || C.weekStart(C.addDays(P.TODAY, 14))), to = P.input('date', o.to || C.addDays(C.weekStart(C.addDays(P.TODAY, 14)), 6 * 7 + 4));
        var hpw = P.input('number', o.hpw || 20, { min: 1, max: 60, step: 1 });
        var role = P.input('text', o.role || '', { placeholder: 'например, Java senior' });
        var out = P.el('div', {}), strip = P.el('div', {});
        var cur = { res: null };
        function build() {
            var e = M.empBy[empSel.value]; if (!e || !from.value || !to.value || to.value < from.value) { out.textContent = 'Заполните период'; cur.res = null; return null; }
            return { id: 'new', emp: e.name, project: projSel.value, kind: kind.value, status: 'Запрошена', from: from.value, to: to.value, hpw: C.num(hpw.value) };
        }
        function recalc() {
            var b = build(); out.innerHTML = ''; strip.innerHTML = ''; if (!b) return;
            var e = M.empBy[b.emp]; var res = C.checkBooking(e, b, M.bookings, M.hol, M.abs[e.name] || [], M.rules); cur.res = res;
            out.appendChild(P.checkBox(res));
            var ws = C.weeksBetween(b.from, b.to).slice(0, 14);
            strip.appendChild(P.el('div', { 'class': 'psa-muted', text: 'Загрузка ' + e.name + ' по неделям с учётом этой брони' + (C.weeksBetween(b.from, b.to).length > 14 ? ' (первые 14 недель)' : '') }));
            strip.appendChild(P.loadStrip(M, e, M.bookings.filter(function (x) { return true; }).concat([b]), ws));
            save.disabled = !res.ok;
        }
        [projSel, empSel, kind, from, to, hpw].forEach(function (c) { c.addEventListener('input', recalc); c.addEventListener('change', recalc); });
        var body = P.el('div', {}, [
            P.el('div', { 'class': 'psa-grid2' }, [P.field('Проект', projSel), P.field('Сотрудник', empSel), P.field('С', from), P.field('По', to), P.field('Часов в неделю', hpw), P.field('Вид брони', kind)]),
            P.field('Роль на проекте', role), strip, out,
            P.el('p', { 'class': 'psa-muted', text: 'Бронь уходит руководителю ресурсного пула на согласование. Мягкая бронь истекает через ' + M.rules.softDays + ' дн., если её не подтвердят.' })
        ]);
        var save = P.btn('Отправить на согласование', function () {
            var b = build(); if (!b || !cur.res || !cur.res.ok) return false;
            var e = M.empBy[b.emp];
            save.disabled = true;
            var f = { 'Бронь': P.nextBookId(M), 'Проект': b.project, 'Сотрудник': b.emp, 'Роль на проекте': role.value, 'Вид брони': b.kind, 'Статус брони': 'Запрошена', 'Бронь с': b.from, 'Бронь по': b.to, 'Часов в неделю': b.hpw, 'Заявитель': P.requester(M), 'Согласующий': P.headOf(M, e) };
            if (b.kind === 'Мягкая') f['Истекает'] = C.addDays(P.TODAY, M.rules.softDays);
            P.create('Бронь', f).then(function () { P.toast('Бронь отправлена на согласование'); m.close(); if (o.onSaved) o.onSaved(); }).catch(function (er) { P.toast(er.message, true); save.disabled = false; });
            return false;
        }, 'psa-primary');
        if (!P.canWrite('Бронь')) save.style.display = 'none';
        var m = P.modal(o.title || 'Новая бронь', body, [{ text: 'Отмена' }].concat([{ text: '', fn: function () { return false; } }]).slice(0, 1), true);
        m.box.querySelector('.psa-modal-foot').appendChild(save);
        recalc();
        return m;
    };
})();
