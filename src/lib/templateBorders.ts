/** A customer's chosen border for their favourite templates (profile page, templates page, API). */
export const BORDER_STYLES = ['solid', 'dashed', 'dotted', 'double', 'groove', 'ridge', 'inset', 'outset'] as const;
export const BORDER_WIDTHS = ['1px', '2px', '3px', '4px', '5px'] as const;
export const BORDER_COLORS = {
  blue: '#3b82f6',
  green: '#10b981',
  purple: '#9333ea',
  gold: '#fbbf24',
  red: '#ef4444',
  orange: '#f97316',
  pink: '#ec4899',
  indigo: '#4f46e5',
  teal: '#14b8a6',
  gray: '#6b7280',
} as const;

export interface BorderPreference {
  style: string;
  color: string;
  width: string;
}

export const DEFAULT_BORDER: BorderPreference = { style: 'solid', color: 'blue', width: '2px' };

export function borderCss(p: BorderPreference): { borderStyle: string; borderColor: string; borderWidth: string } {
  return { borderStyle: p.style, borderWidth: p.width, borderColor: (BORDER_COLORS as Record<string, string>)[p.color] ?? p.color };
}

/** Keeps only values the UI offers, so a saved preference can't carry arbitrary CSS. */
export function cleanBorder(input: Partial<BorderPreference> | undefined, current: BorderPreference = DEFAULT_BORDER): BorderPreference {
  return {
    style: (BORDER_STYLES as readonly string[]).includes(input?.style ?? '') ? input!.style! : current.style,
    color: input?.color && input.color in BORDER_COLORS ? input.color : current.color,
    width: (BORDER_WIDTHS as readonly string[]).includes(input?.width ?? '') ? input!.width! : current.width,
  };
}
