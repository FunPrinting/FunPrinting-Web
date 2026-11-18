'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import {
  Building2,
  CheckCircle2,
  Download,
  ExternalLink,
  FileImage,
  FileText,
  File as FileIcon,
  Loader2,
  MapPin,
  Package,
  Phone,
  Printer,
  Trash2,
  Truck,
  User,
} from 'lucide-react';
import { formatDate, getDefaultExpectedDate } from '@/lib/adminUtils';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { OrderProgress, StatusBadge } from '@/components/orders/OrderStatus';

export interface OrderDetailViewProps {
  order: any;
  mode?: 'admin' | 'user';
  isUpdating?: boolean;
  isPrinting?: boolean;
  isShipping?: boolean;
  onUpdateStatus?: (newStatus: string) => void;
  onSendToPrintQueue?: () => void;
  onDeleteOrder?: () => void;
  onShipOrder?: () => void;
  onMarkAsPrinted?: () => void;
}

type ColorMode = 'color' | 'bw' | 'mixed';
interface PageColors { colorPages: number[]; bwPages: number[] }
interface OrderFile {
  url: string;
  name: string;
  type: string;
  color: ColorMode;
  service?: string;
  pageColors?: PageColors;
}

const MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml',
  pdf: 'application/pdf',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain', rtf: 'application/rtf',
};

function guessType(url: string, name: string) {
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? url.toLowerCase().match(/\.([a-z0-9]+)(\?|$)/)?.[1];
  return (ext && MIME[ext]) || 'application/octet-stream';
}

const colorLabel = (c?: string) => (c === 'color' ? 'Colour' : c === 'mixed' ? 'Mixed' : 'B&W');
const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Our own streaming endpoint: checks access and only serves files from our storage. */
function viewerUrl(url: string, orderId: string, name: string) {
  return `/api/admin/pdf-viewer?url=${encodeURIComponent(url)}&orderId=${encodeURIComponent(orderId)}&filename=${encodeURIComponent(name)}`;
}

/** Normalises the legacy single-file fields and the per-file option arrays into one list. */
function filesOf(order: any): OrderFile[] {
  const urls: string[] = Array.isArray(order.fileURLs) && order.fileURLs.length ? order.fileURLs : order.fileURL ? [order.fileURL] : [];
  const opts = order.printingOptions ?? {};
  const fileOptions = Array.isArray(opts.fileOptions) ? opts.fileOptions : [];
  return urls.map((url, i) => {
    const name = order.originalFileNames?.[i] || (i === 0 && order.originalFileName) || `File ${i + 1}`;
    const legacyColors = Array.isArray(opts.pageColors) ? opts.pageColors[i] : i === 0 ? opts.pageColors : undefined;
    return {
      url,
      name,
      type: order.fileTypes?.[i] || (i === 0 && urls.length === 1 && order.fileType) || guessType(url, name),
      color: fileOptions[i]?.color || opts.color || 'bw',
      service: Array.isArray(opts.serviceOptions) && opts.serviceOptions.length > i ? opts.serviceOptions[i] : opts.serviceOption,
      pageColors: fileOptions[i]?.pageColors || legacyColors,
    };
  });
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 text-sm">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right font-medium">{children}</dd>
    </div>
  );
}

