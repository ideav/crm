// rules: none (defect #5739)
// MDM (демо-копия, ideav/backlogram#978): чистые функции нормализации, похожести, групп дублей, слияния, отката и метрик качества НСИ.
const test = require('node:test');
const assert = require('node:assert');
const C = require('../download/mdm/js/mdm-core.js');

const N = 'Номенклатура', K = 'Контрагент';
const nom = (id, name, art, brand, o) => Object.assign({ id, name, code: 'НСИ-' + id, 'Артикул': art || '', 'Бренд': brand || '', 'Единица измерения': 'шт', source: '1С:УТ Москва', status: 'Эталон' }, o || {});
const kon = (id, name, inn, kpp, o) => Object.assign({ id, name, code: 'НСИ-К' + id, 'ИНН': inn, 'КПП': kpp || '', source: '1С:УТ Москва', status: 'Эталон' }, o || {});

test('нормализация: регистр, латиница в русском слове, сокращения, «М8х40» с кириллицей = «M8x40» с латиницей', () => {
    assert.strictEqual(C.normName('Подш. шар. 6205-2RS (SKF)'), C.normName('ПОДШИПНИК ШАРИКОВЫЙ 6205 2RS SKF'));
    assert.strictEqual(C.normName('Пoдшипник'), C.normName('Подшипник'));
    assert.strictEqual(C.normName('Болт М8х40'), C.normName('болт m8x40'));
    assert.strictEqual(C.normArticle('6205-2RS'), C.normArticle('62052rs'));
    assert.deepStrictEqual(C.mixedScript('Пoдшипник 6205'), ['Пoдшипник']);
});

test('сравнение: совпали артикул, бренд и наименование после нормализации - 100% с объяснением', () => {
    const c = C.compare(nom('1', 'Подшипник шариковый 6205-2RS', '6205-2RS', 'SKF'), nom('2', 'ПОДШ. ШАР. 6205 2RS', '62052rs', 'skf'), null, N);
    assert.strictEqual(c.score, 100);
    assert.match(c.reason, /артикул совпал после нормализации/);
    assert.match(c.reason, /наименование похоже на 100%/);
});

test('сравнение: разные размеры режут похожесть наименования и называются в объяснении', () => {
    const c = C.compare(nom('1', 'Болт М8х40 DIN 933'), nom('2', 'Болт М8х45 DIN 933'), null, N);
    assert.ok(c.score < 60, 'М8х40 и М8х45 - не дубль: ' + c.score);
    assert.match(c.reason, /размеры различаются: 40, 45/);
    const t = C.compare(nom('1', 'Перчатки с ПВХ 7,5 класс', 'ПХБ-75', 'Манипула'), nom('2', 'Перчатки с ПВХ 10 класс', 'ПХБ-10', 'Манипула'), null, N);
    assert.ok(t.score < 85);
    assert.match(t.reason, /артикул различается/);
});

test('сравнение: бренд, вписанный в наименование, не мешает; пустое поле в расчёт не идёт', () => {
    const c = C.compare(nom('1', 'Респиратор FFP2 с клапаном', 'FFP2-К', '3M'), nom('2', '3M Респиратор FFP2 с клапаном', 'FFP2-К', '3M'), null, N);
    assert.strictEqual(c.score, 100);
    const e = C.compare(nom('1', 'Каска защитная белая', 'КЗ-Б', 'РОСОМЗ'), nom('2', 'КАСКА ЗАЩИТНАЯ БЕЛАЯ', '', ''), null, N);
    assert.strictEqual(e.score, 100);
    assert.ok(e.parts.some(p => p.field === 'Артикул' && p.skip));
});

test('группы дублей: без цепочек - серая и красная эмаль не слипаются через строку Excel без артикула', () => {
    const rs = [nom('g1', 'Эмаль ПФ-115 серая (ведро 20 кг)', 'ПФ115-СЕР-20', 'ЯК'), nom('g2', 'Эмаль ПФ-115 красная (ведро 20 кг)', 'ПФ115-КР-20', 'ЯК'),
        nom('x1', 'ЭМАЛЬ ПФ-115 СЕРАЯ ВЕДРО 20 КГ', '', '', { source: 'Excel' }), nom('x2', 'Эмаль ПФ-115 красная ведро 20 кг', '', '', { source: 'Excel' })];
    const g = C.findDuplicates(rs, null, N, 85);
    assert.strictEqual(g.length, 2);
    g.forEach(x => assert.strictEqual(x.members.length, 2));
    assert.ok(g.some(x => x.members.map(m => m.id).sort().join() === 'g1,x1'));
    assert.deepStrictEqual(g[0].sources.sort(), ['1С:УТ Москва', 'Excel']);
});

test('группы дублей: слитые и заблокированные записи не участвуют; доля дублей считает лишние записи', () => {
    const rs = [nom('a', 'Каска защитная белая', 'КЗ-Б', 'Р'), nom('b', 'Каска защитная белая', 'КЗ-Б', 'Р'), nom('c', 'Каска защитная белая', 'КЗ-Б', 'Р', { status: 'Дубль (слит)' }), nom('d', 'Анкер 10х100', 'АК', 'F')];
    const g = C.findDuplicates(rs, null, N, 85);
    assert.strictEqual(g.length, 1);
    assert.deepStrictEqual(g[0].members.map(m => m.id), ['a', 'b']);
    assert.strictEqual(C.dupShare(rs, g), 33.3);
});

