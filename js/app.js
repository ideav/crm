// ============================================================
// Internationalization (i18n)
// ============================================================
const I18N = {
    ru: {
        'page.title': 'Главная',
        'nav.dark': 'Темная',
        'nav.light': 'Светлая',
        'nav.login': 'Войти',
        'nav.cabinet': 'Личный кабинет',
        'welcome.title': 'Добро пожаловать!',
        'welcome.subtitle': 'Сервис для работы с вашими данными.',
        'auth.loginTab': 'Вход',
        'auth.registerTab': 'Регистрация',
        'auth.loginTitle': 'Вход',
        'auth.loginSubtitle': 'Войдите в свой аккаунт',
        'auth.registerTitle': 'Регистрация',
        'auth.registerSubtitle': 'Создайте новый аккаунт',
        'auth.email': 'Email адрес',
        'auth.password': 'Пароль',
        'auth.confirmPassword': 'Подтвердите пароль',
        'auth.loginBtn': 'Войти',
        'auth.registerBtn': 'Зарегистрироваться',
        'auth.or': 'или',
        'auth.yandex': 'Яндекс',
        'auth.close': '✕ Закрыть',
        'msg.passwordMismatch': 'Пароли не совпадают',
        'msg.passwordShort': 'Пароль должен содержать минимум 6 символов',
        'msg.loginSuccess': 'Вход выполнен успешно!',
        'msg.registerSuccess': 'Регистрация прошла успешно. Проверьте вашу почту для подтверждения.',
        'msg.loginError': 'Ошибка входа: ',
        'msg.registerError': 'Ошибка регистрации: ',
        // Cabinet translations
        'cabinet.title': 'Личный кабинет',
        'cabinet.logout': 'Выйти',
        'cabinet.userMenu.language': 'Язык',
        'cabinet.userMenu.theme': 'Тема',
        'cabinet.loading': 'Загрузка данных...',
        'cabinet.menu.profile': 'Профиль',
        'cabinet.menu.balance': 'Баланс',
        'cabinet.menu.databases': 'Базы данных',
        'cabinet.menu.access': 'Доступы',
        'cabinet.menu.bonuses': 'Бонусы',
        'cabinet.menu.referrals': 'Партнерская программа',
        'cabinet.profile.title': 'Профиль',
        'cabinet.profile.name': 'Имя',
        'cabinet.profile.phone': 'Телефон',
        'cabinet.profile.email': 'Email',
        'cabinet.profile.emailHint': 'Email нельзя изменить',
        'cabinet.profile.about': 'Обо мне',
        'cabinet.profile.photo': 'Фото',
        'cabinet.profile.uploadPhoto': 'Загрузить фото',
        'cabinet.profile.save': 'Сохранить изменения',
        'cabinet.profile.saveSuccess': 'Профиль сохранен',
        'cabinet.profile.saveError': 'Ошибка сохранения профиля',
        'cabinet.profile.tariffTitle': 'Информация о тарифе',
        'cabinet.profile.yourTariff': 'Ваш тариф',
        'cabinet.profile.nextCharge': 'Следующее списание',
        'cabinet.profile.chargeDescription': 'Списание по тарифному плану производится один раз в месяц, при этом сбрасываются счетчики ресурсов всех ваших баз. Если расход ресурсов не укладывается в лимит плана, то для продолжения работы вам необходимо повысить план. Подробнее о планах.',
        'cabinet.profile.usageNow': 'Сейчас вы использовали',
        'cabinet.profile.resourceUnits': 'ед. ресурсов или',
        'cabinet.profile.fromLimit': 'от лимита бесплатного тарифного плана в',
        'cabinet.profile.units': 'ед.',
        'cabinet.profile.changePlanText': 'Для смены плана требуется иметь достаточное количество средств на счете. Пополнить счет вы можете здесь, выбрав нужный план:',
        'cabinet.profile.changePlan': 'Сменить план',
        'cabinet.profile.planChangeInfo': 'Для смены плана обратитесь в поддержку',
        'cabinet.balance.title': 'Баланс',
        'cabinet.balance.description': 'Средства вашего счета расходуются на оплату тарифного плана. Вы можете пополнить счет банковской картой или переводом, а также конвертировать бонусы и партнерские отчисления.',
        'cabinet.balance.current': 'Текущий баланс:',
        'cabinet.balance.currency': 'руб.',
        'cabinet.balance.usageToday': 'На сегодня вы использовали около',
        'cabinet.balance.resourceUnits': 'ед. ресурсов или',
        'cabinet.balance.fromLimit': 'от лимита бесплатного тарифного плана в',
        'cabinet.balance.units': 'ед.',
        'cabinet.balance.historyNote': 'Вся история операций хранится здесь.',
        'cabinet.balance.historyTitle': 'История операций',
        'cabinet.balance.date': 'Дата',
        'cabinet.balance.amount': 'Сумма',
        'cabinet.balance.note': 'Примечание',
        'cabinet.balance.noHistory': 'Нет операций',
        'cabinet.balance.addFunds': 'Пополнить счет',
        'cabinet.balance.addFundsInfo': 'Функция пополнения счета будет доступна позже',
        'cabinet.databases.title': 'Базы данных',
        'cabinet.databases.description': 'Список моих баз данных',
        'cabinet.databases.noData': 'Нет баз данных',
        'cabinet.databases.template': 'Шаблон:',
        'cabinet.databases.records': 'Записей:',
        'cabinet.databases.planDate': 'Оплачено до:',
        'cabinet.databases.open': 'Открыть',
        'cabinet.access.title': 'Доступы',
        'cabinet.access.description': 'Список Баз данных с назначенными на них пользователями',
        'cabinet.access.noData': 'Нет данных о доступах',
        'cabinet.bonuses.title': 'Бонусы',
        'cabinet.bonuses.description': 'Вы получаете бонусы при регистрации и при совершении некоторых действий: прохождение уроков, активность в социальных сетях и участие в промо-акциях Интеграла. Актуальные предложения будут приходить вам на почту.',
        'cabinet.bonuses.current': 'Текущие бонусы:',
        'cabinet.bonuses.convertDescription': 'Бонусы можно конвертировать в валюту вашего депозита и пополнять таким образом баланс вашего счета: 1 бонус = 1 рубль.',
        'cabinet.bonuses.historyNote': 'Ваша история операций с бонусами хранится в разделе Баланс.',
        'cabinet.bonuses.convert': 'Конвертировать бонусы',
        'cabinet.bonuses.noBonuses': 'У вас нет бонусов для конвертации',
        'cabinet.bonuses.convertInfo': 'Функция конвертации бонусов будет доступна позже',
        'cabinet.referrals.title': 'Партнерская программа',
        'cabinet.referrals.aboutTitle': 'О программе',
        'cabinet.referrals.aboutDescription': 'Вы получаете вознаграждение 15% за каждую оплату услуги Ideav, которую сделал клиент, привлеченный по вашей реферальной ссылке или промокоду. Программа распространяется также на оплату продления услуг.',
        'cabinet.referrals.withdrawDescription': 'Это вознаграждение можно вывести на вашу банковскую карту или переводом на счет в РФ. Вывод доступен через один месяц после оплаты клиента.',
        'cabinet.referrals.convertDescription': 'Вы также можете сконвертировать ваше партнерское вознаграждение на ваш баланс для оплаты услуг Ideav.',
        'cabinet.referrals.yourLinks': 'Ваши партнерские ссылки:',
        'cabinet.referrals.registration': 'Регистрация:',
        'cabinet.referrals.site': 'Сайт Интеграма:',
        'cabinet.referrals.rulesTitle': 'Правила',
        'cabinet.referrals.rule1': 'Вознаграждение выплачивается через СБП (Система быстрых платежей) или банковским переводом через месяц после каждого платежа приведенного клиента. Комиссия платежной системы оплачивается из вознаграждения партнера.',
        'cabinet.referrals.rule2': 'Не пытайтесь получить скидку, покупая услуги для себя. Мы следим за этим.',
        'cabinet.referrals.rule3': 'Минимальная сумма вывода: 360 рублей.',
        'cabinet.referrals.rule4': 'Запрещено привлечение клиентов с помощью почтовых рассылок.',
        'cabinet.referrals.rule5': 'Запрещено привлечение клиентов с контекстной рекламы с использованием бренда Интеграл.',
        'cabinet.referrals.rule6': 'Запрещена установка партнерской cookie пользователю без его прямого перехода по реферальной ссылке.',
        'cabinet.referrals.agreement': 'Партнерский договор',
        'cabinet.referrals.statsTitle': 'Статистика',
        'cabinet.referrals.statsDescription': 'Здесь будет статистика привлечений клиентов, оплат и вашего вознаграждения.',
        'cabinet.referrals.clients': 'Клиенты',
        'cabinet.referrals.payments': 'Платежи',
        'cabinet.referrals.matured': 'Созрело*',
        'cabinet.referrals.commission': 'Комиссия',
        'cabinet.referrals.paid': 'Выплачено',
        'cabinet.referrals.toPay': 'К выплате',
        'cabinet.referrals.maturedNote': '* Прошло не менее месяца с момента совершения платежа',
        'cabinet.referrals.withdraw': 'Вывести средства',
        'cabinet.referrals.withdrawInfo': 'Функция вывода средств будет доступна позже'
    },
    en: {
        'page.title': 'Home',
        'nav.dark': 'Dark',
        'nav.light': 'Light',
        'nav.login': 'Sign In',
        'nav.cabinet': 'Personal Cabinet',
        'welcome.title': 'Welcome!',
        'welcome.subtitle': 'Service for working with your data.',
        'auth.loginTab': 'Sign In',
        'auth.registerTab': 'Register',
        'auth.loginTitle': 'Sign In',
        'auth.loginSubtitle': 'Sign in to your account',
        'auth.registerTitle': 'Register',
        'auth.registerSubtitle': 'Create a new account',
        'auth.email': 'Email address',
        'auth.password': 'Password',
        'auth.confirmPassword': 'Confirm password',
        'auth.loginBtn': 'Sign In',
        'auth.registerBtn': 'Register',
        'auth.or': 'or',
        'auth.yandex': 'Yandex',
        'auth.close': '✕ Close',
        'msg.passwordMismatch': 'Passwords do not match',
        'msg.passwordShort': 'Password must be at least 6 characters',
        'msg.loginSuccess': 'Signed in successfully!',
        'msg.registerSuccess': 'Registration successful. Please check your email for confirmation.',
        'msg.loginError': 'Login error: ',
        'msg.registerError': 'Registration error: ',
        // Cabinet translations
        'cabinet.title': 'Personal Cabinet',
        'cabinet.logout': 'Sign Out',
        'cabinet.userMenu.language': 'Language',
        'cabinet.userMenu.theme': 'Theme',
        'cabinet.loading': 'Loading data...',
        'cabinet.menu.profile': 'Profile',
        'cabinet.menu.balance': 'Balance',
        'cabinet.menu.databases': 'Databases',
        'cabinet.menu.access': 'Access',
        'cabinet.menu.bonuses': 'Bonuses',
        'cabinet.menu.referrals': 'Referral Program',
        'cabinet.profile.title': 'Profile',
        'cabinet.profile.name': 'Name',
        'cabinet.profile.phone': 'Phone',
        'cabinet.profile.email': 'Email',
        'cabinet.profile.emailHint': 'Email cannot be changed',
        'cabinet.profile.about': 'About me',
        'cabinet.profile.photo': 'Photo',
        'cabinet.profile.uploadPhoto': 'Upload photo',
        'cabinet.profile.save': 'Save changes',
        'cabinet.profile.saveSuccess': 'Profile saved',
        'cabinet.profile.saveError': 'Error saving profile',
        'cabinet.profile.tariffTitle': 'Tariff Information',
        'cabinet.profile.yourTariff': 'Your tariff',
        'cabinet.profile.nextCharge': 'Next charge',
        'cabinet.profile.chargeDescription': 'Billing is done once a month, resetting resource counters for all your databases. If resource usage exceeds the plan limit, you need to upgrade your plan to continue working. Learn more about plans.',
        'cabinet.profile.usageNow': 'Currently you have used',
        'cabinet.profile.resourceUnits': 'resource units or',
        'cabinet.profile.fromLimit': 'of the free plan limit of',
        'cabinet.profile.units': 'units.',
        'cabinet.profile.changePlanText': 'To change your plan, you need sufficient funds in your account. You can top up your account here by selecting the desired plan:',
        'cabinet.profile.changePlan': 'Change plan',
        'cabinet.profile.planChangeInfo': 'Please contact support to change your plan',
        'cabinet.balance.title': 'Balance',
        'cabinet.balance.description': 'Your account funds are used to pay for the tariff plan. You can top up your account with a bank card or transfer, as well as convert bonuses and referral earnings.',
        'cabinet.balance.current': 'Current balance:',
        'cabinet.balance.currency': 'RUB',
        'cabinet.balance.usageToday': 'Today you have used approximately',
        'cabinet.balance.resourceUnits': 'resource units or',
        'cabinet.balance.fromLimit': 'of the free plan limit of',
        'cabinet.balance.units': 'units.',
        'cabinet.balance.historyNote': 'Your complete transaction history is stored here.',
        'cabinet.balance.historyTitle': 'Transaction History',
        'cabinet.balance.date': 'Date',
        'cabinet.balance.amount': 'Amount',
        'cabinet.balance.note': 'Note',
        'cabinet.balance.noHistory': 'No transactions',
        'cabinet.balance.addFunds': 'Add funds',
        'cabinet.balance.addFundsInfo': 'Add funds feature will be available soon',
        'cabinet.databases.title': 'Databases',
        'cabinet.databases.description': 'List of my databases',
        'cabinet.databases.noData': 'No databases',
        'cabinet.databases.template': 'Template:',
        'cabinet.databases.records': 'Records:',
        'cabinet.databases.planDate': 'Paid until:',
        'cabinet.databases.open': 'Open',
        'cabinet.access.title': 'Access',
        'cabinet.access.description': 'List of databases with assigned users',
        'cabinet.access.noData': 'No access data',
        'cabinet.bonuses.title': 'Bonuses',
        'cabinet.bonuses.description': 'You receive bonuses upon registration and for certain actions: completing lessons, social media activity, and participating in Integral promotions. Current offers will be sent to your email.',
        'cabinet.bonuses.current': 'Current bonuses:',
        'cabinet.bonuses.convertDescription': 'Bonuses can be converted to your deposit currency and used to top up your account balance: 1 bonus = 1 ruble.',
        'cabinet.bonuses.historyNote': 'Your bonus transaction history is stored in the Balance section.',
        'cabinet.bonuses.convert': 'Convert bonuses',
        'cabinet.bonuses.noBonuses': 'You have no bonuses to convert',
        'cabinet.bonuses.convertInfo': 'Bonus conversion feature will be available soon',
        'cabinet.referrals.title': 'Referral Program',
        'cabinet.referrals.aboutTitle': 'About the Program',
        'cabinet.referrals.aboutDescription': 'You receive a 15% reward for every Ideav service payment made by a client who was referred through your referral link or promo code. The program also applies to service renewal payments.',
        'cabinet.referrals.withdrawDescription': 'This reward can be withdrawn to your bank card or transferred to a bank account in Russia. Withdrawal is available one month after the client\'s payment.',
        'cabinet.referrals.convertDescription': 'You can also convert your referral reward to your balance to pay for Ideav services.',
        'cabinet.referrals.yourLinks': 'Your referral links:',
        'cabinet.referrals.registration': 'Registration:',
        'cabinet.referrals.site': 'Integral website:',
        'cabinet.referrals.rulesTitle': 'Rules',
        'cabinet.referrals.rule1': 'Rewards are paid via SBP (Fast Payment System) or bank transfer one month after each payment from the referred client. Payment system fees are deducted from the partner\'s reward.',
        'cabinet.referrals.rule2': 'Do not try to get a discount by purchasing services for yourself. We monitor this.',
        'cabinet.referrals.rule3': 'Minimum withdrawal amount: 360 rubles.',
        'cabinet.referrals.rule4': 'Client acquisition through email campaigns is prohibited.',
        'cabinet.referrals.rule5': 'Client acquisition through contextual advertising using the Integral brand is prohibited.',
        'cabinet.referrals.rule6': 'Setting referral cookies without the user\'s direct click on the referral link is prohibited.',
        'cabinet.referrals.agreement': 'Partner Agreement',
        'cabinet.referrals.statsTitle': 'Statistics',
        'cabinet.referrals.statsDescription': 'Statistics on client referrals, payments, and your rewards will be displayed here.',
        'cabinet.referrals.clients': 'Clients',
        'cabinet.referrals.payments': 'Payments',
        'cabinet.referrals.matured': 'Matured*',
        'cabinet.referrals.commission': 'Commission',
        'cabinet.referrals.paid': 'Paid',
        'cabinet.referrals.toPay': 'To pay',
        'cabinet.referrals.maturedNote': '* At least one month has passed since the payment',
        'cabinet.referrals.withdraw': 'Withdraw funds',
        'cabinet.referrals.withdrawInfo': 'Withdrawal feature will be available soon'
    }
};

