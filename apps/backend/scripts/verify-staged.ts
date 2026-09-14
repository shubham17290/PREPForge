import fs from 'node:fs';
import path from 'node:path';

const dir = path.join(process.cwd(), '..', 'apps', 'backend', 'data', 'staging');
const file = fs.readdirSync(dir).filter(f => f.startsWith('staged_2023_CS_')).sort().pop()!;
const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'));

console.log('Staging file:', path.join(dir, file));
console.log('Source:', JSON.stringify(data.source));
console.log('Question count:', data.questions.length);

const nums = data.questions.map((q: any) => q.question_number);
const unique = new Set(nums);
console.log('First:', nums[0], '| Last:', nums[nums.length - 1]);
const dups = nums.filter((n: number, i: number) => nums.indexOf(n) !== i);
console.log('Duplicates:', dups.length ? dups : 'none');
const missing: number[] = [];
for (let n = 1; n <= 65; n++) if (!unique.has(n)) missing.push(n);
console.log('Missing 1..65:', missing.length ? missing : 'none');
console.log('Q1..Q65 all present exactly once:', missing.length === 0 && unique.size === 65);

const q3 = data.questions.filter((q: any) => q.question_number === 3);
console.log('\nQ3 occurrences:', q3.length);
if (q3.length) console.log('Q3 body preview:', JSON.stringify(q3[0].body.slice(0, 80)));

const q65 = data.questions.filter((q: any) => q.question_number === 65);
console.log('\nQ65 occurrences:', q65.length);
if (q65.length) console.log('Q65 body preview:', JSON.stringify(q65[0].body.slice(0, 90)));

console.log('\nType distribution:', data.questions.reduce((acc: any, q: any) => { acc[q.type] = (acc[q.type] || 0) + 1; return acc; }, {}));
