// Партнёрский раздел ЛК: материалы с персональными ссылками, клиенты на сопровождении,
// статус экзамена, активность. Данные читает MyMode.loadPartnerData (блоки cabdata.html),
// здесь — чистые функции (адрес ссылки, день пробного периода, модель вида) и отрисовка
// только через textContent: данные клиентов в разметку не попадают.
(function (root) {
    'use strict';

    var TRIAL_DAYS = 14;
    var TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

    // Адрес ссылки. Токен нужной формы — обязателен для материалов и бота; ссылка на услугу
    // токена не требует и несёт номер партнёра (?aff=)
    function linkUrl(item, ctx) {
        var kind = item && item.kind, token = item && item.token ? String(item.token) : '';
        if (kind === 'service') return ctx.host + '/excel-to-app.html?aff=' + encodeURIComponent(ctx.userId || '0');
        if (!TOKEN_RE.test(token)) return '';
        if (kind === 'bot') return 'https://t.me/' + ctx.bot + '?start=' + token;
        return ctx.host + '/m/' + token;
    }

    function parseDate(s) {
        var m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(String(s || '').trim());
        if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
        m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '').trim());
        return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
    }

    // День пробного периода из 14 по дате начала; null, если дата не распознана
    function trialDay(start, now) {
        var d = parseDate(start);
        if (!d) return null;
        var n = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        var day = Math.max(1, Math.round((n - d) / 86400000) + 1);
        return { day: day, total: TRIAL_DAYS, percent: Math.min(100, Math.round(day / TRIAL_DAYS * 100)), done: day > TRIAL_DAYS };
    }

    function examView(exam) {
        var e = exam || { passed: false, score: 0, date: '', attemptsLeft: 3, threshold: 80 };
        var label;
        if (e.passed) label = 'Сдан · ' + e.score + '%' + (e.date ? ' · ' + e.date : '');
        else if (e.attemptsLeft > 0) label = 'Не сдан · осталось попыток: ' + e.attemptsLeft;
        else label = 'Не сдан · попытки закончились';
        return { passed: !!e.passed, label: label, threshold: e.threshold || 80, attemptsLeft: e.attemptsLeft };
    }

    var STATUS_TEXT = { paid: 'оплатил', trial: 'в триале', lapsed: 'триал окончен' };

    function clientView(c, now) {
        var t = trialDay(c.start, now);
        if (c.paid) return { name: c.name, came: c.came, did: c.did, status: 'paid', statusText: STATUS_TEXT.paid, dayText: 'поддержка завершена', percent: 100 };
        if (!t) return { name: c.name, came: c.came, did: c.did, status: 'trial', statusText: STATUS_TEXT.trial, dayText: '', percent: 0 };
        if (t.done) return { name: c.name, came: c.came, did: c.did, status: 'lapsed', statusText: STATUS_TEXT.lapsed, dayText: 'триал окончен', percent: 100 };
        return { name: c.name, came: c.came, did: c.did, status: 'trial', statusText: STATUS_TEXT.trial, dayText: 'день ' + t.day + ' из ' + t.total, percent: t.percent };
    }

    function viewModel(data, ctx, now) {
        var d = data || {}, s = d.stats || {};
        var links = (d.links || []).map(function (l) {
            return { material: l.material, title: l.title, kind: l.kind, url: linkUrl(l, ctx) };
        }).filter(function (l) { return l.url; });
        if (!links.some(function (l) { return l.kind === 'service'; }))
            links.push({ material: 'service', title: 'Страница услуги и регистрация', kind: 'service', url: linkUrl({ kind: 'service' }, ctx) });
        return {
            summary: { clients: s.clients || 0, onSupport: s.onSupport || 0, paidClients: s.paidClients || 0, earned: s.earned || 0, opens: s.opens || 0, people: s.people || 0 },
            exam: examView(d.exam),
            links: links,
            clients: (d.clients || []).map(function (c) { return clientView(c, now); }),
            activity: [
                { label: 'открыли видео', value: s.videoPeople || 0 },
                { label: 'открыли презентацию', value: s.presentationPeople || 0 },
                { label: 'открыли КП', value: s.kpPeople || 0 },
                { label: 'запустили бота', value: s.botStarts || 0 },
                { label: 'прошли процесс создания', value: s.flows || 0 }
            ]
        };
    }

    function h(doc, tag, cls, text) {
        var e = doc.createElement(tag);
        if (cls) e.className = cls;
        if (text != null) e.textContent = text;
        return e;
    }
    function clear(el) { if (el) el.textContent = ''; return el; }

    function render(doc, vm) {
        var box = clear(doc.getElementById('partner-summary'));
        if (box) [['Клиентов привёл', vm.summary.clients, vm.summary.onSupport + ' на поддержке, ' + vm.summary.paidClients + ' оплатили'],
                  ['Просмотры материалов', vm.summary.opens, vm.summary.people + ' человек']].forEach(function (t) {
            var c = box.appendChild(h(doc, 'div', 'partner-tile mc-card'));
            c.appendChild(h(doc, 'div', 'mc-muted', t[0]));
            c.appendChild(h(doc, 'div', 'partner-big', String(t[1])));
            c.appendChild(h(doc, 'div', 'mc-muted', t[2]));
        });

        box = clear(doc.getElementById('partner-exam'));
        if (box) {
            box.appendChild(h(doc, 'span', 'partner-badge ' + (vm.exam.passed ? 'partner-ok' : 'partner-wait'), vm.exam.label));
            box.appendChild(h(doc, 'p', 'mc-muted', 'Порог сдачи ' + vm.exam.threshold + '%. После сдачи экзамена вы получаете допуск к сопровождению клиентов.'));
        }

        box = clear(doc.getElementById('partner-links'));
        if (box) vm.links.forEach(function (l) {
            var row = box.appendChild(h(doc, 'div', 'partner-row'));
            var left = row.appendChild(h(doc, 'div'));
            left.appendChild(h(doc, 'b', '', l.title));
            var a = left.appendChild(h(doc, 'a', 'partner-link', l.url));
            a.setAttribute('href', l.url);
            a.setAttribute('target', '_blank');
            a.setAttribute('rel', 'noopener');
            var btn = row.appendChild(h(doc, 'button', 'copy-btn partner-copy', 'Копировать ссылку'));
            btn.setAttribute('type', 'button');
            btn.dataset.copyUrl = l.url;
            btn.addEventListener('click', function () {
                var done = function () { btn.textContent = 'Скопировано'; };
                if (root.navigator && root.navigator.clipboard) root.navigator.clipboard.writeText(l.url).then(done, function () {});
            });
        });

        box = clear(doc.getElementById('partner-clients'));
        if (box) {
            if (!vm.clients.length) box.appendChild(h(doc, 'p', 'mc-muted', 'Пока нет клиентов. Отправьте клиентам ссылки из раздела «Материалы».'));
            vm.clients.forEach(function (c) {
                var it = box.appendChild(h(doc, 'div', 'partner-client'));
                var top = it.appendChild(h(doc, 'div', 'partner-client-top'));
                top.appendChild(h(doc, 'span', '', c.name));
                top.appendChild(h(doc, 'span', 'partner-badge partner-' + c.status, c.statusText));
                it.appendChild(h(doc, 'div', 'mc-muted', (c.came ? 'пришёл ' + c.came : '') + (c.did ? ' · ' + c.did : '')));
                var bar = it.appendChild(h(doc, 'div', 'partner-bar'));
                var fill = bar.appendChild(h(doc, 'i'));
                fill.style.width = c.percent + '%';
                if (c.dayText) it.appendChild(h(doc, 'div', 'mc-muted', c.dayText));
            });
        }

        box = clear(doc.getElementById('partner-activity'));
        if (box) vm.activity.forEach(function (a) {
            var it = box.appendChild(h(doc, 'div', 'partner-stat'));
            it.appendChild(h(doc, 'b', '', String(a.value)));
            it.appendChild(h(doc, 'span', 'mc-muted', a.label));
        });
    }

    function init(doc, base, ctx) {
        if (!root.MyMode || !doc.getElementById('partner-links')) return Promise.resolve();
        return root.MyMode.loadPartnerData(base).then(function (data) {
            render(doc, viewModel(data, ctx, new Date()));
        });
    }

    root.PartnerCabinet = { linkUrl: linkUrl, trialDay: trialDay, examView: examView, viewModel: viewModel, render: render, init: init };
})(typeof window !== 'undefined' ? window : globalThis);
