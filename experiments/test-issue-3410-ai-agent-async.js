/*
 * Regression test for issue #3410
 * https://github.com/ideav/crm/issues/3410
 *
 * Клиент ИИ-агента (js/ai-agent-chat.js) во время ожидания показывает, что агент
 * думает, а при долгом ожидании — что нужно ещё время / задача в очереди.
 * Проверяем чистые функции выбора текста и извлечения ответа/ошибки без браузера
 * (модуль экспортируется через module.exports, авто-init не запускается без DOM).
 */
'use strict';

var assert = require('assert');
var agent = require('../js/ai-agent-chat.js');

var failures = 0;
function check(cond, name) {
    if (cond) {
        console.log('PASS: ' + name);
    } else {
        console.log('FAIL: ' + name);
        failures++;
    }
}

// Модуль загрузился без DOM и отдал объект агента.
check(agent && typeof agent.waitMessage === 'function', 'module exports the agent without needing a DOM');

// waitMessage: эскалация по времени ожидания.
check(agent.waitMessage(0).indexOf('Думаю') === 0, 'waitMessage: instant -> "Думаю над ответом…"');
check(agent.waitMessage(5000).indexOf('Думаю') === 0, 'waitMessage: <12s -> still "Думаю…"');
check(agent.waitMessage(20000).indexOf('до минуты') !== -1, 'waitMessage: 12..45s -> "может занять до минуты"');
check(agent.waitMessage(60000).indexOf('очередь') !== -1, 'waitMessage: >45s -> "поставлена в очередь"');
check(agent.waitMessage(60000).indexOf('другого браузера') !== -1, 'waitMessage: long wait mentions cross-browser recovery');

// statusMessage: короткий текст в шапке.
check(agent.statusMessage(0) === 'ИИ-агент думает…', 'statusMessage: instant -> "ИИ-агент думает…"');
check(agent.statusMessage(20000).indexOf('ещё немного времени') !== -1, 'statusMessage: 12..45s -> "нужно ещё немного времени"');
check(agent.statusMessage(60000).indexOf('очереди') !== -1, 'statusMessage: >45s -> "Задача в очереди"');

// Пороги монотонны (текст меняется ровно дважды).
check(agent.waitMessage(11999) !== agent.waitMessage(12000), 'waitMessage threshold at 12s');
check(agent.waitMessage(44999) !== agent.waitMessage(45000), 'waitMessage threshold at 45s');

// getAssistantContent: достаёт ответ из разных форм результата задачи.
check(agent.getAssistantContent({ assistant: { content: 'привет' } }) === 'привет', 'getAssistantContent: assistant.content');
check(agent.getAssistantContent({ content: 'x' }) === 'x', 'getAssistantContent: top-level content');
check(agent.getAssistantContent({ message: 'm' }) === 'm', 'getAssistantContent: message fallback');
check(agent.getAssistantContent(null) === '', 'getAssistantContent: null -> empty');
check(agent.getAssistantContent({}) === '', 'getAssistantContent: unknown shape -> empty');

// getErrorText: достаёт текст ошибки.
check(agent.getErrorText({ error: 'нет оплаты' }) === 'нет оплаты', 'getErrorText: string error');
check(agent.getErrorText({ error: { message: 'oops' } }) === 'oops', 'getErrorText: object error.message');
check(agent.getErrorText(null) === '', 'getErrorText: null -> empty');

// getStatusUrl: формирует адрес опроса статуса по id и последней задачи.
agent.getCurrentDbName = function () { return 'acme'; };
check(agent.getStatusUrl('abc') === '/acme/ai/agent?JSON=1&job=abc', 'getStatusUrl: by job id');
check(agent.getStatusUrl(null) === '/acme/ai/agent?JSON=1&latest=1', 'getStatusUrl: latest');

assert.ok(true);
console.log('');
if (failures) {
    console.log('FAILED: ' + failures + ' check(s) failed');
    process.exit(1);
}
console.log('ALL TESTS PASSED');
