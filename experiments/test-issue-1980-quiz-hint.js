const fs = require('fs');
const path = require('path');
const assert = require('assert');

const templatePath = path.join(__dirname, '..', 'templates', 'quiz.html');
const html = fs.readFileSync(templatePath, 'utf8');

function includesRequiredSnippet(snippet, message) {
    assert(html.includes(snippet), message);
}

includesRequiredSnippet('<script src="/js/hints.js"></script>', 'quiz template must load shared hints.js');
includesRequiredSnippet('id="quiz-hint-box"', 'quiz hint box is missing');
includesRequiredSnippet('id="quiz-hint-drag-handle"', 'quiz hint drag handle is missing');
includesRequiredSnippet('id="quiz-hint-1"', 'quiz hint content step is missing');
includesRequiredSnippet('id="quiz-hint-mobile-toggle"', 'quiz mobile hint toggle is missing');
includesRequiredSnippet('onclick="quizHintClose()"', 'quiz hint close button must use hints.js close API');
includesRequiredSnippet("workspace: 'quiz'", 'quiz hint must initialize the quiz workspace');
includesRequiredSnippet('steps: 1', 'quiz hint must declare exactly one step');

// Описание подсказки разбито на НЕСКОЛЬКО абзацев — берём их все до кнопок блока,
// иначе счёт предложений меряет только первый абзац.
const blockMatch = html.match(/<div id="quiz-hint-1"[\s\S]*?(?=<div style="display:flex)/);
assert(blockMatch, 'quiz hint block is missing');
const paragraphs = [...blockMatch[0].matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].map((m) => m[1]);
assert(paragraphs.length, 'quiz hint description paragraph is missing');

const plainText = paragraphs.join(' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const sentences = plainText
    .split(/[.!?]+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

assert(
    sentences.length >= 3 && sentences.length <= 5,
    `quiz hint description must contain 3-5 sentences, found ${sentences.length}`
);
assert(
    plainText.includes('рабочее место') && plainText.includes('форм'),
    'quiz hint should describe the quiz workplace purpose'
);

console.log('issue-1980 quiz hint markup regression passed');
