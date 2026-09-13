// TEMP — read-only inspection of seeded users (delete after use)
const { PrismaClient } = require("@prisma/client");

async function main() {
  const prisma = new PrismaClient();
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        status: true,
        deletedAt: true,
        role: { select: { code: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    console.log(JSON.stringify(users, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});