import { Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useUploadTarget } from './useUploadTarget';
import { Button } from '@/components/ui/Button';
import { mediaTypeOf } from '@/lib/media/imageProcessing';
import { enqueueUploads } from '@/lib/upload/uploadQueue';
import { toast } from '@/state/toastStore';
import { useVaultStore } from '@/state/vaultStore';

/** Queue the photos and videos among `files`; say so when some were neither. */
function accept(files: File[], vaultId: string, albumId: string | null): void {
  const media = files.filter((file) => mediaTypeOf(file) !== null);
  const skipped = files.length - media.length;
  if (skipped > 0) {
    toast(
      media.length === 0
        ? 'Only photos and videos can be uploaded'
        : `Skipped ${skipped} file${skipped === 1 ? '' : 's'} that ${skipped === 1 ? 'is' : 'are'} not photos or videos`,
      'error',
    );
  }
  enqueueUploads(media, vaultId, albumId);
}

export function UploadButton() {
  const { vaultId, albumId } = useUploadTarget();
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <Button variant="primary" icon={<Upload className="size-4" />} onClick={() => inputRef.current?.click()}>
        Upload
      </Button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/*,video/*,.heic,.heif"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        data-testid="upload-input"
        onChange={(event) => {
          accept(Array.from(event.target.files ?? []), vaultId, albumId);
          // Allow choosing the same files again later
          event.target.value = '';
        }}
      />
    </>
  );
}

const carriesFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files');

/** Whole-window drop target. Only mounted for people who can add photos, inside the unlocked shell. */
export function UploadDropzone() {
  const { vaultId, albumId, albumName } = useUploadTarget();
  const vaultLabel = useVaultStore((s) => s.label);
  const [dragging, setDragging] = useState(false);
  // dragenter/dragleave fire for every element crossed; count them to know when the drag really left
  const depth = useRef(0);
  const target = useRef({ vaultId, albumId });
  target.current = { vaultId, albumId };

  useEffect(() => {
    const onDragEnter = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth.current++;
      setDragging(true);
    };
    const onDragOver = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      // Without this the browser navigates to the dropped file
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    };
    const onDragLeave = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    };
    const onDrop = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth.current = 0;
      setDragging(false);
      accept(Array.from(event.dataTransfer?.files ?? []), target.current.vaultId, target.current.albumId);
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  if (!dragging) return null;

  return (
    <div className="fade-in pointer-events-none fixed inset-0 z-[55] flex items-center justify-center bg-accent/85 p-6 text-accent-ink">
      <div className="rounded-3xl border-2 border-dashed border-current px-12 py-10 text-center">
        <Upload className="mx-auto mb-4 size-12" aria-hidden />
        <p className="text-xl font-semibold">Drop to upload</p>
        <p className="mt-1 text-sm opacity-90">
          {albumName ? `Into ${albumName}` : vaultLabel ? `Into ${vaultLabel}` : 'Into this vault'} · encrypted before it leaves this device
        </p>
      </div>
    </div>
  );
}
