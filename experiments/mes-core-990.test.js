// MES-демо (backlogram#990): поведенческие проверки расчётов цеха в download/mes/js/mes-core.js.
// rules: none (demo)
// Запуск: node experiments/mes-core-990.test.js
'use strict';
const assert = require('assert');
const path = require('path');
const C = require(path.join(__dirname, '..', 'download', 'mes', 'js', 'mes-core.js'));

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('ok   ' + name); } catch (e) { fail++; console.log('FAIL ' + name + '\n     ' + e.message); } }
const R = C.DEFAULT_RULES;
const STEPS = [
    { product: 'Шкаф', op: 'Раскрой', step: 1, norm: 18 }, { product: 'Шкаф', op: 'Кромка', step: 2, norm: 22 }, { product: 'Шкаф', op: 'Присадка', step: 3, norm: 16 },
    { product: 'Шкаф', op: 'Сборка', step: 4, norm: 45 }, { product: 'Шкаф', op: 'Упаковка', step: 5, norm: 10 }, { product: 'Столешница', op: 'Раскрой', step: 1, norm: 6 }
];
const OPSEC = { 'Раскрой': 'Раскрой', 'Кромка': 'Раскрой', 'Присадка': 'Присадка', 'Сборка': 'Сборка', 'Упаковка': 'Сборка' };

t('заказ раскладывается на маршрут: пять операций на трёх участках, в конец очереди каждого', () => {
    const ts = C.routeTasks({ no: 'ЗП-00438', product: 'Шкаф', qty: 12 }, STEPS, OPSEC, { 'Раскрой': 7, 'Сборка': 3 });
    assert.deepStrictEqual(ts.map(x => x.op), ['Раскрой', 'Кромка', 'Присадка', 'Сборка', 'Упаковка']);
    assert.deepStrictEqual(ts.map(x => x.queue), [8, 9, 1, 4, 5]);
    assert.strictEqual(new Set(ts.map(x => x.section)).size, 3);
    assert.strictEqual(ts[0].no, 'СЗ-00438-1');
    assert.ok(ts.every(x => x.plan === 12 && x.state === 'Ожидает'));
});

t('доступно на операции: годные предыдущей минус обработанное; брак выше по маршруту уменьшает вход', () => {
    const t1 = { no: 'a1', plan: 20 }, t2 = { no: 'a2', plan: 20 };
    const prog = C.progress([{ task: 'a1', good: 15, bad: 1 }, { task: 'a2', good: 6, bad: 1 }]);
    assert.strictEqual(C.available(t1, null, prog), 4);
    assert.strictEqual(C.available(t2, t1, prog), 8);
    assert.strictEqual(C.available({ no: 'a3', plan: 20 }, t2, prog), 6);
});

t('отметка на терминале: нельзя больше доступного, брак без виновника, дробные и пустые штуки', () => {
    assert.deepStrictEqual(C.checkMark({ good: 20, bad: 1, culprit: 'Материал', avail: 21 }), []);
    assert.ok(C.checkMark({ good: 20, bad: 2, culprit: 'Материал', avail: 21 })[0].includes('доступно 21'));
    assert.ok(C.checkMark({ good: 5, bad: 1, culprit: '', avail: 10 })[0].includes('по чьей вине'));
    assert.strictEqual(C.checkMark({ good: 2.5, bad: 0, avail: 10 }).length, 1);
    assert.ok(C.checkMark({ good: '', bad: '', avail: 10 })[0].includes('выпуск или брак'));
    assert.strictEqual(C.checkMark({ good: -1, bad: 0, avail: 10 }).length, 1);
});

t('простой: нужна причина, целые минуты, не длиннее смены', () => {
    assert.deepStrictEqual(C.checkDown({ reason: 'Нет материала', mins: 30 }), []);
    assert.strictEqual(C.checkDown({ reason: '', mins: 30 }).length, 1);
    assert.strictEqual(C.checkDown({ reason: 'Нет материала', mins: 0 }).length, 1);
    assert.strictEqual(C.checkDown({ reason: 'Нет материала', mins: 500, shiftMin: 480 }).length, 1);
});

