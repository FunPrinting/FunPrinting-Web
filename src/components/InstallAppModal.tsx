'use client';

import React, { useState, useEffect } from 'react';
import {
  X,
  Smartphone,
  Download,
  Share2,
  PlusSquare,
  CheckCircle2,
  Monitor,
  Zap,
  Printer,
  Radio,
  Sparkles,
  Bell,
} from 'lucide-react';

interface InstallAppModalProps {
  isOpen: boolean;
  onClose: () => void;
  canInstallNative?: boolean;
  hasNativePrompt?: boolean;
  onPromptInstall?: () => Promise<'accepted' | 'dismissed' | 'modal_needed'>;
  onNativeInstall?: () => void;
  isIOS?: boolean;
  isIos?: boolean;
  isAndroid?: boolean;
}

export function InstallAppModal({
  isOpen,
  onClose,
  canInstallNative = false,
  hasNativePrompt = false,
  onPromptInstall,
  onNativeInstall,
  isIOS = false,
  isIos = false,
  isAndroid = false,
}: InstallAppModalProps) {
  const iosActive = isIOS || isIos;
  const nativeSupported = canInstallNative || hasNativePrompt;

  // Auto-select tab based on device detection
  const [selectedTab, setSelectedTab] = useState<'ios' | 'android' | 'desktop'>(
    iosActive ? 'ios' : isAndroid ? 'android' : 'desktop'
  );
  const [isInstalling, setIsInstalling] = useState(false);
  const [installSuccess, setInstallSuccess] = useState(false);

  useEffect(() => {
    if (iosActive) setSelectedTab('ios');
    else if (isAndroid) setSelectedTab('android');
    else setSelectedTab('desktop');
  }, [iosActive, isAndroid]);

  if (!isOpen) return null;

  const handleNativeInstall = async () => {
    if (onPromptInstall) {
      setIsInstalling(true);
      const result = await onPromptInstall();
      setIsInstalling(false);
      if (result === 'accepted') {
        setInstallSuccess(true);
        setTimeout(() => {
          onClose();
        }, 2200);
      }
    } else if (onNativeInstall) {
      setIsInstalling(true);
      onNativeInstall();
      setIsInstalling(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-background/80 backdrop-blur-md animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
    >
      <div className="relative w-full max-w-lg bg-card border border-border rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh] animate-in zoom-in-95 duration-200 text-card-foreground">
        {/* Header with App Brand Banner */}
        <div className="relative bg-primary text-primary-foreground p-5 sm:p-6 overflow-hidden">
          {/* Ambient blur glow */}
          <div className="absolute top-0 right-0 w-48 h-48 bg-white/10 rounded-full blur-2xl pointer-events-none" />

          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-primary-foreground transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>

          <div className="flex items-center gap-3.5 pr-8">
            <div className="w-12 h-12 rounded-2xl bg-white text-primary p-2.5 shadow-lg flex items-center justify-center font-black shrink-0">
              <Printer className="w-7 h-7 text-primary" />
            </div>
            <div>
              <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-white/20 text-[10px] font-mono font-bold uppercase tracking-wider text-primary-foreground">
                <span>Progressive Web App</span>
              </div>
              <h3 className="text-xl font-black tracking-tight leading-tight mt-1 text-white">
                Install Fun Printing
              </h3>
              <p className="text-xs text-primary-foreground/90 font-medium">
                Fast 1-tap ordering & live status tracking on your home screen
              </p>
            </div>
          </div>
        </div>

        {/* Device Switcher Tabs */}
        <div className="flex border-b border-border bg-muted/50 p-1.5 gap-1.5 text-xs font-bold">
          <button
            onClick={() => setSelectedTab('ios')}
            className={`flex-1 py-2 px-3 rounded-xl flex items-center justify-center gap-1.5 transition-all ${
              selectedTab === 'ios'
                ? 'bg-background text-primary shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Smartphone className="w-3.5 h-3.5" />
            <span>Apple iOS</span>
          </button>
          <button
            onClick={() => setSelectedTab('android')}
            className={`flex-1 py-2 px-3 rounded-xl flex items-center justify-center gap-1.5 transition-all ${
              selectedTab === 'android'
                ? 'bg-background text-primary shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Smartphone className="w-3.5 h-3.5" />
            <span>Android</span>
          </button>
          <button
            onClick={() => setSelectedTab('desktop')}
            className={`flex-1 py-2 px-3 rounded-xl flex items-center justify-center gap-1.5 transition-all ${
              selectedTab === 'desktop'
                ? 'bg-background text-primary shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Monitor className="w-3.5 h-3.5" />
            <span>PC / Mac</span>
          </button>
        </div>

        {/* Scrollable Content Body */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-5">
          {/* Native 1-Tap Action Button (if supported & ready on device) */}
          {nativeSupported && !installSuccess && (
            <div className="p-4 rounded-2xl bg-primary/10 border-2 border-primary/30 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-primary">
                  Instant Installation Available
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-primary/20 text-primary font-bold">
                  1-Tap Setup
                </span>
              </div>
              <button
                onClick={handleNativeInstall}
                disabled={isInstalling}
                className="w-full py-3 px-4 bg-primary hover:bg-primary/90 text-primary-foreground font-black text-sm rounded-xl shadow-md transition-all active:scale-[0.98] flex items-center justify-center gap-2 cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>{isInstalling ? 'Opening Install Dialog...' : 'Install Fun Printing App Now'}</span>
              </button>
            </div>
          )}

          {installSuccess && (
            <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 text-xs font-bold flex items-center gap-2.5">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              <span>
                Fun Printing Store successfully installed! You can now launch it anytime from your home screen.
              </span>
            </div>
          )}

          {/* TAB 1: iOS Instructions */}
          {selectedTab === 'ios' && (
            <div className="space-y-3.5">
              <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                Install on iPhone or iPad (Safari):
              </div>

              <div className="space-y-2.5 text-xs text-foreground/90">
                <div className="flex items-start gap-3 p-3 rounded-2xl bg-muted/40 border border-border/70">
                  <div className="w-7 h-7 rounded-xl bg-primary/10 text-primary font-black text-xs flex items-center justify-center shrink-0">
                    1
                  </div>
                  <div className="leading-snug pt-0.5">
                    Open <strong className="text-foreground">Safari</strong> and tap the{' '}
                    <strong className="text-primary inline-flex items-center gap-1 font-bold">
                      <Share2 className="w-3.5 h-3.5 inline" /> Share
                    </strong>{' '}
                    icon in the bottom navigation bar.
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 rounded-2xl bg-muted/40 border border-border/70">
                  <div className="w-7 h-7 rounded-xl bg-primary/10 text-primary font-black text-xs flex items-center justify-center shrink-0">
                    2
                  </div>
                  <div className="leading-snug pt-0.5">
                    Scroll down in the action sheet and tap{' '}
                    <strong className="text-foreground inline-flex items-center gap-1 font-semibold">
                      <PlusSquare className="w-3.5 h-3.5 text-primary inline" /> Add to Home Screen
                    </strong>.
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 rounded-2xl bg-muted/40 border border-border/70">
                  <div className="w-7 h-7 rounded-xl bg-primary/10 text-primary font-black text-xs flex items-center justify-center shrink-0">
                    3
                  </div>
                  <div className="leading-snug pt-0.5">
                    Tap <strong className="text-primary font-black">Add</strong> in the top right corner. The Fun Printing icon will appear on your home screen!
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: Android Instructions */}
          {selectedTab === 'android' && (
            <div className="space-y-3.5">
              <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                Install on Android Phone (Chrome):
              </div>

              <div className="space-y-2.5 text-xs text-foreground/90">
                <div className="flex items-start gap-3 p-3 rounded-2xl bg-muted/40 border border-border/70">
                  <div className="w-7 h-7 rounded-xl bg-primary/10 text-primary font-black text-xs flex items-center justify-center shrink-0">
                    1
                  </div>
                  <div className="leading-snug pt-0.5">
                    Tap the <strong className="text-foreground">three dots menu (⋮)</strong> in the top right corner of Chrome.
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 rounded-2xl bg-muted/40 border border-border/70">
                  <div className="w-7 h-7 rounded-xl bg-primary/10 text-primary font-black text-xs flex items-center justify-center shrink-0">
                    2
                  </div>
                  <div className="leading-snug pt-0.5">
                    Select{' '}
                    <strong className="text-primary font-bold inline-flex items-center gap-1">
                      <Download className="w-3.5 h-3.5 inline" /> Install App
                    </strong>{' '}
                    or <strong className="text-foreground">Add to Home screen</strong>.
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 rounded-2xl bg-muted/40 border border-border/70">
                  <div className="w-7 h-7 rounded-xl bg-primary/10 text-primary font-black text-xs flex items-center justify-center shrink-0">
                    3
                  </div>
                  <div className="leading-snug pt-0.5">
                    Tap <strong className="text-primary font-black">Install</strong> on the confirmation pop-up.
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: Desktop Instructions */}
          {selectedTab === 'desktop' && (
            <div className="space-y-3.5">
              <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                Install on Desktop (Chrome / Edge / Brave):
              </div>

              <div className="space-y-2.5 text-xs text-foreground/90">
                <div className="flex items-start gap-3 p-3 rounded-2xl bg-muted/40 border border-border/70">
                  <div className="w-7 h-7 rounded-xl bg-primary/10 text-primary font-black text-xs flex items-center justify-center shrink-0">
                    1
                  </div>
                  <div className="leading-snug pt-0.5">
                    Look at the right side of the address bar at the top of your browser.
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 rounded-2xl bg-muted/40 border border-border/70">
                  <div className="w-7 h-7 rounded-xl bg-primary/10 text-primary font-black text-xs flex items-center justify-center shrink-0">
                    2
                  </div>
                  <div className="leading-snug pt-0.5">
                    Click the{' '}
                    <strong className="text-primary font-bold inline-flex items-center gap-1">
                      <Download className="w-3.5 h-3.5 inline" /> Install Fun Printing
                    </strong>{' '}
                    icon (monitor with down arrow or install icon).
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 rounded-2xl bg-muted/40 border border-border/70">
                  <div className="w-7 h-7 rounded-xl bg-primary/10 text-primary font-black text-xs flex items-center justify-center shrink-0">
                    3
                  </div>
                  <div className="leading-snug pt-0.5">
                    Confirm by clicking <strong className="text-primary font-black">Install</strong>. It launches in a dedicated, distraction-free app window!
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Core Feature Benefits */}
          <div className="border-t border-border/80 pt-4 space-y-2.5">
            <span className="text-[11px] font-black uppercase text-muted-foreground tracking-wider">
              Why Install Fun Printing App?
            </span>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2.5 rounded-xl bg-muted/50 flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-500 shrink-0" />
                <span className="font-semibold text-foreground">1-Tap Fast Launch</span>
              </div>
              <div className="p-2.5 rounded-xl bg-muted/50 flex items-center gap-2">
                <Radio className="w-4 h-4 text-primary shrink-0" />
                <span className="font-semibold text-foreground">Live Order Tracking</span>
              </div>
              <div className="p-2.5 rounded-xl bg-muted/50 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-emerald-500 shrink-0" />
                <span className="font-semibold text-foreground">Full-Screen App</span>
              </div>
              <div className="p-2.5 rounded-xl bg-muted/50 flex items-center gap-2">
                <Bell className="w-4 h-4 text-violet-500 shrink-0" />
                <span className="font-semibold text-foreground">Status Notifications</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Button */}
        <div className="p-4 bg-muted/30 border-t border-border flex items-center justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-secondary hover:bg-secondary/80 text-secondary-foreground font-bold text-xs rounded-xl transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
