import type { Metadata } from 'next';
import './styles.css';
export const metadata: Metadata = { title: 'Business OS', description: 'Multi-tenant business operating system' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
