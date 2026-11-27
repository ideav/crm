/* BPM: карточка заявки - данные, где она и у кого, решение по неопределённости, цепочка событий журнала. */
(function () {
    'use strict';
    var P = window.Bpm, C = P.core;
    var CODE = { 'Запуск': 'info', 'Переход': 'mute', 'Ручной перевод': 'warn', 'Неопределённость': 'crit', 'Решение по неопределённости': 'ok', 'Правка предложена': 'violet', 'Одобрение правки': 'violet', 'Правка внесена': 'ok', 'Вызов интеграции': 'mute' };
    P.timeline = function (M, req) {
        var list = C.chain(M.events, req.n);
        return P.el('ol', { 'class': 'bpm-timeline' }, list.map(function (e) {
            return P.el('li', { 'class': e.off ? 'bpm-off' : '' }, [
                P.el('div', { 'class': 'bpm-tl-h', html: '<b>' + P.d(e.date) + ' ' + P.esc(e.time) + '</b> ' + P.badge(e.code, CODE[e.code]) + (e.off ? ' ' + P.badge('вне спецификации', 'warn') : '') + ' <span class="bpm-muted">' + P.esc(P.who(e.who)) + '</span>' }),
                P.el('div', { 'class': 'bpm-tl-b', html: (e.to ? P.esc(e.from) + ' → <b>' + P.esc(e.to) + '</b>' : P.esc(e.from)) + (e.why ? '<br><span class="bpm-muted">' + P.esc(e.why) + '</span>' : '') })
            ]);
        }));
    };
    P.holderText = function (M, req) {
        if (!req.exec) return '—';
        var h = C.holder(req.exec, M.empByLogin, M.subs, M.today);
        if (h.via) return P.who(h.who) + ' (за ' + P.who(h.via) + ')';
        return P.who(h.who) + (h.hanging ? ' — отсутствует' : '');
    };
    function info(M, req) {
        var kv = function (k, v) { return P.el('div', { 'class': 'bpm-kv' }, [P.el('span', { text: k }), P.el('span', { html: v })]); };
        return P.el('div', { 'class': 'bpm-grid2' }, [
            P.el('div', {}, [kv('Процесс', P.esc(req.proc)), kv('Предмет', P.esc(req.subj)), kv('Контрагент', P.esc(req.cp) + (req.nonres ? ' ' + P.badge('нерезидент', 'warn') : '')), kv('Сумма', P.esc(P.money(req.sum, req.cur)) + (req.cur !== 'RUB' ? ' ' + P.badge(req.cur, 'info') : '')), kv('Вид договора', P.esc(req.kind))]),
            P.el('div', {}, [kv('Статус', P.statusBadge(req.status)), kv('Где сейчас', P.esc(req.at)), kv('У кого', P.esc(P.holderText(M, req))), kv('На шаге с', P.esc(P.d(req.entered)) + ' (' + C.workDays(req.entered, M.today, M.hol) + ' раб. дн.)'), kv('Инициатор', P.esc(P.who(req.init))), kv('Срок по регламенту', P.esc(P.d(req.due)) + (!req.done && req.due < M.today ? ' ' + P.badge('просрочена', 'crit') : ''))])
        ]);
    }
    /* Панель решения по неопределённости: варианты по прошлым похожим случаям. */
    function resolvePanel(M, req, unc, close, onDone) {
        var vs = C.variants(M.cases, unc.step, unc.feat), total = vs.reduce(function (s, v) { return s + v.count; }, 0);
        var chosen = vs[0] ? vs[0].to : '', box = P.el('div', { 'class': 'bpm-resolve' });
        var canDecide = P.canWrite('Неопределённость') && P.canWrite('Предложение правки') && (M.isOwner || unc.resp === P.ctx.user);
        box.appendChild(P.el('div', { 'class': 'bpm-warnbox bpm-e', html: '<b>Заявка встала: ' + P.esc(unc.n) + '</b> с ' + P.d(unc.found) + ' (' + C.workDays(unc.found, M.today, M.hol) + ' раб. дн.). ' + P.esc(unc.desc) + '<br>Система не создала инцидент и не вызвала разработчика: решает ответственный — ' + P.esc(P.who(unc.resp)) + '.' }));
        box.appendChild(P.el('div', { 'class': 'bpm-chips', html: 'Признаки случая: ' + Object.entries(C.parseFeatures(unc.feat)).map(function (kv) { return '<span class="bpm-chip">' + P.esc(kv[0] + ' = ' + kv[1]) + '</span>'; }).join('') }));
        box.appendChild(P.el('h3', { text: total ? 'По прошлым похожим случаям (' + total + ') шли сюда' : 'Похожих случаев нет — выберите шаг' }));
        var opts = P.el('div', { 'class': 'bpm-variants' });
        function draw() {
            opts.innerHTML = '';
            vs.forEach(function (v) {
                opts.appendChild(P.el('button', { type: 'button', 'class': 'bpm-variant' + (chosen === v.to ? ' bpm-variant-on' : ''), 'aria-pressed': chosen === v.to ? 'true' : 'false', onclick: function () { chosen = v.to; other.value = ''; draw(); } }, [
                    P.el('b', { text: v.to }),
                    P.el('div', { 'class': 'bpm-bar-track' }, [P.el('div', { 'class': 'bpm-bar-fill', style: 'width:' + Math.round(v.share * 100) + '%' })]),
                    P.el('small', { text: v.count + ' из ' + total + ' (' + Math.round(v.share * 100) + '%), простой в среднем ' + P.fmt(v.delay, 1) + ' раб. дн., дошли до конца ' + v.finished + ' — ' + v.examples.join(', ') })
                ]));
            });
        }
        var steps = M.stepList.filter(function (s) { return s.proc === req.proc && s.name !== unc.step && s.kind !== 'Конечное'; }).map(function (s) { return [s.name, s.name]; });
        var other = P.select([['', 'другой шаг…']].concat(steps), '');
        other.addEventListener('change', function () { if (other.value) { chosen = other.value; draw(); } });
        var com = P.input('textarea', '', { placeholder: 'Комментарий: почему так (обязателен, если шаг не из вариантов)' });
        var prop = P.el('input', { type: 'checkbox', checked: 'checked' });
        draw();
        box.appendChild(opts);
        box.appendChild(P.el('div', { 'class': 'bpm-bar' }, [P.field('Или другой шаг', other), P.el('label', { 'class': 'bpm-check' }, [prop, ' Предложить правку спецификации сторонам: следующая такая заявка пойдёт сама'])]));
        box.appendChild(P.field('Комментарий', com));
        var go = P.btn('Отправить заявку дальше', function () {
            var fromVariants = vs.some(function (v) { return v.to === chosen; });
            if (!chosen) return P.toast('Выберите шаг', true);
            if (!fromVariants && com.value.trim().length < 5) return P.toast('Шаг не из вариантов: нужен комментарий', true);
            go.disabled = true;
            P.resolve(unc, chosen, com.value.trim(), prop.checked).then(function (r) {
                close(); P.toast('Заявка ' + req.n + ' ушла в «' + chosen + '»' + (r.prop ? '; правка ' + r.prop + ' отправлена сторонам' : ''));
                if (onDone) onDone(r);
            }).catch(function (e) { go.disabled = false; P.toast(e.message, true); });
        }, 'bpm-primary');
        if (!canDecide) { go.disabled = true; go.title = 'Решает ответственный или владелец процесса'; }
        box.appendChild(P.el('div', { 'class': 'bpm-bar' }, [go, canDecide ? null : P.el('span', { 'class': 'bpm-muted', text: 'Решение принимает ' + P.who(unc.resp) + '.' })]));
        return box;
    }
    P.openReq = function (req, onDone) {
        var M = P.cur, unc = M.uncs.filter(function (u) { return u.req === req.n && u.state === 'Открыта'; })[0];
        var body = P.el('div', {}, [info(M, req)]);
        var dlg = P.modal(req.n + ' · ' + req.subj, body, [{ text: 'Закрыть' }], true);
        if (unc) body.appendChild(resolvePanel(M, req, unc, dlg.close, onDone));
        var calls = M.calls.filter(function (c) { return c.req === req.n; });
        if (calls.length) body.appendChild(P.el('p', { 'class': 'bpm-muted', html: 'Вызовов интеграций: ' + calls.length + ' — <a href="' + P.nav('integrations', 'r=' + encodeURIComponent(req.n)) + '">журнал вызовов</a>' }));
        body.appendChild(P.el('h3', { text: 'Журнал заявки: причина → решение → правка' }));
        body.appendChild(P.timeline(M, req));
        return dlg;
    };
})();
