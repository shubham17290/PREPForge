// T19.1 — Isolated test-database helper (test-only, never used by production).
// Provides fail-fast resolution of TEST_DATABASE_URL and a Prisma client bound to it.
// Production code in `src/core/repositories/prisma.ts` continues to use DATABASE_URL unchanged.

import { PrismaClient } from "@prisma/client";

function normalizeUrl(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  // Strip surrounding quotes if present (e.g., DATABASE_URL="postgres://...")
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

/**
 * Resolve TEST_DATABASE_URL for integration tests.
 * - Never falls back to DATABASE_URL.
 * - Throws with explanatory message if missing/empty.
 * - Rejects if clearly the same as production DATABASE_URL / DATABASE_URL_UNPOOLED.
 */
export function getTestDatabaseUrl(): string {
  const testUrl = normalizeUrl(process.env.TEST_DATABASE_URL);

  if (!testUrl) {
    throw new Error(
      "TEST_DATABASE_URL is required for integration tests that need a database. " +
        "Set TEST_DATABASE_URL to an isolated database (Neon test branch or local Postgres, e.g., postgresql://user:pass@localhost:5432/gate_pyq_test). " +
        "It must never equal the production DATABASE_URL. See .env.example / apps/backend/.env.example. " +
        "The test will not silently fall back to DATABASE_URL.",
    );
  }

  const prodUrl = normalizeUrl(process.env.DATABASE_URL);
  const prodUnpooled = normalizeUrl(process.env.DATABASE_URL_UNPOOLED);

  if (prodUrl && testUrl === prodUrl) {
    throw new Error(
      "TEST_DATABASE_URL must not equal DATABASE_URL (production). " +
        "Refusing to run tests against the production database. " +
        "Configure an isolated test branch (e.g., Neon branch `test`) or a local test database and set TEST_DATABASE_URL accordingly.",
    );
  }

  if (prodUnpooled && testUrl === prodUnpooled) {
    throw new Error(
      "TEST_DATABASE_URL must not equal DATABASE_URL_UNPOOLED (production). " +
        "Refusing to run tests against the production database.",
    );
  }

  return testUrl;
}

/**
 * Create a PrismaClient bound to TEST_DATABASE_URL.
 * Uses the same logging policy as the production singleton.
 */
export function createTestPrismaClient(): PrismaClient {
  const url = getTestDatabaseUrl();

  return new PrismaClient({
    datasources: { db: { url } },
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

/**
 * Convenience for tests that only need validation (no client).
 * Throws if configuration is invalid.
 */
export function assertTestDatabaseIsolated(): string {
  return getTestDatabaseUrl();
}
