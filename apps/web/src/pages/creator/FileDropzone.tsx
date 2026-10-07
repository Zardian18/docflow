import { MAX_UPLOAD_BYTES, mimeForFileName } from '@docflow/shared';
import { CheckCircle2, FileText, RotateCcw, UploadCloud, X } from 'lucide-react';
import { useRef, useState, type DragEvent } from 'react';
import { Button } from '@/components/ui/button';
import { api, errorMessage, uploadToStorage } from '@/lib/api';
import { formatFileSize } from '@/lib/format';
import { cn } from '@/lib/utils';

export type UploadState =
  | { kind: 'empty' }
  | { kind: 'uploading'; file: File; progress: number }
  | { kind: 'done'; file: File; uploadId: string }
  | { kind: 'error'; file: File | null; message: string };

/** Client-side check before anything is sent (the server and storage enforce it too, D20). */
function problemWith(file: File): string | null {
  if (!mimeForFileName(file.name)) return 'Only PDF and DOCX files can be uploaded.';
  if (file.size === 0) return 'This file is empty.';
  if (file.size > MAX_UPLOAD_BYTES)
    return `This file is ${formatFileSize(file.size)}. The limit is 10 MB.`;
  return null;
}

/**
 * Screen 04's drop zone. Uploads straight to storage with a presigned URL, showing progress;
 * the file can be replaced or removed, and a failed upload retried.
 */
export function FileDropzone({
  state,
  onChange,
}: {
  state: UploadState;
  onChange: (s: UploadState) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [dragging, setDragging] = useState(false);

  async function start(file: File) {
    const problem = problemWith(file);
    if (problem) {
      onChange({ kind: 'error', file: null, message: problem });
      return;
    }
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    onChange({ kind: 'uploading', file, progress: 0 });
    try {
      const target = await api.uploads.presign({
        fileName: file.name,
        contentType: mimeForFileName(file.name)!,
        size: file.size,
      });
      await uploadToStorage(
        file,
        target,
        (progress) => onChange({ kind: 'uploading', file, progress }),
        abort.signal,
      );
      onChange({ kind: 'done', file, uploadId: target.uploadId });
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      onChange({ kind: 'error', file, message: errorMessage(err) });
    }
  }

  const pick = () => inputRef.current?.click();
  const remove = () => {
    abortRef.current?.abort();
    onChange({ kind: 'empty' });
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) void start(file);
  };

  const input = (
    <input
      ref={inputRef}
      type="file"
      accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      className="sr-only"
      tabIndex={-1}
      aria-hidden
      onChange={(e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (file) void start(file);
      }}
    />
  );

  if (state.kind === 'uploading' || state.kind === 'done') {
    const done = state.kind === 'done';
    const pct = done ? 100 : Math.round(state.progress * 100);
    return (
      <div className="bg-card rounded-xl border p-4 sm:p-5">
        {input}
        <div className="flex items-start gap-3">
          <span className="bg-primary-soft text-primary inline-flex size-10 shrink-0 items-center justify-center rounded-lg">
            <FileText className="size-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium break-all">{state.file.name}</p>
            <p className="text-muted-foreground mt-0.5 flex items-center gap-1.5 text-xs">
              {formatFileSize(state.file.size)} ·{' '}
              {done ? (
                <span className="text-status-green inline-flex items-center gap-1">
                  <CheckCircle2 className="size-3.5" aria-hidden /> Uploaded
                </span>
              ) : (
                <span>Uploading… {pct}%</span>
              )}
            </p>
            <div
              className="bg-muted mt-2.5 h-1.5 overflow-hidden rounded-full"
              role="progressbar"
              aria-label="Upload progress"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className={cn(
                  'h-full rounded-full transition-[width]',
                  done ? 'bg-status-green' : 'bg-primary',
                )}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
          <div className="flex shrink-0 gap-1">
            {done && (
              <Button type="button" variant="ghost" size="sm" onClick={pick}>
                Replace
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={remove}
              aria-label={done ? 'Remove file' : 'Cancel upload'}
            >
              <X aria-hidden />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {input}
      <button
        type="button"
        onClick={pick}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          'bg-card hover:border-primary/60 flex w-full flex-col items-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors',
          dragging ? 'border-primary bg-primary-soft/40' : 'border-border',
          state.kind === 'error' && 'border-destructive/50',
        )}
      >
        <UploadCloud className="text-muted-foreground mb-1 size-6" aria-hidden />
        <span className="text-sm font-medium">Drop a document here, or click to browse</span>
        <span className="text-muted-foreground text-xs">PDF, DOCX up to 10 MB</span>
      </button>
      {state.kind === 'error' && (
        <div
          role="alert"
          className="text-destructive mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
        >
          <span>{state.message}</span>
          {state.file && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void start(state.file!)}
            >
              <RotateCcw aria-hidden /> Try again
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
