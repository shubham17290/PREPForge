import fs from 'node:fs';
import path from 'node:path';
import { detectQuestionBoundaries } from '../src/ingestion/question-parser.js';

const filePath = path.join(process.cwd(), 'scripts', 'debug-2023-extracted.txt');
const text = fs.readFileSync(filePath, 'utf-8');

const boundaries = detectQuestionBoundaries(text);

console.log('=== NEW BOUNDARY DETECTOR ===');
console.log('Total parsed questions:', boundaries.length);
console.log('First:', boundaries[0]?.questionNumber ?? null, '| Last:', boundaries[boundaries.length - 1]?.questionNumber ?? null);

const numbers = boundaries.map(b => b.questionNumber);
console.log('In order:', numbers.join(', '));

const count = new Map<number, number>();
for (const n of numbers) count.set(n, (count.get(n) ?? 0) + 1);
const dups = [...count.entries()].filter(([, c]) => c > 1);
console.log('Duplicate question numbers:', dups.length ? dups : 'none');

const present = new Set(numbers);
const missing: number[] = [];
for (let n = 1; n <= 65; n++) if (!present.has(n)) missing.push(n);
console.log('Missing from 1..65:', missing.length ? missing : 'none');
const complete = missing.length === 0 && dups.length === 0 && present.size === 65;
console.log('Q1..Q65 all present exactly once:', complete);

// sanity: every boundary should have a sane size and start where expected
let bad = 0;
for (const b of boundaries) {
  if (!(b.questionNumber >= 1 && b.questionNumber <= 65)) bad++;
  if (b.rawText.trim().length < 20) { bad++; console.log('  SHORT boundary #', b.questionNumber, 'len=', b.rawText.length); }
}
console.log('Boundaries failing sanity checks:', bad);

// Show previews of a few key boundaries
for (const target of [3, 41, 42, 64, 65]) {
  const b = boundaries.find(x => x.questionNumber === target);
  if (b) console.log(`--- Q${target}: start=${b.startIndex} end=${b.endIndex} len=${b.rawText.length} preview=${JSON.stringify(b.rawText.slice(0, 70))}`);
}
