import type { ReactNode } from 'react';

export const metadata = {
  title: 'Kash SDK Starter',
  description: 'Next.js + @kashdao/sdk starter',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 720, margin: '2rem auto' }}>
        {children}
      </body>
    </html>
  );
}
