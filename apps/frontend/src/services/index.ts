// PHASE 5 §14 — typed API functions, one per Phase 8 endpoint used by the UI.
import { api, qs } from "@/lib/api";
import type {
  AttemptResponse,
  AdminQuestion,
  AdminSubject,
  AdminTopic,
  AuditEntry,
  BookmarkItem,
  CreatedSession,
  CurrentUser,
  LoginResult,
  MistakeItem,
  Paginated,
  PerformanceOverview,
  PublicQuestion,
  SessionQuestion,
  SessionResult,
  SessionState,
  SubjectPerformance,
  SubjectSummary,
  TopicPerformance,
  TopicSummary,
  WeakTopic,
} from "@/types/api";

export type {
  AttemptResponse,
  AdminQuestion,
  AdminSubject,
  AdminTopic,
  AuditEntry,
  BookmarkItem,
  CreatedSession,
  LoginResult,
  MistakeItem,
  Paginated,
  PerformanceOverview,
  PublicQuestion,
  SessionResult,
  SessionState,
  SubjectPerformance,
  SubjectSummary,
  TopicPerformance,
  TopicSummary,
  WeakTopic,
};

// ─── Auth ────────────────────────────────────────────────────────────────────
export const authService = {
  register: (body: { email: string; password: string; full_name: string; target_subject_id?: string }) =>
    api.post<{ id: string; email: string; full_name: string; role: string }>("/auth/register", body),
  login: (body: { email: string; password: string }) => api.post<LoginResult>("/auth/login", body),
  logout: () => api.post<null>("/auth/logout"),
  me: () => api.get<CurrentUser>("/auth/me"),
  resetPassword: (email: string) => api.post<null>("/auth/reset-password", { email }),
};

// ─── Subjects & topics ───────────────────────────────────────────────────────
export const subjectsService = {
  list: () => api.get<Paginated<SubjectSummary>>("/subjects"),
  detail: (id: string) => api.get<SubjectSummary>(`/subjects/${id}`),
  topics: (subjectId: string) =>
    api.get<Paginated<TopicSummary>>(`/subjects/${subjectId}/topics`),
  topicQuestions: (subjectId: string, topicId: string, page = 1) =>
    api.get<Paginated<PublicQuestion>>(`/subjects/${subjectId}/topics/${topicId}/questions${qs({ page })}`),
};

export const questionsService = {
  get: (id: string) => api.get<PublicQuestion>(`/questions/${id}`),
  list: (params: Record<string, string | number | undefined>) => api.get<Paginated<PublicQuestion>>(`/questions${qs(params)}`),
};

// ─── Practice ────────────────────────────────────────────────────────────────
export interface PracticeFilters {
  subject_id?: string;
  topic_id?: string;
  year?: number;
  difficulty?: string;
  question_types?: string[];
}

export const practiceService = {
  create: (body: { mode: string; filters: PracticeFilters; timed: boolean; question_count: number }) =>
    api.post<CreatedSession>("/practice-sessions", body),
  start: (sessionId: string) => api.post<SessionState>(`/practice-sessions/${sessionId}/start`),
  state: (sessionId: string) => api.get<SessionState>(`/practice-sessions/${sessionId}`),
  questions: (sessionId: string) => api.get<SessionQuestion[]>(`/practice-sessions/${sessionId}/questions`),
  attempt: (
    sessionId: string,
    body: { question_id: string; answer: Record<string, unknown>; time_taken_seconds: number },
  ) => api.post<AttemptResponse>(`/practice-sessions/${sessionId}/attempts`, body),
  complete: (sessionId: string) =>
    api.post<SessionResult>(`/practice-sessions/${sessionId}/complete`, { unanswered_policy: "skipped" }),
  result: (sessionId: string) => api.get<SessionResult>(`/practice-sessions/${sessionId}/result`),
};

// ─── Bookmarks / mistakes / analytics / dashboard ────────────────────────────
export const studentService = {
  bookmarks: (page = 1) => api.get<Paginated<BookmarkItem>>(`/bookmarks${qs({ page })}`),
  addBookmark: (questionId: string) => api.post<{ id: string; question_id: string }>("/bookmarks", { question_id: questionId }),
  removeBookmark: (id: string) => api.del<void>(`/bookmarks/${id}`),
  mistakes: (page = 1, filters: { topic_id?: string; subject_id?: string } = {}) =>
    api.get<Paginated<MistakeItem>>(`/mistakes${qs({ page, ...filters })}`),
};

export const analyticsService = {
  overview: () => api.get<PerformanceOverview>("/performance/overview"),
  subjects: (page = 1) => api.get<Paginated<SubjectPerformance>>(`/performance/subjects${qs({ page })}`),
  topics: (page = 1) => api.get<Paginated<TopicPerformance>>(`/performance/topics${qs({ page })}`),
  dashboardSummary: () => api.get<PerformanceOverview>("/dashboard/summary"),
  dashboardWeak: (limit = 5) => api.get<WeakTopic[]>(`/dashboard/weak${qs({ limit })}`),
};

// ─── Admin ───────────────────────────────────────────────────────────────────
export interface AdminUserRow {
  id: string;
  email: string;
  full_name: string;
  role: "student" | "moderator" | "admin";
  status: "active" | "disabled";
  created_at: string;
  deleted_at: string | null;
}

export const adminService = {
  subjects: (page = 1) => api.get<Paginated<AdminSubject>>(`/admin/subjects${qs({ page })}`),
  createSubject: (body: { code: string; name: string; sort_order?: number }) =>
    api.post<AdminSubject>("/admin/subjects", body),
  updateSubject: (id: string, body: { name?: string; sort_order?: number; is_active?: boolean }) =>
    api.put<AdminSubject>(`/admin/subjects/${id}`, body),
  deactivateSubject: (id: string) => api.del<null>(`/admin/subjects/${id}`),

  topics: (params: { subject_id?: string; page?: number } = {}) => api.get<Paginated<AdminTopic>>(`/admin/topics${qs(params)}`),
  createTopic: (body: { subject_id: string; name: string; sort_order?: number }) => api.post<AdminTopic>("/admin/topics", body),
  updateTopic: (id: string, body: { name?: string; sort_order?: number; is_active?: boolean }) =>
    api.put<AdminTopic>(`/admin/topics/${id}`, body),
  deactivateTopic: (id: string) => api.del<null>(`/admin/topics/${id}`),

  questions: (params: { status?: string; subject_id?: string; page?: number } = {}) =>
    api.get<Paginated<AdminQuestion>>(`/admin/questions${qs(params)}`),
  createQuestion: (body: Record<string, unknown>) => api.post<AdminQuestion>("/admin/questions", body),
  updateQuestion: (id: string, body: Record<string, unknown>) => api.put<AdminQuestion>(`/admin/questions/${id}`, body),
  publishQuestion: (id: string) => api.post<{ id: string; version: number; status: string }>(`/admin/questions/${id}/publish`),
  rejectQuestion: (id: string, reason: string) =>
    api.post<{ id: string; status: string }>(`/admin/questions/${id}/reject`, { reason }),

  users: (page = 1) => api.get<Paginated<AdminUserRow>>(`/admin/users${qs({ page })}`),

  audit: (params: { entity_type?: string; actor_id?: string; page?: number } = {}) =>
    api.get<Paginated<AuditEntry>>(`/admin/audit${qs(params)}`),
};
