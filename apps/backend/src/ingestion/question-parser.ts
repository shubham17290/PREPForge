export interface ParsedQuestion {
  questionNumber: number | null;
  rawText: string;
  body: string;
  type: 'mcq' | 'msq' | 'nat' | 'unknown';
  options: ParsedOption[];
  answer: ParsedAnswer | null;
  marks: number | null;
  negativeMarks: number | null;
  gateYear: number | null;
  paperNumber: string | null;
  shift: string | null;
  sourceFile: string;
  warnings: string[];
}

export interface ParsedOption {
  label: string;
  body: string;
  isCorrect: boolean | null;
}

export interface ParsedAnswer {
  type: 'option' | 'options' | 'numeric' | 'numeric_range';
  value: string | string[] | number | null;
  tolerance?: number;
  rawText: string;
}

export interface MarksRange {
  start: number;
  end: number;
  marks: number;
}

export interface QuestionBoundary {
  startIndex: number;
  endIndex: number;
  questionNumber: number;
  rawText: string;
}

const PAGE_SEPARATOR_PATTERN = /^--\s*\d+\s+of\s+\d+\s*--$/;
const QUESTION_INLINE_PATTERN = /^\s*Q\.\s*(\d{1,2})\s+\S/i;
const QUESTION_FOOTER_PATTERN = /^\s*Q\.\s*(\d{1,2})\s*$/i;
const QUESTION_RANGE_PATTERN = /^\s*Q\.\s*\d{1,2}\s*[–-]\s*Q\.\s*\d{1,2}\s+Carry\b/i;

const HEADER_PATTERNS = [
  /^Computer Science/i,
  /^Organizing Institute/i,
  /^Page \d+ of \d+/i,
  /^GATE \d{4}/i,
  /^CS\s+Page/i,
  /^–\s*Q\.\d+/,
  /^\d+ of \d+ --/,
  /^--\s+\d+\s+of\s+\d+\s+--$/,
  /^Q\.\d+\s*[–-]\s*Q\.\d+\s+Carry/i,
];

const OPTION_PATTERNS = [
  // "(A) body" — label in parens at line start, followed by the option body.
  /^\s*\(\s*([A-D])\s*\)\s*(.+)$/m,
  // "[A] body" — label in brackets at line start.
  /^\s*\[\s*([A-D])\s*\]\s*(.+)$/m,
  // "A. body" — label followed by a period then the body.
  /^\s*([A-D])\.\s+(.+)$/m,
];

// A lone "(A)" on a single line denotes an option label with no inline body (the
// body follows on subsequent lines) — e.g. GATE options drawn as diagrams/trees.
const STANDALONE_OPTION_LABEL_PATTERN = /^\s*\([A-D]\)\s*$/;

const ANSWER_KEY_PATTERNS = [
  /answer\s*[:=]\s*([A-D])/i,
  /correct\s*(?:answer|option)\s*[:=]\s*([A-D])/i,
  /key\s*[:=]\s*([A-D])/i,
];

const MARKS_PATTERNS = [
  /carry\s+(?:one|two)\s+mark[s]?\s+(?:each)?/i,
  /\((\d+)\s*marks?\)/i,
  /marks?\s*[:=]\s*(\d+(?:\.\d+)?)/i,
];

const NEGATIVE_MARKS_PATTERNS = [
  /negative\s+marks?\s*[:=]\s*(\d+(?:\.\d+)?)/i,
  /penalty\s*[:=]\s*(\d+(?:\.\d+)?)/i,
];

const MSQ_INDICATORS = [
  /one\s+or\s+more\s+(?:of\s+the\s+following\s+)?(?:option|answer)/i,
  /multiple\s+(?:correct|select)/i,
  /select\s+(?:all\s+that\s+apply|multiple)/i,
];

const NAT_INDICATORS = [
  /answer\s*(?:is|:)\s*\d+/i,
  /numerical\s+answer/i,
  /fill\s+in\s+the\s+blank/i,
  /_{3,}/,
  /the value of .* is\s*\./i,
  /^is\s+\.$/i,
  /the number of .* is\s*\./i,
  // NAT answer blanks in the extracted PDF text. GATE NAT questions print an empty
  // answer box where the numeric answer goes; the extractor renders that box as a tab
  // followed by a period ("\t.") at the end of the question statement.
  /\t\s*\./i,
  // When the answer box is followed by a unit (e.g. "is ___ ns."), the extractor can
  // render the box as a line break: "is\nns.". This only fires for a line ending in
  // the standalone word "is" whose next line is a short unit fragment ending in ".".
  /\bis\s*\n\s*[A-Za-z]{1,8}\s*\./i,
  // "Rounded off to <precision>" is NAT-only phrasing (MCQ/MSQ answers are fixed
  // options and are never rounded to a decimal place).
  /rounded\s+off\s+to\b/i,
];