t('перестановка в очереди: поднять последнее первым, меняются только сдвинутые места', () => {
    const q = [{ no: 'A', queue: 1 }, { no: 'B', queue: 2 }, { no: 'C', queue: 3 }, { no: 'D', queue: 4 }];
    assert.deepStrictEqual(C.reorder(q, 'D', 1), [{ no: 'D', queue: 1 }, { no: 'A', queue: 2 }, { no: 'B', queue: 3 }, { no: 'C', queue: 4 }]);
    assert.deepStrictEqual(C.reorder(q, 'B', 3), [{ no: 'C', queue: 2 }, { no: 'B', queue: 3 }]);
    assert.deepStrictEqual(C.reorder(q, 'A', 1), []);
    assert.deepStrictEqual(C.reorder([{ no: 'A', queue: 10 }, { no: 'B', queue: 14 }], 'B', 1), [{ no: 'B', queue: 1 }, { no: 'A', queue: 2 }]);
});

t('прогноз выхода: горящий заказ в конце очереди не успевает, после подъёма первым — успевает', () => {
    const cap = { 'Раскрой': C.capacity(5, R), 'Присадка': C.capacity(3, R), 'Сборка': C.capacity(4, R) };
    const other = [{ no: 'X1', order: 'X', section: 'Раскрой', queue: 1 }, { no: 'X2', order: 'X', section: 'Раскрой', queue: 2 }];
    const rem = { X1: 3000, X2: 2500 };
    const steps = STEPS.slice(0, 5).map(s => ({ section: OPSEC[s.op], step: s.step, qty: 12, norm: s.norm, queue: s.step === 1 ? 3 : 0 }));
    const late = C.forecast({ order: 'H', today: '2026-11-26', due: '2026-11-27', steps, tasks: other, rem, cap });
    assert.strictEqual(late.late, true, 'в конце очереди: ' + late.finish);
    assert.ok(late.finish > '2026-11-27');
    const steps2 = steps.map(s => Object.assign({}, s, { queue: s.step === 1 ? 1 : 0 }));
    const ok = C.forecast({ order: 'H', today: '2026-11-26', due: '2026-11-27', steps: steps2, tasks: other.map((x, i) => Object.assign({}, x, { queue: i + 2 })), rem, cap });
    assert.strictEqual(ok.late, false, 'первым: ' + ok.finish);
});

t('прогноз пропускает выходные: пятница + 2 рабочих дня = вторник', () => {
    assert.strictEqual(C.addWorkdays('2026-11-27', 2), '2026-12-01');
    assert.strictEqual(C.addWorkdays('2026-11-28', 0), '2026-11-30');
    const f = C.forecast({ order: 'H', today: '2026-11-27', due: '2026-11-30', steps: [{ section: 'S', step: 1, qty: 100, norm: 40 }], tasks: [], rem: {}, cap: { S: 1632 } });
    assert.strictEqual(f.finish, '2026-12-01'); assert.strictEqual(f.late, true);
});

t('горящий заказ: до срока ≤ 2 рабочих дней или срок прошёл; выпущенный не горит', () => {
    assert.strictEqual(C.isHot('2026-11-27', '2026-11-26', R, false), true);
    assert.strictEqual(C.isHot('2026-11-20', '2026-11-26', R, false), true);
    assert.strictEqual(C.isHot('2026-12-08', '2026-11-26', R, false), false);
    assert.strictEqual(C.isHot('2026-11-27', '2026-11-26', R, true), false);
});

t('расценка: своя для изделия важнее общей, берётся действующая на дату отметки', () => {
    const rates = [{ op: 'Сборка', product: '', price: 200, from: '2026-01-01' }, { op: 'Сборка', product: 'Шкаф', price: 324, from: '2026-09-01' }, { op: 'Сборка', product: 'Шкаф', price: 350, from: '2026-11-20' }];
    assert.strictEqual(C.rateFor(rates, 'Сборка', 'Шкаф', '2026-11-10'), 324);
    assert.strictEqual(C.rateFor(rates, 'Сборка', 'Шкаф', '2026-11-25'), 350);
    assert.strictEqual(C.rateFor(rates, 'Сборка', 'Комод', '2026-11-25'), 200);
    assert.strictEqual(C.rateFor(rates, 'Упаковка', 'Шкаф', '2026-11-25'), 0);
});

t('брак по ст. 156 ТК: не по вине рабочего — как годные, по его вине — не оплачивается', () => {
    assert.strictEqual(C.markPay({ good: 20, bad: 1, culprit: 'Материал' }, 100, R).total, 2100);
    const own = C.markPay({ good: 20, bad: 1, culprit: 'Рабочий' }, 100, R);
    assert.strictEqual(own.total, 2000); assert.strictEqual(own.badLoss, 100);
    assert.strictEqual(C.markPay({ good: 20, bad: 2, culprit: 'Рабочий' }, 100, Object.assign({}, R, { badShare: 0.5 })).total, 2100);
});

