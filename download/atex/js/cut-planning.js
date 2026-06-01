// Рабочее место atex «Расчёт резки» (роль Диспетчер).
//
// Подбор раскроя: для заданной ширины рулона и целевой ширины полосы
// автоматически предлагает комбинацию полос «Заказ» + «Склад» с минимальным
// отходом. Часть epic ideav/atex#52, подзадача B.
//
// Чистое ядро расчёта вынесено в объект `calc` и экспортируется через
// module.exports для модульных тестов (experiments/atex-cut-planning.test.js).

(function(root, factory) {
    'use strict';
    var api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }
    if (typeof window !== 'undefined') {
        window.AtexCutPlanning = api;
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
        return Math.round(n * 1000) / 1000;
    }

    // Занятая полосами ширина — Σ(ширина × количество).
    function usedWidth(strips) {
        return round3((strips || []).reduce(function(sum, s) {
            return sum + toNumber(s.width) * toNumber(s.qty);
        }, 0));
    }

    // «Остаток, мм» — «Ширина входа» минус занятая ширина.
    function remainder(inputWidth, strips) {
        return round3(toNumber(inputWidth) - usedWidth(strips));
    }

    // Подбор комбинации: набрать целевую ширину, добрать остаток ходовыми (min отход).
    // candidates: [{width, freq}] по убыванию freq. tolerance — допустимый |отход|.
    function suggestCombination(inputWidth, targetWidth, candidates, tolerance) {
        var W = toNumber(inputWidth), t = toNumber(targetWidth), tol = toNumber(tolerance);
        var strips = [];
        var nTarget = (t > 0) ? Math.floor(W / t) : 0;
        if (nTarget > 0) strips.push({ width: t, qty: nTarget, purpose: 'Заказ' });
        var rem = round3(W - nTarget * t);
        var fill = bestFill(rem, candidates, tol);
        fill.strips.forEach(function(s){ strips.push({ width: s.width, qty: s.qty, purpose: 'Склад' }); });
        var used = round3(strips.reduce(function(a,s){ return a + s.width*s.qty; }, 0));
        var remOut = round3(W - used);
        return { strips: strips, used: used, remainder: remOut,
                 withinTolerance: Math.abs(remOut) <= Math.abs(tol) };
    }

    // Перебор добора остатка rem ширинами candidates: {strips, leftover, freqSum}
    // с минимальным leftover (затем макс freqSum). Ограниченный поиск (rem конечен).
    function bestFill(rem, candidates, tol) {
        var cands = (candidates || []).map(function(c){ return { width: toNumber(c.width), freq: toNumber(c.freq) }; });
        // допускаем кандидатов чуть шире rem (в пределах допуска) — DFS отсеет неуместившиеся
        cands = cands.filter(function(c){ return c.width > 0 && c.width <= rem + Math.abs(toNumber(tol)); });
        var best = { strips: [], leftover: round3(rem), freqSum: 0 };
        (function dfs(i, left, acc, freqSum){
            var leftR = round3(left);
            if (leftR < best.leftover || (leftR === best.leftover && freqSum > best.freqSum)) {
                best = { strips: acc.slice(), leftover: leftR, freqSum: freqSum };
            }
            if (leftR <= Math.abs(toNumber(tol))) return;
            for (var k = i; k < cands.length; k++) {
                var c = cands[k];
                if (c.width > leftR) continue;
                var maxQ = Math.floor(leftR / c.width);
                for (var q = maxQ; q >= 1; q--) {
                    acc.push({ width: c.width, qty: q });
                    dfs(k + 1, round3(leftR - c.width * q), acc, freqSum + c.freq * q);
                    acc.pop();
                }
            }
        })(0, rem, [], 0);
        return best;
    }

    // Канонический ключ комбинации: сырьё + отсортированный мультинабор ширина×кол-во.
    function combinationSignature(materialId, strips) {
        var parts = (strips || []).map(function(s){ return round3(toNumber(s.width)) + 'x' + toNumber(s.qty); }).sort();
        return String(materialId == null ? '' : materialId) + '|' + parts.join('+');
    }

    var calc = {
        toNumber: toNumber,
        round3: round3,
        usedWidth: usedWidth,
        remainder: remainder,
        suggestCombination: suggestCombination,
        bestFill: bestFill,
        combinationSignature: combinationSignature
    };

    // ─────────────────────────── Браузерный слой ───────────────────────────
    // Ниже — DOM-контроллер (скелет). Требует window/document/fetch; в Node не
    // выполняется. Полная реализация — следующие задачи.

    function init() {
        if (typeof document === 'undefined') return;
        var root = document.getElementById('atex-cut-planning');
        if (!root || root.dataset.initialized === '1') return;
        root.dataset.initialized = '1';
        // TODO: запустить DOM-контроллер (следующие задачи).
    }

    return { calc: calc, init: init };
});
