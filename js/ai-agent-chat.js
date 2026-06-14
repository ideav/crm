/*
 * Issue #3392: упрощённый ИИ-чат.
 *
 * Новый чат связан только с нашим фиксированным ИИ-агентом текущей базы данных.
 * Доступ к агенту разрешён сервером (index.php, ветка /{db}/ai/agent) только
 * пользователю, имя которого совпадает с именем базы, и только при действующей
 * оплате. Все действия агента ограничены текущей базой данных.
 *
 * Старый расширенный ИИ-чат (js/ai-chat.js) скрыт из интерфейса, но оставлен в
 * репозитории как backend-история.
 */
(function () {
    'use strict';

    var IntegramAiAgentChat = {
        attachments: [],
        sending: false,

        init: function () {
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

        setSending: function (sending) {
            this.sending = sending;
            if (this.sendBtn) this.sendBtn.disabled = sending;
            if (this.attachBtn) this.attachBtn.disabled = sending;
            this.setStatus(sending ? 'ИИ-агент печатает…' : 'Готов к работе');
        },

        send: function () {
            if (this.sending) return;
            var text = this.input ? this.input.value.trim() : '';
            if (!text && !this.attachments.length) return;

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
            this.setSending(true);

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
                self.setSending(false);
                self.handleResponse(result);
            }).catch(function () {
                self.setSending(false);
                self.addMessage('assistant', 'Не удалось связаться с ИИ-агентом. Повторите попытку позже.');
            });
        },

        handleResponse: function (result) {
            var data = result.data;

            // Оплата не подтверждена / истекла — index.php возвращает 402 + ссылку.
            if (result.status === 402 && data) {
                this.addMessage('assistant', this.getErrorText(data) || 'Доступ к ИИ-агенту не оплачен.', data.payUrl);
                return;
            }

            if (!result.ok || !data) {
                this.addMessage('assistant', this.getErrorText(data) || 'ИИ-агент недоступен. Повторите попытку позже.');
                return;
            }

            var content = this.getAssistantContent(data);
            this.addMessage('assistant', content || 'ИИ-агент не вернул ответ.');
        },

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
            if (!this.messages) return;
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

            if (payUrl) {
                var link = document.createElement('a');
                link.className = 'ai-chat-message-pay';
                link.href = payUrl;
                link.target = '_blank';
                link.rel = 'noopener';
                link.textContent = 'Перейти к оплате';
                wrap.appendChild(link);
            }

            this.messages.appendChild(wrap);
            this.scrollToBottom();
        },

        scrollToBottom: function () {
            var body = this.messages ? this.messages.parentNode : null;
            if (body && typeof body.scrollTop === 'number') body.scrollTop = body.scrollHeight;
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { IntegramAiAgentChat.init(); });
    } else {
        IntegramAiAgentChat.init();
    }

    if (typeof window !== 'undefined') window.IntegramAiAgentChat = IntegramAiAgentChat;
})();
