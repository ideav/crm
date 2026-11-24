// rules: none (defect #5688)
// PIM (демо-копия, backlogram#989, ideav/crm#5688): настраиваемые опции демо. На каждую опцию: при значении X расчёт или правило даёт Y.
const test = require('node:test');
const assert = require('node:assert');
const C = require('../download/pim/js/pim-core.js');

const ATTRS = {
    'Название': { name: 'Название', type: 'text', field: 'name' }, 'Описание': { name: 'Описание', type: 'text', field: 'desc' },
    'Страна производства': { name: 'Страна производства', type: 'text', field: 'country' },
    'Цвет': { name: 'Цвет', type: 'list', values: ['Белый', 'Беж'] },
};
const OZ = { name: 'Ozon', minPhotos: 0, titleLimit: 100, descLimit: 50 };
const WB = { name: 'Wildberries', minPhotos: 0, titleLimit: 20, descLimit: 50 };
const CH = [OZ, WB];
const CA = [
    { key: 'oz-n', channel: 'Ozon', category: 'Бельё', title: 'Название', ours: 'Название', required: true, limit: 100, values: [], order: 1 },
    { key: 'oz-c', channel: 'Ozon', category: 'Бельё', title: 'Цвет товара', ours: 'Цвет', required: true, values: ['белый', 'бежевый'], order: 2 },
    { key: 'oz-c2', channel: 'Ozon', category: 'Полотенца', title: 'Цвет товара', ours: 'Цвет', required: true, values: ['белый', 'бежевый'], order: 2 },
    { key: 'wb-n', channel: 'Wildberries', category: 'Бельё', title: 'Наименование', ours: 'Название', required: true, limit: 20, values: [], order: 1 },
    { key: 'wb-k', channel: 'Wildberries', category: 'Бельё', title: 'Страна', ours: 'Страна производства', required: true, values: [], order: 2 },
];
const card = (o) => Object.assign({ id: '1', sku: 'А-1', category: 'Бельё', name: 'Комплект белья Лавра Эльба хлопок белый', country: 'Китай', status: 'На проверке', photos: 0, values: { 'Цвет': 'Белый' }, titles: {}, titleIds: {} }, o);
const Mk = (S, valueMap) => ({ attrs: ATTRS, valueMap: valueMap || {}, settings: C.resolveSettings(Object.keys(S || {}).map(k => ({ code: k, value: S[k] }))) });

test('настройки: значения по умолчанию, недопустимое значение заменяется умолчанием', () => {
    const S = C.resolveSettings([{ code: 'ready_rule', value: 'bogus' }, { code: 'title_mode', value: 'per_channel' }]);
    assert.strictEqual(S.ready_rule, 'any');
    assert.strictEqual(S.title_mode, 'per_channel');
    assert.strictEqual(S.value_map_scope, 'category');
    assert.strictEqual(C.opt({}, 'export_scope'), 'channel_ok');
    assert.strictEqual(C.OPTIONS.every(o => o.type !== 'select' || o.variants.some(v => v[0] === o.def)), true);
});

test('title_mode: общее название против названия на площадку', () => {
    const p = card({ titles: { 'Wildberries': 'Бельё Лавра, белый' } });
    const common = C.checkChannel(p, WB, CA, Mk({ title_mode: 'common' }));
    assert.strictEqual(common.blockers.some(b => b.state === 'long'), true);       // 39 симв. при лимите 20
    const per = C.checkChannel(p, WB, CA, Mk({ title_mode: 'per_channel' }));
    assert.strictEqual(per.blockers.some(b => b.state === 'long'), false);         // своё короткое название
    assert.strictEqual(per.items.find(i => i.key === 'wb-n').value, 'Бельё Лавра, белый');
    // без своего названия берётся общее
    assert.strictEqual(C.titleFor(card(), WB, Mk({ title_mode: 'per_channel' }).settings), card().name);
    // Ozon со своим названием не затронут: у него названия нет, берётся общее
    assert.strictEqual(C.titleFor(p, OZ, Mk({ title_mode: 'per_channel' }).settings), p.name);
});

test('title_mode=common: ориентир - самый строгий лимит среди площадок в работе', () => {
    assert.deepStrictEqual(C.strictestTitleLimit(CH, Mk({}).settings), { limit: 20, channel: 'Wildberries' });
    assert.deepStrictEqual(C.strictestTitleLimit(CH, Mk({ active_channels: 'Ozon' }).settings), { limit: 100, channel: 'Ozon' });
});

