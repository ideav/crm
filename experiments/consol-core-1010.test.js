// rules: none (defect #5751)
// Консолидация отчётности (демо-копия, ideav/backlogram#1010): разбор ОСВ, трансляция счетов, контроли пакета, сверка ВГО,
// элиминации, корректировки, консолидация, версии и закрытие периода.
const test = require('node:test');
const assert = require('node:assert');
const C = require('../download/consol/js/consol-core.js');

const A = (code, name, section, o) => Object.assign({ code, name, section, group: section, ord: +code, other: false, ic: false, counter: '', icTwin: '' }, o || {});
const ARTS = [A('1150', 'Основные средства', 'А'), A('1230', 'Дебиторская задолженность', 'А', { icTwin: '1231' }), A('1231', 'Дебиторская задолженность (ВГО)', 'А', { ic: true, counter: '1521' }),
    A('1250', 'Денежные средства', 'А'), A('1260', 'Прочие активы', 'А', { other: true }), A('1310', 'Уставный капитал', 'П'), A('1370', 'Нераспределённая прибыль', 'П'),
    A('1510', 'Кредиты банков краткосрочные', 'П'), A('1520', 'Кредиторская задолженность', 'П', { icTwin: '1521' }), A('1521', 'Кредиторская задолженность (ВГО)', 'П', { ic: true, counter: '1231' }),
    A('1540', 'Оценочные обязательства', 'П'), A('2110', 'Выручка', 'ОПУ', { icTwin: '2111' }), A('2111', 'Выручка (ВГО)', 'ОПУ', { ic: true, counter: '2121' }),
    A('2120', 'Себестоимость продаж', 'ОПУ', { icTwin: '2121' }), A('2121', 'Закупки внутри группы (ВГО)', 'ОПУ', { ic: true, counter: '2111' }), A('2220', 'Коммерческие и управленческие расходы', 'ОПУ'),
    A('2350', 'Прочие доходы и расходы', 'ОПУ', { other: true })];
const BY = {}; ARTS.forEach(a => { BY[a.code] = a; });
const L = (company, article, open, amount, cp) => ({ company, article, open, amount, cp: cp || '', acc: article, status: 'mapped' });
/* Пакет «М»: продал «Т» на 100, дебиторка «Т» 30; прибыль 40 закрыта в нераспределённую прибыль. */
const pkgM = () => [L('М', '1150', 500, 520), L('М', '1231', 20, 30, 'Т'), L('М', '1250', 80, 100), L('М', '1310', -400, -400), L('М', '1370', -200, -240),
    L('М', '2110', 0, -300), L('М', '2111', 0, -100, 'Т'), L('М', '2120', 0, 330), L('М', '2220', 0, 30), L('М', '1520', 0, -10)];
const pkgT = (payable) => [L('Т', '1250', 50, 80 + payable - 30), L('Т', '1521', -20, -payable, 'М'), L('Т', '1310', -30, -30), L('Т', '1370', 0, -20),
    L('Т', '2110', 0, -150), L('Т', '2121', 0, 100, 'М'), L('Т', '2220', 0, 30)];
const ctx = (self, prev, counter, rules) => ({ byCode: BY, self, prev, counter, cpPkg: {}, rules: rules || { SIGN: { blocking: false }, IC: { blocking: false }, OTHER: { blocking: false, threshold: 5 } } });
const state = (res, code) => (res.find(c => c.code === code) || {}).state;

test('ОСВ из 1С: разбор CSV и вставки из Excel, шапка и итоги пропускаются, дебет «+», кредит «-»', () => {
    const csv = 'Счёт;Наименование;ИНН;Нач Дт;Нач Кт;Об Дт;Об Кт;Кон Дт;Кон Кт\n62.01;Покупатели;7708123987;1 000;;500;300;1 200;\n60.01;Поставщики;;;400,5;100;200;;500,5\nИтого;;;;;;;;';
    const r = C.parseOsv(csv);
    assert.strictEqual(r.length, 2);
    assert.deepStrictEqual([r[0].acc, r[0].inn, r[0].open, r[0].close, r[0].turn], ['62.01', '7708123987', 1000, 1200, 200]);
    assert.strictEqual(r[1].close, -500.5);
    const tsv = C.parseOsv('01.01\tОС\t\t10\t\t0\t0\t10\t');
    assert.strictEqual(tsv[0].close, 10);
});

