// ============================================================
// Theme management
// ============================================================
class ThemeManager {
    constructor() {
        this.theme = localStorage.getItem('theme') || 'light';
        this.applyTheme();
    }

    applyTheme() {
        document.documentElement.setAttribute('data-theme', this.theme);
        this.updateThemeButton();
    }

    toggleTheme() {
        this.theme = this.theme === 'light' ? 'dark' : 'light';
        localStorage.setItem('theme', this.theme);
        this.applyTheme();
    }

    updateThemeButton() {
        const isDark = this.theme === 'dark';
        // Update cabinet user menu structure (theme-icon + theme-value spans)
        const themeIcon = document.getElementById('theme-icon');
        const themeValue = document.getElementById('theme-value');
        if (themeIcon) {
            themeIcon.textContent = isDark ? '☀️' : '🌙';
        }
        if (themeValue) {
            themeValue.textContent = isDark ? 'Светлая' : 'Темная';
        }
        // Fallback for index.html simple theme toggle button (no structured spans)
        if (!themeIcon && !themeValue) {
            const themeToggle = document.getElementById('theme-toggle');
            if (themeToggle) {
                themeToggle.innerHTML = (isDark ? '☀️ ' : '🌙 ') + '<span>' + (isDark ? 'Светлая' : 'Темная') + '</span>';
            }
        }
    }
}

// ============================================================
// Cookie utilities
// ============================================================
const CookieUtil = {
    get(name) {
        const match = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=([^;]*)'));
        return match ? decodeURIComponent(match[1]) : null;
    },
    set(name, value, days) {
        let expires = '';
        if (days) {
            const d = new Date();
            d.setTime(d.getTime() + days * 24 * 60 * 60 * 1000);
            expires = '; expires=' + d.toUTCString();
        }
        document.cookie = name + '=' + encodeURIComponent(value) + expires + '; path=/';
    },
    delete(name) {
        document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/';
    },
    getAllIdb() {
        // Returns array of db names for all idb_* cookies found
        const result = [];
        const cookies = document.cookie.split(';');
        for (const c of cookies) {
            const trimmed = c.trim();
            if (trimmed.startsWith('idb_')) {
                const name = trimmed.split('=')[0].trim();
                const dbName = name.slice(4); // remove 'idb_' prefix
                if (dbName) result.push(dbName);
            }
        }
        return result;
    }
};

// ============================================================
// API Configuration
// ============================================================
class ApiConfig {
    constructor() {
        this.host = localStorage.getItem('apiHost') || window.location.hostname;
        this.yandexClientId = '959da92b09364e42bf4c7704db0b992f';
    }

    getBaseUrl(db) {
        return 'https://' + this.host + '/' + db;
    }

    hasYandexAuth() {
        return !!(this.yandexClientId && this.yandexClientId.length > 0);
    }
}

// ============================================================
// Token validation
// ============================================================
async function validateToken(host, dbName) {
    // GET https://{host}/{db}/xsrf?JSON
    // Returns { _xsrf, token, user, ... } on success; on failure logs and deletes cookie
    const url = 'https://' + host + '/' + dbName + '/xsrf?JSON';
    try {
        const response = await fetch(url, { method: 'GET', credentials: 'include' });
        if (!response.ok) {
            console.log('[auth] xsrf check failed for ' + dbName + ': HTTP ' + response.status);
            CookieUtil.delete('idb_' + dbName);
            return null;
        }
        const data = await response.json();
        if (!data || !data._xsrf) {
            console.log('[auth] xsrf check: no valid token for ' + dbName, data);
            CookieUtil.delete('idb_' + dbName);
            return null;
        }
        return data;
    } catch (err) {
        console.log('[auth] xsrf check error for ' + dbName + ':', err);
        CookieUtil.delete('idb_' + dbName);
        return null;
    }
}

