'use client';

/**
 * ToolShell — shared workspace layout used by every tool page.
 * Provides: branded sidebar (desktop) / bottom tabs (mobile), back link,
 * tool header, undo/redo/reset actions, and the two-pane workspace.
 */
import { ReactNode, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ArrowLeft, Undo2, Redo2, RotateCcw, Moon, Sun, Menu, X,
  Wrench, Image as ImageIcon, FileText, MoreHorizontal, Grid2X2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { categories } from '@/registry/tools';
import { useTheme } from '@/app/providers';
import type { CategoryId } from '@/types';

const catIcons: Record<CategoryId, typeof ImageIcon> = {
  image: ImageIcon,
  pdf: FileText,
  more: MoreHorizontal,
};

export function AppFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { theme, toggle } = useTheme();
  const [mobileMenu, setMobileMenu] = useState(false);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ---------- Desktop sidebar ---------- */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-border bg-card md:flex">
        <Link href="/" className="flex items-center gap-2 border-b border-border px-4 py-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Wrench className="h-5 w-5" />
          </span>
          <span className="text-lg font-bold leading-tight">ToolBox<span className="text-primary"> Studio</span></span>
        </Link>
        <nav className="flex-1 space-y-1 overflow-y-auto p-3" aria-label="Tool categories">
          <SideLink href="/" active={pathname === '/'} icon={<Grid2X2 className="h-4 w-4" />}>Dashboard</SideLink>
          <p className="px-3 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Categories</p>
          {categories.map((c) => {
            const Icon = catIcons[c.id];
            const active = pathname?.startsWith(`/tools`) && categoryActive(c.id, pathname);
            return (
              <SideLink key={c.id} href={`/?tab=${c.id}`} active={!!active} icon={<Icon className="h-4 w-4" />}>
                {c.name}
              </SideLink>
            );
          })}
          <p className="px-3 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Popular</p>
          <SideLink href="/tools/background-remover" active={pathname === '/tools/background-remover'}>Background Remover</SideLink>
          <SideLink href="/tools/image-upscaler" active={pathname === '/tools/image-upscaler'}>Image Upscaler</SideLink>
          <SideLink href="/tools/pdf-editor" active={pathname === '/tools/pdf-editor'}>PDF Editor</SideLink>
          <SideLink href="/tools/merge-pdf" active={pathname === '/tools/merge-pdf'}>Merge PDFs</SideLink>
          <SideLink href="/tools/ocr" active={pathname === '/tools/ocr'}>OCR — Extract Text</SideLink>
        </nav>
        <div className="border-t border-border p-3">
          <button
            onClick={toggle}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted transition-colors"
            aria-label="Toggle dark mode"
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
        </div>
      </aside>

      {/* ---------- Mobile top bar ---------- */}
      <header className="sticky top-0 z-40 flex items-center gap-2 border-b border-border bg-card/95 px-3 py-2 backdrop-blur md:hidden">
        <button aria-label="Open menu" onClick={() => setMobileMenu(true)} className="rounded-lg p-2 hover:bg-muted">
          <Menu className="h-5 w-5" />
        </button>
        <Link href="/" className="flex items-center gap-2 font-bold">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Wrench className="h-4 w-4" />
          </span>
          ToolBox Studio
        </Link>
        <button onClick={toggle} aria-label="Toggle dark mode" className="ml-auto rounded-lg p-2 hover:bg-muted">
          {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </button>
      </header>

      {/* ---------- Mobile drawer ---------- */}
      {mobileMenu && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileMenu(false)} />
          <div className="absolute inset-y-0 left-0 w-64 bg-card shadow-xl animate-slide-up flex flex-col">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <span className="font-bold">ToolBox Studio</span>
              <button aria-label="Close menu" onClick={() => setMobileMenu(false)} className="rounded-lg p-2 hover:bg-muted">
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto p-3 space-y-1">
              <SideLink href="/" onClick={() => setMobileMenu(false)} icon={<Grid2X2 className="h-4 w-4" />}>Dashboard</SideLink>
              {categories.map((c) => {
                const Icon = catIcons[c.id];
                return (
                  <SideLink key={c.id} href={`/?tab=${c.id}`} onClick={() => setMobileMenu(false)} icon={<Icon className="h-4 w-4" />}>
                    {c.name}
                  </SideLink>
                );
              })}
            </nav>
          </div>
        </div>
      )}

      {/* ---------- Content ---------- */}
      <div className="md:pl-60">{children}</div>

      {/* ---------- Mobile bottom tabs ---------- */}
      <nav className="fixed bottom-0 inset-x-0 z-40 flex items-stretch justify-around border-t border-border bg-card/95 backdrop-blur md:hidden">
        <BottomTab href="/" label="Home" active={pathname === '/'} icon={<Grid2X2 className="h-5 w-5" />} />
        <BottomTab href="/?tab=image" label="Image" icon={<ImageIcon className="h-5 w-5" />} />
        <BottomTab href="/?tab=pdf" label="PDF" icon={<FileText className="h-5 w-5" />} />
        <BottomTab href="/?tab=more" label="More" icon={<MoreHorizontal className="h-5 w-5" />} />
      </nav>
    </div>
  );
}

