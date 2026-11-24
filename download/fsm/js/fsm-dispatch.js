/* FSM: экран диспетчера (доска нарядов, назначение, карта, занятость инженеров). Расчёты - в FsmCore, запись - через Fsm.* */
(function () {
    'use strict';
    var W = window.Fsm, C = W.core, MIN = C.MIN, HOUR = C.HOUR, DAY = C.DAY, el = W.el, esc = W.esc;
    var M = null, S = { off: 0, tab: 'board', sel: '', selReq: '', prio: '', eng: '', q: '' };
    var R = {}, timer = 0, dragId = '', busy = false, mapInst = null, leafP = null, contracts = null;
    var DAYS = [[-1, 'Вчера'], [0, 'Сегодня'], [1, 'Завтра'], [2, 'Послезавтра']];
    var COLS = [
        { t: 'Новый', st: ['Новый'] }, { t: 'Назначен', st: ['Назначен'] }, { t: 'В пути и на объекте', st: ['В пути', 'На объекте'] },
        { t: 'Ждёт запчасти', st: ['Ждёт запчасти'] }, { t: 'Выполнен, ждёт проверки', st: ['Выполнен'] }
    ];
    var ST_COLOR = { 'Новый': '#64748b', 'Назначен': '#2563eb', 'В пути': '#d97706', 'На объекте': '#7c3aed', 'Ждёт запчасти': '#dc2626', 'Выполнен': '#16a34a', 'Закрыт': '#15803d', 'Отменён': '#94a3b8' };

    function canW() { return W.canWrite('Наряд'); }
    function dayMs() { return C.dayStart(W.now()) + S.off * DAY; }
    function orderDay(o) { return C.dayStart(o.win0 || o.created); }
    function offOf(o) { return Math.round((orderDay(o) - C.dayStart(W.now())) / DAY); }
    function prioRank(n) { var p = M.prios.filter(function (x) { return x['Приоритет'] === n; })[0]; return p ? C.num(p['Порядок']) : 9; }
    function prioKind(n) { return { 'Аварийный': 'crit', 'Срочный': 'warn' }[n] || 'info'; }
    function bd(text, kind) { return W.badge(text, kind); }
    function isLate(o) { return C.isOpen(o) && C.slaState(o, W.now()).state === 'late'; }
    function slaHtml(o) {
        var s = C.slaState(o, W.now()), k = { ok: 'ok', risk: 'warn', late: 'crit', met: 'ok', missed: 'crit', none: 'info' }[s.state];
        var pref = s.stage === 'arrive' ? 'Прибытие: ' : s.stage === 'finish' ? 'Завершение: ' : '';
        return bd(pref + s.text, k);
    }
    function addr(o) { var ob = M.objects[o.obj]; return ob && ob.address ? ob.address : o.obj; }
    function initials(n) { return String(n).split(/\s+/).slice(0, 2).map(function (x) { return x.charAt(0); }).join(''); }
    function winText(o) { return o.win0 ? C.fmtTime(o.win0) + '-' + C.fmtTime(o.win1) : 'не задано'; }
    function act(p, okMsg) {
        if (busy) return Promise.resolve();
        busy = true;
        return p().then(function () { busy = false; if (okMsg) W.toast(okMsg); }).catch(function (e) { busy = false; W.toast('Ошибка: ' + (e && e.message || e), true); throw e; });
    }
    function reload() { return W.load().then(function (m) { M = m; }); }

    /* ---------- выборки ---------- */
    function dayOrders() { var d = dayMs(); return M.orders.filter(function (o) { return orderDay(o) === d; }); }
    function passFilters(o) {
        if (S.prio && o.prio !== S.prio) return false;
        if (S.eng === '-') { if (o.eng) return false; } else if (S.eng && o.eng !== S.eng) return false;
        if (S.q) {
            var h = (o.num + ' ' + o.obj + ' ' + o.client + ' ' + o.reqNum).toLowerCase();
            if (h.indexOf(S.q.toLowerCase()) < 0) return false;
        }
        return true;
    }
    function reqPass(q) {
        if (S.prio && q.prio !== S.prio) return false;
        if (S.q && (q.num + ' ' + q.obj + ' ' + q.client).toLowerCase().indexOf(S.q.toLowerCase()) < 0) return false;
        return true;
    }
    function sortCards(a, b) {
        var la = isLate(a) ? 0 : 1, lb = isLate(b) ? 0 : 1;
        return la - lb || prioRank(a.prio) - prioRank(b.prio) || (a.win0 || a.created) - (b.win0 || b.created);
    }
    function counts() {
        var list = dayOrders(), now = W.now(), c = { nw: 0, work: 0, late: 0, risk: 0, parts: 0 };
        list.forEach(function (o) {
            if (o.status === 'Новый') c.nw++;
            if (['Назначен', 'В пути', 'На объекте', 'Ждёт запчасти'].indexOf(o.status) >= 0) c.work++;
            if (o.status === 'Ждёт запчасти') c.parts++;
            if (C.isOpen(o)) { var s = C.slaState(o, now).state; if (s === 'late') c.late++; else if (s === 'risk') c.risk++; }
        });
        return c;
    }

    /* ---------- шапка ---------- */
    function renderTiles() {
        var c = counts();
        var t = [['Новые', c.nw, ''], ['В работе', c.work, ''], ['Просрочено', c.late, c.late ? 'fsm-disp-t-bad' : ''], ['Риск SLA', c.risk, c.risk ? 'fsm-disp-t-warn' : ''], ['Ждёт запчасти', c.parts, '']];
        R.tiles.innerHTML = '';
        t.forEach(function (x) { R.tiles.appendChild(el('div', { 'class': 'fsm-disp-tile ' + x[2] }, [el('div', { 'class': 'fsm-disp-tv', text: String(x[1]) }), el('div', { 'class': 'fsm-disp-tl', text: x[0] })])); });
    }
    function renderClock() { R.clock.textContent = 'Демо-время: ' + C.fmtDt(W.now()) + ' (МСК)'; }
    function renderDays() {
        R.days.innerHTML = '';
        DAYS.forEach(function (d) {
            R.days.appendChild(el('button', { type: 'button', 'class': 'fsm-disp-day' + (S.off === d[0] ? ' fsm-disp-day-on' : ''), text: d[1], onclick: function () { S.off = d[0]; renderDays(); renderTiles(); renderContent(); } }));
        });
        R.dayText.textContent = C.fmtDate(dayMs());
    }
    function buildHead(host) {
        host.innerHTML = '';
        R.clock = el('span', { 'class': 'fsm-sub' }); R.days = el('div', { 'class': 'fsm-disp-days', role: 'group', 'aria-label': 'День' }); R.dayText = el('span', { 'class': 'fsm-disp-daytext' });
        R.tiles = el('div', { 'class': 'fsm-disp-tiles' });
        var prio = W.select([['', 'Все приоритеты']].concat(M.prios.map(function (p) { return p['Приоритет']; })), S.prio);
        prio.onchange = function () { S.prio = prio.value; renderContent(); };
        var engNames = M.engineers.map(function (e) { return e.name; });
        var eng = W.select([['', 'Все инженеры'], ['-', 'Не назначен']].concat(engNames), S.eng);
        eng.onchange = function () { S.eng = eng.value; renderContent(); };
        var q = el('input', { type: 'search', placeholder: 'Номер, объект, заказчик', value: S.q, 'aria-label': 'Поиск' });
        q.oninput = function () { S.q = q.value.trim(); renderContent(); };
        host.appendChild(el('div', { 'class': 'fsm-disp-top' }, [el('div', {}, [el('h1', { text: 'Доска нарядов' }), R.clock]), el('div', { 'class': 'fsm-disp-dayswrap' }, [R.days, R.dayText])]));
        host.appendChild(R.tiles);
        host.appendChild(el('div', { 'class': 'fsm-bar fsm-disp-filters' }, [W.field('Приоритет', prio), W.field('Инженер', eng), W.field('Поиск', q)]));
        renderClock(); renderDays(); renderTiles();
    }

    /* ---------- карточки ---------- */
    function orderCard(o, opt) {
        opt = opt || {};
        var ob = M.objects[o.obj] || {}, late = isLate(o);
        var badges = [];
        if (o.repeat) badges.push(bd('Повторный', 'warn'));
        if (o.warranty) badges.push(bd('Гарантия', 'info'));
        if (ob.nosig) badges.push(bd('Нет связи на объекте', 'crit'));
        var html = '<div class="fsm-disp-ch"><b class="fsm-disp-num">' + esc(o.num) + '</b>' + bd(o.prio, prioKind(o.prio)) + '<span class="fsm-disp-sla">' + slaHtml(o) + '</span></div>' +
            '<div class="fsm-disp-wt">' + esc(o.wt) + '</div><div class="fsm-disp-cl">' + esc(o.client) + '</div><div class="fsm-disp-ad">' + esc(addr(o)) + '</div>' +
            '<div class="fsm-disp-meta"><span>' + (o.eng ? esc(o.eng) : '<i class="fsm-disp-none">не назначен</i>') + '</span><span>Окно ' + esc(winText(o)) + '</span></div>' +
            (badges.length ? '<div class="fsm-disp-bs">' + badges.join('') + '</div>' : '');
        var card = el('div', { 'class': 'fsm-disp-card' + (late ? ' fsm-disp-late' : '') + (opt.sel ? ' fsm-disp-selected' : ''), tabindex: '0', role: 'button', html: html, 'data-id': o.id });
        card.onclick = function () { if (opt.onpick) opt.onpick(o); else openOrder(o); };
        card.onkeydown = function (e) { if (e.key === 'Enter') card.onclick(); };
        if (opt.drag && canW()) {
            card.draggable = true;
            card.addEventListener('dragstart', function (e) { dragId = o.id; card.classList.add('fsm-disp-dragging'); try { e.dataTransfer.setData('text/plain', o.id); e.dataTransfer.effectAllowed = 'move'; } catch (x) { } });
            card.addEventListener('dragend', function () { dragId = ''; card.classList.remove('fsm-disp-dragging'); });
        }
        return card;
    }
    function reqCard(q) {
        var ob = M.objects[q.obj] || {};
        var html = '<div class="fsm-disp-ch"><b class="fsm-disp-num">' + esc(q.num) + '</b>' + bd(q.prio, prioKind(q.prio)) + '<span class="fsm-disp-sla">' + bd(q.src || 'Заявка', 'info') + '</span></div>' +
            '<div class="fsm-disp-cl">' + esc(q.client) + '</div><div class="fsm-disp-ad">' + esc(ob.address || q.obj) + '</div><div class="fsm-disp-wt fsm-disp-txt">' + esc(q.text) + '</div>' +
            '<div class="fsm-disp-meta"><span>' + esc(q.eq) + '</span><span>Принята ' + esc(C.fmtShort(q.created)) + '</span></div>';
        var card = el('div', { 'class': 'fsm-disp-card fsm-disp-req', html: html });
        if (canW()) card.appendChild(el('div', { 'class': 'fsm-disp-act' }, [W.btn('Создать наряд', function () { createOrderModal(q); }, 'fsm-primary')]));
        return card;
    }

    /* ---------- вкладка «Доска» ---------- */
    function renderBoard(host) {
        var list = dayOrders().filter(passFilters), board = el('div', { 'class': 'fsm-disp-board' });
        COLS.forEach(function (col, i) {
            var items = list.filter(function (o) { return col.st.indexOf(o.status) >= 0; }).sort(sortCards);
            var body = el('div', { 'class': 'fsm-disp-colbody' }), rq = M.requests.filter(reqPass);
            if (i === 0 && rq.length) {
                var box = el('div', { 'class': 'fsm-disp-reqbox' }, [el('div', { 'class': 'fsm-disp-reqh', text: 'Заявки из портала (не превращены в наряд): ' + rq.length })]);
                rq.forEach(function (q) { box.appendChild(reqCard(q)); });
                body.appendChild(box);
            }
            items.forEach(function (o) { body.appendChild(orderCard(o)); });
            if (!items.length && !(i === 0 && rq.length)) body.appendChild(el('div', { 'class': 'fsm-disp-empty', text: 'Нет нарядов' }));
            board.appendChild(el('section', { 'class': 'fsm-disp-col' }, [el('header', { 'class': 'fsm-disp-colh' }, [el('span', { text: col.t }), el('span', { 'class': 'fsm-disp-cnt', text: String(items.length) })]), body]));
        });
        host.appendChild(board);
        var closed = dayOrders().filter(function (o) { return o.status === 'Закрыт' || o.status === 'Отменён'; }).length;
        if (closed) host.appendChild(el('p', { 'class': 'fsm-sub fsm-disp-foot', text: 'Закрыто или отменено за день: ' + closed + ' (на доске не показано)' }));
    }

    /* ---------- окно наряда ---------- */
    function kv(k, v) { return '<div class="fsm-disp-kv"><span>' + esc(k) + '</span><span>' + v + '</span></div>'; }
    function openOrder(o) {
        var ob = M.objects[o.obj] || {};
        var body = el('div', { 'class': 'fsm-disp-det' });
        body.innerHTML = kv('Заказчик', esc(o.client)) + kv('Объект', esc(addr(o))) + kv('Оборудование', esc(o.eq)) + kv('Вид работ', esc(o.wt)) +
            kv('Приоритет', bd(o.prio, prioKind(o.prio))) + kv('Статус', bd(o.status, W.STATUS_CLS[o.status])) + kv('Инженер', o.eng ? esc(o.eng) : '<i>не назначен</i>') +
            kv('Окно прибытия', esc(winText(o))) + kv('Прибыть до', esc(C.fmtShort(o.arrDue))) + kv('Завершить до', esc(C.fmtShort(o.finDue))) + kv('SLA', slaHtml(o)) +
            (ob.onsite ? kv('Контакт на объекте', esc(ob.onsite)) : '') + (ob.pass ? kv('Пропуск', 'нужен') : '') + (ob.nosig ? kv('Связь', bd('Нет связи на объекте', 'crit')) : '') +
            (o.fault ? kv('Неисправность', esc(o.fault)) : '') + (o.reason ? kv('Причина просрочки', esc(o.reason)) : '');
        var more = el('div', { 'class': 'fsm-disp-more', text: 'Загрузка журнала...' }); body.appendChild(more);
        Promise.all([W.rows('Работа наряда', o.id), W.rows('Материал наряда', o.id), W.rows('Событие наряда', o.id)]).then(function (r) {
            var h = '<h4>Чек-лист</h4>' + (r[0].length ? '<ul class="fsm-list">' + r[0].map(function (x) { return '<li>' + (W.bool(x['Выполнено']) ? '[x] ' : '[ ] ') + esc(x['Работа наряда']) + (x['Комментарий'] ? ' - ' + esc(x['Комментарий']) : '') + '</li>'; }).join('') + '</ul>' : '<p class="fsm-sub">Пока пуст.</p>');
            h += '<h4>Материалы</h4>' + (r[1].length ? '<ul class="fsm-list">' + r[1].map(function (x) { return '<li>' + esc(x['Материал наряда']) + ': ' + esc(x['Количество']) + ' ' + esc(x['Ед. изм']) + (x['Источник'] ? ' (' + esc(x['Источник']) + ')' : '') + '</li>'; }).join('') + '</ul>' : '<p class="fsm-sub">Нет.</p>');
            var ev = r[2].slice().sort(function (a, b) { return C.parseDt(a['Время']) - C.parseDt(b['Время']); });
            h += '<h4>Журнал событий</h4>' + (ev.length ? '<ul class="fsm-list fsm-disp-ev">' + ev.map(function (x) { return '<li><b>' + esc(C.fmtShort(C.parseDt(x['Время']))) + '</b> ' + esc(x['Событие наряда']) + (x['Комментарий'] ? ': ' + esc(x['Комментарий']) : '') + ' <span class="fsm-sub">' + esc(x['Автор']) + '</span></li>'; }).join('') + '</ul>' : '<p class="fsm-sub">Событий нет.</p>');
            more.innerHTML = h;
        }).catch(function (e) { more.textContent = 'Не удалось загрузить журнал: ' + (e && e.message || e); });
        var btns = [];
        if (o.status === 'Новый' || o.status === 'Назначен') btns.push({ text: 'Подобрать инженера', cls: 'fsm-primary', fn: function () { pickFor(o); } });
        if (canW() && o.status === 'Выполнен') btns.push({ text: 'Проверить и закрыть', cls: 'fsm-primary', fn: function (close) {
            act(function () { return W.setStatus(M, o, 'Закрыт', { 'Проверен': 1 }, 'Проверен диспетчером').then(function () { o.checked = true; }); }, 'Наряд ' + o.num + ' закрыт').then(function () { close(); refreshAll(); }, function () { });
            return false;
        } });
        if (canW() && C.isOpen(o)) btns.push({ text: 'Отменить наряд', cls: 'fsm-danger', fn: function () { cancelModal(o); } });
        btns.push({ text: 'Закрыть окно' });
        W.modal('Наряд ' + o.num, body, btns);
    }
    function cancelModal(o) {
        var ta = el('textarea', { rows: '3', placeholder: 'Причина отмены' });
        W.modal('Отменить наряд ' + o.num + '?', el('div', {}, [W.field('Причина (попадёт в журнал событий)', ta)]), [
            { text: 'Не отменять' },
            { text: 'Отменить наряд', cls: 'fsm-danger', fn: function (close) {
                if (!ta.value.trim()) { W.toast('Укажите причину отмены', true); return false; }
                act(function () { return W.setStatus(M, o, 'Отменён', {}, ta.value.trim()); }, 'Наряд ' + o.num + ' отменён').then(function () { close(); refreshAll(); }, function () { });
                return false;
            } }]);
    }
    function pickFor(o) { S.tab = 'assign'; S.sel = o.id; S.selReq = ''; S.off = offOf(o); drawTabs(); refreshAll(); }

    /* ---------- вкладка «Назначение» ---------- */
    function unassigned() {
        return M.orders.filter(function (o) { return o.status === 'Новый' && !o.eng; }).filter(function (o) {
            if (S.prio && o.prio !== S.prio) return false;
            return !S.q || (o.num + ' ' + o.obj + ' ' + o.client).toLowerCase().indexOf(S.q.toLowerCase()) >= 0;
        }).sort(sortCards);
    }
    function selOrder() { return M.orders.filter(function (o) { return o.id === S.sel; })[0] || null; }
    function selectOrder(o) { S.sel = o.id; S.selReq = ''; S.off = offOf(o); renderDays(); renderTiles(); renderContent(); }
    function rank(o) { return C.rankEngineers(o, M.ctx()); }
    function reassign(order, eng) {
        var was = order.eng;
        return W.post('_m_set/' + order.id + '?JSON', { fields: { 'Инженер': eng.id } }).then(function () { order.eng = eng.name; return W.addEvent(order, 'Переназначен', 'был: ' + was + ', стал: ' + eng.name); });
    }
    function reasonsHtml(r) {
        return '<ul class="fsm-disp-why">' + r.blockers.map(function (b) { return '<li class="fsm-disp-w-bad">' + esc(b) + '</li>'; }).join('') +
            r.reasons.map(function (x) { return '<li class="fsm-disp-w-' + (x.t === 'warn' ? 'warn' : 'ok') + '">' + esc(x.s) + '</li>'; }).join('') + '</ul>';
    }
    function doAssign(order, r) {
        function go(close) {
            var re = !!order.eng;
            act(function () { return re ? reassign(order, r.e) : W.assign(M, order, r.e); }, (re ? 'Переназначен: ' : 'Назначен: ') + order.num + ' - ' + r.e.name).then(function () { if (close) close(); S.sel = order.id; refreshAll(); }, function () { });
        }
        if (r.ok) return go();
        var body = el('div', {}, [el('p', { text: 'Инженер ' + r.e.name + ' не подходит для наряда ' + order.num + ':' }), el('div', { html: reasonsHtml({ blockers: r.blockers, reasons: [] }) }), el('p', { 'class': 'fsm-sub', text: 'Назначить всё равно?' })]);
        W.modal('Предупреждение', body, [{ text: 'Отмена' }, { text: 'Назначить всё равно', cls: 'fsm-danger', fn: function (close) { go(close); return false; } }]);
    }
    function renderAssign(host) {
        var list = unassigned(), reqs = M.requests.filter(reqPass), o = selOrder();
        if (!o && !S.selReq && list.length) { o = list[0]; S.sel = o.id; }
        var left = el('div', { 'class': 'fsm-disp-left' }, [el('h2', { text: 'Не назначены: ' + (list.length + reqs.length) })]);
        if (!list.length && !reqs.length) left.appendChild(el('div', { 'class': 'fsm-disp-empty', text: 'Неназначенных нарядов и заявок нет' }));
        list.forEach(function (x) { left.appendChild(orderCard(x, { drag: true, sel: o && o.id === x.id, onpick: selectOrder })); });
        if (reqs.length) left.appendChild(el('h3', { 'class': 'fsm-disp-h3', text: 'Заявки без наряда' }));
        reqs.forEach(function (q) { left.appendChild(reqCard(q)); });
        var center = el('div', { 'class': 'fsm-disp-center' }), mapBox = el('div', { 'class': 'fsm-disp-mapbox' }), rk = null, best = null;
        if (o) {
            rk = rank(o); best = rk.filter(function (r) { return r.ok; })[0] || null;
            center.appendChild(el('h2', { text: 'Подбор инженера: ' + o.num }));
            center.appendChild(el('div', { 'class': 'fsm-disp-sum', html: bd(o.prio, prioKind(o.prio)) + ' <b>' + esc(o.wt) + '</b>, ' + esc(addr(o)) + '. Окно ' + esc(winText(o)) + '. ' + slaHtml(o) }));
            if (o.eng) center.appendChild(el('div', { 'class': 'fsm-disp-assigned', text: 'Сейчас назначен: ' + o.eng + ' (статус «' + o.status + '»). Можно переназначить.' }));
            if (!best) center.appendChild(el('div', { 'class': 'fsm-disp-assigned fsm-disp-noeng', text: 'Подходящих инженеров нет. Можно назначить вручную с предупреждением.' }));
            var cols = [
                { t: '#', html: function (r) { return String(rk.indexOf(r) + 1); } },
                { t: 'Инженер', html: function (r) { return '<b>' + esc(r.eng) + '</b>' + (r === best ? ' ' + bd('Рекомендуется', 'info') : '') + '<div class="fsm-sub">' + esc(r.e.district || '') + '</div>'; } },
                { t: 'Оценка', html: function (r) { return bd(r.ok ? 'Подходит' : 'Не подходит', r.ok ? 'ok' : 'crit'); } },
                { t: 'Дорога', html: function (r) { return r.km ? C.fmtKm(r.km) + ' км<div class="fsm-sub">около ' + r.min + ' мин</div>' : '-'; } },
                { t: 'Нагрузка', html: function (r) { return r.count + ' из ' + r.max; } },
                { t: 'Почему', html: reasonsHtml },
                { t: '', html: function (r) { if (!canW()) return ''; if (o.eng === r.eng) return bd('Назначен', 'ok'); return '<button type="button" class="fsm-btn ' + (r.ok ? 'fsm-primary' : 'fsm-danger') + '" data-eng="' + esc(r.eng) + '">' + (r.ok ? 'Назначить' : 'Назначить всё равно') + '</button>'; } }
            ];
            var tbl = W.table(cols, rk, { rowCls: function (r) { return r.ok ? '' : 'fsm-disp-notok'; } });
            tbl.classList.add('fsm-disp-cand');
            tbl.addEventListener('click', function (e) {
                var b = e.target.closest && e.target.closest('button[data-eng]'); if (!b) return;
                var r = rk.filter(function (x) { return x.eng === b.getAttribute('data-eng'); })[0]; if (r) doAssign(o, r);
            });
            center.appendChild(tbl);
            if (!canW()) center.appendChild(el('p', { 'class': 'fsm-sub', text: 'Режим просмотра: назначать наряды может диспетчер.' }));
        } else if (S.selReq) {
            var q = M.requests.filter(function (x) { return x.id === S.selReq; })[0];
            center.appendChild(el('div', { 'class': 'fsm-disp-empty', text: q ? 'Заявка ' + q.num + ' ещё не превращена в наряд.' : 'Выберите наряд слева.' }));
        } else center.appendChild(el('div', { 'class': 'fsm-disp-empty', text: 'Выберите наряд слева, чтобы подобрать инженера.' }));
        var top = el('div', { 'class': 'fsm-disp-assign' }, [left, center, el('div', { 'class': 'fsm-disp-right' }, [el('h2', { text: 'Карта' }), mapBox])]);
        R.gantt = el('div', { 'class': 'fsm-disp-gantt' });
        host.appendChild(top);
        host.appendChild(el('h2', { text: 'Занятость инженеров на день, ' + C.fmtDate(dayMs()) }));
        host.appendChild(R.gantt);
        renderGantt(R.gantt);
        renderMap(mapBox, o, best);
    }

    /* ---------- занятость инженеров ---------- */
    function pct(ms, s0, span) { return Math.max(0, Math.min(100, (ms - s0) / span * 100)); }
    function renderGantt(box) {
        box.innerHTML = '';
        var d = dayMs(), s0 = d + 8 * HOUR, span = 12 * HOUR, now = W.now(), scale = el('div', { 'class': 'fsm-disp-gscale' });
        for (var h = 8; h <= 20; h += 2) scale.appendChild(el('span', { style: 'left:' + ((h - 8) / 12 * 100) + '%', text: (h < 10 ? '0' : '') + h + ':00' }));
        box.appendChild(el('div', { 'class': 'fsm-disp-glane' }, [el('div', {}), scale]));
        M.engineers.forEach(function (e) {
            var mine = M.orders.filter(function (o) { return o.eng === e.name && orderDay(o) === d && o.status !== 'Отменён'; });
            var track = el('div', { 'class': 'fsm-disp-gtrack' });
            for (var h = 9; h < 20; h++) track.appendChild(el('i', { 'class': 'fsm-disp-gtick', style: 'left:' + ((h - 8) / 12 * 100) + '%' }));
            mine.forEach(function (o) {
                var a = o.win0 || o.created, b = o.win1 || a + 2 * HOUR;
                if (b <= s0 || a >= s0 + span) return;
                var l = pct(a, s0, span), w = Math.max(2, pct(b, s0, span) - l);
                var blk = el('div', { 'class': 'fsm-disp-gblk', style: 'left:' + l + '%;width:' + w + '%;background:' + (ST_COLOR[o.status] || '#64748b'), title: o.num + ': ' + o.wt + ', ' + winText(o) + ', ' + o.status, text: o.num.replace(/^Н-/, '') });
                blk.onclick = function () { openOrder(o); };
                if (canW() && o.status === 'Назначен') {
                    blk.draggable = true;
                    blk.addEventListener('dragstart', function (ev) { dragId = o.id; try { ev.dataTransfer.setData('text/plain', o.id); ev.dataTransfer.effectAllowed = 'move'; } catch (x) { } });
                    blk.addEventListener('dragend', function () { dragId = ''; });
                }
                track.appendChild(blk);
            });
            if (d === C.dayStart(now) && now >= s0 && now <= s0 + span) track.appendChild(el('div', { 'class': 'fsm-disp-gnow', style: 'left:' + pct(now, s0, span) + '%', title: 'Сейчас ' + C.fmtTime(now) }));
            var lane = el('div', { 'class': 'fsm-disp-glane' + (e.works ? '' : ' fsm-disp-goff') }, [el('div', { 'class': 'fsm-disp-glabel' }, [el('b', { text: e.name }), el('span', { 'class': 'fsm-sub', text: e.works ? mine.length + ' из ' + e.max : 'не работает' })]), track]);
            if (canW()) {
                lane.addEventListener('dragover', function (ev) { if (dragId) { ev.preventDefault(); lane.classList.add('fsm-disp-gdrop'); } });
                lane.addEventListener('dragleave', function () { lane.classList.remove('fsm-disp-gdrop'); });
                lane.addEventListener('drop', function (ev) {
                    ev.preventDefault(); lane.classList.remove('fsm-disp-gdrop');
                    var o = M.orders.filter(function (x) { return x.id === dragId; })[0]; dragId = '';
                    if (!o || o.eng === e.name) return;
                    var r = rank(o).filter(function (x) { return x.eng === e.name; })[0]; if (r) doAssign(o, r);
                });
            }
            box.appendChild(lane);
        });
        var lg = el('div', { 'class': 'fsm-legend' });
        ['Назначен', 'В пути', 'На объекте', 'Ждёт запчасти', 'Выполнен', 'Закрыт'].forEach(function (s) { lg.appendChild(el('span', { html: '<i class="fsm-disp-dot" style="background:' + ST_COLOR[s] + '"></i>' + esc(s) })); });
        lg.appendChild(el('span', { 'class': 'fsm-disp-hint', text: canW() ? 'Перетащите неназначенный наряд на строку инженера (мышью); на сенсорном экране используйте кнопки выше.' : 'Режим просмотра' }));
        box.appendChild(lg);
    }

    /* ---------- карта ---------- */
    function loadLeaflet() {
        if (leafP) return leafP;
        leafP = new Promise(function (res, rej) {
            if (window.L && window.L.map) return res(window.L);
            var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css'; document.head.appendChild(l);
            var s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
            s.onload = function () { window.L && window.L.map ? res(window.L) : rej(new Error('leaflet')); }; s.onerror = function () { rej(new Error('leaflet')); };
            document.head.appendChild(s); setTimeout(function () { rej(new Error('timeout')); }, 9000);
        });
        leafP.catch(function () { leafP = null; });
        return leafP;
    }
    function orderColor(o) { return isLate(o) || o.prio === 'Аварийный' ? '#dc2626' : o.prio === 'Срочный' ? '#d97706' : '#2563eb'; }
    function engColor(e, n) { return !e.works ? '#94a3b8' : n >= e.max ? '#dc2626' : n >= e.max / 2 ? '#d97706' : '#16a34a'; }
    function mapPoints() {
        var d = dayMs(), os = [], es = [];
        M.orders.forEach(function (o) {
            var ob = M.objects[o.obj]; if (!ob || !ob.lat || orderDay(o) !== d || o.status === 'Закрыт' || o.status === 'Отменён') return;
            os.push({ o: o, lat: ob.lat, lon: ob.lon });
        });
        M.engineers.forEach(function (e) {
            if (!e.lat) return;
            var n = M.orders.filter(function (o) { return o.eng === e.name && orderDay(o) === d && C.isOpen(o); }).length;
            es.push({ e: e, lat: e.lat, lon: e.lon, n: n });
        });
        return { os: os, es: es };
    }
    function renderMap(box, sel, best) {
        if (mapInst) { try { mapInst.remove(); } catch (x) { } mapInst = null; }
        var P = mapPoints(), view = el('div', { 'class': 'fsm-disp-map' }); box.innerHTML = ''; box.appendChild(view);
        box.appendChild(el('div', { 'class': 'fsm-legend fsm-disp-maplg', html: '<span><i class="fsm-disp-dot" style="background:#dc2626"></i>аварийный или просрочен</span><span><i class="fsm-disp-dot" style="background:#d97706"></i>срочный</span><span><i class="fsm-disp-dot" style="background:#2563eb"></i>обычный</span><span>Инженеры: <i class="fsm-disp-dot" style="background:#16a34a"></i>свободен <i class="fsm-disp-dot" style="background:#d97706"></i>занят наполовину <i class="fsm-disp-dot" style="background:#dc2626"></i>загружен</span>' }));
        var selPt = sel && P.os.filter(function (x) { return x.o.id === sel.id; })[0];
        var bestPt = best && P.es.filter(function (x) { return x.e.name === best.eng; })[0];
        loadLeaflet().then(function (L) {
            if (!view.isConnected) return;
            var map = L.map(view, { scrollWheelZoom: false }).setView([55.79, 49.12], 11); mapInst = map;
            L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; OpenStreetMap' }).addTo(map);
            P.os.forEach(function (p) {
                var isSel = sel && p.o.id === sel.id;
                var ic = L.divIcon({ className: 'fsm-disp-pinw', html: '<div class="fsm-disp-pin' + (isSel ? ' fsm-disp-pin-sel' : '') + '" style="background:' + orderColor(p.o) + '"></div>', iconSize: [20, 20], iconAnchor: [10, 10] });
                L.marker([p.lat, p.lon], { icon: ic, zIndexOffset: isSel ? 1000 : 0, title: p.o.num }).addTo(map).bindTooltip(p.o.num + ' ' + p.o.wt).on('click', function () { selectOrder(p.o); });
            });
            P.es.forEach(function (p) {
                var ic = L.divIcon({ className: 'fsm-disp-pinw', html: '<div class="fsm-disp-eng" style="background:' + engColor(p.e, p.n) + '">' + esc(initials(p.e.name)) + '</div>', iconSize: [28, 28], iconAnchor: [14, 14] });
                L.marker([p.lat, p.lon], { icon: ic, zIndexOffset: 500, title: p.e.name }).addTo(map).bindTooltip(p.e.name + ', нарядов на день: ' + p.n);
            });
            if (selPt && bestPt) {
                L.polyline([[selPt.lat, selPt.lon], [bestPt.lat, bestPt.lon]], { color: '#2563eb', weight: 3, dashArray: '6 6' }).addTo(map).bindTooltip(C.fmtKm(best.km) + ' км', { permanent: true, direction: 'center', className: 'fsm-disp-linetip' });
                map.fitBounds([[selPt.lat, selPt.lon], [bestPt.lat, bestPt.lon]], { padding: [50, 50], maxZoom: 13 });
            } else if (selPt) map.setView([selPt.lat, selPt.lon], 12);
            setTimeout(function () { try { map.invalidateSize(); } catch (x) { } }, 250);
        }).catch(function () { if (view.isConnected) drawSvg(view, P, sel, selPt, bestPt, best); });
    }
    function drawSvg(view, P, sel, selPt, bestPt, best) {
        var all = P.os.concat(P.es); view.innerHTML = ''; view.classList.add('fsm-disp-svgmap');
        view.appendChild(el('div', { 'class': 'fsm-disp-svgnote', text: 'Карта недоступна, показана схема' }));
        if (!all.length) return;
        var la = all.map(function (p) { return p.lat; }), lo = all.map(function (p) { return p.lon; });
        var a0 = Math.min.apply(null, la), a1 = Math.max.apply(null, la), o0 = Math.min.apply(null, lo), o1 = Math.max.apply(null, lo), Wd = 600, Ht = 400, pad = 30;
        function X(lon) { return pad + (o1 === o0 ? .5 : (lon - o0) / (o1 - o0)) * (Wd - 2 * pad); }
        function Y(lat) { return Ht - pad - (a1 === a0 ? .5 : (lat - a0) / (a1 - a0)) * (Ht - 2 * pad); }
        var ns = 'http://www.w3.org/2000/svg';
        function n(t, at, txt) { var e = document.createElementNS(ns, t); Object.keys(at).forEach(function (k) { e.setAttribute(k, at[k]); }); if (txt) e.textContent = txt; return e; }
        var svg = n('svg', { viewBox: '0 0 ' + Wd + ' ' + Ht, 'class': 'fsm-disp-svg', role: 'img', 'aria-label': 'Схема объектов и инженеров' });
        svg.appendChild(n('rect', { x: 0, y: 0, width: Wd, height: Ht, fill: 'none', stroke: 'currentColor', 'stroke-opacity': '.2' }));
        if (selPt && bestPt) {
            svg.appendChild(n('line', { x1: X(selPt.lon), y1: Y(selPt.lat), x2: X(bestPt.lon), y2: Y(bestPt.lat), stroke: '#2563eb', 'stroke-width': 2, 'stroke-dasharray': '6 5' }));
            svg.appendChild(n('text', { x: (X(selPt.lon) + X(bestPt.lon)) / 2, y: (Y(selPt.lat) + Y(bestPt.lat)) / 2 - 4, 'text-anchor': 'middle', 'font-size': 12, fill: '#2563eb' }, C.fmtKm(best.km) + ' км'));
        }
        P.os.forEach(function (p) {
            var g = n('g', { style: 'cursor:pointer' }), isSel = sel && p.o.id === sel.id;
            g.appendChild(n('circle', { cx: X(p.lon), cy: Y(p.lat), r: isSel ? 9 : 6, fill: orderColor(p.o), stroke: isSel ? '#111' : '#fff', 'stroke-width': isSel ? 3 : 1 }));
            g.appendChild(n('title', {}, p.o.num + ' ' + p.o.wt));
            g.addEventListener('click', function () { selectOrder(p.o); }); svg.appendChild(g);
        });
        P.es.forEach(function (p) {
            var g = n('g', {}); g.appendChild(n('rect', { x: X(p.lon) - 11, y: Y(p.lat) - 11, width: 22, height: 22, rx: 11, fill: engColor(p.e, p.n) }));
            g.appendChild(n('text', { x: X(p.lon), y: Y(p.lat) + 4, 'text-anchor': 'middle', 'font-size': 10, fill: '#fff' }, initials(p.e.name))); g.appendChild(n('title', {}, p.e.name));
            svg.appendChild(g);
        });
        view.appendChild(svg);
    }

    /* ---------- создание наряда из заявки ---------- */
    function defaultWork(q) {
        var e = M.equipment[q.eq] || {}, map = [['чиллер', 'Ремонт чиллера'], ['прецизион', 'Диагностика и ремонт сплит-системы'], ['сплит', 'Диагностика и ремонт сплит-системы'], ['vrf', 'Диагностика и ремонт сплит-системы'],
            ['приточ', 'ТО приточной установки'], ['холодильн', 'Ремонт холодильной камеры'], ['камера', 'Ремонт холодильной камеры']];
        var srcs = [String(e.kind || '').toLowerCase(), String(q.eq || '').toLowerCase()];
        for (var s = 0; s < srcs.length; s++) for (var i = 0; i < map.length; i++) if (srcs[s].indexOf(map[i][0]) >= 0 && M.works[map[i][1]]) return map[i][1];
        return Object.keys(M.works)[0];
    }
    function nextNum() {
        var mx = 0; M.orders.forEach(function (o) { var m = /(\d+)$/.exec(o.num); if (m && +m[1] > mx) mx = +m[1]; });
        return 'Н-' + (mx + 1);
    }
    function loadContracts() {
        if (contracts) return Promise.resolve(contracts);
        return W.rows('Тип договора').then(function (r) { contracts = W.map(r, 'Тип договора'); return contracts; }).catch(function () { contracts = {}; return contracts; });
    }
    function dtVal(ms) { return C.toApi(ms).slice(0, 16).replace(' ', 'T'); }
    function createOrderModal(q) {
        loadContracts().then(function (ct) {
            var cl = M.clients[q.client] || {}, coef = ct[cl['Тип договора']] ? C.num(ct[cl['Тип договора']]['Коэффициент SLA']) || 1 : 1;
            var work = W.select(Object.keys(M.works), defaultWork(q)), prio = W.select(M.prios.map(function (p) { return p['Приоритет']; }), q.prio);
            var now = Math.ceil(W.now() / (5 * MIN)) * 5 * MIN;
            var w0 = el('input', { type: 'datetime-local', value: dtVal(now) }), w1 = el('input', { type: 'datetime-local', value: '' });
            var comment = el('textarea', { rows: '2', placeholder: 'Комментарий диспетчера (необязательно)' }), hint = el('div', { 'class': 'fsm-sub fsm-disp-hint2' }), touched = false;
            function fillEnd() { if (!touched) w1.value = dtVal(C.parseDt(w0.value) + Math.max((M.works[work.value] || { norm: 1 }).norm, 1) * HOUR); }
            function slaHint() {
                var p = M.prios.filter(function (x) { return x['Приоритет'] === prio.value; })[0] || {};
                var a = C.num(p['SLA прибытие, ч']) * coef, f = C.num(p['SLA завершение, ч']) * coef;
                hint.textContent = 'SLA: прибыть за ' + C.fmtDur(a * 60) + ', завершить за ' + C.fmtDur(f * 60) + (coef !== 1 ? ' (коэффициент договора ' + String(coef).replace('.', ',') + ')' : '');
            }
            w1.oninput = function () { touched = true; }; work.onchange = fillEnd; w0.onchange = fillEnd; prio.onchange = slaHint; fillEnd(); slaHint();
            var info = el('div', { 'class': 'fsm-disp-sum', html: '<b>' + esc(q.num) + '</b> ' + bd(q.prio, prioKind(q.prio)) + '<div>' + esc(q.client) + ', ' + esc((M.objects[q.obj] || {}).address || q.obj) + '</div><div class="fsm-sub">' + esc(q.eq) + ': ' + esc(q.text) + '</div>' });
            var body = el('div', {}, [info, W.field('Вид работ', work), W.field('Приоритет', prio), el('div', { 'class': 'fsm-disp-two' }, [W.field('Окно прибытия с', w0), W.field('Окно прибытия по', w1)]), hint, W.field('Комментарий', comment)]);
            W.modal('Создать наряд из заявки', body, [{ text: 'Отмена' }, { text: 'Создать наряд', cls: 'fsm-primary', fn: function (close) {
                var a0 = C.parseDt(w0.value), a1 = C.parseDt(w1.value);
                if (!a0 || !a1 || a1 <= a0) { W.toast('Проверьте окно прибытия', true); return false; }
                var p = M.prios.filter(function (x) { return x['Приоритет'] === prio.value; })[0] || {}, created = Math.floor(W.now() / MIN) * MIN, num = nextNum();
                var f = { 'Наряд': num, 'Заявка': q.num, 'Заказчик': q.client, 'Объект': q.obj, 'Оборудование': q.eq, 'Вид работ': work.value, 'Приоритет': prio.value, 'Статус': 'Новый', 'Создан': C.toApi(created),
                    'Окно с': C.toApi(a0), 'Окно по': C.toApi(a1), 'Прибыть до': C.toApi(created + C.num(p['SLA прибытие, ч']) * coef * HOUR), 'Завершить до': C.toApi(created + C.num(p['SLA завершение, ч']) * coef * HOUR), 'Неисправность': q.text };
                act(function () {
                    return W.post('_m_new/' + W.tid('Наряд') + '?JSON', { up: 1, fields: f }).then(function (j) {
                        var id = (Array.isArray(j) ? j[0] : j).id; if (!id) throw new Error('Сервер не вернул id наряда');
                        return W.post('_m_set/' + q.id + '?JSON', { fields: { 'Состояние заявки': 'В наряде' } }).then(function () { return W.addEvent({ id: id }, 'Создан', 'Из заявки ' + q.num + (comment.value.trim() ? '. ' + comment.value.trim() : '')); });
                    }).then(reload);
                }, 'Наряд ' + num + ' создан').then(function () {
                    close(); var o = M.orderBy[num]; if (o) { S.tab = 'assign'; S.sel = o.id; S.selReq = ''; S.off = offOf(o); }
                    drawTabs(); refreshAll();
                }, function () { });
                return false;
            } }]);
        });
    }

    /* ---------- каркас ---------- */
    function tabsEl() { return W.tabs([['board', 'Доска'], ['assign', 'Назначение']], S.tab, function (k) { S.tab = k; drawTabs(); renderContent(); }); }
    function drawTabs() { R.tabsHost.innerHTML = ''; R.tabsHost.appendChild(tabsEl()); }
    function renderContent() {
        if (mapInst) { try { mapInst.remove(); } catch (x) { } mapInst = null; }
        R.content.innerHTML = ''; R.gantt = null;
        if (S.tab === 'board') renderBoard(R.content); else renderAssign(R.content);
    }
    function refreshAll() { renderClock(); renderDays(); renderTiles(); renderContent(); }
    function tick(host) {
        if (!host.isConnected) { clearInterval(timer); return; }
        renderClock(); renderTiles();
        if (document.querySelector('.fsm-modal-back') || dragId) return;
        if (S.tab === 'board') { var b = R.content.querySelector('.fsm-disp-board'), x = b ? b.scrollLeft : 0; renderContent(); var nb = R.content.querySelector('.fsm-disp-board'); if (nb) nb.scrollLeft = x; }
        else if (R.gantt) renderGantt(R.gantt);
    }

    W.mount(function (host) {
        return W.load().then(function (m) {
            M = m; host.innerHTML = ''; host.classList.add('fsm-disp');
            R.head = el('div'); R.tabsHost = el('div'); R.content = el('div', { 'class': 'fsm-disp-content' });
            [R.head, R.tabsHost, R.content].forEach(function (x) { host.appendChild(x); });
            buildHead(R.head); drawTabs(); renderContent();
            clearInterval(timer); timer = setInterval(function () { tick(host); }, 30000);
        });
    });
})();
