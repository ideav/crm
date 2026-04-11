        openFormFieldSettings(typeId, metadata) {
            const overlay = document.createElement('div');
            overlay.className = 'form-field-settings-overlay';

            const modal = document.createElement('div');
            modal.className = 'form-field-settings-modal';

            const visibleFields = this.loadFormFieldVisibility(typeId);
            const savedOrder = this.loadFormFieldOrder(typeId);
            const showDelete = this.loadFormShowDelete(typeId);

            // Sort requisites by saved order (if any), preserving original order for unsaved ones
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

            // Add draggable checkbox for each requisite
            sortedReqs.forEach(req => {
                const attrs = this.parseAttrs(req.attrs);
                const fieldName = attrs.alias || req.val;
                const fieldId = req.id;
                const isChecked = visibleFields[fieldId] !== false;

                modalHtml += `
                    <div class="form-field-settings-item" draggable="true" data-field-id="${ fieldId }">
                        <label>
                            <span class="drag-handle">☰</span>
                            <input type="checkbox"
                                   class="form-field-visibility-checkbox"
                                   data-field-id="${ fieldId }"
                                   ${ isChecked ? 'checked' : '' }>
                            <span>${ fieldName }</span>
                        </label>
                    </div>
                `;
            });

            modalHtml += `
                    </div>
                </div>
                <div class="form-field-settings-extra">
                    <label>
                        <input type="checkbox" id="form-show-delete-checkbox" ${ showDelete ? 'checked' : '' }>
                        <span>Показывать кнопку «Удалить»</span>
                    </label>
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

            // Attach handlers
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

            // Close on Escape key (issue #595)
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
                this.saveFormFieldVisibility(typeId, visibility);

                // Save field order
                const items = modal.querySelectorAll('.form-field-settings-item');
                const order = Array.from(items).map(item => item.dataset.fieldId);
                this.saveFormFieldOrder(typeId, order);

                // Save show delete setting
                const showDeleteCheckbox = modal.querySelector('#form-show-delete-checkbox');
                this.saveFormShowDelete(typeId, showDeleteCheckbox.checked);

                closeModal();

                // Apply settings to the edit form if it's open
                const editFormModal = document.querySelector('.edit-form-modal');
                if (editFormModal) {
                    this.applyFormFieldSettings(editFormModal, typeId);

                    // Update delete button visibility
                    const deleteBtn = editFormModal.querySelector('#delete-record-btn');
                    if (deleteBtn) {
                        deleteBtn.style.display = showDeleteCheckbox.checked ? '' : 'none';
                    }
                }
            });
        }

        saveFormFieldVisibility(typeId, visibility) {
            const cookieName = `${ this.options.cookiePrefix }-form-fields-${ typeId }`;
            document.cookie = `${ cookieName }=${ JSON.stringify(visibility) }; path=/; max-age=31536000`;
        }

        loadFormFieldVisibility(typeId) {
            const cookieName = `${ this.options.cookiePrefix }-form-fields-${ typeId }`;
            const cookies = document.cookie.split(';');
            const fieldsCookie = cookies.find(c => c.trim().startsWith(`${ cookieName }=`));

            if (fieldsCookie) {
                try {
                    const visibility = JSON.parse(fieldsCookie.split('=')[1]);
                    return visibility;
                } catch (error) {
                    console.error('Error parsing form field visibility settings:', error);
                    return {};
                }
            }

            return {}; // Default: all fields visible
        }

        saveFormFieldOrder(typeId, order) {
            const cookieName = `${ this.options.cookiePrefix }-form-order-${ typeId }`;
            document.cookie = `${ cookieName }=${ JSON.stringify(order) }; path=/; max-age=31536000`;
        }

        loadFormFieldOrder(typeId) {
            const cookieName = `${ this.options.cookiePrefix }-form-order-${ typeId }`;
            const cookies = document.cookie.split(';');
            const cookie = cookies.find(c => c.trim().startsWith(`${ cookieName }=`));
            if (cookie) {
                try {
                    return JSON.parse(cookie.split('=')[1]);
                } catch (e) {
                    return [];
                }
            }
            return [];
        }

        applyFormFieldSettings(modal, typeId) {
            const visibility = this.loadFormFieldVisibility(typeId);
            const order = this.loadFormFieldOrder(typeId);

            // Apply visibility
            Object.entries(visibility).forEach(([fieldId, isVisible]) => {
                if (!isVisible) {
                    const formGroup = modal.querySelector(`#field-${ fieldId }`)?.closest('.form-group');
                    if (formGroup) {
                        formGroup.style.display = 'none';
                    }
                } else {
                    const formGroup = modal.querySelector(`#field-${ fieldId }`)?.closest('.form-group');
                    if (formGroup) {
                        formGroup.style.display = '';
                    }
                }
            });

            // Apply field order by reordering form-group elements within the form
            if (order.length > 0) {
                const form = modal.querySelector('#edit-form');
                if (form) {
                    const tabContent = form.querySelector('[data-tab-content="attributes"]') || form;
                    const formGroups = Array.from(tabContent.querySelectorAll('.form-group'));

                    // Build a map of fieldId -> form-group element
                    const groupMap = {};
                    formGroups.forEach(group => {
                        // Find the field input inside to get its ID.
                        // Prefer hidden inputs (name^="t") which carry the canonical field ID,
                        // because FILE-type fields have a type="file" input with id="field-{id}-file"
                        // that appears before the hidden input id="field-{id}" (issue #1526).
                        let input = group.querySelector('input[type="hidden"][id^="field-"], input[id^="field-"]:not([type="file"])');
                        if (!input) {
                            input = group.querySelector('[id^="field-"]');
                        }
                        if (input) {
                            const match = input.id.match(/^field-(.+?)(-search|-picker|-file)?$/);
                            if (match) {
                                groupMap[match[1]] = group;
                            }
                        }
                    });

                    // Ensure the first column (main field) is always at the top.
                    const mainGroup = groupMap['main'];
                    const orderedGroups = [];
                    if (mainGroup) {
                        orderedGroups.push(mainGroup);
                    }

                    // Build the natural DOM order of non-main groups (the order produced by
                    // renderAttributesForm, which already interpolates unsaved fields at their
                    // correct metadata positions - issue #1526).
                    const nonMainGroups = formGroups.filter(g => g !== mainGroup);
                    const nonMainKeys = nonMainGroups.map(group => {
                        let input = group.querySelector('input[type="hidden"][id^="field-"], input[id^="field-"]:not([type="file"])');
                        if (!input) input = group.querySelector('[id^="field-"]');
                        if (input) {
                            const match = input.id.match(/^field-(.+?)(-search|-picker|-file)?$/);
                            return match ? match[1] : null;
                        }
                        return null;
                    });

                    // Assign sort keys to non-main groups using the same interpolation logic as
                    // renderAttributesForm (issue #1531): saved fields get integer keys, unsaved
                    // fields get fractional keys placing them before their next saved neighbor in
                    // natural DOM order, so they appear at approximately the right position.
                    const scale = nonMainGroups.length + 1;
                    const savedIndex = new Map();
                    nonMainKeys.forEach(key => {
                        if (key !== null) savedIndex.set(key, order.indexOf(key));
                    });

                    const sortKey = new Map();
                    nonMainGroups.forEach((group, natIdx) => {
                        const key = nonMainKeys[natIdx];
                        if (key === null) {
                            sortKey.set(group, natIdx + 1);  // fallback: preserve original position
                            return;
                        }
                        const idx = savedIndex.get(key);
                        if (idx !== -1) {
                            sortKey.set(group, idx * scale);
                        } else {
                            // Find nearest saved successor in natural DOM order
                            let nextSavedIdx = order.length;
                            for (let i = natIdx + 1; i < nonMainGroups.length; i++) {
                                const k = nonMainKeys[i];
                                if (k !== null) {
                                    const si = savedIndex.get(k);
                                    if (si !== -1) { nextSavedIdx = si; break; }
                                }
                            }
                            sortKey.set(group, nextSavedIdx * scale - scale + natIdx + 1);
                        }
                    });

                    nonMainGroups.sort((a, b) => sortKey.get(a) - sortKey.get(b));
                    nonMainGroups.forEach(g => orderedGroups.push(g));

                    // Also append any groups that had no field input at all (no key)
                    formGroups.forEach(group => {
                        if (!orderedGroups.includes(group)) {
                            orderedGroups.push(group);
                        }
                    });

                    // Re-append in order (moves existing DOM nodes)
                    orderedGroups.forEach(group => {
                        tabContent.appendChild(group);
                    });
                }
            }
        }

        async saveRecord(modal, isCreate, recordId, typeId, parentId, columnId = null) {
            const form = modal.querySelector('#edit-form');

            if (!form.checkValidity()) {
                form.reportValidity();
                return;
            }

            const apiBase = this.getApiBase();

            try {
                // Step 1: Prepare form data for save
                const fileUploads = modal.querySelectorAll('.form-file-upload');
                let hasNewFiles = false;

                // Check if there are new files to upload
                for (const uploadContainer of fileUploads) {
                    const reqId = uploadContainer.dataset.reqId;
                    const hiddenInput = uploadContainer.querySelector(`#field-${ reqId }`);
                    if (hiddenInput.dataset.hasNewFile === 'true' && uploadContainer._fileToUpload) {
                        hasNewFiles = true;
                        break;
                    }
                }

                // Use FormData if there are file uploads, URLSearchParams otherwise
                let requestBody;
                let headers = {};

                if (hasNewFiles) {
                    // Use FormData for file uploads
                    const formData = new FormData(form);
                    requestBody = new FormData();

                    // Add XSRF token
                    if (typeof xsrf !== 'undefined') {
                        requestBody.append('_xsrf', xsrf);
                    }

                    // Get main value
                    const mainValue = formData.get('main');

                    // Add main value as t{typeId}
                    if (isCreate) {
                        if (mainValue !== '' && mainValue !== null && mainValue !== undefined) {
                            requestBody.append(`t${ typeId }`, mainValue);
                        }
                    } else {
                        requestBody.append(`t${ typeId }`, mainValue);
                    }

                    // Add all form fields
                    for (const [key, value] of formData.entries()) {
                        if (key === 'main') continue;

                        // Check if this is a file field
                        const fieldMatch = key.match(/^t(\d+)$/);
                        if (fieldMatch) {
                            const reqId = fieldMatch[1];
                            const uploadContainer = modal.querySelector(`.form-file-upload[data-req-id="${ reqId }"]`);

                            if (uploadContainer) {
                                const hiddenInput = uploadContainer.querySelector(`#field-${ reqId }`);

                                // If there's a new file to upload
                                if (hiddenInput.dataset.hasNewFile === 'true' && uploadContainer._fileToUpload) {
                                    requestBody.append(key, uploadContainer._fileToUpload);
                                    continue;
                                }

                                // If file was deleted, send empty value to signal deletion via save
                                if (hiddenInput.dataset.fileDeleted === 'true') {
                                    requestBody.append(key, '');
                                    continue;
                                }

                                // If it's an existing file, don't include it in the save
                                const originalValue = uploadContainer.dataset.originalValue || '';
                                if (originalValue && hiddenInput.dataset.hasNewFile !== 'true') {
                                    continue;
                                }
                            }
                        }

                        // Add non-file fields
                        if (isCreate) {
                            if (value !== '' && value !== null && value !== undefined) {
                                requestBody.append(key, value);
                            }
                        } else {
                            requestBody.append(key, value);
                        }
                    }
                } else {
                    // Use URLSearchParams for non-file submissions
                    const formData = new FormData(form);
                    const params = new URLSearchParams();

                    // Add XSRF token
                    if (typeof xsrf !== 'undefined') {
                        params.append('_xsrf', xsrf);
                    }

                    // Get main value
                    const mainValue = formData.get('main');

                    // Add all form fields (skip 'main' since it's handled separately as t{typeId})
                    for (const [key, value] of formData.entries()) {
                        if (key === 'main') continue;

                        // Skip file fields that haven't changed
                        const fieldMatch = key.match(/^t(\d+)$/);
                        if (fieldMatch) {
                            const reqId = fieldMatch[1];
                            const uploadContainer = modal.querySelector(`.form-file-upload[data-req-id="${ reqId }"]`);

                            if (uploadContainer) {
                                const originalValue = uploadContainer.dataset.originalValue || '';
                                const hiddenInput = uploadContainer.querySelector(`#field-${ reqId }`);

                                // Skip existing unchanged files; deleted files pass through with empty value
                                if (originalValue && hiddenInput.dataset.hasNewFile !== 'true' && hiddenInput.dataset.fileDeleted !== 'true') {
                                    continue;
                                }
                            }
                        }

                        if (isCreate) {
                            if (value !== '' && value !== null && value !== undefined) {
                                params.append(key, value);
                            }
                        } else {
                            params.append(key, value);
                        }
                    }

                    if (isCreate) {
                        if (mainValue !== '' && mainValue !== null && mainValue !== undefined) {
                            params.append(`t${ typeId }`, mainValue);
                        }
                    } else {
                        params.append(`t${ typeId }`, mainValue);
                    }

                    requestBody = params.toString();
                    headers['Content-Type'] = 'application/x-www-form-urlencoded';
                }

                // Step 2: Save the record
                let url;
                if (isCreate) {
                    url = `${ apiBase }/_m_new/${ typeId }?JSON&up=${ parentId || 1 }`;
                } else {
                    url = `${ apiBase }/_m_save/${ recordId }?JSON`;
                }

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
                    // If not JSON, check if it's an error message
                    if (text.includes('error') || !response.ok) {
                        throw new Error(text);
                    }
                    // Otherwise treat as success
                    result = { success: true };
                }

                const serverError = this.getServerError(result);
                if (serverError) {
                    throw new Error(serverError);
                }

                // Check for warning - show modal and stay in edit mode
                // Pass result.obj to show a link to the existing/found record if available
                if (result.warning) {
                    this.showWarningModal(result.warning, result.id || null);
                    return;
                }

                // Check for warnings (plural) - show modal but continue with save (issue #610)
                // These are informational warnings that don't block the save
                if (result.warnings) {
                    this.showWarningsModal(result.warnings);
                }

                // Close modal
                modal.remove();
                if (modal._overlayElement) {
                    modal._overlayElement.remove();
                }
                window._integramModalDepth = Math.max(0, (window._integramModalDepth || 1) - 1);

                // Show success message
                this.showToast('Запись успешно сохранена', 'success');

                // Dispatch event for external listeners
                const savedId = isCreate ? (result.id || result.i || null) : recordId;
                document.dispatchEvent(new CustomEvent('integram-record-saved', {
                    detail: { isCreate, recordId: savedId, typeId, result }
                }));

                // Check if we edited a record from a subordinate table
                let refreshedSubordinateTable = false;
                if (!isCreate && this.currentEditModal && this.currentEditModal.subordinateTables) {
                    // Find which subordinate table this record belongs to (by matching typeId with arr_id)
                    const subordinateTable = this.currentEditModal.subordinateTables.find(st => st.arr_id === typeId);

                    if (subordinateTable) {
                        // Reload the specific subordinate table
                        const tabContent = this.currentEditModal.modal.querySelector(`[data-tab-content="sub-${ subordinateTable.id }"]`);
                        if (tabContent) {
                            tabContent.dataset.loaded = '';
                            await this.loadSubordinateTable(tabContent, subordinateTable.arr_id, this.currentEditModal.recordId);
                            tabContent.dataset.loaded = 'true';
                            refreshedSubordinateTable = true;
                        }
                    }
                }

                // Check if we edited a record from a cell-opened subordinate table
                // Use == for type coercion since typeId from dataset is a string, while arrId may be a number
                if (!refreshedSubordinateTable && this.cellSubordinateContext && this.cellSubordinateContext.arrId == typeId) {
                    await this.loadSubordinateTable(this.cellSubordinateContext.container, this.cellSubordinateContext.arrId, this.cellSubordinateContext.parentRecordId);
                    refreshedSubordinateTable = true;
                }

                // If we didn't refresh a subordinate table, handle normal table refresh
                if (!refreshedSubordinateTable) {
                    // Handle special refresh for column header create
                    if (isCreate && columnId) {
                        // Extract created record ID from response
                        const createdId = result.id || result.i;

                        if (createdId) {
                            await this.refreshWithNewRecord(columnId, createdId);
                        } else {
                            // Fallback to full reload if no ID returned
                            this.data = [];
                            this.loadedRecords = 0;
                            this.hasMore = true;
                            this.totalRows = null;
                            await this.loadData(false);
                        }
                    } else {
                        // Normal reload for edit or regular create
                        this.data = [];
                        this.loadedRecords = 0;
                        this.hasMore = true;
                        this.totalRows = null;
                        await this.loadData(false);
                    }
                }

            } catch (error) {
                console.error('Error saving record:', error);
                this.showToast(`Ошибка сохранения: ${ error.message }`, 'error');
            }
        }

        async deleteRecord(modal, recordId, typeId) {
            // Show custom confirmation modal instead of native confirm()
            const confirmed = await this.showDeleteConfirmModal();
            if (!confirmed) {
                return;
            }

            const apiBase = this.getApiBase();

            try {
                const params = new URLSearchParams();
                if (typeof xsrf !== 'undefined') {
                    params.append('_xsrf', xsrf);
                }

                const response = await fetch(`${ apiBase }/_m_del/${ recordId }?JSON`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: params.toString()
                });

                if (!response.ok) {
                    throw new Error(`Ошибка удаления: ${ response.statusText }`);
                }

                // Close modal
                modal.remove();
                if (modal._overlayElement) {
                    modal._overlayElement.remove();
                }
                window._integramModalDepth = Math.max(0, (window._integramModalDepth || 1) - 1);

                this.showToast('Запись удалена', 'success');

                // Check if we deleted a record from a subordinate table and refresh it
                let refreshedSubordinateTable = false;
                if (this.currentEditModal && this.currentEditModal.subordinateTables) {
                    // Find which subordinate table this record belongs to (by matching typeId with arr_id)
                    const subordinateTable = this.currentEditModal.subordinateTables.find(st => st.arr_id === typeId);

                    if (subordinateTable) {
                        // Reload the specific subordinate table
                        const tabContent = this.currentEditModal.modal.querySelector(`[data-tab-content="sub-${ subordinateTable.id }"]`);
                        if (tabContent) {
                            tabContent.dataset.loaded = '';
                            await this.loadSubordinateTable(tabContent, subordinateTable.arr_id, this.currentEditModal.recordId);
                            tabContent.dataset.loaded = 'true';
                            refreshedSubordinateTable = true;
                        }
                    }
                }

                // Check if we deleted a record from a cell-opened subordinate table
                // Use == for type coercion since typeId from dataset is a string, while arrId may be a number
                if (!refreshedSubordinateTable && this.cellSubordinateContext && this.cellSubordinateContext.arrId == typeId) {
                    await this.loadSubordinateTable(this.cellSubordinateContext.container, this.cellSubordinateContext.arrId, this.cellSubordinateContext.parentRecordId);
                    refreshedSubordinateTable = true;
                }

                // If we didn't refresh a subordinate table, reload main table data
                if (!refreshedSubordinateTable) {
                    this.data = [];
                    this.loadedRecords = 0;
                    this.hasMore = true;
                    this.totalRows = null;
                    await this.loadData(false);
                }
            } catch (error) {
                console.error('Error deleting record:', error);
                this.showToast(`Ошибка удаления: ${ error.message }`, 'error');
            }
        }

        /**
         * Duplicate the current record: collect form data, optionally prompt for unique first-column value,
         * call _m_new with the same parent, then reopen the edit form for the newly created record.
         * Issue #1575
         */
        async duplicateRecord(modal, recordId, typeId, parentId, metadata) {
            // Check if this type has unique:"1" on the first column
            const isUnique = metadata && (metadata.unique === '1' || metadata.unique === 1 || metadata.unique === true);

            // Get current first-column value from form
            const form = modal.querySelector('#edit-form');
            if (!form) return;

            const formData = new FormData(form);
            const mainValue = formData.get('main');

            let newFirstColumnValue = mainValue;

            if (isUnique) {
                // Prompt user to enter a new value for the first (unique) column
                const prompted = await this.showDuplicateUniqueValueModal(mainValue);
                if (prompted === null) {
                    // User cancelled
                    return;
                }
                newFirstColumnValue = prompted;
            }

            const apiBase = this.getApiBase();

            try {
                // Build request body same as saveRecord (non-file variant)
                const params = new URLSearchParams();

                if (typeof xsrf !== 'undefined') {
                    params.append('_xsrf', xsrf);
                }

                // Add main value as t{typeId}
                if (newFirstColumnValue !== '' && newFirstColumnValue !== null && newFirstColumnValue !== undefined) {
                    params.append(`t${ typeId }`, newFirstColumnValue);
                }

                // Add all other form fields
                for (const [key, value] of formData.entries()) {
                    if (key === 'main') continue;
                    // Skip file fields (don't duplicate files by reference)
                    const fieldMatch = key.match(/^t(\d+)$/);
                    if (fieldMatch) {
                        const reqId = fieldMatch[1];
                        const uploadContainer = modal.querySelector(`.form-file-upload[data-req-id="${ reqId }"]`);
                        if (uploadContainer) continue; // skip file fields
                    }
                    if (value !== '' && value !== null && value !== undefined) {
                        params.append(key, value);
                    }
                }

                const url = `${ apiBase }/_m_new/${ typeId }?JSON&up=${ parentId || 1 }`;

                const response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: params.toString()
                });

                const text = await response.text();
                let result;
                try {
                    result = JSON.parse(text);
                } catch (e) {
                    if (!response.ok) throw new Error(text);
                    result = { success: true };
                }

                const serverError = this.getServerError(result);
                if (serverError) throw new Error(serverError);

                const newId = result.id || result.i || null;
                if (!newId) throw new Error('Сервер не вернул ID новой записи');

                // Close the current modal
                modal.remove();
                if (modal._overlayElement) {
                    modal._overlayElement.remove();
                }
                window._integramModalDepth = Math.max(0, (window._integramModalDepth || 1) - 1);
                if (this.currentEditModal && this.currentEditModal.modal === modal) {
                    this.currentEditModal = null;
                }

                this.showToast('Запись дублирована', 'success');

                // Reload table data
                this.data = [];
                this.loadedRecords = 0;
                this.hasMore = true;
                this.totalRows = null;
                await this.loadData(false);

                // Open edit form for the newly created record
                await this.openEditForm(newId, typeId, 0);

            } catch (error) {
                console.error('Error duplicating record:', error);
                this.showToast(`Ошибка дублирования: ${ error.message }`, 'error');
            }
        }

        /**
         * Show a modal dialog asking user to enter a new value for the unique first column before duplicating.
         * @param {string} currentValue - current value of the first column
         * @returns {Promise<string|null>} - new value entered by user, or null if cancelled
         */
        showDuplicateUniqueValueModal(currentValue) {
            return new Promise((resolve) => {
                const modalId = `duplicate-unique-${ Date.now() }`;
                const escapedValue = String(currentValue || '').replace(/"/g, '&quot;');
                const modalHtml = `
                    <div class="integram-modal-overlay" id="${ modalId }">
                        <div class="integram-modal" style="max-width: 440px;">
                            <div class="integram-modal-header">
                                <h3>Дублирование записи</h3>
                            </div>
                            <div class="integram-modal-body">
                                <p style="margin: 0 0 12px 0;">Поле первой колонки должно быть уникальным. Введите новое значение:</p>
                                <input type="text" id="duplicate-unique-input" class="form-control" value="${ escapedValue }" style="width:100%;">
                            </div>
                            <div class="integram-modal-footer">
                                <button type="button" class="btn btn-primary duplicate-unique-ok-btn" style="margin-right: 8px;">Дублировать</button>
                                <button type="button" class="btn btn-secondary duplicate-unique-cancel-btn">Отменить</button>
                            </div>
                        </div>
                    </div>
                `;
                document.body.insertAdjacentHTML('beforeend', modalHtml);

                const confirmModal = document.getElementById(modalId);
                const input = confirmModal.querySelector('#duplicate-unique-input');

                // Select all text for easy replacement
                input.focus();
                input.select();

                const cleanup = (result) => {
                    confirmModal.remove();
                    resolve(result);
                };

                confirmModal.querySelector('.duplicate-unique-ok-btn').addEventListener('click', () => {
                    cleanup(input.value);
                });
                confirmModal.querySelector('.duplicate-unique-cancel-btn').addEventListener('click', () => cleanup(null));

                // Enter key confirms
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') cleanup(input.value);
                    if (e.key === 'Escape') cleanup(null);
                });

                // Close on overlay click
                confirmModal.addEventListener('click', (e) => {
                    if (e.target === confirmModal) cleanup(null);
                });

                // Close on Escape key
                const handleEscape = (e) => {
                    if (e.key === 'Escape') {
                        document.removeEventListener('keydown', handleEscape);
                        cleanup(null);
                    }
                };
                document.addEventListener('keydown', handleEscape);
            });
        }

        /**
         * Show a custom modal confirmation dialog for delete action
         * @returns {Promise<boolean>} - true if user confirmed, false otherwise
         */
        showDeleteConfirmModal() {
            return new Promise((resolve) => {
                const modalId = `delete-confirm-${ Date.now() }`;
                const modalHtml = `
                    <div class="integram-modal-overlay" id="${ modalId }">
                        <div class="integram-modal" style="max-width: 400px;">
                            <div class="integram-modal-header">
                                <h3>Подтверждение удаления</h3>
                            </div>
                            <div class="integram-modal-body">
                                <p style="margin: 0;">Вы уверены, что хотите удалить эту запись?</p>
                            </div>
                            <div class="integram-modal-footer">
                                <button type="button" class="btn btn-danger delete-confirm-ok-btn" style="margin-right: 8px;">Удалить</button>
                                <button type="button" class="btn btn-secondary delete-confirm-cancel-btn">Отменить</button>
                            </div>
                        </div>
                    </div>
                `;
                document.body.insertAdjacentHTML('beforeend', modalHtml);

                const confirmModal = document.getElementById(modalId);

                const cleanup = (result) => {
                    confirmModal.remove();
                    resolve(result);
                };

                confirmModal.querySelector('.delete-confirm-ok-btn').addEventListener('click', () => cleanup(true));
                confirmModal.querySelector('.delete-confirm-cancel-btn').addEventListener('click', () => cleanup(false));

                // Close on overlay click (outside modal content)
                confirmModal.addEventListener('click', (e) => {
                    if (e.target === confirmModal) {
                        cleanup(false);
                    }
                });

                // Close on Escape key
                const handleEscape = (e) => {
                    if (e.key === 'Escape') {
                        document.removeEventListener('keydown', handleEscape);
                        cleanup(false);
                    }
                };
                document.addEventListener('keydown', handleEscape);
            });
        }

        saveFormShowDelete(typeId, show) {
            const cookieName = `${ this.options.cookiePrefix }-form-show-delete-${ typeId }`;
            document.cookie = `${ cookieName }=${ show ? '1' : '0' }; path=/; max-age=31536000`;
        }

        loadFormShowDelete(typeId) {
            const cookieName = `${ this.options.cookiePrefix }-form-show-delete-${ typeId }`;
            const cookies = document.cookie.split(';');
            const cookie = cookies.find(c => c.trim().startsWith(`${ cookieName }=`));
            if (cookie) {
                return cookie.split('=')[1].trim() === '1';
            }
            return false; // Hidden by default
        }

        async refreshWithNewRecord(columnId, createdRecordId) {
            try {
                // Fetch the new record using filter
                const params = new URLSearchParams({
                    LIMIT: '0,1',
                    [`FR_${ columnId }`]: createdRecordId
                });

                // Forward GET parameters from page URL (issue #476)
                this.appendPageUrlParams(params);

                const separator = this.options.apiUrl.includes('?') ? '&' : '?';
                const response = await fetch(`${ this.options.apiUrl }${ separator }${ params }`);
                const json = await response.json();

                let newRow = null;

                // Check if response is JSON_OBJ array format
                if (this.isJsonDataArrayFormat(json)) {
                    newRow = json[0].r || [];
                } else {
                    // Transform column-based data to row-based data
                    const columnData = json.data || [];

                    if (columnData.length > 0 && Array.isArray(columnData[0]) && columnData[0].length > 0) {
                        // Extract the first (and only) row
                        const row = [];
                        for (let colIndex = 0; colIndex < columnData.length; colIndex++) {
                            row.push(columnData[colIndex][0]);
                        }
                        newRow = row;
                    }
                }

                if (newRow) {
                    // Add the new record to the beginning of the data
                    this.data.unshift(newRow);
                    this.loadedRecords++;

                    // Update total count if known
                    if (this.totalRows !== null) {
                        this.totalRows++;
                    }

                    // Re-render the table
                    this.render();
                } else {
                    // Fallback: full reload if we couldn't fetch the new record
                    this.data = [];
                    this.loadedRecords = 0;
                    this.hasMore = true;
                    this.totalRows = null;
                    await this.loadData(false);
                }
            } catch (error) {
                console.error('Error fetching new record:', error);
                // Fallback to full reload on error
                this.data = [];
                this.loadedRecords = 0;
                this.hasMore = true;
                this.totalRows = null;
                await this.loadData(false);
            }
        }

