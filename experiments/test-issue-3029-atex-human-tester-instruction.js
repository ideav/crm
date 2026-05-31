/*
 * Regression/documentation test for issue #3029.
 *
 * The manual tester instruction must explicitly cover the production checks
 * requested in the issue: material receipt, order entry, executor assignment,
 * new cut type creation, returning remainder/finished stock to warehouse,
 * defect entry, and assignment to the sleeve cutter.
 *
 * Run with: node experiments/test-issue-3029-atex-human-tester-instruction.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const docPath = path.join(root, 'docs', 'atex_human_tester_instruction_3029.md');
const indexPath = path.join(root, 'docs', 'atex_workplaces.md');
const metadata = JSON.parse(fs.readFileSync(path.join(root, 'docs', 'atex_metadata.json'), 'utf8'));

assert(fs.existsSync(docPath), 'docs/atex_human_tester_instruction_3029.md exists');

const doc = fs.readFileSync(docPath, 'utf8');
const index = fs.readFileSync(indexPath, 'utf8');

function includes(text, message) {
    assert(doc.includes(text), message || 'document includes ' + text);
}

[
    '#3029',
    'АТХ-3029',
    'Инструкция для человека-тестировщика',
    'Поступление материалов',
    'Ввод заказа',
    'Создание нового типа резки',
    'Распределение заказа по исполнителям',
    'Ввод брака',
    'Назначение на втулкорез',
    'Оприходование остатка на склад',
    '/atex/intake',
    '/atex/orders',
    '/atex/cut-calc',
    '/atex/production-planning',
    '/atex/slitter',
    '/atex/sleeve-cutter',
    '/atex/warehouse',
    '/atex/dashboards',
    'Получено, м²: 3640',
    'Остаток, м²: 3640',
    'Итого ножей = 18',
    'Остаток, мм = 20',
    'Слиттер: SL-3029',
    'Брак, м²: 12',
    'Втулкорез: TC-3029',
    'Кол-во факт: 10'
].forEach(function(text) {
    includes(text);
});

assert(
    /Поступление материалов[\s\S]*Ввод заказа[\s\S]*Создание нового типа резки[\s\S]*Распределение заказа по исполнителям[\s\S]*Ввод брака[\s\S]*Назначение на втулкорез[\s\S]*Оприходование остатка на склад/.test(doc),
    'instruction keeps the requested manual test steps in the intended flow'
);
assert(
    /Распределение заказа по исполнителям[\s\S]*SL-3029[\s\S]*Обеспечение[\s\S]*Зарезервировано/.test(doc),
    'executor assignment section routes the order position to a slitter through production planning'
);
assert(
    /Назначение на втулкорез[\s\S]*TC-3029[\s\S]*Ожидает[\s\S]*В работе[\s\S]*Готово/.test(doc),
    'sleeve cutter section assigns a tube cutter and covers status transitions'
);
assert(
    /Оприходование остатка на склад[\s\S]*Партия ГП[\s\S]*Адрес хранения[\s\S]*Есть[\s\S]*Зарезервирован[\s\S]*Отгружен/.test(doc),
    'warehouse remainder/finished-stock section covers posting to stock and shipment statuses'
);
assert(
    index.includes('atex_human_tester_instruction_3029.md'),
    'docs/atex_workplaces.md links the issue #3029 human tester instruction'
);

function table(name) {
    const item = metadata.find(function(t) { return t.val === name; });
    assert(item, 'metadata contains table ' + name);
    return item;
}

function req(meta, name) {
    const item = (meta.reqs || []).find(function(r) { return r.val === name; });
    assert(item, meta.val + ' contains requisite ' + name);
}

[
    'Вид сырья',
    'Слиттер',
    'Втулкорез',
    'Клиент',
    'Тип резки',
    'Полоса',
    'Заказ',
    'Позиция заказа',
    'Партия сырья',
    'Производственная резка',
    'Обеспечение',
    'Расход сырья',
    'Событие смены',
    'Задание на втулки',
    'Партия ГП'
].forEach(table);

[
    ['Партия сырья', ['Вид сырья', 'Дата прихода', 'Получено, м²', 'Остаток, м²']],
    ['Заказ', ['Клиент', 'Пользователь', 'Дата создания', 'Статус', 'Лидер', 'Примечания']],
    ['Позиция заказа', ['Кол-во', 'Вид сырья', 'Тип резки', 'Ширина, мм', 'Длина, м', 'Диаметр втулки', 'Статус']],
    ['Тип резки', ['Вид сырья', 'Ширина входа, мм', 'Допуск, мм', 'Итого ножей', 'Остаток, мм']],
    ['Полоса', ['Ширина, мм', 'Количество', 'Назначение']],
    ['Производственная резка', ['Слиттер', 'Тип резки', 'Партия сырья', 'Дата план', 'Статус', 'Счётчик нач.', 'Счётчик кон.', 'Погонаж факт, м', 'Брак, м²']],
    ['Обеспечение', ['Метраж, м', 'Производственная резка', 'Партия ГП', 'Статус']],
    ['Расход сырья', ['Израсходовано, м²', 'Партия сырья']],
    ['Задание на втулки', ['Кол-во план', 'Втулкорез', 'Диаметр, мм', 'Кол-во факт', 'Статус']],
    ['Партия ГП', ['Производственная резка', 'Ширина, мм', 'Кол-во рулонов', 'Метраж, м', 'Адрес хранения', 'Статус']]
].forEach(function(pair) {
    const meta = table(pair[0]);
    pair[1].forEach(function(name) { req(meta, name); });
});

console.log('issue-3029 atex human tester instruction: ok');
