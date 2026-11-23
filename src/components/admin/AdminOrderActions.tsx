'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';
import { Loader2, Phone, RefreshCw, Trash2 } from 'lucide-react';
import { ORDER_STATUS } from '@/lib/orderStatus';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/** What an admin may set by hand. Payment states are changed by payments and by cancelling the print job. */
const SETTABLE = ['processing', 'printing', 'printed', 'ready_for_pickup', 'dispatched', 'delivered', 'completed'] as const;

interface Props {
  order: { _id: string; orderId: string; status: string; paymentStatus: string; customerInfo?: { phone?: string }; studentInfo?: { phone?: string } };
  onChanged: () => void | Promise<void>;
  onDeleted: () => void;
}

/** Manual status change, call the customer, and delete. Print-job actions live in AdminJobPanel. */
export default function AdminOrderActions({ order, onChanged, onDeleted }: Props) {
  const paid = order.paymentStatus === 'completed' && (order.status === 'paid' || (SETTABLE as readonly string[]).includes(order.status));
  const [target, setTarget] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [checkingPayment, setCheckingPayment] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const phone = order.customerInfo?.phone || order.studentInfo?.phone;

  const apply = async () => {
    if (!target) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/orders/${order._id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: target }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'We couldn’t change the status.');
      toast.success(`Now: ${ORDER_STATUS[target as keyof typeof ORDER_STATUS].label}`);
      setTarget('');
      await onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'We couldn’t change the status.');
    } finally {
      setSaving(false);
    }
  };

  const checkPayment = async () => {
    setCheckingPayment(true);
    try {
      const res = await fetch('/api/admin/check-razorpay-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: order.orderId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to check payment');
      if (data.status === 'paid') {
        toast.success('Payment confirmed on Razorpay! Order updated.');
        await onChanged();
      } else {
        toast.error(`Payment status on Razorpay: ${data.status || 'pending'}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not check payment with Razorpay');
    } finally {
      setCheckingPayment(false);
    }
  };

  const remove = async () => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/orders/${order._id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'We couldn’t delete the order.');
      toast.success('Order deleted');
      onDeleted();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'We couldn’t delete the order.');
      setDeleting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Manage</CardTitle>
        <CardDescription>Shops move orders along from their own apps. Use this to correct a mistake.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {paid ? (
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="set-status">Set status</Label>
              <Select value={target} onValueChange={setTarget}>
                <SelectTrigger id="set-status" className="w-56"><SelectValue placeholder="Choose a status" /></SelectTrigger>
                <SelectContent>
                  {SETTABLE.filter((s) => s !== order.status).map((s) => <SelectItem key={s} value={s}>{ORDER_STATUS[s].label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={apply} disabled={!target || saving}>{saving ? <Loader2 className="animate-spin" /> : null}Apply</Button>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Status can be set once the order is paid and not cancelled or refunded.</p>
            {order.paymentStatus === 'pending' && (
              <Button
                variant="outline"
                size="sm"
                onClick={checkPayment}
                disabled={checkingPayment}
              >
                {checkingPayment ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <RefreshCw className="mr-1.5 size-4" />}
                Check Razorpay payment
              </Button>
            )}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {phone ? <Button asChild variant="outline"><a href={`tel:${phone}`}><Phone />Call customer</a></Button> : null}
          <Button variant="destructive" onClick={() => setConfirmDelete(true)}><Trash2 />Delete order</Button>
        </div>
      </CardContent>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete order ${order.orderId}?`}
        description="It is removed for good and its print job is stopped. This does not refund the customer. To refund, use Cancel and refund in the print job panel first."
        confirmLabel="Delete order"
        destructive
        busy={deleting}
        onConfirm={remove}
      />
    </Card>
  );
}
