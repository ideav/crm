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

            // Determine edit form write access (issue #1508)
            // Use the metadata's granted field for this specific form (may differ from table-level for nested forms)
            const metadataGranted = metadata.granted !== undefined ? metadata.granted : null;
            const formIsReadOnly = metadataGranted !== null && metadataGranted !== 'WRITE';
            const formHasSomeWritable = formIsReadOnly
                ? (reqs.some(req => req.granted === 'WRITE'))
                : true;
            const showSaveBtn = !formIsReadOnly || formHasSomeWritable;
            const showDeleteBtn = !isCreate && !formIsReadOnly;
            const showDuplicateBtn = !isCreate && !formIsReadOnly;

            // Build attributes form HTML
            let attributesHtml = this.renderAttributesForm(metadata, recordData, regularFields, recordReqs, isCreate, typeId, formIsReadOnly);

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
                        ${ showDeleteBtn ? '<button type="button" class="btn btn-danger" id="delete-record-btn" style="display:none;">Удалить</button>' : '' }
                        ${ showDuplicateBtn ? '<button type="button" class="btn btn-secondary" id="duplicate-record-btn">Дублировать</button>' : '' }
                        ${ showSaveBtn ? '<button type="button" class="btn btn-primary" id="save-record-btn">Сохранить</button>' : '' }
                        <button type="button" class="btn btn-secondary" data-close-modal="true">Отменить</button>
                    </div>
                </div>
            `;

            modal.innerHTML = formHtml;
            document.body.appendChild(overlay);
            document.body.appendChild(modal);

            // Store recordId on the modal element for subordinate table loading in nested modals
            modal.dataset.recordId = recordId;

            // Store first column value on the modal element for use in password reset handlers (issue #1479)
            if (firstColumnValue != null) {
                modal.dataset.firstColumnValue = firstColumnValue;
            }

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

            // Disable form elements in read-only form-groups (issue #1508)
            if (formIsReadOnly) {
                modal.querySelectorAll('.form-field-readonly input, .form-field-readonly textarea, .form-field-readonly select').forEach(el => {
                    el.disabled = true;
                });
            }

            // Load reference options for dropdowns (scoped to this modal)
            this.loadReferenceOptions(metadata.reqs, recordId || 0, modal);

            // Load GRANT and REPORT_COLUMN dropdown options (issue #577)
            this.loadGrantAndReportColumnOptions(modal);

            // Attach date/datetime picker handlers
            this.attachDatePickerHandlers(modal);

            // Attach file upload handlers
            this.attachFormFileUploadHandlers(modal);

            // Attach password reset handlers for field id=20 (issue #1471)
            this.attachPasswordResetHandlers(modal);

            // Attach form field settings handler
            const formSettingsBtn = modal.querySelector('#form-settings-btn');
            formSettingsBtn.addEventListener('click', () => {
                this.openFormFieldSettings(typeId, metadata);
            });

            // Apply saved field visibility settings
            this.applyFormFieldSettings(modal, typeId);

            // Attach save handler (only if save button is present - issue #1508)
            const saveBtn = modal.querySelector('#save-record-btn');

            if (saveBtn) {
                saveBtn.addEventListener('click', async () => {
                    saveBtn.disabled = true;
                    try {
                        await this.saveRecord(modal, isCreate, recordId, typeId, parentId, columnId);
                    } finally {
                        saveBtn.disabled = false;
                    }
                });
            }

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

            // Attach duplicate handler (edit mode only, issue #1575)
            if (!isCreate) {
                const duplicateBtn = modal.querySelector('#duplicate-record-btn');
                if (duplicateBtn) {
                    duplicateBtn.addEventListener('click', async () => {
                        duplicateBtn.disabled = true;
                        try {
                            await this.duplicateRecord(modal, recordId, typeId, parentId, metadata);
                        } finally {
                            duplicateBtn.disabled = false;
                        }
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
            if (saveBtn) {
                modal.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
                        if (!saveBtn.disabled) {
                            e.preventDefault();
                            saveBtn.click();
                        }
                    }
                });
            }

            // Focus the first visible, non-hidden input/textarea/select in the form (issue #1420)
            const firstField = modal.querySelector('input:not([type="hidden"]):not([type="checkbox"]):not([readonly]), textarea, select');
            if (firstField) {
                firstField.focus();
            }
        }

        renderAttributesForm(metadata, recordData, regularFields, recordReqs, isCreate = false, typeId = null, formIsReadOnly = false) {
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

            // When formIsReadOnly, the main value field is always read-only (issue #1508)
            const mainFieldReadOnly = formIsReadOnly;

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
            } else if (mainFieldType === 'PWD') {
                // Password field - render as type=password input (issue #1441)
                mainFieldHtml = `<input type="password" class="form-control" id="field-main" name="main" value="${ this.escapeHtml(mainValue) }" required autocomplete="new-password">`;
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
                <div class="form-group${ mainFieldReadOnly ? ' form-field-readonly' : '' }">
                    <label for="field-main">${ typeName } <span class="required">*</span></label>
                    ${ mainFieldHtml }
                </div>
            `;

            // Sort fields by saved order if available.
            // Fields not present in the saved order (e.g. newly added fields) are inserted
            // at their natural metadata position relative to their neighbors, rather than
            // being appended at the end (issue #1526).
            const savedFieldOrder = this.loadFormFieldOrder(typeId);
            const sortedFields = [...regularFields];
            if (savedFieldOrder.length > 0) {
                // Build a numeric sort key for each field.
                // Saved fields get integer keys: their saved index * scale.
                // Unsaved fields get a fractional key placed before the next saved neighbor,
                // so they appear at approximately the right metadata position.
                const scale = regularFields.length + 1;

                // Compute saved-order index for each field (-1 if not in savedFieldOrder)
                const savedIndex = new Map();
                regularFields.forEach(req => {
                    savedIndex.set(req.id, savedFieldOrder.indexOf(String(req.id)));
                });

                // Assign sort keys
                const sortKey = new Map();
                regularFields.forEach((req, natIdx) => {
                    const idx = savedIndex.get(req.id);
                    if (idx !== -1) {
                        sortKey.set(req.id, idx * scale);
                    } else {
                        // Find saved successor: the nearest saved field that comes AFTER
                        // this field in the original metadata order
                        let nextSavedIdx = savedFieldOrder.length; // default: after all saved fields
                        for (let i = natIdx + 1; i < regularFields.length; i++) {
                            const si = savedIndex.get(regularFields[i].id);
                            if (si !== -1) { nextSavedIdx = si; break; }
                        }
                        // Count how many unsaved fields share the same saved successor
                        // so they can be ordered by natIdx within the same slot
                        // Key = nextSaved slot start - 1 + small fractional offset
                        sortKey.set(req.id, nextSavedIdx * scale - scale + natIdx + 1);
                    }
                });

                sortedFields.sort((a, b) => sortKey.get(a.id) - sortKey.get(b.id));
            }

            sortedFields.forEach(req => {
                const attrs = this.parseAttrs(req.attrs);
                const fieldName = attrs.alias || req.val;
                const storedValue = recordReqs[req.id] ? recordReqs[req.id].value : '';
                const baseTypeId = recordReqs[req.id] ? recordReqs[req.id].base : req.type;
                const baseFormat = this.normalizeFormat(baseTypeId);
                const isRequired = attrs.required;
                const isMulti = attrs.multi; // Issue #853
                // Apply default value from attrs when creating a new record (issue #1498)
                const reqValue = storedValue || (isCreate ? this.resolveDefaultValue(req.attrs, baseFormat) : '');
                // Field is read-only when form is read-only and req does not have granted: "WRITE" (issue #1508)
                const isReqReadOnly = formIsReadOnly && req.granted !== 'WRITE';

                html += `<div class="form-group${ isReqReadOnly ? ' form-field-readonly' : '' }">`;
                // Password reset buttons in label for field id=20 (issue #1471)
                if (String(req.id) === '20' && baseFormat === 'PWD') {
                    html += `<label for="field-${ req.id }">${ fieldName }${ isRequired ? ' <span class="required">*</span>' : '' }&nbsp;<a class="pwd-reset-btn" data-field-id="${ req.id }" title="Задать пароль и скопировать его в буфер" style="cursor:pointer"><svg width="20" height="20" viewBox="0 1 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6.42858 9.28572V6.42858C6.42858 5.48137 6.80486 4.57297 7.47463 3.90319C8.1444 3.23342 9.05281 2.85715 10 2.85715C10.9472 2.85715 11.8556 3.23342 12.5254 3.90319C13.1952 4.57297 13.5714 5.48137 13.5714 6.42858V9.28572M5.00001 9.28572H15C15.789 9.28572 16.4286 9.92531 16.4286 10.7143V15.7143C16.4286 16.5033 15.789 17.1429 15 17.1429H5.00001C4.21103 17.1429 3.57144 16.5033 3.57144 15.7143V10.7143C3.57144 9.92531 4.21103 9.28572 5.00001 9.28572Z" stroke="#1A1A1A" stroke-linecap="round" stroke-linejoin="round"></path></svg></a>&nbsp;<a class="pwd-reset-mail-btn" data-field-id="${ req.id }" title="Задать пароль и скопировать в буфер приглашение пользователю" style="cursor:pointer"><svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M17.1429 5.71434C17.1429 4.92862 16.5 4.28577 15.7143 4.28577H4.28571C3.5 4.28577 2.85714 4.92862 2.85714 5.71434M17.1429 5.71434V14.2858C17.1429 15.0715 16.5 15.7143 15.7143 15.7143H4.28571C3.5 15.7143 2.85714 15.0715 2.85714 14.2858V5.71434M17.1429 5.71434L10 10.7143L2.85714 5.71434" stroke="#1A1A1A" stroke-linecap="round" stroke-linejoin="round"/></svg></a><span class="pwd-reset-copied" id="field-${ req.id }-copied" style="display:none">Ok</span></label>`;
                } else {
                    html += `<label for="field-${ req.id }">${ fieldName }${ isRequired ? ' <span class="required">*</span>' : '' }</label>`;
                }

                // "Link to any record" field — single-select with dynamic table (issue #1800)
                if (req.orig === '1' && !req.ref_id && !req.ref) {
                    const currentValue = reqValue || '';
                    let currentId = '';
                    let currentText = '';
                    if (currentValue) {
                        const colonIdx = currentValue.indexOf(':');
                        if (colonIdx > 0) {
                            currentId = currentValue.substring(0, colonIdx);
                            currentText = currentValue.substring(colonIdx + 1);
                        } else {
                            currentId = currentValue;
                        }
                    }
                    html += `
                        <div class="form-any-ref-editor" data-req-id="${ req.id }" data-required="${ isRequired }" data-current-id="${ this.escapeHtml(currentId) }">
                            <div class="inline-editor-reference form-ref-editor-box">
                                <div class="inline-editor-reference-header">
                                    <input type="text"
                                           class="inline-editor-reference-search form-ref-search"
                                           id="field-${ req.id }-search"
                                           placeholder="Поиск..."
                                           autocomplete="off"
                                           value="${ this.escapeHtml(currentText) }">
                                    <button class="inline-editor-reference-clear form-ref-clear" title="Очистить значение" aria-label="Очистить значение" type="button" style="${ currentId ? '' : 'display:none;' }"><i class="pi pi-times"></i></button>
                                    <button class="form-any-ref-table-btn" title="Выбрать таблицу" aria-label="Выбрать таблицу" type="button"><i class="pi pi-table"></i></button>
                                </div>
                                <div class="inline-editor-reference-dropdown form-ref-dropdown" id="field-${ req.id }-dropdown" style="display:none;">
                                    <div class="inline-editor-reference-empty">Нажмите для выбора записи или выберите таблицу</div>
                                </div>
                            </div>
                            <input type="hidden"
                                   class="form-ref-value"
                                   id="field-${ req.id }"
                                   name="t${ req.id }"
                                   value="${ this.escapeHtml(currentId) }"
                                   data-req-id="${ req.id }">
                        </div>
                    `;
                }
                // Multi-select reference field (issue #853)
                else if (req.ref_id && isMulti) {
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
                                           autocomplete="off">
                                    <button class="inline-editor-reference-add form-ref-add" style="display: none;" title="Создать запись" aria-label="Создать запись" type="button"><i class="pi pi-plus"></i></button>
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
                                           autocomplete="off">
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
                    // reqValue already includes the default from attrs/current date (resolved above, issue #1498)
                    const dateValueHtml5 = reqValue ? this.formatDateForHtml5(reqValue, false) : '';
                    const dateValueDisplay = reqValue ? this.formatDateForInput(reqValue, false) : '';
                    html += `<input type="date" class="form-control date-picker" id="field-${ req.id }-picker" value="${ this.escapeHtml(dateValueHtml5) }" ${ isRequired ? 'required' : '' } data-target="field-${ req.id }">`;
                    html += `<input type="hidden" id="field-${ req.id }" name="t${ req.id }" value="${ this.escapeHtml(dateValueDisplay) }">`;
                }
                // DateTime field with HTML5 datetime-local picker (with time rounded to 5 minutes)
                else if (baseFormat === 'DATETIME') {
                    // reqValue already includes the default from attrs/current datetime (resolved above, issue #1498)
                    const dateTimeValueHtml5 = reqValue ? this.formatDateForHtml5(reqValue, true) : '';
                    const dateTimeValueDisplay = reqValue ? this.formatDateForInput(reqValue, true) : '';
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
                // PWD field - password input (issue #1441)
                else if (baseFormat === 'PWD') {
                    html += `<input type="password" class="form-control" id="field-${ req.id }" name="t${ req.id }" value="${ this.escapeHtml(reqValue) }" ${ isRequired ? 'required' : '' } autocomplete="new-password">`;
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

                // Fetch first page of data for subordinate table (issue #1640)
                const pageSize = this.options.pageSize || 20;
                const apiBase = this.getApiBase();
                const dataUrl = `${ apiBase }/object/${ arrId }/?JSON_OBJ&F_U=${ parentRecordId }&LIMIT=0,${ pageSize + 1 }`;
                const dataResponse = await fetch(dataUrl);
                const data = await dataResponse.json();

                // Determine if there are more records (issue #1640)
                const rows = Array.isArray(data) ? data : [];
                const hasMore = rows.length > pageSize;
                const firstPageRows = hasMore ? rows.slice(0, pageSize) : rows;

                // Render the subordinate table with first page data
                this.renderSubordinateTable(container, metadata, firstPageRows, arrId, parentRecordId);

                // Store pagination state on container for infinite scroll (issue #1640)
                container._subordinateHasMore = hasMore;
                container._subordinateLoadedCount = firstPageRows.length;
                container._subordinateIsLoading = false;
                container._subordinateArrIdForScroll = arrId;
                container._subordinateParentRecordIdForScroll = parentRecordId;

                // Attach infinite scroll listener to the modal's scrollable body (issue #1640)
                this.attachSubordinateScrollListener(container);

            } catch (error) {
                console.error('Error loading subordinate table:', error);
                container.innerHTML = `<div class="subordinate-table-error">Ошибка загрузки: ${ error.message }</div>`;
            }
        }

        /**
         * Attach scroll listener to the subordinate modal's .edit-form-body for infinite scroll (issue #1640).
         * Loads next page when user scrolls near the bottom. Shows Ajax spinner while loading.
         */
        attachSubordinateScrollListener(container) {
            // Find the scrollable modal body
            const modal = container.closest('.edit-form-modal.subordinate-modal');
            if (!modal) return;
            const scrollEl = modal.querySelector('.edit-form-body');
            if (!scrollEl) return;

            // Remove previous listener if re-attached (e.g. after re-render)
            if (scrollEl._subordinateScrollListener) {
                scrollEl.removeEventListener('scroll', scrollEl._subordinateScrollListener);
            }

            const scrollListener = () => {
                if (container._subordinateIsLoading || !container._subordinateHasMore) return;

                const threshold = 200;
                const distanceFromBottom = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
                if (distanceFromBottom < threshold) {
                    this.loadMoreSubordinateRows(container);
                }
            };

            scrollEl._subordinateScrollListener = scrollListener;
            scrollEl.addEventListener('scroll', scrollListener);

            // Check immediately in case the first page already fits the screen (issue #1640)
            setTimeout(() => scrollListener(), 100);
        }

        /**
         * Load the next page of subordinate table rows and append them to the existing table (issue #1640).
         * Shows an Ajax spinner at the bottom while loading.
         */
        async loadMoreSubordinateRows(container) {
            if (container._subordinateIsLoading || !container._subordinateHasMore) return;

            container._subordinateIsLoading = true;

            // Show spinner at the bottom of the table
            const wrapper = container.querySelector('.subordinate-table-wrapper');
            let spinner = container.querySelector('.subordinate-infinite-spinner');
            if (!spinner) {
                spinner = document.createElement('div');
                spinner.className = 'subordinate-infinite-spinner';
                spinner.innerHTML = '<div class="subordinate-infinite-spinner-icon"></div>';
                if (wrapper) {
                    wrapper.after(spinner);
                } else {
                    container.appendChild(spinner);
                }
            }
            spinner.style.display = 'flex';

            try {
                const arrId = container._subordinateArrIdForScroll;
                const parentRecordId = container._subordinateParentRecordIdForScroll;
                const pageSize = this.options.pageSize || 20;
                const offset = container._subordinateLoadedCount;
                const apiBase = this.getApiBase();
                const dataUrl = `${ apiBase }/object/${ arrId }/?JSON_OBJ&F_U=${ parentRecordId }&LIMIT=${ offset },${ pageSize + 1 }`;

                const dataResponse = await fetch(dataUrl);
                const data = await dataResponse.json();
                const newRows = Array.isArray(data) ? data : [];
                const hasMore = newRows.length > pageSize;
                const pageRows = hasMore ? newRows.slice(0, pageSize) : newRows;

                // Append rows to the accumulated data and update loaded count
                container._subordinateData = (container._subordinateData || []).concat(pageRows);
                container._subordinateLoadedCount += pageRows.length;
                container._subordinateHasMore = hasMore;

                // Append new rows to the existing table's tbody
                const tbody = container.querySelector('.subordinate-table tbody');
                if (tbody && pageRows.length > 0) {
                    const metadata = container._subordinateMetadata;
                    const reqs = metadata ? (metadata.reqs || []) : [];
                    const instanceName = this.options.instanceName;
                    const pathParts = window.location.pathname.split('/');
                    const dbName = pathParts.length >= 2 ? pathParts[1] : '';
                    const searchTerm = container._subordinateSearchTerm || '';

                    pageRows.forEach(row => {
                        const rowId = row.i;
                        const values = row.r || [];
                        const tr = document.createElement('tr');
                        tr.dataset.rowId = rowId;
                        tr.draggable = false;

                        // Drag handle cell (issue #1617)
                        const dragTd = document.createElement('td');
                        dragTd.className = 'subordinate-drag-handle-td';
                        dragTd.innerHTML = '<span class="subordinate-drag-handle" title="Перетащить строку"><i class="pi pi-equals"></i></span>';
                        tr.appendChild(dragTd);

                        // First column (main value)
                        const mainValue = values[0] || '';
                        const mainFieldInfo = { type: metadata ? metadata.type : '' };
                        let displayMainValue = this.formatSubordinateCellValue(mainValue, mainFieldInfo);
                        if (searchTerm) {
                            displayMainValue = this.highlightSearchTerm(displayMainValue, searchTerm);
                        }
                        const mainTd = document.createElement('td');
                        mainTd.className = 'subordinate-cell-clickable';
                        mainTd.dataset.rowId = rowId;
                        mainTd.dataset.typeId = arrId;
                        mainTd.innerHTML = displayMainValue;
                        mainTd.addEventListener('click', () => {
                            this.openEditForm(rowId, arrId, 0);
                        });
                        tr.appendChild(mainTd);

                        // Requisite columns
                        reqs.forEach((req, idx) => {
                            const cellValue = values[idx + 1] !== undefined ? values[idx + 1] : '';
                            const td = document.createElement('td');
                            if (req.arr_id) {
                                const count = typeof cellValue === 'number' ? cellValue : (cellValue || 0);
                                const nestedTableUrl = `/${dbName}/table/${req.arr_id}?F_U=${rowId}`;
                                td.className = 'subordinate-nested-count';
                                td.innerHTML = `<a href="${nestedTableUrl}" class="subordinate-table-icon-link" target="${req.arr_id}" title="Открыть в новом окне" onclick="event.stopPropagation();"><i class="pi pi-table"></i></a><a href="#" class="subordinate-count-link" onclick="window.${instanceName}.openSubordinateTableFromCell(event, ${req.arr_id}, ${rowId}); return false;" title="Посмотреть подчиненную таблицу">(${count})</a>`;
                            } else {
                                let displayValue = this.formatSubordinateCellValue(cellValue, req);
                                if (searchTerm) {
                                    displayValue = this.highlightSearchTerm(displayValue, searchTerm);
                                }
                                td.innerHTML = displayValue;
                            }
                            tr.appendChild(td);
                        });

                        tbody.appendChild(tr);

                        // Attach mousedown/mouseup handlers for the drag handle of the new row (issue #1617).
                        // The tbody-level drop/dragstart/dragover listeners attached by attachSubordinateRowDragHandlers
                        // already cover these new rows via event delegation, so we must NOT call
                        // attachSubordinateRowDragHandlers again (that would add duplicate tbody listeners,
                        // causing two _m_ord requests on drop — issue #1664).
                        const handle = tr.querySelector('.subordinate-drag-handle');
                        if (handle) {
                            handle.addEventListener('mousedown', () => {
                                if (!handle.classList.contains('subordinate-drag-handle-disabled')) {
                                    tr.draggable = true;
                                }
                            });
                            handle.addEventListener('mouseup', () => {
                                tr.draggable = false;
                            });
                        }
                    });
                }

            } catch (error) {
                console.error('Error loading more subordinate rows:', error);
            } finally {
                container._subordinateIsLoading = false;
                // Hide spinner
                if (spinner) spinner.style.display = 'none';
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
                    <button type="button" class="btn btn-sm btn-primary subordinate-add-btn" data-arr-id="${ arrId }" data-parent-id="${ parentRecordId }" title="Добавить">
                        <i class="pi pi-plus"></i>
                    </button>
                    <div class="subordinate-search-wrapper">
                        <input type="text" class="subordinate-search-input" placeholder="Поиск..." value="${ this.escapeHtml(searchTerm) }" autocomplete="off">
                        <button type="button" class="subordinate-search-clear" title="Очистить поиск"${ searchTerm ? '' : ' style="display: none;"' }><i class="pi pi-times"></i></button>
                    </div>
                    <div class="subordinate-table-actions">
                        <button type="button" class="subordinate-copy-buffer-btn" title="Копировать в буфер"><i class="pi pi-clipboard"></i></button>
                        <a href="${subordinateTableUrl}" class="subordinate-table-link" title="Открыть в таблице" target="_blank">
                            <i class="pi pi-table"></i>
                        </a>
                    </div>
                </div>
            `;

            if (rows.length === 0) {
                const emptyMessage = searchTerm ? 'Ничего не найдено' : 'Нет записей';
                html += `<div class="subordinate-table-empty">${ emptyMessage }</div>`;
            } else {
                html += `<div class="subordinate-table-wrapper"><table class="subordinate-table"><thead><tr>`;

                // Drag handle header column (issue #1617)
                html += `<th class="subordinate-drag-handle-th"></th>`;

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

                    html += `<tr data-row-id="${ rowId }" draggable="false">`;

                    // Drag handle cell (issue #1617)
                    html += `<td class="subordinate-drag-handle-td"><span class="subordinate-drag-handle" title="Перетащить строку"><i class="pi pi-equals"></i></span></td>`;

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

            // Attach copy-to-buffer button handler (issue #1788)
            const copyBufferBtn = container.querySelector('.subordinate-copy-buffer-btn');
            if (copyBufferBtn) {
                copyBufferBtn.addEventListener('click', () => {
                    this.copySubordinateToBuffer(container);
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

            // Attach drag-and-drop row reorder handlers (issue #1617)
            this.attachSubordinateRowDragHandlers(container, arrId, parentRecordId);

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

            // Re-attach infinite scroll listener after re-render (issue #1640)
            // (re-render happens on sort/search but pagination state is preserved on container)
            if (container._subordinateHasMore !== undefined) {
                this.attachSubordinateScrollListener(container);
            }
        }

        /**
         * Strip "id:label" reference prefix from a value for plain-text output (issue #1790).
         * Returns just the label part if the value matches "number:text" format.
         */
        stripReferencePrefix(value) {
            if (typeof value === 'string' && value.includes(':')) {
                const parts = value.split(':');
                if (parts.length >= 2 && !isNaN(parseInt(parts[0]))) {
                    return parts.slice(1).join(':');
                }
            }
            return value;
        }

        /**
         * Copy subordinate table data to clipboard with TAB delimiters (issue #1788).
         * Uses the currently displayed rows stored on the container element.
         */
        async copySubordinateToBuffer(container) {
            const data = container._subordinateData;
            const metadata = container._subordinateMetadata;

            if (!data || !metadata) {
                this.showToast('Нет данных для копирования', 'error');
                return;
            }

            const reqs = metadata.reqs || [];
            // Build column list (same as renderSubordinateTable): main column + non-nested reqs
            const columns = [{ name: this.getMetadataName(metadata) }];
            reqs.forEach(req => {
                if (!req.arr_id) {
                    const attrs = this.parseAttrs(req.attrs);
                    columns.push({ name: attrs.alias || req.val });
                }
            });

            const rows = Array.isArray(data) ? data : [];
            if (rows.length === 0) {
                this.showToast('Нет данных для копирования', 'error');
                return;
            }

            // Build TAB-delimited text from rows (only non-nested columns)
            const lines = rows.map(row => {
                const values = row.r || [];
                const cells = [];
                let valIdx = 0;
                // Main value (strip "id:label" reference prefix)
                cells.push(this.stripReferencePrefix(String(values[valIdx] || '')));
                valIdx++;
                // Requisite columns (skip nested arr_id columns)
                reqs.forEach(req => {
                    if (!req.arr_id) {
                        cells.push(this.stripReferencePrefix(String(values[valIdx] || '')));
                    }
                    valIdx++;
                });
                return cells.join('\t');
            });

            const text = lines.join('\n');

            try {
                await navigator.clipboard.writeText(text);
                this.showToast(`Скопировано ${ rows.length } записей в буфер`, 'success');
            } catch (error) {
                console.error('Copy to buffer error:', error);
                this.showToast(`Ошибка копирования: ${ error.message }`, 'error');
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
         * Attach drag-and-drop handlers to subordinate table rows for reordering (issue #1617).
         * Uses HTML5 drag-and-drop API. Drag is initiated only via the handle cell.
         * While _m_ord is in flight, all handles are disabled.
         */
        attachSubordinateRowDragHandlers(container, arrId, parentRecordId) {
            const tbody = container.querySelector('.subordinate-table tbody');
            if (!tbody) return;

            let dragSrcRow = null;
            let dragTargetRow = null;

            const setHandlesDisabled = (disabled) => {
                container.querySelectorAll('.subordinate-drag-handle').forEach(h => {
                    h.classList.toggle('subordinate-drag-handle-disabled', disabled);
                    h.closest('tr').draggable = !disabled;
                });
            };

            const getRows = () => Array.from(tbody.querySelectorAll('tr[data-row-id]'));

            // Enable draggable on mousedown of handle, disable on mouseup (so normal clicks don't trigger drag)
            container.querySelectorAll('.subordinate-drag-handle').forEach(handle => {
                const row = handle.closest('tr');

                handle.addEventListener('mousedown', () => {
                    if (!handle.classList.contains('subordinate-drag-handle-disabled')) {
                        row.draggable = true;
                    }
                });
                handle.addEventListener('mouseup', () => {
                    row.draggable = false;
                });
            });

            tbody.addEventListener('dragstart', (e) => {
                const row = e.target.closest('tr[data-row-id]');
                if (!row || !row.draggable) { e.preventDefault(); return; }
                dragSrcRow = row;
                row.classList.add('subordinate-row-dragging');
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', row.dataset.rowId);
            });

            tbody.addEventListener('dragend', (e) => {
                const row = e.target.closest('tr[data-row-id]');
                if (row) {
                    row.draggable = false;
                    row.classList.remove('subordinate-row-dragging');
                }
                tbody.querySelectorAll('.subordinate-row-drag-over').forEach(r => r.classList.remove('subordinate-row-drag-over'));
                dragSrcRow = null;
                dragTargetRow = null;
            });

            tbody.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                const row = e.target.closest('tr[data-row-id]');
                if (!row || row === dragSrcRow) return;
                tbody.querySelectorAll('.subordinate-row-drag-over').forEach(r => r.classList.remove('subordinate-row-drag-over'));
                row.classList.add('subordinate-row-drag-over');
                dragTargetRow = row;
            });

            tbody.addEventListener('dragleave', (e) => {
                const row = e.target.closest('tr[data-row-id]');
                if (row) row.classList.remove('subordinate-row-drag-over');
            });

            tbody.addEventListener('drop', async (e) => {
                e.preventDefault();
                const targetRow = dragTargetRow;
                dragTargetRow = null;
                if (!targetRow || !dragSrcRow || targetRow === dragSrcRow) return;

                targetRow.classList.remove('subordinate-row-drag-over');

                // Reorder rows in DOM
                const rows = getRows();
                const srcIdx = rows.indexOf(dragSrcRow);
                const tgtIdx = rows.indexOf(targetRow);

                if (srcIdx === -1 || tgtIdx === -1) return;

                // Determine insert position based on cursor Y relative to target row midpoint (issue #1666).
                // This mirrors main-app.js handleReorder logic: top half → insert before, bottom half → insert after.
                const rect = targetRow.getBoundingClientRect();
                const midY = rect.top + rect.height / 2;
                const insertBeforeTarget = e.clientY < midY;

                if (insertBeforeTarget) {
                    tbody.insertBefore(dragSrcRow, targetRow);
                } else {
                    tbody.insertBefore(dragSrcRow, targetRow.nextSibling);
                }

                // Collect new order of row IDs
                const newOrder = getRows().map(r => r.dataset.rowId);

                // New 1-based position of the moved record
                const movedRecordId = dragSrcRow.dataset.rowId;
                const newPosition = newOrder.indexOf(movedRecordId) + 1;

                // Update in-memory data to reflect new order
                const dataMap = {};
                (container._subordinateData || []).forEach(row => { dataMap[row.i] = row; });
                container._subordinateData = newOrder.map(id => dataMap[id]).filter(Boolean);

                // Disable all handles while saving
                setHandlesDisabled(true);

                await this.saveSubordinateRowOrder(movedRecordId, newPosition, container, setHandlesDisabled);
            });
        }

        /**
         * Save the new row order via _m_ord command (issue #1617).
         * Sends only the moved record's ID and its new 1-based position.
         * The backend recalculates order for other records automatically.
         * Re-enables handles when done.
         */
        async saveSubordinateRowOrder(movedRecordId, newPosition, container, setHandlesDisabled) {
            const apiBase = this.getApiBase();
            const params = new URLSearchParams();
            params.append('order', newPosition);
            if (typeof xsrf !== 'undefined') {
                params.append('_xsrf', xsrf);
            }

            try {
                const response = await fetch(`${apiBase}/_m_ord/${movedRecordId}?JSON`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: params.toString()
                });

                const responseText = await response.text();
                let result;
                try {
                    result = JSON.parse(responseText);
                } catch (jsonError) {
                    throw new Error(`Невалидный JSON ответ: ${responseText}`);
                }

                const serverError = this.getServerError(result);
                if (serverError) {
                    throw new Error(serverError);
                }
            } catch (error) {
                console.error('Error saving row order:', error);
                this.showToast(`Ошибка сохранения порядка: ${ error.message }`, 'error');
                // Reload to get correct server order on error
                await this.loadSubordinateTable(container, container._subordinateArrId, container._subordinateParentRecordId);
                return;
            } finally {
                setHandlesDisabled(false);
            }
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

