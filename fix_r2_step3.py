import io

SVC = r"D:\005 Projects\gate cs and it pyq acer\apps\backend\src\core\services\practice.service.ts"

def load(p):
    with io.open(p, "r", encoding="utf-8-sig", newline="") as f:
        return f.read()

def save(p, t):
    t = t.replace("\r\n", "\n").replace("\r", "\n")
    with io.open(p, "w", encoding="utf-8", newline="\n") as f:
        f.write("﻿" + t.lstrip("﻿"))

s = load(SVC)
old = "    selectedAnswers: input.selectedAnswers,"
new = "    selectedAnswers: input.selectedAnswers ?? undefined,"
assert s.count(old) == 1, "selectedAnswers count=%d" % s.count(old)
s = s.replace(old, new)
save(SVC, s)
print("SVC selectedAnswers fix OK")
