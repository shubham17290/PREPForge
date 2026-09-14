import fs from 'node:fs';
import path from 'node:path';
import { detectQuestionBoundaries, parseQuestion } from '../src/ingestion/question-parser.js';

const filePath = path.join(process.cwd(), 'scripts', 'debug-2023-extracted.txt');
const text = fs.readFileSync(filePath, 'utf-8');

const boundaries = detectQuestionBoundaries(text);
const questions = boundaries.map(b => parseQuestion(b, '2023_CS.pdf', 2023, null, null, []));
const byNum = new Map(questions.map(q => [q.questionNumber, q]));

const unknowns = questions.filter(q => q.type === 'unknown');
console.log('UNKNOWN numbers:', unknowns.map(q => q.questionNumber).join(', '));
console.log('');

// 1) For each UNKNOWN, print the RAW text and annotate which NAT-like patterns it contains.
const patterns: Record<string, RegExp> = {
  'is <blank>.': /is\s+\t\s*\./i,
  '= <blank>.': /=?\s*\t\s*\./i,
  'is <blank><unit>.': /is\s+\t\s*\S+\./i,
  'Rounded off': /rounded\s+off/i,
  'Numerical': /numerical/i,
  'The value of ... =': /the value of .* =/i,
  'blank tab-dot': /\t\./,
};

for (const q of unknowns) {
  console.log('='.repeat(90));
  console.log(`Q${q.questionNumber} rawText (${q.rawText.length} chars):`);
  console.log(JSON.stringify(q.rawText));
  console.log('');
  const hits: string[] = [];
  for (const [name, re] of Object.entries(patterns)) {
    if (re.test(q.rawText)) hits.push(name);
  }
  console.log('  Pattern hits:', hits.join(' | ') || 'NONE');
  console.log('');
}
