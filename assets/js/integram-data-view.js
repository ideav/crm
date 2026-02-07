/**
 * IntegramDataView Component
 *
 * A completely isolated, modular JavaScript component for displaying and managing
 * Integram API data in tabular format. This is a standalone product that can be
 * integrated into any web application independently.
 *
 * ============================================================================
 * ARCHITECTURE OVERVIEW
 * ============================================================================
 *
 * This component is divided into three main modules:
 *
 * 1. IntegramTables  - Handles data from object/{table_type_id} endpoints
 * 2. IntegramReports - Handles data from report/{report_id} endpoints
 * 3. IntegramControls - Shared utilities, forms, and common functionality
 *
 * Each module is designed to work independently or together, providing maximum
 * flexibility and maintainability.
 *
 * ============================================================================
 * FEATURES
 * ============================================================================
 *
 * Core Features:
 * - Multiple data sources (tables and reports)
 * - Infinite scroll pagination
 * - Advanced filtering (13+ operators)
 * - Inline editing with multiple data types
 * - Reference field management with autocomplete
 * - Drag & drop column reordering
 * - Column visibility controls
 * - Cookie-based state persistence
 * - Custom cell styling
 * - Responsive design with sticky headers
 * - Compact/spacious view modes
 * - Dynamic column creation
 *
 * Data Type Support:
 * - Text (CHARS, SHORT, MEMO)
 * - Numbers (NUMBER, SIGNED)
 * - Dates (DATE, DATETIME)
 * - References (foreign keys with autocomplete)
 * - Booleans (checkboxes)
 *
 * ============================================================================
 * USAGE EXAMPLES
 * ============================================================================
 *
 * Example 1: Display data from a report
 * ```javascript
 * const reportView = new IntegramReports('container-id', {
 *     apiUrl: 'https://api.integram.ru/report/123',
 *     title: 'Sales Report',
 *     pageSize: 50
 * });
 * ```
 *
 * Example 2: Display data from a table type
 * ```javascript
 * const tableView = new IntegramTables('container-id', {
 *     apiUrl: 'https://api.integram.ru',
 *     tableTypeId: 456,
 *     parentId: 789,
 *     title: 'Product Catalog'
 * });
 * ```
 *
 * Example 3: Use shared controls independently
 * ```javascript
 * IntegramControls.formatDate('20260207', 'DATE');
 * IntegramControls.escapeHtml('<script>alert("xss")</script>');
 * ```
 *
 * ============================================================================
 * API INTEGRATION
 * ============================================================================
 *
 * The component expects Integram API responses in the following formats:
 *
 * For Tables (object/{table_type_id}):
 * - Metadata endpoint: /type/{type_id}/?JSON_DATA
 * - Data endpoint: /object/{type_id}/?JSON_DATA&F_U={parent_id}
 *
 * For Reports (report/{report_id}):
 * - Data endpoint: /report/{report_id}?parameters...
 *
 * ============================================================================
 * DEPENDENCIES
 * ============================================================================
 *
 * Required:
 * - Modern browser with ES6+ support
 * - Fetch API support
 * - CSS file: integram-data-view.css
 *
 * Optional:
 * - Bootstrap 4+ for enhanced styling (falls back gracefully)
 *
 * ============================================================================
 * LICENSE & COPYRIGHT
 * ============================================================================
 *
 * This is a standalone component designed for the Integram platform.
 * Can be used independently in any web application with proper attribution.
 *
 * @version 1.0.0
 * @author AI Issue Solver
 * @date 2026-02-07
 */

// ============================================================================
// MODULE 3: IntegramControls - Shared Utilities and Common Functions
// ============================================================================

/**
 * IntegramControls provides shared functionality used by both IntegramTables
 * and IntegramReports modules. This includes utilities for data formatting,
 * HTML escaping, cookie management, form rendering, and other common operations.
 *
 * This module can be used independently for utility functions without
 * instantiating the full table or report components.
 */
class IntegramControls {
    /**
     * HTML escape utility to prevent XSS attacks
     * @param {string} text - Text to escape
     * @returns {string} Escaped HTML string
     */
    static escapeHtml(text) {
        if (text === null || text === undefined) return '';
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return String(text).replace(/[&<>"']/g, m => map[m]);
    }

    /**
     * Format date values based on type
     * @param {string} value - Date value to format
     * @param {string} format - Format type (DATE, DATETIME)
     * @returns {string} Formatted date string
     */
    static formatDate(value, format) {
        if (!value) return '';

        // Parse YYYYMMDD or YYYYMMDDHHMMSS format
        if (format === 'DATE' && value.length === 8) {
            const year = value.substring(0, 4);
            const month = value.substring(4, 6);
            const day = value.substring(6, 8);
            return `${day}.${month}.${year}`;
        }

        if (format === 'DATETIME' && value.length >= 12) {
            const year = value.substring(0, 4);
            const month = value.substring(4, 6);
            const day = value.substring(6, 8);
            const hour = value.substring(8, 10);
            const minute = value.substring(10, 12);
            return `${day}.${month}.${year} ${hour}:${minute}`;
        }

        return value;
    }

    /**
     * Convert display date format to HTML5 date input format
     * @param {string} displayValue - Date in DD.MM.YYYY format
     * @param {boolean} includeTime - Whether to include time
     * @returns {string} Date in YYYY-MM-DD or YYYY-MM-DDTHH:MM format
     */
    static convertDisplayToHtml5Date(displayValue, includeTime = false) {
        if (!displayValue) return '';

        if (includeTime) {
            const match = displayValue.match(/(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})/);
            if (match) {
                return `${match[3]}-${match[2]}-${match[1]}T${match[4]}:${match[5]}`;
            }
        } else {
            const match = displayValue.match(/(\d{2})\.(\d{2})\.(\d{4})/);
            if (match) {
                return `${match[3]}-${match[2]}-${match[1]}`;
            }
        }

        return displayValue;
    }

    /**
     * Convert HTML5 date input format to Integram API format
     * @param {string} html5Value - Date in YYYY-MM-DD or YYYY-MM-DDTHH:MM format
     * @param {boolean} includeTime - Whether to include time
     * @returns {string} Date in YYYYMMDD or YYYYMMDDHHMMSS format
     */
    static convertHtml5DateToApi(html5Value, includeTime = false) {
        if (!html5Value) return '';

        if (includeTime) {
            const match = html5Value.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
            if (match) {
                return `${match[1]}${match[2]}${match[3]}${match[4]}${match[5]}00`;
            }
        } else {
            const match = html5Value.match(/(\d{4})-(\d{2})-(\d{2})/);
            if (match) {
                return `${match[1]}${match[2]}${match[3]}`;
            }
        }

        return html5Value;
    }

    /**
     * Get cookie value by name
     * @param {string} name - Cookie name
     * @returns {string|null} Cookie value or null
     */
    static getCookie(name) {
        const value = `; ${document.cookie}`;
        const parts = value.split(`; ${name}=`);
        if (parts.length === 2) return parts.pop().split(';').shift();
        return null;
    }

    /**
     * Set cookie with name and value
     * @param {string} name - Cookie name
     * @param {string} value - Cookie value
     * @param {number} days - Expiration in days (default: 365)
     */
    static setCookie(name, value, days = 365) {
        const expires = new Date(Date.now() + days * 864e5).toUTCString();
        document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/`;
    }

    /**
     * Truncate long text values with ellipsis
     * @param {string} text - Text to truncate
     * @param {number} maxLength - Maximum length (default: 127)
     * @returns {object} Object with truncated text and isTruncated flag
     */
    static truncateText(text, maxLength = 127) {
        if (!text || text.length <= maxLength) {
            return { text: text || '', isTruncated: false };
        }
        return {
            text: text.substring(0, maxLength),
            isTruncated: true,
            fullText: text
        };
    }

    /**
     * Extract base URL from API URL
     * @param {string} apiUrl - Full API URL
     * @returns {string} Base URL
     */
    static extractApiBase(apiUrl) {
        try {
            const url = new URL(apiUrl);
            return `${url.protocol}//${url.host}`;
        } catch (e) {
            // If URL parsing fails, try to extract manually
            const match = apiUrl.match(/^(https?:\/\/[^\/]+)/);
            return match ? match[1] : apiUrl;
        }
    }

