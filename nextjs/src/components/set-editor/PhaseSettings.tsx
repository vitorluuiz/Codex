'use client';

import { Accordion, AccordionItem, Input, Switch } from '@/components/ds';
import { Icon } from '@/components/icons/Icons';
import { cx } from '@/lib/cx';
import type { DraftPhase } from '@/lib/types';
import styles from './PhaseSettings.module.css';

/** Atalhos para os valores que quase toda fase usa. O campo continua livre. */
const POINTS_PRESETS = [50, 100, 150, 200];
const MULTIPLIER_PRESETS = [1, 1.5, 2, 3];
const TIME_PRESETS = [15, 30, 45, 60, 90];
const INTRO_TIME_PRESETS = [3, 5, 8, 10];

const THEME_OPTIONS = [
  { id: 'default', label: 'Azul Padrão', color: '#2f6fed' },
  { id: 'cyberpunk', label: 'Cyberpunk', color: '#8b5cf6' },
  { id: 'emerald', label: 'Esmeralda', color: '#16a34a' },
  { id: 'sunset', label: 'Sunset', color: '#d97706' },
  { id: 'crimson', label: 'Carmim', color: '#dc2626' },
];

interface PhaseSettingsProps {
  phase: DraftPhase;
  onChange: (patch: Partial<DraftPhase>) => void;
}

export function PhaseSettings({ phase, onChange }: PhaseSettingsProps) {
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
      </Accordion>
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
