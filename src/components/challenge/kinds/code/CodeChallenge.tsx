'use client';

import { useState, useTransition, type ReactNode } from 'react';

import { Button, Tag } from '@/components/ds';
import { runCodeAction } from '@/lib/actions/match';
import { cx } from '@/lib/cx';
import type { CodePhase, CodeRunResult } from '@/lib/types';
import type { ChallengeLeaderPreviewProps, ChallengePlayerProps } from '../../types';
import styles from './CodeChallenge.module.css';

const DIFFICULTY_TONE = { easy: 'green', medium: 'amber', hard: 'pink' } as const;
const DIFFICULTY_LABEL = { easy: 'Easy', medium: 'Medium', hard: 'Hard' } as const;

const IDLE_MESSAGE = 'Clique em "Rodar" para testar seu código.';

/**
 * Renderiza `código inline` do enunciado. É o único markup aceito ali — o
 * servidor devolve texto simples, então não há risco de HTML arbitrário.
 */
function renderStatement(statement: string): ReactNode {
  return statement.split(/(`[^`]+`)/g).map((chunk, index) =>
    chunk.startsWith('`') && chunk.endsWith('`') ? (
      <code key={index} className={styles.inlineCode}>
        {chunk.slice(1, -1)}
      </code>
    ) : (
      chunk
    ),
  );
}

export function CodePlayer({ phase, disabled, onSubmit, matchId }: ChallengePlayerProps<CodePhase>) {
  const firstEnabled = phase.languages.find((language) => language.enabled) ?? phase.languages[0];
  const [languageId, setLanguageId] = useState(firstEnabled?.id ?? '');
  const [source, setSource] = useState(firstEnabled?.starterCode ?? '');
  const [result, setResult] = useState<CodeRunResult | null>(null);
  const [running, startRun] = useTransition();

  function switchLanguage(id: string) {
    const language = phase.languages.find((item) => item.id === id);
    if (!language) return;
    setLanguageId(id);
    // Só troca o código se a pessoa ainda não mexeu no editor.
    setSource((current) =>
      current.trim() === (firstEnabled?.starterCode ?? '').trim() ? language.starterCode : current,
    );
  }

  function run() {
    startRun(async () => {
      setResult({ status: 'success', output: 'Executando...', testsPassed: null });
      setResult(await runCodeAction(matchId, phase.id, languageId, source));
    });
  }

  const statusLabel = running
    ? 'Executando'
    : result?.status === 'success'
      ? 'Sucesso'
      : result?.status === 'error'
        ? 'Erro'
        : '';

  return (
    <div className={styles.layout}>
      <div className={styles.statementCard}>
        <div className={styles.badges}>
          <Tag tone={DIFFICULTY_TONE[phase.difficulty]}>{DIFFICULTY_LABEL[phase.difficulty]}</Tag>
          {phase.tags.map((tag) => (
            <Tag key={tag} tone="blue">
              {tag}
            </Tag>
          ))}
        </div>

        <h1 className={styles.title}>{phase.title}</h1>
        <p className={styles.statement}>{renderStatement(phase.statement)}</p>

        {phase.examples.length > 0 && (
          <div className={styles.example}>
            <pre className={styles.pre}>
              {phase.examples
                .map((example) => `Entrada: ${example.input}\nSaída: ${example.output}`)
                .join('\n\n')}
            </pre>
          </div>
        )}

        <div className={styles.console}>
          <div className={styles.consoleBar}>
            <span>Console</span>
            <span
              className={cx(
                styles.consoleStatus,
                result?.status === 'success' && !running && styles.statusSuccess,
                result?.status === 'error' && !running && styles.statusError,
              )}
            >
              {statusLabel}
            </span>
          </div>
          <pre
            className={cx(
              styles.consoleOutput,
              result?.status === 'error' && styles.consoleOutputError,
            )}
          >
            {result?.output ?? IDLE_MESSAGE}
          </pre>
        </div>
      </div>

      <div className={styles.editorColumn}>
        <div className={styles.languages}>
          {phase.languages.map((language) => (
            <button
              key={language.id}
              type="button"
              disabled={!language.enabled}
              title={language.enabled ? undefined : 'Em breve'}
              onClick={() => switchLanguage(language.id)}
              className={cx(
                styles.language,
                language.id === languageId && language.enabled && styles.languageActive,
              )}
            >
              {language.label}
            </button>
          ))}
        </div>

        <div className={styles.editorShell}>
          <div className={styles.editorBar}>
            <span className={cx(styles.trafficLight, styles.trafficRed)} />
            <span className={cx(styles.trafficLight, styles.trafficAmber)} />
            <span className={cx(styles.trafficLight, styles.trafficGreen)} />
            <span className={styles.fileName}>{phase.fileName}</span>
          </div>
          <textarea
            className={styles.editor}
            spellCheck={false}
            aria-label={`Editor de código — ${phase.fileName}`}
            value={source}
            onChange={(event) => setSource(event.target.value)}
            disabled={disabled}
          />
        </div>

        <div className={styles.editorActions}>
          <Button variant="secondary" onClick={run} disabled={disabled || running}>
            {running ? 'Rodando…' : 'Rodar'}
          </Button>
          <Button
            onClick={() => onSubmit({ kind: 'code', languageId, source })}
            disabled={disabled || !source.trim()}
          >
            Enviar
          </Button>
        </div>
      </div>
    </div>
  );
}

export function CodeLeaderPreview({ phase }: ChallengeLeaderPreviewProps<CodePhase>) {
  return (
    <>
      <h2 className={styles.title}>{phase.title}</h2>
      <p className={styles.statement}>{renderStatement(phase.statement)}</p>
    </>
  );
}
