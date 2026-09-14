#!/usr/bin/env node
// PHASE 12F.2-D — Debug helper: dump 2023_CS.pdf extracted text to a file for inspection.
import { PDFParse } from 'pdf-parse';
import fs from 'node:fs';
import path from 'node:path';

const projectRoot = 'D:/005 Projects/gate cs and it pyq acer';
const pdfPath = path.join(projectRoot, 'apps', 'backend', 'data', 'raw', 'CS', '2023_CS.pdf');
const dataBuffer = fs.readFileSync(pdfPath);
const parser = new PDFParse({ data: dataBuffer, verbosity: 0 });
await parser.load();
const data = await parser.getText();

const text = data.text ?? '';
console.log('Text length:', text.length);
console.log('Num pages:', parser.doc?.numPages ?? 0);

const outPath = path.join(projectRoot, 'apps', 'backend', 'scripts', 'debug-2023-extracted.txt');
fs.writeFileSync(outPath, text, 'utf-8');
console.log('Dumped to:', outPath);