// Раскрой джамбо на мастер-рулоны (Фаза 2 atex, шаг 6; ideav/crm#5315).
//
// Общее ядро двух рабочих мест — «Раскрой джамбо» (диспетчер, jumbo-cutting.js) и
// «Пульт большого слиттера» (оператор, jumbo-slitter.js). Чистые функции, без DOM и сети:
//   1. потребность в форматах — открытые задания высечки без мастер-рулона, сгруппированные
//      по сырью позиции и диапазону формата ножа [мин. формат, мин. формат + допуск]
//      (мастер-рулон годится заказу, если он не уже минимального формата ножа и шире
//      ненамного: по плану высечки заказчика 95 % рулонов шире минимума на 0–15 мм);
//   2. покрытие потребности складом мастер-рулонов и очередью большого слиттера, дефицит
//      и «не успевает» (резка даст рулон позже план-старта высечки);
//   3. подбор карты раскроя партии по её фактической ширине: полосы под дефицит своего сырья
//      плюс ходовые ширины в запас (диапазоны из «Настройки», например 251-258 и 307-318);
//      три варианта — минимальный отход, закрыть дефицит, компромисс;
//   4. жёсткое правило §9.7 состава решения: сумма полос + кромка = ширина партии, кромка не
//      меньше минимальной (`checkCutMap`) — проверяется перед записью карты;
//   5. выпуск мастер-рулонов: длина джамбо делится на съёмы длиной мастер-рулона, каждый съём
//      даёт по рулону на полосу; прогресс считается по уже принятым рулонам, поэтому повтор
//      после сбоя дописывает недостающие, а не начинает съём заново.
//
// Состав решения — docs/atex_phase2_solution_composition.md §5.4, §5.7; ТЗ — §5.3.

