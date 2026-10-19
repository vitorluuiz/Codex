'use client';

import { useState, useTransition } from 'react';

import { Accordion, AccordionItem, Button, Input, Switch, Tooltip } from '@/components/ds';
import { Icon } from '@/components/icons/Icons';
import { generateVariationsAction } from '@/lib/actions/ai';
import { cx } from '@/lib/cx';
import type {
  AiDifficultyShift,
  AiUsage,
  AiVariationAspect,
  AiVariationOptions,
  AiVariationsResult,
  DraftPhase,
} from '@/lib/types';
import { VariationsReviewModal } from './ai/VariationsReviewModal';
import { formatAiErrorMessage } from './ai/aiErrors';
import styles from './PhaseSettings.module.css';

/** Atalhos para os valores que quase toda fase usa. O campo continua livre. */
const POINTS_PRESETS = [50, 100, 150, 200];
const MULTIPLIER_PRESETS = [1, 1.5, 2, 3];
const TIME_PRESETS = [15, 30, 45, 60, 90];
const INTRO_TIME_PRESETS = [3, 5, 8, 10];
const VARIATION_COUNT_PRESETS = [1, 2, 3, 5];

const THEME_OPTIONS = [
  { id: 'default', label: 'Azul Padrão', color: '#2f6fed' },
  { id: 'cyberpunk', label: 'Cyberpunk', color: '#8b5cf6' },
  { id: 'emerald', label: 'Esmeralda', color: '#16a34a' },
  { id: 'sunset', label: 'Sunset', color: '#d97706' },
  { id: 'crimson', label: 'Carmim', color: '#dc2626' },
];

const VARIATION_ASPECTS: { id: AiVariationAspect; label: string; onlyChoiceKinds?: boolean }[] = [
  { id: 'wording', label: 'Enunciado' },
  { id: 'values', label: 'Valores e exemplos' },
  { id: 'context', label: 'Contexto / história' },
  { id: 'distractors', label: 'Distratores', onlyChoiceKinds: true },
];

const DIFFICULTY_SHIFTS: { id: AiDifficultyShift; label: string }[] = [
  { id: 'easier', label: 'Mais fácil' },
  { id: 'same', label: 'Mesma' },
  { id: 'harder', label: 'Mais difícil' },
];

const DEFAULT_VARIATION_SETTINGS: AiVariationOptions = {
  count: 3,
  aspects: ['wording', 'values'],
  difficulty: 'same',
  keepSettings: true,
  notes: '',
};

interface PhaseSettingsProps {
  phase: DraftPhase;
  onChange: (patch: Partial<DraftPhase>) => void;
  aiUsage?: AiUsage | null;
  onUsageChange?: (usage: AiUsage) => void;
  onAddVariations?: (phases: DraftPhase[]) => void;
}

