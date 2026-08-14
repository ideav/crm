// #4751 п.3 — ПАРОВОЗ ВЫВОЗИТ ЛИШНЕЕ, НО НЕ ВОЗВРАЩАЕТСЯ ЗА ОСВОБОДИВШЕЙСЯ ЁМКОСТЬЮ.
//
// СИМПТОМ (боевое 13.08.2026, ateh1, скриншот тикета). После «Урегулировать» на экране одновременно:
//   • Чт 13.08.2026 — «(405 мин)» при потолке 455, то есть 50 минут смены пусты;
//   • задание № 4 в этом же дне — «проходов 39 из 42, остальные 3 → 14.08»;
//   • тост «Не помещается в смену: Станок 3, Чт 13.08.2026 — до 17:23 при потолке 16:15 (+68 мин)…
//     Задания оставлены в своих днях — перенесите лишнее вручную или „Упорядочить“».
// Три прохода, которые не влезли, лежат назавтра, а место под них — в этом же дне. Один станок
// недобран, другой переполнен, и оператору сказано сделать руками то, ради чего кнопку и жали.
//
// ПРИЧИНА — СТРУКТУРНАЯ, А НЕ СЛУЧАЙНАЯ. Выравнивание идёт ПАРОВОЗОМ (`trainOnly`, #4732, решение
// заказчика 11.08.2026): порядок сохраняется, работа едет только ВПЕРЁД, набивка хвоста смены
// (#3739) выключена — назад не тянем. Значит один проход умеет ровно одно: вывезти лишнее из
// переполненного дня. Освободившуюся при этом ёмкость закрыть НЕЧЕМ — работа, которая в неё
// влезает, уже уехала вперёд, а тянуть её обратно тому же проходу запрещено. Второго прохода не
// бывает: `levelOverfilledAfterWrite` ставит флаг `_levelingDays`, и вложенный вызов (выравнивание
// пишет план тем же путём) выходит немедленно. Итог: КАЖДОЕ срабатывание паровоза оставляет за
// собой недогруз — ровно то, о чём issue #4751 п.3.
//
// РЕШЕНИЕ (ТЗ §15): ВЫРАВНИВАНИЕ ИДЁТ ДО СХОЖДЕНИЯ, А НЕ ОДНИМ ПРОХОДОМ. Долг плана меряем одним
// числом — минуты сверх потолка (DAY_CAPACITY #4467) плюс проходы недобора (DAY_FILL #4469), — и
// повторяем проход, пока долг СТРОГО УБЫВАЕТ. Не убыл — останавливаемся и честно предупреждаем
// (`warnOverfilledDays`), как и раньше: «разгрузить нечем» — законный ответ, цикл — нет.
// Флаг `_levelingDays` остаётся ровно тем, чем был: защитой от РЕКУРСИИ вложенной записи. Циклом
// управляет внешняя функция, поэтому «второй проход» и «рекурсия» больше не одно и то же.
//
// ЧТО ПРОВЕРЯЕМ:
//   A — воспроизведение: после первого прохода долг ОСТАЛСЯ (день недобран) — раньше на этом и
//       заканчивалось;
//   B — выравнивание делает второй проход и добирает освободившуюся ёмкость;
//   C — долг убывать перестал — останавливаемся (цикла нет), сколько бы дней ни было названо;
//   D — число проходов ограничено сверху даже при «убывающем» долге;
//   E — долг нулевой с самого начала — не делаем НИ ОДНОГО прохода (идемпотентность, #4652);
//   F — значение исходной операции наружу не подменяется (на него смотрят вызывающие, #4735);
//   G — недобор считается ТОЙ ЖЕ меркой, что и предупреждение (`plannerUnderfilledDays`), и с теми
//       же правами действия (`manualShift`, #4749) — иначе чиним не то, о чём говорим.
//
// Run with: node experiments/atex-pp-4751-level-converges.test.js

process.env.TZ = 'UTC';
global.window = { db: 'ateh1', xsrf: 'x' };
var Controller = require('../download/atex/js/production-planning.js').Controller;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

var SID = '1279', SID2 = '1282';

// Стенд: план описан ДОЛГОМ по проходам выравнивания. Каждый вызов levelDayLoad съедает
// очередное состояние — так стенд повторяет боевую последовательность, не таща за собой упаковщик.
//   states — [{ over: {sid: минутСверхПотолка}, under: {sid: проходовНедобора} }, …]
function stand(states, opts) {
    var self = Object.create(Controller.prototype);
    var step = 0;
    self.calls = [];              // что именно звали выравнивать
    self.underOpts = [];          // с какими правами спрашивали недобор
    self.slitters = [{ id: SID }, { id: SID2 }];
    self.cuts = [];
    function cur() { return states[Math.min(step, states.length - 1)] || { over: {}, under: {} }; }
    self.overfilledDaysOf = function(sid) {
        var min = Number((cur().over || {})[String(sid)]) || 0;
        return min > 0 ? [{ dayOffset: 0, overMin: min, capMin: 455 }] : [];
    };
    self.plannerUnderfilledDays = function(o) {
        self.underOpts.push(o || null);
        var out = [];
        Object.keys(cur().under || {}).forEach(function(sid) {
            var runs = Number(cur().under[sid]) || 0;
            if (runs > 0) out.push({ key: sid + '|0', slitterId: sid, day: 0, addRuns: runs, addMin: runs * 7, donorCutId: '684571' });
        });
        return out;
    };
    self.levelDayLoad = function(sids) {
        self.calls.push(sids.slice().sort().join(','));
        step++;
        return Promise.resolve(true);
    };
    self.warnOverfilledDays = function() {};
    for (var k in (opts || {})) self[k] = opts[k];
    return self;
}

