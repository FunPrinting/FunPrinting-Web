'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  /** Ask for a short text (for example a reason). The confirm button stays off until it has `minLength` characters. */
  reason?: { label: string; defaultValue?: string; minLength?: number; maxLength?: number };
  onConfirm: (reason?: string) => void | Promise<void>;
}

/** In-page replacement for window.confirm and window.prompt. */
export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel = 'Confirm', cancelLabel = 'Cancel', destructive, busy, reason, onConfirm }: ConfirmDialogProps) {
  const [text, setText] = useState('');
  useEffect(() => {
    if (open) setText(reason?.defaultValue ?? '');
  }, [open, reason?.defaultValue]);
  const tooShort = reason ? text.trim().length < (reason.minLength ?? 1) : false;

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!tooShort && !busy) void onConfirm(reason ? text.trim() : undefined);
          }}
          className="flex flex-col gap-4"
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>
          {reason ? (
            <div className="space-y-2">
              <Label htmlFor="confirm-reason">{reason.label}</Label>
              <Input id="confirm-reason" value={text} maxLength={reason.maxLength ?? 200} onChange={(e) => setText(e.target.value)} autoFocus />
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>{cancelLabel}</Button>
            <Button type="submit" variant={destructive ? 'destructive' : 'default'} disabled={busy || tooShort}>
              {busy ? <Loader2 className="animate-spin" /> : null}{confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