test('трансляция: подтверждённый счёт важнее типовой, контрагент группы по ИНН уводит в статью «(ВГО)», служебные счета не переносятся', () => {
    const osv = C.parseOsv('62.01;Покупатели;7708123987;0;;0;0;30;\n62.01;Покупатели;;0;;0;0;70;\n90.09;Прибыль от продаж;;;;5;5;;\n73.01;Расчёты с персоналом по займам;;;;;;1;\n76.09;Прочие расчёты;;;;;;2;');
    const m = C.mapOsv(osv, { articles: ARTS, byCode: BY, mapping: { '76.09': '1150' }, innTo: { '7708123987': 'Т' }, self: 'М' });
    assert.deepStrictEqual(m.map(x => [x.article, x.cp, x.status]), [['1231', 'Т', 'suggested'], ['1230', '', 'suggested'], ['', '', 'skip'], ['', '', 'unmapped'], ['1150', '', 'mapped']]);
    const fixed = C.remap(m[3], '1260', BY, osv[3]);
    assert.strictEqual(fixed.status, 'mapped'); assert.strictEqual(fixed.amount, 1);
    /* свой ИНН не делает строку внутригрупповой */
    assert.strictEqual(C.mapOsv(osv.slice(0, 1), { articles: ARTS, byCode: BY, mapping: {}, innTo: { '7708123987': 'М' }, self: 'М' })[0].article, '1230');
});

test('контроли: сходящийся пакет зелёный и отправляется', () => {
    const res = C.controls(pkgM(), ctx('М', null, pkgT(30)));
    assert.deepStrictEqual(res.map(c => c.state), res.map(() => 'ok'), JSON.stringify(res.map(c => c.code + ':' + c.msg)));
    assert.strictEqual(C.canSubmit(res), true);
});

test('контроли: несопоставленный счёт и разбалансировка блокируют отправку', () => {
    const p = pkgM(); p.push({ company: 'М', article: '', acc: '73.01', name: 'Займы персоналу', open: 0, amount: 5, status: 'unmapped' });
    p[2] = Object.assign({}, p[2], { amount: 95 });
    const res = C.controls(p, ctx('М', null, pkgT(30)));
    assert.strictEqual(state(res, 'MAP'), 'error');
    assert.strictEqual(state(res, 'BAL'), 'error');
    assert.strictEqual(C.canSubmit(res), false);
});

test('контроли: прибыль в балансе не равна ОПУ и сальдо на начало не совпадает с принятым прошлым пакетом', () => {
    const p = pkgM(); p[4] = Object.assign({}, p[4], { amount: -230 }); p[2] = Object.assign({}, p[2], { amount: 90 });
    const prev = [L('М', '1150', 0, 480), L('М', '1231', 0, 20, 'Т'), L('М', '1250', 0, 100), L('М', '1310', 0, -400), L('М', '1370', 0, -200)];
    const res = C.controls(p, ctx('М', prev, pkgT(30)));
    assert.strictEqual(state(res, 'PNL'), 'error');
    const open = res.find(c => c.code === 'OPEN');
    assert.strictEqual(open.state, 'error');
    assert.strictEqual(open.items.length, 2, open.items.join('; '));
});

test('контроли: доля «прочих» выше порога и расхождение ВГО - предупреждения с суммой разницы', () => {
    const p = pkgM().concat([L('М', '2350', 0, 60), L('М', '1370', 0, 60), L('М', '1250', 0, -60)]);
    const res = C.controls(p, ctx('М', null, pkgT(28.4)));
    assert.strictEqual(state(res, 'OTHER'), 'warn');
    const ic = res.find(c => c.code === 'IC');
    assert.strictEqual(ic.state, 'warn');
    assert.match(ic.items.join(' '), /разница 2/, 'разница показана округлённой до тысяч');
    assert.strictEqual(res.ic.find(x => x.article === '1231').diff, 1.6);
    assert.strictEqual(C.canSubmit(res), true);
});

