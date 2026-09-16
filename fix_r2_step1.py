import io

REPO = r"D:\005 Projects\gate cs and it pyq acer\apps\backend\src\core\repositories\practice.repo.ts"
SVC = r"D:\005 Projects\gate cs and it pyq acer\apps\backend\src\core\services\practice.service.ts"

def load(p):
    with io.open(p, "r", encoding="utf-8-sig", newline="") as f:
        return f.read()

def save(p, t):
    t = t.replace("\r\n", "\n").replace("\r", "\n")
    with io.open(p, "w", encoding="utf-8", newline="\n") as f:
        f.write("﻿" + t.lstrip("﻿"))

# --- REPO FIX 1: unused _userId param referenced as userId ---
t = load(REPO)
old = "export async function saveSelectionMetadata(sessionId: string, metadata: SelectionMetadata, _userId?: string) {"
new = "export async function saveSelectionMetadata(sessionId: string, metadata: SelectionMetadata, userId?: string) {"
assert t.count(old) == 1, "repo sig count=%d" % t.count(old)
t = t.replace(old, new)
save(REPO, t)
print("REPO fix1 OK")

# --- SERVICE FIXES ---
s = load(SVC)

# Fix A: drop unused AnswerUpdateInput import
old_imp = '  parseSessionConfig,\n  AnswerUpdateInput,\n  SessionConfig,'
new_imp = '  parseSessionConfig,\n  SessionConfig,'
assert s.count(old_imp) == 1, "import count=%d" % s.count(old_imp)
s = s.replace(old_imp, new_imp)

# Fix B: widen parsedConfig literal type so parseSessionConfig result assigns
old_cfg = """async function toSessionDTO(session: any): Promise<SessionDTO> {
  let parsedConfig = {
    mode: "default",
    filters: {},
    question_count: session.totalQuestions ?? 0,
    pool: null,
  };"""
new_cfg = """async function toSessionDTO(session: any): Promise<SessionDTO> {
  let parsedConfig: SessionConfig = {
    mode: "default",
    filters: {},
    question_count: session.totalQuestions ?? 0,
    pool: null,
  };"""
assert s.count(old_cfg) == 1, "cfg count=%d" % s.count(old_cfg)
s = s.replace(old_cfg, new_cfg)

# Fix C: inline upsert input type (repo has no exported PracticeQuestionAnswerUpsertInput)
old_up = "  const upsertInput: PracticeQuestionAnswerUpsertInput = {"
new_up = "  const upsertInput: Parameters<typeof upsertAnswer>[0] = {"
assert s.count(old_up) == 1, "upsert count=%d" % s.count(old_up)
s = s.replace(old_up, new_up)

save(SVC, s)
print("SVC fixes OK")
