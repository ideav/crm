// rules: none (defect #5753)
// Бизнес-клуб (демо-копия, ideav/backlogram#1024): взносы и продления, должники, приём заявки, места и лист ожидания, явка, сегменты, поиск по каталогу.
const test = require('node:test');
const assert = require('node:assert');
const C = require('../download/netclub/js/netclub-core.js');

const TODAY = '2026-11-26';
const mem = (name, o) => Object.assign({ name, status: 'Активен', until: '2027-06-01', company: '', position: '', sphere: '', does: '', seeks: '', offers: '' }, o || {});
const fee = (no, member, o) => Object.assign({ no, member, sum: 100000, from: '2026-01-01', to: '2027-01-01', due: '2026-01-10', status: 'Оплачен', paid: '2026-01-05' }, o || {});
const tariff = { name: 'Резидент · год', sum: 180000, months: 12 };

test('даты: месяцы с переносом конца месяца, ДД.ММ.ГГГГ в ISO', () => {
    assert.strictEqual(C.addMonths('2026-01-31', 1), '2026-02-28');
    assert.strictEqual(C.addMonths('2026-11-26', 3), '2027-02-26');
    assert.strictEqual(C.toIso('05.12.2026'), '2026-12-05');
    assert.strictEqual(C.diffDays('2026-11-20', TODAY), 6);
});

test('роль определяется без учёта регистра', () => {
    assert.strictEqual(C.roleKey('Организатор'), 'owner');
    assert.strictEqual(C.roleKey('менеджер КЛУБА'), 'manager');
    assert.strictEqual(C.roleKey('Участник клуба'), 'member');
    assert.strictEqual(C.roleKey('admin'), 'owner');
});

test('состояние счёта: оплачен, просрочен только после срока, ожидает до срока', () => {
    assert.strictEqual(C.feeState(fee('1', 'A'), TODAY), 'paid');
    assert.strictEqual(C.feeState(fee('2', 'A', { status: 'Выставлен', paid: '', due: '2026-11-25' }), TODAY), 'overdue');
    assert.strictEqual(C.feeState(fee('3', 'A', { status: 'Выставлен', paid: '', due: TODAY }), TODAY), 'due');
});

test('должники: только просроченные, давние первыми, сумма и число людей', () => {
    const fees = [fee('1', 'Б', { status: 'Выставлен', paid: '', due: '2026-11-20', sum: 98000 }), fee('2', 'А', { status: 'Выставлен', paid: '', due: '2026-10-10' }),
        fee('3', 'А', { status: 'Выставлен', paid: '', due: '2026-11-01', sum: 50000 }), fee('4', 'В', { status: 'Выставлен', paid: '', due: '2026-12-05' }), fee('5', 'Г')];
    const d = C.debtors(fees, TODAY);
    assert.deepStrictEqual(d.list.map(f => f.no), ['2', '3', '1']);
    assert.strictEqual(d.list[0].days, 47);
    assert.strictEqual(d.sum, 248000);
    assert.strictEqual(d.people, 2);
});

test('продления в окне 30 дней: оплачено / счёт выставлен / нужно выставить; вне окна и вышедшие не попадают', () => {
    const ms = [mem('А', { until: '2026-12-05' }), mem('Б', { until: '2026-12-11' }), mem('В', { until: '2026-12-20' }), mem('Г', { until: '2027-01-15' }), mem('Д', { until: '2026-12-01', status: 'Вышел' })];
    const fees = [fee('1', 'А', { from: '2026-12-05', status: 'Выставлен', paid: '', due: '2026-12-05' }), fee('2', 'Б', { from: '2026-12-11', paid: '2026-11-18' }), fee('3', 'В', { from: '2025-12-20' })];
    const r = C.renewals(ms, fees, TODAY, 30);
    assert.deepStrictEqual(r.map(x => x.member.name + ':' + x.state), ['А:issued', 'Б:paid', 'В:need']);
    assert.strictEqual(r[0].days, 9);
});

test('приостановка: активный без оплаты дольше льготного периода', () => {
    const ms = [mem('А', { until: '2026-10-20' }), mem('Б', { until: '2026-11-01' }), mem('В', { until: '2026-10-01' })];
    const fees = [fee('1', 'В', { from: '2026-10-01', paid: '2026-10-02' })];
    assert.deepStrictEqual(C.toSuspend(ms, fees, TODAY, 30).map(m => m.name), ['А']);
});

