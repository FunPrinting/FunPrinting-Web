'use client';

import Link from 'next/link';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { CheckCircle2, FileText, Loader2, Lock, MapPin, ShoppingCart, Store, Truck } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import InlineAuthModal from '@/components/InlineAuthModal';
import InlinePhoneModal from '@/components/InlinePhoneModal';
import { DeliveryChooser, type DeliveryAddress, type DeliverySpeedChoice } from '@/components/order/DeliveryChooser';
import { ShopPicker, type ShopChoice } from '@/components/order/ShopPicker';
import { FileCard } from '@/components/order/FileCard';
import { FileDropzone } from '@/components/order/FileDropzone';
import { countPages, PageCountError, uploadFile } from '@/lib/order/client';
import { colorPagesOf, DEFAULT_OPTIONS, describeOptions, fileProblem, MAX_FILES, parcelWeight, splitFileName, totals, type Finishing, type OrderFile, type PrintOptions } from '@/lib/order/files';
import { saveOrderDraft, takeOrderDraft } from '@/lib/orderStatePersistence';
import { addToCart, dataUrlToFile, fileToDataUrl, generateCartId, getCart, getCartItem, removeFromCart, updateCartItem, type CartItem } from '@/lib/cartUtils';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const rupees = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

interface Customer {
  name: string;
  email: string;
  phone: string;
}
interface PriceChange {
  orderId: string;
  total: number;
  paymentUrl: string;
}

function makeFile(file: File, pages: number, options: Partial<PrintOptions> = {}, estimatedPages?: boolean): OrderFile {
  return { ...DEFAULT_OPTIONS, ...options, id: newId(), file, pages, estimatedPages, previewUrl: URL.createObjectURL(file) };
}

/** Cart items keep their own options; turn one into an order file. */
function fromCartItem(item: CartItem): OrderFile {
  const o = item.printingOptions;
  return makeFile(dataUrlToFile(item.fileDataUrl, item.fileName, item.fileType), item.pageCount, {
    pageSize: o.pageSize,
    color: o.color,
    sided: o.sided,
    copies: o.copies,
    finishing: (['service', 'file', 'binding'].includes(o.serviceOption) ? o.serviceOption : 'service') as Finishing,
    colorInput: o.color === 'mixed' ? (o.pageColors?.colorPages ?? []).join(', ') : '',
  });
}

function cartOptions(f: OrderFile): CartItem['printingOptions'] {
  const colorPages = colorPagesOf(f);
  return {
    pageSize: f.pageSize,
    color: f.color,
    sided: f.sided,
    copies: f.copies,
    serviceOption: f.finishing,
    pageColors: f.color === 'mixed' ? { colorPages, bwPages: Array.from({ length: f.pages }, (_, i) => i + 1).filter((p) => !colorPages.includes(p)) } : undefined,
  };
}

/** Why "Pay" can't go ahead yet (the first problem), or null. */
function blocker(files: OrderFile[], shop: ShopChoice | undefined, delivery: DeliveryAddress, deliveryCharge: number | null, price: number | null): string | null {
  if (!files.length) return 'Add a document to print';
  const bad = files.find((f) => fileProblem(f));
  if (bad) return `${bad.file.name}: ${fileProblem(bad)}`;
  if (!shop) return 'Choose a print shop';
  if (price === null) return 'Getting the price from the shop…';
  if (delivery.type === 'delivery') {
    const d = delivery;
    if (!d.recipientName || !d.recipientPhone || !d.flatBuilding || !d.address || !d.city || !d.state) return 'Complete the delivery address';
    if (!/^[1-9]\d{5}$/.test(d.pinCode || '')) return 'Enter a 6-digit pincode';
    if (deliveryCharge === null) return 'Choose how the order should be delivered';
  }
  return null;
}

