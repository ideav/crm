// rules: none (demo)
// FSM (демо-копия, ideav/crm#5679): чистые функции расчёта времени, SLA, подбора инженера, KPI, акта и склада в машине.
const test = require('node:test');
const assert = require('node:assert');
const C = require('../download/fsm/js/fsm-core.js');

const T = (s) => C.parseDt(s);
const NOW = T('2026-11-23 11:05');

test('время: epoch сервера читается как московское, запись в формате API', () => {
    assert.strictEqual(C.fmtDt(C.parseDt('1795418100')), '23.11.2026 10:15');
    assert.strictEqual(C.toApi(T('2026-11-23 10:15')), '2026-11-23 10:15:00');
    assert.strictEqual(C.parseDt('23.11.2026 09:30'), T('2026-11-23 09:30'));
    assert.strictEqual(C.parseDt(''), 0);
});

test('SLA: до срока, риск за 30 минут, просрочка, итог по завершённому наряду', () => {
    const base = { status: 'Назначен', arr: 0, fin: 0, arrDue: T('2026-11-23 12:00'), finDue: T('2026-11-23 18:00') };
    assert.strictEqual(C.slaState(base, NOW).state, 'ok');
    assert.strictEqual(C.slaState(Object.assign({}, base, { arrDue: T('2026-11-23 11:25') }), NOW).state, 'risk');
    const late = C.slaState(Object.assign({}, base, { arrDue: T('2026-11-23 10:40') }), NOW);
    assert.strictEqual(late.state, 'late');
    assert.strictEqual(late.left, -25);
    assert.strictEqual(C.slaState(Object.assign({}, base, { status: 'На объекте', arr: T('2026-11-23 10:00') }), NOW).stage, 'finish');
    const done = { status: 'Закрыт', arr: T('2026-11-23 11:00'), fin: T('2026-11-23 12:00'), arrDue: T('2026-11-23 12:00'), finDue: T('2026-11-23 18:00') };
    assert.strictEqual(C.slaState(done, NOW).state, 'met');
    assert.strictEqual(C.slaState(Object.assign({}, done, { fin: T('2026-11-23 19:00') }), NOW).state, 'missed');
    assert.strictEqual(C.slaState({ status: 'Отменён' }, NOW).state, 'none');
});

test('расстояние и время в пути растут с удалением', () => {
    const near = C.haversine(55.789, 49.122, 55.795, 49.13), far = C.haversine(55.789, 49.122, 55.852, 49.088);
    assert.ok(near < far && near > 0);
    assert.ok(C.travelMin(far) > C.travelMin(near));
});

function ctx(extra) {
    const eng = (name, o) => Object.assign({ name, works: true, from: '08:00', to: '17:00', max: 6, district: 'Вахитовский', lat: 55.789, lon: 49.122, skills: [{ skill: 'Хладагент', until: '' }] }, o || {});
    return Object.assign({
        now: NOW, orders: [],
        objects: { 'Объект А': { lat: 55.795, lon: 49.13, district: 'Вахитовский' } },
        works: { 'Ремонт': { skill: 'Хладагент', norm: 2 } },
        engineers: [eng('Близкий'), eng('Далёкий', { lat: 55.852, lon: 49.088, district: 'Авиастроительный' }), eng('Без навыка', { skills: [{ skill: 'Высота', until: '' }] }),
            eng('Допуск истёк', { skills: [{ skill: 'Хладагент', until: '2026-10-31' }] }), eng('В отпуске', { works: false }), eng('Занят')]
    }, extra || {});
}
const order = { id: 'o1', num: 'Н-1', obj: 'Объект А', wt: 'Ремонт', created: T('2026-11-23 10:30'), win0: T('2026-11-23 12:00'), win1: T('2026-11-23 14:00') };

test('подбор: ближайший свободный первым, навык и допуск, отпуск и занятость - блокеры', () => {
    const busy = { id: 'o2', num: 'Н-2', eng: 'Занят', status: 'Назначен', win0: T('2026-11-23 13:00'), win1: T('2026-11-23 15:00'), created: T('2026-11-23 09:00') };
    const r = C.rankEngineers(order, ctx({ orders: [busy] }));
    assert.strictEqual(r[0].eng, 'Близкий');
    assert.ok(r[0].ok && r[1].ok);
    assert.strictEqual(r[1].eng, 'Далёкий');
    const by = {}; r.forEach(x => { by[x.eng] = x; });
    assert.ok(!by['Без навыка'].ok && /нет навыка/.test(by['Без навыка'].blockers[0]));
    assert.ok(!by['Допуск истёк'].ok && /истёк/.test(by['Допуск истёк'].blockers[0]));
    assert.ok(!by['В отпуске'].ok);
    assert.ok(!by['Занят'].ok && /занят в окне/.test(by['Занят'].blockers[0]));
    assert.ok(by['Близкий'].km < by['Далёкий'].km);
});