function detectQuestionType(text: string): 'mcq' | 'msq' | 'nat' | 'unknown' {
  const lowerText = text.toLowerCase();

  // A question that presents genuine labeled (A)-(D) choices is MCQ/MSQ — even if its
  // stem also contains a fill-in blank. Count real option-label *lines*: a line that
  // starts (modulo indentation) with "(A)"/"[A]"/"A." . This deliberately excludes
  // mid-line matrix notation like "det(A)" or "(A, B)" and stem sentences like
  // "A 4 kilobyte...", which a bare "(A)" anywhere would wrongly match.
  const labelCount = (text.match(/^\s*(\(\s*[A-D]\s*\)|\[\s*[A-D]\s*\]|[A-D]\.)/gm) || []).length;
  if (labelCount >= 2) {
    for (const indicator of MSQ_INDICATORS) {
      if (indicator.test(lowerText)) return 'msq';
    }
    return 'mcq';
  }

  for (const indicator of NAT_INDICATORS) {
    if (indicator.test(lowerText)) return 'nat';
  }

  for (const indicator of MSQ_INDICATORS) {
    if (indicator.test(lowerText)) return 'msq';
  }

  return 'unknown';
}

function extractOptions(text: string, type: ParsedQuestion['type']): ParsedOption[] {
  // NAT questions carry no labeled choices.
  if (type === 'nat') {
    return [];
  }

  const options: ParsedOption[] = [];
  const textNormalized = normalizeDashes(text);
  const lines = textNormalized.split('\n');
  let label: string | null = null;
  let bodyParts: string[] = [];

  const flush = () => {
    if (label !== null) {
      const body = bodyParts.join('\n').trim();
      if (body.length > 0) {
        options.push({ label, body, isCorrect: null });
      }
      label = null;
      bodyParts = [];
    }
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();

    // Does this line start a new option label? Handles "(A) body", "(A)", "[A] body",
    // and "A. body". Anchored to line start so mid-line tokens like "det(A)" or
    // stem sentences like "A 4 kilobyte..." are never treated as labels.
    const match = trimmed.match(/^\s*(?:\(\s*([A-D])\s*\)|[\[][A-D][]]\s*|([A-D])\.\s*)(.*)$/);
    if (match) {
      flush();
      label = (match[1] || match[2]).toUpperCase();
      const inlineBody = (match[3] || '').trim();
      if (inlineBody.length > 0) {
        bodyParts.push(inlineBody);
      }
      continue;
    }

    // Not a label line — collect as body only while an option is open.
    if (label !== null) {
      if (trimmed.length === 0) continue; // blank lines don't terminate a body
      if (isHeaderLine(trimmed) || PAGE_SEPARATOR_PATTERN.test(trimmed)) {
        flush();
        continue;
      }
      bodyParts.push(trimmed);
    }
  }

  flush();
  return options;
}

function extractAnswer(text: string, type: ParsedQuestion['type']): ParsedAnswer | null {
  if (type === 'nat') {
    const numMatch = text.match(/answer\s*(?:is|:)\s*([\d.\-eE]+)/i);
    if (numMatch) {
      return {
        type: 'numeric',
        value: parseFloat(numMatch[1]),
        rawText: numMatch[0],
      };
    }
    const blankMatch = text.match(/_{3,}/);
    if (blankMatch) {
      return {
        type: 'numeric',
        value: null,
        rawText: '[blank]',
      };
    }
  }

  if (type === 'msq') {
    const answers: string[] = [];
    for (const pattern of ANSWER_KEY_PATTERNS) {
      const matches = text.matchAll(new RegExp(pattern.source, 'gi'));
      for (const match of matches) {
        if (match[1] && !answers.includes(match[1].toUpperCase())) {
          answers.push(match[1].toUpperCase());
        }
      }
    }
    if (answers.length > 0) {
      return { type: 'options', value: answers, rawText: answers.join(', ') };
    }
  }

  if (type === 'mcq') {
    for (const pattern of ANSWER_KEY_PATTERNS) {
      const match = text.match(pattern);
      if (match) {
        return {
          type: 'option',
          value: match[1].toUpperCase(),
          rawText: match[0],
        };
      }
    }
  }

  return null;
}

