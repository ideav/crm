const assert = require('assert');

function sanitizeInlineMessageHtml(html) {
    if (html === null || html === undefined) return '';

    const str = String(html);
    const placeholderPrefix = '__SAFE_ANCHOR__';
    const safeAnchors = [];

    const withAnchorPlaceholders = str.replace(/<a\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>(.*?)<\/a>/gi, (match, quote, href, text) => {
        const trimmedHref = String(href || '').trim();
        const trimmedText = String(text || '').trim();

        if (!trimmedText) return match;
        if (!/^(https?:\/\/|\/)/i.test(trimmedHref)) return match;
        if (/^\s*javascript:/i.test(trimmedHref)) return match;

        const safeHref = trimmedHref
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        const safeText = trimmedText
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');

        const anchorHtml = `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${safeText}</a>`;
        const placeholder = `${placeholderPrefix}${safeAnchors.length}__`;
        safeAnchors.push(anchorHtml);
        return placeholder;
    });

    let escaped = withAnchorPlaceholders
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');

    escaped = escaped.replace(/&lt;br\s*\/?&gt;/gi, '<br>');

    safeAnchors.forEach((anchorHtml, index) => {
        const placeholder = `${placeholderPrefix}${index}__`;
        escaped = escaped.replace(placeholder, anchorHtml);
    });

    return escaped;
}

function run() {
    const message = 'Этот реквизит используется в <a href="/sportzania/object/22/?F_28=1045">отчетах</a> или <a href="https://example.com/roles">ролях</a>!';
    const sanitized = sanitizeInlineMessageHtml(message);

    assert.ok(sanitized.includes('<a href="/sportzania/object/22/?F_28=1045" target="_blank" rel="noopener noreferrer">отчетах</a>'));
    assert.ok(sanitized.includes('<a href="https://example.com/roles" target="_blank" rel="noopener noreferrer">ролях</a>'));
    assert.ok(!sanitized.includes('&lt;a href='));

    const malicious = 'bad <a href="javascript:alert(1)">link</a> <script>alert(1)</script>';
    const blocked = sanitizeInlineMessageHtml(malicious);

    assert.ok(blocked.includes('&lt;a href=&quot;javascript:alert(1)&quot;&gt;link&lt;/a&gt;'));
    assert.ok(blocked.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
    assert.ok(!blocked.includes('javascript:alert(1)" target='));

    console.log('PASS issue-1831 toast sanitizer keeps safe anchors and escapes unsafe HTML');
}

run();
