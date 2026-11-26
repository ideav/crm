// rules: none (demo #996)
// СУОТ и учёт СИЗ (демо-копия, ideav/backlogram#996): сроки, комплект по нормам, инструктажи, медосмотр, допуск, наряд-допуск, выдача, сводка.
const test = require('node:test');
const assert = require('node:assert');
const C = require('../download/suot/js/suot-core.js');
const T = '2026-11-26';

function model() {
    const M = { rules: C.parseRules([]), depts: ['Цех №2', 'Цех №1'] };
    M.positions = { 'Слесарь-ремонтник': { works: ['Работы на высоте'], factors: ['Шум', 'Работы на высоте'] }, 'Токарь': { works: [], factors: ['Шум'] } };
    M.factorBy = { 'Шум': { months: 24 }, 'Работы на высоте': { months: 12 } };
    M.kinds = [{ name: 'Вводный инструктаж', cat: 'Инструктаж', months: 0, all: true, once: true }, { name: 'Повторный инструктаж', cat: 'Инструктаж', months: 6, all: true }, { name: 'Проверка знаний: высота', cat: 'Проверка знаний', months: 12 }];
    M.kindBy = {}; M.kinds.forEach(k => { M.kindBy[k.name] = k; });
    M.reqs = [{ work: 'Работы на высоте', kind: 'Проверка знаний: высота' }];
    M.ppe = [{ name: 'Каска', kind: 'Голова', code: 'SIZ-103' }, { name: 'Ботинки', kind: 'Обувь', code: 'SIZ-102' }, { name: 'Привязь', kind: 'Прочее', code: 'SIZ-107' }];
    M.ppeBy = {}; M.ppe.forEach(p => { M.ppeBy[p.name] = p; });
    M.norms = [{ pos: 'Слесарь-ремонтник', ppe: 'Каска', qty: 1, months: 24, point: '166.3' }, { pos: 'Слесарь-ремонтник', ppe: 'Ботинки', qty: 1, months: 12, point: '166.2' }, { pos: 'Слесарь-ремонтник', ppe: 'Привязь', qty: 1, months: 0, point: 'прил. 2', work: 'Работы на высоте' }];
    M.workers = [
        { name: 'Гаврилов', tab: 'ТН-0412', dept: 'Цех №2', pos: 'Слесарь-ремонтник', hire: '2019-03-11', sizes: { head: '57-59', shoes: '43' } },
        { name: 'Морозов', tab: 'ТН-0418', dept: 'Цех №2', pos: 'Слесарь-ремонтник', hire: '2017-09-04', sizes: { head: '59-62', shoes: '44' } },
        { name: 'Кузьмин', tab: 'ТН-0533', dept: 'Цех №2', pos: 'Слесарь-ремонтник', hire: '2026-06-15', sizes: {} },
        { name: 'Орлов', tab: 'ТН-0420', dept: 'Цех №1', pos: 'Токарь', hire: '2015-01-01', sizes: {} }];
    M.workerBy = {}; M.workers.forEach(w => { M.workerBy[w.name] = w; });
    const tr = (w, kind, date) => ({ worker: w, kind, date, result: 'Проведён' });
    M.trainings = [tr('Гаврилов', 'Вводный инструктаж', '2019-03-11'), tr('Гаврилов', 'Повторный инструктаж', '2026-04-14'), tr('Гаврилов', 'Проверка знаний: высота', '2025-12-10'),
        tr('Морозов', 'Вводный инструктаж', '2017-09-04'), tr('Морозов', 'Повторный инструктаж', '2026-09-20'), tr('Морозов', 'Проверка знаний: высота', '2026-05-12'),
        tr('Кузьмин', 'Вводный инструктаж', '2026-06-15'), tr('Кузьмин', 'Повторный инструктаж', '2026-09-01'), tr('Кузьмин', 'Проверка знаний: высота', '2026-06-25'),
        tr('Орлов', 'Вводный инструктаж', '2015-01-01'), tr('Орлов', 'Повторный инструктаж', '2026-09-01')];
    M.exams = [{ worker: 'Гаврилов', date: '2025-12-16', verdict: 'Годен' }, { worker: 'Морозов', date: '2026-03-01', verdict: 'Годен' }, { worker: 'Кузьмин', date: '2026-06-10', verdict: 'Годен' }, { worker: 'Орлов', date: '2026-11-12', verdict: 'Не годен' }];
    M.issues = [{ worker: 'Гаврилов', ppe: 'Каска', date: '2024-06-03', qty: 1 }, { worker: 'Гаврилов', ppe: 'Ботинки', date: '2025-12-08', qty: 1 },
        { worker: 'Морозов', ppe: 'Каска', date: '2026-01-10', qty: 1 }, { worker: 'Морозов', ppe: 'Ботинки', date: '2026-02-01', qty: 1 }, { worker: 'Морозов', ppe: 'Привязь', date: '2024-05-01', qty: 1 },
        { worker: 'Кузьмин', ppe: 'Каска', date: '2026-06-16', qty: 1 }, { worker: 'Кузьмин', ppe: 'Ботинки', date: '2026-06-16', qty: 1 }, { worker: 'Кузьмин', ppe: 'Привязь', date: '2026-06-16', qty: 1 }];
    return M;
}

