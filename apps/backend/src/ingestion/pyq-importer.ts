// PHASE 12F.2-T1 — PYQ staging → database importer.
//
// Implements the Phase 12F.2-Q staging→DB contract on top of the Phase 12F.2-S
// keyless-draft policy. This module is NOT wired to any HTTP route: the ingestion
// layer is imported only by `apps/backend/scripts/*`, so the keyless policy stays
// unreachable from the public API.
//
// Design invariants:
//   * Pre-flight is exhaustive BEFORE the first write. The artifact is classified
//     (IMPORTABLE / SKIP) and the configured Subject + User + question types are
//     resolved read-only. Config resolution NEVER creates reference data.
//   * Writes are per-question atomic (QuestionSource + Question + options /
//     numeric answers in ONE prisma.$transaction, via createQuestionWithSource).
//     There is deliberately no paper-wide transaction.
//   * Idempotent: the deterministic source name is the DB-enforced dedupe anchor
//     because Postgres treats NULLs as distinct in uq_question_sources_identity,
//     so the identity tuple alone cannot dedupe papers with null paper/shift.
//   * Nothing is fabricated. Staged marks / negative_marks / options / answers are
//     mapped verbatim; null stays null; no answer key is invented; nothing is
//     published and no QuestionVersion snapshot is written.

import { readStagingFile, type StagingOutput, type StagedQuestion } from './staging.js';
import { validateQuestionInput } from '../core/services/content.service.js';
import {
  findQuestionTypeByCode,
  findSubjectById,
  listActiveSubjects,
} from '../core/repositories/taxonomy.repo.js';
import { findUserByEmail, findUserById } from '../core/repositories/users.repo.js';
import {
  createQuestion,
  createQuestionWithSource,
  findQuestionBySourceId,
  findQuestionBySourceIdentity,
  findQuestionSourceByName,
  getQuestionWithSourceSnapshot,
  recordPyqImportAudit,
  type OptionWrite,
  type QuestionWriteInput,
} from '../core/repositories/questions.repo.js';

// ─── Bounded database retry (Phase 12F.2-T3) ─────────────────────────────────

/**
 * Transient connection failures worth retrying (Neon auto-suspend / pooled
 * endpoint cold starts). Matched case-insensitively against the error message;
 * anything else — validation, business-rule (P2002 unique), configuration — is
 * surfaced immediately and never retried.
 */
const TRANSIENT_DB_ERROR_PATTERNS = [
  "can't reach database server",
  "timed out",
  "timeout",
  "closed the connection",
  "connection terminated",
  "connection refused",
] as const;

export function isTransientDbError(error: unknown): boolean {
  const message = String(error instanceof Error ? error.message : error).toLowerCase();
  return TRANSIENT_DB_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
}

export interface PyqRetryOptions {
  /** Maximum executions of the operation (default 4 — 1 try + 3 retries). */
  maxAttempts?: number;
  /** Base backoff in ms; attempt N waits backoffMs * 2^(N-1) (default 250). */
  backoffMs?: number;
  /** Optional observation hook (used by tests; never throws). */
  onRetry?: (attempt: number, error: unknown) => void;
}

/**
 * Run one database operation under a bounded retry: transient connection
 * failures are retried with exponential backoff up to maxAttempts; every other
 * error — and the original error once attempts are exhausted — is rethrown
 * untouched. Never used to wrap a whole paper: callers apply it per operation.
 */
export async function withDbRetry<T>(operation: () => Promise<T>, options: PyqRetryOptions = {}): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 4);
  const backoffMs = options.backoffMs ?? 250;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !isTransientDbError(error)) throw error;
      options.onRetry?.(attempt, error);
      await new Promise((resolve) => setTimeout(resolve, backoffMs * 2 ** (attempt - 1)));
    }
  }
  throw lastError;
}

// ─── Public types ────────────────────────────────────────────────────────────

export const PYQ_IMPORTABLE_TYPES = ['mcq', 'msq', 'nat'] as const;
export type PyqType = (typeof PYQ_IMPORTABLE_TYPES)[number];

