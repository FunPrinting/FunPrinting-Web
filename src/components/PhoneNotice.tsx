import { cn } from '@/lib/utils';

/** Phone numbers are not verified, so tell people what the number is used for. */
export const PHONE_NOTICE = 'Use an active number you can answer. The print shop and our team will use it to contact you about your orders.';

export function PhoneNotice({ id, className }: { id?: string; className?: string }) {
  return (
    <p id={id} className={cn('text-xs text-muted-foreground', className)}>
      {PHONE_NOTICE}
    </p>
  );
}