export function PhaseSettings({
  phase,
  onChange,
  aiUsage = null,
  onUsageChange,
  onAddVariations,
}: PhaseSettingsProps) {
  const [generatingVariations, startVariationsTransition] = useTransition();
  const [variationError, setVariationError] = useState<string | null>(null);
  const [variationsResult, setVariationsResult] = useState<AiVariationsResult | null>(null);

  const aiEnabled = aiUsage?.enabled !== false;
  const variationSettings: AiVariationOptions = {
    ...DEFAULT_VARIATION_SETTINGS,
    ...phase.variationSettings,
    aspects:
      phase.variationSettings?.aspects && phase.variationSettings.aspects.length > 0
        ? phase.variationSettings.aspects
        : DEFAULT_VARIATION_SETTINGS.aspects,
  };

  const variationCost = variationSettings.count <= 3 ? 1 : 2;
  const hasEnoughCredits =
    !aiUsage ||
    aiUsage.creditsLimit <= 0 ||
    aiUsage.creditsUsed + variationCost <= aiUsage.creditsLimit;
  const questionEmpty = !phase.question.trim();

  function patchVariationSettings(patch: Partial<AiVariationOptions>) {
    onChange({
      variationSettings: {
        ...variationSettings,
        ...patch,
      },
    });
  }

  function toggleAspect(aspect: AiVariationAspect) {
    const current = variationSettings.aspects;
    if (current.includes(aspect)) {
      if (current.length <= 1) return;
      patchVariationSettings({ aspects: current.filter((item) => item !== aspect) });
    } else {
      patchVariationSettings({ aspects: [...current, aspect] });
    }
  }

  function handleGenerateVariations() {
    if (questionEmpty || !hasEnoughCredits || generatingVariations) return;
    setVariationError(null);

    startVariationsTransition(async () => {
      const result = await generateVariationsAction({
        source: phase,
        options: variationSettings,
      });

      if (!result.ok) {
        if (result.usage) {
          onUsageChange?.(result.usage);
        }
        setVariationError(formatAiErrorMessage(result.code, result.message));
        return;
      }

      onUsageChange?.(result.data.usage);
      setVariationsResult(result.data);
    });
  }

  const visibleAspects = VARIATION_ASPECTS.filter(
    (item) => !item.onlyChoiceKinds || phase.kind === 'quiz' || phase.kind === 'fill',
  );

  const generateButton = (
    <Button
      onClick={handleGenerateVariations}
      disabled={questionEmpty || !hasEnoughCredits || generatingVariations}
    >
      {generatingVariations ? 'Gerando variações...' : 'Gerar variações'}
    </Button>
  );

  return (
    <div className={styles.panel}>
      <h2 className={styles.title}>Configurações</h2>

      <Accordion type="single" defaultValue={['challenge-settings']}>
        <Input
          label="Nome da fase"
          value={phase.name}
          onChange={(event) => onChange({ name: event.target.value })}
        />
        {/* 1. Configurações do Desafio */}
        <AccordionItem
          id="challenge-settings"
          title="Definições do desafio"
          subtitle="Pontuação, tempo e multiplicadores"
          icon={<Icon.Settings size={18} />}
        >
          <Input
            type="number"
            label="Pontuação"
            value={phase.basePoints}
            onChange={(event) => onChange({ basePoints: Number(event.target.value) || 0 })}
          />
          <PresetRow
            values={POINTS_PRESETS}
            current={phase.basePoints}
            format={String}
            onPick={(basePoints) => onChange({ basePoints })}
          />

          <Input
            type="number"
            step="0.1"
            label="Multiplicador"
            value={phase.pointsMultiplier}
            onChange={(event) => onChange({ pointsMultiplier: Number(event.target.value) || 1 })}
          />
          <PresetRow
            values={MULTIPLIER_PRESETS}
            current={phase.pointsMultiplier}
            format={(value) => `x${value}`}
            onPick={(pointsMultiplier) => onChange({ pointsMultiplier })}
          />

          <Input
            type="number"
            label="Tempo (s)"
            value={phase.timeSeconds}
            onChange={(event) => onChange({ timeSeconds: Number(event.target.value) || 0 })}
          />
          <PresetRow
            values={TIME_PRESETS}
            current={phase.timeSeconds}
            format={(value) => `${value}s`}
            onPick={(timeSeconds) => onChange({ timeSeconds })}
          />
        </AccordionItem>

        {/* 2. Temas de Personalização do Desafio */}
        <AccordionItem
          id="challenge-theme"
          title="Temas do desafio"
          subtitle="Paleta de cores e efeitos visuais"
          icon={<Icon.Sparkle size={18} />}
        >
          <div className={styles.sectionBlock}>
            <label className={styles.sectionLabel}>Paleta de cores</label>
            <div className={styles.themeGrid}>
              {THEME_OPTIONS.map((theme) => {
                const isSelected = (phase.theme || 'default') === theme.id;
                return (
                  <button
                    key={theme.id}
                    type="button"
                    className={cx(styles.themeChip, isSelected && styles.themeChipActive)}
                    onClick={() => onChange({ theme: theme.id })}
                  >
                    <span
                      className={styles.colorDot}
                      style={{ backgroundColor: theme.color }}
                    />
                    <span className={styles.themeName}>{theme.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className={styles.togglesBlock}>
            <Switch
              label="Efeitos e confetes no acerto"
              checked={phase.showFeedbackAnimation ?? true}
              onChange={(checked) => onChange({ showFeedbackAnimation: checked })}
            />
          </div>
          <p className={styles.hint}>
            O tema altera os realces visuais do desafio durante a partida.
          </p>
        </AccordionItem>

        {/* 3. Personalizações para Tela de Pré-desafio */}
        <AccordionItem
          id="pre-challenge-settings"
          title="Tela de pré-desafio"
          subtitle="Contagem regressiva e instruções"
          icon={<Icon.Clock size={18} />}
        >
          <Input
            type="number"
            label="Contagem regressiva (s)"
            value={phase.introSeconds ?? 5}
            onChange={(event) => onChange({ introSeconds: Number(event.target.value) || 5 })}
          />
          <PresetRow
            values={INTRO_TIME_PRESETS}
            current={phase.introSeconds ?? 5}
            format={(value) => `${value}s`}
            onPick={(introSeconds) => onChange({ introSeconds })}
          />

          <Input
            label="Mensagem de orientação"
            placeholder="Ex: Prepare-se para responder rápido!"
            value={phase.introTip ?? ''}
            onChange={(event) => onChange({ introTip: event.target.value })}
          />

          <div className={styles.togglesBlock}>
            <Switch
              label="Efeitos sonoros na contagem"
              checked={phase.introSound ?? true}
              onChange={(checked) => onChange({ introSound: checked })}
            />
            <Switch
              label="Formas geométricas no fundo"
              checked={phase.introShapes ?? true}
              onChange={(checked) => onChange({ introShapes: checked })}
            />
          </div>
          <p className={styles.hint}>
            Exibida aos participantes por alguns segundos antes do desafio iniciar.
          </p>
        </AccordionItem>

        {/* 4. Variações com IA */}
        {aiEnabled && (
          <AccordionItem
            id="ai-variations"
            title="Variações com IA"
            subtitle="Gerar versões alternativas desta fase"
            icon={<Icon.Ai size={18} />}
          >
            <div className={styles.sectionBlock}>
              <label className={styles.sectionLabel}>Quantidade de variações</label>
              <PresetRow
                values={VARIATION_COUNT_PRESETS}
                current={variationSettings.count}
                format={(value) => `${value}x`}
                onPick={(count) => patchVariationSettings({ count })}
              />
            </div>

            <div className={styles.sectionBlock}>
              <label className={styles.sectionLabel}>O que variar</label>
              <div className={styles.chipRow}>
                {visibleAspects.map((aspect) => {
                  const active = variationSettings.aspects.includes(aspect.id);
                  return (
                    <button
                      key={aspect.id}
                      type="button"
                      className={cx(styles.optionChip, active && styles.optionChipActive)}
                      aria-pressed={active}
                      onClick={() => toggleAspect(aspect.id)}
                    >
                      {aspect.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className={styles.sectionBlock}>
              <label className={styles.sectionLabel}>Dificuldade relativa</label>
              <div className={styles.chipRow}>
                {DIFFICULTY_SHIFTS.map((shift) => {
                  const active = variationSettings.difficulty === shift.id;
                  return (
                    <button
                      key={shift.id}
                      type="button"
                      className={cx(styles.optionChip, active && styles.optionChipActive)}
                      aria-pressed={active}
                      onClick={() => patchVariationSettings({ difficulty: shift.id })}
                    >
                      {shift.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className={styles.togglesBlock}>
              <Switch
                label="Manter pontuação, tempo e tema"
                checked={variationSettings.keepSettings}
                onChange={(keepSettings) => patchVariationSettings({ keepSettings })}
              />
            </div>

            <Input
              label="Instruções extras · opcional"
              placeholder="Ex: usar valores inteiros positivos"
              value={variationSettings.notes ?? ''}
              onChange={(event) => patchVariationSettings({ notes: event.target.value })}
            />

            <div className={styles.costRow}>
              <span className={styles.costBadge}>
                Custo: {variationCost} {variationCost === 1 ? 'crédito' : 'créditos'}
              </span>
              {aiUsage && (
                <span>
                  Disponível: {Math.max(0, aiUsage.creditsLimit - aiUsage.creditsUsed)}
                </span>
              )}
            </div>

            {variationError && <p className={styles.errorText}>{variationError}</p>}

            <div className={styles.actionWrap}>
              {questionEmpty ? (
                <Tooltip label="Escreva o enunciado da fase antes de gerar variações.">
                  {generateButton}
                </Tooltip>
              ) : (
                generateButton
              )}
            </div>

            <p className={styles.hint}>
              As variações aceitas são inseridas logo abaixo desta fase na barra lateral.
            </p>
          </AccordionItem>
        )}
      </Accordion>

      {variationsResult && (
        <VariationsReviewModal
          result={variationsResult}
          sourcePhaseName={phase.name}
          onAccept={(selected) => {
            onAddVariations?.(selected);
            setVariationsResult(null);
          }}
          onClose={() => setVariationsResult(null)}
        />
      )}
    </div>
  );
}

function PresetRow({
  values,
  current,
  format,
  onPick,
}: {
  values: number[];
  current: number;
  format: (value: number) => string;
  onPick: (value: number) => void;
}) {
  return (
    <div className={styles.presets}>
      {values.map((value) => (
        <button
          key={value}
          type="button"
          className={cx(styles.preset, value === current && styles.presetActive)}
          aria-pressed={value === current}
          onClick={() => onPick(value)}
        >
          {format(value)}
        </button>
      ))}
    </div>
  );
}