(function(root, factory) {
    'use strict';
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (typeof window !== 'undefined') window.AtexJumboCutMap = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
    'use strict';

    // Статусы — текстовые значения поля «Статус задания этикетки» / «Статус мастер-рулона».
    var JOB_STATUS = { PLANNED: 'Запланировано', RUNNING: 'В работе', DONE: 'Выполнено' };
    var ROLL_STATUS = { STOCK: 'на складе', OPENED: 'початый', USED: 'израсходован', SCRAP: 'брак' };
    var PURPOSE = { DEFICIT: 'под дефицит', STOCK: 'в запас' };

    // Настройки («Настройка», тип базы / ATEH / общий) и значения по умолчанию.
    var SETTINGS = {
        RUNNING_WIDTHS: { key: 'JUMBO_RUNNING_WIDTHS', def: '' },
        FORMAT_TOLERANCE: { key: 'JUMBO_FORMAT_TOLERANCE_MM', def: 15 },
        MIN_EDGE: { key: 'JUMBO_MIN_EDGE_MM', def: 0 },
        ROLL_LENGTH: { key: 'MASTER_ROLL_LENGTH_M', def: 2000 },
        JOB_MINUTES: { key: 'JUMBO_JOB_MINUTES', def: 90 }
    };

    var VARIANT_LABEL = { waste: 'минимальный отход', cover: 'закрыть дефицит', balance: 'компромисс' };

    function norm(s) {
        return String(s == null ? '' : s).replace(/^\s*\d+:/, '').trim().toLowerCase();
    }

    function num(v) {
        var n = Number(String(v == null ? '' : v).replace(/\s/g, '').replace(',', '.'));
        return isFinite(n) ? n : 0;
    }

    // Ответ object/{t}/?JSON_KV → [{ id, val, reqs }] (главные значения — в `object[]`).
    function kvRecords(json) {
        var reqs = (json && json.reqs) || {};
        return ((json && json.object) || []).map(function(o) {
            return { id: String(o.id), val: o.val == null ? '' : String(o.val), reqs: reqs[o.id] || {} };
        });
    }

    function reqVal(rec, reqId) {
        var v = rec && rec.reqs && reqId ? rec.reqs[reqId] : null;
        return v == null ? '' : String(v);
    }

    // id записи по ссылке: `ref_{reqId}` = «таблица:id,id».
    function refId(rec, reqId) {
        var raw = rec && rec.reqs ? rec.reqs['ref_' + reqId] : null;
        if (raw == null || String(raw).trim() === '') return '';
        return String(raw).replace(/^\s*\d+:/, '').split(',')[0].trim();
    }

    // Значение настройки: строка с типом базы важнее «ATEH», та — общей. recs — [{ key, type, value }].
    function settingValue(recs, key, db) {
        var dbKey = String(db || '').trim().toUpperCase();
        var best = null, bestRank = 0;
        (recs || []).forEach(function(r) {
            if (String(r.key || '').replace(/^﻿/, '').trim() !== key) return;
            var v = String(r.value == null ? '' : r.value).trim();
            if (v === '') return;
            var type = String(r.type || '').trim().toUpperCase();
            var rank = dbKey && type === dbKey ? 3 : (type === 'ATEH' ? 2 : 1);
            if (rank >= bestRank) { best = v; bestRank = rank; }
        });
        return best == null ? '' : best;
    }

    // Все настройки раскроя: { runningWidths, tolerance, minEdge, rollLength, jobMinutes, errors }.
    function readSettings(recs, db) {
        var out = { errors: [] };
        var text = settingValue(recs, SETTINGS.RUNNING_WIDTHS.key, db);
        var parsed = parseWidthRanges(text);
        out.runningWidths = parsed.ranges;
        out.runningWidthsText = text;
        parsed.errors.forEach(function(e) { out.errors.push(SETTINGS.RUNNING_WIDTHS.key + ': ' + e); });
        [['tolerance', 'FORMAT_TOLERANCE'], ['minEdge', 'MIN_EDGE'], ['rollLength', 'ROLL_LENGTH'], ['jobMinutes', 'JOB_MINUTES']].forEach(function(p) {
            var s = SETTINGS[p[1]];
            var raw = settingValue(recs, s.key, db);
            var n = raw === '' ? s.def : num(raw);
            if (raw !== '' && !(n >= 0)) { out.errors.push(s.key + ': «' + raw + '» — не число'); n = s.def; }
            out[p[0]] = n;
        });
        if (!(out.rollLength > 0)) { out.errors.push(SETTINGS.ROLL_LENGTH.key + ' должна быть больше нуля'); out.rollLength = SETTINGS.ROLL_LENGTH.def; }
        return out;
    }

    // «251-258; 307-318» → { ok, ranges: [{ min, max }], errors }. Разделители — «;» и «,»,
    // тире любое; одиночная ширина — диапазон из одного значения.
    function parseWidthRanges(text) {
        var out = { ok: true, ranges: [], errors: [] };
        String(text == null ? '' : text).split(/[;,\n]/).forEach(function(tok) {
            var s = tok.trim();
            if (s === '') return;
            var m = /^(\d+(?:[.,]\d+)?)\s*(?:[-–—]\s*(\d+(?:[.,]\d+)?))?\s*(?:мм)?$/i.exec(s);
            if (!m) { out.errors.push('«' + s + '» — нужен вид «251-258»'); return; }
            var a = num(m[1]);
            var b = m[2] != null ? num(m[2]) : a;
            if (!(a > 0) || b < a) { out.errors.push('«' + s + '» — начало диапазона больше конца или ноль'); return; }
            out.ranges.push({ min: a, max: b });
        });
        out.ok = out.errors.length === 0;
        return out;
    }

    function isDoneStatus(s) {
        var v = norm(s);
        return v === 'выполнено' || v === 'закрыто' || v === 'отменено' || v === 'пропуск';
    }

    // Диапазон формата под нож: [мин, max(мин + допуск, опт)].
    function formatRange(min, opt, tolerance) {
        var lo = num(min);
        var hi = Math.max(lo + Math.max(0, num(tolerance)), num(opt));
        return { min: lo, max: hi };
    }

    // Строки отчёта die_tasks → группы потребности, по сроку.
    // [{ key, materialId, material, min, max, opt, meters, due, jobs: [job_id] }].
    // Пропущенные (нет формата ножа или сырья позиции) — в demandGroups.lastSkipped.
    function demandGroups(rows, opts) {
        var tol = opts && opts.tolerance != null ? opts.tolerance : SETTINGS.FORMAT_TOLERANCE.def;
        var by = {};
        var skipped = [];
        var open = (rows || []).filter(function(r) {
            return !isDoneStatus(r.job_status) && String(r.master_roll_id || '').trim() === '';
        }).sort(function(a, b) { return num(a.job_start) - num(b.job_start); });
        open.forEach(function(r) {
            var min = num(r.min_format) || num(r.used_format) || num(r.opt_format);
            var materialId = String(r.material_id || '').trim();
            if (!(min > 0) || materialId === '') {
                skipped.push({ jobId: String(r.job_id), reason: !(min > 0) ? 'у ножа нет формата' : 'у позиции нет сырья' });
                return;
            }
            var range = formatRange(min, r.opt_format, tol);
            var key = materialId + '|' + range.min + '|' + range.max;
            var g = by[key];
            if (!g) {
                g = by[key] = { key: key, materialId: materialId, material: String(r.material || ''), min: range.min, max: range.max,
                    opt: num(r.opt_format) || num(r.used_format) || range.min, meters: 0, due: Infinity, jobs: [] };
            }
            g.meters = Math.round((g.meters + num(r.footage)) * 10) / 10;
            var start = num(r.job_start);
            if (start > 0 && start < g.due) g.due = start;
            g.jobs.push(String(r.job_id));
        });
        demandGroups.lastSkipped = skipped;
        return Object.keys(by).map(function(k) {
            var g = by[k];
            if (g.due === Infinity) g.due = 0;
            return g;
        }).sort(function(a, b) { return (a.due || Infinity) - (b.due || Infinity) || a.min - b.min; });
    }

    // Склад мастер-рулонов → источники покрытия (готовы сейчас).
    // rolls — [{ id, format, materialId, rest, status }].
    function stockSupply(rolls) {
        return (rolls || []).filter(function(r) {
            var s = norm(r.status);
            return s !== ROLL_STATUS.SCRAP && s !== ROLL_STATUS.USED && num(r.rest) > 0;
        }).map(function(r) {
            return { id: String(r.id), materialId: String(r.materialId), format: num(r.format), meters: num(r.rest), readyAt: 0 };
        });
    }

    // Очередь большого слиттера → источники покрытия: ещё не принятые рулоны открытых заданий.
    // jobs — [{ id, start, minutes, materialId, length, strips, created }].
    function queueSupply(jobs, rollLength) {
        var out = [];
        (jobs || []).forEach(function(j) {
            var pulls = pullLengths(j.length, rollLength);
            var plan = releasePlan(j.strips, pulls).slice(Math.max(0, num(j.created)));
            var readyAt = num(j.start) + num(j.minutes) * 60;
            var by = {};
            plan.forEach(function(r) {
                var k = String(r.format);
                if (!by[k]) by[k] = { jobId: String(j.id), materialId: String(j.materialId), format: r.format, meters: 0, readyAt: readyAt };
                by[k].meters += r.length;
            });
            Object.keys(by).forEach(function(k) { out.push(by[k]); });
        });
        return out;
    }

    // Покрытие групп потребности: сначала склад, потом очередь резки (по готовности).
    // Источник покрывает группу своего сырья, если его формат в диапазоне группы.
    // → копии групп с { stock, planned, deficit, readyAt, late, sources }.
    function coverDemand(groups, stock, queue) {
        var pool = (stock || []).map(function(s) { return Object.assign({ left: num(s.meters), kind: 'stock' }, s); })
            .sort(function(a, b) { return a.format - b.format; });
        var q = (queue || []).map(function(s) { return Object.assign({ left: num(s.meters), kind: 'queue' }, s); })
            .sort(function(a, b) { return num(a.readyAt) - num(b.readyAt) || a.format - b.format; });
        return (groups || []).map(function(g0) {
            var g = Object.assign({}, g0, { stock: 0, planned: 0, readyAt: 0, late: false, sources: [] });
            var need = num(g.meters);
            var take = function(src) {
                src.forEach(function(s) {
                    if (need <= 0 || s.left <= 0) return;
                    if (String(s.materialId) !== String(g.materialId) || s.format < g.min || s.format > g.max) return;
                    var m = Math.min(need, s.left);
                    s.left -= m;
                    need -= m;
                    if (s.kind === 'stock') g.stock += m;
                    else {
                        g.planned += m;
                        if (num(s.readyAt) > g.readyAt) g.readyAt = num(s.readyAt);
                        if (g.due > 0 && num(s.readyAt) > g.due) g.late = true;
                    }
                    g.sources.push({ kind: s.kind, id: s.id || s.jobId, format: s.format, meters: m });
                });
            };
            take(pool);
            take(q);
            g.stock = Math.round(g.stock * 10) / 10;
            g.planned = Math.round(g.planned * 10) / 10;
            g.deficit = Math.max(0, Math.round(need * 10) / 10);
            return g;
        });
    }

    // Номинал и факт партии: ширина и длина — по паспорту партии, без него — из сырья;
    // пустой «Остаток» — вся длина (партию ещё не резали).
    function batchGeometry(batch, material) {
        var b = batch || {}, m = material || {};
        var width = num(b.widthFact) || num(m.jumboWidth);
        var length = num(b.lengthFact) || num(m.jumboLength);
        var restRaw = String(b.rest == null ? '' : b.rest).trim();
        return { width: width, length: length, rest: restRaw === '' ? length : num(restRaw),
            nominalWidth: num(m.jumboWidth), nominalLength: num(m.jumboLength) };
    }

    // ── Подбор карты раскроя ────────────────────────────────────────────────

    // Ширины полос набора: старт с минимумов, остаток ширины раздаётся целыми мм —
    // сначала полосам под дефицит до оптимального формата, потом ходовым до верхней
    // границы (широкий рулон в запас годится большему числу ножей). Шире оптимального
    // полоса под заказ не делается: лишняя ширина ушла бы в отход на высечке, а не в кромку,
    // и отход карты занижался бы.
    function assignWidths(items, counts, available) {
        var w = items.map(function(it) { return it.min; });
        var used = 0;
        items.forEach(function(it, i) { used += counts[i] * it.min; });
        var extra = available - used;
        var raise = function(filter, target) {
            items.forEach(function(it, i) {
                if (!counts[i] || !filter(it) || extra <= 0) return;
                var cap = Math.max(0, Math.min(target(it), it.max) - w[i]);
                var inc = Math.min(cap, Math.floor(extra / counts[i]));
                if (inc > 0) { w[i] += inc; extra -= inc * counts[i]; }
            });
        };
        raise(function(it) { return it.purpose === PURPOSE.DEFICIT; }, function(it) { return it.opt; });
        raise(function(it) { return it.purpose === PURPOSE.STOCK; }, function(it) { return it.max; });
        return w;
    }

    function inRunning(width, running) {
        return (running || []).some(function(r) { return width >= r.min && width <= r.max; });
    }

    // Варианты карты раскроя партии.
    // batch — { width, length, materialId } (фактические ширина, мм, и длина, м);
    // demand — группы с дефицитом { key, materialId, min, max, opt, deficit, due };
    // running — ходовые ширины [{ min, max }]; opts — { minEdge, stockWeight, maxGroups }.
    // → { variants: [{ kind, kinds, label, strips, edge, edgePct, covered, coveredTotal, stockMeters }], reason }.
    function cutMapVariants(batch, demand, running, opts) {
        opts = opts || {};
        var W = num(batch && batch.width);
        var L = num(batch && batch.length);
        var minEdge = Math.max(0, num(opts.minEdge));
        var stockWeight = opts.stockWeight != null ? num(opts.stockWeight) : 0.5;
        if (!(W > 0)) return { variants: [], reason: 'у партии нет ширины (ни по паспорту, ни в сырье)' };
        if (!(L > 0)) return { variants: [], reason: 'у партии нет длины (ни по паспорту, ни в сырье)' };
        var available = W - minEdge;
        var items = [];
        (demand || []).filter(function(g) {
            return String(g.materialId) === String(batch.materialId) && num(g.deficit) > 0 && num(g.min) > 0 && num(g.min) <= available;
        }).sort(function(a, b) { return (a.due || Infinity) - (b.due || Infinity); })
            .slice(0, opts.maxGroups || 6).forEach(function(g, rank) {
                items.push({ purpose: PURPOSE.DEFICIT, groupKey: g.key, min: num(g.min), max: Math.max(num(g.min), num(g.max)),
                    opt: Math.min(Math.max(num(g.opt), num(g.min)), Math.max(num(g.min), num(g.max))),
                    deficit: num(g.deficit), rank: rank, cap: Math.ceil(num(g.deficit) / L) });
            });
        (running || []).forEach(function(r) {
            if (num(r.min) > 0 && num(r.min) <= available) items.push({ purpose: PURPOSE.STOCK, min: num(r.min), max: num(r.max), opt: num(r.max), cap: Infinity });
        });
        if (!items.length) {
            return { variants: [], reason: (demand || []).some(function(g) { return num(g.deficit) > 0; }) ?
                'нет дефицита этого сырья, который помещается в ширину партии, и нет ходовых ширин' :
                'нет ни дефицита форматов, ни ходовых ширин в настройке ' + SETTINGS.RUNNING_WIDTHS.key };
        }

        var best = { waste: null, cover: null, balance: null };
        var counts = items.map(function() { return 0; });
        var nodes = 0, LIMIT = 200000;
        var evaluate = function() {
            var total = counts.reduce(function(a, c) { return a + c; }, 0);
            if (!total) return;
            var widths = assignWidths(items, counts, available);
            var sum = 0;
            items.forEach(function(it, i) { sum += counts[i] * widths[i]; });
            var edge = W - sum;
            var covered = {}, coveredVec = [], coveredM2 = 0, stockM = 0, stockM2 = 0;
            items.forEach(function(it, i) {
                var meters = counts[i] * L;
                if (it.purpose === PURPOSE.DEFICIT) {
                    var c = Math.min(meters, it.deficit);
                    if (counts[i]) covered[it.groupKey] = c;
                    coveredVec[it.rank] = c;
                    coveredM2 += c * widths[i] / 1000;
                    if (meters > c && inRunning(widths[i], running)) { stockM += meters - c; stockM2 += (meters - c) * widths[i] / 1000; }
                } else {
                    stockM += meters;
                    stockM2 += meters * widths[i] / 1000;
                }
            });
            var cand = { counts: counts.slice(), widths: widths, edge: edge, covered: covered, coveredVec: coveredVec,
                coveredM2: coveredM2, stockM: stockM, stockM2: stockM2, value: coveredM2 + stockWeight * stockM2 };
            if (!best.waste || edge < best.waste.edge || (edge === best.waste.edge && (coveredM2 > best.waste.coveredM2 ||
                (coveredM2 === best.waste.coveredM2 && stockM2 > best.waste.stockM2)))) best.waste = cand;
            if (!best.cover || cmpVec(coveredVec, best.cover.coveredVec) > 0 || (cmpVec(coveredVec, best.cover.coveredVec) === 0 && edge < best.cover.edge)) best.cover = cand;
            if (!best.balance || cand.value > best.balance.value + 1e-9 || (Math.abs(cand.value - best.balance.value) <= 1e-9 && edge < best.balance.edge)) best.balance = cand;
        };
        var dfs = function(i, left) {
            if (++nodes > LIMIT) return;
            if (i === items.length) { evaluate(); return; }
            var it = items[i];
            var maxC = Math.min(it.cap, Math.floor(left / it.min));
            for (var c = maxC; c >= 0; c--) {
                counts[i] = c;
                dfs(i + 1, left - c * it.min);
            }
            counts[i] = 0;
        };
        dfs(0, available);

        var seen = {};
        var variants = [];
        ['balance', 'cover', 'waste'].forEach(function(kind) {
            var c = best[kind];
            if (!c) return;
            var strips = [];
            items.forEach(function(it, i) {
                if (!c.counts[i]) return;
                var s = { format: c.widths[i], count: c.counts[i], purpose: it.purpose, min: it.min, max: it.max };
                if (it.groupKey) s.groupKey = it.groupKey;
                strips.push(s);
            });
            var sig = strips.map(function(s) { return s.format + 'x' + s.count + s.purpose + (s.groupKey || ''); }).join('|');
            var coveredTotal = 0;
            Object.keys(c.covered).forEach(function(k) { coveredTotal += c.covered[k]; });
            var v = { kind: kind, kinds: [kind], label: VARIANT_LABEL[kind], strips: strips, edge: c.edge, edgePct: Math.round(c.edge / W * 1000) / 10,
                covered: c.covered, coveredTotal: coveredTotal, stockMeters: c.stockM, length: L, width: W };
            // Совпавшие варианты — одна строка с несколькими подписями.
            if (seen[sig]) { seen[sig].kinds.push(kind); seen[sig].label += ' = ' + VARIANT_LABEL[kind]; return; }
            seen[sig] = v;
            variants.push(v);
        });
        return { variants: variants, reason: '', truncated: nodes > LIMIT };
    }

    function cmpVec(a, b) {
        var n = Math.max(a.length, b.length);
        for (var i = 0; i < n; i++) {
            var x = a[i] || 0, y = b[i] || 0;
            if (x !== y) return x > y ? 1 : -1;
        }
        return 0;
    }

    // Жёсткое правило §9.7: полосы целые и положительные, кромка ≥ минимальной,
    // сумма полос + кромка = фактическая ширина партии.
    function checkCutMap(width, strips, edge, minEdge) {
        var W = num(width);
        if (!(W > 0)) return { ok: false, error: 'у партии нет фактической ширины' };
        if (!strips || !strips.length) return { ok: false, error: 'в карте нет полос' };
        var sum = 0;
        for (var i = 0; i < strips.length; i++) {
            var f = num(strips[i].format), c = num(strips[i].count);
            if (!(f > 0) || !(c >= 1) || Math.floor(c) !== c) return { ok: false, error: 'полоса ' + (i + 1) + ': формат и число полос должны быть больше нуля, число — целым' };
            sum += f * c;
        }
        var e = num(edge);
        if (sum > W + 1e-6) return { ok: false, error: 'полосы ' + sum + ' мм шире партии ' + W + ' мм' };
        if (Math.abs(sum + e - W) > 1e-6) return { ok: false, error: 'полосы ' + sum + ' + кромка ' + e + ' ≠ ширина партии ' + W + ' мм' };
        if (e < Math.max(0, num(minEdge)) - 1e-6) return { ok: false, error: 'кромка ' + e + ' мм меньше минимальной ' + num(minEdge) + ' мм' };
        return { ok: true, sum: sum };
    }

    // Ручной ввод: «270x3 + 325х2», «270 × 3, 310» → { ok, strips: [{ format, count }] } | { ok:false, error }.
    function parseStripsText(text) {
        var src = String(text == null ? '' : text).trim();
        if (src === '') return { ok: false, error: 'полосы не заданы: нужен вид «270 × 3 + 325 × 2»' };
        var strips = [];
        var toks = src.split(/[+,;]/);
        for (var i = 0; i < toks.length; i++) {
            var s = toks[i].trim();
            if (s === '') continue;
            var m = /^(\d+(?:[.,]\d+)?)\s*(?:[xхX×*]\s*(\d+))?$/i.exec(s);
            if (!m) return { ok: false, error: '«' + s + '» — нужен вид «формат × полос», например «270 × 3»' };
            var f = num(m[1]), c = m[2] != null ? Number(m[2]) : 1;
            if (!(f > 0) || !(c >= 1)) return { ok: false, error: '«' + s + '» — формат и число полос должны быть больше нуля' };
            strips.push({ format: f, count: c });
        }
        if (!strips.length) return { ok: false, error: 'полосы не заданы' };
        return { ok: true, strips: strips };
    }

    function mapLabel(strips) {
        return (strips || []).map(function(s) { return num(s.format) + ' × ' + num(s.count); }).join(' + ');
    }

    // ── Съёмы и выпуск ──────────────────────────────────────────────────────

    // Длины съёмов: джамбо делится на мастер-рулоны; остаток длины — последний короткий съём.
    function pullLengths(length, rollLength) {
        var L = num(length), R = num(rollLength);
        if (!(L > 0) || !(R > 0)) return [];
        var out = [];
        var full = Math.floor(L / R + 1e-9);
        for (var i = 0; i < full; i++) out.push(R);
        var rem = Math.round((L - full * R) * 10) / 10;
        if (rem > 0) out.push(rem);
        return out;
    }

    // Все мастер-рулоны задания в порядке приёмки: съём за съёмом, в съёме — полоса за полосой.
    function releasePlan(strips, pulls) {
        var out = [];
        (pulls || []).forEach(function(len, p) {
            var n = 0;
            (strips || []).forEach(function(s, si) {
                for (var c = 0; c < num(s.count); c++) {
                    n++;
                    out.push({ pull: p, slot: n, length: len, format: num(s.format), purpose: s.purpose || '', strip: si });
                }
            });
        });
        return out;
    }

    // Прогресс по числу уже принятых рулонов задания.
    function pullProgress(strips, pulls, created) {
        var perPull = (strips || []).reduce(function(a, s) { return a + num(s.count); }, 0);
        var total = perPull * (pulls || []).length;
        var c = Math.max(0, Math.min(num(created), total));
        var done = total > 0 && c >= total;
        return { perPull: perPull, pulls: (pulls || []).length, total: total, created: c,
            pullIndex: perPull ? Math.min(Math.floor(c / perPull), (pulls || []).length) : 0,
            inPull: perPull ? c % perPull : 0, done: done };
    }

    // Рулоны, которые осталось принять в текущем съёме (повтор после сбоя — только недостающие).
    function pullRolls(strips, pulls, created) {
        var pr = pullProgress(strips, pulls, created);
        if (pr.done || !pr.perPull) return [];
        return releasePlan(strips, pulls).slice(pr.created, (pr.pullIndex + 1) * pr.perPull);
    }

    // Следующие номера мастер-рулонов «МР-NNNN» после наибольшего существующего.
    function nextRollNumbers(existing, n) {
        var max = 0;
        (existing || []).forEach(function(v) {
            var m = /^\s*МР-(\d+)\s*$/i.exec(String(v == null ? '' : v));
            if (m && Number(m[1]) > max) max = Number(m[1]);
        });
        var out = [];
        for (var i = 1; i <= n; i++) {
            var s = String(max + i);
            while (s.length < 4) s = '0' + s;
            out.push('МР-' + s);
        }
        return out;
    }

    // ── Состояние большого слиттера из записей базы ──────────────────────────

    // Порядок записи: id растут; нечисловые id — по строке.
    function byId(a, b) {
        return (num(a.id) - num(b.id)) || String(a.id).localeCompare(String(b.id));
    }

    // raw — { materials, batches, jobs, rolls } (kvRecords) + stripRows (отчёт jumbo_tasks);
    // t — resolveProductionTables(...).tables; rollLength — длина мастер-рулона, м.
    // → { materials, batches, jobs, openJobs, rolls, batchesToCut }.
    function buildState(raw, t, rollLength) {
        var R = function(key) { return (t[key] && t[key].reqs) || {}; };
        var materials = {};
        (raw.materials || []).forEach(function(m) {
            materials[m.id] = { id: m.id, name: m.val, jumboWidth: num(reqVal(m, R('material').jumboWidth)), jumboLength: num(reqVal(m, R('material').jumboLength)) };
        });
        var batches = {};
        (raw.batches || []).forEach(function(b) {
            var r = R('jumboBatch');
            var mid = refId(b, r.material);
            batches[b.id] = { id: b.id, no: b.val, materialId: mid, material: (materials[mid] && materials[mid].name) || reqVal(b, r.material),
                arrived: reqVal(b, r.arrived), warehouseId: refId(b, r.warehouse), warehouse: reqVal(b, r.warehouse),
                geometry: batchGeometry({ widthFact: reqVal(b, r.width), lengthFact: reqVal(b, r.length), rest: reqVal(b, r.rest) }, materials[mid]) };
        });
        var strips = {};
        (raw.stripRows || []).forEach(function(s) {
            var jid = String(s.job_id || '');
            if (!jid) return;
            (strips[jid] = strips[jid] || []).push({ id: String(s.strip_id), format: num(s.strip_format), count: num(s.strip_count) || 1, purpose: String(s.strip_purpose || '') });
        });
        Object.keys(strips).forEach(function(k) { strips[k].sort(byId); });
        var rr = R('masterRoll');
        var rolls = (raw.rolls || []).map(function(m) {
            return { id: m.id, no: m.val, format: num(reqVal(m, rr.format)), length: num(reqVal(m, rr.length)), materialId: refId(m, rr.material),
                jobId: refId(m, rr.jumboJob), rest: num(reqVal(m, rr.rest)), status: reqVal(m, rr.status), warehouseId: refId(m, rr.warehouse) };
        }).sort(byId);
        var jr = R('jumboJob');
        var jobs = (raw.jobs || []).map(function(j) {
            var batch = batches[refId(j, jr.jumboBatch)] || null;
            var own = rolls.filter(function(m) { return m.jobId === j.id; });
            var st = strips[j.id] || [];
            var pulls = pullLengths(batch ? batch.geometry.length : 0, rollLength);
            var status = reqVal(j, jr.status).trim() || JOB_STATUS.PLANNED;
            return { id: j.id, start: num(j.val), minutes: num(reqVal(j, jr.duration)), status: status, done: isDoneStatus(status),
                batchId: batch ? batch.id : '', batch: batch, materialId: batch ? batch.materialId : '', length: batch ? batch.geometry.length : 0,
                edge: num(reqVal(j, jr.edgeWaste)), strips: st, rolls: own, created: own.length, pulls: pulls,
                progress: pullProgress(st, pulls, own.length) };
        }).sort(function(a, b) { return a.start - b.start || num(a.id) - num(b.id); });
        var openJobs = jobs.filter(function(j) { return !j.done; });
        var busy = {};
        openJobs.forEach(function(j) { if (j.batchId) busy[j.batchId] = j.id; });
        var batchesToCut = Object.keys(batches).map(function(k) { return batches[k]; }).filter(function(b) {
            return b.geometry.rest > 0 && !busy[b.id];
        }).sort(function(a, b) { return String(a.no).localeCompare(String(b.no), 'ru', { numeric: true }); });
        return { materials: materials, batches: batches, jobs: jobs, openJobs: openJobs, rolls: rolls, batchesToCut: batchesToCut };
    }

    // Unix-секунды → «ДД.ММ ЧЧ:ММ» по Москве (UTC+3): время в РМ — серверное, московское.
    function fmtTime(unix, withYear) {
        var t = num(unix);
        if (!(t > 0)) return '—';
        var d = new Date((t + 3 * 3600) * 1000);
        var p = function(n) { return (n < 10 ? '0' : '') + n; };
        return p(d.getUTCDate()) + '.' + p(d.getUTCMonth() + 1) + (withYear ? '.' + d.getUTCFullYear() : '') + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes());
    }

    function fmtNum(n) {
        return String(Math.round(num(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    }

    // ── Клиент Integram (браузер) ───────────────────────────────────────────

    function Client(db, xsrf) {
        this.db = db;
        this.xsrf = xsrf || '';
    }
    Client.prototype.url = function(path) { return '/' + encodeURIComponent(this.db) + '/' + path; };
    Client.prototype.getJson = function(path) {
        return fetch(this.url(path), { credentials: 'same-origin' }).then(function(resp) {
            if (!resp.ok) throw new Error(path + ': HTTP ' + resp.status);
            return resp.json();
        });
    };
    Client.prototype.post = function(path, params) {
        var body = new URLSearchParams();
        body.set('_xsrf', (typeof window !== 'undefined' && window.xsrf) || this.xsrf);
        Object.keys(params || {}).forEach(function(k) { if (params[k] != null) body.set(k, params[k]); });
        return fetch(this.url(path), {
            method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString()
        }).then(function(resp) {
            return resp.text().then(function(text) {
                var result;
                try { result = JSON.parse(text); } catch (e) { throw new Error('Сервер вернул не JSON: ' + text.slice(0, 200)); }
                var err = result && (result.error || result.err || (Array.isArray(result) && result[0] && result[0].error));
                if (err) throw new Error(err);
                return result;
            });
        });
    };
    // Серверное «сейчас» — заголовок Date ответа; часы планшета не подставляются.
    Client.prototype.serverNow = function() {
        return fetch(this.url('xsrf?JSON'), { credentials: 'same-origin', cache: 'no-store' }).then(function(resp) {
            var t = Date.parse(String(resp.headers.get('Date') || ''));
            if (!isFinite(t)) throw new Error('сервер не прислал время (заголовок Date)');
            return Math.floor(t / 1000);
        });
    };

    var NEED_TABLES = ['jumboJob', 'jumboStrip', 'jumboBatch', 'material', 'masterRoll'];

    // Загрузка: метаданные → таблицы этикетки по именам, настройки раскроя, записи.
    // opts.demand — ещё отчёт die_tasks (потребность; пульту не нужен).
    function loadState(client, lp, opts) {
        opts = opts || {};
        return client.getJson('metadata').then(function(meta) {
            var res = lp.resolveProductionTables(meta, lp.PRODUCT_KIND.LABEL);
            var lost = NEED_TABLES.filter(function(k) { return !res.tables[k]; });
            if (lost.length) throw new Error('в базе нет таблиц: ' + lost.map(function(k) { return lp.PRODUCTION_CONFIGS[lp.PRODUCT_KIND.LABEL].tables[k].name; }).join(', '));
            var t = res.tables;
            var settingsTable = (meta || []).filter(function(x) { return String(x.val).trim() === 'Настройка'; })[0] || null;
            var sreq = function(name) { return ((settingsTable && settingsTable.reqs) || []).filter(function(r) { return r.val === name; })[0]; };
            var all = function(tid) { return client.getJson('object/' + tid + '/?JSON_KV&LIMIT=0,100000').then(kvRecords); };
            return Promise.all([
                all(t.material.id), all(t.jumboBatch.id), all(t.jumboJob.id), all(t.masterRoll.id),
                client.getJson('report/jumbo_tasks?JSON_KV&LIMIT=0,100000'),
                opts.demand ? client.getJson('report/die_tasks?JSON_KV&LIMIT=0,100000') : Promise.resolve([]),
                settingsTable ? all(settingsTable.id) : Promise.resolve([])
            ]).then(function(r) {
                var typeReq = sreq('Тип'), valReq = sreq('Значение');
                var settings = readSettings(r[6].map(function(s) {
                    return { key: s.val, type: typeReq ? reqVal(s, typeReq.id) : '', value: valReq ? reqVal(s, valReq.id) : '' };
                }), client.db);
                var state = buildState({ materials: r[0], batches: r[1], jobs: r[2], rolls: r[3], stripRows: Array.isArray(r[4]) ? r[4] : [] }, t, settings.rollLength);
                state.tables = t;
                state.missing = res.missing.filter(function(m) { return /^(Задание первичной резки|Полоса раскроя|Партия джамбо|Сырьё этикетки|Мастер-рулон) →/.test(m); });
                state.settings = settings;
                state.dieRows = Array.isArray(r[5]) ? r[5] : [];
                if (opts.demand && !Array.isArray(r[5])) state.missing.push('отчёт die_tasks');
                if (!Array.isArray(r[4])) state.missing.push('отчёт jumbo_tasks');
                return state;
            });
        });
    }

    // Поля _m_new нового задания первичной резки: план-старт (главное значение), партия,
    // длительность, статус «Запланировано», кромка по карте.
    function jobFields(t, p) {
        var f = {};
        var r = t.jumboJob.reqs;
        f['t' + t.jumboJob.id] = String(p.start);
        if (r.jumboBatch) f['t' + r.jumboBatch] = p.batchId;
        if (r.duration) f['t' + r.duration] = String(p.minutes);
        if (r.status) f['t' + r.status] = JOB_STATUS.PLANNED;
        if (r.edgeWaste) f['t' + r.edgeWaste] = String(p.edge);
        return f;
    }

    return {
        Client: Client,
        loadState: loadState,
        core: {
            JOB_STATUS: JOB_STATUS,
            ROLL_STATUS: ROLL_STATUS,
            PURPOSE: PURPOSE,
            SETTINGS: SETTINGS,
            VARIANT_LABEL: VARIANT_LABEL,
            num: num,
            norm: norm,
            kvRecords: kvRecords,
            reqVal: reqVal,
            refId: refId,
            settingValue: settingValue,
            readSettings: readSettings,
            parseWidthRanges: parseWidthRanges,
            isDoneStatus: isDoneStatus,
            formatRange: formatRange,
            demandGroups: demandGroups,
            stockSupply: stockSupply,
            queueSupply: queueSupply,
            coverDemand: coverDemand,
            batchGeometry: batchGeometry,
            cutMapVariants: cutMapVariants,
            checkCutMap: checkCutMap,
            parseStripsText: parseStripsText,
            mapLabel: mapLabel,
            pullLengths: pullLengths,
            releasePlan: releasePlan,
            pullProgress: pullProgress,
            pullRolls: pullRolls,
            nextRollNumbers: nextRollNumbers,
            buildState: buildState,
            jobFields: jobFields,
            fmtTime: fmtTime,
            fmtNum: fmtNum
        }
    };
});
