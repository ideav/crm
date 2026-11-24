/* FSM: модель данных рабочих мест (загрузка справочников, нарядов, актов, инженеров; запись статусов и событий). Нужны fsm-core.js и fsm-app.js. */
(function () {
    'use strict';
    var W = window.Fsm, C = W.core;
    W.bool = function (v) { return v !== undefined && v !== null && v !== '' && v !== '0' && v !== '-1' && v !== false; };
    function soft(n) { return W.rows(n).catch(function () { return []; }); }
    function by(list, key) { var m = {}; list.forEach(function (x) { m[x[key]] = x; }); return m; }
    function normOrder(r, opts) {
        var o = { id: r._id, num: r['Наряд'], reqNum: r['Заявка'], client: r['Заказчик'], obj: r['Объект'], eq: r['Оборудование'], wt: r['Вид работ'], prio: r['Приоритет'], eng: r['Инженер'] || '', status: r['Статус'],
            created: C.parseDt(r['Создан']), win0: C.parseDt(r['Окно с']), win1: C.parseDt(r['Окно по']), arrDue: C.parseDt(r['Прибыть до']), finDue: C.parseDt(r['Завершить до']),
            dep: C.parseDt(r['Выехал']), arr: C.parseDt(r['Прибыл']), fin: C.parseDt(r['Завершён']), fault: r['Неисправность'], repeat: W.bool(r['Повторный']), repOf: r['Повтор наряда'],
            warranty: W.bool(r['Гарантийный']), reason: r['Причина просрочки'], checked: W.bool(r['Проверен']), ref: r._ref };
        var d = C.orderDue(o, opts); o.arrDue = d.arrDue; o.finDue = d.finDue; /* плановое ТО: срок по настройкам демо */
        return o;
    }
    function normAct(r) {
        return { id: r._id, num: r['Акт'], order: r['Наряд'], client: r['Заказчик'], eng: r['Инженер'], created: C.parseDt(r['Составлен']), signer: r['Подписал'], role: r['Должность подписанта'], sig: r['Подпись'],
            signedAt: C.parseDt(r['Подписан']), refused: W.bool(r['Отказ клиента']), refuseWhy: r['Причина отказа'], works: C.num(r['Сумма работ']), mats: C.num(r['Сумма материалов']), total: C.num(r['Итого']),
            signMethod: r['Способ подписи'], remarks: r['Замечания'], exported: W.bool(r['Выгружен в 1С']) };
    }
    /* Загрузка всего, что нужно доске, дашборду и справочникам. Недоступные роли таблицы дают пустой список. */
    W.load = function () {
        return Promise.all([soft('Наряд'), soft('Заявка'), soft('Объект'), soft('Оборудование'), soft('Инженер'), soft('Заказчик'), soft('Вид работ'), soft('Номенклатура'), soft('Приоритет'),
            soft('Статус наряда'), soft('Акт'), W.report('Навыки и допуски').catch(function () { return []; }), W.report('Остатки в машинах').catch(function () { return []; }), soft('Район'), soft('Настройка демо')]).then(function (r) {
            var opts = W.parseOpts(r[14]);
            var M = { opts: opts, orders: r[0].map(function (x) { return normOrder(x, opts); }), reqRows: r[1], clients: by(r[5], 'Заказчик'), prios: r[8], statuses: r[9].sort(function (a, b) { return C.num(a['Порядок']) - C.num(b['Порядок']); }), acts: r[10].map(normAct), districts: by(r[13], 'Район') };
            M.objects = {}; r[2].forEach(function (o) { M.objects[o['Объект']] = { name: o['Объект'], client: o['Заказчик'], address: o['Адрес'], district: o['Район'], lat: C.num(o['Широта']), lon: C.num(o['Долгота']), onsite: o['Контакт на объекте'], pass: W.bool(o['Пропуск нужен']), nosig: W.bool(o['Нет связи']), how: o['Как пройти'], id: o._id }; });
            M.equipment = {}; r[3].forEach(function (e) { M.equipment[e['Оборудование']] = { name: e['Оборудование'], obj: e['Объект'], kind: e['Вид оборудования'], model: e['Модель'], serial: e['Серийный номер'], inst: e['Установлено'], warr: e['Гарантия до'], id: e._id }; });
            M.works = {}; r[6].forEach(function (w) { M.works[w['Вид работ']] = { name: w['Вид работ'], skill: w['Навык'], norm: C.num(w['Нормо-часов']), price: C.num(w['Ставка работ']), to: W.bool(w['Плановое ТО']), list: String(w['Чек-лист'] || '').split(/\r?\n/).filter(Boolean), id: w._id }; });
            M.nomen = {}; r[7].forEach(function (n) { M.nomen[n['Номенклатура']] = { name: n['Номенклатура'], art: n['Артикул'], unit: n['Ед. изм'], price: C.num(n['Цена']), id: n._id }; });
            var sk = {}, st = {}; r[11].forEach(function (x) { (sk[x['Инженер']] = sk[x['Инженер']] || []).push({ skill: x['Навык'], until: x['Допуск до'] ? W.isoDate(x['Допуск до']) : '', doc: x['Номер документа'] }); });
            r[12].forEach(function (x) { (st[x['Инженер']] = st[x['Инженер']] || []).push({ name: x['Материал'], qty: C.num(x['Количество']), min: C.num(x['Минимум']) }); });
            M.engineers = r[4].map(function (e) { return { id: e._id, name: e['Инженер'], phone: e['Телефон'], district: e['Базовый район'], car: e['Автомобиль'], lat: C.num(e['Широта']), lon: C.num(e['Долгота']), posAt: e['Позиция на'],
                from: e['Смена с'], to: e['Смена по'], max: C.num(e['Макс. нарядов в день']) || 6, works: W.bool(e['Работает']), skills: sk[e['Инженер']] || [], stock: st[e['Инженер']] || [] }; });
            M.engBy = by(M.engineers, 'name'); M.orderBy = by(M.orders, 'num');
            M.requests = M.reqRows.filter(function (q) { return q['Состояние заявки'] === 'Новая'; }).map(function (q) {
                return { id: q._id, num: q['Заявка'], client: q['Заказчик'], obj: q['Объект'], eq: q['Оборудование'], prio: q['Приоритет'], src: q['Источник'], created: C.parseDt(q['Создана']), text: q['Что случилось'], contact: q['Контакт'] };
            });
            M.statusId = {}; r[9].forEach(function (s) { M.statusId[s['Статус наряда']] = s._id; });
            M.prioId = {}; r[8].forEach(function (p) { M.prioId[p['Приоритет']] = p._id; });
            M.ctx = function () { return { engineers: M.engineers, orders: M.orders, objects: M.objects, works: M.works, now: W.now(), opts: opts }; };
            W.opts = M.opts;
            return M;
        });
    };
    /* Настройки демо из таблицы «Настройка демо» (строки: код в главном поле, значение в «Значение»); нет таблицы или доступа - значения по умолчанию. */
    W.parseOpts = function (rows) { return C.parseOpts((rows || []).map(function (x) { return { code: x['Настройка демо'], value: x['Значение'] }; })); };
    W.loadOpts = function () { return soft('Настройка демо').then(W.parseOpts); };
    /* Дата допуска приходит как ДД.ММ.ГГГГ или ГГГГ-ММ-ДД: приводим к ГГГГ-ММ-ДД. */
    W.isoDate = function (v) { var ms = C.parseDt(v); return ms ? C.isoDate(ms) : ''; };
    /* Запись события в журнал наряда. */
    W.addEvent = function (order, name, comment) {
        return W.post('_m_new/' + W.tid('Событие наряда') + '?JSON', { up: order.id, fields: { 'Событие наряда': name, 'Время': C.toApi(W.now()), 'Автор': W.ctx.user, 'Комментарий': comment || '' } });
    };
    /* Смена статуса наряда (по id статуса) и запись события. extra - поля наряда по именам (время выезда и т.п.). */
    W.setStatus = function (M, order, status, extra, comment) {
        var f = Object.assign({ 'Статус': M.statusId[status] }, extra || {});
        return W.post('_m_set/' + order.id + '?JSON', { fields: f }).then(function () { order.status = status; return W.addEvent(order, status, comment); });
    };
    /* Назначение инженера: ссылка по id, статус «Назначен», событие. */
    W.assign = function (M, order, eng) {
        var f = { 'Инженер': eng.id, 'Статус': M.statusId['Назначен'] };
        return W.post('_m_set/' + order.id + '?JSON', { fields: f }).then(function () { order.eng = eng.name; order.status = 'Назначен'; return W.addEvent(order, 'Назначен', eng.name); });
    };
    /* Списание материалов наряда со склада в машине инженера, если настройка stock.writeoff совпадает с моментом (act | close). Дважды не списывает: признак - событие «Склад списан». Возвращает план [{name, qty, used}]. */
    W.stockWriteoff = function (M, order, moment) {
        var eng = M.engBy[order.eng]; if (!eng) return Promise.resolve([]);
        return Promise.all([W.rows('Материал наряда', order.id), W.rows('Остаток в машине', eng.id), W.rows('Событие наряда', order.id)]).then(function (r) {
            if (r[2].some(function (e) { return e['Событие наряда'] === 'Склад списан'; })) return [];
            var mats = r[0].map(function (x) { return { name: x['Материал наряда'], qty: C.num(x['Количество']), src: x['Источник'] }; });
            var stock = r[1].map(function (x) { return { id: x._id, name: x['Остаток в машине'], qty: C.num(x['Количество']), min: C.num(x['Минимум']) }; });
            var plan = C.writeoffPlan(M.opts, moment, stock, mats);
            return Promise.all(plan.map(function (p) { return W.post('_m_set/' + p.id + '?JSON', { fields: { 'Количество': String(p.qty) } }); })).then(function () {
                return plan.length ? W.addEvent(order, 'Склад списан', (moment === 'act' ? 'при акте: ' : 'при закрытии: ') + plan.map(function (p) { return p.name + ' -' + W.right(p.used); }).join(', ')) : null;
            }).then(function () { return plan; });
        });
    };
    W.STATUS_CLS = { 'Новый': 'info', 'Назначен': 'info', 'В пути': 'warn', 'На объекте': 'warn', 'Ждёт запчасти': 'crit', 'Выполнен': 'ok', 'Закрыт': 'ok', 'Отменён': 'info' };
    W.opts = null; /* настройки текущего экрана: заполняет W.load */
    W.slaBadge = function (o) {
        var s = C.slaState(o, W.now(), W.opts), k = { ok: 'ok', risk: 'warn', late: 'crit', met: 'ok', missed: 'crit', none: 'info' }[s.state];
        return W.badge(s.text, k);
    };
})();