test('title_mode=per_channel: операции записи названий - новая, изменение, удаление', () => {
    const p = card({ titleIds: { 'Ozon': '77' } });
    const ops = C.titleOps(p, { 'Ozon': '', 'Wildberries': 'Бельё, белый' });
    assert.deepStrictEqual(ops[0], { op: 'del', id: '77' });
    assert.strictEqual(ops[1].op, 'new');
    assert.strictEqual(ops[1].up, '1');
    assert.strictEqual(ops[1].fields['Площадка'], 'Wildberries');
    assert.deepStrictEqual(C.titleOps(p, { 'Ozon': 'Новое' })[0], { op: 'save', id: '77', fields: { 'Название для площадки': 'Новое' } });
    assert.deepStrictEqual(C.titleOps(p, { 'Wildberries': '' }), []);
});

test('value_map_scope: соответствие из одной категории действует на все категории только в общем справочнике', () => {
    const raw = { 'oz-c': { 'беж': 'бежевый' } };
    const byCat = C.buildValueMap(raw, CA, 'category'), byChan = C.buildValueMap(raw, CA, 'channel');
    const towel = card({ category: 'Полотенца', values: { 'Цвет': 'Беж' } });
    const r1 = C.checkChannel(towel, OZ, CA, { attrs: ATTRS, valueMap: byCat, settings: Mk({ value_map_scope: 'category' }).settings });
    const r2 = C.checkChannel(towel, OZ, CA, { attrs: ATTRS, valueMap: byChan, settings: Mk({ value_map_scope: 'channel' }).settings });
    assert.strictEqual(r1.items.find(i => i.key === 'oz-c2').state, 'invalid');
    assert.strictEqual(r2.items.find(i => i.key === 'oz-c2').value, 'бежевый');
    assert.strictEqual(byChan['oz-c2']['беж'], 'бежевый');
    assert.strictEqual(byCat['oz-c2'], undefined);
});

test('value_map_scope=channel: значение не из справочника целевой категории не переносится, чужая площадка не затрагивается', () => {
    const ca = CA.concat([{ key: 'oz-c3', channel: 'Ozon', category: 'Посуда', title: 'Цвет товара', ours: 'Цвет', values: ['чёрный'], order: 1 }]);
    const m = C.buildValueMap({ 'oz-c': { 'беж': 'бежевый' } }, ca, 'channel');
    assert.strictEqual(m['oz-c3']['беж'], undefined);
    assert.deepStrictEqual(m['wb-n'], {});
});

const res = (a, b) => ({ 'Ozon': { pct: a, blockers: [] }, 'Wildberries': { pct: b, blockers: [] } });

test('ready_rule: any, all и manual по одним и тем же результатам', () => {
    const p = card(), r = res(100, 80);
    assert.deepStrictEqual(C.statusBlockers(p, 'Готово к выгрузке', r, true, Mk({ ready_rule: 'any' }).settings), []);
    const all = C.statusBlockers(p, 'Готово к выгрузке', r, true, Mk({ ready_rule: 'all' }).settings);
    assert.strictEqual(all.length, 1); assert.match(all[0], /Wildberries \(80%\)/);
    assert.deepStrictEqual(C.statusBlockers(p, 'Готово к выгрузке', res(10, 20), true, Mk({ ready_rule: 'manual' }).settings), []);
    assert.strictEqual(C.statusBlockers(p, 'Готово к выгрузке', res(10, 20), true, Mk({ ready_rule: 'any' }).settings).length, 1);
    // без настроек - прежнее поведение (хотя бы одна площадка)
    assert.strictEqual(C.statusBlockers(p, 'Готово к выгрузке', res(10, 20)).length, 1);
});

test('active_channels: правило «на всех выбранных» смотрит только отмеченные площадки', () => {
    const p = card(), r = res(100, 40);
    assert.strictEqual(C.statusBlockers(p, 'Готово к выгрузке', r, true, Mk({ ready_rule: 'all' }).settings).length, 1);
    assert.deepStrictEqual(C.statusBlockers(p, 'Готово к выгрузке', r, true, Mk({ ready_rule: 'all', active_channels: 'Ozon' }).settings), []);
    assert.deepStrictEqual(C.activeChannels(Mk({ active_channels: 'Нет такой' }).settings, ['Ozon', 'Wildberries']), ['Ozon', 'Wildberries']);
    const cards = [{ p, res: res(100, 40) }, { p: card({ id: '2' }), res: res(100, 100) }];
    assert.strictEqual(C.readyCount(cards, Mk({ ready_rule: 'all' }).settings), 1);
    assert.strictEqual(C.readyCount(cards, Mk({ ready_rule: 'any' }).settings), 2);
});

