import { extractPDFText, parseGATEFileName, resolveRawPDFPath, listRawPDFFiles } from './pdf-extractor.js';
import {
  detectQuestionBoundaries,
  parseQuestion,
} from './question-parser.js';
import { validateQuestions, getValidationSummary } from './validator.js';
import { checkAllDuplicates } from './duplicate-detector.js';
import { createStagingOutput, writeStagingFile, writeHumanReport, generateHumanReport } from './staging.js';
import type { ParsedQuestion } from './question-parser.js';
import type { PDFExtractResult } from './pdf-extractor.js';
import type { MarksRange } from './question-parser.js';

export interface PipelineOptions {
  pilotOnly?: boolean;
  pilotFile?: string;
  outputStaging?: boolean;
  outputReport?: boolean;
  maxQuestions?: number;
}

export interface PipelineResult {
  extractResult: PDFExtractResult;
  questions: ParsedQuestion[];
  validationResults: Awaited<ReturnType<typeof validateQuestions>>;
  validationSummary: ReturnType<typeof getValidationSummary>;
  duplicates: Map<string, number[]>;
  stagingFilePath?: string;
  reportFilePath?: string;
  report?: string;
}

function extractMarksRangesFromText(text: string): MarksRange[] {
  const ranges: MarksRange[] = [];
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Normalize all common dash variants in range directives before matching,
    // so en dash (–), em dash (—) and minus sign (−) all behave like an ASCII
    // hyphen and do not break / carry pattern matching.
    const dashNormalized = line.replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFF0D]/g, '-');
    const trimmed = dashNormalized.trim();
    if (!trimmed.toLowerCase().includes('carry')) continue;

    // Full range directive. Two real-world shapes must both match:
    //   "Q.1 – Q.5 Carry ONE mark each."                      (GA section)
    //   "Q.11 – Q.22 Multiple Choice Questions (MCQ), carry ONE mark each."
    // The lazy .*? bridges any section-type text between the range and "carry".
    // Digits are capped at 2 because PDF extraction can smear the range end
    // (e.g. "Q.46 – Q.555" for "Q.46 – Q.55" in the 2022 paper).
    let match = trimmed.match(/Q\.\s*(\d{1,2})\s*[–-]\s*Q\.\s*(\d{1,2}).*?carry\s+(one|two)\s+marks?(?:\s+each)?/i);
    if (match) {
      ranges.push({
        start: parseInt(match[1], 10),
        end: parseInt(match[2], 10),
        marks: match[3].toLowerCase() === 'one' ? 1 : 2,
      });
      continue;
    }

    match = trimmed.match(/[–-]\s*Q\.\s*(\d+)\s+Carry\s+(one|two)\s+marks?(?:\s+[Ee]ach)?/i);
    if (match) {
      ranges.push({
        start: 1,
        end: parseInt(match[1], 10),
        marks: match[2].toLowerCase() === 'one' ? 1 : 2,
      });
      continue;
    }
  }

  return ranges;
}

export async function runIngestionPipeline(
  fileName: string,
  options: PipelineOptions = {}
): Promise<PipelineResult> {
  const { outputStaging = true, outputReport = true } = options;

  const filePath = resolveRawPDFPath(fileName);
  const parsedFileName = parseGATEFileName(fileName);

  const extractResult = await extractPDFText(filePath);

  const marksRanges = extractMarksRangesFromText(extractResult.text);

  const boundaries = detectQuestionBoundaries(extractResult.text);

  const questions: ParsedQuestion[] = [];
  for (const boundary of boundaries) {
    const question = parseQuestion(
      boundary,
      fileName,
      parsedFileName?.year ?? null,
      parsedFileName?.paper ?? null,
      parsedFileName?.shift ?? null,
      marksRanges
    );
    questions.push(question);
  }

  const duplicates = checkAllDuplicates(questions);
  for (const [, indices] of duplicates) {
    for (const idx of indices.slice(1)) {
      questions[idx].warnings.push(`DUPLICATE: Same source identity as question at index ${indices[0]}`);
    }
  }

  const validationResults = validateQuestions(questions);
  const validationSummary = getValidationSummary(validationResults);

  let stagingFilePath: string | undefined;
  let reportFilePath: string | undefined;
  let report: string | undefined;

  if (outputStaging) {
    const stagingOutput = createStagingOutput(
      questions,
      fileName,
      parsedFileName?.year ?? 0,
      parsedFileName?.paper ?? null,
      parsedFileName?.shift ?? null
    );
    stagingFilePath = writeStagingFile(stagingOutput);
  }

  if (outputReport) {
    const stagingOutput = createStagingOutput(
      questions,
      fileName,
      parsedFileName?.year ?? 0,
      parsedFileName?.paper ?? null,
      parsedFileName?.shift ?? null
    );
    reportFilePath = writeHumanReport(stagingOutput);
    report = generateHumanReport(stagingOutput);
  }

  return {
    extractResult,
    questions,
    validationResults,
    validationSummary,
    duplicates,
    stagingFilePath,
    reportFilePath,
    report,
  };
}

export async function runPilotPipeline(): Promise<PipelineResult> {
  const files = listRawPDFFiles();
  const pilotFile = files.find(f => f.startsWith('2023_')) ?? files[0];

  console.log(`Running pilot on: ${pilotFile}`);
  return runIngestionPipeline(pilotFile);
}

export function printPipelineSummary(result: PipelineResult): void {
  console.log('\n========== PIPELINE SUMMARY ==========');
  console.log(`File: ${result.extractResult.fileName}`);
  console.log(`Pages: ${result.extractResult.numPages}`);
  console.log(`Text Length: ${result.extractResult.text.length} chars`);
  console.log(`Questions Detected: ${result.questions.length}`);
  console.log(`Valid: ${result.validationSummary.valid}`);
  console.log(`Warnings: ${result.validationSummary.warning}`);
  console.log(`Invalid: ${result.validationSummary.invalid}`);
  console.log(`Total Issues: ${result.validationSummary.totalIssues}`);
  console.log(`Duplicates Found: ${result.duplicates.size}`);

  if (result.stagingFilePath) {
    console.log(`Staging File: ${result.stagingFilePath}`);
  }
  if (result.reportFilePath) {
    console.log(`Report File: ${result.reportFilePath}`);
  }

  if (result.extractResult.warnings.length > 0) {
    console.log('\nExtraction Warnings:');
    for (const w of result.extractResult.warnings) {
      console.log(`  - ${w}`);
    }
  }

  console.log('\n========== END SUMMARY ==========\n');
}