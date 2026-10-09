/*
 * Issue #3392: упрощённый ИИ-чат. Issue #3410: асинхронная работа агента.
 *
 * Новый чат связан только с нашим фиксированным ИИ-агентом текущей базы данных.
 * Доступ к агенту разрешён сервером (index.php, ветка /{db}/ai/agent) любому
 * вошедшему пользователю базы при действующей оплате; агент работает токеном
 * этого пользователя и с его правами. Все действия агента ограничены текущей базой.
 *
 * Issue #3410: задача агента может выполняться долго (до минуты и дольше) и
 * ставиться в очередь. Поэтому:
 *   • POST /{db}/ai/agent создаёт задачу (job) и возвращает её статус;
 *   • пока задача в работе — показываем «ИИ-агент думает», а при долгом ожидании
 *     сообщаем, что нужно ещё немного времени;
 *   • статус/результат опрашиваются GET /{db}/ai/agent?job=ID;
 *   • при открытии панели подхватываем последнюю задачу (GET ?latest), поэтому
 *     результат не теряется, если пользователь закрыл вкладку и вернулся — даже
 *     из другого браузера (состояние хранится на сервере, не в localStorage).
 *
 * Старый расширенный ИИ-чат (js/ai-chat.js) скрыт из интерфейса, но оставлен в
 * репозитории как backend-история.
 */
