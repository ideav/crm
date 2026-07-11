// Regression for ideav/crm#4173 — сирота «нет связей» ВИСИТ, хотя #4168/#4171/#4172 задеплоены (v.21),
// а лог генерации показывает, что чистка после разбиения «нашла 0» (условие по данным cut_planning
// совпадает — значит self.cuts на момент той чистки отличался). Страховка «на показе»
// (maybeCleanOrphansOnRender): renderQueue при КАЖДОЙ отрисовке убирает висящую повреждённую сироту.
//
// Run with: node experiments/atex-production-planning-4173.test.js

process.env.TZ = 'UTC';
global.window = { db: 'testdb', xsrf: 'x' };
var Controller = require('../download/atex/js/production-planning.js').Controller;

var passed = 0, total = 0, pending = 0;
function assert(cond, name, extra) { total++; console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : '')); if (cond) passed++; else process.exitCode = 1; }
function meta(id, pairs) { return { id: String(id), reqs: pairs.map(function(p) { return { id: String(p[0]), val: p[1] }; }) }; }
var cutMeta = meta(100, [['196','Тип намотки']]);
function ctrl() {
    var c = new Controller({ getAttribute: function() { return 'testdb'; } });
    c.meta.cut = cutMeta;
    return c;
}
function cut(id, extra) { return Object.assign({ id: id, plannedRuns: 4, winding: 'OUT', materialId: 'MW308' }, extra || {}); }
function done() { if (--pending === 0) console.log('\n' + passed + '/' + total + ' проверок пройдено.'); }

// ── 1) Висит сирота → maybeCleanOrphansOnRender зовёт чистку и (после удаления) render ──
(function() {
    pending++;
    var c = ctrl();
    c.cuts = [ cut('H'), cut('ORPH', { winding: '', plannedRuns: 4 }) ];
    c.supplies = [ { cutId: 'H' } ];   // ORPH без Обеспечения
    var cleanCalls = 0, renders = 0;
    c.removeCorruptedDaySplitOrphans = function() { cleanCalls++; return Promise.resolve(1); };
    c.render = function() { renders++; };
    c.maybeCleanOrphansOnRender();
    setTimeout(function() {
        assert(cleanCalls === 1, '#4173 висит сирота → чистка вызвана при рендере', '(calls=' + cleanCalls + ')');
        assert(renders === 1, '#4173 после удаления сироты — перерисовка', '(renders=' + renders + ')');
        assert(c._orphanCleaning === false, '#4173 флаг занятости снят после чистки');
        done();
    }, 30);
})();

// ── 2) Тот же id второй раз НЕ пробуем (защита от цикла, если _m_del не убрал) ──
(function() {
    pending++;
    setTimeout(function() {
        var c = ctrl();
        c.cuts = [ cut('ORPH', { winding: '', plannedRuns: 4 }) ];
        c.supplies = [];
        var cleanCalls = 0;
        c.removeCorruptedDaySplitOrphans = function() { cleanCalls++; return Promise.resolve(0); };   // «не убралось»
        c.render = function() {};
        c.maybeCleanOrphansOnRender();   // 1-я попытка
        setTimeout(function() {
            c.maybeCleanOrphansOnRender();   // 2-я — тот же id уже помечен _orphanRenderTried → пропуск
            setTimeout(function() {
                assert(cleanCalls === 1, '#4173 один и тот же id чистится ОДИН раз (без цикла)', '(calls=' + cleanCalls + ')');
                done();
            }, 20);
        }, 20);
    }, 80);
})();

// ── 3) Нет сирот / валидные резки → чистку НЕ зовём ──
(function() {
    pending++;
    setTimeout(function() {
        var c = ctrl();
        c.cuts = [ cut('H'), cut('STK', { winding: 'OUT', plannedRuns: 4 }) ];   // склад: намотка есть, без Обеспечения — НЕ сирота
        c.supplies = [ { cutId: 'H' } ];
        var cleanCalls = 0;
        c.removeCorruptedDaySplitOrphans = function() { cleanCalls++; return Promise.resolve(0); };
        c.render = function() {};
        c.maybeCleanOrphansOnRender();
        setTimeout(function() {
            assert(cleanCalls === 0, '#4173 нет сирот (валидная/складская резка) → чистка НЕ вызвана', '(calls=' + cleanCalls + ')');
            done();
        }, 20);
    }, 160);
})();

// ── 4) Идёт чистка (_orphanCleaning) → повторный вызов пропускается ──
(function() {
    pending++;
    setTimeout(function() {
        var c = ctrl();
        c.cuts = [ cut('ORPH', { winding: '', plannedRuns: 4 }) ];
        c.supplies = [];
        c._orphanCleaning = true;   // как будто уже чистим
        var cleanCalls = 0;
        c.removeCorruptedDaySplitOrphans = function() { cleanCalls++; return Promise.resolve(1); };
        c.render = function() {};
        c.maybeCleanOrphansOnRender();
        setTimeout(function() {
            assert(cleanCalls === 0, '#4173 во время активной чистки повторный вызов пропускается', '(calls=' + cleanCalls + ')');
            done();
        }, 20);
    }, 240);
})();
