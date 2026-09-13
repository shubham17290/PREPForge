// TEMP — read-only inspection of demo data (delete after use)
const { PrismaClient } = require("@prisma/client");

async function main() {
  const prisma = new PrismaClient();
  try {
    const subjects = await prisma.subject.findMany({
      select: { id: true, code: true, name: true, isActive: true, _count: { select: { topics: true, questions: true } } },
      orderBy: { sortOrder: "asc" },
    });
    console.log("== SUBJECTS ==");
    console.log(JSON.stringify(subjects, null, 2));

    const questions = await prisma.question.findMany({
      select: { id: true, body: true, status: true, difficulty: true, gateYear: true, marks: true, subjectId: true, topic: { select: { id: true, name: true } }, questionType: { select: { code: true } } },
      take: 30,
      orderBy: { createdAt: "desc" },
    });
    console.log("== QUESTIONS (latest 30) ==");
    console.log(JSON.stringify(questions, null, 2));

    console.log("== QUESTION COUNTS BY STATUS ==");
    const statusCounts = await prisma.question.groupBy({ by: ["status"], _count: true });
    console.log(JSON.stringify(statusCounts, null, 2));

    const demoUsers = await prisma.user.findMany({
      where: { email: { in: ["demo-prepforge@test.local", "pf-demo-1788951461584@test.local"] } },
      select: {
        id: true, email: true, status: true,
        _count: { select: { practiceSessions: true, attempts: true, bookmarks: true } },
        practiceSessions: { select: { id: true, status: true, modeId: true, score: true, totalQuestions: true, startedAt: true }, take: 5, orderBy: { startedAt: "desc" } },
      },
    });
    console.log("== DEMO USERS ==");
    console.log(JSON.stringify(demoUsers, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});