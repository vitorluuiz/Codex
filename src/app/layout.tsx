import type { Metadata, Viewport } from 'next';

import { cx } from '@/lib/cx';
import { fontBody, fontDisplay, fontMono } from './fonts';
import '@/styles/globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Codex — desafios gamificados para estudar, ensinar e selecionar',
    template: '%s · Codex',
  },
  description:
    'Plataforma de partidas e desafios gamificados para salas de aula e processos seletivos, com relatórios em tempo real.',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f7fb' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0c14' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={cx(fontDisplay.variable, fontBody.variable, fontMono.variable)}>
      <body>{children}</body>
    </html>
  );
}
