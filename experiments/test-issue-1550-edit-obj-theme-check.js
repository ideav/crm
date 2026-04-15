const fs = require('fs');

const source = fs.readFileSync('templates/edit_obj.html', 'utf8');

const forbidden = [
  { pattern: /color:\s*gray;/, label: 'plain gray label color' },
  { pattern: /color:\s*#172D4E;/i, label: 'hard-coded title color' },
  { pattern: /color="lightgray"/i, label: 'legacy font lightgray color' },
  { pattern: /<FONT COLOR="RED">/i, label: 'legacy required red font tag' },
  { pattern: /stroke="#1A1A1A"/i, label: 'hard-coded icon stroke color' },
  { pattern: /fill="#1A1A1A"/i, label: 'hard-coded icon fill color' },
  { pattern: /text-dark\b/, label: 'Bootstrap text-dark class forcing light-theme text' },
  { pattern: /border:2px\s+#f0ad4e\s+solid/i, label: 'hard-coded confirm delete border color' },
];

const failures = forbidden.filter(({ pattern }) => pattern.test(source));

if (!/class="file-\{REQID\}\s+file-value"/.test(source)) {
  failures.push({ label: 'file value text is not bound to themed color class' });
}

if (failures.length) {
  console.error('Theme regression check failed:');
  failures.forEach(failure => console.error('- ' + failure.label));
  process.exit(1);
}

console.log('Theme regression check passed for templates/edit_obj.html');
