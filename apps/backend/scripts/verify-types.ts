import { detectQuestionBoundaries, parseQuestion } from '../src/ingestion/question-parser.js';
import { validateQuestions, getValidationSummary } from '../src/ingestion/validator.js';
import { extractPDFText, resolveRawPDFPath } from '../src/ingestion/pdf-extractor.js';

function extractRawMarksRanges(text: string): Array<{ start: number; end: number; marks: number }> {
  const ranges: Array<{ start: number; end: number; marks: number }> = [];
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.toLowerCase().includes('carry')) continue;
    let m = trimmed.match(/Q\.\s*(\d+)\s*[–-]\s*Q\.\s*(\d+)\s+Carry\s+(one|two)\s+marks?(?:\s+[Ee]ach)?/i);
    if (m) { ranges.push({ start: +m[1], end: +m[2], marks: m[3].toLowerCase() === 'one' ? 1 : 2 }); continue; }
    m = trimmed.match(/[–-]\s*Q\.\s*(\d+)\s+Carry\s+(one|two)\s+marks?(?:\s+[Ee]ach)?/i);
    if (m) { ranges.push({ start: 1, end: +m[1], marks: m[2].toLowerCase() === 'one' ? 1 : 2 }); }
  }
  return ranges;
}

async function main() {
  const fileName = '2023_CS.pdf';
  const extract = await extractPDFText(resolveRawPDFPath(fileName));
  const marksRanges = extractRawMarksRanges(extract.text);

  const boundaries = detectQuestionBoundaries(extract.text);
  const questions = boundaries.map(b => parseQuestion(b, fileName, 2023, null, null, marksRanges));
  questions.sort((a, b) => (a.questionNumber ?? 0) - (b.questionNumber ?? 0));

  console.log('Total:', questions.length);
  console.log('First/Last:', questions[0].questionNumber, '/', questions[questions.length - 1].questionNumber);
  const counts: Record<string, number> = {};
  for (const q of questions) counts[q.type] = (counts[q.type] || 0) + 1;
  console.log('Type counts:', JSON.stringify(counts));

  const nums = questions.map(q => q.questionNumber);
  const uniq = new Set(nums);
  console.log('Duplicates:', nums.length === uniq.size ? 'none' : nums.filter((n, i) => nums.indexOf(n) !== i));
  const missing: number[] = [];
  for (let n = 1; n <= 65; n++) if (!uniq.has(n)) missing.push(n);
  console.log('Missing 1..65:', missing.length ? missing : 'none');

  const results = validateQuestions(questions);
  const summary = getValidationSummary(results);
  console.log('Validation summary:', JSON.stringify(summary));
  for (const r of results) {
    if (r.status === 'INVALID') {
      console.log(`\nINVALID Q${r.question.questionNumber}:`);
      for (const i of r.issues) console.log(`  [${i.severity}] ${i.code}: ${i.message}`);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });

