// PHASE 8 — Admin content service: taxonomy CRUD, question lifecycle, import (Phase 4 §3.2.13)
import { Prisma } from "@prisma/client";
import { AppError, errors } from "../errors";
import * as questionsRepo from "../repositories/questions.repo";
import type { QuestionWriteInput, OptionWrite, NumericAnswerWrite } from "../repositories/questions.repo";
import {
  createSubject,
  updateSubject,
  deactivateSubject,
  findSubjectById,
  createTopic,
  updateTopic,
  deactivateTopic,
  findTopicById,
  ensureQuestionType,
} from "../repositories/taxonomy.repo";
import { writeAuditEntry } from "../repositories/analytics.repo";

const SUBJECT_CODE_RE = /^[a-z0-9_]{2,40}$/;

function mapUniqueViolation(
  error: unknown,
  _field: string,
  code: string,
  message: string,
): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return errors.conflict(code, message);
  }
  if (error instanceof AppError) return error;
  return error;
}


function currentYearPlusOne(): number {
  return new Date().getUTCFullYear() + 1;
}

// ─── Subjects (admin) ────────────────────────────────────────────────────────

export async function createSubjectValidated(actorId: string, body: { code: string; name: string; sort_order?: number }) {
  if (!SUBJECT_CODE_RE.test(body.code)) {
    throw errors.validation([
      { field: "code", code: "VALIDATION_INVALID_CODE", message: "Code must be 2-40 chars of a-z, 0-9 or underscore." },
    ]);
  }
  try {
    const subject = await createSubject({ code: body.code, name: body.name, sortOrder: body.sort_order });
    await writeAuditEntry({
      actorId,
      action: "subject.create",
      entityType: "subjects",
      entityId: subject.id,
      after: { code: subject.code, name: subject.name },
    });
    return subject;
  } catch (error) {
    throw mapUniqueViolation(error, "code", "CONFLICT_CODE_EXISTS", "A subject with this code already exists.");
  }
}

export async function updateSubjectValidated(
  actorId: string,
  id: string,
  patch: { name?: string; sort_order?: number; is_active?: boolean },
) {
  const existing = await findSubjectById(id);
  const anyExisting = existing ?? (await prismaSubjectExists(id));
  if (!anyExisting) throw errors.notFound("RESOURCE_NOT_FOUND", "Subject not found.");
  const updated = await updateSubject(id, {
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.sort_order !== undefined ? { sortOrder: patch.sort_order } : {}),
    ...(patch.is_active !== undefined ? { isActive: patch.is_active } : {}),
  });
  await writeAuditEntry({
    actorId,
    action: "subject.update",
    entityType: "subjects",
    entityId: id,
    after: { name: updated.name, isActive: updated.isActive },
  });
  return updated;
}

export async function deactivateSubjectValidated(actorId: string, id: string): Promise<void> {
  if (!(await prismaSubjectExists(id))) throw errors.notFound("RESOURCE_NOT_FOUND", "Subject not found.");
  await deactivateSubject(id);
  await writeAuditEntry({ actorId, action: "subject.deactivate", entityType: "subjects", entityId: id });
}

async function prismaSubjectExists(id: string): Promise<boolean> {
  const { prisma } = await import("../repositories/prisma");
  const found = await prisma.subject.findUnique({ where: { id }, select: { id: true } });
  return found !== null;
}

// ─── Topics (admin) ──────────────────────────────────────────────────────────

export async function createTopicValidated(
  actorId: string,
  body: { subject_id: string; name: string; chapter_id?: string | null; sort_order?: number },
) {
  const subject = await findSubjectById(body.subject_id);
  if (!subject) {
    throw errors.validation([
      { field: "subject_id", code: "VALIDATION_UNKNOWN_SUBJECT", message: "Subject does not exist or is inactive." },
    ]);
  }
  if (body.chapter_id) {
    const { prisma } = await import("../repositories/prisma");
    const chapter = await prisma.chapter.findUnique({ where: { id: body.chapter_id }, select: { id: true } });
    if (!chapter) {
      throw errors.validation([
        { field: "chapter_id", code: "VALIDATION_UNKNOWN_CHAPTER", message: "Chapter does not exist." },
      ]);
    }
  }
  const topic = await createTopic({
    subjectId: body.subject_id,
    name: body.name,
    ...(body.chapter_id !== undefined ? { chapterId: body.chapter_id } : {}),
    sortOrder: body.sort_order,
  });
  await writeAuditEntry({ actorId, action: "topic.create", entityType: "topics", entityId: topic.id, after: { name: topic.name } });
  return topic;
}

