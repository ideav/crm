        renderSubordinateCreateForm(metadata, arrId, parentRecordId) {
            // Track modal depth for z-index stacking
            if (!window._integramModalDepth) {
                window._integramModalDepth = 0;
            }
            window._integramModalDepth++;
            const modalDepth = window._integramModalDepth;
            const baseZIndex = 1000 + (modalDepth * 10);

            // Create a new form modal for subordinate record
            const overlay = document.createElement('div');
            overlay.className = 'edit-form-overlay subordinate-form-overlay';
            overlay.style.zIndex = baseZIndex;
            overlay.dataset.modalDepth = modalDepth;

            const modal = document.createElement('div');
            modal.className = 'edit-form-modal subordinate-form-modal';
            modal.style.zIndex = baseZIndex + 1;
            modal.dataset.modalDepth = modalDepth;

            // Add cascade offset for nested modals (6px per level)
            const cascadeOffset = (modalDepth - 1) * 6;
            modal.style.transform = `translate(calc(-50% + ${cascadeOffset}px), calc(-50% + ${cascadeOffset}px))`;

            const typeName = this.getMetadataName(metadata);
            const title = `Создание: ${ typeName }`;

            // Build form for regular fields only (no nested subordinate tables in create mode)
            const reqs = metadata.reqs || [];
            const regularFields = reqs.filter(req => !req.arr_id);

            // Determine the type of the main (first column) field
            const mainFieldType = this.normalizeFormat(metadata.type);

            // Get current date/datetime for default values
            const now = new Date();
            const currentDateHtml5 = now.toISOString().split('T')[0]; // YYYY-MM-DD
            const minutes = Math.round(now.getMinutes() / 5) * 5; // Round to 5 minutes
            now.setMinutes(minutes);
            const currentDateTimeHtml5 = now.toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
            const currentDateDisplay = now.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '.'); // DD.MM.YYYY
            const currentDateTimeDisplay = currentDateDisplay + ' ' + now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); // DD.MM.YYYY HH:MM

            // Build main field HTML based on its type
            let mainFieldHtml = '';
            if (mainFieldType === 'BOOLEAN') {
                mainFieldHtml = `<input type="checkbox" id="sub-field-main" name="main" value="1">`;
            } else if (mainFieldType === 'DATE') {
                mainFieldHtml = `<input type="date" class="form-control date-picker" id="sub-field-main-picker" required data-target="sub-field-main" value="${ currentDateHtml5 }">`;
                mainFieldHtml += `<input type="hidden" id="sub-field-main" name="main" value="${ currentDateDisplay }">`;
            } else if (mainFieldType === 'DATETIME') {
                mainFieldHtml = `<input type="datetime-local" class="form-control datetime-picker" id="sub-field-main-picker" required data-target="sub-field-main" value="${ currentDateTimeHtml5 }">`;
                mainFieldHtml += `<input type="hidden" id="sub-field-main" name="main" value="${ currentDateTimeDisplay }">`;
            } else if (mainFieldType === 'NUMBER' || mainFieldType === 'SIGNED') {
                mainFieldHtml = `<input type="number" class="form-control" id="sub-field-main" name="main" value="" required ${ mainFieldType === 'SIGNED' ? 'step="0.01"' : '' }>`;
            } else if (mainFieldType === 'MEMO') {
                mainFieldHtml = `<textarea class="form-control memo-field" id="sub-field-main" name="main" rows="4" required></textarea>`;
            } else if (mainFieldType === 'GRANT') {
                // GRANT field (dropdown with options from GET grants API - issue #593)
                mainFieldHtml = `
                    <select class="form-control form-grant-select" id="sub-field-main" name="main" required data-grant-type="grant">
                        <option value="">Загрузка...</option>
                    </select>
                `;
            } else if (mainFieldType === 'REPORT_COLUMN') {
                // REPORT_COLUMN field (dropdown with options from GET rep_cols API - issue #593)
                mainFieldHtml = `
                    <select class="form-control form-grant-select" id="sub-field-main" name="main" required data-grant-type="rep_col">
                        <option value="">Загрузка...</option>
                    </select>
                `;
            } else {
                // Default: text input (SHORT, CHARS, etc.)
                mainFieldHtml = `<input type="text" class="form-control" id="sub-field-main" name="main" value="" required>`;
            }

            let formHtml = `
                <div class="edit-form-header">
                    <h3>${ title }</h3>
                    <button class="edit-form-close subordinate-close-btn"><i class="pi pi-times"></i></button>
                </div>
                <div class="edit-form-body">
                    <form id="subordinate-edit-form" class="edit-form" onsubmit="return false;" autocomplete="off">
                        <div class="form-group">
                            <label for="sub-field-main">${ typeName } <span class="required">*</span></label>
                            ${ mainFieldHtml }
                        </div>
            `;

            regularFields.forEach(req => {
                const attrs = this.parseAttrs(req.attrs);
                const fieldName = attrs.alias || req.val;
                const baseFormat = this.normalizeFormat(req.type);
                const isRequired = attrs.required;
                const isMulti = attrs.multi;

                formHtml += `<div class="form-group">`;
                formHtml += `<label for="sub-field-${ req.id }">${ fieldName }${ isRequired ? ' <span class="required">*</span>' : '' }</label>`;

                // Multi-select reference field (issue #1772)
                if (req.ref_id && isMulti) {
                    formHtml += `
                        <div class="form-reference-editor form-multi-reference-editor" data-ref-id="${ req.id }" data-required="${ isRequired }" data-ref-type-id="${ req.orig || req.ref_id }" data-multi="1" data-current-value="">
                            <div class="inline-editor-reference form-ref-editor-box inline-editor-multi-reference">
                                <div class="multi-ref-tags-container form-multi-ref-tags-container">
                                    <span class="multi-ref-tags-placeholder">Загрузка...</span>
                                </div>
                                <div class="inline-editor-reference-header">
                                    <input type="text"
                                           class="inline-editor-reference-search form-ref-search"
                                           id="sub-field-${ req.id }-search"
                                           placeholder="Добавить..."
                                           autocomplete="off">
                                    <button class="inline-editor-reference-add form-ref-add" style="display: none;" title="Создать запись" aria-label="Создать запись" type="button"><i class="pi pi-plus"></i></button>
                                </div>
                                <div class="inline-editor-reference-dropdown form-ref-dropdown" id="sub-field-${ req.id }-dropdown" style="display:none;">
                                    <div class="inline-editor-reference-empty">Загрузка...</div>
                                </div>
                            </div>
                            <input type="hidden"
                                   class="form-ref-value form-multi-ref-value"
                                   id="sub-field-${ req.id }"
                                   name="t${ req.id }"
                                   value=""
                                   data-ref-id="${ req.id }">
                        </div>
                    `;
                }
                // Single-select reference field
                else if (req.ref_id) {
                    formHtml += `
                        <div class="form-reference-editor" data-ref-id="${ req.id }" data-required="${ isRequired }" data-ref-type-id="${ req.orig || req.ref_id }">
                            <div class="inline-editor-reference form-ref-editor-box">
                                <div class="inline-editor-reference-header">
                                    <input type="text"
                                           class="inline-editor-reference-search form-ref-search"
                                           id="sub-field-${ req.id }-search"
                                           placeholder="Поиск..."
                                           autocomplete="off">
                                    <button class="inline-editor-reference-clear form-ref-clear" title="Очистить значение" aria-label="Очистить значение" type="button"><i class="pi pi-times"></i></button>
                                    <button class="inline-editor-reference-add form-ref-add" style="display: none;" title="Создать запись" aria-label="Создать запись" type="button"><i class="pi pi-plus"></i></button>
                                </div>
                                <div class="inline-editor-reference-dropdown form-ref-dropdown" id="sub-field-${ req.id }-dropdown">
                                    <div class="inline-editor-reference-empty">Загрузка...</div>
                                </div>
                            </div>
                            <input type="hidden"
                                   class="form-ref-value"
                                   id="sub-field-${ req.id }"
                                   name="t${ req.id }"
                                   value=""
                                   data-ref-id="${ req.id }">
                        </div>
                    `;
                }
                else if (baseFormat === 'BOOLEAN') {
                    formHtml += `<input type="checkbox" id="sub-field-${ req.id }" name="t${ req.id }" value="1">`;
                }
                else if (baseFormat === 'DATE') {
                    // Only apply default value for the first column (where req.id equals arrId)
                    const isFirstColumn = String(req.id) === String(arrId);
                    const dateValue = isFirstColumn ? currentDateHtml5 : '';
                    const dateDisplay = isFirstColumn ? currentDateDisplay : '';
                    formHtml += `<input type="date" class="form-control date-picker" id="sub-field-${ req.id }-picker" ${ isRequired ? 'required' : '' } data-target="sub-field-${ req.id }" value="${ dateValue }">`;
                    formHtml += `<input type="hidden" id="sub-field-${ req.id }" name="t${ req.id }" value="${ dateDisplay }">`;
                }
                else if (baseFormat === 'DATETIME') {
                    // Only apply default value for the first column (where req.id equals arrId)
                    const isFirstColumn = String(req.id) === String(arrId);
                    const dateTimeValue = isFirstColumn ? currentDateTimeHtml5 : '';
                    const dateTimeDisplay = isFirstColumn ? currentDateTimeDisplay : '';
                    formHtml += `<input type="datetime-local" class="form-control datetime-picker" id="sub-field-${ req.id }-picker" ${ isRequired ? 'required' : '' } data-target="sub-field-${ req.id }" value="${ dateTimeValue }">`;
                    formHtml += `<input type="hidden" id="sub-field-${ req.id }" name="t${ req.id }" value="${ dateTimeDisplay }">`;
                }
                else if (baseFormat === 'MEMO') {
                    formHtml += `<textarea class="form-control memo-field" id="sub-field-${ req.id }" name="t${ req.id }" rows="4" ${ isRequired ? 'required' : '' }></textarea>`;
                }
                // GRANT field (dropdown with options from GET grants API - issue #593)
                else if (baseFormat === 'GRANT') {
                    formHtml += `
                        <select class="form-control form-grant-select" id="sub-field-${ req.id }" name="t${ req.id }" ${ isRequired ? 'required' : '' } data-grant-type="grant">
                            <option value="">Загрузка...</option>
                        </select>
                    `;
                }
                // REPORT_COLUMN field (dropdown with options from GET rep_cols API - issue #593)
                else if (baseFormat === 'REPORT_COLUMN') {
                    formHtml += `
                        <select class="form-control form-grant-select" id="sub-field-${ req.id }" name="t${ req.id }" ${ isRequired ? 'required' : '' } data-grant-type="rep_col">
                            <option value="">Загрузка...</option>
                        </select>
                    `;
                }
                else {
                    formHtml += `<input type="text" class="form-control" id="sub-field-${ req.id }" name="t${ req.id }" value="" ${ isRequired ? 'required' : '' }>`;
                }

                formHtml += `</div>`;
            });

            formHtml += `
                    </form>
                </div>
                <div class="edit-form-footer">
                    <div class="edit-form-footer-buttons">
                        <button type="button" class="btn btn-primary" id="subordinate-save-btn">Создать</button>
                        <button type="button" class="btn btn-secondary subordinate-cancel-btn">Отменить</button>
                    </div>
                </div>
            `;

            modal.innerHTML = formHtml;
            document.body.appendChild(overlay);
            document.body.appendChild(modal);

            // Load reference options (scoped to this modal)
            this.loadReferenceOptions(regularFields, 0, modal);

            // Load GRANT and REPORT_COLUMN dropdown options (issue #577)
            this.loadGrantAndReportColumnOptions(modal);

            // Attach date picker handlers
            this.attachDatePickerHandlers(modal);

            // Attach file upload handlers
            this.attachFormFileUploadHandlers(modal);

            // Close handlers
            const closeModal = () => {
                modal.remove();
                overlay.remove();
                window._integramModalDepth = Math.max(0, (window._integramModalDepth || 1) - 1);
            };

            modal.querySelector('.subordinate-close-btn').addEventListener('click', closeModal);
            modal.querySelector('.subordinate-cancel-btn').addEventListener('click', closeModal);
            overlay.addEventListener('click', closeModal);

            // Close on Escape key (issue #595)
            const handleEscape = (e) => {
                if (e.key === 'Escape') {
                    // Only close if this modal is the topmost one
                    const currentDepth = parseInt(modal.dataset.modalDepth) || 0;
                    const maxDepth = window._integramModalDepth || 0;
                    if (currentDepth === maxDepth) {
                        closeModal();
                        document.removeEventListener('keydown', handleEscape);
                    }
                }
            };
            document.addEventListener('keydown', handleEscape);

            // Enter in input/textarea triggers Save (issue #1467)
            const saveBtn = modal.querySelector('#subordinate-save-btn');
            modal.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
                    if (!saveBtn.disabled) {
                        e.preventDefault();
                        saveBtn.click();
                    }
                }
            });

            // Save handler
            modal.querySelector('#subordinate-save-btn').addEventListener('click', async () => {
                const form = modal.querySelector('#subordinate-edit-form');

                if (!form.checkValidity()) {
                    form.reportValidity();
                    return;
                }

                const formData = new FormData(form);
                const params = new URLSearchParams();

                if (typeof xsrf !== 'undefined') {
                    params.append('_xsrf', xsrf);
                }

                // Get main value before iterating form fields
                const mainValue = formData.get('main');

                // Skip empty parameters when creating so server can fill defaults
                // Skip 'main' since it's handled separately as t{arrId}
                for (const [key, value] of formData.entries()) {
                    if (key === 'main') continue;
                    if (value !== '' && value !== null && value !== undefined) {
                        params.append(key, value);
                    }
                }

                // Add main value as t{arrId} parameter (issue #597)
                if (mainValue !== '' && mainValue !== null && mainValue !== undefined) {
                    params.append(`t${ arrId }`, mainValue);
                }

                const apiBase = this.getApiBase();
                const url = `${ apiBase }/_m_new/${ arrId }?JSON&up=${ parentRecordId }`;

                try {
                    const response = await fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: params.toString()
                    });

                    let result;
                    const responseText = await response.text();

                    try {
                        result = JSON.parse(responseText);
                    } catch (jsonError) {
                        // Invalid JSON response
                        throw new Error(`Невалидный JSON ответ: ${responseText}`);
                    }

                    const serverError = this.getServerError(result);
                    if (serverError) {
                        throw new Error(serverError);
                    }
                    if (result.warning) this.showToast(result.warning, 'warning');

                    closeModal();
                    this.showToast('Запись создана', 'success');

                    // Reload the subordinate table
                    if (this.currentEditModal) {
                        const tabContent = this.currentEditModal.modal.querySelector(`[data-tab-content="sub-${ this.currentEditModal.subordinateTables.find(t => t.arr_id === arrId)?.id }"]`);
                        if (tabContent) {
                            tabContent.dataset.loaded = '';
                            await this.loadSubordinateTable(tabContent, arrId, parentRecordId);
                            tabContent.dataset.loaded = 'true';

                            // Update tab count
                            const tab = this.currentEditModal.modal.querySelector(`[data-arr-id="${ arrId }"]`);
                            if (tab) {
                                const currentText = tab.textContent;
                                const match = currentText.match(/^(.+)\s*\((\d+)\)$/);
                                if (match) {
                                    const newCount = parseInt(match[2]) + 1;
                                    tab.textContent = `${ match[1] } (${ newCount })`;
                                }
                            }
                        }
                    }

                    // Reload subordinate table opened from cell
                    if (this.cellSubordinateContext && this.cellSubordinateContext.arrId === arrId) {
                        await this.loadSubordinateTable(this.cellSubordinateContext.container, arrId, parentRecordId);
                    }

                } catch (error) {
                    console.error('Error creating subordinate record:', error);
                    this.showToast(`Ошибка: ${ error.message }`, 'error');
                }
            });
        }

        attachPasswordResetHandlers(modal) {
            // Attach reset password button handlers for field id=20 (issue #1471)
            const resetBtns = modal.querySelectorAll('.pwd-reset-btn');
            const resetMailBtns = modal.querySelectorAll('.pwd-reset-mail-btn');

            const generatePassword = () => (Math.random().toString(36) + Math.random().toString(36)).replace(/\./g, '').substr(1, 8);

            const copyToClipboard = (text) => {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(text);
                } else {
                    const el = document.createElement('textarea');
                    el.value = text;
                    document.body.appendChild(el);
                    el.select();
                    document.execCommand('copy');
                    document.body.removeChild(el);
                }
            };

            const showCopied = (fieldId) => {
                const copiedSpan = modal.querySelector(`#field-${ fieldId }-copied`);
                if (copiedSpan) {
                    copiedSpan.style.display = '';
                    setTimeout(() => { copiedSpan.style.display = 'none'; }, 2500);
                }
            };

            resetBtns.forEach(btn => {
                btn.addEventListener('click', () => {
                    const fieldId = btn.dataset.fieldId;
                    const pwdInput = modal.querySelector(`#field-${ fieldId }`);
                    if (!pwdInput) return;
                    const pwd = generatePassword();
                    pwdInput.value = pwd;
                    copyToClipboard(pwd);
                    showCopied(fieldId);
                    // Warn user to save the generated password (issue #1481)
                    this.showCopyNotification('Пароль сгенерирован и скопирован в буфер. Обязательно сохраните эту форму!', false, 7000);
                });
            });

            resetMailBtns.forEach(btn => {
                btn.addEventListener('click', () => {
                    const fieldId = btn.dataset.fieldId;
                    const pwdInput = modal.querySelector(`#field-${ fieldId }`);
                    if (!pwdInput) return;
                    // Copy login link (username from first column of the table, issue #1479)
                    // Do not allow copying invitation before the record is saved (issue #1591)
                    const username = modal.dataset.firstColumnValue || '';
                    if (!username) {
                        this.showCopyNotification('Сохраните запись перед копированием приглашения', true, 5000);
                        return;
                    }
                    const pwd = generatePassword();
                    pwdInput.value = pwd;
                    const db = window.location.pathname.split('/')[1] || '';
                    // Build login link without prepending username as a separate line (issue #1591)
                    const loginLink = `Ссылка для входа: https://${ location.host }/start.html?db=${ db }&u=${ encodeURIComponent(username) }\nПароль: ${ pwd }`;
                    copyToClipboard(loginLink);
                    showCopied(fieldId);
                    // Warn user to save the generated password (issue #1481)
                    this.showCopyNotification('Пароль сгенерирован и скопирован в буфер. Обязательно сохраните эту форму!', false, 7000);
                });
            });
        }

        attachDatePickerHandlers(modal) {
            // Handle date pickers
            const datePickers = modal.querySelectorAll('.date-picker');
            datePickers.forEach(picker => {
                picker.addEventListener('change', (e) => {
                    const targetId = picker.dataset.target;
                    const hiddenInput = modal.querySelector(`#${ targetId }`);
                    if (hiddenInput) {
                        const displayValue = this.convertHtml5DateToDisplay(picker.value, false);
                        hiddenInput.value = displayValue;
                    }
                });
            });

            // Handle datetime pickers
            const datetimePickers = modal.querySelectorAll('.datetime-picker');
            datetimePickers.forEach(picker => {
                picker.addEventListener('change', (e) => {
                    const targetId = picker.dataset.target;
                    const hiddenInput = modal.querySelector(`#${ targetId }`);
                    if (hiddenInput) {
                        const displayValue = this.convertHtml5DateToDisplay(picker.value, true);
                        hiddenInput.value = displayValue;
                    }
                });
            });
        }

        attachFormFileUploadHandlers(modal) {
            const fileUploads = modal.querySelectorAll('.form-file-upload');
            fileUploads.forEach(uploadContainer => {
                const reqId = uploadContainer.dataset.reqId;
                const fileInput = uploadContainer.querySelector('.file-input');
                const dropzone = uploadContainer.querySelector('.file-dropzone');
                const selectBtn = uploadContainer.querySelector('.file-select-btn');
                const preview = uploadContainer.querySelector('.file-preview');
                const fileName = uploadContainer.querySelector('.file-name');
                const removeBtn = uploadContainer.querySelector('.file-remove-btn');
                const hiddenInput = uploadContainer.querySelector(`#field-${ reqId }`);

                // Click to select file
                selectBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    fileInput.click();
                });

                // Dropzone click
                dropzone.addEventListener('click', (e) => {
                    e.stopPropagation();
                    fileInput.click();
                });

                // File input change
                fileInput.addEventListener('change', async (e) => {
                    const file = e.target.files[0];
                    if (file) {
                        await this.handleFormFileSelection(file, uploadContainer, dropzone, preview, fileName, hiddenInput);
                    }
                    // Reset file input so selecting the same file again triggers change
                    fileInput.value = '';
                });

                // Drag and drop handlers
                dropzone.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    dropzone.classList.add('drag-over');
                });

                dropzone.addEventListener('dragleave', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    dropzone.classList.remove('drag-over');
                });

                dropzone.addEventListener('drop', async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    dropzone.classList.remove('drag-over');

                    const file = e.dataTransfer.files[0];
                    if (file) {
                        await this.handleFormFileSelection(file, uploadContainer, dropzone, preview, fileName, hiddenInput);
                    }
                });

                // Remove file button
                removeBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    // Check if this is an existing file (has original value) or newly uploaded
                    const originalValue = uploadContainer.dataset.originalValue || '';
                    if (originalValue) {
                        // Mark as deleted for existing files
                        hiddenInput.dataset.fileDeleted = 'true';
                    }
                    // Clear UI
                    const fileNameElement = preview.querySelector('.file-name');
                    if (fileNameElement.tagName === 'A') {
                        fileNameElement.outerHTML = `<span class="file-name"></span>`;
                    } else {
                        fileNameElement.textContent = '';
                    }
                    dropzone.style.display = 'flex';
                    preview.style.display = 'none';
                    fileInput.value = '';
                    hiddenInput.value = '';
                });
            });
        }

        async handleFormFileSelection(file, uploadContainer, dropzone, preview, fileName, hiddenInput) {
            // Show loading state
            const dropzoneText = dropzone.querySelector('.file-dropzone-text');
            const originalText = dropzoneText.textContent;
            dropzoneText.textContent = 'Загрузка...';

            try {
                // Store the file object in the upload container for later submission
                uploadContainer._fileToUpload = file;

                // Update UI - replace link with plain text since it's a new upload.
                // Re-query from uploadContainer to avoid using a stale reference that may have
                // been detached from the DOM by a previous outerHTML replacement (issue #1311).
                const currentFileName = uploadContainer.querySelector('.file-name');
                if (currentFileName && currentFileName.tagName === 'A') {
                    currentFileName.outerHTML = `<span class="file-name">${ this.escapeHtml(file.name) }</span>`;
                } else if (currentFileName) {
                    currentFileName.textContent = file.name;
                }
                dropzone.style.display = 'none';
                preview.style.display = 'flex';

                // Mark that a new file is selected (will be uploaded on save)
                hiddenInput.value = file.name; // Store filename temporarily
                hiddenInput.dataset.fileDeleted = 'false';
                hiddenInput.dataset.hasNewFile = 'true';

                dropzoneText.textContent = originalText;
            } catch (error) {
                console.error('Error preparing file:', error);
                this.showToast(`Ошибка подготовки файла: ${ error.message }`, 'error');
                dropzoneText.textContent = originalText;
            }
        }

        async loadReferenceOptions(reqs, recordId, modalElement) {
            // Load reference options for the new form-reference-editor elements
            // Scope query to the specific modal to avoid affecting other open modals
            const container = modalElement || document;
            const formRefEditors = container.querySelectorAll('.form-reference-editor');

            for (const wrapper of formRefEditors) {
                const refReqId = wrapper.dataset.refId;
                const refTypeId = wrapper.dataset.refTypeId;
                const searchInput = wrapper.querySelector('.form-ref-search');
                const dropdown = wrapper.querySelector('.form-ref-dropdown');
                const hiddenInput = wrapper.querySelector('.form-ref-value');
                const clearButton = wrapper.querySelector('.form-ref-clear');
                const addButton = wrapper.querySelector('.form-ref-add');

                if (!searchInput || !dropdown || !hiddenInput) continue;

                // Look up attrs from reqs metadata to determine if id parameter should be included (issue #1571)
                const reqMeta = reqs && Array.isArray(reqs) ? reqs.find(r => String(r.id) === String(refReqId)) : null;
                const refAttrs = (reqMeta && reqMeta.attrs) || wrapper.dataset.attrs || '';

                // Issue #853: Handle multi-select reference editors separately
                if (wrapper.dataset.multi === '1') {
                    this.initFormMultiReferenceEditor(wrapper, refReqId, recordId, refAttrs);
                    continue;
                }

                try {
                    let options = await this.fetchReferenceOptions(refReqId, recordId, '', {}, refAttrs);
                    const allOptionsFetched = options.length < 50;
                    const currentReference = this.resolveCurrentFormReferenceOption(options, hiddenInput.value);
                    options = currentReference.options;

                    // Store options data on the wrapper (array of [id, text] tuples)
                    wrapper._referenceOptions = options;
                    wrapper._allOptionsFetched = allOptionsFetched;

                    // Render options (hidden by default, shown on focus)
                    this.renderFormReferenceOptions(dropdown, options, hiddenInput, searchInput);
                    dropdown.style.display = 'none';

                    // Set current value if exists
                    if (currentReference.id) {
                        hiddenInput.value = currentReference.id;
                        if (currentReference.text) {
                            searchInput.value = currentReference.text;
                        }
                    }

                    // Handle search input
                    let searchTimeout;
                    searchInput.addEventListener('input', async (e) => {
                        const searchText = e.target.value.trim();

                        // Toggle buttons based on search input length (like inline editor)
                        if (searchText.length > 0) {
                            if (addButton) addButton.style.display = '';
                            if (clearButton) clearButton.style.display = 'none';
                        } else {
                            if (addButton) addButton.style.display = 'none';
                            if (clearButton) clearButton.style.display = '';
                        }

                        clearTimeout(searchTimeout);
                        searchTimeout = setTimeout(async () => {
                            if (searchText === '') {
                                this.renderFormReferenceOptions(dropdown, wrapper._referenceOptions, hiddenInput, searchInput);
                            } else {
                                // Filter locally first (options is array of [id, text] tuples)
                                const filtered = wrapper._referenceOptions.filter(([id, text]) =>
                                    text.toLowerCase().includes(searchText.toLowerCase())
                                );
                                this.renderFormReferenceOptions(dropdown, filtered, hiddenInput, searchInput);

                                // If not all fetched, re-query from server
                                if (!wrapper._allOptionsFetched) {
                                    try {
                                        const serverOptions = await this.fetchReferenceOptions(refReqId, recordId, searchText, wrapper._extraParams || {}, refAttrs);
                                        wrapper._referenceOptions = serverOptions;
                                        this.renderFormReferenceOptions(dropdown, serverOptions, hiddenInput, searchInput);
                                    } catch (error) {
                                        console.error('Error re-querying reference options:', error);
                                    }
                                }
                            }
                            dropdown.style.display = 'block';
                        }, 300);
                    });

                    // Show dropdown on focus
                    searchInput.addEventListener('focus', () => {
                        dropdown.style.display = 'block';
                    });

                    // Handle keyboard navigation
                    searchInput.addEventListener('keydown', (e) => {
                        if (e.key === 'ArrowDown') {
                            e.preventDefault();
                            const firstOption = dropdown.querySelector('.inline-editor-reference-option');
                            if (firstOption) firstOption.focus();
                        } else if (e.key === 'Enter') {
                            e.preventDefault();
                            const firstOption = dropdown.querySelector('.inline-editor-reference-option');
                            if (firstOption) firstOption.click();
                        }
                    });

                    // Handle keyboard navigation in dropdown
                    dropdown.addEventListener('keydown', (e) => {
                        const currentOption = document.activeElement;
                        if (e.key === 'ArrowDown') {
                            e.preventDefault();
                            const nextOption = currentOption.nextElementSibling;
                            if (nextOption && nextOption.classList.contains('inline-editor-reference-option')) nextOption.focus();
                        } else if (e.key === 'ArrowUp') {
                            e.preventDefault();
                            const prevOption = currentOption.previousElementSibling;
                            if (prevOption && prevOption.classList.contains('inline-editor-reference-option')) {
                                prevOption.focus();
                            } else {
                                searchInput.focus();
                            }
                        } else if (e.key === 'Enter') {
                            e.preventDefault();
                            currentOption.click();
                        }
                    });

                    // Handle option selection via click delegation
                    dropdown.addEventListener('click', (e) => {
                        const option = e.target.closest('.inline-editor-reference-option');
                        if (option) {
                            hiddenInput.value = option.dataset.id;
                            searchInput.value = option.dataset.text;
                            dropdown.style.display = 'none';
                            hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                    });

                    // Handle clear button
                    if (clearButton) {
                        clearButton.addEventListener('click', (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            hiddenInput.value = '';
                            searchInput.value = '';
                            this.renderFormReferenceOptions(dropdown, wrapper._referenceOptions, hiddenInput, searchInput);
                            dropdown.style.display = 'block';
                            hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
                        });
                    }

                    // Handle add button (create new record)
                    if (addButton && refTypeId) {
                        addButton.addEventListener('click', async (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const inputValue = searchInput.value.trim();
                            await this.openCreateFormForFormReference(refTypeId, inputValue, recordId, hiddenInput, searchInput, wrapper, dropdown);
                        });
                    }

                    // Hide dropdown when clicking outside the reference editor wrapper
                    document.addEventListener('click', (e) => {
                        if (!wrapper.contains(e.target)) {
                            dropdown.style.display = 'none';
                        }
                    });

                } catch (error) {
                    console.error('Error loading reference options:', error);
                    dropdown.innerHTML = '<div class="inline-editor-reference-empty">Ошибка загрузки</div>';
                }
            }

            // Set up field hooks from integramTableOverrides.fieldHooks
            // Hook format:
            //   { watch: 443, target: 4874, onEmpty: { FR_partners: '%' }, onFilled: { FR_partners: '!%' } }
            // When the watched field changes, extra params are applied to target field's dropdown query.
            const hooks = window.integramTableOverrides && window.integramTableOverrides.fieldHooks;
            if (hooks && Array.isArray(hooks)) {
                for (const hook of hooks) {
                    const watchId = String(hook.watch);
                    const targetId = String(hook.target);
                    const watchedWrapper = container.querySelector(`.form-reference-editor[data-ref-id="${ watchId }"]`);
                    const targetWrapper = container.querySelector(`.form-reference-editor[data-ref-id="${ targetId }"]`);
                    if (!watchedWrapper || !targetWrapper) continue;

                    const watchedHiddenInput = watchedWrapper.querySelector('.form-ref-value');
                    const targetHiddenInput = targetWrapper.querySelector('.form-ref-value');
                    const targetSearchInput = targetWrapper.querySelector('.form-ref-search');
                    const targetDropdown = targetWrapper.querySelector('.form-ref-dropdown');
                    if (!watchedHiddenInput || !targetHiddenInput || !targetSearchInput || !targetDropdown) continue;

                    const refReqId = targetWrapper.dataset.refId;

                    const applyHook = async () => {
                        const isEmpty = !watchedHiddenInput.value;
                        targetWrapper._extraParams = isEmpty ? (hook.onEmpty || {}) : (hook.onFilled || {});
                        const targetAttrs = (reqs && Array.isArray(reqs) ? (reqs.find(r => String(r.id) === String(refReqId)) || {}).attrs : '') || targetWrapper.dataset.attrs || '';
                        try {
                            const options = await this.fetchReferenceOptions(refReqId, recordId, '', targetWrapper._extraParams, targetAttrs);
                            targetWrapper._referenceOptions = options;
                            targetWrapper._allOptionsFetched = options.length < 50;
                            this.renderFormReferenceOptions(targetDropdown, options, targetHiddenInput, targetSearchInput);
                            targetDropdown.style.display = 'none';
                        } catch (error) {
                            console.error('Error reloading reference options for hook target:', error);
                        }
                    };

                    watchedHiddenInput.addEventListener('change', applyHook);
                    // Also apply immediately on form open based on current watched field value
                    applyHook();
                }
            }

            // Initialize "link to any record" editors (issue #1800)
            await this.initFormAnyRefEditors(container);
        }

        /**
         * Issue #1800: Initialize "link to any record" field editors in a form modal.
         * Fields with req.orig === '1' (no ref_id, no ref) allow selecting a record from any table.
         * If a value is already set, the table is resolved via get_record/{id}.
         * A table-picker button lets the user switch to any available table (dict?JSON).
         * Server-side search is used when a table has >= 20 records.
         */
        async initFormAnyRefEditors(container) {
            const apiBase = this.getApiBase();
            const editors = container.querySelectorAll('.form-any-ref-editor');

            for (const wrapper of editors) {
                const currentId = wrapper.dataset.currentId || '';
                const searchInput = wrapper.querySelector('.form-ref-search');
                const dropdown = wrapper.querySelector('.form-ref-dropdown');
                const hiddenInput = wrapper.querySelector('.form-ref-value');
                const clearButton = wrapper.querySelector('.form-ref-clear');
                const tableButton = wrapper.querySelector('.form-any-ref-table-btn');

                if (!searchInput || !dropdown || !hiddenInput) continue;

                // Load records from a table, with optional search text
                const loadTableRecords = async (tableId, searchText = '') => {
                    let url = `${ apiBase }/object/${ tableId }?JSON_OBJ`;
                    if (searchText) {
                        url += `&F_${ tableId }=%${ encodeURIComponent(searchText) }%`;
                    }
                    const resp = await fetch(url);
                    if (!resp.ok) throw new Error(`HTTP ${ resp.status }`);
                    const data = await resp.json();
                    return Array.isArray(data) ? data : [];
                };

                // Render records from object/?JSON_OBJ as dropdown options
                const renderRecordOptions = (records) => {
                    if (!records || records.length === 0) {
                        dropdown.innerHTML = '<div class="inline-editor-reference-empty">Нет записей</div>';
                        return;
                    }
                    dropdown.innerHTML = records.map(rec => {
                        const id = String(rec.i);
                        const text = (rec.r && rec.r[0] != null) ? String(rec.r[0]) : `#${ id }`;
                        const escaped = this.escapeHtml(text);
                        return `<div class="inline-editor-reference-option" data-id="${ id }" data-text="${ escaped }" tabindex="0">${ escaped }</div>`;
                    }).join('');
                };

                // Fetch dict?JSON and let user pick a table; then load records from it
                const showTableSelector = async () => {
                    dropdown.innerHTML = '<div class="inline-editor-reference-empty">Загрузка таблиц...</div>';
                    dropdown.style.display = 'block';
                    try {
                        const resp = await fetch(`${ apiBase }/dict?JSON`);
                        if (!resp.ok) throw new Error(`HTTP ${ resp.status }`);
                        const dict = await resp.json();
                        const entries = Object.entries(dict || {});
                        if (entries.length === 0) {
                            dropdown.innerHTML = '<div class="inline-editor-reference-empty">Нет доступных таблиц</div>';
                            return;
                        }
                        dropdown.innerHTML = entries.map(([tId, tName]) => {
                            const escaped = this.escapeHtml(String(tName));
                            return `<div class="inline-editor-reference-option form-any-ref-table-option" data-table-id="${ tId }" data-text="${ escaped }" tabindex="0">${ escaped }</div>`;
                        }).join('');
                        // Table selected: load its records (issue #1807)
                        dropdown.querySelectorAll('.form-any-ref-table-option').forEach(opt => {
                            opt.addEventListener('click', async (e) => {
                                // Stop propagation so the document outside-click handler
                                // does not close the dropdown when the option element is
                                // removed from DOM during innerHTML replacement
                                e.stopPropagation();
                                const tableId = opt.dataset.tableId;
                                wrapper._currentTableId = tableId;
                                searchInput.value = '';
                                dropdown.innerHTML = '<div class="inline-editor-reference-empty">Загрузка...</div>';
                                dropdown.style.display = 'block';
                                try {
                                    const records = await loadTableRecords(tableId);
                                    wrapper._currentRecords = records;
                                    wrapper._serverSearch = records.length >= 20;
                                    renderRecordOptions(records);
                                    dropdown.style.display = 'block';
                                    searchInput.focus();
                                } catch (e) {
                                    dropdown.innerHTML = `<div class="inline-editor-reference-empty">Ошибка: ${ this.escapeHtml(e.message) }</div>`;
                                    dropdown.style.display = 'block';
                                }
                            });
                        });
                    } catch (e) {
                        dropdown.innerHTML = '<div class="inline-editor-reference-empty">Ошибка загрузки таблиц</div>';
                    }
                };

                // If current value is set, resolve its table via get_record/{id}
                if (currentId) {
                    try {
                        const recResp = await fetch(`${ apiBase }/get_record/${ encodeURIComponent(currentId) }`);
                        if (recResp.ok) {
                            const recData = await recResp.json();
                            if (recData && recData.obj) {
                                wrapper._currentTableId = String(recData.obj);
                                const records = await loadTableRecords(recData.obj);
                                wrapper._currentRecords = records;
                                wrapper._serverSearch = records.length >= 20;
                            }
                        }
                    } catch (e) {
                        console.warn('Could not resolve any-record link table:', e);
                    }
                }

                // Show dropdown on focus
                searchInput.addEventListener('focus', () => {
                    if (wrapper._currentTableId) {
                        renderRecordOptions(wrapper._currentRecords || []);
                    } else {
                        dropdown.innerHTML = '<div class="inline-editor-reference-empty">Выберите таблицу <i class="pi pi-table"></i></div>';
                    }
                    dropdown.style.display = 'block';
                });

                // Search input with debounce
                let searchTimeout;
                searchInput.addEventListener('input', async (e) => {
                    const text = e.target.value.trim();
                    clearTimeout(searchTimeout);
                    searchTimeout = setTimeout(async () => {
                        if (!wrapper._currentTableId) {
                            dropdown.innerHTML = '<div class="inline-editor-reference-empty">Выберите таблицу <i class="pi pi-table"></i></div>';
                            dropdown.style.display = 'block';
                            return;
                        }
                        if (text === '') {
                            renderRecordOptions(wrapper._currentRecords || []);
                        } else if (wrapper._serverSearch) {
                            try {
                                const results = await loadTableRecords(wrapper._currentTableId, text);
                                renderRecordOptions(results);
                            } catch (e) {
                                dropdown.innerHTML = '<div class="inline-editor-reference-empty">Ошибка поиска</div>';
                            }
                        } else {
                            const lower = text.toLowerCase();
                            const filtered = (wrapper._currentRecords || []).filter(rec => {
                                const val = (rec.r && rec.r[0] != null) ? String(rec.r[0]) : '';
                                return val.toLowerCase().includes(lower);
                            });
                            renderRecordOptions(filtered);
                        }
                        dropdown.style.display = 'block';
                    }, 300);
                });

                // Keyboard navigation — search input
                searchInput.addEventListener('keydown', (e) => {
                    if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        const first = dropdown.querySelector('.inline-editor-reference-option');
                        if (first) first.focus();
                    } else if (e.key === 'Enter') {
                        e.preventDefault();
                        const first = dropdown.querySelector('.inline-editor-reference-option');
                        if (first) first.click();
                    }
                });

                // Keyboard navigation — dropdown
                dropdown.addEventListener('keydown', (e) => {
                    const cur = document.activeElement;
                    if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        const next = cur.nextElementSibling;
                        if (next && next.classList.contains('inline-editor-reference-option')) next.focus();
                    } else if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        const prev = cur.previousElementSibling;
                        if (prev && prev.classList.contains('inline-editor-reference-option')) {
                            prev.focus();
                        } else {
                            searchInput.focus();
                        }
                    } else if (e.key === 'Enter') {
                        e.preventDefault();
                        cur.click();
                    }
                });

                // Option selection (record, not table-picker options)
                dropdown.addEventListener('click', (e) => {
                    const option = e.target.closest('.inline-editor-reference-option');
                    if (option && !option.classList.contains('form-any-ref-table-option')) {
                        hiddenInput.value = option.dataset.id;
                        searchInput.value = option.dataset.text;
                        dropdown.style.display = 'none';
                        // Issue #1804: show clear button when a value is selected
                        if (clearButton) clearButton.style.display = '';
                        hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                });

                // Clear button — hidden when no value (issue #1804)
                if (clearButton) {
                    clearButton.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        hiddenInput.value = '';
                        searchInput.value = '';
                        clearButton.style.display = 'none';
                        if (wrapper._currentTableId) {
                            renderRecordOptions(wrapper._currentRecords || []);
                        }
                        dropdown.style.display = 'block';
                    });
                }

                // Table switcher button
                if (tableButton) {
                    tableButton.addEventListener('click', async (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        await showTableSelector();
                    });
                }

                // Close dropdown when clicking outside
                document.addEventListener('click', (e) => {
                    if (!wrapper.contains(e.target)) {
                        dropdown.style.display = 'none';
                    }
                });
            }
        }

        /**
         * Issue #853: Initialize a multi-select form reference editor.
         * Shows selected values as removable tags and a search input to add more.
         * Updates the hidden input with comma-separated selected IDs.
         */
        async initFormMultiReferenceEditor(wrapper, refReqId, recordId, attrs = '') {
            const searchInput = wrapper.querySelector('.form-ref-search');
            const dropdown = wrapper.querySelector('.form-ref-dropdown');
            const hiddenInput = wrapper.querySelector('.form-multi-ref-value');
            const tagsContainer = wrapper.querySelector('.form-multi-ref-tags-container');

            if (!searchInput || !dropdown || !hiddenInput || !tagsContainer) return;

            try {
                const options = await this.fetchReferenceOptions(refReqId, recordId, '', {}, attrs);
                wrapper._referenceOptions = options;
                wrapper._allOptionsFetched = options.length < 50;

                // Parse current value: "id1,id2,...:val1,val2,..." (issue #863) or plain display names
                const currentRawValue = wrapper.dataset.currentValue || '';
                // selectedItems: array of {id, text}
                const selectedItems = [];
                const rawColonIndex = currentRawValue.indexOf(':');
                if (currentRawValue && rawColonIndex > 0) {
                    // ids:values format — resolve each ID against fetched options
                    const ids = currentRawValue.substring(0, rawColonIndex).split(',').map(v => v.trim()).filter(v => v.length > 0);
                    // Issue #1786: Extract labels from the right side of ':' as fallback when ID is not in loaded options
                    const storedLabels = currentRawValue.substring(rawColonIndex + 1).split(',').map(v => v.trim());
                    for (let i = 0; i < ids.length; i++) {
                        const id = ids[i];
                        const match = options.find(([optId]) => String(optId) === id);
                        if (match) {
                            selectedItems.push({ id: match[0], text: match[1] });
                        } else {
                            // Use stored label from value string instead of showing raw ID (issue #1786)
                            const storedLabel = storedLabels[i] || id;
                            selectedItems.push({ id, text: storedLabel });
                        }
                    }
                } else {
                    // Fallback: parse display names and match by text
                    const currentTexts = currentRawValue
                        ? currentRawValue.split(',').map(v => v.trim()).filter(v => v.length > 0)
                        : [];
                    for (const text of currentTexts) {
                        const match = options.find(([id, t]) => t === text);
                        if (match) {
                            selectedItems.push({ id: match[0], text: match[1] });
                        } else if (text) {
                            selectedItems.push({ id: '', text });
                        }
                    }
                }
                wrapper._selectedItems = selectedItems;

                const updateHiddenInput = () => {
                    const ids = (wrapper._selectedItems || []).map(s => s.id).filter(id => id);
                    hiddenInput.value = ids.join(',');
                };

                const renderTags = () => {
                    const selected = wrapper._selectedItems || [];
                    if (selected.length === 0) {
                        tagsContainer.innerHTML = '<span class="multi-ref-tags-placeholder">Нет выбранных значений</span>';
                    } else {
                        tagsContainer.innerHTML = selected.map(({ id, text }) => `
                            <span class="multi-ref-tag" data-id="${this.escapeHtml(id)}" data-text="${this.escapeHtml(text)}">
                                ${this.escapeHtml(text)}
                                <button class="multi-ref-tag-remove" type="button" title="Удалить" aria-label="Удалить ${this.escapeHtml(text)}"><i class="pi pi-times"></i></button>
                            </span>
                        `).join('');
                    }
                };

                const renderDropdown = (searchText = '') => {
                    const selectedIds = new Set((wrapper._selectedItems || []).map(s => s.id));
                    const filtered = (wrapper._referenceOptions || []).filter(([id, text]) =>
                        !selectedIds.has(id) && text.toLowerCase().includes(searchText.toLowerCase())
                    );
                    if (filtered.length === 0) {
                        dropdown.innerHTML = '<div class="inline-editor-reference-empty">Нет доступных значений</div>';
                    } else {
                        dropdown.innerHTML = filtered.map(([id, text]) => {
                            const et = this.escapeHtml(text);
                            return `<div class="inline-editor-reference-option" data-id="${id}" data-text="${et}" tabindex="0">${et}</div>`;
                        }).join('');
                    }
                };

                // Store callbacks on wrapper so saveRecordForFormReference can update multi-select after creation
                wrapper._renderTags = renderTags;
                wrapper._updateHiddenInput = updateHiddenInput;

                // Issue #1688: Add button support for form multi-select reference editors
                const addButton = wrapper.querySelector('.form-ref-add');
                const refTypeId = wrapper.dataset.refTypeId;

                const updateAddButtonVisibility = (searchText) => {
                    if (!addButton) return;
                    const selectedIds = new Set((wrapper._selectedItems || []).map(s => s.id));
                    const availableCount = (wrapper._referenceOptions || []).filter(([id]) => !selectedIds.has(id)).length;
                    // Show add button when user has typed something OR when no options are available (issue #1686)
                    addButton.style.display = (searchText.length > 0 || availableCount === 0) ? '' : 'none';
                };

                // Attach add button click handler
                if (addButton && refTypeId) {
                    addButton.addEventListener('click', async (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const inputValue = searchInput.value.trim();
                        await this.openCreateFormForFormReference(refTypeId, inputValue, recordId, hiddenInput, searchInput, wrapper, dropdown);
                    });
                }

                // Initial render
                renderTags();
                updateHiddenInput();
                // Set initial add button visibility (issue #1686: show immediately when no options available)
                updateAddButtonVisibility('');

                // Show dropdown on focus (issue #917: use 'block' not '' to override CSS display:none on .form-ref-editor-box)
                searchInput.addEventListener('focus', () => {
                    renderDropdown(searchInput.value.trim());
                    dropdown.style.display = 'block';
                });

                // Filter on input
                let searchTimeout;
                searchInput.addEventListener('input', (e) => {
                    const searchText = e.target.value.trim();
                    updateAddButtonVisibility(searchText);
                    clearTimeout(searchTimeout);
                    searchTimeout = setTimeout(() => {
                        renderDropdown(searchText);
                        dropdown.style.display = 'block';
                    }, 200);
                });

                // Handle option selection
                dropdown.addEventListener('click', (e) => {
                    const option = e.target.closest('.inline-editor-reference-option');
                    if (!option) return;
                    const id = option.dataset.id;
                    const text = option.dataset.text;
                    if (!(wrapper._selectedItems || []).find(s => s.id === id)) {
                        wrapper._selectedItems = [...(wrapper._selectedItems || []), { id, text }];
                        renderTags();
                        updateHiddenInput();
                    }
                    searchInput.value = '';
                    dropdown.style.display = 'none';
                    // Update add button visibility after selection (available options may have changed)
                    updateAddButtonVisibility('');
                });

                // Handle tag click: remove button removes tag, clicking tag itself opens edit form (issue #871)
                // Clicking empty area in tags container focuses the search input (issue #881)
                tagsContainer.addEventListener('click', (e) => {
                    const removeBtn = e.target.closest('.multi-ref-tag-remove');
                    if (removeBtn) {
                        const tag = removeBtn.closest('.multi-ref-tag');
                        if (!tag) return;
                        const id = tag.dataset.id;
                        const text = tag.dataset.text;
                        wrapper._selectedItems = (wrapper._selectedItems || []).filter(s => !(s.id === id && s.text === text));
                        renderTags();
                        updateHiddenInput();
                        // Update add button visibility after removal (available options may have changed)
                        updateAddButtonVisibility(searchInput.value.trim());
                        return;
                    }
                    const tag = e.target.closest('.multi-ref-tag');
                    if (!tag) {
                        // Clicked on empty area — focus the search input so cursor appears (issue #881)
                        searchInput.focus();
                        return;
                    }
                    const id = tag.dataset.id;
                    if (!id) return;
                    if (refTypeId) {
                        this.openEditForm(id, refTypeId, 0);
                    }
                });

                // Keyboard navigation
                searchInput.addEventListener('keydown', (e) => {
                    if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        const firstOption = dropdown.querySelector('.inline-editor-reference-option');
                        if (firstOption) firstOption.focus();
                    } else if (e.key === 'Enter') {
                        e.preventDefault();
                        const firstOption = dropdown.querySelector('.inline-editor-reference-option');
                        if (firstOption) firstOption.click();
                    }
                });

                dropdown.addEventListener('keydown', (e) => {
                    const currentOption = document.activeElement;
                    if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        const nextOption = currentOption.nextElementSibling;
                        if (nextOption && nextOption.classList.contains('inline-editor-reference-option')) nextOption.focus();
                    } else if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        const prevOption = currentOption.previousElementSibling;
                        if (prevOption && prevOption.classList.contains('inline-editor-reference-option')) {
                            prevOption.focus();
                        } else {
                            searchInput.focus();
                        }
                    } else if (e.key === 'Enter') {
                        e.preventDefault();
                        currentOption.click();
                    }
                });

                // Hide dropdown when clicking outside
                document.addEventListener('click', (e) => {
                    if (!wrapper.contains(e.target)) {
                        dropdown.style.display = 'none';
                    }
                });

            } catch (error) {
                console.error('Error initializing multi-reference editor:', error);
                tagsContainer.innerHTML = '<span class="multi-ref-tags-placeholder">Ошибка загрузки</span>';
                dropdown.innerHTML = '<div class="inline-editor-reference-empty">Ошибка загрузки</div>';
            }
        }

        /**
         * Fetch GRANT or REPORT_COLUMN options from cache or API (issue #607)
         * @param {string} grantType - 'grant' or 'rep_col'
         * @returns {Promise<Array>} - Array of options
         */
        async fetchGrantOrReportColumnOptions(grantType) {
            // Check cache first (issue #607)
            if (grantType === 'grant' && this.grantOptionsCache !== null) {
                return this.grantOptionsCache;
            }
            if (grantType === 'rep_col' && this.reportColumnOptionsCache !== null) {
                return this.reportColumnOptionsCache;
            }

            const apiBase = this.getApiBase();
            let apiUrl;

            if (grantType === 'grant') {
                apiUrl = `${ apiBase }/grants`;
            } else if (grantType === 'rep_col') {
                apiUrl = `${ apiBase }/rep_cols`;
            } else {
                return [];
            }

            const response = await fetch(apiUrl);
            if (!response.ok) {
                throw new Error(`HTTP ${ response.status }`);
            }
            const options = await response.json();

            // Store in cache (issue #607)
            if (grantType === 'grant') {
                this.grantOptionsCache = options;
            } else if (grantType === 'rep_col') {
                this.reportColumnOptionsCache = options;
            }

            return options;
        }

        /**
         * Load GRANT and REPORT_COLUMN dropdown options from API (issue #577)
         * Uses cache to avoid re-fetching on each call (issue #607)
         * GRANT fields use GET /grants endpoint
         * REPORT_COLUMN fields use GET /rep_cols endpoint
         */
        async loadGrantAndReportColumnOptions(modalElement) {
            const container = modalElement || document;
            const grantSelects = container.querySelectorAll('.form-grant-select');

            for (const select of grantSelects) {
                const grantType = select.dataset.grantType;
                const fieldId = select.id;
                const currentValueInput = container.querySelector(`#${ fieldId }-current-value`);
                const currentValue = currentValueInput ? currentValueInput.value : '';

                try {
                    // Use cached options or fetch from API (issue #607)
                    const options = await this.fetchGrantOrReportColumnOptions(grantType);

                    // Clear loading option and populate with fetched options
                    select.innerHTML = '<option value="">-- Выберите --</option>';

                    if (Array.isArray(options)) {
                        options.forEach(opt => {
                            // Options may be in format: { id: "...", val: "..." } or { id: "...", value: "..." }
                            // Use nullish check to properly handle "0" as a valid ID (issue #583)
                            const optId = (opt.id !== undefined && opt.id !== null) ? opt.id : ((opt.i !== undefined && opt.i !== null) ? opt.i : '');
                            const optVal = opt.val || opt.value || opt.name || opt.v || '';
                            const option = document.createElement('option');
                            option.value = optId;
                            option.textContent = optVal;
                            if (String(optId) === String(currentValue)) {
                                option.selected = true;
                            }
                            select.appendChild(option);
                        });
                    }

                    // Remove the hidden current value input after loading
                    if (currentValueInput) {
                        currentValueInput.remove();
                    }

                } catch (error) {
                    console.error(`Error loading ${ grantType } options:`, error);
                    select.innerHTML = '<option value="">Ошибка загрузки</option>';
                }
            }
        }

        /**
         * Load GRANT or REPORT_COLUMN dropdown options for inline editor (issue #601)
         * @param {HTMLSelectElement} selectElement - The select element to populate
         * @param {string} currentValue - The current cell value (display text or ID)
         * @param {string} format - 'GRANT' or 'REPORT_COLUMN'
         */
        /**
         * Load GRANT or REPORT_COLUMN dropdown options for inline editor (issue #601)
         * Uses cache to avoid re-fetching on each call (issue #607)
         * @param {HTMLSelectElement} selectElement - The select element to populate
         * @param {string} currentValue - The current cell value (display text or ID)
         * @param {string} format - 'GRANT' or 'REPORT_COLUMN'
         */
        async loadInlineGrantOptions(selectElement, currentValue, format) {
            try {
                // Map format to grantType for the cache method (issue #607)
                const grantType = format === 'GRANT' ? 'grant' : (format === 'REPORT_COLUMN' ? 'rep_col' : null);
                if (!grantType) {
                    return;
                }

                // Use cached options or fetch from API (issue #607)
                const options = await this.fetchGrantOrReportColumnOptions(grantType);

                // Clear loading option and populate with fetched options
                selectElement.innerHTML = '<option value="">-- Выберите --</option>';

                let selectedId = null;

                if (Array.isArray(options)) {
                    options.forEach(opt => {
                        // Options may be in format: { id: "...", val: "..." } or { id: "...", value: "..." }
                        // Use nullish check to properly handle "0" as a valid ID
                        const optId = (opt.id !== undefined && opt.id !== null) ? opt.id : ((opt.i !== undefined && opt.i !== null) ? opt.i : '');
                        const optVal = opt.val || opt.value || opt.name || opt.v || '';
                        const option = document.createElement('option');
                        option.value = optId;
                        option.textContent = optVal;
                        // Pre-select if currentValue matches either ID or display text (issue #601)
                        // Cell may contain display text (from initial load) or ID (from data attribute)
                        if (String(optId) === String(currentValue) || String(optVal) === String(currentValue)) {
                            option.selected = true;
                            selectedId = optId;
                        }
                        selectElement.appendChild(option);
                    });
                }

                // Store the original ID for comparison when saving (in case currentValue was display text)
                if (selectedId !== null) {
                    this.currentEditingCell.originalValue = String(selectedId);
                }

                // Focus the select after loading options
                selectElement.focus();

            } catch (error) {
                console.error(`Error loading inline ${ format } options:`, error);
                selectElement.innerHTML = '<option value="">Ошибка загрузки</option>';
            }
        }

        renderFormReferenceOptions(dropdown, options, hiddenInput, searchInput) {
            // options is an array of [id, text] tuples
            dropdown.innerHTML = '';

            if (options.length === 0) {
                dropdown.innerHTML = '<div class="inline-editor-reference-empty">Нет доступных значений</div>';
                return;
            }

            options.forEach(([id, text]) => {
                const escapedText = this.escapeHtml(text);
                const optionDiv = document.createElement('div');
                optionDiv.className = 'inline-editor-reference-option';
                optionDiv.textContent = text;
                optionDiv.dataset.id = id;
                optionDiv.dataset.text = text;
                optionDiv.tabIndex = 0;

                // Highlight if selected
                if (String(hiddenInput.value) === String(id)) {
                    optionDiv.style.backgroundColor = 'var(--md-selected)';
                    optionDiv.style.color = 'var(--md-primary)';
                    optionDiv.style.fontWeight = '500';
                }

                dropdown.appendChild(optionDiv);
            });
        }

        async openCreateFormForFormReference(typeId, initialValue, parentRecordId, hiddenInput, searchInput, wrapper, dropdown) {
            // Open a create form for new record from form reference field
            // After creation, set the newly created record ID and value in the reference field
            try {
                if (!this.metadataCache[typeId]) {
                    this.metadataCache[typeId] = await this.fetchMetadata(typeId);
                }

                const metadata = this.metadataCache[typeId];
                this.renderCreateFormForFormReference(metadata, typeId, initialValue, parentRecordId, hiddenInput, searchInput, wrapper, dropdown);

            } catch (error) {
                console.error('Error opening create form for form reference:', error);
                this.showToast(`Ошибка открытия формы: ${error.message}`, 'error');
            }
        }

        renderCreateFormForFormReference(metadata, typeId, initialValue, parentRecordId, hiddenInput, searchInput, wrapper, dropdown) {
            // Track modal depth for z-index stacking
            if (!window._integramModalDepth) {
                window._integramModalDepth = 0;
            }
            window._integramModalDepth++;
            const modalDepth = window._integramModalDepth;
            const baseZIndex = 1000 + (modalDepth * 10);

            const overlay = document.createElement('div');
            overlay.className = 'edit-form-overlay';
            overlay.style.zIndex = baseZIndex;
            overlay.dataset.modalDepth = modalDepth;

            const modal = document.createElement('div');
            modal.className = 'edit-form-modal';
            modal.style.zIndex = baseZIndex + 1;
            modal.dataset.modalDepth = modalDepth;
            modal.dataset.overlayRef = 'true';

            // Add cascade offset for nested modals (6px per level)
            const cascadeOffset = (modalDepth - 1) * 6;
            modal.style.transform = `translate(calc(-50% + ${cascadeOffset}px), calc(-50% + ${cascadeOffset}px))`;

            modal._overlayElement = overlay;

            const typeName = this.getMetadataName(metadata);
            const title = `Создание: ${typeName}`;

            const reqs = metadata.reqs || [];
            const regularFields = reqs.filter(req => !req.arr_id);

            // Get current date/datetime for default values
            const now = new Date();
            const currentDateHtml5 = now.toISOString().split('T')[0]; // YYYY-MM-DD
            const minutes = Math.round(now.getMinutes() / 5) * 5; // Round to 5 minutes
            now.setMinutes(minutes);
            const currentDateTimeHtml5 = now.toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
            const currentDateDisplay = now.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '.'); // DD.MM.YYYY
            const currentDateTimeDisplay = currentDateDisplay + ' ' + now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); // DD.MM.YYYY HH:MM

            // Determine main field type
            const mainFieldType = this.normalizeFormat(metadata.type);

            // Build main field HTML based on its type
            let mainFieldHtml = '';
            if (mainFieldType === 'BOOLEAN') {
                const isChecked = initialValue ? 'checked' : '';
                mainFieldHtml = `<input type="checkbox" id="field-main-form-ref-create" name="main" value="1" ${ isChecked }>`;
            } else if (mainFieldType === 'DATE') {
                const dateValueHtml5 = initialValue ? this.formatDateForHtml5(initialValue, false) : currentDateHtml5;
                const dateValueDisplay = initialValue ? this.formatDateForInput(initialValue, false) : currentDateDisplay;
                mainFieldHtml = `<input type="date" class="form-control date-picker" id="field-main-form-ref-create-picker" required data-target="field-main-form-ref-create" value="${ this.escapeHtml(dateValueHtml5) }">`;
                mainFieldHtml += `<input type="hidden" id="field-main-form-ref-create" name="main" value="${ this.escapeHtml(dateValueDisplay) }">`;
            } else if (mainFieldType === 'DATETIME') {
                const dateTimeValueHtml5 = initialValue ? this.formatDateForHtml5(initialValue, true) : currentDateTimeHtml5;
                const dateTimeValueDisplay = initialValue ? this.formatDateForInput(initialValue, true) : currentDateTimeDisplay;
                mainFieldHtml = `<input type="datetime-local" class="form-control datetime-picker" id="field-main-form-ref-create-picker" required data-target="field-main-form-ref-create" value="${ this.escapeHtml(dateTimeValueHtml5) }">`;
                mainFieldHtml += `<input type="hidden" id="field-main-form-ref-create" name="main" value="${ this.escapeHtml(dateTimeValueDisplay) }">`;
            } else if (mainFieldType === 'NUMBER') {
                mainFieldHtml = `<input type="number" class="form-control" id="field-main-form-ref-create" name="main" value="${ this.escapeHtml(initialValue) }" required>`;
            } else if (mainFieldType === 'SIGNED') {
                mainFieldHtml = `<input type="number" class="form-control" id="field-main-form-ref-create" name="main" value="${ this.escapeHtml(initialValue) }" required step="0.01">`;
            } else if (mainFieldType === 'MEMO') {
                mainFieldHtml = `<textarea class="form-control memo-field" id="field-main-form-ref-create" name="main" rows="4" required>${ this.escapeHtml(initialValue) }</textarea>`;
            } else {
                // Default: text input (SHORT, CHARS, etc.)
                mainFieldHtml = `<input type="text" class="form-control" id="field-main-form-ref-create" name="main" value="${this.escapeHtml(initialValue)}" required>`;
            }

            let attributesHtml = `
                <div class="form-group">
                    <label for="field-main-form-ref-create">${typeName} <span class="required">*</span></label>
                    ${ mainFieldHtml }
                </div>
            `;

            regularFields.forEach(req => {
                const attrs = this.parseAttrs(req.attrs);
                const fieldName = attrs.alias || req.val;
                const isRequired = attrs.required;

                attributesHtml += `<div class="form-group">`;
                attributesHtml += `<label for="field-form-ref-${req.id}">${fieldName}${isRequired ? ' <span class="required">*</span>' : ''}</label>`;

                // Check if this is a reference field
                if (req.ref_id) {
                    // Render as reference dropdown (same as in edit form)
                    attributesHtml += `
                        <div class="form-reference-editor" data-ref-id="${req.id}" data-required="${isRequired}" data-ref-type-id="${req.orig || req.ref_id}">
                            <div class="inline-editor-reference form-ref-editor-box">
                                <div class="inline-editor-reference-header">
                                    <input type="text"
                                           class="inline-editor-reference-search form-ref-search"
                                           id="field-form-ref-${req.id}-search"
                                           placeholder="Поиск..."
                                           autocomplete="off">
                                    <button class="inline-editor-reference-clear form-ref-clear" title="Очистить значение" aria-label="Очистить значение" type="button"><i class="pi pi-times"></i></button>
                                    <button class="inline-editor-reference-add form-ref-add" style="display: none;" title="Создать запись" aria-label="Создать запись" type="button"><i class="pi pi-plus"></i></button>
                                </div>
                                <div class="inline-editor-reference-dropdown form-ref-dropdown" id="field-form-ref-${req.id}-dropdown">
                                    <div class="inline-editor-reference-empty">Загрузка...</div>
                                </div>
                            </div>
                            <input type="hidden"
                                   class="form-ref-value"
                                   id="field-form-ref-${req.id}"
                                   name="t${req.id}"
                                   value=""
                                   data-ref-id="${req.id}">
                        </div>
                    `;
                } else {
                    // Render as simple text input
                    attributesHtml += `<input type="text" class="form-control" id="field-form-ref-${req.id}" name="t${req.id}"${isRequired ? ' required' : ''}>`;
                }

                attributesHtml += `</div>`;
            });

            let formHtml = `
                <div class="edit-form-header">
                    <h3>${title}</h3>
                    <button class="edit-form-close" data-close-form-ref-modal="true"><i class="pi pi-times"></i></button>
                </div>
                <div class="edit-form-body">
                    <form id="edit-form-form-ref-create" class="edit-form" onsubmit="return false;" autocomplete="off">
                        ${attributesHtml}
                    </form>
                </div>
                <div class="edit-form-footer">
                    <div class="edit-form-footer-buttons">
                        <button type="button" class="btn btn-primary" id="save-form-ref-btn">Сохранить</button>
                        <button type="button" class="btn btn-secondary" data-close-form-ref-modal="true">Отменить</button>
                    </div>
                </div>
            `;

            modal.innerHTML = formHtml;
            document.body.appendChild(overlay);
            document.body.appendChild(modal);

            // Load reference options for dropdown fields
            this.loadReferenceOptions(regularFields, parentRecordId, modal);

            // Load GRANT and REPORT_COLUMN dropdown options (issue #577)
            this.loadGrantAndReportColumnOptions(modal);

            // Attach date/datetime picker handlers
            this.attachDatePickerHandlers(modal);

            // Attach save handler
            const saveBtn = modal.querySelector('#save-form-ref-btn');
            saveBtn.addEventListener('click', async () => {
                saveBtn.disabled = true;
                try {
                    await this.saveRecordForFormReference(modal, overlay, typeId, parentRecordId, hiddenInput, searchInput, wrapper, dropdown);
                } finally {
                    saveBtn.disabled = false;
                }
            });

            // Close modal helper
            const closeModal = () => {
                modal.remove();
                overlay.remove();
                window._integramModalDepth = Math.max(0, (window._integramModalDepth || 1) - 1);
            };

            modal.querySelectorAll('[data-close-form-ref-modal="true"]').forEach(btn => {
                btn.addEventListener('click', closeModal);
            });

            overlay.addEventListener('click', closeModal);

            // Close on Escape key (issue #595)
            const handleEscape = (e) => {
                if (e.key === 'Escape') {
                    // Only close if this modal is the topmost one
                    const currentDepth = parseInt(modal.dataset.modalDepth) || 0;
                    const maxDepth = window._integramModalDepth || 0;
                    if (currentDepth === maxDepth) {
                        closeModal();
                        document.removeEventListener('keydown', handleEscape);
                    }
                }
            };
            document.addEventListener('keydown', handleEscape);

            // Enter in input/textarea triggers Save (issue #1422)
            modal.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
                    if (!saveBtn.disabled) {
                        e.preventDefault();
                        saveBtn.click();
                    }
                }
            });
        }

        async saveRecordForFormReference(modal, overlay, typeId, parentRecordId, hiddenInput, searchInput, wrapper, dropdown) {
            const form = modal.querySelector('#edit-form-form-ref-create');

            if (!form.checkValidity()) {
                form.reportValidity();
                return;
            }

            const formData = new FormData(form);
            const params = new URLSearchParams();

            if (typeof xsrf !== 'undefined') {
                params.append('_xsrf', xsrf);
            }

            const mainValue = formData.get('main');

            for (const [key, value] of formData.entries()) {
                if (key === 'main') continue;
                if (value !== '' && value !== null && value !== undefined) {
                    params.append(key, value);
                }
            }

            if (mainValue !== '' && mainValue !== null && mainValue !== undefined) {
                params.append(`t${ typeId }`, mainValue);
            }

            const apiBase = this.getApiBase();
            // Issue #1690: Reference directory values always belong to the root (up=1),
            // not to the current form's parent record
            const url = `${apiBase}/_m_new/${typeId}?JSON&up=1`;

            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    body: params.toString()
                });

                const text = await response.text();

                let result;
                try {
                    result = JSON.parse(text);
                } catch (e) {
                    if (text.includes('error') || !response.ok) {
                        throw new Error(text);
                    }
                    result = { success: true };
                }

                const serverError = this.getServerError(result);
                if (serverError) {
                    throw new Error(serverError);
                }
                if (result.warning) this.showToast(result.warning, 'warning');

                const createdId = result.obj || result.id || result.i;
                const createdValue = result.val || mainValue;


                // Close the create form modal
                modal.remove();
                overlay.remove();
                window._integramModalDepth = Math.max(0, (window._integramModalDepth || 1) - 1);

                this.showToast('Запись успешно создана', 'success');
                this.clearAllReferenceOptionCaches();

                // Set the created record in the form reference field
                if (createdId) {
                    // Issue #1688: Handle multi-select reference fields differently from single-select
                    if (wrapper.dataset.multi === '1') {
                        // Add the new record to the multi-select selection
                        if (!(wrapper._selectedItems || []).find(s => s.id === String(createdId))) {
                            wrapper._selectedItems = [...(wrapper._selectedItems || []), { id: String(createdId), text: createdValue }];
                        }
                        if (wrapper._renderTags) wrapper._renderTags();
                        if (wrapper._updateHiddenInput) wrapper._updateHiddenInput();
                        searchInput.value = '';
                        dropdown.style.display = 'none';
                    } else {
                        hiddenInput.value = createdId;
                        searchInput.value = createdValue;
                        dropdown.style.display = 'none';
                    }

                    // Re-fetch options to include the new record
                    try {
                        const refReqId = wrapper.dataset.refId;
                        const newOptions = await this.fetchReferenceOptions(refReqId, parentRecordId);
                        wrapper._referenceOptions = newOptions;
                    } catch (err) {
                        console.error('Error re-fetching reference options:', err);
                    }
                }

            } catch (error) {
                console.error('Error saving record for form reference:', error);
                this.showToast(`Ошибка сохранения: ${error.message}`, 'error');
            }
        }

        // Form field visibility settings
