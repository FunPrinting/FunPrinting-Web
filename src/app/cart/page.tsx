'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileImage, FileText, File as FileIcon, Pencil, Plus, ShoppingCart, Trash2 } from 'lucide-react';
import {
  getCart,
  removeFromCart,
  clearCart,
  getCartWeight,
  estimateItemPrice,
  estimateCartTotal,
  type CartItem,
} from '@/lib/cartUtils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface PricingInfo {
  basePrices: { A4: number; A3: number };
  multipliers: { color: number; doubleSided: number };
  additionalServices?: { binding: number };
}

function fileIcon(name: string) {
  const n = name.toLowerCase();
  if (/\.(jpe?g|png|gif|webp)$/.test(n)) return FileImage;
  if (/\.(pdf|docx?)$/.test(n)) return FileText;
  return FileIcon;
}

function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function describe(o: CartItem['printingOptions']) {
  const color = o.color === 'color' ? 'Colour' : o.color === 'mixed' ? 'Mixed colour' : 'B&W';
  const extra = o.serviceOption && o.serviceOption !== 'service' ? ` · ${o.serviceOption === 'binding' ? 'Binding' : 'File'}` : '';
  return `${o.pageSize} · ${color} · ${o.sided === 'double' ? 'Double-sided' : 'Single-sided'} · ${o.copies} ${o.copies === 1 ? 'copy' : 'copies'}${extra}`;
}

export default function CartPage() {
  const router = useRouter();
  const [items, setItems] = useState<CartItem[] | null>(null);
  const [pricing, setPricing] = useState<PricingInfo | undefined>(undefined);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    setItems(getCart());
    fetch('/api/pricing')
      .then((res) => res.json())
      .then((data) => data.success && data.pricing && setPricing(data.pricing))
      .catch(() => { /* estimates fall back to default pricing */ });
  }, []);

  const price = (n: number) => (pricing ? `₹${n}` : null);

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">Cart</h1>
          <p className="mt-1 text-muted-foreground">Order several documents together and pay one delivery charge.</p>
        </div>
        <div className="flex gap-2">
          {items?.length ? <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setConfirmClear(true)}>Clear cart</Button> : null}
          <Button variant="outline" asChild><Link href="/order"><Plus />Add documents</Link></Button>
        </div>
      </div>

      {items === null ? (
        <div className="mt-8 space-y-4"><Skeleton className="h-28 rounded-xl" /><Skeleton className="h-28 rounded-xl" /></div>
      ) : items.length === 0 ? (
        <Card className="mt-8">
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <span className="grid size-12 place-items-center rounded-full bg-accent text-accent-foreground"><ShoppingCart className="size-6" aria-hidden /></span>
            <h2 className="font-semibold">Your cart is empty</h2>
            <p className="max-w-sm text-sm text-muted-foreground">On the order page, choose “Add to cart” to collect several documents before you pay.</p>
            <Button asChild className="mt-2"><Link href="/order">Start an order</Link></Button>
          </CardContent>
        </Card>
      ) : (
        <div className="mt-8 grid gap-6 lg:grid-cols-3">
          <ul className="space-y-3 lg:col-span-2">
            {items.map((item) => {
              const Icon = fileIcon(item.fileName);
              return (
                <li key={item.id}>
                  <Card className="gap-0 py-0">
                    <div className="flex items-start gap-4 p-4">
                      <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted"><Icon className="size-5 text-muted-foreground" aria-hidden /></span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{item.fileName}</p>
                        <p className="text-xs text-muted-foreground">
                          {fileSize(item.fileSize)} · {item.pageCount} {item.pageCount === 1 ? 'page' : 'pages'}
                        </p>
                        <p className="mt-1.5 text-sm text-muted-foreground">{describe(item.printingOptions)}</p>
                      </div>
                      <div className="text-right">
                        {price(estimateItemPrice(item, pricing)) ?? <Skeleton className="h-5 w-12" />}
                        <p className="text-[11px] text-muted-foreground">estimate</p>
                      </div>
                    </div>
                    <div className="flex justify-end gap-1 border-t px-3 py-2">
                      <Button variant="ghost" size="sm" onClick={() => router.push(`/order?editCartItem=${encodeURIComponent(item.id)}`)}><Pencil />Edit</Button>
                      <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setItems(removeFromCart(item.id))}><Trash2 />Remove</Button>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>

          <Card className="h-fit lg:sticky lg:top-24">
            <CardHeader><CardTitle>Summary</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{items.length} {items.length === 1 ? 'document' : 'documents'}</span>
                {price(estimateCartTotal(pricing)) ?? <Skeleton className="h-5 w-14" />}
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Delivery</span>
                <span className="text-muted-foreground">Chosen at checkout</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Combined weight</span>
                <span>{Math.round(getCartWeight() * 1000)} g</span>
              </div>
              <Separator />
              <div className="flex items-baseline justify-between">
                <span className="font-medium">Estimated total</span>
                <span className="text-xl font-semibold tabular-nums">{price(estimateCartTotal(pricing)) ?? <Skeleton className="h-6 w-16" />}</span>
              </div>
              <p className="text-xs text-muted-foreground">The final price is set by the shop you choose and shown before you pay.</p>
            </CardContent>
            <CardFooter>
              <Button size="lg" className="w-full" onClick={() => router.push('/order?checkout=true')}>Checkout</Button>
            </CardFooter>
          </Card>
        </div>
      )}

      <Dialog open={confirmClear} onOpenChange={setConfirmClear}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear your cart?</DialogTitle>
            <DialogDescription>All {items?.length ?? 0} documents will be removed from the cart.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Keep them</Button></DialogClose>
            <Button variant="destructive" onClick={() => { clearCart(); setItems([]); setConfirmClear(false); }}>Clear cart</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
