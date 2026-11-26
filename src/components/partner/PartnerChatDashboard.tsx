'use client';

import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Loader2, Megaphone, MessageSquare, Send, Users } from 'lucide-react';
import { ChatThread } from '@/components/chat/ChatThread';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

interface PartnerConversation {
  conversationId: string;
  orderId?: string;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  pickupPointName?: string;
  scheduledSlot?: { date: string; label: string };
  lastMessageAt: string;
  lastMessagePreview: string;
  unreadPartner: number;
}

interface BroadcastItem {
  _id: string;
  pickupPointName: string;
  scheduledDate?: string;
  message: string;
  recipientCount: number;
  emailsSent: number;
  createdAt: string;
}

export function PartnerChatDashboard({
  deliveryPoints,
}: {
  deliveryPoints: Array<{ name: string; isActive?: boolean }>;
}) {
  const activePoints = deliveryPoints.filter((d) => d.isActive !== false);

  // ── Inbox State ──
  const [conversations, setConversations] = useState<PartnerConversation[]>([]);
  const [loadingConvs, setLoadingConvs] = useState(true);
  const [pointFilter, setPointFilter] = useState<string>('__all__');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // ── Broadcast State ──
  const [bpPoint, setBpPoint] = useState<string>(activePoints[0]?.name || '');
  const [bpDate, setBpDate] = useState<string>('');
  const [bpMessage, setBpMessage] = useState<string>('');
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [sendingBroadcast, setSendingBroadcast] = useState(false);
  const [broadcasts, setBroadcasts] = useState<BroadcastItem[]>([]);

  const loadConversations = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ role: 'partner' });
      if (pointFilter && pointFilter !== '__all__') qs.set('pickupPoint', pointFilter);
      const res = await fetch(`/api/chat/conversations?${qs.toString()}`, { cache: 'no-store' });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success) {
        const list = data.conversations as PartnerConversation[];
        setConversations(list);
        setSelectedId((prev) => (prev && list.some((c) => c.conversationId === prev) ? prev : list[0]?.conversationId || null));
      }
    } finally {
      setLoadingConvs(false);
    }
  }, [pointFilter]);

  const loadBroadcasts = useCallback(async () => {
    const res = await fetch('/api/partner/broadcasts', { cache: 'no-store' });
    const data = await res.json().catch(() => null);
    if (res.ok && data?.success) {
      setBroadcasts(data.broadcasts || []);
    }
  }, []);

  useEffect(() => {
    void loadConversations();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void loadConversations();
    }, 6000);
    return () => clearInterval(timer);
  }, [loadConversations]);

  useEffect(() => {
    void loadBroadcasts();
  }, [loadBroadcasts]);

  useEffect(() => {
    if (!bpPoint) {
      setPreviewCount(null);
      return;
    }
    let cancelled = false;
    const qs = new URLSearchParams({ preview: '1', pickupPoint: bpPoint });
    if (bpDate) qs.set('date', bpDate);
    fetch(`/api/partner/broadcasts?${qs.toString()}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && data?.success) setPreviewCount(data.recipientCount);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [bpPoint, bpDate]);

  const sendBroadcast = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bpPoint || !bpMessage.trim() || sendingBroadcast) return;
    setSendingBroadcast(true);
    try {
      const res = await fetch('/api/partner/broadcasts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pickupPointName: bpPoint,
          ...(bpDate ? { scheduledDate: bpDate } : {}),
          message: bpMessage.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Could not send broadcast');
      }
      toast.success(
        `Broadcast sent to ${data.recipientCount} order(s) (${data.emailsSent} email, ${data.chatMessagesCreated} chat)!`
      );
      setBpMessage('');
      void loadBroadcasts();
      void loadConversations();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not send broadcast');
    } finally {
      setSendingBroadcast(false);
    }
  };

  const quickFill = (template: string) => {
    if (!bpPoint) return;
    setBpMessage(template.replace(/\{point\}/g, bpPoint));
  };

  const activeConv = conversations.find((c) => c.conversationId === selectedId);

  return (
    <div className="space-y-6">
      {/* 1. Pickup-Point Broadcast Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Megaphone className="size-5 text-primary" aria-hidden />
            Pickup-point broadcast
          </CardTitle>
          <CardDescription>
            Notify every customer with an active order at a pickup point in one click (sends to their order chat + email).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {activePoints.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Add a pickup/delivery point in your shop settings to send pickup-point broadcasts.
            </p>
          ) : (
            <form onSubmit={sendBroadcast} className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div className="space-y-1.5">
                  <Label>Pickup point</Label>
                  <Select value={bpPoint} onValueChange={setBpPoint}>
                    <SelectTrigger><SelectValue placeholder="Choose pickup point" /></SelectTrigger>
                    <SelectContent>
                      {activePoints.map((pt) => (
                        <SelectItem key={pt.name} value={pt.name}>{pt.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="bp-date">Scheduled date (optional)</Label>
                  <Input id="bp-date" type="date" value={bpDate} onChange={(e) => setBpDate(e.target.value)} />
                </div>
                <div className="flex items-end">
                  <div className="flex h-10 w-full items-center gap-2 rounded-lg border bg-muted/40 px-3 text-xs font-medium text-muted-foreground">
                    <Users className="size-4 text-primary shrink-0" aria-hidden />
                    <span>
                      {previewCount === null
                        ? 'Checking active orders…'
                        : `${previewCount} active ${previewCount === 1 ? 'order' : 'orders'} will be notified`}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => quickFill('On the way to {point} with your orders, reaching in ~15 minutes.')}
                >
                  On the way (15 min)
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => quickFill('Reached {point}! Come collect your printed orders now.')}
                >
                  Reached pickup point
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => quickFill('Leaving {point} in 10 minutes — please collect your order soon!')}
                >
                  Leaving in 10 min
                </Button>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <Textarea
                  value={bpMessage}
                  onChange={(e) => setBpMessage(e.target.value)}
                  placeholder="Write an arrival or pickup announcement…"
                  rows={2}
                  maxLength={1000}
                  className="flex-1 resize-none"
                />
                <Button type="submit" disabled={!bpPoint || !bpMessage.trim() || sendingBroadcast}>
                  {sendingBroadcast ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                  Send broadcast
                </Button>
              </div>
            </form>
          )}

          {broadcasts.length > 0 ? (
            <div className="border-t pt-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recent broadcasts</p>
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {broadcasts.slice(0, 5).map((b) => (
                  <div key={b._id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs">
                    <div className="min-w-0 flex-1">
                      <span className="font-semibold">{b.pickupPointName}</span>
                      <span className="mx-1.5 text-muted-foreground">·</span>
                      <span className="text-muted-foreground">{b.message}</span>
                    </div>
                    <span className="shrink-0 text-muted-foreground">
                      {b.recipientCount} notified · {new Date(b.createdAt).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* 2. Customer Chat Inbox */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0 border-b">
          <div>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="size-5 text-primary" aria-hidden />
              Customer chat inbox
            </CardTitle>
            <CardDescription>Reply directly to customers about orders, pickup timing, or changes.</CardDescription>
          </div>
          {activePoints.length > 0 ? (
            <Select value={pointFilter} onValueChange={setPointFilter}>
              <SelectTrigger className="w-56"><SelectValue placeholder="Filter by pickup point" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All locations</SelectItem>
                {activePoints.map((pt) => (
                  <SelectItem key={pt.name} value={pt.name}>{pt.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </CardHeader>

        <CardContent className="p-0">
          {loadingConvs ? (
            <div className="flex h-64 items-center justify-center">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : conversations.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">No customer conversations yet.</p>
          ) : (
            <div className="grid min-h-[26rem] lg:grid-cols-[20rem_minmax(0,1fr)]">
              <div className="divide-y border-b lg:border-r lg:border-b-0 max-h-[34rem] overflow-y-auto">
                {conversations.map((c) => {
                  const isSelected = c.conversationId === selectedId;
                  return (
                    <button
                      key={c.conversationId}
                      type="button"
                      onClick={() => setSelectedId(c.conversationId)}
                      className={cn(
                        'w-full px-4 py-3 text-left transition-colors hover:bg-muted/50',
                        isSelected && 'bg-accent/60'
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-semibold">{c.customerName}</span>
                        {c.unreadPartner > 0 ? (
                          <Badge className="h-5 min-w-5 justify-center px-1.5 text-[10px]">{c.unreadPartner}</Badge>
                        ) : null}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                        {c.orderId ? <span className="font-mono text-primary">#{c.orderId}</span> : null}
                        {c.pickupPointName ? <span className="truncate">· {c.pickupPointName}</span> : null}
                      </div>
                      <p className="mt-1 truncate text-xs text-muted-foreground">{c.lastMessagePreview}</p>
                    </button>
                  );
                })}
              </div>

              <div className="p-4">
                {activeConv ? (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-xs">
                      <div>
                        <span className="font-semibold text-sm">{activeConv.customerName}</span>
                        <span className="ml-2 text-muted-foreground">{activeConv.customerPhone || activeConv.customerEmail}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {activeConv.orderId ? (
                          <Badge variant="outline" className="font-mono">#{activeConv.orderId}</Badge>
                        ) : null}
                        {activeConv.scheduledSlot?.date ? (
                          <Badge variant="secondary">
                            {activeConv.scheduledSlot.date} · {activeConv.scheduledSlot.label}
                          </Badge>
                        ) : null}
                      </div>
                    </div>

                    <ChatThread
                      conversationId={activeConv.conversationId}
                      role="partner"
                      onMessageSent={() => void loadConversations()}
                    />
                  </div>
                ) : (
                  <p className="py-16 text-center text-sm text-muted-foreground">Select a customer chat on the left.</p>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

