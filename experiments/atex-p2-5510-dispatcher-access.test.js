// ideav/crm#5510 — Диспетчер Фазы 2: меню и права рабочих мест «Импорт из 1С», «Ножи и валы»,
// «Раскрой джамбо», «Склад мастер-рулонов» (docs/atex_p2_dispatcher_access_5510.json).
//
//   1. у каждого рабочего места спецификации есть пункт меню Диспетчера, адрес ведёт на
//      существующие шаблон templates/atex-p2/<адрес>.html и скрипт download/atex-p2/js/<адрес>.js;
//   2. права Диспетчера после накатки (#5320 + #5510; #5510 сильнее) покрывают рабочее место:
//      таблицы записи — WRITE, удаления — флаг delete, чтения — не ниже READ, отчёты — READ;
//   3. таблицы, которые рабочие места берут из кода (master-rolls-core TABLES, NEED_TABLES
//      раскроя через PRODUCTION_CONFIGS этикетки), названы в спецификации рабочего места.
//
// Run with: node experiments/atex-p2-5510-dispatcher-access.test.js

var fs = require('fs');
var path = require('path');

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

var ROOT = path.join(__dirname, '..');
function readJson(rel) {
    try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); }
    catch (e) { console.log('FAIL — ' + rel + ' не читается: ' + e.message); process.exitCode = 1; return null; }
}

var ROLE = 'Диспетчер';
var spec = readJson('docs/atex_p2_dispatcher_access_5510.json');
var prior = readJson('docs/atex_p2_die_planning_grants_5320.json');

// Итоговые права роли после накатки файлов по порядку: ключ → {level, delete}.
function effectiveGrants(files) {
    var out = {};
    files.forEach(function(f) {
        ((f && f.roles) || []).forEach(function(r) {
            if (r.name !== ROLE) return;
            r.grants.forEach(function(g) {
                var key = g.report ? 'report:' + g.report : 'table:' + g.table + (g.field ? '→' + g.field : '');
                out[key] = { level: g.level, delete: !!g.delete };
            });
        });
    });
    return out;
}
var RANK = { BARRED: 0, READ: 1, WRITE: 2 };
function levelOf(G, key) { return G[key] ? G[key].level : 'none'; }
function atLeast(G, key, lvl) { return !!G[key] && RANK[G[key].level] >= RANK[lvl]; }

if (spec) (function() {
    var G = effectiveGrants([prior, spec]);
    var wps = spec.workplaces || [];
    assert(wps.length === 4, 'в спецификации 4 рабочих места', 'есть ' + wps.length);

    // ── 1. Меню ──────────────────────────────────────────────────────────────
    wps.forEach(function(w) {
        var item = (spec.menu || []).filter(function(m) { return m.role === ROLE && m.href === w.href; })[0];
        assert(!!item, 'пункт меню Диспетчера «' + w.name + '» → ' + w.href);
        if (item) assert(/^<i class="pi pi-[a-z-]+"><\/i>$/.test(item.icon), 'иконка пункта «' + w.name + '» — тег <i> PrimeIcons', item.icon);
        assert(fs.existsSync(path.join(ROOT, 'templates/atex-p2', w.href + '.html')), 'шаблон templates/atex-p2/' + w.href + '.html есть');
        assert(fs.existsSync(path.join(ROOT, 'download/atex-p2/js', w.href + '.js')), 'скрипт download/atex-p2/js/' + w.href + '.js есть');
    });

    // ── 2. Права покрывают рабочие места ─────────────────────────────────────
    wps.forEach(function(w) {
        (w.writes || []).forEach(function(t) {
            assert(atLeast(G, 'table:' + t, 'WRITE'), w.name + ': запись в «' + t + '» — WRITE', 'есть ' + levelOf(G, 'table:' + t));
        });
        (w.deletes || []).forEach(function(t) {
            assert(!!G['table:' + t] && G['table:' + t].delete, w.name + ': удаление «' + t + '» — флаг delete');
        });
        (w.reads || []).forEach(function(t) {
            assert(atLeast(G, 'table:' + t, 'READ'), w.name + ': чтение «' + t + '» — не ниже READ', 'есть ' + levelOf(G, 'table:' + t));
        });
        (w.reports || []).forEach(function(r) {
            assert(atLeast(G, 'report:' + r, 'READ'), w.name + ': отчёт ' + r + ' — READ', 'есть ' + levelOf(G, 'report:' + r));
        });
    });
    // Удаление задания первичной резки тянет за собой его полосы.
    assert(!!G['table:Полоса раскроя'] && G['table:Полоса раскроя'].delete, 'полосы раскроя удаляются вместе с заданием — флаг delete');

    // ── 3. Таблицы из кода названы в спецификации ────────────────────────────
    function wp(href) { return wps.filter(function(w) { return w.href === href; })[0] || {}; }
    function named(w) { return [].concat(w.writes || [], w.reads || []); }

    var mr = require('../download/atex-p2/js/master-rolls-core.js').core;
    Object.keys(mr.TABLES).forEach(function(k) {
        var n = mr.TABLES[k].name;
        assert(named(wp('master-rolls')).indexOf(n) >= 0, 'склад МР: таблица кода «' + n + '» в спецификации');
    });

    var lp = require('../download/atex/js/label-production.js').core;
    var cfg = lp.PRODUCTION_CONFIGS[lp.PRODUCT_KIND.LABEL];
    ['jumboJob', 'jumboStrip', 'jumboBatch', 'material', 'masterRoll'].forEach(function(k) {
        var n = cfg.tables[k] && cfg.tables[k].name;
        assert(!!n && named(wp('jumbo-cutting')).indexOf(n) >= 0, 'раскрой джамбо: таблица кода «' + n + '» (' + k + ') в спецификации');
    });
    ['die', 'cylinder', 'machine'].forEach(function(k) {
        var n = cfg.tables[k] && cfg.tables[k].name;
        assert(!!n && named(wp('dies')).indexOf(n) >= 0, 'ножи и валы: таблица кода «' + n + '» (' + k + ') в спецификации');
    });
})();

console.log('\n' + passed + '/' + total + ' passed');