test('подбор: лимит нарядов в день и закрытые наряды не занимают окно', () => {
    const many = [];
    for (let i = 0; i < 6; i++) many.push({ id: 'x' + i, num: 'Н-' + i, eng: 'Близкий', status: 'Назначен', win0: T('2026-11-23 08:00'), win1: T('2026-11-23 08:30'), created: T('2026-11-23 07:00') });
    const r = C.rankEngineers(order, ctx({ orders: many }));
    assert.ok(!r.filter(x => x.eng === 'Близкий')[0].ok);
    const closed = [{ id: 'c', num: 'Н-9', eng: 'Близкий', status: 'Закрыт', win0: T('2026-11-23 12:00'), win1: T('2026-11-23 14:00'), created: T('2026-11-23 09:00') }];
    assert.ok(C.rankEngineers(order, ctx({ orders: closed })).filter(x => x.eng === 'Близкий')[0].ok);
});

test('KPI: SLA, повторные, закрытые в день выезда', () => {
    const mk = (o) => Object.assign({ status: 'Закрыт', repeat: false, eng: 'А', created: T('2026-11-16 09:00'), arrDue: T('2026-11-16 12:00'), finDue: T('2026-11-17 09:00'), arr: T('2026-11-16 10:00'), fin: T('2026-11-16 12:00') }, o);
    const list = [mk({}), mk({}), mk({ arr: T('2026-11-16 13:00') }), mk({ repeat: true }), mk({ status: 'Отменён' })];
    const k = C.kpi(list, T('2026-11-16 00:00'), T('2026-11-23 00:00'), NOW);
    assert.strictEqual(k.total, 4);
    assert.strictEqual(k.met, 3);
    assert.strictEqual(k.missed, 1);
    assert.strictEqual(k.slaPct, 75);
    assert.strictEqual(k.repeatPct, 25);
    assert.strictEqual(k.sameDayPct, 100);
    const w = C.weekly(list, NOW, 2);
    assert.strictEqual(w.length, 2);
    assert.strictEqual(w[0].total, 4);
});

test('акт: итоги, гарантия обнуляет оплату; склад в машине уменьшается только по своему источнику', () => {
    const mats = [{ name: 'Фреон', qty: 0.5, price: 1450, src: 'Склад в машине' }, { name: 'Плата', qty: 1, price: 7800, src: 'Заказ поставщику' }];
    const t = C.actTotals({ price: 2200 }, mats, false);
    assert.strictEqual(t.mats, 725 + 7800);
    assert.strictEqual(t.total, 2200 + 725 + 7800);
    assert.strictEqual(C.actTotals({ price: 2200 }, mats, true).total, 0);
    const st = C.stockAfter([{ name: 'Фреон', qty: 2, min: 1.5 }, { name: 'Плата', qty: 3, min: 1 }], mats);
    assert.strictEqual(st[0].qty, 1.5);
    assert.strictEqual(st[0].low, false);
    assert.strictEqual(st[1].qty, 3);
    assert.strictEqual(C.stockAfter([{ name: 'Фреон', qty: 0.4, min: 1 }], mats)[0].short, true);
});

test('чек-лист и порядок статусов', () => {
    assert.deepStrictEqual(C.checkProgress([{ done: true }, { done: false }, { done: true }, { done: true }]), { done: 3, total: 4, pct: 75 });
    assert.strictEqual(C.nextStatus('Назначен'), 'В пути');
    assert.strictEqual(C.nextStatus('В пути'), 'На объекте');
    assert.strictEqual(C.nextStatus('Закрыт'), '');
});

test('сумма прописью: склонение рублей и тысяч', () => {
    assert.strictEqual(C.rubWords(12300), 'Двенадцать тысяч триста рублей 00 копеек');
    assert.strictEqual(C.rubWords(21000), 'Двадцать одна тысяча рублей 00 копеек');
    assert.strictEqual(C.rubWords(2001.5), 'Две тысячи один рубль 50 копеек');
});

test('KPI: время реакции не учитывает плановое ТО', () => {
    const o = (prio, arr) => ({ status: 'Закрыт', prio, eng: 'А', created: T('2026-11-16 09:00'), arrDue: T('2026-11-16 12:00'), finDue: T('2026-11-17 09:00'), arr: T(arr), fin: T('2026-11-16 12:00') });
    const k = C.kpi([o('Срочный', '2026-11-16 10:00'), o('Плановое ТО', '2026-11-18 10:00')], T('2026-11-16 00:00'), T('2026-11-23 00:00'), NOW);
    assert.strictEqual(k.reactMin, 60);
});
