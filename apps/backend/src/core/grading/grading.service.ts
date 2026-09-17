// PHASE 12G-T14 — Grading Service
// Grades practice answers using frozen QuestionVersion snapshots.
// Never uses live Question/QuestionOption data — only frozen published versions.

export interface GradingInput {
  questionTypeCode: string;
  studentAnswer: {
    selectedAnswers?: string[];
    numericAnswer?: number | null;
  };
  snapshot: Record<string, unknown>;
  marks: number;
  negativeMarks?: number | null;
}

export interface GradingResult {
  correct: boolean;
  marksAwarded: number;
  negativeMarksApplied: number;
  details: Record<string, unknown>;
}

function getSnapshotValue<T>(snapshot: Record<string, unknown>, key: string): T | undefined {
  return snapshot[key] as T | undefined;
}

function getCorrectOptionIds(snapshot: Record<string, unknown>): string[] {
  const options = getSnapshotValue<Record<string, unknown>[]>(snapshot, "options");
  if (!options) return [];
  return options
    .filter((opt) => opt.isCorrect === true)
    .map((opt) => String(opt.id));
}

function getNumericAnswers(snapshot: Record<string, unknown>): Array<{
  value: number;
  toleranceAbs: number;
  toleranceRel: number;
  unit?: string;
  precision?: number;
}> {
  const numericAnswers = getSnapshotValue<Record<string, unknown>[]>(snapshot, "numericAnswers");
  if (!numericAnswers) return [];
  return numericAnswers.map((na) => ({
    value: Number(na.numericValue),
    toleranceAbs: Number(na.toleranceAbs ?? 0),
    toleranceRel: Number(na.toleranceRel ?? 0),
    unit: na.unit ? String(na.unit) : undefined,
    precision: na.precision ? Number(na.precision) : undefined,
  }));
}

export function gradePracticeAnswer(input: GradingInput): GradingResult {
  const { questionTypeCode, studentAnswer, snapshot, marks, negativeMarks } = input;

  const negativeMarksValue = negativeMarks !== undefined && negativeMarks !== null ? Number(negativeMarks) : 0;

  // Determine question type from code
  const isMCQ = questionTypeCode === "mcq";
  const isMSQ = questionTypeCode === "msq";
  const isNAT = questionTypeCode === "nat";

  // Unanswered check
  const isUnanswered = (!studentAnswer.selectedAnswers || studentAnswer.selectedAnswers.length === 0) &&
    (studentAnswer.numericAnswer === undefined || studentAnswer.numericAnswer === null);

  if (isUnanswered) {
    return {
      correct: false,
      marksAwarded: 0,
      negativeMarksApplied: 0,
      details: { reason: "unanswered" },
    };
  }

  // MCQ Grading: exactly one correct option
  if (isMCQ) {
    const correctOptionIds = getCorrectOptionIds(snapshot);
    const studentSelected = studentAnswer.selectedAnswers || [];

    const isCorrect = studentSelected.length === 1 &&
      correctOptionIds.length === 1 &&
      studentSelected[0] === correctOptionIds[0];

    const marksAwarded = isCorrect ? marks : 0;
    const negativeMarksApplied = isCorrect ? 0 : negativeMarksValue;

    return {
      correct: isCorrect,
      marksAwarded,
      negativeMarksApplied,
      details: {
        correctOptionIds,
        studentSelected,
      },
    };
  }

  // MSQ Grading: exact set match (all-or-nothing)
  if (isMSQ) {
    const correctOptionIds = getCorrectOptionIds(snapshot);
    const studentSelected = studentAnswer.selectedAnswers || [];

    // Exact set equality
    const isCorrect = correctOptionIds.length === studentSelected.length &&
      correctOptionIds.every((id) => studentSelected.includes(id));

    const marksAwarded = isCorrect ? marks : 0;
    const negativeMarksApplied = isCorrect ? 0 : negativeMarksValue;

    return {
      correct: isCorrect,
      marksAwarded,
      negativeMarksApplied,
      details: {
        correctOptionIds,
        studentSelected,
      },
    };
  }

  // NAT Grading: numeric tolerance
  if (isNAT) {
    const numericAnswers = getNumericAnswers(snapshot);
    const studentValue = studentAnswer.numericAnswer;

    if (studentValue === undefined || studentValue === null) {
      return {
        correct: false,
        marksAwarded: 0,
        negativeMarksApplied: 0,
        details: { reason: "no_numeric_answer" },
      };
    }

    let isCorrect = false;

    for (const na of numericAnswers) {
      const absDiff = Math.abs(studentValue - na.value);
      const withinAbs = absDiff <= na.toleranceAbs;
      const withinRel = na.value !== 0 && absDiff <= Math.abs(na.value * na.toleranceRel);

      if (withinAbs || withinRel) {
        isCorrect = true;
        break;
      }
    }

    const marksAwarded = isCorrect ? marks : 0;
    const negativeMarksApplied = isCorrect ? 0 : negativeMarksValue;

    return {
      correct: isCorrect,
      marksAwarded,
      negativeMarksApplied,
      details: {
        studentValue,
        expectedValues: numericAnswers.map((na) => na.value),
        tolerances: numericAnswers.map((na) => ({
          absolute: na.toleranceAbs,
          relative: na.toleranceRel,
        })),
      },
    };
  }

  // Unknown question type
  return {
    correct: false,
    marksAwarded: 0,
    negativeMarksApplied: 0,
    details: { reason: "unknown_question_type" },
  };
}