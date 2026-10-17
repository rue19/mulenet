// SPDX-License-Identifier: Apache-2.0
import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'MuleNet Console',
  description: 'Private cross-institution mule-account corroboration on Midnight',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="top">
          <span className="brand">MuleNet</span>
          <nav>
            <Link href="/">Overview</Link>
            <Link href="/judge">Judge mode</Link>
            <Link href="/bank/bank-a">Banks</Link>
            <Link href="/regulator">Regulator</Link>
            <Link href="/transparency">Transparency</Link>
            <Link href="/xray">Privacy X-ray</Link>
            <Link href="/state">On-chain state</Link>
          </nav>
          <span className="net">{process.env.MULENET_NETWORK ?? 'undeployed'} · {process.env.MULENET_DEPLOYMENT ?? 'main'}</span>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
