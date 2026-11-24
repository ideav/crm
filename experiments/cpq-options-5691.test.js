// rules: none (defect #5691)
// CPQ: настраиваемые опции демо (ideav/crm#5691, backlogram#993). На каждую опцию: при значении X ядро даёт Y.
// Значения опций приходят строками таблицы «Настройка» (колонки «Код», «Значение», «Значение настройки»).
const test = require('node:test');
const assert = require('node:assert');
const C = require('../download/cpq/js/cpq-core.js');
const F = require('./cpq-catalog.fixture.json');

/* opts: { КОД: значение } -> строки «Настройка» поверх фикстуры */
function model(opts) {
    const rows = JSON.parse(JSON.stringify(F));
    rows.rules = rows.rules.map(r => Object.assign({ _id: r['Правило'] }, r));
    rows.targets = rows.targets.map(t => Object.assign({ _up: t['Правило'] }, t));
    Object.keys(opts || {}).forEach(code => {
        const numeric = typeof opts[code] === 'number';
        rows.settings.push({ 'Настройка': code, 'Код': code, 'Значение': numeric ? '' : opts[code], 'Значение настройки': numeric ? opts[code] : '' });
    });
    return C.buildModel(rows);
}
const LN = { product: 'LN-32', sel: ['SEAL-SIC', 'DRV-5'], qty: 2 };      /* 344 000 ₽ по каталогу (Дилер) */
const KN = { product: 'KN-65', sel: ['MAT-316', 'DRV-11', 'SEAL-SIC'], qty: 1 }; /* 477 840 ₽ */

test('без строк опций действует исходное поведение демо', () => {
    const M = model();
    assert.deepStrictEqual(M.opts, { discountMode: 'quote', limitsMode: 'roles', flatLimit: 10, companyLimit: 0, marginPolicy: 'approve', marginView: 'show', statusManual: 'deny' });
    assert.strictEqual(C.approval(M, 7, 30, 'Менеджер').needs, false);
    assert.strictEqual(C.approval(M, 8, 30, 'Менеджер').needs, true);
});

test('DISCOUNT_MODE: на всё КП скидка одна, по позициям - у каждой своя, лимит сверяется с наибольшей', () => {
    const wholeM = model({ DISCOUNT_MODE: 'quote' }), linesM = model({ DISCOUNT_MODE: 'lines' });
    const whole = C.priceQuote(wholeM, [Object.assign({ disc: 20 }, LN), KN], 'Дилер', 5, 'Менеджер');
    assert.strictEqual(whole.discount, Math.round(821840 * 0.05));   /* disc позиции игнорируется */
    const byLines = C.priceQuote(linesM, [Object.assign({ disc: 10 }, LN), Object.assign({ disc: 0 }, KN)], 'Дилер', 5, 'Менеджер');
    assert.strictEqual(byLines.byLines, true);
    assert.strictEqual(byLines.lines[0].discAmount, 34400);
    assert.strictEqual(byLines.lines[1].discAmount, 0);
    assert.strictEqual(byLines.discount, 34400);                       /* quote-скидка 5% не применяется */
    assert.strictEqual(byLines.total, 821840 - 34400);
    assert.strictEqual(byLines.discountPct, 10);                       /* наибольшая по позициям идёт в проверку лимита */
    assert.strictEqual(byLines.effectivePct, 4.2);
    assert.strictEqual(byLines.approval.needs, true);                  /* 10% > лимита менеджера 7% */
    const small = C.priceQuote(linesM, [Object.assign({ disc: 7 }, LN), Object.assign({ disc: 3 }, KN)], 'Дилер', 0, 'Менеджер');
    assert.strictEqual(small.approval.needs, false);
});

test('LIMITS_MODE: по ролям лимит свой у каждой, единый лимит даёт одно число всем, кто не согласует', () => {
    const roles = model({ LIMITS_MODE: 'roles' }), flat = model({ LIMITS_MODE: 'flat', LIMIT_FLAT: 12 });
    assert.strictEqual(C.limitOf(roles, 'Менеджер'), 7);
    assert.strictEqual(C.limitOf(roles, 'Старший менеджер'), 10);
    assert.strictEqual(C.limitOf(flat, 'Менеджер'), 12);
    assert.strictEqual(C.limitOf(flat, 'Старший менеджер'), 12);
    assert.strictEqual(C.limitOf(flat, 'Руководитель отдела продаж'), 15);   /* согласующий держит лимит из таблицы */
    assert.strictEqual(C.approval(roles, 11, 30, 'Менеджер').needs, true);
    assert.strictEqual(C.approval(flat, 11, 30, 'Менеджер').needs, false);
    assert.strictEqual(C.approval(flat, 13, 30, 'Менеджер').approver, 'Руководитель отдела продаж');
});

