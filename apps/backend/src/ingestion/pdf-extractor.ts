import { PDFParse } from 'pdf-parse';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

export interface PDFExtractResult {
  text: string;
  numPages: number;
  fileName: string;
  filePath: string;
  extractedAt: string;
  warnings: string[];
}

export interface PDFExtractOptions {
  verbosity?: number;
  maxPages?: number;
}

export class PDFExtractError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly filePath?: string
  ) {
    super(message);
    this.name = 'PDFExtractError';
  }
}

export async function extractPDFText(
  filePath: string,
  options: PDFExtractOptions = {}
): Promise<PDFExtractResult> {
  const absolutePath = path.isAbsolute(filePath)
    ? filePath
    : path.join(PROJECT_ROOT, filePath);

  if (!fs.existsSync(absolutePath)) {
    throw new PDFExtractError(
      `PDF file not found: ${absolutePath}`,
      'FILE_NOT_FOUND',
      absolutePath
    );
  }

  const stats = fs.statSync(absolutePath);
  if (!stats.isFile()) {
    throw new PDFExtractError(
      `Path is not a file: ${absolutePath}`,
      'NOT_A_FILE',
      absolutePath
    );
  }

  const dataBuffer = fs.readFileSync(absolutePath);
  if (dataBuffer.length === 0) {
    throw new PDFExtractError(
      `PDF file is empty: ${absolutePath}`,
      'EMPTY_FILE',
      absolutePath
    );
  }

  const warnings: string[] = [];
  const parser = new PDFParse({
    data: dataBuffer,
    verbosity: options.verbosity ?? 0,
  });

  try {
    await parser.load();
  } catch (err) {
    throw new PDFExtractError(
      `Failed to load PDF: ${err instanceof Error ? err.message : String(err)}`,
      'LOAD_FAILED',
      absolutePath
    );
  }

  let text = '';
  try {
    const result = await parser.getText();
    text = result.text ?? '';
  } catch (err) {
    throw new PDFExtractError(
      `Failed to extract text: ${err instanceof Error ? err.message : String(err)}`,
      'EXTRACTION_FAILED',
      absolutePath
    );
  }

  if (!text || text.trim().length === 0) {
    warnings.push('Extracted text is empty - PDF may be image-only or scanned');
  } else if (text.length < 100) {
    warnings.push(`Extracted text is very short (${text.length} chars) - PDF may be mostly images`);
  }

  const numPages = parser.doc?.numPages ?? 0;

  return {
    text,
    numPages,
    fileName: path.basename(absolutePath),
    filePath: absolutePath,
    extractedAt: new Date().toISOString(),
    warnings,
  };
}

export function parseGATEFileName(fileName: string): {
  year: number;
  paper: string | null;
  shift: string | null;
} | null {
  const baseName = path.parse(fileName).name;
  const patterns = [
    /^(\d{4})_CS(\d?)$/,        // 2023_CS or 2017_CS1
    /^(\d{4})_CS(\d?)_(\w+)$/,  // 2024_CS1_Set1 (if any)
  ];

  for (const pattern of patterns) {
    const match = baseName.match(pattern);
    if (match) {
      const year = parseInt(match[1], 10);
      const paper = match[2] ? match[2] : null;
      const shift = match[3] ? match[3] : null;
      return { year, paper, shift };
    }
  }

  return null;
}

export function resolveRawPDFPath(fileName: string): string {
  return path.join(PROJECT_ROOT, 'apps', 'backend', 'data', 'raw', 'CS', fileName);
}

export function listRawPDFFiles(): string[] {
  const rawDir = path.join(PROJECT_ROOT, 'apps', 'backend', 'data', 'raw', 'CS');
  if (!fs.existsSync(rawDir)) {
    return [];
  }
  return fs.readdirSync(rawDir)
    .filter(f => f.toLowerCase().endsWith('.pdf'))
    .sort();
}