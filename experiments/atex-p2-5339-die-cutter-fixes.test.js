// ideav/crm#5339 — Фаза 2 atex: дефекты пульта высечки по итогам прокликивания (#5332).
//
// Что проверяется (ядро download/atex-p2/js/die-cutter.js):
//   D2. мастер-рулон, зарезервированный под задание (ссылка «Задание высечки» у рулона), пульт
//       берёт, если в задании поле «Мастер-рулон» пусто; без рулона съём не открывается молча —
//       предлагается выбор рулона (подходящие по формату свободные + резерв задания), выбранный
//       пишется в задание и в резерв рулона; оператора не блокируют наглухо («без рулона» — явный выбор;
//   D4. рулонов в партии ГП за съём = ручьи × floor(метраж съёма / длина ролика), длина ролика =
//       этикеток в рулоне × (раппорт вала / этикеток на раппорте) / 1000; нет данных — прежнее
//       поведение (ручьи) и предупреждение;
//   D3. «Простой» (минуты — в числовом поле события «Длительность, мин») и «Смена мастер-рулона»;
//   D5. сообщение об успехе после перечитывания данных: кнопки к этому времени уже обновлены;
//   D6. единый формат метража; D7. без «Съёмов план» не пишем «из 0».
//
// Run with: node experiments/atex-p2-5339-die-cutter-fixes.test.js

process.env.TZ = 'UTC';
var fs = require('fs');
var path = require('path');

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}
function has(name) { return typeof DC[name] === 'function'; }

var mod = require('../download/atex-p2/js/die-cutter.js');
var DC = mod.core;
var NOW = Date.UTC(2026, 10, 1, 9, 0, 0) / 1000;

function job(o) {
    var base = { id: '1', start: NOW, status: 'Запланировано', pullsPlan: 5, pullsFact: 0, footage: 1000, setup: 30,
        machineId: 'M1', dieId: 'D1', dieNo: '1247', streams: 4, cylinderId: 'C96', cylinder: '96',
        rollId: '', roll: '', rollLength: 0, rollRest: '', rollFormat: 0, order: '3257',
        labelWidth: 58, labelLength: 40, labelsPerRoll: 1000, material: 'Бумага' };
    Object.keys(o || {}).forEach(function(k) { base[k] = o[k]; });
    return base;
}
function roll(o) {
    var base = { id: 'R1', no: 'МР-0001', format: 330, length: 2000, rest: 2000, status: 'на складе', material: 'Бумага', reserveTaskId: '' };
    Object.keys(o || {}).forEach(function(k) { base[k] = o[k]; });
    return base;
}

// ── D2. Резерв мастер-рулона ────────────────────────────────────────────────
(function() {
    assert(has('applyReservedRolls'), 'D2: есть applyReservedRolls (задание без рулона берёт рулон своего резерва)');
    if (!has('applyReservedRolls')) return;
    var rolls = [
        roll({ id: 'R5', no: 'МР-0005', reserveTaskId: '1', rest: 1500, length: 2000, format: 335, status: 'початый' }),
        roll({ id: 'R3', no: 'МР-0003', reserveTaskId: '1', rest: 0, status: 'израсходован' }),
        roll({ id: 'R4', no: 'МР-0004', reserveTaskId: '2' })
    ];
    var jobs = DC.applyReservedRolls([job({ id: '1' }), job({ id: '2', rollId: 'R9', roll: 'МР-0009', rollRest: '700' }), job({ id: '3' })], rolls);
    assert(jobs[0].rollId === 'R5' && jobs[0].roll === 'МР-0005' && jobs[0].rollRest === '1500' && jobs[0].rollLength === 2000 && jobs[0].rollFormat === 335,
        'D2: резерв «Задание высечки» → рулон задания (номер, остаток, длина, формат), израсходованный резерв пропущен');
    assert(jobs[0].rollSource === 'reserve', 'D2: источник рулона помечен «резерв» (при съёме запишется в задание)');
    assert(jobs[1].rollId === 'R9' && !jobs[1].rollSource, 'D2: рулон, записанный в самом задании, не заменяется резервом');
    assert(jobs[2].rollId === '' && DC.needsRoll(jobs[2]), 'D2: нет ни рулона, ни резерва — задание «без рулона» (needsRoll)');
    assert(!DC.needsRoll(jobs[0]), 'D2: рулон из резерва — выбирать не нужно');
    var two = DC.applyReservedRolls([job({ id: '1' })], [roll({ id: '8', reserveTaskId: '1' }), roll({ id: '6', reserveTaskId: '1' })]);
    assert(two[0].rollId === '6', 'D2: два рулона в резерве — берётся младший по id');
})();

