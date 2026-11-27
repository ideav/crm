/* Бизнес-клуб: чистые функции (даты, взносы и продления, должники, приём заявки, места и лист ожидания, явка, сегменты рассылок, поиск по каталогу). Без DOM и сети: работает и в браузере, и в Node. */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.NetclubCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    var DAY = 86400000;

    /* ---------- даты и числа ---------- */
    function utc(s) { var p = s.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
    function iso(ms) { var d = new Date(ms); return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2); }
    function addDays(s, n) { return iso(utc(s) + n * DAY); }
    function diffDays(a, b) { return Math.round((utc(b) - utc(a)) / DAY); }
    /* +n месяцев; 31-е число в коротком месяце уходит на последний день месяца */
    function addMonths(s, n) {
        var p = s.split('-'), y = +p[0], m = +p[1] - 1 + n, d = +p[2];
        y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
        var last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
        return iso(Date.UTC(y, m, Math.min(d, last)));
    }
    /* 'ДД.ММ.ГГГГ' или 'ГГГГ-ММ-ДД' -> 'ГГГГ-ММ-ДД'; пусто -> '' */
    function toIso(v) {
        if (!v) return '';
        var m = /^(\d{2})\.(\d{2})\.(\d{4})/.exec(v);
        return m ? m[3] + '-' + m[2] + '-' + m[1] : String(v).slice(0, 10);
    }
    function toDmy(s) { if (!s) return ''; var p = s.split('-'); return p[2] + '.' + p[1] + '.' + p[0]; }
    function num(v) { var n = parseFloat(String(v === undefined || v === null ? '' : v).replace(/\s/g, '').replace(',', '.')); return isFinite(n) ? n : 0; }
    function money(x) { var n = Math.round(num(x)); return (n < 0 ? '-' : '') + String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'; }
    function plural(n, one, few, many) { var a = Math.abs(n) % 100, b = a % 10; return a > 10 && a < 20 ? many : b === 1 ? one : b > 1 && b < 5 ? few : many; }

    /* ---------- роли и настройки ---------- */
    /* Имя роли приходит в регистре базы - сравниваем без учёта регистра. */
    function roleKey(role) {
        var r = String(role || '').toLowerCase();
        if (/организатор|admin|основател/.test(r)) return 'owner';
        if (/менеджер/.test(r)) return 'manager';
        return 'member';
    }
    var DEFAULTS = { renewDays: 30, payDays: 10, graceDays: 30, autoPromote: true, club: 'Бизнес-клуб', catalogFields: ['Компания', 'Должность', 'Сфера', 'Город', 'Чем занимаюсь', 'Что ищу', 'Чем могу помочь'] };
    function parseSettings(map) {
        var s = {}; Object.keys(DEFAULTS).forEach(function (k) { s[k] = DEFAULTS[k]; });
        map = map || {};
        if (map['Название клуба']) s.club = map['Название клуба'];
        if (num(map['Напоминать о продлении за, дней']) > 0) s.renewDays = num(map['Напоминать о продлении за, дней']);
        if (num(map['Дней на оплату счёта']) > 0) s.payDays = num(map['Дней на оплату счёта']);
        if (map['Льготный период, дней'] !== undefined && map['Льготный период, дней'] !== '') s.graceDays = num(map['Льготный период, дней']);
        if (map['Автоперевод из листа ожидания'] !== undefined) s.autoPromote = !/^(нет|0|false|выкл)/i.test(String(map['Автоперевод из листа ожидания']).trim());
        if (map['Поля каталога для участников']) s.catalogFields = String(map['Поля каталога для участников']).split(',').map(function (x) { return x.trim(); }).filter(Boolean);
        return s;
    }
    /* Участник видит в каталоге только поля из настройки; сотрудники клуба - все. */
    function catalogFieldVisible(rk, field, settings) {
        if (rk !== 'member') return true;
        return (settings || DEFAULTS).catalogFields.indexOf(field) >= 0;
    }


    /* Логин участника в кабинете клуба: фамилия латиницей, при совпадении - с цифрой. Поле «Логин» не бывает пустым:
       маска роли «Участник» пропускает запись в строку, где поле маски пустое, поэтому у каждой записи логин свой. */
    var TR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
    function loginFor(name, taken) {
        var base = String(name || '').trim().split(/\s+/)[0].toLowerCase().split('').map(function (c) { return TR[c] !== undefined ? TR[c] : /[a-z0-9]/.test(c) ? c : ''; }).join('') || 'member';
        var have = {}; (taken || []).forEach(function (x) { have[x] = 1; });
        var l = base, i = 2; while (have[l]) l = base + i++;
        return l;
    }

    /* ---------- взносы и продления ---------- */
    /* Состояние счёта на дату: paid / overdue / due (выставлен, срок не наступил) / void */
    function feeState(f, today) {
        if (f.status === 'Оплачен' || f.paid) return 'paid';
        if (f.status === 'Отменён') return 'void';
        return f.due && f.due < today ? 'overdue' : 'due';
    }
    function feeLabel(st) { return { paid: 'Оплачен', overdue: 'Просрочен', due: 'Ожидает оплаты', 'void': 'Отменён' }[st] || st; }
    /* Должники: просроченные счета, самые давние первыми; сумма долга и число людей. */
    function debtors(fees, today) {
        var list = fees.filter(function (f) { return feeState(f, today) === 'overdue'; }).map(function (f) {
            return Object.assign({}, f, { days: diffDays(f.due, today) });
        }).sort(function (a, b) { return b.days - a.days || a.member.localeCompare(b.member); });
        var people = {}; list.forEach(function (f) { people[f.member] = 1; });
        return { list: list, sum: list.reduce(function (s, f) { return s + num(f.sum); }, 0), people: Object.keys(people).length };
    }
    /* Ближайшие продления: участники в клубе, у кого членство кончается в окне [сегодня; сегодня+days].
       Для каждого - что с продлением: оплачено, счёт выставлен или счёт ещё не выставлен. */
    function renewals(members, fees, today, days) {
        var end = addDays(today, days);
        return members.filter(function (m) { return (m.status === 'Активен' || m.status === 'Принят') && m.until && m.until >= today && m.until <= end; })
            .map(function (m) {
                var next = fees.filter(function (f) { return f.member === m.name && f.from && f.from >= m.until && feeState(f, today) !== 'void'; })[0];
                var state = !next ? 'need' : feeState(next, today) === 'paid' ? 'paid' : 'issued';
                return { member: m, until: m.until, days: diffDays(today, m.until), fee: next || null, state: state };
            }).sort(function (a, b) { return a.until < b.until ? -1 : a.until > b.until ? 1 : 0; });
    }
    /* Участник «в клубе» без оплаты дольше льготного периода - кандидат на приостановку. */
    function toSuspend(members, fees, today, graceDays) {
        return members.filter(function (m) {
            if (m.status !== 'Активен' || !m.until || m.until >= today) return false;
            var paid = fees.some(function (f) { return f.member === m.name && f.from >= m.until && feeState(f, today) === 'paid'; });
            return !paid && diffDays(m.until, today) > graceDays;
        });
    }
    function nextInvoiceNo(fees) {
        var max = 0; fees.forEach(function (f) { var m = /(\d+)$/.exec(f.no || ''); if (m) max = Math.max(max, +m[1]); });
        return 'ВЗ-' + ('000' + (max + 1)).slice(-4);
    }
    /* Счёт на продление: период с конца текущего членства на срок тарифа, оплатить до конца членства. */
    function renewalInvoice(m, tariff, fees, today) {
        var from = m.until && m.until >= today ? m.until : today;
        return { no: nextInvoiceNo(fees), member: m.name, tariff: tariff.name, sum: tariff.sum, from: from, to: addMonths(from, tariff.months), due: from, status: 'Выставлен', login: m.login || '' };
    }
    /* Клик 1: заявка принята. Участник попадает в реестр со статусом «Принят», сроком членства и счётом на первый взнос. */
    function acceptApplication(app, tariff, fees, today, settings, opt) {
        if (!tariff) throw new Error('В заявке не выбран тариф');
        if (app.stage === 'Принята') throw new Error('Заявка уже принята');
        if (app.stage === 'Отклонена') throw new Error('Заявка отклонена');
        var s = settings || DEFAULTS, until = addMonths(today, tariff.months), login = loginFor(app.name, (opt && opt.logins) || []);
        var member = { name: app.name, company: app.company, position: app.position, sphere: app.sphere, city: app.city, status: 'Принят', tariff: tariff.name, joined: today, until: until, sponsor: app.sponsor, phone: app.phone, email: app.email, does: app.does, seeks: app.seeks, offers: app.offers, login: login };
        var fee = { no: nextInvoiceNo(fees), member: app.name, tariff: tariff.name, sum: tariff.sum, from: today, to: until, due: addDays(today, s.payDays), status: 'Выставлен', login: login };
        return { member: member, fee: fee };
    }
    /* Сколько дней заявка ждёт движения; больше 14 - «кандидат остывает». */
    function appAge(app, today) { return app.date ? diffDays(app.date, today) : 0; }
    var STAGES = ['Новая', 'Интервью', 'Решение', 'Принята', 'Отклонена'];
    /* Переход этапа воронки: вперёд по одному шагу, «Принята» только из «Решение», «Отклонена» - из любого открытого. */
    function canMove(from, to, rk) {
        if (from === 'Принята' || from === 'Отклонена') return false;
        if (to === 'Отклонена') return true;
        if (to === 'Принята') return from === 'Решение' && rk === 'owner';
        return STAGES.indexOf(to) === STAGES.indexOf(from) + 1;
    }

    /* ---------- события: места, лист ожидания, явка ---------- */
    var TAKING = { 'Записан': 1, 'Пришёл': 1, 'Не пришёл': 1 };
    function eventRegs(ev, regs) { return regs.filter(function (r) { return r.event === ev.name; }); }
    function byOrd(a, b) { return num(a.ord) - num(b.ord) || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0); }
    /* Места события: занято (записан/пришёл/не пришёл), лист ожидания по порядку записи, свободно. */
    function seats(ev, regs) {
        var list = eventRegs(ev, regs), taken = list.filter(function (r) { return TAKING[r.status]; });
        var wait = list.filter(function (r) { return r.status === 'Лист ожидания'; }).sort(byOrd);
        var limit = num(ev.limit);
        return { limit: limit, taken: taken.length, free: limit > 0 ? Math.max(0, limit - taken.length) : Infinity, wait: wait, regs: list };
    }
    /* Места по сводке отчёта «Места на событиях» (для участника, который не видит чужие записи). */
    function seatsFromReport(ev, rows) {
        var taken = 0, wait = 0;
        (rows || []).forEach(function (r) { if (r['Событие'] !== ev.name) return; var n = num(r['Записей']); if (TAKING[r['Статус']]) taken += n; else if (r['Статус'] === 'Лист ожидания') wait += n; });
        var limit = num(ev.limit);
        return { limit: limit, taken: taken, waitCount: wait, free: limit > 0 ? Math.max(0, limit - taken) : Infinity };
    }
    /* Новая запись: есть место - «Записан», нет - «Лист ожидания»; повтор и прошедшее событие - ошибка. */
    function registerDecision(ev, regs, memberName, today) {
        if (ev.status === 'Отменено') throw new Error('Событие отменено');
        if (ev.date && ev.date < today) throw new Error('Событие уже прошло');
        var s = seats(ev, regs);
        var dup = s.regs.filter(function (r) { return r.member === memberName && r.status !== 'Отменил'; })[0];
        if (dup) throw new Error(memberName + ': уже ' + (dup.status === 'Лист ожидания' ? 'в листе ожидания' : 'записан(а)'));
        var ord = s.regs.reduce(function (mx, r) { return Math.max(mx, num(r.ord)); }, 0) + 1;
        return { status: s.free > 0 ? 'Записан' : 'Лист ожидания', ord: ord, waitPos: s.free > 0 ? 0 : s.wait.length + 1 };
    }
    /* Отмена записи: занятое место переходит первому из листа ожидания (если включён автоперевод). Возвращает список изменений. */
    function cancelChanges(ev, regs, regId, autoPromote) {
        var s = seats(ev, regs), r = s.regs.filter(function (x) { return x.id === regId; })[0];
        if (!r) throw new Error('Запись не найдена');
        var out = [{ id: r.id, status: 'Отменил' }];
        if (TAKING[r.status] && autoPromote !== false && s.wait.length && s.free === 0) out.push({ id: s.wait[0].id, status: 'Записан', promoted: s.wait[0].member });
        return out;
    }
    /* Явка по прошедшим событиям: пришло / записано (без отменивших и листа ожидания). */
    function attendance(events, regs, today) {
        var rows = events.filter(function (e) { return e.date && e.date < today && e.status !== 'Отменено'; }).map(function (e) {
            var list = eventRegs(e, regs), reg = list.filter(function (r) { return TAKING[r.status]; }).length, came = list.filter(function (r) { return r.status === 'Пришёл'; }).length;
            return { event: e, reg: reg, came: came, rate: reg ? Math.round(came * 100 / reg) : 0 };
        }).sort(function (a, b) { return a.event.date < b.event.date ? -1 : 1; });
        var reg = rows.reduce(function (s, r) { return s + r.reg; }, 0), came = rows.reduce(function (s, r) { return s + r.came; }, 0);
        return { rows: rows, rate: reg ? Math.round(came * 100 / reg) : 0 };
    }
    /* Сводка дашборда организатора. */
    function dashboard(members, fees, events, regs, today, settings) {
        var s = settings || DEFAULTS, yearAgo = addMonths(today, -12);
        var active = members.filter(function (m) { return m.status === 'Активен'; });
        var left = members.filter(function (m) { return m.status === 'Вышел' && m.left && m.left >= yearAgo; });
        var d = debtors(fees, today), rn = renewals(members, fees, today, s.renewDays), att = attendance(events, regs, today);
        var base = active.length + left.length;
        return { active: active.length, accepted: members.filter(function (m) { return m.status === 'Принят'; }).length, suspended: members.filter(function (m) { return m.status === 'Приостановлен'; }).length,
            left: left.length, churn: base ? Math.round(left.length * 100 / base) : 0, debt: d, renew: rn, renewNeed: rn.filter(function (r) { return r.state === 'need'; }).length,
            attendance: att, suspend: toSuspend(members, fees, today, s.graceDays) };
    }

    /* ---------- рассылки ---------- */
    var SEGMENTS = ['Все активные', 'Должники', 'Участники события', 'Продление в ближайшие дни', 'Новые участники'];
    /* Получатели сегмента: список участников без повторов. */
    function segmentRecipients(segment, ctx) {
        var today = ctx.today, members = ctx.members, inClub = function (m) { return m.status === 'Активен' || m.status === 'Принят' || m.status === 'Приостановлен'; };
        var names = {};
        if (segment === 'Все активные') members.forEach(function (m) { if (m.status === 'Активен') names[m.name] = 1; });
        else if (segment === 'Должники') debtors(ctx.fees, today).list.forEach(function (f) { names[f.member] = 1; });
        else if (segment === 'Участники события') (ctx.regs || []).forEach(function (r) { if (r.event === ctx.event && TAKING[r.status]) names[r.member] = 1; });
        else if (segment === 'Продление в ближайшие дни') renewals(members, ctx.fees, today, ctx.days || DEFAULTS.renewDays).forEach(function (r) { if (r.state !== 'paid') names[r.member.name] = 1; });
        else if (segment === 'Новые участники') members.forEach(function (m) { if (m.status === 'Принят') names[m.name] = 1; });
        else throw new Error('Неизвестный сегмент: ' + segment);
        return members.filter(function (m) { return names[m.name] && inClub(m); });
    }
    /* Напоминание должникам: текст с суммой и сроком на каждого. */
    function debtReminder(f, club) {
        return f.member + ': взнос ' + money(f.sum) + ' по счёту ' + f.no + ' просрочен на ' + f.days + ' ' + plural(f.days, 'день', 'дня', 'дней') + ' (срок ' + toDmy(f.due) + '). ' + (club || 'Клуб') + '.';
    }

    /* ---------- каталог: поиск «ищу бухгалтера по ЭДО» ---------- */
    var STOP = { 'ищу': 1, 'ищем': 1, 'нужен': 1, 'нужна': 1, 'нужно': 1, 'нужны': 1, 'для': 1, 'по': 1, 'на': 1, 'и': 1, 'в': 1, 'с': 1, 'кто': 1, 'может': 1, 'помочь': 1, 'кого': 1, 'или': 1, 'под': 1, 'от': 1, 'мне': 1, 'нас': 1 };
    function norm(s) { return String(s || '').toLowerCase().replace(/ё/g, 'е'); }
    function words(s) { return norm(s).split(/[^a-zа-я0-9]+/).filter(Boolean); }
    /* Грубая основа слова: короткие слова целиком, длинные без окончания (бухгалтера -> бухгалте). */
    function stem(w) { return w.length <= 4 ? w : w.slice(0, Math.max(4, w.length - 2)); }
    function queryStems(q) { return words(q).filter(function (w) { return !STOP[w] && (w.length > 2 || /^[a-z0-9]+$/.test(w)); }).map(stem); }
    /* Вес совпадения: «Чем могу помочь» важнее всего, потом сфера и «чем занимаюсь», потом компания и должность. */
    var WEIGHTS = [['offers', 3], ['sphere', 2], ['does', 2], ['company', 1], ['position', 1], ['seeks', 0.5]];
    function searchCatalog(members, q, opt) {
        opt = opt || {};
        var st = queryStems(q);
        var list = members.filter(function (m) { return m.status === 'Активен' && (!opt.sphere || m.sphere === opt.sphere) && (!opt.exclude || m.name !== opt.exclude); });
        if (!st.length) return list.map(function (m) { return { member: m, score: 0, hits: [] }; }).sort(function (a, b) { return a.member.name.localeCompare(b.member.name); });
        return list.map(function (m) {
            var score = 0, hits = {}, strong = {};
            st.forEach(function (s) {
                WEIGHTS.forEach(function (w) { var ws = words(m[w[0]]); if (ws.some(function (x) { return x.indexOf(s) === 0; })) { score += w[1]; hits[s] = 1; if (w[0] !== 'seeks') strong[s] = 1; } });
            });
            /* все слова запроса нашлись в том, что участник делает (не в «что ищу») - бонус: «бухгалтер + ЭДО» выше «просто бухгалтера» и выше того, кто сам ищет бухгалтера */
            if (Object.keys(strong).length === st.length) score += 2 * st.length;
            return { member: m, score: score, hits: Object.keys(hits) };
        }).filter(function (x) { return x.score > 0; }).sort(function (a, b) { return b.score - a.score || a.member.name.localeCompare(b.member.name); });
    }
    function toCsv(rows, cols) {
        var q = function (v) { v = String(v === undefined || v === null ? '' : v); return /[";\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
        return [cols.map(function (c) { return q(c[1]); }).join(';')].concat(rows.map(function (r) { return cols.map(function (c) { return q(r[c[0]]); }).join(';'); })).join('\n');
    }

    return {
        utc: utc, iso: iso, addDays: addDays, diffDays: diffDays, addMonths: addMonths, toIso: toIso, toDmy: toDmy, num: num, money: money, plural: plural,
        roleKey: roleKey, loginFor: loginFor, DEFAULTS: DEFAULTS, parseSettings: parseSettings, catalogFieldVisible: catalogFieldVisible,
        feeState: feeState, feeLabel: feeLabel, debtors: debtors, renewals: renewals, toSuspend: toSuspend, nextInvoiceNo: nextInvoiceNo, renewalInvoice: renewalInvoice,
        acceptApplication: acceptApplication, appAge: appAge, STAGES: STAGES, canMove: canMove,
        seats: seats, seatsFromReport: seatsFromReport, registerDecision: registerDecision, cancelChanges: cancelChanges, attendance: attendance, dashboard: dashboard,
        SEGMENTS: SEGMENTS, segmentRecipients: segmentRecipients, debtReminder: debtReminder, queryStems: queryStems, searchCatalog: searchCatalog, toCsv: toCsv
    };
});
