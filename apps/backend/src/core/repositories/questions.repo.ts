// PHASE 8 — Questions, versions, sources data access (Phase 3 §6.9–6.14)
import { Prisma, Question } from "@prisma/client";
import { prisma } from "./prisma";

export interface QuestionFilters {
  subjectId?: string;
  topicId?: string;
  year?: number;
  difficulty?: string;
  typeCode?: string;
  questionNumber?: number;
  sourceId?: string;
}

function publishedWhere(filters: QuestionFilters): Prisma.QuestionWhereInput {
  const where: Prisma.QuestionWhereInput = { status: "published" };
  if (filters.subjectId) where.subjectId = filters.subjectId;
  if (filters.topicId) where.topicId = filters.topicId;
  if (filters.year !== undefined) where.gateYear = filters.year;
  if (filters.difficulty) where.difficulty = filters.difficulty;
  if (filters.typeCode) where.questionType = { code: filters.typeCode };
  if (filters.questionNumber !== undefined) where.source = { questionNumber: filters.questionNumber };
  if (filters.sourceId) where.sourceId = filters.sourceId;
  return where;
}

const LIST_SELECT = {
  id: true,
  body: true,
  marks: true,
  negativeMarks: true,
  difficulty: true,
  gateYear: true,
  subject: { select: { id: true, code: true, name: true } },
  topic: { select: { id: true, name: true } },
  questionType: { select: { code: true, name: true } },
} satisfies Prisma.QuestionSelect;

export async function listPublishedQuestions(
  filters: QuestionFilters,
  page: number,
  pageSize: number,
  orderBy: Prisma.QuestionOrderByWithRelationInput[],
) {
  const where = publishedWhere(filters);
  const [items, total] = await prisma.$transaction([
    prisma.question.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: LIST_SELECT,
    }),
    prisma.question.count({ where }),
  ]);
  return { items, total };
}

export async function countPublishedQuestions(filters: QuestionFilters): Promise<number> {
  return prisma.question.count({ where: publishedWhere(filters) });
}

/** Candidate ids for a session pool (single indexed query, Phase 4 §11). */
export async function poolCandidateIds(filters: QuestionFilters, take: number): Promise<string[]> {
  const rows = await prisma.question.findMany({
    where: publishedWhere(filters),
    orderBy: [{ gateYear: "desc" }, { id: "asc" }],
    take,
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

export interface QuestionDetail {
  id: string;
  body: string;
  explanation: string | null;
  marks: Prisma.Decimal;
  negativeMarks: Prisma.Decimal | null;
  difficulty: string;
  status: string;
  version: number;
  gateYear: number;
  createdBy: string;
  reviewedBy: string | null;
  subject: { id: string; code: string; name: string };
  topic: { id: string; name: string } | null;
  questionType: { code: string; name: string };
  source: { id: string; examYear: number; paperNumber: string | null; shift: string | null; questionNumber: number | null } | null;
}

export async function findQuestionById(id: string) {
  return prisma.question.findUnique({
    where: { id },
    include: {
      subject: { select: { id: true, code: true, name: true } },
      topic: { select: { id: true, name: true } },
      questionType: { select: { code: true, name: true } },
      options: { orderBy: { sortOrder: "asc" }, select: { id: true, body: true, isCorrect: true, sortOrder: true } },
      numericAnswers: true,
    },
  });
}

/** Latest immutable snapshot for the question's current version (Phase 3 §6.11). */
export async function currentVersionForQuestion(questionId: string) {
  const question = await prisma.question.findUnique({ where: { id: questionId }, select: { id: true, version: true } });
  if (!question) return null;
  const version = await prisma.questionVersion.findUnique({
    where: { questionId_version: { questionId, version: question.version } },
    select: { id: true, version: true, snapshot: true },
  });
  return version ? { ...version, questionId } : null;
}

// ─── Admin content management ────────────────────────────────────────────────

export interface AdminQuestionFilters {
  status?: string;
  subjectId?: string;
  topicId?: string;
}

export async function adminListQuestions(filters: AdminQuestionFilters, page: number, pageSize: number) {
  const where: Prisma.QuestionWhereInput = {};
  if (filters.status) where.status = filters.status;
  if (filters.subjectId) where.subjectId = filters.subjectId;
  if (filters.topicId) where.topicId = filters.topicId;
  const [items, total] = await prisma.$transaction([
    prisma.question.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        subject: { select: { code: true, name: true } },
        topic: { select: { id: true, name: true } },
        questionType: { select: { code: true, name: true } },
        _count: { select: { options: true, numericAnswers: true } },
      },
    }),
    prisma.question.count({ where }),
  ]);
  return { items, total };
}

