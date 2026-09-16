/*
 * Презентации партнёрского шаблона (issue #4954): одна для партнёра, вторая —
 * та, что он показывает заказчику.
 *
 * Проверяется не «есть ли слова», а то, что расходится молча и дорого: условия
 * из презентации обязаны совпадать с утверждёнными решениями §7 и нормативом
 * пилота. Продающий документ, разошедшийся с договорённостями, обнаруживают уже
 * на переговорах.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const partner = read('docs/xcom-matching/deck-partner.md');
const client = read('docs/xcom-matching/deck-client.md');
const decisions = read('docs/partner-template-4816-decisions.md');
const protocol = read('docs/xcom-matching/pilot-protocol.md');

// --- Условия партнёрства совпадают с утверждёнными ---------------------------

const discount = (decisions.match(/скидка\s*—?\s*(\d+)\s*%/i) || decisions.match(/(\d+)%\s*от публичной цены/i) || [])[1];
assert(discount, 'в решениях §7 не нашёлся процент партнёрской скидки — проверьте формулировку');
assert(new RegExp(discount + '\\s*%').test(partner),
    `презентация партнёра обязана называть утверждённую скидку ${discount}%`);

const target = (protocol.match(/(\d+)\s*минут/) || [])[1];
assert(target, 'в протоколе пилота не нашёлся целевой норматив');
[['партнёра', partner], ['клиента', client]].forEach(([who, deck]) => {
    assert(new RegExp(target).test(deck), `презентация ${who} обязана называть тот же норматив (${target})`);
});

// Норматив — цель, а не обещание клиенту: оба документа проговаривают это словом.
assert(/целев/i.test(partner) && /целев/i.test(client),
    'норматив внедрения должен быть назван целевым, иначе он читается как обещание');

// --- Презентации решают РАЗНЫЕ задачи ---------------------------------------

// Партнёрская объясняет устройство и границу ответственности.
['Первичная настройка', 'Тонкая настройка', 'Сложная настройка', 'граница', 'Экономика']
    .forEach(topic => assert(new RegExp(topic, 'i').test(partner), `у партнёра раскрыта тема: ${topic}`));

// Клиентская не вываливает наружу внутреннюю кухню партнёрства.
['скидк', 'recurring', 'маржа', 'кастомный проект', 'issue']
    .forEach(topic => assert(!new RegExp(topic, 'i').test(client),
        `во внешней презентации не должно быть внутренней темы: ${topic}`));

// --- Формат клиентской презентации ------------------------------------------

const slides = client.split(/\n## Слайд /).slice(1);
assert(slides.length >= 10, `клиентская презентация должна быть разбита на слайды, найдено: ${slides.length}`);
slides.forEach((slide, index) => {
    assert(/\*Говорить:/.test(slide),
        `у слайда ${index + 1} нет подсказки «Говорить» — презентацию показывает партнёр, а не автор`);
});

// --- Честность вместо цифр ---------------------------------------------------

assert(/Чего не обещаем/i.test(client), 'клиентская презентация обязана называть границы вслух');
assert(/не обещается|не обещаем/i.test(partner), 'партнёрская презентация обязана называть ограничения');

// Выдуманная экономия — главный способ потерять доверие на первой же проверке.
[['партнёра', partner], ['клиента', client]].forEach(([who, deck]) => {
    const invented = deck.match(/в \d+ раз[а]? (быстрее|дешевле)|экономия \d+%|на \d+% (быстрее|дешевле)/i);
    assert(!invented, `в презентации ${who} появилась непроверенная метрика: ${invented && invented[0]}`);
});

// --- Слайды: те же правила, что и у текстовых версий ------------------------

const slidesPartner = read('docs/xcom-matching/slides/deck-partner.html');
const slidesClient = read('docs/xcom-matching/slides/deck-client.html');

[['партнёра', slidesPartner, partner], ['клиента', slidesClient, client]].forEach(([who, deck]) => {
    const invented = deck.match(/в \d+ раз[а]? (быстрее|дешевле)|экономия \d+%|на \d+% (быстрее|дешевле)/i);
    assert(!invented, `в слайдах ${who} появилась непроверенная метрика: ${invented && invented[0]}`);
    assert(new RegExp(target).test(deck), `слайды ${who} обязаны называть тот же норматив (${target})`);
    assert(/целев/i.test(deck), `в слайдах ${who} норматив должен быть назван целевым`);
});

assert(new RegExp(discount + '\\s*%').test(slidesPartner), `слайды партнёра называют утверждённую скидку ${discount}%`);
['скидк', 'маржа', 'кастом'].forEach(topic => assert(!new RegExp(topic, 'i').test(slidesClient),
    `во внешних слайдах не должно быть внутренней темы: ${topic}`));

// Колода разбирается так же, как её читает собственный сценарий показа, и
// утверждения делаются о ДАННЫХ разбора — тексте подсказок и значениях токенов.
function slideNotes(html) {
    return html.split('<section class="slide"').slice(1).map((slide) => {
        const found = slide.match(/<aside class="notes-src">([\s\S]*?)<\/aside>/);
        return found ? found[1].trim() : '';
    });
}

const htmlNotes = slideNotes(slidesClient);
assert(htmlNotes.length >= 10, `клиентская колода должна состоять из слайдов, найдено: ${htmlNotes.length}`);
assert.strictEqual(htmlNotes.filter(Boolean).length, htmlNotes.length,
    `подсказка выступающему есть не у всех слайдов: пустых ${htmlNotes.filter(note => !note).length}`);
htmlNotes.forEach((note, index) => assert(note.length > 40,
    `подсказка слайда ${index + 1} слишком коротка, чтобы помочь на показе: «${note}»`));

// Объявления одного селектора → словарь свойств.
function declarations(css, selector) {
    const start = css.indexOf(selector + ' {');
    if (start === -1) return {};
    const block = css.slice(start + selector.length, css.indexOf('}', start));
    const result = {};
    block.replace(/([\w-]+)\s*:\s*([^;]+);/g, (all, name, value) => { result[name] = value.trim(); return all; });
    return result;
}

// Страница рисуется в теме зрителя, и у неё три состояния: тёмная, светлая и
// системная — в последней на корне нет никакой пометки. Поэтому полный набор
// токенов обязан жить на голом `:root`, а фон body — браться из токена: иначе
// в системной теме страница возьмёт фон хоста и покажет текст чужой темы.
[['партнёра', slidesPartner], ['клиента', slidesClient]].forEach(([who, deck]) => {
    const rootTokens = declarations(deck, ':root');
    ['--ground', '--surface', '--ink', '--accent', '--rule'].forEach(token => assert(
        rootTokens[token], `в слайдах ${who} токен ${token} не объявлен на голом :root`));
    assert.strictEqual(declarations(deck, 'body').background, 'var(--ground)',
        `в слайдах ${who} фон body должен браться из токена`);
});

console.log('OK: test-issue-4954-xcom-decks');
