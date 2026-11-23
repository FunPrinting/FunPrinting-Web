'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import toast from 'react-hot-toast';

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export function usePwaInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isAndroid, setIsAndroid] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [canInstallNative, setCanInstallNative] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const promptRef = useRef<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // 1. Check if running in standalone PWA mode
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      Boolean((window.navigator as any).standalone);
    setIsInstalled(isStandalone);

    // 2. Platform detection
    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIOSDevice = /iphone|ipad|ipod/.test(userAgent) && !Boolean((window as any).MSStream);
    const isAndroidDevice = /android/.test(userAgent);
    setIsIOS(isIOSDevice);
    setIsAndroid(isAndroidDevice);
    setIsMobile(isIOSDevice || isAndroidDevice || /mobile/.test(userAgent));

    // 3. Check for early captured prompt from layout head script
    const globalPrompt = (window as any).__deferredPwaPrompt as BeforeInstallPromptEvent | undefined;
    if (globalPrompt) {
      promptRef.current = globalPrompt;
      setDeferredPrompt(globalPrompt);
      setCanInstallNative(true);
    }

    // 4. Handle standard BeforeInstallPrompt event
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      const p = e as BeforeInstallPromptEvent;
      (window as any).__deferredPwaPrompt = p;
      promptRef.current = p;
      setDeferredPrompt(p);
      setCanInstallNative(true);
    };

    // 5. Handle custom event from head inline script
    const handlePromptReady = () => {
      const p = (window as any).__deferredPwaPrompt as BeforeInstallPromptEvent | undefined;
      if (p) {
        promptRef.current = p;
        setDeferredPrompt(p);
        setCanInstallNative(true);
      }
    };

    // 6. Handle App Installed event
    const handleAppInstalled = () => {
      setIsInstalled(true);
      (window as any).__deferredPwaPrompt = null;
      promptRef.current = null;
      setDeferredPrompt(null);
      setCanInstallNative(false);
      setIsModalOpen(false);
      toast.success('Fun Printing Store installed successfully!');
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('pwa-prompt-ready', handlePromptReady);
    window.addEventListener('appinstalled', handleAppInstalled);

    // 7. Register Service Worker and aggressively update
    if ('serviceWorker' in navigator && process.env.NODE_ENV !== 'test') {
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => {
          reg.update().catch(() => {});
          reg.addEventListener('updatefound', () => {
            const installing = reg.installing;
            if (installing) {
              installing.addEventListener('statechange', () => {
                if (installing.state === 'installed' && navigator.serviceWorker.controller) {
                  installing.postMessage({ type: 'SKIP_WAITING' });
                }
              });
            }
          });
        })
        .catch((err) => {
          console.warn('PWA service worker registration notice:', err);
        });
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('pwa-prompt-ready', handlePromptReady);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const promptInstall = useCallback(async (): Promise<'accepted' | 'dismissed' | 'modal_needed'> => {
    const prompt = deferredPrompt || promptRef.current || (typeof window !== 'undefined' ? (window as any).__deferredPwaPrompt : null);
    if (!prompt) {
      return 'modal_needed';
    }

    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === 'accepted') {
        setIsInstalled(true);
        promptRef.current = null;
        setDeferredPrompt(null);
        if (typeof window !== 'undefined') (window as any).__deferredPwaPrompt = null;
        setCanInstallNative(false);
        setIsModalOpen(false);
        return 'accepted';
      }
      return 'dismissed';
    } catch (err) {
      console.error('PWA prompt install error:', err);
      return 'modal_needed';
    }
  }, [deferredPrompt]);

  const triggerInstall = useCallback(async () => {
    if (isInstalled) {
      toast.success('Fun Printing Store is already installed on your device!');
      return;
    }

    const res = await promptInstall();
    if (res === 'modal_needed') {
      setIsModalOpen(true);
    }
  }, [isInstalled, promptInstall]);

  return {
    isInstalled,
    isIOS,
    isIos: isIOS, // backwards-compatible alias
    isAndroid,
    isMobile,
    canInstallNative,
    hasNativePrompt: canInstallNative, // backwards-compatible alias
    promptInstall,
    triggerInstall,
    isModalOpen,
    setIsModalOpen,
  };
}