export interface OptionWrite {
  body: string;
  isCorrect: boolean;
  sortOrder: number;
}

export interface NumericAnswerWrite {
  numericValue: number;
  toleranceAbs?: number | null;
  toleranceRel?: number | null;
  unit?: string | null;
  precision?: number | null;
}

export interface QuestionWriteInput {
  typeCode: string;
  subjectId: string;
  topicId?: string | null;
  body: string;
  explanation?: string | null;
  marks: number;
  negativeMarks?: number | null;
  difficulty: string;
  gateYear: number;
  sourceId?: string | null;
  questionNumber?: number | null;
  options?: OptionWrite[];
  numericAnswers?: NumericAnswerWrite[];
}

interface OptionCreateData {
  body: string;
  isCorrect: boolean;
  sortOrder: number;
}

interface NumericAnswerCreateData {
  numericValue: number;
  toleranceAbs: number | null;
  toleranceRel: number | null;
  unit: string | null;
  precision: number | null;
}

function replaceContentData(input: QuestionWriteInput): {
  options: OptionCreateData[];
  numericAnswers: NumericAnswerCreateData[];
} {
  const options =
    input.options?.map((option) => ({
      body: option.body,
      isCorrect: option.isCorrect,
      sortOrder: option.sortOrder,
    })) ?? [];
  const numericAnswers =
    input.numericAnswers?.map((answer) => ({
      numericValue: answer.numericValue,
      toleranceAbs: answer.toleranceAbs ?? null,
      toleranceRel: answer.toleranceRel ?? null,
      unit: answer.unit ?? null,
      precision: answer.precision ?? null,
    })) ?? [];
  return { options, numericAnswers };
}

export async function createQuestion(
  input: QuestionWriteInput,
  typeId: string,
  createdById: string,
): Promise<{ id: string }> {
  const content = replaceContentData(input);
  return prisma.$transaction(async (tx) => {
    if (input.sourceId && input.questionNumber !== undefined) {
      await tx.questionSource.update({
        where: { id: input.sourceId },
        data: { questionNumber: input.questionNumber },
      });
    }
    const question = await tx.question.create({
      data: {
        questionTypeId: typeId,
        subjectId: input.subjectId,
        topicId: input.topicId ?? null,
        body: input.body,
        explanation: input.explanation ?? null,
        marks: input.marks,
        negativeMarks: input.negativeMarks ?? null,
        difficulty: input.difficulty,
        gateYear: input.gateYear,
        sourceId: input.sourceId ?? null,
        createdById,
        options: { create: content.options },
        numericAnswers: { create: content.numericAnswers },
      },
      select: { id: true },
    });
    return question;
  });
}

// PHASE 12F.2-T1 — PYQ importer helpers. Additive only; existing reads/writes are
// untouched. The importer needs (a) a name-based source lookup — the deterministic
// `name` is the ONLY DB-enforced dedupe anchor for papers whose paperNumber/shift
// are NULL, because Postgres treats NULLs as distinct in uq_question_sources_identity
// — and (b) an atomic "source + question + children" create, since createQuestion
// only attaches to a pre-existing source.

export async function findQuestionSourceByName(name: string) {
  return prisma.questionSource.findFirst({
    where: { name },
    select: { id: true, name: true, examYear: true, paperNumber: true, shift: true, questionNumber: true },
  });
}