export const PYQ_DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export type PyqDifficulty = (typeof PYQ_DIFFICULTIES)[number];

/** Error codes thrown for pre-flight/config failures (no writes performed). */
export const PYQ_IMPORT_ERRORS = {
  STAGING_FILE_NOT_FOUND: 'PYQ_IMPORT_STAGING_FILE_NOT_FOUND',
  CONFIG_INVALID: 'PYQ_IMPORT_CONFIG_INVALID',
  SUBJECT_UNRESOLVED: 'PYQ_IMPORT_SUBJECT_UNRESOLVED',
  USER_UNRESOLVED: 'PYQ_IMPORT_USER_UNRESOLVED',
  TYPE_UNRESOLVED: 'PYQ_IMPORT_TYPE_UNRESOLVED',
  EXAM_YEAR_INVALID: 'PYQ_IMPORT_EXAM_YEAR_INVALID',
} as const;

export interface PyqImportConfig {
  /** Existing Subject id (preferred). Exactly one of subjectId/subjectCode. */
  subjectId?: string;
  /** Existing Subject code, resolved among active subjects. */
  subjectCode?: string;
  /** Existing User id (preferred). Exactly one of createdById/createdByEmail. */
  createdById?: string;
  /** Existing User email. */
  createdByEmail?: string;
  /** Defaults to "medium" — a presentation field, not source data. */
  difficulty?: PyqDifficulty;
}

export interface PyqImportContext {
  subjectId: string;
  subjectCode: string;
  createdById: string;
  createdByEmail: string;
  difficulty: PyqDifficulty;
  /** Resolved for every importable type present in the artifact. */
  typeIds: Record<string, string>;
}

export interface PyqImportSkip {
  questionNumber: number | null;
  reason: string;
  detail: string;
}

export interface PyqImportedQuestion {
  questionNumber: number;
  sourceName: string;
  sourceId: string;
  questionId: string;
  /** Staged question type — drives post-import verification expectations. */
  type: PyqType;
  /** Staged option count for MCQ/MSQ (0 for NAT). */
  expectedOptionCount: number;
  /** Staged numeric-answer count for NAT (always 0 for MCQ/MSQ). */
  expectedNumericAnswerCount: number;
}

export interface PyqExistingQuestion {
  questionNumber: number;
  sourceName: string;
  sourceId: string;
  questionId: string | null;
}

export interface PyqNumbering {
  /** Every positive-integer question number seen in staging, in artifact order. */
  staged: number[];
  /** Numbers missing inside [min..max] of the staged numbers. */
  missing: number[];
  /** Numbers staged more than once. */
  duplicates: number[];
}

export interface PyqImportResult {
  /** Staging artifact file name when read from disk, else null. */
  artifactFile: string | null;
  examYear: number;
  paperNumber: string | null;
  shift: string | null;
  numbering: PyqNumbering;
  totalStaged: number;
  importable: number;
  imported: number;
  alreadyExisting: number;
  skipped: number;
  failed: number;
  importedQuestions: PyqImportedQuestion[];
  existingQuestions: PyqExistingQuestion[];
  skippedQuestions: PyqImportSkip[];
  failedQuestions: PyqImportSkip[];
  /** Attached by verifyPyqImport after the import loop (12F.2-T3); null only in fabricated/partial results. */
  verification: PyqVerificationBlock | null;
}

interface PlannedQuestion {
  questionNumber: number;
  type: PyqType;
  sourceName: string;
  /** Staged option count for MCQ/MSQ; 0 for NAT. */
  expectedOptionCount: number;
  /** Staged numeric-answer count for NAT; 0 for MCQ/MSQ. */
  expectedNumericAnswerCount: number;
  write: QuestionWriteInput;
}

interface PlannedSkip {
  questionNumber: number | null;
  reason: string;
  detail: string;
}

export interface PyqImportPlan {
  numbering: PyqNumbering;
  importable: PlannedQuestion[];
  skipped: PlannedSkip[];
}

// ─── Deterministic identity ──────────────────────────────────────────────────

