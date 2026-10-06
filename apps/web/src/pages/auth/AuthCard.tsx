import type { ReactNode } from 'react';
import { LogoMark } from '@/components/Logo';

/** The centred card from the login design (screen 01), reused by every signed-out page. */
export function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="flex min-h-svh items-center justify-center px-4 py-10">
      <div className="bg-card w-full max-w-[400px] rounded-2xl border px-6 py-8 sm:px-10 sm:py-10">
        <div className="mb-7 flex flex-col items-center text-center">
          <LogoMark className="mb-4 size-12 rounded-xl" />
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          <p className="text-muted-foreground mt-2 text-[13px]">{subtitle}</p>
        </div>
        {children}
        {footer && (
          <div className="text-muted-foreground mt-6 text-center text-xs leading-relaxed">
            {footer}
          </div>
        )}
      </div>
    </main>
  );
}
