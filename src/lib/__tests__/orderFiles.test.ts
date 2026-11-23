import { describe, expect, it } from 'vitest';
import { splitFileName, formatSize, estimateAtShop } from '../order/files';

describe('order/files utilities', () => {
  describe('splitFileName', () => {
    it('splits simple filename into base and ext', () => {
      expect(splitFileName('document.pdf')).toEqual({ base: 'document', ext: 'pdf' });
    });

    it('handles multiple dots by keeping base up to the last dot', () => {
      expect(splitFileName('final.report.v2.docx')).toEqual({ base: 'final.report.v2', ext: 'docx' });
    });

    it('lowercases the extension', () => {
      expect(splitFileName('IMAGE_SCAN.PNG')).toEqual({ base: 'IMAGE_SCAN', ext: 'png' });
    });

    it('handles hidden files or files without extension', () => {
      expect(splitFileName('.gitignore')).toEqual({ base: '.gitignore', ext: '' });
      expect(splitFileName('README')).toEqual({ base: 'README', ext: '' });
    });
  });

  describe('formatSize', () => {
    it('formats bytes, KB, and MB cleanly', () => {
      expect(formatSize(500)).toBe('500 B');
      expect(formatSize(2048)).toBe('2 KB');
      expect(formatSize(5 * 1024 * 1024)).toBe('5.0 MB');
    });
  });

  describe('estimateAtShop with empty files', () => {
    it('returns null when no files are uploaded', () => {
      expect(estimateAtShop([], { perPageBW: 2, perPageColor: 5, binding: 30 })).toBeNull();
    });
  });
});
