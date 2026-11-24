// rules: none (defect #5690)
// PSA (демо-копия, ideav/backlogram#986): настраиваемые опции демо. Для каждой опции проверка «при значении X расчёт или правило даёт Y».
const test = require('node:test');
const assert = require('node:assert');
const C = require('../download/psa/js/psa-core.js');

const emp = (name, o) => Object.assign({ name, fte: 1, cost: 1000, grade: 'middle', pool: 'Разработка' }, o || {});
const bk = (id, e, project, from, to, hpw, o) => Object.assign({ id, emp: e, project, from, to, hpw, kind: 'Мягкая', status: 'Подтверждена' }, o || {});
const rules = (o) => C.applySettings(C.DEFAULT_RULES, C.parseSettings(o || {}));
const W1 = '2026-12-07', W1END = '2026-12-11';

test('справочник опций: у каждой опции код, группа, подсказка и значение по умолчанию из её вариантов', () => {
    const codes = C.SETTING_DEFS.map(d => d.code);
    assert.strictEqual(new Set(codes).size, codes.length);
    ['unit', 'limit', 'overbook', 'overbookWeeks', 'hardBan', 'route', 'pmScope', 'finView'].forEach(c => assert.ok(codes.includes(c), c));
    C.SETTING_DEFS.forEach(d => {
        assert.ok(d.group && d.title && d.hint && d.when, d.code);
        if (d.type === 'choice') assert.ok(d.options.some(o => o[0] === d.def), d.code);
    });
});

test('разбор опций: пустое значение даёт умолчания, мусор и выход за границы заменяются умолчанием', () => {
    const s = C.parseSettings({});
    assert.deepStrictEqual([s.unit, s.limit, s.overbook, s.overbookWeeks, s.hardBan, s.route, s.pmScope, s.finView], ['pct', 100, 110, 2, true, 'pool', 'all', 'fin_pmo']);
    const t = C.parseSettings({ unit: 'hours', limit: '90', overbook: '125', overbookWeeks: '0', hardBan: 'no', route: 'committee', pmScope: 'own', finView: 'leaders' });
    assert.deepStrictEqual([t.unit, t.limit, t.overbook, t.overbookWeeks, t.hardBan, t.route, t.pmScope, t.finView], ['hours', 90, 125, 0, false, 'committee', 'own', 'leaders']);
    const bad = C.parseSettings({ unit: 'дни', limit: 'abc', overbook: '-5', route: 'x', pmScope: '', finView: 'all' });
    assert.deepStrictEqual([bad.unit, bad.limit, bad.overbook, bad.route, bad.pmScope, bad.finView], ['pct', 100, 110, 'pool', 'all', 'fin_pmo']);
    assert.strictEqual(C.parseSettings({ limit: '120', overbook: '100' }).overbook, 120, 'допуск овербукинга не ниже лимита');
});

test('единица планирования: ввод в % ставки переводится в часы по ставке занятости, в часах - без изменений', () => {
    const full = emp('A'), half = emp('B', { fte: 0.5 });
    assert.strictEqual(C.fromInput(full, 50, 'pct'), 20);
    assert.strictEqual(C.fromInput(half, 50, 'pct'), 10);
    assert.strictEqual(C.fromInput(half, 50, 'hours'), 50);
    assert.strictEqual(C.toInput(half, 10, 'pct'), 50);
    assert.strictEqual(C.toInput(half, 10, 'hours'), 10);
});

test('единица планирования: ячейка карты показывает % или часы плана', () => {
    const e = emp('A'), list = [bk('1', 'A', 'P', W1, W1END, 50)];
    const l = C.loadWeek(e, W1, list, {}, []);
    assert.strictEqual(C.loadLabel(l, 'pct'), '125');
    assert.strictEqual(C.loadLabel(l, 'hours'), '50');
    const away = C.loadWeek(e, W1, [], {}, [{ from: W1, to: W1END }]);
    assert.strictEqual(C.loadLabel(away, 'hours'), 'отп');
    assert.strictEqual(C.loadLabel({ base: 0 }, 'pct'), '–');
});

