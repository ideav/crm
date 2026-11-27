/* KPI: чистые функции расчёта премии по правилам компании (выполнение, порог, шкала, потолок, блокирующий показатель,
   оценка руководителя, неполный месяц, корректировка), «что если», прогноз, разбор файла план/факт, выгрузка в ЗУП.
   Без DOM и сети: работает и в браузере, и в Node. */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.KpiCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    function num(v) {
        if (v === null || v === undefined || v === '') return 0;
        var n = typeof v === 'number' ? v : parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
        return isFinite(n) ? n : 0;
    }
    function has(v) { return !(v === null || v === undefined || String(v).trim() === ''); }
    function isNum(v) { return has(v) && /^-?\d+([.,]\d+)?$/.test(String(v).replace(/\s/g, '')); }
    function round(x, d) { var k = Math.pow(10, d || 0); return Math.round(x * k) / k; }
    function pct(x) { return String(round(x * 100, 1)).replace('.', ',') + ' %'; }
    function fnum(x, d) { return String(round(x, d === undefined ? 2 : d)).replace('.', ','); }
    function rub(x) { var n = Math.round(num(x)); return (n < 0 ? '-' : '') + String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'; }
    function toIso(v) {
        if (!v) return '';
        var m = /^(\d{2})\.(\d{2})\.(\d{4})/.exec(v);
        return m ? m[3] + '-' + m[2] + '-' + m[1] : String(v).slice(0, 10);
    }
    function toDmy(s) { s = toIso(s); return s ? s.slice(8, 10) + '.' + s.slice(5, 7) + '.' + s.slice(0, 4) : ''; }
    /* ФИО для сравнения: регистр, ё/е, лишние пробелы */
    function normName(s) { return String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim(); }

    var LESS = 'Меньше - лучше', BLOCK = 'Блокирующий';

    /* Выполнение показателя (доля плана). null - плана нет, считать нельзя (защита от деления на ноль). */
    function achievement(ind, plan, fact, cap) {
        plan = num(plan); fact = num(fact); cap = cap || 1.3;
        if (ind.dir === LESS) {
            if (fact <= 0) return cap;
            if (plan <= 0) return 0;
            return plan / fact;
        }
        if (plan <= 0) return null;
        return fact / plan;
    }

    /* Коэффициент показателя по шкале: ниже порога - 0; ступенчатая шкала от первой ступени; потолок режет перевыполнение. */
    function coefficient(ach, scheme, scale) {
        if (ach === null) return { coef: 0, flag: 'noplan' };
        var th = num(scheme.threshold) / 100, cap = num(scheme.cap) / 100 || 1;
        if (ach < th) return { coef: 0, flag: 'below' };
        var c = ach;
        if (scale === 'Ступенчатая' && scheme.steps && scheme.steps.length) {
            var st = scheme.steps.slice().sort(function (a, b) { return a.from - b.from; });
            if (ach * 100 >= st[0].from) st.forEach(function (s) { if (ach * 100 >= s.from) c = s.coef; });
        }
        if (c > cap) return { coef: cap, flag: 'capped' };
        return { coef: c, flag: '' };
    }

    /* Множитель оценки руководителя: 3 балла = 1, шаг за балл задан в схеме. */
    function ratingMult(avg, stepPct) {
        if (avg === null || avg === undefined || !num(stepPct)) return 1;
        return round(1 + (num(avg) - 3) * num(stepPct) / 100, 4);
    }
    function avgScore(scores) {
        var v = (scores || []).map(num).filter(function (x) { return x > 0; });
        if (!v.length) return null;
        return round(v.reduce(function (s, x) { return s + x; }, 0) / v.length, 2);
    }
    /* Неполный месяц: пропорционально отработанным дням или полностью - правило компании. */
    function partFactor(ts, mode) {
        if (!ts || !num(ts.norm)) return 1;
        if (mode !== 'Пропорционально') return 1;
        return Math.min(1, num(ts.worked) / num(ts.norm));
    }

    /* Расчёт премии сотрудника за период.
       emp: {salary, targetPct}; scheme: {threshold, cap, steps, ratingStep, partMode, lines:[{ind:{name,unit,dir,kind}, weight, scale}]}
       vals: {имя показателя: {plan, fact}}; scores: [баллы]; ts: {norm, worked}; corr: {sum, reason} */
    function calcEmployee(emp, scheme, vals, scores, ts, corr) {
        var target = Math.round(num(emp.salary) * num(emp.targetPct) / 100);
        var res = { target: target, lines: [], sumCoef: 0, flags: [], blocked: false, blockReason: '' };
        (scheme.lines || []).forEach(function (l) {
            var v = vals[l.ind.name] || {};
            var known = has(v.fact);
            if (l.ind.kind === BLOCK) {
                var bad = known && num(v.fact) > num(v.plan);
                if (bad) { res.blocked = true; res.blockReason = l.ind.name + ': ' + fnum(num(v.fact), 1) + ' при допустимых ' + fnum(num(v.plan), 1); }
                res.lines.push({ ind: l.ind, weight: 0, plan: num(v.plan), fact: known ? num(v.fact) : null, ach: null, coef: 0, part: 0, flag: bad ? 'block' : (known ? '' : 'nofact') });
                return;
            }
            var ach = known ? achievement(l.ind, v.plan, v.fact, num(scheme.cap) / 100) : null;
            var k = known ? coefficient(ach, scheme, l.scale) : { coef: 0, flag: 'nofact' };
            var part = k.coef * num(l.weight) / 100;
            res.sumCoef += part;
            if (k.flag && res.flags.indexOf(k.flag) < 0) res.flags.push(k.flag);
            res.lines.push({ ind: l.ind, weight: num(l.weight), scale: l.scale, plan: num(v.plan), fact: known ? num(v.fact) : null, ach: ach, coef: k.coef, part: part, flag: k.flag });
        });
        res.sumCoef = round(res.sumCoef, 4);
        res.avg = avgScore(scores);
        res.mult = ratingMult(res.avg, scheme.ratingStep);
        res.partF = partFactor(ts, scheme.partMode);
        if (res.partF < 1) res.flags.push('part');
        res.calc = res.blocked ? 0 : Math.round(target * res.sumCoef * res.mult * res.partF);
        if (res.blocked) res.flags.unshift('block');
        res.corr = corr && num(corr.sum) || 0;
        res.corrReason = corr && corr.reason || '';
        res.total = Math.max(0, res.calc + res.corr);
        return res;
    }

    /* Расчёт всех сотрудников периода. ctx: {emps, schemes:{name:scheme}, vals:{emp:{ind:{plan,fact}}}, scores:{emp:[..]}, ts:{emp:{..}}, corr:{emp:{..}}} */
    function calcPeriod(ctx, override) {
        var rows = [], fot = 0, target = 0;
        (ctx.emps || []).forEach(function (e) {
            var sc = ctx.schemes[e.scheme];
            if (!sc) return;
            if (override && override[e.scheme]) sc = Object.assign({}, sc, override[e.scheme]);
            var r = calcEmployee(e, sc, (ctx.vals || {})[e.name] || {}, (ctx.scores || {})[e.name], (ctx.ts || {})[e.name], (ctx.corr || {})[e.name]);
            r.emp = e; rows.push(r); fot += r.total; target += r.target;
        });
        return { rows: rows, fot: fot, target: target };
    }
    /* «Что если»: тот же период с другими правилами схем; разница по людям и по ФОТ. */
    function whatIf(ctx, override) {
        var a = calcPeriod(ctx), b = calcPeriod(ctx, override), by = {};
        a.rows.forEach(function (r) { by[r.emp.name] = r; });
        var changed = b.rows.filter(function (r) { return by[r.emp.name] && by[r.emp.name].total !== r.total; }).map(function (r) {
            return { emp: r.emp, before: by[r.emp.name].total, after: r.total, delta: r.total - by[r.emp.name].total };
        });
        return { before: a.fot, after: b.fot, delta: b.fot - a.fot, changed: changed, rows: b.rows };
    }

    /* Сравнение с прошлым месяцем по людям: {name: {now, prev, delta}} */
    function comparePrev(rowsNow, prevTotals) {
        var out = {};
        rowsNow.forEach(function (r) {
            var p = prevTotals && prevTotals[r.emp.name];
            out[r.emp.name] = { now: r.total, prev: p === undefined ? null : num(p), delta: p === undefined ? null : r.total - num(p) };
        });
        return out;
    }

    /* Пояснение строки расчёта человеческим языком (для сотрудника и руководителя). */
    function explainLine(l, scheme) {
        var u = l.ind.unit ? ' ' + l.ind.unit : '';
        if (l.ind.kind === BLOCK) {
            if (l.flag === 'block') return l.ind.name + ': ' + fnum(l.fact, 1) + u + ' при допустимых ' + fnum(l.plan, 1) + ' - премия за период не начисляется';
            return l.ind.name + ': ' + (l.fact === null ? 'нет данных' : fnum(l.fact, 1) + u) + ', допустимо ' + fnum(l.plan, 1) + ' - премию не блокирует';
        }
        if (l.flag === 'nofact') return l.ind.name + ': факт не загружен - доля ' + l.weight + ' % не начислена';
        if (l.flag === 'noplan') return l.ind.name + ': план не задан - показатель не считается, доля ' + l.weight + ' % не начислена';
        var base = l.ind.name + ': факт ' + fnum(l.fact) + u + ' при плане ' + fnum(l.plan) + u + (l.ind.dir === LESS ? ' (меньше - лучше)' : '') + ' = ' + pct(l.ach);
        if (l.flag === 'below') return base + ' - ниже порога ' + num(scheme.threshold) + ' %, доля ' + l.weight + ' % не начислена';
        var t = base + ' -> коэффициент ' + fnum(l.coef) + (l.flag === 'capped' ? ' (потолок ' + num(scheme.cap) + ' %)' : '') + ' x вес ' + l.weight + ' % = ' + pct(l.part);
        return t;
    }
    /* Правила схемы словами - то, что пишется в положение о премировании. */
    function formulaText(scheme) {
        var main = (scheme.lines || []).filter(function (l) { return l.ind.kind !== BLOCK; });
        var blk = (scheme.lines || []).filter(function (l) { return l.ind.kind === BLOCK; });
        var t = ['Премия = оклад x целевой % x сумма (коэффициент показателя x вес)' + (num(scheme.ratingStep) ? ' x множитель оценки руководителя' : '') + (scheme.partMode === 'Пропорционально' ? ' x доля отработанных дней' : '') + '.'];
        t.push('Показатели: ' + main.map(function (l) { return l.ind.name + ' - ' + l.weight + ' %' + (l.scale === 'Ступенчатая' ? ' (ступенчатая шкала)' : ''); }).join('; ') + '.');
        t.push('Если выполнение показателя ниже ' + num(scheme.threshold) + ' % плана, по нему начисления нет. Коэффициент не выше ' + fnum(num(scheme.cap) / 100) + '.');
        if (scheme.steps && scheme.steps.length) t.push('Ступени: ' + scheme.steps.slice().sort(function (a, b) { return a.from - b.from; }).map(function (s) { return 'от ' + s.from + ' % - ' + fnum(s.coef); }).join(', ') + '; ниже первой ступени коэффициент равен выполнению.');
        if (blk.length) t.push('Блокирующие: ' + blk.map(function (l) { return l.ind.name; }).join(', ') + ' - при превышении допустимого премия за период не начисляется.');
        if (num(scheme.ratingStep)) t.push('Оценка руководителя 1-5: 3 балла - x1, каждый балл выше или ниже - плюс или минус ' + num(scheme.ratingStep) + ' %.');
        t.push(scheme.partMode === 'Пропорционально' ? 'Неполный месяц: премия пропорциональна отработанным дням.' : 'Неполный месяц: премия начисляется полностью.');
        return t;
    }
    /* Проверка схемы перед сохранением: веса = 100 %, порог и потолок в разумных пределах, ступени растут. */
    function validateScheme(scheme) {
        var err = [], w = 0;
        (scheme.lines || []).forEach(function (l) { if (l.ind.kind !== BLOCK) w += num(l.weight); });
        if (Math.abs(w - 100) > 0.001) err.push('Сумма весов ' + fnum(w, 1) + ' %, должна быть 100 %');
        var th = num(scheme.threshold), cap = num(scheme.cap);
        if (th < 0 || th >= 100) err.push('Порог начисления должен быть от 0 до 99 %');
        if (cap < 100) err.push('Потолок коэффициента не ниже 100 %');
        var st = (scheme.steps || []).slice().sort(function (a, b) { return a.from - b.from; });
        for (var i = 1; i < st.length; i++) if (st[i].coef < st[i - 1].coef) err.push('Ступень от ' + st[i].from + ' % даёт меньше предыдущей');
        if (st.length && st[st.length - 1].coef * 100 > cap) err.push('Ступень от ' + st[st.length - 1].from + ' % выше потолка ' + cap + ' %');
        return err;
    }
    /* Корректировка руководителем: причина обязательна; снижение больше 20 % расчётной суммы - предупреждение (ст. 135 ТК, сверить с юристом). */
    function checkCorrection(calc, sum, reason) {
        var out = { errors: [], warnings: [] };
        sum = num(sum);
        if (sum !== 0 && !has(reason)) out.errors.push('Укажите причину корректировки - она попадёт в журнал и в расчёт сотрудника');
        if (calc + sum < 0) out.errors.push('Итог не может быть меньше нуля');
        if (sum < 0 && calc > 0 && -sum > calc * 0.2) out.warnings.push('Снижение больше 20 % расчётной премии - проверьте основание (взыскание, положение о премировании)');
        return out;
    }

    /* Прогноз на конец периода при текущем темпе и путь до следующей ступени (спидометр сотрудника). */
    function forecast(plan, factToDate, daysPassed, daysTotal) {
        plan = num(plan); factToDate = num(factToDate);
        var f = daysPassed > 0 ? factToDate * daysTotal / daysPassed : factToDate;
        return { fact: round(f, 2), ach: plan > 0 ? f / plan : null };
    }
    function nextStep(ach, scheme, scale) {
        var marks = [num(scheme.threshold)];
        if (scale === 'Ступенчатая') (scheme.steps || []).forEach(function (s) { marks.push(s.from); });
        else marks.push(100);
        marks = marks.filter(function (m, i) { return marks.indexOf(m) === i; }).sort(function (a, b) { return a - b; });
        var cur = (ach || 0) * 100;
        for (var i = 0; i < marks.length; i++) if (marks[i] > cur + 1e-9) return { at: marks[i], gap: round(marks[i] - cur, 1) };
        return null;
    }

    /* Разбор вставки из Excel (табуляция, «;» или «,»): Таб. номер | Сотрудник | Показатель | План | Факт.
       Сотрудник ищется по табельному номеру, иначе по ФИО (ё/е, регистр); показатель - по имени или синониму. */
    function parseFacts(text, emps, inds) {
        var lines = String(text || '').split(/\r?\n/).filter(function (s) { return s.trim(); });
        var out = { rows: [], errors: [] };
        if (!lines.length) return out;
        var sep = lines[0].indexOf('\t') >= 0 ? '\t' : (lines[0].indexOf(';') >= 0 ? ';' : ',');
        var byNum = {}, byName = {}, byInd = {};
        emps.forEach(function (e) { if (e.num) byNum[String(e.num).trim().toLowerCase()] = e; byName[normName(e.name)] = e; });
        inds.forEach(function (i) { byInd[normName(i.name)] = i; (i.syn || '').split(/[;,]/).forEach(function (s) { if (s.trim()) byInd[normName(s)] = i; }); });
        var seen = {};
        lines.forEach(function (ln, n) {
            var c = ln.split(sep).map(function (s) { return s.trim().replace(/^"|"$/g, ''); });
            if (n === 0 && /показател/i.test(ln) && !/\d/.test(c[3] || '')) return; /* шапка */
            var e = byNum[String(c[0] || '').toLowerCase()] || byName[normName(c[1])];
            var i = byInd[normName(c[2])];
            var where = 'Строка ' + (n + 1) + ': ';
            if (!e) { out.errors.push(where + 'сотрудник «' + (c[1] || c[0]) + '» не найден'); return; }
            if (!i) { out.errors.push(where + 'показатель «' + c[2] + '» не найден'); return; }
            if (has(c[3]) && !isNum(c[3])) { out.errors.push(where + 'план не число'); return; }
            if (!isNum(c[4])) { out.errors.push(where + 'факт не число'); return; }
            var key = e.name + '|' + i.name;
            if (seen[key]) { out.errors.push(where + 'повтор: ' + e.name + ' / ' + i.name + ' уже в строке ' + seen[key]); return; }
            seen[key] = n + 1;
            out.rows.push({ emp: e.name, ind: i.name, plan: has(c[3]) ? num(c[3]) : null, fact: num(c[4]), matchedBy: byNum[String(c[0] || '').toLowerCase()] ? 'таб. номер' : 'ФИО' });
        });
        return out;
    }

    /* Файл для загрузки в 1С:ЗУП (документ «Данные для расчёта зарплаты» / «Премия»): строка на сотрудника + контрольная сумма. */
    function zupCsv(rows, period, code) {
        var head = ['Табельный номер', 'Сотрудник', 'Подразделение', 'Вид начисления', 'Период', 'Сумма'];
        var lines = [head.join(';')], sum = 0, n = 0;
        rows.forEach(function (r) {
            if (!r.total) return;
            n++; sum += r.total;
            lines.push([r.emp.num, r.emp.name, r.emp.dept, code, period, String(r.total)].map(function (v) { v = String(v === undefined ? '' : v); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(';'));
        });
        lines.push(['ИТОГО', n + ' чел.', '', '', '', String(sum)].join(';'));
        return { text: lines.join('\r\n'), count: n, sum: sum };
    }
    /* Сводка в мессенджер: ФОТ премий, разница с прошлым месяцем, обнулённые и ниже порога. */
    function summaryText(period, calc, prevFot) {
        var blocked = calc.rows.filter(function (r) { return r.blocked; }), below = calc.rows.filter(function (r) { return r.flags.indexOf('below') >= 0; });
        var t = ['Премия за ' + period + ': ' + rub(calc.fot) + ' на ' + calc.rows.length + ' чел. (целевая ' + rub(calc.target) + ', ' + pct(calc.target ? calc.fot / calc.target : 0) + ').'];
        if (prevFot !== null && prevFot !== undefined) t.push('К прошлому месяцу: ' + (calc.fot - prevFot >= 0 ? '+' : '') + rub(calc.fot - prevFot) + '.');
        if (blocked.length) t.push('Премия не начислена (блокирующий показатель): ' + blocked.map(function (r) { return r.emp.name; }).join(', ') + '.');
        if (below.length) t.push('Есть показатели ниже порога: ' + below.length + ' чел.');
        return t.join('\n');
    }
    /* Согласование подразделения: сколько согласовано и не просрочено ли. */
    function approvalState(prems, deadline, today) {
        var done = prems.filter(function (p) { return p.status === 'Согласовано'; }).length;
        var overdue = done < prems.length && deadline && toIso(today) > toIso(deadline);
        return { done: done, total: prems.length, overdue: !!overdue, complete: prems.length > 0 && done === prems.length };
    }

    return {
        num: num, has: has, round: round, pct: pct, fnum: fnum, rub: rub, toIso: toIso, toDmy: toDmy, normName: normName, LESS: LESS, BLOCK: BLOCK,
        achievement: achievement, coefficient: coefficient, ratingMult: ratingMult, avgScore: avgScore, partFactor: partFactor,
        calcEmployee: calcEmployee, calcPeriod: calcPeriod, whatIf: whatIf, comparePrev: comparePrev, explainLine: explainLine, formulaText: formulaText,
        validateScheme: validateScheme, checkCorrection: checkCorrection, forecast: forecast, nextStep: nextStep, parseFacts: parseFacts,
        zupCsv: zupCsv, summaryText: summaryText, approvalState: approvalState
    };
});
