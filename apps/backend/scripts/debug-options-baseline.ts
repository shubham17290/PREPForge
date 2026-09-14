import { detectQuestionBoundaries, parseQuestion } from '../src/ingestion/question-parser.js';
import { extractPDFText, resolveRawPDFPath } from '../src/ingestion/pdf-extractor.js';

function extractRawMarksRanges(text: string): Array<{ start: number; end: number; marks: number }> {
  const ranges: Array<{ start: number; end: number; marks: number }> = [];
  for (const line of text.split('\n')) {
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
  const extract = await extractPDFText(resolveRawPDFPath('2023_CS.pdf'));
  const marksRanges = extractRawMarksRanges(extract.text);
  const boundaries = detectQuestionBoundaries(extract.text);
  const questions = boundaries.map(b => parseQuestion(b, '2023_CS.pdf', 2023, null, null, marksRanges));
  questions.sort((a, b) => (a.questionNumber ?? 0) - (b.questionNumber ?? 0));

  console.log('Per-question option counts:');
  for (const q of questions) {
    const labels = q.options.map(o => o.label);
    console.log(`Q${String(q.questionNumber).padStart(2, '0')} [${q.type}] options=${q.options.length} ${labels.join('')}`);
  }

  // Baseline: scan all 65 rawTexts for ANY lone option-label line that isn't already
  // an inline option, to anticipate cross-contamination from a standalone-label pass.
  console.log('\nStandalone label-like lines per question:');
  for (const q of questions) {
    const raw = q.rawText;
    const lone = raw.split('\n').filter(l => /^\(?[A-D]\)?$/.test(l.trim())).map(l => l.trim());
    if (lone.length) console.log(`  Q${q.questionNumber}: ${JSON.stringify(lone)}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