/**
 * Deterministic QuestionSource name: "GATE CS <examYear> Q<questionNumber>".
 * This is the only DB-enforced dedupe anchor for papers whose paperNumber/shift
 * are null, so it must stay stable across runs.
 */
export function buildPyqSourceName(examYear: number, questionNumber: number): string {
  return `GATE CS ${examYear} Q${questionNumber}`;
}

/** Load an explicitly named staging artifact with the existing staging reader. */
export function loadPyqStagingArtifact(fileName: string): StagingOutput {
  const artifact = readStagingFile(fileName);
  if (!artifact) {
    throw new Error(`${PYQ_IMPORT_ERRORS.STAGING_FILE_NOT_FOUND}: staging artifact "${fileName}" was not found.`);
  }
  return artifact;
}

// ── Pre-flight planning (pure: no database access, no writes) ──────────────

function asPositiveInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) return null;
  return value;
}

/** Mirrors the validator's gate_year window (content.service keeps it private). */
function maxImportableYear(): number {
  return new Date().getUTCFullYear() + 1;
}

function computeNumbering(questions: StagedQuestion[]): PyqNumbering {
  const staged: number[] = [];
  const duplicates: number[] = [];
  const seen = new Set<number>();
  for (const question of questions) {
    const number = asPositiveInteger(question?.question_number);
    if (number === null) continue;
    if (seen.has(number)) {
      if (!duplicates.includes(number)) duplicates.push(number);
      continue;
    }
    seen.add(number);
    staged.push(number);
  }
  const missing: number[] = [];
  if (staged.length > 0) {
    const min = Math.min(...staged);
    const max = Math.max(...staged);
    for (let n = min; n <= max; n += 1) {
      if (!seen.has(n)) missing.push(n);
    }
  }
  return { staged, missing, duplicates };
}

/** Option labels named by an explicitly staged answer ("option" / "options"). */
function optionLabelsFromAnswer(answer: StagedQuestion["answer"]): string[] {
  if (!answer) return [];
  const normalise = (value: unknown): string[] =>
    typeof value === "string" && value.trim().length > 0 ? [value.trim().toUpperCase()] : [];
  if (answer.type === "option") return normalise(answer.value);
  if (answer.type === "options" && Array.isArray(answer.value)) {
    return answer.value.flatMap((value) => normalise(value));
  }
  return [];
}

/**
 * Correct flags come from exactly two explicit staging sources — never invented:
 *   1. per-option `is_correct === true`;
 *   2. an "option"/"options" answer whose value matches an option label.
 * When neither is present every option is `false` (keyless draft).
 */
function mapOptions(question: StagedQuestion): OptionWrite[] {
  const source = Array.isArray(question.options) ? question.options : [];
  const explicit = source.map((option) => option?.is_correct === true);
  const labels = explicit.some(Boolean) ? [] : optionLabelsFromAnswer(question.answer);
  return source.map((option, index) => ({
    body: String(option?.body ?? ""),
    isCorrect:
      labels.length > 0 ? labels.includes(String(option?.label ?? "").trim().toUpperCase()) : explicit[index],
    sortOrder: index + 1,
  }));
}

/**
 * NAT keys are produced ONLY from an explicit numeric answer with a usable value.
 * A null / absent / non-finite staged value yields zero keys (keyless draft) —
 * `Number(null)` is 0, so the null guard is load-bearing: without it a blank
 * answer stub would silently become the numeric key 0.
 */
function mapNumericAnswers(question: StagedQuestion): Array<{ numericValue: number }> {
  const answer = question.answer;
  if (!answer || answer.type !== "numeric") return [];
  const value = answer.value;
  if (value === null || value === undefined || value === "") return [];
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return [];
  return [{ numericValue }];
}

function stagedNegativeMarks(question: StagedQuestion): number | null {
  const value = question.negative_marks;
  if (value === null || value === undefined) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}