export async function findQuestionBySourceId(sourceId: string) {
  return prisma.question.findFirst({
    where: { sourceId },
    select: { id: true, status: true, gateYear: true, version: true },
  });
}

export async function createQuestionWithSource(
  source: { name: string; examYear: number; paperNumber: string | null; shift: string | null; questionNumber: number },
  input: QuestionWriteInput,
  typeId: string,
  createdById: string,
): Promise<{ sourceId: string; questionId: string }> {
  const content = replaceContentData(input);
  return prisma.$transaction(async (tx) => {
    const created = await tx.questionSource.create({
      data: {
        name: source.name,
        examYear: source.examYear,
        paperNumber: source.paperNumber,
        shift: source.shift,
        questionNumber: source.questionNumber,
      },
      select: { id: true },
    });
    const question = await tx.question.create({
      data: {
        questionTypeId: typeId,
        subjectId: input.subjectId,
        topicId: input.topicId ?? null,
        body: input.body,
        explanation: input.explanation ?? null,
        marks: input.marks,
        negativeMarks: input.negativeMarks ?? null,
        difficulty: input.difficulty,
        gateYear: input.gateYear,
        sourceId: created.id,
        createdById,
        options: { create: content.options },
        numericAnswers: { create: content.numericAnswers },
      },
      select: { id: true },
    });
    return { sourceId: created.id, questionId: question.id };
  });
}

export async function findQuestionBySourceIdentity(
  examYear: number,
  paperNumber: string | null,
  shift: string | null,
  questionNumber: number | null,
): Promise<Question | null> {
  if (examYear === undefined || questionNumber === undefined || questionNumber === null) return null;
  return prisma.question.findFirst({
    where: {
      gateYear: examYear,
      source: {
        examYear,
        paperNumber,
        shift,
        questionNumber,
      },
    },
    select: { id: true, difficulty: true, status: true, createdAt: true, updatedAt: true, subjectId: true, topicId: true, body: true, explanation: true, marks: true, negativeMarks: true, version: true, gateYear: true, createdById: true, reviewedById: true, questionTypeId: true, sourceId: true },
  });
}

export async function updateQuestion(id: string, patch: Partial<QuestionWriteInput>, typeId?: string): Promise<void> {
  const data: Prisma.QuestionUpdateInput = {};
  if (typeId !== undefined && patch.typeCode !== undefined) data.questionType = { connect: { id: typeId } };
  if (patch.subjectId !== undefined) data.subject = { connect: { id: patch.subjectId } };
  if (patch.topicId !== undefined) data.topic = patch.topicId === null ? { disconnect: true } : { connect: { id: patch.topicId } };
  if (patch.body !== undefined) data.body = patch.body;
  if (patch.explanation !== undefined) data.explanation = patch.explanation;
  if (patch.marks !== undefined) data.marks = patch.marks;
  if (patch.negativeMarks !== undefined) data.negativeMarks = patch.negativeMarks;
  if (patch.difficulty !== undefined) data.difficulty = patch.difficulty;
  if (patch.gateYear !== undefined) data.gateYear = patch.gateYear;
  if (patch.sourceId !== undefined) data.source = patch.sourceId === null ? { disconnect: true } : { connect: { id: patch.sourceId } };
  if (patch.questionNumber !== undefined && patch.sourceId) {
    data.source = patch.sourceId === null ? { disconnect: true } : { connect: { id: patch.sourceId } };
  }

  await prisma.$transaction(async (tx) => {
    const updated = await tx.question.update({ where: { id }, data, select: { id: true } });
    if (patch.options !== undefined || patch.numericAnswers !== undefined) {
      if (patch.options !== undefined) {
        await tx.questionOption.deleteMany({ where: { questionId: updated.id } });
        if (patch.options.length > 0) {
          await tx.questionOption.createMany({
            data: patch.options.map((option) => ({
              questionId: updated.id,
              body: option.body,
              isCorrect: option.isCorrect,
              sortOrder: option.sortOrder,
            })),
          });
        }
      }
      if (patch.numericAnswers !== undefined) {
        await tx.questionNumericAnswer.deleteMany({ where: { questionId: updated.id } });
        if (patch.numericAnswers.length > 0) {
          await tx.questionNumericAnswer.createMany({
            data: patch.numericAnswers.map((answer) => ({
              questionId: updated.id,
              numericValue: answer.numericValue,
              toleranceAbs: answer.toleranceAbs ?? null,
              toleranceRel: answer.toleranceRel ?? null,
              unit: answer.unit ?? null,
              precision: answer.precision ?? null,
            })),
          });
        }
      }
    }
  });
}

