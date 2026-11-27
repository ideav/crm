/* ТОиР: чистые функции расчётов и проверок (без DOM и сети). Работает в браузере (window.ToirCore) и в node (module.exports). */
(function (root) {
    'use strict';
    var C = {};
    C.num = function (x) { if (x === null || x === undefined || x === '') return 0; var n = parseFloat(String(x).replace(/\s/g, '').replace(',', '.')); return isNaN(n) ? 0 : n; };
    C.has = function (x) { return x !== null && x !== undefined && String(x).trim() !== ''; };
    /* Дата: «ДД.ММ.ГГГГ» или ISO -> ISO «ГГГГ-ММ-ДД». */
    C.toIso = function (s) {
        if (!s) return '';
        s = String(s).trim();
        var m = /^(\d{2})\.(\d{2})\.(\d{4})/.exec(s);
        if (m) return m[3] + '-' + m[2] + '-' + m[1];
        m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
        return m ? m[0] : '';
    };
    C.addDays = function (iso, n) { var t = new Date(iso + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
    C.daysBetween = function (a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5); };
    C.short = function (iso) { return iso ? iso.slice(8, 10) + '.' + iso.slice(5, 7) : ''; };
    C.ru = function (iso) { return iso ? iso.slice(8, 10) + '.' + iso.slice(5, 7) + '.' + iso.slice(0, 4) : ''; };
    C.month = function (iso) { return iso ? iso.slice(0, 7) : ''; };
    C.OPEN = { 'Новый': 1, 'Принят': 1, 'В ведомости': 1, 'В ремонте': 1 };
    C.isOpen = function (d) { return !!C.OPEN[d.status]; };

    /* Пункт чек-листа: показание против нормы. Ответ {ok, excess} — excess: на сколько вышли за границу, доля диапазона нормы (или верхней границы). */
    C.checkReading = function (item, value) {
        if (item.kind !== 'Показание') return { ok: true, excess: 0, empty: false };
        if (!C.has(value)) return { ok: false, excess: 0, empty: true };
        var v = C.num(value), lo = C.has(item.lo) ? C.num(item.lo) : null, hi = C.has(item.hi) ? C.num(item.hi) : null;
        var base = hi !== null && hi > 0 ? (lo !== null && lo > 0 ? hi - lo : hi) : 1;
        if (hi !== null && v > hi) return { ok: false, excess: (v - hi) / base, side: 'high', empty: false };
        if (lo !== null && lo > 0 && v < lo) return { ok: false, excess: (lo - v) / base, side: 'low', empty: false };
        return { ok: true, excess: 0, empty: false };
    };
    /* Тренд показаний (по возрастанию даты): за последние 4 замера рост, из трёх шагов не меньше двух вверх, последнее выше 85% верхней границы. */
    C.trend = function (vals, hi) {
        var v = (vals || []).map(C.num);
        if (v.length < 4 || !C.has(hi)) return null;
        var n = v.length, steps = (v[n - 1] > v[n - 2]) + (v[n - 2] > v[n - 3]) + (v[n - 3] > v[n - 4]), up = v[n - 1] > v[n - 4] && steps >= 2;
        if (up && v[n - 1] >= 0.85 * C.num(hi) && v[n - 1] <= C.num(hi)) return 'Растёт и подходит к пределу ' + hi;
        return null;
    };
    /* Подсказка критичности замечания. kind: reading | leak | stop | other; eqClass: A/B/C. */
    C.suggestCriticality = function (o) {
        o = o || {};
        if (o.kind === 'stop') return 'Аварийная';
        if ((o.kind === 'reading' && o.excess > 0.3) || ((o.kind === 'leak' || o.kind === 'reading') && o.eqClass === 'A' && o.excess > 0.1) || (o.kind === 'leak' && o.eqClass === 'A')) return 'Высокая';
        if (o.kind === 'reading' || o.kind === 'leak' || o.eqClass === 'A') return 'Средняя';
        return 'Низкая';
    };
    /* Вид замечания по тексту: течь, остановка или прочее. */
    C.remarkKind = function (text) {
        var t = String(text || '').toLowerCase();
        if (/встал|останов|не работает|заклин|авари|искр|дым|возгоран/.test(t)) return 'stop';
        if (/теч|подтека|капает|лужа|утечк/.test(t)) return 'leak';
        return 'other';
    };
    C.dueDate = function (found, critDays) { return C.addDays(found, Math.max(0, Math.round(C.num(critDays)))); };
    /* Состояние дефекта на дату: просрочен, дней до срока, без ответа автору. */
    C.defectState = function (d, today) {
        var open = C.isOpen(d), left = d.due ? C.daysBetween(today, d.due) : null;
        return { open: open, overdue: open && left !== null && left < 0, left: left, silent: open && !C.has(d.answer) };
    };
    /* Номер дефекта с телефона: дата и время, чтобы не зависеть от чужих номеров под маской. */
    C.defectNo = function (iso, time) { return 'Д-' + iso.slice(2, 4) + iso.slice(5, 7) + iso.slice(8, 10) + '-' + String(time || '').replace(/\D/g, '').slice(0, 6); };
    C.nextNo = function (prefix, names, width) {
        var mx = 0; (names || []).forEach(function (s) { var m = new RegExp('^' + prefix + '(\\d+)$').exec(s); if (m) mx = Math.max(mx, +m[1]); });
        var s = String(mx + 1); while (s.length < (width || 4)) s = '0' + s; return prefix + s;
    };
    /* Замечания обходов, по которым нет дефекта (ни ссылкой, ни дефектом того же узла в 3 дня после). */
    C.remarksWithoutDefect = function (marks, defects) {
        var linked = {}; (defects || []).forEach(function (d) { if (d.mark) linked[d.mark] = 1; });
        return (marks || []).filter(function (m) {
            if (m.result !== 'Замечание' || linked[m.id]) return false;
            return !(defects || []).some(function (d) { return d.eq === m.eq && d.found >= m.date && C.daysBetween(m.date, d.found) <= 3; });
        });
    };
    /* Ход обхода: сколько точек отмечено полностью, замечаний. */
    C.routeProgress = function (points, items, marks) {
        var byEq = {}; (marks || []).forEach(function (m) { (byEq[m.eq] = byEq[m.eq] || {})[m.item] = m; });
        var done = 0, remarks = 0;
        (points || []).forEach(function (p) { var need = (items[p.type] || []).length, got = Object.keys(byEq[p.eq] || {}).length; if (need && got >= need) done++; });
        (marks || []).forEach(function (m) { if (m.result === 'Замечание') remarks++; });
        return { done: done, total: (points || []).length, remarks: remarks };
    };

    /* Свободный остаток запчасти: на складе минус резерв других нарядов. */
    C.free = function (p) { return Math.max(0, C.num(p.stock) - C.num(p.reserved)); };
    /* Ведомость на останов: открытые дефекты узлов линии и ППР, которые подходят к сроку до конца останова + 14 дней.
       o = {stop, eq:{имя:{line,type}}, defects, ppr, works:{имя:{hours,prof,stop}}, norms:{работа:[{part,qty}]}, parts:{имя:{stock,reserved,lead}}, today} */
    C.statement = function (o) {
        var st = o.stop, rows = [], need = {}, hoursBy = {}, total = 0;
        function add(kind, ref, eqName, workName, extra) {
            var w = o.works[workName] || null, hrs = w ? C.num(w.hours) : 0;
            var r = Object.assign({ kind: kind, ref: ref, eq: eqName, work: workName || '', hours: hrs, prof: w ? w.prof : '', needStop: w ? w.stop === 'Да' : false, parts: [] }, extra || {});
            (o.norms[workName] || []).forEach(function (n) { r.parts.push({ part: n.part, qty: C.num(n.qty) }); need[n.part] = (need[n.part] || 0) + C.num(n.qty); });
            total += hrs; if (r.prof) hoursBy[r.prof] = (hoursBy[r.prof] || 0) + hrs;
            rows.push(r);
        }
        (o.defects || []).forEach(function (d) {
            var e = o.eq[d.eq]; if (!e || e.line !== st.line || !C.isOpen(d)) return;
            if (d.stop && d.stop !== st.name) return;
            add('defect', d.name, d.eq, d.work, { crit: d.crit, due: d.due, found: d.found, status: d.status, text: d.text, id: d.id, overdue: d.due && d.due < o.today });
        });
        var horizon = C.addDays(st.to || st.from, 14);
        (o.ppr || []).forEach(function (p) {
            var e = o.eq[p.eq]; if (!e || e.line !== st.line || !p.plan || p.plan > horizon) return;
            add('ppr', p.name, p.eq, p.work, { due: p.plan, id: p.id, overdue: p.plan < o.today });
        });
        var order = { 'Аварийная': 1, 'Высокая': 2, 'Средняя': 3, 'Низкая': 4 };
        rows.sort(function (a, b) { return (a.kind === b.kind ? 0 : a.kind === 'defect' ? -1 : 1) || (order[a.crit] || 9) - (order[b.crit] || 9) || String(a.due).localeCompare(String(b.due)); });
        var deadline = C.addDays(st.from, -1), parts = Object.keys(need).sort().map(function (name) {
            var p = o.parts[name] || { stock: 0, reserved: 0, lead: 0 }, free = C.free(p), short = Math.max(0, need[name] - free);
            var arrive = C.addDays(o.today, C.num(p.lead));
            var state = short === 0 ? 'ok' : arrive <= deadline ? 'order' : 'late';
            return { part: name, need: need[name], stock: C.num(p.stock), reserved: C.num(p.reserved), free: free, short: short, lead: C.num(p.lead), arrive: arrive, state: state };
        });
        var late = parts.filter(function (p) { return p.state === 'late'; }).map(function (p) { return p.part; });
        rows.forEach(function (r) { r.blocked = r.parts.some(function (x) { return late.indexOf(x.part) >= 0; }); });
        return { rows: rows, parts: parts, hours: total, hoursBy: hoursBy, stopHours: C.num(st.hours), late: late, orderToday: parts.filter(function (p) { return p.state === 'order'; }).length, overHours: total > C.num(st.hours) * 3 };
    };
    /* ППР: состояние на дату. */
    C.pprState = function (p, today) {
        if (!p.plan) return 'none';
        if (p.stop) return 'stop';
        var d = C.daysBetween(today, p.plan);
        return d < 0 ? 'overdue' : d <= 7 ? 'soon' : 'plan';
    };
    /* Перестроить ППР под останов: работы с плановой датой до конца останова + 14 дней переходят на дату начала останова. */
    C.pprToStop = function (ppr, stop, eqLine) {
        var horizon = C.addDays(stop.to || stop.from, 14);
        return (ppr || []).filter(function (p) { return eqLine[p.eq] === stop.line && p.plan && p.plan <= horizon && p.plan !== stop.from; })
            .map(function (p) { return { id: p.id, name: p.name, from: p.plan, to: stop.from }; });
    };
    /* Доля в срок: [{due, done}] -> {n, ok, pct}. */
    C.onTime = function (list) {
        var n = 0, ok = 0; (list || []).forEach(function (x) { if (!x.done || !x.due) return; n++; if (x.done <= x.due) ok++; });
        return { n: n, ok: ok, pct: n ? Math.round(ok / n * 100) : null };
    };
    /* Простои по месяцам и причинам. */
    C.downtimeByMonth = function (downs) {
        var m = {}; (downs || []).forEach(function (d) { var k = C.month(d.date); m[k] = m[k] || { 'Авария': 0, 'Нет запчасти': 0, 'Плановый ремонт': 0 }; m[k][d.cause] = (m[k][d.cause] || 0) + C.num(d.hours); });
        return m;
    };
    C.downtimeCost = function (downs, cost, cause) {
        return (downs || []).reduce(function (s, d) { return s + (cause && d.cause !== cause ? 0 : C.num(d.hours) * C.num(cost[d.eq])); }, 0);
    };
    /* Аварии, о которых предупреждал обход: замечание по тому же узлу за 30 дней до аварии, дефект по нему не заведён. */
    C.missedWarnings = function (downs, marks, defects) {
        var free = C.remarksWithoutDefect(marks, defects);
        return (downs || []).filter(function (d) { return d.cause === 'Авария'; }).map(function (d) {
            var m = free.filter(function (x) { return x.eq === d.eq && x.date < d.date && C.daysBetween(x.date, d.date) <= 30; })[0];
            return m ? { down: d, mark: m, days: C.daysBetween(m.date, d.date) } : null;
        }).filter(Boolean);
    };
    /* Выгрузка нарядов в 1С: выполненные и ещё не выгруженные, CSV с разделителем «;». */
    C.export1C = function (orders, eqCode, partsBy) {
        var rows = (orders || []).filter(function (o) { return o.status === 'Выполнен' && !o.exported; });
        var q = function (s) { s = String(s === undefined || s === null ? '' : s); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
        var lines = ['Номер наряда;Дата выполнения;Код оборудования 1С;Оборудование;Вид работ;Часов;Исполнитель;Запчасти'];
        rows.forEach(function (o) {
            var parts = ((partsBy && partsBy[o.name]) || []).map(function (p) { return p.part + ' x ' + p.qty; }).join(', ');
            lines.push([o.name, C.ru(o.done), eqCode[o.eq] || '', o.eq, o.work, String(C.num(o.hours)).replace('.', ','), o.exec, parts].map(q).join(';'));
        });
        return { rows: rows, csv: lines.join('\r\n') };
    };
    /* Очередь без сети: отметки копятся и уходят по одной, когда сеть есть. */
    C.queueAdd = function (q, item) { return (q || []).concat([Object.assign({ qid: 'q' + ((q || []).length + 1) + '-' + Date.now() }, item)]); };
    C.queueDrop = function (q, qid) { return (q || []).filter(function (x) { return x.qid !== qid; }); };

    if (typeof module !== 'undefined' && module.exports) module.exports = C; else root.ToirCore = C;
})(typeof window !== 'undefined' ? window : this);
