# GATE CS & IT PYQ Practice Platform — Improvement & System Design Tracker

> **Status**: Phase 6 foundation complete; substantial implementation exists but critical gaps remain vs approved designs (Phases 1–5).

---

## 🔴 Critical Missing Pieces (Blockers — Must Fix First)

| # | Area | Design Spec | Current Gap | Impact |
|---|------|-------------|-------------|--------|
| 1 | **Grading Service** | Phase 4 §7 — single canonical MCQ/MSQ/NAT evaluator | `grading.service.ts` exists but incomplete (stubs only) | Blocks practice completion, analytics, mistake tracking |
| 2 | **Session Completion** | Phase 4 §8.3 — `POST /practice-sessions/{id}/complete` computes score, finalizes | Practice service has `create/activate/save` but **no `complete`** | Cannot finish a session; no results |
| 3 | **Analytics Endpoints** | Phase 4 §3.1 rows 121–127 — `/performance/overview\|subjects\|topics`, `/dashboard/*` | Routes exist but return mock/empty data | Dashboard & weak-topic recommendations don't work |
| 4 | **Admin Question CRUD** | Phase 4 §3.2.13 — create/edit/publish/reject with validation | `admin.routes.ts` has stubs; no validation, no publish/reject logic | Content management broken |
| 5 | **Question Pool Building** | Phase 4 §8.1 — pool building via `ix_questions_status_published_topic` | Missing in practice service | Sessions start with empty question pools |

---

## 🟡 Significant Design vs Code Mismatches

| Component | Design (Phase 3/4/5) | Code Reality | Fix Required |
|-----------|---------------------|--------------|--------------|
| **Practice Session Status** | `in_progress \| submitted \| completed \| abandoned` | Code uses `pending \| active \| submitted` | Unify enums across backend/frontend |
| **Attempt Model** | `selected_answers` JSONB + `question_version_id` FK | Repo uses `selectedAnswers` + `questionId` (not versioned) | Wire `question_version_id` in attempt upsert |
| **NAT Grading** | Tolerance abs/rel + unit + multiple accepted values | Not implemented | Implement per Phase 3 §6.13 & Phase 4 §7.3 |
| **MSQ Partial Credit** | Configurable per OD-03 | Not implemented | Implement per Phase 4 §7.2 |
| **Weak Topic Threshold** | Configurable via `config.analytics.weakAccuracyBelow` | Hardcoded in frontend/dashboard | Use config-driven threshold |
| **Cookie Session Security** | HttpOnly, Secure, SameSite=Lax | Frontend sends `credentials: "include"` but backend CORS allows all | Add secure cookie flags in production |
| **Question Versioning** | Every publish bumps version + immutable snapshot | Snapshots exist but attempts don't reference them | Link attempts to `question_version_id` |
| **Rate Limiting** | Per-user global + auth-specific | In-memory Map (not distributed) | Move to Redis for multi-instance |

---

## 🟢 Already Solid (No Major Updates Needed)

- ✅ **Prisma Schema** — 100% matches Phase 3 design (all tables, indexes, relations, constraints)
- ✅ **Auth Service** — register/login/logout/reset with rate limiting, lockout, PBKDF2
- ✅ **Ingestion Pipeline** — PDF extract → parse → stage → validate → dedupe → import
- ✅ **API Client** — unwraps Phase 4 envelope, `ApiError` with `fieldErrors`
- ✅ **Auth Context** — React Context + cookie-session, refresh on mount
- ✅ **Frontend Routes/Pages** — All Phase 5 routes exist with correct structure
- ✅ **Design System** — Button, Card, Modal, Toast, Field, Overlay, States components
- ✅ **Question UI Components** — OptionCard, NumericInput, QuestionPalette, TimerChip
- ✅ **Error Handling** — Global handler normalizes to Phase 4 envelope

---

## 📋 Recommended Implementation Order