test('даты: месяцы с прижатием конца месяца, формат ДД.ММ.ГГГГ', () => {
    assert.strictEqual(C.addMonths('2026-01-31', 1), '2026-02-28');
    assert.strictEqual(C.addMonths('2026-11-26', -6), '2026-05-26');
    assert.strictEqual(C.toIso('16.12.2026'), '2026-12-16');
    assert.strictEqual(C.toDmy('2026-12-16'), '16.12.2026');
});

test('состояние срока: просрочено, истекает в горизонте, действует, нет записи', () => {
    assert.strictEqual(C.stateOf('2026-11-25', T, 30), 'over');
    assert.strictEqual(C.stateOf('2026-11-26', T, 30), 'soon');
    assert.strictEqual(C.stateOf('2026-12-26', T, 30), 'soon');
    assert.strictEqual(C.stateOf('2026-12-27', T, 30), 'ok');
    assert.strictEqual(C.stateOf('', T, 30), 'none');
});

test('комплект СИЗ по нормам: срок носки от фактической выдачи, «до износа», не выдано, размер по виду СИЗ', () => {
    const M = model(), card = C.ppeCard(M.workerBy['Гаврилов'], M, T);
    const by = {}; card.forEach(c => { by[c.ppe] = c; });
    assert.strictEqual(by['Каска'].due, '2026-06-03');
    assert.strictEqual(by['Каска'].state, 'over');
    assert.strictEqual(by['Каска'].size, '57-59');
    assert.strictEqual(by['Ботинки'].state, 'soon');
    assert.strictEqual(by['Привязь'].state, 'none');
    assert.strictEqual(C.ppeCard(M.workerBy['Морозов'], M, T).find(c => c.ppe === 'Привязь').state, 'wear');
});

test('инструктажи: виды «для всех» плюс требования опасных работ; однократный вводный не истекает', () => {
    const M = model(), tc = C.trainingCard(M.workerBy['Гаврилов'], M, T);
    assert.deepStrictEqual(tc.map(t => t.kind).sort(), ['Вводный инструктаж', 'Повторный инструктаж', 'Проверка знаний: высота']);
    assert.strictEqual(tc.find(t => t.kind === 'Вводный инструктаж').state, 'ok');
    assert.strictEqual(tc.find(t => t.kind === 'Повторный инструктаж').due, '2026-10-14');
    assert.strictEqual(tc.find(t => t.kind === 'Повторный инструктаж').state, 'over');
    assert.strictEqual(C.trainingCard(M.workerBy['Орлов'], M, T).length, 2, 'токарю без опасных работ проверка знаний на высоте не нужна');
});

test('пост. 805: в первый год на опасных работах повторный инструктаж раз в 3 мес, правило настраивается', () => {
    const M = model(), k = M.workerBy['Кузьмин'];
    const rep = C.trainingCard(k, M, T).find(t => t.kind === 'Повторный инструктаж');
    assert.strictEqual(rep.months, 3);
    assert.strictEqual(rep.due, '2026-12-01');
    assert.strictEqual(rep.state, 'soon');
    M.rules = C.parseRules([{ name: 'Повторный инструктаж в первый год на опасных работах, мес', value: '6' }]);
    assert.strictEqual(C.trainingCard(k, M, T).find(t => t.kind === 'Повторный инструктаж').state, 'ok');
    assert.strictEqual(C.trainingCard(M.workerBy['Орлов'], M, T).find(t => t.kind === 'Повторный инструктаж').months, 6, 'без опасных работ - обычные 6 мес');
});

test('медосмотр: периодичность по самому частому фактору, «не годен» - просрочка', () => {
    const M = model(), g = C.medCard(M.workerBy['Гаврилов'], M, T);
    assert.strictEqual(g.months, 12);
    assert.strictEqual(g.due, '2026-12-16');
    assert.strictEqual(g.state, 'soon');
    const o = C.medCard(M.workerBy['Орлов'], M, T);
    assert.strictEqual(o.state, 'over');
    assert.strictEqual(o.verdict, 'Не годен');
});

test('допуск сегодня: причины - просроченный инструктаж и невыданная обязательная для работ привязь', () => {
    const M = model(), a = C.admission(M.workerBy['Гаврилов'], M, T);
    assert.strictEqual(a.ok, false);
    assert.ok(a.reasons.some(r => /Повторный инструктаж: просрочено с 14\.10\.2026/.test(r)), a.reasons.join('|'));
    assert.ok(a.reasons.some(r => /Привязь: не выдано/.test(r)), a.reasons.join('|'));
    assert.strictEqual(C.admission(M.workerBy['Морозов'], M, T).ok, true);
    assert.ok(C.admission(M.workerBy['Орлов'], M, T).reasons.includes('Медосмотр: не годен'));
});

