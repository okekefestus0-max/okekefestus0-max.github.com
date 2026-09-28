import type { LucideIcon } from 'lucide-react';

export type CategoryId = 'image' | 'pdf' | 'more';

export interface ToolConfig {
  id: string;
  name: string;
  icon: LucideIcon;
  category: CategoryId;
  description: string;
  route: string;
  comingSoon?: boolean;
  badge?: string;
}

export interface ProcessingProgress {
  stage: string;
  progress: number; // 0-100
}

export interface ToastMessage {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type OutputFormat = 'png' | 'jpeg' | 'webp';

export interface ImageFileInfo {
  file: File;
  url: string;
  width: number;
  height: number;
}
