import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'ToolBox Studio — Free Image & PDF Toolkit',
  description:
    'An all-in-one image and PDF toolkit: background remover, AI upscaler, photo enhancer, PDF editor, OCR, QR codes and more. 100% in-browser — no uploads, no login.',
  applicationName: 'ToolBox Studio',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [{ url: '/icons/icon-192.png', sizes: '192x192' }, { url: '/icons/icon-512.png', sizes: '512x512' }],
    apple: '/icons/icon-192.png',
  },
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'ToolBox Studio' },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0b1120' },
  ],
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans">
        <Providers>{children}</Providers>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function(){try{var t=localStorage.getItem('tb-theme');var d=t?t==='dark':matchMedia('(prefers-color-scheme: dark)').matches;if(d)document.documentElement.classList.add('dark');}catch(e){}})();
              if ('serviceWorker' in navigator) addEventListener('load', function(){ navigator.serviceWorker.register('/sw.js').catch(function(){}); });
            `,
          }}
        />
      </body>
    </html>
  );
}