export async function updateTopicValidated(
  actorId: string,
  id: string,
  patch: { name?: string; sort_order?: number; is_active?: boolean; chapter_id?: string | null },
) {
  const topic = await findTopicById(id);
  if (!topic) throw errors.notFound("RESOURCE_NOT_FOUND", "Topic not found.");
  const updated = await updateTopic(id, {
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.sort_order !== undefined ? { sortOrder: patch.sort_order } : {}),
    ...(patch.is_active !== undefined ? { isActive: patch.is_active } : {}),
    ...(patch.chapter_id !== undefined ? { chapterId: patch.chapter_id } : {}),
  });
  await writeAuditEntry({ actorId, action: "topic.update", entityType: "topics", entityId: id, after: { name: updated.name } });
  return updated;
}

export async function deactivateTopicValidated(actorId: string, id: string): Promise<void> {
  const topic = await findTopicById(id);
  if (!topic) throw errors.notFound("RESOURCE_NOT_FOUND", "Topic not found.");
  await deactivateTopic(id);
  await writeAuditEntry({ actorId, action: "topic.deactivate", entityType: "topics", entityId: id });
}

// ─── Questions (mod/admin): create / edit / publish / reject / import ────────

export interface ValidationPolicy {
  /**
   * Internal-only (Phase 12F.2-S): PYQ keyless-draft import path.
   * Relaxes ONLY the answer-key shape rules (MCQ/MSQ correct count, NAT keys);
   * every other validation rule — including >=2 options with non-empty bodies —
   * is unchanged. Normal create/update paths keep the default (key required).
   */
  allowKeylessDraft?: boolean;
}

