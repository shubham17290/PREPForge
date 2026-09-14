// READ-ONLY AUDIT — Phase 12F.2-G
// Searches 2023_CS.pdf extracted text for answer-key / solution / marking info.
// Does NOT modify any source, staging, DB, or data files.
import fs from 'node:fs';
import path from 'node:path';
import { PDFParse } from 'pdf-parse';

const pdfPath = path.resolve(
  'D:\\005 Projects\\gate cs and it pyq acer',
  'apps', 'backend', 'data', 'raw', 'CS', '2023_CS.pdf'
);

const buf = fs.readFileSync(pdfPath);
const parser = new PDFParse({ data: buf, verbosity: 0 });
await parser.load();
const result = await parser.getText();
const text = result.text ?? '';
const numPages = parser.doc?.numPages ?? 0;

// Split into lines, preserve page-ish breaks: pdf-parse doesn't give page text
// directly, so we use the form-feed / blank gaps only as heuristic. We just
// search the whole text.
const lines = text.split('\n');

const signatures = [
  /answer\s*(?:key|key:)?\s*:?\s*[A-D]/i,
  /answer\s*=\s*[A-D]/i,
  /correct\s*(?:answer|option)\s*[:=]?\s*[A-D]/i,
  /\([A-D]\)\s*is\s+correct/i,
  /the\s+correct\s+option\s+is\s+[A-D]/i,
  /answer\s+key/i,
  /solutions?\s*$/i,
  /\bmsq\b.*\banswer\b/i,
  /negative\s*mark/i,
  /each\s+correct\s+answer/i,
  /\bmarks?\b.*\d.*\bnegative\b/i,
];

function findMatches(src, lines) {
  const out = [];
  lines.forEach((ln, i) => {
    signatures.forEach((re) => {
      if (re.test(ln)) out.push({ lineNo: i + 1, text: ln.trim().slice(0, 160) });
    });
  });
  return out;
}

const matches = findMatches(text, lines);

// NAT answer look: questions like "Fill in the blank" with numeric/alpha after
const natHints = lines.filter((ln) =>
  /\b(?:fill\s*in|blank|nat\b|numerical|integer\b|in\s+the\s+range)/i.test(ln)
).length;

console.log('=== 2023_CS.pdf ANSWER AUDIT ===');
console.log('PDF path :', pdfPath);
console.log('Size     :', buf.length, 'bytes');
console.log('Pages    :', numPages);
console.log('Text len :', text.length);
console.log('Text lines:', lines.length);
console.log('--- ANSWER/SOLUTION/MARKING SIGNATURE MATCHES ---');
console.log('matches:', matches.length);
matches.slice(0, 60).forEach((m) =>
  console.log(`  L${String(m.lineNo).padStart(4)}: ${m.text}`)
);

console.log('--- NAT/blank hints count ---', natHints);

// Show the last 25 lines (answer keys are usually appended at end)
console.log('--- LAST 25 LINES OF PDF ---');
lines.slice(-25).forEach((l, i) =>
  console.log(`[${lines.length - 25 + i + 1}] ${l}`)
);

// Show first 20 lines (intro/coversheet may state marks scheme)
console.log('--- FIRST 20 LINES OF PDF ---');
lines.slice(0, 20).forEach((l, i) => console.log(`[${i + 1}] ${l}`));

// MARKING info audit
const markingTerms = [
  'one mark', 'two mark', 'one-mark', 'two-mark',
  'negative mark', 'negative-mark', 'carries', 'carry',
  'each correct', 'no negative', '1 mark', '2 mark',
  'marks', 'negative marks',
];
console.log('--- MARKING INFO DECODED-TEXT SEARCH ---');
for (const k of markingTerms) {
  const re = new RegExp(k, 'i');
  const m = text.match(re);
  console.log(`${k}: ${m ? 'FOUND' : '0'}`);
}
console.log('--- decoded lines containing "mark" (first 20) ---');
lines.filter((l) => /[Mm]ark/.test(l)).slice(0, 20).forEach((l) =>
  console.log(`  ${l.slice(0, 150)}`)
);

