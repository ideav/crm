// #4353 — пульт слиттера: у ОЖИДАЮЩЕГО задания были доступны все кнопки («✓ Готово»,
// «✓✓ Готовы все», «Наладка», «Перерыв», «Прекратить», «Пропуск»), хотя предыдущее задание
// дня ещё не закрыто. В списке слева то же задание при этом честно помечено «ожидает предыдущую».
//
// Корень: у таблицы 1078 «Задание в производство» нет реквизита «Дата план» — это ГЛАВНОЕ
// значение записи (r[0], DATETIME). loadCuts берёт его с фолбэком `|| row[0]`, а loadCut
// (открытая резка) — нет, поэтому у currentCut «Дата план» всегда пустая. Проверка «задание
// будущего дня» (#4332 п.4) сравнивала dateKey(planDate) с выбранным днём: пусто → Infinity →
// «не этот день» → блокировка снималась с ЛЮБОГО открытого ожидающего задания.
//
// Фикс: принадлежность очереди дня определяется по СОСТАВУ очереди (id), а не сравнением дат;
// loadCut заполняет planDate главным значением записи (как loadCuts).
//
// Run with: node experiments/atex-slitter-4353.test.js

process.env.TZ = 'Europe/Moscow';
var api = require('../download/atex/js/slitter.js');
var Controller = api.Controller;
var core = api.core;

var passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}

var DAY = '2026-07-24';
function stamp(dayISO, hhmm) {
    return String(Math.floor(new Date(dayISO + 'T' + hhmm + ':00+03:00').getTime() / 1000));
}

// Очередь из скриншота тикета: 4 задания одного станка на 24.07, все «Ожидает».
function makeInst() {
    var inst = Object.create(Controller.prototype);
    inst.selectedSlitterId = 'm1';
    inst.selectedDate = DAY;
    inst.cuts = [
        { id: '1', slitterId: 'm1', planDate: stamp(DAY, '08:00'), status: 'Ожидает' },
        { id: '2', slitterId: 'm1', planDate: stamp(DAY, '09:48'), status: 'Ожидает' },
        { id: '3', slitterId: 'm1', planDate: stamp(DAY, '10:06'), status: 'Ожидает' },
        { id: '4', slitterId: 'm1', planDate: stamp(DAY, '10:24'), status: 'Ожидает' },
        // задание БУДУЩЕГО дня — вне очереди выбранного дня (секция «Следующее задание», #4332 п.4)
        { id: '9', slitterId: 'm1', planDate: stamp('2026-07-25', '08:00'), status: 'Ожидает' }
    ];
    return inst;
}

// ── очередь дня: первое открытое задание свободно, остальные ожидающие заблокированы ──────────
var inst = makeInst();
assert(inst.isCutLocked(inst.cuts[0]) === false, '#4353: первое открытое задание дня — НЕ заблокировано');
assert(inst.isCutLocked(inst.cuts[1]) === true, '#4353: второе ожидающее задание дня — заблокировано');
assert(inst.isCutLocked(inst.cuts[3]) === true, '#4353: последнее ожидающее задание дня — заблокировано');

// ── открытая резка (currentCut из loadCut): «Дата план» может быть пустой — блокировка остаётся ──
var opened = { id: '2', slitterId: 'm1', planDate: '', status: 'Ожидает' };
assert(inst.isCutLocked(opened) === true,
    '#4353: открытое ожидающее задание БЕЗ «Даты план» всё равно заблокировано (кнопок нет)');

// ── #4332 п.4 сохраняется: задание будущего дня очередью дня не блокируется ────────────────────
assert(inst.isCutLocked(inst.cuts[4]) === false,
    '#4353: задание будущего дня (вне очереди дня) — НЕ заблокировано (#4332 п.4)');

// ── текущее закрыто (выполнено / пропущено) → блокировка переходит к следующему ────────────────
var doneInst = makeInst();
doneInst.cuts[0].status = 'Завершена';
assert(doneInst.isCutLocked(doneInst.cuts[1]) === false,
    '#4353: предыдущее ВЫПОЛНЕНО → следующее задание свободно');
assert(doneInst.isCutLocked(doneInst.cuts[2]) === true,
    '#4353: третье задание всё ещё ждёт второе');

var skipInst = makeInst();
skipInst.cuts[0].status = 'Пропущена';
assert(skipInst.isCutLocked(skipInst.cuts[1]) === false,
    '#4353: предыдущее ПРОПУЩЕНО → следующее задание свободно');

// ── начатое (Наладка/В работе/Перерыв) держит очередь: следующее ожидающее заблокировано ───────
['Наладка', 'В работе', 'Перерыв'].forEach(function(st) {
    var i = makeInst();
    i.cuts[0].status = st;
    assert(i.isCutLocked(i.cuts[1]) === true,
        '#4353: предыдущее в статусе «' + st + '» (не закрыто) → следующее заблокировано');
});

// ── действие на заблокированном задании не проходит (кнопка недоступна и по клику) ─────────────
var guard = makeInst();
guard.currentCut = { id: '2', slitterId: 'm1', planDate: '', status: 'Ожидает' };
guard.busy = false;
guard.notes = [];
guard.posts = [];
guard.notify = function(msg) { this.notes.push(msg); };
guard.post = function(path, params) { this.posts.push({ path: path, params: params }); return Promise.resolve({}); };
guard.meta = { cut: { id: '1078', reqs: [{ id: '1161', val: 'Начато' }, { id: '1162', val: 'В работе' }] } };
guard.eventDateTime = function() { return '2026-07-24 09:48:00'; };
guard.cutAction('Наладка', { setStarted: true, setInWork: true });
assert(guard.notes.indexOf('Резка заблокирована очередью') !== -1 && guard.posts.length === 0,
    '#4353: cutAction на заблокированном задании — отказ, запись не идёт');

// ── loadCut: «Дата план» = главное значение записи (реквизита с таким именем в 1078 нет) ───────
// Реквизиты — реальные имена таблицы 1078 (ateh); «Дата план» среди них отсутствует.
var cutMeta = { id: '1078', reqs: [
    { id: '1156', val: 'Слиттер' }, { id: '95358', val: 'Вид сырья' }, { id: '1161', val: 'Начато' },
    { id: '1162', val: 'В работе' }, { id: '16403', val: 'Кол-во резок план' },
    { id: '1164', val: 'Счётчик нач.' }, { id: '1166', val: 'Счётчик кон.' },
    { id: '15018', val: 'Партия сырья' }, { id: '16411', val: 'Закончено' },
    { id: '24305', val: 'Метраж, м' }, { id: '28144', val: 'Тип намотки' }
] };
var planStamp = stamp(DAY, '09:48');
var loader = Object.create(Controller.prototype);
loader.meta = { cut: cutMeta };
loader.getJson = function() {
    return Promise.resolve([{ i: '2', r: [planStamp, '1282:Станок 3', '2208:MWR113L', '', '', '10',
        '', '', '74925:1781038800', '', '1000.00', 'OUT'] }]);
};
loader.loadCut('2').then(function() {
    assert(loader.currentCut.planDate === planStamp,
        '#4353: loadCut заполняет «Дата план» главным значением записи (r[0])');
    assert(core.dateKey(loader.currentCut.planDate) === core.dateKey(DAY),
        '#4353: день открытой резки совпадает с выбранным днём');

    console.log('\n' + passed + '/' + total + ' assertions passed');
    if (passed !== total) process.exitCode = 1;
});
