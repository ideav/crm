/* MDM: Соответствия кодов. Матрица «эталон <-> 1С:УТ <-> 1С:ERP <-> Excel <-> прайсы партнёров» и очередь сопоставления позиций прайсов с долей автосопоставления. */
(function () {
    'use strict';
    var P = window.Mdm, C = P.core;
    var tab = 'price', flt = 'todo', q = '';

    function render(host, M) {
        host.innerHTML = '';
        P.head('Соответствия кодов', 'Одна позиция эталона - её коды во всех системах. Позиции прайсов партнёров сопоставляются автоматически выше порога ' + M.params.autoMatch + '%, ниже - предлагаются на подтверждение; решение запоминается.').forEach(function (e) { host.appendChild(e); });
        if (!M.mapsReadable) { host.appendChild(P.el('p', { 'class': 'mdm-empty', text: 'Таблица соответствий вашей роли недоступна.' })); return; }
        var s = C.mapStats(M.maps);
        host.appendChild(P.el('div', { 'class': 'mdm-kpis' }, [P.kpi('Позиций прайсов', String(s.total), M.systems.filter(function (x) { return x.prio >= 5; }).map(function (x) { return x.name; }).join(', ')),
            P.kpi('Сопоставлено автоматически', P.pct(s.autoPct), s.auto + ' позиций; критерий готовности - не менее 85%', s.autoPct >= 85 ? 'good' : 'warn'),
            P.kpi('Ждут подтверждения', String(s.proposed), 'доля совпадения ниже порога', s.proposed ? 'warn' : 'good'), P.kpi('Не найдено', String(s.notFound), 'новые для нас позиции', s.notFound ? 'bad' : 'good')]));
        host.appendChild(P.tabs([['price', 'Прайсы партнёров'], ['matrix', 'Матрица кодов']], tab, function (k) { tab = k; render(host, M); }));
        var search = P.input('text', q, { placeholder: 'наименование или код' });
        search.addEventListener('input', function () { q = search.value; clearTimeout(search._t); search._t = setTimeout(function () { draw(); }, 200); });
        var bar = P.el('div', { 'class': 'mdm-bar' }, [P.field('Поиск', search)]), out = P.el('div', {});
        if (tab === 'price') { var sel = P.select([['todo', 'Требуют решения'], ['all', 'Все'], ['Подтверждено', 'Подтверждено']], flt); sel.addEventListener('change', function () { flt = sel.value; draw(); }); bar.appendChild(P.field('Показать', sel)); }
        bar.appendChild(P.el('div', { 'class': 'mdm-grow' })); bar.appendChild(P.btn('Выгрузить CSV', function () { exportCsv(M); }));
        host.appendChild(bar); host.appendChild(out);
        function draw() { out.innerHTML = ''; out.appendChild(tab === 'price' ? prices(host, M) : matrix(M)); }
        draw();
    }
    function hit(s) { return !q || String(s || '').toLowerCase().indexOf(q.toLowerCase()) >= 0; }
    function prices(host, M) {
        var can = P.canWrite('Соответствие кодов');
        var rows = M.maps.filter(function (m) { return (flt === 'all' || (flt === 'todo' ? m.status !== 'Подтверждено' : m.status === flt)) && (hit(m.extName) || hit(m.ext) || hit(m.nom)); })
            .sort(function (a, b) { return (a.status === 'Предложено' ? 0 : a.status === 'Не найдено' ? 1 : 2) - (b.status === 'Предложено' ? 0 : b.status === 'Не найдено' ? 1 : 2) || b.score - a.score; });
        var gold = M.nom.filter(function (r) { return r.status === 'Эталон'; });
        return P.table([
            { t: 'Система', html: function (m) { return P.esc(m.system) + '<div class="mdm-muted">' + P.esc(m.ext) + '</div>'; } },
            { t: 'Позиция партнёра', k: 'extName' },
            { t: 'Эталон', html: function (m) { return m.nom ? P.esc(m.nom) : '<span class="mdm-muted">-</span>'; } },
            { t: 'Доля', num: true, html: function (m) { return m.nom ? P.scoreBadge(m.score, M.params.autoMatch) : ''; } },
            { t: 'Статус', html: function (m) { return P.statusBadge(m.status) + (m.method ? '<div class="mdm-muted">' + P.esc(m.method) + (m.who && m.who !== 'авто' ? ', ' + P.esc(m.who) : '') + '</div>' : ''); } }
        ], rows, { empty: 'Всё сопоставлено', onrow: can ? function (m) { decide(host, M, m, gold); } : null });
    }
    function decide(host, M, m, gold) {
        var cand = m.nom ? null : C.bestMatch(m.extName, gold, P.NOM), body = P.el('div', {});
        body.appendChild(P.el('p', { html: '<b>' + P.esc(m.extName) + '</b><div class="mdm-muted">' + P.esc(m.system) + ', код ' + P.esc(m.ext) + '</div>' }));
        var opts = gold.map(function (g) { var s = C.nameSim(m.extName, g.name, P.NOM, [g['Бренд'], 'арт', g['Артикул']]).sim; return { g: g, s: Math.round(s * 100) }; }).sort(function (a, b) { return b.s - a.s; }).slice(0, 6);
        var pick = P.select(opts.map(function (o) { return [o.g.id, o.s + '% · ' + o.g.code + ' · ' + o.g.name + (o.g['Бренд'] ? ' (' + o.g['Бренд'] + ')' : '')]; }), m.nomId || (cand && cand.rec.id) || (opts[0] && opts[0].g.id));
        body.appendChild(P.field('Позиция эталона', pick, 'Кандидаты по похожести наименования без бренда и артикула'));
        if (!opts.length || opts[0].s < 50) body.appendChild(P.el('div', { 'class': 'mdm-warnbox mdm-w', text: 'Похожих позиций в эталоне нет - вероятно, новая позиция: её заводят заявкой в НСИ.' }));
        var save = function (status, method) { return function (close) {
            var o = opts.filter(function (x) { return x.g.id === pick.value; })[0];
            var f = { 'Статус соответствия': status, 'Способ сопоставления': method, 'Подтвердил': P.ctx.user };
            if (status === 'Подтверждено' && o) { f['Номенклатура'] = Number(o.g.id); f['Доля совпадения'] = o.s; }
            P.update(m.id, f).then(function () { close(); P.toast(status === 'Подтверждено' ? 'Сопоставлено и запомнено' : 'Отмечено: нет в эталоне'); P.rerender(render); }).catch(function (e) { P.toast(e.message, true); });
            return false; }; };
        P.modal('Сопоставление позиции', body, [{ text: 'Закрыть' }, { text: 'Нет в эталоне', fn: save('Не найдено', 'вручную') }, { text: 'Подтвердить', cls: 'mdm-primary', fn: save('Подтверждено', 'память') }], true);
    }
    function matrix(M) {
        var sys = M.systems.map(function (s) { return s.name; });
        var rows = C.codeMatrix(M.nom.filter(function (r) { return r.status !== 'На проверке'; }), M.maps.filter(function (m) { return m.status === 'Подтверждено'; }), sys).filter(function (r) { return hit(r.rec.name) || hit(r.rec.code); });
        return P.table([{ t: 'Эталон', html: function (r) { return '<b>' + P.esc(r.rec.name) + '</b><div class="mdm-muted">' + P.esc(r.rec.code) + '</div>'; } }].concat(sys.map(function (s) {
            return { t: s, html: function (r) { return (r.cells[s] || []).map(function (c) { return '<div class="mdm-cell"><code>' + P.esc(c.code) + '</code>' + (c.via === 'слита' ? ' <span class="mdm-muted">(слита)</span>' : '') + '</div>'; }).join('') || '<span class="mdm-muted">-</span>'; } };
        })).concat([{ t: 'Систем', num: true, html: function (r) { return r.covered + ' / ' + sys.length; } }]), rows);
    }
    function exportCsv(M) {
        P.download('соответствия.csv', C.toCsv(['Система', 'Внешний код', 'Внешнее наименование', 'Эталон', 'Доля, %', 'Статус', 'Способ'], M.maps.map(function (m) { return [m.system, m.ext, m.extName, m.nom, m.score, m.status, m.method]; })));
    }
    P.mount(render);
})();