    /**
     * Debounce function to limit function call frequency
     * @param {Function} func - Function to debounce
     * @param {number} wait - Wait time in milliseconds
     * @returns {Function} Debounced function
     */
    static debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    /**
     * Generate unique instance name for global scope
     * @param {string} prefix - Prefix for instance name
     * @returns {string} Unique instance name
     */
    static generateInstanceName(prefix = 'integramView') {
        return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Parse filter operators and generate API parameters
     * @param {object} column - Column definition
     * @param {object} filter - Filter configuration
     * @param {object} filterTypes - Available filter types
     * @returns {string} API parameter string
     */
    static parseFilter(column, filter, filterTypes) {
        const type = filter.type || '^';
        const value = filter.value;
        const colId = column.id;
        const format = column.format || column.type;

        const filterGroup = filterTypes[format] || filterTypes['SHORT'];
        const filterDef = filterGroup.find(f => f.symbol === type);

        if (!filterDef) return '';

        if (type === '...' && value.includes('|')) {
            const [x1, x2] = value.split('|');
            return filterDef.format
                .replace(/\{ T \}/g, colId)
                .replace('{ X1 }', x1.trim())
                .replace('{ X2 }', x2.trim());
        } else {
            return filterDef.format
                .replace(/\{ T \}/g, colId)
                .replace(/\{ X \}/g, value);
        }
    }

    /**
     * Render modal overlay for forms
     * @param {string} title - Modal title
     * @param {string} content - Modal HTML content
     * @param {Function} onClose - Callback when modal is closed
     * @returns {HTMLElement} Modal overlay element
     */
    static renderModal(title, content, onClose) {
        const overlay = document.createElement('div');
        overlay.className = 'integram-modal-overlay';

        const modal = document.createElement('div');
        modal.className = 'integram-modal';

        modal.innerHTML = `
            <div class="integram-modal-header">
                <h3>${IntegramControls.escapeHtml(title)}</h3>
                <button class="integram-modal-close">&times;</button>
            </div>
            <div class="integram-modal-body">
                ${content}
            </div>
        `;

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        // Close handlers
        const closeBtn = modal.querySelector('.integram-modal-close');
        const closeHandler = () => {
            document.body.removeChild(overlay);
            if (onClose) onClose();
        };

        closeBtn.addEventListener('click', closeHandler);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeHandler();
        });

        return overlay;
    }

    /**
     * Show loading indicator
     * @param {HTMLElement} container - Container element
     * @param {string} message - Loading message
     */
    static showLoading(container, message = 'Загрузка...') {
        container.innerHTML = `
            <div class="integram-loading">
                <div class="integram-spinner"></div>
                <div class="integram-loading-text">${IntegramControls.escapeHtml(message)}</div>
            </div>
        `;
    }

    /**
     * Show error message
     * @param {HTMLElement} container - Container element
     * @param {string} message - Error message
     */
    static showError(container, message) {
        container.innerHTML = `
            <div class="integram-error">
                <div class="integram-error-icon">⚠</div>
                <div class="integram-error-text">${IntegramControls.escapeHtml(message)}</div>
            </div>
        `;
    }
}

// ============================================================================
// BASE CLASS: IntegramDataView - Common functionality for both modules
// ============================================================================

/**
 * Base class providing common functionality for both IntegramTables and IntegramReports.
 * This class should not be instantiated directly; use IntegramTables or IntegramReports instead.
 */
class IntegramDataView {
    constructor(containerId, options = {}) {
        IntegramDebug.log('DataView', `Constructor called for container: ${containerId}`);

        this.container = document.getElementById(containerId);
        if (!this.container) {
            const errorMsg = `Container element with id "${containerId}" not found`;
            IntegramDebug.error('DataView', errorMsg);
            throw new Error(errorMsg);
        }

        IntegramDebug.verbose('DataView', `Container element found:`, this.container);

        // Check URL parameters for parentId
        const urlParams = new URLSearchParams(window.location.search);
        const urlParentId = urlParams.get('parentId') || urlParams.get('F_U') || urlParams.get('up');

        this.options = {
            apiUrl: options.apiUrl || '',
            pageSize: options.pageSize || 20,
            cookiePrefix: options.cookiePrefix || 'integram-view',
            title: options.title || '',
            instanceName: options.instanceName || IntegramControls.generateInstanceName(),
            onCellClick: options.onCellClick || null,
            onDataLoad: options.onDataLoad || null,
            parentId: options.parentId || urlParentId || null
        };

        // Data management
        this.columns = [];
        this.data = [];
        this.loadedRecords = 0;
        this.totalRows = null;
        this.hasMore = true;
        this.isLoading = false;

        // UI state
        this.filters = {};
        this.columnOrder = [];
        this.visibleColumns = [];
        this.filtersEnabled = false;
        this.columnWidths = {};
        this.currentEditingCell = null;

        // Metadata and styling
        this.styleColumns = {};
        this.idColumns = new Set();
        this.editableColumns = new Map();
        this.metadataCache = {};
        this.globalMetadata = null;

        // Table settings
        this.settings = {
            compact: false,
            pageSize: this.options.pageSize,
            truncateLongValues: true
        };

        // Filter operator definitions
        this.filterTypes = {
            'CHARS': [
                { symbol: '^', name: 'начинается с...', format: 'FR_{ T }={ X }%' },
                { symbol: '=', name: 'равно', format: 'FR_{ T }={ X }' },
                { symbol: '≠', name: 'не равно', format: 'FR_{ T }=!{ X }' },
                { symbol: '~', name: 'содержит', format: 'FR_{ T }=%{ X }%' },
                { symbol: '!', name: 'не содержит', format: 'FR_{ T }=!%{ X }%' },
                { symbol: '!^', name: 'не начинается', format: 'FR_{ T }=!%{ X }' },
                { symbol: '%', name: 'не пустое', format: 'FR_{ T }=%' },
                { symbol: '!%', name: 'пустое', format: 'FR_{ T }=!%' },
                { symbol: '(,)', name: 'в списке', format: 'FR_{ T }=IN({ X })' },
                { symbol: '$', name: 'заканчивается', format: 'FR_{ T }=%{ X }' }
            ],
            'NUMBER': [
                { symbol: '^', name: 'начинается с...', format: 'FR_{ T }={ X }%' },
                { symbol: '=', name: 'равно', format: 'FR_{ T }={ X }' },
                { symbol: '≠', name: 'не равно', format: 'FR_{ T }=!{ X }' },
                { symbol: '≥', name: 'не меньше', format: 'FR_{ T }=>={ X }' },
                { symbol: '≤', name: 'не больше', format: 'FR_{ T }=<={ X }' },
                { symbol: '>', name: 'больше', format: 'FR_{ T }>{ X }' },
                { symbol: '<', name: 'меньше', format: 'FR_{ T }<{ X }' },
                { symbol: '...', name: 'в диапазоне', format: 'FR_{ T }={ X1 }&TO_{ T }={ X2 }' },
                { symbol: '%', name: 'не пустое', format: 'FR_{ T }=%' },
                { symbol: '!%', name: 'пустое', format: 'FR_{ T }=!%' }
            ],
            'DATE': [
                { symbol: '=', name: 'равно', format: 'FR_{ T }={ X }' },
                { symbol: '≥', name: 'не меньше', format: 'FR_{ T }=>={ X }' },
                { symbol: '≤', name: 'не больше', format: 'FR_{ T }=<={ X }' },
                { symbol: '>', name: 'больше', format: 'FR_{ T }>{ X }' },
                { symbol: '<', name: 'меньше', format: 'FR_{ T }<{ X }' },
                { symbol: '...', name: 'в диапазоне', format: 'FR_{ T }={ X1 }&TO_{ T }={ X2 }' },
                { symbol: '%', name: 'не пустое', format: 'FR_{ T }=%' },
                { symbol: '!%', name: 'пустое', format: 'FR_{ T }=!%' }
            ]
        };

        // Extend filter types
        this.filterTypes['SHORT'] = this.filterTypes['CHARS'];
        this.filterTypes['MEMO'] = this.filterTypes['CHARS'];
        this.filterTypes['DATETIME'] = this.filterTypes['DATE'];
        this.filterTypes['SIGNED'] = this.filterTypes['NUMBER'];

        // Register instance globally
        window[this.options.instanceName] = this;

        IntegramDebug.log('DataView', `Instance registered as window.${this.options.instanceName}`);
        IntegramDebug.verbose('DataView', `Constructor options:`, this.options);

        // Auto-initialize
        IntegramDebug.log('DataView', `Calling init() for ${containerId}...`);
        this.init();
    }

