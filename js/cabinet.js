// ============================================================
// Cabinet Page Controller
// ============================================================

class CabinetController {
    constructor() {
        this.userData = null;
        this.databases = [];
        this.currentSection = 'databases';
        this.apiConfig = new ApiConfig();
        
        this.me = null; // user identifier for save API
        this.originalProfileValues = {}; // tracks original values to detect changes
    }

    async init() {
        // Check authentication first
        const isAuthenticated = await this.checkAuth();
        if (!isAuthenticated) {
            window.location.href = 'index.html';
            return;
        }

        // Setup menu navigation
        this.setupMenuNavigation();

        // Setup sidebar toggle
        this.setupSidebarToggle();

        // Setup form handlers
        this.setupFormHandlers();

        // Setup copy buttons
        this.setupCopyButtons();

        // Setup referrals tabs
        this.setupReferralsTabs();

        // Setup user menu dropdown
        this.setupUserMenuDropdown();

        // Setup logout button
        this.setupLogout();

        // Load user data
        await this.loadUserData();

        // Show default section
        this.showSection('databases');
    }

    async checkAuth() {
        // Check for any valid idb_* cookie
        const cookies = document.cookie.split(';');
        for (const c of cookies) {
            const trimmed = c.trim();
            if (trimmed.startsWith('idb_')) {
                console.log('[cabinet] Found auth cookie:', trimmed.split('=')[0]);
                return true;
            }
        }
        console.log('[cabinet] No auth cookie found');
        return false;
    }

    setupSidebarToggle() {
        const sidebar = document.getElementById('cabinet-sidebar');
        const toggleBtn = document.getElementById('sidebar-toggle');
        if (!sidebar || !toggleBtn) return;

        // Restore collapsed state from localStorage
        if (localStorage.getItem('sidebarCollapsed') === 'true') {
            sidebar.classList.add('collapsed');
            toggleBtn.title = 'Развернуть меню';
        }

        toggleBtn.addEventListener('click', () => {
            const isCollapsed = sidebar.classList.toggle('collapsed');
            localStorage.setItem('sidebarCollapsed', isCollapsed ? 'true' : 'false');
            toggleBtn.title = isCollapsed ? 'Развернуть меню' : 'Свернуть меню';
        });
    }

    setupMenuNavigation() {
        const menuItems = document.querySelectorAll('.cabinet-menu-item');
        menuItems.forEach(item => {
            item.addEventListener('click', () => {
                const section = item.dataset.section;
                this.showSection(section);

                // Update active state
                menuItems.forEach(mi => mi.classList.remove('active'));
                item.classList.add('active');
            });
        });
    }

    showSection(sectionName) {
        this.currentSection = sectionName;

        // Hide all sections
        const sections = document.querySelectorAll('.cabinet-section');
        sections.forEach(s => s.style.display = 'none');

        // Hide loading state
        const loadingState = document.getElementById('loading-state');
        if (loadingState) loadingState.style.display = 'none';

        // Show requested section
        const section = document.getElementById('section-' + sectionName);
        if (section) {
            section.style.display = '';
        }

        // Sync active menu item
        const menuItems = document.querySelectorAll('.cabinet-menu-item');
        menuItems.forEach(mi => {
            if (mi.dataset.section === sectionName) {
                mi.classList.add('active');
            } else {
                mi.classList.remove('active');
            }
        });
    }

    async loadUserData() {
        const loadingState = document.getElementById('loading-state');
        if (loadingState) loadingState.style.display = '';

        try {
            // Call the API endpoint: report/313?JSON_KV
            const host = this.apiConfig.host;
            const url = 'https://' + host + '/my/report/313?JSON_KV';

            const response = await fetch(url, {
                method: 'GET',
                credentials: 'include'
            });

            if (!response.ok) {
                throw new Error('HTTP ' + response.status);
            }

            const data = await response.json();
            console.log('[cabinet] User data loaded:', data);

            // Parse the response - it's an array of database records
            if (Array.isArray(data) && data.length > 0) {
                this.userData = data[0]; // First record contains user info
                this.me = this.userData.User || null;
                this.databases = data;
                this.populateUserData();
            } else {
                console.warn('[cabinet] No user data received');
            }
        } catch (err) {
            console.error('[cabinet] Error loading user data:', err);
        } finally {
            if (loadingState) loadingState.style.display = 'none';
            // Show default section after loading
            this.showSection(this.currentSection);
        }
    }