test('клик 1: «Принять» даёт участника со сроком членства по тарифу и счёт с новым номером и сроком оплаты', () => {
    const app = { name: 'Кравченко Олег', company: 'Облако-НН', stage: 'Решение', sponsor: 'Тимофеев' };
    const r = C.acceptApplication(app, tariff, [fee('ВЗ-0081', 'X'), fee('ВЗ-0007', 'Y')], TODAY, C.parseSettings({ 'Дней на оплату счёта': '10' }));
    assert.strictEqual(r.member.status, 'Принят');
    assert.strictEqual(r.member.joined, TODAY);
    assert.strictEqual(r.member.until, '2027-11-26');
    assert.strictEqual(r.member.sponsor, 'Тимофеев');
    assert.deepStrictEqual([r.fee.no, r.fee.sum, r.fee.due, r.fee.status], ['ВЗ-0082', 180000, '2026-12-06', 'Выставлен']);
    assert.strictEqual(r.member.login, 'kravchenko');
    assert.strictEqual(r.fee.login, 'kravchenko', 'у счёта логин плательщика не пустой: иначе маска участника его не держит');
    assert.strictEqual(C.acceptApplication(app, tariff, [], TODAY, null, { logins: ['kravchenko'] }).member.login, 'kravchenko2');
    assert.throws(() => C.acceptApplication(Object.assign({}, app, { stage: 'Принята' }), tariff, [], TODAY), /уже принята/);
    assert.throws(() => C.acceptApplication(app, null, [], TODAY), /тариф/);
});

test('воронка: шаг вперёд, принять - только организатор и только из «Решение»', () => {
    assert.ok(C.canMove('Новая', 'Интервью', 'manager'));
    assert.ok(!C.canMove('Новая', 'Решение', 'manager'));
    assert.ok(C.canMove('Решение', 'Принята', 'owner'));
    assert.ok(!C.canMove('Решение', 'Принята', 'manager'));
    assert.ok(!C.canMove('Интервью', 'Принята', 'owner'));
    assert.ok(C.canMove('Интервью', 'Отклонена', 'manager'));
    assert.ok(!C.canMove('Принята', 'Отклонена', 'owner'));
});

const ev = { name: 'Завтрак', date: '2026-12-03', limit: 3, status: 'Открыта запись' };
const reg = (id, member, status, ord) => ({ id, event: 'Завтрак', member, status, ord });

test('клик 2: запись - пока есть места «Записан», дальше лист ожидания с позицией; повтор - ошибка', () => {
    const regs = [reg('1', 'А', 'Записан', 1), reg('2', 'Б', 'Записан', 2), reg('3', 'В', 'Отменил', 3)];
    assert.deepStrictEqual(C.registerDecision(ev, regs, 'Г', TODAY), { status: 'Записан', ord: 4, waitPos: 0 });
    regs.push(reg('4', 'Г', 'Записан', 4));
    assert.deepStrictEqual(C.registerDecision(ev, regs, 'Д', TODAY), { status: 'Лист ожидания', ord: 5, waitPos: 1 });
    assert.throws(() => C.registerDecision(ev, regs, 'А', TODAY), /уже записан/);
    assert.ok(C.registerDecision(ev, regs, 'В', TODAY), 'отменивший может записаться снова');
    assert.throws(() => C.registerDecision(Object.assign({}, ev, { date: '2026-11-12' }), regs, 'Е', TODAY), /прошло/);
});

test('отмена записи переводит первого из листа ожидания; отмена из листа ожидания никого не двигает', () => {
    const regs = [reg('1', 'А', 'Записан', 1), reg('2', 'Б', 'Записан', 2), reg('3', 'В', 'Записан', 3), reg('5', 'Е', 'Лист ожидания', 6), reg('4', 'Д', 'Лист ожидания', 5)];
    assert.deepStrictEqual(C.cancelChanges(ev, regs, '2', true), [{ id: '2', status: 'Отменил' }, { id: '4', status: 'Записан', promoted: 'Д' }]);
    assert.deepStrictEqual(C.cancelChanges(ev, regs, '2', false), [{ id: '2', status: 'Отменил' }]);
    assert.deepStrictEqual(C.cancelChanges(ev, regs, '5', true), [{ id: '5', status: 'Отменил' }]);
});

test('места по сводке отчёта: участнику без доступа к чужим записям', () => {
    const rows = [{ 'Событие': 'Завтрак', 'Статус': 'Записан', 'Записей': '3' }, { 'Событие': 'Завтрак', 'Статус': 'Лист ожидания', 'Записей': '2' }, { 'Событие': 'Другое', 'Статус': 'Записан', 'Записей': '9' }];
    const s = C.seatsFromReport(ev, rows);
    assert.deepStrictEqual([s.taken, s.waitCount, s.free], [3, 2, 0]);
});

