import { describe, expect, it } from 'vitest';
import {
  clampZoom,
  computeFitScale,
  isPageGrayscale,
  MAX_PREVIEW_ZOOM,
  MIN_PREVIEW_ZOOM,
  paperAspectRatio,
  resolvePreviewKind,
} from '@/lib/order/preview';

describe('resolvePreviewKind', () => {
  it('routes PDF files by MIME type or extension', () => {
    expect(resolvePreviewKind({ name: 'notes.pdf', mimeType: 'application/pdf' })).toBe('pdf');
    expect(resolvePreviewKind({ name: 'NOTES.PDF', mimeType: '' })).toBe('pdf');
  });

  it('distinguishes modern .docx from legacy binary .doc', () => {
    expect(
      resolvePreviewKind({
        name: 'report.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
    ).toBe('docx');
    expect(resolvePreviewKind({ name: 'report.DOCX' })).toBe('docx');
    expect(resolvePreviewKind({ name: 'legacy.doc', mimeType: 'application/msword' })).toBe('doc');
    expect(resolvePreviewKind({ name: 'legacy.doc' })).toBe('doc');
  });

  it('routes raster images and respects allowSvg', () => {
    expect(resolvePreviewKind({ name: 'scan.jpg', mimeType: 'image/jpeg' })).toBe('image');
    expect(resolvePreviewKind({ name: 'diagram.webp' })).toBe('image');
    expect(resolvePreviewKind({ name: 'vector.svg', mimeType: 'image/svg+xml', allowSvg: true })).toBe('image');
    expect(resolvePreviewKind({ name: 'vector.svg', mimeType: 'image/svg+xml', allowSvg: false })).toBe('other');
  });

  it('returns other for unsupported formats', () => {
    expect(resolvePreviewKind({ name: 'archive.zip', mimeType: 'application/zip' })).toBe('other');
  });
});

describe('isPageGrayscale', () => {
  it('handles bw, color, and mixed page lists accurately', () => {
    expect(isPageGrayscale({ color: 'bw', pageNumber: 1 })).toBe(true);
    expect(isPageGrayscale({ color: 'color', pageNumber: 1 })).toBe(false);
    expect(isPageGrayscale({ color: 'mixed', pageNumber: 1, colorPages: [1, 3, 5] })).toBe(false);
    expect(isPageGrayscale({ color: 'mixed', pageNumber: 2, colorPages: [1, 3, 5] })).toBe(true);
    expect(isPageGrayscale({ color: 'mixed', pageNumber: 5, colorPages: [1, 3, 5] })).toBe(false);
  });
});

describe('paperAspectRatio', () => {
  it('returns portrait and landscape DIN paper ratios', () => {
    expect(paperAspectRatio('A4', 'portrait')).toBeCloseTo(595.28 / 841.89, 4);
    expect(paperAspectRatio('A4', 'landscape')).toBeCloseTo(841.89 / 595.28, 4);
    expect(paperAspectRatio('A3', 'portrait')).toBeCloseTo(841.89 / 1190.55, 4);
  });
});

describe('clampZoom & computeFitScale', () => {
  it('clamps zoom inside supported range', () => {
    expect(clampZoom(0.1)).toBe(MIN_PREVIEW_ZOOM);
    expect(clampZoom(5)).toBe(MAX_PREVIEW_ZOOM);
    expect(clampZoom(1.25)).toBe(1.25);
    expect(clampZoom(Number.NaN)).toBe(1);
  });

  it('scales wide Word pages down cleanly for mobile 360px containers', () => {
    const mobileScale = computeFitScale({ contentWidth: 794, containerWidth: 328, padding: 24, zoom: 1 });
    expect(mobileScale).toBeCloseTo(304 / 794, 3);
    expect(mobileScale * 794).toBeLessThanOrEqual(305);
  });

  it('scales up proportionally with zoom', () => {
    const fit = computeFitScale({ contentWidth: 800, containerWidth: 424, padding: 24, zoom: 1 });
    const zoomed = computeFitScale({ contentWidth: 800, containerWidth: 424, padding: 24, zoom: 1.5 });
    expect(zoomed).toBeCloseTo(fit * 1.5, 4);
  });
});

