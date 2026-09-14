#!/usr/bin/env node
// PHASE 12F.2-D — Simulate the OLD (committed) boundary detector against the 2023 text
// to confirm the Q3-duplicate and Q65-missing symptoms.
import fs from 'node:fs';
import path from 'node:path';

const filePath = path.join(process.cwd(), 'scripts', 'debug-2023-extracted.txt');
const text = fs.readFileSync(filePath, 'utf-8');

const QUESTION_PATTERNS = [
  /^Q\s*\.\s*(\d{1,2})\s*(?:–|:|\s)/m,
  /^Q\s*(\d{1,2})\s*(?:–|:|\s)/m,
  /^Q\s*\.\s*(\d{1,2})$/m,
  /^Q\s*(\d{1,2})$/m,
];

const HEADER_PATTERNS = [
  /^Computer Science/i,
  /^Organizing Institute/i,
  /^Page \d+ of \d+/i,
  /^GATE \d{4}/i,
  /^CS\s+Page/i,
  /^–\s*Q\.\d+/,
  /^\d+ of \d+ --/,
  /^--\s+\d+\s+of\s+\d+\s+--$/,
  /^Q\.\d+\s*[–-]\s*Q\.\d+\s+Carry/i,
];

function isHeaderLine(line) {
  for (const pattern of HEADER_PATTERNS) {
    if (pattern.test(line)) return true;
  }
  return false;
}

function detectQuestionBoundaries(text) {
  const boundaries = [];
  const lines = text.split('\n');
  let currentStart = -1;
  let currentNumber = -1;
  let currentText = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isHeaderLine(line)) continue;

    let matched = false;
    let qNum = -1;

    for (const pattern of QUESTION_PATTERNS) {
      const match = line.match(pattern);
      if (match) {
        qNum = parseInt(match[1], 10);
        if (!isNaN(qNum) && qNum > 0 && qNum <= 65) {
          matched = true;
          break;
        }
      }
    }

    if (matched) {
      if (currentStart !== -1 && currentText.trim().length > 20) {
        boundaries.push({
          startIndex: currentStart,
          endIndex: i - 1,
          questionNumber: currentNumber,
          rawText: currentText.trim(),
        });
      }
      currentStart = i;
      currentNumber = qNum;
      currentText = line + '\n';
    } else {
      if (currentStart !== -1) {
        currentText += line + '\n';
      }
    }
  }

  if (currentStart !== -1 && currentText.trim().length > 20) {
    boundaries.push({
      startIndex: currentStart,
      endIndex: lines.length - 1,
      questionNumber: currentNumber,
      rawText: currentText.trim(),
    });
  }

  return boundaries;
}

const boundaries = detectQuestionBoundaries(text);
console.log('OLD PARSER RESULTS');
console.log('Total boundaries:', boundaries.length);
console.log('Question numbers in order:', boundaries.map(b => b.questionNumber).join(', '));
console.log('');

const numCount = new Map();
for (const b of boundaries) {
  numCount.set(b.questionNumber, (numCount.get(b.questionNumber) || 0) + 1);
}
console.log('Duplicate numbers:', [...numCount.entries()].filter(([, c]) => c > 1));
const missing = [];
const present = new Set(boundaries.map(b => b.questionNumber));
for (let n = 1; n <= 65; n++) if (!present.has(n)) missing.push(n);
console.log('Missing from 1..65:', missing);
console.log('');
console.log('First boundary:', JSON.stringify(boundaries[0]?.questionNumber), 'startIndex', boundaries[0]?.startIndex);
console.log('Last boundary:', JSON.stringify(boundaries[boundaries.length - 1]?.questionNumber), 'startIndex', boundaries[boundaries.length-1]?.startIndex);
console.log('');
// Show where each duplicate/missing is anchored
for (const [n, c] of numCount) {
  if (c > 1) {
    console.log(`--- #${n} appears ${c}x at:`);
    boundaries.forEach((b, i) => {
      if (b.questionNumber === n) {
        console.log(`  idx ${i}: start=${b.startIndex} len=${b.rawText.length} preview=${JSON.stringify(b.rawText.slice(0, 60))}`);
      }
    });
  }
}