    /**
     * Initialize the component
     */
    init() {
        IntegramDebug.log('DataView', `init() started for ${this.container.id}`);

        this.loadColumnState();
        this.loadSettings();
        this.loadGlobalMetadata();
        this.loadData();

        IntegramDebug.log('DataView', `init() completed for ${this.container.id}`);
    }

    /**
     * Load global metadata for determining relationships
     */
    async loadGlobalMetadata() {
        IntegramDebug.log('DataView', 'Loading global metadata...');

        try {
            const apiBase = IntegramControls.extractApiBase(this.options.apiUrl);
            const metadataUrl = `${apiBase}/type/?JSON_DATA`;

            IntegramDebug.verbose('DataView', `Fetching metadata from: ${metadataUrl}`);

            const response = await fetch(metadataUrl);
            const json = await response.json();
            this.globalMetadata = json;

            IntegramDebug.log('DataView', `Global metadata loaded successfully`);
            IntegramDebug.verbose('DataView', `Metadata:`, json);

            if (this.data.length > 0) {
                IntegramDebug.log('DataView', 'Data already loaded, re-rendering...');
                this.render();
            }
        } catch (error) {
            IntegramDebug.error('DataView', 'Error loading global metadata:', error);
            console.error('Error loading global metadata:', error);
        }
    }

    /**
     * Load column state from cookies
     */
    loadColumnState() {
        const columnOrder = IntegramControls.getCookie(`${this.options.cookiePrefix}-column-order`);
        if (columnOrder) {
            try {
                this.columnOrder = JSON.parse(decodeURIComponent(columnOrder));
            } catch (e) {
                console.error('Failed to parse column order cookie:', e);
            }
        }

        const visibleColumns = IntegramControls.getCookie(`${this.options.cookiePrefix}-visible-columns`);
        if (visibleColumns) {
            try {
                this.visibleColumns = JSON.parse(decodeURIComponent(visibleColumns));
            } catch (e) {
                console.error('Failed to parse visible columns cookie:', e);
            }
        }

        const columnWidths = IntegramControls.getCookie(`${this.options.cookiePrefix}-column-widths`);
        if (columnWidths) {
            try {
                this.columnWidths = JSON.parse(decodeURIComponent(columnWidths));
            } catch (e) {
                console.error('Failed to parse column widths cookie:', e);
            }
        }
    }

    /**
     * Save column state to cookies
     */
    saveColumnState() {
        IntegramControls.setCookie(
            `${this.options.cookiePrefix}-column-order`,
            JSON.stringify(this.columnOrder)
        );
        IntegramControls.setCookie(
            `${this.options.cookiePrefix}-visible-columns`,
            JSON.stringify(this.visibleColumns)
        );
        IntegramControls.setCookie(
            `${this.options.cookiePrefix}-column-widths`,
            JSON.stringify(this.columnWidths)
        );
    }

    /**
     * Load table settings from cookies
     */
    loadSettings() {
        const settings = IntegramControls.getCookie(`${this.options.cookiePrefix}-settings`);
        if (settings) {
            try {
                this.settings = { ...this.settings, ...JSON.parse(decodeURIComponent(settings)) };
                this.options.pageSize = this.settings.pageSize;
            } catch (e) {
                console.error('Failed to parse settings cookie:', e);
            }
        }
    }

    /**
     * Save table settings to cookies
     */
    saveSettings() {
        IntegramControls.setCookie(
            `${this.options.cookiePrefix}-settings`,
            JSON.stringify(this.settings)
        );
    }

    /**
     * Load data - to be implemented by subclasses
     */
    async loadData(append = false) {
        throw new Error('loadData() must be implemented by subclass');
    }

    /**
     * Process column metadata to identify ID and style columns
     */
    processColumnMetadata() {
        this.idColumns.clear();
        this.styleColumns = {};
        this.editableColumns.clear();

        this.columns.forEach((col, index) => {
            // Hide ID columns
            if (col.name && col.name.endsWith(' ID')) {
                this.idColumns.add(col.id);
            }

            // Map style columns
            if (col.name && col.name.endsWith(' Style')) {
                const baseName = col.name.replace(' Style', '');
                const baseCol = this.columns.find(c => c.name === baseName);
                if (baseCol) {
                    this.idColumns.add(col.id);
                    this.styleColumns[baseCol.id] = col.id;
                }
            }

            // Mark editable columns (granted=1)
            if (col.granted === 1 || col.granted === '1') {
                const idColumn = this.columns.find(c =>
                    c.name === `${col.name} ID` &&
                    this.columns.indexOf(c) > index
                );
                this.editableColumns.set(col.id, idColumn ? idColumn.id : null);
            }
        });

        // Initialize visible columns if not loaded from cookie
        if (this.visibleColumns.length === 0) {
            this.visibleColumns = this.columns
                .filter(c => !this.idColumns.has(c.id))
                .map(c => c.id);
        } else {
            // Filter out ID columns from loaded visible columns
            this.visibleColumns = this.visibleColumns.filter(id => !this.idColumns.has(id));
        }

        // Initialize column order if not loaded from cookie
        if (this.columnOrder.length === 0) {
            this.columnOrder = this.visibleColumns.slice();
        }
    }

