// Мерка к issue #5364: логика списков шаблонов баз в js/db-templates.js (ЛК и меню файлов).
//   — в выбор шаблона при создании базы попадают только одобренные (ver > 0) и только те, которых
//     там ещё нет (CM из разметки не дублируется шаблоном cm из реестра);
//   — действия: модератор одобряет/отклоняет/снимает версию на модерации и снимает одобренную,
//     владелец базы-источника только снимает; отклонённую и снятую трогать нельзя;
//   — таблица версий: версии на модерации сверху, текущая (разворачиваемая в ЛК) отмечена;
//   — итог запроса: ok-ответ сервера, ошибка сервера, не-JSON (обрыв, HTML ошибки).
const assert = require('assert');
const T = require('../js/db-templates.js');

let failures = 0;
function check(name, fn) {
    try { fn(); console.log('PASS: ' + name); } catch (e) { failures++; console.log('FAIL: ' + name + ' — ' + e.message); }
}

const list = [
    { id: 'shop', title: 'Магазин', ver: 2, source: 'src', author: 'ann',
      versions: [{ ver: 1, status: 'approved' }, { ver: 2, status: 'approved' }, { ver: 3, status: 'pending' }] },
    { id: 'cm', title: 'Сопоставление каталогов', ver: 1, versions: [{ ver: 1, status: 'approved' }] },
    { id: 'draft', title: 'Черновик', ver: 0, versions: [{ ver: 1, status: 'rejected' }, { ver: 2, status: 'withdrawn' }] },
];

check('выбор при создании базы: одобренные и без дублей', () => {
    assert.deepStrictEqual(T.optionsToAdd(list, ['RU', 'CM']), [{ value: 'shop', label: 'Магазин (v2)' }]);
    assert.deepStrictEqual(T.optionsToAdd([], ['RU']), []);
    assert.deepStrictEqual(T.optionsToAdd(undefined, undefined), []);
});

check('действия над версией: модератор и владелец', () => {
    assert.deepStrictEqual(T.versionActions('pending', true), ['approved', 'rejected', 'withdrawn']);
    assert.deepStrictEqual(T.versionActions('pending', false), ['withdrawn']);
    assert.deepStrictEqual(T.versionActions('approved', true), ['withdrawn']);
    assert.deepStrictEqual(T.versionActions('approved', false), ['withdrawn']);
    for (const s of ['rejected', 'withdrawn']) {
        assert.deepStrictEqual(T.versionActions(s, true), []);
        assert.deepStrictEqual(T.versionActions(s, false), []);
    }
});

check('таблица версий: на модерации сверху, текущая отмечена', () => {
    const rows = T.versionRows(list, true);
    assert.strictEqual(rows.length, 6);
    assert.strictEqual(rows[0].id + rows[0].ver, 'shop3');
    assert.strictEqual(rows[0].statusText, 'на модерации');
    assert.deepStrictEqual(rows.filter(r => r.current).map(r => r.id + r.ver).sort(), ['cm1', 'shop2']);
    assert.ok(!rows.some(r => r.status === 'rejected' && r.actions.length));
});

check('итог запроса', () => {
    assert.deepStrictEqual(T.resultMessage('{"result":"ok","id":"shop","ver":3,"status":"pending"}'),
        { ok: true, text: 'Версия 3 шаблона shop отправлена на модерацию.' });
    assert.deepStrictEqual(T.resultMessage('{"error":"Имя занято"}'), { ok: false, text: 'Имя занято' });
    const html = T.resultMessage('<html>500</html>');
    assert.strictEqual(html.ok, false);
    assert.strictEqual(T.resultMessage('').ok, false);
});

check('имя шаблона', () => {
    for (const ok of ['cm', 'shop', 'a1', 'abcdefghijklmno']) assert.ok(T.idValid(ok), ok);
    for (const bad of ['c', '1ab', 'Shop', 'my', 'abcdefghijklmnop', 'a-b', '', undefined]) assert.ok(!T.idValid(bad), String(bad));
});

if (failures) { console.log(failures + ' FAIL'); process.exitCode = 1; } else console.log('OK');
