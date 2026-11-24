// rules: none (defect #5678)
// CPQ (демо-копия, ideav/crm#5678): движок правил совместимости и цены. Каталог берётся из фикстуры, как строки таблиц базы.
const test = require('node:test');
const assert = require('node:assert');
const C = require('../download/cpq/js/cpq-core.js');
const F = require('./cpq-catalog.fixture.json');

function model(mut) {
    const rows = JSON.parse(JSON.stringify(F));
    rows.rules = rows.rules.map(r => Object.assign({ _id: r['Правило'] }, r));
    rows.targets = rows.targets.map(t => Object.assign({ _up: t['Правило'] }, t));
    if (mut) mut(rows);
    return C.buildModel(rows);
}
const M = model();
const sel = (...c) => c;

test('модель: опции, правила и цели читаются из строк таблиц', () => {
    assert.strictEqual(M.options.length, 34);
    assert.strictEqual(M.rules.length, 35);
    assert.strictEqual(M.rules.filter(r => !r.active).length, 1);
    assert.deepStrictEqual(M.rules.find(r => r.name.indexOf('R-01') === 0).targets, ['MAT-CI', 'MAT-BR', 'MAT-304']);
});

test('цена: база + фиксированные опции, наценка группы клиента, ступень по количеству', () => {
    const line = { product: 'LN-32', sel: sel('SEAL-SIC', 'DRV-5'), qty: 1 };
    assert.strictEqual(C.priceLine(M, line, 'Дилер').unit, 172000);
    assert.strictEqual(C.priceLine(M, line, 'Конечный заказчик').unit, 189200);
    const three = C.priceLine(M, Object.assign({}, line, { qty: 3 }), 'Конечный заказчик');
    assert.strictEqual(three.volumePct, 2);
    assert.strictEqual(three.total, Math.round(189200 * 3 * 0.98));
    assert.strictEqual(C.priceLine(M, Object.assign({}, line, { qty: 10 }), 'Дилер').volumePct, 6);
});

test('цена: опция в процентах от базы изделия', () => {
    const p = C.priceLine(M, { product: 'KN-65', sel: sel('MAT-316', 'DRV-11', 'SEAL-SIC'), qty: 1 }, 'Дилер');
    assert.strictEqual(p.listUnit, 312000 + 99840 + 42000 + 24000);
});

test('КП: скидка, НДС и маржа', () => {
    const q = C.priceQuote(M, [{ product: 'LN-32', sel: sel('SEAL-SIC', 'DRV-5'), qty: 2 }], 'Дилер', 5, 'Менеджер');
    assert.strictEqual(q.subtotal, 344000);
    assert.strictEqual(q.discount, 17200);
    assert.strictEqual(q.total, 326800);
    assert.strictEqual(q.vat, 65360);
    assert.ok(q.marginPct > 18 && q.marginPct < 40);
    assert.strictEqual(q.approval.needs, false);
});

test('исключает: морская вода гасит чугун, бронзу и 304 с причиной, нерегулярное правило не мешает', () => {
    const s = C.toggle(M, 'KN-65', C.initial(M, 'KN-65'), 'ENV-SEA');
    assert.ok(s.ok);
    const ev = C.evaluate(M, 'KN-65', s.sel);
    ['MAT-CI', 'MAT-BR', 'MAT-304'].forEach(c => assert.ok(ev.disabled[c] && /хлориды/.test(ev.disabled[c][0]), c));
    assert.ok(!ev.disabled['MAT-316'] && !ev.disabled['MAT-DUP']);
    const bad = C.toggle(M, 'KN-65', s.sel, 'MAT-CI');
    assert.strictEqual(bad.ok, false);
    assert.deepStrictEqual(bad.sel, s.sel);
});

test('исключает работает в обе стороны: выбранный чугун гасит морскую воду', () => {
    const s = C.toggle(M, 'KN-65', C.initial(M, 'KN-65'), 'MAT-CI').sel;
    const ev = C.evaluate(M, 'KN-65', s);
    assert.ok(ev.disabled['ENV-SEA'] && /Чугун/.test(ev.disabled['ENV-SEA'][0]));
    const swap = C.toggle(M, 'KN-65', s, 'MAT-316');
    assert.ok(swap.ok && swap.sel.indexOf('MAT-CI') < 0 && swap.sel.indexOf('MAT-316') >= 0);
    assert.ok(!C.evaluate(M, 'KN-65', swap.sel).disabled['ENV-SEA']);
});