test('единица планирования: сообщение проверки брони говорит в выбранных единицах', () => {
    const e = emp('A'), nb = bk('n', 'A', 'P', W1, W1END, 60, { status: 'Запрошена' });
    const pct = C.checkBooking(e, nb, [], {}, [], rules({ unit: 'pct' }));
    const hrs = C.checkBooking(e, nb, [], {}, [], rules({ unit: 'hours' }));
    assert.match(pct.errors[0], /Перегрузка 150%/);
    assert.match(hrs.errors[0], /60 ч из 40 ч/);
    assert.ok(!/150%/.test(hrs.errors[0]));
});

test('допуск овербукинга: 120% при допуске 110 - ошибка, при допуске 130 - предупреждение, при лимите 120 - чисто', () => {
    const e = emp('A'), nb = bk('n', 'A', 'P', W1, W1END, 48, { status: 'Запрошена' });
    const strict = C.checkBooking(e, nb, [], {}, [], rules({ overbook: '110' }));
    assert.strictEqual(strict.ok, false);
    const loose = C.checkBooking(e, nb, [], {}, [], rules({ overbook: '130' }));
    assert.strictEqual(loose.ok, true);
    assert.strictEqual(loose.warnings.length, 1);
    assert.match(loose.warnings[0], /допустимый овербукинг до 130%/);
    const lim = C.checkBooking(e, nb, [], {}, [], rules({ limit: '120', overbook: '130' }));
    assert.strictEqual(lim.ok, true);
    assert.strictEqual(lim.warnings.length, 0);
});

test('порог перегрузки меняет цвет ячейки тепловой карты', () => {
    const e = emp('A'), l = C.loadWeek(e, W1, [bk('1', 'A', 'P', W1, W1END, 44)], {}, []);
    assert.strictEqual(C.loadClass(l, rules({ limit: '100', overbook: '110' })), 'warn');
    assert.strictEqual(C.loadClass(l, rules({ limit: '100', overbook: '105' })), 'crit');
    assert.strictEqual(C.loadClass(l, rules({ limit: '120', overbook: '130' })), 'high');
});

test('недель подряд: 3 недели по 105% - ошибка при допуске 2, чисто при 3 и при 0 (без ограничения)', () => {
    const e = emp('A'), nb = bk('n', 'A', 'P', '2026-12-07', '2026-12-25', 42, { status: 'Запрошена' });
    const r2 = C.checkBooking(e, nb, [], {}, [], rules({ overbookWeeks: '2' }));
    assert.ok(r2.errors.some(x => /дольше 2 недель подряд/.test(x)));
    assert.strictEqual(C.checkBooking(e, nb, [], {}, [], rules({ overbookWeeks: '3' })).ok, true);
    assert.strictEqual(C.checkBooking(e, nb, [], {}, [], rules({ overbookWeeks: '0' })).ok, true);
});

test('запрет второй жёсткой брони: включён - ошибка, выключен - решает только допуск овербукинга', () => {
    const e = emp('A'), ex = [bk('1', 'A', 'P1', W1, W1END, 40, { kind: 'Жёсткая' })];
    const nb = bk('n', 'A', 'P2', W1, W1END, 4, { kind: 'Жёсткая', status: 'Запрошена' });
    const on = C.checkBooking(e, nb, ex, {}, [], rules({ hardBan: 'yes' }));
    assert.ok(on.errors.some(x => /вторая жёсткая бронь/.test(x)));
    const off = C.checkBooking(e, nb, ex, {}, [], rules({ hardBan: 'no' }));
    assert.strictEqual(off.ok, true);
    const offOver = C.checkBooking(e, bk('n', 'A', 'P2', W1, W1END, 20, { kind: 'Жёсткая', status: 'Запрошена' }), ex, {}, [], rules({ hardBan: 'no' }));
    assert.strictEqual(offOver.ok, false, 'допуск овербукинга действует и без запрета');
});

test('маршрут согласования: шаги по вариантам', () => {
    assert.deepStrictEqual(C.approvalSteps('pool').map(s => s.key), ['pool']);
    assert.deepStrictEqual(C.approvalSteps('pool_emp').map(s => s.key), ['pool', 'emp']);
    assert.deepStrictEqual(C.approvalSteps('committee').map(s => s.key), ['pool', 'pmo']);
    assert.deepStrictEqual(C.approvalSteps('мусор').map(s => s.key), ['pool']);
});

