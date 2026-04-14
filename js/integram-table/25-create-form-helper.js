class IntegramCreateFormHelper {
    constructor(apiBase, tableTypeId, parentId) {
        this.apiBase = apiBase;
        this.tableTypeId = tableTypeId;
        this.parentId = parentId;
        this.metadataCache = {};
        this.metadataFetchPromises = {};  // In-progress fetch promises by type ID (issue #1455)
        this.grantOptionsCache = null;  // Cache for GRANT dropdown options (issue #607)
        this.reportColumnOptionsCache = null;  // Cache for REPORT_COLUMN dropdown options (issue #607)
    }

    escapeHtml(text) {
        if (text === null || text === undefined) return '';
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    getMetadataName(metadata) {
        return metadata.val || metadata.name || metadata.title || `Тип #${metadata.id || '?'}`;
    }

    parseAttrs(attrs) {
        const result = {
            required: false,
            multi: false,
            alias: null,
            defaultValue: null
        };

        if (!attrs) return result;

        result.required = attrs.includes(':!NULL:');
        result.multi = attrs.includes(':MULTI:');

        const aliasMatch = attrs.match(/:ALIAS=(.*?):/u);
        if (aliasMatch) {
            result.alias = aliasMatch[1];
        }

        // Extract default value: strip all known flags and use the remainder
        let stripped = attrs
            .replace(/:!NULL:/g, '')
            .replace(/:MULTI:/g, '')
            .replace(/:ALIAS=(.*?):/gu, '')
            .trim();
        if (stripped.length > 0) {
            result.defaultValue = stripped;
        }

        return result;
    }

    normalizeFormat(baseTypeId) {
        const validFormats = ['SHORT', 'CHARS', 'DATE', 'NUMBER', 'SIGNED', 'BOOLEAN',
                              'MEMO', 'DATETIME', 'FILE', 'HTML', 'BUTTON', 'PWD',
                              'GRANT', 'REPORT_COLUMN', 'PATH'];

        const upperTypeId = String(baseTypeId).toUpperCase();

        if (validFormats.includes(upperTypeId)) {
            return upperTypeId;
        }

        // Map numeric type IDs to format names
        const formatMap = {
            '3': 'SHORT',
            '8': 'CHARS',
            '9': 'DATE',
            '13': 'NUMBER',
            '14': 'SIGNED',
            '11': 'BOOLEAN',
            '12': 'MEMO',
            '4': 'DATETIME',
            '10': 'FILE',
            '2': 'HTML',
            '7': 'BUTTON',
            '6': 'PWD',
            '5': 'GRANT',
            '16': 'REPORT_COLUMN',
            '17': 'PATH'
        };
        return formatMap[String(baseTypeId)] || 'SHORT';
    }

    formatDateForHtml5(dateStr, includeTime = false) {
        if (!dateStr) return '';

        // Handle Unix/JS numeric timestamp (e.g. "1773328460.1069" or "1773328460000")
        const trimmed = String(dateStr).trim();
        if (/^\d+(\.\d+)?$/.test(trimmed)) {
            const num = parseFloat(trimmed);
            if (num >= 1e9) {
                const ms = num >= 1e12 ? num : num * 1000;
                const date = new Date(ms);
                const year = date.getFullYear();
                if (year >= 2001 && year <= 2100) {
                    const month = String(date.getMonth() + 1).padStart(2, '0');
                    const day = String(date.getDate()).padStart(2, '0');
                    if (includeTime) {
                        const hours = String(date.getHours()).padStart(2, '0');
                        const minutes = String(date.getMinutes()).padStart(2, '0');
                        return `${year}-${month}-${day}T${hours}:${minutes}`;
                    }
                    return `${year}-${month}-${day}`;
                }
            }
        }

        // Handle DD.MM.YYYY format
        const dateParts = trimmed.split(' ')[0].split('.');
        if (dateParts.length === 3) {
            const [day, month, year] = dateParts;
            if (includeTime) {
                const timeParts = trimmed.split(' ')[1] || '00:00';
                return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${timeParts}`;
            }
            return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
        }

        return dateStr;
    }

    formatDateForInput(dateStr, includeTime = false) {
        if (!dateStr) return '';
        return dateStr;
    }

    showToast(message, type = 'info') {
        // Try to use existing toast function if available
        if (typeof window.showToast === 'function') {
            window.showToast(message, type);
            return;
        }

        // Create a simple toast notification
        const toast = document.createElement('div');
        toast.className = `integram-toast integram-toast-${type}`;
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 12px 24px;
            border-radius: 4px;
            color: white;
            z-index: 10000;
            font-family: sans-serif;
            font-size: 0.875rem;
            box-shadow: 0 2px 8px rgba(0,0,0,0.2);
            background-color: ${type === 'error' ? '#dc3545' : type === 'success' ? '#28a745' : '#17a2b8'};
        `;
        document.body.appendChild(toast);

        setTimeout(() => {
            toast.remove();
        }, 3000);
    }

    renderCreateFormModal(metadata, recordData, fieldValues, parentInfo = null) {
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
        const title = `Создание: ${typeName}`;

        // Build parent info subtitle HTML if parentInfo is provided
        let parentSubtitleHtml = '';
        if (parentInfo && parentInfo.val) {
            const escapedParentVal = this.escapeHtml(parentInfo.val);
            parentSubtitleHtml = `<div class="edit-form-parent-subtitle">в: ${escapedParentVal}</div>`;
        }

        // Render the form
        const reqs = metadata.reqs || [];
        const recordReqs = recordData && recordData.reqs ? recordData.reqs : {};
        const regularFields = reqs.filter(req => !req.arr_id);

        // Build attributes form HTML
        let attributesHtml = this.renderAttributesForm(metadata, recordData, regularFields, recordReqs, fieldValues);

        let formHtml = `
            <div class="edit-form-header">
                <div class="edit-form-header-titles">
                    <h3>${title}</h3>
                    ${parentSubtitleHtml}
                </div>
                <button class="edit-form-close" data-close-modal="true"><i class="pi pi-times"></i></button>
            </div>
            <div class="edit-form-body">
                <div class="edit-form-tab-content active" data-tab-content="attributes">
                    <form id="edit-form" class="edit-form" onsubmit="return false;" autocomplete="off">
                        ${attributesHtml}
                    </form>
                </div>
            </div>
            <div class="edit-form-footer">
                <div class="edit-form-footer-buttons">
                    <button type="button" class="btn btn-primary" id="save-record-btn">Сохранить</button>
                    <button type="button" class="btn btn-secondary" data-close-modal="true">Отменить</button>
                </div>
            </div>
        `;

        modal.innerHTML = formHtml;
        document.body.appendChild(overlay);
        document.body.appendChild(modal);

        // Load reference options for dropdowns
        this.loadReferenceOptions(metadata.reqs, modal, fieldValues);

        // Load GRANT and REPORT_COLUMN dropdown options (issue #577)
        this.loadGrantAndReportColumnOptions(modal);

        // Attach date/datetime picker handlers
        this.attachDatePickerHandlers(modal);

        // Attach file upload handlers
        this.attachFormFileUploadHandlers(modal);

        // Attach save handler
        const saveBtn = modal.querySelector('#save-record-btn');
        saveBtn.addEventListener('click', async () => {
            saveBtn.disabled = true;
            try {
                await this.saveRecord(modal, metadata);
            } finally {
                saveBtn.disabled = false;
            }
        });

        // Close modal helper function
        const closeModal = () => {
            modal.remove();
            overlay.remove();
            window._integramModalDepth = Math.max(0, (window._integramModalDepth || 1) - 1);
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
    }

    renderAttributesForm(metadata, recordData, regularFields, recordReqs, fieldValues) {
        let html = '';

        // Get current date/datetime for default values (since this is create mode)
        const now = new Date();
        const currentDateHtml5 = now.toISOString().split('T')[0]; // YYYY-MM-DD
        const minutes = Math.round(now.getMinutes() / 5) * 5; // Round to 5 minutes
        now.setMinutes(minutes);
        const currentDateTimeHtml5 = now.toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
        const currentDateDisplay = now.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '.'); // DD.MM.YYYY
        const currentDateTimeDisplay = currentDateDisplay + ' ' + now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); // DD.MM.YYYY HH:MM

        // Main value field - render according to base type
        const typeName = this.getMetadataName(metadata);
        const mainValue = recordData && recordData.obj ? recordData.obj.val || '' : '';
        // For GRANT/REPORT_COLUMN fields, use term from API response for dropdown pre-selection (issue #583)
        const mainTermValue = recordData && recordData.obj && recordData.obj.term !== undefined ? recordData.obj.term : '';
        const mainFieldType = this.normalizeFormat(metadata.type);

        // Build main field HTML based on its type
        let mainFieldHtml = '';
        if (mainFieldType === 'BOOLEAN') {
            const isChecked = mainValue ? 'checked' : '';
            mainFieldHtml = `<input type="checkbox" id="field-main" name="main" value="1" ${ isChecked }>`;
        } else if (mainFieldType === 'DATE') {
            const dateValueHtml5 = mainValue ? this.formatDateForHtml5(mainValue, false) : currentDateHtml5;
            const dateValueDisplay = mainValue ? this.formatDateForInput(mainValue, false) : currentDateDisplay;
            mainFieldHtml = `<input type="date" class="form-control date-picker" id="field-main-picker" required data-target="field-main" value="${ this.escapeHtml(dateValueHtml5) }">`;
            mainFieldHtml += `<input type="hidden" id="field-main" name="main" value="${ this.escapeHtml(dateValueDisplay) }">`;
        } else if (mainFieldType === 'DATETIME') {
            const dateTimeValueHtml5 = mainValue ? this.formatDateForHtml5(mainValue, true) : currentDateTimeHtml5;
            const dateTimeValueDisplay = mainValue ? this.formatDateForInput(mainValue, true) : currentDateTimeDisplay;
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
                <label for="field-main">${typeName} <span class="required">*</span></label>
                ${ mainFieldHtml }
            </div>
        `;

        // Render requisite fields
        regularFields.forEach(req => {
            const attrs = this.parseAttrs(req.attrs);
            const fieldName = attrs.alias || req.val;
            const reqValue = recordReqs[req.id] ? recordReqs[req.id].value || '' : '';
            const baseTypeId = recordReqs[req.id] ? recordReqs[req.id].base || req.type : req.type;
            const baseFormat = this.normalizeFormat(baseTypeId);
            const isRequired = attrs.required;

            const isMulti = attrs.multi; // Issue #1136

            html += `<div class="form-group">`;
            html += `<label for="field-${req.id}">${fieldName}${isRequired ? ' <span class="required">*</span>' : ''}</label>`;

            // Multi-select reference field (issue #1136)
            if (req.ref_id && isMulti) {
                const currentValue = reqValue || '';
                html += `
                    <div class="form-reference-editor form-multi-reference-editor" data-ref-id="${req.id}" data-required="${isRequired}" data-ref-type-id="${req.orig || req.ref_id}" data-multi="1" data-current-value="${this.escapeHtml(currentValue)}">
                        <div class="inline-editor-reference form-ref-editor-box inline-editor-multi-reference">
                            <div class="multi-ref-tags-container form-multi-ref-tags-container">
                                <span class="multi-ref-tags-placeholder">Загрузка...</span>
                            </div>
                            <div class="inline-editor-reference-header">
                                <input type="text"
                                       class="inline-editor-reference-search form-ref-search"
                                       id="field-${req.id}-search"
                                       placeholder="Добавить..."
                                       autocomplete="off">
                                <button class="inline-editor-reference-add form-ref-add" style="display: none;" title="Создать запись" aria-label="Создать запись" type="button"><i class="pi pi-plus"></i></button>
                            </div>
                            <div class="inline-editor-reference-dropdown form-ref-dropdown" id="field-${req.id}-dropdown" style="display:none;">
                                <div class="inline-editor-reference-empty">Загрузка...</div>
                            </div>
                        </div>
                        <input type="hidden"
                               class="form-ref-value form-multi-ref-value"
                               id="field-${req.id}"
                               name="t${req.id}"
                               value=""
                               data-ref-id="${req.id}">
                    </div>
                `;
            }
            // Single-select reference field (searchable dropdown)
            else if (req.ref_id) {
                const currentValue = reqValue || '';
                html += `
                    <div class="form-reference-editor" data-ref-id="${req.id}" data-required="${isRequired}" data-ref-type-id="${req.orig || req.ref_id}">
                        <div class="inline-editor-reference form-ref-editor-box">
                            <div class="inline-editor-reference-header">
                                <input type="text"
                                       class="inline-editor-reference-search form-ref-search"
                                       id="field-${req.id}-search"
                                       placeholder="Поиск..."
                                       autocomplete="off">
                                <button class="inline-editor-reference-clear form-ref-clear" title="Очистить значение" aria-label="Очистить значение" type="button"><i class="pi pi-times"></i></button>
                            </div>
                            <div class="inline-editor-reference-dropdown form-ref-dropdown" id="field-${req.id}-dropdown">
                                <div class="inline-editor-reference-empty">Загрузка...</div>
                            </div>
                        </div>
                        <input type="hidden"
                               class="form-ref-value"
                               id="field-${req.id}"
                               name="t${req.id}"
                               value="${this.escapeHtml(currentValue)}"
                               data-ref-id="${req.id}">
                    </div>
                `;
            }
            // Boolean field
            else if (baseFormat === 'BOOLEAN') {
                const isChecked = reqValue ? 'checked' : '';
                html += `<input type="checkbox" id="field-${req.id}" name="t${req.id}" value="1" ${isChecked}>`;
            }
            // Date field
            else if (baseFormat === 'DATE') {
                const dateValueHtml5 = reqValue ? this.formatDateForHtml5(reqValue, false) : '';
                const dateValueDisplay = reqValue ? this.formatDateForInput(reqValue, false) : '';
                html += `<input type="date" class="form-control date-picker" id="field-${req.id}-picker" value="${this.escapeHtml(dateValueHtml5)}" ${isRequired ? 'required' : ''} data-target="field-${req.id}">`;
                html += `<input type="hidden" id="field-${req.id}" name="t${req.id}" value="${this.escapeHtml(dateValueDisplay)}">`;
            }
            // DateTime field
            else if (baseFormat === 'DATETIME') {
                const dateTimeValueHtml5 = reqValue ? this.formatDateForHtml5(reqValue, true) : '';
                const dateTimeValueDisplay = reqValue ? this.formatDateForInput(reqValue, true) : '';
                html += `<input type="datetime-local" class="form-control datetime-picker" id="field-${req.id}-picker" value="${this.escapeHtml(dateTimeValueHtml5)}" ${isRequired ? 'required' : ''} data-target="field-${req.id}">`;
                html += `<input type="hidden" id="field-${req.id}" name="t${req.id}" value="${this.escapeHtml(dateTimeValueDisplay)}">`;
            }
            // MEMO field (multi-line text)
            else if (baseFormat === 'MEMO') {
                html += `<textarea class="form-control memo-field" id="field-${req.id}" name="t${req.id}" rows="4" ${isRequired ? 'required' : ''}>${this.escapeHtml(reqValue)}</textarea>`;
            }
            // FILE field
            else if (baseFormat === 'FILE') {
                html += `
                    <div class="form-file-upload" data-req-id="${req.id}" data-original-value="">
                        <input type="file" class="file-input" id="field-${req.id}-file" style="display: none;">
                        <div class="file-dropzone">
                            <span class="file-dropzone-text">Перетащите файл сюда или нажмите для выбора</span>
                            <button type="button" class="file-select-btn">Выбрать файл</button>
                        </div>
                        <div class="file-preview" style="display: none;">
                            <span class="file-name"></span>
                            <button type="button" class="file-remove-btn" title="Удалить файл"><i class="pi pi-times"></i></button>
                        </div>
                        <input type="hidden" id="field-${req.id}" name="t${req.id}" value="" ${isRequired ? 'required' : ''} data-file-deleted="false">
                    </div>
                `;
            }
            // GRANT field (dropdown with options from GET grants API - issue #577)
            else if (baseFormat === 'GRANT') {
                html += `
                    <select class="form-control form-grant-select" id="field-${req.id}" name="t${req.id}" ${isRequired ? 'required' : ''} data-grant-type="grant">
                        <option value="">Загрузка...</option>
                    </select>
                `;
                // Store current value for later selection after options load
                html += `<input type="hidden" id="field-${req.id}-current-value" value="${this.escapeHtml(reqValue)}">`;
            }
            // REPORT_COLUMN field (dropdown with options from GET rep_cols API - issue #577)
            else if (baseFormat === 'REPORT_COLUMN') {
                html += `
                    <select class="form-control form-grant-select" id="field-${req.id}" name="t${req.id}" ${isRequired ? 'required' : ''} data-grant-type="rep_col">
                        <option value="">Загрузка...</option>
                    </select>
                `;
                // Store current value for later selection after options load
                html += `<input type="hidden" id="field-${req.id}-current-value" value="${this.escapeHtml(reqValue)}">`;
            }
            // Regular text field
            else {
                html += `<input type="text" class="form-control" id="field-${req.id}" name="t${req.id}" value="${this.escapeHtml(reqValue)}" ${isRequired ? 'required' : ''}>`;
            }

            html += `</div>`;
        });

        return html;
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

        let apiUrl;

        if (grantType === 'grant') {
            apiUrl = `${ this.apiBase }/grants`;
        } else if (grantType === 'rep_col') {
            apiUrl = `${ this.apiBase }/rep_cols`;
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
    async loadGrantAndReportColumnOptions(modal) {
        const grantSelects = modal.querySelectorAll('.form-grant-select');

        for (const select of grantSelects) {
            const grantType = select.dataset.grantType;
            const fieldId = select.id;
            const currentValueInput = modal.querySelector(`#${ fieldId }-current-value`);
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

    async loadReferenceOptions(reqs, modal, fieldValues) {
        if (!reqs) return;

        for (const req of reqs) {
            if (!req.ref_id) continue;

            // Issue #1136: Check if this is a multi-reference editor
            const wrapper = modal.querySelector(`.form-reference-editor[data-ref-id="${req.id}"]`);
            if (wrapper && wrapper.dataset.multi === '1') {
                this.initMultiReferenceEditor(wrapper, req.id, modal);
                continue;
            }

            const dropdown = modal.querySelector(`#field-${req.id}-dropdown`);
            const hiddenInput = modal.querySelector(`#field-${req.id}`);
            const searchInput = modal.querySelector(`#field-${req.id}-search`);

            if (!dropdown || !hiddenInput) continue;

            try {
                const url = `${this.apiBase}/_ref_reqs/${req.id}?JSON&LIMIT=50`;
                const response = await fetch(url);
                const data = await response.json();

                // Parse options - data is an object {id: text, ...}
                let optionsHtml = '';
                const entries = Object.entries(data);

                if (entries.length === 0) {
                    optionsHtml = '<div class="inline-editor-reference-empty">Нет данных</div>';
                } else {
                    entries.forEach(([id, text]) => {
                        optionsHtml += `<div class="inline-editor-reference-option" data-value="${this.escapeHtml(id)}">${this.escapeHtml(text)}</div>`;
                    });
                }

                dropdown.innerHTML = optionsHtml;

                // Check if this field has a pre-filled value from fieldValues
                const fieldKey = `t${req.id}`;
                const prefilledValue = fieldValues[fieldKey];

                if (prefilledValue !== undefined) {
                    hiddenInput.value = prefilledValue;
                    // Find and display the text for this value
                    const text = data[prefilledValue];
                    if (text && searchInput) {
                        searchInput.value = text;
                    }
                }

                // Attach click handlers for options
                dropdown.querySelectorAll('.inline-editor-reference-option').forEach(option => {
                    option.addEventListener('click', () => {
                        const value = option.dataset.value;
                        const text = option.textContent;
                        hiddenInput.value = value;
                        if (searchInput) {
                            searchInput.value = text;
                        }
                        dropdown.style.display = 'none';
                    });
                });

                // Attach search handler
                if (searchInput) {
                    searchInput.addEventListener('focus', () => {
                        dropdown.style.display = 'block';
                    });

                    searchInput.addEventListener('input', () => {
                        const query = searchInput.value.toLowerCase();
                        dropdown.querySelectorAll('.inline-editor-reference-option').forEach(option => {
                            const text = option.textContent.toLowerCase();
                            option.style.display = text.includes(query) ? '' : 'none';
                        });
                    });
                }

                // Attach clear button handler
                const clearBtn = modal.querySelector(`#field-${req.id}-search`)?.closest('.inline-editor-reference-header')?.querySelector('.form-ref-clear');
                if (clearBtn) {
                    clearBtn.addEventListener('click', () => {
                        hiddenInput.value = '';
                        if (searchInput) {
                            searchInput.value = '';
                        }
                    });
                }

            } catch (error) {
                console.error(`Error loading reference options for field ${req.id}:`, error);
                dropdown.innerHTML = '<div class="inline-editor-reference-empty">Ошибка загрузки</div>';
            }
        }

        // Close dropdowns when clicking outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.form-reference-editor')) {
                modal.querySelectorAll('.form-ref-dropdown').forEach(dropdown => {
                    dropdown.style.display = 'none';
                });
            }
        });
    }

    /**
     * Initialize multi-reference editor for standalone forms (issue #1136)
     * Mirrors IntegramTable.initFormMultiReferenceEditor behavior
     */
    async initMultiReferenceEditor(wrapper, refReqId, modal) {
        const searchInput = wrapper.querySelector('.form-ref-search');
        const dropdown = wrapper.querySelector('.form-ref-dropdown');
        const hiddenInput = wrapper.querySelector('.form-multi-ref-value');
        const tagsContainer = wrapper.querySelector('.form-multi-ref-tags-container');

        if (!searchInput || !dropdown || !hiddenInput || !tagsContainer) return;

        try {
            const url = `${this.apiBase}/_ref_reqs/${refReqId}?JSON&LIMIT=50`;
            const response = await fetch(url);
            const data = await response.json();

            // Parse options into [id, text] tuples
            const options = Object.entries(data);
            wrapper._referenceOptions = options;

            // Parse current value: "id1,id2,...:val1,val2,..." or plain display names
            const currentRawValue = wrapper.dataset.currentValue || '';
            const selectedItems = [];
            const rawColonIndex = currentRawValue.indexOf(':');
            if (currentRawValue && rawColonIndex > 0) {
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

            const self = this;

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
                        <span class="multi-ref-tag" data-id="${self.escapeHtml(id)}" data-text="${self.escapeHtml(text)}">
                            ${self.escapeHtml(text)}
                            <button class="multi-ref-tag-remove" type="button" title="Удалить" aria-label="Удалить ${self.escapeHtml(text)}"><i class="pi pi-times"></i></button>
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
                        const et = self.escapeHtml(text);
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
                    await self.openCreateFormForFormReference(refTypeId, inputValue, null, hiddenInput, searchInput, wrapper, dropdown);
                });
            }

            // Initial render
            renderTags();
            updateHiddenInput();
            // Set initial add button visibility (issue #1686: show immediately when no options available)
            updateAddButtonVisibility('');

            // Show dropdown on focus
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

            // Handle tag removal and click
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
                    searchInput.focus();
                    return;
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
                } else if (e.key === 'Escape') {
                    dropdown.style.display = 'none';
                    searchInput.blur();
                }
            });

            // Keyboard navigation for dropdown options
            dropdown.addEventListener('keydown', (e) => {
                const option = e.target.closest('.inline-editor-reference-option');
                if (!option) return;
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    const next = option.nextElementSibling;
                    if (next && next.classList.contains('inline-editor-reference-option')) next.focus();
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    const prev = option.previousElementSibling;
                    if (prev && prev.classList.contains('inline-editor-reference-option')) {
                        prev.focus();
                    } else {
                        searchInput.focus();
                    }
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    option.click();
                } else if (e.key === 'Escape') {
                    dropdown.style.display = 'none';
                    searchInput.focus();
                }
            });

        } catch (error) {
            console.error(`Error loading multi-reference options for field ${refReqId}:`, error);
            dropdown.innerHTML = '<div class="inline-editor-reference-empty">Ошибка загрузки</div>';
        }
    }

    attachDatePickerHandlers(modal) {
        // Handle date pickers
        modal.querySelectorAll('.date-picker').forEach(picker => {
            picker.addEventListener('change', () => {
                const targetId = picker.dataset.target;
                const hiddenInput = modal.querySelector(`#${targetId}`);
                if (hiddenInput && picker.value) {
                    // Convert YYYY-MM-DD to DD.MM.YYYY
                    const [year, month, day] = picker.value.split('-');
                    hiddenInput.value = `${day}.${month}.${year}`;
                } else if (hiddenInput) {
                    hiddenInput.value = '';
                }
            });
        });

        // Handle datetime pickers
        modal.querySelectorAll('.datetime-picker').forEach(picker => {
            picker.addEventListener('change', () => {
                const targetId = picker.dataset.target;
                const hiddenInput = modal.querySelector(`#${targetId}`);
                if (hiddenInput && picker.value) {
                    // Convert YYYY-MM-DDTHH:MM to DD.MM.YYYY HH:MM
                    const [datePart, timePart] = picker.value.split('T');
                    const [year, month, day] = datePart.split('-');
                    hiddenInput.value = `${day}.${month}.${year} ${timePart}`;
                } else if (hiddenInput) {
                    hiddenInput.value = '';
                }
            });
        });
    }

    attachFormFileUploadHandlers(modal) {
        modal.querySelectorAll('.form-file-upload').forEach(container => {
            const fileInput = container.querySelector('.file-input');
            const dropzone = container.querySelector('.file-dropzone');
            const preview = container.querySelector('.file-preview');
            const fileName = container.querySelector('.file-name');
            const removeBtn = container.querySelector('.file-remove-btn');
            const selectBtn = container.querySelector('.file-select-btn');
            const hiddenInput = container.querySelector('input[type="hidden"]');

            if (selectBtn) {
                selectBtn.addEventListener('click', () => fileInput.click());
            }

            if (dropzone) {
                dropzone.addEventListener('click', () => fileInput.click());

                dropzone.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    dropzone.classList.add('dragover');
                });

                dropzone.addEventListener('dragleave', () => {
                    dropzone.classList.remove('dragover');
                });

                dropzone.addEventListener('drop', (e) => {
                    e.preventDefault();
                    dropzone.classList.remove('dragover');
                    if (e.dataTransfer.files.length > 0) {
                        fileInput.files = e.dataTransfer.files;
                        fileInput.dispatchEvent(new Event('change'));
                    }
                });
            }

            if (fileInput) {
                fileInput.addEventListener('change', () => {
                    if (fileInput.files.length > 0) {
                        const file = fileInput.files[0];
                        container._fileToUpload = file;
                        hiddenInput.dataset.hasNewFile = 'true';
                        fileName.textContent = file.name;
                        dropzone.style.display = 'none';
                        preview.style.display = 'flex';
                    }
                });
            }

            if (removeBtn) {
                removeBtn.addEventListener('click', () => {
                    container._fileToUpload = null;
                    hiddenInput.dataset.hasNewFile = 'false';
                    hiddenInput.value = '';
                    fileInput.value = '';
                    fileName.textContent = '';
                    dropzone.style.display = '';
                    preview.style.display = 'none';
                });
            }
        });
    }

    async saveRecord(modal, metadata) {
        const form = modal.querySelector('#edit-form');

        if (!form.checkValidity()) {
            form.reportValidity();
            return;
        }

        try {
            // Check for file uploads
            const fileUploads = modal.querySelectorAll('.form-file-upload');
            let hasNewFiles = false;

            for (const uploadContainer of fileUploads) {
                if (uploadContainer._fileToUpload) {
                    hasNewFiles = true;
                    break;
                }
            }

            // Prepare request body
            let requestBody;
            let headers = {};

            const formData = new FormData(form);

            if (hasNewFiles) {
                requestBody = new FormData();

                // Add XSRF token
                if (typeof xsrf !== 'undefined') {
                    requestBody.append('_xsrf', xsrf);
                }

                // Get main value
                const mainValue = formData.get('main');
                if (mainValue !== '' && mainValue !== null && mainValue !== undefined) {
                    requestBody.append(`t${this.tableTypeId}`, mainValue);
                }

                // Add all form fields
                for (const [key, value] of formData.entries()) {
                    if (key === 'main') continue;

                    // Check if this is a file field
                    const fieldMatch = key.match(/^t(\d+)$/);
                    if (fieldMatch) {
                        const reqId = fieldMatch[1];
                        const uploadContainer = modal.querySelector(`.form-file-upload[data-req-id="${reqId}"]`);

                        if (uploadContainer && uploadContainer._fileToUpload) {
                            requestBody.append(key, uploadContainer._fileToUpload);
                            continue;
                        }
                    }

                    if (value !== '' && value !== null && value !== undefined) {
                        requestBody.append(key, value);
                    }
                }
            } else {
                const params = new URLSearchParams();

                // Add XSRF token
                if (typeof xsrf !== 'undefined') {
                    params.append('_xsrf', xsrf);
                }

                // Get main value
                const mainValue = formData.get('main');

                // Add all form fields
                for (const [key, value] of formData.entries()) {
                    if (key === 'main') continue;
                    if (value !== '' && value !== null && value !== undefined) {
                        params.append(key, value);
                    }
                }

                if (mainValue !== '' && mainValue !== null && mainValue !== undefined) {
                    params.append(`t${this.tableTypeId}`, mainValue);
                }

                requestBody = params.toString();
                headers['Content-Type'] = 'application/x-www-form-urlencoded';
            }

            // Create the record
            const url = `${this.apiBase}/_m_new/${this.tableTypeId}?JSON&up=${this.parentId || 1}`;

            const response = await fetch(url, {
                method: 'POST',
                headers: headers,
                body: requestBody
            });

            const text = await response.text();
            let result;

            try {
                result = JSON.parse(text);
            } catch (e) {
                throw new Error(`Invalid response: ${text}`);
            }

            const serverError = this.getServerError(result);
            if (serverError) {
                throw new Error(serverError);
            }

            // Success - close modal
            this.showToast('Запись создана', 'success');

            // Close modal
            modal._overlayElement?.remove();
            modal.remove();
            window._integramModalDepth = Math.max(0, (window._integramModalDepth || 1) - 1);

            // Reload any IntegramTable instances on the page
            if (typeof reloadAllIntegramTables === 'function') {
                reloadAllIntegramTables();
            }

        } catch (error) {
            console.error('Error saving record:', error);
            this.showToast(`Ошибка: ${error.message}`, 'error');
        }
    }

    /**
     * Render edit form modal for an existing record (issue #831).
     * Similar to renderCreateFormModal but for editing existing records.
     * Enhanced with subordinate table tabs and form settings button (issue #837).
     */
    renderEditFormModalStandalone(metadata, recordData, typeId, recordId) {
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
        const recordVal = recordData && recordData.obj ? recordData.obj.val : '';
        const title = `Редактирование: ${recordVal || typeName}`;
        const parentId = recordData && recordData.obj ? recordData.obj.parent : 1;

        // Build record ID link HTML
        const pathParts = window.location.pathname.split('/');
        const dbName = pathParts.length >= 2 ? pathParts[1] : '';
        const tableUrl = `/${dbName}/table/${typeId}?F_U=${parentId || 1}&F_I=${recordId}`;

        const recordIdHtml = `
            <span class="edit-form-record-id" onclick="navigator.clipboard.writeText('${recordId}').then(() => { this.style.color='#28a745'; setTimeout(() => this.style.color='', 1000); })" title="Скопировать ID" style="cursor:pointer;margin-left:8px;font-size: 0.75rem;color:var(--cards-text-secondary);">#${recordId}</span>
            <a href="${tableUrl}" class="edit-form-table-link" title="Открыть в таблице" target="_blank" style="margin-left:4px;">
                <i class="pi pi-table"></i>
            </a>
        `;

        // Render the form
        const reqs = metadata.reqs || [];
        const recordReqs = recordData && recordData.reqs ? recordData.reqs : {};
        const regularFields = reqs.filter(req => !req.arr_id);

        // Separate subordinate tables (issue #837)
        const subordinateTables = reqs.filter(req => req.arr_id);
        const hasSubordinateTables = subordinateTables.length > 0 && recordId;

        // Build tabs HTML (issue #837)
        let tabsHtml = '';
        if (hasSubordinateTables) {
            tabsHtml = `<div class="edit-form-tabs">`;
            tabsHtml += `<div class="edit-form-tab active" data-tab="attributes">Атрибуты</div>`;

            subordinateTables.forEach(req => {
                const attrs = this.parseAttrs(req.attrs);
                const fieldName = attrs.alias || req.val;
                const arrCount = recordReqs[req.id] ? recordReqs[req.id].arr || 0 : 0;
                tabsHtml += `<div class="edit-form-tab" data-tab="sub-${req.id}" data-arr-id="${req.arr_id}" data-req-id="${req.id}">${fieldName} (${arrCount})</div>`;
            });

            tabsHtml += `</div>`;
        }

        // Build attributes form HTML with existing values
        let attributesHtml = this.renderAttributesFormForEdit(metadata, recordData, regularFields, recordReqs);

        let formHtml = `
            <div class="edit-form-header">
                <div class="edit-form-header-title-row">
                    <h3>${title}</h3>
                    ${recordIdHtml}
                </div>
                <button class="edit-form-close" data-close-modal="true"><i class="pi pi-times"></i></button>
            </div>
            ${tabsHtml}
            <div class="edit-form-body">
                <div class="edit-form-tab-content active" data-tab-content="attributes">
                    <form id="edit-form" class="edit-form" onsubmit="return false;" autocomplete="off">
                        ${attributesHtml}
                    </form>
                </div>
        `;

        // Add placeholder for subordinate table contents (issue #837)
        if (hasSubordinateTables) {
            subordinateTables.forEach(req => {
                formHtml += `
                    <div class="edit-form-tab-content" data-tab-content="sub-${req.id}">
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
                    <button type="button" class="btn btn-primary" id="save-record-btn">Сохранить</button>
                    <button type="button" class="btn btn-secondary" data-close-modal="true">Отменить</button>
                </div>
            </div>
        `;

        modal.innerHTML = formHtml;
        document.body.appendChild(overlay);
        document.body.appendChild(modal);

        // Store recordId on modal for subordinate table loading (issue #837)
        modal.dataset.recordId = recordId;

        // Attach tab switching handlers (issue #837)
        if (hasSubordinateTables) {
            this.attachTabHandlersStandalone(modal, subordinateTables);
        }

        // Load reference options for dropdowns
        this.loadReferenceOptions(metadata.reqs, modal, {});

        // Load GRANT and REPORT_COLUMN dropdown options
        this.loadGrantAndReportColumnOptions(modal);

        // Attach date/datetime picker handlers
        this.attachDatePickerHandlers(modal);

        // Attach file upload handlers
        this.attachFormFileUploadHandlers(modal);

        // Attach form field settings handler (issue #837)
        const formSettingsBtn = modal.querySelector('#form-settings-btn');
        formSettingsBtn.addEventListener('click', () => {
            this.openFormFieldSettingsStandalone(typeId, metadata);
        });

        // Apply saved field visibility settings (issue #837)
        this.applyFormFieldSettingsStandalone(modal, typeId);

        // Attach save handler
        const saveBtn = modal.querySelector('#save-record-btn');
        saveBtn.addEventListener('click', async () => {
            saveBtn.disabled = true;
            try {
                await this.saveEditedRecord(modal, metadata, recordId);
            } finally {
                saveBtn.disabled = false;
            }
        });

        // Close modal helper function
        const closeModal = () => {
            modal.remove();
            overlay.remove();
            window._integramModalDepth = Math.max(0, (window._integramModalDepth || 1) - 1);
        };

        // Attach close handlers to buttons with data-close-modal attribute
        modal.querySelectorAll('[data-close-modal="true"]').forEach(btn => {
            btn.addEventListener('click', closeModal);
        });

        overlay.addEventListener('click', closeModal);

        // Close on Escape key
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
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

    /**
     * Attach tab handlers for standalone edit form (issue #837).
     */
    attachTabHandlersStandalone(modal, subordinateTables) {
        const tabs = modal.querySelectorAll('.edit-form-tab');
        const self = this;

        tabs.forEach(tab => {
            tab.addEventListener('click', async () => {
                const tabId = tab.dataset.tab;

                // Update active tab
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');

                // Update active content
                const contents = modal.querySelectorAll('.edit-form-tab-content');
                contents.forEach(c => c.classList.remove('active'));

                const targetContent = modal.querySelector(`[data-tab-content="${tabId}"]`);
                if (targetContent) {
                    targetContent.classList.add('active');
                }

                // Load subordinate table if needed
                const parentRecordId = modal.dataset.recordId;
                if (tabId.startsWith('sub-') && tab.dataset.arrId && parentRecordId) {
                    const arrId = tab.dataset.arrId;
                    const reqId = tab.dataset.reqId;

                    // Check if already loaded
                    if (!targetContent.dataset.loaded) {
                        await self.loadSubordinateTableStandalone(targetContent, arrId, parentRecordId, reqId);
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

    /**
     * Load subordinate table content (issue #837).
     */
    async loadSubordinateTableStandalone(container, arrId, parentRecordId, reqId) {
        container.innerHTML = '<div class="subordinate-table-loading">Загрузка...</div>';

        try {
            // Try to use an existing IntegramTable instance for rendering
            if (window._integramTableInstances && window._integramTableInstances.length > 0) {
                const tableInstance = window._integramTableInstances[0];
                if (tableInstance && typeof tableInstance.loadSubordinateTable === 'function') {
                    await tableInstance.loadSubordinateTable(container, arrId, parentRecordId, reqId);
                    return;
                }
            }

            // Fallback: fetch and render subordinate table data manually
            const metadata = await this.fetchMetadataStandalone(arrId);
            const dataUrl = `${this.apiBase}/object/${arrId}/?JSON_OBJ&F_U=${parentRecordId}`;
            const dataResponse = await fetch(dataUrl);
            const data = await dataResponse.json();

            this.renderSubordinateTableStandalone(container, metadata, data, arrId, parentRecordId);

        } catch (error) {
            console.error('Error loading subordinate table:', error);
            container.innerHTML = `<div class="subordinate-table-error">Ошибка загрузки: ${error.message}</div>`;
        }
    }

    /**
     * Fetch metadata for a table type (issue #837).
     * Uses globalMetadata from IntegramTable instances if available to avoid redundant requests (issue #1302).
     */
    async fetchMetadataStandalone(typeId) {
        if (this.metadataCache[typeId]) {
            return this.metadataCache[typeId];
        }

        // Check globalMetadata from existing IntegramTable instances (issue #1302)
        if (window._integramTableInstances && window._integramTableInstances.length > 0) {
            for (const inst of window._integramTableInstances) {
                if (inst && inst.globalMetadata) {
                    const cached = inst.globalMetadata.find(item => item.id === typeId || item.id === Number(typeId));
                    if (cached) {
                        this.metadataCache[typeId] = cached;
                        return cached;
                    }
                }
            }
        }

        // If a fetch for this typeId is already in progress, await it instead of starting a new one (issue #1455)
        if (this.metadataFetchPromises[typeId]) {
            return this.metadataFetchPromises[typeId];
        }

        const fetchPromise = (async () => {
            try {
                const response = await fetch(`${this.apiBase}/metadata/${typeId}`);
                if (!response.ok) {
                    throw new Error(`Failed to fetch metadata: ${response.statusText}`);
                }

                const metadata = await response.json();
                this.metadataCache[typeId] = metadata;
                return metadata;
            } finally {
                delete this.metadataFetchPromises[typeId];
            }
        })();
        this.metadataFetchPromises[typeId] = fetchPromise;
        return fetchPromise;
    }

    /**
     * Render subordinate table (simplified version for standalone use) (issue #837).
     * Uses the same CSS classes as the main renderSubordinateTable method.
     */
    renderSubordinateTableStandalone(container, metadata, data, arrId, parentRecordId) {
        const typeName = this.getMetadataName(metadata);
        const records = Array.isArray(data) ? data : [];
        const reqs = metadata.reqs || [];

        // Build table URL for subordinate table link
        const pathParts = window.location.pathname.split('/');
        const dbName = pathParts.length >= 2 ? pathParts[1] : '';
        const subordinateTableUrl = `/${dbName}/table/${arrId}?F_U=${parentRecordId}`;

        let html = `
            <div class="subordinate-table-toolbar">
                <button type="button" class="btn btn-sm btn-primary subordinate-add-btn" data-arr-id="${arrId}" data-parent-id="${parentRecordId}">
                    + Добавить
                </button>
                <button type="button" class="subordinate-copy-buffer-btn" title="Копировать в буфер"><i class="pi pi-clipboard"></i></button>
                <a href="${subordinateTableUrl}" class="subordinate-table-link" title="Открыть в таблице" target="_blank">
                    <i class="pi pi-table"></i>
                </a>
            </div>
        `;

        if (records.length === 0) {
            html += `<div class="subordinate-table-empty">Нет записей</div>`;
        } else {
            html += `<div class="subordinate-table-wrapper"><table class="subordinate-table"><thead><tr>`;

            // Header: main value column + requisite columns
            html += `<th>${this.escapeHtml(typeName)}</th>`;
            reqs.forEach(req => {
                if (!req.arr_id) {
                    const attrs = this.parseAttrs(req.attrs);
                    const fieldName = attrs.alias || req.val;
                    html += `<th>${this.escapeHtml(fieldName)}</th>`;
                }
            });
            html += `</tr></thead><tbody>`;

            // Data rows
            records.forEach(record => {
                const recordId = record.i;
                const values = record.r || [];
                html += `<tr data-row-id="${recordId}" style="cursor:pointer;">`;

                // Main value column (clickable)
                const mainValue = values[0] || '';
                html += `<td class="subordinate-cell-clickable" data-record-id="${recordId}" data-type-id="${arrId}">${this.escapeHtml(mainValue)}</td>`;

                // Requisite columns
                let valIdx = 1;
                reqs.forEach(req => {
                    if (!req.arr_id) {
                        const cellValue = values[valIdx] || '';
                        html += `<td>${this.escapeHtml(cellValue)}</td>`;
                        valIdx++;
                    }
                });

                html += `</tr>`;
            });

            html += `</tbody></table></div>`;
        }

        container.innerHTML = html;

        // Store data on container for copy-to-buffer (issue #1788)
        container._subordinateData = records;
        container._subordinateMetadata = metadata;

        // Attach handlers for add button
        const addBtn = container.querySelector('.subordinate-add-btn');
        if (addBtn) {
            addBtn.addEventListener('click', () => {
                if (typeof window.openCreateRecordForm === 'function') {
                    window.openCreateRecordForm(arrId, { parentId: parentRecordId });
                }
            });
        }

        // Attach copy-to-buffer button handler (issue #1788)
        const copyBufferBtn = container.querySelector('.subordinate-copy-buffer-btn');
        if (copyBufferBtn) {
            copyBufferBtn.addEventListener('click', () => {
                this.copySubordinateToBuffer(container);
            });
        }

        // Attach handlers for clickable cells (open edit form)
        container.querySelectorAll('.subordinate-cell-clickable').forEach(cell => {
            cell.addEventListener('click', (e) => {
                const recordId = cell.dataset.recordId;
                const typeId = cell.dataset.typeId;
                if (typeof window.openEditRecordForm === 'function') {
                    window.openEditRecordForm(recordId, typeId);
                }
            });
        });
    }

    /**
     * Copy subordinate table data to clipboard with TAB delimiters (issue #1788).
     * Uses the data stored on the container element.
     */
    async copySubordinateToBuffer(container) {
        const records = container._subordinateData;
        const metadata = container._subordinateMetadata;

        if (!records || !metadata || records.length === 0) {
            this.showToast('Нет данных для копирования', 'info');
            return;
        }

        const reqs = metadata.reqs || [];

        // Build TAB-delimited text (main column + non-nested req columns)
        const lines = records.map(record => {
            const values = record.r || [];
            const cells = [String(values[0] || '')];
            let valIdx = 1;
            reqs.forEach(req => {
                if (!req.arr_id) {
                    cells.push(String(values[valIdx] || ''));
                }
                valIdx++;
            });
            return cells.join('\t');
        });

        const text = lines.join('\n');

        try {
            await navigator.clipboard.writeText(text);
            this.showToast(`Скопировано ${ records.length } записей в буфер`, 'success');
        } catch (error) {
            console.error('Copy to buffer error:', error);
            this.showToast(`Ошибка копирования: ${ error.message }`, 'error');
        }
    }

    /**
     * Open form field settings modal (issue #837).
     */
    openFormFieldSettingsStandalone(typeId, metadata) {
        const overlay = document.createElement('div');
        overlay.className = 'form-field-settings-overlay';

        const modal = document.createElement('div');
        modal.className = 'form-field-settings-modal';

        const visibleFields = this.loadFormFieldVisibilityStandalone(typeId);
        const savedOrder = this.loadFormFieldOrderStandalone(typeId);

        // Sort requisites by saved order
        const reqs = metadata.reqs || [];
        const sortedReqs = [...reqs];
        if (savedOrder.length > 0) {
            sortedReqs.sort((a, b) => {
                const idxA = savedOrder.indexOf(String(a.id));
                const idxB = savedOrder.indexOf(String(b.id));
                if (idxA === -1 && idxB === -1) return 0;
                if (idxA === -1) return 1;
                if (idxB === -1) return -1;
                return idxA - idxB;
            });
        }

        let modalHtml = `
            <div class="form-field-settings-header">
                <h3>Настройка полей формы</h3>
                <button class="form-field-settings-close">&times;</button>
            </div>
            <div class="form-field-settings-body">
                <p class="form-field-settings-info">Перетаскивайте поля для изменения порядка, снимите галку для скрытия:</p>
                <div class="form-field-settings-list">
        `;

        sortedReqs.forEach(req => {
            if (req.arr_id) return; // Skip subordinate tables
            const attrs = this.parseAttrs(req.attrs);
            const fieldName = attrs.alias || req.val;
            const fieldId = req.id;
            const isChecked = visibleFields[fieldId] !== false;

            modalHtml += `
                <div class="form-field-settings-item" draggable="true" data-field-id="${fieldId}">
                    <label>
                        <span class="drag-handle">☰</span>
                        <input type="checkbox"
                               class="form-field-visibility-checkbox"
                               data-field-id="${fieldId}"
                               ${isChecked ? 'checked' : ''}>
                        <span>${this.escapeHtml(fieldName)}</span>
                    </label>
                </div>
            `;
        });

        modalHtml += `
                </div>
            </div>
            <div class="form-field-settings-footer">
                <button type="button" class="btn btn-primary form-field-settings-save">Сохранить</button>
                <button type="button" class="btn btn-secondary form-field-settings-cancel">Отменить</button>
            </div>
        `;

        modal.innerHTML = modalHtml;
        document.body.appendChild(overlay);
        document.body.appendChild(modal);

        // Drag-and-drop reordering
        const list = modal.querySelector('.form-field-settings-list');
        let dragItem = null;

        list.addEventListener('dragstart', (e) => {
            dragItem = e.target.closest('.form-field-settings-item');
            if (dragItem) dragItem.classList.add('dragging');
        });

        list.addEventListener('dragend', () => {
            if (dragItem) dragItem.classList.remove('dragging');
            list.querySelectorAll('.form-field-settings-item').forEach(el => el.classList.remove('drag-over'));
            dragItem = null;
        });

        list.addEventListener('dragover', (e) => {
            e.preventDefault();
            const target = e.target.closest('.form-field-settings-item');
            if (target && target !== dragItem) {
                list.querySelectorAll('.form-field-settings-item').forEach(el => el.classList.remove('drag-over'));
                target.classList.add('drag-over');
            }
        });

        list.addEventListener('drop', (e) => {
            e.preventDefault();
            const target = e.target.closest('.form-field-settings-item');
            if (target && target !== dragItem && dragItem) {
                list.insertBefore(dragItem, target);
            }
            list.querySelectorAll('.form-field-settings-item').forEach(el => el.classList.remove('drag-over'));
        });

        const closeBtn = modal.querySelector('.form-field-settings-close');
        const cancelBtn = modal.querySelector('.form-field-settings-cancel');
        const saveBtn = modal.querySelector('.form-field-settings-save');

        const closeModal = () => {
            modal.remove();
            overlay.remove();
        };

        closeBtn.addEventListener('click', closeModal);
        cancelBtn.addEventListener('click', closeModal);
        overlay.addEventListener('click', closeModal);

        // Close on Escape key
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                closeModal();
                document.removeEventListener('keydown', handleEscape);
            }
        };
        document.addEventListener('keydown', handleEscape);

        saveBtn.addEventListener('click', () => {
            // Save visibility
            const checkboxes = modal.querySelectorAll('.form-field-visibility-checkbox');
            const visibility = {};
            checkboxes.forEach(checkbox => {
                const fieldId = checkbox.dataset.fieldId;
                visibility[fieldId] = checkbox.checked;
            });
            this.saveFormFieldVisibilityStandalone(typeId, visibility);

            // Save field order
            const items = modal.querySelectorAll('.form-field-settings-item');
            const order = Array.from(items).map(item => item.dataset.fieldId);
            this.saveFormFieldOrderStandalone(typeId, order);

            closeModal();

            // Apply settings to the edit form if it's open
            const editFormModal = document.querySelector('.edit-form-modal');
            if (editFormModal) {
                this.applyFormFieldSettingsStandalone(editFormModal, typeId);
            }
        });
    }

    /**
     * Save form field visibility settings (issue #837).
     */
    saveFormFieldVisibilityStandalone(typeId, visibility) {
        const cookieName = `integram-table-form-fields-${typeId}`;
        document.cookie = `${cookieName}=${JSON.stringify(visibility)}; path=/; max-age=31536000`;
    }

    /**
     * Load form field visibility settings (issue #837).
     */
    loadFormFieldVisibilityStandalone(typeId) {
        const cookieName = `integram-table-form-fields-${typeId}`;
        const cookies = document.cookie.split(';');
        const fieldsCookie = cookies.find(c => c.trim().startsWith(`${cookieName}=`));

        if (fieldsCookie) {
            try {
                return JSON.parse(fieldsCookie.split('=')[1]);
            } catch (error) {
                console.error('Error parsing form field visibility settings:', error);
                return {};
            }
        }

        return {};
    }

    /**
     * Save form field order settings (issue #837).
     */
    saveFormFieldOrderStandalone(typeId, order) {
        const cookieName = `integram-table-form-order-${typeId}`;
        document.cookie = `${cookieName}=${JSON.stringify(order)}; path=/; max-age=31536000`;
    }

    /**
     * Load form field order settings (issue #837).
     */
    loadFormFieldOrderStandalone(typeId) {
        const cookieName = `integram-table-form-order-${typeId}`;
        const cookies = document.cookie.split(';');
        const cookie = cookies.find(c => c.trim().startsWith(`${cookieName}=`));
        if (cookie) {
            try {
                return JSON.parse(cookie.split('=')[1]);
            } catch (e) {
                return [];
            }
        }
        return [];
    }

    /**
     * Apply form field settings (visibility and order) (issue #837).
     */
    applyFormFieldSettingsStandalone(modal, typeId) {
        const visibility = this.loadFormFieldVisibilityStandalone(typeId);
        const order = this.loadFormFieldOrderStandalone(typeId);

        // Apply visibility
        Object.entries(visibility).forEach(([fieldId, isVisible]) => {
            if (!isVisible) {
                const formGroup = modal.querySelector(`#field-${fieldId}`)?.closest('.form-group');
                if (formGroup) {
                    formGroup.style.display = 'none';
                }
            } else {
                const formGroup = modal.querySelector(`#field-${fieldId}`)?.closest('.form-group');
                if (formGroup) {
                    formGroup.style.display = '';
                }
            }
        });

        // Apply field order by reordering form-group elements
        if (order.length > 0) {
            const form = modal.querySelector('#edit-form');
            if (form) {
                const formGroups = Array.from(form.querySelectorAll('.form-group'));

                // Build a map of fieldId -> form-group element
                const groupMap = {};
                formGroups.forEach(group => {
                    const input = group.querySelector('[id^="field-"]');
                    if (input) {
                        const match = input.id.match(/^field-(.+?)(-search|-picker)?$/);
                        if (match) {
                            groupMap[match[1]] = group;
                        }
                    }
                });

                // Reorder based on saved order
                order.forEach(fieldId => {
                    const group = groupMap[fieldId];
                    if (group && group.parentNode) {
                        group.parentNode.appendChild(group);
                    }
                });
            }
        }
    }

    /**
     * Render attributes form for editing (similar to renderAttributesForm but pre-fills existing values)
     */
    renderAttributesFormForEdit(metadata, recordData, regularFields, recordReqs) {
        let html = '';

        // Main value field
        const typeName = this.getMetadataName(metadata);
        const mainValue = recordData && recordData.obj ? recordData.obj.val || '' : '';
        const mainTermValue = recordData && recordData.obj && recordData.obj.term !== undefined ? recordData.obj.term : '';
        const mainFieldType = this.normalizeFormat(metadata.type);

        // Build main field HTML based on its type
        let mainFieldHtml = '';
        if (mainFieldType === 'BOOLEAN') {
            const isChecked = mainValue ? 'checked' : '';
            mainFieldHtml = `<input type="checkbox" id="field-main" name="main" value="1" ${isChecked}>`;
        } else if (mainFieldType === 'DATE') {
            const dateValueHtml5 = mainValue ? this.formatDateForHtml5(mainValue, false) : '';
            mainFieldHtml = `<input type="date" class="form-control date-picker" id="field-main-picker" data-target="field-main" value="${this.escapeHtml(dateValueHtml5)}">`;
            mainFieldHtml += `<input type="hidden" id="field-main" name="main" value="${this.escapeHtml(mainValue)}">`;
        } else if (mainFieldType === 'DATETIME') {
            const dateTimeValueHtml5 = mainValue ? this.formatDateForHtml5(mainValue, true) : '';
            mainFieldHtml = `<input type="datetime-local" class="form-control datetime-picker" id="field-main-picker" data-target="field-main" value="${this.escapeHtml(dateTimeValueHtml5)}">`;
            mainFieldHtml += `<input type="hidden" id="field-main" name="main" value="${this.escapeHtml(mainValue)}">`;
        } else if (mainFieldType === 'MEMO' || mainFieldType === 'HTML') {
            mainFieldHtml = `<textarea class="form-control" id="field-main" name="main" rows="4">${this.escapeHtml(mainValue)}</textarea>`;
        } else if (mainFieldType === 'GRANT') {
            mainFieldHtml = `<select class="form-control grant-dropdown" id="field-main" name="main" data-current-value="${this.escapeHtml(mainTermValue)}">
                <option value="">Загрузка...</option>
            </select>`;
        } else if (mainFieldType === 'REPORT_COLUMN') {
            mainFieldHtml = `<select class="form-control report-column-dropdown" id="field-main" name="main" data-current-value="${this.escapeHtml(mainTermValue)}">
                <option value="">Загрузка...</option>
            </select>`;
        } else {
            mainFieldHtml = `<input type="text" class="form-control" id="field-main" name="main" value="${this.escapeHtml(mainValue)}">`;
        }

        html += `
            <div class="form-field">
                <label for="field-main">${this.escapeHtml(typeName)}</label>
                ${mainFieldHtml}
            </div>
        `;

        // Render regular fields (requisites)
        for (const req of regularFields) {
            const fieldId = req.id;
            const attrs = this.parseAttrs(req.attrs);
            const fieldName = attrs.alias || req.val;
            const isRequired = attrs.required;
            const isMulti = attrs.multi;
            const fieldType = this.normalizeFormat(req.type);
            const reqData = recordReqs[fieldId] || {};
            const fieldValue = reqData.value !== undefined ? reqData.value : (reqData.val || '');
            const fieldTermValue = reqData.term !== undefined ? reqData.term : '';

            let fieldHtml = '';

            if (req.ref_id && isMulti) {
                // Multi-select reference field (issue #1136)
                const currentValue = fieldValue || '';
                fieldHtml = `
                    <div class="form-reference-editor form-multi-reference-editor" data-ref-id="${fieldId}" data-required="${isRequired}" data-ref-type-id="${req.orig || req.ref_id}" data-multi="1" data-current-value="${this.escapeHtml(currentValue)}">
                        <div class="inline-editor-reference form-ref-editor-box inline-editor-multi-reference">
                            <div class="multi-ref-tags-container form-multi-ref-tags-container">
                                <span class="multi-ref-tags-placeholder">Загрузка...</span>
                            </div>
                            <div class="inline-editor-reference-header">
                                <input type="text"
                                       class="inline-editor-reference-search form-ref-search"
                                       id="field-${fieldId}-search"
                                       placeholder="Добавить..."
                                       autocomplete="off">
                                <button class="inline-editor-reference-add form-ref-add" style="display: none;" title="Создать запись" aria-label="Создать запись" type="button"><i class="pi pi-plus"></i></button>
                            </div>
                            <div class="inline-editor-reference-dropdown form-ref-dropdown" id="field-${fieldId}-dropdown" style="display:none;">
                                <div class="inline-editor-reference-empty">Загрузка...</div>
                            </div>
                        </div>
                        <input type="hidden"
                               class="form-ref-value form-multi-ref-value"
                               id="field-${fieldId}"
                               name="t${fieldId}"
                               value=""
                               data-ref-id="${fieldId}">
                    </div>
                `;
            } else if (req.ref_id) {
                // Single-select reference field (searchable dropdown) (issue #1136)
                const currentValue = fieldValue || '';
                fieldHtml = `
                    <div class="form-reference-editor" data-ref-id="${fieldId}" data-required="${isRequired}" data-ref-type-id="${req.orig || req.ref_id}">
                        <div class="inline-editor-reference form-ref-editor-box">
                            <div class="inline-editor-reference-header">
                                <input type="text"
                                       class="inline-editor-reference-search form-ref-search"
                                       id="field-${fieldId}-search"
                                       placeholder="Поиск..."
                                       autocomplete="off">
                                <button class="inline-editor-reference-clear form-ref-clear" title="Очистить значение" aria-label="Очистить значение" type="button"><i class="pi pi-times"></i></button>
                            </div>
                            <div class="inline-editor-reference-dropdown form-ref-dropdown" id="field-${fieldId}-dropdown">
                                <div class="inline-editor-reference-empty">Загрузка...</div>
                            </div>
                        </div>
                        <input type="hidden"
                               class="form-ref-value"
                               id="field-${fieldId}"
                               name="t${fieldId}"
                               value="${this.escapeHtml(currentValue)}"
                               data-ref-id="${fieldId}">
                    </div>
                `;
            } else if (fieldType === 'BOOLEAN') {
                const isChecked = fieldValue ? 'checked' : '';
                fieldHtml = `<input type="checkbox" id="field-${fieldId}" name="t${fieldId}" value="1" ${isChecked}>`;
            } else if (fieldType === 'DATE') {
                const dateValueHtml5 = fieldValue ? this.formatDateForHtml5(fieldValue, false) : '';
                fieldHtml = `<input type="date" class="form-control date-picker" id="field-${fieldId}-picker"
                    data-target="field-${fieldId}" value="${this.escapeHtml(dateValueHtml5)}">`;
                fieldHtml += `<input type="hidden" id="field-${fieldId}" name="t${fieldId}" value="${this.escapeHtml(fieldValue)}">`;
            } else if (fieldType === 'DATETIME') {
                const dateTimeValueHtml5 = fieldValue ? this.formatDateForHtml5(fieldValue, true) : '';
                fieldHtml = `<input type="datetime-local" class="form-control datetime-picker" id="field-${fieldId}-picker"
                    data-target="field-${fieldId}" value="${this.escapeHtml(dateTimeValueHtml5)}">`;
                fieldHtml += `<input type="hidden" id="field-${fieldId}" name="t${fieldId}" value="${this.escapeHtml(fieldValue)}">`;
            } else if (fieldType === 'MEMO' || fieldType === 'HTML') {
                fieldHtml = `<textarea class="form-control" id="field-${fieldId}" name="t${fieldId}" rows="3"
                    ${isRequired ? 'required' : ''}>${this.escapeHtml(fieldValue)}</textarea>`;
            } else if (fieldType === 'FILE') {
                // Parse file link from HTML if present (issue #1372)
                let fileHref = '';
                let fileDisplayName = '';
                let hasFile = false;

                if (fieldValue && fieldValue !== '') {
                    const linkMatch = fieldValue.match(/<a[^>]*href=["']([^"']+)["'][^>]*>([^<]+)<\/a>/i);
                    if (linkMatch) {
                        fileHref = linkMatch[1];
                        fileDisplayName = linkMatch[2];
                        hasFile = true;
                    } else {
                        fileHref = fieldValue;
                        fileDisplayName = fieldValue.split('/').pop() || fieldValue;
                        hasFile = true;
                    }
                }

                fieldHtml = `
                    <div class="form-file-upload" data-req-id="${fieldId}" data-original-value="${this.escapeHtml(fieldValue)}">
                        <input type="file" class="file-input" id="field-${fieldId}-file" style="display: none;">
                        <div class="file-dropzone" style="${hasFile ? 'display: none;' : ''}">
                            <span class="file-dropzone-text">Перетащите файл или нажмите для выбора</span>
                            <button type="button" class="file-select-btn">Выбрать файл</button>
                        </div>
                        <div class="file-preview" style="${hasFile ? 'display: flex;' : 'display: none;'}">
                            ${fileHref ? `<a href="${this.escapeHtml(fileHref)}" target="_blank" class="file-name file-link">${this.escapeHtml(fileDisplayName)}</a>` : `<span class="file-name">${this.escapeHtml(fileDisplayName)}</span>`}
                            <button type="button" class="file-remove-btn" title="Удалить файл"><i class="pi pi-times"></i></button>
                        </div>
                        <input type="hidden" id="field-${fieldId}" name="t${fieldId}" value="${this.escapeHtml(fieldValue)}" ${isRequired ? 'required' : ''} data-file-deleted="false">
                    </div>
                `;
            } else if (fieldType === 'NUMBER' || fieldType === 'SIGNED') {
                fieldHtml = `<input type="number" class="form-control" id="field-${fieldId}" name="t${fieldId}"
                    value="${this.escapeHtml(fieldValue)}" ${isRequired ? 'required' : ''}
                    ${fieldType === 'SIGNED' ? 'step="0.01"' : ''}>`;
            } else if (fieldType === 'GRANT') {
                fieldHtml = `<select class="form-control grant-dropdown" id="field-${fieldId}" name="t${fieldId}"
                    data-current-value="${this.escapeHtml(fieldTermValue)}">
                    <option value="">Загрузка...</option>
                </select>`;
            } else if (fieldType === 'REPORT_COLUMN') {
                fieldHtml = `<select class="form-control report-column-dropdown" id="field-${fieldId}" name="t${fieldId}"
                    data-current-value="${this.escapeHtml(fieldTermValue)}">
                    <option value="">Загрузка...</option>
                </select>`;
            } else {
                fieldHtml = `<input type="text" class="form-control" id="field-${fieldId}" name="t${fieldId}"
                    value="${this.escapeHtml(fieldValue)}" ${isRequired ? 'required' : ''}>`;
            }

            const requiredMark = isRequired ? '<span style="color:red;">*</span>' : '';

            html += `
                <div class="form-field">
                    <label for="field-${fieldId}">${this.escapeHtml(fieldName)} ${requiredMark}</label>
                    ${fieldHtml}
                </div>
            `;
        }

        return html;
    }

    /**
     * Save an edited record (similar to saveRecord but for updates)
     */
    async saveEditedRecord(modal, metadata, recordId) {
        try {
            const form = modal.querySelector('#edit-form');
            const formData = new FormData(form);

            let requestBody;
            const headers = {};

            // Check for new file uploads via _fileToUpload pattern (issue #1372)
            const fileUploads = modal.querySelectorAll('.form-file-upload');
            let hasNewFiles = false;
            for (const uploadContainer of fileUploads) {
                if (uploadContainer._fileToUpload) {
                    hasNewFiles = true;
                    break;
                }
            }

            if (hasNewFiles) {
                const multipartBody = new FormData();

                // Add XSRF token for file uploads (issue #839)
                if (typeof xsrf !== 'undefined') {
                    multipartBody.append('_xsrf', xsrf);
                }

                // Get main value
                const mainValue = formData.get('main');
                if (mainValue !== '' && mainValue !== null && mainValue !== undefined) {
                    multipartBody.append(`t${this.tableTypeId}`, mainValue);
                }

                // Add all form fields, substituting file uploads where needed
                for (const [key, value] of formData.entries()) {
                    if (key === 'main') continue;

                    const fieldMatch = key.match(/^t(\d+)$/);
                    if (fieldMatch) {
                        const reqId = fieldMatch[1];
                        const uploadContainer = modal.querySelector(`.form-file-upload[data-req-id="${reqId}"]`);
                        if (uploadContainer && uploadContainer._fileToUpload) {
                            multipartBody.append(key, uploadContainer._fileToUpload);
                            continue;
                        }
                    }

                    if (value !== '' && value !== null && value !== undefined) {
                        multipartBody.append(key, value);
                    }
                }

                // Handle checkbox fields explicitly (not included in formData when unchecked)
                form.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
                    if (checkbox.name) {
                        multipartBody.set(checkbox.name, checkbox.checked ? '1' : '0');
                    }
                });

                requestBody = multipartBody;
            } else {
                const params = new URLSearchParams();

                // Add XSRF token (issue #839)
                if (typeof xsrf !== 'undefined') {
                    params.append('_xsrf', xsrf);
                }

                // Handle checkbox fields
                form.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
                    if (checkbox.name) {
                        params.append(checkbox.name, checkbox.checked ? '1' : '0');
                    }
                });

                // Get main value
                const mainValue = formData.get('main');

                // Add all form fields
                for (const [key, value] of formData.entries()) {
                    if (key === 'main') continue;
                    if (value !== '' && value !== null && value !== undefined) {
                        params.append(key, value);
                    }
                }

                if (mainValue !== '' && mainValue !== null && mainValue !== undefined) {
                    params.append(`t${this.tableTypeId}`, mainValue);
                }

                requestBody = params.toString();
                headers['Content-Type'] = 'application/x-www-form-urlencoded';
            }

            // Update the record using _m_save (issue #839)
            const url = `${this.apiBase}/_m_save/${recordId}?JSON`;

            const response = await fetch(url, {
                method: 'POST',
                headers: headers,
                body: requestBody
            });

            const text = await response.text();
            let result;

            try {
                result = JSON.parse(text);
            } catch (e) {
                throw new Error(`Invalid response: ${text}`);
            }

            const serverError = this.getServerError(result);
            if (serverError) {
                throw new Error(serverError);
            }

            // Success - close modal
            this.showToast('Изменения сохранены', 'success');

            // Close modal
            modal._overlayElement?.remove();
            modal.remove();
            window._integramModalDepth = Math.max(0, (window._integramModalDepth || 1) - 1);

            // Reload any IntegramTable instances on the page
            if (typeof reloadAllIntegramTables === 'function') {
                reloadAllIntegramTables();
            }

            // Also reload CardsView instances
            if (window.myCardsView && typeof window.myCardsView._loadData === 'function') {
                window.myCardsView._loadData(false);
            }

        } catch (error) {
            console.error('Error saving record:', error);
            this.showToast(`Ошибка: ${error.message}`, 'error');
        }
    }
}

/**
 * Open an edit form modal for an existing record (issue #831).
 * Global function similar to openCreateRecordForm that works without an IntegramTable instance.
 *
 * @param {number|string} recordId - The ID of the record to edit
 * @param {number|string} typeId - The table type ID
 * @example
 * // Open edit form for record 12345 of type 3596
 * openEditRecordForm(12345, 3596);
 */
async function openEditRecordForm(recordId, typeId) {
    if (!recordId) {
        console.error('openEditRecordForm: recordId is required');
        return;
    }
    if (!typeId) {
        console.error('openEditRecordForm: typeId is required');
        return;
    }

    try {
        // Determine API base from current page URL
        const pathParts = window.location.pathname.split('/');
        let apiBase = '';
        if (pathParts.length >= 2 && pathParts[1]) {
            apiBase = window.location.origin + '/' + pathParts[1];
        }

        if (!apiBase) {
            console.error('openEditRecordForm: Could not determine API base URL');
            return;
        }

        // Fetch metadata for the table type
        let metadata = null;
        if (window._integramTableInstances && window._integramTableInstances.length > 0) {
            for (const inst of window._integramTableInstances) {
                if (inst && inst.globalMetadata) {
                    const cached = inst.globalMetadata.find(item => item.id === typeId || item.id === Number(typeId));
                    if (cached) {
                        metadata = cached;
                        break;
                    }
                }
            }
        }

        if (!metadata) {
            const metadataUrl = `${apiBase}/metadata/${typeId}`;
            const metadataResponse = await fetch(metadataUrl);

            if (!metadataResponse.ok) {
                throw new Error(`Failed to fetch metadata: ${metadataResponse.statusText}`);
            }

            metadata = await metadataResponse.json();
        }

        // Fetch existing record data using object/{typeId}/?JSON_OBJ
        const recordUrl = `${apiBase}/object/${typeId}/?JSON_OBJ&FR_${typeId}=@${recordId}`;
        const recordResponse = await fetch(recordUrl);

        if (!recordResponse.ok) {
            throw new Error(`Failed to fetch record data: ${recordResponse.statusText}`);
        }

        const dataArray = await recordResponse.json();

        if (!Array.isArray(dataArray) || dataArray.length === 0) {
            throw new Error(`Record ${recordId} not found`);
        }

        // Convert JSON_OBJ {i, u, o, r} to {obj, reqs} expected by renderEditFormModalStandalone
        const helper = new IntegramCreateFormHelper(apiBase, typeId, 1);
        const item = dataArray[0];
        const rowValues = item.r || [];

        const reqs = metadata.reqs || [];
        const recordReqs = {};
        reqs.forEach((req, idx) => {
            const rawValue = rowValues[idx + 1] !== undefined ? rowValues[idx + 1] : '';
            const reqFormat = helper.normalizeFormat(req.type);
            let reqValue = rawValue;
            let reqTerm = undefined;
            if ((reqFormat === 'GRANT' || reqFormat === 'REPORT_COLUMN') && typeof rawValue === 'string') {
                const colonIdx = rawValue.indexOf(':');
                if (colonIdx > 0) {
                    reqTerm = rawValue.substring(0, colonIdx);
                    reqValue = rawValue.substring(colonIdx + 1);
                }
            }
            recordReqs[req.id] = { value: reqValue, base: req.type, order: idx };
            if (reqTerm !== undefined) {
                recordReqs[req.id].term = reqTerm;
            }
            if (req.arr_id) {
                recordReqs[req.id].arr = typeof rawValue === 'number' ? rawValue : (parseInt(rawValue, 10) || 0);
            }
        });

        const mainFormat = helper.normalizeFormat(metadata.type);
        let mainVal = rowValues[0] !== undefined ? rowValues[0] : '';
        let mainTerm = undefined;
        if ((mainFormat === 'GRANT' || mainFormat === 'REPORT_COLUMN') && typeof mainVal === 'string') {
            const colonIdx = mainVal.indexOf(':');
            if (colonIdx > 0) {
                mainTerm = mainVal.substring(0, colonIdx);
                mainVal = mainVal.substring(colonIdx + 1);
            }
        }

        const recordData = {
            obj: { id: item.i, val: mainVal, parent: item.u || 1 },
            reqs: recordReqs
        };
        if (mainTerm !== undefined) {
            recordData.obj.term = mainTerm;
        }

        helper.parentId = recordData.obj.parent;
        helper.renderEditFormModalStandalone(metadata, recordData, typeId, recordId);

    } catch (error) {
        console.error('openEditRecordForm: Error opening form:', error);
        // Show error toast if available
        if (typeof window.showToast === 'function') {
            window.showToast(`Ошибка: ${error.message}`, 'error');
        } else {
            console.error(`Ошибка: ${error.message}`);
        }
    }
}

// Make openCreateRecordForm globally accessible
if (typeof window !== 'undefined') {
    window.openCreateRecordForm = openCreateRecordForm;
    window.openEditRecordForm = openEditRecordForm;
    window.IntegramCreateFormHelper = IntegramCreateFormHelper;
}

// Auto-initialize tables from data attributes
function autoInitTables() {
    const tables = document.querySelectorAll('[data-integram-table]');
    tables.forEach(element => {
        const options = {
            apiUrl: element.dataset.apiUrl || '',
            pageSize: parseInt(element.dataset.pageSize) || 20,
            cookiePrefix: element.dataset.cookiePrefix || 'integram-table',
            title: element.dataset.title || '',
            instanceName: element.dataset.instanceName || element.id,
            dataSource: element.dataset.dataSource || 'report',
            tableTypeId: element.dataset.tableTypeId || null,
            parentId: element.dataset.parentId || null
        };

        // Create instance and store in window if instanceName is provided
        const instance = new IntegramTable(element.id, options);
        if (options.instanceName) {
            window[options.instanceName] = instance;
        }

        // Register instance in global registry
        if (typeof window !== 'undefined' && window._integramTableInstances) {
            window._integramTableInstances.push(instance);
        }
    });
}

// Auto-initialize on DOM ready
if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', autoInitTables);
    } else {
        autoInitTables();
    }
}

// Export for use in modules or directly in browser
if (typeof module !== 'undefined' && module.exports) {
    module.exports = IntegramTable;
}