test('требует: морская вода добавляет покрытие, снятие покрытия снимает воду', () => {
    const a = C.toggle(M, 'KN-65', [], 'ENV-SEA');
    assert.ok(a.sel.indexOf('EXT-COAT') >= 0 && a.added[0].code === 'EXT-COAT');
    const off = C.toggle(M, 'KN-65', a.sel, 'EXT-COAT');
    assert.strictEqual(off.sel.indexOf('ENV-SEA'), -1);
    assert.strictEqual(off.removed[0].code, 'ENV-SEA');
});

test('требует цепочкой: гарантия тянет пусконаладку и шеф-монтаж, снятие шеф-монтажа снимает всё', () => {
    const a = C.toggle(M, 'LN-32', [], 'SRV-WAR');
    ['SRV-COM', 'SRV-SUP'].forEach(c => assert.ok(a.sel.indexOf(c) >= 0, c));
    const off = C.toggle(M, 'LN-32', a.sel, 'SRV-SUP');
    ['SRV-COM', 'SRV-WAR'].forEach(c => assert.strictEqual(off.sel.indexOf(c), -1, c));
});

test('только вместе: вставки и опоры идут комплектом в обе стороны', () => {
    const a = C.toggle(M, 'LN-32', [], 'EXT-FLEX');
    assert.ok(a.sel.indexOf('EXT-VIB') >= 0);
    assert.strictEqual(C.toggle(M, 'LN-32', a.sel, 'EXT-VIB').sel.indexOf('EXT-FLEX'), -1);
    const b = C.toggle(M, 'LN-32', [], 'EXT-VIB');
    assert.ok(b.sel.indexOf('EXT-FLEX') >= 0);
});

test('правила изделия: мощный привод недоступен для ЛН-32, обязательный датчик УПД не снять', () => {
    const ev = C.evaluate(M, 'LN-32', C.initial(M, 'LN-32'));
    ['DRV-22', 'DRV-37', 'DRV-55', 'CTL-RED'].forEach(c => assert.ok(ev.disabled[c], c));
    assert.ok(/ЛН-32/.test(ev.disabled['DRV-22'][0]));
    const base = C.initial(M, 'UPD-2');
    assert.ok(base.indexOf('EXT-PRS') >= 0);
    const r = C.toggle(M, 'UPD-2', base, 'EXT-PRS');
    assert.strictEqual(r.ok, false);
    assert.ok(C.evaluate(M, 'UPD-2', base).locked['EXT-PRS']);
});

test('по умолчанию: стартовая комплектация изделия и мягкое предложение плавного пуска', () => {
    assert.ok(C.initial(M, 'UPD-3').indexOf('DRV-37') >= 0);
    const r = C.toggle(M, 'KN-65', C.initial(M, 'KN-65'), 'DRV-22');
    assert.ok(r.sel.indexOf('CTL-SOFT') >= 0);
    const direct = C.toggle(M, 'KN-65', C.toggle(M, 'KN-65', [], 'CTL-DOL').sel, 'DRV-37');
    assert.strictEqual(direct.ok, false);
    assert.ok(/Прямой пуск/.test(direct.reasons[0].text));
});

test('нельзя заменить опцию, которая нужна другой: сточные воды закрепляют двойное уплотнение', () => {
    const w = C.toggle(M, 'KN-65', C.initial(M, 'KN-65'), 'ENV-WASTE');
    assert.ok(w.sel.indexOf('SEAL-DBL') >= 0 && w.sel.indexOf('SEAL-SIC') < 0 && w.sel.indexOf('EXT-DRY') >= 0);
    const ev = C.evaluate(M, 'KN-65', w.sel);
    assert.ok(ev.disabled['SEAL-SIC'] && /нужен для/.test(ev.disabled['SEAL-SIC'][0]));
});

