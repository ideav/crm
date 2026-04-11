        roundToNearest5Minutes(date) {
            // Round date to nearest 5 minutes
            const minutes = date.getMinutes();
            const roundedMinutes = Math.round(minutes / 5) * 5;
            date.setMinutes(roundedMinutes);
            date.setSeconds(0);
            date.setMilliseconds(0);
            return date;
        }

        formatDateForInput(value, includeTime = false) {
            // Convert date from various formats to DD.MM.YYYY or DD.MM.YYYY HH:MM:SS
            if (!value) return '';

            let date;
            // Try to parse DD.MM.YYYY or DD.MM.YYYY HH:MM:SS format first
            if (includeTime) {
                date = this.parseDDMMYYYYHHMMSS(value);
            } else {
                date = this.parseDDMMYYYY(value);
            }

            // If parsing failed, try YYYYMMDD format
            if (!date || isNaN(date.getTime())) {
                date = this.parseYYYYMMDD(value);
            }

            // If still failed, try standard Date constructor
            if (!date || isNaN(date.getTime())) {
                date = new Date(value);
                if (isNaN(date.getTime())) return value;  // Return as-is if not a valid date
            }

            const day = String(date.getDate()).padStart(2, '0');
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const year = date.getFullYear();

            if (includeTime) {
                const hours = String(date.getHours()).padStart(2, '0');
                const minutes = String(date.getMinutes()).padStart(2, '0');
                const seconds = String(date.getSeconds()).padStart(2, '0');
                return `${ day }.${ month }.${ year } ${ hours }:${ minutes }:${ seconds }`;
            }

            return `${ day }.${ month }.${ year }`;
        }

        formatDateForHtml5(value, includeTime = false) {
            // Convert date to HTML5 format: YYYY-MM-DD or YYYY-MM-DDTHH:MM
            if (!value) return '';

            let date;
            // Try to parse DD.MM.YYYY or DD.MM.YYYY HH:MM:SS format first
            if (includeTime) {
                date = this.parseDDMMYYYYHHMMSS(value);
            } else {
                date = this.parseDDMMYYYY(value);
            }

            // If parsing failed, try YYYYMMDD format
            if (!date || isNaN(date.getTime())) {
                date = this.parseYYYYMMDD(value);
            }

            // If still failed, try standard Date constructor
            if (!date || isNaN(date.getTime())) {
                date = new Date(value);
                if (isNaN(date.getTime())) return '';
            }

            // Round to 5 minutes if time is included
            if (includeTime) {
                date = this.roundToNearest5Minutes(date);
            }

            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');

            if (includeTime) {
                const hours = String(date.getHours()).padStart(2, '0');
                const minutes = String(date.getMinutes()).padStart(2, '0');
                return `${ year }-${ month }-${ day }T${ hours }:${ minutes }`;
            }

            return `${ year }-${ month }-${ day }`;
        }

        convertHtml5DateToDisplay(html5Value, includeTime = false) {
            // Convert HTML5 date format to display format
            if (!html5Value) return '';

            if (includeTime) {
                // YYYY-MM-DDTHH:MM(:SS) -> DD.MM.YYYY HH:MM:SS
                const [datePart, timePart] = html5Value.split('T');
                const [year, month, day] = datePart.split('-');
                // Ensure we have seconds (add :00 if not present)
                const timeParts = timePart.split(':');
                const hours = timeParts[0] || '00';
                const minutes = timeParts[1] || '00';
                const seconds = timeParts[2] || '00';
                return `${ day }.${ month }.${ year } ${ hours }:${ minutes }:${ seconds }`;
            } else {
                // YYYY-MM-DD -> DD.MM.YYYY
                const [year, month, day] = html5Value.split('-');
                return `${ day }.${ month }.${ year }`;
            }
        }

        attachFileUploadHandlers(editor, currentValue) {
            const fileInput = editor.querySelector('.file-input');
            const dropzone = editor.querySelector('.file-dropzone');
            const selectBtn = editor.querySelector('.file-select-btn');
            const preview = editor.querySelector('.file-preview');
            const fileName = editor.querySelector('.file-name');
            const removeBtn = editor.querySelector('.file-remove-btn');

            let selectedFile = null;

            // Show current file if exists
            if (currentValue && currentValue !== '') {
                fileName.textContent = currentValue.split('/').pop() || currentValue;
                dropzone.style.display = 'none';
                preview.style.display = 'flex';
                editor.dataset.fileValue = currentValue;
            }

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
                    await this.handleFileSelection(file, editor, dropzone, preview, fileName);
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
                    await this.handleFileSelection(file, editor, dropzone, preview, fileName);
                }
            });

            // Remove file button
            removeBtn.addEventListener('click', (e) => {
                e.preventDefault();
                selectedFile = null;
                editor.dataset.fileValue = '';
                fileName.textContent = '';
                dropzone.style.display = 'flex';
                preview.style.display = 'none';
                fileInput.value = '';
            });
        }

        async handleFileSelection(file, editor, dropzone, preview, fileName) {
            // Store file for direct submission to _m_set on save (issue #1310)
            editor._fileToUpload = file;
            editor.dataset.fileValue = file.name;
            // Update UI
            fileName.textContent = file.name;
            dropzone.style.display = 'none';
            preview.style.display = 'flex';
        }

        async uploadFile(file) {
            const apiBase = this.getApiBase();
            const formData = new FormData();
            formData.append('file', file);

            // Add XSRF token
            if (typeof xsrf !== 'undefined') {
                formData.append('_xsrf', xsrf);
            }

            const response = await fetch(`${ apiBase }/_upload`, {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                throw new Error(`Ошибка загрузки: ${ response.statusText }`);
            }

            const result = await response.json();

            if (result.error) {
                throw new Error(result.error);
            }

            // Return the file path from server response
            return result.path || result.file || result.filename;
        }

        escapeHtml(text) {
            if (text === null || text === undefined) return '';
            return String(text).replace(/&/g, '&amp;')
                              .replace(/</g, '&lt;')
                              .replace(/>/g, '&gt;')
                              .replace(/"/g, '&quot;')
                              .replace(/'/g, '&#039;');
        }

        /**
         * Convert URLs in already-HTML-escaped text to clickable hyperlinks (issue #947)
         * Input text must already be HTML-escaped; this method only wraps URL patterns
         * with anchor tags, preserving all other escaped content intact.
         *
         * @param {string} escapedText - HTML-escaped text that may contain URLs
         * @returns {string} - Text with URLs wrapped in <a> tags
         */
        linkifyText(escapedText) {
            if (!escapedText) return escapedText;
            // Match http/https URLs; stop at whitespace or common trailing punctuation
            return escapedText.replace(/(https?:\/\/[^\s<>"']+)/g, (url) => {
                // Strip trailing punctuation that is unlikely to be part of the URL
                const trailingPunct = url.match(/[.,;:!?)]+$/);
                const cleanUrl = trailingPunct ? url.slice(0, -trailingPunct[0].length) : url;
                const suffix = trailingPunct ? trailingPunct[0] : '';
                return `<a href="${cleanUrl}" target="_blank" rel="noopener noreferrer" class="cell-hyperlink" onclick="event.stopPropagation();">${cleanUrl}</a>${suffix}`;
            });
        }

        /**
         * Parse reference field value in "id:Value" format and return display value
         * For reference fields, values come as "id:DisplayText" where id is the record ID
         * This method extracts and returns only the DisplayText part for display/comparison
         * Issue #504: Handle reference values in grouping fields
         *
         * @param {string} value - The raw value, possibly in "id:Value" format
         * @param {Object} column - The column definition object
         * @returns {string} - The display value (without id: prefix for reference fields)
         */
        parseReferenceDisplayValue(value, column) {
            if (value === null || value === undefined) return '';

            const strValue = String(value);

            // Check if this is a reference field (has ref_id or non-zero ref)
            // or a GRANT/REPORT_COLUMN field which also uses "id:Value" format (issue #925)
            const isRefField = column && (column.ref_id != null || (column.ref && column.ref !== 0));
            const columnFormat = column && column.format ? String(column.format).toUpperCase() : '';
            const isGrantOrReportColumn = columnFormat === 'GRANT' || columnFormat === 'REPORT_COLUMN';

            if ((isRefField || isGrantOrReportColumn) && strValue) {
                const colonIndex = strValue.indexOf(':');
                if (colonIndex > 0) {
                    // Return only the display value part (after the colon)
                    return strValue.substring(colonIndex + 1);
                }
            }

            return strValue;
        }

        showToast(message, type = 'info') {
            // Remove existing toasts
            const existingToasts = document.querySelectorAll('.integram-toast');
            existingToasts.forEach(toast => toast.remove());

            const toast = document.createElement('div');
            toast.className = `integram-toast integram-toast-${ type }`;
            toast.textContent = message;

            document.body.appendChild(toast);

            // Auto-remove after 5 seconds
            setTimeout(() => {
                toast.classList.add('fade-out');
                setTimeout(() => toast.remove(), 300);
            }, 5000);

            // Click to dismiss
            toast.addEventListener('click', () => {
                toast.classList.add('fade-out');
                setTimeout(() => toast.remove(), 300);
            });
        }

        /**
         * Copy record ID to clipboard (issue #563)
         * @param {string} recordId - The record ID to copy
         */
        copyRecordIdToClipboard(recordId) {
            if (!recordId) return;

            navigator.clipboard.writeText(String(recordId)).then(() => {
                this.showToast(`ID #${recordId} скопирован`, 'success');
            }).catch(err => {
                console.error('Failed to copy record ID:', err);
                this.showToast('Не удалось скопировать ID', 'error');
            });
        }

        showWarningModal(message, objId = null) {
            const modalId = `warning-modal-${ Date.now() }`;
            const apiBase = this.getApiBase();

            // Build link HTML if objId is provided
            let linkHtml = '';
            if (objId) {
                const editUrl = `${ apiBase }/edit_obj/${ objId }`;
                linkHtml = `
                    <a href="${ editUrl }" target="_blank" class="integram-modal-link">
                        Открыть найденную запись ↗
                    </a>
                `;
            }

            const modalHtml = `
                <div class="integram-modal-overlay" id="${ modalId }">
                    <div class="integram-modal" style="max-width: 500px;">
                        <div class="integram-modal-header">
                            <h3>Предупреждение</h3>
                        </div>
                        <div class="integram-modal-body">
                            <div class="alert alert-warning" style="margin: 0;">
                                ${ this.escapeHtml(message) }
                            </div>
                            ${ linkHtml }
                        </div>
                        <div class="integram-modal-footer" style="padding: 15px; text-align: right;">
                            <button type="button" class="btn btn-primary" data-close-warning-modal="true">OK</button>
                        </div>
                    </div>
                </div>
            `;
            document.body.insertAdjacentHTML('beforeend', modalHtml);

            const overlay = document.getElementById(modalId);
            const closeBtn = overlay.querySelector('[data-close-warning-modal="true"]');

            closeBtn.addEventListener('click', () => {
                overlay.remove();
            });

            // Also close on click outside the modal
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    overlay.remove();
                }
            });

            // Close on Escape key (issue #595)
            const handleEscape = (e) => {
                if (e.key === 'Escape') {
                    overlay.remove();
                    document.removeEventListener('keydown', handleEscape);
                }
            };
            document.addEventListener('keydown', handleEscape);
        }

        /**
         * Show warnings modal for informational warnings after save (issue #610)
         * Unlike showWarningModal, this doesn't block the save operation
         * @param {string} message - The warning message (may contain basic HTML like <br>)
         */
        showWarningsModal(message) {
            const modalId = `warnings-modal-${ Date.now() }`;

            // Sanitize HTML - allow only safe tags like <br>, strip others
            const sanitizedMessage = this.sanitizeWarningHtml(message);

            const modalHtml = `
                <div class="integram-modal-overlay" id="${ modalId }">
                    <div class="integram-modal" style="max-width: 500px;">
                        <div class="integram-modal-header">
                            <h3>Предупреждение</h3>
                        </div>
                        <div class="integram-modal-body">
                            <div class="alert alert-warning" style="margin: 0;">
                                ${ sanitizedMessage }
                            </div>
                        </div>
                        <div class="integram-modal-footer" style="padding: 15px; text-align: right;">
                            <button type="button" class="btn btn-primary" data-close-warnings-modal="true">OK</button>
                        </div>
                    </div>
                </div>
            `;
            document.body.insertAdjacentHTML('beforeend', modalHtml);

            const overlay = document.getElementById(modalId);
            const closeBtn = overlay.querySelector('[data-close-warnings-modal="true"]');

            closeBtn.addEventListener('click', () => {
                overlay.remove();
            });

            // Also close on click outside the modal
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    overlay.remove();
                }
            });

            // Close on Escape key
            const handleEscape = (e) => {
                if (e.key === 'Escape') {
                    overlay.remove();
                    document.removeEventListener('keydown', handleEscape);
                }
            };
            document.addEventListener('keydown', handleEscape);
        }

        /**
         * Sanitize HTML for warning messages - allows basic formatting tags (issue #610)
         * @param {string} html - The HTML string to sanitize
         * @returns {string} - Sanitized HTML string
         */
        sanitizeWarningHtml(html) {
            if (html === null || html === undefined) return '';

            // Convert to string
            let str = String(html);

            // First, escape all HTML
            str = str.replace(/&/g, '&amp;')
                     .replace(/</g, '&lt;')
                     .replace(/>/g, '&gt;')
                     .replace(/"/g, '&quot;')
                     .replace(/'/g, '&#039;');

            // Then, selectively un-escape safe tags: <br>, <br/>, <br />
            str = str.replace(/&lt;br\s*\/?&gt;/gi, '<br>');

            return str;
        }

        /**
         * Toggle checkbox selection mode
         */
