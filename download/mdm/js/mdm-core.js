/* MDM: чистые функции нормализации, похожести, поиска дублей, слияния и метрик качества НСИ. Без DOM и сети: работает и в браузере, и в Node. */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.MdmCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    var DAY = 86400000;
    /* Латиница, похожая на кириллицу: в кириллическом слове меняем на кириллицу, в артикуле - наоборот. */
    var LAT = 'aceopxykmthbACEOPXYKMTHB';
    var CYR = 'асеорхукмтнвАСЕОРХУКМТНВ';
    var ABBR = { 'подш': 'подшипник', 'рол': 'роликовый', 'каб': 'кабель', 'трикот': 'трикотажные', 'подшип': 'подшипник', 'эл': 'электрод', 'электр': 'электрод', 'перч': 'перчатки', 'тд': 'торговый дом', 'оцинк': 'оцинкованный', 'оц': 'оцинкованный', 'шар': 'шариковый', 'выкл': 'выключатель', 'авт': 'автоматический', 'выкл.авт': 'автоматический выключатель' };
    var LEGAL = ['общество с ограниченной ответственностью', 'публичное акционерное общество', 'акционерное общество', 'ооо', 'пао', 'зао', 'оао', 'ао', 'ип'];
    var DEFAULT_RULES = {
        'Номенклатура': [{ field: 'Артикул', how: 'точно', w: 45 }, { field: 'Наименование', how: 'нечётко', w: 35 }, { field: 'Бренд', how: 'точно', w: 20 }, { field: 'Единица измерения', how: 'точно', w: 5 }],
        'Контрагент': [{ field: 'ИНН', how: 'точно', w: 60 }, { field: 'КПП', how: 'точно', w: 10 }, { field: 'Наименование', how: 'нечётко', w: 30 }]
    };
    var DEFAULT_PARAMS = { dupThreshold: 85, hintThreshold: 70, autoMatch: 90, slaDays: 2, dupTarget: 2 };

    function num(v) { if (v === null || v === undefined || v === '') return 0; var n = parseFloat(String(v).replace(/\s/g, '').replace(',', '.')); return isNaN(n) ? 0 : n; }
    function utc(s) { var p = s.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
    function iso(ms) { var d = new Date(ms); return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2); }
    function toIso(v) { if (!v) return ''; var m = /^(\d{2})\.(\d{2})\.(\d{4})/.exec(v); return m ? m[3] + '-' + m[2] + '-' + m[1] : String(v).slice(0, 10); }
    function addDays(s, n) { return iso(utc(s) + n * DAY); }
    function diffDays(a, b) { return Math.round((utc(b) - utc(a)) / DAY); }
    /* Рабочие дни: суббота и воскресенье не считаются. */
    function addWorkDays(s, n) { var ms = utc(s); while (n > 0) { ms += DAY; var d = new Date(ms).getUTCDay(); if (d !== 0 && d !== 6) n--; } return iso(ms); }
    function workDaysBetween(a, b) { if (!a || !b || b <= a) return 0; var n = 0, ms = utc(a), end = utc(b); while (ms < end) { ms += DAY; var d = new Date(ms).getUTCDay(); if (d !== 0 && d !== 6) n++; } return n; }
    function ruDate(s) { s = toIso(s); return s ? s.slice(8, 10) + '.' + s.slice(5, 7) + '.' + s.slice(0, 4) : ''; }

    function swap(ch, from, to) { var i = from.indexOf(ch); return i < 0 ? ch : to.charAt(i); }
    function hasCyr(s) { return /[Ѐ-ӿ]/.test(s); }
    function hasLat(s) { return /[a-z]/i.test(s); }
    /* Слово, где смешаны латиница и кириллица (латинская o в слове «подшипник»). */
    function mixedScript(s) {
        return String(s || '').split(/[^0-9A-Za-zЀ-ӿ]+/).filter(function (w) { return w && hasCyr(w) && hasLat(w) && !/\d/.test(w); });
    }
    function fixWord(w) {
        if (/\d/.test(w)) return w.split('').map(function (c) { return swap(c, CYR, LAT); }).join('');
        if (!hasCyr(w) || !hasLat(w)) return w;
        return w.split('').map(function (c) { return swap(c, LAT, CYR); }).join('');
    }
    /* Наименование -> сравнимый вид: регистр, ё, гомоглифы, сокращения, кавычки, «М8х40» -> «м 8 40», «2,5» -> «2.5». */
    /* Грубая основа слова: «оцинкованный» и «оцинкованная» сравниваются одинаково. */
    function stem(w) { return w.length > 5 && /^[а-я]+$/.test(w) ? w.replace(/(ый|ая|ое|ые|ой|ий|яя|ие|ых|ого|ую)$/, '') : w; }
    function normName(s, kind) {
        var t = String(s || '').replace(/ /g, ' ').split(/\s+/).map(fixWord).join(' ').toLowerCase().replace(/ё/g, 'е');
        t = t.replace(/(\d),(\d)/g, '$1.$2').replace(/[«»"'`()\[\]\/\;:!?_]+/g, ' ').replace(/,/g, ' ');
        t = t.replace(/(\d)\s*[xх*×]\s*(\d)/g, '$1 $2').replace(/([a-zа-я])(\d)/g, '$1 $2').replace(/(\d)([a-zа-я])/g, '$1 $2');
        t = t.replace(/эл-ды/g, 'электроды').replace(/\.(?!\d)/g, ' ').replace(/-/g, ' ');
        var words = t.split(/\s+/).filter(Boolean).map(function (w) { return stem(ABBR[w] || w); });
        t = ' ' + words.join(' ') + ' ';
        if (kind === 'Контрагент') LEGAL.forEach(function (l) { t = t.split(' ' + l + ' ').join(' '); });
        return t.replace(/\s+/g, ' ').trim();
    }
    /* Артикул -> верхний регистр, кириллица-двойник -> латиница, без разделителей: «6205-2RS» = «6205 2rs». */
    function normArticle(s) {
        return String(s || '').split('').map(function (c) { return swap(c, CYR, LAT); }).join('').toUpperCase().replace(/[^0-9A-ZЀ-ӿ]/g, '');
    }
    function normCode(s) { return String(s || '').replace(/\D/g, ''); }
    function grams(s) { var t = '  ' + s + ' ', g = {}; for (var i = 0; i < t.length - 2; i++) { var k = t.substr(i, 3); g[k] = (g[k] || 0) + 1; } return g; }
    /* Коэффициент Дайса по триграммам, 0..1. */
    function dice(a, b) {
        if (!a && !b) return 1; if (!a || !b) return 0; if (a === b) return 1;
        var ga = grams(a), gb = grams(b), inter = 0, na = 0, nb = 0, k;
        for (k in ga) { na += ga[k]; if (gb[k]) inter += Math.min(ga[k], gb[k]); }
        for (k in gb) nb += gb[k];
        return 2 * inter / (na + nb);
    }
    function numbers(n) { return n.split(' ').filter(function (w) { return /^\d+(\.\d+)?$/.test(w); }).sort(); }
    /* Похожесть наименований: порядок слов не важен, разные размеры (числа) режут похожесть вдвое. */
    function nameSim(a, b, kind, drop) {
        var na = normName(a, kind), nb = normName(b, kind);
        (drop || []).forEach(function (w) { w = normName(w, kind); if (!w) return; na = (' ' + na + ' ').split(' ' + w + ' ').join(' ').trim(); nb = (' ' + nb + ' ').split(' ' + w + ' ').join(' ').trim(); });
        var s = Math.max(dice(na, nb), dice(na.split(' ').sort().join(' '), nb.split(' ').sort().join(' ')));
        var xa = numbers(na), xb = numbers(nb), diff = null;
        var sub = function (p, q) { return p.every(function (x) { return q.indexOf(x) >= 0; }); };
        if (xa.join(' ') !== xb.join(' ') && xa.length && xb.length) { s = s * (sub(xa, xb) || sub(xb, xa) ? 0.9 : 0.5); diff = xa.filter(function (x) { return xb.indexOf(x) < 0; }).concat(xb.filter(function (x) { return xa.indexOf(x) < 0; })); }
        return { sim: s, numDiff: diff };
    }
    function fieldValue(r, field) { return field === 'Наименование' ? r.name : r[field]; }
    function pct(x) { return Math.round(x * 100); }
    /* Сравнение двух записей по правилам: доля 0..100 и объяснение по каждому полю. Поле, пустое у одной из записей, в расчёт не идёт. */
    function compare(a, b, rules, kind) {
        var sum = 0, wsum = 0, parts = [];
        (rules || DEFAULT_RULES[kind] || []).forEach(function (r) {
            if (r.on === false || !(r.w > 0)) return;
            var va = fieldValue(a, r.field), vb = fieldValue(b, r.field);
            if (!va || !vb) { parts.push({ field: r.field, skip: true, note: r.field.toLowerCase() + ' есть не у обеих' }); return; }
            var s, note, lbl = /^[А-ЯA-Z]{2,}$/.test(r.field) ? r.field : r.field.toLowerCase();
            if (r.how === 'нечётко') {
                var ns = nameSim(va, vb, kind, [a['Бренд'], b['Бренд']]); s = ns.sim;
                note = lbl + ' похоже на ' + pct(s) + '%' + (ns.numDiff ? ' (размеры различаются: ' + ns.numDiff.join(', ') + ')' : '');
            } else {
                var ea = r.field === 'ИНН' || r.field === 'КПП' ? normCode(va) : normArticle(va), eb = r.field === 'ИНН' || r.field === 'КПП' ? normCode(vb) : normArticle(vb);
                s = ea === eb ? 1 : 0;
                note = lbl + (s ? ' совпал' + (String(va) !== String(vb) ? ' после нормализации (' + va + ' = ' + vb + ')' : ' (' + va + ')') : ' различается (' + va + ' / ' + vb + ')');
            }
            sum += r.w * s; wsum += r.w;
            parts.push({ field: r.field, sim: s, w: r.w, note: note });
        });
        var mixed = mixedScript(a.name).concat(mixedScript(b.name));
        if (mixed.length) parts.push({ field: 'Наименование', info: true, note: 'латиница внутри русского слова: ' + mixed.join(', ') });
        var score = wsum ? Math.round(100 * sum / wsum) : 0;
        return { score: score, parts: parts, reason: parts.filter(function (p) { return !p.skip; }).map(function (p) { return p.note; }).join('; ') };
    }
    function active(r) { return r.status !== 'Дубль (слит)' && r.status !== 'Заблокирована'; }
    /* Группы дублей: пары выше порога склеиваются от самых похожих, но группа растёт, только если ВСЕ её записи попарно выше порога
       (без цепочек «A похожа на B, B на C» - иначе серая и красная эмаль слипнутся через безымянную строку Excel). */
    function findDuplicates(records, rules, kind, threshold) {
        var rs = records.filter(active), par = {}, edges = [], sc = {};
        rs.forEach(function (r) { par[r.id] = r.id; });
        function root(x) { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; }
        for (var i = 0; i < rs.length; i++) for (var j = i + 1; j < rs.length; j++) {
            var c = compare(rs[i], rs[j], rules, kind);
            sc[rs[i].id + '|' + rs[j].id] = sc[rs[j].id + '|' + rs[i].id] = c.score;
            if (c.score >= threshold) edges.push({ a: rs[i].id, b: rs[j].id, score: c.score, reason: c.reason, parts: c.parts });
        }
        edges.sort(function (x, y) { return y.score - x.score; });
        var mem = {}; rs.forEach(function (r) { mem[r.id] = [r.id]; });
        edges = edges.filter(function (e) {
            var ra = root(e.a), rb = root(e.b);
            if (ra === rb) return true;
            var ok = mem[ra].every(function (x) { return mem[rb].every(function (y) { return sc[x + '|' + y] >= threshold; }); });
            if (ok) { par[ra] = rb; mem[rb] = mem[rb].concat(mem[ra]); }
            return ok;
        });
        var by = {}, byId = {};
        rs.forEach(function (r) { byId[r.id] = r; var k = root(r.id); (by[k] = by[k] || []).push(r); });
        var groups = Object.keys(by).filter(function (k) { return by[k].length > 1; }).map(function (k) {
            var m = by[k], ids = m.map(function (r) { return r.id; });
            var ps = edges.filter(function (e) { return ids.indexOf(e.a) >= 0; }).sort(function (x, y) { return y.score - x.score; });
            return { key: k, kind: kind, members: m, pairs: ps, score: Math.min.apply(null, ps.map(function (e) { return e.score; })), reason: ps[0].reason,
                sources: m.map(function (r) { return r.source; }).filter(function (s, i, a) { return a.indexOf(s) === i; }) };
        });
        return groups.sort(function (x, y) { return y.score - x.score || y.members.length - x.members.length; });
    }
    /* Похожие на черновик новой записи - подсказка при вводе. */
    function similarTo(draft, records, rules, kind, threshold, limit) {
        var d = Object.assign({ id: '_draft' }, draft);
        return records.filter(active).map(function (r) { var c = compare(d, r, rules, kind); return { rec: r, score: c.score, reason: c.reason }; })
            .filter(function (x) { return x.score >= threshold; }).sort(function (a, b) { return b.score - a.score; }).slice(0, limit || 5);
    }
    /* Золотая запись: приоритет источника (меньше - главнее), затем больше документов, затем старше. */
    function suggestGolden(members, prio) {
        prio = prio || {};
        return members.slice().sort(function (a, b) {
            var pa = prio[a.source] || 99, pb = prio[b.source] || 99;
            return pa - pb || num(b.docs) - num(a.docs) || String(a.date || '9').localeCompare(String(b.date || '9'));
        })[0];
    }
    /* Поле за полем: значение золотой записи, а где пусто - из самого приоритетного источника, где поле заполнено. */
    function mergeFields(members, golden, fields, prio) {
        prio = prio || {};
        var order = [golden].concat(members.filter(function (m) { return m !== golden; }).sort(function (a, b) { return (prio[a.source] || 99) - (prio[b.source] || 99); }));
        var out = {};
        fields.forEach(function (f) {
            var src = order.filter(function (m) { return fieldValue(m, f); })[0];
            out[f] = src ? { value: fieldValue(src, f), from: src.id, source: src.source } : { value: '', from: '', source: '' };
        });
        return out;
    }
    /* План слияния: что записать в журнал и какие записи поменять. Снимок «до» нужен для отката. */
    function planMerge(group, goldenId, chosen, ctx) {
        var g = group.members.filter(function (m) { return m.id === goldenId; })[0];
        if (!g) throw new Error('Золотая запись не из этой группы');
        var others = group.members.filter(function (m) { return m !== g; });
        var snap = group.members.map(function (m) { var o = { id: m.id, status: m.status, mergedInto: m.mergedInto || '' }; (ctx.fields || []).forEach(function (f) { o[f] = fieldValue(m, f) || ''; }); return o; });
        var gFields = {}; Object.keys(chosen || {}).forEach(function (f) { var v = chosen[f].value; if (v !== undefined && v !== fieldValue(g, f)) gFields[f] = v; });
        var updates = [{ id: g.id, fields: Object.assign({}, gFields, { 'Статус записи': 'Эталон' }) }].concat(others.map(function (m) { return { id: m.id, fields: { 'Статус записи': 'Дубль (слит)', 'Слита в': g.code } }; }));
        var pair = group.pairs[0] || { score: group.score, reason: group.reason };
        return {
            journal: { 'Вид справочника': group.kind, 'Золотая запись': g.code, 'Поглощённые записи': others.map(function (m) { return m.code; }).join(', '),
                'Доля совпадения': group.score, 'Причина совпадения': pair.reason, 'Поля из источников': JSON.stringify(chosen || {}), 'Снимок до слияния': JSON.stringify(snap),
                'Предложил': ctx.user, 'Дата предложения': ctx.today, 'Статус слияния': ctx.confirm ? 'Подтверждено' : 'Предложено', 'Подтвердил': ctx.confirm ? ctx.user : '', 'Дата решения': ctx.confirm ? ctx.today : '' },
            updates: updates, golden: g, absorbed: others
        };
    }
    /* Откат: вернуть каждой записи статус, ссылку «слита в» и поля из снимка. */
    function planRollback(snapJson, fields) {
        var snap = typeof snapJson === 'string' ? JSON.parse(snapJson || '[]') : snapJson;
        return snap.map(function (s) { var f = { 'Статус записи': s.status, 'Слита в': s.mergedInto || '' }; (fields || []).forEach(function (k) { if (s[k] !== undefined) f[k] = s[k]; }); return { id: s.id, fields: f }; });
    }
    /* Кто может что со слиянием: методолог предлагает, руководитель НСИ подтверждает (четыре глаза). */
    function mergeRights(role) {
        var r = String(role || '').toLowerCase(), head = r === 'руководитель нси' || r === 'admin';
        return { propose: head || r === 'методолог нси', confirm: head };
    }
    function validInn(inn) {
        var s = normCode(inn), k = function (w) { var x = 0; for (var i = 0; i < w.length; i++) x += w[i] * +s[i]; return x % 11 % 10; };
        if (s.length === 10) return k([2, 4, 10, 3, 5, 9, 4, 6, 8]) === +s[9];
        if (s.length === 12) return k([7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === +s[10] && k([3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === +s[11];
        return false;
    }
    /* Срок заявки: просрочена / сегодня / в срок; закрытая заявка не просрочивается. */
    function slaState(req, today) {
        if (req.status === 'Выполнена' || req.status === 'Отклонена') return { state: 'done', late: !!(req.done && req.due && req.done > req.due) };
        if (!req.due) return { state: 'ok', days: null };
        var d = diffDays(today, req.due);
        return { state: d < 0 ? 'late' : d === 0 ? 'today' : 'ok', days: d };
    }
    /* Доля дублей: лишние записи в группах (размер группы минус одна) от числа живых записей, %. */
    function dupShare(records, groups) {
        var n = records.filter(active).length, extra = 0;
        groups.forEach(function (g) { extra += g.members.length - 1; });
        return n ? Math.round(1000 * extra / n) / 10 : 0;
    }
    /* Сопоставление позиций внешних систем: доля найденных автоматически и доля подтверждённых. */
    function mapStats(maps) {
        var n = maps.length, auto = 0, ok = 0, prop = 0, none = 0;
        maps.forEach(function (m) {
            if (m.status === 'Подтверждено') { ok++; if (m.method === 'авто' || m.method === 'память') auto++; }
            else if (m.status === 'Предложено') prop++; else none++;
        });
        var p = function (x) { return n ? Math.round(1000 * x / n) / 10 : 0; };
        return { total: n, auto: auto, confirmed: ok, proposed: prop, notFound: none, autoPct: p(auto), confirmedPct: p(ok) };
    }
    /* Время заведения позиции: среднее число рабочих дней от заявки до выполнения по выполненным заявкам «Создать». */
    function entryDays(reqs) {
        var xs = reqs.filter(function (r) { return r.kind === 'Создать' && r.status === 'Выполнена' && r.date && r.done; }).map(function (r) { return workDaysBetween(r.date, r.done); });
        return xs.length ? Math.round(10 * xs.reduce(function (a, b) { return a + b; }, 0) / xs.length) / 10 : 0;
    }
    /* Лучший кандидат эталона для внешней позиции (прайс партнёра): по наименованию вместе с артикулом и брендом. */
    function bestMatch(extName, goldens, kind) {
        var best = null;
        goldens.forEach(function (g) {
            var s = nameSim(extName, g.name, kind, [g['Бренд'], 'арт', g['Артикул']]).sim;
            var art = normArticle(g['Артикул']); if (art && art.length > 3 && normArticle(extName).indexOf(art) >= 0) s = Math.max(s, 0.6 + 0.4 * s);
            if (!best || s > best.sim) best = { rec: g, sim: s };
        });
        return best ? { rec: best.rec, score: pct(best.sim) } : null;
    }
    /* Матрица «эталон <-> коды в системах»: сама запись, слитые в неё дубли и строки соответствий. */
    function codeMatrix(records, maps, systems) {
        var golden = records.filter(function (r) { return active(r); }), byCode = {}, rows = [];
        golden.forEach(function (g) { var row = { rec: g, cells: {} }; byCode[g.code] = row; rows.push(row); add(row, g.source, { code: g.srcCode, name: g.name, via: 'запись', status: 'Подтверждено' }); });
        function add(row, sys, cell) { (row.cells[sys] = row.cells[sys] || []).push(cell); }
        records.forEach(function (r) { if (r.status === 'Дубль (слит)' && byCode[r.mergedInto]) add(byCode[r.mergedInto], r.source, { code: r.srcCode, name: r.name, via: 'слита', status: 'Подтверждено' }); });
        var byId = {}; golden.forEach(function (g) { byId[g.id] = byCode[g.code]; });
        maps.forEach(function (m) { var row = byId[m.nomId]; if (row) add(row, m.system, { code: m.ext, name: m.extName, via: 'соответствие', status: m.status, score: m.score, method: m.method, id: m.id }); });
        rows.forEach(function (row) { row.covered = (systems || []).filter(function (s) { return row.cells[s]; }).length; });
        return rows;
    }
    function csvCell(v) { var s = String(v === undefined || v === null ? '' : v); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
    function toCsv(head, rows) { return [head].concat(rows).map(function (r) { return r.map(csvCell).join(';'); }).join('\r\n'); }
    /* Правила и параметры из таблиц базы -> объекты расчёта. */
    function parseRules(rows) {
        var out = {};
        (rows || []).forEach(function (x) { var k = x.kind; if (!k) return; (out[k] = out[k] || []).push({ id: x.id, name: x.name, field: x.field, how: x.how, w: num(x.w), on: x.on !== false }); });
        Object.keys(DEFAULT_RULES).forEach(function (k) { if (!out[k] || !out[k].length) out[k] = DEFAULT_RULES[k]; });
        return out;
    }
    function parseParams(map) {
        var p = Object.assign({}, DEFAULT_PARAMS), keys = { 'Порог дубля, %': 'dupThreshold', 'Порог подсказки при вводе, %': 'hintThreshold', 'Порог автосопоставления, %': 'autoMatch', 'Срок заявки, раб. дн.': 'slaDays', 'Цель: доля дублей, %': 'dupTarget' };
        Object.keys(keys).forEach(function (k) { if (map && map[k] !== undefined && map[k] !== '') p[keys[k]] = num(map[k]); });
        return p;
    }

    return {
        DEFAULT_RULES: DEFAULT_RULES, DEFAULT_PARAMS: DEFAULT_PARAMS, num: num, toIso: toIso, ruDate: ruDate, addDays: addDays, diffDays: diffDays, addWorkDays: addWorkDays, workDaysBetween: workDaysBetween,
        mixedScript: mixedScript, normName: normName, normArticle: normArticle, dice: dice, nameSim: nameSim, compare: compare, active: active, findDuplicates: findDuplicates, similarTo: similarTo,
        suggestGolden: suggestGolden, mergeFields: mergeFields, planMerge: planMerge, planRollback: planRollback, mergeRights: mergeRights, validInn: validInn, slaState: slaState,
        dupShare: dupShare, mapStats: mapStats, entryDays: entryDays, bestMatch: bestMatch, codeMatrix: codeMatrix, toCsv: toCsv, parseRules: parseRules, parseParams: parseParams
    };
});
