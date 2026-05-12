const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..');
const planPath = path.join(repoRoot, 'docs', 'INTEGRAM_ARTICLE_SERIES_PLAN.md');
const workspaceDir = path.join(repoRoot, 'docs', 'integram-article-reviews');
const readmePath = path.join(workspaceDir, 'README.md');
const screenshotsKeepPath = path.join(workspaceDir, 'screenshots', '.gitkeep');

if (!fs.existsSync(planPath)) {
    throw new Error('Expected docs/INTEGRAM_ARTICLE_SERIES_PLAN.md to exist');
}

const plan = fs.readFileSync(planPath, 'utf8');
const articleHeadings = [...plan.matchAll(/^### (\d+)\. (.+)$/gm)].map((match) => ({
    number: Number(match[1]),
    title: match[2]
}));

if (articleHeadings.length !== 15) {
    throw new Error(`Expected 15 article topics, found ${articleHeadings.length}`);
}

if (!fs.existsSync(readmePath)) {
    throw new Error('Expected docs/integram-article-reviews/README.md to exist');
}

if (!fs.existsSync(screenshotsKeepPath)) {
    throw new Error('Expected docs/integram-article-reviews/screenshots/.gitkeep to exist');
}

const readme = fs.readFileSync(readmePath, 'utf8');

const requiredFragments = [
    'docs/INTEGRAM_ARTICLE_SERIES_PLAN.md',
    'screenshots/',
    '1-минутный видео-обзор',
    'GitHub issue'
];

for (const fragment of requiredFragments) {
    if (!readme.includes(fragment)) {
        throw new Error(`Expected review workspace README to mention: ${fragment}`);
    }
}

for (const { number, title } of articleHeadings) {
    const paddedNumber = String(number).padStart(2, '0');

    if (!readme.includes(`| ${paddedNumber} |`)) {
        throw new Error(`Expected README to include article slot ${paddedNumber}`);
    }

    if (!readme.includes(title)) {
        throw new Error(`Expected README to include article title: ${title}`);
    }

    if (!readme.includes(`screenshots/${paddedNumber}-`)) {
        throw new Error(`Expected README to reserve a screenshot folder for article ${paddedNumber}`);
    }
}

console.log('PASS issue 2590 article review workspace coverage');