test('данные, а не код: отключённое правило не действует, включённое действует', () => {
    const off = model(rows => { rows.rules.forEach(r => { if (r['Правило'].indexOf('R-01') === 0) r['Активно'] = ''; }); });
    const s = C.toggle(off, 'KN-65', [], 'MAT-CI').sel;
    assert.ok(!C.evaluate(off, 'KN-65', s).disabled['ENV-SEA']);
    const on = model(rows => { rows.rules.forEach(r => { if (r['Правило'].indexOf('R-35') === 0) r['Активно'] = '1'; }); });
    assert.ok(C.evaluate(on, 'KN-65', C.toggle(on, 'KN-65', [], 'SEAL-PK').sel).disabled['ENV-DRINK']);
    assert.ok(!C.evaluate(M, 'KN-65', C.toggle(M, 'KN-65', [], 'SEAL-PK').sel).disabled['ENV-DRINK']);
});

test('полный набор: пустые обязательные группы и ошибки загруженной комплектации', () => {
    assert.deepStrictEqual(C.evaluate(M, 'LN-32', []).missing, ['Среда', 'Материал проточной части', 'Привод', 'Управление', 'Уплотнение вала']);
    const full = sel('ENV-CLEAN', 'MAT-CI', 'DRV-5', 'CTL-DOL', 'SEAL-SIC');
    assert.ok(C.evaluate(M, 'LN-32', full).complete);
    const broken = sel('ENV-SEA', 'MAT-CI', 'DRV-5', 'CTL-DOL', 'SEAL-SIC');
    const ev = C.evaluate(M, 'LN-32', broken);
    assert.ok(!ev.complete && ev.errors.length >= 2);
});

test('тестовый прогон: число допустимых комбинаций по изделиям', () => {
    const exp = { 'LN-32': 246, 'KN-65': 451, 'MS-80': 410, 'UPD-2': 738, 'UPD-3': 410 };
    Object.keys(exp).forEach(k => { const a = C.analyze(M, k); assert.strictEqual(a.combos, 1500); assert.strictEqual(a.valid, exp[k], k); });
    assert.deepStrictEqual(C.analyze(M, 'LN-32').dead.map(d => d.code), ['DRV-22', 'DRV-37', 'DRV-55', 'CTL-RED']);
});

test('согласование скидки: лимит роли, ближайший согласующий, предел компании, маржа ниже минимума', () => {
    assert.strictEqual(C.approval(M, 7, 30, 'Менеджер').needs, false);
    const a = C.approval(M, 12, 30, 'Менеджер');
    assert.ok(a.needs && a.approver === 'Руководитель отдела продаж');
    assert.strictEqual(C.approval(M, 12, 30, 'Старший менеджер').approver, 'Руководитель отдела продаж');
    assert.strictEqual(C.approval(M, 10, 30, 'Старший менеджер').needs, false);
    assert.strictEqual(C.approval(M, 18, 30, 'Старший менеджер').approver, 'Коммерческий директор');
    assert.strictEqual(C.approval(M, 12, 30, 'Руководитель отдела продаж').needs, false);
    const hi = C.approval(M, 30, 30, 'Менеджер');
    assert.ok(hi.blocked && !hi.needs);
    const low = C.approval(M, 3, 12, 'Менеджер');
    assert.ok(low.needs && low.lowMargin && low.approver === 'Коммерческий директор');
});

test('проверка правил находит противоречие: требует и исключает одно и то же', () => {
    assert.deepStrictEqual(C.lint(M), []);
    const bad = model(rows => {
        const o = n => rows.options.find(x => x['Код'] === n)['Опция'];
        rows.rules.push({ _id: 'X', 'Правило': 'X1', 'Тип правила': 'Требует', 'Если опция': o('SRV-WAR'), 'Изделие': '', 'Пояснение для менеджера': 'x', 'Активно': '1' });
        rows.rules.push({ _id: 'Y', 'Правило': 'X2', 'Тип правила': 'Исключает', 'Если опция': o('SRV-WAR'), 'Изделие': '', 'Пояснение для менеджера': 'y', 'Активно': '1' });
        rows.targets.push({ _up: 'X', 'Опция цели': o('EXT-DRY') }, { _up: 'Y', 'Опция цели': o('EXT-DRY') });
    });
    assert.strictEqual(C.lint(bad).length, 1);
});

test('даты и деньги', () => {
    assert.strictEqual(C.toIso('25.11.2026'), '2026-11-25');
    assert.strictEqual(C.addDays('2026-11-23', 14), '2026-12-07');
    assert.strictEqual(C.money(1253870), '1 253 870');
});
