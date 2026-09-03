// #4861 — пульт втулкореза: окно плана «вчера · сегодня · ещё 2 заполненных дня».
//
// Пульт показывал ТОЛЬКО сегодняшний день: задания вчерашнего дня (не закрытые,
// потому что день кончился) и пропущенные впереди дни исчезали молча — боевое
// #4861: заказ 5098, задача которого стоит на вчерашнем дне, оператору не видна.
// Теперь ядро строит ОКНО дней: вчера и сегодня — всегда (даже пустые), дальше —
// следующие ЗАПОЛНЕННЫЕ дни (выходные и пустые дни пропускаются), не более двух.
//
// Run with: node experiments/atex-sleeve-cutter-4861.test.js

var mod = require('../download/atex/js/sleeve-cutter.js');
var core = mod.core;

var passed = 0, total = 0;
function assertEqual(actual, expected, name) {
    total++;
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name
        + (ok ? '' : ' (ожидалось ' + JSON.stringify(expected) + ', получено ' + JSON.stringify(actual) + ')'));
    if (ok) passed++; else process.exitCode = 1;
}

// Задание отчёта на 08:00 локального времени указанной даты (как пишет планирование).
function taskAt(iso, cutterId, qty) {
    var p = core.dayBoundsUnix(iso);
    return core.taskFromReportRow({
        task_id: String(1000 + p.start + (qty || 1)),
        task_date: String(p.start + 8 * 3600),
        cutter_id: cutterId || '2257',
        qty: String(qty || 1),
        fact: '', started: '', finished: ''
    });
}

var TODAY = '2026-09-03';   // четверг

// ── 1) сдвиг даты: каркас окна (месяц и год не ломаются) ──
assertEqual(core.shiftIso(TODAY, -1), '2026-09-02', '#4861 вчера от 03.09 — 02.09');
assertEqual(core.shiftIso(TODAY, 1), '2026-09-04', '#4861 завтра от 03.09 — 04.09');
assertEqual(core.shiftIso('2026-10-01', -1), '2026-09-30', '#4861 сдвиг через границу месяца');
assertEqual(core.shiftIso('2027-01-01', -1), '2026-12-31', '#4861 сдвиг через границу года');
assertEqual(core.shiftIso('мусор', 1), '', '#4861 некорректная дата — пусто, не падаем');

// ── 2) границы чтения отчёта: от вчерашней полуночи до конца горизонта ──
var bounds = core.windowBoundsUnix(TODAY, 14);
assertEqual(core.unixToLocalIso(bounds.start), '2026-09-02', '#4861 чтение начинается со вчерашней полуночи');
assertEqual(core.unixToLocalIso(bounds.end - 1), '2026-09-17', '#4861 чтение захватывает весь горизонт (вчера+14)');
assertEqual(bounds.end - bounds.start, 16 * 86400, '#4861 диапазон чтения — 16 суток (вчера + 14 вперёд + сегодня)');
assertEqual(core.windowBoundsUnix('мусор', 14), null, '#4861 некорректная дата — границ нет');

// ── 3) окно дней: вчера и сегодня всегда, дальше — заполненные ──
// Сценарий боевого тикета: вчера 3 задания (5098), сегодня 2, завтра выходной (пусто),
// через день — 4 задания, затем два пустых, на пятый — 5. Окно: вчера, сегодня,
// +2 дня, +5 дней (пустые пропущены, взято ровно 2 заполненных).
var tasks = []
    .concat([taskAt('2026-09-02', '2257', 140), taskAt('2026-09-02', '2257', 60), taskAt('2026-09-02', '2257', 5)])
    .concat([taskAt(TODAY, '2257', 10), taskAt(TODAY, '2257', 20)])
    .concat([taskAt('2026-09-05', '2257', 30), taskAt('2026-09-05', '2257', 40), taskAt('2026-09-05', '2257', 50), taskAt('2026-09-05', '2257', 60)])
    .concat([taskAt('2026-09-08', '2257', 70), taskAt('2026-09-08', '2257', 80), taskAt('2026-09-08', '2257', 90), taskAt('2026-09-08', '2257', 100)]);
