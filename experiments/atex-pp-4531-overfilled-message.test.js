// Тесты: ideav/crm#4531 — «Зачем мне пишут эти непонятные красные сообщения? нет ни станка,
// ни деталей задания».
//
// СИМПТОМ (боевое, скриншот задачи): после записи плана в углу висит стопка одинаковых на вид
// предупреждений «Не помещается в смену: Пт, 31.07.2026 до 16:19 (+9 мин). Задания оставлены в
// своих днях…». Сообщений столько, сколько станков с переполненным днём (на скриншоте — три), и
// ни в одном не сказано ни какой это станок, ни какое задание в смену не влезло. Оператору
// показывают дату и минуты — то, что он и так видит в бейдже «(N мин)» шапки дня.
//
// ЧЕГО ЖДЁМ:
//   A — на все станки уходит ОДНО сообщение, а не по одному на станок;
//   B — в нём назван СТАНОК своей подписью («Станок 1»), а не только дата;
//   C — и НАЗВАНО ЗАДАНИЕ: номер в дне (как на карточке) + сырьё и размеры, плюс потолок смены,
//       с которым сравнивают;
//   D — детектор переполнения отдаёт виновника структурой (id задания и его номер в дне),
//       чтобы фразу собирал не он, а печать;
//   E — переполнения нет → молчим (не шумим на ровном месте, регресс-контроль #4497).
//
// Run with: node experiments/atex-pp-4531-overfilled-message.test.js

process.env.TZ = 'UTC';
global.window = { db: 'ateh', xsrf: 'x' };
var Controller = require('../download/atex/js/production-planning.js').Controller;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

// Смена как на стенде: 08:00–16:30, обед 12:20×40, буфер уборки 15 мин → потолок резки 16:15.
var DAY_SETTINGS = { DAY_START_HOUR: '08:00', DAY_END_HOUR: '16:30', LUNCH_START: '12:20',
    LUNCH_DURATION: '40', TOTAL_INTERVALS: '15' };
var DAY = [2026, 6, 31];   // 31.07.2026 (месяц — индекс)
function tsAt(hh, mm) { return Math.floor(new Date(DAY[0], DAY[1], DAY[2], hh, mm, 0, 0).getTime() / 1000); }

// Задание: планируемый старт окна + хранимые минуты занятости (то, что видит оператор в бейдже).
function cutOf(id, sid, hh, mm, occMin, over) {
    var c = { id: id, number: String(tsAt(hh, mm)), planDate: String(tsAt(hh, mm)),
        slitter: { id: sid, label: 'Станок ' + sid },
        materialId: '500', materialName: 'MW308', winding: 'IN',
        knifeWidths: [110, 110], knifeCount: 2, plannedRuns: 12, length: 450,
        storedKnifeSetupMin: occMin >= 45 ? '30' : '0',
        storedMaterialWindingMin: occMin >= 45 ? '15' : '0',
        storedCutAndLeaderMin: String(occMin >= 45 ? occMin - 45 : occMin) };
    for (var k in (over || {})) if (Object.prototype.hasOwnProperty.call(over, k)) c[k] = over[k];
    return c;
}

// Контроллер без DOM: нужны только состояние и прототипные методы (как в #4497-E).
function makeController(cuts) {
    var self = Object.create(Controller.prototype);
    self.cuts = cuts;
    self.slitters = [{ id: '101', label: 'Станок 1' }, { id: '202', label: 'Станок 2' },
                     { id: '303', label: 'Станок 3' }];
    self.filter = { slitter: '', status: '', date: '2026-07-31', dateTo: '2026-07-31', query: '' };
    self.daySettings = DAY_SETTINGS;
    self.changeTimes = {};
    self.meta = {};
    self.freezeByDay = {};
    self.notes = [];
    self.notify = function(msg, kind) { self.notes.push({ msg: msg, kind: kind }); };
    return self;
}

