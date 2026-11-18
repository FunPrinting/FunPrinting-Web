'use client';

import { useRef, useState } from 'react';
import { Loader2, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ACCEPTED_FILES } from '@/lib/order/files';
import { Button } from '@/components/ui/button';

/** Drag and drop, or click to choose. `compact` is the "add more" version. */
export function FileDropzone({ onFiles, busy, compact }: { onFiles: (files: File[]) => void; busy?: boolean; compact?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const pick = () => input.current?.click();
  const take = (list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (files.length) onFiles(files);
  };

  const hidden = (
    <input
      ref={input}
      type="file"
      multiple
      accept={ACCEPTED_FILES}
      className="sr-only"
      tabIndex={-1}
      aria-hidden
      onChange={(e) => {
        take(e.target.files);
        e.target.value = ''; // allow choosing the same file again
      }}
    />
  );

  if (compact) {
    return (
      <>
        {hidden}
        <Button variant="outline" onClick={pick} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <Upload />}Add more documents</Button>
      </>
    );
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files); }}
      className={cn('flex flex-col items-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors', over ? 'border-primary bg-accent/40' : 'border-border')}
    >
      {hidden}
      <span className="grid size-12 place-items-center rounded-full bg-accent text-accent-foreground">
        {busy ? <Loader2 className="size-6 animate-spin" aria-hidden /> : <Upload className="size-6" aria-hidden />}
      </span>
      <div>
        <p className="font-medium">{busy ? 'Counting pages…' : 'Drop your documents here'}</p>
        <p className="text-sm text-muted-foreground">PDF, Word or images, up to 50 MB each</p>
      </div>
      <Button onClick={pick} disabled={busy}>Choose files</Button>
    </div>
  );
}
