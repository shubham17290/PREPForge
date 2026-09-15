// PHASE 8 — Taxonomy (subjects/chapters/topics/subtopics) + lookup data access (Phase 3 §6.5–6.9, §6.15)
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

const publishedCount = { where: { status: "published" as const } };

export async function listActiveSubjects() {
  return prisma.subject.findMany({
    where: { isActive: true, deletedAt: null },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      code: true,
      name: true,
      sortOrder: true,
      _count: { select: { topics: { where: { isActive: true } }, questions: publishedCount } },
    },
  });
}

export async function findSubjectById(id: string) {
  return prisma.subject.findFirst({
    where: { id, isActive: true, deletedAt: null },
    include: {
      _count: { select: { topics: { where: { isActive: true } }, questions: publishedCount } },
    },
  });
}

export async function listTopicsForSubject(subjectId: string) {
  return prisma.topic.findMany({
    where: { subjectId, isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      subjectId: true,
      chapterId: true,
      name: true,
      sortOrder: true,
      _count: { select: { questions: publishedCount } },
    },
  });
}

export async function findTopicInSubject(subjectId: string, topicId: string) {
  return prisma.topic.findFirst({
    where: { id: topicId, subjectId, isActive: true },
    select: { id: true, subjectId: true, name: true, isActive: true },
  });
}

export async function findTopicById(topicId: string) {
  return prisma.topic.findUnique({
    where: { id: topicId },
    select: { id: true, subjectId: true, name: true, isActive: true },
  });
}

export interface TopicInfo {
  id: string;
  name: string;
  subjectId: string;
  subjectName: string;
}

export async function topicInfoMap(): Promise<Map<string, TopicInfo>> {
  const topics = await prisma.topic.findMany({
    select: { id: true, name: true, subjectId: true, subject: { select: { name: true } } },
  });
  const map = new Map<string, TopicInfo>();
  for (const topic of topics) {
    map.set(topic.id, { id: topic.id, name: topic.name, subjectId: topic.subjectId, subjectName: topic.subject.name });
  }
  return map;
}

// ─── Admin-side taxonomy ─────────────────────────────────────────────────────

export async function adminListSubjects(page: number, pageSize: number) {
  const [items, total] = await prisma.$transaction([
    prisma.subject.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.subject.count(),
  ]);
  return { items, total };
}

export interface SubjectWriteInput {
  code: string;
  name: string;
  sortOrder?: number;
  isActive?: boolean;
}

export async function createSubject(input: SubjectWriteInput) {
  return prisma.subject.create({
    data: { code: input.code, name: input.name, sortOrder: input.sortOrder ?? 0, isActive: input.isActive ?? true },
  });
}

export async function updateSubject(id: string, patch: Partial<SubjectWriteInput>) {
  const data: Prisma.SubjectUpdateInput = {};
  if (patch.name !== undefined) data.name = patch.name;
  if (patch.sortOrder !== undefined) data.sortOrder = patch.sortOrder;
  if (patch.isActive !== undefined) {
    data.isActive = patch.isActive;
    if (patch.isActive && !("deletedAt" in data)) data.deletedAt = null;
  }
  return prisma.subject.update({ where: { id }, data });
}

/** Phase 4 §3.1: DELETE = deactivate (soft delete per Phase 3 §13.4). */
export async function deactivateSubject(id: string): Promise<void> {
  await prisma.subject.update({ where: { id }, data: { isActive: false, deletedAt: new Date() } });
}

export interface TopicWriteInput {
  subjectId: string;
  chapterId?: string | null;
  name: string;
  sortOrder?: number;
  isActive?: boolean;
}

export async function adminListTopics(subjectId: string | undefined, page: number, pageSize: number) {
  const where: Prisma.TopicWhereInput = subjectId ? { subjectId } : {};
  const [items, total] = await prisma.$transaction([
    prisma.topic.findMany({
      where,
      orderBy: [{ subjectId: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { subject: { select: { code: true, name: true } } },
    }),
    prisma.topic.count({ where }),
  ]);
  return { items, total };
}

export async function createTopic(input: TopicWriteInput) {
  const data: Prisma.TopicCreateInput = {
    name: input.name,
    sortOrder: input.sortOrder ?? 0,
    subject: { connect: { id: input.subjectId } },
    ...(input.chapterId ? { chapter: { connect: { id: input.chapterId } } } : {}),
  };
  return prisma.topic.create({ data, include: { subject: { select: { code: true, name: true } } } });
}

export async function updateTopic(id: string, patch: Partial<TopicWriteInput>) {
  const data: Prisma.TopicUpdateInput = {};
  if (patch.name !== undefined) data.name = patch.name;
  if (patch.sortOrder !== undefined) data.sortOrder = patch.sortOrder;
  if (patch.isActive !== undefined) data.isActive = patch.isActive;
  if (patch.chapterId !== undefined) {
    data.chapter = patch.chapterId === null ? { disconnect: true } : { connect: { id: patch.chapterId } };
  }
  return prisma.topic.update({ where: { id }, data, include: { subject: { select: { code: true, name: true } } } });
}

export async function deactivateTopic(id: string): Promise<void> {
  await prisma.topic.update({ where: { id }, data: { isActive: false } });
}

/**
 * PHASE 12F.2-T1 — read-only question-type resolution for the PYQ importer.
 * Deliberately does NOT create the row (unlike ensureQuestionType): the importer
 * must fail pre-flight when the configured type is not resolvable rather than
 * inventing reference data.
 */
export async function findQuestionTypeByCode(code: string): Promise<{ id: string; code: string } | null> {
  return prisma.questionType.findUnique({ where: { code }, select: { id: true, code: true } });
}

/** Question-type lookup get-or-create (Phase 3 §13.2: extensible sets need no DDL). */
export async function ensureQuestionType(code: string): Promise<{ id: string; code: string }> {
  const defaults: Record<string, { name: string; has_options: boolean; has_numeric: boolean; supports_multiple: boolean }> = {
    mcq: { name: "Multiple Choice (Single Correct)", has_options: true, has_numeric: false, supports_multiple: false },
    msq: { name: "Multiple Select (Multiple Correct)", has_options: true, has_numeric: false, supports_multiple: true },
    nat: { name: "Numerical Answer", has_options: false, has_numeric: true, supports_multiple: false },
  };
  const existing = await prisma.questionType.findUnique({ where: { code } });
  if (existing) return existing;
  const fallback = defaults[code] ?? {
    name: code.toUpperCase(),
    has_options: false,
    has_numeric: false,
    supports_multiple: false,
  };
  return prisma.questionType.create({
    data: {
      code,
      name: fallback.name,
      hasOptions: fallback.has_options,
      hasNumeric: fallback.has_numeric,
      supportsMultiple: fallback.supports_multiple,
    },
  });
}
