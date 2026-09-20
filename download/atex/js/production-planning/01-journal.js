
    // ── #4618: ЖУРНАЛ РАССЛЕДОВАНИЯ ПЛАНА ──────────────────────────────────────────────
    //
    // Зачем. Потерянные проходы (#4552, #4598, #4616) и разорванные 🔒-задания (#4617)
    // расследуются ПОСЛЕ факта, по остаткам в базе: «Тайминг» помнит одно число, «Кол-во
    // резок план» стои́т другое, продолжения нет — и кто его снял, восстановить нечем.
    // Консоль браузера не годится: она живёт до перезагрузки страницы и до диспетчера не
    // доезжает. Поэтому каждое изменение плана пишется В БАЗУ, в таблицу «Журнал».
    //
    // Что пишем — ровно то, чем доказывается пропажа работы:
    //   SESSION       — начало действия (кнопка, пользователь, сколько операций несёт)
    //   RUNS_CHANGE   — у задания меняется «Кол-во резок план»: было → стало
    //   CHAIN_CREATE  — рождение продолжения (родитель, сколько проходов уносит)
    //   CHAIN_DELETE  — снятие сегмента (сколько проходов на нём стояло)
    //   OP_DROPPED    — операцию снял страж (правило реестра §15, режим `drop`)
    //   CHAIN_BALANCE — Σ проходов цепочки ДО и ПОСЛЕ операций; расхождение = потеря
    //   SETTLE_SPLIT  — «Урегулировать» делит частично выполненное: сделано + остаток
    //   DAY_OVER      — станко-день выше потолка смены по ХРАНИМЫМ минутам
    //
    // Правила поведения (нарушение любого хуже, чем отсутствие журнала):
    //   • нет таблицы «Журнал» в базе — журнал молчит и НИЧЕГО не ломает (в ateh1 её нет);
    //   • ни одна ошибка записи не доходит до действия — журнал не вправе сорвать план;
    //   • записи идут ПОСЛЕ основной работы и ОДНИМ батчем, чтобы не занимать пул записи
    //     (#4477/#4480: семафор в post(), пул 5) и не держать действие (#4979);
    //   • потолок JOURNAL_MAX_ROWS на действие — генерация на 200 заданий не должна
    //     превращаться в тысячи строк журнала.
    //
    // Таблица заводится в базе руками (ateh: «Журнал», id 665850) — код находит её ПО ИМЕНИ
    // и по именам колонок, поэтому пересборка базы его не ломает и id никуда не зашиты.
    var JOURNAL_TABLE = 'Журнал';
    var JOURNAL_REQ = {
        session: 'Сессия', action: 'Действие', event: 'Событие', cut: 'Задание',
        order: 'Заказ', slitter: 'Станок', day: 'День', before: 'Было', after: 'Стало',
        details: 'Детали', user: 'Пользователь'
    };
    var JOURNAL_MAX_ROWS = 400;      // строк на одно действие
    var JOURNAL_DETAILS_MAX = 900;   // символов в «Детали»
    var JOURNAL_FLUSH_MS = 3000;     // #4979: страховка, если действие не сбросило очередь само

    // ── #4979: ОЧЕРЕДЬ ДЕЙСТВИЯ И БАТЧ ─────────────────────────────────────────────────────
    // Одно перемещение задания стоило 30 запросов и СЕМЬ СЕКУНД только на журнал (боевая ateh1,
    // 20.09.2026: метки строк сессии 1789915706 → 1789915713) — строки шли по одной.
    // Платформа грузит таблицу ОДНИМ файлом (`object/{tid}?JSON&import=1`, поле `bki_file`,
    // docs/kb/import.md), поэтому строки действия копятся в очереди и уходят одним запросом
    // ПОСЛЕ работы, не занимая пул записи плана.
    //
    // Что при этом НЕ меняется:
    //   • SESSION пишется сразу и мимо очереди (`{immediate:true}`) — #4618 держит её как
    //     единственного свидетеля намерения, если действие умрёт на полпути;
    //   • батч отбит сервером → строки дописываются по одной (#4645: молчащий журнал хуже
    //     отсутствующего), и только полный провал доходит до `journalWriteFailed`;
    //   • ни одна ошибка журнала не доходит до действия.
    function journalQueue(ctx) {
        if (!ctx._journalQueue) ctx._journalQueue = [];
        return ctx._journalQueue;
    }
    // Очередь не вправе зависнуть: если действие не позвало journalFlush (ранний выход, отказ),
    // она уходит по таймеру. `unref` — чтобы таймер не держал процесс в тестах.
    function journalArmFlush(ctx) {
        if (ctx._journalFlushTimer || typeof setTimeout !== 'function') return;
        ctx._journalFlushTimer = setTimeout(function() {
            ctx._journalFlushTimer = null;
            journalFlush(ctx);
        }, JOURNAL_FLUSH_MS);
        if (ctx._journalFlushTimer && typeof ctx._journalFlushTimer.unref === 'function') ctx._journalFlushTimer.unref();
    }

    // Разделитель колонок BKI — «;». Незаэкранированная точка с запятой ВНУТРИ значения рвёт
    // строку по колонкам: на боевой ateh1 «точка с запятой; внутри» легла в «Детали» ПЛЮС
    // «Пользователь». Экранируем так же, как универсальный импорт (templates/upload.html).
    // Переводы строк схлопываем — строка файла обязана остаться одной строкой.
    function journalBkiCell(v) {
        return String(v == null ? '' : v)
            .replace(/[\r\n]+/g, ' ')
            .replace(/\\/g, '\\\\')
            .replace(/;/g, '\\;');
    }

    // Файл батча в сокращённом формате `plain data`: первая строка `DATA`, дальше по записи на
    // строку. Порядок колонок — главное значение таблицы, затем реквизиты В ПОРЯДКЕ МЕТАДАННЫХ;
    // завершающий «;» обязателен (без него движок дочитывает следующую строку — docs/kb/import.md).
    //   rows — карты полей `{t<reqId>: значение}`, ровно те, что ушли бы в `_m_new`.
    function journalBatchText(meta, rows) {
        if (!meta || meta.id == null || !rows || !rows.length) return '';
        var keys = ['t' + meta.id].concat((meta.reqs || []).map(function(r) { return 't' + r.id; }));
        var out = 'DATA\r\n';
        rows.forEach(function(f) {
            out += keys.map(function(k) { return journalBkiCell(f && f[k]); }).join(';') + ';\r\n';
        });
        return out;
    }

    // Сброс очереди: один батч, при отказе — построчно. Никогда не реджектится.
    function journalFlush(ctx) {
        if (!ctx) return Promise.resolve(0);
        if (ctx._journalFlushTimer) {
            if (typeof clearTimeout === 'function') clearTimeout(ctx._journalFlushTimer);
            ctx._journalFlushTimer = null;
        }
        ctx._journalDefer = false;
        var jm = journalMeta(ctx);
        var rows = ctx._journalQueue || [];
        ctx._journalQueue = [];
        if (!jm || !rows.length) return Promise.resolve(0);
        function oneByOne() {
            return rows.reduce(function(p, f) {
                return p.then(function(n) {
                    return journalPostRow(ctx, jm, f).then(function(ok) { return n + (ok ? 1 : 0); });
                });
            }, Promise.resolve(0));
        }
        var sent;
        try {
            sent = (typeof ctx.postImport === 'function')
                ? ctx.postImport(jm.meta.id, journalBatchText(jm.meta, rows), 'journal.bki')
                : null;
        } catch (e) { sent = null; }
        if (!sent || typeof sent.then !== 'function') return oneByOne();
        return sent.then(function() {
            ctx._journalWrote = true;
            return rows.length;
        }, function(err) {
            if (typeof console !== 'undefined' && console.warn) {
                console.warn('[pp] #4979 батч журнала не принят ('
                    + ((err && err.message) || 'причина неизвестна') + ') — дописываем по одной');
            }
            return oneByOne();
        });
    }

    // Метаданные журнала: таблица и id колонок ПО ИМЕНАМ. Нет таблицы → null (журнал молчит).
    // Результат кэшируем на контроллере: metadata читается один раз за загрузку.
    function journalMeta(ctx) {
        if (!ctx) return null;
        if (ctx._journalMeta !== undefined) return ctx._journalMeta;
        var meta = tableByName(ctx._metaAll || [], JOURNAL_TABLE);
        if (!meta || meta.id == null) { ctx._journalMeta = null; return null; }
        var reqs = {};
        Object.keys(JOURNAL_REQ).forEach(function(k) { reqs[k] = reqIdByName(meta, JOURNAL_REQ[k]); });
        ctx._journalMeta = { meta: meta, reqs: reqs };
        return ctx._journalMeta;
    }

    // Одно нажатие кнопки = одна «Сессия». Метка человекочитаемая: действие + время старта,
    // чтобы в таблице строки одного действия отбирались фильтром по колонке.
    function journalSession(ctx, action) {
        if (!ctx) return '';
        var op = String(action || (ctx._ppOp || 'plan'));
        if (!ctx._journalSession || ctx._journalSessionOp !== op) {
            ctx._journalSessionOp = op;
            ctx._journalSession = op + '-' + Math.floor(Date.now() / 1000);
            ctx._journalRows = 0;
        }
        return ctx._journalSession;
    }
    // Новое действие — новая сессия (зовём в начале действия, до первых записей).
    // #4979: этим же открывается очередь действия — дальше строки копятся и уходят одним батчем
    // на journalFlush. Вызовы журнала ВНЕ действия (журналBegin не звали) пишутся как прежде,
    // по одной: их единицы, и отдельная очередь им ничего не даёт.
    function journalBegin(ctx, action) {
        if (!ctx) return '';
        // Предыдущее действие могло не сбросить очередь (ранний выход, делегирование другому
        // действию — splitPartiallyDoneCuts → applySplitPlan). Открыть новую очередь поверх
        // старой значило бы ПОТЕРЯТЬ её строки, а молчащий журнал хуже отсутствующего (#4645).
        if (ctx._journalQueue && ctx._journalQueue.length) journalFlush(ctx);
        ctx._journalSessionOp = null;
        ctx._journalSession = null;
        ctx._journalDefer = true;
        ctx._journalQueue = [];
        return journalSession(ctx, action);
    }

    function journalText(v) {
        if (v == null) return '';
        var s = typeof v === 'string' ? v : (function() { try { return JSON.stringify(v); } catch (e) { return String(v); } })();
        return s.length > JOURNAL_DETAILS_MAX ? s.slice(0, JOURNAL_DETAILS_MAX) + '…' : s;
    }
    function journalNum(v) {
        if (v == null || v === '') return null;
        var n = Number(v);
        return isFinite(n) ? String(Math.round(n)) : null;
    }

    // Одна строка журнала. rec: { event, cut, order, slitter, day, before, after, details }.
    // opts.immediate — писать СРАЗУ, мимо очереди действия (#4618: так идёт SESSION).
    // Возвращает Promise, который НИКОГДА не реджектится (журнал не вправе сорвать действие).
    function planJournal(ctx, rec, opts) {
        var jm = journalMeta(ctx);
        if (!jm || !rec) return Promise.resolve(false);
        if ((ctx._journalRows || 0) >= JOURNAL_MAX_ROWS) return Promise.resolve(false);
        ctx._journalRows = (ctx._journalRows || 0) + 1;
        var f = journalFields(ctx, jm, rec);
        if (ctx._journalDefer && !(opts && opts.immediate)) {
            journalQueue(ctx).push(f);
            journalArmFlush(ctx);
            return Promise.resolve(true);
        }
        return journalPostRow(ctx, jm, f);
    }

    // Карта полей одной строки — ровно то, что уходит в `_m_new` или в колонку батча.
    function journalFields(ctx, jm, rec) {
        var r = jm.reqs, f = {};
        function put(id, val) { if (id && val != null && val !== '') f['t' + id] = val; }
        put(r.session, journalSession(ctx));
        put(r.action, String(ctx._ppOp || ''));
        put(r.event, String(rec.event || ''));
        put(r.cut, journalNum(rec.cut));
        put(r.order, rec.order == null ? '' : String(rec.order));
        put(r.slitter, rec.slitter == null ? '' : String(rec.slitter));
        put(r.day, rec.day == null ? '' : String(rec.day));
        put(r.before, journalNum(rec.before));
        put(r.after, journalNum(rec.after));
        put(r.details, journalText(rec.details));
        put(r.user, String((ctx.user && (ctx.user.name || ctx.user.login)) || ctx.userName || ''));
        return addMainValueField(jm.meta, f, Math.floor(Date.now() / 1000));
    }

    // Отправка одной готовой строки. Ошибка гасится здесь — действие продолжается.
    function journalPostRow(ctx, jm, f) {
        return ctx.post('_m_new/' + jm.meta.id + '?JSON&up=1', f)
            .then(function() { ctx._journalWrote = true; return true; })
            .catch(function(err) { journalWriteFailed(ctx, err); return false; });
    }

    // #4645: ЖУРНАЛ, КОТОРЫЙ НЕ ПИШЕТСЯ, ХУЖЕ ОТСУТСТВУЮЩЕГО — на него рассчитывают при разборе.
    // Боевой день 07.08.2026: рабочее место отправило 309 запросов `_m_new/665850`, в базе не
    // появилось НИ ОДНОЙ строки, и узналось это только из серверного лога. Причина — права:
    // `_m_new` с `up=1` требует WRITE на саму таблицу (index.php, `Grant_1level($id) != "WRITE"`
    // → `die('У вас нет прав на создание объектов этого типа')`), а у роли диспетчера на «Журнал»
    // был только READ — его хватает, чтобы таблица попала в metadata и код честно пробовал писать.
    // Отказ приходит ПЛАЙН-ТЕКСТОМ с кодом 200, поэтому от «сервер прилёг» он неотличим, а
    // `console.warn` не читает никто: строки 06.08 писал admin (`Grant_1level` отдаёт ему WRITE
    // всегда), и в боевой роли журнал был мёртв с первого дня.
    //
    // Правило «журнал не вправе сорвать действие» остаётся: план продолжается, исключение наружу
    // не уходит. Но МОЛЧАТЬ о том, что трассировки нет, нельзя (ТЗ §14) — говорим ОДИН раз за
    // загрузку страницы: тост оператору и console.error разработчику. Дальше журнал не шумит.
    function journalWriteFailed(ctx, err) {
        var msg = (err && err.message) ? String(err.message) : 'причина неизвестна';
        if (typeof console !== 'undefined' && console.warn) {
            console.warn('[pp] #4618 журнал не записан: ' + msg);
        }
        if (ctx._journalDeadReported) return;
        ctx._journalDeadReported = true;
        var noRights = /нет прав|permission/i.test(msg);
        if (typeof console !== 'undefined' && console.error) {
            console.error('[pp] ⛔ #4645: ТРАССИРОВКА ПЛАНА ВЫКЛЮЧЕНА — журнал не пишется. ' + msg
                + (noRights ? ' Роли нужен грант WRITE на таблицу «Журнал» (index.php: _m_new с up=1'
                            + ' требует Grant_1level == WRITE).' : ''));
        }
        if (typeof ctx.notify === 'function') {
            ctx.notify(noRights
                ? 'Журнал изменений плана не пишется: у роли нет прав на запись в таблицу «Журнал». '
                  + 'Разбирать потерянные проходы будет нечем — попросите админа выдать грант.'
                : 'Журнал изменений плана не пишется (' + msg.slice(0, 120) + '). '
                  + 'План записывается как обычно, но трассировки не будет.',
                'warning');
        }
    }

    // Пачка строк. Внутри действия (после journalBegin) они лишь копятся — отправит их одним
    // батчем journalFlush ПОСЛЕ работы; вне действия пишутся последовательно, как прежде.
    function planJournalRows(ctx, rows) {
        if (!journalMeta(ctx) || !rows || !rows.length) return Promise.resolve(0);
        var n = 0;
        return rows.reduce(function(p, rec) {
            return p.then(function() { return planJournal(ctx, rec); }).then(function(ok) { if (ok) n++; });
        }, Promise.resolve()).then(function() { return n; });
    }

    // Σ проходов по цепочкам ДО и ПОСЛЕ набора операций — та же арифметика, которой страж
    // держит целостность разорванного задания (`planWorkBalanceByChain`, #4536), но здесь она
    // нужна как СВИДЕТЕЛЬ: расхождение = работа исчезла, и в журнале видно, на каком звене.
    //   cuts — снимок заданий ДО (self.cuts), ops — операции плана.
    // → [{ chainId, before, after, delta }] только по цепочкам, которых операции касались.
    function journalChainBalance(cuts, ops) {
        var byId = {}, chainOf = {};
        (cuts || []).forEach(function(c) {
            if (!c || c.id == null) return;
            var id = String(c.id);
            byId[id] = c;
            var fp = String(c.firstPartId == null ? '' : c.firstPartId).trim();
            chainOf[id] = fp !== '' ? fp : id;
        });
        var touched = {};
        var before = {}, after = {};
        function runsOf(c) { var n = Number(c && c.plannedRuns); return isFinite(n) ? n : 0; }
        Object.keys(byId).forEach(function(id) {
            var ch = chainOf[id];
            before[ch] = (before[ch] || 0) + runsOf(byId[id]);
            after[ch] = (after[ch] || 0) + runsOf(byId[id]);
        });
        ((ops && ops.updates) || []).forEach(function(u) {
            var id = String(u.cutId), ch = chainOf[id];
            if (ch == null) return;
            touched[ch] = true;
            after[ch] = (after[ch] || 0) - runsOf(byId[id]) + (Number(u.plannedRuns) || 0);
        });
        ((ops && ops.creates) || []).forEach(function(cr) {
            var ch = chainOf[String(cr.parentCutId)];
            if (ch == null) return;
            touched[ch] = true;
            after[ch] = (after[ch] || 0) + (Number(cr.plannedRuns) || 0);
        });
        ((ops && ops.deletes) || []).forEach(function(id) {
            var ch = chainOf[String(id)];
            if (ch == null) return;
            touched[ch] = true;
            after[ch] = (after[ch] || 0) - runsOf(byId[String(id)]);
        });
        return Object.keys(touched).map(function(ch) {
            return { chainId: ch, before: before[ch] || 0, after: after[ch] || 0,
                     delta: (after[ch] || 0) - (before[ch] || 0) };
        });
    }

    // Что снял страж: разница исходных операций и прошедших. Отдельно помечаем снятый `create` —
    // именно он оставляет урезанную голову без продолжения (корень #4536/#4598).
    //   before — операции ДО стража, guard — результат guardPlanOps.
    function journalGuardDrops(ctx, before, guard) {
        if (!journalMeta(ctx) || !before || !guard) return Promise.resolve(0);
        var after = guard.ops || {};
        var keptU = {}, keptC = {}, keptD = {};
        ((after.updates) || []).forEach(function(u) { keptU[String(u.cutId)] = true; });
        ((after.creates) || []).forEach(function(c) { keptC[String(c.parentCutId) + '|' + c.plannedRuns] = true; });
        ((after.deletes) || []).forEach(function(id) { keptD[String(id)] = true; });
        var rules = (guard.violations || []).map(function(v) { return v && v.rule; }).filter(Boolean);
        var why = rules.length ? ' правила: ' + rules.slice(0, 6).join(', ') : '';
        var rows = [];
        ((before.updates) || []).forEach(function(u) {
            if (keptU[String(u.cutId)]) return;
            rows.push({ event: 'OP_DROPPED', cut: u.cutId, after: u.plannedRuns,
                        details: 'снят update (проходов должно было стать ' + u.plannedRuns + ')' + why });
        });
        ((before.creates) || []).forEach(function(c) {
            if (keptC[String(c.parentCutId) + '|' + c.plannedRuns]) return;
            rows.push({ event: 'OP_DROPPED', cut: c.parentCutId, after: c.plannedRuns,
                        details: '⛔ снят CREATE продолжения на ' + c.plannedRuns +
                                 ' проходов — голова останется без остатка' + why });
        });
        ((before.deletes) || []).forEach(function(id) {
            if (keptD[String(id)]) return;
            rows.push({ event: 'OP_DROPPED', cut: id, details: 'снят delete' + why });
        });
        if ((guard.restoredChains || []).length) {
            rows.push({ event: 'OP_DROPPED', before: (guard.restoredChains || []).length,
                        details: '#4536: операции сняты ЦЕЛИКОМ по цепочкам ' + (guard.restoredChains || []).join(', ') });
        }
        return planJournalRows(ctx, rows);
    }

    // Подробности одного применения плана. snapshot — задания ДО (id, plannedRuns, firstPartId),
    // ops — что применяли. Пишем ТОЛЬКО значимое: изменение проходов, рождение и снятие
    // сегментов, и баланс цепочки. Ровный баланс сводим в одну строку — сотни строк «сошлось»
    // прячут ту единственную, где не сошлось.
    function journalApplyDetails(ctx, snapshot, ops) {
        if (!journalMeta(ctx)) return Promise.resolve(0);
        var byId = {};
        (snapshot || []).forEach(function(c) { byId[String(c.id)] = c; });
        // #4636: день по плановому старту — «в какой день это стояло и куда уехало».
        var dayOf = function(ts) {
            var n = Number(ts);
            if (!isFinite(n) || n <= 0) return '';
            var d = new Date(n * 1000);
            var p = function(x) { return (x < 10 ? '0' : '') + x; };
            return p(d.getDate()) + '.' + p(d.getMonth() + 1) + '.' + d.getFullYear();
        };
        var runsOf = function(id) {
            var c = byId[String(id)];
            var n = Number(c && c.plannedRuns);
            return isFinite(n) ? n : null;
        };
        var rows = [];
        ((ops && ops.updates) || []).forEach(function(u) {
            var was = runsOf(u.cutId), now = Number(u.plannedRuns);
            if (u.plannedRuns != null && was != null && was !== now) {
                rows.push({ event: 'RUNS_CHANGE', cut: u.cutId, day: dayOf(u.planStartTs), before: was, after: now,
                            details: 'проходов ' + was + ' → ' + now + (now < was ? ' (урезано на ' + (was - now) + ')' : '') });
            }
            // #4636: ПЕРЕНОС ДНЯ — тоже событие. Раньше в журнал попадала только смена проходов, и
            // «перетащил задание на день раньше» не оставляло следа: в сессии было «updates 7», а
            // какие именно записи переехали и куда — не сказано (боевое #4636).
            var c = byId[String(u.cutId)];
            var wasTs = c ? Number(c.planStartTs) : NaN;
            var nowTs = Number(u.planStartTs);
            if (isFinite(wasTs) && isFinite(nowTs) && nowTs > 0 && wasTs !== nowTs) {
                var wasDay = dayOf(wasTs), nowDay = dayOf(nowTs);
                rows.push({ event: 'PLAN_MOVE', cut: u.cutId, day: nowDay,
                            details: wasDay === nowDay
                                ? ('время старта в дне ' + nowDay + ' изменилось')
                                : ('день ' + wasDay + ' → ' + nowDay) });
            }
        });
        ((ops && ops.creates) || []).forEach(function(cr) {
            rows.push({ event: 'CHAIN_CREATE', cut: cr.parentCutId, after: cr.plannedRuns,
                        details: 'продолжение от ' + cr.parentCutId + ' на ' + cr.plannedRuns + ' проходов' });
        });
        ((ops && ops.deletes) || []).forEach(function(id) {
            rows.push({ event: 'CHAIN_DELETE', cut: id, before: runsOf(id),
                        details: 'снят сегмент, на нём стояло проходов: ' + (runsOf(id) == null ? '?' : runsOf(id)) });
        });
        var bal = journalChainBalance(snapshot, ops);
        var broken = bal.filter(function(b) { return b.delta !== 0; });
        broken.forEach(function(b) {
            rows.push({ event: 'CHAIN_BALANCE', cut: b.chainId, before: b.before, after: b.after,
                        details: '⛔ РАБОТА НЕ СОХРАНЕНА: цепочка ' + b.chainId + ' — было ' + b.before +
                                 ' проходов, стало ' + b.after + ' (' + (b.delta > 0 ? '+' : '') + b.delta + ')' });
        });
        if (bal.length) {
            rows.push({ event: 'CHAIN_BALANCE', before: bal.length, after: broken.length,
                        details: 'цепочек затронуто ' + bal.length + ', баланс сошёлся у ' +
                                 (bal.length - broken.length) + ', сломан у ' + broken.length });
        }
        return planJournalRows(ctx, rows);
    }