function extractMarks(text: string, questionNumber: number, marksRanges: MarksRange[]): { marks: number | null; negativeMarks: number | null } {
  let marks: number | null = null;
  let negativeMarks: number | null = null;

  const oneMarkMatch = text.match(/carry\s+one\s+mark/i);
  const twoMarkMatch = text.match(/carry\s+two\s+marks?/i);

  if (oneMarkMatch) marks = 1;
  else if (twoMarkMatch) marks = 2;

  for (const pattern of MARKS_PATTERNS) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const val = parseFloat(match[1]);
      if (!isNaN(val)) marks = val;
      break;
    }
  }

  if (marks === null && marksRanges.length > 0) {
    for (const range of marksRanges) {
      if (questionNumber >= range.start && questionNumber <= range.end) {
        marks = range.marks;
        break;
      }
    }
  }

  for (const pattern of NEGATIVE_MARKS_PATTERNS) {
    const match = text.match(pattern);
    if (match && match[1]) {
      negativeMarks = parseFloat(match[1]);
      break;
    }
  }

  return { marks, negativeMarks };
}

function cleanBodyText(text: string, questionNumber: number): string {
  let body = text;

  body = body.replace(new RegExp(`^Q\\s*\\.?\\s*${questionNumber}\\s*`, 'i'), '');
  body = body.replace(/^\d+\.\s*/, '');
  body = body.replace(/^Q\s*\d+\s*/i, '');

  const optionStart = body.search(/\([A-D]\)/i);
  if (optionStart !== -1) {
    body = body.substring(0, optionStart);
  }

  const answerStart = Math.min(
    ...[body.toLowerCase().indexOf('answer'),
     body.toLowerCase().indexOf('correct'),
     body.toLowerCase().indexOf('key')]
      .filter(i => i !== -1)
  );

  if (answerStart !== -1 && answerStart > 50) {
    body = body.substring(0, answerStart);
  }

  return body.trim();
}

const DASH_CODES = [8208, 8209, 8210, 8211, 8212, 8213, 8722];
function normalizeDashes(value: string): string {
  let out = value;
  for (const c of DASH_CODES) { out = out.split(String.fromCharCode(c)).join('-'); }
  return out;
}
function isRangeDirective(value: string): boolean {
  const t = normalizeDashes(value).trim().toLowerCase();
  if (t.indexOf('q.') !== 0) return false;
  const ci = t.indexOf('carry');
  if (ci < 0) return false;
  const head = t.slice(0, ci);
  if (head.indexOf('-') < 0) return false;
  if (head.indexOf('q.', 2) < 0) return false;
  return true;
}
function isPageNoise(value: string): boolean {
  const t = value.trim().toLowerCase();
  if (t.indexOf('page ') === 0 && t.indexOf(' of ') > 4) return true;
  if (t.indexOf('--') === 0) return true;
  if (/^\d+\s+of\s+\d+\s*-/.test(t)) return true;
  return false;
}
function isHeaderLine(line: string): boolean {
  const normalized = normalizeDashes(line);
  for (const pattern of HEADER_PATTERNS) {
    if (pattern.test(normalized)) return true;
  }
  if (isRangeDirective(line)) return true;
  if (isPageNoise(line)) return true;
  return false;
}

