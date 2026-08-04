'use client';

import { Input } from '@/components/ds';
import { cx } from '@/lib/cx';
import type { DraftPhase } from '@/lib/types';
import styles from './PhaseSettings.module.css';

/** Atalhos para os valores que quase toda fase usa. O campo continua livre. */
const POINTS_PRESETS = [50, 100, 150, 200];
const MULTIPLIER_PRESETS = [1, 1.5, 2, 3];
const TIME_PRESETS = [15, 30, 45, 60, 90];

interface PhaseSettingsProps {
  phase: DraftPhase;
  onChange: (patch: Partial<DraftPhase>) => void;
}

export function PhaseSettings({ phase, onChange }: PhaseSettingsProps) {
  return (
    <div className={styles.panel}>
      <h2 className={styles.title}>Configurações</h2>

      <Input
        label="Nome da fase"
        value={phase.name}
        onChange={(event) => onChange({ name: event.target.value })}
      />

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