var days = core.planDays(tasks, '2257', TODAY);
assertEqual(days, [
    { iso: '2026-09-02', filled: true },
    { iso: '2026-09-03', filled: true },
    { iso: '2026-09-05', filled: true },
    { iso: '2026-09-08', filled: true }
], '#4861 окно: вчера+сегодня всегда, дальше два заполненных дня без пустых');

// Вчера и сегодня пустые (выходной у втулкореза) — остаются в окне, дальше берём заполненные.
var weekend = core.planDays([taskAt('2026-09-05', '2257', 1), taskAt('2026-09-06', '2257', 1)], '2257', TODAY);
assertEqual(weekend, [
    { iso: '2026-09-02', filled: false },
    { iso: '2026-09-03', filled: false },
    { iso: '2026-09-05', filled: true },
    { iso: '2026-09-06', filled: true }
], '#4861 пустые вчера/сегодня остаются в окне; впереди берутся только заполненные');

// Заполненных дней впереди меньше двух — окно короче, дырку не рисуем.
var short = core.planDays([taskAt('2026-09-02', '2257', 1)], '2257', TODAY);
assertEqual(short, [
    { iso: '2026-09-02', filled: true },
    { iso: '2026-09-03', filled: false }
], '#4861 впереди нет заполненных — окно из вчера и сегодня');

// Чужой втулкорез в окно не попадает.
var otherCutter = core.planDays([taskAt('2026-09-05', '9999', 1)], '2257', TODAY);
assertEqual(otherCutter.length, 2, '#4861 задания чужого втулкореза день окна не заполняют');

// Горизонт поиска ограничен: заполненный день за горизонтом не растягивает окно.
var far = core.planDays([taskAt('2026-10-01', '2257', 1)], '2257', TODAY);
assertEqual(far.length, 2, '#4861 заполненный день за горизонтом поиска в окно не попадает');

// ── 4) подпись дня в заголовке группы ──
assertEqual(core.dayHeading(TODAY, TODAY), 'Сегодня, 03.09', '#4861 сегодняшний день подписан «Сегодня»');
assertEqual(core.dayHeading('2026-09-02', TODAY), 'Вчера, 02.09', '#4861 вчерашний день подписан «Вчера»');
assertEqual(core.dayHeading('2026-09-04', TODAY), 'пт, 04.09', '#4861 прочий день — день недели и дата');
assertEqual(core.dayHeading('мусор', TODAY), 'мусор', '#4861 нераспознанная дата — как есть');

// ── 5) подпись окна в шапке пульта ──
assertEqual(core.windowLabel(days), '02.09 – 08.09.2026',
    '#4861 окно в шапке: «ДД.ММ – ДД.ММ.ГГГГ», год один раз');
assertEqual(core.windowLabel([{ iso: TODAY }]), '03.09.2026', '#4861 один день — полная дата');
assertEqual(core.windowLabel([{ iso: '2026-12-30' }, { iso: '2027-01-02' }]), '30.12.2026 – 02.01.2027',
    '#4861 через новый год — обе даты с годом');
assertEqual(core.windowLabel([]), '', '#4861 пустое окно — пустая подпись');

// ── 6) заголовок пульта: период вместо одной даты, планшет и втулкорез на месте ──
assertEqual(core.workspaceTitleParts('Втулкорез-1', '02.09 – 08.09.2026', 'TC-20 (20–25 мм)'),
    ['Втулкорез-1', '02.09 – 08.09.2026', 'TC-20 (20–25 мм)'],
    '#4861 подпись пульта: планшет · период · втулкорез (период проходит как есть)');

// ── 7) РЕНДЕР: список группами по дням (DOM) ─────────────────────────────────────
// Минимальный DOM-стаб — как в atex-sleeve-cutter.test.js (#4786).
function DomNode(tag) {
    this.tagName = String(tag || '').toUpperCase();
    this.childNodes = [];
    this.attributes = {};
    this.style = {};
    this._className = '';
    this._text = '';
    this.value = '';
    var self = this;
    this.classList = {
        add: function(c) { if (self._cls().indexOf(c) === -1) self._className += ' ' + c; },
        remove: function(c) { self._className = self._cls().filter(function(x) { return x !== c; }).join(' '); },
        contains: function(c) { return self._cls().indexOf(c) !== -1; }
    };
}
DomNode.prototype._cls = function() { return this._className.split(/\s+/).filter(Boolean); };
Object.defineProperty(DomNode.prototype, 'className', {
    get: function() { return this._className; }, set: function(v) { this._className = String(v || ''); } });
