/*
 * Issue #3392: упрощённый ИИ-чат. Issue #3410: асинхронная работа агента.
 *
 * Новый чат связан только с нашим фиксированным ИИ-агентом текущей базы данных.
 * Доступ к агенту разрешён сервером (index.php, ветка /{db}/ai/agent) только
 * пользователю, имя которого совпадает с именем базы, и только при действующей
 * оплате. Все действия агента ограничены текущей базой данных.
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
            this.backdrop = document.getElementById('ai-agent-backdrop');
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

            var self = this;

            this.toggle.addEventListener('click', function () { self.togglePanel(); });
            if (this.closeBtn) this.closeBtn.addEventListener('click', function () { self.closePanel(); });
            if (this.backdrop) this.backdrop.addEventListener('click', function () { self.closePanel(); });

            document.addEventListener('keydown', function (e) {
                if (e.key === 'Escape' && self.isOpen()) self.closePanel();
            });

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
            if (this.backdrop) this.backdrop.hidden = false;
            if (this.toggle) this.toggle.setAttribute('aria-expanded', 'true');
            if (this.input) this.input.focus();
            this.resume();
            this.scrollToBottom();
        },

        closePanel: function () {
            if (!this.panel) return;
            this.panel.classList.remove('open');
            this.panel.setAttribute('aria-hidden', 'true');
            this.panel.setAttribute('inert', '');
            if (this.backdrop) this.backdrop.hidden = true;
            if (this.toggle) this.toggle.setAttribute('aria-expanded', 'false');
        },

        getCurrentDbName: function () {
            if (typeof db !== 'undefined' && db) return String(db);
            if (typeof window !== 'undefined' && window.db) return String(window.db);
            var parts = window.location.pathname.split('/').filter(Boolean);
            return parts.length > 0 ? parts[0] : '';
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
