import { create } from 'zustand';

export type UploadStatus = 'queued' | 'processing' | 'encrypting' | 'uploading' | 'done' | 'failed';

export interface UploadItem {
  id: number;
  file: File;
  vaultId: string;
  /** Album to add the photo to once it is uploaded. */
  albumId: string | null;
  status: UploadStatus;
  /** 0 to 1, meaningful while uploading. */
  progress: number;
  error: string | null;
}

interface UploadState {
  items: UploadItem[];
  panelOpen: boolean;
  setPanelOpen(open: boolean): void;
}

export const useUploadStore = create<UploadState>((set) => ({
  items: [],
  panelOpen: false,
  setPanelOpen: (panelOpen) => set({ panelOpen }),
}));

export const isActive = (item: UploadItem) => item.status !== 'done' && item.status !== 'failed';