// ============================================================
// Notification utility
// ============================================================
function showToast(message, type = 'info') {
    const existing = document.querySelectorAll('.integram-toast');
    existing.forEach(t => t.remove());

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
        font-size: 14px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        background-color: ${type === 'error' ? '#dc3545' : type === 'success' ? '#28a745' : '#17a2b8'};
        cursor: pointer;
    `;
    document.body.appendChild(toast);

    const remove = () => { if (toast.parentNode) toast.remove(); };
    setTimeout(remove, 5000);
    toast.addEventListener('click', remove);
}

// ============================================================
// Yandex OAuth
// ============================================================
class YandexAuthManager {
    constructor(apiConfig) {
        this.apiConfig = apiConfig;
        // Use the current origin so the redirect_uri always matches the host the user is on.
        // This must exactly match what the backend sends in the token-exchange request
        // (index.php uses HTTP_HOST for the same reason).
        this.redirectUri = window.location.origin + '/auth.asp';
        this._inProgress = false;
    }

    isEnabled() {
        return this.apiConfig.hasYandexAuth();
    }

    initiateLogin(db) {
        if (!this.isEnabled()) {
            showToast('Yandex OAuth не настроен. Укажите Client ID в настройках.', 'error');
            return;
        }
        // Guard against double-click / rapid re-entry: once the browser is already
        // navigating to Yandex the flag stays set; it is never reset in this page
        // lifecycle because window.location.href causes a navigation away.
        if (this._inProgress) return;
        this._inProgress = true;
        // Encode the selected DB in state so the backend can redirect after auth.
        // Format: "yandex" or "yandex:<db>" — backend detects Yandex by the "yandex" prefix.
        var state = 'yandex';
        if (db && db !== 'my') {
            state = 'yandex:' + encodeURIComponent(db);
        }
        const params = new URLSearchParams({
            response_type: 'code',
            client_id: this.apiConfig.yandexClientId,
            redirect_uri: this.redirectUri,
            state: state
        });
        window.location.href = 'https://oauth.yandex.ru/authorize?' + params.toString();
    }
}

// ============================================================
// Authentication & UI controller
// ============================================================
class AuthManager {
    constructor(apiConfig) {
        this.apiConfig = apiConfig;
        this.validDbs = []; // list of db names from idb_* cookies with valid tokens (excluding 'my')
        this.allIdbDbs = []; // all db names from idb_* cookies (including 'my')
        this.selectedDb = null;
    }

    init() {
        const dbNames = CookieUtil.getAllIdb();
        this.allIdbDbs = dbNames;

        if (dbNames.length === 0) {
            this.showLoginButton();
            return;
        }

        // Filter out 'my' for regular db list, sort alphabetically
        const otherDbs = dbNames.filter(d => d !== 'my').sort((a, b) => a.localeCompare(b));

        // Use cookie presence as proxy for db availability
        this.validDbs = otherDbs;

        // Always show db-btn-wrapper when any idb_* tokens exist (ЛК always shown)
        // Set selectedDb: prefer last used (from cookie), else first non-my db, else 'my'
        const lastUsed = CookieUtil.get('last_db');
        if (lastUsed && (lastUsed === 'my' || this.validDbs.includes(lastUsed))) {
            this.selectedDb = lastUsed;
        } else if (this.validDbs.length > 0) {
            this.selectedDb = this.validDbs[0];
        } else {
            this.selectedDb = 'my';
        }

        this.showDbButton();
    }

    getDbLabel(dbName) {
        if (dbName === 'my') return 'Личный кабинет';
        return dbName;
    }

    showLoginButton() {
        const loginBtn = document.getElementById('login-btn');
        if (loginBtn) {
            loginBtn.textContent = 'Войти';
            loginBtn.style.display = '';
        }
        const dbWrapper = document.getElementById('db-btn-wrapper');
        if (dbWrapper) dbWrapper.style.display = 'none';
    }

    showDbButton() {
        const loginBtn = document.getElementById('login-btn');
        if (loginBtn) loginBtn.style.display = 'none';

        const dbWrapper = document.getElementById('db-btn-wrapper');
        const dbBtn = document.getElementById('db-btn');
        const dropdownToggle = document.getElementById('db-dropdown-toggle');
        const dropdown = document.getElementById('db-dropdown');

        if (!dbWrapper || !dbBtn) return;

        dbBtn.textContent = this.getDbLabel(this.selectedDb);
        dbWrapper.style.display = '';

        // Build full list for dropdown: ЛК always first, then other valid dbs
        const dropdownDbs = ['my', ...this.validDbs];

        if (dropdownDbs.length > 1) {
            dropdownToggle.style.display = '';
            this.renderDropdown(dropdown, dropdownDbs);
        } else {
            dropdownToggle.style.display = 'none';
            dropdown.style.display = 'none';
        }
    }

    renderDropdown(dropdown, dropdownDbs) {
        dropdown.innerHTML = '';
        dropdownDbs.forEach(db => {
            const item = document.createElement('a');
            item.className = 'db-dropdown-item';
            item.textContent = this.getDbLabel(db);
            item.href = '#';
            item.target = db;
            if (db === this.selectedDb) item.classList.add('db-dropdown-item-active');
            item.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                dropdown.style.display = 'none';
                this.selectedDb = db;
                CookieUtil.set('last_db', db, 365);
                this.showDbButton();
                await this.navigateToDb();
            });
            dropdown.appendChild(item);
        });
    }

    async navigateToDb() {
        if (!this.selectedDb) return;
        const host = this.apiConfig.host;
        const db = this.selectedDb;
        const data = await validateToken(host, db);
        if (!data) {
            if (db === 'my') {
                // No valid ЛК token — show auth panel with 'my' pre-selected
                window._app && window._app.showAuthPanel('my');
            } else {
                // Token invalid for a regular db — remove from list and refresh UI
                this.validDbs = this.validDbs.filter(d => d !== db);
                if (this.validDbs.length === 0 && !this.allIdbDbs.includes('my')) {
                    this.showLoginButton();
                } else {
                    // ЛК is always available, so still show db button
                    this.selectedDb = this.validDbs.length > 0 ? this.validDbs[0] : 'my';
                    this.showDbButton();
                }
            }
            return;
        }
        CookieUtil.set('last_db', db, 365);
        window.location.href = 'https://' + host + '/' + db;
    }

    async login(email, password, db) {
        const host = this.apiConfig.host;
        const targetDb = db || 'my';
        const url = 'https://' + host + '/' + targetDb + '/auth?JSON';
        try {
            const formData = new URLSearchParams();
            formData.append('db', targetDb);
            formData.append('login', email);
            formData.append('pwd', password);

            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: formData.toString(),
                credentials: 'include'
            });

            if (!response.ok) {
                if (response.status === 401) {
                    try {
                        const errData = await response.json();
                        if (errData.error) {
                            return { success: false, message: errData.error };
                        }
                    } catch (e) { /* ignore parse errors */ }
                    return { success: false, message: 'Неверное имя пользователя или пароль' };
                }
                throw new Error('HTTP ' + response.status);
            }

            const data = await response.json();
            if (data.msg && data.msg !== '') {
                return { success: false, message: data.msg };
            }
            return { success: true, message: 'Вход выполнен успешно!' };
        } catch (err) {
            console.error('[auth] login error:', err);
            return { success: false, message: 'Ошибка входа: ' + err.message };
        }
    }

    async register(email, password) {
        const host = this.apiConfig.host;
        const db = 'my';
        // First get xsrf token
        const xsrfData = await validateToken(host, db);
        const xsrfToken = xsrfData ? (xsrfData._xsrf || '') : '';

        const url = 'https://' + host + '/' + db + '/_m_new/18?up=1&next_act=inform';
        try {
            const formData = new URLSearchParams();
            formData.append('_xsrf', xsrfToken);
            formData.append('t18', email);
            formData.append('t20', password);

            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: formData.toString(),
                credentials: 'include'
            });

            if (!response.ok) {
                throw new Error('HTTP ' + response.status);
            }

            const data = await response.json();
            if (data.error) {
                return { success: false, message: data.error };
            }
            return { success: true, message: data.msg || 'Регистрация прошла успешно. Проверьте вашу почту для подтверждения.' };
        } catch (err) {
            console.error('[auth] register error:', err);
            return { success: false, message: 'Ошибка регистрации: ' + err.message };
        }
    }

    // Build options for the DB selector in the auth form
    // Always includes ЛК ('my'), plus all DBs with idb_* cookies (valid tokens)
    buildAuthDbOptions(preselect) {
        const select = document.getElementById('auth-db-select');
        if (!select) return;

        select.innerHTML = '';

        // ЛК always first
        const myOpt = document.createElement('option');
        myOpt.value = 'my';
        myOpt.textContent = 'Личный кабинет';
        select.appendChild(myOpt);

        // Add other valid dbs
        this.validDbs.forEach(db => {
            const opt = document.createElement('option');
            opt.value = db;
            opt.textContent = db;
            select.appendChild(opt);
        });

        // Add "Другая" option at the end
        const otherOpt = document.createElement('option');
        otherOpt.value = '__other__';
        otherOpt.textContent = 'Другая';
        select.appendChild(otherOpt);

        // Determine default: preselect param > last_db cookie > 'my'
        const lastUsed = preselect || CookieUtil.get('last_db') || 'my';
        // Select matching option if it exists
        let found = false;
        for (let i = 0; i < select.options.length; i++) {
            if (select.options[i].value === lastUsed) {
                select.selectedIndex = i;
                found = true;
                break;
            }
        }
        if (!found) select.selectedIndex = 0;

        // Reset custom input visibility on each rebuild
        const customGroup = document.getElementById('auth-db-custom-group');
        const customInput = document.getElementById('auth-db-custom');
        if (customGroup && customInput) {
            customGroup.style.display = 'none';
            customInput.value = '';
        }
    }
}

// ============================================================
// App initialization
// ============================================================
class App {
    constructor() {
        this.theme = new ThemeManager();
        this.apiConfig = new ApiConfig();
        this.auth = new AuthManager(this.apiConfig);
        this.yandexAuth = new YandexAuthManager(this.apiConfig);
        window._app = this;
    }

    navigateToDb() {
        this.auth.navigateToDb();
    }

    async init() {
        // Theme toggle — only bind on index.html (no theme-icon span present)
        // Cabinet page (main.html) binds its own handler in cabinet.js setupUserMenuDropdown()
        const themeToggle = document.getElementById('theme-toggle');
        if (themeToggle && !document.getElementById('theme-icon')) {
            themeToggle.addEventListener('click', () => {
                this.theme.toggleTheme();
            });
        }

        // Show/hide Yandex OAuth buttons
        if (this.yandexAuth.isEnabled()) {
            const yandexLoginBtn = document.getElementById('yandex-login-btn');
            const yandexRegisterBtn = document.getElementById('yandex-register-btn');
            const yandexDivider = document.getElementById('yandex-divider');
            const yandexRegDivider = document.getElementById('yandex-reg-divider');
            if (yandexLoginBtn) { yandexLoginBtn.style.display = ''; }
            if (yandexRegisterBtn) { yandexRegisterBtn.style.display = ''; }
            if (yandexDivider) { yandexDivider.style.display = ''; }
            if (yandexRegDivider) { yandexRegDivider.style.display = ''; }
        }

        // Yandex button handlers — pass the selected DB so the backend can redirect after auth
        const yandexLoginBtn = document.getElementById('yandex-login-btn');
        if (yandexLoginBtn) {
            yandexLoginBtn.addEventListener('click', () => {
                const dbSelect = document.getElementById('auth-db-select');
                const customInput = document.getElementById('auth-db-custom');
                var db = dbSelect ? dbSelect.value : 'my';
                if (db === '__other__') {
                    db = customInput ? customInput.value.trim() : '';
                }
                this.yandexAuth.initiateLogin(db || 'my');
            });
        }
        const yandexRegisterBtn = document.getElementById('yandex-register-btn');
        if (yandexRegisterBtn) {
            yandexRegisterBtn.addEventListener('click', () => {
                this.yandexAuth.initiateLogin('my');
            });
        }

        // Login button: show auth panel
        const loginBtn = document.getElementById('login-btn');
        if (loginBtn) {
            loginBtn.addEventListener('click', () => this.showAuthPanel());
        }

        // Close auth panel
        const closeAuth = document.getElementById('close-auth');
        if (closeAuth) {
            closeAuth.addEventListener('click', (e) => {
                e.preventDefault();
                this.hideAuthPanel();
            });
        }

        // Tab switching
        const tabLogin = document.getElementById('tab-login');
        const tabRegister = document.getElementById('tab-register');
        if (tabLogin) {
            tabLogin.addEventListener('click', () => this.switchTab('login'));
        }
        if (tabRegister) {
            tabRegister.addEventListener('click', () => this.switchTab('register'));
        }

        // "Другая" DB option: show/hide custom input on select change
        const authDbSelect = document.getElementById('auth-db-select');
        const authDbCustomGroup = document.getElementById('auth-db-custom-group');
        const authDbCustom = document.getElementById('auth-db-custom');
        const authDbBack = document.getElementById('auth-db-back');
        if (authDbSelect && authDbCustomGroup && authDbCustom) {
            authDbSelect.addEventListener('change', () => {
                if (authDbSelect.value === '__other__') {
                    authDbCustomGroup.style.display = '';
                    authDbCustom.focus();
                } else {
                    authDbCustomGroup.style.display = 'none';
                    authDbCustom.value = '';
                }
            });
        }
        if (authDbBack && authDbSelect && authDbCustomGroup && authDbCustom) {
            authDbBack.addEventListener('click', (e) => {
                e.preventDefault();
                authDbSelect.value = authDbSelect.options[0].value;
                authDbCustomGroup.style.display = 'none';
                authDbCustom.value = '';
            });
        }

        // Login form
        const loginForm = document.getElementById('login-form');
        if (loginForm) {
            let loginInProgress = false;
            loginForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                // Guard against double-submit while the async login request is in flight.
                if (loginInProgress) return;
                loginInProgress = true;
                const email = document.getElementById('login-email').value;
                const password = document.getElementById('login-password').value;
                const dbSelect = document.getElementById('auth-db-select');
                const customInput = document.getElementById('auth-db-custom');
                let selectedDb = dbSelect ? dbSelect.value : 'my';
                if (selectedDb === '__other__') {
                    selectedDb = customInput ? customInput.value.trim() : '';
                    if (!selectedDb) {
                        showToast('Введите имя базы данных', 'error');
                        loginInProgress = false;
                        return;
                    }
                }
                const result = await this.auth.login(email, password, selectedDb);
                if (result.success) {
                    CookieUtil.set('last_db', selectedDb, 365);
                    if (this._postLoginUri) {
                        window.location.href = window.location.origin + this._postLoginUri;
                    } else {
                        window.location.href = window.location.origin + '/' + selectedDb;
                    }
                } else {
                    showToast(result.message, 'error');
                    loginInProgress = false;
                }
            });
        }

        // Password reset toggle
        const resetLink = document.getElementById('reset-link');
        const backToLoginLink = document.getElementById('back-to-login-link');
        const resetSubmitBtn = document.getElementById('reset-submit-btn');
        const loginSubmitBtn = document.getElementById('login-submit-btn');
        const resetHint = document.getElementById('reset-hint');
        const loginPasswordGroup = document.getElementById('login-password-group');
        const loginEmailLabel = document.getElementById('login-email-label');
        const loginEmailInput = document.getElementById('login-email');
        const resetMessage = document.getElementById('reset-message');

        function enterResetMode() {
            if (loginSubmitBtn) loginSubmitBtn.style.display = 'none';
            if (resetSubmitBtn) resetSubmitBtn.style.display = '';
            if (resetHint) resetHint.style.display = '';
            if (loginPasswordGroup) loginPasswordGroup.style.display = 'none';
            if (resetLink) resetLink.style.display = 'none';
            if (backToLoginLink) backToLoginLink.style.display = '';
            if (loginEmailLabel) loginEmailLabel.textContent = 'Имя пользователя или Email';
            if (loginEmailInput) {
                loginEmailInput.type = 'text';
                loginEmailInput.placeholder = 'username или email';
                loginEmailInput.removeAttribute('required');
            }
            const loginPassword = document.getElementById('login-password');
            if (loginPassword) loginPassword.removeAttribute('required');
            if (resetMessage) resetMessage.style.display = 'none';
        }

        function exitResetMode() {
            if (loginSubmitBtn) loginSubmitBtn.style.display = '';
            if (resetSubmitBtn) resetSubmitBtn.style.display = 'none';
            if (resetHint) resetHint.style.display = 'none';
            if (loginPasswordGroup) loginPasswordGroup.style.display = '';
            if (resetLink) resetLink.style.display = '';
            if (backToLoginLink) backToLoginLink.style.display = 'none';
            if (loginEmailLabel) loginEmailLabel.textContent = 'Email / имя пользователя';
            if (loginEmailInput) {
                loginEmailInput.type = 'text';
                loginEmailInput.placeholder = 'your@email.com или имя пользователя';
                loginEmailInput.setAttribute('required', '');
            }
            const loginPassword = document.getElementById('login-password');
            if (loginPassword) loginPassword.setAttribute('required', '');
            if (resetMessage) resetMessage.style.display = 'none';
        }

        if (resetLink) {
            resetLink.addEventListener('click', (e) => {
                e.preventDefault();
                enterResetMode();
            });
        }

        if (backToLoginLink) {
            backToLoginLink.addEventListener('click', (e) => {
                e.preventDefault();
                exitResetMode();
            });
        }

        if (resetSubmitBtn) {
            resetSubmitBtn.addEventListener('click', async () => {
                const loginVal = loginEmailInput ? loginEmailInput.value.trim() : '';
                if (!loginVal) {
                    showToast('Введите имя пользователя или email', 'error');
                    return;
                }
                const dbSelect = document.getElementById('auth-db-select');
                const customInput = document.getElementById('auth-db-custom');
                let selectedDb = dbSelect ? dbSelect.value : 'my';
                if (selectedDb === '__other__') {
                    selectedDb = customInput ? customInput.value.trim() : '';
                    if (!selectedDb) {
                        showToast('Введите имя базы данных', 'error');
                        return;
                    }
                }
                resetSubmitBtn.disabled = true;
                try {
                    const url = `${encodeURIComponent(selectedDb)}/auth?JSON&reset&db=${encodeURIComponent(selectedDb)}&login=${encodeURIComponent(loginVal)}`;
                    const response = await fetch(url);
                    const text = await response.text();
                    let data = null;
                    try { data = JSON.parse(text); } catch (e) { data = null; }
                    if (resetMessage) {
                        resetMessage.style.display = '';
                        if (data === null) {
                            resetMessage.style.background = 'var(--bg-secondary)';
                            resetMessage.style.color = 'var(--text-primary)';
                            resetMessage.textContent = text;
                        } else {
                            const msg = (data.message || '').toUpperCase();
                            const isError = msg.includes('WRONG') || msg.includes('ERROR');
                            if (!isError) {
                                resetMessage.className = 'success-message';
                                resetMessage.textContent = data.details || data.message || text;
                            } else {
                                resetMessage.style.background = 'var(--bg-secondary)';
                                resetMessage.style.color = 'var(--error-color, #ef4444)';
                                resetMessage.textContent = Object.entries(data).map(([k, v]) => `${k}: ${v}`).join(', ');
                            }
                        }
                    }
                } catch (err) {
                    if (resetMessage) {
                        resetMessage.style.display = '';
                        resetMessage.style.color = 'var(--error-color, #ef4444)';
                        resetMessage.textContent = err.message || 'Ошибка при сбросе пароля';
                    }
                } finally {
                    resetSubmitBtn.disabled = false;
                }
            });
        }

        // OTP (one-time password to email)
        const otpBtn = document.getElementById('otp-btn');
        const otpMessage = document.getElementById('otp-message');
        const otpCodeGroup = document.getElementById('otp-code-group');
        const otpCodeInput = document.getElementById('otp-code-input');
        const otpSubmitBtn = document.getElementById('otp-submit-btn');

        function getSelectedDb() {
            const dbSelect = document.getElementById('auth-db-select');
            const customInput = document.getElementById('auth-db-custom');
            let db = dbSelect ? dbSelect.value : 'my';
            if (db === '__other__') {
                db = customInput ? customInput.value.trim() : '';
            }
            return db;
        }

        function showOtpMessage(text, isError) {
            if (!otpMessage) return;
            otpMessage.style.display = '';
            otpMessage.className = isError ? '' : 'success-message';
            if (isError) {
                otpMessage.style.background = 'var(--bg-secondary)';
                otpMessage.style.color = 'var(--error-color, #ef4444)';
            }
            otpMessage.textContent = text;
        }

        // Step 1: send email → request OTP code
        if (otpBtn) {
            otpBtn.addEventListener('click', async () => {
                const emailVal = loginEmailInput ? loginEmailInput.value.trim() : '';
                if (!emailVal) { showToast('Введите email', 'error'); return; }
                const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if (!emailRe.test(emailVal)) { showToast('Введите корректный email', 'error'); return; }
                const selectedDb = getSelectedDb();
                if (!selectedDb) { showToast('Введите имя базы данных', 'error'); return; }
                otpBtn.disabled = true;
                try {
                    const formData = new FormData();
                    formData.append('email', emailVal);
                    const response = await fetch(`${encodeURIComponent(selectedDb)}/otp`, {
                        method: 'POST',
                        credentials: 'include',
                        body: formData
                    });
                    const text = await response.text();
                    let data = null;
                    try { data = JSON.parse(text); } catch (e) { data = null; }
                    const isError = !response.ok || (data && (data.msg || '').toUpperCase().includes('ERROR'));
                    showOtpMessage(
                        (data && (data.msg || data.message || data.details)) || text,
                        isError
                    );
                    if (!isError && otpCodeGroup) {
                        otpCodeGroup.style.display = '';
                        if (otpCodeInput) otpCodeInput.focus();
                    }
                } catch (err) {
                    showOtpMessage(err.message || 'Ошибка при отправке кода', true);
                } finally {
                    otpBtn.disabled = false;
                }
            });
        }

        // Step 2: submit OTP code → login
        if (otpSubmitBtn) {
            otpSubmitBtn.addEventListener('click', async () => {
                const emailVal = loginEmailInput ? loginEmailInput.value.trim() : '';
                const codeVal = otpCodeInput ? otpCodeInput.value.trim() : '';
                if (!codeVal) { showToast('Введите код из письма', 'error'); return; }
                const selectedDb = getSelectedDb();
                if (!selectedDb) { showToast('Введите имя базы данных', 'error'); return; }
                otpSubmitBtn.disabled = true;
                try {
                    const formData = new FormData();
                    formData.append('email', emailVal);
                    formData.append('otp', codeVal);
                    const response = await fetch(`${encodeURIComponent(selectedDb)}/otp`, {
                        method: 'POST',
                        credentials: 'include',
                        body: formData
                    });
                    const text = await response.text();
                    let data = null;
                    try { data = JSON.parse(text); } catch (e) { data = null; }
                    if (data && data.token && (data.msg === '' || data.msg == null)) {
                        CookieUtil.set('last_db', selectedDb, 365);
                        window.location.href = window.location.origin + '/' + selectedDb;
                    } else {
                        const errText = (data && (data.msg || data.message)) || text || 'Неверный код';
                        showOtpMessage(errText, true);
                        otpSubmitBtn.disabled = false;
                    }
                } catch (err) {
                    showOtpMessage(err.message || 'Ошибка при проверке кода', true);
                    otpSubmitBtn.disabled = false;
                }
            });
        }

        // Register form
        const registerForm = document.getElementById('register-form');
        if (registerForm) {
            let registerInProgress = false;
            registerForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                // Guard against double-submit while the async register request is in flight.
                if (registerInProgress) return;
                const email = document.getElementById('reg-email').value;
                const password = document.getElementById('reg-password').value;
                const confirmPassword = document.getElementById('reg-confirm-password').value;

                if (password !== confirmPassword) {
                    showToast('Пароли не совпадают', 'error');
                    return;
                }
                if (password.length < 6) {
                    showToast('Пароль должен содержать минимум 6 символов', 'error');
                    return;
                }

                registerInProgress = true;
                const result = await this.auth.register(email, password);
                showToast(result.message, result.success ? 'success' : 'error');
                if (result.success) {
                    this.hideAuthPanel();
                } else {
                    registerInProgress = false;
                }
            });
        }

        // Dropdown toggle
        const dropdownToggle = document.getElementById('db-dropdown-toggle');
        const dropdown = document.getElementById('db-dropdown');
        if (dropdownToggle && dropdown) {
            dropdownToggle.addEventListener('click', (e) => {
                e.stopPropagation();
                const isVisible = dropdown.style.display !== 'none';
                dropdown.style.display = isVisible ? 'none' : '';
            });
            // Close dropdown when clicking outside
            document.addEventListener('click', () => {
                if (dropdown.style.display !== 'none') {
                    dropdown.style.display = 'none';
                }
            });
        }

        // Check auth state from cookies
        this.auth.init();

        // Handle r=InvalidToken URL parameter: show login form
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('r') === 'InvalidToken') {
            const dbParam = urlParams.get('db');
            const uriParam = urlParams.get('uri');

            // If db param specified, ensure it's available in the auth DB selector
            if (dbParam && dbParam !== 'my' && !this.auth.validDbs.includes(dbParam)) {
                this.auth.validDbs.push(dbParam);
            }

            // Store uri for post-login redirect, but never redirect back to OAuth callbacks
            if (uriParam && !uriParam.toLowerCase().includes('auth.asp')) {
                this._postLoginUri = uriParam;
            }

            this.showAuthPanel(dbParam || undefined);
        } else if (urlParams.get('r') === 'oauthError') {
            // OAuth provider returned an error or token exchange failed
            const details = urlParams.get('d');
            const msg = details ? details : 'Ошибка авторизации';
            showToast(msg, 'error');
            this.showAuthPanel();
        } else if (urlParams.get('u')) {
            // Handle login link with pre-filled username: ?db=tgroup&u=username
            const dbParam = urlParams.get('db');
            const usernameParam = urlParams.get('u');

            // If db param specified, ensure it's available in the auth DB selector
            if (dbParam && dbParam !== 'my' && !this.auth.validDbs.includes(dbParam)) {
                this.auth.validDbs.push(dbParam);
            }

            this.showAuthPanel(dbParam || undefined);

            // Pre-fill username and focus password field
            const loginEmailInput = document.getElementById('login-email');
            const loginPasswordInput = document.getElementById('login-password');
            if (loginEmailInput) {
                loginEmailInput.value = usernameParam;
            }
            if (loginPasswordInput) {
                loginPasswordInput.focus();
            }
        }
    }

    showAuthPanel(preselect) {
        const authPanel = document.getElementById('auth-panel');
        if (authPanel) authPanel.style.display = '';
        const welcomeSection = document.getElementById('welcome-section');
        if (welcomeSection) welcomeSection.style.display = 'none';
        this.switchTab('login');
        // Build DB options with the preselected db
        this.auth.buildAuthDbOptions(preselect);
    }

    hideAuthPanel() {
        const authPanel = document.getElementById('auth-panel');
        if (authPanel) authPanel.style.display = 'none';
        const welcomeSection = document.getElementById('welcome-section');
        if (welcomeSection) welcomeSection.style.display = '';
    }

    switchTab(tab) {
        const loginSection = document.getElementById('login-section');
        const registerSection = document.getElementById('register-section');
        const tabLogin = document.getElementById('tab-login');
        const tabRegister = document.getElementById('tab-register');

        if (tab === 'login') {
            if (loginSection) loginSection.style.display = '';
            if (registerSection) registerSection.style.display = 'none';
            if (tabLogin) tabLogin.classList.add('auth-tab-active');
            if (tabRegister) tabRegister.classList.remove('auth-tab-active');
        } else {
            if (loginSection) loginSection.style.display = 'none';
            if (registerSection) registerSection.style.display = '';
            if (tabLogin) tabLogin.classList.remove('auth-tab-active');
            if (tabRegister) tabRegister.classList.add('auth-tab-active');
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const app = new App();
    app.init();
});