function Section({ icon: Icon, heading, children, className }: { icon: React.ElementType; heading: string; children: React.ReactNode; className?: string }) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="size-4 text-muted-foreground" aria-hidden />
          {heading}
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function MixedPages({ colors, pageCount }: { colors: PageColors; pageCount?: number }) {
  const color = new Set(colors.colorPages ?? []);
  const bw = new Set(colors.bwPages ?? []);
  if (!color.size && !bw.size) return null;
  return (
    <div className="mt-2 space-y-2 rounded-lg border bg-muted/40 p-3 text-sm">
      <p className="font-medium">Mixed colour pages</p>
      <p className="text-muted-foreground">
        Colour: {color.size ? [...color].join(', ') : 'none'}
        <br />
        B&amp;W: {bw.size ? [...bw].join(', ') : 'none'}
      </p>
      {pageCount ? (
        <div className="flex max-h-32 flex-wrap gap-1 overflow-y-auto">
          {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
            <span
              key={n}
              title={`Page ${n}: ${color.has(n) ? 'colour' : bw.has(n) ? 'black & white' : 'not set'}`}
              className={cn(
                'min-w-7 rounded px-1.5 py-0.5 text-center text-xs font-medium',
                color.has(n) ? 'bg-primary text-primary-foreground' : bw.has(n) ? 'bg-foreground/15' : 'border text-muted-foreground'
              )}
            >
              {n}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FilePreview({ file, orderId, grayscale }: { file: OrderFile; orderId: string; grayscale: boolean }) {
  const [loaded, setLoaded] = useState(false);
  const src = viewerUrl(file.url, orderId, file.name);
  const isImage = file.type.startsWith('image/') && file.type !== 'image/svg+xml';
  const isPdf = file.type === 'application/pdf';

  // Some browsers never fire onLoad for PDFs in an iframe
  useEffect(() => {
    setLoaded(false);
    const t = setTimeout(() => setLoaded(true), 3000);
    return () => clearTimeout(t);
  }, [src]);

  if (!isImage && !isPdf) {
    return (
      <div className="flex h-96 flex-col items-center justify-center gap-3 rounded-lg border bg-muted/40 p-6 text-center">
        <FileIcon className="size-10 text-muted-foreground" aria-hidden />
        <p className="font-medium">{file.name}</p>
        <p className="text-sm text-muted-foreground">This file type can’t be previewed in the browser.</p>
        <Button asChild variant="outline"><a href={src}><Download />Download</a></Button>
      </div>
    );
  }

  return (
    <div className={cn('relative h-[32rem] overflow-hidden rounded-lg border bg-muted/40', grayscale && 'grayscale')}>
      {!loaded ? (
        <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="size-4 animate-spin" aria-hidden />Loading preview…
        </div>
      ) : null}
      {isImage ? (
        <Image src={src} alt={`Preview of ${file.name}`} unoptimized fill className="object-contain" onLoad={() => setLoaded(true)} />
      ) : (
        <iframe key={src} src={src} title={`Preview of ${file.name}`} className={cn('size-full border-0 transition-opacity', loaded ? 'opacity-100' : 'opacity-0')} onLoad={() => setLoaded(true)} allow="fullscreen" />
      )}
    </div>
  );
}

const SHIP_STEPS = ['Printed', 'Shipped', 'In transit', 'Delivered'];
const SHIP_STEP: Record<string, number> = {
  SHIPPED: 1, NEW: 1, PICKUP_SCHEDULED: 1,
  'IN TRANSIT': 2, OUT_FOR_DELIVERY: 2, REACHED_AT_DESTINATION_HUB: 2,
  DELIVERED: 3,
};

function Shipping({ order, admin, isShipping, onShipOrder }: { order: any; admin: boolean; isShipping: boolean; onShipOrder?: () => void }) {
  const sr = order.shiprocket;
  if (!sr?.awbCode) {
    return (
      <Section icon={Package} heading="Shipping">
        <p className="text-sm text-muted-foreground">Not shipped yet.</p>
        {admin && onShipOrder ? (
          <div className="mt-3 space-y-2">
            <Button onClick={onShipOrder} disabled={isShipping || order.paymentStatus !== 'completed'} className="w-full">
              {isShipping ? <Loader2 className="animate-spin" /> : <Truck />}Ship via Shiprocket
            </Button>
            {order.paymentStatus !== 'completed' ? <p className="text-xs text-warning">The order must be paid before it can be shipped.</p> : null}
          </div>
        ) : null}
      </Section>
    );
  }
  const current = SHIP_STEP[sr.status || ''] ?? 1;
  return (
    <Section icon={Package} heading="Shipping">
      <dl>
        <Row label="Courier">{sr.courierName || '—'}</Row>
        <Row label="AWB"><span className="font-mono">{sr.awbCode}</span></Row>
        {sr.status ? <Row label="Status">{sr.status}</Row> : null}
        {sr.lastTrackedAt ? <Row label="Last update">{formatDate(String(sr.lastTrackedAt), 'long')}</Row> : null}
      </dl>
      <ol className="mt-4 grid grid-cols-4 gap-1.5">
        {SHIP_STEPS.map((s, i) => (
          <li key={s} className="space-y-1.5">
            <div className={cn('h-1.5 rounded-full', i <= current ? 'bg-primary' : 'bg-muted')} />
            <span className={cn('block text-[11px]', i <= current ? 'font-medium' : 'text-muted-foreground')}>{s}</span>
          </li>
        ))}
      </ol>
      <Button asChild variant="outline" className="mt-4 w-full">
        <a href={sr.trackingUrl || `https://shiprocket.co/tracking/${sr.awbCode}`} target="_blank" rel="noopener noreferrer">Track shipment<ExternalLink /></a>
      </Button>
    </Section>
  );
}

function addressText(a: any) {
  if (!a) return '';
  if (typeof a === 'string') return a;
  return [a.street, a.city, a.state, a.zipCode].filter(Boolean).join(', ');
}

export function OrderDetailView({
  order,
  mode = 'admin',
  isUpdating = false,
  isPrinting = false,
  isShipping = false,
  onUpdateStatus,
  onSendToPrintQueue,
  onDeleteOrder,
  onShipOrder,
  onMarkAsPrinted,
}: OrderDetailViewProps) {
  const files = useMemo(() => (order ? filesOf(order) : []), [order]);
  const [selected, setSelected] = useState(0);
  useEffect(() => setSelected(0), [order?._id]);

  if (!order) return null;
  const admin = mode === 'admin';
  const opts = order.printingOptions ?? {};
  const delivery = order.deliveryOption;
  const customer = order.customerInfo || order.studentInfo || {};
  const partner = order.partnerInfo;
  const file = files[selected];
  const deliveryPoint = partner?.deliveryPoints?.find((dp: any) => dp.name === delivery?.partnerDeliveryPoint);
  const services: string[] = Array.isArray(opts.serviceOptions) && opts.serviceOptions.length ? [...new Set<string>(opts.serviceOptions)] : opts.serviceOption ? [opts.serviceOption] : [];
  const hasFiles = files.length > 0;

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <div className="space-y-6 lg:col-span-2">
        <Card>
          <CardHeader className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base">Status</CardTitle>
              <div className="flex flex-wrap gap-1.5">
                <StatusBadge status={order.status} />
                {admin ? (
                  <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-medium', order.paymentStatus === 'completed' ? 'bg-success/10 text-success' : order.paymentStatus === 'failed' ? 'bg-destructive/10 text-destructive' : 'bg-warning/10 text-warning')}>
                    Payment {order.paymentStatus || 'unknown'}
                  </span>
                ) : null}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <OrderProgress status={order.status} delivery={delivery?.type === 'delivery'} />
          </CardContent>
        </Card>

        <Section icon={FileText} heading="Order">
          <dl className="divide-y">
            <Row label="Order ID"><span className="font-mono">{order.orderId}</span></Row>
            <Row label="Placed">{order.createdAt ? new Date(order.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—'}</Row>
            <Row label="Type">{order.orderType === 'template' ? 'Template' : 'Uploaded files'}</Row>
            <Row label="Paper">{opts.pageSize || 'A4'}</Row>
            <Row label="Colour">{opts.color === 'color' ? 'Colour' : opts.color === 'mixed' ? 'Mixed' : 'Black & white'}</Row>
            <Row label="Sides">{opts.sided === 'double' ? 'Double-sided' : 'Single-sided'}</Row>
            <Row label="Copies">{opts.copies ?? 1}</Row>
            {opts.pageCount ? <Row label="Pages">{opts.pageCount}</Row> : null}
            {services.length ? <Row label="Finishing">{services.map(title).join(', ')}</Row> : null}
            <Row label="Expected">
              {order.expectedDate ? formatDate(String(order.expectedDate), 'long') : <span className="text-muted-foreground">{formatDate(getDefaultExpectedDate(order.createdAt), 'long')} (estimate)</span>}
            </Row>
            <Row label="Total"><span className="text-base tabular-nums">₹{Number(order.amount || 0).toLocaleString('en-IN')}</span></Row>
          </dl>
          {file?.pageColors && file.color === 'mixed' ? <MixedPages colors={file.pageColors} pageCount={opts.pageCount} /> : null}
        </Section>

        <Section icon={User} heading="Customer">
          <dl className="divide-y">
            <Row label="Name">{customer.name || '—'}</Row>
            <Row label="Phone">{customer.phone || '—'}</Row>
            <Row label="Email"><span className="break-all">{customer.email || '—'}</span></Row>
          </dl>
        </Section>

        {partner ? (
          <Section icon={Printer} heading="Print shop">
            <dl className="divide-y">
              <Row label="Shop">{partner.businessName}</Row>
              {partner.phoneNumbers?.length || partner.phone ? <Row label="Phone">{partner.phoneNumbers?.length ? partner.phoneNumbers.join(', ') : partner.phone}</Row> : null}
              {delivery?.partnerDeliveryPoint ? <Row label="Delivery point">{delivery.partnerDeliveryPoint}</Row> : null}
              {deliveryPoint?.contactNumber ? <Row label="Point contact">{deliveryPoint.contactNumber}</Row> : null}
              {partner.address ? <Row label="Address">{addressText(partner.address)}</Row> : null}
            </dl>
          </Section>
        ) : null}

        {delivery ? (
          <Section icon={delivery.type === 'delivery' ? Truck : Building2} heading={delivery.type === 'delivery' ? 'Delivery' : 'Pickup'}>
            {delivery.type === 'pickup' && delivery.pickupLocation ? (
              <dl className="divide-y">
                <Row label="Location">{delivery.pickupLocation.name}</Row>
                {delivery.pickupLocation.address ? <Row label="Address">{delivery.pickupLocation.address}</Row> : null}
                {delivery.pickupLocation.contactPerson ? <Row label="Contact">{delivery.pickupLocation.contactPerson}</Row> : null}
                {delivery.pickupLocation.contactPhone ? <Row label="Phone">{delivery.pickupLocation.contactPhone}</Row> : null}
                {delivery.pickupLocation.operatingHours ? <Row label="Hours">{delivery.pickupLocation.operatingHours}</Row> : null}
              </dl>
            ) : null}
            {delivery.type === 'pickup' && delivery.pickupLocation?.gmapLink ? (
              <Button asChild variant="outline" size="sm" className="mt-3">
                <a href={delivery.pickupLocation.gmapLink} target="_blank" rel="noopener noreferrer"><MapPin />Open in Google Maps</a>
              </Button>
            ) : null}
            {delivery.type === 'delivery' ? (
              <div className="space-y-1 text-sm">
                {delivery.recipientName || delivery.recipientPhone ? (
                  <p className="font-medium">{[delivery.recipientName, delivery.recipientPhone].filter(Boolean).join(' · ')}</p>
                ) : null}
                <p>{[delivery.flatBuilding, delivery.address].filter(Boolean).join(', ')}</p>
                {delivery.landmark ? <p className="text-muted-foreground">Landmark: {delivery.landmark}</p> : null}
                <p>{[delivery.city, delivery.state].filter(Boolean).join(', ')}{delivery.pinCode ? ` – ${delivery.pinCode}` : ''}</p>
                {delivery.deliveryCharge ? <p className="pt-1 text-muted-foreground">Delivery charge ₹{delivery.deliveryCharge}</p> : null}
                <p className="pt-1 text-muted-foreground">{delivery.method === 'shop' ? `Delivered by the shop${delivery.distance ? ` (${delivery.distance} km)` : ''}` : 'Courier'}</p>
                {delivery.method === 'shop' && delivery.handover?.code ? (
                  <div className="mt-3 rounded-lg border border-primary/30 bg-accent/40 p-3">
                    {delivery.handover.verifiedAt ? (
                      <p>Handed over {formatDate(String(delivery.handover.verifiedAt), 'long')}.</p>
                    ) : (
                      <>
                        <p className="text-muted-foreground">{admin ? 'Customer’s delivery code' : 'Give the delivery person this code'}</p>
                        <p className="font-mono text-2xl font-semibold tracking-[0.3em]">{delivery.handover.code}</p>
                      </>
                    )}
                  </div>
                ) : null}
              </div>
            ) : null}
          </Section>
        ) : null}

        {delivery?.type === 'delivery' ? <Shipping order={order} admin={admin} isShipping={isShipping} onShipOrder={onShipOrder} /> : null}
      </div>

      <div className="space-y-6 lg:col-span-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="size-4 text-muted-foreground" aria-hidden />
              {order.orderType === 'template' ? 'Document' : files.length > 1 ? `Files (${files.length})` : 'File'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {hasFiles ? (
              <>
                <ul className="space-y-2">
                  {files.map((f, i) => {
                    const Icon = f.type.startsWith('image/') ? FileImage : f.type === 'application/pdf' ? FileText : FileIcon;
                    return (
                      <li key={`${f.url}-${i}`}>
                        <div
                          className={cn(
                            'flex items-center gap-3 rounded-lg border p-3 transition-colors',
                            files.length > 1 && 'hover:bg-muted/50',
                            i === selected && files.length > 1 && 'border-primary bg-accent/40'
                          )}
                        >
                          <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                          <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setSelected(i)} aria-pressed={i === selected}>
                            <span className="block truncate text-sm font-medium">{f.name}</span>
                            <span className="text-xs text-muted-foreground">
                              {colorLabel(f.color)}{f.service && f.service !== 'service' ? ` · ${title(f.service)}` : ''}
                            </span>
                          </button>
                          <Button asChild variant="outline" size="sm">
                            <a href={viewerUrl(f.url, order.orderId, f.name)} target="_blank" rel="noopener noreferrer" aria-label={`Open ${f.name}`}><Download />Open</a>
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {file ? <FilePreview file={file} orderId={order.orderId} grayscale={file.color === 'bw'} /> : null}
              </>
            ) : order.orderType === 'template' && order.templateData?.generatedPDF ? (
              <>
                <div className="flex justify-end">
                  <Button asChild variant="outline" size="sm"><a href={order.templateData.generatedPDF} download><Download />Download PDF</a></Button>
                </div>
                <iframe src={order.templateData.generatedPDF} title="Generated document" className="h-[32rem] w-full rounded-lg border" />
                {order.templateData.formData && Object.keys(order.templateData.formData).length ? (
                  <dl className="divide-y rounded-lg border px-3">
                    {Object.entries(order.templateData.formData).map(([k, v]) => <Row key={k} label={k}>{String(v)}</Row>)}
                  </dl>
                ) : null}
              </>
            ) : (
              <p className="py-10 text-center text-sm text-muted-foreground">No document to preview.</p>
            )}
          </CardContent>
        </Card>

        {admin && onUpdateStatus && onSendToPrintQueue && onDeleteOrder ? (
          <Card>
            <CardHeader><CardTitle className="text-base">Actions</CardTitle></CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-2">
              <Button onClick={onSendToPrintQueue} disabled={isPrinting || isUpdating || order.paymentStatus !== 'completed' || !hasFiles} className="sm:col-span-2">
                {isPrinting ? <Loader2 className="animate-spin" /> : <Printer />}Send to the shop’s print queue
              </Button>
              <Button variant="outline" onClick={() => onUpdateStatus('processing')} disabled={order.orderStatus === 'processing' || isUpdating}>Mark processing</Button>
              <Button variant="outline" onClick={() => onUpdateStatus('printing')} disabled={order.orderStatus === 'printing' || isUpdating}>Mark printing</Button>
              {onMarkAsPrinted ? (
                <Button variant="outline" onClick={onMarkAsPrinted} disabled={order.orderStatus !== 'printing' || isUpdating}><CheckCircle2 />Mark printed</Button>
              ) : null}
              <Button variant="outline" onClick={() => onUpdateStatus('dispatched')} disabled={order.orderStatus === 'dispatched' || isUpdating}>Mark dispatched</Button>
              <Button variant="outline" onClick={() => onUpdateStatus('delivered')} disabled={order.orderStatus === 'delivered' || isUpdating}>Mark delivered</Button>
              {customer.phone ? (
                <Button asChild variant="outline"><a href={`tel:${customer.phone}`}><Phone />Call customer</a></Button>
              ) : null}
              <Button variant="destructive" onClick={onDeleteOrder} disabled={isUpdating} className="sm:col-span-2"><Trash2 />Delete order</Button>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