// Три станка, у каждого день переполнен: 08:00 (480 мин) + хвост в 16:00 (30 мин).
// #4559: числа уточнены — первое задание идёт СКВОЗЬ обед 12:20×40 и паузит на него в ходе
// намотки (#3816), поэтому день кончается не в 16:30, а в 17:10, и перебор над потолком 16:15 —
// +55 мин. Виновник прежний — ВТОРОЕ задание дня.
function overfilledOnAll() {
    var cuts = [];
    ['101', '202', '303'].forEach(function(sid) {
        cuts.push(cutOf('a-' + sid, sid, 8, 0, 480));
        cuts.push(cutOf('b-' + sid, sid, 16, 0, 30));
    });
    return cuts;
}

// ── A/B/C: ОДНО сообщение, со станком и заданием ────────────────────────────────────────────
(function () {
    var c = makeController(overfilledOnAll());
    var hit = c.reportOverfilledDays();
    assert(hit.join(',') === '101,202,303',
        '#4531-A: шлюз по-прежнему находит все станки с переполненным днём', '(' + hit.join(',') + ')');
    assert(c.notes.length === 1,
        '#4531-A: и говорит об этом ОДНИМ сообщением, а не по одному на станок',
        '(сообщений: ' + c.notes.length + ')');

    var text = (c.notes[0] || {}).msg || '';
    assert((c.notes[0] || {}).kind === 'warning', '#4531-A: вид сообщения — предупреждение');
    assert(text.indexOf('Не помещается в смену') === 0,
        '#4531-A: начало фразы прежнее — оператор узнаёт сообщение', '(' + text.slice(0, 40) + '…)');

    ['Станок 1', 'Станок 2', 'Станок 3'].forEach(function(label) {
        assert(text.indexOf(label) !== -1, '#4531-B: в сообщении назван «' + label + '»');
    });
    assert(text.indexOf('31.07.2026') !== -1, '#4531-B: и день, как раньше');

    assert(text.indexOf('№ 2') !== -1,
        '#4531-C: названо ЗАДАНИЕ — его номер в дне (как на карточке)', '(' + text + ')');
    assert(text.indexOf('MW308') !== -1,
        '#4531-C: и его сырьё — задание можно узнать в очереди');
    assert(text.indexOf('16:15') !== -1,
        '#4531-C: назван потолок смены, с которым сравнивают');
    assert(text.indexOf('17:10') !== -1 && text.indexOf('+55 мин') !== -1,
        '#4531-C: конец дня и перебор названы (обед сквозь намотку учтён, #4559)');
})();

// ── C2: много станко-дней — называем первые и НЕ замалчиваем остаток ─────────────────────────
(function () {
    var cuts = overfilledOnAll();
    // Четвёртый переполненный станко-день: тот же станок 101, следующий день фильтра.
    var c = makeController(cuts);
    c.filter.dateTo = '2026-08-01';
    cuts.push({ id: 'a-101-d2', number: String(tsAt(8, 0) + 86400), planDate: String(tsAt(8, 0) + 86400),
        slitter: { id: '101', label: 'Станок 1' }, materialId: '500', materialName: 'MR194',
        winding: 'OUT', knifeWidths: [90], knifeCount: 1, plannedRuns: 4, length: 600,
        storedKnifeSetupMin: '30', storedMaterialWindingMin: '15', storedCutAndLeaderMin: '480' });
    c.notes = [];
    c.reportOverfilledDays();
    var text = (c.notes[0] || {}).msg || '';
    assert(c.notes.length === 1, '#4531-C2: по-прежнему одно сообщение', '(' + c.notes.length + ')');
    assert(/…и ещё \d+/.test(text),
        '#4531-C2: остаток станко-дней назван числом, а не замолчан', '(' + text + ')');
})();

