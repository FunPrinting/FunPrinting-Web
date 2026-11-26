'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  FileText,
  Loader2,
  Maximize2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ColorMode, PageSize } from '@/lib/order/files';
import {
  clampZoom,
  computeFitScale,
  isPageGrayscale,
  MAX_PREVIEW_ZOOM,
  MIN_PREVIEW_ZOOM,
  paperAspectRatio,
  PREVIEW_ZOOM_STEP,
  resolvePreviewKind,
} from '@/lib/order/preview';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export interface DocumentPreviewProps {
  /** Local File object (available on /order before/during upload). */
  file?: File;
  /** Preview URL (object URL on /order or authenticated viewer URL on order detail). */
  src: string;
  fileName: string;
  mimeType?: string;
  pageSize?: PageSize;
  color?: ColorMode;
  /** 1-based page numbers printed in colour when color === 'mixed'. */
  colorPages?: number[];
  /** Known page count fallback before client metadata finishes loading. */
  totalPages?: number;
  /** Allow rendering SVG files inside <img> (enabled for local previews, disabled for untrusted remote). */
  allowSvg?: boolean;
  /** Show an expand-to-fullscreen modal button in the preview bar. */
  allowFullscreen?: boolean;
  /** Taller viewport when shown inside a standalone viewer or modal. */
  tall?: boolean;
  className?: string;
}

const PDF_WORKER_SRC = '/pdf.worker.min.mjs';

interface PdfDocHandle {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPageHandle>;
  destroy(): Promise<void> | void;
}

interface PdfPageHandle {
  getViewport(params: { scale: number }): { width: number; height: number };
  render(params: {
    canvas: HTMLCanvasElement;
    canvasContext: CanvasRenderingContext2D;
    viewport: unknown;
  }): { promise: Promise<void>; cancel(): void };
}

function useContainerWidth(ref: React.RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const update = () => setWidth(el.clientWidth);
    update();

    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width ?? el.clientWidth;
      setWidth(next);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);

  return width;
}

function ColorStatusBadge({
  pageSize,
  color,
  grayscale,
  showPageSpecific,
}: {
  pageSize: PageSize;
  color: ColorMode;
  grayscale: boolean;
  showPageSpecific: boolean;
}) {
  const label =
    color === 'mixed' && showPageSpecific
      ? grayscale
        ? 'Prints B&W'
        : 'Prints Colour'
      : color === 'color'
        ? 'Colour'
        : color === 'mixed'
          ? 'Mixed'
          : 'B&W';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap',
        grayscale
          ? 'border-border bg-background text-muted-foreground'
          : 'border-primary/30 bg-primary/10 text-primary',
      )}
    >
      <span
        className={cn(
          'size-1.5 rounded-full',
          grayscale
            ? 'bg-zinc-500'
            : 'bg-gradient-to-tr from-sky-500 via-pink-500 to-amber-400',
        )}
        aria-hidden
      />
      <span>{pageSize}</span>
      <span aria-hidden>·</span>
      <span>{label}</span>
    </span>
  );
}

