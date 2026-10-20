// Мерка к ревью PR #5208: иконки dir_admin видны в тёмной теме.
// Значки «запустить / править / копировать / ссылка / загрузить» в templates/dir_admin.html нарисованы
// SVG-контуром с жёстким цветом stroke="#1A1A1A" — это ровно фон тёмной темы (--bg-primary: #1a1a1a в
// css/styles.css). Правило общее: для КАЖДОГО жёсткого цвета контура в шаблоне в стилях, которые
// подключает сам шаблон (<link rel="stylesheet"> и <style>), есть тёмное переопределение
// [data-theme="dark"] svg path[stroke="<цвет>"] { stroke: var(--text-primary) }.
// Браузера в гейте нет, поэтому каскад разбирается здесь: правила CSS → селекторы → объявления.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const tpl = fs.readFileSync(path.join(ROOT, 'templates/dir_admin.html'), 'utf8');

// Стили страницы: подключённые файлы из репозитория + встроенные <style>
function pageStyles(page) {
    const out = [];
    for (const m of page.matchAll(/<link[^>]+rel="stylesheet"[^>]*href="([^"?]+)[^"]*"/g)) {
        const file = path.join(ROOT, m[1].replace(/^\//, ''));
        if (fs.existsSync(file)) out.push(fs.readFileSync(file, 'utf8'));
    }
    for (const m of page.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) out.push(m[1]);
    return out.join('\n');
}

// Плоский список правил { selectors[], decls{} } (вложенные @media разворачиваются)
function rules(sheet) {
    const out = [];
    const noComments = sheet.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of noComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const decls = {};
        m[2].split(';').forEach(d => {
            const i = d.indexOf(':');
            if (i > 0) decls[d.slice(0, i).trim().toLowerCase()] = d.slice(i + 1).trim();
        });
        out.push({ selectors: m[1].split(',').map(s => s.trim().replace(/\s+/g, ' ')), decls });
    }
    return out;
}

// Цвет контура в тёмной теме для <svg><path stroke="color">: последнее подходящее правило.
// Значение атрибута в селекторе сравнивается с учётом регистра, если нет флага « i».
function darkStroke(all, color) {
    let got = null;
    for (const r of all) {
        if (!r.decls.stroke) continue;
        const hit = r.selectors.some(sel => {
            const m = sel.match(/^\[data-theme="dark"\] (?:[\w.#-]+ )*svg path\[stroke="([^"]+)"( i)?\]$/);
            return !!m && (m[2] ? m[1].toLowerCase() === color.toLowerCase() : m[1] === color);
        });
        if (hit) got = r.decls.stroke;
    }
    return got;
}

test('dir_admin: у каждого жёсткого цвета контура иконок есть цвет в тёмной теме', () => {
    const colors = [...new Set([...tpl.matchAll(/<path[^>]*\sstroke="(#[0-9A-Fa-f]{3,8})"/g)].map(m => m[1]))];
    assert.ok(colors.length > 0, 'в шаблоне есть иконки с контуром');
    const all = rules(pageStyles(tpl));
    for (const color of colors) {
        assert.strictEqual(darkStroke(all, color), 'var(--text-primary)',
            'иконки с stroke="' + color + '" в тёмной теме сливаются с фоном');
    }
});