function OrderPageContent() {
  const router = useRouter();
  const search = useSearchParams();
  const { user, isAuthenticated } = useAuth();

  const [files, setFiles] = useState<OrderFile[]>([]);
  const [counting, setCounting] = useState(false);
  const [shop, setShop] = useState<ShopChoice | undefined>();
  const [printingPrice, setPrintingPrice] = useState<number | null>(null);
  const [delivery, setDelivery] = useState<DeliveryAddress>({ type: 'pickup' });
  const [speed, setSpeed] = useState<DeliverySpeedChoice>('standard');
  const [deliveryCharge, setDeliveryCharge] = useState<number | null>(0);
  const [customer, setCustomer] = useState<Customer>({ name: '', email: '', phone: '' });
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [paying, setPaying] = useState(false);
  const [addingToCart, setAddingToCart] = useState(false);
  const [priceChange, setPriceChange] = useState<PriceChange | null>(null);
  const [editingCartId, setEditingCartId] = useState<string | null>(null);
  const [cartCount, setCartCount] = useState(0);
  // Cart items loaded by "Checkout": removed from the cart once payment starts
  const fromCart = useRef<string[]>([]);
  const receipts = useRef(new Map<string, string>());
  const checkoutKey = useRef<string>(newId());
  const filesRef = useRef(files);
  filesRef.current = files;
  const uploadAbortControllers = useRef(new Map<string, AbortController>());
  const uploadPromises = useRef(new Map<string, Promise<{ receipt: string; pageCount?: number }>>());

  // ── Background file upload & page count preprocessing ──────────────
  const uploadSingleFile = useCallback(
    (fileId: string, file: File): Promise<{ receipt: string; pageCount?: number }> => {
      const existingReceipt = receipts.current.get(fileId);
      if (existingReceipt) {
        setFiles((prev) =>
          prev.map((f) =>
            f.id === fileId ? { ...f, uploadStatus: 'uploaded', uploadProgress: 100, receipt: existingReceipt } : f
          )
        );
        return Promise.resolve({ receipt: existingReceipt });
      }

      const existingPromise = uploadPromises.current.get(fileId);
      if (existingPromise) return existingPromise;

      const prevController = uploadAbortControllers.current.get(fileId);
      if (prevController) prevController.abort();

      const controller = new AbortController();
      uploadAbortControllers.current.set(fileId, controller);

      setFiles((prev) =>
        prev.map((f) =>
          f.id === fileId ? { ...f, uploadStatus: 'uploading', uploadProgress: 0, uploadError: undefined } : f
        )
      );

      const promise = (async () => {
        try {
          const result = await uploadFile(
            file,
            (fraction) => {
              const pct = Math.round(fraction * 100);
              setFiles((prev) =>
                prev.map((f) => (f.id === fileId ? { ...f, uploadProgress: pct } : f))
              );
            },
            controller.signal
          );

          receipts.current.set(fileId, result.receipt);

          setFiles((prev) =>
            prev.map((f) =>
              f.id === fileId
                ? {
                    ...f,
                    uploadStatus: 'uploaded',
                    uploadProgress: 100,
                    receipt: result.receipt,
                    pages: result.pageCount && result.pageCount > 0 ? result.pageCount : f.pages,
                    estimatedPages: false,
                  }
                : f
            )
          );

          return result;
        } catch (err: any) {
          if (controller.signal.aborted) throw err;
          const msg = err instanceof Error ? err.message : 'Upload failed';
          setFiles((prev) =>
            prev.map((f) => (f.id === fileId ? { ...f, uploadStatus: 'error', uploadError: msg } : f))
          );
          throw err;
        } finally {
          uploadAbortControllers.current.delete(fileId);
          uploadPromises.current.delete(fileId);
        }
      })();

      uploadPromises.current.set(fileId, promise);
      return promise;
    },
    []
  );

  // Auto-start upload for any pending documents when the user signs in
  useEffect(() => {
    if (isAuthenticated) {
      const list = filesRef.current;
      for (const f of list) {
        if (!receipts.current.has(f.id) && f.uploadStatus !== 'uploading') {
          uploadSingleFile(f.id, f.file).catch(() => {});
        }
      }
    }
  }, [isAuthenticated, uploadSingleFile]);

  // ── Customer details ───────────────────────────────────────────────
  useEffect(() => {
    if (!isAuthenticated || !user) return;
    setCustomer((c) => ({ ...c, name: user.name || c.name, email: user.email || c.email }));
    fetch('/api/user/profile')
      .then((r) => r.json())
      .then((data) => {
        const phone = data?.profile?.phone;
        if (phone) setCustomer((c) => ({ ...c, phone: c.phone || phone }));
        else if (data?.success) setPhoneOpen(true);
      })
      .catch(() => undefined);
  }, [isAuthenticated, user]);

  // ── Adding documents ───────────────────────────────��───────────────
  const addFiles = useCallback(async (list: File[], options?: Partial<PrintOptions>) => {
    const room = MAX_FILES - filesRef.current.length;
    if (room <= 0) return toast.error(`You can add up to ${MAX_FILES} documents per order.`);
    if (list.length > room) toast.error(`Only the first ${room} documents were added (${MAX_FILES} per order).`);
    setCounting(true);
    const added: OrderFile[] = [];
    for (const file of list.slice(0, room)) {
      try {
        const { pages, estimated } = await countPages(file);
        const doc = makeFile(file, pages, options, estimated);
        if (isAuthenticated) {
          doc.uploadStatus = 'uploading';
          doc.uploadProgress = 0;
        } else {
          doc.uploadStatus = 'idle';
        }
        added.push(doc);
      } catch (e) {
        toast.error(e instanceof PageCountError ? e.message : `We couldn’t add “${file.name}”.`);
      }
    }
    setFiles((prev) => [...prev, ...added]);
    setCounting(false);

    // Immediately preprocess & upload documents in the background
    if (isAuthenticated) {
      for (const doc of added) {
        uploadSingleFile(doc.id, doc.file).catch(() => {});
      }
    }
  }, [isAuthenticated, uploadSingleFile]);

  const updateFile = (id: string, patch: Partial<PrintOptions>) => setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));

  const removeFile = (id: string) => {
    const controller = uploadAbortControllers.current.get(id);
    if (controller) controller.abort();
    uploadAbortControllers.current.delete(id);
    uploadPromises.current.delete(id);

    setFiles((prev) => {
      const gone = prev.find((f) => f.id === id);
      if (gone) URL.revokeObjectURL(gone.previewUrl);
      return prev.filter((f) => f.id !== id);
    });
    receipts.current.delete(id);
  };

  useEffect(() => () => {
    uploadAbortControllers.current.forEach((c) => c.abort());
    uploadAbortControllers.current.clear();
    uploadPromises.current.clear();
    filesRef.current.forEach((f) => URL.revokeObjectURL(f.previewUrl));
  }, []);

  // ── Arriving from elsewhere: Google sign-in, cart, a template ───────
  useEffect(() => {
    setCartCount(getCart().length);

    const draft = takeOrderDraft<DeliveryAddress>();
    if (draft) {
      setFiles(draft.files.map(({ file, pages, estimatedPages, ...options }) => makeFile(file, pages, options, estimatedPages)));
      setDelivery(draft.delivery);
      return;
    }

    const editId = search.get('editCartItem');
    if (editId) {
      const item = getCartItem(editId);
      if (!item) toast.error('That cart item no longer exists.');
      else {
        setFiles([fromCartItem(item)]);
        setEditingCartId(editId);
      }
      return;
    }

    if (search.get('checkout') === 'true') {
      const items = getCart();
      if (items.length) {
        setFiles(items.map(fromCartItem));
        fromCart.current = items.map((i) => i.id);
      }
      return;
    }

    // From the templates flow: the filled document is waiting in sessionStorage
    const pending = sessionStorage.getItem('pendingTemplateDocument');
    if (pending) {
      sessionStorage.removeItem('pendingTemplateDocument');
      (async () => {
        try {
          const t = JSON.parse(pending) as { pdfUrl?: string; wordUrl?: string; templateName?: string };
          const base = (t.templateName || 'document').replace(/[^\w\- ]/g, '').trim().replace(/\s+/g, '-') || 'document';
          for (const [url, ext, type] of [
            [t.pdfUrl, 'pdf', 'application/pdf'],
            [t.wordUrl, 'docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
          ] as const) {
            if (!url) continue;
            const res = await fetch(url).catch(() => null);
            if (!res?.ok) continue;
            await addFiles([new File([await res.blob()], `${base}.${ext}`, { type })]);
            return;
          }
          toast.error('We couldn’t load your document. Download it from the template page and upload it here.');
        } catch {
          toast.error('We couldn’t load your document from the template.');
        }
      })();
    }
    // Runs once on arrival
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Price ──────────────────────────────────────────────────────────
  const shownDelivery = delivery.type === 'delivery' ? deliveryCharge ?? 0 : 0;
  const sums = printingPrice === null ? null : totals(printingPrice, shownDelivery);
  const problem = blocker(files, shop, delivery, deliveryCharge, printingPrice);
  const weightKg = useMemo(() => parcelWeight(files), [files]);

  // ── Cart ───────────────────────────────────────────────────────────
  const addAllToCart = async () => {
    const bad = files.find((f) => fileProblem(f));
    if (bad) return toast.error(`${bad.file.name}: ${fileProblem(bad)}`);
    setAddingToCart(true);
    try {
      for (const f of files) {
        addToCart({ id: generateCartId(), fileName: f.file.name, fileSize: f.file.size, pageCount: f.pages, printingOptions: cartOptions(f), fileDataUrl: await fileToDataUrl(f.file), fileType: f.file.type, addedAt: Date.now() });
      }
      files.forEach((f) => URL.revokeObjectURL(f.previewUrl));
      setFiles([]);
      receipts.current.clear();
      setCartCount(getCart().length);
      toast.success('Added to your cart');
    } catch {
      toast.error('Your browser couldn’t store these files (the cart holds about 5 MB). Order them now instead.');
    } finally {
      setAddingToCart(false);
    }
  };

  const saveCartEdit = () => {
    const f = files[0];
    if (!editingCartId || !f) return;
    const issue = fileProblem(f);
    if (issue) return toast.error(issue);
    updateCartItem(editingCartId, { printingOptions: cartOptions(f) });
    toast.success('Cart item updated');
    router.push('/cart');
  };

  // ── Pay ────────────────────────────────────────────────────────────
  const goToPayment = (url: string) => {
    fromCart.current.forEach((id) => removeFromCart(id));
    checkoutKey.current = newId();
    window.location.assign(url);
  };

  const pay = async () => {
    if (!isAuthenticated) {
      setAuthMode('signin');
      setAuthOpen(true);
      return;
    }
    if (problem) return toast.error(problem);
    if (!customer.phone || customer.phone.replace(/\D/g, '').length < 10) {
      setPhoneOpen(true);
      return;
    }
    setPaying(true);
    try {
      const list = filesRef.current;

      // 1. Check if any file failed to upload
      const failed = list.find((f) => f.uploadStatus === 'error' && !receipts.current.has(f.id));
      if (failed) {
        throw new Error(`“${failed.file.name}” failed to upload. Click Retry on the document card.`);
      }

      // 2. Complete any pending or in-flight uploads
      const pending = list.filter((f) => !receipts.current.has(f.id));
      if (pending.length > 0) {
        for (const f of pending) {
          if (!uploadPromises.current.has(f.id)) {
            uploadSingleFile(f.id, f.file).catch(() => {});
          }
        }
        await Promise.all(
          pending.map((f) => {
            const p = uploadPromises.current.get(f.id);
            return p || uploadSingleFile(f.id, f.file);
          })
        );
      }

      // 3. Double check all receipts are ready
      const missing = filesRef.current.find((f) => !receipts.current.has(f.id));
      if (missing) {
        throw new Error(`Could not complete upload for “${missing.file.name}”. Please try again.`);
      }

      // 4. Checkout: the server prices the order and creates the payment link
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idempotencyKey: checkoutKey.current,
          customerInfo: customer,
          files: list.map((f) => ({
            receipt: receipts.current.get(f.id),
            pageSize: f.pageSize,
            color: f.color,
            sided: f.sided,
            copies: f.copies,
            colorPages: f.color === 'mixed' ? colorPagesOf(f) : undefined,
            service: f.finishing,
          })),
          delivery: {
            ...delivery,
            type: delivery.type,
            partnerId: shop!.id,
            partnerDeliveryPoint: shop!.deliveryPoint,
            speed: delivery.type === 'delivery' ? speed : undefined,
          },
          expectedDate: new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10),
        }),
      });
      const data = await res.json().catch(() => ({ success: false, error: 'Unexpected response from the server' }));
      if (!res.ok || !data.success || !data.paymentUrl) {
        if (res.status !== 409) checkoutKey.current = newId();
        throw new Error(data.error || 'Could not start the payment. Please try again.');
      }

      // 5. The server's price is final; ask again if it differs from what was shown
      const total = (data.amounts?.total ?? 0) / 100;
      if (sums && Math.abs(total - sums.total) >= 1) {
        setPriceChange({ orderId: data.orderId, total, paymentUrl: data.paymentUrl });
        return;
      }
      goToPayment(data.paymentUrl);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setPaying(false);
    }
  };

  const isAnyUploading = files.some((f) => f.uploadStatus === 'uploading');
  const payLabel = !isAuthenticated
    ? 'Sign in to pay'
    : paying
    ? isAnyUploading
      ? 'Uploading documents…'
      : 'Preparing payment…'
    : sums
    ? `Pay ${rupees(sums.total)}`
    : 'Pay';

  // ── Layout ─────────────────────────────────────────────────────────
  const step = (n: number, done: boolean) => (
    <span className={cn('grid size-7 shrink-0 place-items-center rounded-full text-sm font-semibold', done ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')} aria-hidden>
      {done ? <CheckCircle2 className="size-4" /> : n}
    </span>
  );

  return (
    <div className="mx-auto max-w-6xl px-4 pb-32 pt-10 sm:px-6 lg:pb-16">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">{editingCartId ? 'Edit cart item' : 'Order prints'}</h1>
          <p className="mt-1 text-muted-foreground">
            {editingCartId ? 'Change the print options, then save.' : 'Upload documents, choose a shop near you, and pick them up or get them delivered.'}
          </p>
        </div>
        {!editingCartId && cartCount ? (
          <Button variant="outline" asChild><Link href="/cart"><ShoppingCart />Cart ({cartCount})</Link></Button>
        ) : null}
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6 min-w-0">
          {/* 1. Documents */}
          <Card>
            <CardHeader className="flex flex-row items-start gap-3 space-y-0">
              {step(1, files.length > 0 && files.every((f) => !fileProblem(f)))}
              <div className="flex-1">
                <CardTitle>Documents</CardTitle>
                <CardDescription>Each document has its own print options.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {files.map((f, i) => (
                <FileCard
                  key={f.id}
                  file={f}
                  index={i}
                  onChange={(patch) => updateFile(f.id, patch)}
                  onRemove={() => removeFile(f.id)}
                  onRetryUpload={() => uploadSingleFile(f.id, f.file)}
                />
              ))}
              {editingCartId ? null : files.length ? (
                <div className="flex flex-wrap items-center gap-3">
                  <FileDropzone compact onFiles={(l) => addFiles(l)} busy={counting} />
                  {counting ? <span className="text-sm text-muted-foreground">Counting pages…</span> : null}
                </div>
              ) : (
                <>
                  <FileDropzone onFiles={(l) => addFiles(l)} busy={counting} />
                  <p className="text-center text-sm text-muted-foreground">
                    Need a resume or form? <Link href="/templates" className="font-medium text-primary hover:underline">Fill in a template</Link>, then print it here.
                  </p>
                </>
              )}
            </CardContent>
          </Card>

          {/* 2. Shop */}
          {!editingCartId && (
            <Card className="overflow-hidden">
              <CardHeader className="flex flex-row items-start gap-3 space-y-0">
                {step(2, Boolean(shop))}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <CardTitle>Print shop</CardTitle>
                    {shop?.distance !== undefined && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                        <MapPin className="size-3" />
                        {shop.distance.toFixed(1)} km away
                      </span>
                    )}
                  </div>
                  <CardDescription>
                    {shop
                      ? files.length
                        ? `Printing at ${shop.name} · Instant quote for your documents`
                        : `Pre-selected nearest shop: ${shop.name} · Upload documents to calculate total`
                      : 'Finding approved print shops near you…'}
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <ShopPicker
                  files={files}
                  value={shop}
                  onChange={(choice, price) => {
                    const changed = choice.id !== shop?.id;
                    setShop(choice);
                    setPrintingPrice(price);
                    if (changed) {
                      const delivers = Boolean(choice.delivery?.courier || choice.delivery?.self);
                      if (!delivers) setDelivery((d) => ({ ...d, type: 'pickup' }));
                      setDeliveryCharge(delivers && delivery.type === 'delivery' ? null : 0);
                    }
                  }}
                />
              </CardContent>
            </Card>
          )}

          {/* 3. Pickup or delivery */}
          {shop && !editingCartId ? (
            <Card>
              <CardHeader className="flex flex-row items-start gap-3 space-y-0">
                {step(3, delivery.type === 'pickup' || deliveryCharge !== null)}
                <div className="flex-1 min-w-0">
                  <CardTitle>Pickup or delivery</CardTitle>
                  <CardDescription>{shop.deliveryPoint ? `Pickup point: ${shop.deliveryPoint}` : `From ${shop.name}`}</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <DeliveryChooser
                  partnerId={shop.id}
                  shop={shop.delivery}
                  shopName={shop.deliveryPoint || shop.name}
                  weightKg={weightKg}
                  value={delivery}
                  speed={speed}
                  onChange={(next, nextSpeed, charge) => {
                    setDelivery(next);
                    setSpeed(nextSpeed);
                    setDeliveryCharge(next.type === 'pickup' ? 0 : charge);
                  }}
                />
              </CardContent>
            </Card>
          ) : null}
        </div>

        {/* Summary */}
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <Card>
            <CardHeader><CardTitle>Summary</CardTitle></CardHeader>
            <CardContent className="space-y-4 text-sm">
              {files.length ? (
                <ul className="space-y-2.5">
                  {files.map((f) => {
                    const { base, ext } = splitFileName(f.file.name);
                    return (
                      <li key={f.id} className="flex items-start gap-2.5 min-w-0">
                        <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="truncate font-medium text-foreground text-xs sm:text-sm" title={f.file.name}>
                              {base}
                            </span>
                            {ext && (
                              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase text-muted-foreground">
                                {ext}
                              </span>
                            )}
                          </div>
                          <span className="text-xs text-muted-foreground block truncate">
                            {f.pages} {f.pages === 1 ? 'page' : 'pages'}{f.estimatedPages ? ' (est)' : ''} · {describeOptions(f)}
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                  <FileText className="mx-auto size-5 mb-1 opacity-50" />
                  No documents added yet.
                </div>
              )}

              {!editingCartId ? (
                <>
                  <Separator />
                  <dl className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <dt className="flex items-center gap-1.5 text-muted-foreground shrink-0"><Store className="size-4" aria-hidden />Shop</dt>
                      <dd className="truncate text-right font-medium text-xs sm:text-sm">
                        {shop ? (
                          <span title={`${shop.name}${shop.distance !== undefined ? ` (${shop.distance.toFixed(1)} km)` : ''}`}>
                            {shop.name}
                            {shop.distance !== undefined && (
                              <span className="text-xs text-muted-foreground ml-1">({shop.distance.toFixed(1)} km)</span>
                            )}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground flex items-center gap-1 justify-end">
                            <Loader2 className="size-3 animate-spin" /> Locating nearest…
                          </span>
                        )}
                      </dd>
                    </div>
                    <div className="flex justify-between items-center">
                      <dt className="text-muted-foreground">Printing</dt>
                      <dd className="tabular-nums font-medium">
                        {printingPrice !== null ? rupees(printingPrice) : files.length === 0 ? <span className="text-xs text-muted-foreground font-normal">Add document</span> : <span className="text-xs text-muted-foreground font-normal">Calculating…</span>}
                      </dd>
                    </div>
                    <div className="flex justify-between items-center">
                      <dt className="flex items-center gap-1.5 text-muted-foreground"><Truck className="size-4" aria-hidden />{delivery.type === 'delivery' ? 'Delivery' : 'Pickup'}</dt>
                      <dd className="tabular-nums">{delivery.type === 'pickup' ? 'Free' : deliveryCharge === null ? 'Choose' : rupees(deliveryCharge)}</dd>
                    </div>
                    {sums ? (
                      <div className="flex justify-between">
                        <dt className="text-muted-foreground">Processing fee (3%)</dt>
                        <dd className="tabular-nums">{rupees(sums.fee)}</dd>
                      </div>
                    ) : null}
                  </dl>
                  <Separator />
                  <div className="flex items-baseline justify-between">
                    <span className="font-medium">Total</span>
                    {sums ? (
                      <span className="text-2xl font-semibold tabular-nums">{rupees(sums.total)}</span>
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        {files.length ? (shop ? 'Calculating…' : 'Choose a shop') : 'Add document to calculate'}
                      </span>
                    )}
                  </div>

                  <div className="hidden space-y-2 lg:block">
                    <Button size="lg" className="w-full" onClick={pay} disabled={paying || (isAuthenticated && Boolean(problem))}>
                      {paying ? <Loader2 className="animate-spin" /> : <Lock />}{payLabel}
                    </Button>
                    {isAuthenticated && problem ? <p className="text-center text-xs text-muted-foreground">{problem}</p> : null}
                    {files.length ? (
                      <Button variant="outline" className="w-full" onClick={addAllToCart} disabled={addingToCart || paying}>
                        {addingToCart ? <Loader2 className="animate-spin" /> : <ShoppingCart />}Save to cart for later
                      </Button>
                    ) : null}
                  </div>
                </>
              ) : (
                <div className="space-y-2">
                  <Button className="w-full" onClick={saveCartEdit} disabled={!files.length}>Save changes</Button>
                  <Button variant="outline" className="w-full" asChild><Link href="/cart">Cancel</Link></Button>
                </div>
              )}

              {isAnyUploading ? (
                <div className="rounded-lg border bg-muted/40 p-2.5 text-xs text-muted-foreground flex items-center gap-2" role="status">
                  <div className="size-2 rounded-full bg-primary animate-ping shrink-0" />
                  <span className="truncate">Uploading documents in background…</span>
                </div>
              ) : null}

              <p className="text-xs text-muted-foreground">
                The price is confirmed before you pay. Payments are processed by Razorpay; the shop is paid when your order is printed.
              </p>
            </CardContent>
          </Card>
        </aside>
      </div>

      {/* Mobile pay bar */}
      {!editingCartId && files.length ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 p-3 backdrop-blur lg:hidden" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
          <div className="mx-auto flex max-w-6xl items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">{problem && isAuthenticated ? problem : 'Total'}</p>
              <p className="text-lg font-semibold tabular-nums">{sums ? rupees(sums.total) : <span className="text-sm font-normal text-muted-foreground">Choose a shop</span>}</p>
            </div>
            <Button variant="outline" size="icon" onClick={addAllToCart} disabled={addingToCart || paying} aria-label="Save to cart for later"><ShoppingCart /></Button>
            <Button onClick={pay} disabled={paying || (isAuthenticated && Boolean(problem))}>{paying ? <Loader2 className="animate-spin" /> : null}{payLabel}</Button>
          </div>
        </div>
      ) : null}

      <Dialog open={Boolean(priceChange)} onOpenChange={(o) => !o && setPriceChange(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>The price changed to {priceChange ? rupees(priceChange.total) : ''}</DialogTitle>
            <DialogDescription>
              After uploading, the shop’s price for order #{priceChange?.orderId} is {priceChange ? rupees(priceChange.total) : ''} (it was shown as {sums ? rupees(sums.total) : '—'}). This usually means a page count was corrected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setPriceChange(null); router.push('/my-orders'); }}>Not now</Button>
            <Button onClick={() => priceChange && goToPayment(priceChange.paymentUrl)}>Pay {priceChange ? rupees(priceChange.total) : ''}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <InlineAuthModal
        isOpen={authOpen}
        onClose={() => setAuthOpen(false)}
        onAuthSuccess={() => setAuthOpen(false)}
        initialMode={authMode}
        onBeforeGoogleSignIn={async () => {
          const kept = await saveOrderDraft(files, delivery);
          if (!kept && files.length) toast('Your files are too large to keep during sign-in. Please add them again afterwards.');
        }}
      />
      <InlinePhoneModal isOpen={phoneOpen} onClose={() => setPhoneOpen(false)} onPhoneSaved={(phone) => setCustomer((c) => ({ ...c, phone }))} />
    </div>
  );
}

export default function OrderPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-6xl px-4 py-10"><Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Loading" /></div>}>
      <OrderPageContent />
    </Suspense>
  );
}