    populateUserData() {
        if (!this.userData) return;

        // Update account info in navbar
        this.updateNavbarAccount();

        // Populate profile section
        this.populateProfile();

        // Populate balance section
        this.populateBalance();

        // Populate databases section
        this.populateDatabases();

        // Populate bonuses section
        this.populateBonuses();

        // Populate referrals section
        this.populateReferrals();
    }

    updateNavbarAccount() {
        const emailEl = document.getElementById('account-email');
        const avatarEl = document.getElementById('account-avatar');

        if (emailEl && this.userData.Email) {
            emailEl.textContent = this.userData.Email;
        }

        if (avatarEl && this.userData.Email) {
            avatarEl.textContent = this.userData.Email.charAt(0).toUpperCase();
        }

        // If there's a picture, show it in avatar
        if (avatarEl && this.userData.Picture) {
            avatarEl.innerHTML = '<img src="' + this.userData.Picture + '" alt="Avatar" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">';
        }
    }

    populateProfile() {
        // Name
        const nameInput = document.getElementById('profile-name');
        if (nameInput) nameInput.value = this.userData.Name || '';

        // Phone
        const phoneInput = document.getElementById('profile-phone');
        if (phoneInput) phoneInput.value = this.userData.Phone || '';

        // Email (readonly)
        const emailInput = document.getElementById('profile-email');
        if (emailInput) emailInput.value = this.userData.Email || '';

        // About (Notes)
        const aboutInput = document.getElementById('profile-about');
        if (aboutInput) aboutInput.value = this.userData.Notes || '';

        // Public profile checkbox (t307)
        const publicCheckbox = document.getElementById('profile-public');
        if (publicCheckbox) {
            publicCheckbox.checked = !!(this.userData.t307 || this.userData.Public);
        }

        // Store original values for change detection
        this.originalProfileValues = {
            'profile-name': this.userData.Name || '',
            'profile-phone': this.userData.Phone || '',
            'profile-about': this.userData.Notes || '',
            'profile-public': !!(this.userData.t307 || this.userData.Public)
        };

        // Hide save button initially
        const saveBtn = document.getElementById('save-profile-btn');
        if (saveBtn) saveBtn.style.display = 'none';

        // Set up change detection on editable profile fields
        ['profile-name', 'profile-phone', 'profile-about'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('input', () => this.onProfileChange());
        });

        // Change detection for public profile checkbox
        if (publicCheckbox) {
            publicCheckbox.addEventListener('change', () => this.onProfileChange());
        }

        // Photo preview
        if (this.userData.Picture) {
            const photoPreview = document.getElementById('profile-photo-preview');
            if (photoPreview) {
                photoPreview.innerHTML = '<img src="' + this.userData.Picture + '" alt="Profile photo">';
            }
        }

        // Tariff info
        const currentPlan = document.getElementById('current-plan');
        if (currentPlan) {
            currentPlan.textContent = this.userData.Plan || 'Free';
        }

        const nextChargeDate = document.getElementById('next-charge-date');
        if (nextChargeDate && this.userData['Plan date']) {
            nextChargeDate.textContent = this.formatDate(this.userData['Plan date']);
        }

