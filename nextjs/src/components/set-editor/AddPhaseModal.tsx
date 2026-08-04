'use client';

import { useState, useTransition } from 'react';

import { Button, Input } from '@/components/ds';
import { Icon } from '@/components/icons/Icons';
import { generatePhaseAction } from '@/lib/actions/phaseSets';
import { cssVars } from '@/lib/cssVars';
import { cx } from '@/lib/cx';
import type { AiDifficulty, DraftPhase, PhaseKind } from '@/lib/types';
import { KIND_META, KIND_ORDER, defaultDraftPhase, draftPhaseId } from './phaseKinds';
import styles from './AddPhaseModal.module.css';

/** Passos do fluxo. `ai` só existe quando a pessoa escolhe o caminho assistido. */
type Step = 'kind' | 'path' | 'ai';

const DIFFICULTIES: { id: AiDifficulty; label: string }[] = [
  { id: 'easy', label: 'Fácil' },
  { id: 'medium', label: 'Médio' },
  { id: 'hard', label: 'Difícil' },
];

interface AddPhaseModalProps {
  onAdd: (phase: DraftPhase) => void;
  onClose: () => void;
}

export function AddPhaseModal({ onAdd, onClose }: AddPhaseModalProps) {
  const [step, setStep] = useState<Step>('kind');
  const [kind, setKind] = useState<PhaseKind | null>(null);
  const [query, setQuery] = useState('');

  const [topic, setTopic] = useState('');
  const [difficulty, setDifficulty] = useState<AiDifficulty>('medium');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [generating, startTransition] = useTransition();

  const normalized = query.trim().toLowerCase();
  const kinds = KIND_ORDER.filter(
    (id) =>
      !normalized ||
      KIND_META[id].label.toLowerCase().includes(normalized) ||
      KIND_META[id].description.toLowerCase().includes(normalized),
  );

  const totalSteps = step === 'ai' ? 3 : 2;
  const stepIndex = step === 'kind' ? 1 : step === 'path' ? 2 : 3;

  function generate() {
    if (!kind || !topic.trim()) return;
    setError(null);
    startTransition(async () => {
      try {
        const phase = await generatePhaseAction({
          kind,
          topic: topic.trim(),
          difficulty,
          notes: notes.trim(),
        });
        onAdd(phase);
      } catch {
        setError('Não foi possível gerar a fase agora. Tente de novo ou crie manualmente.');
      }
    });
  }

  return (
    <div className={styles.backdrop} onClick={onClose} role="presentation">
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label="Adicionar fase"
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.head}>
          <div className={styles.headText}>
            <h2 className={styles.title}>
              {step === 'kind'
                ? 'Escolha o tipo de fase'
                : step === 'path'
                  ? 'Como você quer criar essa fase?'
                  : 'Criar fase com IA'}
            </h2>
            <div className={styles.steps}>
              {Array.from({ length: totalSteps }, (_, index) => (
                <span
                  key={index}
                  className={cx(styles.stepDot, index < stepIndex && styles.stepDotDone)}
                />
              ))}
              <span className={styles.stepLabel}>
                Etapa {stepIndex} de {totalSteps}
              </span>
            </div>
          </div>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Fechar">
            <Icon.Close size={18} />
          </button>
        </header>

        <div className={styles.body}>
          {step === 'kind' && (
            <div className={styles.kindList}>
              <input
                className={styles.search}
                placeholder="Pesquisar tipos de fase..."
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              {kinds.map((id) => (
                <button
                  key={id}
                  type="button"
                  className={styles.kindRow}
                  style={cssVars({ '--kind-color': KIND_META[id].color })}
                  onClick={() => {
                    setKind(id);
                    setStep('path');
                  }}
                >
                  <span className={styles.kindIcon}>{KIND_META[id].icon}</span>
                  <span className={styles.kindText}>
                    <span className={styles.kindLabel}>{KIND_META[id].label}</span>
                    <span className={styles.kindDescription}>{KIND_META[id].description}</span>
                  </span>
                  <Icon.ChevronRight size={18} className={styles.kindChevron} />
                </button>
              ))}
              {kinds.length === 0 && (
                <p className={styles.noResults}>Nenhum tipo encontrado para “{query}”.</p>
              )}
            </div>
          )}

          {step === 'path' && (
            <div className={styles.paths}>
              <button
                type="button"
                className={styles.path}
                onClick={() => kind && onAdd(defaultDraftPhase(kind, draftPhaseId()))}
              >
                <span className={styles.pathIcon}>
                  <Icon.Pencil size={22} />
                </span>
                <span className={styles.pathTitle}>Criar manualmente</span>
                <span className={styles.pathText}>
                  A fase é criada com parâmetros padrão e abre direto no editor para você escrever
                  o desafio.
                </span>
              </button>

              <button
                type="button"
                className={cx(styles.path, styles.pathAi)}
                onClick={() => setStep('ai')}
              >
                <span className={cx(styles.pathIcon, styles.pathIconAi)}>
                  <Icon.Sparkle size={22} />
                </span>
                <span className={cx(styles.pathTitle, styles.pathTitleAi)}>
                  Criar com aceleração de IA
                </span>
                <span className={styles.pathText}>
                  Descreva o assunto e o nível — a IA escreve o enunciado, as respostas e a
                  correção para você revisar.
                </span>
              </button>
            </div>
          )}

          {step === 'ai' &&
            (generating ? (
              <div className={styles.generating}>
                <span className={styles.spinner} aria-hidden />
                <div className={styles.generatingTitle}>Gerando seu desafio...</div>
                <div className={styles.generatingHint}>Isso leva alguns segundos.</div>
              </div>
            ) : (
              <div className={styles.aiForm}>
                <Input
                  label="Assunto do desafio"
                  placeholder="Ex: frações equivalentes para o 7º ano"
                  value={topic}
                  onChange={(event) => setTopic(event.target.value)}
                />

                <div className={styles.field}>
                  <span className={styles.fieldLabel}>Nível de dificuldade</span>
                  <div className={styles.difficulties}>
                    {DIFFICULTIES.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        className={cx(
                          styles.difficulty,
                          option.id === difficulty && styles.difficultyActive,
                        )}
                        aria-pressed={option.id === difficulty}
                        onClick={() => setDifficulty(option.id)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className={styles.field}>
                  <label className={styles.fieldLabel} htmlFor="ai-notes">
                    Instruções adicionais · opcional
                  </label>
                  <textarea
                    id="ai-notes"
                    className={styles.notes}
                    placeholder="Ex: use exemplos do dia a dia, evite decimais, foque em interpretação."
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                  />
                </div>

                {error && <p className={styles.error}>{error}</p>}

                <p className={styles.disclaimer}>
                  <Icon.Info size={16} />
                  Você poderá revisar e editar tudo antes de salvar o conjunto.
                </p>
              </div>
            ))}
        </div>

        <footer className={styles.foot}>
          {step !== 'kind' && !generating && (
            <Button variant="secondary" onClick={() => setStep(step === 'ai' ? 'path' : 'kind')}>
              Voltar
            </Button>
          )}
          {step === 'ai' && (
            <div className={styles.footPrimary}>
              <Button onClick={generate} disabled={!topic.trim() || generating}>
                Gerar fase
              </Button>
            </div>
          )}
        </footer>
      </div>
    </div>
  );
}