function skipReason(error: unknown): string {
  const details = (error as { details?: Array<{ code?: unknown }> } | null)?.details;
  if (Array.isArray(details) && details.length > 0 && typeof details[0]?.code === "string") {
    return details[0].code;
  }
  return "INVALID_QUESTION";
}

function skipDetail(error: unknown): string {
  const details = (error as { details?: Array<{ message?: unknown }> } | null)?.details;
  if (Array.isArray(details) && details.length > 0 && typeof details[0]?.message === "string") {
    return details[0].message;
  }
  return error instanceof Error ? error.message : String(error);
}

export interface PyqPlanContext {
  subjectId: string;
  difficulty: PyqDifficulty;
}

/**
 * Classify every staged question as IMPORTABLE or SKIP, with all shape validation
 * delegated to the existing content contract under the approved keyless policy.
 * An MCQ/MSQ with fewer than two usable options is rejected by that contract and
 * therefore becomes a SKIP — no question-specific special-casing exists here.
 */
export async function planPyqImport(artifact: StagingOutput, context: PyqPlanContext): Promise<PyqImportPlan> {
  const examYear = Number(artifact?.source?.exam_year);
  const questions = Array.isArray(artifact?.questions) ? artifact.questions : [];
  const numbering = computeNumbering(questions);
  const importable: PlannedQuestion[] = [];
  const skipped: PlannedSkip[] = [];
  const claimed = new Set<number>();

  for (const question of questions) {
    const rawNumber = question?.question_number;
    const questionNumber = asPositiveInteger(rawNumber);
    if (questionNumber === null) {
      skipped.push({
        questionNumber: null,
        reason: "INVALID_QUESTION_NUMBER",
        detail: `Staged question_number ${JSON.stringify(rawNumber)} is not a positive integer.`,
      });
      continue;
    }
    if (claimed.has(questionNumber)) {
      skipped.push({
        questionNumber,
        reason: "DUPLICATE_QUESTION_NUMBER",
        detail: `Question number ${questionNumber} was already staged earlier in this artifact.`,
      });
      continue;
    }

    const type = String(question?.type ?? "").toLowerCase();
    if (!(PYQ_IMPORTABLE_TYPES as readonly string[]).includes(type)) {
      skipped.push({
        questionNumber,
        reason: "UNSUPPORTED_QUESTION_TYPE",
        detail: `Staged type ${JSON.stringify(question?.type)} is not one of ${PYQ_IMPORTABLE_TYPES.join(", ")}.`,
      });
      claimed.add(questionNumber);
      continue;
    }

    const marks = question?.marks;
    if (typeof marks !== "number" || !Number.isFinite(marks) || marks <= 0) {
      skipped.push({
        questionNumber,
        reason: "INVALID_MARKS",
        detail: `Staged marks ${JSON.stringify(marks)} must be a positive number; no default is applied.`,
      });
      claimed.add(questionNumber);
      continue;
    }

    claimed.add(questionNumber);

    const payload: Record<string, unknown> = {
      type_code: type,
      subject_id: context.subjectId,
      body: String(question?.body ?? ""),
      marks,
      gate_year: examYear,
      question_number: questionNumber,
      difficulty: context.difficulty,
      // negative_marks is deliberately omitted when staged null: the validator maps
      // a present null to 0, and a "no penalty" policy must never be invented.
    };
    const negativeMarks = stagedNegativeMarks(question);
    if (negativeMarks !== null) payload["negative_marks"] = negativeMarks;

    const options = mapOptions(question);
    if (options.length > 0) {
      payload["options"] = options.map((option) => ({
        body: option.body,
        is_correct: option.isCorrect,
        sort_order: option.sortOrder,
      }));
    }
    const numericAnswers = mapNumericAnswers(question);
    if (numericAnswers.length > 0) {
      payload["numeric_answers"] = numericAnswers.map((answer) => ({ numeric_value: answer.numericValue }));
    }

    try {
      const write = await validateQuestionInput(payload, "create", { allowKeylessDraft: true });
      importable.push({
        questionNumber,
        type: type as PyqType,
        sourceName: buildPyqSourceName(examYear, questionNumber),
        expectedOptionCount: options.length,
        expectedNumericAnswerCount: numericAnswers.length,
        // The staged value stays authoritative for null-preservation.
        write: { ...write, negativeMarks },
      });
    } catch (error) {
      skipped.push({ questionNumber, reason: skipReason(error), detail: skipDetail(error) });
    }
  }

  return { numbering, importable, skipped };
}

