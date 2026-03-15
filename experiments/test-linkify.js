// Test linkifyText logic (issue #947)

function linkifyText(escapedText) {
    if (!escapedText) return escapedText;
    return escapedText.replace(/(https?:\/\/[^\s<>"']+)/g, (url) => {
        const trailingPunct = url.match(/[.,;:!?)]+$/);
        const cleanUrl = trailingPunct ? url.slice(0, -trailingPunct[0].length) : url;
        const suffix = trailingPunct ? trailingPunct[0] : '';
        return `<a href="${cleanUrl}" target="_blank" rel="noopener noreferrer" class="cell-hyperlink" onclick="event.stopPropagation();">${cleanUrl}</a>${suffix}`;
    });
}

const tests = [
    {
        input: 'Check https://example.com for details',
        expected_contains: '<a href="https://example.com"',
        desc: 'Plain URL in text'
    },
    {
        input: 'Visit https://example.com.',
        expected_contains: '<a href="https://example.com"',
        not_contains: '<a href="https://example.com."',
        desc: 'URL with trailing period'
    },
    {
        input: 'See (https://example.com/path?q=1&amp;r=2)',
        expected_contains: '<a href="https://example.com/path?q=1&amp;r=2"',
        not_contains: 'href="https://example.com/path?q=1&amp;r=2)"',
        desc: 'URL with query params and trailing paren'
    },
    {
        input: 'No URLs here',
        expected_contains: 'No URLs here',
        desc: 'No URL - unchanged'
    },
    {
        input: 'Two links: https://a.com and https://b.com!',
        expected_contains: 'href="https://a.com"',
        desc: 'Two URLs'
    },
    {
        input: '',
        expected_contains: '',
        desc: 'Empty string'
    }
];

let passed = 0;
let failed = 0;

tests.forEach(t => {
    const result = linkifyText(t.input);
    let ok = result.includes(t.expected_contains);
    if (ok && t.not_contains) {
        ok = !result.includes(t.not_contains);
    }
    if (ok) {
        console.log(`✓ ${t.desc}`);
        passed++;
    } else {
        console.log(`✗ ${t.desc}`);
        console.log(`  Input:    ${t.input}`);
        console.log(`  Result:   ${result}`);
        console.log(`  Expected: ${t.expected_contains}`);
        failed++;
    }
});

console.log(`\n${passed} passed, ${failed} failed`);
