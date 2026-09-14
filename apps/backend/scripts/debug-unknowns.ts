import fs from 'node:fs';
import path from 'node:path';

const dir = path.join(process.cwd(), '..', 'apps', 'backend', 'data', 'staging');
const file = fs.readdirSync(dir).filter(f => f.startsWith('staged_2023_CS_')).sort().pop()!;
const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'));
console.log('Staging file:', file);
console.log('Total questions:', data.questions.length);

const unknowns = data.questions.filter((q: any) => q.type === 'unknown');
console.log('UNKNOWN count:', unknowns.length, '\n');

for (const q of unknowns) {
  console.log('='.repeat(90));
  console.log(`Q${q.question_number} (options=${q.options.length}, marks=${q.marks})`);
  console.log('BODY:');
  console.log(q.body);
  console.log('');
}