// ── Post-import verification (Phase 12F.2-T3) ───────────────────────────────

export interface PyqVerificationIssue {
  questionNumber: number | null;
  /** Machine-readable check name, e.g. "source_missing", "count_invariant". */
  check: string;
  detail: string;
}

export interface PyqVerificationBlock {
  success: boolean;
  checkedImported: number;
  issues: PyqVerificationIssue[];
  countInvariant: {
    expectedImportable: number;
    importedPlusExisting: number;
    ok: boolean;
  };
}

/**
 * Read-only post-import verification, run after the import loop. For every newly
 * imported question it re-reads the persisted rows and confirms the QuestionSource
 * exists, the Question exists and is linked, questionNumber and gateYear/examYear
 * agree, and option/numeric-answer counts match the staged expectations. It also
 * enforces the paper-level invariant `imported + alreadyExisting === planned
 * importable count`. Verification NEVER deletes or rolls back completed
 * per-question transactions — a failed verification is reported, not undone.
 */
export async function verifyPyqImport(
  result: PyqImportResult,
  options: { expectedImportableCount: number },
): Promise<PyqVerificationBlock> {
  const issues: PyqVerificationIssue[] = [];

  for (const imported of result.importedQuestions) {
    const snapshot = await withDbRetry(() => getQuestionWithSourceSnapshot(imported.sourceId));
    if (!snapshot.source) {
      issues.push({
        questionNumber: imported.questionNumber,
        check: "source_missing",
        detail: `QuestionSource ${imported.sourceId} (${imported.sourceName}) was not found after import.`,
      });
      continue;
    }
    if (!snapshot.question) {
      issues.push({
        questionNumber: imported.questionNumber,
        check: "question_missing",
        detail: `No Question is linked to QuestionSource ${imported.sourceId} (${imported.sourceName}).`,
      });
      continue;
    }
    if (snapshot.question.sourceId !== imported.sourceId) {
      issues.push({
        questionNumber: imported.questionNumber,
        check: "source_question_relationship",
        detail: `Question ${snapshot.question.id} does not reference QuestionSource ${imported.sourceId}.`,
      });
    }
    if (snapshot.source.questionNumber !== imported.questionNumber) {
      issues.push({
        questionNumber: imported.questionNumber,
        check: "question_number_mismatch",
        detail: `Source carries questionNumber ${snapshot.source.questionNumber}, expected ${imported.questionNumber}.`,
      });
    }
    if (snapshot.question.gateYear !== snapshot.source.examYear) {
      issues.push({
        questionNumber: imported.questionNumber,
        check: "gate_year_mismatch",
        detail: `Question gateYear ${snapshot.question.gateYear} does not match source examYear ${snapshot.source.examYear}.`,
      });
    }
    if (imported.type === "mcq" || imported.type === "msq") {
      if (snapshot.question._count.options !== imported.expectedOptionCount) {
        issues.push({
          questionNumber: imported.questionNumber,
          check: "option_count_mismatch",
          detail: `Expected ${imported.expectedOptionCount} staged options, found ${snapshot.question._count.options} persisted.`,
        });
      }
    }
    if (imported.type === "nat") {
      if (snapshot.question._count.options !== 0) {
        issues.push({
          questionNumber: imported.questionNumber,
          check: "nat_option_count_mismatch",
          detail: `NAT questions must have zero options, found ${snapshot.question._count.options}.`,
        });
      }
      if (snapshot.question._count.numericAnswers !== imported.expectedNumericAnswerCount) {
        issues.push({
          questionNumber: imported.questionNumber,
          check: "numeric_answer_count_mismatch",
          detail: `Expected ${imported.expectedNumericAnswerCount} numeric answers, found ${snapshot.question._count.numericAnswers} persisted.`,
        });
      }
    }
  }

  const importedPlusExisting = result.imported + result.alreadyExisting;
  const countOk = importedPlusExisting === options.expectedImportableCount;
  if (!countOk) {
    issues.push({
      questionNumber: null,
      check: "count_invariant",
      detail: `imported (${result.imported}) + alreadyExisting (${result.alreadyExisting}) must equal the planned importable count (${options.expectedImportableCount}).`,
    });
  }

  return {
    success: issues.length === 0,
    checkedImported: result.importedQuestions.length,
    issues,
    countInvariant: {
      expectedImportable: options.expectedImportableCount,
      importedPlusExisting,
      ok: countOk,
    },
  };
}
// ── Configuration resolution (read-only; never creates reference data) ─────

