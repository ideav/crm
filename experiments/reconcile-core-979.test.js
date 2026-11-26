// rules: none (defect #5731)
// Сверка данных (демо-копия, ideav/backlogram#979): разбор файлов по формату, сопоставление, причины расхождений, «четыре глаза», период.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const C = require('../download/reconcile/js/reconcile-core.js');

const rec = (date, amount, cp, doc, purpose) => C.prep({ date, amount, cp, doc: doc || '', purpose: purpose || '' });
const F_BANK = { delim: ';', dateFmt: 'ДД.ММ.ГГГГ', dec: ',', cols: [{ field: 'date', header: 'Дата операции', required: true }, { field: 'in', header: 'Поступление', required: true }, { field: 'out', header: 'Списание', required: true }, { field: 'cp', header: 'Наименование контрагента', required: true }, { field: 'inn', header: 'ИНН контрагента' }, { field: 'doc', header: 'Номер документа' }, { field: 'purpose', header: 'Назначение платежа' }] };
const F_1C = { delim: ';', dateFmt: 'ГГГГ-ММ-ДД', dec: '.', cols: [{ field: 'date', header: 'Период', required: true }, { field: 'in', header: 'Дебет', required: true }, { field: 'out', header: 'Кредит', required: true }, { field: 'cp', header: 'Контрагент', required: true }, { field: 'doc', header: 'Вх. номер' }, { field: 'purpose', header: 'Содержание' }] };
const demo = n => fs.readFileSync(path.join(__dirname, '../download/reconcile/demo', n), 'utf8');

test('нормализация: контрагент в разной записи - один ключ, номер документа без нулей и префиксов', () => {
    assert.strictEqual(C.normName('ООО "ТЕХНОСНАБ"'), C.normName('ТехноСнаб ООО'));
    assert.strictEqual(C.normName('ООО «Волжский профиль»'), C.normName('ООО "ВОЛЖСКИЙ ПРОФИЛЬ"'));
    assert.notStrictEqual(C.normName('ООО «Кама»'), C.normName('ООО «Кама-Трейд»'));
    assert.strictEqual(C.normDoc('№ 000457'), '457');
    assert.strictEqual(C.docFromPurpose('Оплата по п/п № 00457 от 03.11'), '457');
});

test('числа и даты источника: пробелы, запятая, скобки; несуществующая дата отвергается', () => {
    assert.strictEqual(C.parseAmount('1 234 567,89', ','), 1234567.89);
    assert.strictEqual(C.parseAmount('1,234,567.89', '.'), 1234567.89);
    assert.strictEqual(C.parseAmount('(500,00)', ','), -500);
    assert.strictEqual(C.parseAmount('Итого', ','), null);
    assert.strictEqual(C.parseDate('03.11.2026', 'ДД.ММ.ГГГГ'), '2026-11-03');
    assert.strictEqual(C.parseDate('2026-11-03 0:00:00', 'ГГГГ-ММ-ДД'), '2026-11-03');
    assert.strictEqual(C.parseDate('31.02.2026', 'ДД.ММ.ГГГГ'), null);
    assert.strictEqual(C.parseDate('2026-11-03', 'ДД.ММ.ГГГГ'), null);
});

test('CSV: кавычки, разделитель и перевод строки внутри значения', () => {
    const rows = C.parseCsv('a;b;c\r\n"x;y";"он сказал ""да""";"две\nстроки"\r\n', ';');
    assert.deepStrictEqual(rows, [['a', 'b', 'c'], ['x;y', 'он сказал "да"', 'две\nстроки']]);
});

test('формат: приход/расход дают знак суммы, строка «Итого» уходит в ошибки, а не в данные', () => {
    const r = C.applyFormat('Дата операции;Номер документа;Поступление;Списание;Наименование контрагента\n03.11.2026;12;1 000,50;;ООО "А"\n03.11.2026;13;;250,00;ООО "Б"\nИтого обороты;;1 000,50;250,00;\n', F_BANK);
    assert.deepStrictEqual(r.missing, []);
    assert.deepStrictEqual(r.rows.map(x => x.amount), [1000.5, -250]);
    assert.strictEqual(r.errors.length, 1);
    assert.strictEqual(r.errors[0].line, 4);
});

test('формат: переименованная колонка банка называется до разбора строк', () => {
    const r = C.applyFormat(demo('volga_4417_2026-11-26_new.csv'), F_BANK);
    assert.deepStrictEqual(r.missing.map(m => m.header), ['Наименование контрагента']);
    assert.ok(r.headers.includes('Плательщик / получатель'));
    assert.strictEqual(r.rows.length, 0);
    const fixed = Object.assign({}, F_BANK, { cols: F_BANK.cols.map(c => c.field === 'cp' ? Object.assign({}, c, { header: 'плательщик / получатель' }) : c) });
    assert.strictEqual(C.applyFormat(demo('volga_4417_2026-11-26_new.csv'), fixed).rows.length, 154);
});