// ── A/B. ВТОРОЙ ПРОХОД ДОБИРАЕТ ОСВОБОДИВШУЮСЯ ЁМКОСТЬ ─────────────────────────────────────
// Боевая последовательность: было +68 мин сверх потолка; проход 1 лишнее вывез — и оставил день
// недобранным на 3 прохода (те самые «остальные 3 → 14.08»); проход 2 их забирает обратно.
var live = stand([
    { over: { '1282': 68 }, under: {} },        // до выравнивания: станок 1282 за потолком
    { over: {}, under: { '1279': 3 } },         // после прохода 1: лишнее вывезено, день недобран
    { over: {}, under: {} }                     // после прохода 2: план сошёлся
]);
assert(live.overfilledDaysOf(SID2).length === 1 && live.plannerUnderfilledDays().length === 0,
    'A0. воспроизведение: до выравнивания станок за потолком, недобора ещё нет');

live.levelOverfilledAfterWrite({ withinSlitterIds: [SID, SID2] }, true).then(function(res) {
    assert(live.calls.length >= 2,
        'B. выравнивание идёт ДО СХОЖДЕНИЯ — за освободившейся ёмкостью паровоз возвращается',
        'проходов: ' + live.calls.length + ' — ' + JSON.stringify(live.calls));
    assert(live.calls[0] === '1282' && live.calls[1] === '1279',
        'B2. проход 1 разгружает переполненный станок, проход 2 добирает недобранный',
        JSON.stringify(live.calls));
    assert(live.overfilledDaysOf(SID2).length === 0 && live.plannerUnderfilledDays().length === 0,
        'B3. по выходе долга не осталось: ни перебора, ни недобора');
    assert(res === true,
        'F. значение исходной операции наружу не подменяется', 'res=' + JSON.stringify(res));

    // ── G. МЕРКА НЕДОБОРА — ТА ЖЕ, ЧТО У ПРЕДУПРЕЖДЕНИЯ, И С ТЕМИ ЖЕ ПРАВАМИ ────────────────
    var shift = { '1279': { fromTs: 1 } };
    var withRights = stand([{ over: {}, under: { '1279': 2 } }, { over: {}, under: {} }]);
    return withRights.levelOverfilledAfterWrite({ withinSlitterIds: [SID], manualShift: shift }, true)
        .then(function() {
            assert(withRights.underOpts.length > 0
                   && withRights.underOpts.every(function(o) { return o && o.manualShift === shift; }),
                'G. недобор спрашивается с правами действия на КАЖДОМ проходе (#4749)',
                JSON.stringify(withRights.underOpts.map(function(o) { return !!(o && o.manualShift); })));
        });
}).then(function() {
    // ── C. ДОЛГ НЕ УБЫВАЕТ — ОСТАНАВЛИВАЕМСЯ ────────────────────────────────────────────────
    // «Разгрузить нечем» (в дне одни 🔒 по одному проходу, проход неделим) — законный ответ.
    // Цикл здесь недопустим: до #4751 от него защищал флаг, теперь — мерка долга.
    var stuck = stand([{ over: { '1282': 68 }, under: { '1279': 3 } }]);   // состояние не меняется
    var warned = 0;
    stuck.warnOverfilledDays = function() { warned++; };
    return stuck.levelOverfilledAfterWrite({ withinSlitterIds: [SID, SID2] }, true).then(function() {
        assert(stuck.calls.length >= 1 && stuck.calls.length <= 3,
            'C. долг перестал убывать — выравнивание останавливается, а не крутится',
            'проходов: ' + stuck.calls.length);
    });
}).then(function() {
    // ── D. ПОТОЛОК ЧИСЛА ПРОХОДОВ ───────────────────────────────────────────────────────────
    // Долг «убывает» на единицу бесконечно: без верхнего предела одно нажатие оператора
    // превратилось бы в десятки сессий записи (ровно симптом #4732).
    var many = [];
    for (var i = 60; i > 0; i--) many.push({ over: { '1282': i }, under: {} });
    var slow = stand(many);
    return slow.levelOverfilledAfterWrite({ withinSlitterIds: [SID2] }, true).then(function() {
        assert(slow.calls.length <= 4,
            'D. число проходов ограничено сверху — одно нажатие не превращается в десятки сессий',
            'проходов: ' + slow.calls.length);
    });
}).then(function() {
    // ── E. ДОЛГА НЕТ — НИ ОДНОГО ПРОХОДА ────────────────────────────────────────────────────
    var clean = stand([{ over: {}, under: {} }]);
    return clean.levelOverfilledAfterWrite({ withinSlitterIds: [SID, SID2] }, true).then(function(res) {
        assert(clean.calls.length === 0,
            'E. план уже плотен — выравнивание не пишет ничего (идемпотентность, #4652)',
            'проходов: ' + clean.calls.length);
        assert(res === true, 'E2. и значение исходной операции возвращается как есть');
    });
}).then(function() {
    console.log('\n' + passed + '/' + total + ' проверок прошло');
    if (passed !== total) process.exitCode = 1;
}).catch(function(err) {
    console.error('FAIL — исключение: ' + (err && err.stack || err));
    process.exitCode = 1;
});
