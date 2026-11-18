'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, CircleAlert } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { OrderDetailView } from '@/components/OrderDetailView';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export default function OrderDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [order, setOrder] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) router.push(`/auth/signin?callbackUrl=${encodeURIComponent(`/orders/${id}`)}`);
  }, [authLoading, isAuthenticated, router, id]);

  useEffect(() => {
    if (!isAuthenticated || !id) return;
    // The API only returns orders that belong to the signed-in user (404 otherwise)
    fetch(`/api/orders/${encodeURIComponent(id)}`)
      .then((r) => r.json())
      .then((data) => (data.success && data.order ? setOrder(data.order) : setError(data.error || 'We could not find this order.')))
      .catch(() => setError('Could not load the order. Check your connection and try again.'));
  }, [isAuthenticated, id]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-4">
        <Link href="/my-orders"><ArrowLeft />My orders</Link>
      </Button>

      {error ? (
        <Card className="mx-auto max-w-lg">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <CircleAlert className="size-8 text-muted-foreground" aria-hidden />
            <p>{error}</p>
            <Button asChild variant="outline"><Link href="/my-orders">Back to My orders</Link></Button>
          </CardContent>
        </Card>
      ) : !order ? (
        <div className="grid gap-6 lg:grid-cols-5" role="status" aria-label="Loading order">
          <div className="space-y-6 lg:col-span-2">
            <Skeleton className="h-28 rounded-xl" />
            <Skeleton className="h-80 rounded-xl" />
          </div>
          <Skeleton className="h-[36rem] rounded-xl lg:col-span-3" />
        </div>
      ) : (
        <>
          <div className="mb-6">
            <h1 className="text-3xl font-semibold">Order <span className="font-mono">#{order.orderId}</span></h1>
            <p className="mt-1 text-muted-foreground">Need to change something? Contact the print shop or <Link href="/contact" className="underline">our support team</Link>.</p>
          </div>
          <OrderDetailView order={order} mode="user" />
        </>
      )}
    </div>
  );
}