### Phase A: Core Practice Loop (Unblocks Everything)
1. **Grading Service** (`core/grading/grading.service.ts`) — MCQ/MSQ/NAT per Phase 4 §7
2. **Question Pool Building** — filtered SELECT using `ix_questions_status_published_topic`
3. **Practice Completion** — `completeSession()` in service + repo + route
4. **Attempt Versioning** — wire `question_version_id` in attempt upsert

### Phase B: Analytics & Dashboard
5. **Analytics Queries** — implement `/performance/*` and `/dashboard/*` derived from `attempts`
6. **Weak Topic Detection** — config-driven threshold (OD-05) + recommendation endpoint

### Phase C: Admin & Content Management
7. **Admin Question Validation** — type-specific answer validation + publish/reject transitions
8. **Admin User Management** — role/status changes, audit logging

### Phase D: System Hardening
8. **Align Status Enums** — unify `in_progress/submitted/completed/abandoned`
9. **Cookie Security** — `Secure; SameSite=Lax` in production
10. **Distributed Rate Limiting** — Redis-backed for multi-instance
11. **Database Migrations** — apply CHECK constraints from Phase 3 §8 via raw SQL migrations
12. **Observability** — structured logging, request-id correlation, metrics endpoint

---

## 🏗️ Requirements for a Strong System

### 1. Data Integrity & Correctness
- [ ] **Immutable Attempt History** — attempts reference `question_version_id` (snapshot), never mutable `questions`
- [ ] **Single Grading Path** — one canonical service used by attempt recording AND session completion
- [ ] **Transaction Boundaries** — session creation, attempt upsert, completion each in single DB transaction
- [ ] **Optimistic Concurrency** — `questions.version` + `attempts.response_version` prevent lost updates
- [ ] **Referential Integrity** — FK RESTRICT on audit/history tables; soft-delete for users/subjects

### 2. Security & Authorization
- [ ] **IDOR Prevention** — every per-user query scoped by `user_id = auth.user` (never from body)
- [ ] **RBAC Enforcement** — middleware + service-level checks; RLS as defense-in-depth
- [ ] **Session Security** — HttpOnly, Secure, SameSite=Lax cookies; rotating token hashes
- [ ] **Rate Limiting** — per-IP + per-user; sliding window; distributed (Redis)
- [ ] **Input Validation** — structural (middleware) + business (service) — both return envelope
- [ ] **Audit Trail** — append-only `audit_log` for all admin mutations + auth events

### 3. Performance & Scalability
- [ ] **Index-First Design** — all query patterns covered by Phase 3 §9 indexes
- [ ] **No N+1 Queries** — session pool + options/answers fetched in ≤2 queries
- [ ] **Derived Analytics** — compute on-read from `attempts` (no pre-aggregation until measured need)
- [ ] **Pagination** — offset-based (MVP); keyset cursor reserved for scale
- [ ] **Caching Strategy** — only static data (subjects/topics) with short TTL + invalidation

### 4. Reliability & Operability
- [ ] **Graceful Degradation** — read-mode when analytics DB unavailable
- [ ] **Idempotent Mutations** — attempt upsert keyed by `session_id + question_version_id`
- [ ] **Session Recovery** — server-persisted state; resume within 24h window
- [ ] **Health Checks** — `/health` endpoint + dependency checks (DB, Redis)
- [ ] **Structured Logging** — request-id correlation; no PII/secrets in logs

### 5. Developer Experience & Maintainability
- [ ] **Type Safety** — end-to-end: DB schema → Prisma → API contracts → frontend types
- [ ] **Contract Testing** — API envelope + error codes verified in CI
- [ ] **Migration Discipline** — sequential, versioned, forward-only; additive-first patterns
- [ ] **Feature Flags** — config-driven (OD-01, OD-03, OD-05, OD-06) for safe rollout
- [ ] **Documentation Sync** — design docs updated with implementation decisions

### 6. User Experience Quality
- [ ] **Accessibility** — WCAG 2.1 AA; keyboard nav; screen reader labels; focus states
- [ ] **Responsive** — breakpoints 320/480/768/1200px; touch targets ≥44px
- [ ] **Loading/Empty/Error States** — consistent primitives across all screens
- [ ] **Offline Resilience** — queue attempt submissions; retry with backoff
- [ ] **Internationalization Ready** — text externalized; RTL-aware layout

