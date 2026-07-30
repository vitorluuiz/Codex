import Image from 'next/image';

import { cx } from '@/lib/cx';
import styles from './ImageSlot.module.css';

interface ImageSlotProps {
  /** Descrição do que entra ali — vira o `alt` e o texto do placeholder. */
  placeholder: string;
  /** URL vinda do CMS/Storage. Sem ela, renderiza o contorno tracejado. */
  src?: string | null;
  shape?: 'rounded' | 'rect' | 'circle';
  onDark?: boolean;
  width: number;
  height: number;
  className?: string;
  priority?: boolean;
}

/**
 * Equivalente ao `<image-slot>` do arquivo de design: reserva o espaço da
 * imagem antes de ela existir, mantendo o layout estável.
 */
export function ImageSlot({
  placeholder,
  src,
  shape = 'rounded',
  onDark,
  width,
  height,
  className,
  priority,
}: ImageSlotProps) {
  return (
    <div className={cx(styles.slot, styles[shape], onDark && styles.onDark, className)}>
      {src ? (
        <Image
          className={styles.image}
          src={src}
          alt={placeholder}
          width={width}
          height={height}
          priority={priority}
        />
      ) : (
        <span>{placeholder}</span>
      )}
    </div>
  );
}
