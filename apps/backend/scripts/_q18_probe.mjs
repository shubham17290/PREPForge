import { extractPDFText, resolveRawPDFPath } from '../src/ingestion/pdf-extractor.js';

const r = await extractPDFText(resolveRawPDFPath('2022_CS.pdf'));
const { text, pages } = r;
const lines = text.split('\n');
console.log('PAGES:', pages?.length ?? 0, 'CHARS:', text.length, 'LINES:', lines.length);
const q8idx = lines.findIndex(l=>l.trim().startsWith('Q.8'));
const q9idx = lines.findIndex(l=>l.trim().startsWith('Q.9'));
const q17idx = lines.findIndex(l=>l.trim().startsWith('Q.17'));
const q18idx = lines.findIndex(l=>l.trim().startsWith('Q.18'));
const q19idx = lines.findIndex(l=>l.trim().startsWith('Q.19'));
console.log('Q8 L', q8idx, 'Q9 L', q9idx, 'Q17 L', q17idx, 'Q18 L', q18idx, 'Q19 L', q19idx);
const q18HeaderLine = lines[q18idx];
console.log('Q18HDR:', JSON.stringify(q18HeaderLine));
const q18Line = q18HeaderLine.replace(/^\s*Q\.\s*18\s*/, '')
  .replace(/^(Multiple Choice Questions \(MCQ\), carry TWO marks each.\s*)?/i,'');
console.log('Q18LINE:', JSON.stringify(q18Line));
const raw = lines.slice(q17idx+1, q19idx);
console.log('RAW_LEN', raw.length);
for (let i = 0; i < raw.length; i++) {
  const v = raw[i];
  const codepoints = Array.from(v).map(ch => 'U+' + v.charCodeAt(v.indexOf(ch)).toString(16).toUpperCase().padStart(4,'0'));
  console.log(i + ': ' + JSON.stringify(v) + ' | CP:(' + codepoints.slice(0,6).join(' ') + ')');
}