test('сопоставление: точное, допуск по сумме и дате, N:1 и 1:N; запись не используется дважды', () => {
    const A = [rec('2026-11-03', 1000, 'ООО А', '1'), rec('2026-11-03', 500, 'ООО Б', '2'), rec('2026-11-04', 300000, 'ООО В', ''), rec('2026-11-05', -105000, 'ООО Г', ''), rec('2026-11-05', -105000, 'ООО Г', ''), rec('2026-11-06', 777, 'ООО Д', '9')];
    const B = [rec('2026-11-03', 1000, 'А ООО', '1'), rec('2026-11-04', 500.4, 'Б ООО', ''), rec('2026-11-04', 100000, 'В ООО', ''), rec('2026-11-05', 200000, 'В ООО', ''), rec('2026-11-05', -210000, 'Г ООО', ''), rec('2026-11-06', 777, 'Д ООО', '9')];
    A.push(rec('2026-11-06', 777, 'ООО Д', '9'));
    const m = C.match(A, B);
    const kinds = m.groups.map(g => g.kind + ':' + g.a.length + '-' + g.b.length).sort();
    assert.deepStrictEqual(kinds, ['exact:1-1', 'exact:1-1', 'many:1-2', 'many:2-1', 'tol:1-1']);
    assert.deepStrictEqual(m.unA, [6], 'второй платёж на 777 ₽ не забирает уже сопоставленную запись учёта');
    const used = m.groups.flatMap(g => g.b);
    assert.strictEqual(new Set(used).size, used.length);
});

test('выключенное правило не применяется, правила из таблицы читаются по виду и ключам', () => {
    const rules = C.rulesFrom([{ name: 'Допуск', order: '2', kind: 'Допуск', keys: 'контрагент', amtTol: '1', dayTol: '2', on: false }, { name: 'Точное', order: '1', kind: 'Точное', keys: 'сумма, дата, документ, контрагент', amtTol: '0', dayTol: '0', on: true }]);
    assert.deepStrictEqual(rules.map(r => r.kind), ['exact', 'tol']);
    assert.deepStrictEqual(rules[0].keys, ['amount', 'date', 'doc', 'cp']);
    const A = [rec('2026-11-03', 500, 'ООО Б', '2')], B = [rec('2026-11-04', 500.4, 'Б ООО', '')];
    assert.strictEqual(C.match(A, B, rules).groups.length, 0);
});

test('причины: комиссия, сумма, дата вне допуска, дубль, нет в учёте и нет в банке', () => {
    const A = [rec('2026-11-03', -2990, 'АО БАНК', '', 'Комиссия за ведение счета'), rec('2026-11-03', -1284600, 'ООО М', '77'), rec('2026-11-03', 412000, 'ООО Т', ''), rec('2026-11-03', 73500, 'ООО Л', ''), rec('2026-11-03', -58200, 'ООО П', '55')];
    const B = [rec('2026-11-03', -1248600, 'М ООО', '77'), rec('2026-11-10', 412000, 'Т ООО', ''), rec('2026-11-03', -58200, 'П ООО', '55'), rec('2026-11-03', -58200, 'П ООО', '55'), rec('2026-11-03', -318400, 'У ООО', '91')];
    const m = C.match(A, B), items = C.classify(A, B, m, { dayTol: 2 });
    const got = items.map(i => i.reason).sort();
    assert.deepStrictEqual(got, [C.REASONS.DATE, C.REASONS.DUP, C.REASONS.FEE, C.REASONS.NO_BANK, C.REASONS.NO_LEDGER, C.REASONS.AMOUNT].sort());
    const amt = items.find(i => i.reason === C.REASONS.AMOUNT);
    assert.strictEqual(amt.diff, -36000);
    assert.strictEqual(amt.a.length + amt.b.length, 2, 'расхождение суммы - одно на обе стороны');
});

test('демо-файлы 26.11: сошлось 93,6%, расхождения разобраны по причинам', () => {
    const a = C.applyFormat(demo('volga_4417_2026-11-26.csv'), F_BANK), b = C.applyFormat(demo('1c_51-01_2026-11-26.csv'), F_1C);
    assert.strictEqual(a.rows.length, 154); assert.strictEqual(b.rows.length, 157);
    const m = C.match(a.rows, b.rows), items = C.classify(a.rows, b.rows, m), s = C.summary(a.rows, b.rows, m, items);
    assert.strictEqual(s.pct, 93.6);
    const by = Object.fromEntries(s.byReason.map(r => [r.reason, r.n]));
    assert.deepStrictEqual(by, { 'Нет в учёте': 4, 'Нет в банке': 5, 'Сумма не равна': 3, 'Дубль в учёте': 2, 'Комиссия банка не проведена': 3 });
    assert.ok(s.byRule.some(r => /N:1/.test(r.rule) && r.groups === 2));
});

