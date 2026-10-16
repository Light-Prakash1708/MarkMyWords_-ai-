import { contentWords, paragraphs, sentences, type Sentence } from "../util/text";

/** Shared lexical feature extraction (used by the rule-based judge and by engine-level checks). */

export const DIMENSION_LEXICON: Record<string, RegExp> = {
  constitutional: /\b(articles?\s*\d+|constitution\w*|amendments?|fundamental rights?|directive principles?|schedules?|basic structure)\b/i,
  legal: /\b(\w+ act\b|acts?,?\s*(?:19|20)\d{2}|courts?|judg(?:e)?ments?|supreme court|high court|statut\w*|legal\w*|tribunals?|verdicts?|bench)\b/i,
  economic: /\b(econom\w*|fiscal|revenues?|gdp|growth|invest\w*|inflation|tax\w*|budget\w*|markets?|prices?|costs?|incomes?|employment|credit|interest rates?|subsid\w*|financ\w*|lending|deposits?)\b/i,
  social: /\b(social\w*|poor|poverty|women|girls|children|marginali[sz]ed|vulnerable|health|education|nutrition|equity|inclusi\w*|households?|caste|tribal|livelihoods?)\b/i,
  environmental: /\b(environment\w*|climate|emissions?|carbon|forests?|ecolog\w*|pollution|groundwater|biodiversity|renewable|ecosystems?)\b/i,
  international: /\b(international|global\w*|bilateral|multilateral|treat(?:y|ies)|agreements?|neighbou?r\w*|foreign|united nations|paris|wto|imf)\b/i,
  governance: /\b(governance|accountab\w*|transparen\w*|institution\w*|administrat\w*|implementation|capacity|bureaucra\w*|e-governance|citizens?|decentrali[sz]\w*|federal\w*|devolution)\b/i,
  technological: /\b(technolog\w*|digital|data|platforms?|artificial intelligence|internet|cyber|apps?|innovation|upi|software)\b/i,
  security: /\b(security|terror\w*|borders?|defen[cs]e|extremis\w*|threats?|attacks?|ransomware)\b/i,
};

export const DIMENSION_HINTS: Record<string, string> = {
  constitutional: "the relevant Articles or constitutional provisions",
  legal: "a relevant statute or court judgment",
  economic: "fiscal, market or income effects",
  social: "effects on households, vulnerable groups or social outcomes",
  environmental: "environmental or climate effects",
  international: "the external or international angle",
  governance: "institutions, implementation capacity or accountability",
  technological: "the role of technology or data",
  security: "security implications",
};