test('маршрут согласования: подписи идут по порядку, статус Подтверждена только после последней', () => {
    let r = C.signStep('pool_emp', '', 'pool');
    assert.deepStrictEqual([r.done, r.signed, r.next && r.next.key], [false, 'pool', 'emp']);
    r = C.signStep('pool_emp', r.signed, 'emp');
    assert.deepStrictEqual([r.done, r.signed, r.next], [true, 'pool,emp', null]);
    assert.strictEqual(C.signStep('pool', '', 'pool').done, true);
    assert.strictEqual(C.signStep('committee', '', 'pmo').error !== undefined, true, 'комитет: PMO не раньше руководителя пула');
    r = C.signStep('committee', 'pool', 'pmo');
    assert.strictEqual(r.done, true);
    assert.strictEqual(C.signStep('committee', 'pool', 'pool').error !== undefined, true, 'повторная подпись');
    assert.deepStrictEqual(C.approvalProgress('committee', 'pool'), { done: 1, total: 2, text: '1 из 2: ждём PMO' });
});

test('маршрут согласования: кто может подписать шаг', () => {
    const POOL = 'Руководитель ресурсного пула', PMO = 'Руководитель PMO', PM = 'Руководитель проекта', DIR = 'Директор';
    assert.strictEqual(C.canSign('pool', 'pool', POOL), true);
    assert.strictEqual(C.canSign('pool', 'pool', PMO), true, 'в простом маршруте PMO подменяет руководителя пула');
    assert.strictEqual(C.canSign('committee', 'pool', PMO), false, 'в комитете PMO подписывает только за PMO');
    assert.strictEqual(C.canSign('committee', 'pmo', PMO), true);
    assert.strictEqual(C.canSign('committee', 'pmo', POOL), false);
    assert.strictEqual(C.canSign('pool_emp', 'emp', POOL), true);
    assert.strictEqual(C.canSign('pool', 'pool', PM), false);
    assert.strictEqual(C.canSign('pool', 'pool', DIR), false);
});

test('видимость проектов для руководителя проекта: все или только свои; остальные роли видят все', () => {
    const PM = 'Руководитель проекта', projects = [{ name: 'A', pmLogin: 'pm' }, { name: 'B', pmLogin: 'other' }, { name: 'C', pmLogin: 'pm' }];
    assert.deepStrictEqual(C.visibleProjects(projects, PM, 'pm', 'all').map(p => p.name), ['A', 'B', 'C']);
    assert.deepStrictEqual(C.visibleProjects(projects, PM, 'pm', 'own').map(p => p.name), ['A', 'C']);
    assert.deepStrictEqual(C.visibleProjects(projects, 'Руководитель PMO', 'pmo', 'own').map(p => p.name), ['A', 'B', 'C']);
    const bookings = [{ project: 'A' }, { project: 'B' }];
    assert.deepStrictEqual(C.visibleBookings(bookings, projects, PM, 'pm', 'own').map(b => b.project), ['A']);
    assert.strictEqual(C.visibleBookings(bookings, projects, PM, 'pm', 'all').length, 2);
});

test('финансовая часть: кому видны ставки и маржа по варианту опции', () => {
    const R = { dir: 'Директор', pmo: 'Руководитель PMO', pool: 'Руководитель ресурсного пула', pm: 'Руководитель проекта', fin: 'Финансовый директор' };
    const who = v => Object.keys(R).filter(k => C.canSeeMoney(R[k], v));
    assert.deepStrictEqual(who('finance'), ['dir', 'fin']);
    assert.deepStrictEqual(who('fin_pmo'), ['dir', 'pmo', 'fin']);
    assert.deepStrictEqual(who('leaders'), ['dir', 'pmo', 'pool', 'pm', 'fin']);
});

test('роль из шаблона приходит в любом регистре («Руководитель pmo»): ключ роли определяется без учёта регистра', () => {
    assert.strictEqual(C.roleKey('Руководитель pmo'), 'pmo');
    assert.strictEqual(C.roleKey('руководитель ресурсного пула'), 'pool');
    assert.strictEqual(C.canSign('committee', 'pmo', 'Руководитель pmo'), true);
    assert.strictEqual(C.canSeeMoney('Руководитель pmo', 'fin_pmo'), true);
    assert.strictEqual(C.canSeeMoney('Руководитель pmo', 'finance'), false);
});
