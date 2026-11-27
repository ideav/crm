/* ТОиР: обход. Обходчик — телефон: маршрут, чек-лист точки, норма / замечание, фото, без сети. Остальные — ход обходов. */
(function () {
    'use strict';
    var T = window.Toir, C = T.core, el = T.el;
    var S = { round: null, pt: 0, ans: {}, file: null, crit: '', busy: false };
    var QKEY = 'toir-queue-' + T.ctx.user, NKEY = 'toir-offline';
    function lsGet(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
    function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
    S.queue = lsGet(QKEY, []); S.offline = !!lsGet(NKEY, false);
    var walkerMode = T.roleIs(/обходчик/i) && (!T.isAdmin() || /walker/.test(location.hash));

    T.mount(function (h, M) { S.M = M; S.h = h; draw(); });
    function draw() { var h = S.h; h.innerHTML = ''; if (walkerMode) walker(h, S.M); else board(h, S.M); }

    /* ---------- телефон обходчика ---------- */
    function myRounds(M) { return M.rounds.filter(function (r) { return r.date === T.TODAY && (r.walker === T.who() || T.isAdmin()); }).sort(function (a, b) { return (M.routeBy[a.route] || {}).start > (M.routeBy[b.route] || {}).start ? 1 : -1; }); }
    function marksOf(M, round) { return M.marks.filter(function (m) { return m.round === round.name; }); }
    function netBar() {
        var bar = el('div', { 'class': 'toir-net' + (S.offline ? ' toir-net-off' : ''), id: 'toir-net' }, [
            el('span', { text: S.offline ? 'Нет сети: отметки копятся на телефоне' : 'Сеть есть' }),
            S.queue.length ? el('b', { 'class': 'toir-amber', text: 'Не отправлено: ' + S.queue.length }) : null,
            T.btn(S.offline ? 'Сеть появилась' : 'Режим «нет сети»', function () { S.offline = !S.offline; lsSet(NKEY, S.offline); if (!S.offline && S.queue.length) flush(); else draw(); }, 'toir-small')
        ]);
        return bar;
    }
    function walker(h, M) {
        var wrap = el('div', { 'class': 'toir-phone' }); h.appendChild(wrap);
        wrap.appendChild(netBar());
        if (!S.round) {
            wrap.appendChild(el('h1', { text: 'Обходы на ' + C.ru(T.TODAY) }));
            wrap.appendChild(el('p', { 'class': 'toir-sub', text: 'Маршрут по точкам, в каждой пять пунктов: норма или замечание. Замечание сразу уходит мастеру дефектом.' }));
            myRounds(M).forEach(function (r) {
                var rt = M.routeBy[r.route] || { points: [] }, pr = C.routeProgress(rt.points, M.items, marksOf(M, r));
                wrap.appendChild(el('div', { 'class': 'toir-card toir-click', onclick: function () { S.round = r; S.pt = firstOpen(M, r); S.ans = {}; draw(); } }, [
                    el('div', { 'class': 'toir-item-h' }, [el('b', { text: r.route }), el('span', { html: T.badge(r.status, T.statusKind(r.status)) })]),
                    el('div', { 'class': 'toir-muted', text: 'Начало ' + (rt.start || '') + ' · точек ' + pr.done + ' из ' + pr.total + (pr.remarks ? ' · замечаний ' + pr.remarks : '') })]));
            });
            if (!myRounds(M).length) wrap.appendChild(el('p', { 'class': 'toir-muted', text: 'На сегодня обходов нет.' }));
            wrap.appendChild(myDefects(M));
            return;
        }
        var r = S.round, rt = M.routeBy[r.route], pts = rt.points, done = doneMap(M, r);
        wrap.appendChild(el('div', { 'class': 'toir-bar' }, [T.btn('← Обходы', function () { S.round = null; draw(); }, 'toir-small'), el('b', { 'class': 'toir-grow', text: r.route })]));
        wrap.appendChild(el('div', { 'class': 'toir-points' }, pts.map(function (p, i) {
            var st = done[p.eq];
            return el('button', { type: 'button', 'class': 'toir-pt' + (i === S.pt ? ' toir-pt-on' : '') + (st === 'rem' ? ' toir-pt-rem' : st ? ' toir-pt-done' : ''), text: (i + 1) + '. ' + p.eq.split(' ').pop(), onclick: function () { S.pt = i; S.ans = {}; S.file = null; S.tag = null; S.note = ''; S.crit = ''; draw(); } });
        })));
        var p = pts[S.pt];
        if (done[p.eq]) { wrap.appendChild(pointDone(M, r, p)); return; }
        wrap.appendChild(pointForm(M, r, p));
    }
    function firstOpen(M, r) { var d = doneMap(M, r), pts = (M.routeBy[r.route] || { points: [] }).points; for (var i = 0; i < pts.length; i++) if (!d[pts[i].eq]) return i; return 0; }
    function doneMap(M, r) {
        var out = {}, ms = marksOf(M, r), pts = (M.routeBy[r.route] || { points: [] }).points;
        pts.forEach(function (p) { var mm = ms.filter(function (m) { return m.eq === p.eq; }); if (mm.length >= (M.items[p.type] || []).length && mm.length) out[p.eq] = mm.some(function (m) { return m.result === 'Замечание'; }) ? 'rem' : 'ok'; });
        S.queue.filter(function (q) { return q.round === r.name; }).forEach(function (q) { out[q.eq] = q.remark ? 'rem' : 'ok'; });
        return out;
    }
    function pointDone(M, r, p) {
        var ms = marksOf(M, r).filter(function (m) { return m.eq === p.eq; }), queued = S.queue.some(function (q) { return q.round === r.name && q.eq === p.eq; });
        return el('div', { 'class': 'toir-card' }, [el('h3', { text: p.eq }), el('p', { 'class': 'toir-muted', text: queued ? 'Отмечено без сети, ждёт отправки' : 'Точка отмечена' }),
            T.table([{ k: 'item', t: 'Пункт' }, { t: 'Итог', html: function (m) { return T.badge(m.result + (m.value !== '' && m.value !== undefined ? ' · ' + T.fmt(m.value, 1) : ''), m.result === 'Норма' ? 'ok' : 'crit'); } }], ms, { cls: 'toir-stack', empty: queued ? 'Ждёт отправки' : 'Нет отметок' }),
            nextBtn(M, r)]);
    }
    function nextBtn(M, r) { var n = firstOpen(M, r), d = doneMap(M, r); return d[(M.routeBy[r.route].points[n] || {}).eq] ? el('p', { 'class': 'toir-note toir-note-ok', text: 'Все точки маршрута отмечены' }) : T.btn('Следующая точка →', function () { S.pt = n; S.ans = {}; S.file = null; S.tag = null; S.note = ''; S.crit = ''; draw(); }, 'toir-primary toir-big'); }
    function remarkInfo(M, p) {
        var items = M.items[p.type] || [], eq = M.eqBy[p.eq] || {}, bad = [], worst = 0, kind = 'other';
        items.forEach(function (it) {
            var a = S.ans[it.name]; if (!a) return;
            if (it.kind === 'Показание') { var c = C.checkReading(it, a.value); if (!c.ok && !c.empty) { bad.push(it.name + ' ' + T.fmt(a.value, 1) + ' ' + it.unit + ' при норме ' + (C.num(it.lo) > 0 ? it.lo + '–' + it.hi : 'до ' + it.hi)); worst = Math.max(worst, c.excess); kind = 'reading'; } }
            else if (a.result === 'Замечание') bad.push(it.name);
        });
        if (kind !== 'reading') kind = C.remarkKind(S.note || '');
        var crit = C.suggestCriticality({ kind: kind, excess: worst, eqClass: eq.cls });
        return { bad: bad, crit: crit, excess: worst };
    }
    function pointForm(M, r, p) {
        var items = M.items[p.type] || [], eq = M.eqBy[p.eq] || {};
        var box = el('div', {});
        box.appendChild(el('div', { 'class': 'toir-card' }, [
            el('div', { 'class': 'toir-item-h' }, [T.eqLink(M, p.eq), el('span', { 'class': 'toir-muted', text: 'класс ' + (eq.cls || '—') })]),
            el('div', { 'class': 'toir-muted', text: (eq.inv || '') + ' · метка ' + (eq.label || '—') + (S.tag ? ' · отмечено: ' + S.tag : '') }),
            S.tag ? null : el('div', { 'class': 'toir-yn' }, [T.btn('Сканировать ' + (eq.label || 'QR'), function () { S.tag = 'QR'; draw(); }), T.btn('Метки нет — вручную', function () { S.tag = 'Вручную'; draw(); })])
        ]));
        var panel = el('div', {});
        items.forEach(function (it) {
            var a = S.ans[it.name], card = el('div', { 'class': 'toir-item', 'data-item': it.name });
            var hist = T.history(M, p.eq, it.name).slice(-10);
            card.appendChild(el('div', { 'class': 'toir-item-h' }, [el('span', { 'class': 'toir-item-name', text: it.name }), el('small', { 'class': 'toir-muted', text: it.hint || '' })]));
            if (it.kind === 'Показание') {
                var inp = T.input('number', a ? a.value : '', { step: 'any', inputmode: 'decimal', 'aria-label': it.name });
                var msg = el('span', { 'class': 'toir-muted' });
                var upd = function (full) {
                    var v = inp.value, c = C.checkReading(it, v);
                    S.ans[it.name] = v === '' ? undefined : { result: c.ok ? 'Норма' : 'Замечание', value: v };
                    card.className = 'toir-item' + (!c.ok && !c.empty ? ' toir-item-bad' : '');
                    msg.textContent = c.empty ? 'норма ' + (C.num(it.lo) > 0 ? it.lo + '–' + it.hi : 'до ' + it.hi) + ' ' + it.unit : c.ok ? 'в норме' : 'выше нормы на ' + Math.round(c.excess * 100) + '%';
                    msg.className = c.ok || c.empty ? 'toir-muted' : 'toir-red';
                    if (full) drawPanel();
                };
                var tmr = null; inp.addEventListener('input', function () { upd(false); clearTimeout(tmr); tmr = setTimeout(drawPanel, 350); });
                card.appendChild(el('div', { 'class': 'toir-reading' }, [inp, el('span', { text: it.unit }), msg]));
                var tr = C.trend(hist.map(function (m) { return m.value; }), it.hi);
                if (hist.length) card.appendChild(el('div', {}, [T.spark(hist.map(function (m) { return m.value; }), it.hi, it.lo, 240, 40), tr ? el('div', { 'class': 'toir-amber', text: tr + ' — по последним обходам' }) : null]));
                setTimeout(function () { upd(false); }, 0);
            } else {
                card.appendChild(el('div', { 'class': 'toir-yn' }, [
                    el('button', { type: 'button', 'class': a && a.result === 'Норма' ? 'toir-yn-ok' : '', text: 'Норма', onclick: function () { S.ans[it.name] = { result: 'Норма' }; draw(); } }),
                    el('button', { type: 'button', 'class': a && a.result === 'Замечание' ? 'toir-yn-bad' : '', text: 'Замечание', onclick: function () { S.ans[it.name] = { result: 'Замечание' }; draw(); } })]));
                if (a && a.result === 'Замечание') card.className = 'toir-item toir-item-bad';
            }
            box.appendChild(card);
        });
        box.appendChild(panel);
        function drawPanel() {
            panel.innerHTML = '';
            var info = remarkInfo(M, p), all = items.every(function (it) { return S.ans[it.name]; });
            if (info.bad.length) {
                var note = T.input('textarea', S.note || '', { rows: 2, placeholder: 'Что увидели: шум, течь, нагрев…', 'aria-label': 'Комментарий к замечанию' });
                note.addEventListener('input', function () { S.note = note.value; });
                var file = el('input', { type: 'file', accept: 'image/*', capture: 'environment', 'class': 'toir-file', 'aria-label': 'Фото замечания', onchange: function () { S.file = file.files[0] || null; } });
                S.crit = S.crit && S.critFor === p.eq ? S.crit : info.crit; S.critFor = p.eq;
                var cs = T.select(M.crit.map(function (c) { return [c.name, c.name + ' — срок ' + c.days + ' дн.']; }), S.crit); cs.addEventListener('change', function () { S.crit = cs.value; drawPanel(); });
                var days = (M.critBy[S.crit] || { days: 3 }).days;
                panel.appendChild(el('div', { 'class': 'toir-card toir-card-bad' }, [
                    el('b', { text: 'Замечание станет дефектом' }),
                    el('div', { 'class': 'toir-muted', text: info.bad.join('; ') }),
                    T.field('Комментарий', note), T.field('Фото', file),
                    T.field('Критичность (подсказка: ' + info.crit + ')', cs, 'Срок устранения — ' + C.ru(C.dueDate(T.TODAY, days)) + '. ' + ((M.critBy[S.crit] || {}).rule || ''))]));
            }
            panel.appendChild(T.btn(info.bad.length ? 'Отметить точку и отправить замечание' : 'Отметить точку: всё в норме', function (ev) { save(M, r, p, info, ev.target); }, 'toir-primary toir-big', all && S.tag ? {} : { disabled: 'disabled', title: S.tag ? 'Ответьте на все пункты' : 'Сначала отметьте точку по метке' }));
        }
        drawPanel();
        return box;
    }
    /* Сохранение точки: отметки пакетом, фото к первой отметке-замечанию, дефект со ссылкой на неё, статус обхода. */
    function pack(M, r, p, info) {
        var items = M.items[p.type] || [], t = T.hm();
        return { round: r.name, roundId: r.id, eq: p.eq, shop: r.shop, time: t, tag: S.tag || 'Вручную', remark: info.bad.length > 0, crit: S.crit || info.crit, note: S.note || '', bad: info.bad,
            marks: items.map(function (it) { var a = S.ans[it.name]; return { item: it.name, result: a.result, value: a.value === undefined ? '' : a.value }; }) };
    }
    function send(M, q, file) {
        var ops = q.marks.map(function (m) {
            var f = { 'Обход': q.round, 'Оборудование': q.eq, 'Пункт чек-листа': m.item, 'Цех': q.shop, 'Обходчик': T.who(), 'Результат отметки': m.result, 'Комментарий отметки': m.result === 'Замечание' ? (q.note || '') : '', 'Время отметки': q.time, 'Отметка по метке': q.tag };
            if (m.value !== '') f['Показание'] = m.value;
            return { op: 'new', id: 'Отметка обхода', up: 1, fields: f };
        });
        return T.post('_m_batch?JSON', { ops: ops }).then(function (j) {
            var res = (j && j.results) || [];
            if (res.length !== ops.length || res.some(function (x) { return !x.ok; })) throw new Error('Отметки не записались');
            var ids = res.map(function (x) { return String(x.id); });
            q.marks.forEach(function (m, i) { M.marks.push({ id: ids[i], round: q.round, date: T.TODAY, eq: q.eq, item: m.item, shop: q.shop, walker: T.who(), result: m.result, value: m.value, note: q.note, time: q.time, tag: q.tag }); });
            var first = q.marks.map(function (m, i) { return m.result === 'Замечание' ? ids[i] : null; }).filter(Boolean)[0];
            var chain = Promise.resolve();
            var photo = file || (q.photo ? dataToFile(q.photo) : null);
            if (first && photo) chain = chain.then(function () { return T.upload(first, 'Отметка обхода', 'Фото замечания', photo); });
            if (first) chain = chain.then(function () {
                var days = (M.critBy[q.crit] || { days: 3 }).days, no = C.defectNo(T.TODAY, T.now());
                var text = (q.note ? q.note + '. ' : '') + q.bad.join('; ');
                return T.create('Дефект', { 'Дефект': no, 'Оборудование': q.eq, 'Цех': q.shop, 'Обнаружен': T.TODAY, 'Источник дефекта': 'Обход', 'Отметка обхода': first, 'Описание дефекта': text, 'Критичность дефекта': q.crit, 'Статус дефекта': 'Новый', 'Срок устранения': C.dueDate(T.TODAY, days), 'Автор дефекта': T.who() })
                    .then(function (id) { M.defects.push({ id: id, name: no, eq: q.eq, shop: q.shop, found: T.TODAY, source: 'Обход', mark: first, text: text, crit: q.crit, status: 'Новый', due: C.dueDate(T.TODAY, days), author: T.who(), answer: '' }); q.defect = no; });
            });
            return chain.then(function () { return roundStatus(M, q); }).then(function () { return q; });
        });
    }
    function roundStatus(M, q) {
        var r = M.roundBy[q.round]; if (!r) return null;
        var d = doneMap(M, r), pts = M.routeBy[r.route].points, all = pts.every(function (p) { return d[p.eq]; });
        var f = {};
        if (r.status !== 'В работе' && r.status !== 'Выполнен') { f['Статус обхода'] = 'В работе'; f['Начат в'] = q.time; r.status = 'В работе'; }
        if (all) { f['Статус обхода'] = 'Выполнен'; f['Завершён в'] = q.time; r.status = 'Выполнен'; }
        return Object.keys(f).length ? T.update(r.id, f) : null;
    }
    function dataToFile(u) { var b = atob(u.split(',')[1]), a = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return new File([a], 'photo.jpg', { type: 'image/jpeg' }); }
    function shrink(file) {
        return new Promise(function (res) {
            if (!file) return res(null);
            var u = URL.createObjectURL(file), im = new Image();
            im.onload = function () { var k = Math.min(1, 900 / im.naturalWidth), cv = document.createElement('canvas'); cv.width = Math.round(im.naturalWidth * k); cv.height = Math.round(im.naturalHeight * k); cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height); URL.revokeObjectURL(u); res(cv.toDataURL('image/jpeg', 0.75)); };
            im.onerror = function () { res(null); }; im.src = u;
        });
    }
    function save(M, r, p, info, btn) {
        if (S.busy) return; S.busy = true; btn.disabled = true;
        var q = pack(M, r, p, info), file = S.file;
        var after = function (msg) { S.busy = false; S.ans = {}; S.file = null; S.tag = null; S.note = ''; S.crit = ''; S.pt = firstOpen(M, r); T.toast(msg); draw(); };
        if (S.offline) {
            return shrink(file).then(function (u) { if (u) q.photo = u; S.queue = C.queueAdd(S.queue, q); lsSet(QKEY, S.queue); after('Сохранено на телефоне: отправится, когда появится сеть'); });
        }
        send(M, q, file).then(function (x) { after(x.defect ? 'Замечание отправлено мастеру: дефект ' + x.defect + ', срок ' + C.ru(C.dueDate(T.TODAY, (M.critBy[x.crit] || { days: 3 }).days)) : 'Точка отмечена'); })
            .catch(function (e) { S.busy = false; btn.disabled = false; T.toast(e.message, true); });
    }
    function flush() {
        var M = S.M, list = S.queue.slice(), sent = 0;
        var step = function () {
            if (!list.length) { T.toast('Отправлено: ' + sent); draw(); return; }
            var q = list.shift();
            send(M, q, null).then(function () { sent++; S.queue = C.queueDrop(S.queue, q.qid); lsSet(QKEY, S.queue); step(); })
                .catch(function (e) { T.toast('Не отправилось: ' + e.message, true); draw(); });
        };
        step();
    }
    /* Мои замечания: что с ними сделали. */
    function myDefects(M) {
        var mine = M.defects.filter(function (d) { return d.author === T.who(); }).sort(function (a, b) { return b.found.localeCompare(a.found) || b.name.localeCompare(a.name); }).slice(0, 12);
        return el('div', {}, [el('h2', { text: 'Мои замечания и ответы' }),
            T.table([{ t: 'Узел', html: function (d) { return T.esc(d.eq) + '<br><small class="toir-muted">' + C.ru(d.found) + ' · ' + T.esc(d.name) + '</small>'; } },
                { t: 'Статус', html: function (d) { var s = C.defectState(d, T.TODAY); return T.badge(d.status, T.statusKind(d.status)) + (s.overdue ? ' ' + T.badge('срок прошёл', 'crit') : ''); } },
                { t: 'Ответ', html: function (d) { return d.answer ? T.esc(d.answer) : '<span class="toir-muted">ответа пока нет</span>'; } }], mine, { cls: 'toir-stack', empty: 'Замечаний пока нет' })]);
    }
    /* ---------- ход обходов (мастер, механик, начальник цеха) ---------- */
    function board(h, M) {
        h.appendChild(el('div', {}, T.head('Ход обходов на ' + C.ru(T.TODAY), 'Кто где прошёл, какие отклонения, какие замечания не стали дефектами. Телефон обходчика — под его учёткой.')));
        var today = M.rounds.filter(function (r) { return r.date === T.TODAY; });
        var week = C.addDays(T.TODAY, -7), lastWeek = M.rounds.filter(function (r) { return r.date >= week && r.date < T.TODAY; });
        var free = C.remarksWithoutDefect(M.marks.filter(function (m) { return m.date >= C.addDays(T.TODAY, -30); }), M.defects);
        h.appendChild(el('div', { 'class': 'toir-kpis' }, [
            T.kpi('обходов сегодня выполнено', today.filter(function (r) { return r.status === 'Выполнен'; }).length + ' из ' + today.length),
            T.kpi('выполнено за 7 дней', lastWeek.filter(function (r) { return r.status === 'Выполнен'; }).length + ' из ' + lastWeek.length, lastWeek.filter(function (r) { return r.status === 'Пропущен'; }).length + ' пропущено', lastWeek.some(function (r) { return r.status === 'Пропущен'; }) ? 'warn' : ''),
            T.kpi('замечаний без дефекта, 30 дней', String(free.length), 'записаны в обходе, но в работу не попали', free.length ? 'bad' : 'good')]));
        h.appendChild(T.table([
            { t: 'Маршрут', html: function (r) { return T.esc(r.route) + '<br><small class="toir-muted">' + T.esc(r.walker) + ', начало ' + T.esc((M.routeBy[r.route] || {}).start || '') + '</small>'; } },
            { t: 'Статус', html: function (r) { return T.badge(r.status, T.statusKind(r.status)); } },
            { t: 'Точки', num: true, html: function (r) { var p = C.routeProgress((M.routeBy[r.route] || {}).points || [], M.items, marksOf(M, r)); return p.done + ' / ' + p.total; } },
            { t: 'Отклонения', html: function (r) { var ms = marksOf(M, r).filter(function (m) { return m.result === 'Замечание'; }); return ms.length ? ms.map(function (m) { return '<span class="toir-red">' + T.esc(m.eq.split(' ').pop() + ': ' + m.item + (m.value ? ' ' + T.fmt(m.value, 1) : '')) + '</span>'; }).join('<br>') : '<span class="toir-muted">нет</span>'; } },
            { t: 'Время', html: function (r) { return T.esc((r.started || '') + (r.finished ? '–' + r.finished : '')); } }], today, { cls: 'toir-stack' }));
        h.appendChild(el('h2', { text: 'Замечания обходов, по которым нет дефекта' }));
        h.appendChild(T.table([
            { t: 'Дата', html: function (m) { return C.ru(m.date) + ' ' + T.esc(m.time || ''); } },
            { t: 'Узел', node: function (m) { return T.eqLink(M, m.eq); } },
            { k: 'item', t: 'Пункт' }, { t: 'Что записал обходчик', html: function (m) { return T.esc(m.note || '') + (m.photo ? ' <a href="' + T.esc(m.photo) + '" target="_blank" rel="noopener">фото</a>' : ''); } },
            { k: 'walker', t: 'Обходчик' }], free.sort(function (a, b) { return b.date.localeCompare(a.date); }), { cls: 'toir-stack', empty: 'Все замечания стали дефектами' }));
        if (T.isAdmin()) h.appendChild(el('p', { 'class': 'toir-muted' }, [T.btn('Открыть как телефон обходчика', function () { location.hash = 'walker'; walkerMode = true; draw(); }, 'toir-small')]));
    }
})();