class I18nManager {
    constructor() {
        this.lang = localStorage.getItem('lang') || 'ru';
    }

    t(key) {
        return (I18N[this.lang] && I18N[this.lang][key]) || (I18N['ru'][key]) || key;
    }

    setLang(lang) {
        if (I18N[lang]) {
            this.lang = lang;
            localStorage.setItem('lang', lang);
            this.applyAll();
        }
    }

    toggleLang() {
        const langs = Object.keys(I18N);
        const idx = langs.indexOf(this.lang);
        this.setLang(langs[(idx + 1) % langs.length]);
    }

    applyAll() {
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            el.textContent = this.t(key);
        });
        document.title = this.t('page.title');
        // Update lang value span if present (cabinet user menu structure)
        const langValue = document.getElementById('lang-value');
        if (langValue) {
            langValue.textContent = this.lang.toUpperCase();
        } else {
            // Fallback for index.html simple lang toggle button
            const langToggle = document.getElementById('lang-toggle');
            if (langToggle && !langToggle.querySelector('[data-i18n]')) {
                langToggle.textContent = this.lang.toUpperCase();
            }
        }
    }
}

// ============================================================
// Theme management
// ============================================================
class ThemeManager {
    constructor(i18n) {
        this.i18n = i18n;
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
            const key = isDark ? 'nav.light' : 'nav.dark';
            themeValue.textContent = this.i18n.t(key);
            themeValue.setAttribute('data-i18n', key);
        }
        // Fallback for index.html simple theme toggle button (no structured spans)
        if (!themeIcon && !themeValue) {
            const themeToggle = document.getElementById('theme-toggle');
            if (themeToggle) {
                const labelKey = isDark ? 'nav.light' : 'nav.dark';
                themeToggle.innerHTML = (isDark ? '☀️ ' : '🌙 ') + '<span data-i18n="' + labelKey + '">' + this.i18n.t(labelKey) + '</span>';
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
// Yandex OAuth
// ============================================================
class YandexAuthManager {
    constructor(apiConfig) {
        this.apiConfig = apiConfig;
        // Yandex redirects to auth.asp on the current host (ideav.ru)
        this.redirectUri = 'https://ideav.ru/auth.asp';
    }

    isEnabled() {
        return this.apiConfig.hasYandexAuth();
    }

    initiateLogin() {
        if (!this.isEnabled()) {
            alert('Yandex OAuth не настроен. Укажите Client ID в настройках.');
            return;
        }
        const params = new URLSearchParams({
            response_type: 'token',
            client_id: this.apiConfig.yandexClientId,
            redirect_uri: this.redirectUri
        });
        window.location.href = 'https://oauth.yandex.ru/authorize?' + params.toString();
    }
}

// ============================================================
// Authentication & UI controller
// ============================================================
class AuthManager {
    constructor(apiConfig, i18n) {
        this.apiConfig = apiConfig;
        this.i18n = i18n;
        this.validDbs = []; // list of db names from idb_* cookies, ordered (idb_my first)
        this.selectedDb = null;
    }

    init() {
        const dbNames = CookieUtil.getAllIdb();
        if (dbNames.length === 0) {
            this.showLoginButton();
            return;
        }

        // Sort: idb_my first, then others
        dbNames.sort((a, b) => {
            if (a === 'my') return -1;
            if (b === 'my') return 1;
            return a.localeCompare(b);
        });

        // Use cookie presence as proxy for db availability; token validation
        // happens only when user selects a db (see navigateToDb / renderDropdown).
        this.validDbs = dbNames;

        this.selectedDb = this.validDbs[0];
        this.showDbButton();
    }

    getDbLabel(dbName) {
        if (dbName === 'my') return this.i18n.t('nav.cabinet');
        return dbName;
    }

    showLoginButton() {
        const loginBtn = document.getElementById('login-btn');
        if (loginBtn) {
            loginBtn.textContent = this.i18n.t('nav.login');
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

        if (this.validDbs.length > 1) {
            dropdownToggle.style.display = '';
            this.renderDropdown(dropdown);
        } else {
            dropdownToggle.style.display = 'none';
            dropdown.style.display = 'none';
        }
    }

    renderDropdown(dropdown) {
        dropdown.innerHTML = '';
        this.validDbs.forEach(db => {
            // Use anchor element to open db in new tab with target="{db name}"
            const item = document.createElement('a');
            item.className = 'db-dropdown-item';
            item.textContent = this.getDbLabel(db);
            item.href = '#';
            item.target = db; // Open in tab named after the database
            if (db === this.selectedDb) item.classList.add('db-dropdown-item-active');
            item.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                dropdown.style.display = 'none';
                // Validate token only upon db selection
                const host = this.apiConfig.host;
                const data = await validateToken(host, db);
                if (!data) {
                    // Token invalid – remove from list and refresh UI
                    this.validDbs = this.validDbs.filter(d => d !== db);
                    if (this.validDbs.length === 0) {
                        this.showLoginButton();
                    } else {
                        if (this.selectedDb === db) this.selectedDb = this.validDbs[0];
                        this.showDbButton();
                    }
                    return;
                }
                // Navigate to the selected db in a named tab
                window.open('https://' + host + '/' + db, db);
                this.selectedDb = db;
                this.showDbButton();
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
            // Token invalid – remove from list and refresh UI
            this.validDbs = this.validDbs.filter(d => d !== db);
            if (this.validDbs.length === 0) {
                this.showLoginButton();
            } else {
                this.selectedDb = this.validDbs[0];
                this.showDbButton();
            }
            return;
        }
        window.location.href = 'https://' + host + '/' + db;
    }

    async login(email, password) {
        const host = this.apiConfig.host;
        // Try each known db or the default 'my'
        // We use the /auth?JSON endpoint as implemented before
        const db = 'my';
        const url = 'https://' + host + '/' + db + '/auth?JSON';
        try {
            const formData = new URLSearchParams();
            formData.append('db', db);
            formData.append('login', email);
            formData.append('pwd', password);

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
            if (data.msg && data.msg !== '') {
                return { success: false, message: data.msg };
            }
            return { success: true, message: this.i18n.t('msg.loginSuccess') };
        } catch (err) {
            console.error('[auth] login error:', err);
            return { success: false, message: this.i18n.t('msg.loginError') + err.message };
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
            return { success: true, message: data.msg || this.i18n.t('msg.registerSuccess') };
        } catch (err) {
            console.error('[auth] register error:', err);
            return { success: false, message: this.i18n.t('msg.registerError') + err.message };
        }
    }
}

// ============================================================
// App initialization
// ============================================================
class App {
    constructor() {
        this.i18n = new I18nManager();
        this.theme = new ThemeManager(this.i18n);
        this.apiConfig = new ApiConfig();
        this.auth = new AuthManager(this.apiConfig, this.i18n);
        this.yandexAuth = new YandexAuthManager(this.apiConfig);
        window._app = this;
    }

    navigateToDb() {
        this.auth.navigateToDb();
    }

    async init() {
        // Apply i18n
        this.i18n.applyAll();

        // Theme toggle — only bind on index.html (no theme-icon span present)
        // Cabinet page (main.html) binds its own handler in cabinet.js setupUserMenuDropdown()
        const themeToggle = document.getElementById('theme-toggle');
        if (themeToggle && !document.getElementById('theme-icon')) {
            themeToggle.addEventListener('click', () => {
                this.theme.toggleTheme();
                this.i18n.applyAll(); // refresh i18n keys after theme label update
            });
        }

        // Lang toggle — only bind on index.html (no lang-value span present)
        // Cabinet page (main.html) binds its own handler in cabinet.js setupUserMenuDropdown()
        const langToggle = document.getElementById('lang-toggle');
        if (langToggle && !document.getElementById('lang-value')) {
            langToggle.addEventListener('click', () => {
                this.i18n.toggleLang();
                // Update login button text if visible
                const loginBtn = document.getElementById('login-btn');
                if (loginBtn && loginBtn.style.display !== 'none') {
                    loginBtn.textContent = this.i18n.t('nav.login');
                }
                // Re-render db button labels
                if (this.auth.selectedDb) {
                    this.auth.showDbButton();
                }
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

        // Yandex button handlers
        const yandexLoginBtn = document.getElementById('yandex-login-btn');
        if (yandexLoginBtn) {
            yandexLoginBtn.addEventListener('click', () => this.yandexAuth.initiateLogin());
        }
        const yandexRegisterBtn = document.getElementById('yandex-register-btn');
        if (yandexRegisterBtn) {
            yandexRegisterBtn.addEventListener('click', () => this.yandexAuth.initiateLogin());
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

        // Login form
        const loginForm = document.getElementById('login-form');
        if (loginForm) {
            loginForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const email = document.getElementById('login-email').value;
                const password = document.getElementById('login-password').value;
                const result = await this.auth.login(email, password);
                if (result.success) {
                    this.hideAuthPanel();
                    this.auth.init();
                } else {
                    alert(result.message);
                }
            });
        }

        // Register form
        const registerForm = document.getElementById('register-form');
        if (registerForm) {
            registerForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const email = document.getElementById('reg-email').value;
                const password = document.getElementById('reg-password').value;
                const confirmPassword = document.getElementById('reg-confirm-password').value;

                if (password !== confirmPassword) {
                    alert(this.i18n.t('msg.passwordMismatch'));
                    return;
                }
                if (password.length < 6) {
                    alert(this.i18n.t('msg.passwordShort'));
                    return;
                }

                const result = await this.auth.register(email, password);
                alert(result.message);
                if (result.success) {
                    this.hideAuthPanel();
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
    }

    showAuthPanel() {
        const authPanel = document.getElementById('auth-panel');
        if (authPanel) authPanel.style.display = '';
        const welcomeSection = document.getElementById('welcome-section');
        if (welcomeSection) welcomeSection.style.display = 'none';
        this.switchTab('login');
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