function configError(code: string, message: string): Error {
  return new Error(`${code}: ${message}`);
}

function normaliseDifficulty(value: PyqDifficulty | undefined): PyqDifficulty {
  const difficulty = value ?? "medium";
  if (!(PYQ_DIFFICULTIES as readonly string[]).includes(difficulty)) {
    throw configError(PYQ_IMPORT_ERRORS.CONFIG_INVALID, `difficulty must be one of ${PYQ_DIFFICULTIES.join(", ")}.`);
  }
  return difficulty;
}

/**
 * Resolve the configured Subject. An existing row is required — one is NEVER
 * created here, and the caller must supply exactly one of subjectId/subjectCode.
 */
async function resolveSubject(config: PyqImportConfig): Promise<{ id: string; code: string }> {
  const byId = config.subjectId?.trim();
  const byCode = config.subjectCode?.trim();
  if (byId && byCode) {
    throw configError(PYQ_IMPORT_ERRORS.CONFIG_INVALID, "Provide either subjectId or subjectCode, not both.");
  }
  if (!byId && !byCode) {
    throw configError(PYQ_IMPORT_ERRORS.CONFIG_INVALID, "A configured Subject is required (subjectId or subjectCode).");
  }
  if (byId) {
    const subject = await findSubjectById(byId);
    if (!subject) {
      throw configError(PYQ_IMPORT_ERRORS.SUBJECT_UNRESOLVED, `No active Subject with id "${byId}" exists.`);
    }
    return { id: subject.id, code: subject.code };
  }
  const subjects = await listActiveSubjects();
  const subject = subjects.find((candidate) => candidate.code === byCode);
  if (!subject) {
    const available = subjects.map((candidate) => candidate.code).join(", ") || "(none)";
    throw configError(
      PYQ_IMPORT_ERRORS.SUBJECT_UNRESOLVED,
      `No active Subject with code "${byCode}" exists. Available codes: ${available}.`,
    );
  }
  return { id: subject.id, code: subject.code };
}

/** Resolve the configured author. An existing, active User is required. */
async function resolveAuthor(config: PyqImportConfig): Promise<{ id: string; email: string }> {
  const byId = config.createdById?.trim();
  const byEmail = config.createdByEmail?.trim();
  if (byId && byEmail) {
    throw configError(PYQ_IMPORT_ERRORS.CONFIG_INVALID, "Provide either createdById or createdByEmail, not both.");
  }
  if (!byId && !byEmail) {
    throw configError(PYQ_IMPORT_ERRORS.CONFIG_INVALID, "A configured importer User is required (createdById or createdByEmail).");
  }
  const user = byId ? await findUserById(byId) : await findUserByEmail(byEmail as string);
  if (!user) {
    throw configError(PYQ_IMPORT_ERRORS.USER_UNRESOLVED, `No User matching ${byId ? `id "${byId}"` : `email "${byEmail}"`} exists.`);
  }
  if (user.status !== "active" || user.deletedAt !== null) {
    throw configError(PYQ_IMPORT_ERRORS.USER_UNRESOLVED, `User "${user.email}" is not active.`);
  }
  return { id: user.id, email: user.email };
}