function categoryActive(cat: CategoryId, path: string): boolean {
  const map: Record<CategoryId, string[]> = {
    image: ['background-remover', 'image-upscaler', 'photo-enhancer', 'image-compressor', 'image-converter', 'resize-crop', 'watermark-image'],
    pdf: ['pdf-editor', 'merge-pdf', 'split-pdf', 'compress-pdf', 'images-to-pdf', 'pdf-to-images', 'watermark-pdf'],
    more: ['ocr', 'qr-generator'],
  };
  return map[cat].some((id) => path.includes(id));
}

function SideLink({ href, active, children, icon, onClick }: {
  href: string; active?: boolean; children: ReactNode; icon?: ReactNode; onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
        active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      )}
      aria-current={active ? 'page' : undefined}
    >
      {icon}
      <span className="truncate">{children}</span>
    </Link>
  );
}

function BottomTab({ href, label, icon, active }: { href: string; label: string; icon: ReactNode; active?: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium',
        active ? 'text-primary' : 'text-muted-foreground'
      )}
    >
      {icon}
      {label}
    </Link>
  );
}

// ============================================================================
// ToolShell — per-tool workspace (header + undo/redo + panes)
// ============================================================================
interface ToolShellProps {
  title: string;
  description: string;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  onReset?: () => void;
  controls: ReactNode;   // left pane
  preview: ReactNode;    // right pane
  footer?: ReactNode;    // below panes (download bar etc.)
}

export function ToolShell({
  title, description, canUndo, canRedo, onUndo, onRedo, onReset, controls, preview, footer,
}: ToolShellProps) {
  return (
    <AppFrame>
      <main className="mx-auto max-w-7xl px-3 pb-24 pt-4 md:px-6 md:pb-10">
        <Link
          href="/"
          className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> All tools
        </Link>

        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
            <p className="mt-1 text-sm text-muted-foreground max-w-2xl">{description}</p>
          </div>
          <div className="flex items-center gap-2">
            <ActionBtn label="Undo" disabled={!canUndo} onClick={onUndo}><Undo2 className="h-4 w-4" /></ActionBtn>
            <ActionBtn label="Redo" disabled={!canRedo} onClick={onRedo}><Redo2 className="h-4 w-4" /></ActionBtn>
            <ActionBtn label="Reset" onClick={onReset}><RotateCcw className="h-4 w-4" /></ActionBtn>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
          <section aria-label="Controls" className="space-y-4">{controls}</section>
          <section aria-label="Preview" className="min-w-0">{preview}</section>
        </div>

        {footer && <div className="mt-4">{footer}</div>}
      </main>
    </AppFrame>
  );
}

export function ActionBtn({ label, disabled, onClick, children }: {
  label: string; disabled?: boolean; onClick?: () => void; children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        'flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium transition-colors',
        disabled ? 'opacity-40 cursor-not-allowed' : 'hover:bg-muted active:scale-95'
      )}
    >
      {children}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

export function Panel({ title, children, className }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-xl border border-border bg-card p-4', className)}>
      {title && <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>}
      {children}
    </div>
  );
}
