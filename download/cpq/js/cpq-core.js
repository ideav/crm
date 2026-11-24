/* CPQ: движок правил совместимости и цены. Чистые функции, без DOM и сети: работает в браузере и в Node.
 * Правила приходят ДАННЫМИ (таблицы «Правило» и «Цель правила»), в коде нет ни одной отраслевой опции.
 * Тип правила: requires (требует), excludes (исключает), together (только вместе), default (по умолчанию).
 * Правило без «Если опция» действует на изделие целиком (excludes: изделие не комплектуется; requires: обязательная опция).
 */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.CpqCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    function num(v) {
        var n = parseFloat(String(v === undefined || v === null || v === '' ? 0 : v).replace(/\s/g, '').replace(',', '.'));
        return isNaN(n) ? 0 : n;
    }
    function round(x) { return Math.round(x); }
    function round1(x) { return Math.round(x * 10) / 10; }
    function toIso(v) {
        if (!v) return '';
        var m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(v);
        return m ? m[3] + '-' + m[2] + '-' + m[1] : String(v).slice(0, 10);
    }
    function toDmy(s) { return s ? s.split('-').reverse().join('.') : ''; }
    function addDays(s, n) {
        var p = s.split('-'), d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n));
        return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2);
    }
    function money(x) { return String(round(num(x))).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }

    /* ---------- Настраиваемые опции демо ----------
     * Значения лежат в таблице «Настройка» (колонки «Код», «Значение», «Значение настройки»). Ядро читает их, а не константы;
     * если строки в базе нет, действует вариант по умолчанию (он же исходное поведение демо). */
    var OPTION_DEFAULTS = {
        DISCOUNT_MODE: 'quote',   /* quote: одна скидка на КП; lines: скидка по каждой позиции */
        LIMITS_MODE: 'roles',     /* roles: лимит у каждой роли; flat: единый лимит менеджерам */
        LIMIT_FLAT: 10,           /* единый лимит, % (для LIMITS_MODE=flat) */
        LIMIT_COMPANY: 0,         /* предел скидки компании, %; 0 = лимит коммерческого директора */
        MARGIN_POLICY: 'approve', /* approve: ниже минимума - согласование; block: запрет; off: не контролировать */
        MARGIN_VIEW: 'show',      /* show: цифра; flag: только отметка; hide: скрыта (для ролей без права согласовать) */
        STATUS_MANUAL: 'deny'     /* deny: менеджер меняет статус только экранами; allow: может вручную */
    };
    var NUMERIC_OPTS = { LIMIT_FLAT: 1, LIMIT_COMPANY: 1 };
    function parseOptions(rows) {
        var o = {}; Object.keys(OPTION_DEFAULTS).forEach(function (k) { o[k] = OPTION_DEFAULTS[k]; });
        (rows || []).forEach(function (r) {
            var code = r['Код'];
            if (!code || !(code in OPTION_DEFAULTS)) return;
            if (NUMERIC_OPTS[code]) { var raw = r['Значение настройки']; if (raw !== undefined && raw !== '') o[code] = Math.max(0, num(raw)); }
            else if (r['Значение']) o[code] = String(r['Значение']).trim();
        });
        return { discountMode: o.DISCOUNT_MODE === 'lines' ? 'lines' : 'quote', limitsMode: o.LIMITS_MODE === 'flat' ? 'flat' : 'roles', flatLimit: o.LIMIT_FLAT,
            companyLimit: o.LIMIT_COMPANY, marginPolicy: { block: 'block', off: 'off' }[o.MARGIN_POLICY] || 'approve', marginView: { flag: 'flag', hide: 'hide' }[o.MARGIN_VIEW] || 'show',
            statusManual: o.STATUS_MANUAL === 'allow' ? 'allow' : 'deny' };
    }
    function roleOf(m, name) { return m.roles.filter(function (r) { return r.name === name; })[0] || { name: name, limit: 0, level: 0, approves: false }; }
    /* Собственный лимит скидки роли: при едином лимите его получают все, кто не согласует; согласующие держат лимит из таблицы. */
    function limitOf(m, roleName) {
        var r = roleOf(m, roleName);
        return m.opts.limitsMode === 'flat' && !r.approves ? m.opts.flatLimit : r.limit;
    }
    /* Предел скидки компании: заданный числом или лимит старшего согласующего. */
    function companyLimit(m) {
        if (m.opts.companyLimit > 0) return m.opts.companyLimit;
        var ap = m.roles.filter(function (r) { return r.approves; }).sort(function (a, b) { return a.limit - b.limit; });
        return ap.length ? ap[ap.length - 1].limit : 0;
    }
    /* Что роль видит про маржу: согласующие видят всегда, остальные - по опции. */
    function marginView(m, roleName) { return roleOf(m, roleName).approves ? 'show' : m.opts.marginView; }
    function marginText(m, roleName, marginPct) {
        var v = marginView(m, roleName), min = m.settings['Минимальная маржа, %'] || 0;
        if (v === 'show') return round1(marginPct) + '%';
        if (v === 'flag') return m.opts.marginPolicy !== 'off' && marginPct < min - 1e-9 ? 'ниже минимума' : 'в норме';
        return '';
    }
    /* Может ли роль вручную поставить любой статус КП (без прохождения экранов). Руководители могут всегда. */
    function canSetStatus(m, roleName) { return roleOf(m, roleName).approves || m.opts.statusManual === 'allow'; }

    var TYPE_BY_NAME = { 'Требует': 'requires', 'Исключает': 'excludes', 'Только вместе': 'together', 'По умолчанию': 'default' };
    var TYPE_NAME = { requires: 'Требует', excludes: 'Исключает', together: 'Только вместе', 'default': 'По умолчанию' };

    /* ---------- Модель из плоских строк ----------
     * rows: {products, groups, options, rules, targets, custGroups, steps, roles, settings} - массивы строк (поля как в таблицах базы).
     * Ссылки между таблицами - по названию (значению ссылки), опции в ядре адресуются по Коду. */
    function buildModel(rows) {
        var m = { products: [], groups: [], options: [], rules: [], custGroups: [], steps: [], roles: [], settings: {} };
        var optByName = {};
        (rows.groups || []).forEach(function (g) {
            m.groups.push({ name: g['Группа опций'], order: num(g['Порядок']), mode: g['Выбор'] === 'Несколько' ? 'many' : 'one',
                required: !!num(g['Обязательная']) && g['Обязательная'] !== '', hint: g['Подсказка'] || '' });
        });
        m.groups.sort(function (a, b) { return a.order - b.order; });
        (rows.options || []).forEach(function (o) {
            var x = { code: o['Код'], name: o['Опция'], group: o['Группа опций'], priceType: o['Тип цены'] === '% от базы' ? 'percent' : 'fixed',
                price: num(o['Цена опции']), costShare: num(o['Доля себестоимости опции, %']), note: o['Описание'] || '' };
            m.options.push(x); optByName[x.name] = x;
        });
        (rows.products || []).forEach(function (p) {
            m.products.push({ key: p['Артикул'], name: p['Изделие'], series: p['Серия'] || '', base: num(p['Базовая цена']), costShare: num(p['Доля себестоимости, %']),
                maxPressure: num(p['Макс. давление, бар']), maxTemp: num(p['Макс. температура, °C']), leadDays: num(p['Срок изготовления, дн']), note: p['Описание'] || '' });
        });
        var prodByName = {}; m.products.forEach(function (p) { prodByName[p.name] = p; });
        var tg = {};
        (rows.targets || []).forEach(function (t) { var o = optByName[t['Опция цели']]; if (o) (tg[t._up] = tg[t._up] || []).push(o.code); });
        (rows.rules || []).forEach(function (r) {
            var c = r['Если опция'] ? optByName[r['Если опция']] : null, p = r['Изделие'] ? prodByName[r['Изделие']] : null;
            m.rules.push({ id: r._id || r['Правило'], name: r['Правило'], type: TYPE_BY_NAME[r['Тип правила']] || 'requires', ifCode: c ? c.code : null,
                product: p ? p.key : null, targets: tg[r._id] || r.targets || [], message: r['Пояснение для менеджера'] || r['Правило'],
                active: r['Активно'] === undefined ? true : (r['Активно'] !== '' && num(r['Активно']) !== 0), since: r['Действует с'] || '', author: r['Автор правки'] || '' });
        });
        (rows.custGroups || []).forEach(function (g) { m.custGroups.push({ name: g['Группа клиента'], markup: num(g['Наценка, %']) }); });
        (rows.steps || []).forEach(function (s) { m.steps.push({ from: num(s['От штук']), pct: num(s['Скидка за объём, %']) }); });
        m.steps.sort(function (a, b) { return a.from - b.from; });
        (rows.roles || []).forEach(function (r) { m.roles.push({ name: r['Роль продаж'], limit: num(r['Лимит скидки, %']), approves: !!num(r['Согласует']), level: num(r['Уровень']) }); });
        m.roles.sort(function (a, b) { return a.level - b.level; });
        (rows.settings || []).forEach(function (s) { m.settings[s['Настройка']] = num(s['Значение настройки']); });
        m.opts = parseOptions(rows.settings);
        return index(m);
    }
    function index(m) {
        m.optBy = {}; m.options.forEach(function (o) { m.optBy[o.code] = o; });
        m.prodBy = {}; m.products.forEach(function (p) { m.prodBy[p.key] = p; });
        m.groupBy = {}; m.groups.forEach(function (g) { m.groupBy[g.name] = g; });
        return m;
    }

    /* ---------- Правила ---------- */
    function rulesFor(m, product) {
        return m.rules.filter(function (r) { return r.active && (!r.product || r.product === product); });
    }
    function nm(m, code) { return m.optBy[code] ? m.optBy[code].name : code; }
    function groupOf(m, code) { return m.groupBy[m.optBy[code].group]; }
    function has(sel, c) { return sel.indexOf(c) >= 0; }
    function without(sel, c) { return sel.filter(function (x) { return x !== c; }); }
    function mates(m, sel, code) {
        var g = groupOf(m, code);
        if (!g || g.mode !== 'one') return [];
        return sel.filter(function (x) { return x !== code && m.optBy[x].group === g.name; });
    }
    /* обязательные опции изделия (requires без «Если») */
    function lockedMap(m, product) {
        var L = {};
        rulesFor(m, product).forEach(function (r) { if (r.type === 'requires' && !r.ifCode) r.targets.forEach(function (t) { L[t] = r.message; }); });
        return L;
    }
    /* кто из выбранных требует код s (requires/together) */
    function dependents(m, product, sel, s) {
        var out = [];
        rulesFor(m, product).forEach(function (r) {
            if (r.type === 'requires' && r.ifCode && has(sel, r.ifCode) && has(r.targets, s)) out.push({ code: r.ifCode, msg: r.message });
            if (r.type === 'together') {
                var mem = [r.ifCode].concat(r.targets).filter(Boolean);
                if (has(mem, s)) mem.forEach(function (x) { if (x !== s && has(sel, x)) out.push({ code: x, msg: r.message }); });
            }
        });
        return out;
    }
    /* прямые конфликты выбора o с набором sel (без каскада) -> [причины] */
    function conflicts(m, product, sel, o) {
        var out = [];
        rulesFor(m, product).forEach(function (r) {
            if (r.type !== 'excludes') return;
            if (!r.ifCode) { if (has(r.targets, o)) out.push({ kind: 'product', text: 'Для изделия «' + (m.prodBy[product] ? m.prodBy[product].name : product) + '» недоступно: ' + r.message, rule: r.id }); return; }
            if (r.ifCode === o) r.targets.forEach(function (t) { if (has(sel, t)) out.push({ kind: 'with', with: t, text: 'Несовместимо с «' + nm(m, t) + '»: ' + r.message, rule: r.id }); });
            if (has(r.targets, o) && has(sel, r.ifCode)) out.push({ kind: 'with', with: r.ifCode, text: 'Несовместимо с «' + nm(m, r.ifCode) + '»: ' + r.message, rule: r.id });
        });
        return out;
    }
    /* Попытка выбрать опцию o в наборе sel. Возвращает {ok, sel, added, removed, reasons}.
     * Групповой выбор «Один»: соседи по группе заменяются. Цели «требует» и «только вместе» добавляются каскадом. */
    function tryAdd(m, product, sel, o, stack) {
        stack = stack || [];
        if (has(sel, o)) return { ok: true, sel: sel, added: [], removed: [], reasons: [] };
        if (has(stack, o)) return { ok: true, sel: sel, added: [], removed: [], reasons: [] };
        var cur = sel.slice(), removed = [], added = [];
        var mt = mates(m, cur, o);
        for (var i = 0; i < mt.length; i++) {
            var dep = dependents(m, product, cur, mt[i]);
            if (dep.length) return { ok: false, reasons: [{ kind: 'needed', text: '«' + nm(m, mt[i]) + '» нужен для «' + nm(m, dep[0].code) + '»: ' + dep[0].msg }] };
            if (lockedMap(m, product)[mt[i]]) return { ok: false, reasons: [{ kind: 'locked', text: '«' + nm(m, mt[i]) + '» обязателен для изделия: ' + lockedMap(m, product)[mt[i]] }] };
            cur = without(cur, mt[i]); removed.push({ code: mt[i], why: 'заменено выбором «' + nm(m, o) + '»' });
        }
        var cf = conflicts(m, product, cur, o);
        if (cf.length) return { ok: false, reasons: cf };
        cur.push(o);
        var rs = rulesFor(m, product), st = stack.concat([o]);
        for (var k = 0; k < rs.length; k++) {
            var r = rs[k], need = [];
            if (r.type === 'requires' && r.ifCode === o) need = r.targets;
            else if (r.type === 'together') {
                var mem = [r.ifCode].concat(r.targets).filter(Boolean);
                if (has(mem, o)) need = mem.filter(function (x) { return x !== o; });
            }
            for (var j = 0; j < need.length; j++) {
                if (has(cur, need[j])) continue;
                var sub = tryAdd(m, product, cur, need[j], st);
                if (!sub.ok) return { ok: false, reasons: [{ kind: 'chain', rule: r.id, text: 'Требует «' + nm(m, need[j]) + '», но это недоступно: ' + sub.reasons[0].text }] };
                cur = sub.sel; sub.removed.forEach(function (x) { removed.push(x); });
                added.push({ code: need[j], why: (r.type === 'together' ? 'комплектом с «' : 'требуется для «') + nm(m, o) + '»: ' + r.message });
                sub.added.forEach(function (x) { added.push(x); });
            }
        }
        /* предложения «по умолчанию» с условием: добавляются мягко, без отказа */
        rs.forEach(function (r) {
            if (r.type !== 'default' || r.ifCode !== o) return;
            r.targets.forEach(function (t) {
                if (has(cur, t)) return;
                var sub = tryAdd(m, product, cur, t, st);
                if (sub.ok) { cur = sub.sel; sub.removed.forEach(function (x) { removed.push(x); }); added.push({ code: t, why: 'по умолчанию для «' + nm(m, o) + '»: ' + r.message }); }
            });
        });
        return { ok: true, sel: cur, added: added, removed: removed, reasons: [] };
    }
    /* Приводит набор в согласованное состояние: убирает опции, у которых пропало требуемое. */
    function settle(m, product, sel, removed) {
        var cur = sel.slice(), changed = true, rs = rulesFor(m, product), L = lockedMap(m, product), guard = 0;
        while (changed && guard++ < 50) {
            changed = false;
            rs.forEach(function (r) {
                if (r.type === 'requires' && r.ifCode && has(cur, r.ifCode)) {
                    var miss = r.targets.filter(function (t) { return !has(cur, t); });
                    if (miss.length && !L[r.ifCode]) { cur = without(cur, r.ifCode); removed.push({ code: r.ifCode, why: 'снят: нет «' + nm(m, miss[0]) + '»' }); changed = true; }
                }
                if (r.type === 'together') {
                    var mem = [r.ifCode].concat(r.targets).filter(Boolean), pres = mem.filter(function (x) { return has(cur, x); });
                    if (pres.length && pres.length < mem.length) {
                        pres.forEach(function (x) { if (!L[x]) { cur = without(cur, x); removed.push({ code: x, why: 'снят вместе с «' + nm(m, mem.filter(function (y) { return !has(pres, y); })[0]) + '» (только вместе)' }); } });
                        changed = true;
                    }
                }
            });
        }
        return cur;
    }
    /* Стартовый набор изделия: обязательные опции и «по умолчанию» (сначала общие, затем для изделия). */
    function initial(m, product) {
        var sel = [], rs = rulesFor(m, product);
        rs.filter(function (r) { return r.type === 'requires' && !r.ifCode; }).forEach(function (r) {
            r.targets.forEach(function (t) { var a = tryAdd(m, product, sel, t); if (a.ok) sel = a.sel; });
        });
        var defs = rs.filter(function (r) { return r.type === 'default' && !r.ifCode; });
        defs.sort(function (a, b) { return (a.product ? 1 : 0) - (b.product ? 1 : 0); });
        defs.forEach(function (r) {
            r.targets.forEach(function (t) { var a = tryAdd(m, product, sel, t); if (a.ok) sel = a.sel; });
        });
        return sel;
    }
    /* Клик по опции: выбор или снятие. Возвращает {ok, sel, added, removed, reasons}. */
    function toggle(m, product, sel, code) {
        if (has(sel, code)) {
            var L = lockedMap(m, product);
            if (L[code]) return { ok: false, sel: sel, added: [], removed: [], reasons: [{ kind: 'locked', text: 'Обязательно для изделия: ' + L[code] }] };
            var removed = [{ code: code, why: 'снято вручную' }];
            var out = settle(m, product, without(sel, code), removed);
            removed.shift();
            return { ok: true, sel: out, added: [], removed: removed, reasons: [] };
        }
        var r = tryAdd(m, product, sel, code);
        if (!r.ok) return { ok: false, sel: sel, added: [], removed: [], reasons: r.reasons };
        var rem = r.removed.slice(), s2 = settle(m, product, r.sel, rem);
        return { ok: true, sel: s2, added: r.added, removed: rem, reasons: [] };
    }
    /* Состояние мастера: какие опции погашены и почему, ошибки набора, пропущенные обязательные группы. */
    function evaluate(m, product, sel) {
        var disabled = {}, errors = [], missing = [], L = lockedMap(m, product);
        m.options.forEach(function (o) {
            if (has(sel, o.code)) return;
            var a = tryAdd(m, product, sel, o.code);
            if (!a.ok) disabled[o.code] = a.reasons.map(function (x) { return x.text; });
        });
        sel.forEach(function (c) {
            conflicts(m, product, without(sel, c), c).forEach(function (x) {
                if (x.kind === 'product' || sel.indexOf(x.with) > sel.indexOf(c)) errors.push({ code: c, rule: x.rule, text: x.text });
            });
        });
        rulesFor(m, product).forEach(function (r) {
            if (r.type === 'requires' && r.ifCode && has(sel, r.ifCode)) r.targets.forEach(function (t) { if (!has(sel, t)) errors.push({ code: r.ifCode, rule: r.id, text: '«' + nm(m, r.ifCode) + '» требует «' + nm(m, t) + '»: ' + r.message }); });
            if (r.type === 'requires' && !r.ifCode) r.targets.forEach(function (t) { if (!has(sel, t)) errors.push({ code: t, rule: r.id, text: 'Обязательно для изделия «' + nm(m, t) + '»: ' + r.message }); });
            if (r.type === 'together') {
                var mem = [r.ifCode].concat(r.targets).filter(Boolean), pres = mem.filter(function (x) { return has(sel, x); });
                if (pres.length && pres.length < mem.length) errors.push({ code: pres[0], rule: r.id, text: 'Только вместе: ' + mem.map(function (x) { return '«' + nm(m, x) + '»'; }).join(' и ') + ' - ' + r.message });
            }
        });
        m.groups.forEach(function (g) {
            var inG = sel.filter(function (c) { return m.optBy[c].group === g.name; });
            if (g.required && !inG.length) missing.push(g.name);
            if (g.mode === 'one' && inG.length > 1) errors.push({ code: inG[1], rule: null, text: 'В группе «' + g.name + '» можно выбрать только одно' });
        });
        return { disabled: disabled, locked: L, errors: errors, missing: missing, complete: !errors.length && !missing.length };
    }

    /* ---------- Цена ---------- */
    function volumePct(m, qty) {
        var p = 0; m.steps.forEach(function (s) { if (qty >= s.from) p = s.pct; }); return p;
    }
    function markupOf(m, group) {
        var g = m.custGroups.filter(function (x) { return x.name === group; })[0]; return g ? g.markup : 0;
    }
    /* Цена одной позиции: база + опции (фикс и % от базы) -> наценка группы клиента -> ступень по количеству. */
    function priceLine(m, line, custGroup) {
        var p = m.prodBy[line.product];
        if (!p) throw new Error('нет изделия ' + line.product);
        var parts = [{ label: p.name + ' (базовая цена)', amount: p.base, kind: 'base' }], cost = p.base * p.costShare / 100;
        var groupOrder = {}; m.groups.forEach(function (g, i) { groupOrder[g.name] = i; });
        var sel = line.sel.slice().sort(function (a, b) { return groupOrder[m.optBy[a].group] - groupOrder[m.optBy[b].group]; });
        sel.forEach(function (c) {
            var o = m.optBy[c], amt = o.priceType === 'percent' ? round(p.base * o.price / 100) : round(o.price);
            parts.push({ label: o.name, amount: amt, kind: 'option', code: c, group: o.group, pct: o.priceType === 'percent' ? o.price : null });
            cost += amt * o.costShare / 100;
        });
        var list = parts.reduce(function (s, x) { return s + x.amount; }, 0);
        var mk = markupOf(m, custGroup), unit = round(list * (1 + mk / 100)), qty = Math.max(1, round(num(line.qty) || 1)), vol = volumePct(m, qty);
        var total = round(unit * qty * (1 - vol / 100));
        return { parts: parts, listUnit: list, markupPct: mk, markupAmount: unit - list, unit: unit, qty: qty, volumePct: vol, volumeAmount: unit * qty - total, total: total, cost: round(cost * qty) };
    }
    /* Согласование скидки: лимит роли менеджера, минимальная маржа (по политике опции), ближайший согласующий.
     * discountPct - скидка, которую сверяем с лимитом: при скидке по позициям это наибольшая из скидок позиций. */
    function approval(m, discountPct, marginPct, roleName) {
        var role = roleOf(m, roleName), own = limitOf(m, roleName), view = marginView(m, roleName), policy = m.opts.marginPolicy;
        var minMargin = m.settings['Минимальная маржа, %'] === undefined ? 0 : m.settings['Минимальная маржа, %'];
        var approvers = m.roles.filter(function (r) { return r.approves; }).sort(function (a, b) { return a.limit - b.limit; });
        var maxLimit = companyLimit(m);
        var reasons = [], overLimit = discountPct > own + 1e-9, lowMargin = policy !== 'off' && marginPct < minMargin - 1e-9, blocked = discountPct > maxLimit + 1e-9, by = null;
        if (overLimit) reasons.push('Скидка ' + round1(discountPct) + '% выше вашего лимита ' + round1(own) + '%');
        if (lowMargin) reasons.push(view === 'show' ? 'Маржа ' + round1(marginPct) + '% ниже минимальной ' + round1(minMargin) + '%' : 'Маржа ниже допустимой');
        if (blocked) reasons.push('Скидка выше предела компании ' + round1(maxLimit) + '%: нужна индивидуальная схема');
        if (lowMargin && policy === 'block') { blocked = true; reasons.push('Сделка ниже минимальной маржи запрещена настройкой'); }
        if ((overLimit || lowMargin) && !blocked) {
            var cand = approvers.filter(function (r) { return r.limit >= discountPct - 1e-9 && r.level > role.level; })[0];
            if (lowMargin) cand = approvers[approvers.length - 1];
            by = cand ? cand.name : null;
        }
        return { needs: (overLimit || lowMargin) && !blocked, blocked: blocked, approver: by, reasons: reasons, limit: own, minMargin: minMargin, overLimit: overLimit, lowMargin: lowMargin, maxLimit: maxLimit, marginView: view };
    }
    /* КП целиком: позиции, скидка (на всё КП или по позициям - по опции), НДС, маржа, нужно ли согласование.
     * discountPct - скидка на всё КП; при скидке по позициям берётся line.disc каждой позиции. */
    function priceQuote(m, lines, custGroup, discountPct, roleName) {
        var byLines = m.opts.discountMode === 'lines';
        var priced = lines.map(function (l) {
            var p = priceLine(m, l, custGroup);
            p.discPct = byLines ? Math.max(0, num(l.disc)) : 0;
            p.discAmount = round(p.total * p.discPct / 100);
            p.payable = p.total - p.discAmount;
            return p;
        });
        var subtotal = priced.reduce(function (s, x) { return s + x.total; }, 0), cost = priced.reduce(function (s, x) { return s + x.cost; }, 0);
        var d, disc;
        if (byLines) { disc = priced.reduce(function (s, x) { return s + x.discAmount; }, 0); d = priced.reduce(function (s, x) { return Math.max(s, x.discPct); }, 0); }
        else { d = Math.max(0, num(discountPct)); disc = round(subtotal * d / 100); }
        var total = subtotal - disc;
        var vatPct = m.settings['НДС, %'] === undefined ? 20 : m.settings['НДС, %'], vat = round(total * vatPct / 100);
        var margin = total > 0 ? (total - cost) / total * 100 : 0;
        return { lines: priced, subtotal: subtotal, discountPct: d, discount: disc, effectivePct: subtotal > 0 ? round1(disc / subtotal * 100) : 0, byLines: byLines, total: total, vatPct: vatPct, vat: vat, totalVat: total + vat, cost: cost, marginPct: round1(margin),
            approval: approval(m, d, margin, roleName) };
    }
    function describe(m, sel) {
        var groupOrder = {}; m.groups.forEach(function (g, i) { groupOrder[g.name] = i; });
        return sel.slice().sort(function (a, b) { return groupOrder[m.optBy[a].group] - groupOrder[m.optBy[b].group]; }).map(function (c) { return nm(m, c); });
    }

    /* ---------- Тестовый прогон правил (для инженера) ---------- */
    function analyze(m, product) {
        var base = initial(m, product), req = m.groups.filter(function (g) { return g.required && g.mode === 'one'; });
        var lists = req.map(function (g) { return m.options.filter(function (o) { return o.group === g.name; }).map(function (o) { return o.code; }); });
        var total = 0, valid = 0, byOpt = {}, bad = {};
        function walk(i, sel) {
            if (i === lists.length) { total++; valid++; sel.forEach(function (c) { byOpt[c] = (byOpt[c] || 0) + 1; }); return; }
            var anyChild = false;
            lists[i].forEach(function (c) {
                var a = tryAdd(m, product, sel, c);
                if (!a.ok) { var cnt = 1; for (var j = i + 1; j < lists.length; j++) cnt *= lists[j].length; total += cnt; bad[c] = (bad[c] || 0) + cnt; return; }
                walk(i + 1, a.sel);
            });
        }
        walk(0, base);
        var dead = [];
        m.options.forEach(function (o) {
            var a = tryAdd(m, product, base, o.code);
            if (!a.ok) dead.push({ code: o.code, name: o.name, reason: a.reasons[0].text });
        });
        return { product: product, combos: total, valid: valid, invalid: total - valid, dead: dead, base: base };
    }
    /* Проверка самих правил: противоречия, которые инженер мог внести. */
    function lint(m) {
        var out = [];
        m.rules.filter(function (r) { return r.active; }).forEach(function (r) {
            if (r.ifCode && has(r.targets, r.ifCode)) out.push({ rule: r.id, text: 'Правило «' + r.name + '» ссылается само на себя' });
            if (!r.targets.length) out.push({ rule: r.id, text: 'У правила «' + r.name + '» нет целей' });
        });
        m.rules.filter(function (r) { return r.active && r.type === 'requires' && r.ifCode; }).forEach(function (a) {
            m.rules.filter(function (r) { return r.active && r.type === 'excludes'; }).forEach(function (b) {
                if (a.product && b.product && a.product !== b.product) return;
                a.targets.forEach(function (t) {
                    if ((b.ifCode === a.ifCode && has(b.targets, t)) || (b.ifCode === t && has(b.targets, a.ifCode)))
                        out.push({ rule: a.id, text: '«' + a.name + '» требует «' + nm(m, t) + '», а «' + b.name + '» его исключает' });
                });
            });
        });
        return out;
    }

    return {
        num: num, round: round, round1: round1, toIso: toIso, toDmy: toDmy, addDays: addDays, money: money, TYPE_NAME: TYPE_NAME, TYPE_BY_NAME: TYPE_BY_NAME,
        buildModel: buildModel, index: index, rulesFor: rulesFor, initial: initial, toggle: toggle, evaluate: evaluate, tryAdd: tryAdd,
        volumePct: volumePct, markupOf: markupOf, priceLine: priceLine, priceQuote: priceQuote, approval: approval, describe: describe,
        analyze: analyze, lint: lint,
        OPTION_DEFAULTS: OPTION_DEFAULTS, parseOptions: parseOptions, limitOf: limitOf, companyLimit: companyLimit, marginView: marginView, marginText: marginText, canSetStatus: canSetStatus
    };
});
