/* Взыскание: Реестр дебиторов (первый клик демо) и карточка должника. */
(function () {
    'use strict';
    var W = window.Dbt, C = W.core, M = W.M;
    var state = { mgr: '', stage: '', q: '', onlyOver: true };
    var BUCKET_CLS = { cur: 'dbt-b-cur', b30: 'dbt-b-30', b60: 'dbt-b-60', b90: 'dbt-b-90', b90p: 'dbt-b-90p' };
    var STAGE_SHORT = { before: 'До срока', remind: '1–7 дн.', call: '8–14 дн.', stop: '15–30 дн.', claim: '31–60 дн.', court: '61+ дн.', restructuring: 'График' };

    function kpi(label, value, sub, cls) {
        return W.el('div', { 'class': 'dbt-kpi ' + (cls || '') }, [W.el('div', { 'class': 'dbt-kpi-v', text: value }), W.el('div', { 'class': 'dbt-kpi-l', text: label }), W.el('div', { 'class': 'dbt-kpi-s', text: sub || '' })]);
    }
    function agingBar(t) {
        var total = t.total || 1;
        return W.el('div', { 'class': 'dbt-aging' }, [
            W.el('div', { 'class': 'dbt-aging-bar' }, C.BUCKETS.map(function (b) { return W.el('div', { 'class': 'dbt-aging-seg ' + BUCKET_CLS[b[0]], style: 'width:' + (t[b[0]] / total * 100).toFixed(2) + '%', title: b[1] + ': ' + W.money(t[b[0]]) + ' ₽' }); })),
            W.el('div', { 'class': 'dbt-legend' }, C.BUCKETS.map(function (b) { return W.el('span', { html: '<i class="dbt-dot ' + BUCKET_CLS[b[0]] + '"></i>' + W.esc(b[1]) + ': <b>' + W.money(t[b[0]]) + '</b>' }); }))
        ]);
    }
    function stageBadge(r) { return W.badge(r.stage.name, r.override === 'restructuring' ? 'info' : r.stage.color); }
    function filtered() {
        return M.visible(state.mgr).filter(function (r) {
            if (state.onlyOver && r.overdue <= 0 && r.stageCode !== 'restructuring') return false;
            if (state.stage && r.stageCode !== state.stage) return false;
            if (state.q && r.name.toLowerCase().indexOf(state.q.toLowerCase()) < 0) return false;
            return true;
        }).sort(function (a, b) { return b.overdue - a.overdue; });
    }
    function render(host) {
        host.innerHTML = '';
        var mine = !!M.me && W.ctx.role.indexOf('Менеджер') === 0;
        if (mine) state.mgr = M.me;
        var base = M.visible(state.mgr), t = M.totals(base), rows = filtered();
        var share = t.total ? t.overdue / t.total * 100 : 0, stopped = base.filter(function (r) { return r.stop; });
        host.appendChild(W.el('h1', { text: mine ? 'Мои должники' : 'Реестр дебиторов' }));
        host.appendChild(W.el('p', { 'class': 'dbt-sub', text: 'Дебиторка на ' + C.toDmy(W.TODAY) + ': у каждого должника своя ступень воронки и обязательное следующее действие с исполнителем.' }));
        host.appendChild(W.el('div', { 'class': 'dbt-kpis' }, [
            kpi('Дебиторка', W.money(t.total) + ' ₽', base.length + ' клиентов'),
            kpi('Просрочено', W.money(t.overdue) + ' ₽', share.toFixed(1).replace('.', ',') + '% дебиторки', share > 15 ? 'dbt-kpi-bad' : ''),
            kpi('Просрочка свыше 30 дн.', W.money(t.b60 + t.b90 + t.b90p) + ' ₽', 'претензионная зона'),
            kpi('На стоп-отгрузке', String(stopped.length), W.money(stopped.reduce(function (s, r) { return s + r.debt; }, 0)) + ' ₽ долга', stopped.length ? 'dbt-kpi-warn' : '')
        ]));
        host.appendChild(agingBar(t));
        // воронка
        var fun = M.funnel(base);
        host.appendChild(W.el('div', { 'class': 'dbt-funnel', role: 'group', 'aria-label': 'Воронка просрочки' }, fun.map(function (f) {
            var st = M.stageBy[f.code] || { name: f.code, color: 'info' };
            return W.el('button', { type: 'button', 'class': 'dbt-step dbt-step-' + (st.color || 'info') + (state.stage === f.code ? ' dbt-step-on' : ''), 'data-stage': f.code, onclick: function () { state.stage = state.stage === f.code ? '' : f.code; render(host); } },
                [W.el('span', { 'class': 'dbt-step-n', text: String(f.n) }), W.el('span', { 'class': 'dbt-step-t', text: st.name }), W.el('span', { 'class': 'dbt-step-s', text: STAGE_SHORT[f.code] + ' · ' + W.money(f.sum) + ' ₽' })]);
        })));
        // фильтры
        var mgrs = [['', 'Все менеджеры']].concat(M.managers.map(function (m) { return [m['Менеджер'], m['Менеджер']]; }));
        var bar = W.el('div', { 'class': 'dbt-bar' });
        if (!mine) bar.appendChild(W.field('Менеджер', (function () { var s = W.select(mgrs, state.mgr); s.onchange = function () { state.mgr = s.value; render(host); }; return s; })()));
        bar.appendChild(W.field('Поиск', (function () { var i = W.el('input', { type: 'search', placeholder: 'Название клиента', value: state.q }); i.oninput = function () { state.q = i.value; refreshTable(); }; return i; })()));
        bar.appendChild(W.field('Показывать', (function () { var s = W.select([['1', 'Только с просрочкой'], ['0', 'Все с долгом']], state.onlyOver ? '1' : '0'); s.onchange = function () { state.onlyOver = s.value === '1'; render(host); }; return s; })()));
        if (state.stage) bar.appendChild(W.btn('Сбросить ступень', function () { state.stage = ''; render(host); }));
        host.appendChild(bar);
        var holder = W.el('div', { id: 'dbt-reg-table' });
        host.appendChild(holder);
        function refreshTable() { holder.innerHTML = ''; holder.appendChild(table(filtered(), host)); }
        refreshTable();
    }
    function table(rows, host) {
        var cols = [
            { t: 'Клиент', html: function (r) { return (r.key ? '<span class="dbt-key" title="Ключевой клиент: исключение из автоматической стоп-отгрузки">★</span> ' : '') + '<b>' + W.esc(r.name) + '</b><div class="dbt-mini">' + W.esc(W.shortFio(r.mgr)) + '</div>'; } },
            { t: 'Долг, ₽', num: true, html: function (r) { return W.money(r.debt); } },
            { t: 'Просрочено, ₽', num: true, html: function (r) { return r.overdue ? '<b>' + W.money(r.overdue) + '</b>' : '—'; } },
            { t: 'Не наст.', num: true, html: function (r) { return r.aging.cur ? W.money(r.aging.cur) : ''; } },
            { t: '0–30', num: true, html: function (r) { return r.aging.b30 ? W.money(r.aging.b30) : ''; } },
            { t: '31–60', num: true, html: function (r) { return r.aging.b60 ? W.money(r.aging.b60) : ''; } },
            { t: '61–90', num: true, html: function (r) { return r.aging.b90 ? W.money(r.aging.b90) : ''; } },
            { t: '90+', num: true, html: function (r) { return r.aging.b90p ? '<b class="dbt-red">' + W.money(r.aging.b90p) + '</b>' : ''; } },
            { t: 'Дней', num: true, html: function (r) { return r.maxDays || ''; } },
            { t: 'Ступень', html: function (r) { return stageBadge(r); } },
            { t: 'Следующее действие', html: function (r) { return '<div class="' + (r.hot ? 'dbt-red' : '') + '">' + W.esc(r.action) + '</div><div class="dbt-mini">' + W.esc(r.owner) + '</div>'; } },
            { t: 'Отгрузка', html: function (r) { return r.stop ? W.badge('СТОП', 'crit') : r.dec.needDirector ? W.badge('решает директор', 'warn') : r.dec.stop ? W.badge('нужен стоп', 'warn') : W.badge('открыта', 'ok'); } }
        ];
        return W.table(cols, rows, { empty: 'Нет должников по выбранным условиям', rowCls: function (r) { return r.hot ? 'dbt-row-hot' : ''; }, onrow: function (r) { W.openDebtor(r.name, function () { render(host); }); } });
    }

    /* ---------- карточка должника ---------- */
    W.templateVars = function (r, extra) {
        var oldest = r.docs.filter(function (d) { return d.days > 0; }).sort(function (a, b) { return b.days - a.days; });
        var v = { 'клиент': r.name, 'договор': (M.contractByClient[r.name] || {}).no || '', 'сумма': W.money2(r.overdue), 'просрочено': W.money2(r.overdue), 'документы': oldest.map(function (d) { return d.number; }).join(', '),
            'дней': r.maxDays, 'менеджер': r.mgr, 'дата': C.toDmy(W.TODAY), 'срок': C.toDmy(C.addDays(W.TODAY, 30)), 'пени': '0,00' };
        Object.keys(extra || {}).forEach(function (k) { v[k] = extra[k]; });
        return v;
    };
    function section(title, node) { return W.el('div', { 'class': 'dbt-sec' }, [W.el('h3', { text: title }), node]); }
    W.openDebtor = function (name, after) {
        var r = M.byName[name]; if (!r) return;
        var body = W.el('div', { 'class': 'dbt-card' });
        var docs = r.docs.slice().sort(function (a, b) { return b.days - a.days; });
        body.appendChild(W.el('div', { 'class': 'dbt-card-head', html: stageBadge(r) + ' ' + (r.stop ? W.badge('СТОП-ОТГРУЗКА', 'crit') : W.badge('отгрузка открыта', 'ok')) + (r.key ? ' ' + W.badge('ключевой клиент', 'info') : '') +
            '<div class="dbt-mini">ИНН ' + W.esc((M.clients[name] || {}).inn) + ' · договор ' + W.esc((M.contractByClient[name] || {}).no) + ' · менеджер ' + W.esc(r.mgr) + ' · лимит ' + W.money(r.limit) + ' ₽</div>' }));
        body.appendChild(W.el('div', { 'class': 'dbt-kpis dbt-kpis-s' }, [kpi('Долг', W.money(r.debt) + ' ₽'), kpi('Просрочено', W.money(r.overdue) + ' ₽', r.maxDays + ' дн. старейший'), kpi('Ступень', r.stage.name, r.owner)]));
        body.appendChild(W.el('p', { 'class': 'dbt-next', html: '<b>Следующее действие:</b> ' + W.esc(r.action) + ' <span class="dbt-mini">(' + W.esc(r.owner) + ')</span>' }));
        if (r.stop || r.dec.reasons.length) body.appendChild(W.el('p', { 'class': 'dbt-mini', text: (r.stop ? 'Стоп: ' + (M.clients[name].stopReason || '') + '. ' : '') + (r.dec.reasons.length ? 'По правилам: ' + r.dec.reasons.join('; ') + (r.dec.note ? ' (' + r.dec.note + ')' : '') : '') }));
        body.appendChild(section('Отгрузки с долгом', W.table([
            { t: 'Отгрузка', k: 'number' }, { t: 'Дата', html: function (d) { return C.toDmy(d.date); } }, { t: 'Срок оплаты', html: function (d) { return C.toDmy(d.due); } },
            { t: 'Сумма', num: true, html: function (d) { return W.money(d.amount); } }, { t: 'Оплачено', num: true, html: function (d) { return d.paid ? W.money(d.paid) : ''; } },
            { t: 'Остаток', num: true, html: function (d) { return '<b>' + W.money(d.balance) + '</b>'; } }, { t: 'Просрочка', num: true, html: function (d) { return d.days ? d.days + ' дн.' : 'нет'; } }], docs)));
        var pays = M.pays.filter(function (p) { return p.client === name; }).sort(function (a, b) { return a.date < b.date ? 1 : -1; }).slice(0, 6);
        body.appendChild(section('Последние оплаты', W.table([{ t: 'Платёжка', k: 'id' }, { t: 'Дата', html: function (p) { return C.toDmy(p.date); } }, { t: 'Отгрузка', k: 'doc' }, { t: 'Сумма', num: true, html: function (p) { return W.money(p.amount); } }], pays)));
        var cts = M.contacts.filter(function (c) { return c.client === name; }).sort(function (a, b) { return a.date < b.date ? 1 : -1; }).slice(0, 6);
        var prs = M.promises.filter(function (p) { return p.client === name; });
        body.appendChild(section('Контакты и обещания', W.el('div', {}, [
            W.table([{ t: 'Дата', html: function (c) { return C.toDmy(c.date); } }, { t: 'Канал', k: 'ch' }, { t: 'Тема', k: 'theme' }, { t: 'Итог', k: 'res' }], cts, { empty: 'Контактов пока нет' }),
            prs.length ? W.table([{ t: 'Обещано к', html: function (p) { return C.toDmy(p.date); } }, { t: 'Сумма', num: true, html: function (p) { return W.money(p.sum); } }, { t: 'Статус', html: function (p) { return W.badge(W.short(p.status), p.status === 'Обещание: нарушено' ? 'crit' : p.status === 'Обещание: исполнено' ? 'ok' : 'warn'); } }, { t: 'Комментарий', k: 'comment' }], prs) : null])));
        var btns = [];
        if (W.canWrite('Контакт')) {
            btns.push({ text: 'Напоминание', cls: 'dbt-primary', keep: true, fn: function () { remindDialog(r, after); return false; } });
            btns.push({ text: 'Записать обещание', keep: true, fn: function () { promiseDialog(r, after); return false; } });
        }
        btns.push({ text: 'Претензия и пени', keep: true, fn: function () { location.href = W.url('claim') + '#client=' + encodeURIComponent(r.name); return false; } });
        if (W.canWrite('Клиент')) btns.push({ text: r.stop ? 'Снять стоп-отгрузку' : 'Поставить на стоп-отгрузку', cls: r.stop ? '' : 'dbt-danger', keep: true, fn: function () { stopDialog(r, after); return false; } });
        else if (r.stop && W.canWrite('Запрос разблокировки')) btns.push({ text: 'Запросить разблокировку', keep: true, fn: function () { unblockDialog(r, after); return false; } });
        btns.push({ text: 'Закрыть' });
        W.modal(r.name, body, btns).box.classList.add('dbt-modal-wide');
    };
    function remindDialog(r, after) {
        var st = r.stageCode === 'stop' ? 'stop' : r.stageCode === 'call' ? 'call' : r.stageCode === 'claim' ? 'claim' : 'remind';
        var tpl = M.templates[M.stageBy[st].name] || M.templates['Напоминание'] || M.templates[Object.keys(M.templates)[0]] || { 'Тема': 'Напоминание', 'Текст шаблона': '' };
        var ta = W.el('textarea', { rows: 6 }); ta.value = C.fill(tpl['Текст шаблона'], W.templateVars(r));
        var ch = W.select(['Email', 'Мессенджер', 'Телефон'], st === 'call' ? 'Телефон' : 'Email');
        var body = W.el('div', {}, [W.el('p', { 'class': 'dbt-mini', text: 'Шаблон «' + tpl['Шаблон письма'] + '» заполнен суммами и документами. Ничего не отправляется само: менеджер видит текст и подтверждает.' }), W.field('Канал', ch), W.field('Текст', ta)]);
        W.modal('Напоминание: ' + r.name, body, [{ text: 'Отправить и записать контакт', cls: 'dbt-primary', fn: function (close) {
            M.create('Контакт', { 'Контакт': W.TODAY, 'Клиент': r.name, 'Менеджер': r.mgr, 'Канал контакта': ch.value, 'Автор': M.me || W.ctx.user, 'Тема': tpl['Тема'] ? C.fill(tpl['Тема'], W.templateVars(r)) : 'Напоминание', 'Итог': 'Отправлено из шаблона' })
                .then(function () { W.toast('Контакт записан в журнал'); return M.reload().then(function () { W.closeAll(); after && after(); }); }).catch(function (e) { W.toast(e.message, true); }); } }, { text: 'Отмена' }]);
    }
    function promiseDialog(r, after) {
        var d = W.el('input', { type: 'date', value: C.addDays(W.TODAY, 5) }), s = W.el('input', { type: 'number', value: Math.round(r.overdue), min: 0 }), c = W.el('input', { type: 'text', placeholder: 'Кто обещал, на каком основании' });
        W.modal('Обещание платежа: ' + r.name, W.el('div', {}, [W.field('Обещано к дате', d), W.field('Сумма, ₽', s), W.field('Комментарий', c)]), [{ text: 'Записать', cls: 'dbt-primary', fn: function () {
            if (!d.value || d.value < W.TODAY) { W.toast('Укажите будущую дату', true); return false; }
            M.create('Обещание', { 'Обещание': d.value, 'Клиент': r.name, 'Менеджер': r.mgr, 'Дата записи': W.TODAY, 'Сумма обещания': s.value, 'Статус обещания': 'Обещание: ждём', 'Комментарий': c.value })
                .then(function () { W.toast('Обещание записано'); return M.reload().then(function () { W.closeAll(); after && after(); }); }).catch(function (e) { W.toast(e.message, true); }); } }, { text: 'Отмена' }]);
    }
    function stopDialog(r, after) {
        var cl = M.clients[r.name], on = !r.stop, why = W.el('input', { type: 'text', value: on ? (r.dec.reasons[0] ? r.dec.reasons[0].charAt(0).toUpperCase() + r.dec.reasons[0].slice(1) : '') : '' });
        var body = W.el('div', {}, [W.el('p', { text: on ? 'Флаг виден менеджерам и складу в стоп-листе. Передача в учётную систему — отдельным обменом.' : 'Отгрузка по клиенту снова разрешена.' }), r.key && on ? W.el('p', { 'class': 'dbt-red', text: 'Ключевой клиент: стоп ставится только по решению финансового директора.' }) : null, on ? W.field('Причина', why) : null]);
        W.modal((on ? 'Стоп-отгрузка: ' : 'Снять стоп: ') + r.name, body, [{ text: on ? 'Поставить стоп' : 'Снять стоп', cls: on ? 'dbt-danger' : 'dbt-primary', fn: function () {
            M.set(cl.id, on ? { 'Стоп-отгрузка': 1, 'Причина стопа': why.value, 'Дата стопа': W.TODAY, 'Кто поставил стоп': W.ctx.user } : { 'Стоп-отгрузка': '', 'Причина стопа': '', 'Дата стопа': '', 'Кто поставил стоп': '' })
                .then(function () { W.toast(on ? 'Клиент на стоп-отгрузке' : 'Стоп снят'); return M.reload().then(function () { W.closeAll(); after && after(); }); }).catch(function (e) { W.toast(e.message, true); }); } }, { text: 'Отмена' }]);
    }
    function unblockDialog(r, after) {
        var c = W.el('textarea', { rows: 3, placeholder: 'Почему разрешить отгрузку, что обещает клиент' });
        W.modal('Запрос разблокировки: ' + r.name, W.el('div', {}, [W.field('Комментарий', c)]), [{ text: 'Отправить запрос', cls: 'dbt-primary', fn: function () {
            if (!c.value.trim()) { W.toast('Опишите причину', true); return false; }
            M.create('Запрос разблокировки', { 'Запрос разблокировки': W.TODAY, 'Клиент': r.name, 'Менеджер': r.mgr, 'Комментарий': c.value, 'Статус запроса': 'Запрос: на рассмотрении' })
                .then(function () { W.toast('Запрос ушёл финансовому директору'); return M.reload().then(function () { W.closeAll(); after && after(); }); }).catch(function (e) { W.toast(e.message, true); }); } }, { text: 'Отмена' }]);
    }

    W.mount(function (host) { return W.loadModel().then(function () { render(host); var h = /client=([^&]+)/.exec(location.hash); if (h) W.openDebtor(decodeURIComponent(h[1]), function () { render(host); }); }); });
})();
