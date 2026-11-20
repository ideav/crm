// #5269 — живые таблицы: компонент integram-table подписывается на свой тип через
// IntegramWS (js/ws-client.js) и сообщает, какие записи у него на экране. Демон присылает
// готовые строки (с масками этого пользователя), и таблица меняет их на месте — без запросов
// и без перечитывания. Запись удалена или скрыта маской — строка убирается. Новые видимые
// записи копятся на плашке «Добавлено N — показать»; правка схемы, массовое изменение или
// обрыв связи — плашка «… — обновить». Пока ячейка в правке или новая строка не сохранена —
// изменения ждут.
//
// Run with: node --test experiments/ws-table-live-5269.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'integram-table.js'), 'utf8');

function load(page) {
    const timers = [];
    const sb = {
        console, URLSearchParams, location: { protocol: 'https:', host: 'x', hostname: 'x', pathname: '/demo/table/500', search: '' },
        history: { replaceState() {} },
        document: { getElementById: () => null, querySelectorAll: () => [], querySelector: () => null,
            addEventListener() {}, readyState: 'complete', hasFocus: () => page.focused },
        setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
        clearTimeout() {},
        user: page.user, IntegramWS: page.ws,
    };
    sb.window = sb;
    sb.globalThis = sb;
    vm.createContext(sb);
    const IntegramTable = vm.runInContext(SRC + '\n;({ IntegramTable });', sb).IntegramTable;
    const t = Object.create(IntegramTable.prototype);
    t.options = Object.assign({ tableTypeId: '500', dataSource: 'table' }, page.options || {});
    t.columns = [{ id: '500' }, { id: '501' }];
    t.rawObjectData = (page.rows || []).map((r) => ({ ...r }));
    t.data = t.rawObjectData.map((r) => r.r);
    t.loadedRecords = t.data.length;
    t.totalRows = t.data.length;
    t.calls = [];
    t.reload = () => t.calls.push('reload');
    t.refreshData = () => t.calls.push('refreshData');
    t.render = () => t.calls.push('render');
    t.captureScrollState = () => null;
    t.restoreScrollState = () => {};
    const run = () => { const list = timers.splice(0); list.forEach((x) => x.fn()); return list.length; };
    return { t, run, timers };
}

function fakeWs() {
    const ws = { subs: [], enabled: () => true, subscribe(t, fn) {
        const s = { t, fn, shown: [] };
        ws.subs.push(s);
        const off = () => { s.off = true; };
        off.shown = (ids) => s.shown.push(ids);
        return off;
    } };
    return ws;
}

const ROWS = [{ i: 10, u: 1, o: 1, r: ['a', '1'] }, { i: 11, u: 1, o: 2, r: ['b', '2'] }];
const msg = (m) => Object.assign({ by: 'bob', rows: [], remove: [], added: [], stale: '' }, m);

test('подписка на свой тип — один раз, с записями на экране; отчёт или live:false — без подписки', () => {
    const ws = fakeWs();
    const { t } = load({ ws, user: 'ann', focused: true, rows: ROWS });
    t.liveAttach();
    t.liveAttach();
    assert.deepEqual(ws.subs.map((s) => s.t), [500]);
    assert.deepEqual(ws.subs[0].shown.at(-1), [10, 11], 'после каждой загрузки — какие записи на экране');
    assert.doesNotThrow(() => load({ ws: undefined, user: 'ann', focused: true }).t.liveAttach());
    const ws2 = fakeWs();
    load({ ws: ws2, user: 'ann', focused: true, options: { live: false } }).t.liveAttach();
    load({ ws: ws2, user: 'ann', focused: true, options: { dataSource: 'report' } }).t.liveAttach();
    assert.equal(ws2.subs.length, 0);
});

test('чужая правка — строка меняется на месте, без перечитывания', () => {
    const ws = fakeWs();
    const { t } = load({ ws, user: 'ann', focused: true, rows: ROWS });
    t.liveAttach();
    const fresh = { i: 11, u: 1, o: 2, r: ['b2', '22'] };
    ws.subs[0].fn(msg({ rows: [fresh, { i: 99, u: 1, o: 1, r: ['z', 'z'] }] }));
    assert.deepEqual(t.data, [['a', '1'], ['b2', '22']]);
    assert.deepEqual(t.rawObjectData[1], fresh);
    assert.deepEqual(t.calls, ['render'], 'одна перерисовка, ни reload, ни refreshData');
    assert.equal(t.liveBannerText(), '', 'плашки нет');
});

