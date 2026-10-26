import type { DraftPhase, PhaseLimits } from '@/lib/types';
import { splitQuestion } from './phaseKinds';

export const DEFAULT_PHASE_LIMITS: PhaseLimits = {
  maxQuestionLength: 4000,
  maxOptionLength: 300,
  maxExpectedAnswerLength: 2000,
  maxStarterCodeLength: 4096,
  maxTestCasesLength: 4096,
};

export interface PhaseValidationErrors {
  question?: string;
  options?: Record<number, string>;
  quizGeneral?: string;
  expectedAnswer?: string;
  starterCode?: string;
  testCases?: string;
  fillGeneral?: string;
}

export type SetValidationErrors = Record<string, PhaseValidationErrors>;

export function hasErrors(errors: PhaseValidationErrors | undefined | null): boolean {
  if (!errors) return false;
  if (errors.question) return true;
  if (errors.quizGeneral) return true;
  if (errors.expectedAnswer) return true;
  if (errors.starterCode) return true;
  if (errors.testCases) return true;
  if (errors.fillGeneral) return true;
  if (errors.options && Object.keys(errors.options).length > 0) return true;
  return false;
}

export function validatePhase(
  phase: DraftPhase,
  limits: PhaseLimits,
): PhaseValidationErrors | null {
  const errors: PhaseValidationErrors = {};

  // 1. Enunciado (pergunta)
  const trimmedQuestion = phase.question.trim();
  if (!trimmedQuestion) {
    errors.question = 'O enunciado da questão é obrigatório.';
  } else if (phase.question.length > limits.maxQuestionLength) {
    errors.question = `O enunciado excede o limite máximo de ${limits.maxQuestionLength} caracteres.`;
  }

  // 2. Validações específicas por tipo de desafio
  if (phase.kind === 'quiz') {
    const optionErrors: Record<number, string> = {};

    // Não considerar alternativas vazias de forma silenciosa
    phase.options.forEach((opt, idx) => {
      const trimmedOpt = opt.trim();
      if (!trimmedOpt) {
        optionErrors[idx] = 'A alternativa não pode ficar vazia.';
      } else if (opt.length > limits.maxOptionLength) {
        optionErrors[idx] = `A alternativa excede o limite máximo de ${limits.maxOptionLength} caracteres.`;
      }
    });

    if (Object.keys(optionErrors).length > 0) {
      errors.options = optionErrors;
    }

    // Requisitos normais do quiz
    if (phase.options.length < 2) {
      errors.quizGeneral = 'O quiz deve conter no mínimo 2 alternativas.';
    } else if (phase.options.length > 8) {
      errors.quizGeneral = 'O quiz aceita no máximo 8 alternativas.';
    } else if (phase.correctIndexes.length === 0) {
      errors.quizGeneral = 'Assinale ao menos uma alternativa como correta.';
    } else if (phase.correctIndexes.length >= phase.options.length) {
      errors.quizGeneral = 'Não é possível assinalar todas as alternativas como corretas.';
    }
  } else if (phase.kind === 'text') {
    const trimmedAnswer = phase.expectedAnswer.trim();
    if (!trimmedAnswer) {
      errors.expectedAnswer = 'A resposta esperada é obrigatória.';
    } else if (phase.expectedAnswer.length > limits.maxExpectedAnswerLength) {
      errors.expectedAnswer = `A resposta esperada excede o limite máximo de ${limits.maxExpectedAnswerLength} caracteres.`;
    }
  } else if (phase.kind === 'code') {
    if (phase.starterCode.length > limits.maxStarterCodeLength) {
      errors.starterCode = `O código inicial excede o limite de ${limits.maxStarterCodeLength} caracteres.`;
    }
    if (phase.testCases.length > limits.maxTestCasesLength) {
      errors.testCases = `Os casos de teste excedem o limite de ${limits.maxTestCasesLength} caracteres.`;
    }
  } else if (phase.kind === 'fill') {
    const segments = splitQuestion(phase.question);
    const hasBlank = segments.some((s) => s.blankIndex !== null);
    if (!hasBlank && trimmedQuestion) {
      errors.fillGeneral = 'A frase com lacunas deve conter ao menos uma lacuna (use ___ ou PALAVRA).';
    }
  }

  return hasErrors(errors) ? errors : null;
}