#!/usr/bin/env node
// PHASE 12F.2-D — Debug helper: map each PDF page to its footer marker & first content.
import fs from 'node:fs';
import path from 'node:path';

const filePath = path.join(process.cwd(), 'scripts', 'debug-2023-extracted.txt');
const text = fs.readFileSync(filePath, 'utf-8');
const lines = text.split('\n');

const HEADER_LINE = /^(GATE\s+\d{4}|Computer Science and Information Technology \(CS\)|Organizing Institute|Page \d+ of \d+|CS\s+Page \d+ of \d+|–\s*Q\.|Q\.\d+\s*[–-]\s*Q\.\d+\s+Carry|Q\.\d+\s*[–-]\s*Q\.\d+\s*$)/;

// Build page segments
const pages = [];
let currentPage = { num: null, lines: [] };
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(/^--\s*(\d+)\s+of\s+69\s*--$/);
  if (m) {
    currentPage.num = parseInt(m[1], 10);
    currentPage.lines.push({ idx: i, text: lines[i] });
    pages.push(currentPage);
    currentPage = { num: null, lines: [] };
  } else {
    currentPage.lines.push({ idx: i, text: lines[i] });
  }
}

for (const p of pages) {
  const footers = p.lines.filter(l => /^Q\.\s*\d+\s*$/i.test(l.text.trim()));
  const inlineMarkers = p.lines.filter(l => /^Q\.\s*\d+\s+\S/i.test(l.text.trim()) || /^Q\.\s*\d+\t/i.test(l.text.trim()));
  const firstContent = p.lines.find(l => {
    const t = l.text.trim();
    if (!t) return false;
    if (/^--\s*\d+\s+of\s+69/.test(t)) return false;
    if (HEADER_LINE.test(t)) return false;
    return true;
  });
  console.log(`PAGE ${p.num}: footers=${JSON.stringify(footers.map(f => f.text.trim()))} markers=${JSON.stringify(inlineMarkers.map(m => m.text.trim()))}`);
  if (firstContent) {
    console.log(`   first-content[${firstContent.idx}]: ${JSON.stringify(firstContent.text.slice(0, 90))}`);
  } else {
    console.log(`   first-content: NONE`);
  }
}