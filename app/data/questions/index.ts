import pharmacology from "./pharmacology.json";

export type QuestionType = "essay" | "short-note" | "very-short";
export type Difficulty = "easy" | "medium" | "hard";

export interface Question {
  id: string;
  subject: string;
  topic: string;
  subtopic: string;
  marks: number;
  originalMarks: string;
  type: QuestionType;
  question: string;
  parts: string[];
  answer: string;
  keywords: string[];
  yearsAsked: number[];
  university: string;
  difficulty: Difficulty;
  needsDiagram: boolean;
  source: string;
}

export const allQuestions: Question[] = [
  ...(pharmacology as Question[]),
];

export const questionsBySubject = (subject: string): Question[] =>
  allQuestions.filter((q) => q.subject === subject);
