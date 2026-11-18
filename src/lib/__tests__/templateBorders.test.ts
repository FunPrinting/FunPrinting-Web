import { describe, expect, it } from 'vitest';
import { borderCss, cleanBorder, DEFAULT_BORDER } from '@/lib/templateBorders';

describe('template borders', () => {
  it('keeps only values the UI offers', () => {
    expect(cleanBorder({ style: 'dashed', color: 'teal', width: '3px' })).toEqual({ style: 'dashed', color: 'teal', width: '3px' });
    expect(cleanBorder({ style: 'url(x)', color: 'red; background:url(x)', width: '999px' })).toEqual(DEFAULT_BORDER);
    expect(cleanBorder(undefined, { style: 'dotted', color: 'gold', width: '4px' })).toEqual({ style: 'dotted', color: 'gold', width: '4px' });
  });
  it('turns a preference into CSS', () => {
    expect(borderCss({ style: 'solid', color: 'gold', width: '2px' })).toEqual({ borderStyle: 'solid', borderWidth: '2px', borderColor: '#fbbf24' });
  });
});