test('удалена или скрыта маской — строка убирается; перенос к другому родителю — тоже', () => {
    const ws = fakeWs();
    const { t } = load({ ws, user: 'ann', focused: true, rows: ROWS, options: { parentId: '1' } });
    t.liveAttach();
    ws.subs[0].fn(msg({ remove: [10] }));
    assert.deepEqual(t.rawObjectData.map((r) => r.i), [11]);
    assert.deepEqual([t.data.length, t.loadedRecords, t.totalRows], [1, 1, 1]);
    assert.deepEqual(ws.subs[0].shown.at(-1), [11], 'демону — новый список записей на экране');
    ws.subs[0].fn(msg({ rows: [{ i: 11, u: 7, o: 1, r: ['b', '2'] }] }));
    assert.deepEqual(t.data, [], 'запись ушла к другому родителю — с экрана подчинённой таблицы');
});

test('новые записи — плашка «Добавлено N — показать»; свои в активной вкладке и чужого родителя — не считаются', () => {
    const ws = fakeWs();
    const { t } = load({ ws, user: 'ann', focused: true, rows: ROWS, options: { parentId: '1' } });
    t.liveAttach();
    ws.subs[0].fn(msg({ added: [1, 1, 5] }));
    assert.equal(t.liveBannerText(), 'Добавлено 2 — показать');
    ws.subs[0].fn(msg({ by: 'ann', added: [1] }));
    assert.equal(t.liveBannerText(), 'Добавлено 2 — показать', 'своя запись в этой вкладке уже на экране');
    ws.subs[0].fn(msg({ added: [1] }));
    assert.equal(t.liveBannerText(), 'Добавлено 3 — показать');
    assert.deepEqual(t.calls, [], 'данные на экране не трогаются, пока не нажали');
    t.liveBannerClick();
    assert.deepEqual(t.calls, ['reload']);
    t.liveAttach();                           // загрузка завершилась
    assert.equal(t.liveBannerText(), '');
});

test('схема, массовое изменение, обрыв — плашка «обновить»; схема — с колонками', () => {
    const ws = fakeWs();
    const { t } = load({ ws, user: 'ann', focused: true, rows: ROWS });
    t.liveAttach();
    ws.subs[0].fn(msg({ stale: 'bulk' }));
    assert.equal(t.liveBannerText(), 'Данные изменились — обновить');
    ws.subs[0].fn(msg({ stale: 'schema' }));
    assert.equal(t.liveBannerText(), 'Структура таблицы изменилась — обновить');
    ws.subs[0].fn(msg({ rows: [{ i: 10, u: 1, o: 1, r: ['x', 'y'] }] }));
    assert.deepEqual(t.data[0], ['a', '1'], 'после смены схемы строки не подставляются — раскладка колонок могла смениться');
    t.liveBannerClick();
    assert.deepEqual(t.calls, ['refreshData']);
});

test('ячейка в правке или несохранённая новая строка — изменения ждут', () => {
    const ws = fakeWs();
    const { t, run } = load({ ws, user: 'ann', focused: true, rows: ROWS });
    t.liveAttach();
    t.currentEditingCell = { colId: 1 };
    ws.subs[0].fn(msg({ rows: [{ i: 10, u: 1, o: 1, r: ['a2', '1'] }] }));
    run();
    assert.deepEqual(t.data[0], ['a', '1'], 'пока правка — не трогаем');
    t.currentEditingCell = null;
    t.pendingNewRow = true;
    run();
    assert.deepEqual(t.data[0], ['a', '1']);
    t.pendingNewRow = false;
    run();
    assert.deepEqual(t.data[0], ['a2', '1']);
});

test('строка другой длины, чем колонки, — это смена схемы: плашка вместо подстановки', () => {
    const ws = fakeWs();
    const { t } = load({ ws, user: 'ann', focused: true, rows: ROWS });
    t.liveAttach();
    ws.subs[0].fn(msg({ rows: [{ i: 10, u: 1, o: 1, r: ['a', '1', 'new'] }] }));
    assert.deepEqual(t.data[0], ['a', '1']);
    assert.equal(t.liveBannerText(), 'Структура таблицы изменилась — обновить');
});
