'use client';

import { Button } from '@/components/ds';
import { cx } from '@/lib/cx';
import styles from './screens.module.css';

interface TimeUpScreenProps {
  onContinue: () => void;
}

/**
 * O tempo da fase acabou e a pessoa não chegou a responder.
 *
 * Tela própria, e não o `IndividualFeedbackScreen`, porque aquele é construído em
 * torno de uma submissão — nota, pontuação, explicação — e aqui não existe nenhuma.
 * Fingir uma submissão vazia obrigaria os quatro tipos de desafio a tratar campos
 * nulos que nunca são nulos em nenhum outro caminho.
 *
 * A resposta certa não aparece aqui: ela sai na comparação com a turma, que é o
 * único lugar por onde o gabarito chega ao aluno (a "regra de ouro" da seção 7).
 */
export function TimeUpScreen({ onContinue }: TimeUpScreenProps) {
  return (
    <div className={styles.centered}>
      <div className={cx(styles.panel, styles.panelMedium)}>
        <h2 className={styles.sectionTitle}>Tempo esgotado</h2>
        <p className={styles.comparisonSummary}>
          Esta fase foi encerrada antes do seu envio, então ela não pontuou. Veja como a turma se
          saiu e a resposta correta.
        </p>

        <div className={styles.footerActions}>
          <Button size="lg" onClick={onContinue}>
            Ver comparação com a turma
          </Button>
        </div>
      </div>
    </div>
  );
}