test('контрагенты: один ИНН с пробелом и другое написание - дубль; филиал с другим КПП - нет', () => {
    const a = kon('1', 'ООО «ТД Металлсервис»', '7722170068', '772201001'), b = kon('2', 'ТОРГОВЫЙ ДОМ МЕТАЛЛСЕРВИС', '7722 170068', '');
    const ab = C.compare(a, b, null, K);
    assert.ok(ab.score >= 95, 'один ИНН: ' + ab.score);
    assert.match(ab.reason, /ИНН совпал после нормализации/);
    const f = C.compare(kon('3', 'ПАО «Северсталь»', '3528182851', '352801001'), kon('4', 'ПАО «Северсталь» (Ижорский трубный завод)', '3528182851', '781745001'), null, K);
    assert.ok(f.score < 85, 'филиал: ' + f.score);
    assert.match(f.reason, /КПП различается/);
});

test('ИНН: контрольная сумма для 10 и 12 цифр', () => {
    assert.strictEqual(C.validInn('7722170068'), true);
    assert.strictEqual(C.validInn('7703412519'), false);
    assert.strictEqual(C.validInn('500100732259'), true);
    assert.strictEqual(C.validInn('123'), false);
});

test('золотая запись: приоритет источника, затем число документов; пустые поля добираются из следующего источника', () => {
    const prio = { '1С:УТ Москва': 1, '1С:ERP Казань': 2, 'Excel': 3 };
    const a = nom('a', 'Фильтр W 712/75', '', 'MANN', { source: 'Excel', docs: 900 }), b = nom('b', 'Фильтр масляный W 712/75', '', '', { source: '1С:ERP Казань', docs: 5 }), c = nom('c', 'ФИЛЬТР W712/75', 'W712/75', 'MANN', { source: '1С:ERP Казань', docs: 40 });
    const g = C.suggestGolden([a, b, c], prio);
    assert.strictEqual(g.id, 'c');
    const f = C.mergeFields([a, b, c], b, ['Наименование', 'Артикул', 'Бренд'], prio);
    assert.deepStrictEqual([f['Наименование'].from, f['Артикул'].from, f['Бренд'].from], ['b', 'c', 'c']);
});

test('слияние: методолог предлагает, руководитель подтверждает; снимок «до» возвращает записи при откате', () => {
    const g = { kind: N, score: 97, members: [nom('a', 'Гайка М8', 'DIN934-M8', 'СК'), nom('b', 'Гайка М8 оц.', 'DIN934-M8', 'СК', { status: 'На проверке', source: '1С:ERP Казань' })], pairs: [{ a: 'a', b: 'b', score: 97, reason: 'артикул совпал' }] };
    const chosen = { 'Наименование': { value: 'Гайка М8 DIN 934 оцинкованная', from: 'b' } };
    const p = C.planMerge(g, 'a', chosen, { user: 'nsi.metod', today: '2026-11-26', confirm: false, fields: ['Наименование', 'Артикул'] });
    assert.strictEqual(p.journal['Статус слияния'], 'Предложено');
    assert.strictEqual(p.journal['Подтвердил'], '');
    assert.strictEqual(p.journal['Поглощённые записи'], 'НСИ-b');
    assert.deepStrictEqual(p.updates.map(u => u.fields['Статус записи']), ['Эталон', 'Дубль (слит)']);
    assert.strictEqual(p.updates[0].fields['Наименование'], 'Гайка М8 DIN 934 оцинкованная');
    assert.strictEqual(p.updates[1].fields['Слита в'], 'НСИ-a');
    const back = C.planRollback(p.journal['Снимок до слияния'], ['Наименование']);
    assert.deepStrictEqual(back.map(u => [u.id, u.fields['Статус записи'], u.fields['Слита в'], u.fields['Наименование']]), [['a', 'Эталон', '', 'Гайка М8'], ['b', 'На проверке', '', 'Гайка М8 оц.']]);
    assert.strictEqual(C.planMerge(g, 'a', {}, { user: 'nsi.head', today: '2026-11-26', confirm: true }).journal['Статус слияния'], 'Подтверждено');
    assert.throws(() => C.planMerge(g, 'zz', {}, { user: 'x', today: '2026-11-26' }));
    assert.deepStrictEqual(C.mergeRights('Методолог НСИ'), { propose: true, confirm: false });
    assert.deepStrictEqual(C.mergeRights('руководитель нси'), { propose: true, confirm: true });
    assert.deepStrictEqual(C.mergeRights('Инициатор заявок'), { propose: false, confirm: false });
});

