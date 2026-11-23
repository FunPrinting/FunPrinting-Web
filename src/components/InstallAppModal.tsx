'use client';

import { Check, Download, Share, Sparkles } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export function InstallAppModal({
  isOpen,
  onClose,
  isIos,
  onNativeInstall,
  hasNativePrompt,
}: {
  isOpen: boolean;
  onClose: () => void;
  isIos: boolean;
  onNativeInstall?: () => void;
  hasNativePrompt?: boolean;
}) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md p-6 sm:rounded-2xl">
        <DialogHeader className="text-left space-y-2">
          <div className="flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Download className="size-6" />
            </div>
            <div>
              <DialogTitle className="text-lg font-bold">Install Web App</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Fun Printing Store for Mobile & Desktop
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* Key Advantages */}
          <div className="rounded-xl border bg-muted/30 p-3.5 space-y-2 text-xs">
            <p className="font-semibold text-foreground flex items-center gap-1.5">
              <Sparkles className="size-3.5 text-primary" />
              Why install the app?
            </p>
            <ul className="space-y-1.5 text-muted-foreground">
              <li className="flex items-center gap-2">
                <Check className="size-3.5 text-emerald-500 shrink-0" />
                <span>Fast 1-tap ordering directly from your home screen</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="size-3.5 text-emerald-500 shrink-0" />
                <span>Full-screen experience without browser URL bars</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="size-3.5 text-emerald-500 shrink-0" />
                <span>Instant print status & delivery notifications</span>
              </li>
            </ul>
          </div>

          {/* Installation Steps */}
          {hasNativePrompt ? (
            <div className="space-y-3 pt-1">
              <p className="text-sm text-muted-foreground">
                Click below to install Fun Printing Store on your device immediately.
              </p>
              <Button className="w-full gap-2" onClick={onNativeInstall}>
                <Download className="size-4" />
                <span>Install now</span>
              </Button>
            </div>
          ) : isIos ? (
            <div className="space-y-3 pt-1">
              <p className="text-xs font-semibold text-foreground uppercase tracking-wider">
                How to install on iPhone & iPad:
              </p>
              <ol className="space-y-2.5 text-xs text-muted-foreground">
                <li className="flex items-start gap-2.5">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                    1
                  </span>
                  <span>
                    Tap the <strong>Share</strong> button <Share className="inline size-3.5 text-primary mx-0.5" /> in Safari’s bottom toolbar.
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                    2
                  </span>
                  <span>
                    Scroll down and tap <strong>Add to Home Screen</strong>.
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                    3
                  </span>
                  <span>
                    Tap <strong>Add</strong> in the top-right corner to finish.
                  </span>
                </li>
              </ol>
            </div>
          ) : (
            <div className="space-y-3 pt-1">
              <p className="text-xs font-semibold text-foreground uppercase tracking-wider">
                How to install on Chrome / Edge / Desktop:
              </p>
              <ol className="space-y-2.5 text-xs text-muted-foreground">
                <li className="flex items-start gap-2.5">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                    1
                  </span>
                  <span>
                    Look for the <strong>Install</strong> icon <Download className="inline size-3.5 text-primary mx-0.5" /> on the right side of your address bar.
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                    2
                  </span>
                  <span>
                    Or open browser menu (<strong>⋮</strong> or <strong>…</strong>) $\rightarrow$ select <strong>Install Fun Printing Store</strong>.
                  </span>
                </li>
              </ol>
            </div>
          )}
        </div>

        <div className="pt-2">
          <Button variant="outline" className="w-full text-xs" onClick={onClose}>
            Got it
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
