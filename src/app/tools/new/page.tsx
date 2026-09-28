'use client';

import Link from 'next/link';
import { Clock3, ArrowLeft, Bell } from 'lucide-react';
import { AppFrame } from '@/components/tool/ToolShell';

export default function ComingSoonPage() {
  return (
    <AppFrame>
      <main className="mx-auto flex max-w-lg flex-col items-center px-4 py-24 text-center">
        <span className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-500">
          <Clock3 className="h-8 w-8" />
        </span>
        <h1 className="text-2xl font-bold">This tool is coming soon</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          We&apos;re building it right now. In the meantime, everything else in the toolbox is ready to use —
          try the Background Remover, PDF Editor or the OCR tool.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Link href="/" className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">
            <ArrowLeft className="h-4 w-4" /> Back to dashboard
          </Link>
          <span className="flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground">
            <Bell className="h-4 w-4" /> Updates ship weekly
          </span>
        </div>
      </main>
    </AppFrame>
  );
}
