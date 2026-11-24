/* FSM: мобильный экран инженера (телефон, одна колонка). Состояние держится в памяти, страница не перезагружается. Нужны fsm-core.js, fsm-app.js, fsm-model.js. */
(function () {
    'use strict';
    var W = window.Fsm, C = W.core, el = W.el, esc = W.esc;
    var S = { M: null, eng: null, day: 'today', view: 'list', oid: null, d: null, act: null, busy: false, timers: [], q: Promise.resolve() };
    var DAYMS = C.DAY;

    /* ---------- мелочи ---------- */
    function status2cls(s) { return W.STATUS_CLS[s] || 'info'; }
    function isClosed(o) { return o.status === 'Выполнен' || o.status === 'Закрыт'; }
    function isLive(o) { return o.status === 'В пути' || o.status === 'На объекте' || o.status === 'Ждёт запчасти'; }
    function money(x) { return Math.round(C.num(x)).toLocaleString('ru-RU').replace(/ /g, ' ') + ' ₽'; }
    function qty(x) { return String(C.round2(C.num(x))).replace('.', ','); }
    function html(tag, cls, inner) { return el(tag, { 'class': cls, html: inner }); }
    function digits(s) { return String(s || '').replace(/\D+/g, ''); }
    function stepOf(unit) { return /^(м|кг|л)$/i.test(String(unit || '').trim()) ? 0.5 : 1; }
    function fail(e) { W.toast('Ошибка записи: ' + (e && e.message || e), true); }
    function today0() { return C.dayStart(W.now()); }
    function orderDay(o) { return C.dayStart(o.win0 || o.created); }
    function href(a) { var m = /href="([^"]+)"/.exec(a || ''); return m ? m[1].replace(/&amp;/g, '&') : ''; }
    /* Записи в порядке очереди: каждая запись ждёт предыдущую, чтобы быстрые нажатия не обгоняли друг друга. */
    function queue(fn) {
        var p = S.q.then(fn); S.q = p.catch(function () { }); return p;
    }
    /* Файл в реквизит FILE: multipart _m_set/<id>?JSON с полем t<id реквизита> (W.post не умеет отправлять File). */
    function postFile(path, key, file) {
        var fd = new FormData(); fd.append('_xsrf', W.ctx.xsrf); fd.append(key, file, file.name);
        return fetch(W.url(path), { method: 'POST', body: fd, credentials: 'same-origin' }).then(function (r) { return r.json().catch(function () { return {}; }); }).then(function (j) {
            var e = Array.isArray(j) ? j[0] : j; if (e && e.error) throw new Error(e.error); return j;
        });
    }
    function reqId(table, name) {
        var t = W.metaBy[table], r = t && (t.reqs || []).filter(function (x) { return x.val === name; })[0];
        if (!r) throw new Error('Нет реквизита «' + name + '» в таблице «' + table + '»'); return r.id;
    }
    /* Прокрутка может быть у окна или у контейнера платформы: берём ближайший прокручиваемый родитель. */
    function scroller() {
        for (var n = root && root.parentElement; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
            var oy = getComputedStyle(n).overflowY;
            if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight + 1) return n;
        }
        return null;
    }
    function saveScroll() { var n = scroller(); return n ? n.scrollTop : (window.pageYOffset || 0); }
    function setScroll(y) { var n = scroller(); if (n) n.scrollTop = y; else window.scrollTo(0, y); if (!y) window.scrollTo(0, 0); }

    /* ---------- определение инженера и выбор нарядов ---------- */
    function detectEngineer(M) {
        var cnt = {}, best = '', n = 0;
        M.orders.forEach(function (o) { if (o.eng) cnt[o.eng] = (cnt[o.eng] || 0) + 1; });
        Object.keys(cnt).forEach(function (k) { if (cnt[k] > n) { n = cnt[k]; best = k; } });
        return M.engBy[best] || null;
    }
    function dayOrders() {
        var d0 = today0() + (S.day === 'tomorrow' ? DAYMS : 0), M = S.M;
        return M.orders.filter(function (o) {
            if (o.eng !== S.eng.name || o.status === 'Отменён') return false;
            var od = orderDay(o);
            if (S.day === 'tomorrow') return od === d0;
            return od === d0 || (od < d0 && C.isOpen(o));
        }).sort(function (a, b) { return (a.win0 || a.created) - (b.win0 || b.created); });
    }
    function actOf(o) { return S.M.acts.filter(function (a) { return a.order === o.num; })[0] || null; }
    function actBadge(a) {
        if (!a) return '';
        return a.refused ? W.badge('Акт без подписи: отказ', 'warn') : a.signedAt ? W.badge('Акт подписан', 'ok') : W.badge('Акт составлен', 'info');
    }
    function reload() {
        return W.load().then(function (M) { S.M = M; S.eng = M.engBy[S.eng.name] || S.eng; });
    }

    /* ---------- данные открытого наряда ---------- */
    function normCheck(r) { return { id: r._id, text: r['Работа наряда'], done: W.bool(r['Выполнено']) }; }
    function normMat(r) { return { id: r._id, name: r['Материал наряда'], qty: C.num(r['Количество']), unit: r['Ед. изм'], price: C.num(r['Цена']), src: r['Источник'] }; }
    function normPhoto(r) { return { id: r._id, name: r['Фото наряда'], stage: r['Этап'], url: href(r['Файл']), at: C.parseDt(r['Снято']) }; }
    function ensureChecklist(o, rows) {
        var wt = S.M.works[o.wt], list = wt ? wt.list : [];
        if (rows.length || !list.length || !C.isOpen(o)) return Promise.resolve(rows);
        var out = [], p = Promise.resolve();
        list.forEach(function (t) {
            p = p.then(function () {
                return W.post('_m_new/' + W.tid('Работа наряда') + '?JSON', { up: o.id, fields: { 'Работа наряда': t } }).then(function (j) { out.push({ id: String(j.id || j.obj), text: t, done: false }); });
            });
        });
        return p.then(function () { return out; });
    }
    function loadOrder(o) {
        var eng = S.eng;
        return Promise.all([W.rows('Работа наряда', o.id), W.rows('Материал наряда', o.id), W.rows('Фото наряда', o.id), W.rows('Остаток в машине', eng.id), W.rows('Событие наряда', o.id)]).then(function (r) {
            return ensureChecklist(o, r[0].map(normCheck)).then(function (checks) {
                var stock = r[3].map(function (x) { return { id: x._id, name: x['Остаток в машине'], qty: C.num(x['Количество']), min: C.num(x['Минимум']) }; });
                return { checks: checks, mats: r[1].map(normMat), photos: r[2].map(normPhoto), stock: stock, events: r[4] };
            });
        });
    }
    function openOrder(o, push) {
        S.busy = true; S.oid = o.id; S.view = 'order'; render(0);
        loadOrder(o).then(function (d) {
            S.d = d; S.busy = false; if (S.oid !== o.id) return;
            if (push !== false) { try { history.pushState({ fsmOrder: o.id }, ''); } catch (e) { } }
            render(0);
        }).catch(function (e) { S.busy = false; S.view = 'list'; render(0); fail(e); });
    }
    function curOrder() { return S.M.orders.filter(function (o) { return o.id === S.oid; })[0]; }
    function toList() { S.view = 'list'; S.oid = null; S.d = null; S.act = null; render(0); }

    /* ---------- каркас ---------- */
    var root = null;
    function badges(o) {
        var ob = S.M.objects[o.obj] || {}, out = '';
        out += W.badge(o.prio, o.prio === 'Аварийный' ? 'crit' : o.prio === 'Срочный' ? 'warn' : 'info');
        if (ob.nosig) out += ' ' + W.badge('Нет связи на объекте', 'warn');
        if (ob.pass) out += ' ' + W.badge('Пропуск', 'info');
        if (o.warranty) out += ' ' + W.badge('Гарантия', 'ok');
        if (o.repeat) out += ' ' + W.badge('Повторный', 'crit');
        return out;
    }
    function slaEl(o) {
        var s = el('span', { 'class': 'fsm-eng-sla' });
        function upd() {
            var st = C.slaState(o, W.now(), W.opts), k = { ok: 'ok', risk: 'warn', late: 'crit', met: 'ok', missed: 'crit', none: 'info' }[st.state];
            var pre = st.stage === 'arrive' ? 'Прибыть: ' : st.stage === 'finish' ? 'Завершить: ' : '';
            s.innerHTML = W.badge(pre + st.text, k);
        }
        upd(); S.timers.push(upd); return s;
    }
    function render(scroll) {
        S.timers = [];
        root.innerHTML = '';
        if (S.view === 'list') root.appendChild(renderList());
        else if (S.view === 'order') root.appendChild(renderOrder());
        else if (S.view === 'act') root.appendChild(renderAct());
        else root.appendChild(renderDone());
        setScroll(scroll === undefined ? saveScroll() : scroll);
    }
    function redraw() { var y = saveScroll(); render(y); }

    /* ---------- список нарядов ---------- */
    function card(o) {
        var ob = S.M.objects[o.obj] || {}, a = actOf(o);
        var c = el('button', { type: 'button', 'class': 'fsm-eng-card fsm-eng-st-' + status2cls(o.status) + (isLive(o) ? ' fsm-eng-live' : '') + (isClosed(o) ? ' fsm-eng-closed' : ''), onclick: function () { openOrder(o); } });
        var win = o.win0 && o.win1 ? C.fmtTime(o.win0) + '–' + C.fmtTime(o.win1) : C.fmtTime(o.created);
        var od = orderDay(o), dnote = od < today0() ? ' (' + C.fmtShort(o.win0).slice(0, 5) + ')' : '';
        c.appendChild(html('div', 'fsm-eng-card-top', '<span class="fsm-eng-time">' + esc(win + dnote) + '</span>' + W.badge(o.status, status2cls(o.status))));
        c.appendChild(el('div', { 'class': 'fsm-eng-wt', text: o.wt }));
        c.appendChild(el('div', { 'class': 'fsm-eng-obj', text: ob.name || o.obj }));
        c.appendChild(el('div', { 'class': 'fsm-eng-addr', text: ob.address || '' }));
        var tags = el('div', { 'class': 'fsm-eng-tags' }); tags.innerHTML = badges(o) + (a ? ' ' + actBadge(a) : '');
        c.appendChild(tags);
        c.appendChild(el('div', { 'class': 'fsm-eng-slaline' }, [el('span', { text: o.num + '  ' }), slaEl(o)]));
        return c;
    }
    function nw(n, f) { var a = Math.abs(n) % 100, b = a % 10; return a > 10 && a < 20 ? f[2] : b > 1 && b < 5 ? f[1] : b === 1 ? f[0] : f[2]; }
    function renderList() {
        var e = S.eng, list = dayOrders(), closed = list.filter(isClosed).length, bx = el('div', { 'class': 'fsm-eng-wrap' });
        var d0 = today0() + (S.day === 'tomorrow' ? DAYMS : 0);
        var head = el('header', { 'class': 'fsm-eng-head' });
        head.appendChild(el('div', { 'class': 'fsm-eng-name', text: e.name }));
        head.appendChild(el('div', { 'class': 'fsm-eng-shift', text: 'Смена ' + (e.from || '') + '–' + (e.to || '') + (e.car ? ' · ' + e.car : '') }));
        head.appendChild(html('div', 'fsm-eng-stats', '<span><b>' + list.length + '</b> ' + nw(list.length, ['наряд', 'наряда', 'нарядов']) + '</span><span><b>' + closed + '</b> закрыто</span>'));
        bx.appendChild(head);
        bx.appendChild(el('div', { 'class': 'fsm-eng-seg', role: 'tablist' }, [['today', 'Сегодня'], ['tomorrow', 'Завтра']].map(function (p) {
            return el('button', { type: 'button', role: 'tab', 'aria-selected': S.day === p[0] ? 'true' : 'false', 'class': 'fsm-eng-segb' + (S.day === p[0] ? ' fsm-eng-segon' : ''), onclick: function () { S.day = p[0]; render(0); }, text: p[1] });
        })));
        bx.appendChild(el('div', { 'class': 'fsm-eng-date', text: (S.day === 'today' ? 'Мои наряды на сегодня' : 'Мои наряды на завтра') + ', ' + C.fmtDate(d0) }));
        var live = list.filter(isLive), rest = list.filter(function (o) { return !isLive(o); });
        if (live.length) { bx.appendChild(el('div', { 'class': 'fsm-eng-sec', text: 'Сейчас в работе' })); live.forEach(function (o) { bx.appendChild(card(o)); }); }
        if (rest.length) { if (live.length) bx.appendChild(el('div', { 'class': 'fsm-eng-sec', text: 'По времени' })); rest.forEach(function (o) { bx.appendChild(card(o)); }); }
        if (!list.length) bx.appendChild(el('div', { 'class': 'fsm-eng-empty', text: 'На этот день нарядов нет' }));
        return bx;
    }

    /* ---------- карточка наряда ---------- */
    function box(title, inner, cls) {
        var b = el('section', { 'class': 'fsm-eng-box ' + (cls || '') });
        if (title) b.appendChild(el('h2', { text: title }));
        [].concat(inner).forEach(function (n) { if (n) b.appendChild(typeof n === 'string' ? html('div', '', n) : n); });
        return b;
    }
    function kv(k, v) { return '<div class="fsm-eng-kv"><span>' + esc(k) + '</span><span>' + v + '</span></div>'; }
    function topbar(title, back) {
        return el('div', { 'class': 'fsm-eng-top' }, [el('button', { type: 'button', 'class': 'fsm-eng-back', 'aria-label': 'Назад', onclick: back, text: '←' }), el('span', { 'class': 'fsm-eng-toptitle', text: title })]);
    }
    function renderOrder() {
        var o = curOrder(), wrap = el('div', { 'class': 'fsm-eng-wrap fsm-eng-withbar' });
        wrap.appendChild(topbar('Мои наряды', toList));
        if (!o) { wrap.appendChild(el('div', { 'class': 'fsm-eng-empty', text: 'Наряд не найден' })); return wrap; }
        var M = S.M, ob = M.objects[o.obj] || {}, cl = M.clients[o.client] || {}, eq = M.equipment[o.eq] || {}, d = S.d, act = actOf(o), now = W.now();
        var h = el('div', { 'class': 'fsm-eng-oh' });
        h.appendChild(html('div', 'fsm-eng-num', esc(o.num) + ' ' + W.badge(o.status, status2cls(o.status))));
        h.appendChild(html('div', 'fsm-eng-tags', badges(o)));
        h.appendChild(el('div', { 'class': 'fsm-eng-slaline' }, [slaEl(o)]));
        if (o.win0) h.appendChild(el('div', { 'class': 'fsm-eng-muted', text: 'Окно ' + C.fmtShort(o.win0) + '–' + C.fmtTime(o.win1) }));
        wrap.appendChild(h);
        if (!d) { wrap.appendChild(el('div', { 'class': 'fsm-eng-empty', text: 'Загрузка наряда...' })); return wrap; }

        /* заказчик */
        var phone = cl['Телефон'] || '', route = ob.lat ? 'https://yandex.ru/maps/?rtext=~' + ob.lat + ',' + ob.lon + '&rtt=auto' : '';
        var cb = box('Заказчик', [
            html('div', 'fsm-eng-big', esc(o.client)),
            kv('Контакт', esc(cl['Контактное лицо'] || '—')),
            phone ? '<a class="fsm-eng-link fsm-eng-tel" href="tel:' + esc(phone.replace(/[^\d+]/g, '')) + '">Позвонить ' + esc(phone) + '</a>' : '',
            kv('Объект', esc(o.obj)), kv('Адрес', esc(ob.address || '—')),
            ob.how ? kv('Как пройти', esc(ob.how)) : '', ob.onsite ? kv('Контакт на объекте', esc(ob.onsite)) : '',
            ob.pass ? '<div class="fsm-eng-note fsm-eng-note-info">Нужен пропуск</div>' : '',
            ob.nosig ? '<div class="fsm-eng-note fsm-eng-note-warn">Нет связи на объекте: фото и акт загрузятся, когда появится сеть</div>' : '',
            route ? '<a class="fsm-eng-link fsm-eng-route" target="_blank" rel="noopener" href="' + esc(route) + '">Маршрут в Яндекс Картах</a>' : ''
        ]);
        wrap.appendChild(cb);
        wrap.appendChild(box('Неисправность', [html('div', 'fsm-eng-fault', esc(o.fault || '—')), kv('Вид работ', esc(o.wt)), kv('Нормо-часов', esc(qty((M.works[o.wt] || {}).norm || 0)))]));

        /* оборудование и история ремонтов */
        var ws = C.warrantyState(eq.warr, now), hist = C.equipHistory(M.orders, o.eq, o.id, 5), rec = C.recentVisits(M.orders, o.eq, o.id, now, 30);
        var eb = box('Оборудование', [
            html('div', 'fsm-eng-big', esc(o.eq)), kv('Модель', esc(eq.model || '—')), kv('Серийный №', esc(eq.serial || '—')),
            kv('Установлено', esc(eq.inst ? C.fmtDate(C.parseDt(eq.inst)) : '—')),
            kv('Гарантия', '<span class="fsm-eng-warr fsm-eng-warr-' + ws.state + '">' + esc(ws.text) + '</span>')
        ]);
        if (rec.length || o.repeat) {
            var l = rec[0];
            eb.appendChild(html('div', 'fsm-eng-note fsm-eng-note-crit', '<b>Повторный выезд.</b> ' + (rec.length ? 'За последние 30 дней по этому оборудованию было выездов: ' + rec.length + ', последний ' + esc(C.fmtDate(l.fin || l.arr || l.dep)) + ' («' + esc(l.wt) + '»). ' : '') + 'Сверьтесь с историей ниже: что делали в прошлый раз и не повторяется ли причина.'));
        }
        eb.appendChild(el('h3', { text: 'История ремонтов' }));
        if (!hist.length) eb.appendChild(el('div', { 'class': 'fsm-eng-muted', text: 'Других нарядов по этому оборудованию нет' }));
        hist.forEach(function (x) {
            var res = isClosed(x) ? x.status + ', ' + C.slaState(x, now, W.opts).text : x.status;
            eb.appendChild(html('div', 'fsm-eng-hist', '<div><b>' + esc(C.fmtDate(x.fin || x.arr || x.win0 || x.created)) + '</b> ' + esc(x.num) + (x.repeat ? ' ' + W.badge('Повторный', 'crit') : '') + '</div><div>' + esc(x.wt) + '</div><div class="fsm-eng-muted">' + esc(x.eng || 'без инженера') + ' · ' + esc(res) + '</div>'));
        });
        wrap.appendChild(eb);
        wrap.appendChild(checkBox(o));
        wrap.appendChild(photoBox(o));
        wrap.appendChild(matBox(o, !!act));
        if (act) wrap.appendChild(actBox(act));
        wrap.appendChild(actionBar(o, act));
        return wrap;
    }

    /* ---------- чек-лист ---------- */
    function isPhotoItem(c) { return /^Фото/i.test(c.text || '') && /до/i.test(c.text || ''); }
    function checkBox(o) {
        var d = S.d, pr = C.checkProgress(d.checks), editable = !isClosed(o);
        var b = box('Чек-лист работ', [html('div', 'fsm-eng-prog', '<div class="fsm-eng-bar"><i style="width:' + pr.pct + '%"></i></div><span>' + pr.done + ' из ' + pr.total + '</span>')]);
        if (!d.checks.length) b.appendChild(el('div', { 'class': 'fsm-eng-muted', text: 'Для этого вида работ чек-лист не задан' }));
        d.checks.forEach(function (c) {
            var auto = isPhotoItem(c);
            b.appendChild(el('button', { type: 'button', 'class': 'fsm-eng-check' + (c.done ? ' fsm-eng-checked' : ''), 'aria-pressed': c.done ? 'true' : 'false', disabled: !editable || auto ? 'disabled' : undefined, onclick: function () { toggleCheck(c); } }, [
                el('i', { 'class': 'fsm-eng-cbx', text: c.done ? '✓' : '' }), el('span', { text: c.text + (auto ? ' (отмечается по загрузке фото)' : '') })]));
        });
        return b;
    }
    function writeCheck(c, done) {
        return queue(function () { return W.post('_m_set/' + c.id + '?JSON', { fields: { 'Выполнено': done ? 1 : '' } }); });
    }
    function toggleCheck(c) {
        c.done = !c.done; redraw();
        writeCheck(c, c.done).catch(function (e) { c.done = !c.done; redraw(); fail(e); });
    }
    /* Пункт «Фото до и после» отмечается автоматически, когда есть оба фото. */
    function syncPhotoItem() {
        var d = S.d, has = function (s) { return d.photos.some(function (p) { return p.stage === s; }); }, want = has('до') && has('после');
        return Promise.all(d.checks.filter(isPhotoItem).map(function (c) {
            if (c.done === want) return null; c.done = want; return writeCheck(c, want);
        }));
    }

    /* ---------- фото ---------- */
    /* Уменьшение на canvas: ширина до 1600 px, JPEG 0.8. */
    function resizeImage(file, name) {
        function fromSrc(src, w, h) {
            var k = Math.min(1, 1600 / w), cv = document.createElement('canvas'); cv.width = Math.round(w * k); cv.height = Math.round(h * k);
            cv.getContext('2d').drawImage(src, 0, 0, cv.width, cv.height);
            return new Promise(function (res, rej) { cv.toBlob(function (b) { b ? res(new File([b], name, { type: 'image/jpeg' })) : rej(new Error('Не удалось уменьшить фото')); }, 'image/jpeg', 0.8); });
        }
        if (window.createImageBitmap) return createImageBitmap(file).then(function (bm) { return fromSrc(bm, bm.width, bm.height); });
        return new Promise(function (res, rej) {
            var u = URL.createObjectURL(file), im = new Image();
            im.onload = function () { fromSrc(im, im.naturalWidth, im.naturalHeight).then(res, rej); URL.revokeObjectURL(u); };
            im.onerror = function () { rej(new Error('Файл не похож на изображение')); }; im.src = u;
        });
    }
    function addPhoto(o, stage, file) {
        var d = S.d, n = d.photos.filter(function (p) { return p.stage === stage; }).length + 1, label = stage + ' ' + n, id = null;
        S.upload = stage; redraw();
        return resizeImage(file, stage + '-' + n + '.jpg').then(function (jpg) {
            return queue(function () {
                return W.post('_m_new/' + W.tid('Фото наряда') + '?JSON', { up: o.id, fields: { 'Фото наряда': label, 'Этап': stage, 'Снято': C.toApi(W.now()) } }).then(function (j) {
                    id = String(j.id || j.obj);
                    return postFile('_m_set/' + id + '?JSON', 't' + reqId('Фото наряда', 'Файл'), jpg);
                }).catch(function (e) { if (id) W.post('_m_del/' + id + '?JSON', {}).catch(function () { }); throw e; });
            });
        }).then(function () { return W.rows('Фото наряда', o.id); }).then(function (rows) {
            d.photos = rows.map(normPhoto); return syncPhotoItem();
        }).then(function () { S.upload = null; redraw(); W.toast('Фото загружено'); }).catch(function (e) { S.upload = null; redraw(); fail(e); });
    }
    function delPhoto(o, p) {
        var d = S.d; d.photos = d.photos.filter(function (x) { return x !== p; }); redraw();
        queue(function () { return W.post('_m_del/' + p.id + '?JSON', {}); }).then(syncPhotoItem).then(redraw).catch(function (e) { fail(e); W.rows('Фото наряда', o.id).then(function (r) { d.photos = r.map(normPhoto); redraw(); }); });
    }
    function photoBtn(o, stage, title) {
        var inp = el('input', { type: 'file', accept: 'image/*', capture: 'environment', 'class': 'fsm-eng-file', 'data-stage': stage, onchange: function () {
            var f = inp.files && inp.files[0]; if (f) addPhoto(o, stage, f);
        } });
        var lab = el('label', { 'class': 'fsm-eng-photobtn' + (S.upload ? ' fsm-eng-dis' : '') }, [el('span', { text: title }), inp]);
        if (S.upload) inp.disabled = true;
        return lab;
    }
    function photoBox(o) {
        var d = S.d, b = box('Фото', []), editable = !isClosed(o);
        if (editable) b.appendChild(el('div', { 'class': 'fsm-eng-photobtns' }, [photoBtn(o, 'до', 'Фото до'), photoBtn(o, 'после', 'Фото после')]));
        if (S.upload) b.appendChild(el('div', { 'class': 'fsm-eng-muted', text: 'Загрузка фото «' + S.upload + '»...' }));
        if (!d.photos.length) b.appendChild(el('div', { 'class': 'fsm-eng-muted', text: 'Фото пока нет' }));
        var g = el('div', { 'class': 'fsm-eng-thumbs' });
        d.photos.forEach(function (p) {
            var t = el('figure', { 'class': 'fsm-eng-thumb' });
            t.appendChild(p.url ? el('a', { href: p.url, target: '_blank', rel: 'noopener' }, [el('img', { src: p.url, alt: p.name, loading: 'lazy' })]) : el('div', { 'class': 'fsm-eng-nofile', text: 'нет файла' }));
            t.appendChild(el('figcaption', { text: p.name }));
            if (editable) t.appendChild(el('button', { type: 'button', 'class': 'fsm-eng-del', onclick: function () { delPhoto(o, p); }, text: 'Удалить' }));
            g.appendChild(t);
        });
        b.appendChild(g);
        return b;
    }

    /* ---------- материалы ---------- */
    function stockMats() { return S.d.mats.filter(function (m) { return (!m.src || m.src === 'Склад в машине') && m.qty > 0; }); }
    function syncMat(m) {
        return queue(function () {
            var f = { 'Количество': String(C.round2(m.qty)) };
            if (m.qty <= 0) { if (m.id) { var id = m.id; m.id = null; return W.post('_m_del/' + id + '?JSON', {}); } return null; }
            if (m.id) return W.post('_m_set/' + m.id + '?JSON', { fields: f });
            return W.post('_m_new/' + W.tid('Материал наряда') + '?JSON', { up: S.oid, fields: { 'Материал наряда': m.name, 'Количество': f['Количество'], 'Ед. изм': m.unit, 'Цена': String(m.price), 'Источник': 'Склад в машине' } }).then(function (j) { m.id = String(j.id || j.obj); });
        });
    }
    function bump(item, delta) {
        var d = S.d, nm = S.M.nomen[item.name] || {}, unit = nm.unit || 'шт', m = stockMats().filter(function (x) { return x.name === item.name; })[0];
        var cur = m ? m.qty : 0, nq = C.round2(cur + delta);
        if (nq < 0) return;
        if (nq > item.qty0 + 1e-9) { W.toast('Нельзя списать больше остатка: в машине ' + qty(item.qty0) + ' ' + unit, true); return; }
        if (!m) { m = { id: null, name: item.name, qty: 0, unit: unit, price: nm.price || 0, src: 'Склад в машине' }; d.mats.push(m); }
        m.qty = nq; if (nq <= 0 && !m.id) d.mats = d.mats.filter(function (x) { return x !== m; });
        redraw();
        syncMat(m).then(function () { if (m.qty <= 0) d.mats = d.mats.filter(function (x) { return x !== m; }); }).catch(fail);
    }
    function matBox(o, applied) {
        var d = S.d, editable = !isClosed(o), b = box('Материалы', []);
        var after = applied ? d.stock.map(function (s) { return { name: s.name, qty: s.qty, min: s.min, used: 0, low: s.qty < s.min, id: s.id }; }) : C.stockAfter(d.stock, d.mats);
        if (editable && !applied) {
            b.appendChild(el('h3', { text: 'Склад в машине' }));
            d.stock.forEach(function (s, i) {
                var a = after[i], nm = S.M.nomen[s.name] || {}, unit = nm.unit || 'шт', st = stepOf(unit), m = stockMats().filter(function (x) { return x.name === s.name; })[0];
                var item = { name: s.name, qty0: s.qty };
                var row = el('div', { 'class': 'fsm-eng-stock' + (a.low ? ' fsm-eng-lowrow' : '') });
                row.appendChild(html('div', 'fsm-eng-stock-n', '<b>' + esc(s.name) + '</b><span class="fsm-eng-muted">остаток ' + esc(qty(a.qty)) + ' ' + esc(unit) + ' (мин. ' + esc(qty(s.min)) + ')</span>' + (a.low ? ' ' + W.badge('Ниже минимума', 'warn') : '')));
                row.appendChild(el('div', { 'class': 'fsm-eng-stepper' }, [
                    el('button', { type: 'button', 'aria-label': 'Меньше', disabled: !m ? 'disabled' : undefined, onclick: function () { bump(item, -st); }, text: '−' }),
                    el('span', { 'class': 'fsm-eng-stepval', text: m ? qty(m.qty) : '0' }),
                    el('button', { type: 'button', 'aria-label': 'Больше', onclick: function () { bump(item, st); }, text: '+' })]));
                b.appendChild(row);
            });
        }
        b.appendChild(el('h3', { text: 'Списано по наряду' }));
        var shown = d.mats.filter(function (m) { return m.qty > 0; });
        if (!shown.length) b.appendChild(el('div', { 'class': 'fsm-eng-muted', text: 'Материалы не списаны' }));
        var tot = 0;
        shown.forEach(function (m) {
            var sum = C.matSum(m); tot += sum;
            b.appendChild(html('div', 'fsm-eng-matrow', '<span>' + esc(m.name) + '<small>' + esc(m.src || '') + '</small></span><span>' + esc(qty(m.qty)) + ' ' + esc(m.unit) + ' × ' + esc(money(m.price)) + ' = <b>' + esc(money(sum)) + '</b></span>'));
        });
        if (shown.length) b.appendChild(html('div', 'fsm-eng-mattot', 'Материалы: <b>' + esc(money(tot)) + '</b>'));
        if (applied) b.appendChild(el('div', { 'class': 'fsm-eng-muted', text: 'Остатки в машине уже уменьшены при оформлении акта' }));
        return b;
    }

    /* ---------- акт: блок в карточке и нижняя панель ---------- */
    function actBox(a) {
        var b = box('Акт', [html('div', 'fsm-eng-big', esc(a.num) + ' ' + actBadge(a)), kv('Составлен', esc(C.fmtDt(a.created))), kv('Итого', '<b>' + esc(money(a.total)) + '</b>')]);
        if (a.refused) b.appendChild(el('div', { 'class': 'fsm-eng-note fsm-eng-note-warn', text: 'Причина: ' + (a.refuseWhy || '—') }));
        else if (a.signer) b.appendChild(el('div', { 'class': 'fsm-eng-muted', text: 'Подписал: ' + a.signer + (a.role ? ', ' + a.role : '') }));
        b.appendChild(el('a', { 'class': 'fsm-eng-link fsm-eng-route', href: W.url('act?id=' + a.id), text: 'Открыть акт для печати' }));
        return b;
    }
    function setSt(o, status, extra, comment) {
        if (S.busy) return; S.busy = true;
        var f = {}; Object.keys(extra || {}).forEach(function (k) { f[k] = extra[k]; });
        W.setStatus(S.M, o, status, f, comment).then(function () {
            if (f['Выехал']) o.dep = C.parseDt(f['Выехал']); if (f['Прибыл']) o.arr = C.parseDt(f['Прибыл']);
            S.busy = false; redraw();
        }).catch(function (e) { S.busy = false; fail(e); });
    }
    function waitPart(o) {
        var ta = el('textarea', { rows: 3, placeholder: 'Какая запчасть нужна, артикул, срок', 'class': 'fsm-eng-ta' });
        W.modal('Жду запчасть', W.field('Комментарий (обязательно)', ta), [{ text: 'Отмена' }, { text: 'Сохранить', cls: 'fsm-primary', fn: function () {
            var t = ta.value.trim(); if (!t) { ta.focus(); W.toast('Укажите, какая запчасть нужна', true); return false; }
            setSt(o, 'Ждёт запчасти', {}, t);
        } }]);
    }
    function actionBar(o, act) {
        var bar = el('div', { 'class': 'fsm-eng-bar2' }), inner = el('div', { 'class': 'fsm-eng-bar2in' }); bar.appendChild(inner);
        var next = C.nextStatus(o.status), dis = S.busy ? 'disabled' : undefined;
        function big(text, fn, cls) { inner.appendChild(el('button', { type: 'button', 'class': 'fsm-eng-bigbtn ' + (cls || ''), disabled: dis, onclick: fn, text: text })); }
        if (isClosed(o) || o.status === 'Отменён') {
            if (act) inner.appendChild(el('a', { 'class': 'fsm-eng-bigbtn fsm-eng-primary', href: W.url('act?id=' + act.id), text: 'Открыть акт для печати' }));
            else inner.appendChild(el('div', { 'class': 'fsm-eng-muted', text: 'Наряд закрыт' }));
            inner.appendChild(el('button', { type: 'button', 'class': 'fsm-eng-bigbtn', onclick: toList, text: 'К списку нарядов' }));
        } else if (o.status === 'Назначен') big('Выехал', function () { setSt(o, 'В пути', { 'Выехал': C.toApi(W.now()) }, ''); }, 'fsm-eng-primary');
        else if (o.status === 'В пути') big('Прибыл на объект', function () { setSt(o, 'На объекте', { 'Прибыл': C.toApi(W.now()) }, ''); }, 'fsm-eng-primary');
        else if (o.status === 'Ждёт запчасти') big('Возобновить работу', function () { setSt(o, next || 'На объекте', {}, 'Запчасть получена'); }, 'fsm-eng-primary');
        else if (o.status === 'На объекте') {
            if (act) inner.appendChild(el('div', { 'class': 'fsm-eng-muted', text: 'Акт уже оформлен' }));
            else { big('Оформить акт', function () { S.view = 'act'; S.act = null; render(0); }, 'fsm-eng-primary'); big('Жду запчасть', function () { waitPart(o); }, 'fsm-eng-second'); }
        } else inner.appendChild(el('div', { 'class': 'fsm-eng-muted', text: 'Нет действий для статуса «' + o.status + '»' }));
        return bar;
    }

    /* ---------- подпись на canvas ---------- */
    function sigPad() {
        var wrap = el('div', { 'class': 'fsm-eng-sigwrap' }), cv = el('canvas', { 'class': 'fsm-eng-sig', 'aria-label': 'Поле подписи' }), ctx = cv.getContext('2d');
        var st = { ink: false, w: 3, down: false, x: 0, y: 0, ready: false };
        function size() {
            var r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
            if (!r.width) return false;
            cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0b1f4d'; st.ready = true; return true;
        }
        (function wait() { if (!size()) requestAnimationFrame(wait); })();
        function pt(e) { var r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
        cv.addEventListener('pointerdown', function (e) {
            if (!st.ready && !size()) return;
            e.preventDefault(); try { cv.setPointerCapture(e.pointerId); } catch (x) { }
            var p = pt(e); st.down = true; st.x = p.x; st.y = p.y; ctx.lineWidth = st.w; ctx.beginPath(); ctx.arc(p.x, p.y, st.w / 2, 0, 6.2832); ctx.fillStyle = '#0b1f4d'; ctx.fill(); st.ink = true; hint.style.display = 'none';
        });
        cv.addEventListener('pointermove', function (e) {
            if (!st.down) return; e.preventDefault();
            var p = pt(e); ctx.lineWidth = st.w; ctx.beginPath(); ctx.moveTo(st.x, st.y); ctx.quadraticCurveTo(st.x, st.y, (st.x + p.x) / 2, (st.y + p.y) / 2); ctx.lineTo(p.x, p.y); ctx.stroke(); st.x = p.x; st.y = p.y;
        });
        function up() { st.down = false; }
        cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up); cv.addEventListener('pointerleave', up);
        var hint = el('div', { 'class': 'fsm-eng-sighint', text: 'Подпись клиента' });
        var widths = [[2, 'Тонкая'], [3, 'Средняя'], [5, 'Толстая']], wb = widths.map(function (w) {
            return el('button', { type: 'button', 'class': 'fsm-eng-wbtn' + (w[0] === st.w ? ' fsm-eng-wbtn-on' : ''), 'data-w': w[0], onclick: function () {
                st.w = w[0]; wb.forEach(function (b) { b.className = 'fsm-eng-wbtn' + (b === this ? ' fsm-eng-wbtn-on' : ''); }, this);
            }, text: w[1] });
        });
        wb.forEach(function (b, i) { b.onclick = function () { st.w = widths[i][0]; wb.forEach(function (x) { x.className = 'fsm-eng-wbtn' + (x === b ? ' fsm-eng-wbtn-on' : ''); }); }; });
        var clear = el('button', { type: 'button', 'class': 'fsm-eng-wbtn fsm-eng-clear', text: 'Очистить', onclick: function () { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height); ctx.restore(); st.ink = false; hint.style.display = ''; } });
        wrap.appendChild(el('div', { 'class': 'fsm-eng-sigarea' }, [cv, hint]));
        wrap.appendChild(el('div', { 'class': 'fsm-eng-sigtools' }, wb.concat([clear])));
        return { node: wrap, has: function () { return st.ink; }, blob: function () { return new Promise(function (res, rej) { cv.toBlob(function (b) { b ? res(new File([b], 'podpis.png', { type: 'image/png' })) : rej(new Error('Не удалось сохранить подпись')); }, 'image/png'); }); } };
    }

    /* Подтверждение кодом из СМС (способ подписи act.sign_mode = sms). Шлюз в демо не подключён: код показывается на экране как имитация. */
    function smsBlock(phone) {
        var st = { sent: '' }, note = el('div', { 'class': 'fsm-eng-note fsm-eng-note-warn', style: 'display:none' }), inp = el('input', { type: 'text', inputmode: 'numeric', maxlength: '4', 'class': 'fsm-eng-in', placeholder: 'Код из СМС', autocomplete: 'off' });
        var node = el('div', { 'class': 'fsm-eng-sms' }, [
            el('div', { 'class': 'fsm-eng-muted', text: 'Код уйдёт клиенту на номер ' + (phone || '(телефон не указан)') + '. Клиент называет его инженеру.' }),
            el('button', { type: 'button', 'class': 'fsm-eng-bigbtn fsm-eng-second', 'data-act': 'sms-send', text: 'Отправить код клиенту', onclick: function () {
                st.sent = String(1000 + Math.floor(Math.random() * 9000)); note.style.display = ''; note.textContent = 'Демо-имитация: СМС-шлюз не подключён, клиенту ушёл бы код ' + st.sent + '.'; inp.focus();
            } }), note, W.field('Код от клиента', inp)]);
        return { node: node, sent: function () { return st.sent; }, value: function () { return inp.value; } };
    }
    /* ---------- экран акта ---------- */
    function renderAct() {
        var o = curOrder(), M = S.M, d = S.d, wrap = el('div', { 'class': 'fsm-eng-wrap fsm-eng-withbar' });
        wrap.appendChild(topbar('Акт по наряду ' + o.num, function () { S.view = 'order'; render(0); }));
        var wt = M.works[o.wt] || { price: 0 }, mats = d.mats.filter(function (m) { return m.qty > 0; }), tot = C.actTotals({ price: wt.price }, mats, o.warranty, M.opts), pr = C.checkProgress(d.checks);
        var sum = box('Сводка', [html('div', 'fsm-eng-big', esc(o.wt)), kv('Ставка работ', '<b>' + esc(money(wt.price)) + '</b>')]);
        sum.appendChild(el('h3', { text: 'Материалы' }));
        if (!mats.length) sum.appendChild(el('div', { 'class': 'fsm-eng-muted', text: 'Материалы не списаны' }));
        mats.forEach(function (m) { sum.appendChild(html('div', 'fsm-eng-matrow', '<span>' + esc(m.name) + '</span><span>' + esc(qty(m.qty)) + ' ' + esc(m.unit) + ' × ' + esc(money(m.price)) + ' = <b>' + esc(money(C.matSum(m))) + '</b></span>')); });
        sum.appendChild(html('div', '', kv('Материалы', esc(money(tot.mats)))));
        sum.appendChild(html('div', 'fsm-eng-total', 'Итого к оплате <b>' + esc(money(tot.total)) + '</b>'));
        if (o.warranty) sum.appendChild(html('div', 'fsm-eng-note fsm-eng-note-ok', tot.total ? 'Гарантийный наряд: сумма по прайсу ' + esc(money(tot.sum)) + ' (так задано в настройках, для взаиморасчётов).' : 'Гарантийный наряд: итого 0 ₽. Стоимость работ и материалов без гарантии составила бы ' + esc(money(tot.sum)) + '.'));
        if (pr.done < pr.total) sum.appendChild(html('div', 'fsm-eng-note fsm-eng-note-warn', 'Чек-лист выполнен не полностью: ' + pr.done + ' из ' + pr.total + '. Проверьте, прежде чем подписывать.'));
        wrap.appendChild(sum);
        var rem = el('textarea', { rows: 3, 'class': 'fsm-eng-ta', placeholder: 'Замечания по работам, рекомендации клиенту' });
        var signer = el('input', { type: 'text', 'class': 'fsm-eng-in', value: (M.clients[o.client] || {})['Контактное лицо'] || '', autocomplete: 'off' });
        var role = el('input', { type: 'text', 'class': 'fsm-eng-in', placeholder: 'Например, управляющий', autocomplete: 'off' });
        var plan = C.signPlan(M.opts), pad = plan.ink ? sigPad() : null, sms = plan.code ? smsBlock((M.clients[o.client] || {})['Телефон']) : null;
        var agree = el('input', { type: 'checkbox', id: 'fsm-eng-agree' });
        wrap.appendChild(box('Подписание', [W.field('Замечания', rem), W.field('Кто подписывает (ФИО)', signer), W.field('Должность', role),
            plan.ink ? el('div', { 'class': 'fsm-eng-fieldlab', text: 'Подпись' }) : el('div', { 'class': 'fsm-eng-fieldlab', text: 'Подтверждение: код из СМС' }), plan.ink ? pad.node : sms.node,
            el('label', { 'class': 'fsm-eng-agree', 'for': 'fsm-eng-agree' }, [agree, el('span', { text: 'Клиент ознакомлен с актом' })])]));
        var bar = el('div', { 'class': 'fsm-eng-bar2' }), inner = el('div', { 'class': 'fsm-eng-bar2in' }); bar.appendChild(inner);
        function chk() {
            var v = C.signCheck(M.opts, { signer: signer.value, ink: pad && pad.has(), code: sms && sms.value(), sentCode: sms && sms.sent() });
            if (!v.ok) { if (!signer.value.trim()) signer.focus(); W.toast(v.why, true); return false; }
            if (!agree.checked) { W.toast('Отметьте, что клиент ознакомлен с актом', true); return false; }
            return true;
        }
        inner.appendChild(el('button', { type: 'button', 'class': 'fsm-eng-bigbtn fsm-eng-primary', 'data-act': 'sign', text: 'Подписать и закрыть наряд', onclick: function () {
            if (chk()) finishAct(o, { signed: true, method: plan.mode, signer: signer.value.trim(), role: role.value.trim(), remarks: rem.value.trim(), pad: pad, tot: tot });
        } }));
        inner.appendChild(el('button', { type: 'button', 'class': 'fsm-eng-bigbtn fsm-eng-second', 'data-act': 'refuse', text: 'Клиент отсутствует / отказался', onclick: function () {
            var ta = el('textarea', { rows: 3, 'class': 'fsm-eng-ta', placeholder: 'Например, клиент отсутствует на объекте' });
            W.modal('Акт без подписи', W.field('Причина (обязательно)', ta), [{ text: 'Отмена' }, { text: 'Закрыть без подписи', cls: 'fsm-primary', fn: function () {
                var t = ta.value.trim(); if (!t) { ta.focus(); W.toast('Укажите причину', true); return false; }
                finishAct(o, { signed: false, why: t, remarks: rem.value.trim(), tot: tot });
            } }]);
        } }));
        wrap.appendChild(bar);
        return wrap;
    }
    function finishAct(o, p) {
        if (S.busy) return; S.busy = true;
        document.querySelectorAll('.fsm-eng-bigbtn').forEach(function (b) { b.disabled = true; });
        var d = S.d, now = C.toApi(W.now()), num = 'А-' + digits(o.num), actId = null, T = p.tot, used = {};
        var f = { 'Акт': num, 'Наряд': o.num, 'Заказчик': o.client, 'Инженер': S.eng.name, 'Составлен': now, 'Сумма работ': String(T.works), 'Сумма материалов': String(T.mats), 'Итого': String(T.total) };
        if (p.remarks) f['Замечания'] = p.remarks;
        if (p.signed) { f['Подписал'] = p.signer; f['Подписан'] = now; f['Способ подписи'] = p.method || 'screen'; if (p.role) f['Должность подписанта'] = p.role; } else { f['Отказ клиента'] = 1; f['Причина отказа'] = p.why; }
        d.mats.forEach(function (m) { if ((!m.src || m.src === 'Склад в машине') && m.qty > 0) used[m.name] = (used[m.name] || 0) + m.qty; });
        S.q.then(function () { return W.post('_m_new/' + W.tid('Акт') + '?JSON', { up: 1, fields: f }); }).then(function (j) {
            actId = String(j.id || j.obj); if (!actId) throw new Error('Не удалось создать акт');
            return p.signed && p.pad ? p.pad.blob().then(function (b) { return postFile('_m_set/' + actId + '?JSON', 't' + reqId('Акт', 'Подпись'), b); }) : null;
        }).then(function () {
            return W.setStatus(S.M, o, 'Выполнен', { 'Завершён': now }, 'Акт ' + num);
        }).then(function () { return W.addEvent(o, p.signed ? 'Акт подписан' : 'Акт без подписи', p.signed ? p.signer : p.why); })
            .then(function () {
                /* склад в машине: списание при акте - только если так задано в настройках (stock.writeoff), иначе его сделает диспетчер при закрытии наряда */
                var plan = C.writeoffPlan(S.M.opts, 'act', d.stock, d.mats);
                return Promise.all(plan.map(function (s) {
                    d.stock.forEach(function (x) { if (x.id === s.id) x.qty = s.qty; });
                    return W.post('_m_set/' + s.id + '?JSON', { fields: { 'Количество': String(s.qty) } });
                })).then(function () { return plan.length ? W.addEvent(o, 'Склад списан', 'при акте: ' + plan.map(function (x) { return x.name + ' -' + W.right(x.used); }).join(', ')) : null; });
            }).then(reload).then(function () {
                S.busy = false; S.view = 'done'; S.act = { id: actId, num: num, signed: p.signed, why: p.why, total: T.total, warranty: o.warranty }; render(0);
            }).catch(function (e) {
                S.busy = false; fail(e);
                if (actId) reload().then(function () { S.view = 'order'; return loadOrder(curOrder()); }).then(function (dd) { S.d = dd; render(0); }).catch(function () { });
                else document.querySelectorAll('.fsm-eng-bigbtn').forEach(function (b) { b.disabled = false; });
            });
    }
    function renderDone() {
        var a = S.act, o = curOrder(), wrap = el('div', { 'class': 'fsm-eng-wrap fsm-eng-done' });
        wrap.appendChild(el('div', { 'class': 'fsm-eng-doneico', text: '✓' }));
        wrap.appendChild(el('h1', { text: 'Готово' }));
        wrap.appendChild(el('p', { 'class': 'fsm-eng-big', text: 'Наряд ' + (o ? o.num : '') + ' выполнен' }));
        wrap.appendChild(el('p', { 'class': 'fsm-eng-muted', text: (a.signed ? 'Акт ' + a.num + ' подписан клиентом.' : 'Акт ' + a.num + ' оформлен без подписи: ' + a.why) + ' Итого ' + money(a.total) + (a.warranty ? ' (гарантия)' : '') + '.' }));
        wrap.appendChild(el('a', { 'class': 'fsm-eng-bigbtn fsm-eng-primary', href: W.url('act?id=' + a.id), text: 'Открыть акт для печати' }));
        wrap.appendChild(el('button', { type: 'button', 'class': 'fsm-eng-bigbtn', text: 'К списку нарядов', onclick: toList }));
        return wrap;
    }

    /* ---------- запуск ---------- */
    W.mount(function (host) {
        return W.load().then(function (M) {
            S.M = M; S.eng = detectEngineer(M);
            host.innerHTML = ''; host.classList.add('fsm-eng-host');
            root = el('div', { 'class': 'fsm-eng' }); host.appendChild(root);
            if (!S.eng) { root.appendChild(el('div', { 'class': 'fsm-eng-empty', text: 'Нет нарядов: войдите под учётной записью инженера' })); return; }
            render(0);
            setInterval(function () { S.timers.forEach(function (f) { f(); }); }, 30000);
            window.addEventListener('popstate', function () { if (S.view !== 'list') toList(); });
        });
    });
})();