(function() {
    assert(has('rollCandidates'), 'D2: есть rollCandidates (рулоны для выбора)');
    if (!has('rollCandidates')) return;
    var j = job({ id: '1', rollId: 'R1' });
    var die = { minFormat: 330 };
    var rolls = [
        roll({ id: 'R1', no: 'текущий' }),
        roll({ id: 'R2', no: 'свободный-330', format: 330 }),
        roll({ id: 'R3', no: 'свободный-345', format: 345 }),
        roll({ id: 'R4', no: 'узкий', format: 320 }),
        roll({ id: 'R5', no: 'широкий-346', format: 346 }),
        roll({ id: 'R6', no: 'чужой-резерв', reserveTaskId: '9' }),
        roll({ id: 'R7', no: 'моя-резервация', reserveTaskId: '1', format: 340 }),
        roll({ id: 'R8', no: 'пустой', rest: 0, status: 'израсходован' }),
        roll({ id: 'R9', no: 'брак', status: 'брак' }),
        roll({ id: 'R10', no: 'другое-сырьё', material: 'Плёнка' })
    ];
    var list = DC.rollCandidates(j, rolls, die, 15);
    assert(list.map(function(r) { return r.id; }).join() === 'R7,R2,R3',
        'D2: кандидаты — свои резервы, затем свободные подходящего формата [мин, мин+допуск] и сырья; чужой резерв, пустые, брак, текущий — нет', list.map(function(r) { return r.id; }).join());
    var any = DC.rollCandidates(j, rolls, null, 15);
    assert(any.some(function(r) { return r.id === 'R4'; }) && any.every(function(r) { return r.id !== 'R6' && r.id !== 'R8'; }),
        'D2: у ножа нет минимального формата — формат не фильтруется, свободных по-прежнему только не занятые');
})();

(function() {
    var open = DC.jobActions({ done: false, shiftOpen: true, setupOpen: false, stale: false });
    assert(open.indexOf('roll') >= 0 && open.indexOf('idle') >= 0, 'D3: смена открыта — есть «Смена мастер-рулона» и «Простой»');
    var closed = DC.jobActions({ done: false, shiftOpen: false, setupOpen: false, stale: false });
    assert(closed.indexOf('roll') < 0 && closed.indexOf('idle') < 0, 'D3: смена закрыта — ни «Простоя», ни смены рулона');
    var done = DC.jobActions({ done: true, shiftOpen: true, setupOpen: false, stale: false });
    assert(done.indexOf('roll') < 0 && done.indexOf('idle') < 0, 'D3: задание выполнено — ни «Простоя», ни смены рулона');
    assert(DC.WRITE_ACTIONS.indexOf('roll') >= 0 && DC.WRITE_ACTIONS.indexOf('idle') >= 0, 'D3: «Простой» и «Смена рулона» — пишущие действия (закрытая смена их не даёт)');
})();

(function() {
    assert(has('rollAssignFields'), 'D2/D3: есть rollAssignFields (поля записи выбора рулона)');
    if (!has('rollAssignFields')) return;
    var t = { dieJob: { id: 'TJ', reqs: { masterRoll: '137' } }, masterRoll: { id: 'TM', reqs: { reserveTask: '638' } } };
    var f = DC.rollAssignFields(t, job({ id: '77' }), roll({ id: 'R2' }));
    assert(f.job['t137'] === 'R2' && f.roll['t638'] === '77', 'выбор рулона: в задании «Мастер-рулон» = рулон, у рулона «Задание высечки» = задание');
    var f2 = DC.rollAssignFields({ dieJob: t.dieJob, masterRoll: { id: 'TM', reqs: {} } }, job({ id: '77' }), roll({ id: 'R2' }));
    assert(f2.job['t137'] === 'R2' && Object.keys(f2.roll).length === 0, 'нет колонки резерва у рулона — пишется только задание');
})();