test('явка: пришли / записаны по прошедшим событиям, будущие и отменившие не считаются', () => {
    const evs = [{ name: 'E1', date: '2026-11-12', limit: 12 }, { name: 'E2', date: '2026-11-20', limit: 20 }, { name: 'E3', date: '2026-12-03', limit: 12 }];
    const regs = [{ event: 'E1', status: 'Пришёл' }, { event: 'E1', status: 'Не пришёл' }, { event: 'E1', status: 'Отменил' }, { event: 'E2', status: 'Пришёл' }, { event: 'E2', status: 'Пришёл' }, { event: 'E3', status: 'Записан' }];
    const a = C.attendance(evs, regs, TODAY);
    assert.deepStrictEqual(a.rows.map(r => r.event.name + ':' + r.came + '/' + r.reg + '=' + r.rate), ['E1:1/2=50', 'E2:2/2=100']);
    assert.strictEqual(a.rate, 75);
});

test('сегменты рассылки: должники, участники события, продление; вышедшие не получают', () => {
    const ms = [mem('А'), mem('Б', { until: '2026-12-10' }), mem('В', { status: 'Вышел' }), mem('Г', { status: 'Приостановлен' })];
    const fees = [fee('1', 'Г', { status: 'Выставлен', paid: '', due: '2026-10-10' }), fee('2', 'В', { status: 'Выставлен', paid: '', due: '2026-10-10' })];
    const regs = [{ event: 'Завтрак', member: 'А', status: 'Записан' }, { event: 'Завтрак', member: 'Б', status: 'Лист ожидания' }];
    const ctx = { today: TODAY, members: ms, fees, regs, event: 'Завтрак' };
    assert.deepStrictEqual(C.segmentRecipients('Должники', ctx).map(m => m.name), ['Г']);
    assert.deepStrictEqual(C.segmentRecipients('Участники события', ctx).map(m => m.name), ['А']);
    assert.deepStrictEqual(C.segmentRecipients('Продление в ближайшие дни', ctx).map(m => m.name), ['Б']);
    assert.deepStrictEqual(C.segmentRecipients('Все активные', ctx).map(m => m.name), ['А', 'Б']);
    assert.throws(() => C.segmentRecipients('Все подряд', ctx), /Неизвестный сегмент/);
});

test('каталог: «ищу бухгалтера по ЭДО» - сначала тот, у кого есть оба слова, дальше «Чем могу помочь» весомее сферы; неактивные не ищутся', () => {
    const ms = [mem('Лаптева', { offers: 'Бухгалтерия на аутсорс, перевод документооборота на ЭДО, 1С' }), mem('Чернов', { offers: 'ИТ-аутсорсинг, ЭДО и электронная подпись' }),
        mem('Никитин', { sphere: 'Бухгалтерия и финансы', offers: 'Финмодель и кредиты' }), mem('Голубев', { status: 'Вышел', offers: 'Бухгалтерские услуги, ЭДО' }), mem('Ларин', { offers: 'Кейтеринг' }), mem('Ковалёва', { seeks: 'Бухгалтера на аутсорс с ЭДО' })];
    const r = C.searchCatalog(ms, 'ищу бухгалтера по ЭДО');
    assert.deepStrictEqual(r.map(x => x.member.name), ['Лаптева', 'Чернов', 'Никитин', 'Ковалёва'], 'тот, кто сам ищет бухгалтера, ниже тех, кто помогает');
    assert.deepStrictEqual(r[0].hits.sort(), ['бухгалте', 'эдо']);
    assert.strictEqual(C.searchCatalog(ms, '').length, 5);
    assert.deepStrictEqual(C.searchCatalog(ms, 'ЭДО', { exclude: 'Чернов' }).map(x => x.member.name), ['Лаптева', 'Ковалёва']);
});

test('настройки: поля каталога для участника, сотрудникам видно всё, автоперевод выключается', () => {
    const s = C.parseSettings({ 'Поля каталога для участников': 'Компания, Что ищу', 'Автоперевод из листа ожидания': 'нет', 'Льготный период, дней': '0' });
    assert.ok(C.catalogFieldVisible('member', 'Что ищу', s));
    assert.ok(!C.catalogFieldVisible('member', 'Город', s));
    assert.ok(C.catalogFieldVisible('manager', 'Город', s));
    assert.strictEqual(s.autoPromote, false);
    assert.strictEqual(s.graceDays, 0);
});

test('логин участника: фамилия латиницей, без пустых, совпадения с цифрой', () => {
    assert.strictEqual(C.loginFor('Ковалёва Анна Сергеевна'), 'kovaleva');
    assert.strictEqual(C.loginFor('Щукин Илья', ['schukin', 'schukin2']), 'schukin3');
    assert.strictEqual(C.loginFor(''), 'member');
});
