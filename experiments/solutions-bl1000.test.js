// Мерка к ideav/backlogram#1000: картинка-иллюстрация в шапке решения на широком экране — 2/3 ширины,
// картинка без источника (своя схема, как у LLM-маршрутизатора) — во всю ширину.
// rules: none (defect #5657)
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const C = require(path.join(__dirname, '..', 'download', 'solutions', 'app.js'));

const row = extra => Object.assign({ id: '561', 'Решение': 'WFM', 'Опубликовано': '1' }, extra);
const photo = C.normalize(row({ 'Картинка': 's977-bae33c27', 'Источник изображения': 'Julien | Unsplash | https://unsplash.com/photos/x' }));
const scheme = C.normalize(row({ 'Картинка': 's1425a-18be76ac' }));

assert.strictEqual(typeof C.heroFigure, 'function', 'нет Core.heroFigure');
const hp = C.heroFigure(photo), hs = C.heroFigure(scheme);
assert.ok(/^<figure class="sl-hero sl-hero-photo">/.test(hp), hp);
assert.ok(hp.indexOf('class="sl-credit"') > 0, 'у фото подпись источника');
assert.ok(/^<figure class="sl-hero">/.test(hs), hs);
assert.ok(hs.indexOf('sl-credit') < 0, hs);
assert.strictEqual(C.heroFigure(C.normalize(row({}))), '', 'без картинки — пусто');

// стили: фото на широком экране сужено до 66%, у схемы ширина не ограничена
const css = fs.readFileSync(path.join(__dirname, '..', 'download', 'solutions', 'app.css'), 'utf8');
const wide = css.match(/@media \(min-width:(\d+)px\)\{([^}]*\{[^}]*\})*[^}]*\}/g) || [];
assert.ok(wide.some(m => /\.sl-hero-photo\{[^}]*max-width:66%/.test(m)), 'нет сужения .sl-hero-photo в @media (min-width)');
assert.ok(!/\.sl-hero\{[^}]*max-width/.test(css), 'общая .sl-hero не должна сужаться — схемы остаются крупными');
console.log('solutions-bl1000: ok');
