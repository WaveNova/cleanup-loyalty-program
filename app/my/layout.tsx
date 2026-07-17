import { Space_Grotesk, Noto_Sans_TC, Space_Mono } from 'next/font/google';
import type { Metadata } from 'next';
import RejectionLogger from './RejectionLogger';

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['500', '700'],
  variable: '--font-space-grotesk',
  display: 'swap',
});

const notoSansTC = Noto_Sans_TC({
  subsets: ['latin'],
  weight: ['400', '500', '700', '900'],
  variable: '--font-noto-sans-tc',
  display: 'swap',
});

const spaceMono = Space_Mono({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-space-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: '我的海洋足跡 — WaveNova',
  description: '查看你的淨灘紀錄與海洋足跡',
};

export default function MyLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={`${spaceGrotesk.variable} ${notoSansTC.variable} ${spaceMono.variable}`}
      style={{ fontFamily: "var(--font-noto-sans-tc), 'PingFang TC', 'Noto Sans TC', system-ui, sans-serif" }}
    >
      <RejectionLogger />
      {children}
    </div>
  );
}