        // Usage info
        this.updateUsageInfo();
    }

    updateUsageInfo() {
        // Calculate total resource usage across all databases
        let totalCount = 0;
        this.databases.forEach(db => {
            totalCount += parseInt(db.Count || '0', 10);
        });

        const limit = 20000; // Free plan limit
        const usagePercent = ((totalCount / limit) * 100).toFixed(2);

        // Profile section
        const usageUnits = document.getElementById('usage-units');
        const usagePercentEl = document.getElementById('usage-percent');
        const usageLimitEl = document.getElementById('usage-limit');
        const usageBarFill = document.getElementById('usage-bar-fill');

        if (usageUnits) usageUnits.textContent = totalCount.toFixed(2);
        if (usagePercentEl) usagePercentEl.textContent = usagePercent + '%';
        if (usageLimitEl) usageLimitEl.textContent = limit.toString();
        if (usageBarFill) usageBarFill.style.width = Math.min(parseFloat(usagePercent), 100) + '%';

        // Balance section
        const balanceUsageUnits = document.getElementById('balance-usage-units');
        const balanceUsagePercent = document.getElementById('balance-usage-percent');
        const balanceUsageLimit = document.getElementById('balance-usage-limit');

        if (balanceUsageUnits) balanceUsageUnits.textContent = totalCount.toFixed(2);
        if (balanceUsagePercent) balanceUsagePercent.textContent = usagePercent + '%';
        if (balanceUsageLimit) balanceUsageLimit.textContent = limit.toString();
    }

    populateBalance() {
        const balanceAmount = document.getElementById('balance-amount');
        if (balanceAmount) {
            balanceAmount.textContent = this.userData.Balance || '0';
        }
    }

    populateDatabases() {
        const container = document.getElementById('databases-list');
        if (!container) return;

        container.innerHTML = '';

        if (this.databases.length === 0) {
            container.innerHTML = '<p class="empty-message">Нет баз данных</p>';
            return;
        }

        this.databases.forEach(db => {
            const card = document.createElement('div');
            card.className = 'database-card';

            const templateLabel = db.Template || 'default';
            const description = db.Description || '';
            const recordCount = db.Count || '0';
            const planDate = db['Plan date'] ? this.formatDate(db['Plan date']) : '-';
            const planDateRaw = db['Plan date'] || '';
            const publicName = db.PublicName || '';
            const registrationOpen = !!(db.Register);
            const tokenLifetime = db.TTL || '';
            const dbId = db.DBID;

            const dbNameCapitalized = db.DB ? db.DB.charAt(0).toUpperCase() + db.DB.slice(1) : '';
            const planDatePassed = this.isDatePassed(planDateRaw);

            card.innerHTML = `
                <div class="database-info">
                    <div class="database-name-row">
                        <a class="database-name-link" href="https://${this.apiConfig.host}/${db.DB}" target="${this.escapeHtml(db.DB)}">${this.escapeHtml(dbNameCapitalized)}</a>
                        <span class="database-id-inline">#${this.escapeHtml(dbId)}</span>
                    </div>
                    <div class="database-stats">
                        <span class="database-stat"><span>Шаблон:</span> <strong>${this.escapeHtml(templateLabel)}</strong></span>
                        <span class="database-stat"><span>Расход:</span> <strong>${recordCount}</strong></span>
                        <span class="database-stat database-stat-right"><span>Оплачено до:</span> <strong class="${planDatePassed ? 'plan-date-expired' : ''}">${planDate}</strong></span>
                    </div>
                    <div class="database-edit-fields">
                        <div class="database-field-group">
                            <label class="database-field-label">Описание</label>
                            <textarea class="database-field-input database-description-input" rows="2" data-field="t276">${this.escapeHtml(description)}</textarea>
                        </div>
                        <div class="database-field-group">
                            <label class="database-field-label">Публичное имя</label>
                            <input type="text" class="database-field-input database-public-name-input" maxlength="127" pattern="[A-Za-zА-Яа-яЁё0-9\\s.,!?;:—…«»'&quot;\\-]+" data-field="t305" data-dbname="${this.escapeHtml(db.DB)}" value="${this.escapeHtml(publicName)}">
                        </div>
                        <div class="database-field-group database-field-group-row database-inline-row">
                            <label class="database-field-label database-inline-label">
                                <input type="checkbox" class="database-checkbox" data-field="t367"${registrationOpen ? ' checked' : ''}>
                                Регистрация открыта
                            </label>
                            <label class="database-field-label database-inline-label">
                                Время жизни токена, минут
                                <input type="number" class="database-field-input database-field-input-short" min="0" step="1" data-field="t369" value="${this.escapeHtml(tokenLifetime)}">
                            </label>
                        </div>
                        <div class="database-save-row">
                            <button type="button" class="btn-primary btn-small database-save-btn" style="display:none">Сохранить</button>
                            <span class="database-save-status"></span>
                        </div>
                    </div>
                </div>
            `;

            // Track original values for change detection
            const origValues = {
                t276: description,
                t305: publicName,
                t367: registrationOpen,
                t369: tokenLifetime
            };

            // Set up change detection
            card.querySelectorAll('[data-field]').forEach(input => {
                const eventType = input.type === 'checkbox' ? 'change' : 'input';
                input.addEventListener(eventType, () => {
                    this.onDbFieldChange(card, origValues);
                });
            });

            // Save public name to cookie when edited
            const publicNameInput = card.querySelector('.database-public-name-input');
            if (publicNameInput) {
                publicNameInput.addEventListener('input', () => {
                    const dbName = publicNameInput.dataset.dbname;
                    if (dbName) {
                        document.cookie = 'idbname_' + dbName + '=' + encodeURIComponent(publicNameInput.value) + ';path=/;max-age=31536000';
                    }
                });
            }

            // Set up save button
            const saveBtn = card.querySelector('.database-save-btn');
            if (saveBtn) {
                saveBtn.addEventListener('click', () => this.saveDatabase(dbId, card, origValues));
            }

            container.appendChild(card);
        });
    }

    onDbFieldChange(card, origValues) {
        const saveBtn = card.querySelector('.database-save-btn');
        if (!saveBtn) return;

        const hasChanges = Array.from(card.querySelectorAll('[data-field]')).some(input => {
            const field = input.dataset.field;
            if (input.type === 'checkbox') {
                return input.checked !== origValues[field];
            }
            return input.value !== origValues[field];
        });

        saveBtn.style.display = hasChanges ? '' : 'none';
    }

    async saveDatabase(dbId, card, origValues) {
        const saveBtn = card.querySelector('.database-save-btn');
        const statusEl = card.querySelector('.database-save-status');
        if (saveBtn) saveBtn.disabled = true;

        try {
            const host = this.apiConfig.host;
            const url = 'https://' + host + '/my/_m_set/' + encodeURIComponent(dbId) + '?JSON';

            const fd = new FormData();
            card.querySelectorAll('[data-field]').forEach(input => {
                if (input.type === 'checkbox') {
                    fd.append(input.dataset.field, input.checked ? '1' : '');
                } else {
                    fd.append(input.dataset.field, input.value);
                }
            });
            fd.append('_xsrf', xsrf);

            const response = await fetch(url, {
                method: 'POST',
                credentials: 'include',
                body: fd
            });

            if (!response.ok) {
                throw new Error('HTTP ' + response.status);
            }

            // Update original values after successful save
            card.querySelectorAll('[data-field]').forEach(input => {
                const field = input.dataset.field;
                if (input.type === 'checkbox') {
                    origValues[field] = input.checked;
                } else {
                    origValues[field] = input.value;
                }
            });

            // Save public name to cookie after successful save
            const publicNameInput = card.querySelector('.database-public-name-input');
            if (publicNameInput) {
                const dbName = publicNameInput.dataset.dbname;
                if (dbName) {
                    document.cookie = 'idbname_' + dbName + '=' + encodeURIComponent(publicNameInput.value) + ';path=/;max-age=31536000';
                }
            }

            if (saveBtn) saveBtn.style.display = 'none';
            showToast('Настройки базы данных сохранены', 'success');
        } catch (err) {
            console.error('[cabinet] Error saving database settings:', err);
            showToast('Ошибка сохранения настроек базы данных', 'error');
        } finally {
            if (saveBtn) saveBtn.disabled = false;
        }
    }

    populateBonuses() {
        const bonusesAmount = document.getElementById('bonuses-amount');
        if (bonusesAmount) {
            bonusesAmount.textContent = this.userData.Bonus || '0';
        }
    }

    populateReferrals() {
        // Referral links
        const userId = this.userData.DBID || '0';
        const registerLink = document.getElementById('referral-link-register');
        const siteLink = document.getElementById('referral-link-site');

        if (registerLink) {
            const regUrl = 'https://ideav.ru?aff=' + userId;
            registerLink.href = regUrl;
            registerLink.textContent = regUrl;
        }

        if (siteLink) {
            const siteUrl = 'https://ideav.ru/ru?aff=' + userId;
            siteLink.href = siteUrl;
            siteLink.textContent = siteUrl;
        }

        // Referral statistics
        const referrals = this.userData.Referrals || '';
        // Parse referrals if it's a comma-separated list or similar
        const referralCount = referrals ? referrals.split(',').filter(r => r.trim()).length : 0;

        const statsClients = document.getElementById('stats-clients');
        if (statsClients) {
            statsClients.textContent = referralCount.toString();
        }
    }

    setupFormHandlers() {
        // Save profile button
        const saveProfileBtn = document.getElementById('save-profile-btn');
        if (saveProfileBtn) {
            saveProfileBtn.addEventListener('click', () => this.saveProfile());
        }

        // Photo upload
        const uploadPhotoBtn = document.getElementById('upload-photo-btn');
        const photoInput = document.getElementById('profile-photo');
        if (uploadPhotoBtn && photoInput) {
            uploadPhotoBtn.addEventListener('click', () => photoInput.click());
            photoInput.addEventListener('change', (e) => this.handlePhotoUpload(e));
        }

        // Change plan button
        const changePlanBtn = document.getElementById('change-plan-btn');
        if (changePlanBtn) {
            changePlanBtn.addEventListener('click', () => this.changePlan());
        }

        // Add funds button
        const addFundsBtn = document.getElementById('add-funds-btn');
        if (addFundsBtn) {
            addFundsBtn.addEventListener('click', () => this.addFunds());
        }

        // Convert bonuses button
        const convertBonusesBtn = document.getElementById('convert-bonuses-btn');
        if (convertBonusesBtn) {
            convertBonusesBtn.addEventListener('click', () => this.convertBonuses());
        }

        // Withdraw referrals button
        const withdrawReferralsBtn = document.getElementById('withdraw-referrals-btn');
        if (withdrawReferralsBtn) {
            withdrawReferralsBtn.addEventListener('click', () => this.withdrawReferrals());
        }
    }

    onProfileChange() {
        const saveBtn = document.getElementById('save-profile-btn');
        if (!saveBtn) return;

        const textChanged = ['profile-name', 'profile-phone', 'profile-about'].some(id => {
            const el = document.getElementById(id);
            return el && el.value !== this.originalProfileValues[id];
        });

        const publicCheckbox = document.getElementById('profile-public');
        const publicChanged = publicCheckbox && (publicCheckbox.checked !== this.originalProfileValues['profile-public']);

        saveBtn.style.display = (textChanged || publicChanged) ? '' : 'none';
    }

    async saveProfile() {
        if (!this.me) {
            console.error('[cabinet] Cannot save profile: user identifier (me) is not set');
            showToast('Ошибка сохранения профиля', 'error');
            return;
        }

        const saveBtn = document.getElementById('save-profile-btn');
        if (saveBtn) saveBtn.disabled = true;

        try {
            const host = this.apiConfig.host;
            const url = 'https://' + host + '/my/_m_save/' + this.me + '?JSON';

            const photoInput = document.getElementById('profile-photo');
            const hasPhoto = photoInput && photoInput.files && photoInput.files.length > 0;

            const fd = new FormData();
            fd.append('t33', document.getElementById('profile-name')?.value || '');
            fd.append('t30', document.getElementById('profile-phone')?.value || '');
            fd.append('t39', document.getElementById('profile-about')?.value || '');
            const publicCheckbox = document.getElementById('profile-public');
            fd.append('t307', publicCheckbox && publicCheckbox.checked ? '1' : '');
            if (hasPhoto) {
                fd.append('t38', photoInput.files[0]);
            }
            fd.append('_xsrf', xsrf);

            const response = await fetch(url, {
                method: 'POST',
                credentials: 'include',
                body: fd
            });

            if (!response.ok) {
                throw new Error('HTTP ' + response.status);
            }

            // Update original values after successful save
            this.originalProfileValues['profile-name'] = document.getElementById('profile-name')?.value || '';
            this.originalProfileValues['profile-phone'] = document.getElementById('profile-phone')?.value || '';
            this.originalProfileValues['profile-about'] = document.getElementById('profile-about')?.value || '';
            this.originalProfileValues['profile-public'] = !!(publicCheckbox && publicCheckbox.checked);

            if (saveBtn) saveBtn.style.display = 'none';
            showToast('Профиль сохранен', 'success');
        } catch (err) {
            console.error('[cabinet] Error saving profile:', err);
            showToast('Ошибка сохранения профиля', 'error');
        } finally {
            if (saveBtn) saveBtn.disabled = false;
        }
    }

    handlePhotoUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        // Preview the image
        const reader = new FileReader();
        reader.onload = (e) => {
            const photoPreview = document.getElementById('profile-photo-preview');
            if (photoPreview) {
                photoPreview.innerHTML = '<img src="' + e.target.result + '" alt="Profile photo">';
            }
        };
        reader.readAsDataURL(file);

        // Show save button since there's a new photo to save
        const saveBtn = document.getElementById('save-profile-btn');
        if (saveBtn) saveBtn.style.display = '';
    }

    changePlan() {
        const planSelect = document.getElementById('plan-select');
        const selectedPlan = planSelect?.value || 'free';

        // TODO: Implement plan change API call
        showToast('Для смены плана обратитесь в поддержку', 'info');
    }

    addFunds() {
        // TODO: Implement add funds functionality
        showToast('Функция пополнения счета будет доступна позже', 'info');
    }

    convertBonuses() {
        const bonusAmount = parseInt(this.userData?.Bonus || '0', 10);
        if (bonusAmount <= 0) {
            showToast('У вас нет бонусов для конвертации', 'info');
            return;
        }

        // TODO: Implement bonus conversion API call
        showToast('Функция конвертации бонусов будет доступна позже', 'info');
    }

    withdrawReferrals() {
        // TODO: Implement referral withdrawal functionality
        showToast('Функция вывода средств будет доступна позже', 'info');
    }

    setupReferralsTabs() {
        const tabs = document.querySelectorAll('.referrals-tab');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const tabName = tab.dataset.tab;

                // Update active tab
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');

                // Show corresponding content
                const contents = document.querySelectorAll('.referrals-tab-content');
                contents.forEach(c => c.style.display = 'none');
                const content = document.getElementById('referrals-tab-' + tabName);
                if (content) content.style.display = '';
            });
        });
    }

    setupCopyButtons() {
        const copyBtns = document.querySelectorAll('.copy-btn');
        copyBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const targetId = btn.dataset.copy;
                const targetEl = document.getElementById(targetId);
                if (targetEl) {
                    const text = targetEl.href || targetEl.textContent;
                    navigator.clipboard.writeText(text).then(() => {
                        const originalHTML = btn.innerHTML;
                        btn.innerHTML = '<i class="pi pi-check"></i>';
                        setTimeout(() => {
                            btn.innerHTML = originalHTML;
                        }, 2000);
                    }).catch(err => {
                        console.error('[cabinet] Copy failed:', err);
                    });
                }
            });
        });
    }

    setupUserMenuDropdown() {
        const menuToggle = document.getElementById('user-menu-toggle');
        const menuDropdown = document.getElementById('user-menu-dropdown');
        const menuWrapper = menuToggle ? menuToggle.closest('.user-menu-wrapper') : null;

        if (!menuToggle || !menuDropdown) return;

        // Toggle dropdown on click
        menuToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = menuDropdown.style.display !== 'none';
            menuDropdown.style.display = isOpen ? 'none' : '';
            if (menuWrapper) {
                menuWrapper.classList.toggle('open', !isOpen);
            }
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!menuToggle.contains(e.target) && !menuDropdown.contains(e.target)) {
                menuDropdown.style.display = 'none';
                if (menuWrapper) {
                    menuWrapper.classList.remove('open');
                }
            }
        });

        // Theme toggle
        const themeToggle = document.getElementById('theme-toggle');
        if (themeToggle) {
            themeToggle.addEventListener('click', (e) => {
                e.stopPropagation();
                // Use the theme manager from app.js if available
                if (window._app && window._app.theme) {
                    window._app.theme.toggleTheme();
                } else {
                    // Fallback: toggle manually
                    const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
                    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
                    document.documentElement.setAttribute('data-theme', newTheme);
                    localStorage.setItem('theme', newTheme);
                }
                this.updateThemeMenuLabels();
            });
        }

        // Initialize labels
        this.updateThemeMenuLabels();
    }

    updateThemeMenuLabels() {
        const themeIcon = document.getElementById('theme-icon');
        const themeValue = document.getElementById('theme-value');
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

        if (themeIcon) {
            themeIcon.innerHTML = isDark ? '<i class="pi pi-sun"></i>' : '<i class="pi pi-moon"></i>';
        }
        if (themeValue) {
            themeValue.textContent = isDark ? 'Светлая' : 'Темная';
        }
    }

    setupLogout() {
        const logoutBtn = document.getElementById('logout-btn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => {
                // Delete all idb_* cookies
                const cookies = document.cookie.split(';');
                cookies.forEach(c => {
                    const name = c.split('=')[0].trim();
                    if (name.startsWith('idb_')) {
                        document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/';
                    }
                });

                // Redirect to index
                window.location.href = 'index.html';
            });
        }
    }

    isDatePassed(dateStr) {
        // Input format: DD.MM.YYYY
        if (!dateStr) return false;
        const parts = dateStr.split('.');
        if (parts.length !== 3) return false;
        const date = new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
        return date < new Date();
    }

    formatDate(dateStr) {
        // Input format: DD.MM.YYYY
        if (!dateStr) return '-';

        const parts = dateStr.split('.');
        if (parts.length !== 3) return dateStr;

        const months = [
            'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
            'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
        ];

        const day = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1;
        const year = parts[2];

        if (month >= 0 && month < 12) {
            return day + ' ' + months[month] + ' ' + year;
        }

        return dateStr;
    }

    escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
}

// Initialize cabinet when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    // Wait for app.js to initialize first
    setTimeout(() => {
        const cabinet = new CabinetController();
        cabinet.init();
    }, 100);
});
