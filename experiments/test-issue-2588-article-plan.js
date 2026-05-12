const fs = require('fs');
const path = require('path');

const docPath = path.join(__dirname, '..', 'docs', 'INTEGRAM_ARTICLE_SERIES_PLAN.md');

if (!fs.existsSync(docPath)) {
    throw new Error('Expected docs/INTEGRAM_ARTICLE_SERIES_PLAN.md to exist');
}

const doc = fs.readFileSync(docPath, 'utf8');

const requiredFragments = [
    'Excel',
    'Google Sheets',
    'Airtable',
    'Notion',
    'заказной разработки',
    'вайб-кодинга',
    '1 048 576',
    '150 000',
    'локально',
    'права доступа',
    'API',
    'HTML-шаблоны'
];

for (const fragment of requiredFragments) {
    if (!doc.includes(fragment)) {
        throw new Error(`Expected article plan to mention: ${fragment}`);
    }
}

const articleHeadingCount = (doc.match(/^### \d+\./gm) || []).length;

if (articleHeadingCount < 12) {
    throw new Error(`Expected at least 12 article topics, found ${articleHeadingCount}`);
}

console.log('PASS issue 2588 article plan coverage');