test('контроль ВГО: контрагент не сдал пакет - пара ждёт, а не расходится', () => {
    const res = C.controls(pkgM(), ctx('М', null, []));
    assert.strictEqual(state(res, 'IC'), 'ok');
    assert.ok(res.ic.every(p => p.state === 'missing'));
});

test('сверка ВГО: пары группы, расхождение и элиминация только сошедшихся пар без влияния на прибыль', () => {
    const lines = pkgM().concat(pkgT(30));
    const pairs = C.icPairs(lines, BY);
    assert.strictEqual(pairs.length, 2);
    assert.ok(pairs.every(p => p.state === 'ok' && p.a === 'М' && p.b === 'Т'), JSON.stringify(pairs));
    const e = C.eliminationEntries(pairs);
    assert.strictEqual(C.sum(e, x => x.amount), 0);
    assert.strictEqual(C.validateAdj({ basis: 'сверка', entries: e }, BY, { name: 'Элиминация ВГО', profit: false }).ok, true);
    const bad = C.icPairs(pkgM().concat(pkgT(28.4)), BY);
    assert.strictEqual(bad.find(p => p.kind === 'Расчёты').state, 'diff');
    assert.strictEqual(C.eliminationEntries(bad).length, 2, 'элиминируется только сошедшаяся пара выручки');
});

test('корректировки: без основания и несбалансированные не утверждаются, реклассификация не может менять прибыль', () => {
    const k = (profit) => ({ name: profit ? 'Трансформация' : 'Реклассификация', profit });
    assert.match(C.validateAdj({ basis: '', entries: [{ article: '2220', company: 'М', amount: 10 }, { article: '1540', company: 'М', amount: -10 }] }, BY, k(true)).errors.join(), /основание/);
    assert.match(C.validateAdj({ basis: 'расчёт', entries: [{ article: '2220', company: 'М', amount: 10 }, { article: '1540', company: 'М', amount: -9 }] }, BY, k(true)).errors.join(), /не сбалансирована/);
    assert.match(C.validateAdj({ basis: 'договор', entries: [{ article: '2220', company: 'М', amount: 10 }, { article: '1540', company: 'М', amount: -10 }] }, BY, k(false)).errors.join(), /не должен менять прибыль/);
    const ok = C.validateAdj({ basis: 'график', entries: [{ article: '1510', company: 'М', amount: -50 }, { article: '1520', company: 'М', amount: 50 }] }, BY, k(false));
    assert.strictEqual(ok.ok, true); assert.strictEqual(ok.profit, 0);
    assert.strictEqual(C.nextAdjNum([{ num: 'Э-3к26-01', period: '3к26' }, { num: 'Т-3к26-06', period: '3к26' }], '3к26', 'Р'), 'Р-3к26-07');
});

test('консолидация: элиминация обнуляет ВГО, корректировка ОПУ закрывается в нераспределённую прибыль, баланс группы сходится', () => {
    const lines = pkgM().concat(pkgT(30));
    const elim = { num: 'Э-1', status: 'Утверждена', entries: C.eliminationEntries(C.icPairs(lines, BY)) };
    const vac = { num: 'Т-2', status: 'Утверждена', entries: [{ article: '2220', company: 'М', amount: 12 }, { article: '1540', company: 'М', amount: -12 }] };
    const draft = { num: 'Т-3', status: 'Черновик', entries: [{ article: '2220', company: 'Т', amount: 5 }, { article: '1540', company: 'Т', amount: -5 }] };
    const r = C.consolidate(lines, [elim, vac, draft], ARTS, ['М', 'Т']);
    assert.strictEqual(r.by['1231'].total, 0); assert.strictEqual(r.by['2111'].total, 0);
    assert.strictEqual(r.profit, 40 + 20 - 12);
    assert.strictEqual(r.check, 0);
    assert.strictEqual(r.by['2220'].byCo['М'], 30, 'расшифровка до общества');
    assert.ok(r.by['1370'].adjSrc.some(s => s.num === 'Т-2'), 'видно, какая корректировка изменила прибыль');
    const withDraft = C.consolidate(lines, [elim, vac, draft], ARTS, ['М', 'Т'], { drafts: true });
    assert.strictEqual(withDraft.profit, 43); assert.strictEqual(withDraft.check, 0);
});

