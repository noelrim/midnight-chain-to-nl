export const metadata = {
  title: 'Midnight NL→SQL',
  description: 'Natural language to SQL, safely.',
};

import './globals.css';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
