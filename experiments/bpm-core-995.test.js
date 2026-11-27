// rules: none (defect #5759)
// BPM (демо-копия, ideav/backlogram#995): исполнение по событийной спецификации, неопределённость, похожие случаи,
// стороны одобрения правки, проверка спецификации, карта из журнала, замещение, повтор вызовов.
const test = require('node:test');
const assert = require('node:assert');
const C = require('../download/bpm/js/bpm-core.js');

function spec() {
    const st = (kind, exec, o) => Object.assign({ kind, proc: 'ДГ', exec, norm: 16 }, o || {});
    return {
        steps: {
            'Регистрация': st('Шаг', 'Инициатор', { start: true }), 'Юрист': st('Шаг', 'lawyer'), 'Бюджет': st('Шаг', 'economist'),
            'Валютный контроль': st('Шаг', 'treasury'), 'Финдиректор': st('Шаг', 'cfo'), 'Возврат': st('Шаг', 'Инициатор'), 'Подписан': st('Конечное', '')
        },
        transitions: [
            { from: 'Регистрация', to: 'Юрист', cond: '', proc: 'ДГ' },
            { from: 'Юрист', to: 'Бюджет', cond: 'Решение = Согласовано и Нерезидент = нет', proc: 'ДГ' },
            { from: 'Юрист', to: 'Возврат', cond: 'Решение = Возвращено', proc: 'ДГ' },
            { from: 'Бюджет', to: 'Финдиректор', cond: 'Решение = Согласовано и Сумма > 3000000', proc: 'ДГ' },
            { from: 'Бюджет', to: 'Подписан', cond: 'Решение = Согласовано и Сумма <= 3000000', proc: 'ДГ' },
            { from: 'Валютный контроль', to: 'Финдиректор', cond: 'Решение = Согласовано', proc: 'ДГ' },
            { from: 'Финдиректор', to: 'Подписан', cond: 'Решение = Согласовано', proc: 'ДГ' },
            { from: 'Возврат', to: 'Юрист', cond: 'Решение = Исправлено', proc: 'ДГ' }
        ]
    };
}
const resident = { nonres: 0, cur: 'RUB', sum: 2000000, kind: 'Поставка' };
const nonres = { nonres: 1, cur: 'CNY', sum: 6400000, kind: 'Поставка' };

test('условия: «и», сравнение чисел, ≠, регистр не важен, пустое условие проходит всегда', () => {
    const a = { 'Решение': 'согласовано', 'Сумма': 3500000, 'Валюта': 'USD' };
    assert.strictEqual(C.evalCond('Решение = Согласовано и Сумма > 3000000', a), true);
    assert.strictEqual(C.evalCond('Сумма <= 3000000', a), false);
    assert.strictEqual(C.evalCond('Валюта ≠ RUB', a), true);
    assert.strictEqual(C.evalCond('Валюта != USD', a), false);
    assert.strictEqual(C.evalCond('', a), true);
    assert.strictEqual(C.evalCond('мусор без оператора', a), false);
});

test('маршрут: резидент идёт по спецификации, нерезидент после юриста встаёт (неопределённость, а не ошибка)', () => {
    const S = spec();
    assert.strictEqual(C.route(S, 'Юрист', C.attrsOf(resident, 'Согласовано')).to, 'Бюджет');
    const r = C.route(S, 'Юрист', C.attrsOf(nonres, 'Согласовано'));
    assert.strictEqual(r.to, null);
    assert.strictEqual(r.stuck, true);
    assert.strictEqual(r.tried.length, 2);
    assert.strictEqual(C.route(S, 'Подписан', {}).stuck, false, 'конечное событие - не неопределённость');
    assert.strictEqual(C.route(S, 'Бюджет', C.attrsOf({ sum: 3000001, cur: 'RUB' }, 'Согласовано')).to, 'Финдиректор');
    assert.strictEqual(C.route(S, 'Бюджет', C.attrsOf({ sum: 3000000, cur: 'RUB' }, 'Согласовано')).to, 'Подписан');
});

test('решение по задаче: возврат и нестандартный случай без комментария не принимаются; нестандартный всегда к ответственному', () => {
    assert.deepStrictEqual(C.checkDecision('Согласовано', ''), []);
    assert.strictEqual(C.checkDecision('Возвращено', '').length, 1);
    assert.strictEqual(C.checkDecision('Нестандартный случай', 'ок').length, 1);
    assert.deepStrictEqual(C.checkDecision('Нестандартный случай', 'Поставщик просит аванс 50%'), []);
    assert.strictEqual(C.checkDecision('', '').length, 1);
    const p = C.plan(spec(), resident, 'Юрист', 'Нестандартный случай');
    assert.strictEqual(p.stuck, true);
    assert.strictEqual(p.manual, true);
    assert.strictEqual(C.plan(spec(), resident, 'Юрист', 'Согласовано').to, 'Бюджет');
});