(function () {
    'use strict';

    var IntegramAiAgentChat = {
        attachments: [],
        sending: false,

        // Issue #3410: состояние ожидания/опроса.
        pollIntervalMs: 2500,   // как часто опрашивать статус задачи
        thinkStart: 0,          // когда начали ждать ответ (мс)
        activeJobId: null,      // id задачи, которую ждём
        pollJobId: null,        // id задачи, по которой идёт опрос
        pollTimer: null,        // setInterval опроса статуса
        tickTimer: null,        // setInterval обновления текста ожидания
        currentBubble: null,    // «пузырь» агента с индикатором «думает»
        rendered: {},           // id задач, уже показанных в ленте
        localActivity: false,   // были ли отправки в этой сессии вкладки
        resumeChecked: false,   // восстановление выполняем один раз за загрузку

        init: function () {
            this.rendered = {};
            this.toggle = document.getElementById('ai-chat-toggle');
            this.panel = document.getElementById('ai-agent-panel');
            this.closeBtn = document.getElementById('ai-agent-close');
            this.input = document.getElementById('ai-agent-input');
            this.sendBtn = document.getElementById('ai-agent-send');
            this.attachBtn = document.getElementById('ai-agent-attach');
            this.fileInput = document.getElementById('ai-agent-files');
            this.messages = document.getElementById('ai-agent-messages');
            this.attachmentsList = document.getElementById('ai-agent-attachments');
            this.statusEl = document.getElementById('ai-agent-status');

            // Без панели и кнопки вызова работать нечему — тихо выходим.
            if (!this.toggle || !this.panel) return false;

            // Не вошедшему пользователю (и guest) ИИ-агент недоступен — прячем кнопку
            // вызова и НЕ обращаемся к ai/agent?JSON (ни resume, ни send, ни опросы).
            if (!this.isAgentAllowed()) {
                this.toggle.style.display = 'none';
                return false;
            }

            var self = this;

            this.toggle.addEventListener('click', function () { self.togglePanel(); });
            if (this.closeBtn) this.closeBtn.addEventListener('click', function () { self.closePanel(); });

            // backlogram#735: из страницы в чат копируют данные — панель не модальная:
            // подложки нет, клик вне панели её не закрывает; Esc закрывает, только когда
            // фокус внутри панели (Esc на странице — для её собственных окон).
            document.addEventListener('keydown', function (e) {
                if (e.key === 'Escape' && self.isOpen() && self.panel.contains(document.activeElement)) self.closePanel();
            });

            this.initResizer();

            if (this.sendBtn) this.sendBtn.addEventListener('click', function () { self.send(); });

            if (this.input) {
                this.input.addEventListener('keydown', function (e) {
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        self.send();
                    }
                });
            }

            if (this.attachBtn && this.fileInput) {
                this.attachBtn.addEventListener('click', function () { self.fileInput.click(); });
                this.fileInput.addEventListener('change', function () {
                    self.addFiles(self.fileInput.files);
                    self.fileInput.value = '';
                });
            }

            // Issue #3410: подхватываем незавершённую/последнюю задачу с сервера —
            // результат не теряется при перезагрузке или заходе с другого браузера.
            this.resume();

            return true;
        },

        isOpen: function () {
            return this.panel && this.panel.classList.contains('open');
        },

        togglePanel: function () {
            if (this.isOpen()) this.closePanel(); else this.openPanel();
        },

        openPanel: function () {
            if (!this.panel) return;
            this.panel.classList.add('open');
            this.panel.setAttribute('aria-hidden', 'false');
            this.panel.removeAttribute('inert');
            if (this.toggle) this.toggle.setAttribute('aria-expanded', 'true');
            if (this.input) this.input.focus();
            this.renderContext();
            this.resume();
            this.scrollToBottom();
        },

        closePanel: function () {
            if (!this.panel) return;
            this.panel.classList.remove('open');
            this.panel.setAttribute('aria-hidden', 'true');
            this.panel.setAttribute('inert', '');
            if (this.toggle) this.toggle.setAttribute('aria-expanded', 'false');
        },

        // --- backlogram#735: ширина панели перетаскиванием левого края ---

        minWidth: 320,          // уже — не помещаются сообщения и поле ввода
        defaultWidth: 460,      // как width в css/ai-chat.css
        pageGap: 120,           // слева всегда видна полоса страницы, чтобы копировать из неё
        widthStep: 40,          // шаг стрелками на ручке
        widthKey: 'integram.aiAgent.panelWidth',
        panelWidth: 0,          // 0 — ширина по умолчанию из CSS

        clampWidth: function (w) {
            var vw = (typeof window !== 'undefined' && window.innerWidth) || 0;
            var max = vw ? Math.max(this.minWidth, vw - this.pageGap) : w;
            w = Math.round(Math.min(Math.max(w, this.minWidth), max));
            return vw ? Math.min(w, vw) : w;
        },

        setWidth: function (w) {
            this.panelWidth = this.clampWidth(w);
            this.panel.style.width = this.panelWidth + 'px';
        },

        resetWidth: function () {
            this.panelWidth = 0;
            this.panel.style.width = '';
            this.storage('removeItem');
        },

        // localStorage недоступен в приватном режиме/при запрете — ширина просто не запомнится.
        storage: function (method, value) {
            try {
                var ls = window.localStorage;
                return method === 'setItem' ? ls.setItem(this.widthKey, value) : ls[method](this.widthKey);
            } catch (e) {
                return null;
            }
        },

        initResizer: function () {
            var self = this;
            var handle = document.createElement('div');
            handle.className = 'ai-agent-resizer';
            handle.setAttribute('role', 'separator');
            handle.setAttribute('aria-orientation', 'vertical');
            handle.setAttribute('aria-label', 'Ширина панели ИИ-агента');
            handle.setAttribute('tabindex', '0');
            handle.title = 'Потяните, чтобы изменить ширину. Двойной щелчок — ширина по умолчанию';
            this.panel.appendChild(handle);
            this.resizer = handle;

            var saved = parseInt(this.storage('getItem'), 10);
            if (saved > 0) this.setWidth(saved);

            var drag = null;
            handle.addEventListener('pointerdown', function (e) {
                if (e.button) return;
                e.preventDefault();
                drag = { x: e.clientX, w: self.panelWidth || self.panel.offsetWidth || self.defaultWidth };
                self.panel.classList.add('is-resizing');
                if (document.body) document.body.classList.add('ai-agent-resizing');
            });
            document.addEventListener('pointermove', function (e) {
                if (drag) self.setWidth(drag.w + (drag.x - e.clientX));
            });
            var stop = function () {
                if (!drag) return;
                drag = null;
                self.panel.classList.remove('is-resizing');
                if (document.body) document.body.classList.remove('ai-agent-resizing');
                if (self.panelWidth) self.storage('setItem', String(self.panelWidth));
            };
            document.addEventListener('pointerup', stop);
            document.addEventListener('pointercancel', stop);

            handle.addEventListener('keydown', function (e) {
                var dir = e.key === 'ArrowLeft' ? 1 : e.key === 'ArrowRight' ? -1 : 0;
                if (!dir) return;
                e.preventDefault();
                self.setWidth((self.panelWidth || self.panel.offsetWidth || self.defaultWidth) + dir * self.widthStep);
                self.storage('setItem', String(self.panelWidth));
            });
            handle.addEventListener('dblclick', function () { self.resetWidth(); });
        },

        getCurrentDbName: function () {
            if (typeof db !== 'undefined' && db) return String(db);
            if (typeof window !== 'undefined' && window.db) return String(window.db);
            var parts = window.location.pathname.split('/').filter(Boolean);
            return parts.length > 0 ? parts[0] : '';
        },

        // Имя текущего пользователя (глобаль `user` из main.html: '{_global_.user}').
        getCurrentUserName: function () {
            if (typeof user !== 'undefined' && user) return String(user);
            if (typeof window !== 'undefined' && window.user) return String(window.user);
            return '';
        },

        // python2node#839: ИИ-агент доступен любому вошедшему пользователю базы — он
        // работает токеном этого пользователя и с его правами. Зеркало серверного
        // aiAgentRequireUser (index.php): не вошедшему и guest сервер ответит 403, поэтому
        // для них не делаем НИ ОДНОГО запроса /{db}/ai/agent?JSON.
        isAgentAllowed: function () {
            var u = this.getCurrentUserName().toLowerCase();
            return u !== '' && u !== 'guest';
        },

        // --- python2node#847: контекст экрана ---
        //
        // Агенту уходит, где сейчас пользователь: карточка записи, список таблицы, отчёт,
        // рабочее место, плюс фильтры из адреса и выделенные строки integram-table. Тогда
        // «что тут не так?» и «добавь колонку в этот отчёт» понятны без уточнений. На главной
        // контекста нет — запрос прежний. Пользователь может снять контекст крестиком.

        contextDismissed: false,
        maxSelection: 50,

        // Глобаль страницы (main.html/шаблоны действия объявляют их через var).
        pageGlobal: function (name) {
            if (typeof window === 'undefined') return undefined;
            return window[name];
        },

        // Чистая функция: env = {action, id, pathname, search, typeId, typeName, title, selection}.
        buildScreenContext: function (env) {
            env = env || {};
            var action = String(env.action || '').toLowerCase();
            var id = parseInt(env.id, 10) > 0 ? parseInt(env.id, 10) : 0;
            var ctx = null;
            var title = String(env.title || '').replace(/\s+/g, ' ').trim();
            if (action === 'edit_obj' && id) {
                ctx = { page: 'object', object_id: id };
                var typeId = parseInt(env.typeId, 10);
                if (typeId > 0) ctx.table_id = typeId;
                ctx.label = (String(env.typeName || '').trim() || 'Запись') + ' №' + id;
            } else if ((action === 'object' || action === 'table') && id) {
                ctx = { page: 'table', table_id: id, label: 'Таблица ' + (title || id) };
            } else if (action === 'report' && id) {
                ctx = { page: 'report', report_id: id, label: 'Отчёт ' + (title || id) };
            } else if (action === 'dir_admin') {
                ctx = { page: 'dir_admin', label: 'Файлы базы' };
            } else if (action && /^[\w-]{1,64}$/.test(action)
                && ['main', 'edit_obj', 'object', 'table', 'report'].indexOf(action) < 0) {
                ctx = { page: 'workplace', workplace: action, label: 'Рабочее место ' + action };
            }
            if (!ctx) return null;

            var filters = {}, nFilters = 0;
            String(env.search || '').replace(/^\?/, '').split('&').forEach(function (pair) {
                if (!pair || nFilters >= 20) return;
                var eq = pair.indexOf('=');
                var key, val;
                try {
                    key = decodeURIComponent((eq < 0 ? pair : pair.slice(0, eq)).replace(/\+/g, ' '));
                    val = eq < 0 ? '' : decodeURIComponent(pair.slice(eq + 1).replace(/\+/g, ' '));
                } catch (e) { return; }
                if (!/^(F|FR|TO)_[\wА-Яа-яЁё]+$/.test(key) || val === '') return;
                if (key === 'F_I' && ctx.page === 'table' && parseInt(val, 10) > 0) {
                    ctx.object_id = parseInt(val, 10);
                }
                filters[key] = val.slice(0, 200);
                nFilters++;
            });
            if (nFilters) ctx.filters = filters;

            var sel = [];
            (env.selection || []).forEach(function (v) {
                var n = parseInt(v, 10);
                if (n > 0 && sel.indexOf(n) < 0 && sel.length < IntegramAiAgentChat.maxSelection) sel.push(n);
            });
            if (sel.length) {
                ctx.selection = sel;
                ctx.label += ' · выделено ' + sel.length;
            }
            if (env.pathname) ctx.url = String(env.pathname) + String(env.search || '');
            return ctx;
        },

        // id выделенных строк всех integram-table на странице.
        collectSelection: function () {
            var list = this.pageGlobal('_integramTableInstances') || [];
            var ids = [];
            for (var t = 0; t < list.length; t++) {
                var inst = list[t];
                if (!inst || !inst.selectedRows || !inst.selectedRows.size) continue;
                var rows = inst.rawObjectData || [];
                inst.selectedRows.forEach(function (idx) {
                    if (rows[idx] && rows[idx].i) ids.push(rows[idx].i);
                });
            }
            return ids;
        },

        // Название таблицы/отчёта со страницы — последний пункт «хлебных крошек».
        pageTitle: function () {
            if (typeof document === 'undefined' || !document.querySelector) return '';
            var el = document.querySelector('.breadcrumb-item.active');
            return el ? el.textContent : '';
        },

        getScreenContext: function () {
            if (this.contextDismissed) return null;
            var loc = (typeof window !== 'undefined' && window.location) || {};
            return this.buildScreenContext({
                action: typeof action !== 'undefined' ? action : this.pageGlobal('action'),
                id: typeof id !== 'undefined' ? id : this.pageGlobal('id'),
                typeId: this.pageGlobal('type'),
                typeName: this.pageGlobal('typeName'),
                title: this.pageTitle(),
                pathname: loc.pathname || '',
                search: loc.search || '',
                selection: this.collectSelection()
            });
        },

        // Строка «Контекст: Сделка №5231» над полем ввода; крестик снимает контекст.
        renderContext: function () {
            var ctx = this.getScreenContext();
            if (!this.contextEl) {
                var anchor = this.attachmentsList;
                var parent = anchor && anchor.parentNode;
                if (!ctx || !parent || !parent.insertBefore) return ctx;
                var self = this;
                var el = document.createElement('div');
                el.className = 'ai-agent-context';
                var label = document.createElement('span');
                label.className = 'ai-agent-context-label';
                el.appendChild(label);
                var remove = document.createElement('button');
                remove.type = 'button';
                remove.className = 'ai-agent-context-remove';
                remove.title = 'Не передавать контекст страницы';
                remove.setAttribute('aria-label', 'Не передавать контекст страницы');
                remove.innerHTML = '<i class="pi pi-times"></i>';
                remove.addEventListener('click', function () { self.dismissContext(); });
                el.appendChild(remove);
                parent.insertBefore(el, anchor);
                this.contextEl = el;
                this.contextLabel = label;
            }
            this.contextEl.hidden = !ctx;
            if (ctx) this.contextLabel.textContent = 'Контекст: ' + ctx.label;
            return ctx;
        },

        dismissContext: function () {
            this.contextDismissed = true;
            this.renderContext();
        },

        getXsrfToken: function () {
            if (typeof xsrf !== 'undefined' && xsrf) return String(xsrf);
            if (typeof window !== 'undefined' && window.xsrf) return String(window.xsrf);
            var meta = document.querySelector ? document.querySelector('meta[name="_xsrf"]') : null;
            return meta ? meta.getAttribute('content') : '';
        },

        getAgentUrl: function () {
            var dbName = this.getCurrentDbName() || 'my';
            return '/' + encodeURIComponent(dbName) + '/ai/agent?JSON=1';
        },

        // GET-адрес статуса: по id задачи либо последней задачи (?latest).
        getStatusUrl: function (jobId) {
            var base = this.getAgentUrl();
            return jobId
                ? base + '&job=' + encodeURIComponent(jobId)
                : base + '&latest=1';
        },

        addFiles: function (fileList) {
            if (!fileList || !fileList.length) return;
            for (var i = 0; i < fileList.length; i++) {
                this.attachments.push(fileList[i]);
            }
            this.renderAttachments();
        },

        removeAttachment: function (index) {
            this.attachments.splice(index, 1);
            this.renderAttachments();
        },

        renderAttachments: function () {
            if (!this.attachmentsList) return;
            var self = this;
            this.attachmentsList.innerHTML = '';
            this.attachments.forEach(function (file, index) {
                var li = document.createElement('li');
                li.className = 'ai-agent-attachment';

                var icon = document.createElement('i');
                icon.className = 'pi pi-file';
                li.appendChild(icon);

                var name = document.createElement('span');
                name.className = 'ai-agent-attachment-name';
                name.textContent = file.name;
                li.appendChild(name);

                var remove = document.createElement('button');
                remove.type = 'button';
                remove.className = 'ai-agent-attachment-remove';
                remove.title = 'Убрать файл';
                remove.setAttribute('aria-label', 'Убрать файл');
                remove.innerHTML = '<i class="pi pi-times"></i>';
                remove.addEventListener('click', function () { self.removeAttachment(index); });
                li.appendChild(remove);

                self.attachmentsList.appendChild(li);
            });
        },

        setStatus: function (text) {
            if (this.statusEl) this.statusEl.textContent = text;
        },

        // --- Issue #3410: тексты ожидания (чистые функции, тестируются в node) ---

        // Сообщение в «пузыре» агента в зависимости от того, сколько уже ждём.
        waitMessage: function (elapsedMs) {
            elapsedMs = elapsedMs || 0;
            if (elapsedMs < 12000)
                return 'Думаю над ответом…';
            if (elapsedMs < 45000)
                return 'Думаю над ответом. Это может занять до минуты — подождите, пожалуйста…';
            return 'Задача поставлена в очередь, ответ придёт чуть позже. Можно закрыть окно — '
                + 'результат сохранится и откроется, когда вы вернётесь, даже из другого браузера.';
        },

        // Короткий текст в шапке панели.
        statusMessage: function (elapsedMs) {
            elapsedMs = elapsedMs || 0;
            if (elapsedMs < 12000)
                return 'ИИ-агент думает…';
            if (elapsedMs < 45000)
                return 'ИИ-агент думает, нужно ещё немного времени…';
            return 'Задача в очереди, ответ скоро будет…';
        },

        send: function () {
            if (this.sending) return;
            var text = this.input ? this.input.value.trim() : '';
            if (!text && !this.attachments.length) return;

            this.localActivity = true;
            this.addMessage('user', text || '(вложения)');

            var form = new FormData();
            form.append('_xsrf', this.getXsrfToken());
            form.append('message', text);
            var context = this.renderContext();
            if (context) form.append('context', JSON.stringify(context));
            this.attachments.forEach(function (file) {
                form.append('files[]', file, file.name);
            });

            if (this.input) this.input.value = '';
            this.attachments = [];
            this.renderAttachments();

            // Показываем «думает» сразу — ещё до того, как сервер вернул job.
            this.beginWaiting(null);

            var self = this;
            fetch(this.getAgentUrl(), {
                method: 'POST',
                body: form,
                credentials: 'same-origin',
                headers: { 'X-Requested-With': 'XMLHttpRequest' }
            }).then(function (response) {
                return response.json().catch(function () { return null; }).then(function (data) {
                    return { status: response.status, ok: response.ok, data: data };
                });
            }).then(function (result) {
                self.handleSubmitResponse(result);
            }).catch(function () {
                // Соединение оборвалось (например, таймаут сервера). Задача уже
                // создана на сервере — пробуем подхватить её опросом.
                self.recoverAfterSubmitFailure();
            });
        },

        handleSubmitResponse: function (result) {
            var data = result.data;

            // Оплата не подтверждена / истекла — index.php возвращает 402 + ссылку.
            if (result.status === 402 && data) {
                this.replaceThinking(this.getErrorText(data) || 'Доступ к ИИ-агенту не оплачен.', data.payUrl);
                this.endWaiting();
                return;
            }

            if (!result.ok && (!data || !data.job)) {
                this.replaceThinking(this.getErrorText(data) || 'ИИ-агент недоступен. Повторите попытку позже.');
                this.endWaiting();
                return;
            }

            this.routeJob(data && data.job ? data.job : null, false);
        },

        // Подхват задачи, если submit-запрос не дождался ответа (обрыв/таймаут).
        recoverAfterSubmitFailure: function () {
            var self = this;
            fetch(this.getStatusUrl(null), {
                credentials: 'same-origin',
                headers: { 'X-Requested-With': 'XMLHttpRequest' }
            }).then(function (response) {
                return response.json().catch(function () { return null; });
            }).then(function (data) {
                var job = data && data.job ? data.job : null;
                if (job) {
                    self.routeJob(job, false);
                } else {
                    self.replaceThinking('Не удалось связаться с ИИ-агентом. Повторите попытку позже.');
                    self.endWaiting();
                }
            }).catch(function () {
                self.replaceThinking('Не удалось связаться с ИИ-агентом. Повторите попытку позже.');
                self.endWaiting();
            });
        },

        // Маршрутизация задачи по статусу. fromPoll=true — вызвано опросом (тогда
        // временные сбои не считаем фатальными).
        routeJob: function (job, fromPoll) {
            if (!job) {
                if (!fromPoll) {
                    this.replaceThinking('ИИ-агент недоступен. Повторите попытку позже.');
                    this.endWaiting();
                }
                return;
            }
            this.activeJobId = job.id;

            if (job.status === 'done') {
                this.finalizeAnswer(job);
                this.endWaiting();
                return;
            }
            if (job.status === 'error') {
                this.replaceThinking(this.getErrorText(job.result) || job.error || 'ИИ-агент завершил работу с ошибкой.');
                this.endWaiting();
                return;
            }
            // queued / processing — ждём дальше и опрашиваем статус.
            if (!this.currentBubble) this.currentBubble = this.addThinkingBubble();
            if (!this.sending) this.beginWaiting(job.id);
            this.ensurePolling(job.id);
        },

        finalizeAnswer: function (job) {
            var content = this.getAssistantContent(job.result) || 'ИИ-агент не вернул ответ.';
            this.replaceThinking(content);
            if (job.id) this.rendered[job.id] = true;
        },

        // --- ожидание и индикатор «думает» ---

        beginWaiting: function (jobId) {
            this.sending = true;
            if (this.sendBtn) this.sendBtn.disabled = true;
            if (this.attachBtn) this.attachBtn.disabled = true;
            this.thinkStart = this.now();
            if (!this.currentBubble) this.currentBubble = this.addThinkingBubble();
            this.activeJobId = jobId || this.activeJobId;
            this.updateWaiting();
            this.startTick();
        },

        endWaiting: function () {
            this.sending = false;
            if (this.sendBtn) this.sendBtn.disabled = false;
            if (this.attachBtn) this.attachBtn.disabled = false;
            this.stopTick();
            this.stopPolling();
            this.activeJobId = null;
            this.currentBubble = null;
            if (this.statusEl) this.statusEl.classList.remove('is-waiting');
            this.setStatus('Готов к работе');
        },

        startTick: function () {
            this.stopTick();
            var self = this;
            if (typeof setInterval === 'undefined') return;
            this.tickTimer = setInterval(function () { self.updateWaiting(); }, 1000);
        },

        stopTick: function () {
            if (this.tickTimer && typeof clearInterval !== 'undefined') clearInterval(this.tickTimer);
            this.tickTimer = null;
        },

        updateWaiting: function () {
            var elapsed = this.now() - this.thinkStart;
            if (this.statusEl) this.statusEl.classList.add('is-waiting');
            this.setStatus(this.statusMessage(elapsed));
            if (this.currentBubble && this.currentBubble.label)
                this.currentBubble.label.textContent = this.waitMessage(elapsed);
        },

        ensurePolling: function (jobId) {
            if (!jobId) return;
            this.activeJobId = jobId;
            if (this.pollTimer && this.pollJobId === jobId) return;
            this.stopPolling();
            this.pollJobId = jobId;
            var self = this;
            if (typeof setInterval === 'undefined') return;
            this.pollTimer = setInterval(function () { self.pollOnce(); }, this.pollIntervalMs);
        },

        stopPolling: function () {
            if (this.pollTimer && typeof clearInterval !== 'undefined') clearInterval(this.pollTimer);
            this.pollTimer = null;
            this.pollJobId = null;
        },

        pollOnce: function () {
            var jobId = this.pollJobId;
            if (!jobId) return;
            var self = this;
            fetch(this.getStatusUrl(jobId), {
                credentials: 'same-origin',
                headers: { 'X-Requested-With': 'XMLHttpRequest' }
            }).then(function (response) {
                return response.json().catch(function () { return null; });
            }).then(function (data) {
                // Нет данных — временный сбой/таймаут опроса, продолжаем ждать.
                if (!data || !data.job) return;
                self.routeJob(data.job, true);
            }).catch(function () {
                // Сетевой сбой опроса не фатален: задача жива на сервере.
            });
        },

        // --- восстановление при открытии (в т.ч. из другого браузера) ---

        resume: function () {
            if (this.resumeChecked) return;
            this.resumeChecked = true;
            if (this.localActivity) return;
            if (typeof fetch === 'undefined') return;
            var self = this;
            fetch(this.getStatusUrl(null), {
                credentials: 'same-origin',
                headers: { 'X-Requested-With': 'XMLHttpRequest' }
            }).then(function (response) {
                return response.json().catch(function () { return null; });
            }).then(function (data) {
                var job = data && data.job ? data.job : null;
                if (!job || self.localActivity) return;
                self.restoreJob(job);
            }).catch(function () {});
        },

        restoreJob: function (job) {
            if (!job || !job.id || this.rendered[job.id]) return;
            this.addMessage('user', job.message || '(вложения)');
            this.rendered[job.id] = true;

            if (job.status === 'done') {
                this.addMessage('assistant', this.getAssistantContent(job.result) || 'ИИ-агент не вернул ответ.');
                return;
            }
            if (job.status === 'error') {
                this.addMessage('assistant', this.getErrorText(job.result) || job.error || 'ИИ-агент завершил работу с ошибкой.');
                return;
            }
            // Задача ещё выполняется — показываем «думает» и продолжаем опрос.
            this.currentBubble = this.addThinkingBubble();
            this.beginWaiting(job.id);
            this.ensurePolling(job.id);
        },

        // --- сообщения ленты ---

        getAssistantContent: function (data) {
            if (!data) return '';
            if (data.assistant && typeof data.assistant.content === 'string') return data.assistant.content;
            if (typeof data.content === 'string') return data.content;
            if (typeof data.message === 'string') return data.message;
            return '';
        },

        getErrorText: function (data) {
            if (!data) return '';
            if (typeof data.error === 'string') return data.error;
            if (data.error && data.error.message) return data.error.message;
            return '';
        },

        addMessage: function (role, text, payUrl) {
            if (!this.messages) return null;
            var wrap = document.createElement('div');
            wrap.className = 'ai-chat-message ' + (role === 'user' ? 'ai-chat-message-user' : 'ai-chat-message-assistant');

            var author = document.createElement('div');
            author.className = 'ai-chat-message-author';
            author.textContent = role === 'user' ? 'Вы' : 'ИИ-агент';
            wrap.appendChild(author);

            var body = document.createElement('div');
            body.className = 'ai-chat-message-text';
            body.textContent = text;
            wrap.appendChild(body);

            if (payUrl) this.appendPayLink(wrap, payUrl);

            this.messages.appendChild(wrap);
            this.scrollToBottom();
            return wrap;
        },

        appendPayLink: function (wrap, payUrl) {
            var link = document.createElement('a');
            link.className = 'ai-chat-message-pay';
            link.href = payUrl;
            link.target = '_blank';
            link.rel = 'noopener';
            link.textContent = 'Перейти к оплате';
            wrap.appendChild(link);
        },

        // «Пузырь» агента с анимированным индикатором набора и подписью ожидания.
        addThinkingBubble: function () {
            if (!this.messages) return null;
            var wrap = document.createElement('div');
            wrap.className = 'ai-chat-message ai-chat-message-assistant ai-chat-message-thinking';

            var author = document.createElement('div');
            author.className = 'ai-chat-message-author';
            author.textContent = 'ИИ-агент';
            wrap.appendChild(author);

            var body = document.createElement('div');
            body.className = 'ai-chat-message-text';

            var dots = document.createElement('span');
            dots.className = 'ai-agent-typing';
            dots.setAttribute('aria-hidden', 'true');
            dots.innerHTML = '<i></i><i></i><i></i>';
            body.appendChild(dots);

            var label = document.createElement('span');
            label.className = 'ai-agent-thinking-label';
            label.textContent = this.waitMessage(0);
            body.appendChild(label);

            wrap.appendChild(body);
            this.messages.appendChild(wrap);
            this.scrollToBottom();
            return { el: wrap, label: label };
        },

        // Заменяет «думает»-пузырь готовым ответом (или создаёт новое сообщение).
        replaceThinking: function (text, payUrl) {
            var bubble = this.currentBubble;
            if (bubble && bubble.el) {
                bubble.el.className = 'ai-chat-message ai-chat-message-assistant';
                var body = bubble.el.querySelector('.ai-chat-message-text');
                if (body) {
                    body.innerHTML = '';
                    body.textContent = text;
                }
                if (payUrl) this.appendPayLink(bubble.el, payUrl);
                this.scrollToBottom();
            } else {
                this.addMessage('assistant', text, payUrl);
            }
            this.currentBubble = null;
        },

        scrollToBottom: function () {
            var body = this.messages ? this.messages.parentNode : null;
            if (body && typeof body.scrollTop === 'number') body.scrollTop = body.scrollHeight;
        },

        now: function () {
            return (typeof Date !== 'undefined' && Date.now) ? Date.now() : 0;
        }
    };

    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function () { IntegramAiAgentChat.init(); });
        } else {
            IntegramAiAgentChat.init();
        }
    }

    if (typeof window !== 'undefined') window.IntegramAiAgentChat = IntegramAiAgentChat;
    if (typeof module !== 'undefined' && module.exports) module.exports = IntegramAiAgentChat;
})();