export async function validateQuestionInput(
  raw: Record<string, unknown>,
  mode: "create" | "edit",
  policy: ValidationPolicy = {},
): Promise<QuestionWriteInput> {
  const details: Array<{ field: string; code: string; message: string }> = [];

  const typeCode = typeof raw["type_code"] === "string" ? raw["type_code"] : undefined;
  if (mode === "create" && !typeCode) details.push({ field: "type_code", code: "VALIDATION_REQUIRED", message: '"type_code" is required.' });
  if (typeCode !== undefined && !["mcq", "msq", "nat"].includes(typeCode)) {
    details.push({ field: "type_code", code: "VALIDATION_INVALID_VALUE", message: '"type_code" must be mcq, msq or nat.' });
  }

  if (typeof raw["body"] === "string" && raw["body"].trim().length < 5) {
    details.push({ field: "body", code: "VALIDATION_TOO_SHORT", message: '"body" must be at least 5 characters.' });
  }
  if (raw["marks"] !== undefined) {
    const marks = Number(raw["marks"]);
    if (!Number.isFinite(marks) || marks < 0 || marks > 100) {
      details.push({ field: "marks", code: "VALIDATION_OUT_OF_RANGE", message: '"marks" must be between 0 and 100.' });
    }
  }
  if (raw["negative_marks"] !== undefined && raw["negative_marks"] !== null) {
    const negative = Number(raw["negative_marks"]);
    if (!Number.isFinite(negative) || negative < 0 || negative > 100) {
      details.push({ field: "negative_marks", code: "VALIDATION_OUT_OF_RANGE", message: '"negative_marks" must be between 0 and 100.' });
    }
  }
  if (raw["gate_year"] !== undefined) {
    const year = Number(raw["gate_year"]);
    if (!Number.isInteger(year) || year < 1990 || year > currentYearPlusOne()) {
      details.push({ field: "gate_year", code: "VALIDATION_OUT_OF_RANGE", message: `"gate_year" must be between 1990 and ${currentYearPlusOne()}.` });
    }
  }
  if (raw["question_number"] !== undefined && raw["question_number"] !== null) {
    const qn = Number(raw["question_number"]);
    if (!Number.isInteger(qn) || qn < 1) {
      details.push({ field: "question_number", code: "VALIDATION_INVALID_QUESTION_NUMBER", message: '"question_number" must be a positive integer.' });
    }
  }
  if (raw["difficulty"] !== undefined && !["easy", "medium", "hard"].includes(String(raw["difficulty"]))) {
    details.push({ field: "difficulty", code: "VALIDATION_INVALID_VALUE", message: '"difficulty" must be easy, medium or hard.' });
  }
  if (raw["explanation"] !== undefined && raw["explanation"] !== null && typeof raw["explanation"] !== "string") {
    details.push({ field: "explanation", code: "VALIDATION_INVALID_STRING", message: '"explanation" must be a string.' });
  }
  if (details.length > 0) throw errors.validation(details);

  // Type-specific answer shape (Phase 4 §6). Incoming JSON uses snake_case;
  // repository write models are camelCase — normalize here.
  const effectiveType = (typeCode ?? undefined) as "mcq" | "msq" | "nat" | undefined;

  let parsedOptions: OptionWrite[] | undefined;
  if (raw["options"] !== undefined) {
    if (!Array.isArray(raw["options"]) || raw["options"].length < 2) {
      throw errors.validation([
        { field: "options", code: "VALIDATION_INVALID_OPTIONS", message: "Provide at least 2 options." },
      ]);
    }
    parsedOptions = (raw["options"] as Array<Record<string, unknown>>).map((option, index) => ({
      body: String(option?.body ?? ""),
      isCorrect: option?.is_correct === true,
      sortOrder: typeof option?.sort_order === "number" ? option.sort_order : index + 1,
    }));
  }

  let parsedNumericAnswers: NumericAnswerWrite[] | undefined;
  if (raw["numeric_answers"] !== undefined) {
    if (!Array.isArray(raw["numeric_answers"]) || raw["numeric_answers"].length < 1) {
      throw errors.validation([
        { field: "numeric_answers", code: "VALIDATION_NAT_KEY_REQUIRED", message: "NAT requires at least one accepted numeric value." },
      ]);
    }
    parsedNumericAnswers = (raw["numeric_answers"] as Array<Record<string, unknown>>).map((key) => ({
      numericValue: Number(key?.numeric_value),
      toleranceAbs: key?.tolerance_abs === undefined || key?.tolerance_abs === null ? null : Number(key.tolerance_abs),
      toleranceRel: key?.tolerance_rel === undefined || key?.tolerance_rel === null ? null : Number(key.tolerance_rel),
      unit: typeof key?.unit === "string" ? key.unit : null,
      precision: typeof key?.precision === "number" ? key.precision : null,
    }));
  }

  if (effectiveType === "mcq" || effectiveType === "msq") {
    const options = parsedOptions;
    if (!Array.isArray(options) || options.length < 2 || options.some((option) => option.body.length < 1)) {
      throw errors.validation([
        { field: "options", code: "VALIDATION_INVALID_OPTIONS", message: "Provide at least 2 options with text bodies." },
      ]);
    }
    const correctCount = options.filter((option) => option.isCorrect === true).length;
    if (effectiveType === "mcq" && correctCount !== 1 && !policy.allowKeylessDraft) {
      throw errors.validation([
        { field: "options", code: "VALIDATION_MCQ_ONE_CORRECT", message: "MCQ requires exactly one correct option." },
      ]);
    }
    if (effectiveType === "msq" && correctCount < 1 && !policy.allowKeylessDraft) {
      throw errors.validation([
        { field: "options", code: "VALIDATION_MSQ_ONE_CORRECT", message: "MSQ requires at least one correct option." },
      ]);
    }
  } else if (effectiveType === "nat" && !policy.allowKeylessDraft) {
    const keys = parsedNumericAnswers;
    if (!Array.isArray(keys) || keys.length < 1) {
      throw errors.validation([
        { field: "numeric_answers", code: "VALIDATION_NAT_KEY_REQUIRED", message: "NAT requires at least one accepted numeric value." },
      ]);
    }
    for (const key of keys) {
      if (!Number.isFinite(key.numericValue)) {
        throw errors.validation([
          { field: "numeric_answers", code: "VALIDATION_NAT_VALUE", message: "Each NAT key needs a finite numeric_value." },
        ]);
      }
    }
  }

  return {
    typeCode: typeCode as string,
    subjectId: String(raw["subject_id"] ?? ""),
    topicId: raw["topic_id"] === undefined ? undefined : ((raw["topic_id"] as string) ?? null),
    body: String(raw["body"] ?? ""),
    explanation: (raw["explanation"] as string | undefined | null) ?? null,
    marks: raw["marks"] === undefined ? 1 : Number(raw["marks"]),
    negativeMarks: raw["negative_marks"] === undefined ? undefined : Number(raw["negative_marks"]),
    difficulty: String(raw["difficulty"] ?? "medium"),
    gateYear: Number(raw["gate_year"]),
    sourceId: (raw["source_id"] as string | undefined | null) ?? null,
    questionNumber: raw["question_number"] !== undefined && raw["question_number"] !== null ? Number(raw["question_number"]) : undefined,
    options: parsedOptions,
    numericAnswers: parsedNumericAnswers,
  };
}

