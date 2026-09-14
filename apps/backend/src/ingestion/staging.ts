import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ParsedQuestion } from './question-parser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const STAGING_DIR = path.join(PROJECT_ROOT, 'apps', 'backend', 'data', 'staging');

export interface StagedQuestion {
  question_number: number | null;
  type: string;
  body: string;
  options: Array<{ label: string; body: string; is_correct: boolean | null }>;
  answer: { type: string; value: unknown; raw_text: string } | null;
  marks: number | null;
  negative_marks: number | null;
  warnings: string[];
}

export interface StagedSource {
  file: string;
  exam_year: number;
  paper_number: string | null;
  shift: string | null;
}

export interface StagingOutput {
  source: StagedSource;
  questions: StagedQuestion[];
  generated_at: string;
  parser_version: string;
}

export function ensureStagingDir(): void {
  if (!fs.existsSync(STAGING_DIR)) {
    fs.mkdirSync(STAGING_DIR, { recursive: true });
  }
}

export function toStagedQuestion(q: ParsedQuestion): StagedQuestion {
  return {
    question_number: q.questionNumber,
    type: q.type,
    body: q.body,
    options: q.options.map(o => ({
      label: o.label,
      body: o.body,
      is_correct: o.isCorrect,
    })),
    answer: q.answer ? {
      type: q.answer.type,
      value: q.answer.value,
      raw_text: q.answer.rawText,
    } : null,
    marks: q.marks,
    negative_marks: q.negativeMarks,
    warnings: q.warnings,
  };
}

export function createStagingOutput(
  questions: ParsedQuestion[],
  sourceFile: string,
  examYear: number,
  paperNumber: string | null,
  shift: string | null
): StagingOutput {
  const source: StagedSource = {
    file: sourceFile,
    exam_year: examYear,
    paper_number: paperNumber,
    shift,
  };

  return {
    source,
    questions: questions.map(toStagedQuestion),
    generated_at: new Date().toISOString(),
    parser_version: '1.0.0',
  };
}

export function writeStagingFile(output: StagingOutput): string {
  ensureStagingDir();
  const fileName = `staged_${output.source.file.replace('.pdf', '')}_${Date.now()}.json`;
  const filePath = path.join(STAGING_DIR, fileName);
  fs.writeFileSync(filePath, JSON.stringify(output, null, 2), 'utf-8');
  return filePath;
}

export function readStagingFile(fileName: string): StagingOutput | null {
  const filePath = path.join(STAGING_DIR, fileName);
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content);
}

export function listStagingFiles(): string[] {
  if (!fs.existsSync(STAGING_DIR)) return [];
  return fs.readdirSync(STAGING_DIR)
    .filter(f => f.startsWith('staged_') && f.endsWith('.json'))
    .sort();
}

export function generateHumanReport(output: StagingOutput): string {
  const lines: string[] = [];
  lines.push('# PDF Ingestion Pilot Report');
  lines.push('');
  lines.push(`**Source File:** ${output.source.file}`);
  lines.push(`**Exam Year:** ${output.source.exam_year}`);
  lines.push(`**Paper:** ${output.source.paper_number ?? 'N/A'}`);
  lines.push(`**Shift:** ${output.source.shift ?? 'N/A'}`);
  lines.push(`**Generated:** ${output.generated_at}`);
  lines.push(`**Parser Version:** ${output.parser_version}`);
  lines.push('');
  lines.push('## Question Summary');
  lines.push('');
  lines.push('| # | Type | Preview | Options | Answer | Marks | Warnings |');
  lines.push('|---|------|---------|---------|--------|-------|----------|');

  for (const q of output.questions) {
    const preview = q.body.length > 80 ? q.body.substring(0, 80) + '...' : q.body;
    const optionCount = q.options.length;
    const answerStatus = q.answer
      ? (q.answer.type === 'option' ? `Opt ${q.answer.value}`
        : q.answer.type === 'options' ? `Opts ${(q.answer.value as string[]).join(',')}`
        : q.answer.type === 'numeric' ? `Num ${q.answer.value}`
        : q.answer.type)
      : 'None';
    const marks = q.marks !== null ? `${q.marks}${q.negative_marks !== null ? ` (neg: ${q.negative_marks})` : ''}` : 'Unknown';
    const warnings = q.warnings.length > 0 ? q.warnings.join('; ') : 'None';

    lines.push(`| ${q.question_number ?? '?'} | ${q.type} | ${preview.replace(/\|/g, '\\|')} | ${optionCount} | ${answerStatus} | ${marks} | ${warnings.replace(/\|/g, '\\|')} |`);
  }

  lines.push('');
  const typeCounts = output.questions.reduce((acc, q) => {
    acc[q.type] = (acc[q.type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  lines.push('## Type Distribution');
  lines.push('');
  for (const [type, count] of Object.entries(typeCounts)) {
    lines.push(`- **${type.toUpperCase()}**: ${count}`);
  }

  lines.push('');
  lines.push('## Warnings Summary');
  const allWarnings = output.questions.flatMap(q => q.warnings);
  if (allWarnings.length === 0) {
    lines.push('No warnings.');
  } else {
    const warningCounts = allWarnings.reduce((acc, w) => {
      acc[w] = (acc[w] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    for (const [warning, count] of Object.entries(warningCounts)) {
      lines.push(`- ${warning} (${count} occurrences)`);
    }
  }

  return lines.join('\n');
}

export function writeHumanReport(output: StagingOutput): string {
  ensureStagingDir();
  const fileName = `report_${output.source.file.replace('.pdf', '')}_${Date.now()}.md`;
  const filePath = path.join(STAGING_DIR, fileName);
  const report = generateHumanReport(output);
  fs.writeFileSync(filePath, report, 'utf-8');
  return filePath;
}