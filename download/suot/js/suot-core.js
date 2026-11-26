/* СУОТ и учёт СИЗ: чистые функции (сроки, комплект по нормам, инструктажи и обучение, медосмотры, допуск к работам, наряд-допуск, выдача со склада, сводка). Без DOM и сети: работает и в браузере, и в Node. */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.SuotCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    var DAY = 86400000;
    /* Правила по умолчанию; в базе их переопределяет таблица «Правило ОТ». */
    var DEFAULT_RULES = { warnDays: 30, repeatMonths: 6, newbieRepeatMonths: 3, newbieDays: 365, earlyIssueDays: 30 };
    var RULE_NAMES = {
        'Горизонт предупреждения, дней': 'warnDays',
        'Повторный инструктаж, мес': 'repeatMonths',
        'Повторный инструктаж в первый год на опасных работах, мес': 'newbieRepeatMonths',
        'Первый год на опасных работах, дней': 'newbieDays',
        'Ранняя выдача без причины, дней до срока': 'earlyIssueDays'
    };
    var REPEAT_KIND = 'Повторный инструктаж';

    function utc(s) { var p = s.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
    function iso(ms) { var d = new Date(ms); return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2); }
    function addDays(s, n) { return iso(utc(s) + n * DAY); }
    function diffDays(a, b) { return Math.round((utc(b) - utc(a)) / DAY); }
    /* Месяцы с прижатием дня: 31.01 + 1 мес = 28(29).02. */
    function addMonths(s, n) {
        var p = s.split('-'), y = +p[0], m = +p[1] - 1 + n, d = +p[2];
        y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
        var last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
        return iso(Date.UTC(y, m, Math.min(d, last)));
    }
    /* 'ДД.ММ.ГГГГ' или 'ГГГГ-ММ-ДД' -> 'ГГГГ-ММ-ДД'; пусто -> '' */
    function toIso(v) {
        if (!v) return '';
        var m = /^(\d{2})\.(\d{2})\.(\d{4})/.exec(v);
        return m ? m[3] + '-' + m[2] + '-' + m[1] : String(v).slice(0, 10);
    }
    function toDmy(s) { return s ? s.split('-').reverse().join('.') : ''; }
    function num(v) { var n = parseFloat(String(v === undefined || v === null ? '' : v).replace(',', '.')); return isNaN(n) ? 0 : n; }
    function list(v) { return String(v || '').split(/[;,\n]/).map(function (x) { return x.trim(); }).filter(Boolean); }

    function parseRules(rows) {
        var r = Object.assign({}, DEFAULT_RULES);
        (rows || []).forEach(function (x) { var k = RULE_NAMES[x.name]; if (k && x.value !== '' && x.value !== undefined) r[k] = num(x.value); });
        return r;
    }
    /* Состояние срока: none - нет записи, over - просрочено, soon - истекает в горизонте, ok - действует, na - не требуется. */
    function stateOf(due, today, warn) {
        if (!due) return 'none';
        var d = diffDays(today, due);
        if (d < 0) return 'over';
        if (d <= warn) return 'soon';
        return 'ok';
    }
    var STATE_TEXT = { none: 'нет записи', over: 'просрочено', soon: 'истекает', ok: 'действует', na: 'не требуется', wear: 'до износа' };
    function dueText(due, today) {
        if (!due) return '';
        var d = diffDays(today, due);
        if (d < 0) return 'просрочено ' + (-d) + ' дн.';
        if (d === 0) return 'истекает сегодня';
        return 'через ' + d + ' дн.';
    }
    function lastBy(rows, pred) {
        var best = null;
        rows.forEach(function (r) { if (pred(r) && r.date && (!best || r.date > best.date)) best = r; });
        return best;
    }
    function worksOf(M, w) { var p = M.positions[w.pos]; return p ? p.works : []; }
    function isDangerous(M, w) { return worksOf(M, w).length > 0; }

    /* ---------- СИЗ: комплект по нормам должности ---------- */
    var SIZE_FIELD = { 'Одежда': 'clothes', 'Обувь': 'shoes', 'Голова': 'head', 'Руки': 'gloves' };
    function sizeFor(w, ppe) { var f = ppe && SIZE_FIELD[ppe.kind]; return f ? (w.sizes && w.sizes[f]) || '' : ''; }
    function normsOf(M, posName) { return M.norms.filter(function (n) { return n.pos === posName; }); }
    function ppeCard(w, M, today) {
        var warn = M.rules.warnDays;
        return normsOf(M, w.pos).map(function (n) {
            var last = lastBy(M.issues, function (i) { return i.worker === w.name && i.ppe === n.ppe; });
            var due = last && n.months > 0 ? addMonths(last.date, n.months) : '';
            var st = !last ? 'none' : (n.months > 0 ? stateOf(due, today, warn) : 'wear');
            return { ppe: n.ppe, qty: n.qty, months: n.months, point: n.point, basis: n.basis, work: n.work || '', last: last ? last.date : '', lastQty: last ? last.qty : 0, due: due, state: st, size: sizeFor(w, M.ppeBy[n.ppe]) };
        });
    }

    /* ---------- инструктажи, обучение, проверка знаний ---------- */
    /* Обязательные виды: «для всех» + требования к работам повышенной опасности, которые есть в должности (или в наряде). */
    function requiredKinds(w, M, today, extraWorks) {
        var works = worksOf(M, w).concat(extraWorks || []);
        var need = {};
        M.kinds.forEach(function (k) { if (k.all) need[k.name] = { kind: k, why: 'для всех' }; });
        M.reqs.forEach(function (q) { if (works.indexOf(q.work) >= 0 && M.kindBy[q.kind] && !need[q.kind]) need[q.kind] = { kind: M.kindBy[q.kind], why: q.work }; });
        return Object.keys(need).map(function (n) {
            var k = need[n].kind, months = k.months;
            /* правило пост. 805: впервые допущенным к опасным работам в первый год повторный - чаще */
            if (k.name === REPEAT_KIND) {
                months = M.rules.repeatMonths;
                if (works.length && w.hire && diffDays(w.hire, today) < M.rules.newbieDays) months = M.rules.newbieRepeatMonths;
            }
            return { kind: k, months: months, why: need[n].why };
        });
    }
    function trainingCard(w, M, today, extraWorks) {
        var warn = M.rules.warnDays;
        return requiredKinds(w, M, today, extraWorks).map(function (x) {
            var last = lastBy(M.trainings, function (t) { return t.worker === w.name && t.kind === x.kind.name && t.result !== 'Не сдал'; });
            var due = last && !x.kind.once ? addMonths(last.date, x.months) : '';
            var st = !last ? 'none' : (x.kind.once ? 'ok' : stateOf(due, today, warn));
            return { kind: x.kind.name, cat: x.kind.cat, months: x.kind.once ? 0 : x.months, once: x.kind.once, why: x.why, last: last ? last.date : '', by: last ? last.by : '', due: due, state: st };
        });
    }

    /* ---------- медосмотр: периодичность по самому частому фактору должности ---------- */
    function medCard(w, M, today) {
        var p = M.positions[w.pos], factors = p ? p.factors : [];
        var months = 0, names = [];
        factors.forEach(function (f) { var x = M.factorBy[f]; if (x) { names.push(f); if (!months || x.months < months) months = x.months; } });
        if (!months) return { state: 'na', factors: [], months: 0, last: '', due: '', verdict: '' };
        var last = lastBy(M.exams, function (e) { return e.worker === w.name; });
        if (!last) return { state: 'none', factors: names, months: months, last: '', due: '', verdict: '' };
        var due = addMonths(last.date, months);
        var st = last.verdict === 'Не годен' ? 'over' : stateOf(due, today, M.rules.warnDays);
        return { state: st, factors: names, months: months, last: last.date, due: due, verdict: last.verdict, clinic: last.clinic || '' };
    }

    /* ---------- допуск работника сегодня (к работам должности и к работам наряда) ---------- */
    function admission(w, M, today, works) {
        var reasons = [];
        works = works || [];
        trainingCard(w, M, today, works).forEach(function (t) {
            if (t.state === 'over') reasons.push(t.kind + ': просрочено с ' + toDmy(t.due));
            else if (t.state === 'none') reasons.push(t.kind + ': нет записи');
        });
        var med = medCard(w, M, today);
        if (med.state === 'over') reasons.push(med.verdict === 'Не годен' ? 'Медосмотр: не годен' : 'Медосмотр: просрочен с ' + toDmy(med.due));
        else if (med.state === 'none') reasons.push('Медосмотр: нет заключения');
        /* СИЗ, обязательные для вида работ (норма с пометкой «для работ») */
        var all = worksOf(M, w).concat(works);
        ppeCard(w, M, today).forEach(function (c) {
            if (!c.work || all.indexOf(c.work) < 0) return;
            if (c.state === 'none') reasons.push(c.ppe + ': не выдано (' + c.work.toLowerCase() + ')');
            else if (c.state === 'over') reasons.push(c.ppe + ': срок носки истёк ' + toDmy(c.due));
        });
        works.forEach(function (x) { if (worksOf(M, w).indexOf(x) < 0) reasons.push('Должность «' + w.pos + '» не допускается к работе «' + x + '»'); });
        return { ok: reasons.length === 0, reasons: reasons };
    }

    /* ---------- наряд-допуск: маршрут и блокировка подписи ---------- */
    var FLOW = [
        { from: 'Черновик', to: 'На согласовании ОТ', role: 'master', label: 'Отправить на согласование' },
        { from: 'На согласовании ОТ', to: 'На утверждении', role: 'ot', label: 'Согласовать (ОТ)' },
        { from: 'На утверждении', to: 'Допуск выдан', role: 'chief', label: 'Утвердить и выдать допуск' },
        { from: 'Допуск выдан', to: 'Закрыт', role: 'master', label: 'Закрыть наряд' }
    ];
    function roleKey(role) {
        var r = String(role || '').toLowerCase();
        if (r === 'admin') return 'admin';
        if (/кладов/.test(r)) return 'store';
        if (/мастер/.test(r)) return 'master';
        if (/охран|специалист/.test(r)) return 'ot';
        if (/начальник|директор|руковод/.test(r)) return 'chief';
        return 'other';
    }
    function nextStep(status) { return FLOW.filter(function (f) { return f.from === status; })[0] || null; }
    function permitCheck(permit, M, today) {
        var rows = permit.executors.map(function (name) {
            var w = M.workerBy[name];
            if (!w) return { worker: name, ok: false, reasons: ['Работник не найден'] };
            var a = admission(w, M, today, permit.works);
            return { worker: name, ok: a.ok, reasons: a.reasons };
        });
        var reasons = [];
        if (!rows.length) reasons.push('Нет исполнителей');
        rows.forEach(function (r) { if (!r.ok) reasons.push(r.worker + ' — ' + r.reasons.join('; ')); });
        return { ok: reasons.length === 0, rows: rows, reasons: reasons };
    }
    /* Шаг маршрута: роль должна совпасть с шагом; закрытие наряда от допусков не зависит, остальные шаги блокируются при недопуске. */
    function signPermit(permit, role, M, today) {
        var step = nextStep(permit.status), rk = roleKey(role);
        if (!step) return { ok: false, error: 'Наряд в статусе «' + permit.status + '»: подписывать нечего' };
        if (rk !== step.role && rk !== 'admin') return { ok: false, error: 'Этот шаг подписывает ' + ROLE_TEXT[step.role] };
        if (step.to !== 'Закрыт') {
            var chk = permitCheck(permit, M, today);
            if (!chk.ok) return { ok: false, blocked: true, error: 'Подпись заблокирована: ' + chk.reasons.join(' | '), check: chk };
        }
        return { ok: true, status: step.to, step: step };
    }
    var ROLE_TEXT = { master: 'мастер участка', ot: 'специалист по охране труда', chief: 'начальник производства', store: 'кладовщик', admin: 'администратор' };

    /* ---------- выдача со склада ---------- */
    function issueCheck(w, ppeName, M, today) {
        var card = ppeCard(w, M, today), c = card.filter(function (x) { return x.ppe === ppeName; })[0];
        if (!c) return { inNorm: false, needReason: true, message: '«' + ppeName + '» нет в нормах должности «' + w.pos + '»: выдача вне нормы, нужна причина' };
        if (c.state === 'wear') return { inNorm: true, card: c, needReason: true, message: 'Норма «до износа»: укажите причину замены (износ, порча)' };
        if (c.last && c.due && diffDays(today, c.due) > M.rules.earlyIssueDays) return { inNorm: true, card: c, needReason: true, message: 'Срок носки до ' + toDmy(c.due) + ': ранняя выдача, нужна причина (износ, порча, утеря)' };
        return { inNorm: true, card: c, needReason: false, message: c.last ? 'Плановая замена: срок носки до ' + toDmy(c.due) : 'Первая выдача по норме (п. ' + c.point + ')' };
    }
    function stockOf(batches, ppe, size) {
        return batches.filter(function (b) { return b.ppe === ppe && (!size || !b.size || b.size === size); }).reduce(function (s, b) { return s + num(b.qty); }, 0);
    }
    /* Партия для списания: подходящий размер, есть остаток, первым - с ближайшим сроком годности. */
    function pickBatch(batches, ppe, size, qty) {
        var c = batches.filter(function (b) { return b.ppe === ppe && (!b.size || !size || b.size === size) && num(b.qty) >= qty; });
        c.sort(function (a, b) { return (a.expires || '9999') < (b.expires || '9999') ? -1 : 1; });
        return c[0] || null;
    }
    /* Отпечаток подписи на экране (766н п. 26: идентифицирующие сведения вместо подписи на бумаге). */
    function fingerprint(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return ('0000000' + h.toString(16)).slice(-8); }
    /* Сканер работает как клавиатура: табельный номер, штрихкод СИЗ или их пара через пробел. */
    function parseScan(text, M) {
        var out = { worker: null, ppe: null };
        String(text || '').trim().split(/\s+/).forEach(function (t) {
            var u = t.toUpperCase();
            M.workers.forEach(function (w) { if (String(w.tab).toUpperCase() === u) out.worker = w; });
            M.ppe.forEach(function (p) { if (String(p.code).toUpperCase() === u) out.ppe = p; });
        });
        return out;
    }

    /* ---------- календарь сроков и сводка ---------- */
    function events(M, today, horizon) {
        var out = [];
        M.workers.forEach(function (w) {
            function add(stream, item, due, st) { if (st === 'over' || st === 'soon' || st === 'none') out.push({ worker: w.name, tab: w.tab, dept: w.dept, pos: w.pos, stream: stream, item: item, due: due, state: st, days: due ? diffDays(today, due) : null }); }
            ppeCard(w, M, today).forEach(function (c) { add('СИЗ', c.ppe, c.due, c.state); });
            trainingCard(w, M, today).forEach(function (t) { add(t.cat === 'Инструктаж' ? 'Инструктаж' : 'Обучение', t.kind, t.due, t.state); });
            var m = medCard(w, M, today); if (m.state !== 'na') add('Медосмотр', 'Периодический медосмотр', m.due, m.state);
        });
        out = out.filter(function (e) { return e.state !== 'soon' || e.days <= (horizon || M.rules.warnDays); });
        var rank = { over: 0, none: 1, soon: 2 };
        out.sort(function (a, b) { return rank[a.state] - rank[b.state] || (a.days === null ? 0 : a.days) - (b.days === null ? 0 : b.days) || (a.worker < b.worker ? -1 : 1); });
        return out;
    }
    var STREAMS = ['СИЗ', 'Инструктаж', 'Обучение', 'Медосмотр'];
    function summary(M, today) {
        var ev = events(M, today), by = {};
        M.depts.forEach(function (d) { by[d] = { dept: d, workers: 0, admitted: 0 }; STREAMS.forEach(function (s) { by[d][s] = { over: 0, soon: 0 }; }); });
        M.workers.forEach(function (w) { var d = by[w.dept]; if (!d) return; d.workers++; if (admission(w, M, today).ok) d.admitted++; });
        ev.forEach(function (e) { var d = by[e.dept]; if (!d) return; d[e.stream][e.state === 'soon' ? 'soon' : 'over']++; });
        return M.depts.map(function (d) { var x = by[d]; x.pct = x.workers ? Math.round(x.admitted * 100 / x.workers) : 0; return x; }).filter(function (x) { return x.workers; });
    }
    function toCsv(rows) { return rows.map(function (r) { return r.map(function (v) { var s = String(v === undefined || v === null ? '' : v); return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(';'); }).join('\r\n'); }

    return {
        DEFAULT_RULES: DEFAULT_RULES, RULE_NAMES: RULE_NAMES, STATE_TEXT: STATE_TEXT, STREAMS: STREAMS, FLOW: FLOW, ROLE_TEXT: ROLE_TEXT,
        utc: utc, iso: iso, addDays: addDays, diffDays: diffDays, addMonths: addMonths, toIso: toIso, toDmy: toDmy, num: num, list: list,
        parseRules: parseRules, stateOf: stateOf, dueText: dueText, sizeFor: sizeFor, normsOf: normsOf, ppeCard: ppeCard, requiredKinds: requiredKinds, trainingCard: trainingCard,
        medCard: medCard, admission: admission, roleKey: roleKey, nextStep: nextStep, permitCheck: permitCheck, signPermit: signPermit,
        issueCheck: issueCheck, stockOf: stockOf, pickBatch: pickBatch, fingerprint: fingerprint, parseScan: parseScan, events: events, summary: summary, toCsv: toCsv
    };
});
