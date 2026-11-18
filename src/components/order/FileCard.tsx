'use client';

import { useState } from 'react';
import { ChevronDown, Eye, FileImage, FileText, Minus, Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { colorPagesOf, fileKind, fileProblem, formatSize, MAX_COPIES, parsePageRange, type OrderFile, type PrintOptions } from '@/lib/order/files';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Segmented } from '@/components/order/Segmented';

function Preview({ file }: { file: OrderFile }) {
  const kind = fileKind(file.file);
  const gray = file.color === 'bw';
  if (kind === 'image') {
    // eslint-disable-next-line @next/next/no-img-element -- local object URL
    return <img src={file.previewUrl} alt={`Preview of ${file.file.name}`} className={cn('max-h-[28rem] w-full rounded-lg border bg-muted/40 object-contain', gray && 'grayscale')} />;
  }
  if (kind === 'pdf') {
    return <iframe src={file.previewUrl} title={`Preview of ${file.file.name}`} className={cn('h-[28rem] w-full rounded-lg border', gray && 'grayscale')} />;
  }
  return <p className="rounded-lg border bg-muted/40 p-6 text-center text-sm text-muted-foreground">Word documents can’t be previewed here. The shop prints the uploaded file.</p>;
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
export function FileCard({ file, index, bindingPrice, onChange, onRemove }: { file: OrderFile; index: number; bindingPrice?: number; onChange: (patch: Partial<PrintOptions>) => void; onRemove: () => void }) {
  const [preview, setPreview] = useState(false);
  const kind = fileKind(file.file);
  const Icon = kind === 'image' ? FileImage : FileText;
  const range = file.color === 'mixed' ? parsePageRange(file.colorInput, file.pages) : null;
  const problem = fileProblem(file);
  const id = (s: string) => `f${index}-${s}`;

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="flex items-start gap-3 p-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted"><Icon className="size-5 text-muted-foreground" aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium" title={file.file.name}>{file.file.name}</p>
          <p className="text-sm text-muted-foreground">
            {file.pages} {file.pages === 1 ? 'page' : 'pages'}{file.estimatedPages ? ' (estimated)' : ''} · {formatSize(file.file.size)}
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={onRemove} aria-label={`Remove ${file.file.name}`}><Trash2 /></Button>
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
