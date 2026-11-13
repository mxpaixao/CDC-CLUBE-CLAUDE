import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Clube CDC',
  description: 'Programa de fidelidade e comunidade da Casa das Correias',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icone.svg', apple: '/icone.svg' },
};

export const viewport: Viewport = { themeColor: '#b3261e', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
