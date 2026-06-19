// Рабочее место atex «Расчёт оптимальной резки» (роли Диспетчер/Администратор).
//
// Калькулятор-визуализатор: по выбранному Виду сырья (ширина джамбо и длина
// рулона), желаемым ширинам полос и количеству рулонов для каждой подбирает
// карты раскроя ножей с минимальным отходом и показывает, сколько рулонов
// получится. Решение ideav/crm#3465, доработки ideav/crm#3474. Правила разработки
// рабочих мест — docs/WORKSPACE_DEVELOPMENT_GUIDE.md, раздел 3.12 docs/atex_workplaces.md.
//
// Модель расчёта (#3474):
//   • считаем по ФАКТИЧЕСКОЙ ширине полосы — пользователь задаёт номинал
//     («Ширина в заказе»), а справочник «Фактическая ширина резки» (table 66190)
//     переводит его в фактическую с учётом условия (ширина джамбо). На геометрию
//     раскроя идёт фактическая ширина;
//   • в идеале — по ОДНОЙ карте раскроя на каждую ширину (все ножи одной ширины,
//     джамбо заполняется максимально плотно). Ширины объединяются в одну карту
//     ТОЛЬКО если это снижает суммарный отход. Жёсткий потолок — 3 карты;
//   • НИЧЕГО НА СКЛАД: каждая карта режет только заказанные ширины, остаток
//     джамбо — это «Отход» (необрезаемый край), а не складские полосы;
//   • «Отход, мм» одной карты = W − Σ(ширина × ножей); общий отход (м²) считается
//     по всем картам с учётом числа проходов и длины рулона.
//
// Кнопка «В заказ» создаёт под выбранным (или новым) Заказом по одной Позиции
// заказа на каждую ширину — это единственная запись данных. Номер нового заказа
// подсказывается запросом `report/nextOrder`.
//
// Чистое ядро расчёта вынесено в объект `core` и экспортируется через
// module.exports для модульных тестов (experiments/atex-cut-optimizer.test.js).

