// #4751 — «ДЕНЬ НАБИТ» ОПРЕДЕЛЯЕТСЯ ОДИН РАЗ.
//
// ЗАЧЕМ. В коде живут ТРИ мерки недобора, и за август каждый тикет выбирал между ними заново:
//   • `ops.dayFill` — вердикт УПАКОВЩИКА о СВОЕЙ раскладке (что он не смог набить из-за 🔒/заморозки);
//   • `underfilledDaysFromPlan` — РАЗНИЦА раскладки с ХРАНИМЫМ планом, в проходах, ограниченная
//     свободными минутами дня;
//   • `planUnderfilledDays` — «потолок − Σ хранимых минут», ЧЛЕН ОБЪЕКТИВА «Упорядочить», которым
//     кандидаты сравниваются между собой.
// #4745 назначил оператору первую, #4749 — вторую; тест #4743 при этом переписывали дважды.
// Тикет «опять не забит день» можно завести всегда, пока «набит» значит три разные вещи.
//
// ПРАВИЛО (ТЗ §15). Оператору и починке отвечает ОДИН вердикт — `plannerUnderfilledDays`. Он
// объединяет вердикт упаковщика и разницу с хранимым планом, и другой мерки у этого вопроса нет.
// `planUnderfilledDays` остаётся ТОЛЬКО объективу: там сравнивают КАНДИДАТОВ между собой, а не
// отвечают на вопрос «набит ли день» — это разные вопросы, и путать их нельзя.
//
// ЧТО ПРОВЕРЯЕМ (поведением, без чтения исходника):
//   A — вердикт непустой на дне, который заведомо можно набить (иначе тест ничего не стережёт);
//   B — ПРЕДУПРЕЖДЕНИЕ оператору называет РОВНО те станко-дни, что назвал вердикт;
//   C — ВЫРАВНИВАНИЕ идёт РОВНО по тем же станкам;
//   D — оба потребителя спрашивают вердикт, а не считают сами (перестал спрашивать — завёл мерку);
//   E — вердикт пуст → и предупреждения нет, и выравнивание не запускается (одно «нет» на всех);
//   F — объектив «Упорядочить» пользуется СВОЕЙ меркой и на вердикт оператора не влияет:
//       подменив вердикт, число объектива не двигаем.
//
// Run with: node experiments/atex-pp-4751-one-underfill-definition.test.js

process.env.TZ = 'UTC';
global.window = { db: 'ateh1', xsrf: 'x' };
var mod = require('../download/atex/js/production-planning.js');
var Controller = mod.Controller;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

var SID = '1279', SID2 = '1282';

// Стенд: вердикт подменяем, потребители — настоящие. Так видно, ЧТО каждый из них с ним делает.
function stand(verdict, extra) {
    var self = Object.create(Controller.prototype);
    self.asked = 0;
    self.said = [];
    self.levelled = null;
    self.filter = { date: '2026-08-13' };
    self.nowMs = function() { return Date.UTC(2026, 7, 13, 9, 0, 0); };
    self.cuts = [];
    self.slitters = [{ id: SID }, { id: SID2 }];
    self.overfilledDaysOf = function() { return []; };          // перебора нет — судим только недобор
    self.plannerUnderfilledDays = function() { self.asked++; return verdict.slice(); };
    self.levelDayLoad = function(ids) { self.levelled = ids.slice().sort(); return Promise.resolve(true); };
    self.warnOverfilledDays = function() {};
    self.notify = function(msg, kind) { self.said.push({ msg: msg, kind: kind }); };
    for (var k in (extra || {})) self[k] = extra[k];
    return self;
}
function row(sid, day, addRuns) {
    return { key: sid + '|' + day, slitterId: sid, day: day, addRuns: addRuns,
             addMin: addRuns * 7, donorCutId: 'd' + sid };
}

// ── A/B/D. ПРЕДУПРЕЖДЕНИЕ ГОВОРИТ РОВНО ТО, ЧТО НАЗВАЛ ВЕРДИКТ ───────────────────────────────
var verdict = [row(SID, 0, 6), row(SID2, 0, 3)];
var warn = stand(verdict);
var saidCount = warn.warnUnderfilledAfterSettle();
assert(saidCount >= 1 && warn.said.length === 1 && warn.said[0].kind === 'warning',
    'A. вердикт непустой — оператору сказано ровно один раз',
    'сообщений: ' + warn.said.length);
assert(warn.asked > 0,
    'D. предупреждение СПРАШИВАЕТ вердикт, а не считает само', 'обращений: ' + warn.asked);
