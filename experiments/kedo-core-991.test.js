// rules: none (defect #5744)
// КЭДО (демо-копия, ideav/backlogram#991): рабочие дни, просрочка, светофор, очередь кадровика, сверка «оператор ↔ ЗУП», повтор передачи.
const test = require('node:test');
const assert = require('node:assert');
const C = require('../download/kedo/js/kedo-core.js');

const HOL = { '2026-11-04': 1 };
const T = '2026-11-26';
const doc = (number, o) => Object.assign({ number, tab: 'ТЛ-00114', type: 'Ознакомление с ЛНА', zupKind: 'Ознакомление с локальным актом', date: '2026-11-18', sent: '2026-11-18', status: 'Отправлен', opId: 'KK-' + number, zup: '' }, o || {});
const signed = (number, o) => doc(number, Object.assign({ status: 'Подписан', signed: '2026-11-19', zup: 'Принят' }, o || {}));
const MAP = { 'Подписано работником': 'Подписан', 'Завершён': 'Подписан', 'Ожидает подписания': 'Отправлен', 'Просмотрен': 'Открыт', 'Отклонён': 'Отказ' };

test('рабочие дни: выходные и праздник не считаются, дата отправки не входит', () => {
    assert.strictEqual(C.workdaysBetween('2026-11-20', T, HOL), 4);
    assert.strictEqual(C.workdaysBetween('2026-11-03', '2026-11-06', HOL), 2);
    assert.strictEqual(C.workdaysBetween(T, T, HOL), 0);
    assert.strictEqual(C.addWorkdays('2026-11-03', 1, HOL), '2026-11-05');
});

test('даты выгрузок в разных форматах сводятся к ISO, мусор — пусто', () => {
    assert.strictEqual(C.toIso('01.02.26'), '2026-02-01');
    assert.strictEqual(C.toIso('2026-02-01 00:00:00'), '2026-02-01');
    assert.strictEqual(C.toIso('5.3.2026'), '2026-03-05');
    assert.strictEqual(C.toIso('вчера'), '');
});

test('просрочка: больше срока рабочих дней, срок типа документа важнее правила, эскалация после порога', () => {
    const R = { overdueDays: 3, escalateDays: 5, dateTolerance: 2 };
    assert.strictEqual(C.docState(doc('1', { sent: '2026-11-23' }), T, HOL, R).overdue, false);
    const s = C.docState(doc('2', { sent: '2026-11-20', status: 'Открыт' }), T, HOL, R);
    assert.strictEqual(s.overdue, true); assert.strictEqual(s.status, 'Просрочен'); assert.strictEqual(s.escalate, false);
    assert.strictEqual(C.docState(doc('3', { sent: '2026-11-13' }), T, HOL, R).escalate, true);
    assert.strictEqual(C.docState(doc('4', { sent: '2026-11-20', limit: 5 }), T, HOL, R).overdue, false);
    assert.strictEqual(C.docState(signed('5', { sent: '2026-11-02' }), T, HOL, R).overdue, false, 'подписанный не бывает просроченным');
});

test('светофор: «подписан, но не в ЗУП» считает и ошибки передачи, и непереданные', () => {
    const L = C.lights([signed('1'), signed('2', { zup: 'Не передан' }), signed('3', { zup: 'Ошибка передачи', error: 'Таймаут' }), doc('4', { sent: '2026-11-13' }), doc('5', { status: 'Отказ' }), doc('6', { status: 'Подготовлен', sent: '' })], T, HOL);
    assert.strictEqual(L.signedNotZup, 2); assert.strictEqual(L.zupErrors, 1); assert.strictEqual(L.overdue, 1);
    assert.strictEqual(L.refused, 1); assert.strictEqual(L.prepared, 1); assert.strictEqual(L.done, 1); assert.strictEqual(L.total, 6);
});

test('очередь «мне сегодня»: ошибки, отказы и эскалации первыми, документ в срок в очередь не попадает', () => {
    const q = C.queue([doc('ok', { sent: '2026-11-25' }), doc('late', { sent: '2026-11-19' }), doc('esc', { sent: '2026-11-13' }), signed('err', { zup: 'Ошибка передачи', error: 'Таймаут' }), doc('ref', { status: 'Отказ', reason: 'Не приходит СМС' }), doc('today', { sent: '2026-11-23' })], T, HOL);
    assert.deepStrictEqual(q.map(i => i.doc.number), ['esc', 'err', 'ref', 'late', 'today']);
    assert.strictEqual(q[0].action, 'Эскалировать руководителю');
    assert.strictEqual(q.find(i => i.doc.number === 'ref').note, 'Не приходит СМС');
});

test('повтор передачи: таймаут лечится, «сотрудник не найден» — нет, неподписанное и уже принятое не передаются', () => {
    assert.strictEqual(C.retryOutcome(signed('1', { zup: 'Ошибка передачи', error: 'Таймаут обмена' })).ok, true);
    const bad = C.retryOutcome(signed('2', { zup: 'Ошибка передачи', error: 'Сотрудник ТЛ-00417 не найден в ЗУП' }));
    assert.strictEqual(bad.ok, false); assert.match(bad.hint, /табельный/);
    assert.strictEqual(C.retryOutcome(doc('3')).ok, false);
    assert.strictEqual(C.retryOutcome(signed('4')).ok, false);
});

test('статусы операторов сводятся к единому справочнику без учёта регистра, ё и пробелов; неизвестный — null', () => {
    assert.strictEqual(C.normStatus('  подписано  работником ', MAP), 'Подписан');
    assert.strictEqual(C.normStatus('Завершен', MAP), 'Подписан');
    assert.strictEqual(C.normStatus('На доработке', MAP), null);
});

