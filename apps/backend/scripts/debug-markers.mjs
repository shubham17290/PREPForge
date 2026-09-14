#!/usr/bin/env node
// PHASE 12F.2-D — Debug helper: analyze question-marker-like lines in the 2023 extracted text.
import fs from 'node:fs';
import path from 'node:path';

const filePath = path.join(process.cwd(), 'scripts', 'debug-2023-extracted.txt');
const text = fs.readFileSync(filePath, 'utf-8');
const lines = text.split('\n');

console.log('=== LINES MATCHING ^Q.\\s*\\d (any position) ===');
for (let i = 0; i < lines.length; i++) {
  const line = lines[i].trim();
  if (/^Q\.\s*\d/i.test(line)) {
    const prev = (lines[i - 1] || '').trim();
    const next = (lines[i + 1] || '').trim();
    console.log(`[line ${i}] MATCH: ${JSON.stringify(line)}`);
    console.log(`        prev: ${JSON.stringify(prev)}`);
    console.log(`        next: ${JSON.stringify(next)}`);
  }
}