test('похожие случаи: тот же шаг, сходство признаков, группировка по выбранному шагу, доли и средний простой', () => {
    const cases = [
        { req: 'A', step: 'Юрист', feat: 'Нерезидент = да; Валюта = CNY; Вид договора = Поставка', to: 'Валютный контроль', delay: 4, finished: 1 },
        { req: 'B', step: 'Юрист', feat: 'Нерезидент = да; Валюта = RUB; Вид договора = Поставка', to: 'Валютный контроль', delay: 2, finished: 1 },
        { req: 'C', step: 'Юрист', feat: 'Нерезидент = да; Валюта = RUB; Вид договора = Поставка', to: 'Финдиректор', delay: 5, finished: 1 },
        { req: 'D', step: 'Юрист', feat: 'Нерезидент = нет; Валюта = USD; Вид договора = Услуги', to: 'Возврат', delay: 1, finished: 0 },
        { req: 'E', step: 'Бюджет', feat: 'Нерезидент = да; Валюта = CNY; Вид договора = Поставка', to: 'Финдиректор', delay: 1, finished: 1 },
        { req: 'F', step: 'Юрист', feat: 'Нерезидент = да; Валюта = CNY; Вид договора = Поставка', to: '', delay: 0 }
    ];
    const v = C.variants(cases, 'Юрист', 'Нерезидент = да; Валюта = CNY; Вид договора = Поставка');
    assert.deepStrictEqual(v.map(x => x.to), ['Валютный контроль', 'Финдиректор'], 'чужой шаг, нерешённый и непохожий случаи не входят');
    assert.strictEqual(v[0].count, 2);
    assert.strictEqual(v[0].delay, 3);
    assert.ok(Math.abs(v[0].share - 2 / 3) < 1e-9);
    assert.deepStrictEqual(v[0].examples, ['A', 'B']);
    assert.ok(v[0].score > v[1].score);
});

test('правка из решения: переход из шага, где встала заявка, с условием по признаку случая; заявка-двойник после правки идёт сама', () => {
    const S = spec();
    const p = C.proposalFrom({ step: 'Юрист', feat: 'Нерезидент = да; Валюта = CNY; Вид договора = Поставка' }, 'Валютный контроль');
    assert.deepStrictEqual(p, { from: 'Юрист', to: 'Валютный контроль', cond: 'Решение = Согласовано и Нерезидент = да' });
    S.transitions.push(Object.assign({ proc: 'ДГ' }, p));
    assert.strictEqual(C.route(S, 'Юрист', C.attrsOf({ nonres: 1, cur: 'RUB', sum: 5200000 }, 'Согласовано')).to, 'Валютный контроль');
    assert.strictEqual(C.route(S, 'Юрист', C.attrsOf(resident, 'Согласовано')).to, 'Бюджет', 'резидента правка не задевает');
    assert.strictEqual(C.lint(S, 'ДГ').filter(i => i.kind === 'gap').length, 0, 'дыра «нерезидент после юриста» закрыта');
});

test('стороны одобрения: при передаче объекта три стороны, без передачи - две; один человек подписывает один раз', () => {
    const S = spec();
    assert.deepStrictEqual(C.sides({ from: 'Юрист', to: 'Валютный контроль', transfer: true }, S, 'owner').map(s => s.side + ':' + s.who),
        ['Передающая:lawyer', 'Принимающая:treasury', 'Владелец процесса:owner']);
    assert.deepStrictEqual(C.sides({ from: 'Бюджет', to: 'Подписан', transfer: false }, S, 'owner').map(s => s.side), ['Исполнитель шага', 'Владелец процесса']);
    assert.strictEqual(C.sides({ from: 'Юрист', to: 'Валютный контроль', transfer: true }, S, 'lawyer').length, 2);
    const st = C.approvalState([{ decision: 'Одобрено' }, { decision: 'Ждёт' }, { decision: 'Одобрено' }]);
    assert.strictEqual(st.approved, false);
    assert.strictEqual(st.waiting.length, 1);
    assert.strictEqual(C.approvalState([{ decision: 'Одобрено' }, { decision: 'Одобрено' }]).approved, true);
    assert.strictEqual(C.approvalState([{ decision: 'Одобрено' }, { decision: 'Отклонено' }]).rejected, true);
    assert.strictEqual(C.approvalState([]).approved, false);
});

test('проверка спецификации: переход в никуда, недостижимый шаг, тупик, нет продолжения, неоднозначность', () => {
    const S = spec();
    const kinds = C.lint(S, 'ДГ');
    assert.deepStrictEqual(kinds.filter(i => i.kind === 'gap').map(i => i.step), ['Юрист']);
    assert.ok(kinds.some(i => i.kind === 'unreachable' && i.step === 'Валютный контроль'));
    assert.ok(kinds.some(i => i.kind === 'deadEnd' && i.step === 'Возврат') === false, 'из возврата переход есть');
    S.transitions.push({ from: 'Финдиректор', to: 'ИТ-служба', cond: 'Решение = Согласовано и Сумма > 9000000', proc: 'ДГ' });
    S.steps['Архив'] = { kind: 'Шаг', proc: 'ДГ', exec: 'x' };
    S.transitions.push({ from: 'Юрист', to: 'Архив', cond: 'Решение = Архив', proc: 'ДГ' });
    const k2 = C.lint(S, 'ДГ');
    assert.ok(k2.some(i => i.kind === 'dangling' && /ИТ-служба/.test(i.text)));
    assert.ok(k2.some(i => i.kind === 'ambiguous' && i.step === 'Финдиректор'));
    assert.ok(k2.some(i => i.kind === 'deadEnd' && i.step === 'Архив'));
    delete S.steps['Подписан'];
    assert.ok(C.lint(S, 'ДГ').some(i => i.kind === 'noEnd'));
});