Object.defineProperty(DomNode.prototype, 'textContent', {
    get: function() { return this.childNodes.length
        ? this.childNodes.map(function(c) { return c.textContent; }).join(' ') : this._text; },
    set: function(v) { this._text = String(v == null ? '' : v); this.childNodes = []; } });
Object.defineProperty(DomNode.prototype, 'innerHTML', {
    get: function() { return ''; },
    set: function() { this.childNodes = []; this._text = ''; } });
DomNode.prototype.appendChild = function(n) { this.childNodes.push(n); return n; };
DomNode.prototype.setAttribute = function(k, v) { this.attributes[k] = String(v); };
DomNode.prototype.addEventListener = function() {};
DomNode.prototype._all = function(acc) {
    this.childNodes.forEach(function(c) { acc.push(c); c._all(acc); }); return acc; };
DomNode.prototype.querySelectorAll = function(sel) {
    var cls = sel.replace(/^\./, '');
    return this._all([]).filter(function(n) { return n.classList.contains(cls); }); };
DomNode.prototype.querySelector = function(sel) { return this.querySelectorAll(sel)[0] || null; };

(function() {
    var savedDoc = global.document;
    global.document = { createElement: function(t) { return new DomNode(t); } };

    var inst = Object.create(mod.Controller.prototype);
    inst.selectedCutterId = '2257';
    inst.selectedDate = TODAY;
    inst.showDone = false;
    inst.missingCols = [];
    inst.tasks = tasks;   // те же задания: вчера 3 · сегодня 2 · +2 дня 4 · +5 дней 4
    var host = new DomNode('section');
    inst.tasksEl = host;

    inst.renderTasks();

    // Групп дня — ровно по окну (4), после верхней сводки.
    var daySections = host.querySelectorAll('.atex-sc-day');
    assertEqual(daySections.length, 4, '#4861 список — группами по дням окна');

    // Заголовки дней — в порядке окна, «Сегодня» на своём месте.
    // (05.09.2026 — суббота, 08.09 — вторник.)
    var titles = host.querySelectorAll('.atex-sc-day-title').map(function(n) { return n.textContent; });
    assertEqual(titles, ['Вчера, 02.09', 'Сегодня, 03.09', 'сб, 05.09', 'вт, 08.09'],
        '#4861 заголовки дней: вчера · сегодня · день недели с датой');

    // Нумерация плановая ВНУТРИ дня: у первого задания каждого дня № 1.
    daySections.forEach(function(section, i) {
        var num = section.querySelectorAll('.atex-sc-card-num')[0];
        assertEqual(num && num.textContent, '№ 1', '#4861 день ' + (i + 1) + ': нумерация дня начинается с № 1');
    });

    // «✓✓ Закрыть все» — по кнопке у каждого дня с незавершёнными заданиями.
    assertEqual(host.querySelectorAll('.atex-sc-summary-all').length, 4,
        '#4861 у каждого дня с живыми заданиями — своё «✓✓ Закрыть все»');

    // Пустой день (завтра, 04.09 — выходной) в окне НЕ показан вовсе: пропущен, а не дырка.
    assertEqual(host.textContent.indexOf('04.09'), -1,
        '#4861 пустой день пропущен — в списке нет его заголовка');

    // Полностью пустое окно: вчера и сегодня остаются с подписью «заданий нет».
    inst.tasks = [];
    host.innerHTML = '';
    inst.renderTasks();
    assertEqual(host.querySelectorAll('.atex-sc-day').length, 2, '#4861 без заданий окно — вчера и сегодня');
    assertEqual(host.querySelectorAll('.atex-sc-empty').length, 2,
        '#4861 пустой день говорит «заданий нет», а не исчезает');
    assertEqual(host.querySelectorAll('.atex-sc-summary-all').length, 0,
        '#4861 без заданий кнопок «Закрыть все» нет');

    global.document = savedDoc;
})();

console.log('\n' + passed + '/' + total + ' passed');
if (process.exitCode) process.exit(process.exitCode);