test('версии: сравнение снимков показывает изменившиеся статьи и объясняющую корректировку', () => {
    const lines = pkgM().concat(pkgT(30));
    const elim = { num: 'Э-1', status: 'Утверждена', entries: C.eliminationEntries(C.icPairs(lines, BY)) };
    const vac = { num: 'Т-2', status: 'Утверждена', entries: [{ article: '2220', company: 'М', amount: 12 }, { article: '1540', company: 'М', amount: -12 }] };
    const v1 = C.snapshot(C.consolidate(lines, [elim], ARTS, ['М', 'Т'])), v2 = C.snapshot(C.consolidate(lines, [elim, vac], ARTS, ['М', 'Т']));
    const cmp = C.compareSnap(v1, v2, ARTS, [elim, vac], ['Э-1']);
    assert.deepStrictEqual(cmp.rows.map(r => r.code).sort(), ['1370', '1540', '2220']);
    assert.ok(cmp.rows.every(r => r.why.indexOf('Т-2') >= 0));
    assert.strictEqual(cmp.profitA - cmp.profitB, 12);
    assert.deepStrictEqual(C.compareSnap(v2, v2, ARTS, [elim, vac], ['Э-1', 'Т-2']).rows, []);
});

test('закрытие: просрочка в рабочих днях и чек-лист не пускает закрыть период с непринятым пакетом', () => {
    assert.strictEqual(C.workdaysLate('2026-11-20', '2026-11-26'), 4);
    assert.strictEqual(C.workdaysLate('20.11.2026', '2026-11-20'), 0);
    assert.strictEqual(C.workdaysLate('2026-11-20', '2026-11-26', ['2026-11-24']), 3);
    const lines = pkgM().concat(pkgT(30)), pairs = C.icPairs(lines, BY);
    const base = { perimeter: ['М', 'Т'], pairs, adjs: [{ num: 'Э-1', status: 'Утверждена', basis: 'сверка', entries: C.eliminationEntries(pairs) }], cons: C.consolidate(lines, [], ARTS, ['М', 'Т']) };
    const open = C.closeChecklist(Object.assign({ pkgs: [{ company: 'М', status: 'Принят' }, { company: 'Т', status: 'Отправлен' }] }, base));
    assert.strictEqual(open.ready, false); assert.deepStrictEqual(open.failed.map(s => s.key), ['pkgs']);
    const done = C.closeChecklist(Object.assign({ pkgs: [{ company: 'М', status: 'Принят' }, { company: 'Т', status: 'Принят' }] }, base));
    assert.strictEqual(done.ready, true);
    const noBasis = C.closeChecklist(Object.assign({}, base, { pkgs: done.steps && [{ company: 'М', status: 'Принят' }, { company: 'Т', status: 'Принят' }], adjs: [{ num: 'Т-9', status: 'Черновик', basis: '' }] }));
    assert.deepStrictEqual(noBasis.failed.map(s => s.key), ['adj']);
    assert.strictEqual(C.periodLocked({ status: 'Закрыт' }), true);
});

test('формат: тысячи с пробелами, настоящий минус, разбор чисел с запятой и скобками', () => {
    assert.strictEqual(C.fmt(-1234567), '−1 234 567');
    assert.strictEqual(C.num('1 234,5'), 1234.5);
    assert.strictEqual(C.num('(200)'), -200);
    assert.strictEqual(C.disp(BY['1520'], -10), 10);
    assert.strictEqual(C.disp(BY['2110'], -10), 10);
    assert.strictEqual(C.disp(BY['2220'], 10), -10);
});
