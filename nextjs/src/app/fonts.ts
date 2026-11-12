import localFont from 'next/font/local';

export const fontDisplay = localFont({
  src: './fonts/Fredoka/Fredoka-VariableFont_wdth,wght.ttf',
  // subsets: ['latin'],
  // weight: ['400', '500', '600', '700'],
  variable: '--font-display-src',
  display: 'swap',
});

export const fontBody = localFont({
  src: './fonts/Plus_Jakarta_Sans/PlusJakartaSans-VariableFont_wght.ttf',
  // subsets: ['latin'],
  // weight: ['400', '500', '600', '700', '800'],
  variable: '--font-body-src',
  display: 'swap',
});

export const fontMono = localFont({
  src: './fonts/JetBrains_Mono/JetBrainsMono-VariableFont_wght.ttf',
  // subsets: ['latin'],
  // weight: ['400', '500', '600'],
  variable: '--font-mono-src',
  display: 'swap',
});
