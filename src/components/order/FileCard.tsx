'use client';

import { useState } from 'react';
import { AlertCircle, CheckCircle2, ChevronDown, Eye, FileImage, FileText, Loader2, Minus, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { colorPagesOf, fileKind, fileProblem, formatSize, MAX_COPIES, parsePageRange, splitFileName, type OrderFile, type PrintOptions } from '@/lib/order/files';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Segmented } from '@/components/order/Segmented';
import { DocumentPreview } from '@/components/order/DocumentPreview';

function Preview({ file }: { file: OrderFile }) {
  return (
    <DocumentPreview
      file={file.file}
      src={file.previewUrl}
      fileName={file.file.name}
      mimeType={file.file.type}
      pageSize={file.pageSize}
      color={file.color}
      colorPages={colorPagesOf(file)}
      totalPages={file.pages}
    />
  );
}

function PageChips({ pages, colorPages }: { pages: number; colorPages: Set<number> }) {
  if (pages > 300) return null;
  return (
    <div className="flex max-h-32 flex-wrap gap-1 overflow-y-auto" aria-hidden>
      {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
        <span key={n} className={cn('min-w-7 rounded px-1.5 py-0.5 text-center text-xs tabular-nums', colorPages.has(n) ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>{n}</span>
      ))}
    </div>
  );
}