export interface PublishSnapshot {
  question_id: string;
  type_code: string;
  body: string;
  explanation: string | null;
  marks: number;
  negative_marks: number | null;
  difficulty: string;
  gate_year: number;
  subject_id: string;
  topic_id: string | null;
  question_number: number | null;
  source_id: string | null;
  options: Array<{ id: string; body: string; is_correct: boolean }>;
  numeric_answers: Array<{
    numeric_value: string;
    tolerance_abs: string | null;
    tolerance_rel: string | null;
    unit: string | null;
  }>;
}

/**
 * Publish transition (Phase 4 §3.2.13): bump `questions.version`, append an
 * immutable snapshot to `question_versions`, set reviewer + status. Atomic.
 */
export async function publishQuestion(
  questionId: string,
  reviewerId: string,
  reason: string | undefined,
): Promise<{ newVersion: number; snapshot: PublishSnapshot }> {
  return prisma.$transaction(async (tx) => {
    const question = await tx.question.findUnique({
      where: { id: questionId },
      include: {
        options: { orderBy: { sortOrder: "asc" }, select: { id: true, body: true, isCorrect: true } },
        numericAnswers: true,
        source: { select: { id: true, examYear: true, paperNumber: true, shift: true, questionNumber: true } },
      },
    });
    if (!question) throw new Error("QUESTION_NOT_FOUND");

    const newVersion = question.version + 1;
    const snapshot: PublishSnapshot = {
      question_id: question.id,
      type_code: (await tx.questionType.findUniqueOrThrow({ where: { id: question.questionTypeId } })).code,
      body: question.body,
      explanation: question.explanation,
      marks: Number(question.marks),
      negative_marks: question.negativeMarks === null ? null : Number(question.negativeMarks),
      difficulty: question.difficulty,
      gate_year: question.gateYear,
      subject_id: question.subjectId,
      topic_id: question.topicId,
      question_number: question.source ? question.source.questionNumber : null,
      source_id: question.sourceId,
      options: question.options.map((option) => ({
        id: option.id,
        body: option.body,
        is_correct: option.isCorrect,
      })),
      numeric_answers: question.numericAnswers.map((answer) => ({
        numeric_value: String(answer.numericValue),
        tolerance_abs: answer.toleranceAbs === null ? null : String(answer.toleranceAbs),
        tolerance_rel: answer.toleranceRel === null ? null : String(answer.toleranceRel),
        unit: answer.unit,
      })),
    };

    await tx.questionVersion.create({
      data: {
        questionId: question.id,
        version: newVersion,
        snapshot: snapshot as unknown as Prisma.InputJsonValue,
        reason: reason ?? null,
        createdById: reviewerId,
      },
    });
    await tx.question.update({
      where: { id: question.id },
      data: { version: newVersion, status: "published", reviewedById: reviewerId },
    });
    return { newVersion, snapshot };
  });
}

export async function rejectQuestion(questionId: string, reviewerId: string): Promise<void> {
  await prisma.question.update({
    where: { id: questionId },
    data: { status: "rejected", reviewedById: reviewerId },
  });
}

export async function bulkCreateQuestions(
  inputs: Array<{ input: QuestionWriteInput; typeId: string; createdById: string }>,
): Promise<Array<{ id: string }>> {
  const created: Array<{ id: string }> = [];
  for (const item of inputs) {
    created.push(await createQuestion(item.input, item.typeId, item.createdById));
  }
  return created;
}
