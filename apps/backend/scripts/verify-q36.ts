import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const stagingDir: string =
  process.platform === 'win32'
    ? 'D:\\005 Projects\\gate cs and it pyq acer\\apps\\apps\\backend\\data\\staging'
    : join(process.cwd(), '..', '..', 'apps/apps/backend/data/staging');
const files = readdirSync(stagingDir).filter(f => /^staged_2023_CS_.*\.json$/.test(f)).sort().reverse();
if (!files.length) { console.error('No staged 2023 file found'); process.exit(1); }
const staged = JSON.parse(readFileSync(join(stagingDir, files[0]), 'utf8'));

const questions = staged.questions.map((q: any) => {
  const number = Number(q.number ?? q.questionNumber ?? q.question_number ?? q.qno);
  const options = Array.isArray(q.options) ? q.options.length : 0;
  return { number, type: q.type, options, raw: q };
});
questions.sort((a, b) => a.number - b.number);

console.log('Staging file:', files[0]);
console.log('Sample question keys:', Object.keys(staged.questions[0] ?? {}).join(', '));
console.log('Total questions:', questions.length);
console.log('Numbers 1..65 exactly once:', questions.length === 65 && questions.every((q, i) => q.number === i + 1));
console.log('Duplicates:', questions.length - new Set(questions.map(q => q.number)).size);

console.log('\nType distribution:');
for (const [t, arr] of Object.entries(questions.reduce((m: Record<string, number[]>, q) => { (m[q.type] ||= []).push(q.number); return m; }, {}))) {
  console.log(`  ${t}: ${arr.length} (Q${arr.join(',')})`);
}

console.log('\nQ36 options:');
const q36 = questions.find(q => q.number === 36);
if (q36) console.log(`  Q36 type=${q36.type}, options=${q36.options}`);

console.log('\nQ36 option bodies (first 60 chars each):');
if (q36 && q36.raw && Array.isArray(q36.raw.options)) {
  for (const o of q36.raw.options) console.log(`  ${o.label ?? '?'}: "${String(o.body ?? '').slice(0, 60)}..."`);
}
