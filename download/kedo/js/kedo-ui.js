/* КЭДО: общие компоненты экранов (значки статусов, карточка документа с подписью и историей, действия). */
(function () {
    'use strict';
    var P = window.Kedo, C = P.core;
    P.BORDER = 'Подпись и юридическую значимость даёт оператор КЭДО (здесь — Контур.КЭДО). Этот слой ведёт маршрут, статусы, сверку и возврат подписанного в ЗУП.';
    P.statusBadge = function (d) {
        var s = d.st, kind = { 'Подготовлен': 'mute', 'Отправлен': 'info', 'Открыт': 'info', 'Подписан': 'ok', 'Отказ': 'crit' }[d.status] || 'info';
        if (s.overdue) return P.badge(s.escalate ? 'просрочен, эскалация' : 'просрочен', s.escalate ? 'crit' : 'warn');
        return P.badge(String(d.status).toLowerCase(), kind);
    };
    P.zupBadge = function (d) {
        if (!d.st.signed) return '<span class="kedo-muted">—</span>';
        if (d.st.inZup) return P.badge('да, ' + C.toDmy(d.back).slice(0, 5), 'ok');
        return P.badge(d.st.zupError ? 'ошибка передачи' : 'нет', 'crit');
    };
    P.waitText = function (d) { return d.st.waiting ? d.st.wd + ' из ' + d.st.limit : ''; };
    P.deptHead = function (M, dept) { var x = M.depts.filter(function (d) { return d.name === dept; })[0]; return x ? x.head : 'руководителю подразделения'; };
    function kv(label, value) { return P.el('div', { 'class': 'kedo-kv' }, [P.el('span', { text: label }), P.el('span', { html: value })]); }
    /* Действия по документу; каждое пишет событие в историю. after() перерисовывает экран. */
    P.remind = function (d, after) {
        return P.addEvent(d, 'Напоминание сотруднику: СМС и уведомление в приложении оператора', 'Напоминание').then(function () { P.resetModel(); P.toast('Напоминание отправлено: ' + d.emp); if (after) after(); }).catch(function (e) { P.toast(e.message, true); });
    };
    P.escalate = function (M, d, after) {
        var head = P.deptHead(M, d.dept);
        return P.addEvent(d, 'Эскалация: ' + head + ' — документ не подписан ' + d.st.wd + ' раб. дн.', 'Эскалация').then(function () { P.resetModel(); P.toast('Эскалировано: ' + head); if (after) after(); }).catch(function (e) { P.toast(e.message, true); });
    };
    P.retry = function (d, after) {
        return P.retryZup(d).then(function (res) {
            if (res.ok) P.toast('Принят в ЗУП: ' + d.number); else P.toast((res.hint || res.error), true);
            if (after) after(res);
        }).catch(function (e) { P.toast(e.message, true); });
    };
    P.canAct = function () { return P.canWrite('Событие документа'); };
    /* Карточка документа: документ, подпись, маршрут, история, действия. */
    P.docCard = function (M, d, after) {
        var e = M.empBy[d.emp] || {}, t = M.typeBy[d.type] || {}, rt = M.routeBy[t.route];
        var hist = P.el('ol', { 'class': 'kedo-timeline' }, [P.el('li', { text: 'Загрузка истории...' })]);
        var body = P.el('div', {}, [
            P.el('div', { 'class': 'kedo-grid2' }, [
                P.el('div', {}, [P.el('h3', { text: 'Документ' }), kv('Тип', P.esc(d.type) + ' <span class="kedo-muted">(в ЗУП: ' + P.esc(d.zupKind) + ')</span>'), kv('Сотрудник', P.esc(d.emp) + ', ' + P.esc(e.tab || '')),
                    kv('Подразделение', P.esc(d.dept) + ', ' + P.esc(d.org)), kv('Должность', P.esc(e.position || '')), kv('Дата документа', C.toDmy(d.date)), kv('Кадровик', P.esc(d.kadr || ''))]),
                P.el('div', {}, [P.el('h3', { text: 'Подпись и учёт' }), kv('Статус подписи', P.statusBadge(d)), kv('Отправлен оператору', C.toDmy(d.sent) || '—'), d.st.waiting ? kv('Висит, раб. дней', d.st.wd + ' при сроке ' + d.st.limit) : null,
                    kv('Вид подписи', P.esc(d.sign || e.sign || '—')), kv('Подписан', C.toDmy(d.signed) || '—'), kv('Файл с подписью', d.file ? '<span class="kedo-chip">' + P.esc(d.file) + '</span>' : '—'),
                    kv('ID у оператора', P.esc(d.opId || '—')), kv('В ЗУП', P.zupBadge(d)), d.error ? kv('Ошибка передачи', '<span style="color:var(--p-red)">' + P.esc(d.error) + '</span>') : null, d.reason ? kv('Причина отказа', P.esc(d.reason)) : null])
            ]),
            rt ? P.el('div', {}, [P.el('h3', { text: 'Маршрут «' + rt.name + '»', style: 'margin-top:12px' }), P.el('div', { 'class': 'kedo-muted', text: rt.steps.map(function (s) { return s.order + '. ' + s.who + ' — ' + s.sign + ', ' + s.days + ' р.д.'; }).join('  →  ') })]) : null,
            P.el('h3', { text: 'История', style: 'margin-top:12px' }), hist,
            P.el('div', { 'class': 'kedo-border', text: P.BORDER })
        ]);
        var btns = [{ text: 'Закрыть' }];
        if (d.st.notInZup && P.canWrite('Кадровый документ')) btns.push({ text: 'Повторить передачу в ЗУП', cls: 'kedo-primary', fn: function (close) { P.retry(d, function (res) { close(); if (after) after(res); }); return false; } });
        if (d.st.waiting && P.canAct()) btns.push({ text: 'Напомнить', fn: function (close) { P.remind(d, function () { close(); if (after) after(); }); return false; } });
        if (d.st.overdue && P.canAct()) btns.push({ text: 'Эскалировать руководителю', fn: function (close) { P.escalate(M, d, function () { close(); if (after) after(); }); return false; } });
        P.modal(d.number + ': ' + d.type, body, btns, true);
        P.events(d).then(function (ev) {
            hist.innerHTML = '';
            ev.forEach(function (x) { hist.appendChild(P.el('li', { 'class': /Ошибка|Отказ|Эскалация/.test(x.kind) ? 'kedo-ev-bad' : (/Подпись|ЗУП/.test(x.kind) && !/Ошибка/.test(x.text) ? 'kedo-ev-ok' : '') }, [x.text, P.el('small', { text: C.toDmy(x.date) + ' ' + x.time + ' · ' + (x.who || '') })])); });
            if (!ev.length) hist.appendChild(P.el('li', { text: 'Событий нет' }));
        }).catch(function () { hist.innerHTML = '<li>История недоступна</li>'; });
    };
    /* Фильтры реестра: юрлицо, подразделение, тип, статус, поиск. */
    P.filterBar = function (M, st, onchange) {
        function opts(list, all) { return [['', all]].concat(list.map(function (x) { return [x, x]; })); }
        var uniq = function (a) { return a.filter(function (x, i) { return x && a.indexOf(x) === i; }).sort(); };
        var org = P.select(opts(uniq(M.docs.map(function (d) { return d.org; })), 'Все юрлица'), st.org || '');
        var dept = P.select(opts(uniq(M.docs.map(function (d) { return d.dept; })), 'Все подразделения'), st.dept || '');
        var type = P.select(opts(uniq(M.docs.map(function (d) { return d.type; })), 'Все типы'), st.type || '');
        var q = P.input('text', st.q || '', { placeholder: 'Сотрудник или номер' });
        [org, dept, type, q].forEach(function (c) { c.addEventListener('input', function () { st.org = org.value; st.dept = dept.value; st.type = type.value; st.q = q.value; onchange(); }); });
        return P.el('div', { 'class': 'kedo-bar' }, [P.field('Юрлицо', org), P.field('Подразделение', dept), P.field('Тип документа', type), P.field('Поиск', q)]);
    };
    P.applyFilter = function (docs, st) {
        var q = (st.q || '').toLowerCase();
        return docs.filter(function (d) { return (!st.org || d.org === st.org) && (!st.dept || d.dept === st.dept) && (!st.type || d.type === st.type) && (!q || (d.emp + ' ' + d.number).toLowerCase().indexOf(q) >= 0); });
    };
})();
