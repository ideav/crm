// Мерка к issue #5452: «Непонятно, как проводить модерацию» — панель модерации в ЛК my
// объясняет, откуда берутся заявки и что с ними делать, и считает версии на модерации.
//   — нет заявок: прямо сказано, что ждущих версий нет, и где владелец базы их создаёт;
//   — есть заявки: число в заголовке подсказки и что делают кнопки Одобрить/Отклонить/Снять.
const assert = require('assert');
const T = require('../js/db-templates.js');

let failures = 0;
function check(name, fn) {
    try { fn(); console.log('PASS: ' + name); } catch (e) { failures++; console.log('FAIL: ' + name + ' — ' + e.message); }
}

const approvedOnly = T.versionRows([{ id: 'cm', title: 'Сопоставление каталогов', ver: 1,
    versions: [{ ver: 1, status: 'approved' }] }], true);
const withPending = T.versionRows([
    { id: 'shop', title: 'Магазин', ver: 1, versions: [{ ver: 1, status: 'approved' }, { ver: 2, status: 'pending' }] },
    { id: 'crm2', title: 'CRM', ver: 0, versions: [{ ver: 1, status: 'pending' }] },
], true);

check('нет заявок: сказано прямо и где их создают', () => {
    const g = T.moderationGuide(approvedOnly);
    assert.strictEqual(g.pending, 0);
    assert.match(g.summary, /нет/i);
    const all = g.steps.join(' ');
    assert.match(all, /Файлы/);
    assert.match(all, /Шаблон базы/);
    assert.match(all, /Зафиксировать версию/);
});

check('есть заявки: число и смысл кнопок', () => {
    const g = T.moderationGuide(withPending);
    assert.strictEqual(g.pending, 2);
    assert.match(g.summary, /2/);
    const all = g.steps.join(' ');
    for (const w of ['Одобрить', 'Отклонить', 'Снять']) assert.ok(all.indexOf(w) >= 0, w);
});

check('пустой реестр', () => {
    const g = T.moderationGuide([]);
    assert.strictEqual(g.pending, 0);
    assert.ok(g.steps.length > 0);
});

if (failures) { console.log(failures + ' FAIL'); process.exit(1); }
console.log('OK');
