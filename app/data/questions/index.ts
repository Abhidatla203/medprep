import pharmacology from "./pharmacology.json";

export type QuestionType = "essay" | "short-note" | "very-short";
export type Difficulty = "easy" | "medium" | "hard";

export interface TextbookRef {
  book: string;
  edition: string;
  chapter: string;
  page: number;
}

export interface Question {
  id: string;
  subject: string;
  topic: string;
  subtopic: string;
  marks: number;
  type: QuestionType;
  question: string;
  answer: string;
  textbookRef?: TextbookRef;
  keywords: string[];
  yearsAsked: number[];
  university: string;
  difficulty: Difficulty;
  needsDiagram: boolean;
}

export const allQuestions: Question[] = [
  ...(pharmacology as Question[]),
];

export const questionsBySubject = (subject: string): Question[] =>
  allQuestions.filter((q) => q.subject === subject);
