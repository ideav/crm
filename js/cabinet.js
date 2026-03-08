// ============================================================
// Cabinet Page Controller
// ============================================================

class CabinetController {
    constructor() {
        this.userData = null;
        this.databases = [];
        this.currentSection = 'profile';
        this.apiConfig = new ApiConfig();
        this.i18n = window._app ? window._app.i18n : new I18nManager();
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

        // Setup user menu dropdown
        this.setupUserMenuDropdown();

        // Setup logout button
        this.setupLogout();

        // Load user data
        await this.loadUserData();

        // Show default section
        this.showSection('profile');
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
            container.innerHTML = '<p class="empty-message" data-i18n="cabinet.databases.noData">Нет баз данных</p>';
            return;
        }

        this.databases.forEach(db => {
            const card = document.createElement('div');
            card.className = 'database-card';

            const templateLabel = db.Template || 'default';
            const description = db.Description || '';
            const recordCount = db.Count || '0';
            const planDate = db['Plan date'] ? this.formatDate(db['Plan date']) : '-';

            card.innerHTML = `
                <div class="database-info">
                    <div class="database-name">${this.escapeHtml(db.DB)}</div>
                    <div class="database-id">ID: ${db.DBID}</div>
                    ${description ? '<div class="database-description">' + this.escapeHtml(description) + '</div>' : ''}
                    <div class="database-stats">
                        <span class="database-stat"><span data-i18n="cabinet.databases.template">Шаблон:</span> <strong>${this.escapeHtml(templateLabel)}</strong></span>
                        <span class="database-stat"><span data-i18n="cabinet.databases.records">Записей:</span> <strong>${recordCount}</strong></span>
                        <span class="database-stat"><span data-i18n="cabinet.databases.planDate">Оплачено до:</span> <strong>${planDate}</strong></span>
                    </div>
                </div>
                <div class="database-actions">
                    <button type="button" class="btn-secondary btn-small" onclick="window.open('https://${this.apiConfig.host}/${db.DB}', '_blank')" data-i18n="cabinet.databases.open">Открыть</button>
                </div>
            `;

            container.appendChild(card);
        });

        // Re-apply i18n
        if (this.i18n) {
            this.i18n.applyAll();
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

    async saveProfile() {
        const name = document.getElementById('profile-name')?.value || '';
        const phone = document.getElementById('profile-phone')?.value || '';
        const about = document.getElementById('profile-about')?.value || '';

        try {
            // TODO: Implement profile save API call
            // For now, show a message
            alert(this.i18n.t('cabinet.profile.saveSuccess') || 'Профиль сохранен');
        } catch (err) {
            console.error('[cabinet] Error saving profile:', err);
            alert(this.i18n.t('cabinet.profile.saveError') || 'Ошибка сохранения профиля');
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

        // TODO: Implement photo upload API call
    }

    changePlan() {
        const planSelect = document.getElementById('plan-select');
        const selectedPlan = planSelect?.value || 'free';

        // TODO: Implement plan change API call
        alert(this.i18n.t('cabinet.profile.planChangeInfo') || 'Для смены плана обратитесь в поддержку');
    }

    addFunds() {
        // TODO: Implement add funds functionality
        alert(this.i18n.t('cabinet.balance.addFundsInfo') || 'Функция пополнения счета будет доступна позже');
    }

    convertBonuses() {
        const bonusAmount = parseInt(this.userData?.Bonus || '0', 10);
        if (bonusAmount <= 0) {
            alert(this.i18n.t('cabinet.bonuses.noBonuses') || 'У вас нет бонусов для конвертации');
            return;
        }

        // TODO: Implement bonus conversion API call
        alert(this.i18n.t('cabinet.bonuses.convertInfo') || 'Функция конвертации бонусов будет доступна позже');
    }

    withdrawReferrals() {
        // TODO: Implement referral withdrawal functionality
        alert(this.i18n.t('cabinet.referrals.withdrawInfo') || 'Функция вывода средств будет доступна позже');
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
                        const originalText = btn.textContent;
                        btn.textContent = '✓';
                        setTimeout(() => {
                            btn.textContent = originalText;
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

        // Language toggle
        const langToggle = document.getElementById('lang-toggle');
        const langValue = document.getElementById('lang-value');
        if (langToggle) {
            langToggle.addEventListener('click', (e) => {
                e.stopPropagation();
                this.i18n.toggleLang();
                if (langValue) {
                    langValue.textContent = this.i18n.lang.toUpperCase();
                }
                this.updateThemeMenuLabels();
            });
        }

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
        if (langValue) {
            langValue.textContent = this.i18n.lang.toUpperCase();
        }
    }

    updateThemeMenuLabels() {
        const themeIcon = document.getElementById('theme-icon');
        const themeValue = document.getElementById('theme-value');
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

        if (themeIcon) {
            themeIcon.textContent = isDark ? '☀️' : '🌙';
        }
        if (themeValue) {
            const key = isDark ? 'nav.light' : 'nav.dark';
            themeValue.textContent = this.i18n.t(key);
            themeValue.setAttribute('data-i18n', key);
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