test('карта из журнала: частоты и время на шаге, ручной перевод вне спецификации помечен', () => {
    const ev = (req, date, time, code, from, to) => ({ req, date, time, code, from, to });
    const E = [
        ev('1', '2026-11-02', '09:00', 'Запуск', 'Регистрация', ''), ev('1', '2026-11-02', '11:00', 'Переход', 'Регистрация', 'Юрист'), ev('1', '2026-11-03', '11:00', 'Переход', 'Юрист', 'Бюджет'),
        ev('2', '2026-11-05', '10:00', 'Запуск', 'Регистрация', ''), ev('2', '2026-11-05', '12:00', 'Переход', 'Регистрация', 'Юрист'), ev('2', '2026-11-09', '12:00', 'Ручной перевод', 'Юрист', 'Валютный контроль'),
        ev('2', '2026-11-09', '12:30', 'Вызов интеграции', 'Юрист', '')
    ];
    const m = C.buildMap(E, spec());
    const reg = m.edges.find(e => e.from === 'Регистрация');
    assert.strictEqual(reg.count, 2);
    assert.strictEqual(reg.avgH, 2);
    const off = m.edges.find(e => e.to === 'Валютный контроль');
    assert.strictEqual(off.offSpec, true);
    assert.strictEqual(off.manual, 1);
    assert.strictEqual(off.avgH, 96);
    assert.strictEqual(m.edges.find(e => e.to === 'Бюджет').offSpec, false);
    assert.strictEqual(m.steps.find(s => s.step === 'Юрист').avgH, 60);
    assert.ok(m.unused.some(t => t.to === 'Возврат'), 'переход из спецификации, по которому никто не шёл');
});

test('кто держит задачу: отпуск с замещением - заместитель, без замещения - висит; где застряло', () => {
    const emp = { esm: { absFrom: '2026-11-24', absTo: '2026-12-05' }, cfo: { absFrom: '2026-11-24', absTo: '2026-11-27' }, lawyer: {} };
    const subs = [{ emp: 'cfo', sub: 'treasury', from: '2026-11-24', to: '2026-11-27' }];
    assert.deepStrictEqual(C.holder('cfo', emp, subs, '2026-11-26'), { who: 'treasury', via: 'cfo', hanging: false });
    assert.strictEqual(C.holder('esm', emp, subs, '2026-11-26').hanging, true);
    assert.strictEqual(C.holder('esm', emp, subs, '2026-11-23').hanging, false, 'до отпуска не висит');
    assert.strictEqual(C.holder('cfo', emp, subs, '2026-11-30').who, 'cfo');
    const ctx = { today: '2026-11-26', spec: spec(), empByLogin: emp, subs: subs };
    const k = r => C.stuckReasons(r, ctx).map(x => x.kind);
    assert.deepStrictEqual(k({ at: 'Бюджет', exec: 'esm', status: 'В работе', entered: '2026-11-19' }), ['absent', 'overdue']);
    assert.deepStrictEqual(k({ at: 'Финдиректор', exec: 'cfo', status: 'В работе', entered: '2026-11-25' }), []);
    assert.deepStrictEqual(k({ at: 'Юрист', exec: 'owner', status: 'Ждёт решения', entered: '2026-11-23' }), ['uncertainty']);
    assert.deepStrictEqual(k({ at: 'Юрист', exec: 'lawyer', status: 'В работе', entered: '2026-11-25', done: '2026-11-26' }), []);
    assert.strictEqual(C.workDays('2026-11-20', '2026-11-23'), 1, 'выходные не считаются');
    assert.strictEqual(C.workDays('2026-11-03', '2026-11-05', { '2026-11-04': 1 }), 1, 'праздник не считается');
});

test('повтор вызова: задержки 5/20/80 мин, после исчерпания попыток - ошибка, успех прекращает повторы', () => {
    assert.deepStrictEqual([1, 2, 3].map(a => C.retryDelay(a)), [5, 20, 80]);
    assert.strictEqual(C.callState([{ att: 1, code: 503 }, { att: 2, code: 503 }, { att: 3, code: 503 }], 3).state, 'исчерпано');
    const s = C.callState([{ att: 1, code: 503 }], 3);
    assert.strictEqual(s.state, 'повтор');
    assert.strictEqual(s.nextIn, 20);
    assert.strictEqual(C.callState([{ att: 2, code: 200 }, { att: 1, code: 502 }], 3).state, 'успех');
    assert.strictEqual(C.minutesAdd('10:07', 20), '10:27');
    assert.strictEqual(C.minutesAdd('23:50', 20), '00:10');
});
