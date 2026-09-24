/**
 * Ícones do produto. São todos SVG inline com `stroke="currentColor"` para que
 * a cor venha do CSS que envolve o ícone — nada de cor fixa no componente.
 */

interface IconProps {
  size?: number;
  className?: string;
}

function base(size: number, className?: string) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none' as const,
    stroke: 'currentColor',
    strokeWidth: 2,
    className,
    'aria-hidden': true,
  };
}

export const Icon = {
  Students: ({ size = 24, className }: IconProps) => (
    <svg {...base(size, className)}>
      <path d="M22 10 12 5 2 10l10 5 10-5z" />
      <path d="M6 12v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5" />
    </svg>
  ),
  Teachers: ({ size = 24, className }: IconProps) => (
    <svg {...base(size, className)}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  ),
  Recruiters: ({ size = 24, className }: IconProps) => (
    <svg {...base(size, className)}>
      <circle cx="8" cy="9" r="3.2" />
      <circle cx="16" cy="9" r="3.2" />
      <path d="M2 20c0-3 2.6-5 6-5s6 2 6 5M10 20c0-3 2.6-5 6-5s6 2 6 5" />
    </svg>
  ),
  Templates: ({ size = 24, className }: IconProps) => (
    <svg {...base(size, className)}>
      <rect x="3" y="4" width="18" height="14" rx="2" />
      <path d="M3 9h18M8 4v5M16 4v5" />
    </svg>
  ),
  PhaseTypes: ({ size = 24, className }: IconProps) => (
    <svg {...base(size, className)}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  ),
  Reports: ({ size = 24, className }: IconProps) => (
    <svg {...base(size, className)}>
      <path d="M3 3v18h18" />
      <path d="M7 15l4-5 3 3 5-7" />
    </svg>
  ),
  Ai: ({ size = 24, className }: IconProps) => (
    <svg {...base(size, className)}>
      <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
      <circle cx="12" cy="12" r="4" />
    </svg>
  ),
  Award: ({ size = 24, className }: IconProps) => (
    <svg {...base(size, className)}>
      <circle cx="12" cy="8" r="6" />
      <path d="M8.5 13.5 7 22l5-3 5 3-1.5-8.5" />
    </svg>
  ),
  Flame: ({ size = 24, className }: IconProps) => (
    <svg {...base(size, className)} fill="currentColor" stroke="none">
      <path d="M12 2c-.3 3.4-2.2 4.9-4 7-1.6 2-2 3.4-2 5a6 6 0 0 0 12 0c0-2.4-1.3-3.7-2-5 1.6.6 2.3 1.7 2.6 2.8.9-1.3 1.4-2.9 1.4-4.6C20 4.5 16.6 2.6 12 2z" />
    </svg>
  ),
  Trophy: ({ size = 24, className }: IconProps) => (
    <svg {...base(size, className)}>
      <path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0V4z" />
      <path d="M7 6H4a1 1 0 0 0-1 1c0 2 1.5 4 4 4M17 6h3a1 1 0 0 1 1 1c0 2-1.5 4-4 4" />
    </svg>
  ),
  Crown: ({ size = 24, className }: IconProps) => (
    <svg {...base(size, className)}>
      <path d="M3 8l4 3 5-6 5 6 4-3-2 11H5z" />
    </svg>
  ),
  Clock: ({ size = 24, className }: IconProps) => (
    <svg {...base(size, className)}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </svg>
  ),
  Users: ({ size = 24, className }: IconProps) => (
    <svg {...base(size, className)}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  Lock: ({ size = 24, className }: IconProps) => (
    <svg {...base(size, className)}>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  ),
  Copy: ({ size = 24, className }: IconProps) => (
    <svg {...base(size, className)}>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
    </svg>
  ),
  Check: ({ size = 24, className }: IconProps) => (
    <svg {...base(size, className)} strokeWidth={3}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  ),
  Dash: ({ size = 24, className }: IconProps) => (
    <svg {...base(size, className)} strokeWidth={3}>
      <path d="M6 12h12" />
    </svg>
  ),
  Close: ({ size = 24, className }: IconProps) => (
    <svg {...base(size, className)} strokeWidth={3}>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  ),
  ChevronLeft: ({ size = 24, className }: IconProps) => (
    <svg {...base(size, className)}>
      <path d="M15 18l-6-6 6-6" />
    </svg>
  ),
  ChevronDown: ({ size = 24, className }: IconProps) => (
    <svg {...base(size, className)}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  ),
  ChevronRight: ({ size = 24, className }: IconProps) => (
    <svg {...base(size, className)}>
      <path d="M9 18l6-6-6-6" />
    </svg>
  ),
  ArrowLeft: ({ size = 24, className }: IconProps) => (
    <svg {...base(size, className)}>
      <path d="M19 12H5M12 19l-7-7 7-7" />
    </svg>
  ),
  Restart: ({ size = 24, className }: IconProps) => (
    <svg {...base(size, className)}>
      <path d="M3 12a9 9 0 1 1 3 6.7" />
      <path d="M3 21v-6h6" />
    </svg>
  ),
  Power: ({ size = 24, className }: IconProps) => (
    <svg {...base(size, className)}>
      <path d="M18.36 6.64a9 9 0 1 1-12.73 0M12 2v10" />
    </svg>
  ),
  Pause: ({ size = 24, className }: IconProps) => (
    <svg {...base(size, className)}>
      <circle cx="12" cy="12" r="10" />
      <path d="M9 8v8M15 8v8" />
    </svg>
  ),
  More: ({ size = 24, className }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  ),
  Grip: ({ size = 16, className }: IconProps) => (
    <svg width={(size * 12) / 16} height={size} viewBox="0 0 12 16" fill="currentColor" className={className} aria-hidden>
      <circle cx="3" cy="2" r="1.4" />
      <circle cx="9" cy="2" r="1.4" />
      <circle cx="3" cy="8" r="1.4" />
      <circle cx="9" cy="8" r="1.4" />
      <circle cx="3" cy="14" r="1.4" />
      <circle cx="9" cy="14" r="1.4" />
    </svg>
  ),
  Sparkle: ({ size = 24, className }: IconProps) => (
    <svg {...base(size, className)}>
      <path d="M12 2l1.8 5.6L19 9l-5.2 1.4L12 16l-1.8-5.6L5 9l5.2-1.4z" />
    </svg>
  ),
  Search: ({ size = 24, className }: IconProps) => (
    <svg {...base(size, className)}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  ),
  Person: ({ size = 24, className }: IconProps) => (
    <svg {...base(size, className)}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" />
    </svg>
  ),
  Bell: ({ size = 24, className }: IconProps) => (
    <svg {...base(size, className)}>
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  ),
  Settings: ({ size = 24, className }: IconProps) => (
    <svg {...base(size, className)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  ),
  SignOut: ({ size = 24, className }: IconProps) => (
    <svg {...base(size, className)}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  ),
  Eye: ({ size = 24, className }: IconProps) => (
    <svg {...base(size, className)}>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
  Download: ({ size = 24, className }: IconProps) => (
    <svg {...base(size, className)}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M7 10l5 5 5-5" />
      <path d="M12 15V3" />
    </svg>
  ),
  Pencil: ({ size = 24, className }: IconProps) => (
    <svg {...base(size, className)}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  ),
  Plus: ({ size = 24, className }: IconProps) => (
    <svg {...base(size, className)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  Grid: ({ size = 24, className }: IconProps) => (
    <svg {...base(size, className)}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  ),
  Globe: ({ size = 24, className }: IconProps) => (
    <svg {...base(size, className)}>
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20M12 2c2.5 2.7 4 6.2 4 10s-1.5 7.3-4 10c-2.5-2.7-4-6.2-4-10s1.5-7.3 4-10z" />
    </svg>
  ),
  Alert: ({ size = 24, className }: IconProps) => (
    <svg {...base(size, className)}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4M12 16h.01" />
    </svg>
  ),
  Info: ({ size = 24, className }: IconProps) => (
    <svg {...base(size, className)}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4M12 8h.01" />
    </svg>
  ),
  /* --- Tipos de fase ------------------------------------------------------ */
  Quiz: ({ size = 24, className }: IconProps) => (
    <svg {...base(size, className)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.7" />
      <path d="M12 17h.01" />
    </svg>
  ),
  Code: ({ size = 24, className }: IconProps) => (
    <svg {...base(size, className)}>
      <path d="M8 6 3 12l5 6M16 6l5 6-5 6" />
    </svg>
  ),
  Text: ({ size = 24, className }: IconProps) => (
    <svg {...base(size, className)}>
      <path d="M4 6h16M4 11h16M4 16h9" />
    </svg>
  ),
  Fill: ({ size = 24, className }: IconProps) => (
    <svg {...base(size, className)}>
      <path d="M4 15h6M14 15h6" />
      <path d="M4 9h16" />
    </svg>
  ),
};