test('сверка: подписано у оператора и нет в ЗУП, устаревший статус, пропажа у оператора, чужой табельный, неизвестный статус', () => {
    const docs = [signed('a', { zup: 'Не передан' }), signed('b'), doc('c', { status: 'Открыт' }), doc('d'), doc('e', { status: 'Подготовлен', sent: '', opId: '' })];
    const rows = [
        { opId: 'KK-a', tab: 'ТЛ-00114', kind: 'Ознакомление с локальным актом', date: '2026-11-18', opStatus: 'Завершён' },
        { opId: 'KK-b', tab: 'ТЛ-00114', kind: 'Ознакомление с локальным актом', date: '2026-11-18', opStatus: 'Подписано работником' },
        { opId: 'KK-c', tab: 'ТЛ-00114', kind: 'Ознакомление с локальным актом', date: '2026-11-18', opStatus: 'Подписано работником' },
        { opId: 'KK-x', tab: 'ТЛ-00999', fio: 'Иванов И.И.', kind: 'Отпуск', date: '2026-11-18', opStatus: 'Подписан ' + '' },
        { opId: 'KK-y', tab: 'ТЛ-00114', kind: 'Отпуск', date: '2026-11-18', opStatus: 'На доработке' }];
    const R = C.reconcile(docs, rows, Object.assign({ 'Подписан': 'Подписан' }, MAP), { 'ТЛ-00114': 'Морозов Денис Алексеевич' }, 2);
    const n = k => R.groups[k].map(i => (i.doc || {}).number || i.row.opId);
    assert.deepStrictEqual(n('signedNotInZup'), ['a']);
    assert.deepStrictEqual(n('ok'), ['b']);
    assert.deepStrictEqual(n('statusStale'), ['c']);
    assert.deepStrictEqual(n('missingAtOperator'), ['d'], 'подготовленный, но не отправленный — не пропажа');
    assert.deepStrictEqual(n('unknownEmp'), ['KK-x']);
    assert.deepStrictEqual(n('unknownStatus'), ['KK-y']);
    assert.strictEqual(R.problems, 5);
});

test('сверка без ID: составной ключ табельный + вид + дата в допуске; вне допуска строка не склеивается молча', () => {
    const docs = [signed('a', { opId: 'KK-1', date: '2026-11-10' })];
    const row = d => ({ opId: '', tab: 'ТЛ-00114', kind: 'ознакомление с локальным актом', date: d, opStatus: 'Завершён' });
    const R1 = C.reconcile(docs, [row('2026-11-11')], MAP, { 'ТЛ-00114': 'x' }, 2);
    assert.strictEqual(R1.byComposite, 1); assert.strictEqual(R1.groups.ok.length, 1);
    const R2 = C.reconcile(docs, [row('2026-11-20')], MAP, { 'ТЛ-00114': 'x' }, 2);
    assert.strictEqual(R2.groups.notInRegistry.length, 1); assert.strictEqual(R2.groups.missingAtOperator.length, 1);
});

test('CSV оператора: разделитель ; кавычки, BOM и русские заголовки; нехватка колонок видна', () => {
    const csv = '﻿Таб. №;ФИО;Вид документа;ID;Дата документа;Статус;Дата подписания\r\nТЛ-00114;"Морозов; Денис";Отпуск;KK-1;01.11.26;Завершён;02.11.2026\r\n';
    const m = C.mapExport(C.parseCsv(csv));
    assert.deepStrictEqual(m.missing, []);
    assert.deepStrictEqual(m.rows[0], { tab: 'ТЛ-00114', fio: 'Морозов; Денис', kind: 'Отпуск', opId: 'KK-1', date: '2026-11-01', opStatus: 'Завершён', signed: '2026-11-02' });
    assert.deepStrictEqual(C.mapExport(C.parseCsv('ФИО,Статус\nА,Б')).missing, ['tab', 'kind']);
});

test('роль из шаблона распознаётся в любом регистре', () => {
    assert.strictEqual(C.roleKey('Директор по персоналу'), 'hrd');
    assert.strictEqual(C.roleKey('специалист по кадрам'), 'hr');
    assert.strictEqual(C.roleKey('Руководитель подразделения'), 'manager');
    assert.strictEqual(C.roleKey('Сотрудник'), 'employee');
    assert.strictEqual(C.roleKey('admin'), 'admin');
});

test('подсказка сотруднику: срок подписи по рабочим дням, подписанное и принятое — без действий', () => {
    assert.strictEqual(C.employeeHint(doc('1', { sent: '2026-11-25' }), T, HOL), 'Нужно подписать до 30.11.2026.');
    assert.match(C.employeeHint(doc('2', { sent: '2026-11-19' }), T, HOL), /срок прошёл 2 раб\. дн\./);
    assert.match(C.employeeHint(signed('3'), T, HOL), /принят в учёте/);
    assert.match(C.employeeHint(signed('4', { zup: 'Не передан' }), T, HOL), /переносит/);
});

test('правила из таблицы «Правило КЭДО» перекрывают значения по умолчанию', () => {
    const r = C.rulesFrom([{ name: 'Порог просрочки, раб. дней', value: '5' }, { name: 'Допуск сверки по дате, дней', value: '0' }]);
    assert.strictEqual(r.overdueDays, 5); assert.strictEqual(r.escalateDays, 5); assert.strictEqual(r.dateTolerance, 0);
});
