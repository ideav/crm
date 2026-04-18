        getColTypeIcon(col) {
            const isRef = col.ref_id != null || (col.ref && col.ref !== 0);
            const isTable = !!col.arr_id;
            if (isTable) {
                return `<span class="col-type-icon" title="Табличный реквизит"><svg width="13" height="13" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="1" width="14" height="14" rx="1" stroke="currentColor" stroke-width="1.5"/><line x1="1" y1="5" x2="15" y2="5" stroke="currentColor" stroke-width="1.5"/><line x1="1" y1="9" x2="15" y2="9" stroke="currentColor" stroke-width="1.5"/><line x1="5" y1="5" x2="5" y2="15" stroke="currentColor" stroke-width="1.5"/></svg></span>`;
            }
            if (isRef) {
                return `<span class="col-type-icon" title="Ссылочный реквизит (справочник)"><svg width="13" height="13" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6.5 3.5H3a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M9.5 2H14v4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><line x1="14" y1="2" x2="7" y2="9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></span>`;
            }
            const format = col.format || this.mapTypeIdToFormat(col.type || '3');
            const typeIconMap = {
                'SHORT':    { icon: 'Aa', title: 'Короткая строка (до 127 символов)' },
                'CHARS':    { icon: 'Aa', title: 'Строка без ограничения длины' },
                'MEMO':     { icon: '¶',  title: 'Многострочный текст' },
                'DATE':     { icon: '📅', title: 'Дата' },
                'DATETIME': { icon: '📅', title: 'Дата и время' },
                'NUMBER':   { icon: '#',  title: 'Целое число' },
                'SIGNED':   { icon: '#',  title: 'Число с десятичной частью' },
                'BOOLEAN':  { icon: '✓',  title: 'Логическое значение (Да / Нет)' },
                'FILE':     { icon: '📎', title: 'Файл' },
                'HTML':     { icon: '<>', title: 'HTML' },
                'PWD':      { icon: '🔒', title: 'Пароль' },
                'GRANT':    { icon: '▾',  title: 'Список значений' },
                'REPORT_COLUMN': { icon: '▾', title: 'Колонка отчёта' },
            };
            const info = typeIconMap[format] || { icon: '?', title: format };
            return `<span class="col-type-icon" title="${info.title}" style="font-size: 0.6875rem;font-weight:600;opacity:0.65;min-width:16px;text-align:center;">${info.icon}</span>`;
        }

        /**
         * Directly open the add column form without going through column settings (issue #1230)
         */
        quickAddColumn() {
            this.showAddColumnForm(null);
        }

        openColumnSettings() {
            this._columnSettingsChanged = false;
            const overlay = document.createElement('div');
            overlay.className = 'column-settings-overlay';

            const modal = document.createElement('div');
            modal.className = 'column-settings-modal';
            const instanceName = this.options.instanceName;

            // Build column list in columnOrder sequence so the DOM reflects the current order (issue #962)
            const orderedSettingsCols = this.columnOrder
                .map(id => this.columns.find(c => c.id === id))
                .filter(c => !!c);
            const firstColId = this.columnOrder[0];

            modal.innerHTML = `
                <div class="column-settings-header">
                    <h3>Настройки колонок таблицы</h3>
                    <button class="btn-col-settings-help" title="Помощь" aria-label="Помощь">?</button>
                </div>
                <div class="column-settings-list" id="column-settings-list-${instanceName}">
                    ${ orderedSettingsCols.map((col, idx) => {
                        const isFirst = col.id === firstColId;
                        const parsedAttrs = this.parseAttrs(col.attrs);
                        const isMulti = parsedAttrs.multi;
                        const isRequired = parsedAttrs.required;
                        const alias = parsedAttrs.alias;
                        const originalName = col.val || col.name;
                        const displayName = alias
                            ? `${ this.escapeHtml(alias) } <span class="col-original-name">(${this.escapeHtml(originalName)})</span>`
                            : this.escapeHtml(col.name);
                        // First column: not draggable, no drag handle, shows lock icon (issue #962)
                        // Other columns: draggable, show 1-based position number among requisites (issue #962)
                        const draggableAttr = isFirst ? 'draggable="false"' : 'draggable="true"';
                        const handleOrLock = isFirst
                            ? `<span class="col-settings-drag-handle col-settings-fixed" title="Первая колонка зафиксирована">&#128274;</span>`
                            : `<span class="col-settings-drag-handle" title="Перетащите для изменения порядка">&#9776;</span><span class="col-settings-order-num">${ idx }</span>`;
                        return `
                        <div class="column-settings-item ${ isFirst ? 'column-settings-item--fixed' : '' }" ${ draggableAttr } data-column-id="${ col.id }">
                            ${ handleOrLock }
                            ${ this.getColTypeIcon(col) }
                            <label style="flex: 1; margin: 0;">
                                <input type="checkbox"
                                       data-column-id="${ col.id }"
                                       ${ this.visibleColumns.includes(col.id) ? 'checked' : '' }>
                                ${ displayName }
                                ${ isRequired ? '<span class="col-required-badge" title="Обязательно к заполнению">*</span>' : '' }
                                ${ isMulti ? '<span class="col-multi-badge" title="Выбор нескольких значений">&#9641;</span>' : '' }
                            </label>
                            <button class="btn-col-edit" data-col-id="${ col.id }" title="Редактировать колонку">
                                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12.146 0.146009C12.2408 0.0522494 12.3679 0 12.5005 0C12.6331 0 12.7602 0.0522494 12.854 0.146009L15.854 3.14601C15.9006 3.19245 15.9375 3.24763 15.9627 3.30838C15.9879 3.36912 16.0009 3.43424 16.0009 3.50001C16.0009 3.56578 15.9879 3.6309 15.9627 3.69164C15.9375 3.75239 15.9006 3.80756 15.854 3.85401L5.85399 13.854C5.806 13.9017 5.74885 13.9391 5.68599 13.964L0.685989 15.964C0.595125 16.0004 0.495585 16.0093 0.399709 15.9896C0.303832 15.9699 0.215836 15.9226 0.14663 15.8534C0.0774234 15.7842 0.0300499 15.6962 0.0103825 15.6003C-0.00928499 15.5044 -0.000381488 15.4049 0.0359892 15.314L2.03599 10.314C2.06092 10.2511 2.09834 10.194 2.14599 10.146L12.146 0.146009ZM11.207 2.50001L13.5 4.79301L14.793 3.50001L12.5 1.20701L11.207 2.50001ZM12.793 5.50001L10.5 3.20701L3.99999 9.70701V10H4.49999C4.6326 10 4.75977 10.0527 4.85354 10.1465C4.94731 10.2402 4.99999 10.3674 4.99999 10.5V11H5.49999C5.6326 11 5.75977 11.0527 5.85354 11.1465C5.94731 11.2402 5.99999 11.3674 5.99999 11.5V12H6.29299L12.793 5.50001ZM3.03199 10.675L2.92599 10.781L1.39799 14.602L5.21899 13.074L5.32499 12.968C5.22961 12.9324 5.14738 12.8685 5.0893 12.7848C5.03123 12.7012 5.00007 12.6018 4.99999 12.5V12H4.49999C4.36738 12 4.2402 11.9473 4.14644 11.8536C4.05267 11.7598 3.99999 11.6326 3.99999 11.5V11H3.49999C3.39817 10.9999 3.2988 10.9688 3.21517 10.9107C3.13153 10.8526 3.06763 10.7704 3.03199 10.675Z" fill="currentColor"/></svg>
                            </button>
                        </div>`;
                    }).join('') }
                </div>
                <div style="display: flex; justify-content: flex-end; align-items: center; margin-top: 15px; gap: 10px;">
                    <button class="btn btn-primary" id="add-column-btn-${instanceName}">Добавить колонку</button>
                    <button class="btn btn-secondary" onclick="window.${ instanceName }.closeColumnSettings()">Закрыть</button>
                </div>
            `;

            document.body.appendChild(overlay);
            document.body.appendChild(modal);

            // Hide structure-modifying elements when user does not have structure write access (issue #1636)
            if (!this.isStructureWritable()) {
                modal.querySelectorAll('.col-settings-drag-handle').forEach(el => { el.style.display = 'none'; });
                modal.querySelectorAll('.btn-col-edit').forEach(el => { el.style.display = 'none'; });
                const helpBtnNoAccess = modal.querySelector('.btn-col-settings-help');
                if (helpBtnNoAccess) helpBtnNoAccess.style.display = 'none';
                const addColBtnNoAccess = modal.querySelector(`#add-column-btn-${instanceName}`);
                if (addColBtnNoAccess) addColBtnNoAccess.style.display = 'none';
                modal.querySelectorAll('.column-settings-item').forEach(item => { item.setAttribute('draggable', 'false'); });
            }

            // Attach help button handler (issue #968)
            const helpBtn = modal.querySelector('.btn-col-settings-help');
            if (helpBtn) {
                helpBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.showToast('Здесь вы можете определить как колонки будут храниться в базе данных. Первая колонка всегда фиксирована, а остальным можно задать порядок. Вы можете настроить представление в таблицах по-своему, перетаскивая колонки таблицы, а при сбросе тех настроек - таблицы будут возвращаться к виду, который настроен здесь.', 'info');
                });
            }

            // Attach add column button handler
            const addColumnBtn = modal.querySelector(`#add-column-btn-${instanceName}`);
            if (addColumnBtn) {
                addColumnBtn.addEventListener('click', () => this.showAddColumnForm(modal));
            }

            modal.querySelectorAll('input[type="checkbox"]').forEach(cb => {
                cb.addEventListener('change', (e) => {
                    const colId = cb.dataset.columnId;
                    if (cb.checked) {
                        if (!this.visibleColumns.includes(colId)) {
                            this.visibleColumns.push(colId);
                        }
                    } else {
                        this.visibleColumns = this.visibleColumns.filter(id => id !== colId);
                    }
                    this._columnSettingsChanged = true;
                    this.saveColumnState();
                    this.render();
                });
            });

            // Attach edit button handlers (issue #937)
            modal.querySelectorAll('.btn-col-edit').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const colId = btn.dataset.colId;
                    const col = this.columns.find(c => c.id === colId);
                    if (col) {
                        this.showColumnEditForm(col);
                    }
                });
            });

            overlay.addEventListener('click', () => this.closeColumnSettings());

            // Drag-and-drop reordering of columns in the settings list (issue #953)
            const columnList = modal.querySelector(`#column-settings-list-${instanceName}`);
            let dragItem = null;

            columnList.addEventListener('dragstart', (e) => {
                const item = e.target.closest('.column-settings-item');
                // Prevent dragging the first (fixed) column (issue #962)
                if (item && item.dataset.columnId === firstColId) {
                    e.preventDefault();
                    return;
                }
                dragItem = item;
                if (dragItem) dragItem.classList.add('dragging');
            });

            columnList.addEventListener('dragend', () => {
                if (dragItem) dragItem.classList.remove('dragging');
                columnList.querySelectorAll('.column-settings-item').forEach(el => el.classList.remove('drag-over'));
                dragItem = null;
            });

            columnList.addEventListener('dragover', (e) => {
                e.preventDefault();
                const target = e.target.closest('.column-settings-item');
                if (target && target !== dragItem) {
                    columnList.querySelectorAll('.column-settings-item').forEach(el => el.classList.remove('drag-over'));
                    target.classList.add('drag-over');
                }
            });

            columnList.addEventListener('drop', (e) => {
                e.preventDefault();
                const target = e.target.closest('.column-settings-item');
                if (target && target !== dragItem && dragItem) {
                    const draggedId = dragItem.dataset.columnId;
                    const targetId = target.dataset.columnId;
                    // Prevent moving the first column or dropping onto the first column (issue #958)
                    const firstColumnId = this.columnOrder[0];
                    if (draggedId === firstColumnId || targetId === firstColumnId) {
                        columnList.querySelectorAll('.column-settings-item').forEach(el => el.classList.remove('drag-over'));
                        return;
                    }
                    // Determine insert position based on mouse Y relative to target midpoint (issue #958)
                    // This allows moving a column to the last position (insert after target)
                    const targetRect = target.getBoundingClientRect();
                    const midY = targetRect.top + targetRect.height / 2;
                    if (e.clientY > midY) {
                        // Insert after target
                        columnList.insertBefore(dragItem, target.nextSibling);
                        // For reorderColumns, use the element after the dragged item as the target
                        // If there's nothing after, append to end — reorderColumns handles index-based placement
                        const nextSibling = target.nextSibling === dragItem ? target.nextSibling && target.nextSibling.nextSibling : target.nextSibling;
                        if (nextSibling && nextSibling.dataset && nextSibling.dataset.columnId) {
                            this._columnSettingsChanged = true;
                            this.reorderColumns(draggedId, nextSibling.dataset.columnId);
                        } else {
                            // Move to the last position: splice to end
                            const draggedIdx = this.columnOrder.indexOf(draggedId);
                            // Skip if already at the last position (issue #966)
                            if (draggedIdx > 0 && draggedIdx < this.columnOrder.length - 1) {
                                this._columnSettingsChanged = true;
                                this.columnOrder.splice(draggedIdx, 1);
                                this.columnOrder.push(draggedId);
                                this.saveColumnState();
                                const newOrderIndex = this.columnOrder.indexOf(draggedId);
                                if (newOrderIndex >= 0) {
                                    this.saveColumnOrderToServer(draggedId, newOrderIndex);
                                }
                                this.render();
                            }
                        }
                    } else {
                        // Insert before target
                        columnList.insertBefore(dragItem, target);
                        this._columnSettingsChanged = true;
                        this.reorderColumns(draggedId, targetId);
                    }
                }
                columnList.querySelectorAll('.column-settings-item').forEach(el => el.classList.remove('drag-over'));
                // Refresh order number badges after drop (issue #962)
                refreshOrderBadges();
            });

            // Update the 1-based order number badges to reflect current DOM order (issue #962)
            const refreshOrderBadges = () => {
                const items = columnList.querySelectorAll('.column-settings-item:not(.column-settings-item--fixed)');
                items.forEach((item, idx) => {
                    const badge = item.querySelector('.col-settings-order-num');
                    if (badge) badge.textContent = String(idx + 1);
                });
            };

            // Close on Escape key (issue #595)
            const handleEscape = (e) => {
                if (e.key === 'Escape') {
                    this.closeColumnSettings();
                    document.removeEventListener('keydown', handleEscape);
                }
            };
            document.addEventListener('keydown', handleEscape);
        }

        /**
         * Show a column edit form modal for an existing column (issue #937, #1018).
         * Provides: rename column, change base type, required, alias (ref only), delete, delete with data,
         * multiselect toggle (ref only), go to dictionary in new tab (ref only).
         * Logic taken from templates/object.html.
         */
        showColumnEditForm(col) {
            const instanceName = this.options.instanceName;
            const apiBase = this.getApiBase();
            const parsedAttrs = this.parseAttrs(col.attrs);
            const isRef = col.ref_id != null || (col.ref && col.ref !== 0);
            const isFreeLink = String(col.type) === '1';
            const isMulti = parsedAttrs.multi;
            const isRequired = parsedAttrs.required;
            const isFirstColumn = col.id === String(this.objectTableId || this.options.tableTypeId);
            const isUnique = col.unique === '1' || col.unique === 1 || col.unique === true;

            // Base types for first column (issue #1026): SHORT, CHARS, DATE, NUMBER, SIGNED, MEMO, DATETIME, HTML, GRANT, REPORT_COLUMN
            const firstColumnTypes = [
                { id: 3, name: 'Короткая строка (до 127 символов)' },
                { id: 8, name: 'Строка без ограничения длины' },
                { id: 9, name: 'Дата' },
                { id: 13, name: 'Целое число' },
                { id: 14, name: 'Число с десятичной частью' },
                { id: 12, name: 'Многострочный текст' },
                { id: 4, name: 'Дата и время' },
                { id: 2, name: 'HTML' },
                { id: 5, name: 'Права доступа (GRANT)' },
                { id: 16, name: 'Колонка отчета (REPORT_COLUMN)' }
            ];

            // Base types for regular (non-first) columns
            const baseTypes = [
                { id: 3, name: 'Короткая строка (до 127 символов)' },
                { id: 8, name: 'Строка без ограничения длины' },
                { id: 9, name: 'Дата' },
                { id: 13, name: 'Целое число' },
                { id: 14, name: 'Число с десятичной частью' },
                { id: 11, name: 'Логическое значение (Да / Нет)' },
                { id: 12, name: 'Многострочный текст' },
                { id: 4, name: 'Дата и время' },
                { id: 10, name: 'Файл' },
                { id: 7, name: 'Кнопка' }
            ];

            const availableTypes = isFirstColumn ? firstColumnTypes : baseTypes;

            // If the column's current type is not in the list, add it so the select shows the correct value
            if (!isRef && col.type && !availableTypes.find(t => String(t.id) === String(col.type))) {
                availableTypes.push({ id: parseInt(col.type), name: `Тип #${ col.type }` });
            }

            const colEditOverlay = document.createElement('div');
            colEditOverlay.className = 'column-settings-overlay';
            colEditOverlay.style.zIndex = '1001';

            const colEditModal = document.createElement('div');
            colEditModal.className = 'column-settings-modal col-edit-modal';
            colEditModal.style.zIndex = '1002';

            // Build the alias display value (either alias or original name)
            const currentAlias = parsedAttrs.alias || '';
            // Original (base) column name for renaming (issue #1018)
            const currentName = col.val || col.name;

            // For reference columns, build a grey hyperlink to table/{ref} instead of an editable name input (issue #1435)
            const refTypeId = col.ref || col.orig || col.ref_id;
            const dbName = window.location.pathname.split('/')[1];
            const refTableUrl = refTypeId ? `/${ dbName }/table/${ refTypeId }` : '#';
            const nameFieldHtml = isRef
                ? `<a href="${ this.escapeHtml(refTableUrl) }" target="${ refTypeId }" style="color: grey;">${ this.escapeHtml(currentName) }</a>`
                : `<input type="text" id="col-edit-name-${instanceName}" class="form-control form-control-sm col-edit-input" value="${ this.escapeHtml(currentName) }" placeholder="Введите название колонки" autocomplete="off">`;

            colEditModal.innerHTML = `
                <h3 style="margin: 0 0 16px 0; font-weight: 500; font-size: 1.125rem;">Редактирование колонки: <em style="font-style: normal; color: var(--md-primary, #1976d2);">${ this.escapeHtml(col.name) }</em></h3>
                <div class="col-edit-section">
                    <div class="col-edit-row">
                        <label class="col-edit-label">Название:</label>
                        ${ nameFieldHtml }
                    </div>
                    <div class="col-edit-row">
                        <label class="col-edit-label">Базовый тип:</label>
                        ${ isFreeLink ? `<span class="col-edit-value">Свободная ссылка</span>`
                            : !isRef ? `<select id="col-edit-type-${instanceName}" class="form-control form-control-sm col-edit-select">
                            ${ availableTypes.map(t => `<option value="${t.id}" ${ String(col.type) === String(t.id) ? 'selected' : '' }>${t.name}</option>`).join('') }
                        </select>` : `<span class="col-edit-value">Ссылочный тип (справочник)</span>` }
                    </div>
                    ${ isFirstColumn ? `<div class="col-edit-row">
                        <label class="col-edit-label col-edit-check-label">
                            <input type="checkbox" id="col-edit-unique-${instanceName}" ${ isUnique ? 'checked' : '' }>
                            Уникальные значения
                        </label>
                    </div>` : '' }
                    <div class="col-edit-row">
                        <label class="col-edit-label col-edit-check-label">
                            <input type="checkbox" id="col-edit-required-${instanceName}" ${ (isRequired || isFirstColumn) ? 'checked' : '' } ${ isFirstColumn ? 'disabled' : '' }>
                            Обязательно к заполнению
                        </label>
                    </div>
                    ${ isRef ? `
                    <div class="col-edit-row">
                        <label class="col-edit-label">Псевдоним:</label>
                        <input type="text" id="col-edit-alias-${instanceName}" class="form-control form-control-sm col-edit-input" value="${ this.escapeHtml(currentAlias) }" placeholder="Введите псевдоним колонки" autocomplete="off">
                    </div>
                    <div class="col-edit-row">
                        <label class="col-edit-check-label">
                            <input type="checkbox" id="col-edit-multi-${instanceName}" ${ isMulti ? 'checked' : '' }>
                            Выбор нескольких значений
                        </label>
                    </div>
                    ` : '' }
                </div>
                ${ isRef ? `<div class="col-edit-go-dict-row">
                    <a class="col-edit-go-dict-link" id="col-edit-go-dict-${instanceName}" href="#" role="button">
                        Перейти в справочник
                    </a>
                </div>` : '' }
                <div class="col-edit-actions">
                    <button class="menu-modal-btn delete col-edit-del-btn" id="col-edit-del-${instanceName}">${ isFirstColumn ? 'Удалить таблицу' : 'Удалить колонку' }</button>
                    <button class="menu-modal-btn save" id="col-edit-save-${instanceName}">Сохранить</button>
                    <button class="menu-modal-btn cancel" id="col-edit-cancel-${instanceName}">Отменить</button>
                </div>
                <div id="col-edit-del-confirm-${instanceName}" class="col-edit-del-confirm" style="display:none;">
                    <span class="col-edit-del-warn">Удалить колонку вместе с данными?</span>
                    <button class="menu-modal-btn delete" id="col-edit-del-forced-${instanceName}">Удалить с данными</button>
                    <button class="menu-modal-btn cancel" id="col-edit-del-cancel-${instanceName}">Отменить</button>
                </div>
                <div id="col-edit-status-${instanceName}" class="col-edit-status" style="display:none;"></div>
            `;

            document.body.appendChild(colEditOverlay);
            document.body.appendChild(colEditModal);

            const showStatus = (msg, isError) => {
                const el = colEditModal.querySelector(`#col-edit-status-${instanceName}`);
                el.textContent = msg;
                el.className = 'col-edit-status' + (isError ? ' col-edit-status-error' : ' col-edit-status-ok');
                el.style.display = 'block';
            };

            const closeColEdit = () => {
                colEditOverlay.remove();
                colEditModal.remove();
            };

            const refreshCurrentTableAfterDelete = async () => {
                this.metadataCache = {};
                this.metadataFetchPromises = {};
                this.globalMetadata = null;
                this.globalMetadataPromise = null;
                this.columns = [];
                this.closeColumnSettings();
                closeColEdit();
                await this.loadData(false);
            };

            colEditOverlay.addEventListener('click', closeColEdit);
            colEditModal.querySelector(`#col-edit-cancel-${instanceName}`).addEventListener('click', closeColEdit);

            // Close on Enter key; stop propagation so the parent column-settings-modal is not affected (issue #1568)
            colEditModal.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    e.stopPropagation();
                    colEditModal.querySelector(`#col-edit-save-${instanceName}`).click();
                }
            });

            // Save button: save type (non-ref) + required + alias (ref)
            colEditModal.querySelector(`#col-edit-save-${instanceName}`).addEventListener('click', async () => {
                const saveBtn = colEditModal.querySelector(`#col-edit-save-${instanceName}`);
                saveBtn.disabled = true;

                try {
                    // 0. Rename column (issue #1018, extended to first column in issue #1026)
                    // For ref columns the name field is a hyperlink (not editable), so the input won't exist (issue #1435)
                    // For free link columns (type=1) use _d_alias instead of _d_save (issue #1835)
                    const nameInput = colEditModal.querySelector(`#col-edit-name-${instanceName}`);
                    const newName = nameInput ? nameInput.value.trim() : '';
                    if (newName && newName !== currentName) {
                        const result = isFreeLink
                            ? await this.setColumnAlias(col.id, newName)
                            : await this.renameColumn(col.orig || col.id, newName, col.type);
                        if (!result.success) {
                            showStatus('Ошибка переименования: ' + result.error, true);
                            saveBtn.disabled = false;
                            return;
                        }
                        col.name = newName;
                        col.val = newName;
                    }

                    // 1. Change base type (non-ref, non-free-link only)
                    if (!isRef && !isFreeLink) {
                        const newTypeId = colEditModal.querySelector(`#col-edit-type-${instanceName}`).value;
                        const currentColName = colEditModal.querySelector(`#col-edit-name-${instanceName}`).value.trim() || col.name;
                        const newUnique = colEditModal.querySelector(`#col-edit-unique-${instanceName}`)?.checked ?? isUnique;
                        if (String(newTypeId) !== String(col.type) || newUnique !== isUnique) {
                            const result = await this.saveColumnType(col.orig || col.id, newTypeId, currentColName, newUnique);
                            if (!result.success) {
                                showStatus('Ошибка изменения типа: ' + result.error, true);
                                saveBtn.disabled = false;
                                return;
                            }
                            col.type = newTypeId;
                            col.unique = newUnique ? '1' : '0';
                        }
                    }

                    // 2. Required flag (skip for first column - issue #1873)
                    // First column is always required and cannot have _d_null sent to server
                    if (!isFirstColumn) {
                        const newRequired = colEditModal.querySelector(`#col-edit-required-${instanceName}`).checked;
                        if (newRequired !== isRequired) {
                            const result = await this.setColumnRequired(col.id);
                            if (!result.success) {
                                showStatus('Ошибка изменения обязательности: ' + result.error, true);
                                saveBtn.disabled = false;
                                return;
                            }
                            // Update attrs
                            if (newRequired) {
                                col.attrs = (col.attrs || '') + ':!NULL:';
                            } else {
                                col.attrs = (col.attrs || '').replace(/:!NULL:/g, '');
                            }
                        }
                    }

                    // 3. Alias (ref only)
                    if (isRef) {
                        const newAlias = colEditModal.querySelector(`#col-edit-alias-${instanceName}`).value.trim();
                        if (newAlias !== currentAlias) {
                            const result = await this.setColumnAlias(col.id, newAlias);
                            if (!result.success) {
                                showStatus('Ошибка установки псевдонима: ' + result.error, true);
                                saveBtn.disabled = false;
                                return;
                            }
                            // Update attrs alias
                            col.attrs = (col.attrs || '').replace(/:ALIAS=.*?:/g, '');
                            if (newAlias) {
                                col.attrs = (col.attrs || '') + `:ALIAS=${newAlias}:`;
                            }
                            col.name = newAlias || (this.parseAttrs(col.attrs).alias) || col.name;
                        }

                        // 4. Multiselect toggle (ref only)
                        const newMulti = colEditModal.querySelector(`#col-edit-multi-${instanceName}`).checked;
                        if (newMulti !== isMulti) {
                            const result = await this.toggleColumnMulti(col.id);
                            if (!result.success) {
                                showStatus('Ошибка изменения мультивыбора: ' + result.error, true);
                                saveBtn.disabled = false;
                                return;
                            }
                            if (newMulti) {
                                col.attrs = (col.attrs || '') + ':MULTI:';
                            } else {
                                col.attrs = (col.attrs || '').replace(/:MULTI:/g, '');
                            }
                        }
                    }

                    showStatus('Изменения сохранены', false);
                    // Clear metadata cache so edit/add forms fetch fresh metadata (issue #1386)
                    this.metadataCache = {};
                    this.metadataFetchPromises = {};  // Clear in-progress fetches (issue #1455)
                    // Clear globalMetadata so fetchMetadata() re-fetches fresh column info (issue #1400)
                    this.globalMetadata = null;
                    this.globalMetadataPromise = null;
                    // Clear columns so loadDataFromTable() re-fetches metadata (issue #1400)
                    this.columns = [];
                    // Close only the col-edit modal and reopen the parent column settings so the user
                    // can continue editing other columns; do not close the parent modal (issue #1568)
                    setTimeout(async () => {
                        closeColEdit();
                        this.closeColumnSettings();
                        await this.loadData(0);
                        this.openColumnSettings();
                    }, 800);
                } catch (err) {
                    showStatus('Ошибка: ' + err.message, true);
                    saveBtn.disabled = false;
                }
            });

            // Go to dictionary (ref only) - opens in new tab
            if (isRef) {
                colEditModal.querySelector(`#col-edit-go-dict-${instanceName}`).addEventListener('click', (e) => {
                    e.preventDefault();
                    const refTypeId = col.orig || col.ref_id;
                    if (refTypeId) {
                        const dbName = window.location.pathname.split('/')[1];
                        window.open(`/${dbName}/object/${refTypeId}`, '_blank');
                    }
                });
            }

            // Delete column/table button (issue #1932: table deletion uses _d_del, column uses _d_del_req)
            colEditModal.querySelector(`#col-edit-del-${instanceName}`).addEventListener('click', async () => {
                const delBtn = colEditModal.querySelector(`#col-edit-del-${instanceName}`);
                delBtn.disabled = true;
                if (isFirstColumn) {
                    const tableId = this.objectTableId || this.options.tableTypeId;
                    const result = await this.deleteTable(tableId);
                    if (result.success) {
                        closeColEdit();
                        const dbName = window.location.pathname.split('/')[1];
                        window.location.href = `/${dbName}/tables`;
                    } else {
                        showStatus('Ошибка удаления таблицы: ' + result.error, true);
                        delBtn.disabled = false;
                    }
                } else {
                    const result = await this.deleteColumn(col.id, false);
                    if (result.success) {
                        await refreshCurrentTableAfterDelete();
                    } else if (result.hasData) {
                        // Show forced delete option
                        delBtn.style.display = 'none';
                        const confirmEl = colEditModal.querySelector(`#col-edit-del-confirm-${instanceName}`);
                        confirmEl.style.display = 'flex';
                        colEditModal.querySelector(`#col-edit-del-forced-${instanceName}`).addEventListener('click', async () => {
                            const result2 = await this.deleteColumn(col.id, true);
                            if (result2.success) {
                                await refreshCurrentTableAfterDelete();
                            } else {
                                showStatus('Ошибка удаления: ' + result2.error, true);
                            }
                        });
                        colEditModal.querySelector(`#col-edit-del-cancel-${instanceName}`).addEventListener('click', () => {
                            confirmEl.style.display = 'none';
                            delBtn.style.display = '';
                            delBtn.disabled = false;
                        });
                    } else {
                        showStatus('Ошибка удаления: ' + result.error, true);
                        delBtn.disabled = false;
                    }
                }
            });
        }

        /**
         * Save column base type via API (issue #937).
         * Uses _d_save/{origId}?JSON as in object.html saveType().
         * @param {boolean} [isUnique] - Whether to set unique=1 flag (issue #1026)
         */
        async saveColumnType(origId, newTypeId, colName, isUnique) {
            const apiBase = this.getApiBase();
            try {
                const params = new URLSearchParams();
                params.append('val', colName);
                params.append('t', newTypeId);
                if (isUnique) params.append('unique', '1');
                if (typeof xsrf !== 'undefined') params.append('_xsrf', xsrf);

                const resp = await fetch(`${apiBase}/_d_save/${origId}?JSON`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: params.toString()
                });
                if (!resp.ok) return { success: false, error: `HTTP ${resp.status}` };
                return { success: true };
            } catch (err) {
                return { success: false, error: err.message };
            }
        }

        /**
         * Rename a column via API (issue #1018).
         * Uses _d_save/{origId}?JSON with new name and existing type.
         */
        async renameColumn(origId, newName, typeId) {
            const apiBase = this.getApiBase();
            try {
                const params = new URLSearchParams();
                params.append('val', newName);
                params.append('t', typeId);
                if (typeof xsrf !== 'undefined') params.append('_xsrf', xsrf);

                const resp = await fetch(`${apiBase}/_d_save/${origId}?JSON`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: params.toString()
                });
                if (!resp.ok) return { success: false, error: `HTTP ${resp.status}` };
                return { success: true };
            } catch (err) {
                return { success: false, error: err.message };
            }
        }

        /**
         * Toggle required flag for a column via API (issue #937).
         * Uses _d_null/{colId}?JSON as in object.html.
         */
        async setColumnRequired(colId) {
            const apiBase = this.getApiBase();
            try {
                const params = new URLSearchParams();
                if (typeof xsrf !== 'undefined') params.append('_xsrf', xsrf);

                const resp = await fetch(`${apiBase}/_d_null/${colId}?JSON`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: params.toString()
                });
                if (!resp.ok) return { success: false, error: `HTTP ${resp.status}` };
                return { success: true };
            } catch (err) {
                return { success: false, error: err.message };
            }
        }

        /**
         * Set column alias via API (issue #937).
         * Uses _d_alias/{colId}?JSON as in object.html setAlias().
         */
        async setColumnAlias(colId, alias) {
            const apiBase = this.getApiBase();
            try {
                const params = new URLSearchParams();
                params.append('val', alias);
                if (typeof xsrf !== 'undefined') params.append('_xsrf', xsrf);

                const resp = await fetch(`${apiBase}/_d_alias/${colId}?JSON`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: params.toString()
                });
                if (!resp.ok) return { success: false, error: `HTTP ${resp.status}` };
                return { success: true };
            } catch (err) {
                return { success: false, error: err.message };
            }
        }

        /**
         * Toggle multiselect flag for a reference column via API (issue #937).
         * Uses _d_multi/{colId}?JSON as in object.html.
         */
        async toggleColumnMulti(colId) {
            const apiBase = this.getApiBase();
            try {
                const params = new URLSearchParams();
                if (typeof xsrf !== 'undefined') params.append('_xsrf', xsrf);

                const resp = await fetch(`${apiBase}/_d_multi/${colId}?JSON`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: params.toString()
                });
                if (!resp.ok) return { success: false, error: `HTTP ${resp.status}` };
                return { success: true };
            } catch (err) {
                return { success: false, error: err.message };
            }
        }

        /**
         * Delete a table via API (issue #1932).
         * Uses _d_del/{tableId}?JSON. On success returns {id, obj, next_act, args, warnings}.
         * @returns {Promise<{success: boolean, error?: string}>}
         */
        async deleteTable(tableId) {
            const apiBase = this.getApiBase();
            try {
                const params = new URLSearchParams();
                if (typeof xsrf !== 'undefined') params.append('_xsrf', xsrf);

                const resp = await fetch(`${apiBase}/_d_del/${tableId}?JSON`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: params.toString()
                });
                if (!resp.ok) return { success: false, error: `HTTP ${resp.status}` };
                const result = await resp.json();
                if (result && result.id) return { success: true };
                const err = (Array.isArray(result) && result[0]?.error) || result?.error || 'Неизвестная ошибка';
                return { success: false, error: err };
            } catch (err) {
                return { success: false, error: err.message };
            }
        }

        /**
         * Delete a column via API (issue #937).
         * Uses _d_del_req/{colId}?JSON as in object.html.
         * @param {boolean} forced - whether to force delete with data
         * @returns {Promise<{success: boolean, hasData?: boolean, error?: string}>}
         */
        async deleteColumn(colId, forced) {
            const apiBase = this.getApiBase();
            try {
                const params = new URLSearchParams();
                if (forced) params.append('forced', '1');
                if (typeof xsrf !== 'undefined') params.append('_xsrf', xsrf);

                const resp = await fetch(`${apiBase}/_d_del_req/${colId}?JSON`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: params.toString()
                });
                if (!resp.ok) return { success: false, error: `HTTP ${resp.status}` };
                const result = await resp.json();
                // When column has data, API returns an error; treat it as hasData=true
                if (Array.isArray(result) && result[0]?.error) {
                    return { success: false, hasData: true, error: result[0].error };
                }
                return { success: true };
            } catch (err) {
                return { success: false, error: err.message };
            }
        }

        closeColumnSettings() {
            document.querySelectorAll('.column-settings-overlay, .column-settings-modal').forEach(el => el.remove());
            if (this._columnSettingsChanged) {
                this._columnSettingsChanged = false;
                this.loadData(false);
            }
        }

        /**
         * Show form to add a new column (issue #565, #567)
         * Displays a modal dialog with inputs for column name, base type, list value checkbox, and multiselect checkbox
         */
        showAddColumnForm(parentModal) {
            const instanceName = this.options.instanceName;

            // Base types available for selection
            const baseTypes = [
                { id: 3, name: 'Короткая строка (до 127 символов)' },
                { id: 8, name: 'Строка без ограничения длины' },
                { id: 9, name: 'Дата' },
                { id: 13, name: 'Целое число' },
                { id: 14, name: 'Число с десятичной частью' },
                { id: 11, name: 'Логическое значение (Да / Нет)' },
                { id: 12, name: 'Многострочный текст' },
                { id: 4, name: 'Дата и время' },
                { id: 10, name: 'Файл' },
                { id: 1, name: 'Свободная ссылка' }
            ];

            // Create modal overlay (issue #567: make the form a modal)
            const modalOverlay = document.createElement('div');
            modalOverlay.className = 'add-column-modal-overlay';
            modalOverlay.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0, 0, 0, 0.32); z-index: 1001; backdrop-filter: blur(2px);';

            // Create modal container
            const modal = document.createElement('div');
            modal.className = 'add-column-modal';
            modal.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: #fff; padding: 20px; border-radius: 4px; box-shadow: 0 14px 28px rgba(0,0,0,0.25), 0 10px 10px rgba(0,0,0,0.22); z-index: 1002; max-width: 450px; width: 90%;';

            modal.innerHTML = `
                <h3 style="margin: 0 0 20px 0; font-weight: 500; font-size: 1.25rem;">Добавить новую колонку</h3>
                <div style="margin-bottom: 16px; position: relative;">
                    <label style="display: block; margin-bottom: 6px; font-weight: 500; font-size: 0.875rem;">Имя колонки:</label>
                    <input type="text" id="new-column-name-${instanceName}" class="form-control" placeholder="Введите имя колонки" style="width: 100%; padding: 10px 12px; border: 1px solid #dee2e6; border-radius: 4px; font-size: 0.875rem; box-sizing: border-box;" autocomplete="off">
                    <div id="column-name-suggestions-${instanceName}" style="display: none; position: absolute; top: 100%; left: 0; right: 0; background: #fff; border: 1px solid #dee2e6; border-radius: 4px; box-shadow: 0 4px 8px rgba(0,0,0,0.1); max-height: 250px; overflow-y: auto; z-index: 1003;"></div>
                </div>
                <div style="margin-bottom: 16px;">
                    <label style="display: block; margin-bottom: 6px; font-weight: 500; font-size: 0.875rem;">Базовый тип:</label>
                    <select id="new-column-type-${instanceName}" class="form-control" style="width: 100%; padding: 10px 12px; border: 1px solid #dee2e6; border-radius: 4px; font-size: 0.875rem; box-sizing: border-box;">
                        ${baseTypes.map(t => `<option value="${t.id}">${t.name}</option>`).join('')}
                    </select>
                </div>
                <div style="margin-bottom: 16px;">
                    <label style="display: flex; align-items: center; cursor: pointer; font-size: 0.875rem;">
                        <input type="checkbox" id="new-column-list-${instanceName}" style="margin-right: 10px; width: 18px; height: 18px;">
                        Списочное значение (справочник)
                    </label>
                </div>
                <div style="margin-bottom: 16px; display: none;" id="multiselect-container-${instanceName}">
                    <label style="display: flex; align-items: center; cursor: pointer; font-size: 0.875rem;">
                        <input type="checkbox" id="new-column-multiselect-${instanceName}" style="margin-right: 10px; width: 18px; height: 18px;">
                        Разрешить мультивыбор (выбор нескольких значений)
                    </label>
                </div>
                <div id="add-column-error-${instanceName}" style="color: #dc3545; margin-bottom: 16px; display: none; font-size: 0.875rem;"></div>
                <div style="display: flex; justify-content: flex-end; gap: 10px;">
                    <button class="btn btn-primary" id="create-column-btn-${instanceName}">Создать</button>
                    <button class="btn btn-secondary" id="cancel-add-column-btn-${instanceName}">Отменить</button>
                </div>
            `;

            document.body.appendChild(modalOverlay);
            document.body.appendChild(modal);

            // Close modal function
            const closeAddColumnModal = () => {
                modalOverlay.remove();
                modal.remove();
            };

            // Close on overlay click
            modalOverlay.addEventListener('click', closeAddColumnModal);

            // Show/hide multiselect option based on list checkbox
            const listCheckbox = modal.querySelector(`#new-column-list-${instanceName}`);
            const multiselectContainer = modal.querySelector(`#multiselect-container-${instanceName}`);

            // Track whether the user has manually changed type or reference flag (issue #1494)
            let typeManuallyChanged = false;
            let refManuallyChanged = false;

            listCheckbox.addEventListener('change', () => {
                multiselectContainer.style.display = listCheckbox.checked ? 'block' : 'none';
                if (!listCheckbox.checked) {
                    modal.querySelector(`#new-column-multiselect-${instanceName}`).checked = false;
                }
                // Mark as manually changed only if not triggered by auto-detection
                if (!listCheckbox._autoDetecting) {
                    refManuallyChanged = true;
                }
            });

            // Metadata search for column name suggestions (issue #585)
            const nameInput = modal.querySelector(`#new-column-name-${instanceName}`);
            const suggestionsDiv = modal.querySelector(`#column-name-suggestions-${instanceName}`);
            const typeSelect = modal.querySelector(`#new-column-type-${instanceName}`);

            // Mark type as manually changed when the user edits it directly (issue #1494)
            typeSelect.addEventListener('change', () => {
                typeManuallyChanged = true;
            });

            // Get base type name by id
            const getBaseTypeName = (typeId) => {
                const type = baseTypes.find(t => t.id === parseInt(typeId));
                return type ? type.name : `Тип ${typeId}`;
            };

            // Search metadata and return matching items
            const searchMetadata = (searchTerm) => {
                if (!this.globalMetadata || !searchTerm || searchTerm.length < 1) {
                    return [];
                }

                const term = searchTerm.toLowerCase();
                const results = [];
                // Track seen suggestions to prevent duplicates (issue #587)
                const seen = new Set();

                // Helper to create unique key for deduplication
                const getKey = (name, type, isReference) => `${name.toLowerCase()}|${type}|${isReference}`;

                // Search in top-level metadata items (tables)
                for (const item of this.globalMetadata) {
                    const name = item.val || item.value || item.name || '';
                    if (name.toLowerCase().includes(term)) {
                        const type = item.type || item.id;
                        const key = getKey(name, type, false);
                        // Add as regular suggestion if not already seen
                        if (!seen.has(key)) {
                            seen.add(key);
                            results.push({
                                name: name,
                                type: type,
                                isReference: false,
                                source: 'table',
                                item: item
                            });
                        }

                        // If item has "referenced" key, add additional suggestion as "Справочник {Name}"
                        if (item.referenced) {
                            const refKey = getKey(name, type, true);
                            if (!seen.has(refKey)) {
                                seen.add(refKey);
                                results.push({
                                    name: name,
                                    type: type,
                                    isReference: true,
                                    source: 'table',
                                    item: item
                                });
                            }
                        }
                    }

                    // Also check if "Справочник {name}" matches the search term
                    if (item.referenced && `справочник ${name}`.toLowerCase().includes(term)) {
                        const type = item.type || item.id;
                        const refKey = getKey(name, type, true);
                        // Check if we haven't already added this reference suggestion
                        if (!seen.has(refKey)) {
                            seen.add(refKey);
                            results.push({
                                name: name,
                                type: type,
                                isReference: true,
                                source: 'table',
                                item: item
                            });
                        }
                    }

                    // Search in reqs (requisites) of this item
                    if (item.reqs && Array.isArray(item.reqs)) {
                        for (const req of item.reqs) {
                            const reqName = req.val || req.value || req.name || '';
                            if (reqName.toLowerCase().includes(term)) {
                                const reqType = req.type;
                                const reqKey = getKey(reqName, reqType, false);
                                if (!seen.has(reqKey)) {
                                    seen.add(reqKey);
                                    results.push({
                                        name: reqName,
                                        type: reqType,
                                        isReference: false,
                                        source: 'requisite',
                                        item: req
                                    });
                                }
                            }
                        }
                    }
                }

                // Return top 10 results
                return results.slice(0, 10);
            };

            // Render suggestions dropdown
            const renderSuggestions = (suggestions) => {
                if (suggestions.length === 0) {
                    suggestionsDiv.style.display = 'none';
                    return;
                }

                suggestionsDiv.innerHTML = suggestions.map((s, idx) => {
                    const typeName = getBaseTypeName(s.type);
                    const displayName = s.isReference ? `Справочник ${s.name}` : s.name;
                    return `<div class="column-suggestion-item" data-index="${idx}" style="padding: 10px 12px; cursor: pointer; border-bottom: 1px solid #eee; font-size: 0.875rem;" onmouseover="this.style.backgroundColor='#f5f5f5'" onmouseout="this.style.backgroundColor='transparent'">
                        ${this.escapeHtml(displayName)} <span style="color: #888;">(${this.escapeHtml(typeName)})</span>
                    </div>`;
                }).join('');

                suggestionsDiv.style.display = 'block';

                // Add click handlers for suggestions
                suggestionsDiv.querySelectorAll('.column-suggestion-item').forEach((el, idx) => {
                    el.addEventListener('click', () => {
                        const suggestion = suggestions[idx];
                        // Fill the name field (use original name without "Справочник" prefix)
                        nameInput.value = suggestion.name;

                        // Set the base type
                        typeSelect.value = suggestion.type;

                        // If reference suggestion, check the list checkbox; otherwise uncheck it (issue #587)
                        if (suggestion.isReference) {
                            listCheckbox.checked = true;
                            multiselectContainer.style.display = 'block';
                        } else {
                            listCheckbox.checked = false;
                            multiselectContainer.style.display = 'none';
                        }

                        // Hide suggestions
                        suggestionsDiv.style.display = 'none';
                    });
                });
            };

            // Input event for search and auto-detection of type/reference (issue #1494)
            nameInput.addEventListener('input', () => {
                const value = nameInput.value.trim();
                if (value.length >= 1) {
                    const suggestions = searchMetadata(value);
                    renderSuggestions(suggestions);

                    // Auto-detect base type and reference flag from column name dictionary
                    if (typeof detectColumnType === 'function') {
                        const detected = detectColumnType(value);
                        if (detected) {
                            if (!typeManuallyChanged) {
                                typeSelect.value = String(detected.type);
                            }
                            if (!refManuallyChanged) {
                                listCheckbox._autoDetecting = true;
                                listCheckbox.checked = detected.ref;
                                listCheckbox._autoDetecting = false;
                                multiselectContainer.style.display = detected.ref ? 'block' : 'none';
                                if (!detected.ref) {
                                    modal.querySelector(`#new-column-multiselect-${instanceName}`).checked = false;
                                }
                            }
                        }
                    }
                } else {
                    suggestionsDiv.style.display = 'none';
                }
            });

            // Hide suggestions when clicking outside
            document.addEventListener('click', (e) => {
                if (!nameInput.contains(e.target) && !suggestionsDiv.contains(e.target)) {
                    suggestionsDiv.style.display = 'none';
                }
            });

            // Cancel button handler
            modal.querySelector(`#cancel-add-column-btn-${instanceName}`).addEventListener('click', closeAddColumnModal);

            // Create button handler
            modal.querySelector(`#create-column-btn-${instanceName}`).addEventListener('click', async () => {
                const columnName = modal.querySelector(`#new-column-name-${instanceName}`).value.trim();
                const baseTypeId = parseInt(modal.querySelector(`#new-column-type-${instanceName}`).value);
                const isListValue = listCheckbox.checked;
                const isMultiselect = modal.querySelector(`#new-column-multiselect-${instanceName}`).checked;
                const errorDiv = modal.querySelector(`#add-column-error-${instanceName}`);

                // Validate
                if (!columnName) {
                    errorDiv.textContent = 'Введите имя колонки';
                    errorDiv.style.display = 'block';
                    return;
                }

                errorDiv.style.display = 'none';

                // Disable buttons during creation
                const createBtn = modal.querySelector(`#create-column-btn-${instanceName}`);
                const cancelBtn = modal.querySelector(`#cancel-add-column-btn-${instanceName}`);
                createBtn.disabled = true;
                cancelBtn.disabled = true;
                createBtn.textContent = 'Создание...';

                try {
                    const result = await this.createColumn(columnName, baseTypeId, isListValue, isMultiselect);

                    if (result.success) {
                        // Add column to the table's internal state first so getColTypeIcon can use it
                        const newCol = {
                            id: String(result.columnId),
                            name: columnName,
                            type: baseTypeId,
                            paramId: result.termId,
                            // For list columns, set ref_id, ref, and orig so showColumnEditForm treats them
                            // as reference columns immediately (without requiring a page refresh, issue #1678)
                            ref_id: isListValue ? result.refId : null,
                            ref: isListValue ? parseInt(result.termId) : 0,
                            orig: isListValue ? result.termId : null
                        };
                        this.columns.push(newCol);

                        // Add new column to columnOrder so drag-and-drop reordering works immediately (issue #976)
                        if (!this.columnOrder.includes(String(result.columnId))) {
                            this.columnOrder.push(String(result.columnId));
                        }

                        // Add new column to the column settings list in the parent modal (issue #949)
                        // parentModal may be null when called directly via quickAddColumn (issue #1230)
                        const columnList = parentModal ? parentModal.querySelector(`#column-settings-list-${instanceName}`) : null;
                        if (columnList) {
                            const newItem = document.createElement('div');
                            newItem.className = 'column-settings-item';
                            newItem.setAttribute('draggable', 'true');
                            newItem.dataset.columnId = String(result.columnId);
                            // Determine 1-based position number among non-fixed columns (issue #970)
                            const nonFixedCount = columnList.querySelectorAll('.column-settings-item:not(.column-settings-item--fixed)').length;
                            const orderNum = nonFixedCount + 1;
                            newItem.innerHTML = `
                                <span class="col-settings-drag-handle" title="Перетащите для изменения порядка">&#9776;</span><span class="col-settings-order-num">${orderNum}</span>
                                ${this.getColTypeIcon(newCol)}
                                <label style="flex: 1; margin: 0;">
                                    <input type="checkbox" data-column-id="${result.columnId}" checked>
                                    ${this.escapeHtml(columnName)}
                                </label>
                                <button class="btn-col-edit" data-col-id="${result.columnId}" title="Редактировать колонку">
                                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12.146 0.146009C12.2408 0.0522494 12.3679 0 12.5005 0C12.6331 0 12.7602 0.0522494 12.854 0.146009L15.854 3.14601C15.9006 3.19245 15.9375 3.24763 15.9627 3.30838C15.9879 3.36912 16.0009 3.43424 16.0009 3.50001C16.0009 3.56578 15.9879 3.6309 15.9627 3.69164C15.9375 3.75239 15.9006 3.80756 15.854 3.85401L5.85399 13.854C5.806 13.9017 5.74885 13.9391 5.68599 13.964L0.685989 15.964C0.595125 16.0004 0.495585 16.0093 0.399709 15.9896C0.303832 15.9699 0.215836 15.9226 0.14663 15.8534C0.0774234 15.7842 0.0300499 15.6962 0.0103825 15.6003C-0.00928499 15.5044 -0.000381488 15.4049 0.0359892 15.314L2.03599 10.314C2.06092 10.2511 2.09834 10.194 2.14599 10.146L12.146 0.146009ZM11.207 2.50001L13.5 4.79301L14.793 3.50001L12.5 1.20701L11.207 2.50001ZM12.793 5.50001L10.5 3.20701L3.99999 9.70701V10H4.49999C4.6326 10 4.75977 10.0527 4.85354 10.1465C4.94731 10.2402 4.99999 10.3674 4.99999 10.5V11H5.49999C5.6326 11 5.75977 11.0527 5.85354 11.1465C5.94731 11.2402 5.99999 11.3674 5.99999 11.5V12H6.29299L12.793 5.50001ZM3.03199 10.675L2.92599 10.781L1.39799 14.602L5.21899 13.074L5.32499 12.968C5.22961 12.9324 5.14738 12.8685 5.0893 12.7848C5.03123 12.7012 5.00007 12.6018 4.99999 12.5V12H4.49999C4.36738 12 4.2402 11.9473 4.14644 11.8536C4.05267 11.7598 3.99999 11.6326 3.99999 11.5V11H3.49999C3.39817 10.9999 3.2988 10.9688 3.21517 10.9107C3.13153 10.8526 3.06763 10.7704 3.03199 10.675Z" fill="currentColor"/></svg>
                                </button>
                            `;
                            columnList.appendChild(newItem);

                            // Add event listener for the new checkbox
                            const newCheckbox = newItem.querySelector('input[type="checkbox"]');
                            newCheckbox.addEventListener('change', () => {
                                const colId = newCheckbox.dataset.columnId;
                                if (newCheckbox.checked) {
                                    if (!this.visibleColumns.includes(colId)) {
                                        this.visibleColumns.push(colId);
                                    }
                                } else {
                                    this.visibleColumns = this.visibleColumns.filter(id => id !== colId);
                                }
                                this.saveColumnState();
                                this.render();
                            });

                            // Add event listener for the new edit button (issue #949)
                            const newEditBtn = newItem.querySelector('.btn-col-edit');
                            newEditBtn.addEventListener('click', (e) => {
                                e.stopPropagation();
                                const col = this.columns.find(c => c.id === String(result.columnId));
                                if (col) {
                                    this.showColumnEditForm(col);
                                }
                            });
                        }

                        // Make the column visible
                        if (!this.visibleColumns.includes(String(result.columnId))) {
                            this.visibleColumns.push(String(result.columnId));
                        }

                        // Save state and re-render
                        this._columnSettingsChanged = true;
                        this.saveColumnState();
                        this.render();

                        // Clear metadata cache so edit/add forms fetch fresh metadata (issue #1424)
                        this.metadataCache = {};
                        this.metadataFetchPromises = {};  // Clear in-progress fetches (issue #1455)
                        // Clear globalMetadata so fetchMetadata() re-fetches fresh column info (issue #1424)
                        this.globalMetadata = null;
                        this.globalMetadataPromise = null;

                        // Close the add column modal but keep the parent column settings modal open
                        closeAddColumnModal();
                    } else {
                        errorDiv.textContent = result.error || 'Ошибка при создании колонки';
                        errorDiv.style.display = 'block';
                        createBtn.disabled = false;
                        cancelBtn.disabled = false;
                        createBtn.textContent = 'Создать';
                    }
                } catch (error) {
                    console.error('Error creating column:', error);
                    errorDiv.textContent = error.message || 'Ошибка при создании колонки';
                    errorDiv.style.display = 'block';
                    createBtn.disabled = false;
                    cancelBtn.disabled = false;
                    createBtn.textContent = 'Создать';
                }
            });

            // Focus on the name input
            modal.querySelector(`#new-column-name-${instanceName}`).focus();

            // Close on Escape key
            const handleEscape = (e) => {
                if (e.key === 'Escape') {
                    closeAddColumnModal();
                    document.removeEventListener('keydown', handleEscape);
                }
            };
            document.addEventListener('keydown', handleEscape);
        }

        /**
         * Create a new column via API (issue #565)
         * @param {string} columnName - Name of the new column
         * @param {number} baseTypeId - Base type ID (3, 4, 8, 9, 10, 11, 12, 13, 14)
         * @param {boolean} isListValue - Whether this is a list/lookup column
         * @param {boolean} isMultiselect - Whether multiple values can be selected (only for list columns)
         * @returns {Promise<{success: boolean, columnId?: string, termId?: string, error?: string}>}
         */
        async createColumn(columnName, baseTypeId, isListValue, isMultiselect) {
            const apiBase = this.getApiBase();
            const tableId = this.objectTableId || this.options.tableTypeId;
            const isFreeLink = Number(baseTypeId) === 1;

            if (!tableId) {
                return { success: false, error: 'Не удалось определить ID таблицы' };
            }

            try {
                if (isFreeLink) {
                    const reqParams = new URLSearchParams();
                    reqParams.append('val', columnName);
                    reqParams.append('t', String(baseTypeId));
                    if (typeof xsrf !== 'undefined') {
                        reqParams.append('_xsrf', xsrf);
                    }

                    const reqResponse = await fetch(`${apiBase}/_d_req/${tableId}?JSON`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: reqParams.toString()
                    });

                    if (!reqResponse.ok) {
                        return { success: false, error: `Ошибка добавления колонки: ${reqResponse.status}` };
                    }

                    const reqResult = await reqResponse.json();

                    if (Array.isArray(reqResult) && reqResult[0]?.error) {
                        return { success: false, error: reqResult[0].error };
                    }

                    const columnId = reqResult.id;
                    if (!columnId) {
                        return { success: false, error: 'Не получен ID колонки' };
                    }

                    return {
                        success: true,
                        columnId: String(columnId),
                        termId: null,
                        refId: null
                    };
                }

                // Step 1: Create term with the base type
                const termParams = new URLSearchParams();
                termParams.append('val', columnName);
                termParams.append('t', baseTypeId);
                if (typeof xsrf !== 'undefined') {
                    termParams.append('_xsrf', xsrf);
                }
                // For list values, add unique=1 flag
                if (isListValue) {
                    termParams.append('unique', '1');
                }

                const termResponse = await fetch(`${apiBase}/_d_new?JSON`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: termParams.toString()
                });

                if (!termResponse.ok) {
                    return { success: false, error: `Ошибка создания термина: ${termResponse.status}` };
                }

                const termResult = await termResponse.json();

                // Check for API error
                if (Array.isArray(termResult) && termResult[0]?.error) {
                    return { success: false, error: termResult[0].error };
                }

                const termId = termResult.obj;
                if (!termId) {
                    return { success: false, error: 'Не получен ID термина' };
                }

                let typeIdToAdd = termId;

                // Step 2: For list values, create a reference to the term
                if (isListValue) {
                    const refParams = new URLSearchParams();
                    if (typeof xsrf !== 'undefined') {
                        refParams.append('_xsrf', xsrf);
                    }

                    const refResponse = await fetch(`${apiBase}/_d_ref/${termId}?JSON`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: refParams.toString()
                    });

                    if (!refResponse.ok) {
                        return { success: false, error: `Ошибка создания ссылки: ${refResponse.status}` };
                    }

                    const refResult = await refResponse.json();

                    if (Array.isArray(refResult) && refResult[0]?.error) {
                        return { success: false, error: refResult[0].error };
                    }

                    typeIdToAdd = refResult.obj;
                    if (!typeIdToAdd) {
                        return { success: false, error: 'Не получен ID ссылки' };
                    }
                }

                // Step 3: Add the term/reference as a column (requisite) to the table
                const reqParams = new URLSearchParams();
                reqParams.append('t', typeIdToAdd);
                if (typeof xsrf !== 'undefined') {
                    reqParams.append('_xsrf', xsrf);
                }

                const reqResponse = await fetch(`${apiBase}/_d_req/${tableId}?JSON`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: reqParams.toString()
                });

                if (!reqResponse.ok) {
                    return { success: false, error: `Ошибка добавления колонки: ${reqResponse.status}` };
                }

                const reqResult = await reqResponse.json();

                if (Array.isArray(reqResult) && reqResult[0]?.error) {
                    return { success: false, error: reqResult[0].error };
                }

                const columnId = reqResult.id;
                if (!columnId) {
                    return { success: false, error: 'Не получен ID колонки' };
                }

                // Step 4: If multiselect is enabled for list values, toggle the multi flag
                if (isListValue && isMultiselect) {
                    const multiParams = new URLSearchParams();
                    if (typeof xsrf !== 'undefined') {
                        multiParams.append('_xsrf', xsrf);
                    }

                    const multiResponse = await fetch(`${apiBase}/_d_multi/${columnId}?JSON`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: multiParams.toString()
                    });

                    if (!multiResponse.ok) {
                        console.warn(`Warning: Failed to enable multiselect for column ${columnId}: ${multiResponse.status}`);
                    }
                }

                return {
                    success: true,
                    columnId: String(columnId),
                    termId: String(termId),
                    refId: isListValue ? String(typeIdToAdd) : null
                };
            } catch (error) {
                console.error('Error in createColumn:', error);
                return { success: false, error: error.message };
            }
        }
