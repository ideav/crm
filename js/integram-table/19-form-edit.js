        renderEditFormModal(metadata, recordData, isCreate, typeId, columnId = null) {
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

            // Store reference to overlay on modal for proper cleanup
            modal._overlayElement = overlay;

            const typeName = this.getMetadataName(metadata);
            const firstColumnValue = !isCreate && recordData && recordData.obj ? recordData.obj.val : null;
            const title = isCreate ? `Создание: ${ typeName }` : `Редактирование: ${ firstColumnValue || typeName }`;
            const instanceName = this.options.instanceName;

            // Save and update navbar-workspace + document.title with object value
            const navbarWorkspace = document.querySelector('.navbar-workspace');
            const prevWorkspaceText = navbarWorkspace ? navbarWorkspace.textContent : null;
            const prevDocTitle = document.title;
            const objectValue = firstColumnValue || typeName;
            const truncatedValue = objectValue && objectValue.length > 32 ? objectValue.slice(0, 32) + '...' : objectValue;
            if (navbarWorkspace) navbarWorkspace.textContent = truncatedValue;
            document.title = truncatedValue;
            const recordId = recordData && recordData.obj ? recordData.obj.id : null;
            // Issue #616: For create mode, use F_U from URL as parent when F_U > 1
            const defaultParentId = (this.options.parentId && parseInt(this.options.parentId) > 1) ? this.options.parentId : 1;
            const parentId = recordData && recordData.obj && recordData.obj.parent ? recordData.obj.parent : defaultParentId;

            // Build record ID and table link HTML for edit mode (issue #563)
            let recordIdHtml = '';
            if (!isCreate && recordId) {
                // Extract database name from URL path
                const pathParts = window.location.pathname.split('/');
                const dbName = pathParts.length >= 2 ? pathParts[1] : '';
                // Build table URL with filters: /{dbName}/table/{typeId}?F_U={parentId}&F_I={recordId}
                const tableUrl = `/${dbName}/table/${typeId}?F_U=${parentId || 1}&F_I=${recordId}`;

                recordIdHtml = `
                    <span class="edit-form-record-id" onclick="window.${instanceName}.copyRecordIdToClipboard('${recordId}')" title="Скопировать ID">#${recordId}</span>
                    <a href="${tableUrl}" class="edit-form-table-link" title="Открыть в таблице" target="_blank">
                        <i class="pi pi-table"></i>
                    </a>
                `;
            }

            // Separate regular fields from subordinate tables
            const reqs = metadata.reqs || [];
            const recordReqs = recordData && recordData.reqs ? recordData.reqs : {};

            // Sort by order if available
            const sortedReqs = reqs.sort((a, b) => {
                const orderA = recordReqs[a.id] ? recordReqs[a.id].order || 0 : 0;
                const orderB = recordReqs[b.id] ? recordReqs[b.id].order || 0 : 0;
                return orderA - orderB;
            });

            const regularFields = sortedReqs.filter(req => !req.arr_id);
            const subordinateTables = sortedReqs.filter(req => req.arr_id);

            // Build tabs HTML
            let tabsHtml = '';
            let hasSubordinateTables = subordinateTables.length > 0 && !isCreate && recordId;

            if (hasSubordinateTables) {
                tabsHtml = `<div class="edit-form-tabs">`;
                tabsHtml += `<div class="edit-form-tab active" data-tab="attributes">Атрибуты</div>`;

                subordinateTables.forEach(req => {
                    const attrs = this.parseAttrs(req.attrs);
                    const fieldName = attrs.alias || req.val;
                    const arrCount = recordReqs[req.id] ? recordReqs[req.id].arr || 0 : 0;
                    tabsHtml += `<div class="edit-form-tab" data-tab="sub-${ req.id }" data-arr-id="${ req.arr_id }" data-req-id="${ req.id }">${ fieldName } (${ arrCount })</div>`;
                });

                tabsHtml += `</div>`;
            }

            // Build attributes form HTML
            let attributesHtml = this.renderAttributesForm(metadata, recordData, regularFields, recordReqs, isCreate, typeId);

            let formHtml = `
                <div class="edit-form-header">
                    <div class="edit-form-header-title-row">
                        <h3>${ title }</h3>
                        ${ recordIdHtml }
                    </div>
                    <button class="edit-form-close" data-close-modal="true"><i class="pi pi-times"></i></button>
                </div>
                ${ tabsHtml }
                <div class="edit-form-body">
                    <div class="edit-form-tab-content active" data-tab-content="attributes">
                        <form id="edit-form" class="edit-form" onsubmit="return false;" autocomplete="off">
                            ${ attributesHtml }
                        </form>
                    </div>
            `;

            // Add placeholder for subordinate table contents
            if (hasSubordinateTables) {
                subordinateTables.forEach(req => {
                    formHtml += `
                        <div class="edit-form-tab-content" data-tab-content="sub-${ req.id }">
                            <div class="subordinate-table-loading">Загрузка...</div>
                        </div>
                    `;
                });
            }

            formHtml += `
                </div>
                <div class="edit-form-footer">
                    <button type="button" class="btn btn-icon form-settings-btn" id="form-settings-btn" title="Настройка видимости полей">
                        <i class="pi pi-cog"></i>
                    </button>
                    <div class="edit-form-footer-buttons">
                        ${ !isCreate ? '<button type="button" class="btn btn-danger" id="delete-record-btn" style="display:none;">Удалить</button>' : '' }
                        <button type="button" class="btn btn-primary" id="save-record-btn">Сохранить</button>
                        <button type="button" class="btn btn-secondary" data-close-modal="true">Отменить</button>
                    </div>
                </div>
            `;

            modal.innerHTML = formHtml;
            document.body.appendChild(overlay);
            document.body.appendChild(modal);

            // Store recordId on the modal element for subordinate table loading in nested modals
            modal.dataset.recordId = recordId;

            // Store modal context for subordinate tables - ONLY for the first level (parent form)
            // Don't overwrite when opening subordinate record forms (nested modals)
            if (modalDepth === 1) {
                this.currentEditModal = {
                    modal,
                    recordId,
                    typeId,
                    metadata,
                    recordData,
                    subordinateTables,
                    recordReqs
                };
            }

            // Attach tab switching handlers
            if (hasSubordinateTables) {
                this.attachTabHandlers(modal);
            }

            // Load reference options for dropdowns (scoped to this modal)
            this.loadReferenceOptions(metadata.reqs, recordId || 0, modal);

            // Load GRANT and REPORT_COLUMN dropdown options (issue #577)
            this.loadGrantAndReportColumnOptions(modal);

            // Attach date/datetime picker handlers
            this.attachDatePickerHandlers(modal);

            // Attach file upload handlers
            this.attachFormFileUploadHandlers(modal);

            // Attach form field settings handler
            const formSettingsBtn = modal.querySelector('#form-settings-btn');
            formSettingsBtn.addEventListener('click', () => {
                this.openFormFieldSettings(typeId, metadata);
            });

            // Apply saved field visibility settings
            this.applyFormFieldSettings(modal, typeId);

            // Attach save handler
            const saveBtn = modal.querySelector('#save-record-btn');

            saveBtn.addEventListener('click', async () => {
                saveBtn.disabled = true;
                try {
                    await this.saveRecord(modal, isCreate, recordId, typeId, parentId, columnId);
                } finally {
                    saveBtn.disabled = false;
                }
            });

            // Attach delete handler (edit mode only)
            if (!isCreate) {
                const deleteBtn = modal.querySelector('#delete-record-btn');
                if (deleteBtn) {
                    // Show/hide based on saved setting
                    const showDelete = this.loadFormShowDelete(typeId);
                    if (showDelete) {
                        deleteBtn.style.display = '';
                    }
                    deleteBtn.addEventListener('click', () => {
                        this.deleteRecord(modal, recordId, typeId);
                    });
                }
            }

            // Close modal helper function
            const closeModal = () => {
                modal.remove();
                overlay.remove();
                window._integramModalDepth = Math.max(0, (window._integramModalDepth || 1) - 1);
                if (modalDepth === 1) {
                    this.currentEditModal = null;
                }
                // Restore navbar-workspace and document.title
                if (navbarWorkspace && prevWorkspaceText !== null) navbarWorkspace.textContent = prevWorkspaceText;
                document.title = prevDocTitle;
            };

            // Attach close handlers to buttons with data-close-modal attribute
            modal.querySelectorAll('[data-close-modal="true"]').forEach(btn => {
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

            // Focus the first visible, non-hidden input/textarea/select in the form (issue #1420)
            const firstField = modal.querySelector('input:not([type="hidden"]):not([type="checkbox"]):not([readonly]), textarea, select');
            if (firstField) {
                firstField.focus();
            }
        }

        renderAttributesForm(metadata, recordData, regularFields, recordReqs, isCreate = false, typeId = null) {
            let html = '';

            // Get current date/datetime for default values in create mode
            // Only applied to the first column (where req.id equals typeId)
            let currentDateHtml5 = '';
            let currentDateTimeHtml5 = '';
            let currentDateDisplay = '';
            let currentDateTimeDisplay = '';

            if (isCreate) {
                const now = new Date();
                currentDateHtml5 = now.toISOString().split('T')[0]; // YYYY-MM-DD
                const minutes = Math.round(now.getMinutes() / 5) * 5; // Round to 5 minutes
                now.setMinutes(minutes);
                currentDateTimeHtml5 = now.toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
                currentDateDisplay = now.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '.'); // DD.MM.YYYY
                currentDateTimeDisplay = currentDateDisplay + ' ' + now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); // DD.MM.YYYY HH:MM
            }

            // Main value field - render according to base type
            const typeName = this.getMetadataName(metadata);
            const mainValue = recordData && recordData.obj ? recordData.obj.val : '';
            // For GRANT/REPORT_COLUMN fields, use term from API response for dropdown pre-selection (issue #583)
            const mainTermValue = recordData && recordData.obj && recordData.obj.term !== undefined ? recordData.obj.term : '';
            const mainFieldType = this.normalizeFormat(metadata.type);

            // Build main field HTML based on its type
            let mainFieldHtml = '';
            if (mainFieldType === 'BOOLEAN') {
                const isChecked = mainValue ? 'checked' : '';
                mainFieldHtml = `<input type="checkbox" id="field-main" name="main" value="1" ${ isChecked }>`;
            } else if (mainFieldType === 'DATE') {
                const dateValueHtml5 = mainValue ? this.formatDateForHtml5(mainValue, false) : (isCreate ? currentDateHtml5 : '');
                const dateValueDisplay = mainValue ? this.formatDateForInput(mainValue, false) : (isCreate ? currentDateDisplay : '');
                mainFieldHtml = `<input type="date" class="form-control date-picker" id="field-main-picker" required data-target="field-main" value="${ this.escapeHtml(dateValueHtml5) }">`;
                mainFieldHtml += `<input type="hidden" id="field-main" name="main" value="${ this.escapeHtml(dateValueDisplay) }">`;
            } else if (mainFieldType === 'DATETIME') {
                const dateTimeValueHtml5 = mainValue ? this.formatDateForHtml5(mainValue, true) : (isCreate ? currentDateTimeHtml5 : '');
                const dateTimeValueDisplay = mainValue ? this.formatDateForInput(mainValue, true) : (isCreate ? currentDateTimeDisplay : '');
                mainFieldHtml = `<input type="datetime-local" class="form-control datetime-picker" id="field-main-picker" required data-target="field-main" value="${ this.escapeHtml(dateTimeValueHtml5) }">`;
                mainFieldHtml += `<input type="hidden" id="field-main" name="main" value="${ this.escapeHtml(dateTimeValueDisplay) }">`;
            } else if (mainFieldType === 'NUMBER') {
                mainFieldHtml = `<input type="number" class="form-control" id="field-main" name="main" value="${ this.escapeHtml(mainValue) }" required>`;
            } else if (mainFieldType === 'SIGNED') {
                mainFieldHtml = `<input type="number" class="form-control" id="field-main" name="main" value="${ this.escapeHtml(mainValue) }" required step="0.01">`;
            } else if (mainFieldType === 'MEMO') {
                mainFieldHtml = `<textarea class="form-control memo-field" id="field-main" name="main" rows="4" required>${ this.escapeHtml(mainValue) }</textarea>`;
            } else if (mainFieldType === 'GRANT') {
                // GRANT field (dropdown with options from GET grants API - issue #581)
                mainFieldHtml = `
                    <select class="form-control form-grant-select" id="field-main" name="main" required data-grant-type="grant">
                        <option value="">Загрузка...</option>
                    </select>
                `;
                // Store current value (term) for later selection after options load (issue #583)
                mainFieldHtml += `<input type="hidden" id="field-main-current-value" value="${ this.escapeHtml(mainTermValue) }">`;
            } else if (mainFieldType === 'REPORT_COLUMN') {
                // REPORT_COLUMN field (dropdown with options from GET rep_cols API - issue #581)
                mainFieldHtml = `
                    <select class="form-control form-grant-select" id="field-main" name="main" required data-grant-type="rep_col">
                        <option value="">Загрузка...</option>
                    </select>
                `;
                // Store current value (term) for later selection after options load (issue #583)
                mainFieldHtml += `<input type="hidden" id="field-main-current-value" value="${ this.escapeHtml(mainTermValue) }">`;
            } else {
                // Default: text input (SHORT, CHARS, etc.)
                mainFieldHtml = `<input type="text" class="form-control" id="field-main" name="main" value="${ this.escapeHtml(mainValue) }" required>`;
            }

            html += `
                <div class="form-group">
                    <label for="field-main">${ typeName } <span class="required">*</span></label>
                    ${ mainFieldHtml }
                </div>
            `;

            // Sort fields by saved order if available
            const savedFieldOrder = this.loadFormFieldOrder(typeId);
            const sortedFields = [...regularFields];
            if (savedFieldOrder.length > 0) {
                sortedFields.sort((a, b) => {
                    const idxA = savedFieldOrder.indexOf(String(a.id));
                    const idxB = savedFieldOrder.indexOf(String(b.id));
                    if (idxA === -1 && idxB === -1) return 0;
                    if (idxA === -1) return 1;
                    if (idxB === -1) return -1;
                    return idxA - idxB;
                });
            }

            sortedFields.forEach(req => {
                const attrs = this.parseAttrs(req.attrs);
                const fieldName = attrs.alias || req.val;
                const reqValue = recordReqs[req.id] ? recordReqs[req.id].value : '';
                const baseTypeId = recordReqs[req.id] ? recordReqs[req.id].base : req.type;
                const baseFormat = this.normalizeFormat(baseTypeId);
                const isRequired = attrs.required;
                const isMulti = attrs.multi; // Issue #853

                html += `<div class="form-group">`;
                html += `<label for="field-${ req.id }">${ fieldName }${ isRequired ? ' <span class="required">*</span>' : '' }</label>`;

                // Multi-select reference field (issue #853)
                if (req.ref_id && isMulti) {
                    const currentValue = reqValue || '';
                    html += `
                        <div class="form-reference-editor form-multi-reference-editor" data-ref-id="${ req.id }" data-required="${ isRequired }" data-ref-type-id="${ req.orig || req.ref_id }" data-multi="1" data-current-value="${ this.escapeHtml(currentValue) }">
                            <div class="inline-editor-reference form-ref-editor-box inline-editor-multi-reference">
                                <div class="multi-ref-tags-container form-multi-ref-tags-container">
                                    <span class="multi-ref-tags-placeholder">Загрузка...</span>
                                </div>
                                <div class="inline-editor-reference-header">
                                    <input type="text"
                                           class="inline-editor-reference-search form-ref-search"
                                           id="field-${ req.id }-search"
                                           placeholder="Добавить..."
                                           autocomplete="off" readonly onfocus="this.removeAttribute('readonly')" onmousedown="this.removeAttribute('readonly')">
                                </div>
                                <div class="inline-editor-reference-dropdown form-ref-dropdown" id="field-${ req.id }-dropdown" style="display:none;">
                                    <div class="inline-editor-reference-empty">Загрузка...</div>
                                </div>
                            </div>
                            <input type="hidden"
                                   class="form-ref-value form-multi-ref-value"
                                   id="field-${ req.id }"
                                   name="t${ req.id }"
                                   value=""
                                   data-ref-id="${ req.id }">
                        </div>
                    `;
                }
                // Single-select reference field (searchable dropdown with clear/add buttons)
                else if (req.ref_id) {
                    const currentValue = reqValue || '';
                    html += `
                        <div class="form-reference-editor" data-ref-id="${ req.id }" data-required="${ isRequired }" data-ref-type-id="${ req.orig || req.ref_id }">
                            <div class="inline-editor-reference form-ref-editor-box">
                                <div class="inline-editor-reference-header">
                                    <input type="text"
                                           class="inline-editor-reference-search form-ref-search"
                                           id="field-${ req.id }-search"
                                           placeholder="Поиск..."
                                           autocomplete="off" readonly onfocus="this.removeAttribute('readonly')" onmousedown="this.removeAttribute('readonly')">
                                    <button class="inline-editor-reference-clear form-ref-clear" title="Очистить значение" aria-label="Очистить значение" type="button"><i class="pi pi-times"></i></button>
                                    <button class="inline-editor-reference-add form-ref-add" style="display: none;" title="Создать запись" aria-label="Создать запись" type="button"><i class="pi pi-plus"></i></button>
                                </div>
                                <div class="inline-editor-reference-dropdown form-ref-dropdown" id="field-${ req.id }-dropdown">
                                    <div class="inline-editor-reference-empty">Загрузка...</div>
                                </div>
                            </div>
                            <input type="hidden"
                                   class="form-ref-value"
                                   id="field-${ req.id }"
                                   name="t${ req.id }"
                                   value="${ this.escapeHtml(currentValue) }"
                                   data-ref-id="${ req.id }">
                        </div>
                    `;
                }
                // Boolean field
                else if (baseFormat === 'BOOLEAN') {
                    const isChecked = reqValue ? 'checked' : '';
                    const prevValue = reqValue || '';
                    html += `<input type="checkbox" id="field-${ req.id }" name="t${ req.id }" value="1" ${ isChecked }>`;
                    html += `<input type="hidden" name="b${ req.id }" value="${ this.escapeHtml(prevValue) }">`;
                }
                // Date field with HTML5 date picker
                else if (baseFormat === 'DATE') {
                    // Only apply default value for the first column (where req.id equals typeId)
                    const isFirstColumn = typeId && String(req.id) === String(typeId);
                    const dateValueHtml5 = reqValue ? this.formatDateForHtml5(reqValue, false) : (isCreate && isFirstColumn ? currentDateHtml5 : '');
                    const dateValueDisplay = reqValue ? this.formatDateForInput(reqValue, false) : (isCreate && isFirstColumn ? currentDateDisplay : '');
                    html += `<input type="date" class="form-control date-picker" id="field-${ req.id }-picker" value="${ this.escapeHtml(dateValueHtml5) }" ${ isRequired ? 'required' : '' } data-target="field-${ req.id }">`;
                    html += `<input type="hidden" id="field-${ req.id }" name="t${ req.id }" value="${ this.escapeHtml(dateValueDisplay) }">`;
                }
                // DateTime field with HTML5 datetime-local picker (with time rounded to 5 minutes)
                else if (baseFormat === 'DATETIME') {
                    // Only apply default value for the first column (where req.id equals typeId)
                    const isFirstColumn = typeId && String(req.id) === String(typeId);
                    const dateTimeValueHtml5 = reqValue ? this.formatDateForHtml5(reqValue, true) : (isCreate && isFirstColumn ? currentDateTimeHtml5 : '');
                    const dateTimeValueDisplay = reqValue ? this.formatDateForInput(reqValue, true) : (isCreate && isFirstColumn ? currentDateTimeDisplay : '');
                    html += `<input type="datetime-local" class="form-control datetime-picker" id="field-${ req.id }-picker" value="${ this.escapeHtml(dateTimeValueHtml5) }" ${ isRequired ? 'required' : '' } data-target="field-${ req.id }">`;
                    html += `<input type="hidden" id="field-${ req.id }" name="t${ req.id }" value="${ this.escapeHtml(dateTimeValueDisplay) }">`;
                }
                // MEMO field (multi-line text, 4 rows)
                else if (baseFormat === 'MEMO') {
                    html += `<textarea class="form-control memo-field" id="field-${ req.id }" name="t${ req.id }" rows="4" ${ isRequired ? 'required' : '' }>${ this.escapeHtml(reqValue) }</textarea>`;
                }
                // FILE field (file upload with drag-and-drop)
                else if (baseFormat === 'FILE') {
                    // Parse file link from HTML if present
                    let fileHref = '';
                    let fileName = '';
                    let hasFile = false;

                    if (reqValue && reqValue !== '') {
                        // Check if value contains HTML link: <a target="_blank" href="/path/to/file">filename.ext</a>
                        const linkMatch = reqValue.match(/<a[^>]*href=["']([^"']+)["'][^>]*>([^<]+)<\/a>/i);
                        if (linkMatch) {
                            fileHref = linkMatch[1];
                            fileName = linkMatch[2];
                            hasFile = true;
                        } else {
                            // Fallback: treat as plain file path
                            fileHref = reqValue;
                            fileName = reqValue.split('/').pop() || reqValue;
                            hasFile = true;
                        }
                    }

                    html += `
                        <div class="form-file-upload" data-req-id="${ req.id }" data-original-value="${ this.escapeHtml(reqValue) }">
                            <input type="file" class="file-input" id="field-${ req.id }-file" style="display: none;">
                            <div class="file-dropzone" style="${ hasFile ? 'display: none;' : '' }">
                                <span class="file-dropzone-text">Перетащите файл сюда или нажмите для выбора</span>
                                <button type="button" class="file-select-btn">Выбрать файл</button>
                            </div>
                            <div class="file-preview" style="${ hasFile ? 'display: flex;' : 'display: none;' }">
                                ${ fileHref ? `<a href="${ this.escapeHtml(fileHref) }" target="_blank" class="file-name file-link">${ this.escapeHtml(fileName) }</a>` : `<span class="file-name">${ this.escapeHtml(fileName) }</span>` }
                                <button type="button" class="file-remove-btn" title="Удалить файл"><i class="pi pi-times"></i></button>
                            </div>
                            <input type="hidden" id="field-${ req.id }" name="t${ req.id }" value="${ this.escapeHtml(reqValue) }" ${ isRequired ? 'required' : '' } data-file-deleted="false">
                        </div>
                    `;
                }
                // GRANT field (dropdown with options from GET grants API - issue #577)
                else if (baseFormat === 'GRANT') {
                    html += `
                        <select class="form-control form-grant-select" id="field-${ req.id }" name="t${ req.id }" ${ isRequired ? 'required' : '' } data-grant-type="grant">
                            <option value="">Загрузка...</option>
                        </select>
                    `;
                    // Store current value (ID) for later selection after options load (issue #925)
                    const grantTermValue = recordReqs[req.id] && recordReqs[req.id].term !== undefined ? recordReqs[req.id].term : reqValue;
                    html += `<input type="hidden" id="field-${ req.id }-current-value" value="${ this.escapeHtml(grantTermValue) }">`;
                }
                // REPORT_COLUMN field (dropdown with options from GET rep_cols API - issue #577)
                else if (baseFormat === 'REPORT_COLUMN') {
                    html += `
                        <select class="form-control form-grant-select" id="field-${ req.id }" name="t${ req.id }" ${ isRequired ? 'required' : '' } data-grant-type="rep_col">
                            <option value="">Загрузка...</option>
                        </select>
                    `;
                    // Store current value (ID) for later selection after options load (issue #925)
                    const repColTermValue = recordReqs[req.id] && recordReqs[req.id].term !== undefined ? recordReqs[req.id].term : reqValue;
                    html += `<input type="hidden" id="field-${ req.id }-current-value" value="${ this.escapeHtml(repColTermValue) }">`;
                }
                // Regular text field
                else {
                    html += `<input type="text" class="form-control" id="field-${ req.id }" name="t${ req.id }" value="${ this.escapeHtml(reqValue) }" ${ isRequired ? 'required' : '' }>`;
                }

                html += `</div>`;
            });

            return html;
        }

        attachTabHandlers(modal) {
            const tabs = modal.querySelectorAll('.edit-form-tab');
            const instanceName = this.options.instanceName;

            tabs.forEach(tab => {
                tab.addEventListener('click', async () => {
                    const tabId = tab.dataset.tab;

                    // Update active tab
                    tabs.forEach(t => t.classList.remove('active'));
                    tab.classList.add('active');

                    // Update active content
                    const contents = modal.querySelectorAll('.edit-form-tab-content');
                    contents.forEach(c => c.classList.remove('active'));

                    const targetContent = modal.querySelector(`[data-tab-content="${ tabId }"]`);
                    if (targetContent) {
                        targetContent.classList.add('active');
                    }

                    // Load subordinate table if needed
                    // Use modal.dataset.recordId to support nested modals (issue #741)
                    const parentRecordId = modal.dataset.recordId;
                    if (tabId.startsWith('sub-') && tab.dataset.arrId && parentRecordId) {
                        const arrId = tab.dataset.arrId;
                        const reqId = tab.dataset.reqId;

                        // Check if already loaded
                        if (!targetContent.dataset.loaded) {
                            await this.loadSubordinateTable(targetContent, arrId, parentRecordId, reqId);
                            targetContent.dataset.loaded = 'true';
                        }
                    }

                    // Show/hide footer buttons based on tab
                    const footer = modal.querySelector('.edit-form-footer');
                    if (tabId === 'attributes') {
                        footer.style.display = 'flex';
                        // Collapse modal back to normal size
                        modal.classList.remove('expanded');
                    } else {
                        footer.style.display = 'none';
                        // Expand modal to fit subordinate table
                        modal.classList.add('expanded');
                    }
                });
            });
        }

        async loadSubordinateTable(container, arrId, parentRecordId, reqId) {
            container.innerHTML = '<div class="subordinate-table-loading">Загрузка...</div>';

            try {
                // Fetch metadata for subordinate table (use cache to avoid redundant requests)
                if (!this.metadataCache[arrId]) {
                    this.metadataCache[arrId] = await this.fetchMetadata(arrId);
                }
                const metadata = this.metadataCache[arrId];

                // Fetch data for subordinate table
                const apiBase = this.getApiBase();
                const dataUrl = `${ apiBase }/object/${ arrId }/?JSON_OBJ&F_U=${ parentRecordId }`;
                const dataResponse = await fetch(dataUrl);
                const data = await dataResponse.json();

                // Render the subordinate table
                this.renderSubordinateTable(container, metadata, data, arrId, parentRecordId);

            } catch (error) {
                console.error('Error loading subordinate table:', error);
                container.innerHTML = `<div class="subordinate-table-error">Ошибка загрузки: ${ error.message }</div>`;
            }
        }

        /**
         * Open subordinate table from a cell click in the main table
         * @param {Event} event - Click event
         * @param {number} arrId - Subordinate table type ID
         * @param {number} parentRecordId - Parent record ID
         */
        async openSubordinateTableFromCell(event, arrId, parentRecordId) {
            event.preventDefault();
            event.stopPropagation();

            try {
                // Fetch metadata for subordinate table (use cache to avoid redundant requests)
                if (!this.metadataCache[arrId]) {
                    this.metadataCache[arrId] = await this.fetchMetadata(arrId);
                }
                const metadata = this.metadataCache[arrId];

                // Create modal for subordinate table
                const modalDepth = (window._integramModalDepth || 0) + 1;
                window._integramModalDepth = modalDepth;
                const baseZIndex = 1000 + (modalDepth * 10);

                const overlay = document.createElement('div');
                overlay.className = 'edit-form-overlay subordinate-modal-overlay';
                overlay.style.zIndex = baseZIndex;
                overlay.dataset.modalDepth = modalDepth;

                const modal = document.createElement('div');
                modal.className = 'edit-form-modal subordinate-modal expanded';
                modal.style.zIndex = baseZIndex + 1;
                modal.dataset.modalDepth = modalDepth;

                const typeName = this.getMetadataName(metadata);

                modal.innerHTML = `
                    <div class="edit-form-header">
                        <h3>${ typeName }</h3>
                        <button class="edit-form-close subordinate-modal-close"><i class="pi pi-times"></i></button>
                    </div>
                    <div class="edit-form-body">
                        <div class="subordinate-table-container">
                            <div class="subordinate-table-loading">Загрузка...</div>
                        </div>
                    </div>
                `;

                document.body.appendChild(overlay);
                document.body.appendChild(modal);

                // Save and update navbar-workspace + document.title with subordinate table name (issue #1219)
                const navbarWorkspace = document.querySelector('.navbar-workspace');
                const prevWorkspaceText = navbarWorkspace ? navbarWorkspace.textContent : null;
                const prevDocTitle = document.title;
                const truncatedTypeName = typeName && typeName.length > 32 ? typeName.slice(0, 32) + '...' : typeName;
                if (navbarWorkspace) navbarWorkspace.textContent = truncatedTypeName;
                document.title = truncatedTypeName;

                // Load subordinate table data
                const container = modal.querySelector('.subordinate-table-container');
                await this.loadSubordinateTable(container, arrId, parentRecordId, null);

                // Track context so save handlers can refresh this subordinate table
                this.cellSubordinateContext = {
                    container,
                    arrId,
                    parentRecordId
                };

                // Close handler
                const closeModal = () => {
                    modal.remove();
                    overlay.remove();
                    window._integramModalDepth = Math.max(0, (window._integramModalDepth || 1) - 1);
                    this.cellSubordinateContext = null;
                    // Restore navbar-workspace and document.title (issue #1219)
                    if (navbarWorkspace && prevWorkspaceText !== null) navbarWorkspace.textContent = prevWorkspaceText;
                    document.title = prevDocTitle;
                };

                modal.querySelector('.subordinate-modal-close').addEventListener('click', closeModal);
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

            } catch (error) {
                console.error('Error opening subordinate table:', error);
                this.showToast(`Ошибка: ${ error.message }`, 'error');
            }
        }

        renderSubordinateTable(container, metadata, data, arrId, parentRecordId, sortState = null, searchTerm = '') {
            const instanceName = this.options.instanceName;
            let rows = Array.isArray(data) ? [...data] : [];
            const reqs = metadata.reqs || [];

            // Initialize sort state if not provided (multi-column sorting support)
            // sortState is an array of {colIndex, direction} objects, sorted by priority
            if (!sortState) {
                sortState = [];
            }

            // Store original data and state on container for re-rendering
            container._subordinateData = data;
            container._subordinateMetadata = metadata;
            container._subordinateArrId = arrId;
            container._subordinateParentRecordId = parentRecordId;
            container._subordinateSortState = sortState;
            container._subordinateSearchTerm = searchTerm;

            // Build column info for sorting (includes type information)
            const columns = [
                { name: this.getMetadataName(metadata), type: metadata.type, index: 0 }
            ];
            reqs.forEach((req, idx) => {
                const attrs = this.parseAttrs(req.attrs);
                columns.push({
                    name: attrs.alias || req.val,
                    type: req.type,
                    index: idx + 1,
                    arr_id: req.arr_id
                });
            });

            // Apply multi-column sorting (client-side)
            if (sortState.length > 0) {
                rows = this.sortSubordinateRows(rows, sortState, columns);
            }

            // Apply search filter (client-side)
            if (searchTerm && searchTerm.trim() !== '') {
                rows = this.filterSubordinateRows(rows, searchTerm.trim(), columns);
            }

            // Build table URL for subordinate table link (issue #589)
            const pathParts = window.location.pathname.split('/');
            const dbName = pathParts.length >= 2 ? pathParts[1] : '';
            const subordinateTableUrl = `/${dbName}/table/${arrId}?F_U=${parentRecordId}`;

            let html = `
                <div class="subordinate-table-toolbar">
                    <button type="button" class="btn btn-sm btn-primary subordinate-add-btn" data-arr-id="${ arrId }" data-parent-id="${ parentRecordId }">
                        + Добавить
                    </button>
                    <div class="subordinate-search-wrapper">
                        <input type="text" class="subordinate-search-input" placeholder="Поиск..." value="${ this.escapeHtml(searchTerm) }" autocomplete="off" readonly onfocus="this.removeAttribute('readonly')" onmousedown="this.removeAttribute('readonly')">
                        <button type="button" class="subordinate-search-clear" title="Очистить поиск"${ searchTerm ? '' : ' style="display: none;"' }><i class="pi pi-times"></i></button>
                    </div>
                    <a href="${subordinateTableUrl}" class="subordinate-table-link" title="Открыть в таблице" target="_blank">
                        <i class="pi pi-table"></i>
                    </a>
                </div>
            `;

            if (rows.length === 0) {
                const emptyMessage = searchTerm ? 'Ничего не найдено' : 'Нет записей';
                html += `<div class="subordinate-table-empty">${ emptyMessage }</div>`;
            } else {
                html += `<div class="subordinate-table-wrapper"><table class="subordinate-table"><thead><tr>`;

                // Header: main value column + requisite columns (with sort indicators)
                columns.forEach((col, colIdx) => {
                    // Find sort state for this column
                    const sortInfo = sortState.find(s => s.colIndex === colIdx);
                    const sortIndicator = sortInfo ? (sortInfo.direction === 'asc' ? ' <i class="pi pi-sort-amount-up-alt" style="font-size:0.75em;"></i>' : ' <i class="pi pi-sort-amount-down" style="font-size:0.75em;"></i>') : '';
                    const sortPriority = sortInfo ? sortState.indexOf(sortInfo) + 1 : '';
                    const priorityBadge = sortState.length > 1 && sortPriority ? `<span class="subordinate-sort-priority">${ sortPriority }</span>` : '';

                    html += `<th class="subordinate-sortable-header" data-col-index="${ colIdx }">${ col.name }${ sortIndicator }${ priorityBadge }</th>`;
                });

                html += `</tr></thead><tbody>`;

                // Data rows
                rows.forEach(row => {
                    const rowId = row.i;
                    const values = row.r || [];

                    html += `<tr data-row-id="${ rowId }">`;

                    // First column (main value) - clickable to edit
                    const mainValue = values[0] || '';
                    const mainFieldInfo = { type: metadata.type };
                    let displayMainValue = this.formatSubordinateCellValue(mainValue, mainFieldInfo);
                    if (searchTerm) {
                        displayMainValue = this.highlightSearchTerm(displayMainValue, searchTerm);
                    }
                    html += `<td class="subordinate-cell-clickable" data-row-id="${ rowId }" data-type-id="${ arrId }">${ displayMainValue }</td>`;

                    // Other columns
                    reqs.forEach((req, idx) => {
                        const cellValue = values[idx + 1] !== undefined ? values[idx + 1] : '';

                        if (req.arr_id) {
                            const count = typeof cellValue === 'number' ? cellValue : (cellValue || 0);
                            // Issue #737: Use the same icon styling as .subordinate-link-cell in main table
                            const nestedTableUrl = `/${dbName}/table/${req.arr_id}?F_U=${rowId}`;
                            html += `<td class="subordinate-nested-count"><a href="${nestedTableUrl}" class="subordinate-table-icon-link" target="${req.arr_id}" title="Открыть в новом окне" onclick="event.stopPropagation();"><i class="pi pi-table"></i></a><a href="#" class="subordinate-count-link" onclick="window.${instanceName}.openSubordinateTableFromCell(event, ${req.arr_id}, ${rowId}); return false;" title="Посмотреть подчиненную таблицу">(${count})</a></td>`;
                        } else {
                            let displayValue = this.formatSubordinateCellValue(cellValue, req);
                            if (searchTerm) {
                                displayValue = this.highlightSearchTerm(displayValue, searchTerm);
                            }
                            html += `<td>${ displayValue }</td>`;
                        }
                    });

                    html += `</tr>`;
                });

                html += `</tbody></table></div>`;
            }

            // Save search input focus state before re-rendering (issue #593)
            const oldSearchInput = container.querySelector('.subordinate-search-input');
            const wasSearchFocused = oldSearchInput && document.activeElement === oldSearchInput;
            const cursorPosition = wasSearchFocused ? oldSearchInput.selectionStart : 0;

            container.innerHTML = html;

            // Attach click handlers for editing rows
            const clickableCells = container.querySelectorAll('.subordinate-cell-clickable');
            clickableCells.forEach(cell => {
                cell.addEventListener('click', () => {
                    const rowId = cell.dataset.rowId;
                    const typeId = cell.dataset.typeId;
                    this.openEditForm(rowId, typeId, 0);
                });
            });

            // Attach add button handler
            const addBtn = container.querySelector('.subordinate-add-btn');
            if (addBtn) {
                addBtn.addEventListener('click', () => {
                    this.createSubordinateRecord(arrId, parentRecordId);
                });
            }

            // Attach sortable column header handlers
            const sortableHeaders = container.querySelectorAll('.subordinate-sortable-header');
            sortableHeaders.forEach(th => {
                th.addEventListener('click', () => {
                    const colIndex = parseInt(th.dataset.colIndex, 10);
                    this.handleSubordinateSort(container, colIndex);
                });
            });

            // Attach search input handler
            const searchInput = container.querySelector('.subordinate-search-input');
            const searchClear = container.querySelector('.subordinate-search-clear');

            if (searchInput) {
                let debounceTimer;
                searchInput.addEventListener('input', (e) => {
                    const newSearchTerm = e.target.value;
                    searchClear.style.display = newSearchTerm ? '' : 'none';

                    // Debounce search to avoid excessive re-renders
                    clearTimeout(debounceTimer);
                    debounceTimer = setTimeout(() => {
                        this.renderSubordinateTable(
                            container,
                            container._subordinateMetadata,
                            container._subordinateData,
                            container._subordinateArrId,
                            container._subordinateParentRecordId,
                            container._subordinateSortState,
                            newSearchTerm
                        );
                    }, 200);
                });
            }

            if (searchClear) {
                searchClear.addEventListener('click', () => {
                    this.renderSubordinateTable(
                        container,
                        container._subordinateMetadata,
                        container._subordinateData,
                        container._subordinateArrId,
                        container._subordinateParentRecordId,
                        container._subordinateSortState,
                        ''
                    );
                });
            }

            // Restore search input focus after re-rendering (issue #593)
            if (wasSearchFocused && searchInput) {
                searchInput.focus();
                // Restore cursor position
                if (typeof searchInput.setSelectionRange === 'function') {
                    const newPos = Math.min(cursorPosition, searchInput.value.length);
                    searchInput.setSelectionRange(newPos, newPos);
                }
            }
        }

        /**
         * Handle column sort click in subordinate table
         * Implements 3-state sorting: no sort -> asc -> desc -> no sort
         * Supports multi-column sorting with priority
         */
        handleSubordinateSort(container, colIndex) {
            let sortState = container._subordinateSortState || [];
            const existingIdx = sortState.findIndex(s => s.colIndex === colIndex);

            if (existingIdx === -1) {
                // Column not sorted - add as ascending (highest priority = last in array)
                sortState.push({ colIndex, direction: 'asc' });
            } else {
                const existing = sortState[existingIdx];
                if (existing.direction === 'asc') {
                    // Currently ascending - switch to descending
                    sortState[existingIdx].direction = 'desc';
                } else {
                    // Currently descending - remove sort
                    sortState.splice(existingIdx, 1);
                }
            }

            // Re-render with new sort state
            this.renderSubordinateTable(
                container,
                container._subordinateMetadata,
                container._subordinateData,
                container._subordinateArrId,
                container._subordinateParentRecordId,
                sortState,
                container._subordinateSearchTerm || ''
            );
        }

        /**
         * Sort subordinate table rows (multi-column support)
         */
        sortSubordinateRows(rows, sortState, columns) {
            return [...rows].sort((a, b) => {
                for (const sort of sortState) {
                    const col = columns[sort.colIndex];
                    const valA = (a.r || [])[sort.colIndex];
                    const valB = (b.r || [])[sort.colIndex];

                    const comparison = this.compareSubordinateValues(valA, valB, col.type);
                    if (comparison !== 0) {
                        return sort.direction === 'asc' ? comparison : -comparison;
                    }
                }
                return 0;
            });
        }

        /**
         * Compare two values for sorting, respecting their type
         */
        compareSubordinateValues(a, b, type) {
            // Handle null/undefined/empty
            const aEmpty = a === null || a === undefined || a === '';
            const bEmpty = b === null || b === undefined || b === '';

            if (aEmpty && bEmpty) return 0;
            if (aEmpty) return 1;  // Empty values go to end
            if (bEmpty) return -1;

            const baseFormat = this.normalizeFormat(type);

            // For reference values (id:label format), extract the label for comparison
            let valA = a;
            let valB = b;
            if (typeof a === 'string' && a.includes(':')) {
                const parts = a.split(':');
                if (parts.length >= 2 && !isNaN(parseInt(parts[0]))) {
                    valA = parts.slice(1).join(':');
                }
            }
            if (typeof b === 'string' && b.includes(':')) {
                const parts = b.split(':');
                if (parts.length >= 2 && !isNaN(parseInt(parts[0]))) {
                    valB = parts.slice(1).join(':');
                }
            }

            switch (baseFormat) {
                case 'NUMBER':
                case 'SIGNED':
                    const numA = parseFloat(valA);
                    const numB = parseFloat(valB);
                    if (!isNaN(numA) && !isNaN(numB)) {
                        return numA - numB;
                    }
                    break;
                case 'DATE':
                    const dateA = this.parseDDMMYYYY(String(valA));
                    const dateB = this.parseDDMMYYYY(String(valB));
                    if (dateA && dateB) {
                        return dateA.getTime() - dateB.getTime();
                    }
                    break;
                case 'DATETIME':
                    const dtA = this.parseDDMMYYYYHHMMSS(String(valA));
                    const dtB = this.parseDDMMYYYYHHMMSS(String(valB));
                    if (dtA && dtB) {
                        return dtA.getTime() - dtB.getTime();
                    }
                    break;
                case 'BOOLEAN':
                    const boolA = valA !== null && valA !== undefined && valA !== '' && valA !== 0 && valA !== '0' && valA !== false;
                    const boolB = valB !== null && valB !== undefined && valB !== '' && valB !== 0 && valB !== '0' && valB !== false;
                    return (boolA === boolB) ? 0 : (boolA ? -1 : 1);
            }

            // Default: string comparison (case-insensitive)
            return String(valA).toLowerCase().localeCompare(String(valB).toLowerCase(), 'ru');
        }

        /**
         * Filter subordinate table rows by search term (searches all fields)
         */
        filterSubordinateRows(rows, searchTerm, columns) {
            const term = searchTerm.toLowerCase();
            return rows.filter(row => {
                const values = row.r || [];
                return values.some((val, idx) => {
                    if (val === null || val === undefined) return false;

                    // For reference values, extract the label
                    let searchVal = String(val);
                    if (typeof val === 'string' && val.includes(':')) {
                        const parts = val.split(':');
                        if (parts.length >= 2 && !isNaN(parseInt(parts[0]))) {
                            searchVal = parts.slice(1).join(':');
                        }
                    }

                    return searchVal.toLowerCase().includes(term);
                });
            });
        }

        /**
         * Highlight search term in text (for display)
         */
        highlightSearchTerm(text, searchTerm) {
            if (!searchTerm || !text) return text;

            // Don't highlight inside HTML tags
            const term = searchTerm.toLowerCase();
            const textLower = text.toLowerCase();

            if (!textLower.includes(term)) return text;

            // Simple highlight - replace matches with highlighted version
            // Using a case-insensitive regex with capturing group
            const escapedTerm = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(`(${escapedTerm})`, 'gi');

            return text.replace(regex, '<mark class="subordinate-search-highlight">$1</mark>');
        }

        formatSubordinateCellValue(value, req) {
            if (value === null || value === undefined || value === '') {
                return '';
            }

            // Format based on type if req is provided - check this BEFORE reference value parsing
            if (req) {
                const baseFormat = this.normalizeFormat(req.type);

                switch (baseFormat) {
                    case 'BOOLEAN':
                        // Display as checkbox icon: any non-empty value = YES, empty = NO
                        const boolVal = value !== null && value !== undefined && value !== '' && value !== 0 && value !== '0' && value !== false;
                        return boolVal ? '<span class="boolean-check"><i class="pi pi-check"></i></span>' : '<span class="boolean-uncheck"><i class="pi pi-times"></i></span>';
                    case 'DATE':
                        if (value) {
                            const dateObj = this.parseDDMMYYYY(value);
                            if (dateObj && !isNaN(dateObj.getTime())) {
                                return this.formatDateDisplay(dateObj);
                            }
                        }
                        break;
                    case 'DATETIME':
                        if (value) {
                            const datetimeObj = this.parseDDMMYYYYHHMMSS(value);
                            if (datetimeObj && !isNaN(datetimeObj.getTime())) {
                                return this.formatDateTimeDisplay(datetimeObj);
                            }
                        }
                        break;
                    case 'FILE':
                        // Check if value is already an HTML anchor tag (from object/ endpoint)
                        if (typeof value === 'string' && value.trim().startsWith('<a')) {
                            // Value is already HTML link - add file-link class and return as-is
                            return value.replace('<a', '<a class="file-link"');
                        }
                        break;
                }
            }

            // Handle reference values (format: "id:label")
            // This must come AFTER type-based formatting to avoid misinterpreting datetime values as references
            if (typeof value === 'string' && value.includes(':')) {
                const parts = value.split(':');
                if (parts.length >= 2 && !isNaN(parseInt(parts[0]))) {
                    // It's a reference value, show the label
                    return this.escapeHtml(parts.slice(1).join(':'));
                }
            }

            return this.escapeHtml(String(value));
        }

        async createSubordinateRecord(arrId, parentRecordId) {
            try {
                // Fetch metadata for the subordinate table type
                if (!this.metadataCache[arrId]) {
                    this.metadataCache[arrId] = await this.fetchMetadata(arrId);
                }

                const metadata = this.metadataCache[arrId];

                // Open create form with parent ID
                this.renderSubordinateCreateForm(metadata, arrId, parentRecordId);

            } catch (error) {
                console.error('Error creating subordinate record:', error);
                this.showToast(`Ошибка: ${ error.message }`, 'error');
            }
        }