test('предложение N:1 для ручного разбора находит документы вне окна правила', () => {
    const x = { date: '2026-11-06', amount: 486000, cp: 'ООО "ТЕХНОСНАБ"', doc: '4194' };
    const pool = [{ date: '2026-11-06', amount: 162000, cp: 'ТехноСнаб ООО' }, { date: '2026-11-11', amount: 162000, cp: 'ТехноСнаб ООО' }, { date: '2026-11-13', amount: 162000, cp: 'ТехноСнаб ООО' }, { date: '2026-11-12', amount: 162000, cp: 'Другой ООО' }];
    const s = C.suggest(x, pool, { dayTol: 15 });
    assert.strictEqual(s.rows.length, 3); assert.strictEqual(s.diff, 0);
    assert.ok(s.rows.every(r => r.cp === 'ТехноСнаб ООО'));
    assert.strictEqual(C.suggest(x, pool, { dayTol: 2 }), null);
});

test('закрытие: нужно основание; подтверждает только контролёр и не тот, кто закрыл; закрытый период правок не принимает', () => {
    const periods = [{ name: 'Октябрь 2026', from: '2026-10-01', to: '2026-10-31', status: 'Закрыт' }, { name: 'Ноябрь 2026', from: '2026-11-01', to: '2026-11-30', status: 'Открыт' }];
    const d = { status: 'Открыто', date: '2026-11-03' };
    assert.ok(C.closeErrors(d, 'ок', 'operator', periods).some(e => /основание/i.test(e)));
    assert.deepStrictEqual(C.closeErrors(d, 'Проведено в 1С документом БК-1128', 'operator', periods), []);
    assert.ok(C.closeErrors(d, 'Проведено в 1С документом БК-1128', 'auditor', periods).length > 0);
    assert.ok(C.closeErrors({ status: 'Открыто', date: '2026-10-14' }, 'Проведено в 1С документом БК-1128', 'controller', periods).some(e => /Период/.test(e)));
    const chk = { status: 'На проверке', date: '2026-11-03', closedBy: 'ivanova' };
    assert.ok(C.approveErrors(chk, 'ivanova', 'controller', periods).some(e => /Четыре глаза/.test(e)));
    assert.ok(C.approveErrors(chk, 'petrov', 'operator', periods).length > 0);
    assert.deepStrictEqual(C.approveErrors(chk, 'sokolova', 'controller', periods), []);
    assert.deepStrictEqual(C.lockErrors(periods[1], [{ date: '2026-11-03', status: 'Закрыто' }]), []);
    assert.strictEqual(C.lockErrors(periods[1], [{ date: '2026-11-03', status: 'На проверке' }, { date: '2026-10-03', status: 'Открыто' }]).length, 1);
});

test('возраст и просрочка: корзины возраста, закрытое не просрочено', () => {
    assert.deepStrictEqual([0, 1, 2, 5, 6, 15, 16].map(C.ageBucket), ['до 2 дн.', 'до 2 дн.', '2–5 дн.', '2–5 дн.', '6–15 дн.', '6–15 дн.', 'больше 15 дн.']);
    assert.strictEqual(C.ageDays('2026-11-06', '2026-11-26'), 20);
    assert.strictEqual(C.isOverdue({ status: 'Открыто', due: '2026-11-25' }, '2026-11-26'), true);
    assert.strictEqual(C.isOverdue({ status: 'Закрыто', due: '2026-11-25' }, '2026-11-26'), false);
    assert.strictEqual(C.isOverdue({ status: 'Открыто', due: '2026-11-26' }, '2026-11-26'), false);
});

test('роли по названию роли базы', () => {
    assert.deepStrictEqual(['Оператор сверки', 'Контролёр сверки', 'Методолог сверки', 'Аудитор', 'admin', 'user'].map(C.roleKey), ['operator', 'controller', 'methodologist', 'auditor', 'controller', 'viewer']);
});

test('объём: 2 x 100 000 строк сверяются за секунды, доля сошедшихся в ожидаемых пределах', () => {
    const s = C.synth(100000, 979), t0 = Date.now();
    const m = C.match(s.A, s.B), items = C.classify(s.A, s.B, m), sm = C.summary(s.A, s.B, m, items);
    const ms = Date.now() - t0;
    assert.ok(ms < 15000, 'сверка 200 тыс. строк заняла ' + ms + ' мс');
    assert.ok(sm.pct > 94 && sm.pct < 98, 'сошлось ' + sm.pct);
    assert.strictEqual(sm.matched + sm.unmatched, sm.total);
});