test('export_scope: только прошедшие проверку площадки или все «Готово» с пустыми ячейками', () => {
    const good = card({ id: '1', sku: 'А-1', status: 'Готово к выгрузке', country: 'Китай' });
    const gap = card({ id: '2', sku: 'А-2', status: 'Готово к выгрузке', country: '', name: 'Короткое' });
    const draft = card({ id: '3', sku: 'А-3', status: 'Черновик' });
    const strict = Mk({ export_scope: 'channel_ok' }), loose = Mk({ export_scope: 'ready_with_gaps' });
    const a = C.buildExport([good, gap], WB, CA, strict);
    assert.strictEqual(a.ok.length, 0);                    // у good название длиннее лимита WB, у gap нет страны
    const g2 = card({ id: '4', sku: 'А-4', status: 'Готово к выгрузке', name: 'Короткое' });
    assert.strictEqual(C.buildExport([g2, gap], WB, CA, strict).ok.length, 1);
    assert.strictEqual(C.buildExport([g2, gap], WB, CA, strict).bad.length, 1);
    const b = C.buildExport([g2, gap], WB, CA, loose);
    assert.strictEqual(b.ok.length, 2); assert.strictEqual(b.bad.length, 0);
    const row = b.ok.find(r => r.p.sku === 'А-2');
    assert.strictEqual(row.gaps.length, 1); assert.match(row.gaps[0], /не заполнено/);
    assert.strictEqual(row.cells[b.columns.indexOf('Страна')], '');
    // состав выбираемых карточек
    assert.deepStrictEqual(C.exportCards([good, draft], strict.settings, false).map(p => p.sku), ['А-1']);
    assert.deepStrictEqual(C.exportCards([good, draft], strict.settings, true).map(p => p.sku), ['А-1', 'А-3']);
    assert.deepStrictEqual(C.exportCards([good, draft], loose.settings, true).map(p => p.sku), ['А-1']);
});

test('approve_by: ассистент утверждает только при настройке «любой редактор»', () => {
    const asst = { card: true, edit: true, feed: false }, mgr = { card: true, edit: true, feed: true }, head = { card: true, edit: false, feed: false }, viewer = { card: false, edit: false, feed: true };
    const m = Mk({ approve_by: 'managers' }).settings, e = Mk({ approve_by: 'editors' }).settings;
    assert.deepStrictEqual([asst, mgr, head, viewer].map(c => C.canApprove(m, c)), [false, true, true, false]);
    assert.deepStrictEqual([asst, mgr, head, viewer].map(c => C.canApprove(e, c)), [true, true, true, false]);
});

test('лимиты площадок редактируются: лимит названия площадки управляет проверкой, пометка про документацию - настройкой', () => {
    const p = card({ name: 'Комплект белья Лавра' });                       // 20 симв.
    assert.strictEqual(C.checkChannel(p, WB, CA, Mk({})).blockers.length, 0);
    assert.strictEqual(C.checkChannel(p, WB, CA, Mk({})).items.find(i => i.key === 'wb-n').state, 'ok');
    const strictWB = Object.assign({}, WB, { titleLimit: 10 });
    assert.strictEqual(C.checkChannel(p, strictWB, CA, Mk({})).items.find(i => i.key === 'wb-n').state, 'long');
    assert.match(C.checkChannel(p, strictWB, CA, Mk({})).items.find(i => i.key === 'wb-n').msg, /при лимите 10/);
    const n1 = C.limitsNote(WB, Mk({}).settings);
    assert.strictEqual(n1.warn, true); assert.match(n1.text, /сверить с документацией площадки/);
    const n2 = C.limitsNote(Object.assign({}, WB, { limitsChecked: '23.11.2026' }), Mk({}).settings);
    assert.strictEqual(n2.warn, false); assert.match(n2.text, /23\.11\.2026/);
    assert.strictEqual(C.limitsNote(WB, Mk({ limits_note: 'hide' }).settings), null);
});
