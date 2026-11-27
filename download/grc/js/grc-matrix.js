/* GRC: матрица «риск - контроль - владелец», пробелы и загрузка из Excel. */
(function () {
    'use strict';
    var P = window.Grc, C = P.core;
    var f = { proc: '', q: '', gaps: false };
    var SAMPLE = ['Риск\tПроцесс\tВероятность\tВлияние\tКонтроль\tВладелец контроля\tПериодичность\tКлючевой\tЧто приложить',
        'Ошибка в курсовых разницах\tУчёт и отчётность\tсредний\t3\tПроверка переоценки валютных счетов\tСорокина А.Ю.\tЕжемесячно\tда\tРасчёт переоценки',
        '\t\t\t\tСверка курсов с ЦБ на дату операции\tСорокина А.Ю.\tЕжемесячно\tнет\t',
        'Задвоение платежа поставщику\tПлатежи и казначейство\tвысокий\t4\tКонтроль дублей в реестре платежей\tФинансовый отдел\tЕженедельно\tда\tОтчёт о дублях',
        'Задвоение платежа поставщику\tПлатежи и казначейство\tвысокий\t4\tСверка с актами поставщиков\tГордеева М.П.\t\tнет\t',
        'Нарушение сроков инвентаризации\tСкладской учёт\t2\t3\t\t\t\t\t'].join('\n');

    function rowsOf(M, gaps) {
        var gBy = {}; gaps.forEach(function (g) { (gBy[g.ref] = gBy[g.ref] || []).push(g); });
        var out = [];
        M.risks.forEach(function (r) {
            var cs = M.ctrls.filter(function (c) { return c.risk === r.code; });
            if (!cs.length) out.push({ r: r, c: null, gaps: gBy[r.code] || [] });
            cs.forEach(function (c, k) { out.push({ r: r, c: c, first: k === 0, gaps: (k === 0 ? gBy[r.code] || [] : []).concat(gBy[c.code] || []) }); });
        });
        return out.filter(function (x) {
            if (f.proc && x.r.process !== f.proc) return false;
            if (f.gaps && !x.gaps.length) return false;
            if (f.q) { var s = (x.r.code + ' ' + x.r.name + ' ' + (x.c ? x.c.code + ' ' + x.c.name + ' ' + x.c.owner : '')).toLowerCase(); if (s.indexOf(f.q.toLowerCase()) < 0) return false; }
            return true;
        });
    }
    function render(host, M, reload) {
        var gaps = C.matrixGaps(M.risks, M.ctrls, M.emps, M.zones);
        host.innerHTML = '';
        P.head('Матрица «риск - контроль - владелец»', 'Загружена из Excel службы внутреннего контроля: риски на шкалах заказчика, контроли, владельцы-сотрудники и периодичность. Пробелы матрицы видны сразу, до запуска кампании.').forEach(function (n) { host.appendChild(n); });
        host.appendChild(P.el('div', { 'class': 'grc-kpis' }, [
            P.kpi('Рисков', String(M.risks.length), M.cats.length + ' категорий, ' + M.procs.length + ' процессов'),
            P.kpi('Контролей', String(M.ctrls.length), M.ctrls.filter(function (c) { return c.key; }).length + ' ключевых'),
            P.kpi('Пробелов', String(gaps.length), gaps.filter(function (g) { return g.high; }).length + ' по высоким рискам', gaps.length ? 'bad' : 'good')]));
        var proc = P.select([['', 'Все процессы']].concat(M.procs.map(function (p) { return p.name; })), f.proc);
        proc.onchange = function () { f.proc = proc.value; render(host, M, reload); };
        var q = P.input('text', f.q, { placeholder: 'Поиск: риск, контроль, владелец' });
        q.onchange = function () { f.q = q.value; render(host, M, reload); };
        var cb = P.input('checkbox', '', {}); cb.checked = f.gaps; cb.onchange = function () { f.gaps = cb.checked; render(host, M, reload); };
        host.appendChild(P.el('div', { 'class': 'grc-bar' }, [P.field('Процесс', proc), P.field('Поиск', q), P.el('label', { 'class': 'grc-check' }, [cb, ' только с пробелами']), P.el('span', { 'class': 'grc-grow' }),
            P.canWrite('Контроль') ? P.btn('Загрузить из Excel', function () { importDlg(M, reload); }, 'grc-primary') : null]));
        if (gaps.length) {
            var gl = P.el('div', { 'class': 'grc-gaps' }, [P.el('b', { text: 'Пробелы матрицы: ' })]);
            gaps.forEach(function (g) { gl.appendChild(P.el('span', { 'class': 'grc-gap' + (g.high ? ' grc-gap-high' : ''), text: g.ref + ': ' + g.text })); });
            host.appendChild(gl);
        }
        host.appendChild(P.table([
            { t: 'Риск', html: function (x) { return x.first === false ? '' : '<b>' + P.esc(x.r.code) + '</b> ' + P.esc(x.r.name) + '<br><small>' + P.esc(x.r.process) + '</small>'; } },
            { t: 'Зона', html: function (x) { return x.first === false ? '' : P.zoneBadge(P.zone(M, x.r.p * x.r.i)) + ' <small>' + x.r.p + 'x' + x.r.i + '</small>'; } },
            { t: 'Контроль', html: function (x) { return x.c ? '<b>' + P.esc(x.c.code) + '</b> ' + P.esc(x.c.name) + (x.c.key ? ' ' + P.badge('ключевой', 'info') : '') : '<span class="grc-et">нет контроля</span>'; } },
            { t: 'Владелец', html: function (x) { return x.c ? P.esc(x.c.owner || '-') : ''; } },
            { t: 'Периодичность', html: function (x) { return x.c ? P.esc(x.c.period || '-') : ''; } },
            { t: 'Что приложить', html: function (x) { return x.c ? P.esc(x.c.evidence || '') : ''; } },
            { t: 'Пробел', html: function (x) { return x.gaps.map(function (g) { return P.badge(g.text, g.high ? 'crit' : 'warn'); }).join(' '); } }
        ], rowsOf(M, gaps), { onrow: function (x) { if (x.c) P.ctrlCard(M, x.c.code); } }));
    }
    function importDlg(M, reload) {
        var ta = P.el('textarea', { rows: 8, placeholder: 'Скопируйте строки из Excel вместе с заголовком и вставьте сюда (Ctrl+V). Подойдёт и CSV.' });
        var file = P.input('file', '', { accept: '.csv,.txt,.tsv' });
        var out = P.el('div', { 'class': 'grc-preview' }), plan = null;
        file.onchange = function () { var fl = file.files[0]; if (!fl) return; var rd = new FileReader(); rd.onload = function () { ta.value = rd.result; check(); }; rd.readAsText(fl, 'utf-8'); };
        function check() {
            plan = C.importPlan(C.parseTable(ta.value), { probs: M.probs, impacts: M.impacts, emps: M.emps.filter(function (e) { return e.login; }), periods: M.periods, risks: M.risks, ctrls: M.ctrls });
            out.innerHTML = '';
            var names = { risk: 'Риск', process: 'Процесс', prob: 'Вероятность', impact: 'Влияние', control: 'Контроль', owner: 'Владелец', period: 'Периодичность', key: 'Ключевой', evidence: 'Что приложить', category: 'Категория', riskCode: 'Код риска', ctrlCode: 'Код контроля' };
            out.appendChild(P.el('p', { html: 'Узнали колонки: ' + Object.keys(plan.map).map(function (k) { return P.badge(names[k] || k, 'info'); }).join(' ') }));
            out.appendChild(P.el('p', { html: 'Будет загружено: <b>' + plan.risks.filter(function (r) { return !r.exists; }).length + '</b> новых рисков и <b>' + plan.ctrls.length + '</b> контролей.' }));
            if (plan.issues.length) out.appendChild(P.table([{ t: 'Строка', k: 'row', num: true }, { t: 'Что не так', k: 'text' }], plan.issues));
            else out.appendChild(P.el('p', { 'class': 'grc-gt', text: 'Проблем не найдено.' }));
        }
        ta.oninput = check;
        var body = P.el('div', {}, [P.el('p', { 'class': 'grc-sub', text: 'Колонки узнаются по заголовку: риск, процесс, вероятность, влияние, контроль, владелец, периодичность, ключевой, что приложить. Шкалы словами переводятся в баллы, объединённые ячейки и повторы риска склеиваются.' }),
            P.el('div', { 'class': 'grc-bar' }, [P.field('Файл CSV', file), P.btn('Вставить пример', function () { ta.value = SAMPLE; check(); })]), ta, out]);
        P.modal('Загрузка матрицы из Excel', body, [{ text: 'Отмена' }, { text: 'Загрузить', cls: 'grc-primary', keep: true, fn: function (close) {
            if (!plan || !plan.ctrls.length && !plan.risks.length) { P.toast('Нечего загружать', true); return false; }
            Promise.resolve().then(function () { return load(M, plan); }).then(function (n) { close(); P.toast('Загружено: ' + n.r + ' рисков, ' + n.c + ' контролей'); reload(); }).catch(function (e) { P.toast(e.message, true); });
            return false;
        } }], true);
    }
    /* Уникальность кодов проверяется до пакета: новый код не должен совпасть с существующей записью. */
    function load(M, plan) {
        var procs = {}; M.procs.forEach(function (p) { procs[p.name] = 1; });
        var cats = {}; M.cats.forEach(function (c) { cats[c] = 1; });
        var ops = [], nr = 0;
        plan.risks.filter(function (r) { return !r.exists; }).forEach(function (r) {
            if (M.riskBy[r.code]) throw new Error('Код риска ' + r.code + ' уже занят');
            var fl = { 'Риск': r.code, 'Название риска': r.name };
            if (procs[r.process]) fl['Бизнес-процесс'] = r.process;
            if (cats[r.category]) fl['Категория риска'] = r.category;
            if (r.p) fl['Уровень вероятности'] = M.probs[r.p - 1].name;
            if (r.i) fl['Уровень влияния'] = M.impacts[r.i - 1].name;
            ops.push({ op: 'new', id: 'Риск', up: 1, fields: fl }); nr++;
        });
        plan.ctrls.forEach(function (c) {
            if (M.ctrlBy[c.code]) throw new Error('Код контроля ' + c.code + ' уже занят');
            var e = M.empBy[c.owner], fl = { 'Контроль': c.code, 'Название контроля': c.name, 'Риск': c.risk, 'Ключевой контроль': c.key ? 1 : '', 'Что приложить': c.evidence };
            if (e) { fl['Владелец контроля'] = e.name; fl['Логин владельца'] = e.login; }
            if (c.period) fl['Периодичность'] = c.period;
            ops.push({ op: 'new', id: 'Контроль', up: 1, fields: fl });
        });
        return P.batch(ops).then(function () { return { r: nr, c: plan.ctrls.length }; });
    }
    P.mount(function (host, M, reload) { render(host, M, reload); });
})();