/**
 * Resolve the QuestionType rows used by the artifact. Reference data is seeded by
 * migrations, so a missing type is a configuration error — never auto-created.
 */
async function resolveTypeIds(types: PyqType[]): Promise<Record<string, string>> {
  const typeIds: Record<string, string> = {};
  for (const type of types) {
    const row = await findQuestionTypeByCode(type);
    if (!row) {
      throw configError(PYQ_IMPORT_ERRORS.TYPE_UNRESOLVED, `QuestionType "${type}" does not exist; run migrations/seed first.`);
    }
    typeIds[type] = row.id;
  }
  return typeIds;
}

/** Read-only resolution of every piece of import configuration. */
export async function resolvePyqImportContext(
  config: PyqImportConfig,
  types: PyqType[] = [...PYQ_IMPORTABLE_TYPES],
): Promise<PyqImportContext> {
  const subject = await resolveSubject(config);
  const author = await resolveAuthor(config);
  const difficulty = normaliseDifficulty(config.difficulty);
  const typeIds = await resolveTypeIds(types);
  return {
    subjectId: subject.id,
    subjectCode: subject.code,
    createdById: author.id,
    createdByEmail: author.email,
    difficulty,
    typeIds,
  };
}
// ── Execution ──────────────────────────────────────────────────────────────

export interface PyqImportOptions extends PyqImportConfig {
  /** Explicit staging artifact file name (inside apps/backend/data/staging). */
  artifactFile?: string;
  /**
   * In-memory artifact. Used by callers (and tests) that already hold a staging
   * object; exactly one of artifactFile / artifact must be supplied.
   */
  artifact?: StagingOutput;
}

/**
 * Import one explicitly supplied staging artifact.
 *
 * Order of operations (no write happens before the entire artifact is planned and
 * all configuration is resolved):
 *   1. read the artifact (existing staging reader when a file name is given);
 *   2. validate exam year;
 *   3. resolve Subject / User / QuestionTypes read-only (never creating them);
 *   4. classify every staged question (IMPORTABLE / SKIP);
 *   5. import question-by-question, idempotently and atomically.
 */