export function detectQuestionBoundaries(text: string): QuestionBoundary[] {
  const textNormalized = normalizeDashes(text);
  const lines = textNormalized.split('\n');
  void QUESTION_RANGE_PATTERN;
  if (lines.length === 0) return [];

  // 1) Group lines into page segments using the trailing "— N of M —" separators.
  //    GATE question bodies begin at the top of the PDF page they are printed on, so
  //    anchoring boundaries to page structure keeps option/diagram/explanation text
  //    inside the question it belongs to.
  const pageSegments: Array<{ startLine: number; endLine: number }> = [];
  let segmentStart = 0;
  for (let i = 0; i < lines.length; i++) {
    if (PAGE_SEPARATOR_PATTERN.test(lines[i].trim())) {
      pageSegments.push({ startLine: segmentStart, endLine: i });
      segmentStart = i + 1;
    }
  }
  pageSegments.push({ startLine: segmentStart, endLine: lines.length });

  // 2) Collect a question-start candidate for every page that can be labelled.
  //    - Inline marker "Q.N <content>" (used by the GA section) anchors directly.
  //    - A standalone bare "Q.N" line labels the page's first content line, whether
  //      it is printed at the top of the page with the body below it (e.g. GATE 2022
  //      Q.8) or as the LAST meaningful line of a page. Range directives like
  //      "Q.6 – Q.10 Carry TWO marks Each" are page headers and never treated as
  //      questions.
  const starts: Array<{ questionNumber: number; startIndex: number }> = [];

  for (const segment of pageSegments) {
    const inlineMarkers: Array<{ questionNumber: number; lineIndex: number }> = [];
    let footerCandidate: { questionNumber: number; lineIndex: number } | null = null;
    let firstContentIndex: number | null = null;
    let lastMeaningfulIndex = -1;

    for (let i = segment.startLine; i < segment.endLine; i++) {
      const trimmed = lines[i].trim();
      if (trimmed.length === 0) continue;
      if (isHeaderLine(trimmed)) continue;
      if (isRangeDirective(trimmed)) continue;
      if (isPageNoise(trimmed)) continue;

      lastMeaningfulIndex = i;

      const inlineMatch = trimmed.match(QUESTION_INLINE_PATTERN);
      if (inlineMatch) {
        const qNum = parseInt(inlineMatch[1], 10);
        if (qNum > 0) {
          inlineMarkers.push({ questionNumber: qNum, lineIndex: i });
        }
        if (firstContentIndex === null) firstContentIndex = i;
        continue;
      }

      const footerMatch = trimmed.match(QUESTION_FOOTER_PATTERN);
      if (footerMatch) {
        const qNum = parseInt(footerMatch[1], 10);
        if (qNum > 0) {
          footerCandidate = { questionNumber: qNum, lineIndex: i };
        }
        continue;
      }

      if (firstContentIndex === null) firstContentIndex = i;
    }

    if (inlineMarkers.length > 0) {
      for (const marker of inlineMarkers) {
        starts.push({ questionNumber: marker.questionNumber, startIndex: marker.lineIndex });
      }
    } else if (
      footerCandidate !== null &&
      firstContentIndex !== null &&
      (footerCandidate.lineIndex === lastMeaningfulIndex ||
        footerCandidate.lineIndex < firstContentIndex)
    ) {
      // A bare "Q.N" line labels the page's first content line whether it sits at
      // the top of the page with the body printed below it (e.g. GATE 2022 Q.8) or
      // as a trailing footer on the previous page.
      starts.push({ questionNumber: footerCandidate.questionNumber, startIndex: firstContentIndex });
    }
  }

  // 3) Collapse consecutive duplicate numbers. A question spanning several pages is
  //    labelled once per page; keeping only the first label lets the earlier boundary
  //    extend across the whole question.
  const dedupedStarts: Array<{ questionNumber: number; startIndex: number }> = [];
  for (const candidate of starts) {
    const previous = dedupedStarts[dedupedStarts.length - 1];
    if (previous && previous.questionNumber === candidate.questionNumber) continue;
    dedupedStarts.push(candidate);
  }

  // 4) Build boundaries [startIndex, nextStart) and strip structural noise (page
  //    headers/separators, redundant footer labels, blank lines) from rawText.
  const boundaries: QuestionBoundary[] = [];
  for (let i = 0; i < dedupedStarts.length; i++) {
    const startIndex = dedupedStarts[i].startIndex;
    const endIndex = i < dedupedStarts.length - 1 ? dedupedStarts[i + 1].startIndex : lines.length;


    const contentLines: string[] = [];
    for (let j = startIndex; j < endIndex; j++) {
      const trimmed = lines[j].trim();
      if (trimmed.length === 0) continue;
      if (isHeaderLine(lines[j])) continue;
      if (QUESTION_FOOTER_PATTERN.test(trimmed)) continue;
      contentLines.push(lines[j]);
    }

    const rawText = contentLines.join('\n').trim();
    if (rawText.length <= 20) continue;

    boundaries.push({
      startIndex,
      endIndex: endIndex - 1,
      questionNumber: dedupedStarts[i].questionNumber,
      rawText,
    });
  }

  return boundaries;
}

export function parseQuestion(
  boundary: QuestionBoundary,
  sourceFile: string,
  defaultYear: number | null,
  defaultPaper: string | null,
  defaultShift: string | null,
  marksRanges: MarksRange[] = []
): ParsedQuestion {
  const warnings: string[] = [];
  const text = boundary.rawText;

  const type = detectQuestionType(text);
  if (type === 'unknown') {
    warnings.push('Could not determine question type (MCQ/MSQ/NAT)');
  }

  const options = extractOptions(text, type);
  if ((type === 'mcq' || type === 'msq') && options.length < 2) {
    warnings.push(`Expected at least 2 options for ${type.toUpperCase()}, found ${options.length}`);
  }

  const answer = extractAnswer(text, type);
  if (!answer && type !== 'unknown') {
    warnings.push('No answer found in extracted text');
  }

  const { marks, negativeMarks } = extractMarks(text, boundary.questionNumber ?? 0, marksRanges);
  if (marks === null) {
    warnings.push('Marks not specified in question text');
  }

  const body = cleanBodyText(text, boundary.questionNumber);
  if (body.length < 10) {
    warnings.push('Question body appears too short');
  }

  return {
    questionNumber: boundary.questionNumber,
    rawText: boundary.rawText,
    body,
    type,
    options,
    answer,
    marks,
    negativeMarks,
    gateYear: defaultYear,
    paperNumber: defaultPaper,
    shift: defaultShift,
    sourceFile,
    warnings,
  };
}