test('LIMIT_COMPANY: предел компании - число из настройки, а при нуле лимит старшего согласующего', () => {
    const def = model({ LIMIT_COMPANY: 0 }), tight = model({ LIMIT_COMPANY: 12 }), wide = model({ LIMIT_COMPANY: 30 });
    assert.strictEqual(C.companyLimit(def), 25);
    assert.strictEqual(C.approval(def, 26, 30, 'Менеджер').blocked, true);
    assert.strictEqual(C.approval(tight, 13, 30, 'Менеджер').blocked, true);
    assert.strictEqual(C.approval(tight, 12, 30, 'Менеджер').approver, 'Руководитель отдела продаж');
    assert.strictEqual(C.approval(wide, 26, 30, 'Менеджер').blocked, false);   /* предел выше лимита директора: согласующего нет */
    assert.strictEqual(C.approval(wide, 26, 30, 'Менеджер').approver, null);
});

test('MARGIN_POLICY: ниже минимума - согласование директора, запрет или не контролируется', () => {
    /* маржа 23.7%: порог 30 делает её низкой */
    const base = (policy) => { const m = model({ MARGIN_POLICY: policy }); m.settings['Минимальная маржа, %'] = 30; return C.approval(m, 5, 23.7, 'Менеджер'); };
    const ap = base('approve'), bl = base('block'), off = base('off');
    assert.strictEqual(ap.needs, true);
    assert.strictEqual(ap.approver, 'Коммерческий директор');
    assert.strictEqual(bl.blocked, true);
    assert.strictEqual(bl.needs, false);
    assert.ok(/запрещена/.test(bl.reasons.join(' ')));
    assert.strictEqual(off.needs, false);
    assert.strictEqual(off.lowMargin, false);
});

test('MARGIN_VIEW: менеджер видит цифру, только отметку или ничего; согласующие видят всегда', () => {
    const view = (v) => model({ MARGIN_VIEW: v });
    assert.strictEqual(C.marginText(view('show'), 'Менеджер', 23.74), '23.7%');
    assert.strictEqual(C.marginText(view('flag'), 'Менеджер', 23.74), 'в норме');
    assert.strictEqual(C.marginText(view('flag'), 'Менеджер', 12), 'ниже минимума');
    assert.strictEqual(C.marginText(view('hide'), 'Менеджер', 23.74), '');
    assert.strictEqual(C.marginText(view('hide'), 'Руководитель отдела продаж', 23.74), '23.7%');
    assert.strictEqual(C.marginText(view('hide'), 'Коммерческий директор', 12), '12%');
    /* причина согласования не выдаёт цифру маржи, если её не показывают */
    const low = (v) => { const m = view(v); m.settings['Минимальная маржа, %'] = 30; return C.approval(m, 5, 23.7, 'Менеджер').reasons.join(' '); };
    assert.ok(/23\.7%/.test(low('show')));
    assert.ok(!/\d/.test(low('hide')));
});

test('STATUS_MANUAL: вручную менять статус могут руководители всегда, менеджеры - если разрешено', () => {
    const deny = model({ STATUS_MANUAL: 'deny' }), allow = model({ STATUS_MANUAL: 'allow' });
    assert.strictEqual(C.canSetStatus(deny, 'Менеджер'), false);
    assert.strictEqual(C.canSetStatus(deny, 'Старший менеджер'), false);
    assert.strictEqual(C.canSetStatus(deny, 'Руководитель отдела продаж'), true);
    assert.strictEqual(C.canSetStatus(allow, 'Менеджер'), true);
});

test('значения опций вне списка вариантов не ломают ядро: действует вариант по умолчанию', () => {
    const M = model({ DISCOUNT_MODE: 'странно', MARGIN_VIEW: 'что-то', STATUS_MANUAL: '', LIMITS_MODE: 'x' });
    assert.strictEqual(M.opts.discountMode, 'quote');
    assert.strictEqual(M.opts.marginView, 'show');
    assert.strictEqual(M.opts.statusManual, 'deny');
    assert.strictEqual(M.opts.limitsMode, 'roles');
});
