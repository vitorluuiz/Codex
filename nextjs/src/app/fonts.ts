import { Fredoka, JetBrains_Mono, Plus_Jakarta_Sans } from 'next/font/google';

export const fontDisplay = Fredoka({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-display-src',
  display: 'swap',
});

export const fontBody = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-body-src',
  display: 'swap',
});

export const fontMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono-src',
  display: 'swap',
});
