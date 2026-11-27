/* BI-сводка: чистые функции (периоды, план-факт, свежесть источников, разбор файла по формату, сверка лидов, отклонения). Без DOM и сети: работает и в браузере, и в Node. */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.BisysCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    var DAY = 86400000;
    var RETURN = 'Возврат';
    var OK_LOAD = { 'Успешно': 1, 'С отказами': 1 };

    function num(x) { if (x === null || x === undefined || x === '') return 0; var n = parseFloat(String(x).replace(/\s/g, '').replace(',', '.')); return isNaN(n) ? 0 : n; }
    function round1(x) { return Math.round(x * 10) / 10; }
    function utc(s) { var p = s.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
    function iso(t) { var d = new Date(t); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0'); }
    function addDays(s, n) { return iso(utc(s) + n * DAY); }
    function diffDays(a, b) { return Math.round((utc(b) - utc(a)) / DAY); }
    /* «25.11.2026», «2026-11-25», «2026-11-25 10:00» → «2026-11-25»; пустое → '' */
    function toIso(s) {
        if (!s) return '';
        s = String(s).trim();
        var m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
        if (m) return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
        m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
        return m ? m[0] : '';
    }
    function toShort(s) { var p = String(s).split('-'); return p.length === 3 ? p[2] + '.' + p[1] : s; }
    function toDmy(s) { var p = String(s).split('-'); return p.length === 3 ? p[2] + '.' + p[1] + '.' + p[0] : s; }
    function monthStart(s) { return s.slice(0, 8) + '01'; }
    function daysInMonth(s) { var p = s.split('-'); return new Date(Date.UTC(+p[0], +p[1], 0)).getUTCDate(); }
    function inRange(d, from, to) { return !!d && d >= from && d <= to; }

    /* Период сводки относительно «сегодня»: вчера, 7 дней по вчера, месяц с 1-го по вчера. */
    function period(kind, today) {
        var y = addDays(today, -1);
        if (kind === 'yesterday') return { kind: kind, from: y, to: y, label: 'вчера, ' + toDmy(y) };
        if (kind === 'week') return { kind: kind, from: addDays(y, -6), to: y, label: '7 дней, ' + toShort(addDays(y, -6)) + '–' + toShort(y) };
        var f = monthStart(y);
        return { kind: 'month', from: f, to: y, label: 'месяц, ' + toShort(f) + '–' + toShort(y) };
    }
    /* Итоги по документам: выручка с возвратами (минусом), себестоимость, валовая прибыль, число продаж. */
    function totals(docs) {
        var t = { revenue: 0, cost: 0, gp: 0, sales: 0, returns: 0, docs: 0 };
        (docs || []).forEach(function (d) {
            t.revenue += num(d.sum); t.cost += num(d.cost); t.docs++;
            if (d.kind === RETURN) t.returns++; else t.sales++;
        });
        t.gp = t.revenue - t.cost;
        t.margin = t.revenue ? round1(t.gp / t.revenue * 100) : null;
        t.avgCheck = t.sales ? Math.round(t.revenue / t.sales) : 0;
        return t;
    }
    function filterDocs(docs, o) {
        o = o || {};
        return (docs || []).filter(function (d) {
            return (!o.from || d.date >= o.from) && (!o.to || d.date <= o.to) && (!o.sub || d.sub === o.sub) && (!o.source || d.source === o.source) && (!o.load || d.load === o.load);
        });
    }
    /* План на период: месячный план делится по дням поровну (план на 25 дней ноября = 25/30 месячного). */
    function planFor(plans, from, to, sub) {
        var r = { revenue: 0, gp: 0 };
        (plans || []).forEach(function (p) {
            if (sub && p.sub !== sub) return;
            var ms = monthStart(p.month), dim = daysInMonth(ms), me = addDays(ms, dim - 1);
            var a = from > ms ? from : ms, b = to < me ? to : me;
            if (a > b) return;
            var k = (diffDays(a, b) + 1) / dim;
            r.revenue += num(p.revenue) * k; r.gp += num(p.gp) * k;
        });
        r.revenue = Math.round(r.revenue); r.gp = Math.round(r.gp);
        return r;
    }
    function devPct(fact, plan) { return plan ? round1((fact - plan) / plan * 100) : null; }
    /* Прогноз месяца по темпу: факт с 1-го по вчера, растянутый на все дни месяца. */
    function forecastMonth(fact, today) {
        var y = addDays(today, -1), passed = diffDays(monthStart(y), y) + 1;
        return passed ? Math.round(fact / passed * daysInMonth(y)) : 0;
    }

    /* Свежесть источников. Источник свежий, если последняя удачная загрузка покрывает вчера
       (для ежедневных) или текущий месяц (для ежемесячных). asOf — время последней удачной загрузки сегодня. */
    function freshness(sources, loads, today) {
        var y = addDays(today, -1), asOf = '';
        var list = (sources || []).map(function (s) {
            var own = (loads || []).filter(function (l) { return l.source === s.name; });
            own.sort(function (a, b) { return (a.date + a.time) < (b.date + b.time) ? 1 : -1; });
            var good = own.filter(function (l) { return OK_LOAD[l.status]; });
            var lastGood = good[0] || null, last = own[0] || null;
            var maxFor = good.reduce(function (m, l) { return l.dataFor > m ? l.dataFor : m; }, '');
            var need = s.freq === 'Ежемесячно' ? monthStart(y) : y;
            var fresh = !!maxFor && maxFor >= need;
            if (lastGood && lastGood.date === today && lastGood.time > asOf) asOf = lastGood.time;
            return { name: s.name, freq: s.freq, at: s.at, fresh: fresh, dataFor: maxFor, lastGood: lastGood, last: last, failed: !!last && !OK_LOAD[last.status] };
        });
        var n = list.filter(function (x) { return x.fresh; }).length;
        return { list: list, fresh: n, total: list.length, asOf: asOf, stale: list.filter(function (x) { return !x.fresh; }) };
    }
    /* Последний день, за который у подразделения есть данные (для пометки «нет данных за …»). */
    function lastDataDay(docs, sub) {
        return (docs || []).reduce(function (m, d) { return d.sub === sub && d.date > m ? d.date : m; }, '');
    }
    /* План-факт по подразделениям за период. thr — порог отклонения в % (из каталога метрик). */
    function planFact(subs, docs, plans, from, to, thr) {
        thr = thr || {};
        return (subs || []).map(function (s) {
            var t = totals(filterDocs(docs, { from: from, to: to, sub: s.name })), p = planFor(plans, from, to, s.name);
            var last = lastDataDay(docs, s.name);
            var r = { sub: s.name, type: s.type, fact: t.revenue, plan: p.revenue, dev: devPct(t.revenue, p.revenue), gp: t.gp, gpPlan: p.gp, gpDev: devPct(t.gp, p.gp), margin: t.margin, sales: t.sales, avgCheck: t.avgCheck, missingFrom: last && last < to ? addDays(last, 1) : '' };
            r.flags = [];
            if (r.dev !== null && r.dev <= -(thr['Выручка'] || 5)) r.flags.push('Выручка');
            if (r.gpDev !== null && r.gpDev <= -(thr['Валовая прибыль'] || 5)) r.flags.push('Валовая прибыль');
            return r;
        });
    }
    /* Главные отклонения: худшие строки план-факта ниже порога, с карточкой отклонения, если она заведена. */
    function topDeviations(pf, cards, n) {
        var out = [];
        (pf || []).forEach(function (r) {
            r.flags.forEach(function (m) {
                var card = (cards || []).filter(function (c) { return c.sub === r.sub && c.metric === m; })[0] || null;
                out.push({ sub: r.sub, metric: m, dev: m === 'Выручка' ? r.dev : r.gpDev, fact: m === 'Выручка' ? r.fact : r.gp, plan: m === 'Выручка' ? r.plan : r.gpPlan, card: card, commented: !!(card && String(card.comment || '').trim()), missingFrom: r.missingFrom });
            });
        });
        out.sort(function (a, b) { return a.dev - b.dev; });
        return n ? out.slice(0, n) : out;
    }
    /* Выручка по дням периода (для графика). */
    function daily(docs, from, to) {
        var by = {}; (docs || []).forEach(function (d) { if (inRange(d.date, from, to)) by[d.date] = (by[d.date] || 0) + num(d.sum); });
        var out = [], d = from;
        while (d <= to) { out.push({ d: d, v: Math.round(by[d] || 0) }); d = addDays(d, 1); }
        return out;
    }
    /* Раскрытие цифры: группы по ключу документа (source, sub, load, date) с итогами. */
    function groupBy(docs, key) {
        var m = {}, order = [];
        (docs || []).forEach(function (d) { var k = d[key] || '—'; if (!m[k]) { m[k] = []; order.push(k); } m[k].push(d); });
        return order.map(function (k) { var t = totals(m[k]); t.key = k; return t; }).sort(function (a, b) { return b.revenue - a.revenue; });
    }

    /* ---------- загрузка файла по сохранённому формату ---------- */
    function parseFormat(f) {
        var r = { name: f.name || '', delim: f.delim || ';', cols: [], map: {}, rules: [] };
        String(f.cols || '').split(/\r?\n/).forEach(function (l) { var p = l.split('='); if (p.length === 2 && p[0].trim()) r.cols.push({ file: p[0].trim(), field: p[1].trim() }); });
        String(f.rules || '').split(/\r?\n/).forEach(function (l) {
            l = l.trim(); if (!l) return;
            var m = l.match(/^Соответствие:\s*(.+?)\s*→\s*(.+)$/);
            if (m) r.map[m[1]] = m[2]; else r.rules.push(l);
        });
        return r;
    }
    function splitLine(line, delim) {
        var out = [], cur = '', q = false;
        for (var i = 0; i < line.length; i++) {
            var ch = line[i];
            if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
            else if (ch === delim && !q) { out.push(cur); cur = ''; }
            else cur += ch;
        }
        out.push(cur);
        return out.map(function (x) { return x.trim(); });
    }
    function strictNum(s) { var t = String(s || '').replace(/[\s ]/g, '').replace(',', '.'); return /^-?\d+(\.\d+)?$/.test(t) ? parseFloat(t) : null; }
    /* Проверка файла: ctx = {subs: [имена], existing: {номер: 1}, from, to}. Возвращает принятые записи и отказы с причиной. */
    function checkFile(text, fmt, ctx) {
        var lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/);
        var head = splitLine(lines[0] || '', fmt.delim), idx = {}, res = { accepted: [], rejected: [], total: 0, missingCols: [] };
        fmt.cols.forEach(function (c) { var i = head.indexOf(c.file); if (i < 0) res.missingCols.push(c.file); else idx[c.field] = i; });
        if (res.missingCols.length) return res;
        var subs = {}; (ctx.subs || []).forEach(function (s) { subs[s] = 1; });
        var seen = {}, mainField = fmt.cols[0].field;
        for (var n = 1; n < lines.length; n++) {
            if (!lines[n].trim()) continue;
            res.total++;
            var v = splitLine(lines[n], fmt.delim), why = '';
            var get = function (f) { return idx[f] === undefined ? '' : (v[idx[f]] || ''); };
            var no = get(mainField), date = toIso(get('Дата документа')), sum = strictNum(get('Сумма документа'));
            var wh = get('Подразделение'), sub = subs[wh] ? wh : fmt.map[wh] || '';
            if (v.length < head.length) why = 'Колонок ' + v.length + ' из ' + head.length;
            else if (!no) why = 'Нет номера документа';
            else if (seen[no]) why = 'Номер ' + no + ' уже есть в файле (строка ' + seen[no] + ')';
            else if (ctx.existing && ctx.existing[no]) why = 'Документ ' + no + ' уже загружен раньше';
            else if (!date) why = 'Дата не распознана: «' + get('Дата документа') + '»';
            else if (!inRange(date, ctx.from, ctx.to)) why = 'Дата ' + toDmy(date) + ' вне периода загрузки ' + (ctx.from === ctx.to ? toDmy(ctx.from) : toDmy(ctx.from) + '–' + toDmy(ctx.to));
            else if (sum === null) why = 'Сумма не число: «' + get('Сумма документа') + '»';
            else if (sum === 0) why = 'Сумма равна нулю';
            else if (!sub) why = 'Подразделение «' + wh + '» нет в справочнике и в соответствиях формата';
            if (no && !seen[no]) seen[no] = n + 1;
            if (why) { res.rejected.push({ line: n + 1, why: why, raw: lines[n] }); continue; }
            var cost = strictNum(get('Себестоимость документа'));
            res.accepted.push({ no: no, date: date, sub: sub, sum: sum, cost: cost === null ? 0 : cost, pos: strictNum(get('Позиций в документе')) || 1, kind: sum < 0 ? RETURN : (get('Вид документа') || 'Продажа') });
        }
        return res;
    }
    /* Демо-файл Ozon за 25.11: 40 строк, 12 из них с ошибками разных видов. */
    function demoOzonCsv() {
        var L = ['Номер отправления;Дата;Склад;Сумма;Себестоимость с комиссией;Товаров;Статус'];
        for (var i = 0; i < 28; i++) {
            var sum = 1490 + (i * 397) % 2900, ret = i % 10 === 7;
            L.push('OZ-7412' + (9001 + i) + '-1;25.11.2026;' + (i % 3 ? 'Ozon FBO Москва' : 'Ozon FBO Ярославль') + ';' + (ret ? -sum : sum) + ';' + (ret ? -Math.round(sum * 0.5) + 190 : Math.round(sum * 0.66)) + ';' + (1 + i % 3) + ';' + (ret ? 'Возврат' : 'Отправление'));
        }
        L.push('OZ-74129003-1;25.11.2026;Ozon FBO Москва;2210;1460;1;Отправление');
        L.push('OZ-74129010-1;25.11.2026;Ozon FBO Москва;1990;1310;1;Отправление');
        L.push('OZ-74120310-1;25.11.2026;Ozon FBO Москва;2380;1570;1;Отправление');
        L.push('OZ-74129101-1;24.11.2026;Ozon FBO Москва;1750;1150;1;Отправление');
        L.push('OZ-74129102-1;24.11.2026;Ozon FBO Ярославль;3120;2060;2;Отправление');
        L.push('OZ-74129103-1;25.11.2026;Ozon FBO Москва;2 49О;1640;1;Отправление');
        L.push('OZ-74129104-1;25.11.2026;Ozon FBO Москва;—;0;1;Отправление');
        L.push('OZ-74129105-1;25.11.2026;Ozon FBO Москва;0;0;1;Отправление');
        L.push('OZ-74129106-1;25.11.2026;Ozon FBO Ярославль;0,00;0;1;Отправление');
        L.push('OZ-74129107-1;25.11.2026;Ozon FBS Казань;2650;1750;1;Отправление');
        L.push('OZ-74129108-1;25.11.2026;Ozon FBS Казань;1820;1200;1;Отправление');
        L.push(';25.11.2026;Ozon FBO Москва;1590;1050;1;Отправление');
        return L.join('\n');
    }

    /* ---------- сверка лидов маркетинга и продаж ---------- */
    function normPhone(p) { var d = String(p || '').replace(/\D/g, ''); if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1); return d; }
    function isJunk(lead) {
        var d = normPhone(lead.phone), tail = d.slice(4);
        if (d.length !== 11) return 'номер неполный';
        if (/^(\d)\1+$/.test(tail)) return 'номер-заглушка';
        if (/1234567|2345678|3456789/.test(d)) return 'номер-заглушка';
        if (/тест|бот|спам/i.test(lead.comment || '')) return 'тест или спам';
        return '';
    }
    var REASONS = {
        dup: { side: 'mk', label: 'Повторная заявка того же человека', why: 'Маркетинг считает каждую отправку формы, Битрикс24 склеивает повторы по телефону в один лид' },
        junk: { side: 'mk', label: 'Спам, тест, неполный номер', why: 'Продажи удаляют нецелевые обращения, в отчёте маркетинга они остаются' },
        late: { side: 'mk', label: 'Другой период: лид создан после конца периода', why: 'Маркетинг считает по дате клика, Битрикс24 — по дате создания лида' },
        lost: { side: 'mk', label: 'Не дошли до Битрикс24', why: 'Заявка есть у маркетинга, в Битрикс24 её нет ни в каком периоде — проверить интеграцию формы' },
        early: { side: 'sales', label: 'Другой период: клик был до начала периода', why: 'Маркетинг отнёс лид к прошлому месяцу по дате клика' },
        offline: { side: 'sales', label: 'Звонки и визиты без рекламы', why: 'Лиды из звонков в магазин и шоурума: в отчёт маркетинга не попадают по определению' }
    };
    function reconcileLeads(mk, sales, from, to) {
        var by = function (arr) { var m = {}; arr.forEach(function (l) { var p = normPhone(l.phone); (m[p] = m[p] || []).push(l); }); return m; };
        var mkIn = mk.filter(function (l) { return inRange(l.date, from, to); }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
        var saIn = sales.filter(function (l) { return inRange(l.date, from, to); });
        var saInBy = by(saIn), saAllBy = by(sales), mkAllBy = by(mk), mkOk = {};
        var res = { mkCount: mkIn.length, salesCount: saIn.length, matched: 0, groups: {} };
        Object.keys(REASONS).forEach(function (k) { res.groups[k] = { key: k, side: REASONS[k].side, label: REASONS[k].label, why: REASONS[k].why, items: [] }; });
        var seen = {};
        mkIn.forEach(function (l) {
            var p = normPhone(l.phone), j = isJunk(l), g;
            if (j) g = 'junk';
            else if (seen[p]) g = 'dup';
            else if (saInBy[p]) { seen[p] = 1; mkOk[p] = 1; res.matched++; return; }
            else if ((saAllBy[p] || []).some(function (s) { return s.date > to; })) g = 'late';
            else g = 'lost';
            if (!j) seen[p] = 1;
            res.groups[g].items.push({ lead: l, pair: (saAllBy[p] || [])[0] || (g === 'dup' ? mkIn.filter(function (x) { return normPhone(x.phone) === p; })[0] : null), note: j || '' });
        });
        saIn.forEach(function (l) {
            var p = normPhone(l.phone);
            if (mkOk[p]) return;
            var early = (mkAllBy[p] || []).filter(function (m) { return m.date < from; })[0];
            res.groups[early ? 'early' : 'offline'].items.push({ lead: l, pair: early || null, note: '' });
        });
        res.list = Object.keys(res.groups).map(function (k) { return res.groups[k]; }).filter(function (g) { return g.items.length; });
        return res;
    }

    /* ---------- отклонения ---------- */
    var COMMENT_MIN = 20;
    function checkComment(text) {
        var t = String(text || '').trim();
        if (!t) return 'Комментарий обязателен: без причины отклонение не закрыть и не отметить разобранным';
        if (t.length < COMMENT_MIN) return 'Слишком коротко: напишите причину и что делаем (не меньше ' + COMMENT_MIN + ' знаков)';
        if (t.split(/\s+/).length < 3) return 'Нужна причина своими словами: хотя бы три слова';
        return '';
    }
    /* Следующий статус: Новое → Прокомментировано → Закрыто. Без комментария — ошибка. */
    function nextStatus(cur, comment) {
        var e = checkComment(comment);
        if (e) return { ok: false, error: e };
        return { ok: true, status: cur === 'Прокомментировано' ? 'Закрыто' : 'Прокомментировано' };
    }
    function signalText(d, money) {
        money = money || function (x) { return Math.round(x) + ' ₽'; };
        return d.sub + ': ' + d.metric.toLowerCase() + ' ' + (d.dev < 0 ? 'ниже' : 'выше') + ' плана на ' + Math.abs(d.dev).toString().replace('.', ',') + '% (факт ' + money(d.fact) + ', план ' + money(d.plan) + ').' + (d.commented ? ' Причина: ' + d.card.comment : ' Комментария нет — нужен до конца дня.');
    }
    /* Откат загрузки: удалить её документы и саму запись журнала. */
    function rollbackOps(loadRid, docs) {
        var ops = (docs || []).filter(function (d) { return d.loadRid === loadRid; }).map(function (d) { return { op: 'del', id: d.rid }; });
        ops.push({ op: 'del', id: loadRid });
        return ops;
    }
    function nextCode(list, prefix, width) {
        var max = 0; (list || []).forEach(function (s) { var m = String(s).match(/(\d+)$/); if (String(s).indexOf(prefix) === 0 && m && +m[1] > max) max = +m[1]; });
        return prefix + String(max + 1).padStart(width || 4, '0');
    }

    return {
        RETURN: RETURN, REASONS: REASONS, COMMENT_MIN: COMMENT_MIN, num: num, round1: round1, iso: iso, addDays: addDays, diffDays: diffDays, toIso: toIso, toShort: toShort, toDmy: toDmy, monthStart: monthStart, daysInMonth: daysInMonth, inRange: inRange,
        period: period, totals: totals, filterDocs: filterDocs, planFor: planFor, devPct: devPct, forecastMonth: forecastMonth, freshness: freshness, lastDataDay: lastDataDay, planFact: planFact, topDeviations: topDeviations, daily: daily, groupBy: groupBy,
        parseFormat: parseFormat, splitLine: splitLine, strictNum: strictNum, checkFile: checkFile, demoOzonCsv: demoOzonCsv, normPhone: normPhone, isJunk: isJunk, reconcileLeads: reconcileLeads,
        checkComment: checkComment, nextStatus: nextStatus, signalText: signalText, rollbackOps: rollbackOps, nextCode: nextCode
    };
});