test('подсказка при вводе: похожие выше порога по убыванию, слитые не предлагаются', () => {
    const rs = [nom('1', 'Подшипник шариковый 6204-2RS', '6204-2RS', 'SKF'), nom('2', 'Подшипник шариковый 6205-2RS', '6205-2RS', 'SKF'), nom('3', 'Подшипник 6204 2RS', '6204-2RS', 'SKF', { status: 'Дубль (слит)' })];
    const s = C.similarTo({ name: 'Подшипник 6204 2RS SKF', 'Артикул': '62042rs', 'Бренд': 'SKF' }, rs, null, N, 70, 5);
    assert.strictEqual(s[0].rec.id, '1');
    assert.ok(s[0].score >= 85);
    assert.ok(s.every(x => x.rec.id !== '3'));
    assert.deepStrictEqual(C.similarTo({ name: 'Герметик силиконовый' }, rs, null, N, 70), []);
});

test('правила: вес и выключатель правила меняют результат; пустая таблица правил - правила по умолчанию', () => {
    const a = nom('1', 'Подшипник 6205-2RS', '6205-2RS', 'SKF'), b = nom('2', 'Подшипник 6205-2RS', '6205-2RS', 'ГПЗ-4');
    const r15 = C.parseRules([{ kind: N, field: 'Артикул', how: 'точно', w: 45 }, { kind: N, field: 'Наименование', how: 'нечётко', w: 35 }, { kind: N, field: 'Бренд', how: 'точно', w: 15 }, { kind: N, field: 'Единица измерения', how: 'точно', w: 5 }]);
    assert.strictEqual(C.compare(a, b, r15[N], N).score, 85);
    assert.ok(C.compare(a, b, C.parseRules([])[N], N).score < 85, 'по умолчанию бренд весит 20: SKF и ГПЗ-4 не дубль');
    const off = C.parseRules([{ kind: N, field: 'Бренд', how: 'точно', w: 20, on: false }, { kind: N, field: 'Артикул', how: 'точно', w: 45 }]);
    assert.strictEqual(C.compare(a, b, off[N], N).score, 100);
    assert.strictEqual(C.parseParams({ 'Порог дубля, %': '80' }).dupThreshold, 80);
    assert.strictEqual(C.parseParams({}).hintThreshold, 70);
});

test('метрики: срок заявки в рабочих днях, время заведения, доля автосопоставления', () => {
    assert.strictEqual(C.addWorkDays('2026-11-26', 2), '2026-11-30');
    assert.strictEqual(C.workDaysBetween('2026-11-06', '2026-11-09'), 1);
    assert.strictEqual(C.slaState({ status: 'Новая', due: '2026-11-23' }, '2026-11-26').state, 'late');
    assert.strictEqual(C.slaState({ status: 'Новая', due: '2026-11-26' }, '2026-11-26').state, 'today');
    assert.strictEqual(C.slaState({ status: 'Выполнена', due: '2026-11-20', done: '2026-11-19' }, '2026-11-26').state, 'done');
    assert.strictEqual(C.entryDays([{ kind: 'Создать', status: 'Выполнена', date: '2026-11-05', done: '2026-11-06' }, { kind: 'Создать', status: 'Выполнена', date: '2026-11-06', done: '2026-11-11' }, { kind: 'Изменить', status: 'Выполнена', date: '2026-11-01', done: '2026-11-20' }]), 2);
    const s = C.mapStats([{ status: 'Подтверждено', method: 'авто' }, { status: 'Подтверждено', method: 'память' }, { status: 'Подтверждено', method: 'вручную' }, { status: 'Предложено' }, { status: 'Не найдено' }]);
    assert.deepStrictEqual([s.total, s.auto, s.confirmed, s.proposed, s.notFound, s.autoPct], [5, 2, 3, 1, 1, 40]);
});

test('сопоставление прайса: позиция партнёра находит свой эталон без бренда и «арт.», размеры не путаются', () => {
    const g = [nom('m8', 'Гайка М8 DIN 934 оцинкованная', 'DIN934-M8', 'Стройкрепёж'), nom('m12', 'Гайка М12 DIN 934 оцинкованная', 'DIN934-M12', 'Стройкрепёж'), nom('p', 'Подшипник шариковый 6205-2RS', '6205-2RS', 'SKF')];
    assert.strictEqual(C.bestMatch('ГАЙКА М12 DIN 934 ОЦ. Стройкрепёж', g, N).rec.id, 'm12');
    const p = C.bestMatch('SKF Подш. шар. 6205-2RS арт. 6205-2RS', g, N);
    assert.strictEqual(p.rec.id, 'p');
    assert.ok(p.score >= 90, 'автосопоставление выше порога: ' + p.score);
    const rows = C.codeMatrix([g[2], nom('d', 'ПОДШ 6205', '6205-2RS', 'SKF', { status: 'Дубль (слит)', mergedInto: 'НСИ-p', source: '1С:ERP Казань', srcCode: 'ЕР-1' })], [{ nomId: 'p', system: 'Прайс ПК', ext: 'ПК-1', status: 'Подтверждено' }], ['1С:УТ Москва', '1С:ERP Казань', 'Прайс ПК']);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].covered, 3);
    assert.strictEqual(rows[0].cells['1С:ERP Казань'][0].via, 'слита');
});
