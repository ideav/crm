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

const paragraphMatch = html.match(/<div id="quiz-hint-1"[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/);
assert(paragraphMatch, 'quiz hint description paragraph is missing');

const plainText = paragraphMatch[1]
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
