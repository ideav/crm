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

        // Databases tab state
        this.dbSortField = null; // 'name' | 'count' | 'date'
        this.dbSortDir = 'asc';  // 'asc' | 'desc'
        this.dbSearchQuery = '';

        // Community tab state
        this.communityInvites = [];
        this.communityTab = 'my-invites';
        this.communityArchive = false;
        this.communityRequestsType = 'to-me';
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

        // Setup databases controls (sort, search, create)
        this.setupDatabasesControls();

        // Setup community (cooperation) tabs
        this.setupCommunityTabs();

        // Setup user menu dropdown
        this.setupUserMenuDropdown();

        // Setup logout button
        this.setupLogout();

        // Load user data
        await this.loadUserData();

        // Show section from URL hash, or default to 'databases'
        const { section, subTab, extra } = this.parseUrlHash();
        const validSections = ['databases', 'community', 'profile', 'tariff', 'balance', 'bonuses', 'referrals'];
        const targetSection = (section && validSections.includes(section)) ? section : 'databases';
        this.showSection(targetSection);
        if (subTab) this.showSubTab(targetSection, subTab);
        // Handle deep-link: #community/requests/request/{dbName}
        if (targetSection === 'community' && subTab === 'requests' && extra[0] === 'request' && extra[1]) {
            this.openCreateRequestForm(extra[1]);
        }
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
                this.updateUrlHash(section);

                // Update active state
                menuItems.forEach(mi => mi.classList.remove('active'));
                item.classList.add('active');
            });
        });

        // Restore section from URL hash on load
        window.addEventListener('hashchange', () => {
            const { section, subTab, extra } = this.parseUrlHash();
            if (section) {
                this.showSection(section);
                if (subTab) this.showSubTab(section, subTab);
                // Handle deep-link: #community/requests/request/{dbName}
                if (section === 'community' && subTab === 'requests' && extra[0] === 'request' && extra[1]) {
                    this.openCreateRequestForm(extra[1]);
                }
            }
        });
    }

    // Parse URL hash into section, optional sub-tab, and optional extra path segments
    // Format: #section or #section/subtab or #section/subtab/action/param
    parseUrlHash() {
        const hash = window.location.hash.replace('#', '');
        if (!hash) return { section: null, subTab: null, extra: [] };
        const parts = hash.split('/');
        return { section: parts[0] || null, subTab: parts[1] || null, extra: parts.slice(2) };
    }

    // Update the URL hash to reflect current section and optional sub-tab
    updateUrlHash(section, subTab) {
        const newHash = subTab ? section + '/' + subTab : section;
        history.replaceState(null, '', '#' + newHash);
    }

    // Activate a sub-tab within a given section without triggering full tab setup
    showSubTab(section, subTab) {
        if (section === 'referrals') {
            const tabs = document.querySelectorAll('.referrals-tab');
            const contents = document.querySelectorAll('.referrals-tab-content');
            tabs.forEach(t => {
                if (t.dataset.tab === subTab) t.classList.add('active');
                else t.classList.remove('active');
            });
            contents.forEach(c => c.style.display = 'none');
            const content = document.getElementById('referrals-tab-' + subTab);
            if (content) content.style.display = '';
        } else if (section === 'community') {
            const tabs = document.querySelectorAll('.community-tab');
            const contents = document.querySelectorAll('.community-tab-content');
            tabs.forEach(t => {
                if (t.dataset.communityTab === subTab) t.classList.add('active');
                else t.classList.remove('active');
            });
            contents.forEach(c => c.style.display = 'none');
            const content = document.getElementById('community-tab-' + subTab);
            if (content) content.style.display = '';
            this.communityTab = subTab;
            const inviteBtn = document.getElementById('invite-btn');
            if (inviteBtn) inviteBtn.style.display = subTab === 'my-invites' ? '' : 'none';
            this.renderCommunityData();
        }
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

        // Load community (cooperation) data
        this.loadCommunityData();
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

        // If there's a photo, show it in avatar
        if (avatarEl && this.userData.Photo) {
            avatarEl.innerHTML = '<img src="' + this.userData.Photo + '" alt="Avatar" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">';
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

        // Public profile checkbox (IsPublic: empty = no, any value = yes)
        const publicCheckbox = document.getElementById('profile-public');
        if (publicCheckbox) {
            publicCheckbox.checked = !!(this.userData.IsPublic);
        }

        // Store original values for change detection
        this.originalProfileValues = {
            'profile-name': this.userData.Name || '',
            'profile-phone': this.userData.Phone || '',
            'profile-about': this.userData.Notes || '',
            'profile-public': !!(this.userData.IsPublic)
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

        // Photo preview (Photo field contains a relative path)
        if (this.userData.Photo) {
            const photoPreview = document.getElementById('profile-photo-preview');
            if (photoPreview) {
                photoPreview.innerHTML = '<img src="' + this.userData.Photo + '" alt="Profile photo">';
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

        // Apply search filter
        const query = this.dbSearchQuery.trim().toLowerCase();
        let dbs = this.databases.filter(db => {
            if (!query) return true;
            const fields = [
                db.DB || '',
                db.Template || '',
                db.Description || '',
                db.Count || '',
                db.Date || '',
                db.RegDate || '',
                db['Plan date'] || '',
                db.PublicName || ''
            ];
            return fields.some(f => f.toLowerCase().includes(query));
        });

        // Apply sort
        if (this.dbSortField) {
            const dir = this.dbSortDir === 'asc' ? 1 : -1;
            dbs = dbs.slice().sort((a, b) => {
                if (this.dbSortField === 'name') {
                    return dir * (a.DB || '').localeCompare(b.DB || '');
                }
                if (this.dbSortField === 'count') {
                    return dir * (parseInt(a.Count || '0', 10) - parseInt(b.Count || '0', 10));
                }
                if (this.dbSortField === 'date') {
                    // Date format: DD.MM.YYYY
                    const parseDate = s => {
                        if (!s) return 0;
                        const p = s.split('.');
                        if (p.length !== 3) return 0;
                        return new Date(parseInt(p[2], 10), parseInt(p[1], 10) - 1, parseInt(p[0], 10)).getTime();
                    };
                    return dir * (parseDate(a.Date) - parseDate(b.Date));
                }
                return 0;
            });
        }

        // Show DB limit warning if needed (free plan: max 3 DBs)
        const planId = parseInt(this.userData && this.userData.PlanID || '0', 10);
        const createForm = document.getElementById('create-db-form');
        const limitWarning = document.getElementById('db-limit-warning');
        const submitBtn = document.getElementById('create-db-submit-btn');
        const nameInput = document.getElementById('new-db-name');
        const templateSelect = document.getElementById('new-db-template');
        const atLimit = this.databases.length >= 3 && planId < 1147;
        if (limitWarning) limitWarning.style.display = atLimit ? '' : 'none';
        if (submitBtn) submitBtn.disabled = atLimit;
        if (nameInput) nameInput.disabled = atLimit;
        if (templateSelect) templateSelect.disabled = atLimit;

        if (dbs.length === 0) {
            container.innerHTML = '<p class="empty-message">Нет баз данных</p>';
            return;
        }

        dbs.forEach(db => {
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
            const createdDate = db.Date ? this.formatDate(db.Date) : '';

            const dbNameCapitalized = db.DB ? db.DB.charAt(0).toUpperCase() + db.DB.slice(1) : '';
            const planDatePassed = this.isDatePassed(planDateRaw);

            card.innerHTML = `
                <div class="database-info">
                    <div class="database-name-row">
                        <a class="database-name-link" href="https://${this.apiConfig.host}/${db.DB}" target="${this.escapeHtml(db.DB)}">${this.escapeHtml(dbNameCapitalized)}</a>
                        <span class="database-id-inline">#${this.escapeHtml(dbId)}</span>
                        ${createdDate ? `<span class="database-created-date">Создана: ${this.escapeHtml(createdDate)}</span>` : ''}
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

    // ============================================================
    // Community (Cooperation) Section
    // ============================================================

    setupCommunityTabs() {
        // Tab switching
        const tabs = document.querySelectorAll('.community-tab');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const tabName = tab.dataset.communityTab;
                this.communityTab = tabName;

                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');

                const contents = document.querySelectorAll('.community-tab-content');
                contents.forEach(c => c.style.display = 'none');
                const content = document.getElementById('community-tab-' + tabName);
                if (content) content.style.display = '';

                // Show/hide invite button based on active tab
                const inviteBtn = document.getElementById('invite-btn');
                if (inviteBtn) inviteBtn.style.display = tabName === 'my-invites' ? '' : 'none';

                // Hide invite form when switching tabs
                const inviteForm = document.getElementById('invite-form');
                if (inviteForm) inviteForm.style.display = 'none';

                // Hide create request form and button when switching tabs
                const createRequestForm = document.getElementById('create-request-form');
                if (createRequestForm) createRequestForm.style.display = 'none';
                const createRequestBtn = document.getElementById('create-request-btn');
                if (createRequestBtn) createRequestBtn.style.display = 'none';

                this.renderCommunityData();

                // Update URL hash
                this.updateUrlHash('community', tabName);
            });
        });

        // Setup invite button and form
        this.setupInviteForm();

        // Setup create request button and form
        this.setupCreateRequestForm();

        // Active/Archive radio toggle
        document.querySelectorAll('input[name="community-archive"]').forEach(radio => {
            radio.addEventListener('change', () => {
                this.communityArchive = radio.value === 'archive';
                this.renderCommunityData();
            });
        });

        // Requests sub-filter (to my DB / my requests)
        document.querySelectorAll('input[name="community-requests-type"]').forEach(radio => {
            radio.addEventListener('change', () => {
                this.communityRequestsType = radio.value;
                // Show "Создать запрос" button only for "from-me" sub-filter
                const createRequestBtn = document.getElementById('create-request-btn');
                if (createRequestBtn) createRequestBtn.style.display = radio.value === 'from-me' ? '' : 'none';
                // Hide form when switching sub-filter
                const createRequestForm = document.getElementById('create-request-form');
                if (createRequestForm) createRequestForm.style.display = 'none';
                this.renderCommunityData();
            });
        });
    }

    async loadCommunityData() {
        try {
            const host = this.apiConfig.host;
            const url = 'https://' + host + '/my/report/380?JSON_KV';

            const response = await fetch(url, {
                method: 'GET',
                credentials: 'include'
            });

            if (!response.ok) {
                throw new Error('HTTP ' + response.status);
            }

            const data = await response.json();
            console.log('[cabinet] Community data loaded:', data);

            if (Array.isArray(data)) {
                this.communityInvites = data;
            } else {
                this.communityInvites = [];
            }

            this.renderCommunityData();
        } catch (err) {
            console.error('[cabinet] Error loading community data:', err);
            this.communityInvites = [];
            this.renderCommunityData();
        }
    }

    renderCommunityData() {
        const currentUid = uid; // from global var set in <script> tag
        const isArchive = this.communityArchive;
        // Archive statuses: 373 (Отказ), 374 (Отозвано)
        const archiveStatuses = ['373', '374'];

        const filterByArchive = (items) => {
            return items.filter(item => {
                const inArchive = archiveStatuses.includes(item.StateID);
                return isArchive ? inArchive : !inArchive;
            });
        };

        // Tab 1: My invitations (HostUserID === uid), excluding requests (StateID === '375')
        const myInvites = filterByArchive(
            this.communityInvites.filter(i => i.HostUserID === currentUid && i.StateID !== '375')
        );
        this.renderCommunityList('community-my-invites-list', myInvites, 'my-invites');

        // Tab 2: Invitations to me (GuestUserID === uid OR GuestUserID is empty), excluding own invitations and requests (StateID === '375')
        const invitationsToMe = filterByArchive(
            this.communityInvites.filter(i =>
                i.HostUserID !== currentUid &&
                (i.GuestUserID === currentUid || i.GuestUserID === '') &&
                i.StateID !== '375'
            )
        );
        this.renderCommunityList('community-invitations-list', invitationsToMe, 'invitations');

        // Tab 3: Requests (StateID === "375")
        const allRequests = this.communityInvites.filter(i => i.StateID === '375');
        let requests;
        if (this.communityRequestsType === 'to-me') {
            // Requests to my DB
            requests = filterByArchive(allRequests.filter(i => i.HostUserID === currentUid));
        } else {
            // My requests to other DBs
            requests = filterByArchive(allRequests.filter(i => i.GuestUserID === currentUid));
        }
        this.renderCommunityList('community-requests-list', requests, 'requests');
    }

    formatCommunityDate(inviteDate) {
        if (!inviteDate) return '';
        const ts = parseInt(inviteDate, 10);
        if (!isNaN(ts) && ts > 1000000000) {
            const d = new Date(ts * 1000);
            // Date and time without seconds
            return d.toLocaleDateString('ru-RU') + ' ' +
                d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        }
        return inviteDate;
    }

    buildCommunityNameDesc(name, description) {
        // Returns "(name, description)" or "(name)" or "(description)" or "" if both empty
        const parts = [];
        if (name) parts.push(this.escapeHtml(name));
        if (description) parts.push(this.escapeHtml(description));
        return parts.length > 0 ? ' (' + parts.join(', ') + ')' : '';
    }

    renderCommunityList(containerId, items, tabType) {
        const container = document.getElementById(containerId);
        if (!container) return;

        if (items.length === 0) {
            const emptyMsg = this.communityArchive ? 'Нет записей в архиве' : 'Нет записей';
            container.innerHTML = '<p class="empty-message">' + emptyMsg + '</p>';
            return;
        }

        container.innerHTML = '';
        const isArchive = this.communityArchive;

        items.forEach(item => {
            const card = document.createElement('div');
            card.className = 'community-card';

            const statusClass = this.getStatusClass(item.StateID);
            const statusLabel = item.State || '';
            const dbName = item.DB || '';
            const publicName = item.Name || '';
            const description = item.Description || '';
            const guestUser = item.GuestUser || '';
            const isPublic = !item.GuestUserID; // public invite if no GuestUserID
            const dateStr = this.formatCommunityDate(item.Invite);
            const nameDesc = this.buildCommunityNameDesc(publicName, description);
            const stateId = item.StateID || '';
            const recordId = item.InviteID || '';

            // DB name is bold; it's a hyperlink if invitation accepted or DB is my own
            const isMyDb = tabType === 'my-invites' ||
                (tabType === 'requests' && this.communityRequestsType === 'to-me');
            const isAccepted = stateId === '372';
            const dbEscaped = this.escapeHtml(dbName);
            const dbBold = isMyDb || isAccepted
                ? '<a href="/' + dbEscaped + '" target="' + dbEscaped + '"><strong>' + dbEscaped + '</strong></a>'
                : '<strong>' + dbEscaped + '</strong>';

            let titleHtml = '';
            if (tabType === 'my-invites') {
                // Personal invite: "Персональное для {GuestUser} в {DB} (name, desc)"
                // Public invite:   "{DB} (name, desc)"
                if (guestUser) {
                    titleHtml = this.escapeHtml(dateStr) + ': Персональное для ' +
                        '<strong>' + this.escapeHtml(guestUser) + '</strong>' +
                        ' в ' + dbBold + nameDesc;
                } else {
                    titleHtml = this.escapeHtml(dateStr) + ': ' + dbBold + nameDesc;
                }
            } else if (tabType === 'invitations') {
                // Personal invite: "Персональное в {DB} (name, desc)"
                // Public invite:   "{DB} (name, desc)"
                if (!isPublic) {
                    titleHtml = this.escapeHtml(dateStr) + ': Персональное в ' +
                        dbBold + nameDesc;
                } else {
                    titleHtml = this.escapeHtml(dateStr) + ': ' + dbBold + nameDesc;
                }
            } else if (tabType === 'requests') {
                const requestsType = this.communityRequestsType;
                if (requestsType === 'to-me') {
                    // "Доступ для {GuestUser} к БД {DB} (name, desc)"
                    titleHtml = this.escapeHtml(dateStr) + ': Доступ для ' +
                        '<strong>' + this.escapeHtml(guestUser) + '</strong>' +
                        ' к БД ' + dbBold + nameDesc;
                } else {
                    // "БД {DB} (name, desc)"
                    titleHtml = this.escapeHtml(dateStr) + ': БД ' + dbBold + nameDesc;
                }
            }

            // Build right badges
            let badgesHtml = '';
            if (isPublic) { // && (tabType === 'invitations' || (tabType === 'requests' && this.communityRequestsType === 'from-me'))) {
                badgesHtml += '<span class="community-card-status status-public">публичное</span>';
            }
            badgesHtml += '<span class="community-card-status ' + statusClass + '">' + this.escapeHtml(statusLabel) + '</span>';

            // Build action buttons
            let actionsHtml = '';
            if (tabType === 'my-invites' && !isArchive) {
                // "Отозвать" button in active section
                actionsHtml += '<button type="button" class="btn-secondary btn-small community-action-btn" ' +
                    'data-action="revoke" data-id="' + this.escapeHtml(recordId) + '">' +
                    'Отозвать</button>';
            } else if (tabType === 'invitations') {
                // "Принять" and "Отказать" buttons for Новое (371) or Отказ (373) — use report/inviteAccept
                if (stateId === '371' || stateId === '373') {
                    actionsHtml +=
                        '<button type="button" class="btn-primary btn-small community-action-btn" ' +
                        'data-action="accept" data-id="' + this.escapeHtml(recordId) + '" data-tab-type="invitations">' +
                        'Принять</button>' +
                        '<button type="button" class="btn-danger btn-small community-action-btn" ' +
                        'data-action="reject" data-id="' + this.escapeHtml(recordId) + '" data-tab-type="invitations">' +
                        'Отказать</button>';
                }
            } else if (tabType === 'requests') {
                if (this.communityRequestsType === 'to-me') {
                    // "Принять" and "Отказать" buttons — use report/inviteRequestAccept
                    actionsHtml +=
                        '<button type="button" class="btn-primary btn-small community-action-btn" ' +
                        'data-action="accept" data-id="' + this.escapeHtml(recordId) + '" data-tab-type="requests">' +
                        'Принять</button>' +
                        '<button type="button" class="btn-danger btn-small community-action-btn" ' +
                        'data-action="reject" data-id="' + this.escapeHtml(recordId) + '" data-tab-type="requests">' +
                        'Отказать</button>';
                } else {
                    // "Отозвать запрос" button
                    actionsHtml += '<button type="button" class="btn-secondary btn-small community-action-btn" ' +
                        'data-action="revoke-request" data-id="' + this.escapeHtml(recordId) + '">' +
                        'Отозвать запрос</button>';
                }
            }

            card.innerHTML =
                '<div class="community-card-header">' +
                    '<span class="community-card-title">' + titleHtml + '</span>' +
                    '<div class="community-card-badges">' + badgesHtml + '</div>' +
                '</div>' +
                (actionsHtml ? '<div class="community-card-actions">' + actionsHtml + '</div>' : '');

            // Attach action button listeners
            card.querySelectorAll('.community-action-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const action = btn.dataset.action;
                    const id = btn.dataset.id;
                    this.handleCommunityAction(action, id, item, card);
                });
            });

            container.appendChild(card);
        });
    }

    getStatusClass(stateId) {
        switch (stateId) {
            case '371': return 'status-new';
            case '372': return 'status-accepted';
            case '373': return 'status-rejected';
            case '374': return 'status-revoked';
            case '375': return 'status-request';
            default: return '';
        }
    }

    async handleCommunityAction(action, id, item, card) {
        const btn = card.querySelector('[data-action="' + action + '"]');
        if (btn) btn.disabled = true;

        try {
            const host = this.apiConfig.host;
            let response;

            if (action === 'revoke') {
                // Revoke endpoint: /my/report/236429/?JSON_KV&FR_InviteID=<id>
                const url = 'https://' + host + '/my/report/236429/?JSON_KV&confirmed=1&FR_InviteID=' + encodeURIComponent(id);

                const fd = new FormData();
                fd.append('_xsrf', xsrf);

                response = await fetch(url, {
                    method: 'POST',
                    credentials: 'include',
                    body: fd
                });

                if (!response.ok) {
                    throw new Error('HTTP ' + response.status);
                }

                const data = await response.json();
                console.log('[cabinet] Revoke response:', data);

                if (!Array.isArray(data) || data.length === 0 || !data[0].InviteID) {
                    throw new Error('Unexpected revoke response');
                }
            } else if (action === 'revoke-request') {
                // Revoke request endpoint: /my/report/236536/?JSON_KV&confirmed=1&FR_InviteID=<id>
                const url = 'https://' + host + '/my/report/236536/?JSON_KV&confirmed=1&FR_InviteID=' + encodeURIComponent(id);

                const fd = new FormData();
                fd.append('_xsrf', xsrf);

                response = await fetch(url, {
                    method: 'POST',
                    credentials: 'include',
                    body: fd
                });

                if (!response.ok) {
                    throw new Error('HTTP ' + response.status);
                }

                const data = await response.json();
                console.log('[cabinet] Revoke request response:', data);

                if (!Array.isArray(data) || data.length === 0 || !data[0].InviteID) {
                    throw new Error('Unexpected revoke-request response');
                }
            } else if (action === 'accept') {
                // Invitations use report/inviteAccept; requests use report/inviteRequestAccept (236472)
                const tabType = btn ? btn.dataset.tabType : 'requests';
                const reportId = tabType === 'invitations' ? 'inviteAccept' : '236472';
                const url = 'https://' + host + '/my/report/' + reportId + '/?JSON_KV&confirmed=1&FR_InviteID=' + encodeURIComponent(id);

                const fd = new FormData();
                fd.append('_xsrf', xsrf);
                fd.append('cmd', '372');

                response = await fetch(url, {
                    method: 'POST',
                    credentials: 'include',
                    body: fd
                });

                if (!response.ok) {
                    throw new Error('HTTP ' + response.status);
                }

                const acceptData = await response.json();
                if (!Array.isArray(acceptData) || acceptData.length === 0 || acceptData[0]['Статус'] !== '372') {
                    throw new Error('Операция не выполнена');
                }
            } else if (action === 'reject') {
                // Invitations use report/inviteAccept; requests use report/inviteRequestAccept (236472)
                const tabType = btn ? btn.dataset.tabType : 'requests';
                const reportId = tabType === 'invitations' ? 'inviteAccept' : '236472';
                const url = 'https://' + host + '/my/report/' + reportId + '/?JSON_KV&confirmed=1&FR_InviteID=' + encodeURIComponent(id);

                const fd = new FormData();
                fd.append('_xsrf', xsrf);
                fd.append('cmd', '373');

                response = await fetch(url, {
                    method: 'POST',
                    credentials: 'include',
                    body: fd
                });

                if (!response.ok) {
                    throw new Error('HTTP ' + response.status);
                }

                const rejectData = await response.json();
                if (!Array.isArray(rejectData) || rejectData.length === 0 || rejectData[0]['Статус'] !== '373') {
                    throw new Error('Операция не выполнена');
                }
            } else {
                // Action endpoint: /my/_invite_action/?JSON&id=<id>&action=<action>
                const url = 'https://' + host + '/my/_invite_action/?JSON' +
                    '&id=' + encodeURIComponent(id) +
                    '&action=' + encodeURIComponent(action);

                const fd = new FormData();
                fd.append('_xsrf', xsrf);

                response = await fetch(url, {
                    method: 'POST',
                    credentials: 'include',
                    body: fd
                });

                if (!response.ok) {
                    throw new Error('HTTP ' + response.status);
                }
            }

            // Reload community data to reflect new state
            await this.loadCommunityData();

            const messages = { revoke: 'Приглашение отозвано', 'revoke-request': 'Запрос отозван', accept: 'Принято', reject: 'Отказ отправлен' };
            showToast(messages[action] || 'Готово', 'success');
        } catch (err) {
            console.error('[cabinet] Error performing community action:', err);
            showToast('Ошибка выполнения действия', 'error');
            if (btn) btn.disabled = false;
        }
    }

    setupInviteForm() {
        const inviteBtn = document.getElementById('invite-btn');
        const inviteForm = document.getElementById('invite-form');
        const submitBtn = document.getElementById('invite-submit-btn');
        const cancelBtn = document.getElementById('invite-cancel-btn');

        // Show invite button on initial load since my-invites tab is active by default
        if (inviteBtn) inviteBtn.style.display = '';

        if (inviteBtn && inviteForm) {
            inviteBtn.addEventListener('click', () => {
                const isVisible = inviteForm.style.display !== 'none';
                if (!isVisible) {
                    // Populate DB dropdown with user's own databases
                    const dbSelect = document.getElementById('invite-db');
                    if (dbSelect) {
                        dbSelect.innerHTML = '';
                        this.databases.forEach(db => {
                            const opt = document.createElement('option');
                            opt.value = db.DB || '';
                            opt.textContent = db.DB || '';
                            dbSelect.appendChild(opt);
                        });
                    }
                }
                inviteForm.style.display = isVisible ? 'none' : '';
            });
        }

        if (cancelBtn && inviteForm) {
            cancelBtn.addEventListener('click', () => {
                inviteForm.style.display = 'none';
                this.resetInviteForm();
            });
        }

        if (submitBtn) {
            submitBtn.addEventListener('click', () => this.sendInvite());
        }
    }

    resetInviteForm() {
        const userInput = document.getElementById('invite-user');
        const descrInput = document.getElementById('invite-descr');
        if (userInput) userInput.value = '';
        if (descrInput) descrInput.value = '';
    }

    setupCreateRequestForm() {
        const createRequestBtn = document.getElementById('create-request-btn');
        const createRequestForm = document.getElementById('create-request-form');
        const submitBtn = document.getElementById('request-submit-btn');
        const cancelBtn = document.getElementById('request-cancel-btn');

        if (createRequestBtn && createRequestForm) {
            createRequestBtn.addEventListener('click', () => {
                const isVisible = createRequestForm.style.display !== 'none';
                createRequestForm.style.display = isVisible ? 'none' : '';
                if (!isVisible) {
                    const dbInput = document.getElementById('request-db');
                    if (dbInput) dbInput.focus();
                }
            });
        }

        if (cancelBtn && createRequestForm) {
            cancelBtn.addEventListener('click', () => {
                createRequestForm.style.display = 'none';
                this.resetCreateRequestForm();
            });
        }

        if (submitBtn) {
            submitBtn.addEventListener('click', () => this.sendRequest());
        }
    }

    resetCreateRequestForm() {
        const dbInput = document.getElementById('request-db');
        const descrInput = document.getElementById('request-descr');
        const errEl = document.getElementById('request-db-error');
        if (dbInput) { dbInput.value = ''; dbInput.classList.remove('input-invalid'); }
        if (descrInput) descrInput.value = '';
        if (errEl) errEl.style.display = 'none';
    }

    async sendRequest() {
        const dbInput = document.getElementById('request-db');
        const descrInput = document.getElementById('request-descr');
        const errEl = document.getElementById('request-db-error');
        const submitBtn = document.getElementById('request-submit-btn');

        const dbName = dbInput ? dbInput.value.trim() : '';
        const descr = descrInput ? descrInput.value.trim() : '';

        if (!dbName) {
            showToast('Введите имя базы данных', 'error');
            return;
        }

        // Check if the entered DB is one of the user's own databases
        const ownDbs = this.databases.map(d => (d.DB || '').toLowerCase());
        if (ownDbs.includes(dbName.toLowerCase())) {
            if (errEl) { errEl.textContent = 'Нельзя отправить запрос к собственной базе'; errEl.style.display = ''; }
            if (dbInput) dbInput.classList.add('input-invalid');
            return;
        }

        if (errEl) errEl.style.display = 'none';
        if (dbInput) dbInput.classList.remove('input-invalid');
        if (submitBtn) submitBtn.disabled = true;

        try {
            const host = this.apiConfig.host;
            const url = 'https://' + host + '/my/report/236495/?JSON_KV&confirmed=1&FR_DB=' + encodeURIComponent(dbName);

            const fd = new FormData();
            fd.append('_xsrf', xsrf);
            if (descr) fd.append('descr', descr);

            const response = await fetch(url, {
                method: 'POST',
                credentials: 'include',
                body: fd
            });

            const text = await response.text();
            console.log('[cabinet] Create request response:', text);

            let parsed;
            try {
                parsed = JSON.parse(text);
            } catch (e) {
                console.error('[cabinet] Create request response is not valid JSON:', text);
                if (errEl) { errEl.textContent = 'База не найдена или скрыта владельцем'; errEl.style.display = ''; }
                if (dbInput) dbInput.classList.add('input-invalid');
                return;
            }

            // Expect 1 row with "Invite" field; empty array = DB not found
            if (!Array.isArray(parsed) || parsed.length === 0 || !parsed[0].Invite) {
                console.error('[cabinet] Create request: DB not found, response:', parsed);
                if (errEl) { errEl.textContent = 'База не найдена или скрыта владельцем'; errEl.style.display = ''; }
                if (dbInput) dbInput.classList.add('input-invalid');
                return;
            }

            console.log('[cabinet] Request created:', parsed);
            showToast('Запрос отправлен', 'success');

            // Hide form and reset
            const createRequestForm = document.getElementById('create-request-form');
            if (createRequestForm) createRequestForm.style.display = 'none';
            this.resetCreateRequestForm();

            // Switch to "from-me" view and reload data
            this.communityRequestsType = 'from-me';
            const fromMeRadio = document.querySelector('input[name="community-requests-type"][value="from-me"]');
            if (fromMeRadio) fromMeRadio.checked = true;

            await this.loadCommunityData();
        } catch (err) {
            console.error('[cabinet] Error sending request:', err);
            showToast('Ошибка отправки запроса', 'error');
        } finally {
            if (submitBtn) submitBtn.disabled = false;
        }
    }

    async sendInvite() {
        const dbSelect = document.getElementById('invite-db');
        const userInput = document.getElementById('invite-user');
        const descrInput = document.getElementById('invite-descr');
        const submitBtn = document.getElementById('invite-submit-btn');

        const db = dbSelect ? dbSelect.value.trim() : '';
        const user = userInput ? userInput.value.trim() : '';
        const descr = descrInput ? descrInput.value.trim() : '';

        if (!db) {
            showToast('Выберите базу данных', 'error');
            return;
        }

        if (submitBtn) submitBtn.disabled = true;

        try {
            const host = this.apiConfig.host;
            const url = 'https://' + host + '/my/report/385?JSON_KV';

            const fd = new FormData();
            fd.append('confirmed', '1');
            fd.append('_xsrf', xsrf);
            fd.append('db', db);
            if (user) fd.append('user', user);
            if (descr) fd.append('descr', descr);

            const response = await fetch(url, {
                method: 'POST',
                credentials: 'include',
                body: fd
            });

            const text = await response.text();
            console.log('[cabinet] Invite response:', text);

            let parsed;
            try {
                parsed = JSON.parse(text);
            } catch (e) {
                console.error('[cabinet] Invite response is not valid JSON:', text);
                showToast('Ошибка: ' + text, 'error');
                return;
            }

            // Check for error field in response
            if (parsed && parsed.error) {
                console.error('[cabinet] Invite error from server:', parsed.error);
                showToast('Ошибка: ' + parsed.error, 'error');
                return;
            }

            // When a user was specified, verify Invitee is non-empty (empty means user not found)
            if (user) {
                const record = Array.isArray(parsed) ? parsed[0] : parsed;
                if (!record || !record.Invitee) {
                    console.error('[cabinet] Invite error: user not found, response:', parsed);
                    showToast('Ошибка: пользователь не найден', 'error');
                    return;
                }
            }

            // Valid JSON response — success
            console.log('[cabinet] Invite created:', parsed);
            showToast('Приглашение отправлено', 'success');

            // Hide form and reset
            const inviteForm = document.getElementById('invite-form');
            if (inviteForm) inviteForm.style.display = 'none';
            this.resetInviteForm();

            // Reload community data to show new invite
            await this.loadCommunityData();
        } catch (err) {
            console.error('[cabinet] Error sending invite:', err);
            showToast('Ошибка отправки приглашения', 'error');
        } finally {
            if (submitBtn) submitBtn.disabled = false;
        }
    }

    // Open create request form pre-filled with dbName (used by deep-link)
    openCreateRequestForm(dbName) {
        // Switch to "from-me" sub-filter
        this.communityRequestsType = 'from-me';
        const fromMeRadio = document.querySelector('input[name="community-requests-type"][value="from-me"]');
        if (fromMeRadio) fromMeRadio.checked = true;

        // Show the "Создать запрос" button
        const createRequestBtn = document.getElementById('create-request-btn');
        if (createRequestBtn) createRequestBtn.style.display = '';

        // Show the form
        const createRequestForm = document.getElementById('create-request-form');
        if (createRequestForm) createRequestForm.style.display = '';

        // Pre-fill the DB name
        const dbInput = document.getElementById('request-db');
        if (dbInput) dbInput.value = dbName;

        this.renderCommunityData();
    }

    setupDatabasesControls() {
        // Create DB button — toggle form
        const createBtn = document.getElementById('create-db-btn');
        const createForm = document.getElementById('create-db-form');
        const cancelBtn = document.getElementById('create-db-cancel-btn');
        const submitBtn = document.getElementById('create-db-submit-btn');
        const nameInput = document.getElementById('new-db-name');

        if (createBtn && createForm) {
            createBtn.addEventListener('click', () => {
                const isVisible = createForm.style.display !== 'none';
                createForm.style.display = isVisible ? 'none' : '';
                if (!isVisible && nameInput) {
                    nameInput.focus();
                }
            });
        }

        if (cancelBtn && createForm) {
            cancelBtn.addEventListener('click', () => {
                createForm.style.display = 'none';
                this.resetCreateDbForm();
            });
        }

        if (submitBtn) {
            submitBtn.addEventListener('click', () => this.createDatabase());
        }

        if (nameInput) {
            nameInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') this.createDatabase();
                // Clear error on input
                const errEl = document.getElementById('new-db-name-error');
                if (errEl) { errEl.style.display = 'none'; nameInput.classList.remove('input-invalid'); }
            });
        }

        // Sort button — toggle dropdown
        const sortBtn = document.getElementById('databases-sort-btn');
        const sortDropdown = document.getElementById('databases-sort-dropdown');
        if (sortBtn && sortDropdown) {
            sortBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const isOpen = sortDropdown.style.display !== 'none';
                sortDropdown.style.display = isOpen ? 'none' : '';
            });

            document.addEventListener('click', (e) => {
                if (!sortBtn.contains(e.target) && !sortDropdown.contains(e.target)) {
                    sortDropdown.style.display = 'none';
                }
            });

            sortDropdown.querySelectorAll('.sort-option').forEach(opt => {
                opt.addEventListener('click', () => {
                    this.dbSortField = opt.dataset.sort;
                    this.dbSortDir = opt.dataset.dir;
                    sortDropdown.style.display = 'none';

                    // Mark active
                    sortDropdown.querySelectorAll('.sort-option').forEach(o => o.classList.remove('active'));
                    opt.classList.add('active');

                    this.populateDatabases();
                });
            });
        }

        // Search input — filter on input
        const searchInput = document.getElementById('databases-search');
        if (searchInput) {
            searchInput.addEventListener('input', () => {
                this.dbSearchQuery = searchInput.value;
                this.populateDatabases();
            });
        }
    }

    resetCreateDbForm() {
        const nameInput = document.getElementById('new-db-name');
        const errEl = document.getElementById('new-db-name-error');
        const planId = parseInt(this.userData && this.userData.PlanID || '0', 10);
        const atLimit = this.databases.length >= 3 && planId < 1147;
        if (nameInput) { nameInput.value = ''; nameInput.classList.remove('input-invalid'); nameInput.disabled = atLimit; }
        if (errEl) errEl.style.display = 'none';
        const submitBtn = document.getElementById('create-db-submit-btn');
        if (submitBtn) { submitBtn.disabled = atLimit; submitBtn.textContent = 'Создать'; }
        const templateSelect = document.getElementById('new-db-template');
        if (templateSelect) templateSelect.disabled = atLimit;
    }

    async createDatabase() {
        const nameInput = document.getElementById('new-db-name');
        const templateSelect = document.getElementById('new-db-template');
        const errEl = document.getElementById('new-db-name-error');
        const submitBtn = document.getElementById('create-db-submit-btn');

        if (!nameInput || !templateSelect) return;

        const dbName = nameInput.value.trim();
        const template = templateSelect.value;

        // Validate name: 3-15 latin chars/digits, starting with a letter
        if (!(/^[a-zA-Z][a-zA-Z0-9]{2,14}$/).test(dbName)) {
            if (errEl) {
                errEl.textContent = 'От 3 до 15 латинских символов и цифр, начиная с буквы';
                errEl.style.display = '';
            }
            nameInput.classList.add('input-invalid');
            nameInput.focus();
            return;
        }

        if (errEl) errEl.style.display = 'none';
        nameInput.classList.remove('input-invalid');

        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Проверка...'; }
        if (nameInput) nameInput.disabled = true;

        try {
            const host = this.apiConfig.host;

            // Step 1: Check if DB name is taken (report/292)
            const checkFd = new FormData();
            checkFd.append('_xsrf', xsrf);
            const checkUrl = 'https://' + host + '/my/report/292?JSON&FR_DB=' + encodeURIComponent(dbName);
            const checkResp = await fetch(checkUrl, {
                method: 'POST',
                credentials: 'include',
                body: checkFd
            });

            if (!checkResp.ok) throw new Error('HTTP ' + checkResp.status);

            const checkData = await checkResp.json();
            // If DB field is '0' — name is free; otherwise — taken
            const dbExists = this.getJsonValue(checkData, 'DB', 0);
            if (dbExists !== '0' && dbExists !== 0 && dbExists !== '') {
                // Name is taken
                if (errEl) {
                    errEl.textContent = 'Это имя занято, придумайте другое';
                    errEl.style.display = '';
                }
                nameInput.classList.add('input-invalid');
                nameInput.disabled = false;
                if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Создать'; }
                return;
            }

            // Step 2: Create the database (_new_db/)
            if (submitBtn) submitBtn.textContent = 'Создание...';
            const createFd = new FormData();
            createFd.append('_xsrf', xsrf);
            const createUrl = 'https://' + host + '/my/_new_db/?JSON&db=' + encodeURIComponent(dbName) + '&template=' + encodeURIComponent(template);
            const createResp = await fetch(createUrl, {
                method: 'POST',
                credentials: 'include',
                body: createFd
            });

            if (!createResp.ok) throw new Error('HTTP ' + createResp.status);

            // Success: hide form, reload databases
            const createForm = document.getElementById('create-db-form');
            if (createForm) createForm.style.display = 'none';
            this.resetCreateDbForm();

            showToast('База данных создана', 'success');

            // Reload user data to refresh the list
            await this.loadUserData();
        } catch (err) {
            console.error('[cabinet] Error creating database:', err);
            showToast('Ошибка создания базы данных', 'error');
            if (nameInput) nameInput.disabled = false;
            if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Создать'; }
        }
    }

    // Helper: get value from JSON_KV-style response
    getJsonValue(json, colName, rowIndex) {
        if (!json || !json.columns || !json.data) return '';
        for (let i = 0; i < json.columns.length; i++) {
            if (json.columns[i].name === colName) {
                return json.data[i][rowIndex] !== undefined ? json.data[i][rowIndex] : '';
            }
        }
        return '';
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

                // Update URL hash
                this.updateUrlHash('referrals', tabName);
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