(function() {
    var s = DC.eventParams({ id: 'TE', reqs: { type: '1', duration: '9' } }, { now: 100, typeId: 'T', minutes: null, duration: 25 });
    assert(s['t9'] === '25', 'D3: «Простой» — минуты пишутся в числовое поле «Длительность, мин» события');
    var s2 = DC.eventParams({ id: 'TE', reqs: { type: '1', setupMinutes: '8' } }, { now: 100, typeId: 'T', minutes: 12 });
    assert(s2['t8'] === '12' && !('t9' in s2), 'минуты наладки по-прежнему в «Длительность наладки, мин»');
    assert(has('idleMinutes') && DC.idleMinutes('25') === 25 && DC.idleMinutes('12,6') === 13 && DC.idleMinutes('0') === 0 && DC.idleMinutes('abc') === 0,
        'D3: минуты простоя — целые, мусор и ноль → 0 (запись отклоняется)');
    assert(has('idleState') && DC.idleState([
        { jobId: '1', type: 'Простой', duration: 25 }, { jobId: '1', type: 'Простой', duration: 10 },
        { jobId: '1', type: 'Брак', duration: 0 }, { jobId: '2', type: 'Простой', duration: 99 }
    ], '1').minutes === 35, 'D3: простой задания — сумма «Длительности» его событий «Простой»');
})();

// ── D4. Рулонов в партии ГП ─────────────────────────────────────────────────
(function() {
    assert(has('rollLengthM'), 'D4: есть rollLengthM');
    if (!has('rollLengthM')) return;
    // 1000 этикеток × (100 мм / 2 на раппорте) = 50 000 мм = 50 м
    assert(DC.rollLengthM(1000, 100, 2) === 50, 'D4: длина ролика = этикеток в рулоне × (раппорт / этикеток на раппорте) / 1000, м');
    assert(DC.rollLengthM(0, 100, 2) === 0 && DC.rollLengthM(1000, 0, 2) === 0 && DC.rollLengthM(1000, 100, 0) === 0, 'D4: нет любого из трёх чисел — длина 0 (данных нет)');

    var j = job({ streams: 4, rollLenM: 50 });
    var r = DC.rollsPerPull(j, 200);
    assert(r.rolls === 16 && !r.warn, 'D4: съём 200 м, ролик 50 м, 4 ручья → 4 × floor(4) = 16 рулонов', JSON.stringify(r));
    assert(DC.rollsPerPull(j, 199).rolls === 12, 'D4: неполный ролик не считается: floor(199/50) = 3 → 12');
    var f = DC.rollsPerPull(job({ streams: 4 }), 200);
    assert(f.rolls === 4 && /данн/i.test(f.warn), 'D4: нет данных для длины ролика — прежнее число (ручьи) и предупреждение', JSON.stringify(f));
    var tiny = DC.rollsPerPull(j, 30);
    assert(tiny.rolls === 4 && !!tiny.warn, 'D4: метраж съёма меньше ролика — прежнее число (ручьи) и предупреждение');

    var p = DC.takeoffPlan(j, [j], [], [], 2, 200);
    assert(p.ok && p.gps.length === 2 && p.gps.every(function(g) { return g.rolls === 16; }), 'D4: takeoffPlan — партия ГП каждого съёма по 16 рулонов');
    assert(Array.isArray(p.warnings) && p.warnings.length === 0, 'D4: данные есть — предупреждений нет');
    var p2 = DC.takeoffPlan(job({ streams: 4 }), [], [], [], 1, 200);
    assert(p2.gps[0].rolls === 4 && p2.warnings.length === 1, 'D4: данных нет — партия по ручьям и одно видимое предупреждение в плане');
    // Хвост: партия ГП съёма, записанного раньше, считается от метража ЭТОГО съёма, а не от нового.
    var runs = [{ id: 'r1', date: NOW, meters: 100, kind: 'вырубка', jobId: '1', dieId: 'D1' }];
    var tail = DC.takeoffPlan(job({ streams: 4, rollLenM: 50, status: 'В работе' }), [], runs, [], 0, 0);
    assert(tail.gps.length === 1 && tail.gps[0].rolls === 8, 'D4: дописывание хвоста — рулоны по метражу записанного съёма (100 м → 2 × 4 = 8)', JSON.stringify(tail.gps));
    // Расчёт ролика для задания по ножу и валу
    assert(has('jobRollLength') && DC.jobRollLength(job({ cylinderId: 'C96', dieId: 'D1', labelsPerRoll: 1000 }),
        [{ id: 'D1', labelsPerRepeat: 2, cylinderId: 'C0' }], [{ id: 'C96', repeat: 100 }]) === 50, 'D4: длина ролика задания — раппорт вала задания, этикеток на раппорте ножа');
    assert(DC.jobRollLength(job({ cylinderId: '', dieId: 'D1', labelsPerRoll: 1000 }),
        [{ id: 'D1', labelsPerRepeat: 2, cylinderId: 'C0' }], [{ id: 'C0', repeat: 100 }]) === 50, 'D4: в задании вала нет — вал ножа');
})();

