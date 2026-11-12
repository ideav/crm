// Мерка к issue #5465: бронь слота консультации и отмена записи на афише timepad (download/timepad/app.js).
// https://github.com/ideav/crm/issues/5465
//
//   1) слот занимается РАНЬШЕ билета: _m_new в «Слот» (857) с ключом «консультация|день|время» и кодом
//      «~код» в реквизите 889 (маска гостя). Уникальность ключа держит ядро: второй получает warning
//      «Запись уже существует» — это «время занято», билет тогда не создаётся;
//   2) билет консультации — ссылка на консультацию (892) и время слота (894, unix);
//   3) билет не записался — слот освобождается отменой по тому же коду, а не остаётся занятым;
//   4) отмена — _m_new в «Отмена» (858) с «~код» и кодом в 890; код вне формата TP + 8 знаков A–Z/0–9
//      на сервер не уходит (сервер отклоняет его условием when, см. timepad-cancel-guard-5465);
//   5) занятые и прошедшие слоты недоступны; отменить можно консультацию и событие с ёмкостью.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'download', 'timepad', 'app.js'), 'utf8');
global.PoraSchedule = require('../download/timepad/schedule.js');
const calls = [];
let replies = [];
global.fetch = function(url, opt){
    const body = opt && opt.body ? Object.fromEntries(new URLSearchParams(opt.body)) : null;
    calls.push({ url, method: opt && opt.method || 'GET', body });
    const reply = replies.length ? replies.shift() : { id: 1 };
    return Promise.resolve({ status: 200, text: () => Promise.resolve(JSON.stringify(reply)) });
};
global.crypto = require('crypto').webcrypto;
const module_ = { exports: {} };
new Function('module', 'exports', src)(module_, module_.exports);
const tp = module_.exports;

let failures = 0;
async function check(name, fn){
    calls.length = 0; replies = [];
    try { await fn(); console.log('PASS: ' + name); }
    catch(e){ failures++; console.log('FAIL: ' + name + '\n  ' + (e && e.message)); }
}
const day = { kind: 'c', id: 700, day: '2027-03-15', title: 'Разбор', cap: 4 };
const slot = { time: '10:00', key: '700|2027-03-15|10:00', start: 1805094000, end: 1805095800 };

