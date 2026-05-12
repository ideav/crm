// Engine pattern from ASSETS_DEPLOYMENT.md:
// \{([A-ZА-Я0-9\.&_ \-]*?[^ ;\r\n])}
const fs = require('fs');
const content = fs.readFileSync('/tmp/gh-issue-solver-1778569276756/templates/funnel.html', 'utf8');
const re = /\{([A-ZА-Я0-9\.&_ \-]*?[^ ;\r\n])\}/g;
const matches = [];
let m;
while ((m = re.exec(content)) !== null) {
  const lineNo = content.slice(0, m.index).split('\n').length;
  matches.push({ lineNo, full: m[0], inner: m[1] });
}
console.log('matches found:', matches.length);
matches.forEach(m => console.log(` line ${ m.lineNo }: ${ m.full } -> "${ m.inner }"`));
