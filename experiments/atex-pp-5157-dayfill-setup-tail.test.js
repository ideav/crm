// Tests for ideav/crm#5157 — «Не набирает 450 на 1 станке»: мерка DAY_FILL не признаёт
// добор «одна настройка в хвост дня, все проходы — на следующий день».
//
// Решение заказчика 15.10.2026: «ноль проходов тоже нормально — в этот день ложится одна
// настройка, а все проходы на следующий день». Это правило упаковщика (#3635 п.5 / #3955 / #4144):
// проход не влез — в хвост дня кладётся настройка под потолок нахлёста НАСТРОЙКИ, проходы уезжают.
// Мерка недобора знала только шаблон «наладка + проход» и обязана признавать и этот.
//
// Числа — день 16.10.2026 Станка 1 ateh: 407 мин при ёмкости 450 → под потолок резки (455)
// свободно 48, под потолок настройки (460) — 53; первым на следующий рабочий день стоит целое
// задание с наладкой 45 (ножи 30 + сырьё 15) и 4 проходами по 3.5. Наладка + проход = 48.5 > 48,
// а одна наладка 45 ≤ 53 — день добирается хвост-настройкой (407 + 45 = 452 ≤ 460). Упаковщик
// так и разложил этот день (трасса: «в хвост дня положена настройка 45 мин»), разбор — #5162.
//
// Run with: node experiments/atex-pp-5157-dayfill-setup-tail.test.js

process.env.TZ = 'UTC';
var mod = require('../download/atex/js/production-planning.js');
var planning = mod.planning;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

// День 1: под потолок резки свободно 48, под потолок настройки — 53 (нахлёсты 5 и 10).
// День 2: донор — целое задание с наладкой 45 и 4 проходами по 3.5 (need = 48.5).
function segsFixture() {
    return [
        { cutId: 'A', chainId: 'A', dayOffset: 1, windowStartMin: 480, runs: 10, setupMin: 0, durationMin: 300 },
        { cutId: 'B', chainId: 'B', dayOffset: 2, windowStartMin: 480 + 1440, runs: 4, setupMin: 45, durationMin: 14 }
    ];
}

// ── 1. Проход с наладкой не влезает (48.5 > 48), но наладка влезает в хвост настройки
//       (45 ≤ 53) → день назван недобранным, добор = хвост-настройка. ────────────────────────
(function() {
    var rows = planning.underfilledLayoutDays(segsFixture(), {
        freeMinFor: function(d) { return d === 1 ? 48 : 0; },
        freeTuneFor: function(d) { return d === 1 ? 53 : 0; }
    });
    var day1 = rows.filter(function(u) { return u.day === 1; })[0];
    assert(!!day1, '#5157: день 1 назван недобранным, когда в хвост влезает одна настройка',
        'rows=' + JSON.stringify(rows));
    assert(!!day1 && Math.abs((day1.needMin || 0) - 45) < 1e-6,
        '#5157: needMin = наладка донора (45), а не «наладка+проход»',
        day1 && ('needMin=' + day1.needMin));
    assert(!!day1 && day1.setupOnly === true,
        '#5157: добор помечен setupOnly — проходы донора едут на следующий день целиком');
})();

// ── 2. Настройка донора не влезает в хвост наладки (45 > 43) — день законно недобран,
//       мерка молчит (правило не должно ловить ничего и всегда). ─────────────────────────────
(function() {
    var rows = planning.underfilledLayoutDays(segsFixture(), {
        freeMinFor: function(d) { return d === 1 ? 38 : 0; },
        freeTuneFor: function(d) { return d === 1 ? 43 : 0; }
    });
    assert(!rows.some(function(u) { return u.day === 1; }),
        '#5157: настройка донора не влезает в хвост настройки — дня в мерке нет');
})();

// ── 3. Прежний шаблон не сломан: свободно 50 — влезает наладка + один проход (48.5) —
//       обычный репорт без setupOnly. ────────────────────────────────────────────────────────
(function() {
    var rows = planning.underfilledLayoutDays(segsFixture(), {
        freeMinFor: function(d) { return d === 1 ? 50 : 0; },
        freeTuneFor: function(d) { return d === 1 ? 50 : 0; }
    });
    var day1 = rows.filter(function(u) { return u.day === 1; })[0];
    assert(!!day1 && !day1.setupOnly && Math.abs((day1.needMin || 0) - 48.5) < 1e-6,
        '#5157: прежний шаблон «проход с наладкой» работает как раньше',
        day1 && ('needMin=' + day1.needMin + ' setupOnly=' + day1.setupOnly));
})();

// ── 4. Донор без наладки (продолжение, setup 0) и проход не влезает — добрать нечем,
//       мерка молчит (как раньше). ────────────────────────────────────────────────────────────
(function() {
    var segs = [
        { cutId: 'A', chainId: 'A', dayOffset: 1, windowStartMin: 480, runs: 10, setupMin: 0, durationMin: 300 },
        { cutId: 'B', chainId: 'B', dayOffset: 2, windowStartMin: 480 + 1440, runs: 4, setupMin: 0, durationMin: 14 }
    ];
    var rows = planning.underfilledLayoutDays(segs, {
        freeMinFor: function(d) { return d === 1 ? 2 : 0; },
        freeTuneFor: function(d) { return d === 1 ? 2 : 0; }
    });
    assert(!rows.some(function(u) { return u.day === 1; }),
        '#5157: у донора нет наладки и проход не влезает — добор не объявляется');
})();

console.log('Итог: ' + passed + '/' + total);
