import { cssVars, toPercent } from '@/lib/cssVars';
import { cx } from '@/lib/cx';
import styles from './Meter.module.css';

export type MeterTone = 'success' | 'primary' | 'danger' | 'muted' | 'info';

interface MeterProps {
  /** Percentual 0..100. */
  value: number;
  tone?: MeterTone;
  size?: 'thin' | 'medium' | 'thick';
  /** Usa o trilho escuro da barra superior da partida. */
  onDark?: boolean;
  label?: string;
  className?: string;
}

export function Meter({
  value,
  tone = 'success',
  size = 'thin',
  onDark,
  label,
  className,
}: MeterProps) {
  return (
    <div
      className={cx(styles.track, styles[size], onDark && styles.onDark, className)}
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={cx(styles.fill, styles[tone])}
        style={cssVars({ '--meter-value': toPercent(value) })}
      />
    </div>
  );
}
