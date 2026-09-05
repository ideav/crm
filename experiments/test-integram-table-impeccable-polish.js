const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const css = read('css/integram-table.css');
const render = read('js/integram-table/04-render-table.js');
const core = read('js/integram-table/00-class-open.js');
const title = read('js/integram-table/01-core.js');
const cells = read('js/integram-table/06-render-cell.js');
const hiddenFilters = read('js/integram-table/14-url-config.js');
const toast = read('js/integram-table/22-utils.js');
const exportMenu = read('js/integram-table/23-bulk-export.js');

let passed = 0;
function check(name, condition) {
    if (!condition) throw new Error(`FAIL: ${name}`);
    passed++;
    console.log(`PASS: ${name}`);
}

check('shared polish token layer exists', css.includes('--it-primary:') && css.includes('--it-surface:'));
check('new palette uses OKLCH', css.includes('oklch('));
check('reduced motion is supported', css.includes('@media (prefers-reduced-motion: reduce)'));
check('forced-colors selection remains visible', css.includes('@media (forced-colors: active)'));
check('visible keyboard focus is defined', css.includes(':focus-visible') && css.includes('outline: 2px solid var(--it-focus)'));
check('mobile touch targets reach 44px', /@media \(max-width: 768px\)[\s\S]*min-height: 44px;/.test(css));
check('broad transition-all declarations are absent', !/transition:\s*all\b/.test(css));
check('pure black and white literals are absent', !/(?:#(?:fff|ffffff|000|000000)\b|:\s*(?:white|black)\b)/i.test(css));
check('wide colored side stripes are absent', !/border-(?:left|right):\s*[2-9]px\s+solid/.test(css));
check('stale conflict markers are absent', !css.includes('<<<<<<<'));
check('toolbar actions render as native buttons', render.includes('<button type="button" class="integram-table-settings'));
check('toolbar has no clickable settings divs', !/<div class="integram-table-settings[^>]*onclick=/.test(render));
check('filter operator is a labelled button', render.includes('class="filter-icon-inside"') && render.includes('Условие фильтра:'));
check('sortable headings are native buttons', render.includes('<button type="button" class="column-header-content"'));
check('empty and loading states are explicit', render.includes('integram-table-empty-state') && render.includes('Загружаем данные…') && render.includes('Записей пока нет'));
check('row-selection toggle exposes pressed state', title.includes('aria-pressed="${ this.checkboxMode'));
check('total count actions are native buttons', cells.includes('<button type="button" class="total-count-unknown"') && cells.includes('<button type="button" class="total-count-known"'));
check('hidden filter removal is a labelled button', hiddenFilters.includes('<button type="button" class="hidden-filter-badge-remove"'));
check('modal roles and labels are assigned centrally', core.includes("setAttribute('role', 'dialog')") && core.includes("setAttribute('aria-labelledby'"));
check('modal keyboard focus is trapped and restored', core.includes("event.key === 'Tab'") && core.includes('previouslyFocused.focus'));
check('toast status is not communicated by color alone', toast.includes('integram-toast-icon') && toast.includes('integram-toast-dismiss') && toast.includes("setAttribute('role'"));
check('export menu exposes expanded state', exportMenu.includes("setAttribute('aria-expanded', 'true')") && /\.key === 'ArrowDown'/.test(exportMenu));
check('export menu releases outside-click listeners', exportMenu.includes('_integramExportCloseHandler') && exportMenu.includes("removeEventListener('click'"));
check('CSS braces are balanced', (css.match(/{/g) || []).length === (css.match(/}/g) || []).length);

console.log(`\n${passed} impeccable polish checks passed.`);
