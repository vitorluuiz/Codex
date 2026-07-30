import { cx } from '@/lib/cx';
import type { AvatarIndex } from '@/lib/types';
import { AVATAR_CLASS_NAMES, avatarGlyph } from './avatars';
import styles from './Avatar.module.css';

interface AvatarProps {
  index: AvatarIndex;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  /** Só a bolinha colorida, sem o símbolo. */
  plain?: boolean;
  name?: string;
  className?: string;
}

export function Avatar({ index, size = 'md', plain, name, className }: AvatarProps) {
  const toneClass = styles[AVATAR_CLASS_NAMES[index]];

  return (
    <span
      className={cx(styles.avatar, styles[size], toneClass, plain && styles.plain, className)}
      role="img"
      aria-label={name ? `Avatar de ${name}` : 'Avatar'}
    >
      {!plain && avatarGlyph(index)}
    </span>
  );
}
