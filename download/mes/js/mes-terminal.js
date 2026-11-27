/* MES: терминал рабочего (телефон/планшет) — взять задание, выпуск, брак, простой, свой заработок. */
(function () {
    'use strict';
    var P = window.Mes, C = P.core;
    P.uid = function (prefix) { var d = new Date(); return prefix + '-' + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') + '-' + String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0') + String(d.getSeconds()).padStart(2, '0') + Math.floor(Math.random() * 90 + 10); };
    P.mount(function (host, M) {
        host.classList.add('mes-term');
        var h = P.hash();
        var pool = M.me ? [M.me] : M.workers.filter(function (w) { return !M.mySection || w.section === M.mySection; });
        var W = M.me || pool.filter(function (w) { return w.name === h.w; })[0] || pool[0];
        if (!W) { host.appendChild(P.note('Нет рабочих, доступных этой роли', 'warn')); return; }
        host.appendChild(P.el('div', { 'class': 'mes-term-top' }, [
            P.el('div', {}, [P.el('div', { 'class': 'mes-term-name', text: W.name }), P.el('div', { 'class': 'mes-muted', text: W.num + ' · ' + W.section + ' · ' + W.grade + ' разряд · ' + C.toRu(M.today) })]),
            M.me ? null : P.field('Кто за терминалом', (function () { var s = P.select(pool.map(function (w) { return [w.name, w.name + ' (' + w.num + ')']; }), W.name); s.addEventListener('change', function () { location.hash = 'w=' + encodeURIComponent(s.value); P.redraw(); }); return s; })())
        ]));
        var base = { marks: M.marks, downs: M.downs, taskBy: M.taskBy, workers: M.workers, rates: M.rates, reasonKind: M.reasonKind, rules: M.rules, only: W.name };
        var today = C.earnings(Object.assign({ from: M.today, to: M.today }, base))[0] || {}, month = C.earnings(Object.assign({ from: P.MONTH_FROM, to: M.today }, base))[0] || {};
        host.appendChild(P.el('div', { 'class': 'mes-kpis mes-kpis-term' }, [
            P.kpi('Заработал сегодня', P.money((today.paid || 0) + (today.pending || 0) + (today.idlePay || 0)), (today.good || 0) + ' шт годных' + (today.pending ? ', ' + P.money(today.pending) + ' ждёт приёмки' : ''), 'good'),
            P.kpi('За ноябрь', P.money((month.total || 0) + (month.pending || 0)), 'к выплате ' + P.money(month.total || 0) + (month.dispute ? ' · спорно ' + P.money(month.dispute) : ''))
        ]));
        var canW = P.canWrite('Отметка выработки');
        var mine = M.tasks.filter(function (t) { return t.section === W.section && t.state === C.STATE.run && t.worker === W.name; });
        var free = M.tasks.filter(function (t) { return t.section === W.section && t.state !== C.STATE.done && !(t.state === C.STATE.run && t.worker === W.name) && P.avail(M, t) > 0; }).sort(function (a, b) { return a.queue - b.queue; });

        function setTask(t, f) { return P.update(t.id, f); }
        function take(t) {
            setTask(t, { 'Состояние задания': C.STATE.run, 'Рабочий': W.name, 'Начато в': P.nowHHMM() }).then(function () { P.toast('Задание ' + t.no + ' в работе'); P.redraw(); }).catch(function (e) { P.toast(e.message, true); });
        }
        function output(t) {
            var avail = P.avail(M, t);
            var good = P.input('number', '', { min: 0, step: 1, inputmode: 'numeric', 'class': 'mes-big' }), bad = P.input('number', '', { min: 0, step: 1, inputmode: 'numeric', 'class': 'mes-big' });
            var cul = P.select([['', 'не выбрано']].concat(C.CULPRITS.map(function (c) { return [c, c === 'Рабочий' ? 'Моя ошибка' : c]; })), '');
            var culF = P.field('По чьей вине брак', cul, 'Брак не по вашей вине оплачивается как годные (ст. 156 ТК)'), out = P.el('div', {});
            var rate = C.rateFor(M.rates, t.op, t.product, M.today);
            function upd() { culF.style.display = C.num(bad.value) > 0 ? '' : 'none'; var e = C.checkMark({ good: good.value, bad: bad.value, culprit: cul.value, avail: avail }); out.innerHTML = ''; if (good.value || bad.value) out.appendChild(e.length ? P.note(P.esc(e[0]), 'bad') : P.note('Начислится ' + P.money(C.markPay({ good: good.value, bad: bad.value, culprit: cul.value }, rate, M.rules).total) + ' по расценке ' + P.money(rate) + '/шт', 'ok')); return e; }
            [good, bad, cul].forEach(function (i) { i.addEventListener('input', upd); i.addEventListener('change', upd); });
            var body = P.el('div', {}, [P.el('p', { 'class': 'mes-muted', text: t.no + ' · ' + t.op + ' · ' + t.product + ' · доступно ' + avail + ' шт' }), P.el('div', { 'class': 'mes-grid2' }, [P.field('Годных, шт', good), P.field('Брак, шт', bad)]), culF, out]);
            upd();
            P.modal('Выпуск', body, [{ text: 'Отмена' }, { text: 'Записать', cls: 'mes-primary', fn: function (close) {
                var e = upd(); if (e.length) return false;
                var g = C.num(good.value), b = C.num(bad.value), left = avail - g - b, prev = P.prevTask(M, t);
                var fin = left <= 0 && (!prev || prev.state === C.STATE.done);
                P.create('Отметка выработки', { 'Отметка выработки': P.uid('ОВ'), 'Сменное задание': t.no, 'Рабочий': W.name, 'Участок': W.section, 'Дата смены': M.today, 'Время отметки': P.nowHHMM(), 'Годных, шт': g, 'Брак, шт': b, 'Виновник брака': b ? cul.value : '', 'Приёмка мастером': 'Ожидает' })
                    .then(function () { var p = M.prog[t.no] || { good: 0, bad: 0 }, f = { 'Сделано годных': p.good + g, 'Сделано брака': p.bad + b }; if (fin) f['Состояние задания'] = C.STATE.done; return setTask(t, f); })
                    .then(function () { P.toast(fin ? 'Операция закрыта: заказ ушёл на следующую операцию' : 'Выпуск записан'); close(); P.redraw(); }).catch(function (er) { P.toast(er.message, true); });
                return false;
            } }]);
        }
        function downtime(t) {
            var reason = P.select(M.reasons.map(function (r) { return [r.name, r.name + ' — ' + r.kind.toLowerCase()]; }), M.reasons[0] && M.reasons[0].name), mins = P.input('number', '30', { min: 1, step: 5, inputmode: 'numeric', 'class': 'mes-big' }), out = P.el('div', {});
            function upd() { var e = C.checkDown({ reason: reason.value, mins: mins.value, shiftMin: M.rules.shiftMin }); out.innerHTML = ''; out.appendChild(e.length ? P.note(P.esc(e[0]), 'bad') : P.note(M.reasonKind[reason.value] === C.WORKER_FAULT ? 'По вашей вине — не оплачивается' : 'Оплачивается ' + Math.round(M.rules.idleShare * 100) + '% ставки: ' + P.money(C.downPay({ mins: mins.value }, W.tariff, M.reasonKind[reason.value], M.rules)) + ' (ст. 157 ТК)', 'ok')); return e; }
            [reason, mins].forEach(function (i) { i.addEventListener('input', upd); i.addEventListener('change', upd); }); upd();
            P.modal('Простой', P.el('div', {}, [P.field('Причина', reason), P.field('Минут простоя', mins), out]), [{ text: 'Отмена' }, { text: 'Записать простой', cls: 'mes-primary', fn: function (close) {
                if (upd().length) return false;
                P.create('Простой', { 'Простой': P.uid('ПР'), 'Сменное задание': t ? t.no : '', 'Рабочий': W.name, 'Участок': W.section, 'Причина простоя': reason.value, 'Дата смены': M.today, 'Время отметки': P.nowHHMM(), 'Минут простоя': C.num(mins.value) })
                    .then(function () { return t ? setTask(t, { 'Состояние задания': C.STATE.pause }) : null; })
                    .then(function () { P.toast('Простой записан, мастер видит его на пульте'); close(); P.redraw(); }).catch(function (er) { P.toast(er.message, true); });
                return false;
            } }]);
        }
        function card(t, active) {
            var p = M.prog[t.no] || { good: 0, bad: 0 }, a = P.avail(M, t), o = M.orderBy[t.order] || {};
            var kids = [P.el('div', { 'class': 'mes-tcard-h', html: '<b>' + P.esc(t.op) + '</b> · ' + P.esc(t.product) + (o && P.isHot(M, o) ? ' ' + P.badge('горит, срок ' + C.toShort(o.due), 'crit') : '') }),
                P.el('div', { 'class': 'mes-muted', text: t.no + ' · заказ ' + t.order + ' · сделано ' + p.good + (p.bad ? ' (+' + p.bad + ' брак)' : '') + ' из ' + t.plan + ' · доступно ' + a + ' шт · ' + P.money(C.rateFor(M.rates, t.op, t.product, M.today)) + '/шт' })];
            if (canW) kids.push(P.el('div', { 'class': 'mes-tcard-b' }, active ? [P.btn('Выпуск', function () { output(t); }, 'mes-primary mes-xl'), P.btn('Простой', function () { downtime(t); }, 'mes-xl'), P.btn('Пауза', function () { setTask(t, { 'Состояние задания': C.STATE.pause }).then(function () { P.redraw(); }); }, 'mes-xl')]
                : [P.btn('Взять в работу', function () { take(t); }, 'mes-xl')]));
            return P.el('div', { 'class': 'mes-tcard' + (active ? ' mes-tcard-on' : '') }, kids);
        }
        if (mine.length) { host.appendChild(P.el('h2', { text: 'В работе' })); mine.forEach(function (t) { host.appendChild(card(t, true)); }); }
        host.appendChild(P.el('h2', { text: 'Задания участка по очереди' }));
        if (!free.length) host.appendChild(P.note('Доступных заданий нет: ждите вход от предыдущей операции', 'warn'));
        free.slice(0, 6).forEach(function (t) { host.appendChild(card(t, false)); });
        if (canW) host.appendChild(P.el('div', { 'class': 'mes-bar' }, [P.btn('Простой без задания', function () { downtime(null); }, 'mes-xl')]));
        var my = M.marks.filter(function (m) { return m.worker === W.name && m.date === M.today; }).sort(function (a, b) { return a.at < b.at ? 1 : -1; });
        host.appendChild(P.el('h2', { text: 'Мои отметки сегодня' }));
        host.appendChild(P.table([{ t: 'Время', k: 'at' }, { t: 'Операция', html: function (r) { var t = M.taskBy[r.task] || {}; return P.esc(t.op || r.task) + '<br><small>' + P.esc(t.product || '') + '</small>'; } }, { t: 'Годных', num: true, k: 'good' }, { t: 'Брак', num: true, k: 'bad' }, { t: 'Приёмка', html: function (r) { return P.badge(r.accept, { 'Принято': 'ok', 'Ожидает': 'warn', 'Спор': 'crit' }[r.accept] || 'mute'); } }], my, { empty: 'Сегодня отметок ещё нет' }));
    });
})();
