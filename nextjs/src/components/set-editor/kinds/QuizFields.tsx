'use client';

import { useRef, useState, useTransition } from 'react';

import { Button, Popover, Tooltip, anchorFrom, type AnchorRect } from '@/components/ds';
import { Icon } from '@/components/icons/Icons';
import { decideGenerationAction, suggestQuizOptionsAction } from '@/lib/actions/ai';
import { cx } from '@/lib/cx';
import type {
  AiUsage,
  QuizDraftPhase,
  QuizOptionSuggestion,
  QuizSuggestionMode,
} from '@/lib/types';
import { formatAiErrorMessage } from '../ai/aiErrors';
import shared from '../PhaseForm.module.css';
import styles from './QuizFields.module.css';

/** Limites de alternativas num quiz — abaixo de 2 não há escolha, acima de 8 não cabe na tela. */
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 8;

const SUGGESTION_MODES: { id: QuizSuggestionMode; label: string }[] = [
  { id: 'distractors', label: 'Distratores' },
  { id: 'correct', label: 'Corretas' },
  { id: 'any', label: 'Mistura' },
];

const SUGGESTION_COUNTS = [2, 3, 4];

interface QuizFieldsProps {
  phase: QuizDraftPhase;
  onChange: (patch: Partial<QuizDraftPhase>) => void;
  aiUsage?: AiUsage | null;
  onUsageChange?: (usage: AiUsage) => void;
}