var msg = (warn.said[0] || {}).msg || '';
assert(/1279/.test(msg) && /1282/.test(msg),
    'B. в тексте названы РОВНО те станко-дни, что в вердикте',
    '(' + msg.slice(0, 160) + ')');

// ── C/D. ВЫРАВНИВАНИЕ ИДЁТ ПО ТЕМ ЖЕ СТАНКАМ ────────────────────────────────────────────────
var lvl = stand(verdict);
lvl.levelOverfilledAfterWrite({ withinSlitterIds: [SID, SID2] }, true).then(function() {
    assert(String(lvl.levelled) === String([SID, SID2].sort()),
        'C. выравнивание берёт РОВНО те станки, что назвал вердикт',
        'пошли выравнивать: ' + JSON.stringify(lvl.levelled));
    assert(lvl.asked > 0,
        'D2. и выравнивание тоже СПРАШИВАЕТ вердикт', 'обращений: ' + lvl.asked);

    // ── E. ПУСТОЙ ВЕРДИКТ — ОДНО «НЕТ» НА ВСЕХ ──────────────────────────────────────────────
    var quietWarn = stand([]);
    var n = quietWarn.warnUnderfilledAfterSettle();
    assert(n === 0 && quietWarn.said.length === 0,
        'E. вердикт пуст — оператору не говорим ничего', 'сообщений: ' + quietWarn.said.length);
    var quietLvl = stand([]);
    return quietLvl.levelOverfilledAfterWrite({ withinSlitterIds: [SID, SID2] }, true).then(function() {
        assert(quietLvl.levelled === null,
            'E2. и выравнивание не запускается — то же «нет», что услышал оператор',
            'пошли выравнивать: ' + JSON.stringify(quietLvl.levelled));
    });
}).then(function() {
    // ── F. ОБЪЕКТИВ «УПОРЯДОЧИТЬ» — ДРУГОЙ ВОПРОС И ДРУГАЯ МЕРКА ────────────────────────────
    // Объектив сравнивает КАНДИДАТОВ между собой (`planUnderfilledDays`), а не отвечает «набит ли
    // день». Подмена вердикта оператора не должна двигать его число — иначе это снова одна мерка
    // на два разных вопроса, и «набит» опять начнёт значить разное.
    var BASE = new Date(2026, 7, 13, 0, 0, 0, 0).getTime();
    var D0 = Math.round(BASE / 1000) + 8 * 3600;
    function cut(id, day, runs) {
        return { id: id, slitter: { id: SID }, materialId: 'MW308', winding: 'OUT', batchId: 'BMW308',
                 knifeWidths: [59], knifeCount: 1, rollerWidth: 60, plannedRuns: runs, isFoil: false,
                 status: '', fixed: false, firstPartId: id, startDate: '', endDate: '',
                 planDate: String(D0 + day * 86400),
                 storedKnifeSetupMin: 0, storedMaterialWindingMin: 0, storedCutAndLeaderMin: runs * 10 };
    }
    function objective(verdictRows) {
        var s = stand(verdictRows);
        s.nowMs = function() { return BASE + 9 * 3600000; };
        s.cuts = [cut('a', 0, 5), cut('b', 1, 20)];   // день 0 полупустой — объективу есть что считать
        s.slitters = [{ id: SID }];
        s.workingWindow = function() {
            return { startMin: 480, cutEndMin: 970, endMin: 990, maxOverworkCutsMin: 5,
                     maxOverworkTuneMin: 10, lunchStartMin: 740, lunchDurationMin: 40 };
        };
        s.shiftClosedSlittersToday = function() { return {}; };
        s.blockedRangesBySlitter = function() { return {}; };
        return { n: s.planUnderfilledDays(s.cuts, null).length, asked: s.asked };
    }
    var withVerdict = objective(verdict);
    var withoutVerdict = objective([]);
    assert(withVerdict.n > 0,
        'F0. объектив на полупустом дне ДЕЙСТВИТЕЛЬНО что-то считает — иначе проверка ниже пуста',
        'станко-дней: ' + withVerdict.n);
    assert(withVerdict.n === withoutVerdict.n && withVerdict.asked === 0,
        'F. объектив «Упорядочить» считает СВОЕЙ меркой — вердикт оператора он даже не спрашивает',
        'с вердиктом: ' + withVerdict.n + ', без: ' + withoutVerdict.n
            + ', обращений к вердикту: ' + withVerdict.asked);

    console.log('\n' + passed + '/' + total + ' проверок прошло');
    if (passed !== total) process.exitCode = 1;
}).catch(function(err) {
    console.error('FAIL — исключение: ' + (err && err.stack || err));
    process.exitCode = 1;
});
