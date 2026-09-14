import { extractPDFText, resolveRawPDFPath } from '../src/ingestion/pdf-extractor.js';
const r = await extractPDFText(resolveRawPDFPath('2022_CS.pdf'));
const lines = r.text.split('\n');
const idx = lines.findIndex(l => l.trim() === 'Q.8');
console.log('Q8line=' + idx + ' total=' + lines.length);
for (let i = idx - 8; i <= idx + 12; i++) console.log(i + ': ' + JSON.stringify(lines[i]));