    /**
     * Render the table
     */
    render() {
        // Implementation in subclasses or shared
        const instanceName = this.options.instanceName;
        const orderedColumns = this.columnOrder
            .map(id => this.columns.find(c => c.id === id))
            .filter(c => c && this.visibleColumns.includes(c.id));

        this.container.innerHTML = `
            <div class="integram-data-view-wrapper">
                <div class="integram-data-view-header">
                    ${this.options.title ? `<div class="integram-data-view-title">${IntegramControls.escapeHtml(this.options.title)}</div>` : ''}
                    <div class="integram-data-view-controls">
                        <button class="integram-btn integram-btn-sm" onclick="window.${instanceName}.clearAllFilters()" title="Очистить фильтры">
                            🗑️
                        </button>
                        <button class="integram-btn integram-btn-sm" onclick="window.${instanceName}.toggleFilters()">
                            ${this.filtersEnabled ? '✓' : ''} Фильтры
                        </button>
                        <div class="integram-settings-icon" onclick="window.${instanceName}.openTableSettings()" title="Настройка">⚙️</div>
                        <div class="integram-settings-icon" onclick="window.${instanceName}.openColumnSettings()">⚙️</div>
                    </div>
                </div>
                <div class="integram-table-container">
                    <table class="integram-table${this.settings.compact ? ' compact' : ''}">
                        <thead>
                            <tr>
                                ${orderedColumns.map(col => this.renderColumnHeader(col)).join('')}
                            </tr>
                            ${this.filtersEnabled ? `
                            <tr class="filter-row">
                                ${orderedColumns.map(col => this.renderFilterCell(col)).join('')}
                            </tr>
                            ` : ''}
                        </thead>
                        <tbody>
                            ${this.data.map((row, rowIndex) => `
                                <tr>
                                    ${orderedColumns.map((col, colIndex) => {
                                        const cellValue = row[col.id];
                                        return this.renderCell(col, cellValue, rowIndex, colIndex);
                                    }).join('')}
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                    ${this.renderScrollCounter()}
                </div>
            </div>
        `;

        this.attachEventListeners();
    }

    /**
     * Render column header
     */
    renderColumnHeader(col) {
        const width = this.columnWidths[col.id] ? `width: ${this.columnWidths[col.id]}px;` : '';
        return `
            <th draggable="true" data-column-id="${col.id}" style="${width}">
                <span class="column-header-content">${IntegramControls.escapeHtml(col.name)}</span>
                <div class="column-resize-handle" data-column-id="${col.id}"></div>
            </th>
        `;
    }

    /**
     * Render filter cell
     */
    renderFilterCell(column) {
        const currentFilter = this.filters[column.id] || { type: '^', value: '' };
        const format = column.format || column.type;
        const filterGroup = this.filterTypes[format] || this.filterTypes['SHORT'];

        return `
            <th>
                <div class="filter-cell-wrapper">
                    <span class="filter-icon-inside" data-column-id="${column.id}">
                        ${IntegramControls.escapeHtml(currentFilter.type)}
                    </span>
                    <input type="text"
                           value="${IntegramControls.escapeHtml(currentFilter.value)}"
                           class="filter-input-with-icon"
                           data-column-id="${column.id}"
                           placeholder="фильтр...">
                </div>
            </th>
        `;
    }

    /**
     * Render table cell
     */
    renderCell(column, value, rowIndex, colIndex) {
        let cellClass = '';
        let displayValue = value;
        let customStyle = '';

        // Apply custom style if available
        if (this.styleColumns[column.id]) {
            const styleColId = this.styleColumns[column.id];
            const styleValue = this.data[rowIndex][styleColId];
            if (styleValue) {
                customStyle = ` style="${IntegramControls.escapeHtml(styleValue)}"`;
            }
        }

        // Format based on type
        const format = column.format || column.type;
        if (format === 'DATE') {
            displayValue = IntegramControls.formatDate(value, 'DATE');
        } else if (format === 'DATETIME') {
            displayValue = IntegramControls.formatDate(value, 'DATETIME');
        }

        // Truncate if needed
        if (this.settings.truncateLongValues && typeof displayValue === 'string') {
            const truncated = IntegramControls.truncateText(displayValue);
            if (truncated.isTruncated) {
                displayValue = `${IntegramControls.escapeHtml(truncated.text)}...`;
            } else {
                displayValue = IntegramControls.escapeHtml(displayValue);
            }
        } else {
            displayValue = IntegramControls.escapeHtml(displayValue);
        }

        // Check if editable
        const isEditable = this.editableColumns.has(column.id);
        if (isEditable) {
            cellClass += ' editable-cell';
        }

        return `<td class="${cellClass}" data-row="${rowIndex}" data-col="${colIndex}"${customStyle}>${displayValue}</td>`;
    }

    /**
     * Render scroll counter
     */
    renderScrollCounter() {
        const instanceName = this.options.instanceName;
        const totalDisplay = this.totalRows === null
            ? `<span class="total-count-unknown" onclick="window.${instanceName}.fetchTotalCount()" title="Нажмите, чтобы узнать общее количество">?</span>`
            : this.totalRows;

        return `
            <div class="scroll-counter">
                Показано ${this.loadedRecords} из ${totalDisplay}
            </div>
        `;
    }

    /**
     * Attach event listeners
     */
    attachEventListeners() {
        // Drag and drop for columns
        const headers = this.container.querySelectorAll('th[draggable="true"]');
        headers.forEach(th => {
            th.addEventListener('dragstart', (e) => {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/html', th.innerHTML);
                th.classList.add('dragging');
            });

            th.addEventListener('dragend', () => {
                th.classList.remove('dragging');
                this.container.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
            });

            th.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                th.classList.add('drag-over');
            });

            th.addEventListener('dragleave', () => {
                th.classList.remove('drag-over');
            });

            th.addEventListener('drop', (e) => {
                e.preventDefault();
                th.classList.remove('drag-over');

                const draggingElement = this.container.querySelector('.dragging');
                if (draggingElement && draggingElement !== th) {
                    const fromId = draggingElement.dataset.columnId;
                    const toId = th.dataset.columnId;

                    const fromIndex = this.columnOrder.indexOf(fromId);
                    const toIndex = this.columnOrder.indexOf(toId);

                    this.columnOrder.splice(fromIndex, 1);
                    this.columnOrder.splice(toIndex, 0, fromId);

                    this.saveColumnState();
                    this.render();
                }
            });
        });

        // Filter inputs
        const filterInputs = this.container.querySelectorAll('.filter-input-with-icon');
        filterInputs.forEach(input => {
            input.addEventListener('input', IntegramControls.debounce(() => {
                const colId = input.dataset.columnId;
                if (!this.filters[colId]) {
                    this.filters[colId] = { type: '^', value: '' };
                }
                this.filters[colId].value = input.value;
                this.loadedRecords = 0;
                this.hasMore = true;
                this.loadData(false);
            }, 500));
        });

        // Filter icons (cycle through operators)
        const filterIcons = this.container.querySelectorAll('.filter-icon-inside');
        filterIcons.forEach(icon => {
            icon.addEventListener('click', () => {
                const colId = icon.dataset.columnId;
                const column = this.columns.find(c => c.id === colId);
                const format = column.format || column.type;
                const filterGroup = this.filterTypes[format] || this.filterTypes['SHORT'];

                if (!this.filters[colId]) {
                    this.filters[colId] = { type: '^', value: '' };
                }

                const currentType = this.filters[colId].type;
                const currentIndex = filterGroup.findIndex(f => f.symbol === currentType);
                const nextIndex = (currentIndex + 1) % filterGroup.length;
                this.filters[colId].type = filterGroup[nextIndex].symbol;

                icon.textContent = filterGroup[nextIndex].symbol;
                icon.title = filterGroup[nextIndex].name;

                if (this.filters[colId].value) {
                    this.loadedRecords = 0;
                    this.hasMore = true;
                    this.loadData(false);
                }
            });
        });

        // Infinite scroll
        const tableContainer = this.container.querySelector('.integram-table-container');
        tableContainer.addEventListener('scroll', IntegramControls.debounce(() => {
            const { scrollTop, scrollHeight, clientHeight } = tableContainer;
            if (scrollTop + clientHeight >= scrollHeight - 100 && this.hasMore && !this.isLoading) {
                this.loadData(true);
            }
        }, 200));
    }

    /**
     * Toggle filters visibility
     */
    toggleFilters() {
        this.filtersEnabled = !this.filtersEnabled;
        this.render();
    }

    /**
     * Clear all filters
     */
    clearAllFilters() {
        this.filters = {};
        this.loadedRecords = 0;
        this.hasMore = true;
        this.loadData(false);
    }

    /**
     * Fetch total count
     */
    async fetchTotalCount() {
        // To be implemented by subclasses
    }

    /**
     * Open table settings modal
     */
    openTableSettings() {
        const content = `
            <div class="integram-settings-form">
                <label>
                    <input type="checkbox" id="compact-mode" ${this.settings.compact ? 'checked' : ''}>
                    Компактный режим
                </label>
                <label>
                    <input type="checkbox" id="truncate-values" ${this.settings.truncateLongValues ? 'checked' : ''}>
                    Обрезать длинные значения
                </label>
                <label>
                    Размер страницы:
                    <input type="number" id="page-size" value="${this.settings.pageSize}" min="10" max="100">
                </label>
                <button class="integram-btn" onclick="window.${this.options.instanceName}.saveTableSettings()">Сохранить</button>
            </div>
        `;

        this.settingsModal = IntegramControls.renderModal('Настройки таблицы', content, () => {
            this.settingsModal = null;
        });
    }

    /**
     * Save table settings
     */
    saveTableSettings() {
        const compactMode = document.getElementById('compact-mode').checked;
        const truncateValues = document.getElementById('truncate-values').checked;
        const pageSize = parseInt(document.getElementById('page-size').value);

        this.settings.compact = compactMode;
        this.settings.truncateLongValues = truncateValues;
        this.settings.pageSize = pageSize;
        this.options.pageSize = pageSize;

        this.saveSettings();
        this.render();

        if (this.settingsModal) {
            document.body.removeChild(this.settingsModal);
            this.settingsModal = null;
        }
    }

    /**
     * Open column settings modal
     */
    openColumnSettings() {
        const columnsList = this.columns
            .filter(c => !this.idColumns.has(c.id))
            .map(col => {
                const isVisible = this.visibleColumns.includes(col.id);
                return `
                    <label>
                        <input type="checkbox" class="column-visibility" data-column-id="${col.id}" ${isVisible ? 'checked' : ''}>
                        ${IntegramControls.escapeHtml(col.name)}
                    </label>
                `;
            }).join('');

        const content = `
            <div class="integram-settings-form">
                <div class="integram-column-list">
                    ${columnsList}
                </div>
                <button class="integram-btn" onclick="window.${this.options.instanceName}.saveColumnSettings()">Сохранить</button>
            </div>
        `;

        this.columnSettingsModal = IntegramControls.renderModal('Настройки колонок', content, () => {
            this.columnSettingsModal = null;
        });
    }

    /**
     * Save column settings
     */
    saveColumnSettings() {
        const checkboxes = document.querySelectorAll('.column-visibility');
        this.visibleColumns = Array.from(checkboxes)
            .filter(cb => cb.checked)
            .map(cb => cb.dataset.columnId);

        this.saveColumnState();
        this.render();

        if (this.columnSettingsModal) {
            document.body.removeChild(this.columnSettingsModal);
            this.columnSettingsModal = null;
        }
    }
}

// ============================================================================
// MODULE 1: IntegramTables - For object/{table_type_id} Data
// ============================================================================

/**
 * IntegramTables handles displaying and managing data from table-type endpoints.
 * This module fetches data from object/{table_type_id}/?JSON_DATA&F_U={parent_id}
 * and provides full CRUD capabilities with metadata-driven form generation.
 *
 * Usage:
 * ```javascript
 * const tableView = new IntegramTables('container-id', {
 *     apiUrl: 'https://api.integram.ru',
 *     tableTypeId: 123,
 *     parentId: 456,
 *     title: 'My Table'
 * });
 * ```
 */
class IntegramTables extends IntegramDataView {
    constructor(containerId, options = {}) {
        IntegramDebug.log('Tables', `IntegramTables constructor called for: ${containerId}`);

        super(containerId, {
            ...options,
            cookiePrefix: options.cookiePrefix || 'integram-tables'
        });

        this.options.tableTypeId = options.tableTypeId || null;

        IntegramDebug.verbose('Tables', `tableTypeId: ${this.options.tableTypeId}`);

        if (!this.options.tableTypeId) {
            const errorMsg = 'tableTypeId is required for IntegramTables';
            IntegramDebug.error('Tables', errorMsg);
            throw new Error(errorMsg);
        }

        IntegramDebug.log('Tables', `IntegramTables instance created successfully for: ${containerId}`);
    }

    /**
     * Load data from table endpoint
     */
    async loadData(append = false) {
        IntegramDebug.log('Tables', `loadData called (append=${append})`);

        if (this.isLoading || (!append && !this.hasMore && this.loadedRecords > 0)) {
            IntegramDebug.warn('Tables', `loadData skipped - isLoading=${this.isLoading}, hasMore=${this.hasMore}, loadedRecords=${this.loadedRecords}`);
            return;
        }

        this.isLoading = true;
        IntegramDebug.log('Tables', 'Loading data...');

        try {
            if (!append) {
                IntegramDebug.log('Tables', 'Showing loading indicator...');
                IntegramControls.showLoading(this.container);
            }

            const apiBase = IntegramControls.extractApiBase(this.options.apiUrl);
            const offset = append ? this.loadedRecords : 0;

            IntegramDebug.verbose('Tables', `API base: ${apiBase}, offset: ${offset}`);

            // First load: fetch metadata
            if (!append && this.columns.length === 0) {
                const metadataUrl = `${apiBase}/type/${this.options.tableTypeId}/?JSON_DATA`;
                IntegramDebug.log('Tables', `Fetching metadata from: ${metadataUrl}`);

                const metaResponse = await fetch(metadataUrl);
                const metaJson = await metaResponse.json();

                IntegramDebug.verbose('Tables', 'Metadata response:', metaJson);

                if (metaJson.f && Array.isArray(metaJson.f)) {
                    this.columns = metaJson.f.map(col => ({
                        id: col.i,
                        name: col.n,
                        type: col.t,
                        format: col.f,
                        orig: col.o,
                        granted: col.g
                    }));
                    this.metadataCache[this.options.tableTypeId] = metaJson;

                    IntegramDebug.log('Tables', `Loaded ${this.columns.length} columns from metadata`);
                    IntegramDebug.verbose('Tables', 'Columns:', this.columns);
                } else {
                    IntegramDebug.warn('Tables', 'No columns found in metadata response', metaJson);
                }
            }

            // Fetch data
            let dataUrl = `${apiBase}/object/${this.options.tableTypeId}/?JSON_DATA`;
            if (this.options.parentId) {
                dataUrl += `&F_U=${this.options.parentId}`;
                IntegramDebug.verbose('Tables', `Using parentId: ${this.options.parentId}`);
            }
            dataUrl += `&LIMIT=${this.options.pageSize}&OFFSET=${offset}`;

            // Apply filters
            const filters = this.filters || {};
            Object.keys(filters).forEach(colId => {
                const filter = filters[colId];
                if (filter.value || filter.type === '%' || filter.type === '!%') {
                    const column = this.columns.find(c => c.id === colId);
                    if (column) {
                        const filterParam = IntegramControls.parseFilter(column, filter, this.filterTypes);
                        if (filterParam) {
                            dataUrl += `&${filterParam}`;
                            IntegramDebug.verbose('Tables', `Applied filter: ${filterParam}`);
                        }
                    }
                }
            });

            IntegramDebug.log('Tables', `Fetching data from: ${dataUrl}`);

            const dataResponse = await fetch(dataUrl);
            const dataJson = await dataResponse.json();

            IntegramDebug.verbose('Tables', 'Data response:', dataJson);

            // Process data
            const newRows = [];
            if (dataJson.d && Array.isArray(dataJson.d)) {
                const startIdx = append ? this.loadedRecords : 0;
                dataJson.d.forEach((record, idx) => {
                    const row = {};
                    this.columns.forEach(col => {
                        row[col.id] = record[col.id] || '';
                    });
                    newRows.push(row);
                });

                IntegramDebug.log('Tables', `Processed ${newRows.length} data rows`);
            } else {
                IntegramDebug.warn('Tables', 'No data array found in response', dataJson);
            }

            if (!append) {
                this.data = newRows;
                this.loadedRecords = 0;
                IntegramDebug.log('Tables', 'Data replaced (not appending)');
            } else {
                this.data.push(...newRows);
                IntegramDebug.log('Tables', 'Data appended');
            }

            this.loadedRecords += newRows.length;
            this.hasMore = newRows.length >= this.options.pageSize;

            IntegramDebug.verbose('Tables', `Total loaded records: ${this.loadedRecords}, hasMore: ${this.hasMore}`);

            if (newRows.length < this.options.pageSize) {
                this.totalRows = this.loadedRecords;
                this.hasMore = false;
                IntegramDebug.log('Tables', `All data loaded. Total rows: ${this.totalRows}`);
            }

            // Process metadata
            if (!append) {
                IntegramDebug.log('Tables', 'Processing column metadata...');
                this.processColumnMetadata();
            }

            IntegramDebug.log('Tables', 'Rendering table...');
            this.render();

            if (this.options.onDataLoad) {
                IntegramDebug.verbose('Tables', 'Calling onDataLoad callback');
                this.options.onDataLoad(this.data);
            }

            IntegramDebug.log('Tables', 'Data load completed successfully');

        } catch (error) {
            IntegramDebug.error('Tables', 'Error loading data:', error);
            console.error('Error loading data:', error);
            IntegramControls.showError(this.container, `Ошибка загрузки данных: ${error.message}`);
        } finally {
            this.isLoading = false;
        }
    }

    /**
     * Fetch total count with current filters
     */
    async fetchTotalCount() {
        try {
            const apiBase = IntegramControls.extractApiBase(this.options.apiUrl);
            let countUrl = `${apiBase}/object/${this.options.tableTypeId}/?JSON_DATA&COUNT=1`;

            if (this.options.parentId) {
                countUrl += `&F_U=${this.options.parentId}`;
            }

            // Apply filters
            const filters = this.filters || {};
            Object.keys(filters).forEach(colId => {
                const filter = filters[colId];
                if (filter.value || filter.type === '%' || filter.type === '!%') {
                    const column = this.columns.find(c => c.id === colId);
                    if (column) {
                        const filterParam = IntegramControls.parseFilter(column, filter, this.filterTypes);
                        if (filterParam) {
                            countUrl += `&${filterParam}`;
                        }
                    }
                }
            });

            const response = await fetch(countUrl);
            const json = await response.json();

            if (json.count !== undefined) {
                this.totalRows = parseInt(json.count);
                this.render();
            }
        } catch (error) {
            console.error('Error fetching total count:', error);
        }
    }
}

// ============================================================================
// MODULE 2: IntegramReports - For report/{report_id} Data
// ============================================================================

/**
 * IntegramReports handles displaying data from report endpoints.
 * This module fetches data from report/{report_id} URLs with custom parameters
 * and provides read-only tabular display with filtering capabilities.
 *
 * Usage:
 * ```javascript
 * const reportView = new IntegramReports('container-id', {
 *     apiUrl: 'https://api.integram.ru/report/123',
 *     title: 'Sales Report',
 *     pageSize: 50
 * });
 * ```
 */
class IntegramReports extends IntegramDataView {
    constructor(containerId, options = {}) {
        IntegramDebug.log('Reports', `IntegramReports constructor called for: ${containerId}`);

        super(containerId, {
            ...options,
            cookiePrefix: options.cookiePrefix || 'integram-reports'
        });

        IntegramDebug.log('Reports', `IntegramReports instance created successfully for: ${containerId}`);
    }

    /**
     * Load data from report endpoint
     */
    async loadData(append = false) {
        IntegramDebug.log('Reports', `loadData called (append=${append})`);

        if (this.isLoading || (!append && !this.hasMore && this.loadedRecords > 0)) {
            IntegramDebug.warn('Reports', `loadData skipped - isLoading=${this.isLoading}, hasMore=${this.hasMore}, loadedRecords=${this.loadedRecords}`);
            return;
        }

        this.isLoading = true;
        IntegramDebug.log('Reports', 'Loading data...');

        try {
            if (!append) {
                IntegramDebug.log('Reports', 'Showing loading indicator...');
                IntegramControls.showLoading(this.container);
            }

            const offset = append ? this.loadedRecords : 0;
            const params = new URLSearchParams();
            params.set('LIMIT', this.options.pageSize);
            params.set('OFFSET', offset);

            IntegramDebug.verbose('Reports', `Offset: ${offset}, PageSize: ${this.options.pageSize}`);

            // Apply filters
            const filters = this.filters || {};
            Object.keys(filters).forEach(colId => {
                const filter = filters[colId];
                if (filter.value || filter.type === '%' || filter.type === '!%') {
                    const column = this.columns.find(c => c.id === colId);
                    if (column) {
                        const filterParam = IntegramControls.parseFilter(column, filter, this.filterTypes);
                        if (filterParam) {
                            filterParam.split('&').forEach(param => {
                                const [key, value] = param.split('=');
                                params.set(key, value);
                            });
                        }
                    }
                }
            });

            const separator = this.options.apiUrl.includes('?') ? '&' : '?';
            const fetchUrl = `${this.options.apiUrl}${separator}${params}`;

            IntegramDebug.log('Reports', `Fetching data from: ${fetchUrl}`);

            const response = await fetch(fetchUrl);
            const json = await response.json();

            IntegramDebug.verbose('Reports', 'Data response:', json);

            // Extract columns from first load
            if (!append && json.f) {
                this.columns = json.f.map(col => ({
                    id: col.i || col.id || col.n,
                    name: col.n || col.name,
                    type: col.t || col.type || 'CHARS',
                    format: col.f || col.format,
                    orig: col.o || col.orig,
                    granted: col.g || col.granted || 0
                }));

                IntegramDebug.log('Reports', `Loaded ${this.columns.length} columns from response`);
                IntegramDebug.verbose('Reports', 'Columns:', this.columns);
            } else if (!append) {
                IntegramDebug.warn('Reports', 'No columns found in response', json);
            }

            // Process data
            const newRows = [];
            if (json.d && Array.isArray(json.d)) {
                json.d.forEach(record => {
                    const row = {};
                    this.columns.forEach(col => {
                        row[col.id] = record[col.id] || '';
                    });
                    newRows.push(row);
                });

                IntegramDebug.log('Reports', `Processed ${newRows.length} data rows`);
            } else {
                IntegramDebug.warn('Reports', 'No data array found in response', json);
            }

            if (!append) {
                this.data = newRows;
                this.loadedRecords = 0;
                IntegramDebug.log('Reports', 'Data replaced (not appending)');
            } else {
                this.data.push(...newRows);
                IntegramDebug.log('Reports', 'Data appended');
            }

            this.loadedRecords += newRows.length;
            this.hasMore = newRows.length >= this.options.pageSize;

            IntegramDebug.verbose('Reports', `Total loaded records: ${this.loadedRecords}, hasMore: ${this.hasMore}`);

            if (newRows.length < this.options.pageSize) {
                this.totalRows = this.loadedRecords;
                this.hasMore = false;
                IntegramDebug.log('Reports', `All data loaded. Total rows: ${this.totalRows}`);
            }

            // Process metadata
            if (!append) {
                IntegramDebug.log('Reports', 'Processing column metadata...');
                this.processColumnMetadata();
            }

            IntegramDebug.log('Reports', 'Rendering table...');
            this.render();

            if (this.options.onDataLoad) {
                IntegramDebug.verbose('Reports', 'Calling onDataLoad callback');
                this.options.onDataLoad(this.data);
            }

            IntegramDebug.log('Reports', 'Data load completed successfully');

        } catch (error) {
            IntegramDebug.error('Reports', 'Error loading data:', error);
            console.error('Error loading data:', error);
            IntegramControls.showError(this.container, `Ошибка загрузки данных: ${error.message}`);
        } finally {
            this.isLoading = false;
        }
    }

    /**
     * Fetch total count with current filters
     */
    async fetchTotalCount() {
        try {
            const params = new URLSearchParams();
            params.set('COUNT', '1');

            // Apply filters
            const filters = this.filters || {};
            Object.keys(filters).forEach(colId => {
                const filter = filters[colId];
                if (filter.value || filter.type === '%' || filter.type === '!%') {
                    const column = this.columns.find(c => c.id === colId);
                    if (column) {
                        const filterParam = IntegramControls.parseFilter(column, filter, this.filterTypes);
                        if (filterParam) {
                            filterParam.split('&').forEach(param => {
                                const [key, value] = param.split('=');
                                params.set(key, value);
                            });
                        }
                    }
                }
            });

            const separator = this.options.apiUrl.includes('?') ? '&' : '?';
            const response = await fetch(`${this.options.apiUrl}${separator}${params}`);
            const json = await response.json();

            if (json.count !== undefined) {
                this.totalRows = parseInt(json.count);
                this.render();
            }
        } catch (error) {
            console.error('Error fetching total count:', error);
        }
    }
}

// ============================================================================
// DEBUG/TRACING MODULE
// ============================================================================

/**
 * IntegramDebug provides comprehensive tracing and debugging capabilities
 * for the IntegramDataView component. Can be enabled/disabled at runtime.
 */
class IntegramDebug {
    static enabled = false;
    static verboseEnabled = false;

    /**
     * Enable debug mode
     * @param {boolean} verbose - Enable verbose logging
     */
    static enable(verbose = false) {
        IntegramDebug.enabled = true;
        IntegramDebug.verboseEnabled = verbose;
        console.log('[IntegramDataView] Debug mode enabled' + (verbose ? ' (VERBOSE)' : ''));
    }

    /**
     * Disable debug mode
     */
    static disable() {
        IntegramDebug.enabled = false;
        IntegramDebug.verboseEnabled = false;
        console.log('[IntegramDataView] Debug mode disabled');
    }

    /**
     * Log a debug message
     * @param {string} category - Message category
     * @param {string} message - Message text
     * @param {*} data - Optional data to log
     */
    static log(category, message, data = null) {
        if (!IntegramDebug.enabled) return;

        const timestamp = new Date().toISOString().substr(11, 12);
        const prefix = `[${timestamp}][${category}]`;

        if (data !== null) {
            console.log(prefix, message, data);
        } else {
            console.log(prefix, message);
        }
    }

    /**
     * Log verbose debug message (only when verbose mode is on)
     * @param {string} category - Message category
     * @param {string} message - Message text
     * @param {*} data - Optional data to log
     */
    static verbose(category, message, data = null) {
        if (!IntegramDebug.enabled || !IntegramDebug.verboseEnabled) return;

        const timestamp = new Date().toISOString().substr(11, 12);
        const prefix = `[${timestamp}][${category}][VERBOSE]`;

        if (data !== null) {
            console.log(prefix, message, data);
        } else {
            console.log(prefix, message);
        }
    }

    /**
     * Log an error
     * @param {string} category - Error category
     * @param {string} message - Error message
     * @param {Error} error - Error object
     */
    static error(category, message, error = null) {
        const timestamp = new Date().toISOString().substr(11, 12);
        const prefix = `[${timestamp}][${category}][ERROR]`;

        if (error !== null) {
            console.error(prefix, message, error);
        } else {
            console.error(prefix, message);
        }
    }

    /**
     * Log a warning
     * @param {string} category - Warning category
     * @param {string} message - Warning message
     * @param {*} data - Optional data
     */
    static warn(category, message, data = null) {
        if (!IntegramDebug.enabled) return;

        const timestamp = new Date().toISOString().substr(11, 12);
        const prefix = `[${timestamp}][${category}][WARN]`;

        if (data !== null) {
            console.warn(prefix, message, data);
        } else {
            console.warn(prefix, message);
        }
    }
}

// Make debug class globally accessible
if (typeof window !== 'undefined') {
    window.IntegramDebug = IntegramDebug;
}

// ============================================================================
// AUTO-INITIALIZATION
// ============================================================================

/**
 * Auto-initialize tables and reports from HTML data attributes
 *
 * Supported patterns:
 *
 * Pattern 1 (new): data-integram-type attribute
 * ```html
 * <div id="my-table"
 *      data-integram-type="table"
 *      data-api-url="https://api.integram.ru"
 *      data-table-type-id="123"
 *      data-parent-id="456"
 *      data-title="My Table">
 * </div>
 *
 * <div id="my-report"
 *      data-integram-type="report"
 *      data-api-url="https://api.integram.ru/report/789"
 *      data-title="My Report">
 * </div>
 * ```
 *
 * Pattern 2 (legacy): data-integram-table attribute
 * ```html
 * <div id="my-table"
 *      data-integram-table
 *      data-api-url="https://api.integram.ru/report/789"
 *      data-title="My Table">
 * </div>
 * ```
 */
function autoInitIntegramDataViews() {
    IntegramDebug.log('INIT', 'Starting auto-initialization...');

    let initializedCount = 0;

    // Pattern 1: Auto-initialize with data-integram-type="table"
    const tableElements = document.querySelectorAll('[data-integram-type="table"]');
    IntegramDebug.log('INIT', `Found ${tableElements.length} elements with data-integram-type="table"`);

    tableElements.forEach(element => {
        try {
            IntegramDebug.log('INIT', `Initializing table: ${element.id || '(no id)'}`);

            if (!element.id) {
                IntegramDebug.error('INIT', 'Element has no ID, skipping', element);
                return;
            }

            const options = {
                apiUrl: element.dataset.apiUrl || '',
                tableTypeId: element.dataset.tableTypeId || null,
                parentId: element.dataset.parentId || null,
                title: element.dataset.title || '',
                pageSize: parseInt(element.dataset.pageSize || 20),
                cookiePrefix: element.dataset.cookiePrefix || undefined,
                instanceName: element.dataset.instanceName || undefined
            };

            IntegramDebug.verbose('INIT', `Table options for ${element.id}:`, options);

            if (!options.apiUrl) {
                IntegramDebug.warn('INIT', `No apiUrl specified for table ${element.id}`);
            }
            if (!options.tableTypeId) {
                IntegramDebug.warn('INIT', `No tableTypeId specified for table ${element.id}`);
            }

            const instance = new IntegramTables(element.id, options);
            initializedCount++;

            IntegramDebug.log('INIT', `Successfully initialized table: ${element.id}`);
        } catch (error) {
            IntegramDebug.error('INIT', `Failed to initialize table ${element.id}:`, error);
        }
    });

    // Pattern 2: Auto-initialize with data-integram-type="report"
    const reportElements = document.querySelectorAll('[data-integram-type="report"]');
    IntegramDebug.log('INIT', `Found ${reportElements.length} elements with data-integram-type="report"`);

    reportElements.forEach(element => {
        try {
            IntegramDebug.log('INIT', `Initializing report: ${element.id || '(no id)'}`);

            if (!element.id) {
                IntegramDebug.error('INIT', 'Element has no ID, skipping', element);
                return;
            }

            const options = {
                apiUrl: element.dataset.apiUrl || '',
                title: element.dataset.title || '',
                pageSize: parseInt(element.dataset.pageSize || 20),
                cookiePrefix: element.dataset.cookiePrefix || undefined,
                instanceName: element.dataset.instanceName || undefined
            };

            IntegramDebug.verbose('INIT', `Report options for ${element.id}:`, options);

            if (!options.apiUrl) {
                IntegramDebug.warn('INIT', `No apiUrl specified for report ${element.id}`);
            }

            const instance = new IntegramReports(element.id, options);
            initializedCount++;

            IntegramDebug.log('INIT', `Successfully initialized report: ${element.id}`);
        } catch (error) {
            IntegramDebug.error('INIT', `Failed to initialize report ${element.id}:`, error);
        }
    });

    // Pattern 3 (legacy): Auto-initialize with data-integram-table attribute
    // This pattern auto-detects whether to use IntegramReports or IntegramTables
    // based on whether data-table-type-id is present
    const legacyElements = document.querySelectorAll('[data-integram-table]');
    IntegramDebug.log('INIT', `Found ${legacyElements.length} elements with data-integram-table (legacy pattern)`);

    legacyElements.forEach(element => {
        try {
            IntegramDebug.log('INIT', `Initializing legacy table: ${element.id || '(no id)'}`);

            if (!element.id) {
                IntegramDebug.error('INIT', 'Element has no ID, skipping', element);
                return;
            }

            const hasTableTypeId = element.dataset.tableTypeId;
            const dataSource = element.dataset.dataSource;

            // Determine if this should be a table or report
            const isTable = hasTableTypeId || dataSource === 'table';

            IntegramDebug.log('INIT', `Legacy element ${element.id} detected as: ${isTable ? 'TABLE' : 'REPORT'}`);

            if (isTable) {
                const options = {
                    apiUrl: element.dataset.apiUrl || '',
                    tableTypeId: element.dataset.tableTypeId || null,
                    parentId: element.dataset.parentId || null,
                    title: element.dataset.title || '',
                    pageSize: parseInt(element.dataset.pageSize || 20),
                    cookiePrefix: element.dataset.cookiePrefix || undefined,
                    instanceName: element.dataset.instanceName || undefined
                };

                IntegramDebug.verbose('INIT', `Legacy table options for ${element.id}:`, options);

                if (!options.tableTypeId) {
                    IntegramDebug.warn('INIT', `No tableTypeId specified for legacy table ${element.id}`);
                }

                const instance = new IntegramTables(element.id, options);
                initializedCount++;
            } else {
                const options = {
                    apiUrl: element.dataset.apiUrl || '',
                    title: element.dataset.title || '',
                    pageSize: parseInt(element.dataset.pageSize || 20),
                    cookiePrefix: element.dataset.cookiePrefix || undefined,
                    instanceName: element.dataset.instanceName || undefined
                };

                IntegramDebug.verbose('INIT', `Legacy report options for ${element.id}:`, options);

                const instance = new IntegramReports(element.id, options);
                initializedCount++;
            }

            IntegramDebug.log('INIT', `Successfully initialized legacy element: ${element.id}`);
        } catch (error) {
            IntegramDebug.error('INIT', `Failed to initialize legacy element ${element.id}:`, error);
        }
    });

    IntegramDebug.log('INIT', `Auto-initialization complete. Initialized ${initializedCount} components.`);
}

// Auto-initialize on DOM ready
if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        IntegramDebug.log('INIT', 'Waiting for DOMContentLoaded event...');
        document.addEventListener('DOMContentLoaded', autoInitIntegramDataViews);
    } else {
        IntegramDebug.log('INIT', 'DOM already loaded, initializing immediately...');
        autoInitIntegramDataViews();
    }
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        IntegramTables,
        IntegramReports,
        IntegramControls,
        IntegramDataView
    };
}
