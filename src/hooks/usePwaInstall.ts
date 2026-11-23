'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import toast from 'react-hot-toast';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export function usePwaInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const promptRef = useRef<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // 1. Register Service Worker to satisfy Chrome/Chromium PWA installability requirements
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => {
          reg.update().catch(() => {});
        })
        .catch((err) => {
          console.warn('PWA service worker registration failed:', err);
        });
    }

    // 2. Check if currently running in standalone display mode (installed PWA)
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      Boolean((navigator as any).standalone);
    if (isStandalone) {
      setIsInstalled(true);
    }

    // 3. Detect iOS devices (iPhone, iPad, iPod)
    const ua = window.navigator.userAgent;
    const isIosDevice = /iPad|iPhone|iPod/.test(ua) && !Boolean((window as any).MSStream);
    setIsIos(isIosDevice);

    // 4. Capture standard W3C beforeinstallprompt event
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      const promptEvent = e as BeforeInstallPromptEvent;
      promptRef.current = promptEvent;
      setDeferredPrompt(promptEvent);
    };

    // 5. Listen for successful installation
    const handleAppInstalled = () => {
      setIsInstalled(true);
      promptRef.current = null;
      setDeferredPrompt(null);
      setIsModalOpen(false);
      toast.success('Fun Printing Store installed successfully!');
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const triggerInstall = useCallback(async () => {
    // If running already installed
    if (isInstalled) {
      toast.success('Fun Printing Store is already installed on your device!');
      return;
    }

    const promptEvent = deferredPrompt || promptRef.current;

    // DIRECT INSTALL: Directly trigger native prompt on Chrome, Edge, Android
    if (promptEvent) {
      try {
        await promptEvent.prompt();
        const choice = await promptEvent.userChoice;
        if (choice.outcome === 'accepted') {
          setIsInstalled(true);
          promptRef.current = null;
          setDeferredPrompt(null);
          setIsModalOpen(false);
        }
      } catch (err) {
        console.warn('Install prompt error:', err);
        setIsModalOpen(true);
      }
      return;
    }

    // iOS Safari does not implement BeforeInstallPrompt API; show visual guide modal
    if (isIos) {
      setIsModalOpen(true);
      return;
    }

    // If prompt hasn't captured yet, open the modal as fallback
    setIsModalOpen(true);
  }, [deferredPrompt, isInstalled, isIos]);

  return {
    isInstalled,
    isIos,
    isModalOpen,
    setIsModalOpen,
    triggerInstall,
    hasNativePrompt: Boolean(deferredPrompt),
  };
}
