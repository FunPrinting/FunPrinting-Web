import type { ColorMode, PageSize } from '@/lib/order/files';

export type PreviewKind = 'pdf' | 'docx' | 'doc' | 'image' | 'other';

const A4_RATIO = 595.28 / 841.89;
const A3_RATIO = 841.89 / 1190.55;

export const MIN_PREVIEW_ZOOM = 0.75;
export const MAX_PREVIEW_ZOOM = 2;
export const PREVIEW_ZOOM_STEP = 0.25;

/** Maps file name + MIME type to the client preview renderer. */
export function resolvePreviewKind({
  name,
  mimeType = '',
  allowSvg = true,
}: {
  name: string;
  mimeType?: string;
  allowSvg?: boolean;
}): PreviewKind {
  const lowerName = name.toLowerCase();
  const lowerMime = mimeType.toLowerCase();

  if (lowerMime === 'application/pdf' || lowerName.endsWith('.pdf')) {
    return 'pdf';
  }
  if (
    lowerMime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    lowerName.endsWith('.docx')
  ) {
    return 'docx';
  }
  if (lowerMime === 'application/msword' || lowerName.endsWith('.doc')) {
    return 'doc';
  }
  if (lowerMime === 'image/svg+xml' || lowerName.endsWith('.svg')) {
    return allowSvg ? 'image' : 'other';
  }
  if (lowerMime.startsWith('image/') || /\.(jpe?g|png|gif|bmp|tiff?|webp)$/.test(lowerName)) {
    return 'image';
  }
  return 'other';
}

/** Aspect ratio (width / height) of the printed sheet matching uploads/printReady.ts. */
export function paperAspectRatio(
  pageSize: PageSize = 'A4',
  orientation: 'portrait' | 'landscape' = 'portrait',
): number {
  const portraitRatio = pageSize === 'A3' ? A3_RATIO : A4_RATIO;
  return orientation === 'landscape' ? 1 / portraitRatio : portraitRatio;
}

/** Whether a 1-based page number renders in grayscale given the print color configuration. */
export function isPageGrayscale({
  color = 'bw',
  pageNumber = 1,
  colorPages = [],
}: {
  color?: ColorMode;
  pageNumber?: number;
  colorPages?: number[];
}): boolean {
  if (color === 'bw') return true;
  if (color === 'color') return false;
  return !colorPages.includes(pageNumber);
}

/** Clamps a user zoom multiplier within supported bounds. */
export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(MAX_PREVIEW_ZOOM, Math.max(MIN_PREVIEW_ZOOM, Math.round(zoom * 100) / 100));
}

/** Computes a CSS scale factor to fit wide Word documents neatly inside mobile or desktop viewports. */
export function computeFitScale({
  contentWidth,
  containerWidth,
  padding = 24,
  zoom = 1,
}: {
  contentWidth: number;
  containerWidth: number;
  padding?: number;
  zoom?: number;
}): number {
  if (contentWidth <= 0 || containerWidth <= 0) return 1;
  const available = Math.max(160, containerWidth - padding);
  const baseScale = Math.min(1.15, available / contentWidth);
  return Math.max(0.25, baseScale * clampZoom(zoom));
}

