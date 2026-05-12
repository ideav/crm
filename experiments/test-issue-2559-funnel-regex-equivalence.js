// Verify that {N} and {N,N} are equivalent in regex semantics
const cases = [
  { a: /^(\d{4})-(\d{1,2})-(\d{1,2})/, b: /^(\d{4,4})-(\d{1,2})-(\d{1,2})/, samples: ['2026-05-12', '26-5-12', '2026-1-2'] },
  { a: /^(\d{4})(\d{2})(\d{2})$/, b: /^(\d{4,4})(\d{2,2})(\d{2,2})$/, samples: ['20260512', '2026051', '202605121'] },
  { a: /^(\d{4})(\d{2})$/, b: /^(\d{4,4})(\d{2,2})$/, samples: ['202605', '20260', '2026051'] },
  { a: /^(\d{4})-(\d{1,2})$/, b: /^(\d{4,4})-(\d{1,2})$/, samples: ['2026-05', '2026-5', '26-05'] },
  { a: /^(\d{1,2})\.(\d{1,2})\.(\d{4})/, b: /^(\d{1,2})\.(\d{1,2})\.(\d{4,4})/, samples: ['12.05.2026', '1.5.2026', '12.05.26'] },
  { a: /^(\d{4})(\d{2})(?:\d{2})?$/, b: /^(\d{4,4})(\d{2,2})(?:\d{2,2})?$/, samples: ['202605', '20260512', '2026051'] },
  { a: /^(\d{1,2})[.\/-](\d{4})$/, b: /^(\d{1,2})[.\/-](\d{4,4})$/, samples: ['5.2026', '12-2026', '5-26'] },
];

let pass = 0, fail = 0;
for (const { a, b, samples } of cases) {
  for (const s of samples) {
    const ra = a.exec(s);
    const rb = b.exec(s);
    const eq = JSON.stringify(ra) === JSON.stringify(rb);
    if (eq) { pass++; }
    else { fail++; console.log('MISMATCH:', a, b, s, ra, rb); }
  }
}
console.log(`pass=${ pass } fail=${ fail }`);
process.exit(fail === 0 ? 0 : 1);