---

## 🎯 Phase 7+ Roadmap (Post-Foundation)

| Phase | Focus | Key Deliverables |
|-------|-------|------------------|
| **7** | **Database Implementation** | Run Prisma migrations; seed roles, question_types, practice_modes, subjects/topics |
| **8** | **Core API Implementation** | Auth, subjects, practice sessions, grading, completion, bookmarks |
| **9** | **Analytics & Dashboard** | Performance endpoints, weak-topic detection, recommendations |
| **10** | **Admin Features** | Question CRUD, publish/reject, user management, audit log |
| **11** | **Frontend Integration** | Connect all screens to real APIs; E2E tests with Playwright |
| **12** | **Content Ingestion** | Import real GATE PYQ PDFs; validate + publish |
| **13** | **Hardening** | Load testing, security audit, observability, CI/CD |
| **14** | **Launch Prep** | Beta program, feedback loop, documentation, runbooks |

---

## 📌 Open Decisions (From Design Docs — Must Resolve)

| ID | Question | Options | Recommended Default |
|----|----------|---------|---------------------|
| OD-01 | MCQ negative-marking policy | GATE official / custom / none | GATE official per question config |
| OD-03 | MSQ partial scoring + NAT tolerance | exact-only / partial; tolerance range | full on exact set; partial credit; NAT ±0.1 |
| OD-04 | Taxonomy depth | 2-level (Subject→Topic) / 3-4 level | 2-level; chapters/subtopics nullable |
| OD-05 | Weak-topic threshold + min attempts | variants | accuracy < 45% AND attempts ≥ 5 (configurable) |
| OD-06 | Unanswered-at-submit policy | marked wrong / not scored / skipped | skipped, not scored |
| OD-07 | Separation of duties | allow self-publish / require second reviewer | reviewer ≠ author for publish |
| API-01 | Auth transport | JWT bearer / cookie-session | **Cookie-session** (revocable) |
| API-02 | Time-limit auto-finalize | auto-submit / student-submit-only | student-submit-only MVP |
| DB-R | Data retention window | forever / delete 3y / anonymize 2y | forever + export & delete-rights |

---

## ✅ Definition of Done (Per Feature)

A feature is **done** when:
- [ ] Implementation matches Phase 3/4/5 design specs exactly
- [ ] Unit tests cover grading logic, validation, edge cases
- [ ] Integration tests hit real DB (test containers)
- [ ] API contract tests verify envelope + error codes
- [ ] Frontend screen works end-to-end (Playwright)
- [ ] Lint + typecheck pass (`npm run lint && npm run typecheck`)
- [ ] Design doc updated if implementation deviated (with rationale)
- [ ] Migration applied (if schema changed)

---

## 🚀 Quick Start for Contributors

```bash
# 1. Install
npm install

# 2. Configure env
cp .env.example .env
# Edit .env with DATABASE_URL, FRONTEND_ORIGIN, etc.

# 3. Database (Phase 7)
npm run prisma:validate --workspace backend
npm run prisma:generate --workspace backend
npm run prisma:migrate deploy --workspace backend  # when migrations exist

# 4. Dev servers
npm run dev  # backend:4000 + frontend:3000

# 5. Verify
curl http://localhost:4000/api/v1/health
open http://localhost:3000
```

---

## 📚 Reference Documents (Source of Truth)

| Doc | Purpose |
|-----|---------|
| `docs/PRD-Phase1.md` | Product requirements, user roles, MVP scope |
| `docs/DB-Model-Phase3.md` | Complete PostgreSQL schema (600+ lines) |
| `docs/API-Backend-Phase4.md` | API architecture, endpoints, contracts, security |
| `docs/Frontend-UX-Phase5.md` | UI/UX design, components, routes, state management |
| `apps/backend/prisma/schema.prisma` | Implemented Prisma schema (matches Phase 3) |

---

*Last updated: Based on codebase audit vs approved design docs. Update this file as work progresses.*