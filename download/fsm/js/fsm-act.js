/* FSM: реестр актов (экран acts) и печатная форма акта (экран act). Выбор по data-screen у #fsm-app. */
(function () {
    'use strict';
    var W = window.Fsm, C = W.core;
    var screen = W.ctx.screen;

    /* ---------- общее ---------- */
    function kindOf(a) { return a.refused ? 'refused' : a.signedAt ? 'signed' : 'unsigned'; }
    function decorate(M, a) {
        var o = M.orderBy[a.order] || null;
        a.o = o; a.obj = o ? o.obj : ''; a.warranty = !!(o && o.warranty); a.kind = kindOf(a);
        a.pay = a.warranty ? 0 : (a.total || (a.works + a.mats));
        a.gross = a.works + a.mats;
        return a;
    }
    function badgesOf(a) {
        var h = [];
        if (a.kind === 'signed') h.push(W.badge('Подписан', 'ok'));
        else if (a.kind === 'refused') h.push(W.badge('Отказ клиента', 'crit'));
        else h.push(W.badge('Без подписи', 'warn'));
        if (a.warranty) h.push(W.badge('Гарантия', 'info'));
        if (a.exported) h.push(W.badge('Выгружен в 1С', 'ok'));
        return h.join(' ');
    }
    function rub(x) { return C.num(x).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 }); }
    /* Файловые реквизиты приходят как <a href="/download/..">имя</a>: берём адрес. */
    function fileUrl(v) { var m = /href="([^"]+)"/.exec(String(v || '')); return m ? m[1] : ''; }
    function markExported(list) {
        var chain = Promise.resolve();
        list.forEach(function (a) { chain = chain.then(function () { return W.post('_m_set/' + a.id + '?JSON', { fields: { 'Выгружен в 1С': 1 } }).then(function () { a.exported = true; }); }); });
        return chain;
    }

    /* ================= реестр актов ================= */
    function screenActs(host, M) {
        var acts = M.acts.map(function (a) { return decorate(M, a); }).sort(function (a, b) { return b.created - a.created; });
        var write = W.canWrite('Акт');
        var st = { period: '30', state: '', eng: '', q: '', sel: {} };
        var now = W.now();
        var engs = {}; acts.forEach(function (a) { if (a.eng) engs[a.eng] = 1; });
        var engList = Object.keys(engs).sort();

        function base() {
            var q = st.q.trim().toLowerCase();
            return acts.filter(function (a) {
                if (st.period !== 'all' && now - a.created > (+st.period) * C.DAY) return false;
                if (st.eng && a.eng !== st.eng) return false;
                if (q && [a.num, a.order, a.client, a.obj, a.signer, a.eng].join(' ').toLowerCase().indexOf(q) < 0) return false;
                return true;
            });
        }
        function byState(list) {
            return list.filter(function (a) {
                switch (st.state) {
                    case 'signed': return a.kind === 'signed';
                    case 'unsigned': return a.kind === 'unsigned';
                    case 'refused': return a.kind === 'refused';
                    case 'warranty': return a.warranty;
                    case 'notexp': return !a.exported;
                }
                return true;
            });
        }
        var tiles = W.el('div', { 'class': 'fsm-act-tiles' }), tableBox = W.el('div'), tools = W.el('div', { 'class': 'fsm-bar fsm-act-tools' });

        function selected(list) { return list.filter(function (a) { return st.sel[a.id]; }); }
        function drawTiles(list) {
            var sum = 0; list.forEach(function (a) { sum += a.pay; });
            var defs = [['', 'Всего актов', list.length, ''], ['signed', 'Подписано', list.filter(function (a) { return a.kind === 'signed'; }).length, 'ok'],
                ['unsigned', 'Без подписи', list.filter(function (a) { return a.kind === 'unsigned'; }).length, 'warn'], ['refused', 'Отказ клиента', list.filter(function (a) { return a.kind === 'refused'; }).length, 'crit'],
                ['notexp', 'Не выгружено в учёт', list.filter(function (a) { return !a.exported; }).length, 'warn'], ['', 'Сумма к оплате', rub(sum) + ' ₽', 'sum']];
            tiles.innerHTML = '';
            defs.forEach(function (d) {
                var on = d[0] && st.state === d[0];
                tiles.appendChild(W.el('button', { type: 'button', 'class': 'fsm-act-tile fsm-act-tile-' + (d[3] || 'n') + (on ? ' fsm-act-tile-on' : ''), onclick: function () { st.state = on ? '' : d[0]; stateSel.value = st.state; draw(); } },
                    [W.el('span', { 'class': 'fsm-act-tile-v', text: String(d[2]) }), W.el('span', { 'class': 'fsm-act-tile-t', text: d[1] })]));
            });
        }
        function csv(list) {
            var rows = list.map(function (a) {
                return { num: a.num, date: C.fmtDt(a.created), order: a.order, client: a.client, obj: a.obj, eng: a.eng, signer: a.signer, role: a.role, works: W.right(a.works), mats: W.right(a.mats), pay: W.right(a.pay),
                    state: { signed: 'Подписан', unsigned: 'Без подписи', refused: 'Отказ клиента' }[a.kind], war: a.warranty ? 'Да' : 'Нет', exp: a.exported ? 'Да' : 'Нет' };
            });
            return C.toCsv(rows, [['num', 'Акт'], ['date', 'Дата'], ['order', 'Наряд'], ['client', 'Заказчик'], ['obj', 'Объект'], ['eng', 'Инженер'], ['signer', 'Подписал'], ['role', 'Должность'],
                ['works', 'Сумма работ'], ['mats', 'Сумма материалов'], ['pay', 'К оплате'], ['state', 'Состояние'], ['war', 'Гарантия'], ['exp', 'Выгружен в 1С']]);
        }
        function drawTools(list) {
            tools.innerHTML = '';
            if (!write) { tools.style.display = 'none'; return; }
            tools.style.display = '';
            var sel = selected(list), target = sel.length ? sel : list, todo = target.filter(function (a) { return !a.exported; });
            tools.appendChild(W.el('span', { 'class': 'fsm-sub fsm-act-selinfo', text: sel.length ? 'Выбрано актов: ' + sel.length : 'Ничего не выбрано: действие применится ко всем актам по фильтру (' + list.length + ')' }));
            tools.appendChild(W.btn('Выбрать все', function () { list.forEach(function (a) { st.sel[a.id] = 1; }); draw(); }));
            tools.appendChild(W.btn('Снять выбор', function () { st.sel = {}; draw(); }));
            tools.appendChild(W.btn('Отметить выгруженным в 1С (' + todo.length + ')', function () {
                if (!todo.length) { W.toast('Все акты уже выгружены'); return; }
                W.modal('Выгрузка в 1С', W.el('p', { text: 'Отметить выгруженными в 1С актов: ' + todo.length + '. Флаг «Выгружен в 1С» будет установлен в базе.' }), [{ text: 'Отмена' }, { text: 'Отметить', cls: 'fsm-primary', fn: function () {
                    markExported(todo).then(function () { W.toast('Отмечено актов: ' + todo.length); draw(); }).catch(function (e) { W.toast('Ошибка: ' + e.message, true); draw(); });
                } }]);
            }, 'fsm-primary'));
            tools.appendChild(W.btn('Выгрузить CSV (' + target.length + ')', function () {
                if (!target.length) { W.toast('Нет актов для выгрузки', true); return; }
                W.download('acts-' + C.isoDate(now) + '.csv', csv(target));
            }));
        }
        function draw() {
            var b = base(), list = byState(b);
            drawTiles(b); drawTools(list);
            var cols = [];
            if (write) cols.push({ t: '', html: function (a) { return '<input type="checkbox" class="fsm-act-chk" data-id="' + a.id + '"' + (st.sel[a.id] ? ' checked' : '') + ' aria-label="Выбрать акт ' + W.esc(a.num) + '">'; } });
            cols = cols.concat([
                { t: 'Акт', html: function (a) { return '<b>' + W.esc(a.num) + '</b><div class="fsm-sub fsm-act-small fsm-nowrap">' + W.esc(a.order) + '</div>'; } },
                { t: 'Дата', html: function (a) { return '<span class="fsm-nowrap">' + W.esc(C.fmtDate(a.created)) + '</span>'; } },
                { t: 'Заказчик', k: 'client' }, { t: 'Объект', html: function (a) { return W.esc(String(a.obj).split(' · ').pop()); } }, { t: 'Инженер', k: 'eng' },
                { t: 'Подписал', html: function (a) { return a.signer ? W.esc(a.signer) + '<div class="fsm-sub fsm-act-small">' + W.esc(a.role) + '</div>' : '<span class="fsm-sub">нет</span>'; } },
                { t: 'Сумма, ₽', num: true, html: function (a) { return rub(a.pay); } },
                { t: 'Состояние', html: badgesOf }
            ]);
            var visible = list.slice(0, 300);
            var tb = W.table(cols, visible, { empty: 'Нет актов по выбранным условиям', onrow: function (a) { location.href = 'act?id=' + a.id; }, rowCls: function (a) { return a.kind === 'refused' ? 'fsm-row-bad' : ''; } });
            [].forEach.call(tb.querySelectorAll('.fsm-act-chk'), function (c) {
                c.addEventListener('click', function (e) { e.stopPropagation(); });
                c.addEventListener('change', function () { if (c.checked) st.sel[c.dataset.id] = 1; else delete st.sel[c.dataset.id]; drawTools(byState(base())); });
            });
            tableBox.innerHTML = '';
            tableBox.appendChild(W.el('p', { 'class': 'fsm-sub', text: 'Показано актов: ' + visible.length + (list.length > visible.length ? ' из ' + list.length + ' (уточните фильтр)' : '') }));
            tableBox.appendChild(tb);
        }

        var periodSel = W.select([['7', '7 дней'], ['30', '30 дней'], ['all', 'Всё время']], st.period);
        var stateSel = W.select([['', 'Все'], ['signed', 'Подписан'], ['unsigned', 'Без подписи'], ['refused', 'Отказ клиента'], ['warranty', 'Гарантия'], ['notexp', 'Не выгружен в 1С']], st.state);
        var engSel = W.select([['', 'Все инженеры']].concat(engList.map(function (n) { return [n, n]; })), st.eng);
        var qIn = W.el('input', { type: 'search', placeholder: 'Акт, наряд, заказчик, объект', 'aria-label': 'Поиск' });
        periodSel.onchange = function () { st.period = periodSel.value; draw(); };
        stateSel.onchange = function () { st.state = stateSel.value; draw(); };
        engSel.onchange = function () { st.eng = engSel.value; draw(); };
        qIn.oninput = function () { st.q = qIn.value; draw(); };

        host.innerHTML = '';
        host.appendChild(W.el('h1', { text: 'Акты выполненных работ' }));
        host.appendChild(W.el('p', { 'class': 'fsm-sub', text: write ? 'Реестр актов, отметка выгрузки в 1С и выгрузка в CSV.' : 'Реестр актов. Нажмите на строку, чтобы открыть печатную форму.' }));
        host.appendChild(tiles);
        host.appendChild(W.el('div', { 'class': 'fsm-bar' }, [W.field('Период', periodSel), W.field('Состояние', stateSel), engList.length > 1 ? W.field('Инженер', engSel) : null, W.field('Поиск', qIn)]));
        host.appendChild(tools);
        host.appendChild(tableBox);
        draw();
    }

    /* ================= печатная форма акта ================= */
    function screenAct(host, M) {
        var m = /[?&]id=([^&]+)/.exec(location.search), key = m ? decodeURIComponent(m[1]) : '';
        var a = null;
        M.acts.forEach(function (x) { if (x.id === key || x.num === key) a = x; });
        host.innerHTML = '';
        if (!a) {
            host.appendChild(W.el('h1', { text: 'Акт не найден' }));
            host.appendChild(W.el('p', { 'class': 'fsm-sub', text: 'Акт с таким номером недоступен или не существует.' }));
            host.appendChild(W.btn('К списку актов', function () { location.href = 'acts'; }));
            return Promise.resolve();
        }
        decorate(M, a);
        var o = a.o, write = W.canWrite('Акт');
        return Promise.all([o ? W.rows('Работа наряда', o.id).catch(function () { return []; }) : [], o ? W.rows('Материал наряда', o.id).catch(function () { return []; }) : [],
            o ? W.rows('Фото наряда', o.id).catch(function () { return []; }) : []]).then(function (r) {
            var checks = r[0], mats = r[1], photos = r[2];
            var ob = (o && M.objects[o.obj]) || {}, eq = (o && M.equipment[o.eq]) || {}, cl = M.clients[a.client] || {}, wk = (o && M.works[o.wt]) || { norm: 0, name: o ? o.wt : '' };
            var E = W.esc;

            var bar = W.el('div', { 'class': 'fsm-act-bar' }, [
                W.btn('Печать / сохранить в PDF', function () { window.print(); }, 'fsm-primary'), W.btn('К списку актов', function () { location.href = 'acts'; }),
                write && !a.exported ? W.btn('Отметить выгруженным в 1С', function (ev) {
                    var b = ev.currentTarget; b.disabled = true;
                    markExported([a]).then(function () { W.toast('Отмечено: выгружен в 1С'); screenAct(host, M); }).catch(function (e) { b.disabled = false; W.toast('Ошибка: ' + e.message, true); });
                }) : null,
                W.el('span', { 'class': 'fsm-act-barinfo', html: badgesOf(a) })
            ]);

            function kv(k, v) { return '<tr><th>' + E(k) + '</th><td>' + v + '</td></tr>'; }
            var h = '';
            h += '<div class="fsm-act-head"><div class="fsm-act-org"><b>ООО «Климат-Сервис»</b><br><span>вымышленный исполнитель, демонстрационные данные</span></div></div>';
            h += '<h2 class="fsm-act-title">АКТ выполненных работ № ' + E(a.num) + ' от ' + E(C.fmtDate(a.created)) + '</h2>';
            h += '<table class="fsm-act-kv">';
            h += kv('Основание', 'Наряд № ' + E(a.order) + (o && o.fault ? '<div class="fsm-act-small">Неисправность: ' + E(o.fault) + '</div>' : ''));
            h += kv('Заказчик', E(a.client) + (cl['Номер договора'] ? ', договор № ' + E(cl['Номер договора']) + (cl['Тип договора'] ? ' (' + E(cl['Тип договора']) + ')' : '') : ''));
            h += kv('Объект', E(o ? String(o.obj).split(' · ').pop() : '') + (ob.address ? ', ' + E(ob.address) : ''));
            h += kv('Оборудование', eq.model ? E(eq.model) + ', серийный № ' + E(eq.serial || '—') : E(o ? o.eq : '—'));
            h += kv('Время работ', 'прибытие: ' + E(o && o.arr ? C.fmtDt(o.arr) : '—') + '; завершение: ' + E(o && o.fin ? C.fmtDt(o.fin) : '—'));
            h += '</table>';
            if (o && o.repeat) h += '<div class="fsm-act-note fsm-act-note-warn">Повторный выезд по наряду № ' + E(o.repOf || '—') + '</div>';
            if (a.warranty) h += '<div class="fsm-act-note fsm-act-note-info">Гарантийный случай: стоимость работ и материалов не оплачивается.</div>';

            h += '<h3>Выполненные работы</h3><table class="fsm-act-tbl"><thead><tr><th class="n">№</th><th>Вид работ</th><th class="r">Нормо-часы</th><th class="r">Стоимость, ₽</th></tr></thead><tbody>';
            h += '<tr><td class="n">1</td><td>' + E(wk.name || (o ? o.wt : '')) + '</td><td class="r">' + E(W.right(wk.norm)) + '</td><td class="r">' + rub(a.works) + '</td></tr>';
            checks.forEach(function (c) {
                var done = W.bool(c['Выполнено']);
                h += '<tr class="fsm-act-chk-row"><td></td><td colspan="2">' + E(c['Работа наряда']) + (c['Комментарий'] ? ' <i>(' + E(c['Комментарий']) + ')</i>' : '') + '</td><td class="r">' + (done ? 'выполнено' : '<b>не выполнено</b>') + '</td></tr>';
            });
            h += '</tbody></table>';

            h += '<h3>Материалы</h3>';
            if (!mats.length) h += '<p class="fsm-act-small">Материалы не использовались.</p>';
            else {
                h += '<table class="fsm-act-tbl"><thead><tr><th class="n">№</th><th>Наименование</th><th>Ед.</th><th class="r">Кол-во</th><th class="r">Цена, ₽</th><th class="r">Сумма, ₽</th></tr></thead><tbody>';
                mats.forEach(function (x, i) {
                    var mm = { qty: x['Количество'], price: x['Цена'] };
                    h += '<tr><td class="n">' + (i + 1) + '</td><td>' + E(x['Материал наряда']) + '</td><td>' + E(x['Ед. изм']) + '</td><td class="r">' + E(W.right(x['Количество'])) + '</td><td class="r">' + rub(x['Цена']) + '</td><td class="r">' + rub(C.matSum(mm)) + '</td></tr>';
                });
                h += '</tbody></table>';
            }

            h += '<table class="fsm-act-sum"><tr><th>Работы</th><td>' + rub(a.works) + ' ₽</td></tr><tr><th>Материалы</th><td>' + rub(a.mats) + ' ₽</td></tr>';
            if (a.warranty) h += '<tr><th>Стоимость по расценкам</th><td>' + rub(a.gross) + ' ₽</td></tr><tr><th>Скидка по гарантии</th><td>' + rub(a.gross) + ' ₽</td></tr>';
            h += '<tr class="fsm-act-sum-total"><th>Итого к оплате</th><td>' + rub(a.pay) + ' ₽</td></tr></table>';
            h += '<p class="fsm-act-words">Итого к оплате: <b>' + E(C.rubWords(a.pay)) + '</b>' + (a.pay ? ' (НДС не облагается, демонстрационный пример)' : '') + '</p>';
            h += '<p class="fsm-act-remarks"><b>Замечания:</b> ' + (a.remarks ? E(a.remarks).replace(/\n/g, '<br>') : 'нет') + '</p>';

            var sigUrl = fileUrl(a.sig), sigBlock;
            if (a.kind === 'refused') sigBlock = '<div class="fsm-act-stamp fsm-act-stamp-bad">Подпись отсутствует.<br>Отказ: ' + E(a.refuseWhy || 'причина не указана') + '</div>';
            else if (sigUrl) sigBlock = '<img class="fsm-act-sigimg" src="' + E(sigUrl) + '" alt="Подпись заказчика"><div class="fsm-act-small">Подписано на экране устройства' + (a.signedAt ? ', ' + E(C.fmtDt(a.signedAt)) : '') + '</div>';
            else if (a.signedAt) sigBlock = '<div class="fsm-act-stamp">Подписано на экране устройства,<br>' + E(C.fmtDt(a.signedAt)) + '</div>';
            else sigBlock = '<div class="fsm-act-stamp fsm-act-stamp-bad">Подпись отсутствует</div>';
            h += '<div class="fsm-act-sign"><div><div class="fsm-act-signh">Исполнитель</div><div>Инженер ' + E(a.eng || '—') + '</div><div class="fsm-act-line"></div><div class="fsm-act-small">подпись</div></div>';
            h += '<div><div class="fsm-act-signh">Заказчик</div><div>' + E(a.signer || '—') + (a.role ? ', ' + E(a.role) : '') + '</div>' + sigBlock + '</div></div>';

            if (photos.length) {
                h += '<div class="fsm-act-photos"><h3>Фотофиксация</h3><div class="fsm-act-photogrid">';
                photos.forEach(function (p) {
                    var u = fileUrl(p['Файл']), isImg = /\.(png|jpe?g|gif|webp)$/i.test(u);
                    h += '<figure>' + (u && isImg ? '<img src="' + E(u) + '" alt="' + E(p['Этап'] || 'Фото') + '">' : '<div class="fsm-act-nophoto">' + (u ? '<a href="' + E(u) + '">файл</a>' : 'нет файла') + '</div>') + '<figcaption>' + E(p['Этап'] || '') + (p['Снято'] ? ', ' + E(C.fmtDt(C.parseDt(p['Снято']))) : '') + '</figcaption></figure>';
                });
                h += '</div></div>';
            }
            var sheet = W.el('div', { 'class': 'fsm-act-sheet', html: h });
            host.appendChild(bar);
            host.appendChild(W.el('div', { 'class': 'fsm-act-paper' }, [sheet]));
        });
    }

    /* Лёгкая загрузка: только то, что нужно актам (без отчётов, недоступных инженерам). */
    function soft(n) { return W.canRead(n) ? W.rows(n).catch(function () { return []; }) : Promise.resolve([]); }
    function load() {
        return Promise.all([soft('Акт'), soft('Наряд'), soft('Объект'), soft('Оборудование'), soft('Заказчик'), soft('Вид работ')]).then(function (r) {
            var M = { objects: {}, equipment: {}, clients: {}, works: {}, orderBy: {} };
            M.acts = r[0].map(function (x) {
                return { id: x._id, num: x['Акт'], order: x['Наряд'], client: x['Заказчик'], eng: x['Инженер'], created: C.parseDt(x['Составлен']), signer: x['Подписал'], role: x['Должность подписанта'], sig: x['Подпись'],
                    signedAt: C.parseDt(x['Подписан']), refused: W.bool(x['Отказ клиента']), refuseWhy: x['Причина отказа'], works: C.num(x['Сумма работ']), mats: C.num(x['Сумма материалов']), total: C.num(x['Итого']),
                    remarks: x['Замечания'], exported: W.bool(x['Выгружен в 1С']) };
            });
            r[1].forEach(function (x) { M.orderBy[x['Наряд']] = { id: x._id, num: x['Наряд'], obj: x['Объект'], eq: x['Оборудование'], wt: x['Вид работ'], fault: x['Неисправность'], arr: C.parseDt(x['Прибыл']), fin: C.parseDt(x['Завершён']), repeat: W.bool(x['Повторный']), repOf: x['Повтор наряда'], warranty: W.bool(x['Гарантийный']) }; });
            r[2].forEach(function (x) { M.objects[x['Объект']] = { address: x['Адрес'] }; });
            r[3].forEach(function (x) { M.equipment[x['Оборудование']] = { model: x['Модель'], serial: x['Серийный номер'] }; });
            r[4].forEach(function (x) { M.clients[x['Заказчик']] = x; });
            r[5].forEach(function (x) { M.works[x['Вид работ']] = { name: x['Вид работ'], norm: C.num(x['Нормо-часов']) }; });
            return M;
        });
    }
    W.mount(function (host) {
        return load().then(function (M) {
            host.classList.add('fsm-act-screen');
            return screen === 'act' ? screenAct(host, M) : screenActs(host, M);
        });
    });
})();
