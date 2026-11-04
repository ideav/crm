// #5269 — живые таблицы: компонент integram-table подписывается на свой тип через
// IntegramWS (js/ws-client.js) и перечитывает данные, когда записи таблицы изменил кто-то
// другой. Пачка событий — одно перечитывание (пауза LIVE_DEBOUNCE); пока ячейка в правке
// или новая строка не сохранена — перечитывание откладывается; правка схемы — перечитать и
// колонки (refreshData). Свои правки в активной вкладке уже на экране — их не перечитываем.
//
// Run with: node --test experiments/ws-table-live-5269.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

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
    const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'integram-table.js'), 'utf8');
    const IntegramTable = vm.runInContext(src + '\n;({ IntegramTable });', sb).IntegramTable;
    const t = Object.create(IntegramTable.prototype);
    t.options = { tableTypeId: '500' };
    t.calls = [];
    t.reload = () => t.calls.push('reload');
    t.refreshData = () => t.calls.push('refreshData');
    const run = () => { const list = timers.splice(0); list.forEach((x) => x.fn()); return list.length; };
    return { t, run, timers };
}

function fakeWs() {
    const ws = { subs: [], enabled: () => true, subscribe(t, fn) { ws.subs.push({ t, fn }); return () => { ws.off = true; }; } };
    return ws;
}

const change = { k: 'change', op: 'update', id: 11, up: 10, t: 501, types: [501, 500] };

test('подписка на свой тип — один раз; без клиента или с live:false — нет', () => {
    const ws = fakeWs();
    const { t } = load({ ws, user: 'ann', focused: true });
    t.liveAttach();
    t.liveAttach();
    assert.deepEqual(ws.subs.map((s) => s.t), [500]);
    const off = load({ ws: undefined, user: 'ann', focused: true }).t;
    assert.doesNotThrow(() => off.liveAttach());
    const ws2 = fakeWs();
    const opt = load({ ws: ws2, user: 'ann', focused: true }).t;
    opt.options.live = false;
    opt.liveAttach();
    assert.equal(ws2.subs.length, 0);
});

test('пачка чужих событий — одно перечитывание после паузы', () => {
    const ws = fakeWs();
    const { t, run } = load({ ws, user: 'ann', focused: true });
    t.liveAttach();
    ws.subs[0].fn({ by: 'bob', reload: false, events: [change] });
    ws.subs[0].fn({ by: 'bob', reload: false, events: [change] });
    assert.deepEqual(t.calls, [], 'не сразу');
    assert.equal(run(), 1, 'один таймер на пачку');
    assert.deepEqual(t.calls, ['reload']);
});

test('своя правка в активной вкладке — без перечитывания; в фоновой вкладке — с ним', () => {
    const ws = fakeWs();
    const a = load({ ws, user: 'ann', focused: true });
    a.t.liveAttach();
    ws.subs[0].fn({ by: 'ann', reload: false, events: [change] });
    a.run();
    assert.deepEqual(a.t.calls, []);
    const ws2 = fakeWs();
    const b = load({ ws: ws2, user: 'ann', focused: false });
    b.t.liveAttach();
    ws2.subs[0].fn({ by: 'ann', reload: false, events: [change] });
    b.run();
    assert.deepEqual(b.t.calls, ['reload']);
});

test('ячейка в правке — перечитывание ждёт; правка схемы — refreshData', () => {
    const ws = fakeWs();
    const { t, run } = load({ ws, user: 'ann', focused: true });
    t.liveAttach();
    t.currentEditingCell = { colId: 1 };
    ws.subs[0].fn({ by: 'bob', reload: false, events: [{ k: 'schema', t: 500 }] });
    run();
    assert.deepEqual(t.calls, [], 'пока правка — не трогаем');
    t.currentEditingCell = null;
    run();
    assert.deepEqual(t.calls, ['refreshData']);
});