/** One document: preview, page count and its own print options. */
export function FileCard({
  file,
  index,
  bindingPrice,
  onChange,
  onRemove,
  onRetryUpload,
}: {
  file: OrderFile;
  index: number;
  bindingPrice?: number;
  onChange: (patch: Partial<PrintOptions>) => void;
  onRemove: () => void;
  onRetryUpload?: () => void;
}) {
  const [preview, setPreview] = useState(false);
  const kind = fileKind(file.file);
  const Icon = kind === 'image' ? FileImage : FileText;
  const range = file.color === 'mixed' ? parsePageRange(file.colorInput, file.pages) : null;
  const problem = fileProblem(file);
  const id = (s: string) => `f${index}-${s}`;
  const { base, ext } = splitFileName(file.file.name);

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="flex items-center gap-3 p-4 min-w-0">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
          <Icon className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <p className="truncate font-medium text-foreground text-sm sm:text-base" title={file.file.name}>
              {base}
            </p>
            {ext ? (
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {ext}
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-0.5 text-xs text-muted-foreground">
            <span>
              {file.pages} {file.pages === 1 ? 'page' : 'pages'}{file.estimatedPages ? ' (estimated)' : ''} · {formatSize(file.file.size)}
            </span>

            {/* Background Upload Progress & Preprocessing Badge */}
            {file.uploadStatus === 'uploading' && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                <Loader2 className="size-3 animate-spin" />
                <span>Uploading {Math.round(file.uploadProgress ?? 0)}%</span>
              </span>
            )}

            {file.uploadStatus === 'uploaded' && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="size-3" />
                <span>Ready</span>
              </span>
            )}

            {file.uploadStatus === 'error' && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive">
                <AlertCircle className="size-3" />
                <span>{file.uploadError || 'Upload failed'}</span>
                {onRetryUpload && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRetryUpload();
                    }}
                    className="ml-0.5 inline-flex items-center gap-0.5 underline font-semibold hover:text-foreground cursor-pointer"
                  >
                    <RefreshCw className="size-2.5" />
                    Retry
                  </button>
                )}
              </span>
            )}
          </div>

          {/* Mini progress bar while uploading */}
          {file.uploadStatus === 'uploading' && (
            <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-all duration-300 ease-out"
                style={{ width: `${Math.max(5, Math.min(100, file.uploadProgress ?? 0))}%` }}
              />
            </div>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onRemove}
          className="shrink-0 size-8 text-muted-foreground hover:text-destructive"
          aria-label={`Remove ${file.file.name}`}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>

      <div className="grid gap-4 border-t p-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <p className="text-sm font-medium" id={id('size')}>Paper</p>
          <Segmented label="Paper size" value={file.pageSize} onChange={(pageSize) => onChange({ pageSize })} options={[{ value: 'A4', label: 'A4' }, { value: 'A3', label: 'A3' }]} />
        </div>
        <div className="space-y-1.5">
          <p className="text-sm font-medium">Sides</p>
          <Segmented label="Sides" value={file.sided} onChange={(sided) => onChange({ sided })} options={[{ value: 'single', label: 'Single-sided' }, { value: 'double', label: 'Double-sided', disabled: file.pages < 2 }]} />
        </div>
        <div className="space-y-1.5">
          <p className="text-sm font-medium">Colour</p>
          <Segmented
            label="Colour"
            value={file.color}
            onChange={(color) => onChange({ color })}
            options={[{ value: 'bw', label: 'B&W' }, { value: 'color', label: 'Colour' }, { value: 'mixed', label: 'Some pages', disabled: file.pages < 2, hint: 'Choose which pages are printed in colour' }]}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={id('copies')}>Copies</Label>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" onClick={() => onChange({ copies: Math.max(1, file.copies - 1) })} disabled={file.copies <= 1} aria-label="One copy fewer"><Minus /></Button>
            <Input
              id={id('copies')}
              inputMode="numeric"
              className="w-16 text-center tabular-nums"
              value={String(file.copies || '')}
              onChange={(e) => onChange({ copies: Math.min(MAX_COPIES, Number(e.target.value.replace(/\D/g, '')) || 0) })}
              onBlur={() => file.copies < 1 && onChange({ copies: 1 })}
            />
            <Button variant="outline" size="icon" onClick={() => onChange({ copies: Math.min(MAX_COPIES, file.copies + 1) })} disabled={file.copies >= MAX_COPIES} aria-label="One copy more"><Plus /></Button>
          </div>
        </div>
        {file.pages > 1 ? (
          <div className="space-y-1.5 sm:col-span-2">
            <p className="text-sm font-medium">Finishing</p>
            <Segmented
              label="Finishing"
              value={file.finishing}
              onChange={(finishing) => onChange({ finishing })}
              options={[
                { value: 'service', label: 'None' },
                { value: 'file', label: 'File folder' },
                { value: 'binding', label: bindingPrice !== undefined ? `Binding +₹${bindingPrice}/copy` : 'Binding' },
              ]}
            />
          </div>
        ) : null}

        {file.color === 'mixed' ? (
          <div className="space-y-2 rounded-lg border bg-muted/30 p-3 sm:col-span-2">
            <Label htmlFor={id('colour-pages')}>Pages in colour</Label>
            <Input
              id={id('colour-pages')}
              value={file.colorInput}
              onChange={(e) => onChange({ colorInput: e.target.value })}
              placeholder="e.g. 1-3, 7, 10-"
              aria-invalid={Boolean(range?.errors.length)}
              aria-describedby={id('colour-help')}
            />
            <p id={id('colour-help')} className="text-xs text-muted-foreground">
              Separate pages with commas. “10-” means page 10 to the end. Other pages print in B&W.
            </p>
            {range?.errors.map((e) => <p key={e} className="text-sm text-destructive">{e}</p>)}
            {!range?.errors.length ? range?.warnings.map((w) => <p key={w} className="text-sm text-warning">{w}</p>) : null}
            {range && !range.errors.length ? (
              <>
                <p className="text-sm">{range.pages.length} colour · {file.pages - range.pages.length} B&W</p>
                <PageChips pages={file.pages} colorPages={new Set(colorPagesOf(file))} />
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      {problem && !(file.color === 'mixed' && range?.errors.length) ? <p className="border-t px-4 py-2 text-sm text-destructive">{problem}</p> : null}

      {kind !== 'other' ? (
        <div className="border-t">
          <button type="button" onClick={() => setPreview(!preview)} aria-expanded={preview} className="flex w-full items-center justify-between px-4 py-2 text-sm text-muted-foreground hover:text-foreground">
            <span className="flex items-center gap-2"><Eye className="size-4" aria-hidden />{preview ? 'Hide preview' : 'Preview'}</span>
            <ChevronDown className={cn('size-4 transition-transform', preview && 'rotate-180')} aria-hidden />
          </button>
          {preview ? <div className="px-4 pb-4"><Preview file={file} /></div> : null}
        </div>
      ) : null}
    </Card>
  );
}