(function(root, factory) {
    'use strict';
    var api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }
    if (typeof window !== 'undefined') {
        window.AtexCutOptimizer = api;
        if (typeof document !== 'undefined') {
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', api.init);
            } else {
                api.init();
            }
        }
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
    'use strict';

    // Имена таблиц/реквизитов схемы atex (docs/atex_metadata.json). По именам
    // рабочее место находит конкретные числовые id в метаданных текущей сборки.
    var TABLE = {
        material: 'Вид сырья',
        actualWidth: 'Фактическая ширина резки',
        order: 'Заказ',
        position: 'Позиция заказа',
        sleeve: 'Диаметр втулки',
        client: 'Клиент'
    };
    var MATERIAL_REQ = { width: 'Ширина, мм', length: 'Длина рулона, м', tolerance: 'Допуск, мм' };
    // Справочник «Фактическая ширина резки»: главное значение записи — факт. ширина,
    // «Ширина в заказе» — номинал, «Код» — условие применения.
    var ACTUAL_WIDTH_REQ = { order: 'Ширина в заказе', code: 'Код' };
    // Реквизиты «Заказа» и «Позиции заказа» — резолвятся по любому из имён.
    var ORDER_REQ = {
        client: ['Клиент'], manager: ['Менеджер', 'Пользователь'],
        created: ['Дата создания'], status: ['Статус заказа', 'Статус'],
        lead: ['Лидер'], due: ['Срок изготовления']
    };
    var POSITION_REQ = {
        qty: ['Кол-во', 'Количество'], raw: ['Вид сырья'],
        width: ['Ширина, мм', 'Ширина'], length: ['Длина, м', 'Длина'],
        sleeve: ['Диаметр втулки'], winding: ['Тип намотки'],
        status: ['Статус позиции', 'Статус']
    };
    var DEFAULT_ORDER_STATUS = 'Новый';
    var DEFAULT_POSITION_STATUS = 'Новая';
    var MAX_MAPS = 3;
    // Длина рулона по умолчанию и набор стандартных длин для выбора (можно ввести
    // свою). Список — по частоте использования в заказах (м).
    var DEFAULT_LENGTH = 450;
    var LENGTH_PRESETS = [300, 600, 700, 900, 1000];

    // ───────────────────────── Чистое ядро расчёта ─────────────────────────

    // Терпимый разбор числа: принимает запятую как десятичный разделитель,
    // отбрасывает пробелы; «пусто»/мусор → 0.
    function toNumber(value) {
        if (typeof value === 'number') return isFinite(value) ? value : 0;
        var text = String(value == null ? '' : value).replace(/\s+/g, '').replace(',', '.');
        var n = parseFloat(text);
        return isFinite(n) ? n : 0;
    }

    // Округление до 3 знаков, чтобы убрать артефакты float-арифметики.
    function round3(n) {
        return Math.round(toNumber(n) * 1000) / 1000;
    }

    // НОД двух целых неотрицательных чисел (алгоритм Евклида).
    function gcd2(a, b) {
        a = Math.abs(Math.round(a));
        b = Math.abs(Math.round(b));
        while (b) { var t = b; b = a % b; a = t; }
        return a;
    }

    // НОД списка положительных целых. Пустой/нулевой список → 1.
    function gcdAll(nums) {
        var g = 0;
        (nums || []).forEach(function(n) { g = gcd2(g, n); });
        return g > 0 ? g : 1;
    }

    // ── #3474: фактическая ширина резки (справочник table 66190) ──
    // «Код» правила: '' (пусто) — безусловно; 'j=910'/'j>1000' — по ширине джамбо;
    // 's=0.5' — по диаметру втулки в дюймах. Калькулятор знает только ширину
    // джамбо, поэтому 's…'-правила (нет контекста втулки) не применяются.
    // Поддержаны операторы = > < >= <=.
    function parseActualWidthCode(code) {
        var c = String(code == null ? '' : code).trim().toLowerCase().replace(/\s+/g, '');
        if (!c) return { key: '', op: '', val: 0 };           // безусловно
        var m = c.match(/^([js])(>=|<=|=|>|<)(\d+(?:\.\d+)?)$/);
        if (!m) return { key: '?', op: '', val: 0 };          // нераспознан → не применяем
        return { key: m[1], op: m[2], val: Number(m[3]) };
    }

    // ctx: { jumbo, inches }. key 'j' → сверяем с ширина джамбо, 's' → дюймы втулки.
    // '' → всегда true; '?' → всегда false (жёсткий фильтр).
    function actualWidthCodeMatches(parsed, ctx) {
        if (!parsed || parsed.key === '') return true;
        if (parsed.key === '?') return false;
        var v = parsed.key === 'j' ? (ctx && ctx.jumbo) : (ctx && ctx.inches);
        if (v == null || v === '' || !isFinite(Number(v))) return false;
        v = Number(v);
        switch (parsed.op) {
            case '=':  return Math.abs(v - parsed.val) < 1e-6;
            case '>':  return v > parsed.val + 1e-9;
            case '<':  return v < parsed.val - 1e-9;
            case '>=': return v >= parsed.val - 1e-9;
            case '<=': return v <= parsed.val + 1e-9;
        }
        return false;
    }

    // rows: [{ actual, order, code }] из справочника → индекс
    // { round3(order): [{ actual, parsed }] }. Условные правила идут раньше
    // безусловных — приоритет более специфичного правила при совпадении номинала.
    function buildActualWidthIndex(rows) {
        var index = {};
        (rows || []).forEach(function(row) {
            var order = round3(row && row.order);
            var actual = round3(row && row.actual);
            if (!(order > 0) || !(actual > 0)) return;
            var key = String(order);
            (index[key] || (index[key] = [])).push({ order: order, actual: actual, parsed: parseActualWidthCode(row.code) });
        });
        Object.keys(index).forEach(function(key) {
            index[key].sort(function(a, b) {
                return (b.parsed.key !== '' ? 1 : 0) - (a.parsed.key !== '' ? 1 : 0);
            });
        });
        return index;
    }

    // Фактическая ширина для номинала с учётом контекста. Нет правила или ни одно
    // условие не выполнено → возвращаем номинал (жёсткий фильтр, как в планировании).
    function resolveCutWidth(nominalWidth, ctx, index) {
        var n = round3(nominalWidth);
        if (!(n > 0)) return nominalWidth;
        var rows = (index && index[String(n)]) || [];
        for (var i = 0; i < rows.length; i++) {
            if (actualWidthCodeMatches(rows[i].parsed, ctx)) {
                return rows[i].actual > 0 ? rows[i].actual : n;
            }
        }
        return n;
    }

    // Нормализация желаемых полос: номинальная ширина/количество, отбрасываются
    // строки без положительной ширины. Количество < 1 → 1 (нельзя хотеть 0).
    function normalizeItems(items) {
        return (items || []).map(function(it) {
            return { width: round3(it && it.width), qty: Math.max(1, Math.round(toNumber(it && it.qty))) };
        }).filter(function(it) { return it.width > 0; });
    }

    // Раскладка одной карты по группе ширин. Группа = подмножество заказанных
    // ширин, режется на одном джамбо. Раскладка = пропорциональный спросу набор
    // (через НОД), уложенный в W максимально плотно. НИЧЕГО НА СКЛАД: добора
    // остатка нет — лишний край джамбо это «Отход», а не складские полосы (#3474).
    // Если пропорциональный набор шире джамбо — группу одной картой не нарезать
    // (fits=false), её следует разбить на отдельные карты. Возвращает:
    //   { knives:[по индексу ширины], passes, usedWidth, trimWidth, fits }.
    function packGroup(inputWidth, widths, qtys) {
        var W = round3(inputWidth);
        var g = gcdAll(qtys);
        var ratio = qtys.map(function(q) { return q / g; });
        var setWidth = round3(ratio.reduce(function(s, r, i) { return s + r * widths[i]; }, 0));
        var sets = setWidth > 0 ? Math.floor(round3(W / setWidth)) : 0;

        if (sets < 1) {
            return { knives: widths.map(function() { return 0; }), passes: 0, usedWidth: 0, trimWidth: W, fits: false };
        }
        var knives = ratio.map(function(r) { return sets * r; });
        // Число проходов: sets·passes ≈ НОД, чтобы итог по рулонам лёг ближе к желаемому.
        var passes = Math.max(1, Math.round(g / sets));
        var usedWidth = round3(knives.reduce(function(s, c, i) { return s + c * widths[i]; }, 0));
        return { knives: knives, passes: passes, usedWidth: usedWidth, trimWidth: round3(W - usedWidth), fits: true };
    }

    // Разбиения индексов [0..n-1] на не более `maxBlocks` непустых групп.
    // Для калькулятора ширин немного, поэтому полный перебор уместен; при большом
    // числе ширин (> 8) возвращаем единственное разбиение «все вместе».
    function partitionsAtMost(n, maxBlocks) {
        if (n <= 0) return [[]];
        if (n > 8) return [[Array.apply(null, { length: n }).map(function(_, i) { return i; })]];
        var result = [];
        (function rec(i, blocks) {
            if (i === n) { result.push(blocks.map(function(b) { return b.slice(); })); return; }
            for (var b = 0; b < blocks.length; b++) {
                blocks[b].push(i);
                rec(i + 1, blocks);
                blocks[b].pop();
            }
            if (blocks.length < maxBlocks) {
                blocks.push([i]);
                rec(i + 1, blocks);
                blocks.pop();
            }
        })(0, []);
        return result;
    }

    // Развернуть ножи карты в отдельные сегменты со смещением слева (для рисунка).
    function expandSegments(pattern) {
        var segments = [];
        var offset = 0;
        (pattern || []).forEach(function(s, stripIndex) {
            var width = round3(s.width);
            var count = Math.max(0, Math.round(toNumber(s.knives)));
            for (var k = 0; k < count; k++) {
                segments.push({ stripIndex: stripIndex, width: width, offset: round3(offset) });
                offset = round3(offset + width);
            }
        });
        return segments;
    }

    // Полный расчёт плана резки.
    //   inputWidth — ширина джамбо, мм;
    //   items — желаемые полосы [{width(номинал), qty}];
    //   options.rollLength — длина рулона, м (для площади отхода);
    //   options.actualWidthIndex — индекс справочника фактической ширины (#3474);
    //   options.maxMaps — потолок числа карт (по умолчанию 3).
    function computePlan(inputWidth, items, options) {
        options = options || {};
        var W = round3(inputWidth);
        var rollLength = round3(options.rollLength);
        var maxMaps = options.maxMaps > 0 ? Math.floor(options.maxMaps) : MAX_MAPS;
        var index = options.actualWidthIndex || null;
        var ctx = { jumbo: W > 0 ? W : null, inches: null };

        // Номинал → факт; агрегируем по фактической ширине (по ней режем и считаем).
        var norm = normalizeItems(items);
        var byActual = {};
        var order = [];
        norm.forEach(function(it) {
            var actual = round3(resolveCutWidth(it.width, ctx, index));
            var key = String(actual);
            if (!byActual[key]) { byActual[key] = { actualWidth: actual, nominalWidth: it.width, qty: 0 }; order.push(key); }
            byActual[key].qty += it.qty;
            // если один и тот же факт собрался из разных номиналов — показываем «смешанный».
            if (byActual[key].nominalWidth !== it.width) byActual[key].nominalWidth = null;
        });
        var all = order.map(function(k) { return byActual[k]; });
        var overflow = all.filter(function(it) { return it.actualWidth > W; });
        var usable = all.filter(function(it) { return it.actualWidth <= W; });

        var base = {
            inputWidth: W, rollLength: rollLength,
            items: all, overflow: overflow,
            feasible: false, reason: '', proportionKept: true,
            maps: [], results: [],
            mapCount: 0, totalPasses: 0,
            totalDesired: 0, totalProduced: 0,
            totalWasteWidth: 0, wastePct: 0, totalWasteAreaM2: 0
        };

        if (W <= 0) { base.reason = 'Укажите ширину входа (джамбо) больше нуля.'; return base; }
        if (!usable.length) {
            base.reason = overflow.length
                ? 'Все заданные ширины больше ширины входа — раскроить нельзя.'
                : 'Добавьте хотя бы одну полосу (ширина и количество).';
            return base;
        }

        var widths = usable.map(function(it) { return it.actualWidth; });
        var qtys = usable.map(function(it) { return it.qty; });

        // Выбираем разбиение ширин на ≤ maxMaps карт. По умолчанию — по одной карте
        // на ширину; объединяем только когда это помогает делу. Критерии по
        // приоритету: (1) все группы режутся одной картой; (2) ближе к желаемому
        // (минимум суммарного отклонения |выпуск − спрос|, чтобы не недодать и не
        // перепроизвести на склад); (3) меньше отход; (4) больше карт — ближе к
        // идеалу «одна карта на ширину».
        var partitions = partitionsAtMost(widths.length, maxMaps);
        var bestChoice = null;
        partitions.forEach(function(part) {
            var packs = part.map(function(idxs) {
                var gw = idxs.map(function(i) { return widths[i]; });
                var gq = idxs.map(function(i) { return qtys[i]; });
                return { idxs: idxs, pack: packGroup(W, gw, gq) };
            });
            var prod = {};
            packs.forEach(function(p) {
                p.idxs.forEach(function(i, j) { prod[i] = (prod[i] || 0) + p.pack.knives[j] * p.pack.passes; });
            });
            var deviation = qtys.reduce(function(s, q, i) { return s + Math.abs((prod[i] || 0) - q); }, 0);
            var waste = packs.reduce(function(s, p) { return s + p.pack.trimWidth * p.pack.passes; }, 0);
            var infeasible = packs.reduce(function(s, p) { return s + (p.pack.fits ? 0 : 1); }, 0);
            var score = { infeasible: infeasible, deviation: deviation, waste: round3(waste), maps: part.length };
            if (!bestChoice || better(score, bestChoice.score)) bestChoice = { packs: packs, score: score };
        });

        var maps = bestChoice.packs.map(function(p, mi) {
            var pattern = p.idxs.map(function(i, j) {
                return { width: widths[i], nominalWidth: usable[i].nominalWidth, knives: p.pack.knives[j] };
            }).filter(function(s) { return s.knives > 0; })
              .sort(function(a, b) { return b.width - a.width; });
            return {
                index: mi + 1,
                pattern: pattern,
                segments: expandSegments(pattern),
                passes: p.pack.passes,
                knivesTotal: p.pack.knives.reduce(function(s, c) { return s + c; }, 0),
                usedWidth: p.pack.usedWidth,
                trimWidth: p.pack.trimWidth,
                trimPct: W > 0 ? round3(p.pack.trimWidth / W * 100) : 0,
                fits: p.pack.fits
            };
        });

        // Произведено по каждой ширине = Σ по картам (ножи ширины × проходы карты).
        var producedByWidth = {};
        bestChoice.packs.forEach(function(p) {
            p.idxs.forEach(function(i, j) {
                var key = String(widths[i]);
                producedByWidth[key] = (producedByWidth[key] || 0) + p.pack.knives[j] * p.pack.passes;
            });
        });

        var results = usable.map(function(it) {
            var produced = producedByWidth[String(it.actualWidth)] || 0;
            return {
                actualWidth: it.actualWidth,
                nominalWidth: it.nominalWidth,
                desiredQty: it.qty,
                produced: produced,
                deviation: produced - it.qty
            };
        });

        var totalPasses = maps.reduce(function(s, m) { return s + m.passes; }, 0);
        var totalDesired = qtys.reduce(function(s, q) { return s + q; }, 0);
        var totalProduced = results.reduce(function(s, r) { return s + r.produced; }, 0);
        var totalWasteWidth = round3(maps.reduce(function(s, m) { return s + m.trimWidth * m.passes; }, 0));
        // Доля отхода = отход во всех проходах ÷ полная ширина всех проходов джамбо.
        var wastePct = totalPasses > 0 ? round3(totalWasteWidth / (W * totalPasses) * 100) : 0;
        // Площадь отхода (м²) = Σ по картам (отход(м) × длина рулона(м) × проходов).
        var totalWasteAreaM2 = rollLength > 0
            ? round3(maps.reduce(function(s, m) { return s + m.trimWidth / 1000 * rollLength * m.passes; }, 0))
            : 0;

        base.feasible = true;
        base.proportionKept = maps.every(function(m) { return m.fits; });
        base.maps = maps;
        base.results = results;
        base.mapCount = maps.length;
        base.totalPasses = totalPasses;
        base.totalDesired = totalDesired;
        base.totalProduced = totalProduced;
        base.totalWasteWidth = totalWasteWidth;
        base.wastePct = wastePct;
        base.totalWasteAreaM2 = totalWasteAreaM2;
        return base;

        // Лучше: меньше нерезабельных групп; затем ближе к желаемому; затем меньше
        // отход; затем больше карт (ближе к идеалу «одна карта на ширину»).
        function better(a, b) {
            if (a.infeasible !== b.infeasible) return a.infeasible < b.infeasible;
            if (a.deviation !== b.deviation) return a.deviation < b.deviation;
            if (a.waste !== b.waste) return a.waste < b.waste;
            return a.maps > b.maps;
        }
    }

    // Доля сегмента шириной `width` в шкале карты. Шкала — максимум из ширины
    // входа и занятой ширины. Проценты [0..100].
    function widthPercent(width, inputWidth, usedWidth) {
        var scale = Math.max(toNumber(inputWidth), toNumber(usedWidth));
        if (scale <= 0) return 0;
        return round3(toNumber(width) / scale * 100);
    }

    var core = {
        toNumber: toNumber,
        round3: round3,
        gcd2: gcd2,
        gcdAll: gcdAll,
        parseActualWidthCode: parseActualWidthCode,
        actualWidthCodeMatches: actualWidthCodeMatches,
        buildActualWidthIndex: buildActualWidthIndex,
        resolveCutWidth: resolveCutWidth,
        normalizeItems: normalizeItems,
        packGroup: packGroup,
        partitionsAtMost: partitionsAtMost,
        expandSegments: expandSegments,
        computePlan: computePlan,
        widthPercent: widthPercent
    };

    // ─────────────────────────── Браузерный слой ───────────────────────────
    // Ниже — DOM-контроллер. Требует window/document/fetch; в Node не выполняется.

    function el(tag, attrs, children) {
        var node = document.createElement(tag);
        if (attrs) Object.keys(attrs).forEach(function(k) {
            if (k === 'class') node.className = attrs[k];
            else if (k === 'text') node.textContent = attrs[k];
            else if (k === 'html') node.innerHTML = attrs[k];
            else if (k === 'dataset') Object.keys(attrs[k]).forEach(function(d) { node.dataset[d] = attrs[k][d]; });
            else node.setAttribute(k, attrs[k]);
        });
        (children || []).forEach(function(c) {
            if (c == null) return;
            node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
        });
        return node;
    }

    // Индекс колонки реквизита по имени в JSON_OBJ-строке (колонки идут в
    // порядке [главное значение, ...reqs]; раздел 6 гайда).
    function colIndex(meta, reqName) {
        if (!meta) return -1;
        var order = [String(meta.id)].concat((meta.reqs || []).map(function(r) { return String(r.id); }));
        var found = (meta.reqs || []).filter(function(r) {
            return String(r.val).trim().toLowerCase() === String(reqName).trim().toLowerCase();
        })[0];
        return found ? order.indexOf(String(found.id)) : -1;
    }

    function cellValue(rec, meta, reqName) {
        var idx = colIndex(meta, reqName);
        var r = (rec && rec.r) || [];
        return idx >= 0 ? r[idx] : undefined;
    }

    // id реквизита таблицы по любому из имён (для записи t{reqId}=...).
    function reqIdByNames(meta, names) {
        if (!meta) return '';
        var wanted = (names || []).map(function(n) { return String(n).trim().toLowerCase(); });
        var found = (meta.reqs || []).filter(function(r) {
            return wanted.indexOf(String(r.val).trim().toLowerCase()) >= 0;
        })[0];
        return found ? String(found.id) : '';
    }

    function AtexCutOptimizer(root) {
        this.root = root;
        this.db = (typeof window !== 'undefined' && window.db) || root.getAttribute('data-db') || '';
        this.xsrf = root.getAttribute('data-xsrf') || (typeof window !== 'undefined' && window.xsrf) || '';
        this.meta = { material: null, actualWidth: null, order: null, position: null, sleeve: null, client: null };
        this.materials = [];      // [{ id, label, width, length }]
        this.sleeves = [];        // [{ id, label }]
        this.clients = [];        // [{ id, label }]
        this.orders = [];         // [{ id, number }]
        this.actualWidthIndex = {};
        this.materialId = '';
        this.rows = [{ width: '', qty: '1' }]; // желаемые полосы (UI-состояние)
        this.lengthValue = String(DEFAULT_LENGTH); // длина рулона по умолчанию (#3474-fix)
        this.plan = null;
        this.busy = false;
    }

    AtexCutOptimizer.prototype.url = function(path) {
        return '/' + encodeURIComponent(this.db) + '/' + path;
    };

    AtexCutOptimizer.prototype.getJson = function(path) {
        return fetch(this.url(path), { credentials: 'same-origin' }).then(function(resp) {
            return resp.text().then(function(text) {
                try { return JSON.parse(text); }
                catch (e) { throw new Error('Некорректный JSON: ' + text.slice(0, 200)); }
            });
        });
    };

    // POST t{reqId}=value (+ _xsrf) формой; разбирает JSON-ответ.
    AtexCutOptimizer.prototype.post = function(path, fields) {
        var params = [];
        if (this.xsrf) params.push('_xsrf=' + encodeURIComponent(this.xsrf));
        Object.keys(fields || {}).forEach(function(reqId) {
            var v = fields[reqId];
            if (v == null || v === '') return;
            params.push('t' + reqId + '=' + encodeURIComponent(v));
        });
        return fetch(this.url(path), {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.join('&')
        }).then(function(resp) {
            return resp.text().then(function(text) {
                var data = null;
                try { data = JSON.parse(text); } catch (e) {}
                if (!resp.ok) throw new Error((data && (data.error || data.msg)) || text.slice(0, 200) || ('HTTP ' + resp.status));
                if (data && data.error) throw new Error(data.error);
                return data || {};
            });
        });
    };

    AtexCutOptimizer.prototype.loadMetadata = function() {
        var self = this;
        return this.getJson('metadata').then(function(all) {
            var list = Array.isArray(all) ? all : [all];
            function byName(name) {
                return list.filter(function(t) {
                    return String(t.val).trim().toLowerCase() === name.trim().toLowerCase();
                })[0] || null;
            }
            self.meta.material = byName(TABLE.material);
            self.meta.actualWidth = byName(TABLE.actualWidth);
            self.meta.order = byName(TABLE.order);
            self.meta.position = byName(TABLE.position);
            self.meta.sleeve = byName(TABLE.sleeve);
            self.meta.client = byName(TABLE.client);
            if (!self.meta.material) throw new Error('В метаданных не найдена таблица «' + TABLE.material + '»');
        });
    };

    // Список «Видов сырья» с шириной и длиной рулона — для поиска и автоподстановки.
    AtexCutOptimizer.prototype.loadMaterials = function() {
        var self = this;
        var meta = this.meta.material;
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,1000').then(function(rows) {
            self.materials = (rows || []).map(function(rec) {
                return {
                    id: String(rec.i),
                    label: (rec.r && rec.r[0]) || ('#' + rec.i),
                    width: cellValue(rec, meta, MATERIAL_REQ.width) || '',
                    length: cellValue(rec, meta, MATERIAL_REQ.length) || '',
                    tolerance: cellValue(rec, meta, MATERIAL_REQ.tolerance) || ''
                };
            });
        });
    };

    // Справочник «Фактическая ширина резки» (#3474) → this.actualWidthIndex.
    // Нет таблицы/доступа → пустой индекс (фича тихо деградирует к номиналу).
    AtexCutOptimizer.prototype.loadActualWidths = function() {
        var self = this;
        this.actualWidthIndex = {};
        var meta = this.meta.actualWidth;
        if (!meta) return Promise.resolve();
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,5000').then(function(rows) {
            var list = (rows || []).map(function(rec) {
                return {
                    actual: (rec.r || [])[0],
                    order: cellValue(rec, meta, ACTUAL_WIDTH_REQ.order),
                    code: cellValue(rec, meta, ACTUAL_WIDTH_REQ.code) || ''
                };
            });
            self.actualWidthIndex = buildActualWidthIndex(list);
        }).catch(function() { self.actualWidthIndex = {}; });
    };

    // Простой справочник [{id,label}] по таблице (для втулок/клиентов/заказов).
    AtexCutOptimizer.prototype.loadRefList = function(meta) {
        if (!meta) return Promise.resolve([]);
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,2000').then(function(rows) {
            return (rows || []).map(function(rec) {
                return { id: String(rec.i), label: (rec.r && rec.r[0] != null && String(rec.r[0]) !== '') ? String(rec.r[0]) : ('#' + rec.i) };
            });
        }).catch(function() { return []; });
    };

    AtexCutOptimizer.prototype.materialById = function(id) {
        var wanted = String(id);
        return this.materials.filter(function(m) { return String(m.id) === wanted; })[0] || null;
    };

    // ── Рендеринг каркаса ──

    AtexCutOptimizer.prototype.start = function() {
        var self = this;
        this.root.innerHTML = '';
        var layoutEl = el('div', { class: 'atex-co-layout' });

        this.formEl = el('section', { class: 'atex-co-form' });
        layoutEl.appendChild(this.formEl);

        this.viewEl = el('section', { class: 'atex-co-view' });
        this.viewEl.appendChild(el('div', { class: 'atex-co-placeholder', text: 'Заполните параметры слева и нажмите «Рассчитать».' }));
        layoutEl.appendChild(this.viewEl);

        this.root.appendChild(layoutEl);
        this.toastHost = this.root;

        this.formEl.appendChild(el('div', { class: 'atex-co-loading', text: 'Загрузка справочника сырья…' }));

        return this.loadMetadata()
            .then(function() {
                return Promise.all([
                    self.loadMaterials(),
                    self.loadActualWidths(),
                    self.loadRefList(self.meta.sleeve).then(function(l) { self.sleeves = l; }),
                    self.loadRefList(self.meta.client).then(function(l) { self.clients = l; }),
                    self.loadRefList(self.meta.order).then(function(l) {
                        self.orders = l.map(function(o) { return { id: o.id, number: o.label }; });
                    })
                ]);
            })
            .then(function() { self.renderForm(); })
            .catch(function(err) { self.fatal('Ошибка инициализации: ' + err.message); });
    };

    AtexCutOptimizer.prototype.renderForm = function() {
        var self = this;
        var form = this.formEl;
        form.innerHTML = '';
        form.appendChild(el('h2', { class: 'atex-co-form-title', text: 'Параметры резки' }));

        // Вид сырья — поиск по справочнику (AtexRefSearch).
        var matField = el('div', { class: 'atex-co-field' }, [
            el('label', { class: 'atex-co-label', text: 'Вид сырья' })
        ]);
        if (typeof window !== 'undefined' && window.AtexRefSearch && window.AtexRefSearch.createSelect) {
            var select = window.AtexRefSearch.createSelect({
                classPrefix: 'atex-co',
                inputClass: 'atex-co-input',
                options: this.materials.map(function(m) { return { id: m.id, label: m.label }; }),
                value: this.materialId,
                placeholder: 'Начните вводить вид сырья…',
                onChange: function(id) { self.onMaterialChange(id); }
            });
            matField.appendChild(select);
        } else {
            var sel = el('select', { class: 'atex-co-input' }, [ el('option', { value: '', text: '— не выбрано —' }) ]
                .concat(this.materials.map(function(m) { return el('option', { value: m.id, text: m.label }); })));
            sel.value = this.materialId;
            sel.addEventListener('change', function() { self.onMaterialChange(sel.value); });
            matField.appendChild(sel);
        }
        form.appendChild(matField);

        // Ширина входа и длина рулона.
        var dims = el('div', { class: 'atex-co-grid2' });
        this.widthInput = el('input', { class: 'atex-co-input', type: 'text', inputmode: 'decimal',
            placeholder: 'напр. 910', value: this.widthValue || '' });
        // Длина рулона: выбор из стандартного списка с возможностью ввести свою.
        var lengthListId = 'atex-co-length-list';
        var lengthList = el('datalist', { id: lengthListId },
            LENGTH_PRESETS.map(function(v) { return el('option', { value: String(v) }); }));
        this.lengthInput = el('input', { class: 'atex-co-input', type: 'text', inputmode: 'decimal',
            list: lengthListId, autocomplete: 'off', placeholder: 'напр. 450',
            value: (this.lengthValue == null || this.lengthValue === '') ? String(DEFAULT_LENGTH) : this.lengthValue });
        this.widthInput.addEventListener('input', function() { self.widthValue = self.widthInput.value; self.maybeRecalc(); });
        this.lengthInput.addEventListener('input', function() { self.lengthValue = self.lengthInput.value; self.maybeRecalc(); });
        dims.appendChild(el('div', { class: 'atex-co-field' }, [
            el('label', { class: 'atex-co-label', text: 'Ширина входа (джамбо), мм' }), this.widthInput
        ]));
        dims.appendChild(el('div', { class: 'atex-co-field' }, [
            el('label', { class: 'atex-co-label', text: 'Длина рулона, м' }), this.lengthInput, lengthList
        ]));
        form.appendChild(dims);

        // Допуск на отход, мм — автоподстановка из Вида сырья («Допуск, мм»),
        // редактируемый. По нему красится отход каждой карты раскроя.
        this.tolInput = el('input', { class: 'atex-co-input', type: 'text', inputmode: 'decimal',
            placeholder: 'напр. 20', value: this.tolValue || '' });
        this.tolInput.addEventListener('input', function() { self.tolValue = self.tolInput.value; self.maybeRecalc(); });
        form.appendChild(el('div', { class: 'atex-co-field' }, [
            el('label', { class: 'atex-co-label', text: 'Допуск, мм' }), this.tolInput
        ]));

        // Желаемые полосы (ширина + количество), редактируемый список.
        form.appendChild(el('div', { class: 'atex-co-rows-head' }, [
            el('span', { class: 'atex-co-label', text: 'Желаемые рулоны (ширина в заказе)' })
        ]));
        this.rowsEl = el('div', { class: 'atex-co-rows' });
        form.appendChild(this.rowsEl);
        this.renderRows();

        var addBtn = el('button', { class: 'atex-co-btn atex-co-btn-secondary', type: 'button', text: '+ Добавить ширину' });
        addBtn.addEventListener('click', function() { self.rows.push({ width: '', qty: '1' }); self.renderRows(); self.maybeRecalc(); });
        form.appendChild(addBtn);

        var calcBtn = el('button', { class: 'atex-co-btn atex-co-btn-primary', type: 'button', text: 'Рассчитать' });
        calcBtn.addEventListener('click', function() { self.calculate(); });
        form.appendChild(calcBtn);

        // Ctrl+Enter из любого поля формы — рассчитать.
        form.addEventListener('keydown', function(e) {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); self.calculate(); }
        });
    };

    AtexCutOptimizer.prototype.renderRows = function() {
        var self = this;
        var box = this.rowsEl;
        box.innerHTML = '';
        this.rows.forEach(function(row, idx) {
            var widthInput = el('input', { class: 'atex-co-input', type: 'text', inputmode: 'decimal',
                placeholder: 'ширина, мм', value: row.width });
            widthInput.addEventListener('input', function() { row.width = widthInput.value; self.maybeRecalc(); });
            // Кол-во — целое, числовое, шаг 5 (#3478).
            var qtyInput = el('input', { class: 'atex-co-input', type: 'number', inputmode: 'numeric',
                min: '0', step: '5', placeholder: 'кол-во', value: row.qty });
            qtyInput.addEventListener('input', function() { row.qty = qtyInput.value; self.maybeRecalc(); });
            var del = el('button', { class: 'atex-co-row-del', type: 'button', title: 'Удалить', text: '×' });
            del.addEventListener('click', function() {
                self.rows.splice(idx, 1);
                if (!self.rows.length) self.rows.push({ width: '', qty: '1' });
                self.renderRows();
                self.maybeRecalc();
            });
            box.appendChild(el('div', { class: 'atex-co-row' }, [widthInput, qtyInput, del]));
        });
    };

    AtexCutOptimizer.prototype.onMaterialChange = function(id) {
        this.materialId = String(id || '');
        var m = this.materialById(this.materialId);
        if (m) {
            // Подставляем только ширину джамбо; длину рулона задаёт пользователь
            // (по умолчанию 450, выбор из списка стандартных длин), материал её не диктует.
            if (this.widthInput) this.widthInput.value = String(m.width || '');
            this.widthValue = String(m.width || '');
            // Допуск на отход — из выбранного материала (поле редактируемое).
            if (this.tolInput) this.tolInput.value = String(m.tolerance || '');
            this.tolValue = String(m.tolerance || '');
        }
        this.maybeRecalc();
    };

    // ── Расчёт ──

    AtexCutOptimizer.prototype.calculate = function() {
        var inputWidth = this.widthInput ? this.widthInput.value : '';
        var rollLength = this.lengthInput ? this.lengthInput.value : '';
        var items = this.rows.map(function(r) { return { width: r.width, qty: r.qty }; });
        this.plan = computePlan(inputWidth, items, {
            rollLength: rollLength,
            actualWidthIndex: this.actualWidthIndex,
            maxMaps: MAX_MAPS
        });
        this.calculated = true;   // после первого расчёта правки полей пересчитывают раскладку (#3478)
        this.renderResult();
    };

    // Живой пересчёт раскладки при изменении полей — только после первого
    // «Рассчитать» (#3478). Дебаунс, чтобы не пересчитывать на каждое нажатие.
    AtexCutOptimizer.prototype.maybeRecalc = function() {
        if (!this.calculated) return;
        var self = this;
        if (this._recalcTimer) clearTimeout(this._recalcTimer);
        this._recalcTimer = setTimeout(function() { self._recalcTimer = null; self.calculate(); }, 200);
    };

    AtexCutOptimizer.prototype.renderResult = function() {
        var self = this;
        var view = this.viewEl;
        view.innerHTML = '';
        var p = this.plan;
        if (!p) {
            view.appendChild(el('div', { class: 'atex-co-placeholder', text: 'Заполните параметры слева и нажмите «Рассчитать».' }));
            return;
        }
        if (!p.feasible) {
            view.appendChild(el('div', { class: 'atex-co-warn', text: p.reason }));
            return;
        }

        var mat = this.materialById(this.materialId);
        var head = el('div', { class: 'atex-co-result-head' }, [
            el('h2', { class: 'atex-co-result-title', text: 'План резки' + (mat ? ': ' + mat.label : '') })
        ]);
        var toOrderBtn = el('button', { class: 'atex-co-btn atex-co-btn-primary atex-co-to-order', type: 'button', text: 'В заказ' });
        toOrderBtn.addEventListener('click', function() { self.openOrderModal(); });
        head.appendChild(toOrderBtn);
        view.appendChild(head);

        if (!p.proportionKept) {
            view.appendChild(el('div', { class: 'atex-co-note',
                text: 'Заданный набор шире джамбо — пропорции желаемых количеств сохранить нельзя; ширина набита максимально плотно.' }));
        }
        if (p.overflow && p.overflow.length) {
            view.appendChild(el('div', { class: 'atex-co-note',
                text: 'Не помещаются (шире джамбо): ' + p.overflow.map(function(o) { return o.actualWidth + ' мм'; }).join(', ') }));
        }

        view.appendChild(this.renderSummary(p));
        view.appendChild(this.renderMaps(p));
        view.appendChild(this.renderTable(p));
    };

    // Несколько карт раскроя (по одной на ширину, объединённые ради отхода).
    AtexCutOptimizer.prototype.renderMaps = function(p) {
        var wrap = el('div', { class: 'atex-co-maps' });
        // Допуск на отход материала (Вид сырья → «Допуск, мм»), редактируемый.
        var tol = this.tolInput ? toNumber(this.tolInput.value) : 0;
        p.maps.forEach(function(m) {
            var card = el('div', { class: 'atex-co-map' });
            var widthsLabel = m.pattern.map(function(s) { return s.width + '×' + s.knives; }).join(' + ');
            card.appendChild(el('div', { class: 'atex-co-bar-caption' }, [
                el('span', { class: 'atex-co-map-title', text: 'Карта ' + m.index + ' · ' + widthsLabel }),
                el('span', { class: 'atex-co-bar-caption-used',
                    text: m.passes + (m.passes === 1 ? ' резка' : ' резок') + ' · занято ' + m.usedWidth + ' мм' })
            ]));
            var bar = el('div', { class: 'atex-co-bar' });
            m.segments.forEach(function(seg) {
                var pct = widthPercent(seg.width, p.inputWidth, m.usedWidth);
                var node = el('div', { class: 'atex-co-seg atex-co-seg-order', title: seg.width + ' мм · Заказ' });
                node.style.width = pct + '%';
                // Подпись ширины — для ВСЕХ полос, в т.ч. узких (#3478-fix): узкая
                // подпись поворачивается вертикально (класс is-narrow), чтобы влезть.
                appendSegLabel(node, seg.width, pct);
                bar.appendChild(node);
            });
            if (m.trimWidth > 0) {
                var rpct = widthPercent(m.trimWidth, p.inputWidth, m.usedWidth);
                var rem = el('div', { class: 'atex-co-seg atex-co-seg-remainder', title: 'Отход: ' + m.trimWidth + ' мм' });
                rem.style.width = rpct + '%';
                appendSegLabel(rem, m.trimWidth, rpct);
                bar.appendChild(rem);
            }
            card.appendChild(bar);
            // Цвет отхода по допуску материала: ≤ допуска — норма (зелёный),
            // больше — превышение (красный). Без допуска — нейтрально (0 = зелёный).
            var wasteCls = 'atex-co-map-waste';
            if (tol > 0) wasteCls += (m.trimWidth <= tol ? ' is-ok' : ' is-warn');
            else if (m.trimWidth === 0) wasteCls += ' is-ok';
            var wasteText = 'Отход: ' + m.trimWidth + ' мм (' + m.trimPct + '%)'
                + (tol > 0 ? ' · допуск ' + round3(tol) + ' мм' : '');
            card.appendChild(el('div', { class: 'atex-co-map-foot' }, [
                el('span', { text: 'Полос/резку: ' + m.knivesTotal }),
                el('span', { class: wasteCls, text: wasteText })
            ]));
            wrap.appendChild(card);
        });
        wrap.appendChild(el('div', { class: 'atex-co-legend-keys' }, [
            legendKey('order', 'Заказ'),
            legendKey('remainder', 'Отход')
        ]));
        return wrap;

        // Подпись ширины для ВСЕХ полос; узкая (pct < 6) поворачивается вертикально.
        function appendSegLabel(node, width, pct) {
            node.appendChild(el('span', {
                class: 'atex-co-seg-label' + (pct < 6 ? ' is-narrow' : ''),
                text: String(width)
            }));
        }

        function legendKey(kind, label) {
            return el('span', { class: 'atex-co-legend-key' }, [
                el('span', { class: 'atex-co-swatch atex-co-seg-' + kind }),
                document.createTextNode(label)
            ]);
        }
    };

    AtexCutOptimizer.prototype.renderTable = function(p) {
        var table = el('div', { class: 'atex-co-table' });
        table.appendChild(el('div', { class: 'atex-co-table-head' }, [
            el('span', { text: 'Ширина (факт), мм' }),
            el('span', { text: 'В заказе' }),
            el('span', { text: 'Желаемо' }),
            el('span', { text: 'Получится' }),
            el('span', { text: 'Δ к желаемому' })
        ]));
        p.results.forEach(function(r) {
            var dev = (r.deviation > 0 ? '+' : '') + r.deviation;
            var devCls = 'atex-co-dev' + (r.deviation === 0 ? ' is-ok' : (r.deviation > 0 ? ' is-surplus' : ' is-short'));
            var nominal = (r.nominalWidth == null) ? '—'
                : (r.nominalWidth === r.actualWidth ? '=' : String(r.nominalWidth));
            table.appendChild(el('div', { class: 'atex-co-table-row' }, [
                el('span', { text: String(r.actualWidth) }),
                el('span', { class: 'atex-co-nominal', text: nominal }),
                el('span', { text: String(r.desiredQty) }),
                el('span', { text: String(r.produced) }),
                el('span', { class: devCls, text: dev })
            ]));
        });
        return table;
    };

    AtexCutOptimizer.prototype.renderSummary = function(p) {
        var summary = el('div', { class: 'atex-co-summary' });
        // Главные параметры (req #3474.5) — выделены классом is-primary (цветом).
        // «Итого рулонов» — «<получится> из <желаемо>»; число «получится» это то,
        // что сообщают клиенту, поэтому выделено отдельно (atex-co-rolls-got).
        var rolls = el('span', { class: 'atex-co-rolls' }, [
            el('span', { class: 'atex-co-rolls-got', text: String(p.totalProduced) }),
            el('span', { class: 'atex-co-rolls-of', text: ' из ' + p.totalDesired })
        ]);
        summary.appendChild(metric('Итого рулонов', rolls, true));
        summary.appendChild(metric('Общий отход, м²', p.rollLength > 0 ? p.totalWasteAreaM2 : '—', true));
        summary.appendChild(metric('Карт раскроя', p.mapCount));
        summary.appendChild(metric('Всего резок', p.totalPasses));
        return summary;

        function metric(label, value, primary) {
            var valueEl = el('span', { class: 'atex-co-metric-value' });
            if (value && value.nodeType) valueEl.appendChild(value);
            else valueEl.textContent = String(value);
            return el('div', { class: 'atex-co-metric' + (primary ? ' is-primary' : '') }, [
                el('span', { class: 'atex-co-metric-label', text: label }),
                valueEl
            ]);
        }
    };

    // ── «В заказ»: модалка и запись (#3474) ──

    // Следующий свободный номер заказа: серверный отчёт report/nextOrder, при
    // отсутствии — максимум числового номера среди заказов + 1.
    AtexCutOptimizer.prototype.suggestNextOrder = function() {
        var self = this;
        function fromList() {
            var max = 0;
            self.orders.forEach(function(o) {
                var n = parseInt(String(o.number).replace(/\D+/g, ''), 10);
                if (isFinite(n) && n > max) max = n;
            });
            return max > 0 ? String(max + 1) : '';
        }
        // Отчёт ateh `nextOrder` отдаёт JSON_KV `[{"Заказ":"3690"}]`; на всякий
        // случай распознаём и иные имена колонки, иначе берём единственную колонку.
        return this.getJson('report/nextOrder?JSON_KV').then(function(data) {
            var row = Array.isArray(data) ? data[0] : data;
            if (!row || typeof row !== 'object') return fromList();
            var names = ['Заказ', 'next', 'nextOrder', 'next_order', 'order_no'];
            var val = null;
            for (var i = 0; i < names.length && val == null; i++) {
                if (row[names[i]] != null) val = row[names[i]];
            }
            if (val == null) {
                var keys = Object.keys(row);
                if (keys.length === 1) val = row[keys[0]];
            }
            return (val == null || val === '') ? fromList() : String(val);
        }).catch(function() { return fromList(); });
    };

    AtexCutOptimizer.prototype.openOrderModal = function() {
        var self = this;
        var p = this.plan;
        if (!p || !p.feasible || !p.results.length) return;
        if (!this.meta.order || !this.meta.position) {
            this.notify('Не найдены таблицы «Заказ»/«Позиция заказа» — запись невозможна.', 'error');
            return;
        }
        if (!this.materialId) { this.notify('Сначала выберите Вид сырья.', 'error'); return; }

        var overlay = el('div', { class: 'atex-co-modal-overlay' });
        var modal = el('div', { class: 'atex-co-modal', role: 'dialog', 'aria-modal': 'true' });
        modal.appendChild(el('h3', { class: 'atex-co-modal-title', text: 'В заказ' }));
        modal.appendChild(el('p', { class: 'atex-co-modal-sub',
            text: 'Создаётся по одной позиции на каждую ширину (' + p.results.length + ' шт.).' }));

        // Номер заказа: список существующих (datalist) + ввод нового.
        var listId = 'atex-co-order-list';
        var dl = el('datalist', { id: listId }, this.orders.map(function(o) {
            return el('option', { value: String(o.number) });
        }));
        var numberInput = el('input', { class: 'atex-co-input', type: 'text', list: listId,
            placeholder: 'номер заказа', autocomplete: 'off' });
        var numHint = el('div', { class: 'atex-co-modal-hint', text: 'Подсказка свободного номера…' });
        modal.appendChild(field('Номер заказа', numberInput, [dl, numHint]));

        // Поля нового заказа (показываются, если номер не из списка).
        var clientSel = this.refSelect('atex-co-client', this.clients, 'Клиент (для нового заказа)');
        var leadInput = el('input', { class: 'atex-co-input', type: 'text', placeholder: 'лидер' });
        var newOrderBox = el('div', { class: 'atex-co-modal-neworder' }, [
            field('Клиент', clientSel.node),
            field('Лидер', leadInput)
        ]);
        modal.appendChild(newOrderBox);

        // Поля позиций (нужны всегда — их нет в калькуляторе).
        var sleeveSel = this.refSelect('atex-co-sleeve', this.sleeves, 'Диаметр втулки');
        var windingSel = el('select', { class: 'atex-co-input' }, [
            el('option', { value: '', text: '— не указано —' }),
            el('option', { value: 'IN', text: 'IN (внутрь)' }),
            el('option', { value: 'OUT', text: 'OUT (наружу)' })
        ]);
        modal.appendChild(field('Диаметр втулки', sleeveSel.node));
        modal.appendChild(field('Тип намотки', windingSel));

        var msg = el('div', { class: 'atex-co-modal-msg' });
        modal.appendChild(msg);

        var cancelBtn = el('button', { class: 'atex-co-btn', type: 'button', text: 'Отмена' });
        var submitBtn = el('button', { class: 'atex-co-btn atex-co-btn-primary', type: 'button', text: 'Создать' });
        modal.appendChild(el('div', { class: 'atex-co-modal-actions' }, [cancelBtn, submitBtn]));

        overlay.appendChild(modal);
        this.root.appendChild(overlay);

        function orderByNumber(num) {
            var n = String(num).trim();
            return self.orders.filter(function(o) { return String(o.number).trim() === n; })[0] || null;
        }
        function syncNewOrderBox() {
            var existing = orderByNumber(numberInput.value);
            newOrderBox.style.display = existing ? 'none' : '';
        }
        numberInput.addEventListener('input', syncNewOrderBox);

        // Подсказать свободный номер.
        this.suggestNextOrder().then(function(next) {
            if (next && !numberInput.value) { numberInput.value = next; syncNewOrderBox(); }
            numHint.textContent = next ? ('Свободный номер: ' + next) : 'Введите номер заказа или выберите существующий.';
        });
        syncNewOrderBox();

        function close() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }
        cancelBtn.addEventListener('click', close);
        overlay.addEventListener('click', function(e) { if (e.target === overlay) close(); });
        modal.addEventListener('keydown', function(e) { if (e.key === 'Escape') close(); });

        submitBtn.addEventListener('click', function() {
            var number = String(numberInput.value).trim();
            if (!number) { msg.textContent = 'Укажите номер заказа.'; msg.className = 'atex-co-modal-msg is-error'; return; }
            var sleeveId = sleeveSel.value();
            submitBtn.disabled = cancelBtn.disabled = true;
            msg.className = 'atex-co-modal-msg';
            msg.textContent = 'Запись…';
            self.commitToOrder({
                number: number,
                existing: orderByNumber(number),
                clientId: clientSel.value(),
                lead: String(leadInput.value).trim(),
                sleeveId: sleeveId,
                winding: windingSel.value
            }).then(function(res) {
                close();
                self.notify('Заказ ' + res.number + ': добавлено позиций — ' + res.positions + '.', 'success');
            }).catch(function(err) {
                submitBtn.disabled = cancelBtn.disabled = false;
                msg.textContent = 'Не удалось: ' + (err.message || err);
                msg.className = 'atex-co-modal-msg is-error';
            });
        });

        setTimeout(function() { numberInput.focus(); }, 30);

        function field(label, control, extra) {
            var children = [el('label', { class: 'atex-co-label', text: label }), control];
            (extra || []).forEach(function(x) { children.push(x); });
            return el('div', { class: 'atex-co-field' }, children);
        }
    };

    // Простой ref-select [{id,label}] поверх AtexRefSearch (или нативный select).
    AtexCutOptimizer.prototype.refSelect = function(idPrefix, options, placeholder) {
        if (typeof window !== 'undefined' && window.AtexRefSearch && window.AtexRefSearch.createSelect) {
            var value = '';
            var node = window.AtexRefSearch.createSelect({
                classPrefix: 'atex-co',
                inputClass: 'atex-co-input',
                cacheKey: idPrefix,
                options: (options || []).map(function(o) { return { id: o.id, label: o.label }; }),
                placeholder: placeholder || '',
                onChange: function(id) { value = String(id || ''); }
            });
            return { node: node, value: function() { return value; } };
        }
        var sel = el('select', { class: 'atex-co-input' }, [el('option', { value: '', text: '— не выбрано —' })]
            .concat((options || []).map(function(o) { return el('option', { value: o.id, text: o.label }); })));
        return { node: sel, value: function() { return sel.value; } };
    };

    // Создать (при необходимости) заказ и по одной позиции на каждую ширину.
    AtexCutOptimizer.prototype.commitToOrder = function(opts) {
        var self = this;
        var p = this.plan;
        var orderMeta = this.meta.order, posMeta = this.meta.position;
        var rollLength = this.lengthInput ? toNumber(this.lengthInput.value) : 0;

        var ensureOrder = opts.existing
            ? Promise.resolve(String(opts.existing.id))
            : (function() {
                var fields = {};
                fields[String(orderMeta.id)] = opts.number;   // главное значение = номер заказа
                put(fields, orderMeta, ORDER_REQ.client, opts.clientId);
                put(fields, orderMeta, ORDER_REQ.manager, (typeof window !== 'undefined' && window.uid) || '');
                put(fields, orderMeta, ORDER_REQ.created, todayIso());
                put(fields, orderMeta, ORDER_REQ.status, DEFAULT_ORDER_STATUS);
                put(fields, orderMeta, ORDER_REQ.lead, opts.lead);
                return self.post('_m_new/' + orderMeta.id + '?JSON&up=1', fields).then(function(res) {
                    var id = res && (res.obj != null ? res.obj : res.id);
                    if (id == null) throw new Error('сервер не вернул id заказа');
                    self.orders.push({ id: String(id), number: opts.number });
                    return String(id);
                });
            })();

        return ensureOrder.then(function(orderId) {
            // Последовательно создаём позиции, чтобы не ловить гонки на сервере.
            var created = 0;
            var chain = Promise.resolve();
            p.results.forEach(function(r) {
                chain = chain.then(function() {
                    var fields = {};
                    // «Позиция заказа» хранит НОМИНАЛ («Ширина в заказе»); планирование
                    // само переводит его в фактическую (annotatePositionsCutWidth, #3372).
                    var orderWidth = (r.nominalWidth != null) ? r.nominalWidth : r.actualWidth;
                    put(fields, posMeta, POSITION_REQ.qty, r.desiredQty);
                    put(fields, posMeta, POSITION_REQ.raw, self.materialId);
                    put(fields, posMeta, POSITION_REQ.width, orderWidth);
                    if (rollLength > 0) put(fields, posMeta, POSITION_REQ.length, rollLength);
                    put(fields, posMeta, POSITION_REQ.sleeve, opts.sleeveId);
                    put(fields, posMeta, POSITION_REQ.winding, normalizeWinding(opts.winding));
                    put(fields, posMeta, POSITION_REQ.status, DEFAULT_POSITION_STATUS);
                    return self.post('_m_new/' + posMeta.id + '?JSON&up=' + encodeURIComponent(orderId), fields)
                        .then(function() { created++; });
                });
            });
            return chain.then(function() { return { number: opts.number, positions: created }; });
        });

        function put(fields, meta, names, value) {
            if (value == null || value === '') return;
            var rid = reqIdByNames(meta, names);
            if (rid) fields[rid] = value;
        }
        function normalizeWinding(v) {
            var s = String(v == null ? '' : v).trim().toUpperCase();
            return (s === 'IN' || s === 'OUT') ? s : '';
        }
        function todayIso() {
            var d = new Date();
            function pad(n) { return (n < 10 ? '0' : '') + n; }
            return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
        }
    };

    AtexCutOptimizer.prototype.setBusy = function(on) {
        this.busy = on;
        if (this.root) this.root.classList.toggle('is-busy', !!on);
    };

    AtexCutOptimizer.prototype.notify = function(message, kind) {
        if (kind === 'error' && typeof window !== 'undefined' && window.mainAppController &&
            typeof window.mainAppController.showErrorModal === 'function') {
            window.mainAppController.showErrorModal(message);
            return;
        }
        var toast = el('div', { class: 'atex-co-toast atex-co-toast-' + (kind || 'info'), text: message });
        (this.toastHost || document.body).appendChild(toast);
        setTimeout(function() { toast.classList.add('is-visible'); }, 10);
        setTimeout(function() {
            toast.classList.remove('is-visible');
            setTimeout(function() { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 300);
        }, 3500);
    };

    AtexCutOptimizer.prototype.fatal = function(message) {
        this.root.innerHTML = '';
        this.root.appendChild(el('div', { class: 'atex-co-fatal', text: message }));
    };

    function init() {
        if (typeof document === 'undefined') return;
        var root = document.getElementById('atex-cut-optimizer');
        if (!root || root.dataset.initialized === '1') return;
        root.dataset.initialized = '1';
        var controller = new AtexCutOptimizer(root);
        root._atexCutOptimizer = controller;
        controller.start();
    }

    return { core: core, Controller: AtexCutOptimizer, init: init };
});