(async () => {
    await check('бронь: сначала слот с ключом и «~кодом», потом билет с консультацией и временем', async () => {
        replies = [{ id: 10, val: slot.key }, { id: 11 }];
        const code = await tp.bookSlot(day, slot, 'XS', 'Анна', 'a@example.com', '');
        assert.strictEqual(calls.length, 2, 'запросов: ' + calls.length);
        assert.strictEqual(calls[0].url, '/timepad/_m_new/857?JSON');
        assert.strictEqual(calls[0].body.t857, slot.key);
        assert.strictEqual(calls[0].body.t889, '~' + code);
        assert.strictEqual(calls[1].url, '/timepad/_m_new/494?JSON');
        assert.strictEqual(calls[1].body.t494, '~' + code, 'тот же код у билета');
        assert.strictEqual(calls[1].body.t892, '700');
        assert.strictEqual(calls[1].body.t894, String(slot.start));
        assert.strictEqual(calls[1].body.t546, 'Анна');
        assert.ok(!('t496' in calls[1].body), 'у билета консультации нет события');
        assert.strictEqual(tp.state.taken[slot.key], 1, 'слот отмечен занятым');
    });

    await check('слот занят («Запись уже существует») — отказ, билет не создаётся', async () => {
        tp.state.taken = {};
        replies = [{ id: 10, warning: 'Запись уже существует' }];
        await assert.rejects(tp.bookSlot(day, slot, 'XS', 'Иван', 'i@example.com', ''), /заняли/);
        assert.strictEqual(calls.length, 1, 'запросов: ' + calls.length);
        assert.strictEqual(tp.state.taken[slot.key], 1, 'время показывается занятым');
    });

    await check('билет не записался — слот освобождается отменой по тому же коду', async () => {
        tp.state.taken = {};
        replies = [{ id: 10 }, [{ error: 'нет доступа' }], { id: 12 }];
        await assert.rejects(tp.bookSlot(day, slot, 'XS', 'Иван', 'i@example.com', ''), /Не удалось оформить/);
        assert.strictEqual(calls.length, 3);
        const code = calls[0].body.t889.slice(1);
        assert.strictEqual(calls[2].url, '/timepad/_m_new/858?JSON');
        assert.strictEqual(calls[2].body.t890, code);
        assert.ok(!tp.state.taken[slot.key], 'слот снова свободен');
    });

    await check('отмена: «Отмена» с «~кодом» и кодом; регистр и пробелы прощаются', async () => {
        replies = [{ id: 20 }];
        assert.strictEqual(await tp.cancelOnServer('  tpzkrl9fm6 ', 'XS'), 'TPZKRL9FM6');
        assert.strictEqual(calls[0].url, '/timepad/_m_new/858?JSON');
        assert.strictEqual(calls[0].body.t858, '~TPZKRL9FM6');
        assert.strictEqual(calls[0].body.t890, 'TPZKRL9FM6');
    });

    await check('код вне формата на сервер не уходит', async () => {
        for(const bad of ['', 'TP%', 'TP%%%%%%%%', 'TPZKRL9FM', 'TP[USER]XX', 'ZZZKRL9FM6', 'TPЖKRL9FM6'])
            await assert.rejects(tp.cancelOnServer(bad, 'XS'), /Код билета/, bad);
        assert.strictEqual(calls.length, 0);
    });

    await check('дни консультации: занятые и прошедшие слоты недоступны', async () => {
        const now = Date.UTC(2027, 2, 15, 7, 10) / 1000;   // 15.03.2027 10:10 МСК
        tp.state.taken = { '700|2027-03-15|11:00': 1 };
        const days = tp.consDays({ id: 700, title: 'Разбор', dates: '15.03.2027, 16.03.2027', timeFrom: '10:00', timeTo: '12:00', step: 30 }, now);
        assert.deepStrictEqual(days.map(d => d.day), ['2027-03-15', '2027-03-16']);
        assert.deepStrictEqual(days[0].slots.map(s => s.time + (s.busy ? '×' : '')), ['10:00×', '10:30', '11:00×', '11:30']);
        assert.strictEqual(days[0].free, 2);
        assert.strictEqual(days[1].free, 4);
        assert.strictEqual(tp.left(days[0]), 2, 'остаток окон');
    });

    await check('день, все слоты которого прошли, с афиши уходит', async () => {
        const now = Date.UTC(2027, 2, 15, 10, 0) / 1000;   // 13:00 МСК, приём до 12:00
        tp.state.taken = {};
        const days = tp.consDays({ id: 700, dates: '15.03.2027', timeFrom: '10:00', timeTo: '12:00', step: 30 }, now);
        assert.deepStrictEqual(days, []);
    });

    await check('что можно отменить', async () => {
        const future = Date.now() / 1000 + 86400;
        assert.strictEqual(tp.cancellable({ kind: 'c', start: future }), true, 'консультация');
        assert.strictEqual(tp.cancellable({ event: 1, cap: 10, start: future }), true, 'событие с ёмкостью');
        assert.strictEqual(tp.cancellable({ event: 1, cap: 0, start: future }), false, 'событие без ёмкости');
        assert.strictEqual(tp.cancellable({ kind: 'c', start: future, cancelled: 1 }), false, 'уже отменён');
        assert.strictEqual(tp.cancellable({ kind: 'c', start: 1000, end: 2000 }), false, 'прошедшее');
    });

    console.log(failures ? '\n' + failures + ' FAIL' : '\nALL PASS');
    if(failures) process.exitCode = 1;
})();