export const MARKERS = {
  contrast: /\b(however|but|on the other hand|critics|limitations?|drawbacks?|concerns?|challenges?|criticis\w*|downsides?|risks?|nevertheless|yet)\b/i,
  judgement: /\b(therefore|thus|hence|overall|on balance|in conclusion|way forward|to conclude|in sum|going forward|it can be concluded|in short)\b/i,
  causes: /\b(because|due to|owing to|caused by|driven by|as a result of|stems? from|since|given that|as long as)\b/i,
  effects: /\b(leads? to|led to|results? in|resulting|implications?|consequen\w*|impacts?|effects?|thereby|which means|so that|this means|in turn|so (?:their|its|the|that|banks|states|firms|farmers|households)|which (?:limits|reduces|raises|lowers|helps|allows|forces|keeps|weakens|strengthens|increases|delays)|enabl\w*|caus(?:es|ing)|allowing|forcing|with a lag|transmit\w*)\b/i,
  examples: /\b(for example|for instance|e\.g\.|such as|like the|illustrat\w*)\b/i,
  opinion: /\b(i believe|in my view|it is argued|arguably|should|must|needs? to|ought to)\b/i,
  positive: /\b(benefits?|advantages?|strengths?|helped|improved|achiev\w*|success\w*|positive|enabled|expanded)\b/i,
  criteria: /\b(criteri\w*|measured by|in terms of|effective\w*|outcomes?|performance)\b/i,
  assessment: /\b(effective|ineffective|successful|failed|partial(?:ly)?|limited|significant)\b/i,
  forward: /\b(way forward|going forward|ahead|future|should|need to|must|reform\w*)\b/i,
  outcome: /\b(increase[sd]?|reduce[sd]?|improve[sd]?|weaken\w*|slow\w*|delay\w*|affect\w*|rise[sn]?|fall[sn]?|decline[sd]?|boost\w*|hamper\w*|lower\w*|raise[sd]?)\b/i,
  filler: /\b(in today'?s world|since time immemorial|very very|basically|it is a well[- ]known fact|needless to say|in this modern era)\b/i,
  absolute: /\b(always|never|completely|totally|biggest|all problems|no one|everyone)\b/i,
};

export const EVIDENCE_PATTERNS: RegExp[] = [
  /\barticles?\s*\d+[a-z]?\b/gi,
  /\b[A-Z][\w-]*(?:\s+[A-Z][\w-]*)*\s+Act\b/g,
  /\b(?:19|20)\d{2}\b/g,
  /\b\d+(?:\.\d+)?\s*(?:%|per ?cent)\b/gi,
  /\b(?:committee|commission|report|survey|index)\b/gi,
  /\b(?:scheme|mission|yojana|abhiyan|programme|program)\b/gi,
  /\bv(?:s)?\.\s+[A-Z]/g,
  /\b(?:for example|for instance|e\.g\.|such as)\b/gi,
];

/** Lines that address the evaluator instead of the question (prompt-injection attempts). */
export const INJECTION_RE =
  /(\b(ignore|disregard|forget)\b[^.\n]{0,60}\b(rubric|instructions?|previous|above|criteria|rules)\b)|(\b(award|give|grant|assign)\b[^.\n]{0,20}\b(me|this answer|this|full)\b[^.\n]{0,20}(\d+\s*\/\s*\d+|full marks|maximum marks|top score))|(\byou are (now )?(an?|the) (evaluator|examiner|grader|ai)\b)|(\bsystem prompt\b)|(<\/?\s*(system|assistant|instructions?)\s*>)|(\bscore_kind\b)/i;

export interface AnswerFeatures {
  text: string;
  sentences: Sentence[];
  usableSentences: Sentence[];
  injectionSentences: Sentence[];
  paragraphs: { text: string; start: number; end: number }[];
  words: number;
  dimensions: Set<string>;
  evidenceCount: number;
  causalCount: number;
  bulletLines: number;
}

export function extractFeatures(text: string): AnswerFeatures {
  const sents = sentences(text);
  const injectionSentences = sents.filter((s) => INJECTION_RE.test(s.text));
  const usable = sents.filter((s) => !INJECTION_RE.test(s.text));
  const usableText = usable.map((s) => s.text).join(" ");
  const dims = new Set<string>();
  for (const [dim, re] of Object.entries(DIMENSION_LEXICON)) if (re.test(usableText)) dims.add(dim);
  let evidenceCount = 0;
  for (const re of EVIDENCE_PATTERNS) evidenceCount += (usableText.match(re) || []).length;
  const causalCount =
    (usableText.match(new RegExp(MARKERS.causes.source, "gi")) || []).length +
    (usableText.match(new RegExp(MARKERS.effects.source, "gi")) || []).length;
  const bulletLines = (text.match(/^\s*(?:[-•*]|\d+[.)])\s+/gm) || []).length;
  const words = (usableText.match(/[\p{L}\p{N}]+/gu) || []).length;
  return {
    text,
    sentences: sents,
    usableSentences: usable,
    injectionSentences,
    paragraphs: paragraphs(text),
    words,
    dimensions: dims,
    evidenceCount,
    causalCount,
    bulletLines,
  };
}

export function firstSentenceMatching(f: AnswerFeatures, re: RegExp): Sentence | undefined {
  return f.usableSentences.find((s) => re.test(s.text));
}

export function questionOverlap(answer: string, question: string): number {
  const q = new Set(contentWords(question));
  if (q.size === 0) return 0;
  const a = new Set(contentWords(answer));
  let hit = 0;
  for (const w of q) if (a.has(w) || [...a].some((x) => x.startsWith(w.slice(0, 6)) && w.length >= 6)) hit++;
  return hit / q.size;
}
