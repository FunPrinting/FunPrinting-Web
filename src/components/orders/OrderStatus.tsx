import { progressSteps, statusInfo, type StatusTone } from '@/lib/orderStatus';
import { cn } from '@/lib/utils';

const TONE: Record<StatusTone, string> = {
  neutral: 'bg-muted text-muted-foreground',
  primary: 'bg-accent text-accent-foreground',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  danger: 'bg-destructive/10 text-destructive',
};

/** Pill with the customer-facing label for Order.status. */
export function StatusBadge({ status, className }: { status?: string | null; className?: string }) {
  const info = statusInfo(status);
  return <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-medium', TONE[info.tone], className)}>{info.label}</span>;
}

/** Five-step bar (Paid → Accepted → Printed → Ready/Shipped → Collected/Delivered). Hidden before payment and for cancelled orders. */
export function OrderProgress({ status, delivery }: { status?: string | null; delivery: boolean }) {
  const info = statusInfo(status);
  if (info.step < 1) return null;
  return (
    <ol className="grid grid-cols-5 gap-1.5" aria-label={`Progress: ${info.label}`}>
      {progressSteps(delivery).map((label, i) => (
        <li key={label} className="space-y-1.5">
          <div className={cn('h-1.5 rounded-full', i < info.step ? 'bg-primary' : 'bg-muted')} />
          <span className={cn('block text-[11px]', i < info.step ? 'font-medium text-foreground' : 'text-muted-foreground')}>{label}</span>
        </li>
      ))}
    </ol>
  );
}