export async function importPyqStagingArtifact(options: PyqImportOptions): Promise<PyqImportResult> {
  const artifact = options.artifact ?? (options.artifactFile ? loadPyqStagingArtifact(options.artifactFile) : null);
  if (!artifact) {
    throw configError(PYQ_IMPORT_ERRORS.CONFIG_INVALID, "Provide an artifactFile or an in-memory artifact.");
  }
  const artifactFile = options.artifactFile ?? artifact.source?.file ?? null;
  const examYear = Number(artifact.source?.exam_year);
  if (!Number.isInteger(examYear) || examYear < 1990 || examYear > maxImportableYear()) {
    throw configError(
      PYQ_IMPORT_ERRORS.EXAM_YEAR_INVALID,
      `Staging exam_year ${JSON.stringify(artifact.source?.exam_year)} is outside the importable range 1990..${maxImportableYear()}.`,
    );
  }
  // Staged paper/shift are carried verbatim — null stays null, never invented.
  const paperNumber = artifact.source?.paper_number ?? null;
  const shift = artifact.source?.shift ?? null;

  const stagedTypes = Array.from(
    new Set(
      (artifact.questions ?? [])
        .map((question) => String(question?.type ?? "").toLowerCase())
        .filter((type): type is PyqType => (PYQ_IMPORTABLE_TYPES as readonly string[]).includes(type)),
    ),
  );

  // Pre-flight context resolution is read-only but hits the database; a Neon
  // cold start here must not masquerade as a configuration error (12F.2-T3).
  const context = await withDbRetry(() => resolvePyqImportContext(options, stagedTypes));
  const plan = await planPyqImport(artifact, { subjectId: context.subjectId, difficulty: context.difficulty });

  const result: PyqImportResult = {
    artifactFile,
    examYear,
    paperNumber,
    shift,
    numbering: plan.numbering,
    totalStaged: Array.isArray(artifact.questions) ? artifact.questions.length : 0,
    importable: plan.importable.length,
    imported: 0,
    alreadyExisting: 0,
    skipped: plan.skipped.length,
    failed: 0,
    importedQuestions: [],
    existingQuestions: [],
    skippedQuestions: plan.skipped.map((skip) => ({ ...skip })),
    failedQuestions: [],
    verification: {
      success: false,
      checkedImported: 0,
      issues: [],
      countInvariant: { expectedImportable: plan.importable.length, importedPlusExisting: 0, ok: false },
    },
  };

  for (const planned of plan.importable) {
    try {
      // Idempotency anchors: deterministic name (DB-enforced unique) first, then
      // the source identity tuple (necessary because NULL paper/shift means the
      // composite unique index cannot dedupe these papers). Lookups are retried
      // on transient connection failures only (12F.2-T3).
      const existingSource = await withDbRetry(() => findQuestionSourceByName(planned.sourceName));
      const identityQuestion =
        existingSource === null
          ? await withDbRetry(() =>
              findQuestionBySourceIdentity(examYear, paperNumber, shift, planned.questionNumber),
            )
          : null;
      const sourceId = existingSource?.id ?? identityQuestion?.sourceId ?? null;

      if (sourceId !== null) {
        const linked = await withDbRetry(() => findQuestionBySourceId(sourceId));
        if (linked) {
          result.alreadyExisting += 1;
          result.existingQuestions.push({
            questionNumber: planned.questionNumber,
            sourceName: existingSource?.name ?? planned.sourceName,
            sourceId,
            questionId: linked.id,
          });
          continue;
        }
        // Partial prior run: the source exists but carries no question. Adopt that
        // row instead of creating a second QuestionSource (12F.2-Q §F.3).
        const adopted = await withDbRetry(() =>
          createQuestion(
            { ...planned.write, sourceId, questionNumber: planned.questionNumber },
            context.typeIds[planned.type],
            context.createdById,
          ),
        );
        // The adopt path builds the question outside createQuestionWithSource's
        // transaction, so its import-audit row is written separately (still
        // attributed to the configured importer actor).
        await withDbRetry(() =>
          recordPyqImportAudit({
            createdById: context.createdById,
            questionId: adopted.id,
            questionSourceId: sourceId,
            sourceName: existingSource?.name ?? planned.sourceName,
            examYear,
            questionNumber: planned.questionNumber,
          }),
        );
        result.imported += 1;
        result.importedQuestions.push({
          questionNumber: planned.questionNumber,
          sourceName: existingSource?.name ?? planned.sourceName,
          sourceId,
          questionId: adopted.id,
          type: planned.type,
          expectedOptionCount: planned.expectedOptionCount,
          expectedNumericAnswerCount: planned.expectedNumericAnswerCount,
        });
        continue;
      }

      const created = await withDbRetry(() =>
        createQuestionWithSource(
          { name: planned.sourceName, examYear, paperNumber, shift, questionNumber: planned.questionNumber },
          planned.write,
          context.typeIds[planned.type],
          context.createdById,
        ),
      );
      result.imported += 1;
      result.importedQuestions.push({
        questionNumber: planned.questionNumber,
        sourceName: planned.sourceName,
        sourceId: created.sourceId,
        questionId: created.questionId,
        type: planned.type,
        expectedOptionCount: planned.expectedOptionCount,
        expectedNumericAnswerCount: planned.expectedNumericAnswerCount,
      });
    } catch (error) {
      // A per-question failure never aborts the paper: the whole unit is skipped
      // and reported (its transaction rolled back by createQuestionWithSource).
      result.failed += 1;
      result.failedQuestions.push({
        questionNumber: planned.questionNumber,
        reason: skipReason(error),
        detail: skipDetail(error),
      });
    }
  }

  // Post-import verification (12F.2-T3): read-only re-check of every newly
  // imported question plus the paper-level count invariant. A failed
  // verification is reported on the result — completed per-question
  // transactions are never rolled back here.
  result.verification = await verifyPyqImport(result, { expectedImportableCount: plan.importable.length });

  return result;
}