// ── D: детектор отдаёт ВИНОВНИКА структурой ─────────────────────────────────────────────────
(function () {
    var c = makeController(overfilledOnAll());
    var days = c.overfilledDaysOf('101');
    assert(days.length === 1, '#4531-D: переполненный день найден', '(' + days.length + ')');
    var d = days[0] || {};
    assert(String(d.cutId) === 'b-101',
        '#4531-D: виновник — задание, которым день кончается', '(' + d.cutId + ')');
    assert(d.seq === 2,
        '#4531-D: и его номер в дне — тот же, что на карточке', '(' + d.seq + ')');
    assert(Math.round(d.overMin) === 55 && Math.round(d.endMin) === 17 * 60 + 10,
        '#4531-D: минуты перебора и конец дня — с обедом сквозь намотку (#4559)',
        '(+' + d.overMin + ' мин, конец ' + d.endMin + ')');
    assert(Math.round(d.capMin) === 16 * 60 + 15,
        '#4531-D: потолок смены отдан рядом — фразе не надо считать его самой', '(' + d.capMin + ')');
})();

// ── E: переполнения нет → молчим ────────────────────────────────────────────────────────────
(function () {
    var c = makeController([cutOf('ok1', '101', 8, 0, 60), cutOf('ok2', '101', 9, 0, 60)]);
    var hit = c.reportOverfilledDays();
    assert(hit.length === 0 && c.notes.length === 0,
        '#4531-E: день в пределах смены — ни одного сообщения (регресс #4497)',
        '(станков ' + hit.length + ', сообщений ' + c.notes.length + ')');

    // Одиночный вызов с пути ручной перестановки (↑↓/«↻ Пересчитать наладку») тоже жив.
    var c2 = makeController(overfilledOnAll());
    var warned = c2.warnOverfilledDays('101');
    assert(warned.length === 1 && warned[0].overMin > 0 && c2.notes.length === 1,
        '#4531-E: вызов по ОДНОМУ станку работает как раньше (регресс #4408)',
        '(дней ' + warned.length + ', сообщений ' + c2.notes.length + ')');
    assert(((c2.notes[0] || {}).msg || '').indexOf('Станок 1') !== -1,
        '#4531-E: и в нём тоже назван станок');
})();

// ── F: печать фразы — ЧИСТАЯ функция, её можно звать без контроллера ────────────────────────
(function () {
    var P = require('../download/atex/js/production-planning.js').planning;
    assert(P.formatOverfilledDaysMessage([]) === null,
        '#4531-F: называть нечего → null (а не пустая фраза)');

    var one = P.formatOverfilledDaysMessage([{ slitterId: '7', dayOffset: 0, endMin: 990,
        overMin: 15, capMin: 975, seq: 3, cutLabel: 'MW308 IN — 450 х 12' }], {
        slitterLabel: function(id) { return 'Станок ' + id; },
        dayLabel: function() { return 'Пт, 31.07.2026'; },
        clock: function(m) { return String(Math.floor(m / 60)) + ':' + ('0' + (m % 60)).slice(-2); }
    });
    assert(one.rest === 0 && one.shown.length === 1, '#4531-F: один станко-день — один пункт');
    assert(one.text === 'Не помещается в смену: Станок 7, Пт, 31.07.2026 — до 16:30 при потолке 16:15'
        + ' (+15 мин), последнее задание № 3 «MW308 IN — 450 х 12». Задания оставлены в своих днях —'
        + ' перенесите лишнее вручную (🗓) или «Упорядочить».',
        '#4531-F: фраза целиком — место, мерка, виновник', '(' + one.text + ')');

    // Задание не опознано (нет seq/подписи) — фраза не ломается на «№undefined», место и мерка остаются.
    var bare = P.formatOverfilledDaysMessage([{ dayOffset: 2, endMin: 990, overMin: 15, capMin: 975 }]);
    assert(bare.text.indexOf('undefined') === -1 && bare.text.indexOf('задание') === -1,
        '#4531-F: без опознанного задания фраза остаётся осмысленной', '(' + bare.text + ')');

    // Подпись задания — как первая строка карточки.
    assert(P.cutShortLabel({ materialName: 'MW308', winding: 'in', length: 450, plannedRuns: 12 })
        === 'MW308 IN — 450 х 12', '#4531-F: подпись задания = сырьё, намотка, размеры');
})();

console.log('\n' + passed + '/' + total + ' проверок пройдено');
if (passed !== total) process.exitCode = 1;
