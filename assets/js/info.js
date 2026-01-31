/**
 * Info.html Workspace Script
 * Loads quick links
 * Note: Tasks table auto-initializes from data attributes in integram-table.js
 */

(function() {
    'use strict';

    // Load quick links
    async function loadQuickLinks() {
        const container = document.getElementById('quick-links');

        try {
            const response = await fetch(`/${window.db}/report/299?JSON_KV`);
            const links = await response.json();

            if (!links || links.length === 0) {
                container.innerHTML = '<div style="padding: 20px; color: #6c757d;">Нет быстрых ссылок</div>';
                return;
            }

            let html = '';
            links.forEach(link => {
                const format = link['Формат отчета'] || 'report';
                const queryId = link['ЗапросID'];
                const label = link['Запрос'] || 'Ссылка';
                const isPriority = link['приоритет'] === 'X';
                const url = `/${window.db}/${format}/${queryId}`;

                html += `
                    <a href="${url}" class="quick-link-badge${isPriority ? ' priority' : ''}" target="${queryId}">
                        ${isPriority ? '<span class="icon">⚡</span>' : ''}
                        ${label}
                    </a>
                `;
            });

            container.innerHTML = html;
        } catch (error) {
            console.error('Error loading quick links:', error);
            container.innerHTML = '<div style="padding: 20px; color: #dc3545;">Ошибка загрузки быстрых ссылок</div>';
        }
    }

    // Initialize components on page load
    document.addEventListener('DOMContentLoaded', function() {
        // Load quick links
        loadQuickLinks();

        // Tasks table auto-initializes from data-integram-table attributes
    });

})();