// ── D5. Сообщение после перечитывания ───────────────────────────────────────
(function() {
    var order = [];
    var fake = {
        busy: false,
        message: function(text, kind) { order.push('message:' + kind + ':' + text); },
        reload: function() { order.push('reload'); return Promise.resolve(); }
    };
    return mod.AtexDieCutter.prototype.run.call(fake, function() { order.push('work'); return Promise.resolve(); }, 'Наладка начата.').then(function() {
        var iReload = order.indexOf('reload');
        var iOk = order.indexOf('message:ok:Наладка начата.');
        assert(iReload >= 0 && iOk > iReload, 'D5: «Наладка начата» показывается ПОСЛЕ перечитывания данных (кнопки уже обновлены)', order.join(' | '));
        assert(fake.busy === false, 'D5: после работы пульт снова свободен');
    });
})().then(function() {
    // ── D6/D7 ───────────────────────────────────────────────────────────────
    assert(has('fmtM'), 'D6: есть fmtM (единый формат метража)');
    if (has('fmtM')) {
        assert(DC.fmtM(1418) === '1 418' && DC.fmtM(1418.5) === '1 418,5', 'D6: 1418 → «1 418», 1418.5 → «1 418,5» — один формат с пробелом тысяч и запятой');
        assert(DC.fmtM(1418.04) === '1 418' && DC.fmtM(0.25) === '0,3' && DC.fmtM('') === '0', 'D6: до десятых, целые без «,0»');
    }
    assert(has('pullsCaption'), 'D7: есть pullsCaption');
    if (has('pullsCaption')) {
        var noPlan = DC.pullsCaption({ done: 0, plan: 0, complete: false }, false);
        assert(!/из\s*0/.test(noPlan) && /1/.test(noPlan), 'D7: нет «Съёмов план» — «Съём 1» без «из 0»', noPlan);
        assert(/из\s*5/.test(DC.pullsCaption({ done: 2, plan: 5, complete: false }, false)), 'D7: план есть — «Съём 3 из 5»');
        assert(!/из\s*0/.test(DC.pullsCaption({ done: 3, plan: 0, complete: false }, true)), 'D7: задание закрыто без плана — «Съёмов 3» без «из 0»');
        assert(DC.pullsCount({ done: 2, plan: 0 }) === 'съёмов 2' && DC.pullsCount({ done: 2, plan: 5 }) === 'съёмов 2 из 5', 'D7: карточка очереди — «съёмов 2» / «съёмов 2 из 5»');
    }

    // ── Декларация схемы ────────────────────────────────────────────────────
    var schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'atex_phase2_schema.json'), 'utf8'));
    var ev = schema.tables.filter(function(t) { return t.name === 'Событие смены высечки'; })[0];
    var dur = ev && ev.fields.filter(function(f) { return f.name === 'Длительность, мин'; })[0];
    assert(!!dur && dur.type === 'NUMBER', 'D3: в декларации «Событие смены высечки» есть числовое поле «Длительность, мин»');

    console.log('\n' + passed + '/' + total + ' проверок пройдено.');
});
