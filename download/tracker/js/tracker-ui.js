/* Трекер: общие компоненты (DOM, окна, карточка «почему она здесь», выбор «куда дальше»). */
(function () {
    'use strict';
    var P = window.Trk, C = P.core, host = document.getElementById('trk-app');
    P.el = function (tag, attrs, kids) {
        var e = document.createElement(tag);
        Object.keys(attrs || {}).forEach(function (k) {
            if (k === 'text') e.textContent = attrs[k];
            else if (k === 'html') e.innerHTML = attrs[k];
            else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), attrs[k]);
            else if (attrs[k] !== false && attrs[k] !== undefined) e.setAttribute(k, attrs[k]);
        });
        [].concat(kids || []).forEach(function (c) { if (c !== null && c !== undefined && c !== false) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
        return e;
    };
    P.btn = function (text, fn, cls) { return P.el('button', { type: 'button', 'class': 'trk-btn ' + (cls || ''), onclick: fn, text: text }); };
    P.toast = function (msg, bad) {
        var t = P.el('div', { 'class': 'trk-toast' + (bad ? ' trk-toast-bad' : ''), text: msg, role: 'status' });
        document.body.appendChild(t); setTimeout(function () { t.remove(); }, bad ? 6000 : 3000);
    };
    P.modal = function (title, body, buttons, wide) {
        var back = P.el('div', { 'class': 'trk-modal-back' });
        function close() { back.remove(); }
        var foot = P.el('div', { 'class': 'trk-modal-foot' }, (buttons || [{ text: 'Закрыть' }]).map(function (b) {
            return P.btn(b.text, function () { var r = b.fn ? b.fn(close) : null; if (r !== false && !b.keep) close(); }, b.cls);
        }));
        var box = P.el('div', { 'class': 'trk-modal' + (wide ? ' trk-modal-wide' : ''), role: 'dialog', 'aria-label': title }, [P.el('h3', { text: title }), body, foot]);
        back.addEventListener('mousedown', function (e) { if (e.target === back) close(); });
        back.appendChild(box); document.body.appendChild(back);
        return { close: close, box: box };
    };
    P.field = function (label, input, hint) { return P.el('label', { 'class': 'trk-field' }, [P.el('span', { text: label }), input, hint ? P.el('small', { text: hint }) : null]); };
    P.select = function (opts, value) {
        var s = P.el('select', {}, opts.map(function (o) { var v = Array.isArray(o) ? o[0] : o, t = Array.isArray(o) ? o[1] : o; return P.el('option', { value: v, text: t }); }));
        s.value = value === undefined ? '' : value; return s;
    };
    P.input = function (type, value, attrs) { var i = P.el(type === 'textarea' ? 'textarea' : 'input', Object.assign(type === 'textarea' ? { rows: 3 } : { type: type }, attrs || {})); i.value = value === undefined ? '' : value; return i; };
    P.badge = function (text, kind) { return '<span class="trk-badge trk-' + (kind || 'info') + '">' + P.esc(text) + '</span>'; };
    P.table = function (cols, rows, opts) {
        opts = opts || {};
        var thead = P.el('thead', {}, [P.el('tr', {}, cols.map(function (c) { return P.el('th', { text: c.t, 'class': c.num ? 'trk-num' : '' }); }))]);
        var tbody = P.el('tbody', {}, rows.map(function (r) {
            return P.el('tr', { 'class': (opts.rowCls ? opts.rowCls(r) : '') + (opts.onrow ? ' trk-click' : ''), onclick: opts.onrow ? function () { opts.onrow(r); } : undefined },
                cols.map(function (c) { var td = P.el('td', { 'class': (c.num ? 'trk-num ' : '') + (c.cls ? c.cls(r) : '') }); if (c.html) td.innerHTML = c.html(r); else td.textContent = r[c.k] === undefined ? '' : r[c.k]; return td; }));
        }));
        if (!rows.length) tbody.appendChild(P.el('tr', {}, [P.el('td', { colspan: cols.length, 'class': 'trk-empty', text: opts.empty || 'Нет данных' })]));
        return P.el('div', { 'class': 'trk-tablewrap' }, [P.el('table', { 'class': 'trk-table' }, [thead, tbody])]);
    };
    P.kpi = function (label, value, sub, kind) {
        return P.el('div', { 'class': 'trk-kpi' + (kind ? ' trk-kpi-' + kind : '') }, [P.el('div', { 'class': 'trk-kpi-v', html: value }), P.el('div', { 'class': 'trk-kpi-l', text: label }), sub ? P.el('div', { 'class': 'trk-kpi-s', text: sub }) : null]);
    };
    P.head = function (title, sub) { return [P.el('h1', { text: title }), P.el('p', { 'class': 'trk-sub', text: sub })]; };
    P.fail = function (e) { host.innerHTML = ''; host.appendChild(P.el('div', { 'class': 'trk-error', text: 'Ошибка: ' + (e && e.message || e) })); };
    var render = null;
    P.mount = function (fn) {
        if (!host) return;
        render = function () { return P.meta().then(function () { return P.model(); }).then(function (M) { host.innerHTML = ''; return fn(host, M); }).catch(P.fail); };
        host.textContent = 'Загрузка...'; render();
    };
    P.refresh = function () { P.reload(); host.textContent = 'Загрузка...'; return render(); };
    P.run = function (promise, ok) { return promise.then(function () { if (ok) P.toast(ok); return P.refresh(); }).catch(function (e) { P.toast(e.message || String(e), true); }); };

    var KIND = { 'Шаг': 'ok', 'Исключение': 'warn', 'Неопределённость': 'bad', 'Назначение': 'info', 'Компенсация': 'muted' };
    P.kindBadge = function (k) { return P.badge(k, KIND[k] || 'info'); };
    /* Цепочка «почему она здесь»: события заявки, автор, причина, основание, версия правил. */
    P.chainList = function (M, req) {
        var ev = C.chain(M.journal, req.code);
        return P.el('ol', { 'class': 'trk-chain' }, ev.map(function (e) {
            return P.el('li', { 'class': 'trk-chain-' + (KIND[e.kind] || 'info') }, [
                P.el('div', { 'class': 'trk-chain-h', html: P.kindBadge(e.kind) + ' <b>' + P.esc(e.step) + '</b> <span class="trk-muted">' + P.esc(C.toDmy(e.date) + ' ' + e.time + ' · ' + e.author + (/~ai$/.test(e.login) ? ' (ИИ)' : '')) + '</span>' }),
                e.why ? P.el('div', { text: e.why }) : null,
                P.el('div', { 'class': 'trk-muted trk-small', text: e.code + ' · ' + (e.basis || '') + (e.ver ? ' · правила v' + e.ver : '') })]);
        }));
    };
    P.reqHead = function (req) {
        return P.el('div', { 'class': 'trk-reqhead', html: '<b>' + P.esc(req.code) + '</b> ' + P.esc(req.title) + '<br><span class="trk-muted">' + P.esc(req.kind + ' · ' + C.money(req.sum) + ' · ' + req.dept + ' · инициатор ' + req.initiator) + '</span>' });
    };
    /* Окно «куда дальше?»: варианты по похожим заявкам, регламенту и спеке; выбор сразу двигает заявку исключением с причиной. */
    P.whereNext = function (M, req) {
        var vs = C.variants(M.spec, req, M.journal, M.regs), picked = vs[0] ? vs[0].step : '';
        var why = P.input('textarea', '', { placeholder: 'Почему так (уйдёт в журнал и в предложение правила)' });
        var list = P.el('div', { 'class': 'trk-variants' }, vs.map(function (v, i) {
            var r = P.el('input', { type: 'radio', name: 'trk-v', value: v.step });
            if (i === 0) r.checked = true;
            r.addEventListener('change', function () { picked = v.step; });
            return P.el('label', { 'class': 'trk-variant' }, [r, P.el('div', {}, [P.el('b', { text: v.step }), P.el('div', { 'class': 'trk-muted trk-small', text: v.why.join('; ') })])]);
        }));
        var body = P.el('div', {}, [P.reqHead(req), P.el('p', { 'class': 'trk-alert', text: 'У шага «' + req.step + '» нет продолжения в спецификации. Процесс не сломан: выберите, куда дальше, — заявка пойдёт сразу, решение запишется в журнал как исключение.' }),
            vs.length ? list : P.el('p', { text: 'Вариантов не нашлось — опишите случай как есть.' }), P.field('Причина', why)]);
        P.modal('Куда дальше?', body, [{ text: 'Отмена' }, { text: 'Передать', cls: 'trk-primary', fn: function () {
            if (!picked) return false;
            P.run(P.move(req, picked, why.value.trim() || 'Выбран вариант «' + picked + '»: ' + ((vs.filter(function (v) { return v.step === picked; })[0] || {}).why || []).join('; ')), 'Заявка передана: ' + picked + '. Исключение записано в журнал');
        } }], true);
    };
    P.reqCard = function (M, req) {
        var next = C.nextSteps(M.spec, req), unc = C.isUncertain(M.spec, req), mine = req.login === P.ctx.user || P.isBA();
        var body = P.el('div', {}, [P.reqHead(req), unc ? P.el('p', { 'class': 'trk-alert', text: 'Неопределённость: у шага «' + req.step + '» нет продолжения.' }) : null,
            P.el('h4', { text: 'Почему она здесь' }), P.chainList(M, req)]);
        var b = [{ text: 'Закрыть' }];
        if (mine && unc) b.push({ text: 'Куда дальше?', cls: 'trk-primary', fn: function () { P.whereNext(M, req); } });
        if (mine) next.forEach(function (t) { b.push({ text: '→ ' + t.to, cls: 'trk-primary', fn: function () { P.run(P.move(req, t.to), 'Передано по правилу: ' + t.to); } }); });
        P.modal(req.code + ' · ' + req.step, body, b, true);
    };
    /* Новый шаг процесса по ходу: вводит бизнес-администратор, без релиза. */
    P.addStep = function (M) {
        var name = P.input('text', '', { placeholder: 'Например, «Юридическая экспертиза»' });
        var after = P.select(M.spec.steps.filter(function (s) { return !C.isFinal(s); }).map(function (s) { return [String(s.order), 'после «' + s.name + '»']; }));
        var dept = P.select(M.depts.map(function (d) { return d.name; })), norm = P.input('number', '24', { min: 0 });
        P.modal('Новый шаг процесса', P.el('div', {}, [P.field('Название шага', name), P.field('Место в процессе', after), P.field('Кто выполняет', dept), P.field('Норматив, ч', norm),
            P.el('p', { 'class': 'trk-muted trk-small', text: 'Шаг появится сразу. Переходы в него и из него встанут в спецификацию после одобрения сторон; до тех пор заявка в нём — неопределённость, а не ошибка.' })]),
        [{ text: 'Отмена' }, { text: 'Добавить шаг', cls: 'trk-primary', fn: function () {
            var n = name.value.trim();
            if (!n) { P.toast('Назовите шаг', true); return false; }
            if (M.spec.by[n]) { P.toast('Такой шаг уже есть', true); return false; }
            P.run(P.create('Шаг процесса', { 'Шаг процесса': n, 'Процесс': M.process['Процесс'], 'Вид шага': 'Шаг', 'Порядок шага': C.num(after.value) + 5, 'Подразделение': dept.value,
                'Норматив, ч': C.num(norm.value), 'Шаг введён': P.TODAY, 'Кто ввёл шаг': M.me.name })
                .then(function () { return P.bumpSpec(M); }), 'Шаг «' + n + '» добавлен, спецификация v' + ((C.num(M.process['Версия спеки']) || 1) + 1));
        } }]);
    };
})();
