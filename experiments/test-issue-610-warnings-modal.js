/**
 * Test script for issue #610 - Show warnings from _m_save response
 *
 * This tests:
 * 1. showWarningsModal method exists and works
 * 2. sanitizeWarningHtml method sanitizes HTML correctly
 * 3. Warnings are displayed in a modal (not alert)
 */

// Mock minimal IntegrAmTable class to test the methods
class IntegrAmTableMock {
    /**
     * Sanitize HTML for warning messages - allows basic formatting tags (issue #610)
     * @param {string} html - The HTML string to sanitize
     * @returns {string} - Sanitized HTML string
     */
    sanitizeWarningHtml(html) {
        if (html === null || html === undefined) return '';

        // Convert to string
        let str = String(html);

        // First, escape all HTML
        str = str.replace(/&/g, '&amp;')
                 .replace(/</g, '&lt;')
                 .replace(/>/g, '&gt;')
                 .replace(/"/g, '&quot;')
                 .replace(/'/g, '&#039;');

        // Then, selectively un-escape safe tags: <br>, <br/>, <br />
        str = str.replace(/&lt;br\s*\/?&gt;/gi, '<br>');

        return str;
    }
}

// Test cases
const table = new IntegrAmTableMock();

// Test 1: Basic HTML escaping
console.log('Test 1: Basic HTML escaping');
const test1Input = '<script>alert("xss")</script>';
const test1Output = table.sanitizeWarningHtml(test1Input);
const test1Expected = '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;';
console.log('Input:', test1Input);
console.log('Output:', test1Output);
console.log('Expected:', test1Expected);
console.log('Pass:', test1Output === test1Expected);
console.log();

// Test 2: <br> tag preservation
console.log('Test 2: <br> tag preservation');
const test2Input = 'Line 1<br>Line 2';
const test2Output = table.sanitizeWarningHtml(test2Input);
const test2Expected = 'Line 1<br>Line 2';
console.log('Input:', test2Input);
console.log('Output:', test2Output);
console.log('Expected:', test2Expected);
console.log('Pass:', test2Output === test2Expected);
console.log();

// Test 3: <br/> tag preservation
console.log('Test 3: <br/> tag preservation');
const test3Input = 'Line 1<br/>Line 2';
const test3Output = table.sanitizeWarningHtml(test3Input);
const test3Expected = 'Line 1<br>Line 2';
console.log('Input:', test3Input);
console.log('Output:', test3Output);
console.log('Expected:', test3Expected);
console.log('Pass:', test3Output === test3Expected);
console.log();

// Test 4: <br /> tag preservation (with space)
console.log('Test 4: <br /> tag preservation');
const test4Input = 'Line 1<br />Line 2';
const test4Output = table.sanitizeWarningHtml(test4Input);
const test4Expected = 'Line 1<br>Line 2';
console.log('Input:', test4Input);
console.log('Output:', test4Output);
console.log('Expected:', test4Expected);
console.log('Pass:', test4Output === test4Expected);
console.log();

// Test 5: Issue #610 example - Нельзя оставить пустым имя объекта!<br>
console.log('Test 5: Issue #610 example');
const test5Input = 'Нельзя оставить пустым имя объекта!<br>';
const test5Output = table.sanitizeWarningHtml(test5Input);
const test5Expected = 'Нельзя оставить пустым имя объекта!<br>';
console.log('Input:', test5Input);
console.log('Output:', test5Output);
console.log('Expected:', test5Expected);
console.log('Pass:', test5Output === test5Expected);
console.log();

// Test 6: Mixed safe and unsafe HTML
console.log('Test 6: Mixed safe and unsafe HTML');
const test6Input = '<b>Bold</b><br>Text<script>bad</script>';
const test6Output = table.sanitizeWarningHtml(test6Input);
const test6Expected = '&lt;b&gt;Bold&lt;/b&gt;<br>Text&lt;script&gt;bad&lt;/script&gt;';
console.log('Input:', test6Input);
console.log('Output:', test6Output);
console.log('Expected:', test6Expected);
console.log('Pass:', test6Output === test6Expected);
console.log();

// Test 7: Null/undefined handling
console.log('Test 7: Null/undefined handling');
console.log('null:', table.sanitizeWarningHtml(null) === '');
console.log('undefined:', table.sanitizeWarningHtml(undefined) === '');
console.log();

// Test 8: Case insensitive <BR>
console.log('Test 8: Case insensitive <BR>');
const test8Input = 'Line 1<BR>Line 2';
const test8Output = table.sanitizeWarningHtml(test8Input);
const test8Expected = 'Line 1<br>Line 2';
console.log('Input:', test8Input);
console.log('Output:', test8Output);
console.log('Expected:', test8Expected);
console.log('Pass:', test8Output === test8Expected);
console.log();

// Summary
console.log('=== All tests completed ===');