t('простой по ст. 157 ТК: организационный — 2/3 ставки, по вине рабочего — ноль', () => {
    assert.strictEqual(Math.round(C.downPay({ mins: 90 }, 400, 'Организационная', R)), 400);
    assert.strictEqual(C.downPay({ mins: 90 }, 400, 'По вине рабочего', R), 0);
});

t('выработка за период: к выплате только принятое мастером, ожидающее и спорное отдельно', () => {
    const ctx = {
        marks: [
            { task: 'T1', worker: 'Иванов', date: '2026-11-25', good: 10, bad: 0, accept: 'Принято' },
            { task: 'T1', worker: 'Иванов', date: '2026-11-26', good: 5, bad: 1, culprit: 'Рабочий', accept: 'Ожидает' },
            { task: 'T1', worker: 'Иванов', date: '2026-11-24', good: 3, bad: 0, accept: 'Спор' },
            { task: 'T1', worker: 'Петров', date: '2026-11-26', good: 7, bad: 0, accept: 'Принято' },
            { task: 'T1', worker: 'Иванов', date: '2026-10-31', good: 99, bad: 0, accept: 'Принято' }],
        downs: [{ worker: 'Иванов', reason: 'Нет материала', date: '2026-11-26', mins: 60 }],
        taskBy: { T1: { op: 'Раскрой', product: 'Шкаф', norm: 18 } }, rates: [{ op: 'Раскрой', product: 'Шкаф', price: 130, from: '2026-09-01' }],
        workers: [{ name: 'Иванов', num: 'ТН-1', tariff: 450 }, { name: 'Петров', num: 'ТН-2', tariff: 400 }], reasonKind: { 'Нет материала': 'Организационная' }, rules: R, from: '2026-11-01', to: '2026-11-26'
    };
    const rows = C.earnings(ctx), iv = rows.find(r => r.worker === 'Иванов');
    assert.strictEqual(iv.paid, 1300); assert.strictEqual(iv.pending, 650); assert.strictEqual(iv.dispute, 390);
    assert.strictEqual(Math.round(iv.idlePay), 300); assert.strictEqual(Math.round(iv.total), 1600);
    assert.strictEqual(iv.badLoss, 130); assert.strictEqual(iv.normMin, (10 + 6 + 3) * 18);
    const only = C.earnings(Object.assign({}, ctx, { only: 'Петров' }));
    assert.strictEqual(only.length, 1); assert.strictEqual(only[0].paid, 910);
    const csv = C.onecRows(rows, ctx.workers, '01.11.2026–26.11.2026');
    assert.ok(csv[0].startsWith('Период;Табельный номер'));
    assert.ok(csv.some(l => l.includes('ТН-1;Иванов;Раскрой;Шкаф;18;130;')), csv.join('\n'));
    assert.ok(csv.some(l => l.includes('Оплата простоя')));
});

t('остаток работы по заказу: закрытый шаг не считается, брак на шаге уменьшает следующий', () => {
    const tasks = [{ no: 'a1', order: 'A', step: 1, plan: 10, state: 'Выполнено', norm: 10 }, { no: 'a2', order: 'A', step: 2, plan: 10, state: 'В работе', norm: 5 }, { no: 'a3', order: 'A', step: 3, plan: 10, state: 'Ожидает', norm: 2 }];
    const prog = C.progress([{ task: 'a1', good: 9, bad: 1 }, { task: 'a2', good: 4, bad: 1 }]);
    const rem = C.remainMinutes(tasks, prog);
    assert.strictEqual(rem.a1, 0); assert.strictEqual(rem.a2, (9 - 5) * 5); assert.strictEqual(rem.a3, 8 * 2);
});

t('правила цеха читаются из справочника по именам', () => {
    const r = C.parseRules([{ name: 'Оплата простоя не по вине рабочего, % ставки', value: '80' }, { name: 'Брак по вине рабочего, % расценки', value: '50' }, { name: 'Горящий заказ, рабочих дней до срока', value: '3' }]);
    assert.strictEqual(r.idleShare, 0.8); assert.strictEqual(r.badShare, 0.5); assert.strictEqual(r.hotDays, 3); assert.strictEqual(r.shiftMin, 480);
    assert.strictEqual(C.toIso('27.11.2026'), '2026-11-27'); assert.strictEqual(C.toRu('2026-11-27'), '27.11.2026');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
