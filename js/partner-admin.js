// Сводный кабинет партнёров (рабочее место админа и директора базы my, templates/my/partners.html).
// Три уровня: все партнёры → клиенты партнёра → карточка клиента. Данные — отчёты adminPartners,
// adminClients, adminEvents (формат JSON_KV, контракт — docs/partner-cabinet.md). Содержимое таблиц и
// дашбордов клиентов не читается: только метрики и события. Отрисовка — только textContent.
// Зависит от js/partner-cabinet.js (PartnerCabinet.trialDay).
(function (root) {
    'use strict';

    var STAGES = ['Открыл материал', 'Зарегистрировался', 'Запустил бота', 'Получил дашборды', 'Оплатил'];

    function get(r, key) {
        if (!r || typeof r !== 'object') return '';
        var want = key.toLowerCase(), found = '';
        Object.keys(r).forEach(function (k) { if (k.toLowerCase() === want && r[k] != null) found = String(r[k]).trim(); });
        return found;
    }
    function num(v) { var n = parseFloat(String(v == null ? '' : v).replace(/\s/g, '').replace(',', '.')); return isNaN(n) ? 0 : n; }
    function rub(n) { return n ? String(n).replace(/\B(?=(\d{3})+$)/g, ' ') + ' ₽' : '—'; }
    function rows(x) { return Array.isArray(x) ? x.filter(function (r) { return r && typeof r === 'object'; }) : []; }

    function readPartners(json) {
        return rows(json).filter(function (r) { return get(r, 'PartnerID') || get(r, 'Name'); }).map(function (r) {
            var passed = get(r, 'ExamPassed') === '1', score = num(get(r, 'ExamScore')), date = get(r, 'ExamDate');
            return {
                id: get(r, 'PartnerID'), name: get(r, 'Name') || get(r, 'PartnerID'), reg: get(r, 'Reg'),
                exam: passed ? 'passed' : (score > 0 || date ? 'failed' : 'none'), score: score, examDate: date,
                opens: num(get(r, 'Opens')), bot: num(get(r, 'BotStarts')), flows: num(get(r, 'Flows')),
                earned: num(get(r, 'Earned')), payable: num(get(r, 'Payable')), last: get(r, 'LastActive'), minutes: num(get(r, 'Minutes'))
            };
        });
    }

    function readClients(json) {
        return rows(json).filter(function (r) { return get(r, 'ClientID') || get(r, 'Client'); }).map(function (r) {
            var st = parseInt(get(r, 'Stage'), 10);
            return {
                id: get(r, 'ClientID'), pid: get(r, 'PartnerID'), name: get(r, 'Client') || get(r, 'ClientID'),
                came: get(r, 'Came'), stage: isNaN(st) ? 1 : Math.min(5, Math.max(1, st)),
                trialStart: get(r, 'TrialStart') || get(r, 'Came'), last: get(r, 'LastActive'),
                direct: num(get(r, 'DirectCount')), paid: get(r, 'Paid') === '1',
                bases: num(get(r, 'Bases')), records: num(get(r, 'Records')), tokens: num(get(r, 'Tokens'))
            };
        });
    }

    function readEvents(json) {
        return rows(json).filter(function (r) { return get(r, 'Text') || get(r, 'Kind'); }).map(function (r) {
            return { time: get(r, 'EventTime'), kind: get(r, 'Kind'), text: get(r, 'Text') };
        });
    }

    function trial(c, now) { return root.PartnerCabinet ? root.PartnerCabinet.trialDay(c.trialStart, now) : null; }
    function byPartner(clients, pid) { return clients.filter(function (c) { return c.pid === pid; }); }
    function partnerOf(partners, id) { return partners.filter(function (p) { return p.id === id; })[0]; }

    function funnel(clients) {
        return STAGES.map(function (label, i) {
            return { label: label, count: clients.filter(function (c) { return c.stage >= i + 1; }).length };
        });
    }

    function totals(partners, clients, now) {
        function sum(k) { return partners.reduce(function (s, p) { return s + p[k]; }, 0); }
        return {
            partners: partners.length,
            passed: partners.filter(function (p) { return p.exam === 'passed'; }).length,
            clients: clients.length,
            paid: clients.filter(function (c) { return c.paid; }).length,
            trial: clients.filter(function (c) { var t = trial(c, now); return !c.paid && t && !t.done; }).length,
            opens: sum('opens'), payable: sum('payable'), earned: sum('earned')
        };
    }

    function signals(partners, clients, now) {
        var out = [];
        partners.forEach(function (p) {
            if (p.exam !== 'passed' && byPartner(clients, p.id).length)
                out.push({ kind: 'wait', pid: p.id, text: p.name + ': есть клиенты, но экзамен не сдан' });
            if (p.payable >= 1000)
                out.push({ kind: 'ok', pid: p.id, text: p.name + ': к выплате ' + rub(p.payable) + ' (порог 1 000 ₽)' });
        });
        clients.forEach(function (c) {
            var p = partnerOf(partners, c.pid), who = c.name + ' (' + (p ? p.name : c.pid) + ')', t = trial(c, now);
            if (c.direct > 3) out.push({ kind: 'bad', pid: c.pid, text: who + ': ' + c.direct + ' прямых обращения, больше 3: повышение по клиенту прекращено' });
            else if (c.direct === 3) out.push({ kind: 'wait', pid: c.pid, text: who + ': 3 прямых обращения из 3, следующее прекратит повышение' });
            if (!c.paid && t && t.day >= 12 && t.day <= 14) out.push({ kind: 'wait', pid: c.pid, text: who + ': триал заканчивается, день ' + t.day + ' из 14' });
        });
        return out;
    }

    function filterPartners(partners, clients, f, now) {
        var q = String((f && f.q) || '').toLowerCase(), mode = (f && f.filter) || 'all';
        var flagged = {};
        if (mode === 'signal') signals(partners, clients, now).forEach(function (s) { flagged[s.pid] = true; });
        return partners.filter(function (p) {
            if (q && p.name.toLowerCase().indexOf(q) < 0) return false;
            if (mode === 'noexam') return p.exam !== 'passed';
            if (mode === 'signal') return !!flagged[p.id];
            return true;
        });
    }

    function h(doc, tag, cls, text) {
        var e = doc.createElement(tag);
        if (cls) e.className = cls;
        if (text != null) e.textContent = text;
        return e;
    }
    function call(fn) { if (typeof fn === 'function') fn.apply(null, Array.prototype.slice.call(arguments, 1)); }
    function badge(doc, txt, kind) { return h(doc, 'span', 'partner-badge partner-' + kind, txt); }
    function tile(doc, grid, label, val, sub) {
        var c = grid.appendChild(h(doc, 'div', 'mc-card partner-tile'));
        c.appendChild(h(doc, 'div', 'mc-muted', label));
        c.appendChild(h(doc, 'div', 'partner-big', String(val)));
        if (sub) c.appendChild(h(doc, 'div', 'mc-muted', sub));
    }
    function table(doc, heads) {
        var wrap = h(doc, 'div', 'mc-table-wrap'), t = wrap.appendChild(h(doc, 'table', 'data-table'));
        var tr = t.appendChild(h(doc, 'thead')).appendChild(h(doc, 'tr'));
        heads.forEach(function (x) { tr.appendChild(h(doc, 'th', '', x)); });
        wrap.body = t.appendChild(h(doc, 'tbody'));
        return wrap;
    }
    function linkCell(doc, tr, text, key, id, fn) {
        var b = tr.appendChild(h(doc, 'td')).appendChild(h(doc, 'button', 'partner-lnk', text));
        b.setAttribute('type', 'button');
        b.dataset[key] = id;
        b.addEventListener('click', fn);
    }
    function examBadge(doc, p) {
        if (p.exam === 'passed') return badge(doc, 'сдан · ' + p.score + '%', 'ok');
        if (p.exam === 'failed') return badge(doc, 'не сдан · ' + p.score + '%', 'bad');
        return badge(doc, 'не сдавал', 'wait');
    }

    function level1(doc, view, state, data, hd, now) {
        var t = totals(data.partners, data.clients, now);
        var g = view.appendChild(h(doc, 'div', 'partner-summary'));
        tile(doc, g, 'Партнёров', t.partners, t.passed + ' сдали экзамен');
        tile(doc, g, 'Клиентов', t.clients, t.trial + ' в триале, оплатили: ' + t.paid);
        tile(doc, g, 'Открытий материалов', t.opens, 'за 30 дней');
        tile(doc, g, 'К выплате', rub(t.payable) === '—' ? '0 ₽' : rub(t.payable), 'начислено ' + (rub(t.earned) === '—' ? '0 ₽' : rub(t.earned)));

        var f = view.appendChild(h(doc, 'div', 'mc-card'));
        f.appendChild(h(doc, 'h2', '', 'Воронка клиентов по всем партнёрам'));
        var total = data.clients.length || 1;
        funnel(data.clients).forEach(function (s) {
            var r = f.appendChild(h(doc, 'div', 'partner-frow'));
            r.appendChild(h(doc, 'span', '', s.label));
            var bar = r.appendChild(h(doc, 'div', 'partner-bar')), i = bar.appendChild(h(doc, 'i'));
            i.style.width = Math.round(s.count / total * 100) + '%';
            r.appendChild(h(doc, 'b', '', String(s.count)));
        });

        var sg = view.appendChild(h(doc, 'div', 'mc-card'));
        sg.appendChild(h(doc, 'h2', '', 'Сигналы'));
        var list = signals(data.partners, data.clients, now);
        if (!list.length) sg.appendChild(h(doc, 'p', 'mc-muted', 'Сигналов нет.'));
        list.forEach(function (x) {
            var r = sg.appendChild(h(doc, 'div', 'partner-sig'));
            r.appendChild(badge(doc, x.kind === 'ok' ? 'выплата' : x.kind === 'bad' ? 'внимание' : 'следить', x.kind));
            r.appendChild(h(doc, 'span', '', x.text));
        });

        var c = view.appendChild(h(doc, 'div', 'mc-card'));
        c.appendChild(h(doc, 'h2', '', 'Партнёры'));
        var fl = c.appendChild(h(doc, 'div', 'partner-filters'));
        var sel = fl.appendChild(h(doc, 'select'));
        [['all', 'Все'], ['noexam', 'Без экзамена'], ['signal', 'С сигналами']].forEach(function (o) {
            var op = sel.appendChild(h(doc, 'option', '', o[1])); op.value = o[0];
        });
        sel.value = state.filter;
        sel.setAttribute('aria-label', 'Фильтр партнёров');
        var q = fl.appendChild(h(doc, 'input'));
        q.setAttribute('type', 'search'); q.setAttribute('placeholder', 'Поиск по имени'); q.setAttribute('aria-label', 'Поиск по имени');
        q.value = state.q;
        sel.addEventListener('change', function () { state.filter = sel.value; call(hd.redraw); });
        q.addEventListener('change', function () { state.q = q.value; call(hd.redraw); });

        var tb = table(doc, ['Партнёр', 'Регистрация', 'Экзамен', 'Материалы', 'Бот / процессы', 'Клиенты', 'Начислено', 'К выплате', 'Последняя активность', 'В кабинете']);
        c.appendChild(tb);
        filterPartners(data.partners, data.clients, state, now).forEach(function (p) {
            var tr = tb.body.appendChild(h(doc, 'tr')), cl = byPartner(data.clients, p.id);
            linkCell(doc, tr, p.name, 'partner', p.id, function () { call(hd.openPartner, p.id); });
            tr.appendChild(h(doc, 'td', '', p.reg));
            tr.appendChild(h(doc, 'td')).appendChild(examBadge(doc, p));
            tr.appendChild(h(doc, 'td', '', p.opens + ' открытий'));
            tr.appendChild(h(doc, 'td', '', p.bot + ' / ' + p.flows));
            tr.appendChild(h(doc, 'td', '', cl.length + ' (' + cl.filter(function (x) { return x.paid; }).length + ' опл.)'));
            tr.appendChild(h(doc, 'td', '', rub(p.earned)));
            tr.appendChild(h(doc, 'td', '', rub(p.payable)));
            tr.appendChild(h(doc, 'td', '', p.last));
            tr.appendChild(h(doc, 'td', '', p.minutes + ' мин'));
        });
    }

    function level2(doc, view, state, data, hd, now) {
        var p = partnerOf(data.partners, state.pid);
        if (!p) { view.appendChild(h(doc, 'p', 'mc-muted', 'Партнёр не найден.')); return; }
        var cl = byPartner(data.clients, p.id);
        var g = view.appendChild(h(doc, 'div', 'partner-summary'));
        tile(doc, g, 'Партнёр', p.name, 'зарегистрирован ' + p.reg);
        tile(doc, g, 'Экзамен', p.exam === 'none' ? '—' : p.score + '%', p.examDate || 'не сдавал');
        tile(doc, g, 'Клиентов', cl.length, 'оплатили: ' + cl.filter(function (x) { return x.paid; }).length);
        tile(doc, g, 'К выплате', rub(p.payable) === '—' ? '0 ₽' : rub(p.payable), 'начислено ' + (rub(p.earned) === '—' ? '0 ₽' : rub(p.earned)));
        var c = view.appendChild(h(doc, 'div', 'mc-card'));
        c.appendChild(h(doc, 'h2', '', 'Клиенты партнёра'));
        if (!cl.length) c.appendChild(h(doc, 'p', 'mc-muted', 'Клиентов пока нет.'));
        var tb = table(doc, ['Клиент', 'Пришёл', 'Этап', 'Поддержка', 'Последняя активность', 'Прямые обращения', 'Оплата']);
        c.appendChild(tb);
        cl.forEach(function (x) {
            var tr = tb.body.appendChild(h(doc, 'tr')), t = trial(x, now);
            linkCell(doc, tr, x.name, 'client', x.id, function () { call(hd.openClient, x.id); });
            tr.appendChild(h(doc, 'td', '', x.came));
            tr.appendChild(h(doc, 'td', '', STAGES[x.stage - 1]));
            var ts = tr.appendChild(h(doc, 'td'));
            if (x.paid) ts.appendChild(h(doc, 'span', 'mc-muted', 'завершена'));
            else if (t) {
                var bar = ts.appendChild(h(doc, 'div', 'partner-bar')), i = bar.appendChild(h(doc, 'i'));
                i.style.width = t.percent + '%';
                ts.appendChild(h(doc, 'span', 'mc-muted', t.done ? 'триал окончен' : 'день ' + t.day + ' из ' + t.total));
            }
            tr.appendChild(h(doc, 'td', '', x.last));
            tr.appendChild(h(doc, 'td')).appendChild(x.direct > 3 ? badge(doc, x.direct + ' · повышение снято', 'bad') : h(doc, 'span', '', x.direct + ' из 3'));
            tr.appendChild(h(doc, 'td')).appendChild(x.paid ? badge(doc, 'оплатил', 'ok') : badge(doc, 'не оплатил', 'wait'));
        });
        var a = view.appendChild(h(doc, 'div', 'mc-card'));
        a.appendChild(h(doc, 'h2', '', 'Активность партнёра'));
        var gg = a.appendChild(h(doc, 'div', 'partner-summary'));
        tile(doc, gg, 'Открытий материалов', p.opens, 'за 30 дней');
        tile(doc, gg, 'Запусков бота', p.bot);
        tile(doc, gg, 'Прошли процесс создания', p.flows);
        tile(doc, gg, 'Время в кабинете', p.minutes + ' мин', 'за 30 дней');
    }

    function level3(doc, view, state, data, hd, now, events) {
        var x = data.clients.filter(function (c) { return c.id === state.cid; })[0];
        if (!x) { view.appendChild(h(doc, 'p', 'mc-muted', 'Клиент не найден.')); return; }
        var p = partnerOf(data.partners, x.pid), t = trial(x, now);
        var g = view.appendChild(h(doc, 'div', 'partner-summary'));
        tile(doc, g, 'Клиент', x.name, 'партнёр ' + (p ? p.name : x.pid));
        tile(doc, g, 'Пришёл', x.came, 'последняя активность ' + x.last);
        tile(doc, g, 'Поддержка', x.paid ? 'завершена' : (t ? (t.done ? 'окончена' : 'день ' + t.day + ' из ' + t.total) : '—'));
        tile(doc, g, 'Прямые обращения', x.direct + ' из 3');
        var c = view.appendChild(h(doc, 'div', 'mc-card'));
        c.appendChild(h(doc, 'h2', '', 'Этап клиента'));
        var st = c.appendChild(h(doc, 'div', 'partner-steps'));
        STAGES.forEach(function (s, i) { st.appendChild(h(doc, 'span', 'partner-step' + (x.stage > i ? ' partner-on' : ''), s)); });
        c.appendChild(h(doc, 'div', 'mc-muted', 'Использование: баз ' + x.bases + ', записей ' + x.records + ', токенов ' + x.tokens + '. Содержимое таблиц и дашбордов клиента не показывается.'));
        var hb = view.appendChild(h(doc, 'div', 'mc-card'));
        hb.appendChild(h(doc, 'h2', '', 'Хронология событий'));
        if (!events || !events.length) hb.appendChild(h(doc, 'p', 'mc-muted', 'У клиента пока нет событий.'));
        (events || []).forEach(function (e) {
            var r = hb.appendChild(h(doc, 'div', 'partner-ev'));
            r.appendChild(h(doc, 'span', 'mc-muted', e.time));
            r.appendChild(badge(doc, e.kind, e.kind === 'Обращение' ? 'bad' : e.kind === 'Оплата' ? 'ok' : 'wait'));
            r.appendChild(h(doc, 'span', '', e.text));
        });
    }

    function crumbs(doc, box, state, data, hd) {
        if (!box) return;
        box.textContent = '';
        function go(t, fn) { var b = box.appendChild(h(doc, 'button', 'partner-lnk', t)); b.setAttribute('type', 'button'); b.addEventListener('click', function () { call(fn); }); }
        go('Все партнёры', hd.home);
        if (state.level >= 2) {
            var p = partnerOf(data.partners, state.pid);
            box.appendChild(h(doc, 'span', 'mc-muted', '›'));
            go(p ? p.name : state.pid, hd.partner);
        }
        if (state.level === 3) {
            var c = data.clients.filter(function (x) { return x.id === state.cid; })[0];
            box.appendChild(h(doc, 'span', 'mc-muted', '›'));
            box.appendChild(h(doc, 'span', 'mc-muted', c ? c.name : state.cid));
        }
    }

    function render(doc, state, data, hd, now, events) {
        hd = hd || {};
        crumbs(doc, doc.getElementById('partners-crumbs'), state, data, hd);
        var view = doc.getElementById('partners-view');
        if (!view) return;
        view.textContent = '';
        [null, level1, level2, level3][state.level](doc, view, state, data, hd, now, events);
    }

    function fetchRows(url) {
        return fetch(url, { credentials: 'include' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .catch(function () { return null; });
    }
    function load(base) {
        return Promise.all([fetchRows(base + '/report/adminPartners?JSON_KV'), fetchRows(base + '/report/adminClients?JSON_KV')])
            .then(function (r) { return { partners: readPartners(r[0]), clients: readClients(r[1]) }; });
    }
    function loadEvents(base, clientId) {
        return fetchRows(base + '/report/adminEvents?JSON_KV&FR_ClientID=' + encodeURIComponent(clientId)).then(readEvents);
    }

    function init(doc, base) {
        if (!doc.getElementById('partners-view')) return Promise.resolve();
        var state = { level: 1, pid: null, cid: null, filter: 'all', q: '' }, data = { partners: [], clients: [] }, events = [];
        var hd = {
            home: function () { state.level = 1; draw(); },
            partner: function () { state.level = 2; draw(); },
            openPartner: function (id) { state.level = 2; state.pid = id; draw(); },
            openClient: function (id) {
                state.level = 3; state.cid = id; events = []; draw();
                loadEvents(base, id).then(function (e) { if (state.cid === id) { events = e; draw(); } });
            },
            redraw: function () { draw(); }
        };
        function draw() { render(doc, state, data, hd, new Date(), events); if (root.scrollTo) root.scrollTo(0, 0); }
        return load(base).then(function (d) { data = d; draw(); });
    }

    root.PartnerAdmin = {
        readPartners: readPartners, readClients: readClients, readEvents: readEvents, funnel: funnel, totals: totals,
        signals: signals, filterPartners: filterPartners, render: render, load: load, loadEvents: loadEvents, init: init
    };

    if (root.document && root.document.getElementById && root.document.getElementById('partners-view'))
        init(root.document, '/' + root.db);
})(typeof window !== 'undefined' ? window : globalThis);
