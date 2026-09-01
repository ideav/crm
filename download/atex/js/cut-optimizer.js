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
//     по всем картам с учётом числа проходов и длины рулона;
//   • % отхода в карте (#4828) — от ЭФФЕКТИВНОЙ (занятой полосами) ширины резки:
//     менеджеру по нему видно, на сколько процентов умножить цену прайса, продавая
//     дорезок (891 → занято 740, отход 151 → 20,405%). Доля от общей ширины W,
//     важная планеру, живёт в wastePct и не менялась.
//
// Кнопка «В заказ» создаёт под выбранным (или новым) Заказом по одной Позиции
// заказа на каждую ширину — это единственная запись данных. Номер нового заказа
// подсказывается запросом `report/nextOrder`.
//
// #4779: калькулятор снова считает НЕСКОЛЬКО ширин за раз (строки желаемых
// рулонов добавляются и удаляются), а после длины рулона задаются Лидер, Диаметр
// втулки и Тип намотки — по ним подбираются «точки запаса»: строки справочника
// «Максимальный запас» (table 67113, docs/atex_data_schema.md §6.6), то есть
// номенклатуры, которые целесообразно нарезать впрок. Клик по точке кладёт её
// ширину в желаемые рулоны — так краем джамбо добирают запас вместо отхода.
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
        position: ['Заказанное количество', 'Позиция заказа'],
        sleeve: 'Диаметр втулки',
        client: 'Клиент',
        leader: 'Лидер',  // #3592: справочник «Лидер» (table/1132) — список для поля формы «В заказ»
        maxStock: 'Максимальный запас',  // #4779: точки запаса (table/67113) — что целесообразно нарезать впрок
        sleeveMaterial: 'Материал втулки'  // #4804: справочник материалов втулки (table/740264)
    };
    var MATERIAL_REQ = { width: 'Ширина, мм', length: 'Длина рулона, м', tolerance: 'Допуск, мм' };
    // Справочник «Фактическая ширина резки»: главное значение записи — факт. ширина,
    // «Ширина в заказе» — номинал, «Код» — условие применения.
    var ACTUAL_WIDTH_REQ = { order: 'Ширина в заказе', code: 'Код' };
    // #4804: реквизиты справочника «Диаметр втулки» (8188). «Дюймы» — диаметр (1 / 0.5),
    // «Ширина втулки, мм» — ширина ГОТОВОЙ втулки (пусто — метровая палка, режется под
    // размер), «Материал втулки» — ссылка на справочник 740264.
    var SLEEVE_REQ = { inches: 'Дюймы', width: 'Ширина втулки, мм', material: 'Материал втулки' };
    // #4779: реквизиты «Максимального запаса» (table 67113, docs/atex_data_schema.md §6.6).
    // Главное значение записи — максимально допустимый запас (рулонов); реквизиты
    // задают номенклатуру ГП. Те же имена читает production-planning.js (MAX_STOCK_REQ).
    var MAX_STOCK_REQ = {
        material: 'Вид сырья',
        width: ['Ширина, мм', 'Ширина'],
        length: ['Длина, м', 'Длина'],
        winding: 'Тип намотки',
        sleeve: 'Диаметр втулки',
        leader: 'Лидер'
    };
    // Реквизиты «Заказа» и «Заказанного количества» — резолвятся по любому из имён.
    var ORDER_REQ = {
        client: ['Клиент'], manager: ['Менеджер', 'Пользователь'],
        created: ['Дата создания'], status: ['Статус заказа', 'Статус'],
        lead: ['Лидер'], due: ['Срок изготовления']
    };
    var POSITION_REQ = {
        qty: ['Кол-во', 'Количество'], raw: ['Вид сырья'],
        width: ['Ширина, мм', 'Ширина'], length: ['Длина, м', 'Длина'],
        sleeve: ['Диаметр втулки'], winding: ['Тип намотки'],
        lead: ['Лидер'], status: ['Статус позиции', 'Статус']
    };
    var DEFAULT_ORDER_STATUS = 'Новый';
    var DEFAULT_POSITION_STATUS = 'Новая';
    var MAX_MAPS = 3;
    // Длина рулона по умолчанию и набор стандартных длин для выбора (можно ввести
    // свою). Список показывается целиком, без фильтрации по введённому значению,
    // и включает значение по умолчанию (#3482).
    var DEFAULT_LENGTH = 450;
    // #4779: заказчик добавил 360, 74 и 110 м; список держим по возрастанию.
    var LENGTH_PRESETS = [74, 110, 300, 360, 450, 600, 700, 900, 1000];
    // #3573: допуск на отход по умолчанию (мм). Берётся из Вида сырья («Допуск, мм»),
    // а если у материала он не задан — действует это значение. По нему красится отход.
    var DEFAULT_TOLERANCE = 21;
    // #3744: оценка времени резки для менеджера. Таблица «Время операции,
    // мин» — те же нормы метража WIND_<метры>, что использует production-planning.js
    // (windingMinutes). Формула: «Всего резок» × время намотки одного рулона.
    // #4832: НАЛАДКУ/ПЕРЕНАЛАДКУ в оценке НЕ считаем («убирали это») — настройка
    // станка забота плана, менеджеру важно время резки. Перевод в дни — по
    // MINUTES_PER_DAY рабочих минут.
    var OP_TIMES_TABLE = 'Время операции, мин';
    var OP_TIMES_CODE_REQ = 'Код операции';
    var MINUTES_PER_DAY = 450;     // 1 рабочий день = 450 минут (для единицы «дни»)

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

    // #4804 п.3: чем добить ОСТАТОК джамбо, чтобы отход был минимальным. Безграничный
    // рюкзак по заданным ширинам: каждую можно доложить сколько угодно раз. Ширины
    // бывают дробными (32.5 мм), поэтому считаем в десятых долях миллиметра.
    // `prefer` — порядок предпочтения ширин при РАВНОМ заполнении (больше доля в
    // пропорции — раньше): так добивка держится ближе к исходному распределению.
    // → массив «сколько ножей доложить» по индексам widths.
    function fillRemainder(remainder, widths, prefer) {
        var add = widths.map(function() { return 0; });
        var SCALE = 10;
        var cap = Math.floor(round3(remainder) * SCALE + 1e-6);
        if (!(cap > 0)) return add;
        var ws = widths.map(function(w) { return Math.round(w * SCALE); });
        // Заполнено при ёмкости c и каким ножом пришли (−1 — тем же, что при c−1).
        var best = new Array(cap + 1);
        var pick = new Array(cap + 1);
        best[0] = 0; pick[0] = -1;
        for (var c = 1; c <= cap; c++) {
            best[c] = best[c - 1];
            pick[c] = -1;
            for (var pi = 0; pi < prefer.length; pi++) {
                var i = prefer[pi];
                if (ws[i] <= 0 || ws[i] > c) continue;
                var cand = best[c - ws[i]] + ws[i];
                // Строгое «>» — при равном заполнении побеждает более ранняя (более
                // пропорциональная) ширина.
                if (cand > best[c]) { best[c] = cand; pick[c] = i; }
            }
        }
        var pos = cap;
        while (pos > 0) {
            var take = pick[pos];
            if (take < 0) { pos--; continue; }
            add[take]++;
            pos -= ws[take];
        }
        return add;
    }

    // #4804 п.4: заданный набор шире джамбо — ужимаем пропорцию, пока не влезет.
    // Каждой ширине оставляем хотя бы один нож (ширину из раскроя не выкидываем);
    // вызывающий уже проверил, что по одному ножу на ширину в джамбо помещается.
    function shrinkToFit(W, widths, ratio) {
        function knivesAt(scale) {
            return ratio.map(function(r) { return Math.max(1, Math.floor(r * scale)); });
        }
        function widthOf(knives) {
            return round3(knives.reduce(function(s, k, i) { return s + k * widths[i]; }, 0));
        }
        var lo = 0, hi = 1;
        for (var step = 0; step < 50; step++) {
            var mid = (lo + hi) / 2;
            if (widthOf(knivesAt(mid)) <= W) lo = mid; else hi = mid;
        }
        return knivesAt(lo);
    }

    // #4804 п.2/п.3/п.4: ЕДИНАЯ карта раскроя со всеми ширинами. Ножи подбираются так,
    // чтобы джамбо было занято максимально плотно:
    //   • сначала кладутся ЦЕЛЫЕ пропорциональные наборы (пропорция желаемых количеств
    //     через НОД) — приоритет пропорции из тикета;
    //   • остаток джамбо добивается любыми заданными ширинами по минимуму отхода (п.3);
    //   • если даже ОДИН пропорциональный набор шире джамбо, пропорция ужимается (п.4),
    //     и остаток добивается так же.
    // Число проходов — минимальное, при котором выпуск по КАЖДОЙ ширине не меньше
    // желаемого (ножи × проходы ≥ спрос).
    // → { knives, passes, usedWidth, trimWidth, fits, proportionKept }.
    function packSingleMap(inputWidth, widths, qtys) {
        var W = round3(inputWidth);
        var zero = widths.map(function() { return 0; });
        var minWidth = round3(widths.reduce(function(s, w) { return s + w; }, 0));
        // По одному ножу на каждую ширину — уже шире джамбо: резать нечем.
        if (minWidth > W) {
            return { knives: zero, passes: 0, usedWidth: 0, trimWidth: W, fits: false, proportionKept: false };
        }
        var g = gcdAll(qtys);
        var ratio = qtys.map(function(q) { return q / g; });
        var setWidth = round3(ratio.reduce(function(s, r, i) { return s + r * widths[i]; }, 0));

        var knives, proportionKept;
        if (setWidth > 0 && setWidth <= W) {
            var sets = Math.floor(round3(W / setWidth));
            knives = ratio.map(function(r) { return sets * r; });
            proportionKept = true;
        } else {
            knives = shrinkToFit(W, widths, ratio);
            proportionKept = false;
        }

        // Приоритет добивки — ширины с большей долей в пропорции.
        var prefer = widths.map(function(_, i) { return i; })
            .sort(function(a, b) { return (ratio[b] - ratio[a]) || (widths[b] - widths[a]) || (a - b); });
        var used = round3(knives.reduce(function(s, k, i) { return s + k * widths[i]; }, 0));
        var add = fillRemainder(round3(W - used), widths, prefer);
        knives = knives.map(function(k, i) { return k + add[i]; });

        used = round3(knives.reduce(function(s, k, i) { return s + k * widths[i]; }, 0));
        // Проходов ровно столько, чтобы не недодать ни по одной ширине.
        var passes = 1;
        knives.forEach(function(k, i) {
            if (k > 0) passes = Math.max(passes, Math.ceil(qtys[i] / k));
        });
        return {
            knives: knives, passes: passes, usedWidth: used,
            trimWidth: round3(W - used), fits: true, proportionKept: proportionKept
        };
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

        // #4804 п.2: карта раскроя ОДНА — все ширины лежат на ней. Разбиения на «Карту 1»
        // и «Карту 2» больше нет: заказчику нужен один вариант со всеми ширинами.
        var single = packSingleMap(W, widths, qtys);
        if (!single.fits) {
            base.reason = 'По одному ножу на каждую ширину — уже шире входа ('
                + round3(widths.reduce(function(s, w) { return s + w; }, 0)) + ' мм при входе ' + W
                + ' мм). Уберите часть ширин.';
            base.items = all;
            return base;
        }
        var bestChoice = { packs: [{ idxs: widths.map(function(_, i) { return i; }), pack: single }] };

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
                // #4828: % отхода менеджеру — от ЭФФЕКТИВНОЙ ширины резки (занятой
                // полосами), а не от общей рабочей ширины джамбо: по нему видно, на
                // сколько процентов надо умножить цену прайса, чтобы продать дорезок
                // (вход 891, занято 740, отход 151 → 20,405%, а не 16,947%).
                trimPct: p.pack.usedWidth > 0 ? round3(p.pack.trimWidth / p.pack.usedWidth * 100) : 0,
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
        // #4828: в таком виде (от ОБЩЕЙ ширины W) доля важна планеру и остаётся без
        // изменений; менеджеру в карте показывается trimPct — от эффективной ширины.
        var wastePct = totalPasses > 0 ? round3(totalWasteWidth / (W * totalPasses) * 100) : 0;
        // Площадь отхода (м²) = Σ по картам (отход(м) × длина рулона(м) × проходов).
        var totalWasteAreaM2 = rollLength > 0
            ? round3(maps.reduce(function(s, m) { return s + m.trimWidth / 1000 * rollLength * m.passes; }, 0))
            : 0;

        base.feasible = true;
        // #4804 п.4: пропорция желаемых количеств сохранена, либо её пришлось ужать,
        // чтобы набор влез в джамбо.
        base.proportionKept = single.proportionKept;
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
    }

    // ── #4811: лидеры калькулятора ───────────────────────────────────────────────────
    // Справочник «Лидер» (1132) держит семь записей, но менеджеру в расчёте резки нужны
    // ЧЕТЫРЕ (решение заказчика): три своих и клиентский. Список захардкожен, а вот ID
    // записей — НЕТ: свои лидеры сводятся со справочником ПО ПОДПИСИ, как и все прочие
    // сущности рабочего места (WORKSPACE_DEVELOPMENT_GUIDE.md, раздел 3). Пересборка базы
    // такой код переживает, а появись в справочнике запись «Клиентский» — она подхватится
    // сама, без правки кода.
    var CLIENT_LEADER = 'Клиентский';
    var OPTIMIZER_LEADERS = ['MONOCHROME', 'MONOCHROME ZNAK', 'Прозрачный', CLIENT_LEADER];

    // Лидеры калькулятора как опции выбора: подпись — она же значение (id записи
    // справочника у «Клиентского» отсутствует, поэтому ключом служит подпись).
    function optimizerLeaders() {
        return OPTIMIZER_LEADERS.map(function(label) {
            return { id: label, label: label, client: label === CLIENT_LEADER };
        });
    }

    // Клиентский лидер — лидер ЗАКАЗЧИКА: записи в справочнике у него нет, и точек запаса
    // под него не бывает (нарезать впрок под чужой лидер нечего).
    function isClientLeader(label) {
        return normText(label) === normText(CLIENT_LEADER);
    }

    // Запись справочника «Лидер» под выбранную подпись; нет такой (или выбран клиентский)
    // → null. Чужую запись молча не подставляем.
    function resolveLeader(leaders, label) {
        var wanted = normText(label);
        if (!wanted || isClientLeader(label)) return null;
        var found = (leaders || []).filter(function(rec) { return normText(rec && rec.label) === wanted; })[0];
        return found || null;
    }

    // ── #4804 п.1: втулка задаётся ДИАМЕТРОМ и МАТЕРИАЛОМ ────────────────────────────
    // Раньше оператор выбирал запись справочника «Диаметр втулки» (8188) целиком —
    // список длинных названий, в которых диаметр, материал и ширина смешаны. Теперь
    // выбираются два понятных параметра: диаметр (1″ или 0,5″) и материал втулки
    // (справочник «Материал втулки», table 740264). У 0,5″ материал не спрашивается —
    // втулки этого диаметра бывают только картонными.
    //
    // Записи справочника пульт читает с реквизитами: `inches` («Дюймы»), `sleeveWidth`
    // («Ширина втулки, мм»; пусто — метровая палка, режется под размер) и `materialId`
    // /`materialLabel` (ссылка на 740264).

    // Диаметры, между которыми выбирает оператор.
    var SLEEVE_INCHES = [
        { value: '1', label: '1″' },
        { value: '0.5', label: '0,5″' }
    ];
    // Материал втулок диаметром 0,5″ — всегда картон (решение заказчика, #4804 п.1).
    var CARDBOARD_LABEL = 'Картон';

    function sleeveInchesOptions() {
        return SLEEVE_INCHES.map(function(o) { return { value: o.value, label: o.label }; });
    }
    // Спрашивать ли материал втулки у этого диаметра. У 0,5″ — нет.
    function sleeveNeedsMaterial(inches) {
        return String(inches == null ? '' : inches).trim() === '1';
    }
    function sameInches(recInches, wanted) {
        var w = toNumber(wanted);
        return w > 0 && Math.abs(toNumber(recInches) - w) < 1e-6;
    }
    // Материал выбора: у 0,5″ он не спрашивается и всегда картонный, поэтому
    // сравнение идёт по подписи, а не по переданному id.
    function sleeveMaterialMatches(rec, choice) {
        if (!sleeveNeedsMaterial(choice && choice.inches)) {
            return normText(rec && rec.materialLabel) === normText(CARDBOARD_LABEL);
        }
        var wanted = String((choice && choice.materialId) == null ? '' : choice.materialId).trim();
        if (!wanted) return true;   // материал не выбран — по нему не отсекаем
        return String(rec && rec.materialId == null ? '' : rec.materialId).trim() === wanted;
    }
    // Подходит ли запись справочника выбору «диаметр + материал». Диаметр не выбран —
    // не отсекаем ничего (так же ведёт себя подбор точек запаса до выбора параметров).
    function sleeveMatchesChoice(rec, choice) {
        var inches = String((choice && choice.inches) == null ? '' : choice.inches).trim();
        if (!inches) return true;
        if (!rec) return false;
        return sameInches(rec.inches, inches) && sleeveMaterialMatches(rec, choice);
    }
    // Конкретная запись «Диаметра втулки» под полосу: сначала ГОТОВАЯ втулка ровно на
    // эту ширину, иначе МЕТРОВАЯ (ширина не задана — режется под размер). Ни той, ни
    // другой нет → null: чужую втулку молча не подставляем.
    //   choice: { inches, materialId, width }.
    function resolveSleeve(sleeves, choice) {
        var inches = String((choice && choice.inches) == null ? '' : choice.inches).trim();
        if (!inches) return null;
        var width = round3(choice && choice.width);
        var fit = (sleeves || []).filter(function(rec) {
            return rec && sameInches(rec.inches, inches) && sleeveMaterialMatches(rec, choice);
        });
        if (!fit.length) return null;
        var exact = fit.filter(function(rec) {
            return toNumber(rec.sleeveWidth) > 0 && Math.abs(round3(rec.sleeveWidth) - width) < 1e-6;
        })[0];
        if (exact) return exact;
        var meter = fit.filter(function(rec) { return !(toNumber(rec.sleeveWidth) > 0); })[0];
        return meter || null;
    }

    // Доля сегмента шириной `width` в шкале карты. Шкала — максимум из ширины
    // входа и занятой ширины. Проценты [0..100].
    function widthPercent(width, inputWidth, usedWidth) {
        var scale = Math.max(toNumber(inputWidth), toNumber(usedWidth));
        if (scale <= 0) return 0;
        return round3(toNumber(width) / scale * 100);
    }

    // #3744: точки «намотка N метров → минуты» из кодов WIND_<метры> таблицы «Время
    // операции, мин» (WIND_300=1.2 … WIND_1100=5.6). Та же модель метража, что в
    // production-planning.js (windingPointsFromTimes). Спец-коды (WIND_FOIL_*) не парсим.
    function windingPointsFromTimes(opTimes) {
        var pts = [];
        Object.keys(opTimes || {}).forEach(function(code) {
            var m = /^WIND_(\d+)$/.exec(code);
            if (m) pts.push({ m: Number(m[1]), min: toNumber(opTimes[code]) });
        });
        pts.sort(function(a, b) { return a.m - b.m; });
        return pts;
    }

    // #3744: минуты намотки runMeters по точкам — кусочно-линейно (зеркало
    // production-planning.js windingMinutes): ниже первой точки — пропорция от 0; между
    // точками — линейно; выше последней — экстраполяция последним отрезком (при одной
    // точке клампим). Нет точек / runMeters ≤ 0 → 0.
    function windingMinutes(runMeters, points) {
        var x = toNumber(runMeters);
        var p = (points || []).slice().sort(function(a, b) { return a.m - b.m; });
        if (!p.length || x <= 0) return 0;
        if (x <= p[0].m) return round3(p[0].min * (x / p[0].m));
        for (var i = 1; i < p.length; i++) {
            if (x <= p[i].m) {
                var t = (x - p[i - 1].m) / (p[i].m - p[i - 1].m);
                return round3(p[i - 1].min + t * (p[i].min - p[i - 1].min));
            }
        }
        if (p.length < 2) return round3(p[p.length - 1].min);
        var a = p[p.length - 2], b = p[p.length - 1];
        var slope = (b.min - a.min) / (b.m - a.m);
        return round3(b.min + slope * (x - b.m));
    }

    // #3744: общие минуты резки = по каждой резке («Всего резок» = passes) время намотки
    // одного рулона windingMinutes от длины рулона и норм WIND_*. Резок нет → 0; норм
    // нет → 0 (считать нечего — показчик покажет «—»). #4832: НАЛАДКУ в оценке не
    // считаем (решение заказчика «убирали это»): 45 мин настройки станка — забота
    // плана, в менеджерской оценке резки ей не место.
    function planningMinutes(passes, rollLength, windPoints) {
        var n = Math.max(0, Math.round(toNumber(passes)));
        if (n <= 0) return 0;
        return round3(n * windingMinutes(rollLength, windPoints));
    }

    // #3744: минуты → три единицы для менеджера. Часы и дни — с одним знаком после
    // запятой; день = MINUTES_PER_DAY рабочих минут. { minutes, hours, days }.
    function planningTimeUnits(mins) {
        var m = round3(mins);
        return {
            minutes: Math.round(m),
            hours: Math.round(m / 60 * 10) / 10,
            days: Math.round(m / MINUTES_PER_DAY * 10) / 10
        };
    }

    // ── #4779: точки запаса («Максимальный запас», table 67113) ──
    // Строка справочника — номенклатура ГП, которую целесообразно нарезать впрок,
    // и её максимально допустимый запас. Планирование сводит излишек резки с этой
    // таблицей по ключу «сырьё + ширина + длина + намотка», а «Диаметр втулки» и
    // «Лидер» доуточняют совпадение, только если заданы у обеих сторон (#3391,
    // docs/atex_data_schema.md §6.6). Здесь тот же ключ читается наоборот: ширина
    // и есть ответ («какие ширины имеет смысл добрать»), поэтому она в сверку не
    // идёт, а остальные параметры приходят из формы.

    // «IN»/«OUT» (регистр и пробелы неважны); прочее — пусто, как в планировании.
    function normWinding(value) {
        var s = String(value == null ? '' : value).trim().toUpperCase();
        return (s === 'IN' || s === 'OUT') ? s : '';
    }

    function normText(value) {
        return String(value == null ? '' : value).trim().toLowerCase();
    }

    // Сверка ссылочного параметра (сырьё/втулка/лидер). Обе стороны — { id, label }.
    // Не выбрано пользователем → не фильтруем; не задано в строке справочника →
    // строка шире («любое») и подходит. Сверяем по id, а текстовое поле — по подписи.
    function stockRefMatches(point, chosen) {
        var pId = String((point && point.id) || '').trim(), pLabel = normText(point && point.label);
        var cId = String((chosen && chosen.id) || '').trim(), cLabel = normText(chosen && chosen.label);
        if (!cId && !cLabel) return true;
        if (!pId && !pLabel) return true;
        if (pId && cId) return pId === cId;
        return pLabel === cLabel;
    }

    // Сверка числового параметра (длина): нуль/пусто с любой стороны → не фильтруем.
    function stockNumberMatches(pointValue, chosenValue) {
        var a = round3(toNumber(pointValue)), b = round3(toNumber(chosenValue));
        if (!(a > 0) || !(b > 0)) return true;
        return a === b;
    }

    // Сверка намотки: нераспознанная/пустая с любой стороны → не фильтруем.
    function stockWindingMatches(pointValue, chosenValue) {
        var a = normWinding(pointValue), b = normWinding(chosenValue);
        if (!a || !b) return true;
        return a === b;
    }

    // #4804 п.1: сверка втулки точки запаса с выбором «диаметр + материал». Точка
    // ссылается на КОНКРЕТНУЮ запись справочника «Диаметр втулки», а форма задаёт пару
    // параметров, под которую подходит несколько записей — поэтому сверяем не id, а
    // диаметр и материал той записи, на которую точка ссылается.
    //   sleeveById — { id: запись справочника }; выбор пуст → не фильтруем.
    function stockSleeveMatches(point, choice, sleeveById) {
        var inches = String((choice && choice.inches) == null ? '' : choice.inches).trim();
        if (!inches) return true;                       // диаметр не выбран — не фильтруем
        var pId = String((point && point.id) || '').trim();
        if (!pId) return true;                          // у точки втулка не задана — «любая»
        var rec = (sleeveById || {})[pId];
        if (!rec) return true;                          // запись не прочиталась — не отсекаем
        return sleeveMatchesChoice(rec, choice);
    }

    // Совпадает ли точка запаса с выбранными в форме параметрами.
    // ctx: { material: {id,label}, length, winding, leader: {id,label},
    //        sleeveChoice: { inches, materialId }, sleeveById: { id: запись 8188 } }.
    function stockPointMatches(point, ctx) {
        if (!point || !(toNumber(point.width) > 0)) return false;
        ctx = ctx || {};
        return stockRefMatches(point.material, ctx.material) &&
            stockNumberMatches(point.length, ctx.length) &&
            stockWindingMatches(point.winding, ctx.winding) &&
            stockSleeveMatches(point.sleeve, ctx.sleeveChoice, ctx.sleeveById) &&
            stockRefMatches(point.leader, ctx.leader);
    }

    // Подходящие точки запаса по возрастанию ширины (при равной — по длине,
    // затем по убыванию допустимого запаса: сверху то, чего можно нарезать больше).
    function matchStockPoints(points, ctx) {
        return (points || []).filter(function(p) { return stockPointMatches(p, ctx); })
            .sort(function(a, b) {
                return (toNumber(a.width) - toNumber(b.width)) ||
                    (toNumber(a.length) - toNumber(b.length)) ||
                    (toNumber(b.limit) - toNumber(a.limit));
            });
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
        expandSegments: expandSegments,
        computePlan: computePlan,
        widthPercent: widthPercent,
        windingPointsFromTimes: windingPointsFromTimes,
        windingMinutes: windingMinutes,
        planningMinutes: planningMinutes,
        planningTimeUnits: planningTimeUnits,
        normWinding: normWinding,                 // #4779
        stockPointMatches: stockPointMatches,     // #4779
        matchStockPoints: matchStockPoints,       // #4779
        lengthPresets: LENGTH_PRESETS,            // #4779: стандартные длины рулона
        // #4804 п.1: втулка выбирается диаметром и материалом, запись справочника
        // подбирается под ширину полосы.
        // #4811: четыре лидера калькулятора; свои сводятся со справочником по подписи.
        CLIENT_LEADER: CLIENT_LEADER,
        optimizerLeaders: optimizerLeaders,
        isClientLeader: isClientLeader,
        resolveLeader: resolveLeader,
        CARDBOARD_LABEL: CARDBOARD_LABEL,
        sleeveInchesOptions: sleeveInchesOptions,
        sleeveNeedsMaterial: sleeveNeedsMaterial,
        sleeveMatchesChoice: sleeveMatchesChoice,
        resolveSleeve: resolveSleeve
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

    // #4779: то же по ЛЮБОМУ из имён (схемы баз расходятся: «Длина, м» / «Длина»).
    function cellValueByNames(rec, meta, names) {
        var list = Array.isArray(names) ? names : [names];
        for (var i = 0; i < list.length; i++) {
            var v = cellValue(rec, meta, list[i]);
            if (v !== undefined) return v;
        }
        return undefined;
    }

    // #4779: ссылочное значение JSON_OBJ («id:Подпись») → { id, label }. Текстовое
    // поле (лидер в части баз — строка) остаётся подписью без id.
    function parseRef(raw) {
        var s = String(raw == null ? '' : raw);
        var m = s.match(/^(\d+):([\s\S]*)$/);
        return m ? { id: m[1], label: m[2] } : { id: '', label: s };
    }

    // Номер партии сырья (batch_no) = главное значение «Партии сырья», а это поле
    // DATETIME — приходит unix-штампом в СЕКУНДАХ (дата+время прихода), а не номером.
    // Форматируем «ДД.ММ.ГГГГ ЧЧ:ММ» (через AtexRefSearch.formatDateTime); не-штамп
    // (короткий id/строка) возвращаем как есть.
    function formatBatchTimestamp(value) {
        var s = String(value == null ? '' : value).trim();
        if (!/^\d+$/.test(s) || Number(s) < 1000000000) return s;
        if (typeof window !== 'undefined' && window.AtexRefSearch &&
            typeof window.AtexRefSearch.formatDateTime === 'function') {
            var f = window.AtexRefSearch.formatDateTime(s);
            if (f) return String(f);
        }
        var d = new Date(Number(s) * 1000);
        if (isNaN(d.getTime())) return s;
        function pad(n) { return (n < 10 ? '0' : '') + n; }
        return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear() +
            ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
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
        this.meta = { material: null, actualWidth: null, order: null, position: null, sleeve: null, client: null, leader: null, opTimes: null, maxStock: null, sleeveMaterial: null };
        this.opTimes = {};        // #3744: нормы метража WIND_* из «Время операции, мин»
        this.materials = [];      // [{ id, label, width, length }]
        // #4804: записи «Диаметра втулки» с диаметром, шириной готовой втулки и материалом.
        this.sleeves = [];        // [{ id, label, inches, sleeveWidth, materialId, materialLabel }]
        this.sleeveMaterials = []; // #4804: справочник «Материал втулки» (740264) — [{ id, label }]
        this.clients = [];        // [{ id, label }]
        this.leaders = [];        // [{ id, label }] — справочник «Лидер» (table/1132), #3592
        this.orders = [];         // [{ id, number }]
        this.actualWidthIndex = {};
        this.materialId = '';
        this.batches = [];        // [{ id, no, materialId, remainderM2, active, … }]
        this.rows = [{ width: '', qty: '1' }]; // желаемые полосы (UI-состояние, #4779 — их снова несколько)
        // #4779: параметры номенклатуры, по которым подбираются точки запаса.
        // #4811: лидер выбирается из ЧЕТЫРЁХ захардкоженных, поэтому состояние — ПОДПИСЬ,
        // а не id записи: у «Клиентского» записи в справочнике нет.
        this.leaderLabel = '';
        // #4804: втулка задаётся диаметром и материалом; конкретная запись справочника
        // подбирается под ширину полосы (core.resolveSleeve).
        this.sleeveInches = '';
        this.sleeveMaterialId = '';
        this.windingValue = '';
        this.stockPoints = [];    // [{ id, width, length, winding, material, sleeve, leader, limit }]
        this.stockLoadFailed = false;  // справочник не прочитался (нет доступа/сети) — говорим прямо
        this.lengthValue = String(DEFAULT_LENGTH); // длина рулона по умолчанию (#3474-fix)
        this.tolValue = String(DEFAULT_TOLERANCE); // допуск на отход по умолчанию 21 мм (#3573)
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
                var names = (Array.isArray(name) ? name : [name]).map(function(n) {
                    return String(n).trim().toLowerCase();
                });
                return list.filter(function(t) {
                    return names.indexOf(String(t.val).trim().toLowerCase()) !== -1;
                })[0] || null;
            }
            self.meta.material = byName(TABLE.material);
            self.meta.actualWidth = byName(TABLE.actualWidth);
            self.meta.order = byName(TABLE.order);
            self.meta.position = byName(TABLE.position);
            self.meta.sleeve = byName(TABLE.sleeve);
            self.meta.client = byName(TABLE.client);
            self.meta.leader = byName(TABLE.leader);  // #3592
            self.meta.opTimes = byName(OP_TIMES_TABLE);  // #3744: нормы метража (необязательна)
            self.meta.maxStock = byName(TABLE.maxStock);  // #4779: точки запаса (необязательна)
            self.meta.sleeveMaterial = byName(TABLE.sleeveMaterial);  // #4804: материалы втулки (необязательна)
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

    // #4779: справочник «Максимальный запас» (67113) → точки запаса. Главное
    // значение записи — максимально допустимый запас (рулонов). Нет таблицы или
    // доступа → пустой список (панель честно скажет, что подбирать не из чего).
    AtexCutOptimizer.prototype.loadStockPoints = function() {
        var self = this;
        this.stockPoints = [];
        this.stockLoadFailed = false;
        var meta = this.meta.maxStock;
        if (!meta) return Promise.resolve();
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,5000').then(function(rows) {
            self.stockPoints = (rows || []).map(function(rec) {
                var r = (rec && rec.r) || [];
                return {
                    id: String(rec.i),
                    limit: toNumber(r[0]),
                    material: parseRef(cellValueByNames(rec, meta, MAX_STOCK_REQ.material)),
                    width: toNumber(cellValueByNames(rec, meta, MAX_STOCK_REQ.width)),
                    length: toNumber(cellValueByNames(rec, meta, MAX_STOCK_REQ.length)),
                    winding: normWinding(cellValueByNames(rec, meta, MAX_STOCK_REQ.winding)),
                    sleeve: parseRef(cellValueByNames(rec, meta, MAX_STOCK_REQ.sleeve)),
                    leader: parseRef(cellValueByNames(rec, meta, MAX_STOCK_REQ.leader))
                };
            }).filter(function(p) { return p.width > 0; });
        }).catch(function(err) {
            self.stockPoints = [];
            self.stockLoadFailed = true;
            console.warn('[co] точки запаса: не удалось прочитать «Максимальный запас»:', err && err.message);
        });
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

    // #4804: записи справочника «Диаметр втулки» (8188) с реквизитами, по которым
    // втулка подбирается: диаметр («Дюймы»), ширина ГОТОВОЙ втулки («Ширина втулки, мм»;
    // пусто — метровая палка, режется под размер) и материал (ссылка на 740264).
    AtexCutOptimizer.prototype.loadSleeves = function() {
        var self = this;
        this.sleeves = [];
        var meta = this.meta.sleeve;
        if (!meta) return Promise.resolve();
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,2000').then(function(rows) {
            self.sleeves = (rows || []).map(function(rec) {
                var material = parseRef(cellValue(rec, meta, SLEEVE_REQ.material));
                var width = toNumber(cellValue(rec, meta, SLEEVE_REQ.width));
                return {
                    id: String(rec.i),
                    label: (rec.r && rec.r[0] != null && String(rec.r[0]) !== '') ? String(rec.r[0]) : ('#' + rec.i),
                    inches: toNumber(cellValue(rec, meta, SLEEVE_REQ.inches)),
                    sleeveWidth: width > 0 ? width : null,
                    materialId: material.id,
                    materialLabel: material.label
                };
            });
        }).catch(function() { self.sleeves = []; });
    };

    // Партии сырья — отчёт material_batches (JSON_KV): № партии, вид сырья (id+имя),
    // остаток (м²), флаг «В работе» (is_active). Нет отчёта/доступа → пустой список.
    AtexCutOptimizer.prototype.loadMaterialBatches = function() {
        var self = this;
        this.batches = [];
        return this.getJson('report/material_batches?JSON_KV&LIMIT=0,5000').then(function(rows) {
            self.batches = (Array.isArray(rows) ? rows : []).map(function(row) {
                return {
                    id: row.batch_id == null ? '' : String(row.batch_id),
                    no: row.batch_no == null ? '' : String(row.batch_no).trim(),
                    materialId: row.batch_material_id == null ? '' : String(row.batch_material_id).trim(),
                    materialName: row.batch_material == null ? '' : String(row.batch_material).trim(),
                    remainderM2: toNumber(row.batch_remainder_m2),
                    remainderM: toNumber(row.batch_remainder_m),
                    warehouse: row['Склад'] == null ? '' : String(row['Склад']).trim(),
                    active: String(row.is_active == null ? '' : row.is_active).trim() !== ''
                };
            });
        }).catch(function() { self.batches = []; });
    };

    // #3744: нормы метража из таблицы «Время операции, мин» — коды WIND_<метры> → минуты
    // намотки (та же таблица и чтение, что в production-planning.js loadOperationTimes).
    // Главное значение записи = минуты, колонка «Код операции» = код. Нет таблицы/доступа
    // → пустые нормы (оценка времени тихо деградирует к одной настройке 45 мин).
    AtexCutOptimizer.prototype.loadOperationTimes = function() {
        var self = this;
        this.opTimes = {};
        var meta = this.meta.opTimes;
        if (!meta) return Promise.resolve();
        var codeIdx = colIndex(meta, OP_TIMES_CODE_REQ);
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,200').then(function(rows) {
            var raw = {};
            (rows || []).forEach(function(rec) {
                var r = rec.r || [];
                var code = codeIdx >= 0 ? String(r[codeIdx] == null ? '' : r[codeIdx]).trim() : '';
                if (code) raw[code] = toNumber(r[0]);   // r[0] — главное значение = минуты
            });
            self.opTimes = raw;
        }).catch(function() { self.opTimes = {}; });
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
                    self.loadSleeves(),   // #4804: втулки с диаметром/шириной/материалом
                    self.loadRefList(self.meta.sleeveMaterial).then(function(l) { self.sleeveMaterials = l; }),  // #4804
                    self.loadRefList(self.meta.client).then(function(l) { self.clients = l; }),
                    self.loadRefList(self.meta.leader).then(function(l) { self.leaders = l; }),  // #3592
                    self.loadRefList(self.meta.order).then(function(l) {
                        self.orders = l.map(function(o) { return { id: o.id, number: o.label }; });
                    }),
                    self.loadMaterialBatches(),
                    self.loadOperationTimes(),  // #3744: нормы метража для оценки времени резки
                    self.loadStockPoints()      // #4779: «Максимальный запас» — точки запаса
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
        this.widthInput.addEventListener('input', function() { self.widthValue = self.widthInput.value; self.maybeRecalc(); });
        // Длина рулона: комбобокс — выбор из полного (нефильтруемого) списка
        // стандартных длин с возможностью ввести свою (#3482).
        var lengthCombo = this.makeLengthCombo();
        this.lengthInput = lengthCombo.input;
        dims.appendChild(el('div', { class: 'atex-co-field' }, [
            el('label', { class: 'atex-co-label', text: 'Ширина входа, мм' }), this.widthInput
        ]));
        dims.appendChild(el('div', { class: 'atex-co-field' }, [
            el('label', { class: 'atex-co-label', text: 'Длина рулона, м' }), lengthCombo.node
        ]));
        form.appendChild(dims);

        // #4779: после длины — параметры номенклатуры (Лидер, Диаметр втулки, Тип
        // намотки). На геометрию раскроя они не влияют: по ним подбираются точки
        // запаса («Максимальный запас») — ширины, которые целесообразно нарезать впрок.
        // #4811: не весь справочник, а четыре лидера менеджера. Значение опции — подпись.
        var leaderSel = this.refSelect('atex-co-nom-lead', core.optimizerLeaders(), 'Лидер', {
            value: this.leaderLabel,
            onChange: function(label) { self.leaderLabel = String(label || ''); self.renderStockPoints(); }
        });
        // #4804 п.1: втулка задаётся ДИАМЕТРОМ и МАТЕРИАЛОМ, а не выбором одной из
        // длинных записей справочника. У 0,5″ материал не спрашиваем — он всегда картон,
        // и поле материала скрывается.
        var inchesSel = el('select', { class: 'atex-co-input' }, [
            el('option', { value: '', text: '— не указано —' })
        ].concat(core.sleeveInchesOptions().map(function(o) {
            return el('option', { value: o.value, text: o.label });
        })));
        inchesSel.value = this.sleeveInches || '';
        var sleeveMatSel = this.refSelect('atex-co-nom-sleeve-mat', this.sleeveMaterials, 'Материал втулки', {
            value: this.sleeveMaterialId,
            onChange: function(id) { self.sleeveMaterialId = String(id || ''); self.renderStockPoints(); }
        });
        var sleeveMatField = el('div', { class: 'atex-co-field' }, [
            el('label', { class: 'atex-co-label', text: 'Материал втулки' }), sleeveMatSel.node
        ]);
        // У 0,5″ материала не бывает выбора — показываем, что он картонный.
        var cardboardNote = el('div', { class: 'atex-co-field' }, [
            el('label', { class: 'atex-co-label', text: 'Материал втулки' }),
            el('div', { class: 'atex-co-readonly', text: core.CARDBOARD_LABEL })
        ]);
        function syncSleeveMaterial() {
            var needs = core.sleeveNeedsMaterial(self.sleeveInches);
            var chosen = String(self.sleeveInches || '') !== '';
            sleeveMatField.style.display = needs ? '' : 'none';
            cardboardNote.style.display = (chosen && !needs) ? '' : 'none';
        }
        inchesSel.addEventListener('change', function() {
            self.sleeveInches = inchesSel.value;
            // Диаметр без выбора материала (0,5″) — прежний выбор материала не должен
            // тихо участвовать в подборе.
            if (!core.sleeveNeedsMaterial(self.sleeveInches)) self.sleeveMaterialId = '';
            syncSleeveMaterial();
            self.renderStockPoints();
        });
        var windingSel = el('select', { class: 'atex-co-input' }, [
            el('option', { value: '', text: '— не указано —' }),
            el('option', { value: 'IN', text: 'IN (внутрь)' }),
            el('option', { value: 'OUT', text: 'OUT (наружу)' })
        ]);
        windingSel.value = this.windingValue || '';
        windingSel.addEventListener('change', function() {
            self.windingValue = windingSel.value;
            self.renderStockPoints();
        });
        form.appendChild(el('div', { class: 'atex-co-field' }, [
            el('label', { class: 'atex-co-label', text: 'Лидер' }), leaderSel.node
        ]));
        form.appendChild(el('div', { class: 'atex-co-field' }, [
            el('label', { class: 'atex-co-label', text: 'Диаметр втулки' }), inchesSel
        ]));
        form.appendChild(sleeveMatField);
        form.appendChild(cardboardNote);
        syncSleeveMaterial();
        form.appendChild(el('div', { class: 'atex-co-field' }, [
            el('label', { class: 'atex-co-label', text: 'Тип намотки' }), windingSel
        ]));

        // #3597: «Допуск, мм» — только вывод значения (не редактируется). Берётся из
        // Вида сырья («Допуск, мм»); если не задан — 21 мм (#3573). По нему красится отход.
        this.tolDisplay = el('div', { class: 'atex-co-readonly', text: this.tolValue || String(DEFAULT_TOLERANCE) });
        form.appendChild(el('div', { class: 'atex-co-field' }, [
            el('label', { class: 'atex-co-label', text: 'Допуск, мм' }), this.tolDisplay
        ]));

        // Желаемые полосы (ширина + количество), редактируемый список.
        form.appendChild(el('div', { class: 'atex-co-rows-head' }, [
            el('span', { class: 'atex-co-label', text: 'Желаемые рулоны (ширина в заказе)' })
        ]));
        this.rowsEl = el('div', { class: 'atex-co-rows' });
        form.appendChild(this.rowsEl);
        this.renderRows();

        // #4779: ширин снова может быть несколько — кнопка добавления вернулась
        // (снято ограничение одной ширины из #3749).
        var addBtn = el('button', { class: 'atex-co-btn atex-co-btn-secondary', type: 'button', text: '+ Добавить ширину' });
        addBtn.addEventListener('click', function() {
            self.rows.push({ width: '', qty: '1' });
            self.renderRows();
            self.maybeRecalc();
        });
        form.appendChild(addBtn);

        var calcBtn = el('button', { class: 'atex-co-btn atex-co-btn-primary', type: 'button', text: 'Рассчитать' });
        calcBtn.addEventListener('click', function() { self.calculate(); });
        form.appendChild(calcBtn);

        // Ctrl+Enter из любого поля формы — рассчитать.
        form.addEventListener('keydown', function(e) {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); self.calculate(); }
        });

        // #4779: подходящие точки запаса (по выбранной номенклатуре).
        this.stockEl = el('div', { class: 'atex-co-stock' });
        form.appendChild(this.stockEl);
        this.renderStockPoints();

        // Подходящие партии сырья (внизу формы).
        this.batchesEl = el('div', { class: 'atex-co-batches' });
        form.appendChild(this.batchesEl);
        this.renderBatches();
    };

    // Список подходящих партий сырья выбранного вида: только «В работе», по
    // возрастанию остатка (м²). Партии, чьего остатка не хватает на текущий план
    // (площадь джамбо = ширина × длина × число резок), показываются неактивными —
    // их остаток лучше предложить клиенту, а не пускать в работу.
    AtexCutOptimizer.prototype.renderBatches = function() {
        var box = this.batchesEl;
        if (!box) return;
        box.innerHTML = '';
        box.appendChild(el('div', { class: 'atex-co-rows-head' }, [
            el('span', { class: 'atex-co-label', text: 'Подходящие партии сырья' })
        ]));
        if (!this.materialId) {
            box.appendChild(el('div', { class: 'atex-co-batches-hint', text: 'Выберите вид сырья, чтобы увидеть партии.' }));
            return;
        }
        var matId = String(this.materialId);
        var list = this.batches
            .filter(function(b) { return b.active && String(b.materialId) === matId; })
            .sort(function(a, b) { return a.remainderM2 - b.remainderM2; });
        if (!list.length) {
            box.appendChild(el('div', { class: 'atex-co-batches-hint', text: 'Нет партий «В работе» по этому виду сырья.' }));
            return;
        }
        // Сколько м² сырья нужно на план: ширина джамбо × длина рулона × число резок.
        var p = this.plan;
        var neededM2 = (p && p.feasible && p.inputWidth > 0 && p.rollLength > 0)
            ? round3(p.inputWidth / 1000 * p.rollLength * p.totalPasses) : 0;
        list.forEach(function(b) {
            var insufficient = neededM2 > 0 && b.remainderM2 < neededM2;
            var row = el('div', { class: 'atex-co-batch' + (insufficient ? ' is-insufficient' : '') });
            if (insufficient) row.title = 'Остатка не хватает на резку (нужно ' + neededM2 + ' м²) — предложить клиенту.';
            row.appendChild(el('span', { class: 'atex-co-batch-no', text: formatBatchTimestamp(b.no) || ('#' + b.id) }));
            row.appendChild(el('span', { class: 'atex-co-batch-wh', text: b.warehouse || '—' }));
            row.appendChild(el('span', { class: 'atex-co-batch-rem', text: Math.floor(b.remainderM2) + ' м²' }));
            box.appendChild(row);
        });
        if (neededM2 > 0) {
            box.appendChild(el('div', { class: 'atex-co-batches-hint',
                text: 'Серые — остатка < ' + neededM2 + ' м² (на план), их лучше продать клиенту.' }));
        }
    };

    // #4779: строка на каждую желаемую ширину (ширина + количество + удаление);
    // последнюю строку не удаляем — оставляем пустую, чтобы форму было чем заполнить.
    AtexCutOptimizer.prototype.renderRows = function() {
        var self = this;
        var box = this.rowsEl;
        box.innerHTML = '';
        if (!this.rows.length) this.rows.push({ width: '', qty: '1' });
        this.rows.forEach(function(row, idx) {
            var widthInput = el('input', { class: 'atex-co-input', type: 'text', inputmode: 'decimal',
                placeholder: 'ширина, мм', value: row.width });
            widthInput.addEventListener('input', function() { row.width = widthInput.value; self.maybeRecalc(); });
            // Кол-во — целое, числовое, шаг 5 (#3478).
            var qtyInput = el('input', { class: 'atex-co-input', type: 'number', inputmode: 'numeric',
                min: '0', step: '5', placeholder: 'кол-во', value: row.qty });
            qtyInput.addEventListener('input', function() { row.qty = qtyInput.value; self.maybeRecalc(); });
            var del = el('button', { class: 'atex-co-row-del', type: 'button', title: 'Удалить ширину', text: '×' });
            del.addEventListener('click', function() {
                self.rows.splice(idx, 1);
                if (!self.rows.length) self.rows.push({ width: '', qty: '1' });
                self.renderRows();
                self.maybeRecalc();
            });
            box.appendChild(el('div', { class: 'atex-co-row' }, [widthInput, qtyInput, del]));
        });
    };

    // #4779: подходящие точки запаса — строки «Максимального запаса», совпавшие с
    // выбранными Видом сырья, длиной, Лидером, Диаметром втулки и Типом намотки.
    // Это ширины, которые целесообразно нарезать впрок: клик по точке кладёт её в
    // желаемые рулоны — краем джамбо добирается запас вместо отхода.
    AtexCutOptimizer.prototype.renderStockPoints = function() {
        var self = this;
        var box = this.stockEl;
        if (!box) return;
        box.innerHTML = '';
        box.appendChild(el('div', { class: 'atex-co-rows-head' }, [
            el('span', { class: 'atex-co-label', text: 'Подходящие точки запаса' })
        ]));
        function hint(text) { box.appendChild(el('div', { class: 'atex-co-stock-hint', text: text })); }
        if (!this.meta.maxStock) {
            hint('Справочник «Максимальный запас» недоступен — подбирать точки запаса не из чего.');
            return;
        }
        if (this.stockLoadFailed) {
            hint('Не удалось прочитать справочник «Максимальный запас» — точки запаса не подобрать.');
            return;
        }
        if (!this.stockPoints.length) {
            hint('Справочник «Максимальный запас» пуст — нарезать впрок нечего.');
            return;
        }
        // #4811: у КЛИЕНТСКОГО лидера точек запаса не бывает — нарезать впрок под чужой
        // лидер нечего. Не «ничего не нашлось», а «искать нечего»: говорим об этом прямо,
        // иначе пустая панель читается как сбой подбора.
        if (core.isClientLeader(this.leaderLabel)) {
            hint('Лидер клиентский — точек запаса под него не бывает: впрок такое не режут.');
            return;
        }
        if (!this.materialId) {
            hint('Выберите вид сырья, чтобы увидеть точки запаса.');
            return;
        }
        var mat = this.materialById(this.materialId);
        var points = matchStockPoints(this.stockPoints, {
            material: { id: this.materialId, label: mat ? mat.label : '' },
            length: this.lengthInput ? this.lengthInput.value : this.lengthValue,
            winding: this.windingValue,
            // #4804 п.1: втулка сверяется парой «диаметр + материал» по записи справочника.
            sleeveChoice: this.sleeveChoice(),
            sleeveById: this.sleeveById(),
            // #4811: выбран лидер ПОДПИСЬЮ; сверяем записью справочника, если она есть.
            leader: this.leaderChoice()
        });
        if (!points.length) {
            hint('Нет точек запаса под выбранные параметры (сырьё, длина, лидер, втулка, намотка).');
            return;
        }
        points.forEach(function(p) {
            var details = stockPointDetails(p);
            // Подпись номенклатуры в узкой колонке обрезается — полностью её видно в title.
            var row = el('button', { class: 'atex-co-stock-point', type: 'button',
                title: 'Добавить ' + p.width + ' мм в желаемые рулоны · ' + details });
            row.appendChild(el('span', { class: 'atex-co-stock-width', text: p.width + ' мм' }));
            row.appendChild(el('span', { class: 'atex-co-stock-nom', text: details }));
            row.appendChild(el('span', { class: 'atex-co-stock-limit',
                text: p.limit > 0 ? ('до ' + round3(p.limit) + ' рул.') : '—' }));
            row.addEventListener('click', function() { self.addWidthFromStock(p); });
            box.appendChild(row);
        });
        hint('Клик по точке добавляет её ширину в желаемые рулоны (количество — максимальный запас).');

        // Выбор пользователя как { id, label } — точка запаса может хранить и ссылку, и текст.
        function refChoice(list, id) {
            var wanted = String(id || '');
            if (!wanted) return { id: '', label: '' };
            var found = (list || []).filter(function(o) { return String(o.id) === wanted; })[0];
            return { id: wanted, label: found ? found.label : '' };
        }

        // Подпись номенклатуры точки: длина · намотка · втулка · лидер (что задано).
        function stockPointDetails(p) {
            var parts = [];
            if (p.length > 0) parts.push(round3(p.length) + ' м');
            if (p.winding) parts.push(p.winding);
            if (p.sleeve && p.sleeve.label) parts.push('втулка ' + p.sleeve.label);
            if (p.leader && p.leader.label) parts.push('лидер ' + p.leader.label);
            return parts.join(' · ') || 'любая номенклатура';
        }
    };

    // #4811: выбранный лидер в виде { id, label } для сверки с точкой запаса. Своя запись
    // справочника нашлась — сверка пойдёт по id (переживает переименование), не нашлась —
    // по подписи. Лидер не выбран — пусто, и по нему не фильтруем (прежнее поведение #3391).
    AtexCutOptimizer.prototype.leaderChoice = function() {
        var label = String(this.leaderLabel || '');
        if (!label) return { id: '', label: '' };
        var rec = core.resolveLeader(this.leaders, label);
        return { id: rec ? rec.id : '', label: label };
    };
    // Запись справочника «Лидер» под выбранную подпись; у «Клиентского» её нет → ''.
    AtexCutOptimizer.prototype.leaderRefId = function() {
        var rec = core.resolveLeader(this.leaders, this.leaderLabel);
        return rec ? rec.id : '';
    };

    // #4804 п.1: выбор втулки как пара «диаметр + материал» — в этом виде его понимают
    // и подбор точек запаса, и подстановка втулки в позицию заказа.
    AtexCutOptimizer.prototype.sleeveChoice = function() {
        return { inches: this.sleeveInches || '', materialId: this.sleeveMaterialId || '' };
    };
    // Выбор втулки строкой — «1″ · Пластик чёрная» / «0,5″ · Картон»; не выбран — прочерк.
    AtexCutOptimizer.prototype.sleeveChoiceLabel = function() {
        var inches = String(this.sleeveInches || '');
        if (!inches) return '— не указана —';
        var opt = core.sleeveInchesOptions().filter(function(o) { return o.value === inches; })[0];
        var label = opt ? opt.label : inches;
        if (!core.sleeveNeedsMaterial(inches)) return label + ' · ' + core.CARDBOARD_LABEL;
        var mat = (this.sleeveMaterials || []).filter(function(m) {
            return String(m.id) === String(this.sleeveMaterialId || '');
        }, this)[0];
        return label + (mat ? ' · ' + mat.label : ' · материал не выбран');
    };
    // Записи справочника «Диаметр втулки» по id — чтобы у точки запаса прочитать
    // диаметр и материал той втулки, на которую она ссылается.
    AtexCutOptimizer.prototype.sleeveById = function() {
        var map = {};
        (this.sleeves || []).forEach(function(rec) { map[String(rec.id)] = rec; });
        return map;
    };
    // Запись справочника под ПОЛОСУ этой ширины (готовая на неё → метровая → нет).
    AtexCutOptimizer.prototype.sleeveForWidth = function(width) {
        var choice = this.sleeveChoice();
        choice.width = width;
        return core.resolveSleeve(this.sleeves, choice);
    };

    // #4779: положить ширину точки запаса в желаемые рулоны. Количество — её
    // максимально допустимый запас; ширина уже в списке → не плодим строку-дубль.
    AtexCutOptimizer.prototype.addWidthFromStock = function(point) {
        var width = toNumber(point && point.width);
        if (!(width > 0)) return;
        var same = this.rows.filter(function(r) { return toNumber(r.width) === width; })[0];
        if (same) {
            this.notify('Ширина ' + width + ' мм уже в списке желаемых рулонов.');
            return;
        }
        var qty = toNumber(point.limit) > 0 ? String(Math.round(toNumber(point.limit))) : '1';
        var empty = this.rows.filter(function(r) { return String(r.width).trim() === ''; })[0];
        if (empty) { empty.width = String(width); empty.qty = qty; }
        else { this.rows.push({ width: String(width), qty: qty }); }
        this.renderRows();
        this.maybeRecalc();
    };

    // Комбобокс «Длина рулона»: текстовое поле (свой ввод) + кнопка-стрелка,
    // открывающая ПОЛНЫЙ список стандартных длин без фильтрации по значению (#3482).
    AtexCutOptimizer.prototype.makeLengthCombo = function() {
        var self = this;
        var input = el('input', { class: 'atex-co-input atex-co-combo-input', type: 'text', inputmode: 'decimal',
            autocomplete: 'off', placeholder: 'напр. 450', role: 'combobox',
            value: (this.lengthValue == null || this.lengthValue === '') ? String(DEFAULT_LENGTH) : this.lengthValue });
        var caret = el('button', { class: 'atex-co-combo-caret', type: 'button', tabindex: '-1',
            'aria-label': 'Показать список длин', text: '▾' });
        var listEl = el('div', { class: 'atex-co-combo-list', role: 'listbox' });
        var wrap = el('div', { class: 'atex-co-combo' }, [input, caret, listEl]);

        function rebuild() {
            listEl.innerHTML = '';
            LENGTH_PRESETS.forEach(function(v) {
                var active = String(v) === String(input.value).trim();
                var item = el('div', { class: 'atex-co-combo-item' + (active ? ' is-active' : ''),
                    role: 'option', text: String(v) + ' м' });
                item.addEventListener('mousedown', function(e) {
                    e.preventDefault();
                    input.value = String(v);
                    self.lengthValue = String(v);
                    closeList();
                    self.renderStockPoints();   // #4779: длина входит в номенклатуру запаса
                    self.maybeRecalc();
                });
                listEl.appendChild(item);
            });
        }
        function openList() { rebuild(); wrap.classList.add('is-open'); }
        function closeList() { wrap.classList.remove('is-open'); }
        function isOpen() { return wrap.classList.contains('is-open'); }

        caret.addEventListener('mousedown', function(e) { e.preventDefault(); if (isOpen()) closeList(); else openList(); input.focus(); });
        input.addEventListener('focus', openList);
        // Ввод своей длины: список НЕ фильтруем — показываем целиком (только
        // подсвечиваем совпадение), значение пересчитывает раскладку.
        input.addEventListener('input', function() {
            self.lengthValue = input.value;
            rebuild();
            self.renderStockPoints();   // #4779: длина входит в номенклатуру запаса
            self.maybeRecalc();
        });
        input.addEventListener('keydown', function(e) { if (e.key === 'Escape') closeList(); });
        document.addEventListener('mousedown', function(e) { if (!wrap.contains(e.target)) closeList(); });

        return { node: wrap, input: input };
    };

    AtexCutOptimizer.prototype.onMaterialChange = function(id) {
        this.materialId = String(id || '');
        var m = this.materialById(this.materialId);
        if (m) {
            // Подставляем только ширину джамбо; длину рулона задаёт пользователь
            // (по умолчанию 450, выбор из списка стандартных длин), материал её не диктует.
            if (this.widthInput) this.widthInput.value = String(m.width || '');
            this.widthValue = String(m.width || '');
            // Допуск на отход — из выбранного материала («Допуск, мм»); если не задан, 21 мм (#3573).
            var matTol = toNumber(m.tolerance) > 0 ? String(m.tolerance) : String(DEFAULT_TOLERANCE);
            this.tolValue = matTol;
            if (this.tolDisplay) this.tolDisplay.textContent = matTol;  // #3597: только вывод
        }
        this.renderBatches();
        this.renderStockPoints();   // #4779: точки запаса — по выбранному сырью
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
        this.renderBatches();     // достаточность остатка зависит от плана
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
        // #4690: кнопка деактивирована — заказ из оптимизатора не создаём.
        // Обработчик не вешаем; сама модалка (openOrderModal) оставлена нетронутой,
        // чтобы вернуть кнопку в строй одной строкой.
        var toOrderBtn = el('button', { class: 'atex-co-btn atex-co-btn-primary atex-co-to-order', type: 'button', text: 'В заказ' });
        toOrderBtn.disabled = true;
        toOrderBtn.title = 'Создание заказа из оптимизатора отключено';
        head.appendChild(toOrderBtn);
        view.appendChild(head);

        if (!p.proportionKept) {
            // #4804 п.4: набор шире джамбо — количества уменьшены, чтобы влезть.
            view.appendChild(el('div', { class: 'atex-co-note',
                text: 'Заданный набор шире входа — количества уменьшены, чтобы уместиться в ширину; пропорция желаемых количеств не сохранена.' }));
        }
        if (p.overflow && p.overflow.length) {
            view.appendChild(el('div', { class: 'atex-co-note',
                text: 'Не помещаются (шире джамбо): ' + p.overflow.map(function(o) { return o.actualWidth + ' мм'; }).join(', ') }));
        }

        view.appendChild(this.renderSummary(p));
        view.appendChild(this.renderMaps(p));
        view.appendChild(this.renderTable(p));
    };

    // #4804 п.2: единственная карта раскроя — все ширины на ней.
    AtexCutOptimizer.prototype.renderMaps = function(p) {
        var wrap = el('div', { class: 'atex-co-maps' });
        // #3597: допуск только из Вида сырья (this.tolValue), не редактируется. Пусто/0 → 21 мм.
        var tol = toNumber(this.tolValue);
        if (!(tol > 0)) tol = DEFAULT_TOLERANCE;
        p.maps.forEach(function(m) {
            var card = el('div', { class: 'atex-co-map' });
            var widthsLabel = m.pattern.map(function(s) { return s.width + '×' + s.knives; }).join(' + ');
            card.appendChild(el('div', { class: 'atex-co-bar-caption' }, [
                // #4804 п.2: карта одна — нумерации «Карта 1»/«Карта 2» больше нет.
                el('span', { class: 'atex-co-map-title', text: 'Карта раскроя · ' + widthsLabel }),
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
            // Цвет отхода по допуску: ≤ допуска — норма (зелёный), больше — превышение
            // (красный). Допуск всегда задан: из материала или дефолт 21 мм (#3573).
            var wasteCls = 'atex-co-map-waste' + (m.trimWidth <= tol ? ' is-ok' : ' is-warn');
            var wasteText = 'Отход: ' + m.trimWidth + ' мм (' + m.trimPct + '%) · допуск ' + round3(tol) + ' мм';
            card.appendChild(el('div', { class: 'atex-co-map-foot' }, [
                el('span', { text: 'Полос/резку: ' + m.knivesTotal }),
                // #4828: база процента — занятая полосами (эффективная) ширина резки;
                // во всплывающей подсказке говорим об этом прямо.
                el('span', { class: wasteCls, text: wasteText,
                    title: 'Процент от занятой полосами (эффективной) ширины резки — ' + m.usedWidth
                        + ' мм, не от общей ширины входа' })
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
            el('span', { text: 'Желаемое' }),
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
        // #4804 п.2: метрики «Карт раскроя» нет — карта всегда одна.
        summary.appendChild(metric('Всего резок', p.totalPasses));
        // #3744: общие минуты резки в трёх единицах (минуты/часы/дни): «Всего резок» ×
        // время намотки рулона (нормы метража WIND_* из «Время операции, мин», как в
        // production-planning.js). #4832: наладку в оценке не считаем (решение
        // заказчика); норм нет или длина не задана — честное «—», а не «0 мин».
        var planMins = planningMinutes(p.totalPasses, p.rollLength, windingPointsFromTimes(this.opTimes || {}));
        var timeVal;
        if (planMins > 0) {
            var units = planningTimeUnits(planMins);
            timeVal = el('span', { class: 'atex-co-time' }, [
                el('span', { class: 'atex-co-time-min', text: ruNum(units.minutes) + ' мин' }),
                el('span', { class: 'atex-co-time-sub', text: ruNum(units.hours) + ' ч · ' + ruNum(units.days) + ' дн' })
            ]);
        } else {
            timeVal = el('span', { class: 'atex-co-time',
                title: 'В «Время операции, мин» нет норм намотки WIND_* — время посчитать нельзя' }, ['—']);
        }
        summary.appendChild(metric('Время на резку', timeVal, true));
        return summary;

        // Русский десятичный разделитель (запятая) для часов/дней.
        function ruNum(n) { return String(n).replace('.', ','); }

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
            this.notify('Не найдены таблицы «Заказ»/«Заказанное количество» — запись невозможна.', 'error');
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
        // #3592: «Лидер» — выбор из справочника «Лидер» (table/1132), а не свободный текст.
        // #4779: значения номенклатуры (лидер/втулка/намотка) подставляются из формы.
        var leadSel = this.refSelect('atex-co-lead', core.optimizerLeaders(), 'Лидер', { value: this.leaderLabel });
        var newOrderBox = el('div', { class: 'atex-co-modal-neworder' }, [
            field('Клиент', clientSel.node),
            field('Лидер', leadSel.node)
        ]);
        modal.appendChild(newOrderBox);

        // Поля позиций (нужны всегда — их нет в калькуляторе).
        // #4804 п.1: втулка берётся парой «диаметр + материал» из формы; КАЖДОЙ позиции
        // подбирается своя запись справочника — под ширину её полосы.
        var sleeveNote = el('div', { class: 'atex-co-readonly', text: this.sleeveChoiceLabel() });
        var windingSel = el('select', { class: 'atex-co-input' }, [
            el('option', { value: '', text: '— не указано —' }),
            el('option', { value: 'IN', text: 'IN (внутрь)' }),
            el('option', { value: 'OUT', text: 'OUT (наружу)' })
        ]);
        windingSel.value = this.windingValue || '';
        modal.appendChild(field('Втулка', sleeveNote));
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
            submitBtn.disabled = cancelBtn.disabled = true;
            msg.className = 'atex-co-modal-msg';
            msg.textContent = 'Запись…';
            self.commitToOrder({
                number: number,
                existing: orderByNumber(number),
                clientId: clientSel.value(),
                // #4811: в модалке лидер выбирается ПОДПИСЬЮ (их четыре), а «Лидер» заказа и
                // позиции — ССЫЛКА на справочник 1132. Пишем id найденной записи; у
                // «Клиентского» её нет — тогда поле остаётся пустым, чужую не подставляем.
                lead: (core.resolveLeader(self.leaders, leadSel.value()) || {}).id || '',
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
    // #4779: opts = { value, onChange } — начальное значение и подписка на выбор
    // (поля номенклатуры в форме пересобирают список точек запаса).
    AtexCutOptimizer.prototype.refSelect = function(idPrefix, options, placeholder, opts) {
        opts = opts || {};
        var initial = String(opts.value || '');
        function notify(id) { if (typeof opts.onChange === 'function') opts.onChange(id); }
        if (typeof window !== 'undefined' && window.AtexRefSearch && window.AtexRefSearch.createSelect) {
            var value = initial;
            var node = window.AtexRefSearch.createSelect({
                classPrefix: 'atex-co',
                inputClass: 'atex-co-input',
                cacheKey: idPrefix,
                options: (options || []).map(function(o) { return { id: o.id, label: o.label }; }),
                value: initial,
                placeholder: placeholder || '',
                onChange: function(id) { value = String(id || ''); notify(value); }
            });
            return { node: node, value: function() { return value; } };
        }
        var sel = el('select', { class: 'atex-co-input' }, [el('option', { value: '', text: '— не выбрано —' })]
            .concat((options || []).map(function(o) { return el('option', { value: o.id, text: o.label }); })));
        sel.value = initial;
        sel.addEventListener('change', function() { notify(sel.value); });
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
                    // «Заказанное количество» хранит НОМИНАЛ («Ширина в заказе»); планирование
                    // само переводит его в фактическую (annotatePositionsCutWidth, #3372).
                    var orderWidth = (r.nominalWidth != null) ? r.nominalWidth : r.actualWidth;
                    // Кол-во рулонов — главное значение записи «Заказанное количество»
                    // (у таблицы нет реквизита «Кол-во»). На старой схеме «Позиция
                    // заказа» это был реквизит — пишем туда, если он есть.
                    var qtyReq = reqIdByNames(posMeta, POSITION_REQ.qty);
                    if (qtyReq) fields[qtyReq] = r.desiredQty;
                    else fields[String(posMeta.id)] = r.desiredQty;
                    put(fields, posMeta, POSITION_REQ.raw, self.materialId);
                    put(fields, posMeta, POSITION_REQ.width, orderWidth);
                    if (rollLength > 0) put(fields, posMeta, POSITION_REQ.length, rollLength);
                    // #4804 п.1: втулка — под ширину ИМЕННО ЭТОЙ полосы (готовая на неё,
                    // иначе метровая). Подходящей нет — поле оставляем пустым, чужую не пишем.
                    var sleeve = self.sleeveForWidth(r.actualWidth);
                    put(fields, posMeta, POSITION_REQ.sleeve, sleeve ? sleeve.id : '');
                    put(fields, posMeta, POSITION_REQ.winding, normalizeWinding(opts.winding));
                    put(fields, posMeta, POSITION_REQ.lead, opts.lead);  // #3592: лидер позиции (ссылка на «Лидер» 1132)
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
