/** Shared by the template pages (browse, create, edit, my templates). Same values as DynamicTemplate.category. */
export const TEMPLATE_CATEGORIES = [
  { value: 'lab-manual', label: 'Lab manual' },
  { value: 'assignment', label: 'Assignment' },
  { value: 'report', label: 'Report' },
  { value: 'certificate', label: 'Certificate' },
  { value: 'other', label: 'Other' },
] as const;

export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number]['value'];

export const categoryLabel = (value: string) => TEMPLATE_CATEGORIES.find((c) => c.value === value)?.label ?? 'Other';

/** "Free" or "₹49". */
export const priceLabel = (t: { isPaid?: boolean; price?: number }) => (t.isPaid && (t.price ?? 0) > 0 ? `₹${t.price}` : 'Free');