test('наряд-допуск: подпись блокируется, пока исполнитель не допущен; замена исполнителя снимает блок', () => {
    const M = model(), p = { num: 'НД-118', status: 'На согласовании ОТ', works: ['Работы на высоте'], executors: ['Гаврилов', 'Морозов'] };
    const r = C.signPermit(p, 'Специалист по охране труда', M, T);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.blocked, true);
    assert.ok(/Гаврилов/.test(r.error) && !/Морозов —/.test(r.error), r.error);
    p.executors = ['Морозов', 'Кузьмин'];
    const r2 = C.signPermit(p, 'Специалист по охране труда', M, T);
    assert.strictEqual(r2.ok, true);
    assert.strictEqual(r2.status, 'На утверждении');
});

test('наряд-допуск: шаг подписывает только своя роль, закрытие от допусков не зависит', () => {
    const M = model(), p = { status: 'На утверждении', works: ['Работы на высоте'], executors: ['Морозов'] };
    assert.strictEqual(C.signPermit(p, 'Мастер участка', M, T).ok, false);
    assert.strictEqual(C.signPermit(p, 'Начальник производства', M, T).status, 'Допуск выдан');
    const done = { status: 'Допуск выдан', works: ['Работы на высоте'], executors: ['Гаврилов'] };
    assert.strictEqual(C.signPermit(done, 'Мастер участка', M, T).status, 'Закрыт');
    assert.strictEqual(C.signPermit({ status: 'Закрыт', works: [], executors: [] }, 'admin', M, T).ok, false);
    const alien = C.permitCheck({ works: ['Работы на высоте'], executors: ['Орлов'] }, M, T);
    assert.ok(alien.rows[0].reasons.some(x => /не допускается к работе/.test(x)), 'должность без этого вида работ в наряд не входит');
});

test('роль по имени без учёта регистра', () => {
    assert.strictEqual(C.roleKey('Специалист по охране труда'), 'ot');
    assert.strictEqual(C.roleKey('КЛАДОВЩИК СИЗ'), 'store');
    assert.strictEqual(C.roleKey('мастер участка'), 'master');
    assert.strictEqual(C.roleKey('Начальник производства'), 'chief');
    assert.strictEqual(C.roleKey('admin'), 'admin');
});

test('выдача: плановая без причины, ранняя и вне нормы - с причиной', () => {
    const M = model(), g = M.workerBy['Гаврилов'], m = M.workerBy['Морозов'];
    assert.strictEqual(C.issueCheck(g, 'Каска', M, T).needReason, false);
    assert.strictEqual(C.issueCheck(g, 'Привязь', M, T).needReason, false, 'первая выдача по норме');
    assert.strictEqual(C.issueCheck(m, 'Каска', M, T).needReason, true, 'каска до 10.01.2028 - ранняя');
    assert.strictEqual(C.issueCheck(m, 'Привязь', M, T).needReason, true, 'до износа - причина замены');
    const out = C.issueCheck(M.workerBy['Орлов'], 'Каска', M, T);
    assert.strictEqual(out.inNorm, false);
    assert.strictEqual(out.needReason, true);
});

test('склад: остаток по размеру, партия с ближайшим сроком годности, сканер', () => {
    const M = model(), b = [{ code: 'П1', ppe: 'Каска', size: '57-59', qty: 2, expires: '2028-01-01' }, { code: 'П2', ppe: 'Каска', size: '57-59', qty: 5, expires: '2027-03-01' }, { code: 'П3', ppe: 'Каска', size: '59-62', qty: 4 }];
    assert.strictEqual(C.stockOf(b, 'Каска', '57-59'), 7);
    assert.strictEqual(C.pickBatch(b, 'Каска', '57-59', 1).code, 'П2');
    assert.strictEqual(C.pickBatch(b, 'Каска', '57-59', 6), null);
    const s = C.parseScan(' тн-0412  SIZ-107 ', M);
    assert.strictEqual(s.worker.name, 'Гаврилов');
    assert.strictEqual(s.ppe.name, 'Привязь');
    assert.notStrictEqual(C.fingerprint('a|1,2'), C.fingerprint('a|1,3'));
});

test('календарь и сводка: просрочки по подразделениям, процент допущенных', () => {
    const M = model(), ev = C.events(M, T);
    assert.ok(ev.length > 0);
    assert.strictEqual(ev[0].state, 'over', 'просрочки первыми');
    assert.ok(ev.some(e => e.worker === 'Кузьмин' && e.item === 'Повторный инструктаж' && e.state === 'soon'));
    const s = C.summary(M, T), c2 = s.find(x => x.dept === 'Цех №2'), c1 = s.find(x => x.dept === 'Цех №1');
    assert.strictEqual(c2.workers, 3);
    assert.strictEqual(c2.admitted, 2);
    assert.strictEqual(c2.pct, 67);
    assert.strictEqual(c2['СИЗ'].over, 2, 'каска просрочена и привязь не выдана');
    assert.strictEqual(c1['Медосмотр'].over, 1);
});

test('CSV: точка с запятой, кавычки и переносы экранируются', () => {
    assert.strictEqual(C.toCsv([['a;b', 'c"d', 'e']]), '"a;b";"c""d";e');
});
