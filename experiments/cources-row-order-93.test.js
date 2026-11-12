// rules: none (defect #5492)
// LMS cources: ядро не отдаёт в JSON_OBJ поле, закрытое роли грантом BARRED, и остальные значения
// строки сдвигаются. api.js раскладывает r[] по именам реквизитов, поэтому для роли из schema.json
// `hide[<роль>]` такие поля пропускаются. Иначе у автора «Опубликован» читается пустым,
// и опубликованный курс выглядит «на проверке».
//
// Run with: node experiments/cources-row-order-93.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const schema = {
    tables: {
        'Курс автора': {
            id: 10,
            req: { 'Владелец': 11, 'Статус': 12, 'Манифест': 13, 'Опубликован': 14 },
            hide: { 'Ученик': ['Манифест'] },
        },
    },
};

function load(role, rec) {
    const ctx = { console, Promise, URLSearchParams };
    ctx.window = ctx;
    ctx.LMS = { role, z: 'cources' };
    ctx.LMSApp = {
        root: '/download/cources/', z: 'cources', mock: false,
        getJSON: () => Promise.resolve(schema),
        fmtUnix: v => 'unix:' + v,
    };
    ctx.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve([rec]) });
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'download', 'cources', 'js', 'api.js'), 'utf8'), ctx);
    const A = ctx.LMSApp;
    return A.loadSchema().then(() => A.list('Курс автора', {})).then(rows => rows[0]);
}

(async () => {
    // автор (Ученик): Манифест вырезан ядром — 4 значения вместо 5
    const own = await load('Ученик', { i: 1, r: ['Курс', '5:lmstest', 'в каталоге', 'Тест'] });
    assert.strictEqual(own['Статус'], 'в каталоге');
    assert.strictEqual(own['Опубликован'], 'Тест', 'после скрытого «Манифеста» значение «Опубликован» не сдвигается');
    assert.ok(!('Манифест' in own) || own['Манифест'] === '', 'скрытое поле пустое');

    // админ видит все поля
    const adm = await load('admin', { i: 1, r: ['Курс', '5:lmstest', 'в каталоге', '/m.json', 'Тест'] });
    assert.strictEqual(adm['Манифест'], '/m.json');
    assert.strictEqual(adm['Опубликован'], 'Тест');
    console.log('ok   cources-row-order-93');
})().catch(e => { console.log('FAIL ' + e.message); process.exit(1); });
