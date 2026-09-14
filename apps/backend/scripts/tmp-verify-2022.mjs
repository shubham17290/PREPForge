import { runIngestionPipeline } from '../src/ingestion/pipeline.js';
const r = await runIngestionPipeline('2022_CS.pdf', { outputStaging: false, outputReport: false });
const nums = r.questions.map(q => q.questionNumber);
const missing = [];
for (let i = 1; i <= 65; i++) if (!nums.includes(i)) missing.push(i);
console.log('COUNT=' + r.questions.length + ' missing=' + JSON.stringify(missing));
const tc = {};
for (const q of r.questions) tc[q.type] = (tc[q.type] || 0) + 1;
console.log('TYPES=' + JSON.stringify(tc));
let bad = 0;
for (const q of r.questions) {
  if ((q.type === 'mcq' || q.type === 'msq') && q.options.length !== 4) { console.log('OPTQ' + q.questionNumber + '=' + q.type + ':' + q.options.length + ':' + JSON.stringify(q.options.map(o => o.label))); bad++; }
  if (q.type === 'nat' && q.options.length !== 0) { console.log('NATQ' + q.questionNumber + ':' + q.options.length); bad++; }
  const L = q.options.map(o => o.label);
  if (new Set(L).size !== L.length) { console.log('DUPL' + q.questionNumber); bad++; }
  for (const o of q.options) if (/carry/i.test(o.body)) { console.log('LEAK' + q.questionNumber + o.label); bad++; }
}
console.log('BAD=' + bad);
console.log('VAL=' + JSON.stringify(r.validationSummary));
const q5 = r.questions.find(q => q.questionNumber === 5);
const q7 = r.questions.find(q => q.questionNumber === 7);
const q8 = r.questions.find(q => q.questionNumber === 8);
console.log('Q5=' + (q5 && q5.type) + ':' + (q5 && q5.options.length) + ':' + JSON.stringify(q5 && q5.options.map(o => o.label)));
console.log('Q7=' + (q7 && q7.type) + ':' + (q7 && q7.options.length) + ':' + JSON.stringify(q7 && q7.options.map(o => o.label)));
console.log('Q8=' + (q8 && q8.type) + ':' + (q8 && q8.options.length) + ':' + JSON.stringify(q8 && q8.options.map(o => o.label)));
