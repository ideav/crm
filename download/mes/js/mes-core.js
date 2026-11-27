/* MES: чистые функции цеха (маршрут, очередь, прогноз срока, проверка отметки, сдельная). Без DOM и сети. */
(function (root) {
    'use strict';
    var C = {};
    C.DEFAULT_RULES = { shiftMin: 480, idleShare: 0.667, badShare: 0, hotDays: 2, loadPct: 85 };
    C.STATE = { wait: 'Ожидает', run: 'В работе', pause: 'Пауза', done: 'Выполнено' };
    C.CULPRITS = ['Материал', 'Предыдущий участок', 'Оборудование', 'Рабочий'];
    C.WORKER_FAULT = 'По вине рабочего';

    C.num = function (x) { var n = parseFloat(String(x === undefined || x === null ? '' : x).replace(',', '.').replace(/\s/g, '')); return isNaN(n) ? 0 : n; };
    /* Дата: 'ДД.ММ.ГГГГ' или 'ГГГГ-ММ-ДД' -> 'ГГГГ-ММ-ДД'. */
    C.toIso = function (s) {
        s = String(s || '').trim();
        var m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})/); if (m) return m[3] + '-' + m[2] + '-' + m[1];
        m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[0] : '';
    };
    C.toRu = function (iso) { var m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[3] + '.' + m[2] + '.' + m[1] : ''; };
    C.toShort = function (iso) { return C.toRu(iso).slice(0, 5); };
    C.addDays = function (iso, n) { var d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
    C.isWorkday = function (iso, hol) { var w = new Date(iso + 'T00:00:00Z').getUTCDay(); return w !== 0 && w !== 6 && !(hol && hol[iso]); };
    /* n-й рабочий день от iso (0 = сам iso, если рабочий, иначе ближайший следующий). */
    C.addWorkdays = function (iso, n, hol) {
        var d = iso; while (!C.isWorkday(d, hol)) d = C.addDays(d, 1);
        while (n > 0) { d = C.addDays(d, 1); if (C.isWorkday(d, hol)) n--; }
        return d;
    };
    C.workdaysBetween = function (from, to, hol) { var n = 0, d = from; if (to <= from) return 0; while (d < to) { d = C.addDays(d, 1); if (C.isWorkday(d, hol)) n++; } return n; };
    C.round = function (x, d) { var k = Math.pow(10, d || 0); return Math.round(C.num(x) * k) / k; };

    /* Правила цеха из справочника «Правило цеха» (по именам). */
    C.parseRules = function (rows) {
        var r = Object.assign({}, C.DEFAULT_RULES), by = {};
        (rows || []).forEach(function (x) { by[x.name] = C.num(x.value); });
        if (by['Длина смены, мин']) r.shiftMin = by['Длина смены, мин'];
        /* доли — целыми процентами: поле «Значение правила» целочисленное */
        if (by['Оплата простоя не по вине рабочего, % ставки'] !== undefined) r.idleShare = by['Оплата простоя не по вине рабочего, % ставки'] / 100;
        if (by['Брак по вине рабочего, % расценки'] !== undefined) r.badShare = by['Брак по вине рабочего, % расценки'] / 100;
        if (by['Горящий заказ, рабочих дней до срока']) r.hotDays = by['Горящий заказ, рабочих дней до срока'];
        if (by['Загрузка участка от нормы, %']) r.loadPct = by['Загрузка участка от нормы, %'];
        return r;
    };

    /* ---------- маршрут ---------- */
    /* Шаги маршрута изделия по порядку: [{op, step, norm}]. */
    C.routeOf = function (steps, product) {
        return (steps || []).filter(function (s) { return s.product === product; }).sort(function (a, b) { return a.step - b.step; });
    };
    /* Сменные задания из заказа: по шагу маршрута на операцию, в конец очереди своего участка. */
    C.routeTasks = function (order, steps, opSection, maxQueue) {
        var q = Object.assign({}, maxQueue || {});
        return C.routeOf(steps, order.product).map(function (s) {
            var sec = opSection[s.op] || '';
            q[sec] = (q[sec] || 0) + 1;
            return { no: 'СЗ-' + String(order.no).replace(/^\D+-?/, '') + '-' + s.step, order: order.no, op: s.op, section: sec, step: s.step, plan: order.qty, queue: q[sec], state: C.STATE.wait, norm: s.norm };
        });
    };

    /* ---------- факт и остатки ---------- */
    /* Сумма годных и брака по заданиям: {taskNo: {good, bad}}. */
    C.progress = function (marks) {
        var p = {};
        (marks || []).forEach(function (m) { var x = p[m.task] || (p[m.task] = { good: 0, bad: 0 }); x.good += C.num(m.good); x.bad += C.num(m.bad); });
        return p;
    };
    /* Сколько можно сделать на шаге сейчас: на первом — план минус сделанное, дальше — годные предыдущего шага минус обработанное. */
    C.available = function (task, prevTask, prog) {
        var me = prog[task.no] || { good: 0, bad: 0 }, used = me.good + me.bad;
        if (!prevTask) return Math.max(0, task.plan - used);
        var pv = prog[prevTask.no] || { good: 0, bad: 0 };
        return Math.max(0, Math.min(task.plan, pv.good) - used);
    };
    /* Осталось сделать на шаге (с учётом того, что брак выше по маршруту уменьшил вход). */
    C.remaining = function (task, prevChainGood, prog) {
        var me = prog[task.no] || { good: 0, bad: 0 };
        var cap = prevChainGood === undefined || prevChainGood === null ? task.plan : Math.min(task.plan, prevChainGood);
        return task.state === C.STATE.done ? 0 : Math.max(0, cap - me.good - me.bad);
    };
    /* Проверка отметки на терминале до записи. */
    C.checkMark = function (o) {
        var e = [], good = o.good === '' || o.good === undefined ? 0 : Number(o.good), bad = o.bad === '' || o.bad === undefined ? 0 : Number(o.bad);
        if (!isFinite(good) || !isFinite(bad) || good < 0 || bad < 0 || Math.floor(good) !== good || Math.floor(bad) !== bad) e.push('Количество — целое число штук, не меньше нуля');
        else if (good + bad === 0) e.push('Укажите выпуск или брак');
        else if (good + bad > o.avail) e.push('Больше, чем есть на операции: доступно ' + o.avail + ' шт');
        if (bad > 0 && !o.culprit) e.push('Укажите, по чьей вине брак: от этого зависит оплата');
        return e;
    };
    C.checkDown = function (o) {
        var e = [], m = Number(o.mins);
        if (!o.reason) e.push('Выберите причину простоя');
        if (!isFinite(m) || m <= 0 || Math.floor(m) !== m) e.push('Минуты простоя — целое число больше нуля');
        else if (m > (o.shiftMin || 480)) e.push('Простой длиннее смены');
        return e;
    };

    /* ---------- очередь и прогноз ---------- */
    /* Перестановка задания в очереди участка: tasks — задания участка, pos — новое место (1..n). Возвращает только изменённые [{no, queue}]. */
    C.reorder = function (tasks, no, pos) {
        var list = tasks.slice().sort(function (a, b) { return a.queue - b.queue; });
        var i = list.findIndex(function (t) { return t.no === no; }); if (i < 0) return [];
        var t = list.splice(i, 1)[0]; pos = Math.max(1, Math.min(list.length + 1, pos)); list.splice(pos - 1, 0, t);
        var out = [];
        list.forEach(function (x, k) { if (x.queue !== k + 1) out.push({ no: x.no, queue: k + 1 }); });
        return out;
    };
    /* Мощность участка, мин в смену: рабочие × длина смены × загрузка. */
    C.capacity = function (workers, rules) { return Math.max(1, workers) * rules.shiftMin * rules.loadPct / 100; };
    /* Остаток работы по заданиям (мин): {taskNo: минуты}. tasks с полями no, order, step, plan, state, norm. */
    C.remainMinutes = function (tasks, prog) {
        var byOrder = {}, out = {};
        tasks.forEach(function (t) { (byOrder[t.order] = byOrder[t.order] || []).push(t); });
        Object.keys(byOrder).forEach(function (o) {
            var chain = null;
            byOrder[o].sort(function (a, b) { return a.step - b.step; }).forEach(function (t) {
                var rest = C.remaining(t, chain, prog);
                out[t.no] = rest * C.num(t.norm);
                var me = prog[t.no] || { good: 0 };
                chain = t.state === C.STATE.done ? me.good : Math.min(chain === null ? t.plan : chain, t.plan) - (me.bad || 0);
            });
        });
        return out;
    };
    /* Прогноз выхода заказа по нормам и очередям участков.
       o: {order, today, due, steps:[{section, no?, queue?, step, qty, norm, done}], tasks (видимые задания), rem (remainMinutes), cap: {section: мин}, hol}
       Шаг ждёт и очередь своего участка перед ним, и окончания предыдущего шага. */
    C.forecast = function (o) {
        var t = 0, detail = [];
        o.steps.forEach(function (s) {
            if (s.done) return;
            var cap = o.cap[s.section] || 1, ahead = 0;
            (o.tasks || []).forEach(function (x) { if (x.section === s.section && s.queue && x.queue < s.queue && x.order !== o.order) ahead += o.rem[x.no] || 0; });
            var own = s.no && o.rem[s.no] !== undefined ? o.rem[s.no] : s.qty * s.norm;
            var start = Math.max(t, ahead / cap); t = start + own / cap;
            detail.push({ section: s.section, step: s.step, aheadMin: Math.round(ahead), ownMin: Math.round(own), endDays: C.round(t, 2) });
        });
        var finish = t <= 1 ? C.addWorkdays(o.today, 0, o.hol) : C.addWorkdays(o.today, Math.ceil(t) - 1, o.hol);
        return { days: C.round(t, 2), finish: finish, late: !!o.due && finish > o.due, detail: detail };
    };
    /* Горящий: не выпущен и до срока не больше hotDays рабочих дней (или срок прошёл). */
    C.isHot = function (due, today, rules, done) { if (done || !due) return false; return due < today || C.workdaysBetween(today, due) <= rules.hotDays; };

    /* ---------- сдельная ---------- */
    /* Расценка операции на дату: своя для изделия важнее общей, из действующих — последняя. */
    C.rateFor = function (rates, op, product, date) {
        var best = null;
        (rates || []).forEach(function (r) {
            if (r.op !== op || (r.product && r.product !== product) || (r.from && date && r.from > date)) return;
            var score = (r.product ? 2 : 1) * 1e9 + Number(String(r.from || '0000-00-00').replace(/-/g, ''));
            if (!best || score > best.score) best = { score: score, price: C.num(r.price) };
        });
        return best ? best.price : 0;
    };
    /* Начисление по отметке: годные по расценке; брак не по вине рабочего — как годные (ТК ст. 156), по его вине — доля badShare. */
    C.markPay = function (m, rate, rules) {
        var good = C.num(m.good), bad = C.num(m.bad), own = m.culprit === 'Рабочий';
        var badPaid = bad * rate * (own ? rules.badShare : 1);
        return { good: good * rate, bad: badPaid, total: good * rate + badPaid, badLoss: own ? bad * rate * (1 - rules.badShare) : 0 };
    };
    /* Оплата простоя: не по вине рабочего — idleShare тарифной ставки (ТК ст. 157), по его вине — 0. */
    C.downPay = function (d, tariff, kind, rules) { return kind === C.WORKER_FAULT ? 0 : C.num(d.mins) / 60 * C.num(tariff) * rules.idleShare; };
    /* Выработка по рабочим за период. ctx: {marks, downs, taskBy, workers, rates, reasonKind, rules, from, to}
       Принятое мастером — к выплате; «Ожидает» и «Спор» — отдельно, в расчёт к выплате не входят. */
    C.earnings = function (ctx) {
        var by = {};
        function row(w) { return by[w] || (by[w] = { worker: w, good: 0, bad: 0, normMin: 0, paid: 0, pending: 0, dispute: 0, badLoss: 0, idleMin: 0, idlePay: 0, lines: {} }); }
        (ctx.workers || []).forEach(function (w) { if (!ctx.only || ctx.only === w.name) row(w.name); });
        (ctx.marks || []).forEach(function (m) {
            if (m.date < ctx.from || m.date > ctx.to || (ctx.only && ctx.only !== m.worker)) return;
            var t = ctx.taskBy[m.task]; if (!t) return;
            var rate = C.rateFor(ctx.rates, t.op, t.product, m.date), p = C.markPay(m, rate, ctx.rules), r = row(m.worker);
            r.good += C.num(m.good); r.bad += C.num(m.bad); r.normMin += (C.num(m.good) + C.num(m.bad)) * C.num(t.norm);
            if (m.accept === 'Спор') r.dispute += p.total; else if (m.accept === 'Принято') r.paid += p.total; else r.pending += p.total;
            r.badLoss += p.badLoss;
            var k = t.op + '|' + t.product, l = r.lines[k] || (r.lines[k] = { op: t.op, product: t.product, rate: rate, qty: 0, sum: 0 });
            l.qty += C.num(m.good) + (m.culprit === 'Рабочий' ? 0 : C.num(m.bad)); l.sum += p.total;
        });
        (ctx.downs || []).forEach(function (d) {
            if (d.date < ctx.from || d.date > ctx.to || (ctx.only && ctx.only !== d.worker)) return;
            var w = (ctx.workers || []).filter(function (x) { return x.name === d.worker; })[0], r = row(d.worker);
            r.idleMin += C.num(d.mins); r.idlePay += C.downPay(d, w ? w.tariff : 0, ctx.reasonKind[d.reason], ctx.rules);
        });
        return Object.keys(by).map(function (k) { var r = by[k]; r.total = r.paid + r.idlePay; return r; });
    };
    /* Строки «Сдельного наряда» для 1С (CSV через «;»). */
    C.onecRows = function (rows, workers, period) {
        var tn = {}; (workers || []).forEach(function (w) { tn[w.name] = w.num; });
        var out = [['Период', 'Табельный номер', 'Сотрудник', 'Операция', 'Изделие', 'Количество', 'Расценка', 'Сумма'].join(';')];
        rows.forEach(function (r) {
            Object.keys(r.lines).sort().forEach(function (k) { var l = r.lines[k]; out.push([period, tn[r.worker] || '', r.worker, l.op, l.product, l.qty, String(l.rate).replace('.', ','), C.round(l.sum, 2).toFixed(2).replace('.', ',')].join(';')); });
            if (r.idlePay > 0) out.push([period, tn[r.worker] || '', r.worker, 'Оплата простоя (ст. 157 ТК)', '', r.idleMin + ' мин', '', C.round(r.idlePay, 2).toFixed(2).replace('.', ',')].join(';'));
        });
        return out;
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = C;
    root.MesCore = C;
})(typeof window !== 'undefined' ? window : this);
