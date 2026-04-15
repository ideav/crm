const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'templates', 'object.html');
const source = fs.readFileSync(target, 'utf8');

const bannedPatterns = [
  { label: '#333', regex: /#333\b/i },
  { label: '#fff', regex: /#fff\b/i },
  { label: 'lightgray', regex: /lightgray\b/i },
  { label: '#e7e7e7', regex: /#e7e7e7\b/i },
  { label: '#777777', regex: /#777777\b/i },
  { label: 'font-tag-color', regex: /font\s+color=/i },
  { label: 'hardcoded-stroke', regex: /stroke="#(?:1A1A1A|777777|212529)"/i },
  { label: 'hardcoded-fill', regex: /fill="#(?:1A1A1A|777777|212529|fff)"/i }
];

const failures = [];
for (const pattern of bannedPatterns) {
  if (pattern.regex.test(source)) {
    failures.push(pattern.label);
  }
}

if (failures.length > 0) {
  console.error('Object theme audit failed. Found banned hard-coded theme colors/patterns:');
  failures.forEach((failure) => console.error(' - ' + failure));
  process.exit(1);
}

console.log('Object theme audit passed: no banned hard-coded theme colors remain in templates/object.html');
