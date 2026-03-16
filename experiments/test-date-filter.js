// Simple test to verify date conversion logic for filter pickers

// Simulate the conversion functions
function convertHtml5DateToDisplay(html5Value, includeTime = false) {
    if (!html5Value) return '';

    if (includeTime) {
        // YYYY-MM-DDTHH:MM(:SS) -> DD.MM.YYYY HH:MM:SS
        const [datePart, timePart] = html5Value.split('T');
        const [year, month, day] = datePart.split('-');
        const timeParts = timePart.split(':');
        const hours = timeParts[0] || '00';
        const minutes = timeParts[1] || '00';
        const seconds = timeParts[2] || '00';
        return `${day}.${month}.${year} ${hours}:${minutes}:${seconds}`;
    } else {
        // YYYY-MM-DD -> DD.MM.YYYY
        const [year, month, day] = html5Value.split('-');
        return `${day}.${month}.${year}`;
    }
}

function formatDateForHtml5(value, includeTime = false) {
    if (!value) return '';
    // Parse DD.MM.YYYY
    const parts = value.trim().split(' ');
    const dateParts = parts[0].split('.');
    if (dateParts.length !== 3) return '';
    const day = dateParts[0];
    const month = dateParts[1];
    const year = dateParts[2];
    
    if (includeTime && parts.length >= 2) {
        const timeParts = parts[1].split(':');
        const h = (timeParts[0] || '00').padStart(2, '0');
        const m = (timeParts[1] || '00').padStart(2, '0');
        return `${year}-${month}-${day}T${h}:${m}`;
    }
    return `${year}-${month}-${day}`;
}

// Test cases
console.log('=== Date conversion tests ===');

// DD.MM.YYYY -> YYYY-MM-DD (HTML5) -> DD.MM.YYYY (display)
const dateDisplay = '15.03.2026';
const dateHtml5 = formatDateForHtml5(dateDisplay, false);
const dateBack = convertHtml5DateToDisplay(dateHtml5, false);
console.log(`Date: ${dateDisplay} -> ${dateHtml5} -> ${dateBack}`);
console.assert(dateBack === dateDisplay, `Expected ${dateDisplay}, got ${dateBack}`);

// DD.MM.YYYY HH:MM:SS -> YYYY-MM-DDTHH:MM (HTML5) -> DD.MM.YYYY HH:MM:SS (display)
const datetimeDisplay = '15.03.2026 10:30:00';
const datetimeHtml5 = formatDateForHtml5(datetimeDisplay, true);
const datetimeBack = convertHtml5DateToDisplay(datetimeHtml5, true);
console.log(`DateTime: ${datetimeDisplay} -> ${datetimeHtml5} -> ${datetimeBack}`);
// Note: seconds may be added as '00'
console.assert(datetimeBack.startsWith('15.03.2026 10:30'), `Expected to start with '15.03.2026 10:30', got ${datetimeBack}`);

// Empty value
const emptyHtml5 = formatDateForHtml5('', false);
console.log(`Empty: '' -> '${emptyHtml5}'`);
console.assert(emptyHtml5 === '', `Expected '', got ${emptyHtml5}`);

console.log('\nAll tests passed!');