async function assertActiveTaxonomy(subjectId: string, topicId?: string | null): Promise<void> {
  const subject = await findSubjectById(subjectId);
  if (!subject) {
    throw errors.validation([
      { field: "subject_id", code: "VALIDATION_UNKNOWN_SUBJECT", message: "Subject does not exist or is inactive." },
    ]);
  }
  if (topicId) {
    const topic = await findTopicById(topicId);
    if (!topic || !topic.isActive || topic.subjectId !== subjectId) {
      throw errors.validation([
        { field: "topic_id", code: "VALIDATION_UNKNOWN_TOPIC", message: "Topic does not exist for this subject." },
      ]);
    }
  }
}

export async function createQuestionValidated(actorId: string, rawBody: Record<string, unknown>) {
  const input = await validateQuestionInput(rawBody, "create");
  await assertActiveTaxonomy(input.subjectId, input.topicId);

  if (input.sourceId && input.questionNumber !== undefined) {
    const { prisma } = await import("../repositories/prisma");
    const source = await prisma.questionSource.findUnique({
      where: { id: input.sourceId },
      select: { paperNumber: true, shift: true },
    });
    const existing = await questionsRepo.findQuestionBySourceIdentity(
      input.gateYear,
      source?.paperNumber ?? null,
      source?.shift ?? null,
      input.questionNumber,
    );
    if (existing) {
      throw errors.conflict("CONFLICT_DUPLICATE_QUESTION", "A question with this GATE source identity already exists.");
    }
  }

  const type = await ensureQuestionType(input.typeCode);
  const created = await questionsRepo.createQuestion(input, type.id, actorId);
  await writeAuditEntry({ actorId, action: "question.create", entityType: "questions", entityId: created.id });
  return created;
}

export async function updateQuestionValidated(actorId: string, id: string, rawBody: Record<string, unknown>) {
  const { prisma } = await import("../repositories/prisma");
  const existing = await prisma.question.findUnique({ where: { id }, select: { id: true, status: true, subjectId: true } });
  if (!existing) throw errors.notFound("QUESTION_NOT_FOUND", "Question not found.");
  if (existing.status === "published" || existing.status === "archived") {
    throw errors.conflict("CONFLICT_STATE_INVALID", "Published/archived questions cannot be edited directly.");
  }
  const patch = await validateQuestionInput(rawBody, "edit");
  const subjectId = patch.subjectId || existing.subjectId;
  await assertActiveTaxonomy(subjectId, patch.topicId ?? undefined);
  const typeId = patch.typeCode ? (await ensureQuestionType(patch.typeCode)).id : undefined;
  await questionsRepo.updateQuestion(id, patch, typeId);
  await writeAuditEntry({ actorId, action: "question.update", entityType: "questions", entityId: id });
}