export function QuizFields({
  phase,
  onChange,
  aiUsage = null,
  onUsageChange,
}: QuizFieldsProps) {
  const [alert, setAlert] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const [popoverAnchor, setPopoverAnchor] = useState<AnchorRect | null>(null);
  const [suggestMode, setSuggestMode] = useState<QuizSuggestionMode>('distractors');
  const [suggestCount, setSuggestCount] = useState<number>(3);
  const [suggestions, setSuggestions] = useState<QuizOptionSuggestion[]>([]);
  const [suggestionGenId, setSuggestionGenId] = useState<string | null>(null);
  const [acceptedCount, setAcceptedCount] = useState<number>(0);
  const [suggesting, startSuggestTransition] = useTransition();

  const aiEnabled = aiUsage?.enabled !== false;
  const filledOptionsCount = phase.options.filter((opt) => opt.trim() !== '').length;
  const remainingSlots = Math.max(0, MAX_OPTIONS - filledOptionsCount);
  const dailyExceeded =
    aiUsage !== null &&
    aiUsage.suggestionsDailyLimit > 0 &&
    aiUsage.suggestionsUsedToday >= aiUsage.suggestionsDailyLimit;

  function toggleCorrect(index: number) {
    const current = phase.correctIndexes;
    if (current.includes(index)) {
      // Uma fase sem gabarito não tem como ser corrigida.
      if (current.length === 1) return;
      onChange({ correctIndexes: current.filter((i) => i !== index) });
      return;
    }

    const next = [...current, index].sort((a, b) => a - b);
    // Se tudo estiver certo, a pergunta deixa de discriminar qualquer coisa.
    if (next.length >= phase.options.length) {
      setAlert('Não é possível selecionar todas as alternativas como corretas.');
      return;
    }
    onChange({ correctIndexes: next });
  }

  function handleRequestSuggestions() {
    if (!phase.question.trim() || remainingSlots === 0 || dailyExceeded || suggesting) return;
    setAlert(null);
    setPopoverAnchor(null);

    if (suggestionGenId && suggestions.length > 0) {
      void decideGenerationAction(
        suggestionGenId,
        acceptedCount > 0 ? 'partial' : 'discarded',
        acceptedCount,
      );
    }

    const effectiveCount = Math.min(suggestCount, remainingSlots);

    startSuggestTransition(async () => {
      const result = await suggestQuizOptionsAction({
        question: phase.question,
        options: phase.options,
        correctIndexes: phase.correctIndexes,
        count: effectiveCount,
        mode: suggestMode,
      });

      if (!result.ok) {
        if (result.usage) {
          onUsageChange?.(result.usage);
        }
        setAlert(formatAiErrorMessage(result.code, result.message));
        return;
      }

      onUsageChange?.(result.data.usage);
      setSuggestions(result.data.suggestions);
      setSuggestionGenId(result.data.generationId);
      setAcceptedCount(0);
    });
  }

  function handleAddSuggestion(suggestion: QuizOptionSuggestion, index: number) {
    const nextOptions = [...phase.options];
    let targetIdx = nextOptions.length;

    // Se a última opção for um slot vazio em aberto, preenche ele antes de criar outro
    if (nextOptions.length > 0 && nextOptions[nextOptions.length - 1].trim() === '') {
      targetIdx = nextOptions.length - 1;
      nextOptions[targetIdx] = suggestion.label;
      if (nextOptions.length < MAX_OPTIONS) {
        nextOptions.push('');
      }
    } else if (nextOptions.length < MAX_OPTIONS) {
      nextOptions.push(suggestion.label);
    } else {
      setAlert('A fase já atingiu o limite máximo de 8 alternativas.');
      return;
    }

    let nextCorrect = [...phase.correctIndexes];
    if (suggestion.isCorrect && !nextCorrect.includes(targetIdx)) {
      const candidate = [...nextCorrect, targetIdx].sort((a, b) => a - b);
      if (candidate.length < nextOptions.length) {
        nextCorrect = candidate;
      }
    }

    onChange({ options: nextOptions, correctIndexes: nextCorrect });

    const remaining = suggestions.filter((_, i) => i !== index);
    const nextAccepted = acceptedCount + 1;
    setSuggestions(remaining);
    setAcceptedCount(nextAccepted);

    if (remaining.length === 0 && suggestionGenId) {
      void decideGenerationAction(suggestionGenId, 'accepted', nextAccepted);
      setSuggestionGenId(null);
    }
  }

  function handleDismissSuggestions() {
    if (suggestionGenId) {
      void decideGenerationAction(
        suggestionGenId,
        acceptedCount > 0 ? 'partial' : 'discarded',
        acceptedCount,
      );
    }
    setSuggestions([]);
    setSuggestionGenId(null);
    setAcceptedCount(0);
  }

  function reorderOptions(from: number, to: number) {
    if (
      from === to ||
      from < 0 ||
      to < 0 ||
      from >= phase.options.length ||
      to >= phase.options.length
    ) {
      return;
    }

    const nextOptions = [...phase.options];
    const [moved] = nextOptions.splice(from, 1);
    nextOptions.splice(to, 0, moved);

    const indexMap = new Map<number, number>();
    for (let oldIndex = 0; oldIndex < phase.options.length; oldIndex++) {
      if (oldIndex === from) {
        indexMap.set(oldIndex, to);
      } else if (from < to && oldIndex > from && oldIndex <= to) {
        indexMap.set(oldIndex, oldIndex - 1);
      } else if (from > to && oldIndex >= to && oldIndex < from) {
        indexMap.set(oldIndex, oldIndex + 1);
      } else {
        indexMap.set(oldIndex, oldIndex);
      }
    }

    const correctIndexes = phase.correctIndexes
      .map((i) => indexMap.get(i))
      .filter((i): i is number => i !== undefined)
      .sort((a, b) => a - b);

    onChange({ options: nextOptions, correctIndexes });
  }

  function handleDrop(target: number) {
    const from = dragIndex;
    setDragIndex(null);
    setOverIndex(null);
    if (from === null || from === target) return;
    reorderOptions(from, target);
  }

  function shuffleOptions() {
    if (phase.options.length <= 1) return;

    const hasTrailingEmpty =
      phase.options.length > MIN_OPTIONS &&
      phase.options[phase.options.length - 1].trim() === '';

    const countToShuffle = hasTrailingEmpty
      ? phase.options.length - 1
      : phase.options.length;

    if (countToShuffle <= 1) return;

    const pairs = phase.options.slice(0, countToShuffle).map((option, index) => ({
      option,
      isCorrect: phase.correctIndexes.includes(index),
    }));

    for (let i = pairs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pairs[i], pairs[j]] = [pairs[j], pairs[i]];
    }

    const nextOptions = pairs.map((p) => p.option);
    if (hasTrailingEmpty) {
      nextOptions.push(phase.options[phase.options.length - 1]);
    }

    const correctIndexes = pairs
      .map((p, i) => (p.isCorrect ? i : -1))
      .filter((i) => i !== -1);

    if (hasTrailingEmpty && phase.correctIndexes.includes(phase.options.length - 1)) {
      correctIndexes.push(phase.options.length - 1);
    }

    onChange({
      options: nextOptions,
      correctIndexes: correctIndexes.length > 0 ? correctIndexes.sort((a, b) => a - b) : [0],
    });
  }

  function removeOptionAt(index: number) {
    if (phase.options.length <= MIN_OPTIONS) return;

    const nextOptions = phase.options.filter((_, i) => i !== index);

    let correctIndexes = phase.correctIndexes
      .filter((i) => i !== index)
      .map((i) => (i > index ? i - 1 : i));

    if (correctIndexes.length >= nextOptions.length) {
      correctIndexes = correctIndexes.slice(0, -1);
    }
    if (correctIndexes.length === 0) {
      correctIndexes = [0];
    }

    onChange({ options: nextOptions, correctIndexes });

    const targetIndex = Math.max(0, index - 1);
    setTimeout(() => {
      const el = inputRefs.current[targetIndex];
      if (el) {
        el.focus();
        const len = el.value.length;
        el.setSelectionRange(len, len);
      }
    }, 0);
  }

  function trimTrailingEmpty() {
    const nextOptions = [...phase.options];
    while (nextOptions.length > MIN_OPTIONS && nextOptions[nextOptions.length - 1].trim() === '') {
      nextOptions.pop();
    }
    if (nextOptions.length < phase.options.length) {
      let correctIndexes = phase.correctIndexes.filter((i) => i < nextOptions.length);
      if (correctIndexes.length >= nextOptions.length) correctIndexes = correctIndexes.slice(0, -1);
      if (correctIndexes.length === 0) correctIndexes = [0];
      onChange({ options: nextOptions, correctIndexes });
    }
  }

  function handleOptionChange(index: number, value: string) {
    const nextOptions = phase.options.map((opt, i) => (i === index ? value : opt));
    const wasEmpty = phase.options[index].trim() === '';
    const nowFilled = value.trim() !== '';

    if (
      wasEmpty &&
      nowFilled &&
      nextOptions.length < MAX_OPTIONS &&
      nextOptions.every((opt) => opt.trim() !== '')
    ) {
      nextOptions.push('');
    }

    if (
      !nowFilled &&
      index < nextOptions.length - 1 &&
      nextOptions.length > MIN_OPTIONS &&
      nextOptions[nextOptions.length - 1].trim() === ''
    ) {
      nextOptions.pop();
    }

    let correctIndexes = phase.correctIndexes;
    if (nextOptions.length < phase.options.length) {
      correctIndexes = correctIndexes.filter((i) => i < nextOptions.length);
      if (correctIndexes.length >= nextOptions.length) correctIndexes = correctIndexes.slice(0, -1);
      if (correctIndexes.length === 0) correctIndexes = [0];
    }

    onChange({ options: nextOptions, correctIndexes });
  }

  function handleInputBlur(index: number) {
    if (
      index === phase.options.length - 1 &&
      phase.options[index].trim() === '' &&
      phase.options.length > MIN_OPTIONS
    ) {
      removeOptionAt(index);
    }
  }

  function handleContainerBlur(event: React.FocusEvent<HTMLDivElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node)) {
      return;
    }
    trimTrailingEmpty();
  }

  function handleKeyDown(index: number, event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Backspace' && phase.options[index] === '') {
      if (phase.options.length > MIN_OPTIONS) {
        event.preventDefault();
        removeOptionAt(index);
      } else if (index > 0) {
        event.preventDefault();
        const prevInput = inputRefs.current[index - 1];
        if (prevInput) {
          prevInput.focus();
          const len = prevInput.value.length;
          prevInput.setSelectionRange(len, len);
        }
      }
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      if (phase.options.length >= MAX_OPTIONS) return;

      // Se a próxima alternativa já existe e está vazia, apenas foca nela
      if (
        index + 1 < phase.options.length &&
        phase.options[index + 1].trim() === ''
      ) {
        inputRefs.current[index + 1]?.focus();
        return;
      }

      // Adiciona uma nova alternativa logo após a atual
      const nextOptions = [...phase.options];
      nextOptions.splice(index + 1, 0, '');

      const correctIndexes = phase.correctIndexes.map((i) =>
        i > index ? i + 1 : i,
      );

      onChange({ options: nextOptions, correctIndexes });

      setTimeout(() => {
        inputRefs.current[index + 1]?.focus();
      }, 0);
      return;
    }
  }

  const questionEmpty = !phase.question.trim();
  const suggestButtonDisabled =
    questionEmpty || remainingSlots === 0 || dailyExceeded || suggesting;

  return (
    <div className={shared.field} onBlur={handleContainerBlur}>
      <div className={shared.labelRow}>
        <span className={shared.label}>Alternativas · marque uma ou mais corretas</span>
        <div className={styles.headerActions}>
          {aiEnabled && (
            <button
              type="button"
              className={styles.aiSuggestButton}
              disabled={suggestButtonDisabled}
              onClick={(event) => setPopoverAnchor(anchorFrom(event.currentTarget))}
              title={
                questionEmpty
                  ? 'Escreva a pergunta antes de pedir sugestões da IA'
                  : remainingSlots === 0
                    ? 'Limite máximo de 8 alternativas atingido'
                    : 'Sugerir novas alternativas com IA'
              }
            >
              <Icon.Sparkle size={14} />
              <span>{suggesting ? 'Sugerindo...' : 'Sugerir com IA'}</span>
            </button>
          )}

          <button
            type="button"
            className={styles.shuffleButton}
            onClick={shuffleOptions}
            title="Reordenar alternativas aleatoriamente"
          >
            <Icon.Shuffle size={14} />
            <span>Alternar ordem</span>
          </button>
        </div>
      </div>

      {popoverAnchor && (
        <Popover
          anchor={popoverAnchor}
          width={280}
          align="end"
          estimatedHeight={220}
          label="Sugerir alternativas com IA"
          onClose={() => setPopoverAnchor(null)}
        >
          <div className={styles.popoverBody}>
            <div className={styles.popoverSection}>
              <span className={styles.popoverLabel}>Tipo de sugestão</span>
              <div className={styles.popoverChips}>
                {SUGGESTION_MODES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className={cx(
                      styles.popoverChip,
                      suggestMode === m.id && styles.popoverChipActive,
                    )}
                    onClick={() => setSuggestMode(m.id)}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.popoverSection}>
              <span className={styles.popoverLabel}>Quantidade</span>
              <div className={styles.popoverChips}>
                {SUGGESTION_COUNTS.filter((c) => c <= Math.max(2, remainingSlots)).map((count) => (
                  <button
                    key={count}
                    type="button"
                    className={cx(
                      styles.popoverChip,
                      suggestCount === count && styles.popoverChipActive,
                    )}
                    onClick={() => setSuggestCount(count)}
                  >
                    {count} opções
                  </button>
                ))}
              </div>
            </div>

            {aiUsage && (
              <div className={styles.popoverQuota}>
                <span>
                  Sugestões hoje: {aiUsage.suggestionsUsedToday} / {aiUsage.suggestionsDailyLimit}
                </span>
                <span>Grátis</span>
              </div>
            )}

            <Button size="sm" onClick={handleRequestSuggestions}>
              Gerar sugestões
            </Button>
          </div>
        </Popover>
      )}

      {alert && (
        <div className={styles.alert} role="alert">
          <Icon.Alert size={18} className={styles.alertIcon} />
          <span>{alert}</span>
          <button
            type="button"
            className={styles.alertClose}
            onClick={() => setAlert(null)}
            aria-label="Fechar aviso"
          >
            <Icon.Close size={14} />
          </button>
        </div>
      )}

      {phase.options.map((option, index) => {
        const isCorrect = phase.correctIndexes.includes(index);
        return (
          <div
            key={index}
            className={cx(
              styles.optionRow,
              dragIndex === index && styles.rowDragging,
              overIndex === index && dragIndex !== index && styles.rowDropTarget,
            )}
            onDragOver={(e) => {
              e.preventDefault();
              setOverIndex(index);
            }}
            onDrop={() => handleDrop(index)}
          >
            <button
              type="button"
              className={cx(styles.mark, isCorrect && styles.markCorrect)}
              onClick={() => toggleCorrect(index)}
              aria-pressed={isCorrect}
              aria-label={`Marcar alternativa ${index + 1} como correta`}
            >
              {isCorrect && <Icon.Check size={13} />}
            </button>
            <input
              ref={(el) => {
                inputRefs.current[index] = el;
              }}
              className={shared.input}
              placeholder={`Alternativa ${index + 1}`}
              value={option}
              onChange={(event) => handleOptionChange(index, event.target.value)}
              onBlur={() => handleInputBlur(index)}
              onKeyDown={(event) => handleKeyDown(index, event)}
            />
            <div
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', String(index));
                setDragIndex(index);
              }}
              onDragEnd={() => {
                setDragIndex(null);
                setOverIndex(null);
              }}
              className={styles.dragHandle}
              title="Segure e arraste para alternar a posição"
              aria-label={`Reordenar alternativa ${index + 1}`}
            >
              <Icon.Grip size={15} />
            </div>
          </div>
        );
      })}

      {suggestions.length > 0 && (
        <div className={styles.suggestionsBox}>
          <div className={styles.suggestionsHead}>
            <span className={styles.suggestionsTitle}>
              <Icon.Sparkle size={14} />
              Sugestões da IA · clique para adicionar
            </span>
            <button
              type="button"
              className={styles.dismissButton}
              onClick={handleDismissSuggestions}
            >
              Descartar sugestões
            </button>
          </div>

          <div className={styles.suggestionsList}>
            {suggestions.map((suggestion, idx) => {
              const chip = (
                <button
                  key={idx}
                  type="button"
                  className={styles.suggestionChip}
                  onClick={() => handleAddSuggestion(suggestion, idx)}
                >
                  <Icon.Plus size={13} />
                  <span>{suggestion.label}</span>
                  <span
                    className={
                      suggestion.isCorrect
                        ? styles.suggestionBadgeCorrect
                        : styles.suggestionBadgeWrong
                    }
                  >
                    {suggestion.isCorrect ? 'Correta' : 'Distrator'}
                  </span>
                </button>
              );

              return suggestion.rationale ? (
                <Tooltip key={idx} label={suggestion.rationale} openDirection="top">
                  {chip}
                </Tooltip>
              ) : (
                chip
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
