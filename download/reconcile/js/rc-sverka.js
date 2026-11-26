/* Сверка: загрузка двух файлов по формату, сопоставление по правилам, отчёт расхождений по причинам, запись прогона, расчёт на 1 млн строк. */
(function () {
    'use strict';
    var P = window.Rc, C = P.core;
    var DEMO = { bank: 'volga_4417_2026-11-26.csv', bankNew: 'volga_4417_2026-11-26_new.csv', ledger: '1c_51-01_2026-11-26.csv' };
    /* подсказка: какая колонка файла похожа на недостающее поле */
    var GUESS = { date: /дата|период/i, amount: /сумма/i, 'in': /приход|поступлен|дебет/i, out: /расход|списан|кредит/i, cp: /плательщик|получател|контрагент|наименован/i, inn: /инн/i, doc: /номер|№/i, purpose: /назначен|содержан/i };
    var st = { pair: '', files: { b: null, l: null }, over: { b: {}, l: {} }, res: null, filter: '' };
    var host, M;

    function pairOf() { return M.pairs.filter(function (p) { return p.name === st.pair; })[0] || M.pairs[0]; }
    function fmtOf(side) { var p = pairOf(); return M.fmtBy[side === 'b' ? p.fb : p.fl]; }
    /* Формат с поправками маппинга, сделанными в этой загрузке. */
    function effFmt(side) {
        var f = fmtOf(side); if (!f) return null;
        var o = st.over[side];
        return Object.assign({}, f, { cols: f.cols.map(function (c) { return o[c.field] ? Object.assign({}, c, { header: o[c.field] }) : c; }) });
    }
    function demoUrl(name) { return '/download/' + P.ctx.db + '/demo/' + name; }
    function loadDemo(bankName) {
        st.pair = M.pairs[0].name; st.over = { b: {}, l: {} };
        return Promise.all([bankName, DEMO.ledger].map(function (n) { return fetch(demoUrl(n), { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('Нет демо-файла ' + n); return r.text(); }); }))
            .then(function (t) { st.files.b = { name: bankName, text: t[0] }; st.files.l = { name: DEMO.ledger, text: t[1] }; run(); })
            .catch(function (e) { P.toast(e.message, true); });
    }
    function readFile(side, file) {
        var fr = new FileReader();
        fr.onload = function () {
            var txt = String(fr.result || '');
            /* файл в windows-1251 (частый случай выгрузок 1С и банков) читаем заново в нужной кодировке */
            if (/�/.test(txt.slice(0, 2000))) {
                var f2 = new FileReader(); f2.onload = function () { st.files[side] = { name: file.name, text: String(f2.result || '') }; run(); }; f2.readAsText(file, 'windows-1251'); return;
            }
            st.files[side] = { name: file.name, text: txt }; st.over[side] = {}; run();
        };
        fr.readAsText(file, 'utf-8');
    }
    /* Разбор и сопоставление: всё в браузере, без обращения к серверу. */
    function run() {
        st.res = null; st.filter = '';
        if (!st.files.b || !st.files.l) { render(); return; }
        var t0 = performance.now();
        var pb = C.applyFormat(st.files.b.text, effFmt('b')), pl = C.applyFormat(st.files.l.text, effFmt('l'));
        var out = { pb: pb, pl: pl, t0: t0 };
        if (!pb.missing.length && !pl.missing.length) {
            var t1 = performance.now();
            out.m = C.match(pb.rows, pl.rows, M.rules);
            out.items = C.classify(pb.rows, pl.rows, out.m, { dayTol: 2 });
            out.sum = C.summary(pb.rows, pl.rows, out.m, out.items);
            out.ms = Math.max(1, Math.round(performance.now() - t1));
        }
        out.parseMs = Math.round(performance.now() - t0);
        st.res = out;
        render();
    }
    /* Окно правки маппинга: недостающие колонки выбираются из заголовков файла. */
    function fixMapping(side) {
        var r = side === 'b' ? st.res.pb : st.res.pl, f = fmtOf(side), sels = {};
        var body = P.el('div', {}, [P.el('p', { 'class': 'rc-muted', text: 'Формат «' + f.name + '». В файле нет колонок, которые нужны для сверки. Выберите, какая колонка файла их заменяет.' })]);
        r.missing.forEach(function (m) {
            var free = r.headers.filter(function (h) { return f.cols.every(function (c) { return c.header.toLowerCase() !== h.toLowerCase(); }); });
            var guess = free.filter(function (h) { return GUESS[m.field] && GUESS[m.field].test(h); })[0] || '';
            sels[m.field] = P.select([['', '- не выбрано -']].concat(r.headers.map(function (h) { return [h, h]; })), guess);
            body.appendChild(P.field(m.label + ' (было «' + m.header + '»)', sels[m.field]));
        });
        var canSave = P.canWrite('Колонка формата');
        body.appendChild(P.el('p', { 'class': 'rc-muted', text: canSave ? 'Изменение сохранится в формате и попадёт в журнал: следующая выгрузка этого банка разберётся без правки.' : 'У вашей роли нет права менять форматы: поправка действует только для этой загрузки, постоянную правку делает методолог.' }));
        P.modal('Поправить маппинг колонок', body, [{ text: 'Отмена' }, { text: canSave ? 'Сохранить в формат и повторить' : 'Применить к этой загрузке', cls: 'rc-primary', fn: function () {
            var ch = [];
            r.missing.forEach(function (m) { var v = sels[m.field].value; if (v) { st.over[side][m.field] = v; ch.push(m); } });
            if (!ch.length) { P.toast('Выберите колонку', true); return false; }
            if (canSave) {
                var ops = ch.map(function (m) { var col = f.cols.filter(function (c) { return c.field === m.field; })[0]; return { op: 'set', id: col.id, fields: { 'Заголовок в файле': st.over[side][m.field] } }; });
                ops.push(P.logOp('Изменение формата', f.name, ch.map(function (m) { return '«' + m.header + '» → «' + st.over[side][m.field] + '»'; }).join('; ')));
                P.batch(ops).then(function () { return P.model(); }).then(function (m2) { M = m2; st.over[side] = {}; P.toast('Маппинг сохранён в формате'); run(); }).catch(function (e) { P.toast(e.message, true); });
            } else run();
        } }]);
    }

    function canSave() { return ['Загрузка файла', 'Запись сверки', 'Прогон сверки', 'Расхождение'].every(P.canWrite); }
    function savedBefore() {
        var hb = C.hash(st.files.b.text), hl = C.hash(st.files.l.text);
        return M.loads.filter(function (l) { return l.hash === hb || l.hash === hl; })[0] || null;
    }
    /* Запись прогона: две загрузки, прогон, все строки с итогом сопоставления, расхождения на разбор, журнал. */
    function save(btn) {
        var r = st.res, p = pairOf(), pi = M.pairs.indexOf(p) + 1, hm = P.now().replace(':', ''), md = P.TODAY.slice(5, 7) + P.TODAY.slice(8, 10);
        if (C.isLocked(P.TODAY, M.periods)) { P.toast('Период закрыт: запись прогона запрещена', true); return; }
        if (savedBefore()) { P.toast('Этот файл уже загружен: повторная запись не создаёт дублей', true); return; }
        btn.disabled = true; btn.textContent = 'Записываю...';
        var loads = [['b', st.files.b, p.fb, r.pb], ['l', st.files.l, p.fl, r.pl]], ids = {};
        var runCode = 'ПР-' + pi + '-' + P.TODAY + '-' + hm;
        Promise.all(loads.map(function (x) {
            return P.create('Загрузка файла', { 'Загрузка файла': x[1].name, 'Формат загрузки': x[2], 'Пара сверки': p.name, 'Дата загрузки': P.TODAY, 'Время загрузки': P.now(), 'Загрузил': P.ctx.user, 'Строк в файле': x[3].total, 'Строк с ошибкой': x[3].errors.length, 'Хэш файла': C.hash(x[1].text) }).then(function (j) { ids[x[0]] = j.id || j.obj; });
        })).then(function () {
            return P.create('Прогон сверки', { 'Прогон сверки': runCode, 'Пара сверки': p.name, 'Период сверки': (C.periodOf(P.TODAY, M.periods) || {}).name || '', 'Дата прогона': P.TODAY, 'Время прогона': P.now(), 'Файл банка': st.files.b.name, 'Файл учёта': st.files.l.name, 'Строк банка': r.pb.rows.length, 'Строк учёта': r.pl.rows.length, 'Сопоставлено строк': r.sum.matched, 'Не сопоставлено строк': r.sum.unmatched, 'Сошлось, %': r.sum.pct, 'Длительность, мс': r.ms, 'Запустил': P.ctx.user, 'Статус прогона': 'Черновик' });
        }).then(function (jr) {
            var runId = jr.id || jr.obj, ops = [], grp = { b: {}, l: {} }, code = { b: [], l: [] };
            r.m.groups.forEach(function (g, k) { var gc = 'Г' + pi + '-' + md + hm + '-' + (k + 1); g.a.forEach(function (i) { grp.b[i] = [gc, g.rule]; }); g.b.forEach(function (j) { grp.l[j] = [gc, g.rule]; }); });
            [['b', r.pb.rows, 'Банк', 'Б'], ['l', r.pl.rows, 'Учёт', 'У']].forEach(function (x) {
                x[1].forEach(function (row, i) {
                    var g = grp[x[0]][i], c = x[3] + pi + '-' + md + hm + '-' + ('00' + (i + 1)).slice(-3); code[x[0]][i] = c;
                    ops.push({ op: 'new', id: P.tid('Запись сверки'), up: 1, fields: { 'Запись сверки': c, 'Загрузка файла': ids[x[0]], 'Пара сверки': p.id, 'Сторона сверки': x[2], 'Дата операции': row.date, 'Сумма операции': row.amount, 'Контрагент': row.cp, 'ИНН контрагента': row.inn, 'Номер документа': row.doc, 'Назначение платежа': row.purpose, 'Статус сопоставления': g ? 'Сопоставлено' : 'Расхождение', 'Группа сопоставления': g ? g[0] : '', 'Правило сопоставления': g ? g[1] : '' } });
                });
            });
            r.items.forEach(function (it, k) {
                ops.push({ op: 'new', id: P.tid('Расхождение'), up: 1, fields: { 'Расхождение': 'РС-' + pi + '-' + md + hm + '-' + (k + 1), 'Пара сверки': p.id, 'Причина расхождения': it.reason, 'Прогон сверки': runId, 'Контрагент': it.cp, 'Дата операции': it.date, 'Сумма операции': it.amount, 'Сумма расхождения': it.a.length && it.b.length ? it.diff : it.amount,
                    'Записи банка': it.a.map(function (i) { return code.b[i]; }).join(', '), 'Записи учёта': it.b.map(function (j) { return code.l[j]; }).join(', '), 'Дата выявления': P.TODAY, 'Срок разбора': C.addDays(P.TODAY, p.sla), 'Ответственный': p.respId, 'Статус разбора': C.ST.OPEN } });
            });
            ops.push(P.logOp('Загрузка файла', st.files.b.name, 'Формат «' + p.fb + '», строк: ' + r.pb.total + ', ошибок разбора: ' + r.pb.errors.length));
            ops.push(P.logOp('Загрузка файла', st.files.l.name, 'Формат «' + p.fl + '», строк: ' + r.pl.total + ', ошибок разбора: ' + r.pl.errors.length));
            ops.push(P.logOp('Прогон сверки', runCode, 'Сошлось ' + r.sum.pct + '% (' + r.sum.matched + ' из ' + r.sum.total + ' строк), расхождений на разбор: ' + r.items.length));
            return P.batch(ops, function (k, n) { btn.textContent = 'Записываю: ' + k + ' из ' + n; });
        }).then(function (res) {
            var bad = res.filter(function (x) { return !x.ok; }).length;
            P.toast(bad ? 'Записано с ошибками: ' + bad : 'Прогон записан: расхождения ушли ответственному ' + p.resp, !!bad);
            return P.model().then(function (m2) { M = m2; render(); });
        }).catch(function (e) { P.toast(e.message, true); btn.disabled = false; btn.textContent = 'Записать прогон в базу'; });
    }
    /* 1 000 000 строк: две синтетические выгрузки по 500 000, расчёт в фоне (Web Worker), страница не замирает. */
    function million(box) {
        box.innerHTML = ''; box.appendChild(P.el('p', { text: 'Генерирую две выгрузки по 500 000 строк и сверяю...' }));
        function show(d) {
            box.innerHTML = '';
            box.appendChild(P.el('div', { 'class': 'rc-kpis' }, [
                P.kpi('Строк сверено', d.sum.total.toLocaleString('ru-RU'), '2 файла, правила как у пары'),
                P.kpi('Сопоставление', (d.match / 1000).toFixed(1).replace('.', ',') + ' с', 'точное, допуск, N:1', 'good'),
                P.kpi('Разбор причин', (d.cls / 1000).toFixed(1).replace('.', ',') + ' с', 'по каждой непарной строке', 'good'),
                P.kpi('Сошлось', String(d.sum.pct).replace('.', ',') + '%', 'не сошлось ' + d.sum.unmatched.toLocaleString('ru-RU') + ' строк', d.sum.pct < 95 ? 'warn' : 'good')]));
            box.appendChild(P.el('p', { 'class': 'rc-muted', text: 'Расчёт идёт в браузере, без сервера: тот же модуль, что сверяет ваши файлы. Генерация данных заняла ' + (d.gen / 1000).toFixed(1).replace('.', ',') + ' с и в итог не входит. Причины: ' + d.sum.byReason.map(function (x) { return x.reason + ' ' + x.n.toLocaleString('ru-RU'); }).join(', ') + '.' }));
        }
        function sync() { setTimeout(function () { var t0 = Date.now(), s = C.synth(500000, 979), t1 = Date.now(), m = C.match(s.A, s.B), t2 = Date.now(), it = C.classify(s.A, s.B, m), sm = C.summary(s.A, s.B, m, it); show({ gen: t1 - t0, match: t2 - t1, cls: Date.now() - t2, sum: sm }); }, 30); }
        try {
            var core = document.querySelector('script[src*="reconcile-core.js"]').src;
            var src = 'importScripts(' + JSON.stringify(core) + ');onmessage=function(e){var C=self.ReconCore,t0=Date.now(),s=C.synth(e.data,979),t1=Date.now(),m=C.match(s.A,s.B),t2=Date.now(),it=C.classify(s.A,s.B,m),sm=C.summary(s.A,s.B,m,it);postMessage({gen:t1-t0,match:t2-t1,cls:Date.now()-t2,sum:{pct:sm.pct,total:sm.total,unmatched:sm.unmatched,byReason:sm.byReason}})};';
            var w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
            w.onmessage = function (e) { show(e.data); w.terminate(); };
            w.onerror = function (e) { e.preventDefault(); w.terminate(); sync(); };
            w.postMessage(500000);
        } catch (e) { sync(); }
    }

    function fileCard(side) {
        var f = fmtOf(side), file = st.files[side], r = st.res && (side === 'b' ? st.res.pb : st.res.pl), bad = r && r.missing.length;
        var inp = P.el('input', { type: 'file', accept: '.csv,.txt', onchange: function () { if (inp.files[0]) readFile(side, inp.files[0]); } });
        var kids = [P.el('b', { text: side === 'b' ? 'Выписка банка' : 'Выгрузка учётной системы' }), P.el('span', { 'class': 'rc-muted', text: 'Формат: ' + (f ? f.name + ' (' + f.sys + ', разделитель «' + f.delim + '», даты ' + f.dateFmt + ')' : 'не задан') }), inp];
        if (file) kids.push(P.el('span', { text: file.name + (r ? ': строк ' + r.total + ', разобрано ' + r.rows.length + (r.errors.length ? ', пропущено ' + r.errors.length : '') : '') }));
        if (bad) {
            kids.push(P.el('div', { 'class': 'rc-warnbox rc-e', text: 'Не найдены колонки: ' + r.missing.map(function (m) { return '«' + m.header + '» (' + m.label + ')'; }).join(', ') + '. В файле: ' + r.headers.join(', ') }));
            kids.push(P.btn('Поправить маппинг', function () { fixMapping(side); }, 'rc-primary'));
        }
        if (r && r.errors.length) kids.push(P.el('div', { 'class': 'rc-warnbox rc-w', text: r.errors.slice(0, 3).map(function (e) { return 'строка ' + e.line + ': ' + e.msg; }).join('; ') + (r.errors.length > 3 ? ' и ещё ' + (r.errors.length - 3) : '') }));
        return P.el('div', { 'class': 'rc-file' + (bad ? ' rc-bad' : file ? ' rc-has' : '') }, kids);
    }
    function sideSum(r, idx) { var s = 0; idx.forEach(function (i) { s += r[i].amount; }); return C.round2(s); }
    function results(box) {
        var r = st.res, s = r.sum, A = r.pb.rows, B = r.pl.rows, reason = {}; M.reasons.forEach(function (x) { reason[x.name] = x; });
        var unSum = 0; r.items.forEach(function (it) { unSum += Math.abs(it.a.length && it.b.length ? it.diff : it.amount); });
        box.appendChild(P.el('div', { 'class': 'rc-hero' }, [P.el('span', { 'class': 'rc-big', text: 'Сошлось ' + String(s.pct).replace('.', ',') + '%' }), P.el('span', { 'class': 'rc-big rc-r', text: 'не сошлось ' + String(C.round2(100 - s.pct)).replace('.', ',') + '%' }),
            P.el('span', { 'class': 'rc-muted', text: s.unmatched + ' строк из ' + s.total + ', ' + r.items.length + ' расхождений на ' + P.short(unSum) + '. Сопоставление за ' + r.ms + ' мс' })]));
        var max = Math.max.apply(null, s.byReason.map(function (x) { return x.sum; }).concat([1]));
        box.appendChild(P.el('h2', { text: 'Расхождения по причинам' }));
        s.byReason.forEach(function (x) {
            var on = st.filter === x.reason;
            box.appendChild(P.el('div', { 'class': 'rc-rbar rc-click', title: 'Показать только эту причину', onclick: function () { st.filter = on ? '' : x.reason; render(); } }, [
                P.el('span', { html: (on ? '<b>' : '') + P.esc(x.reason) + ' <span class="rc-muted">(' + x.n + ')</span>' + (on ? '</b>' : '') }),
                P.el('div', { 'class': 'rc-bar-track' }, [P.el('div', { 'class': 'rc-bar-fill rc-r', style: 'width:' + Math.max(2, x.sum / max * 100) + '%' })]),
                P.el('span', { 'class': 'rc-num', text: P.money(x.sum) })]));
        });
        var items = r.items.filter(function (it) { return !st.filter || it.reason === st.filter; });
        box.appendChild(P.el('h2', { text: 'Отчёт расхождений' + (st.filter ? ': ' + st.filter : '') }));
        box.appendChild(P.table([
            { t: 'Причина', html: function (it) { return P.badge(it.reason, it.reason === C.REASONS.FEE ? 'warn' : 'crit'); } },
            { t: 'Контрагент', k: 'cp' }, { t: 'Дата', html: function (it) { return P.esc(C.toDmy(it.date)); } },
            { t: 'Банк', num: 1, html: function (it) { return it.a.length ? P.money(sideSum(A, it.a)) + (it.a.length > 1 ? ' (' + it.a.length + ')' : '') : '<span class="rc-muted">нет</span>'; } },
            { t: 'Учёт', num: 1, html: function (it) { return it.b.length ? P.money(sideSum(B, it.b)) + (it.b.length > 1 ? ' (' + it.b.length + ')' : '') : '<span class="rc-muted">нет</span>'; } },
            { t: 'Разница', num: 1, html: function (it) { return P.money(it.a.length && it.b.length ? it.diff : it.amount); } },
            { t: 'Что проверить', html: function (it) { return '<span class="rc-muted">' + P.esc((reason[it.reason] || {}).check || '') + '</span>'; } }
        ], items, { empty: 'Расхождений нет' }));
        box.appendChild(P.el('h2', { text: 'Какие правила сработали' }));
        box.appendChild(P.table([{ t: 'Правило', k: 'rule' }, { t: 'Групп', k: 'groups', num: 1 }, { t: 'Строк', k: 'rows', num: 1 }], s.byRule));
        var prev = savedBefore(), bar = P.el('div', { 'class': 'rc-bar' });
        if (canSave()) {
            var b = P.btn(prev ? 'Уже записан ' + C.toDmy(prev.date) + ' ' + prev.time : 'Записать прогон в базу', function () { save(b); }, 'rc-primary'); b.disabled = !!prev; bar.appendChild(b);
        }
        bar.appendChild(P.btn('Скачать отчёт расхождений (CSV)', function () {
            P.download('расхождения_' + P.TODAY + '.csv', C.toCsv(r.items, [{ t: 'Причина', k: 'reason' }, { t: 'Контрагент', k: 'cp' }, { t: 'Дата', k: function (it) { return C.toDmy(it.date); } }, { t: 'Банк', k: function (it) { return it.a.length ? String(sideSum(A, it.a)).replace('.', ',') : ''; } }, { t: 'Учёт', k: function (it) { return it.b.length ? String(sideSum(B, it.b)).replace('.', ',') : ''; } }, { t: 'Разница', k: function (it) { return String(it.a.length && it.b.length ? it.diff : it.amount).replace('.', ','); } }]));
        }));
        bar.appendChild(P.el('span', { 'class': 'rc-muted', text: canSave() ? 'Строки и расхождения уйдут в базу; расхождения - в очередь ответственного ' + pairOf().resp + ' со сроком ' + pairOf().sla + ' дн.' : 'Записывать прогоны может оператор или контролёр.' }));
        box.appendChild(bar);
    }
    function render() {
        host.innerHTML = '';
        P.head('Загрузка и сверка', 'Две выгрузки разных форматов: выписка банка и учётная система. Колонки разбираются по формату источника, строки сопоставляются по правилам (точное, с допуском, N:1), каждое расхождение получает причину.').forEach(function (n) { host.appendChild(n); });
        var sel = P.select(M.pairs.map(function (p) { return [p.name, p.name]; }), pairOf().name); sel.onchange = function () { st.pair = sel.value; st.over = { b: {}, l: {} }; run(); };
        host.appendChild(P.el('div', { 'class': 'rc-bar' }, [P.field('Пара сверки', sel), P.btn('Взять демо-файлы за 26.11', function () { loadDemo(DEMO.bank); }, 'rc-primary'), P.btn('Демо: банк поменял формат выписки', function () { loadDemo(DEMO.bankNew); })]));
        host.appendChild(P.el('div', { 'class': 'rc-drop' }, [fileCard('b'), fileCard('l')]));
        var box = P.el('div', {});
        if (st.res && st.res.sum) results(box);
        else if (!st.files.b || !st.files.l) box.appendChild(P.el('p', { 'class': 'rc-muted', text: 'Выберите два файла или нажмите «Взять демо-файлы»: выписка банка «Волга-Кредит» (154 операции, суммы с пробелами и запятой, строка «Итого») и выгрузка 1С (157 строк, даты ГГГГ-ММ-ДД, точка в суммах, контрагенты записаны иначе).' }));
        host.appendChild(box);
        host.appendChild(P.el('h2', { text: 'Тот же расчёт на 1 000 000 строк' }));
        var mb = P.el('div', {}, [P.el('p', { 'class': 'rc-muted', text: 'Две синтетические выгрузки по 500 000 строк с теми же видами расхождений. Считается в фоне, страница не замирает.' })]);
        host.appendChild(P.el('div', { 'class': 'rc-bar' }, [P.btn('Запустить на 1 млн строк', function () { million(mb); })]));
        host.appendChild(mb);
    }
    P.mount(function (h, m) { host = h; M = m; st.pair = (M.pairs.filter(function (p) { return p.resp === P.ctx.user; })[0] || M.pairs[0] || {}).name; render(); });
})();