export async function publishQuestionValidated(actorId: string, id: string) {
  const question = await questionsRepo.findQuestionById(id);
  if (!question) throw errors.notFound("QUESTION_NOT_FOUND", "Question not found.");
  if (question.createdById === actorId) throw errors.authorCannotPublish(); // OD-07
  if (question.status !== "in_review" && question.status !== "draft") {
    throw errors.conflict("CONFLICT_STATE_INVALID", `Cannot publish from status "${question.status}".`);
  }

  // PHASE 12F.2-S — publish-time answer-key guard (Phase 12F.2-R §4.2). Keyless
  // PYQ drafts are now importable, but they must never reach students: practice
  // pools select only `published` questions, so unkeyed release is blocked here.
  // `findQuestionById` above already includes type code, option flags and keys.
  const typeCode = question.questionType.code;
  const correctCount = question.options.filter((option) => option.isCorrect).length;
  const finiteKeys = question.numericAnswers.filter((key) => Number.isFinite(Number(key.numericValue))).length;
  const unkeyed =
    (typeCode === "mcq" && correctCount !== 1) ||
    (typeCode === "msq" && correctCount < 1) ||
    (typeCode === "nat" && finiteKeys < 1);
  if (unkeyed) {
    throw errors.validation([
      {
        field: typeCode === "nat" ? "numeric_answers" : "options",
        code: "VALIDATION_KEY_REQUIRED_ON_PUBLISH",
        message:
          "Answer key required before publishing (MCQ: exactly one correct option, MSQ: at least one correct option, NAT: at least one finite numeric value).",
      },
    ]);
  }

  const result = await questionsRepo.publishQuestion(id, actorId, undefined);
  await writeAuditEntry({
    actorId,
    action: "question.publish",
    entityType: "questions",
    entityId: id,
    after: { version: result.newVersion, status: "published" },
  });
  return { id, version: result.newVersion, status: "published" };
}

export async function rejectQuestionValidated(actorId: string, id: string, reason: string) {
  const question = await questionsRepo.findQuestionById(id);
  if (!question) throw errors.notFound("QUESTION_NOT_FOUND", "Question not found.");
  if (question.createdById === actorId) throw errors.authorCannotPublish(); // OD-07
  if (question.status !== "in_review" && question.status !== "draft") {
    throw errors.conflict("CONFLICT_STATE_INVALID", `Cannot reject from status "${question.status}".`);
  }
  await questionsRepo.rejectQuestion(id, actorId);
  await writeAuditEntry({
    actorId,
    action: "question.reject",
    entityType: "questions",
    entityId: id,
    after: { status: "rejected", reason },
  });
  return { id, status: "rejected" };
}

export interface ImportReport {
  imported: number;
  failed: number;
  errors: Array<{ index: number; code: string; message: string }>;
}

/** Bulk import (Should scope, Phase 4 §4 partial-success contract): always 200 + report. */
export async function importQuestions(actorId: string, items: Array<Record<string, unknown>>): Promise<ImportReport> {
  const report: ImportReport = { imported: 0, failed: 0, errors: [] };
  const valid: Array<{ input: QuestionWriteInput; typeId: string }> = [];
  const { prisma } = await import("../repositories/prisma");
  for (let index = 0; index < items.length; index += 1) {
    try {
      const input = await validateQuestionInput(items[index], "create", { allowKeylessDraft: true });
      await assertActiveTaxonomy(input.subjectId, input.topicId);

      if (input.sourceId && input.questionNumber !== undefined) {
        const source = await prisma.questionSource.findUnique({
          where: { id: input.sourceId },
          select: { paperNumber: true, shift: true },
        });
        const existing = await questionsRepo.findQuestionBySourceIdentity(
          input.gateYear,
          source?.paperNumber ?? null,
          source?.shift ?? null,
          input.questionNumber,
        );
        if (existing) {
          report.failed += 1;
          report.errors.push({
            index,
            code: "CONFLICT_DUPLICATE_QUESTION",
            message: `A question with GATE source identity (exam_year: ${input.gateYear}, paper_number: ${source?.paperNumber ?? "null"}, shift: ${source?.shift ?? "null"}, question_number: ${input.questionNumber}) already exists.`,
          });
          continue;
        }
      }

      valid.push({ input, typeId: (await ensureQuestionType(input.typeCode)).id });
    } catch (error) {
      report.failed += 1;
      report.errors.push({
        index,
        code: "VALIDATION_ERROR",
        message: error instanceof Error ? error.message : "Invalid item.",
      });
    }
  }
  const created = await questionsRepo.bulkCreateQuestions(valid.map((item) => ({ ...item, createdById: actorId })));
  report.imported = created.length;
  await writeAuditEntry({
    actorId,
    action: "question.import",
    entityType: "questions",
    entityId: `batch:${Date.now()}`,
    after: { imported: report.imported, failed: report.failed },
  });
  return report;
}