function PdfPreviewBody({
  file,
  src,
  pageNumber,
  zoom,
  grayscale,
  tall,
  onTotalPages,
  onPageStep,
}: {
  file?: File;
  src: string;
  pageNumber: number;
  zoom: number;
  grayscale: boolean;
  tall?: boolean;
  onTotalPages: (count: number) => void;
  onPageStep: (delta: number) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerWidth = useContainerWidth(viewportRef);

  const [pdfDoc, setPdfDoc] = useState<PdfDocHandle | null>(null);
  const [docLoading, setDocLoading] = useState(true);
  const [pageRendering, setPageRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let activeTask: { promise: Promise<PdfDocHandle>; destroy(): Promise<void> | void } | null = null;
    let loadedDoc: PdfDocHandle | null = null;

    setDocLoading(true);
    setError(null);
    setPdfDoc(null);

    (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        if (cancelled) return;

        pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_SRC;

        if (file) {
          const buffer = await file.arrayBuffer();
          if (cancelled) return;
          activeTask = pdfjs.getDocument({ data: new Uint8Array(buffer) }) as unknown as typeof activeTask;
        } else {
          activeTask = pdfjs.getDocument({ url: src, withCredentials: true }) as unknown as typeof activeTask;
        }

        const doc = await activeTask!.promise;
        if (cancelled) {
          await doc.destroy();
          return;
        }
        loadedDoc = doc;
        setPdfDoc(doc);
        onTotalPages(doc.numPages);
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : 'Unable to load PDF preview';
          setError(msg.includes('password') ? 'This PDF is password-protected and cannot be previewed.' : 'Could not render PDF preview.');
        }
      } finally {
        if (!cancelled) setDocLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      try {
        activeTask?.destroy();
      } catch {
        /* ignore cleanup errors */
      }
      try {
        loadedDoc?.destroy();
      } catch {
        /* ignore cleanup errors */
      }
    };
  }, [file, src, onTotalPages]);

  useEffect(() => {
    if (!pdfDoc || containerWidth <= 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;
    let renderTask: { promise: Promise<void>; cancel(): void } | null = null;

    setPageRendering(true);

    (async () => {
      try {
        const clampedPage = Math.min(Math.max(1, pageNumber), pdfDoc.numPages);
        const page = await pdfDoc.getPage(clampedPage);
        if (cancelled) return;

        const baseViewport = page.getViewport({ scale: 1 });
        const maxFit = tall ? 860 : 720;
        const targetCssWidth = Math.min(maxFit, Math.max(220, containerWidth - 24));
        const cssScale = (targetCssWidth / baseViewport.width) * zoom;
        const cssViewport = page.getViewport({ scale: cssScale });
        const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
        const renderViewport = page.getViewport({ scale: cssScale * dpr });

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        canvas.width = Math.max(1, Math.floor(renderViewport.width));
        canvas.height = Math.max(1, Math.floor(renderViewport.height));
        canvas.style.width = `${cssViewport.width}px`;
        canvas.style.height = `${cssViewport.height}px`;

        renderTask = page.render({
          canvas,
          canvasContext: ctx,
          viewport: renderViewport,
        });
        await renderTask.promise;
      } catch (err) {
        if (!cancelled) {
          const name = (err as { name?: string })?.name;
          if (name !== 'RenderingCancelledException') {
            setError('Could not render this PDF page.');
          }
        }
      } finally {
        if (!cancelled) setPageRendering(false);
      }
    })();

    return () => {
      cancelled = true;
      try {
        renderTask?.cancel();
      } catch {
        /* ignore cancel errors */
      }
    };
  }, [pdfDoc, pageNumber, containerWidth, zoom, tall]);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (zoom > 1 || e.touches.length !== 1) return;
    touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (zoom > 1 || !touchStartRef.current || e.changedTouches.length !== 1) return;
    const dx = e.changedTouches[0].clientX - touchStartRef.current.x;
    const dy = e.changedTouches[0].clientY - touchStartRef.current.y;
    touchStartRef.current = null;
    if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      onPageStep(dx < 0 ? 1 : -1);
    }
  };

  if (error) {
    return (
      <div className="flex min-h-60 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
        <AlertCircle className="size-6 text-destructive/80" aria-hidden />
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div
      ref={viewportRef}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      className={cn(
        'relative flex w-full justify-center overflow-auto p-3 sm:p-4',
        tall ? 'max-h-[76dvh] min-h-[24rem]' : 'max-h-[30rem] min-h-[16rem]',
      )}
    >
      {docLoading ? (
        <div className="flex min-h-60 items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Loading document…
        </div>
      ) : (
        <div className="relative my-auto inline-block shrink-0">
          <canvas
            ref={canvasRef}
            className={cn(
              'block rounded-sm bg-white shadow-sm ring-1 ring-black/10 transition-opacity duration-150',
              grayscale && 'grayscale',
              pageRendering ? 'opacity-70' : 'opacity-100',
            )}
          />
          {pageRendering ? (
            <div className="pointer-events-none absolute top-2 right-2 flex items-center gap-1 rounded-full bg-background/90 px-2 py-0.5 text-[11px] text-muted-foreground shadow-xs ring-1 ring-border">
              <Loader2 className="size-3 animate-spin" aria-hidden />
              Rendering
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function DocxPreviewBody({
  file,
  src,
  zoom,
  grayscale,
  tall,
}: {
  file?: File;
  src: string;
  zoom: number;
  grayscale: boolean;
  tall?: boolean;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const styleHostRef = useRef<HTMLDivElement>(null);
  const contentHostRef = useRef<HTMLDivElement>(null);
  const containerWidth = useContainerWidth(viewportRef);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number }>({ width: 794, height: 1123 });

  const measureDocx = useCallback(() => {
    const host = contentHostRef.current;
    if (!host) return;
    const section = host.querySelector('section') as HTMLElement | null;
    const contentWidth = section?.offsetWidth || host.scrollWidth || 794;
    const contentHeight = host.scrollHeight || 1123;
    if (contentWidth > 0 && contentHeight > 0) {
      setNaturalSize({ width: contentWidth, height: contentHeight });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const contentHost = contentHostRef.current;
    const styleHost = styleHostRef.current;
    if (!contentHost || !styleHost) return;

    setLoading(true);
    setError(null);
    contentHost.innerHTML = '';
    styleHost.innerHTML = '';

    (async () => {
      try {
        const [{ renderAsync }, bytes] = await Promise.all([
          import('docx-preview'),
          file ? file.arrayBuffer() : fetch(src, { credentials: 'include' }).then((r) => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.arrayBuffer();
          }),
        ]);
        if (cancelled) return;

        await renderAsync(bytes, contentHost, styleHost, {
          className: 'fp-docx',
          inWrapper: false,
          ignoreWidth: false,
          ignoreHeight: false,
          ignoreFonts: false,
          breakPages: true,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
          renderEndnotes: true,
          useBase64URL: true,
        });

        if (cancelled) return;
        requestAnimationFrame(() => {
          if (!cancelled) measureDocx();
        });
      } catch {
        if (!cancelled) {
          setError('Could not render this Word document preview. The print shop will still print the uploaded file.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      contentHost.innerHTML = '';
      styleHost.innerHTML = '';
    };
  }, [file, src, measureDocx]);

  const scale = useMemo(
    () => computeFitScale({ contentWidth: naturalSize.width, containerWidth, padding: 24, zoom }),
    [naturalSize.width, containerWidth, zoom],
  );

  if (error) {
    return (
      <div className="flex min-h-60 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
        <FileText className="size-7 text-muted-foreground/70" aria-hidden />
        <p className="max-w-sm">{error}</p>
      </div>
    );
  }

  return (
    <div
      ref={viewportRef}
      className={cn(
        'relative w-full overflow-auto p-3 sm:p-4',
        tall ? 'max-h-[76dvh] min-h-[24rem]' : 'max-h-[30rem] min-h-[16rem]',
      )}
    >
      {/* Isolated style target for docx-preview so document styles do not leak into app chrome */}
      <div ref={styleHostRef} className="hidden" aria-hidden />

      {loading ? (
        <div className="flex min-h-60 items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Rendering Word document…
        </div>
      ) : null}

      <div
        className={cn('mx-auto origin-top-left', loading && 'opacity-0')}
        style={{
          width: `${Math.ceil(naturalSize.width * scale)}px`,
          height: `${Math.ceil(naturalSize.height * scale)}px`,
        }}
      >
        <div
          ref={contentHostRef}
          className={cn(
            'origin-top-left [&_.fp-docx]:mx-auto [&_.fp-docx]:bg-white [&_.fp-docx]:text-black [&_.fp-docx]:shadow-sm [&_.fp-docx]:ring-1 [&_.fp-docx]:ring-black/10 [&_.fp-docx]:mb-3',
            grayscale && 'grayscale',
          )}
          style={{
            width: `${naturalSize.width}px`,
            transform: `scale(${scale})`,
          }}
        />
      </div>
    </div>
  );
}

function ImagePreviewBody({
  src,
  fileName,
  pageSize,
  zoom,
  grayscale,
  tall,
}: {
  src: string;
  fileName: string;
  pageSize: PageSize;
  zoom: number;
  grayscale: boolean;
  tall?: boolean;
}) {
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait');
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  const aspectRatio = paperAspectRatio(pageSize, orientation);

  useEffect(() => {
    setLoaded(false);
    setFailed(false);
  }, [src]);

  if (failed) {
    return (
      <div className="flex min-h-60 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
        <AlertCircle className="size-6 text-destructive/80" aria-hidden />
        <p>Unable to load image preview.</p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'relative flex w-full justify-center overflow-auto p-3 sm:p-4',
        tall ? 'max-h-[76dvh] min-h-[22rem]' : 'max-h-[30rem] min-h-[16rem]',
      )}
    >
      <div
        className="relative my-auto flex shrink-0 items-center justify-center rounded-sm bg-white p-[3%] shadow-sm ring-1 ring-black/10 transition-[width] duration-150"
        style={{
          width: `${Math.round((orientation === 'landscape' ? 460 : 340) * zoom)}px`,
          maxWidth: zoom <= 1 ? '100%' : 'none',
          aspectRatio: String(aspectRatio),
        }}
      >
        {!loaded ? (
          <div className="absolute inset-0 flex items-center justify-center gap-2 text-xs text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Loading image…
          </div>
        ) : null}
        {/* eslint-disable-next-line @next/next/no-img-element -- supports local blob URLs and authenticated viewer streams */}
        <img
          src={src}
          alt={`Preview of ${fileName}`}
          onLoad={(e) => {
            const img = e.currentTarget;
            if (img.naturalWidth > 0 && img.naturalHeight > 0) {
              setOrientation(img.naturalWidth > img.naturalHeight ? 'landscape' : 'portrait');
            }
            setLoaded(true);
          }}
          onError={() => {
            setFailed(true);
            setLoaded(true);
          }}
          className={cn(
            'size-full object-contain transition-opacity duration-150',
            grayscale && 'grayscale',
            loaded ? 'opacity-100' : 'opacity-0',
          )}
        />
      </div>
    </div>
  );
}

export function DocumentPreview({
  file,
  src,
  fileName,
  mimeType,
  pageSize = 'A4',
  color = 'bw',
  colorPages = [],
  totalPages,
  allowSvg = true,
  allowFullscreen = true,
  tall = false,
  className,
}: DocumentPreviewProps) {
  const kind = useMemo(
    () => resolvePreviewKind({ name: fileName, mimeType: mimeType ?? file?.type, allowSvg }),
    [fileName, mimeType, file?.type, allowSvg],
  );

  const [pageNumber, setPageNumber] = useState(1);
  const [detectedPages, setDetectedPages] = useState<number>(totalPages ?? 1);
  const [pageInput, setPageInput] = useState('1');
  const [zoom, setZoom] = useState(1);
  const [fullscreenOpen, setFullscreenOpen] = useState(false);

  const pageCount = kind === 'pdf' ? Math.max(1, detectedPages) : 1;

  useEffect(() => {
    setPageNumber(1);
    setPageInput('1');
    setDetectedPages(totalPages ?? 1);
    setZoom(1);
  }, [src, file, totalPages]);

  const handleTotalPages = useCallback((count: number) => {
    setDetectedPages(count);
    setPageNumber((prev) => {
      const clamped = Math.min(Math.max(1, prev), Math.max(1, count));
      setPageInput(String(clamped));
      return clamped;
    });
  }, []);

  const goToPage = useCallback(
    (next: number) => {
      const clamped = Math.min(Math.max(1, next), pageCount);
      setPageNumber(clamped);
      setPageInput(String(clamped));
    },
    [pageCount],
  );

  const stepPage = useCallback(
    (delta: number) => {
      setPageNumber((prev) => {
        const clamped = Math.min(Math.max(1, prev + delta), pageCount);
        setPageInput(String(clamped));
        return clamped;
      });
    },
    [pageCount],
  );

  const commitPageInput = () => {
    const parsed = Number.parseInt(pageInput, 10);
    if (Number.isFinite(parsed)) {
      goToPage(parsed);
    } else {
      setPageInput(String(pageNumber));
    }
  };

  const grayscale = isPageGrayscale({ color, pageNumber, colorPages });

  if (kind === 'doc') {
    return (
      <div className={cn('rounded-lg border bg-muted/40 p-6 text-center', className)}>
        <FileText className="mx-auto mb-2 size-8 text-muted-foreground" aria-hidden />
        <p className="text-sm font-medium">Legacy Word (.doc) file</p>
        <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
          Browser preview works for PDF, images, and modern Word (.docx) files. Your .doc file is uploaded safely and the print shop will print it cleanly—or save as .docx / PDF if you want an on-screen preview first.
        </p>
      </div>
    );
  }

  if (kind === 'other') {
    return (
      <div className={cn('rounded-lg border bg-muted/40 p-6 text-center text-sm text-muted-foreground', className)}>
        This file format cannot be previewed in the browser.
      </div>
    );
  }

  return (
    <>
      <div className={cn('overflow-hidden rounded-lg border bg-muted/45', className)}>
        {/* Clean print-focused toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-background/95 px-2.5 py-1.5 backdrop-blur-xs">
          <ColorStatusBadge
            pageSize={pageSize}
            color={color}
            grayscale={grayscale}
            showPageSpecific={kind === 'pdf'}
          />

          {kind === 'pdf' && pageCount > 1 ? (
            <div className="flex items-center gap-1" aria-label="Page navigation">
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={() => stepPage(-1)}
                disabled={pageNumber <= 1}
                aria-label="Previous page"
                className="size-7 sm:size-7"
              >
                <ChevronLeft className="size-4" aria-hidden />
              </Button>
              <div className="flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
                <input
                  type="text"
                  inputMode="numeric"
                  aria-label="Current page number"
                  value={pageInput}
                  onChange={(e) => setPageInput(e.target.value.replace(/\D+/g, ''))}
                  onBlur={commitPageInput}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      commitPageInput();
                    }
                  }}
                  className="h-6 w-9 rounded border bg-background px-1 text-center text-xs font-medium text-foreground outline-none focus:ring-1 focus:ring-primary"
                />
                <span>/ {pageCount}</span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={() => stepPage(1)}
                disabled={pageNumber >= pageCount}
                aria-label="Next page"
                className="size-7 sm:size-7"
              >
                <ChevronRight className="size-4" aria-hidden />
              </Button>
            </div>
          ) : null}

          <div className="ml-auto flex items-center gap-0.5" aria-label="Zoom controls">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => setZoom((z) => clampZoom(z - PREVIEW_ZOOM_STEP))}
              disabled={zoom <= MIN_PREVIEW_ZOOM}
              aria-label="Zoom out"
              className="size-7"
            >
              <ZoomOut className="size-3.5" aria-hidden />
            </Button>
            <button
              type="button"
              onClick={() => setZoom(1)}
              title="Reset to fit width"
              className="min-w-11 rounded px-1.5 py-0.5 text-center text-[11px] font-medium text-muted-foreground tabular-nums hover:bg-muted hover:text-foreground"
            >
              {zoom === 1 ? 'Fit' : `${Math.round(zoom * 100)}%`}
            </button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => setZoom((z) => clampZoom(z + PREVIEW_ZOOM_STEP))}
              disabled={zoom >= MAX_PREVIEW_ZOOM}
              aria-label="Zoom in"
              className="size-7"
            >
              <ZoomIn className="size-3.5" aria-hidden />
            </Button>
            {allowFullscreen ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={() => setFullscreenOpen(true)}
                aria-label="Expand preview"
                className="ml-0.5 size-7"
              >
                <Maximize2 className="size-3.5" aria-hidden />
              </Button>
            ) : null}
          </div>
        </div>

        {/* Rendered sheet area */}
        {kind === 'pdf' ? (
          <PdfPreviewBody
            file={file}
            src={src}
            pageNumber={pageNumber}
            zoom={zoom}
            grayscale={grayscale}
            tall={tall}
            onTotalPages={handleTotalPages}
            onPageStep={stepPage}
          />
        ) : kind === 'docx' ? (
          <DocxPreviewBody
            file={file}
            src={src}
            zoom={zoom}
            grayscale={grayscale}
            tall={tall}
          />
        ) : (
          <ImagePreviewBody
            src={src}
            fileName={fileName}
            pageSize={pageSize}
            zoom={zoom}
            grayscale={grayscale}
            tall={tall}
          />
        )}
      </div>

      {allowFullscreen ? (
        <Dialog open={fullscreenOpen} onOpenChange={setFullscreenOpen}>
          <DialogContent className="flex max-h-[94dvh] w-[calc(100%-1rem)] max-w-5xl flex-col gap-2 p-3 sm:w-[calc(100%-2rem)] sm:max-w-5xl sm:p-4">
            <DialogHeader className="pr-8">
              <DialogTitle className="truncate text-sm font-medium">{fileName}</DialogTitle>
            </DialogHeader>
            <DocumentPreview
              file={file}
              src={src}
              fileName={fileName}
              mimeType={mimeType}
              pageSize={pageSize}
              color={color}
              colorPages={colorPages}
              totalPages={pageCount}
              allowSvg={allowSvg}
              allowFullscreen={false}
              tall
            />
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}

