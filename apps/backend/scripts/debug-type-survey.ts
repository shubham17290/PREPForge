import fs from 'node:fs';
import path from 'node:path';
import { detectQuestionBoundaries, parseQuestion } from '../src/ingestion/question-parser.js';

const filePath = path.join(process.cwd(), 'scripts', 'debug-2023-extracted.txt');
const text = fs.readFileSync(filePath, 'utf-8');
const boundaries = detectQuestionBoundaries(text);
const questions = boundaries.map(b => parseQuestion(b, '2023_CS.pdf', 2023, null, null, []));
questions.sort((a, b) => (a.questionNumber ?? 0) - (b.questionNumber ?? 0));

const candidates: Record<string, RegExp> = {
  'tab-dot(blank)': /\t\./,
  'is-tab-dot': /is\s*\t\s*\./i,
  'is-tab-unit-dot': /is\s*\t\s*[A-Za-z]+\s*\./i,
  'rounded-off': /rounded\s+off/i,
  'is-<eol>-unit-dot': /is\s*$\s*[A-Za-z]+\s*\./im,
};

console.log('=== Per-question type + candidate signal matches ===');
for (const q of questions) {
  const hits: string[] = [];
  for (const [name, re] of Object.entries(candidates)) {
    if (re.test(q.rawText)) hits.push(name);
  }
  console.log(`Q${String(q.questionNumber).padStart(2, '0')} [${q.type.padEnd(7)}] ${hits.join(', ') || '-'}`);
}

console.log('\n=== Currently-NAT questions rawText (blank representation) ===');
for (const q of questions.filter(q => q.type === 'nat')) {
  console.log(`--- Q${q.questionNumber} ---`);
  console.log(q.rawText);
  console.log('');
}
