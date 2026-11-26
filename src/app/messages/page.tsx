'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Loader2, MessageSquare } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { ChatThread } from '@/components/chat/ChatThread';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface ConversationItem {
  conversationId: string;
  orderId?: string;
  partnerId: string;
  partnerName: string;
  pickupPointName?: string;
  scheduledSlot?: { date: string; label: string };
  lastMessageAt: string;
  lastMessagePreview: string;
  unreadCustomer: number;
}

export default function CustomerMessagesPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading } = useAuth();
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const loadConversations = useCallback(async () => {
    try {
      const res = await fetch('/api/chat/conversations?role=customer', { cache: 'no-store' });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success) {
        const list = data.conversations as ConversationItem[];
        setConversations(list);
        setSelectedId((prev) => prev || list[0]?.conversationId || null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/auth/signin?callbackUrl=/messages');
    }
  }, [isLoading, isAuthenticated, router]);

  useEffect(() => {
    if (!isAuthenticated) return;
    void loadConversations();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void loadConversations();
    }, 8000);
    return () => clearInterval(timer);
  }, [isAuthenticated, loadConversations]);

  const active = conversations.find((c) => c.conversationId === selectedId);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">Messages</h1>
          <p className="mt-1 text-muted-foreground">Live chats and pickup updates from your print shops.</p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/my-orders">My orders</Link>
        </Button>
      </div>

      {loading ? (
        <div className="grid min-h-[40vh] place-items-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : conversations.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <MessageSquare className="size-10 text-muted-foreground opacity-50" />
            <p className="font-medium">No conversations yet</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Open any of your orders to start chatting directly with the print shop.
            </p>
            <Button asChild className="mt-1">
              <Link href="/my-orders">View my orders</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
          <Card className="overflow-hidden">
            <CardHeader className="border-b py-3.5">
              <CardTitle className="text-sm font-semibold">Conversations</CardTitle>
            </CardHeader>
            <div className="divide-y max-h-[34rem] overflow-y-auto">
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
                      <span className="truncate text-sm font-semibold">{c.partnerName}</span>
                      {c.unreadCustomer > 0 ? (
                        <Badge className="h-5 min-w-5 justify-center px-1.5 text-[10px]">{c.unreadCustomer}</Badge>
                      ) : null}
                    </div>
                    {c.orderId ? (
                      <p className="mt-0.5 font-mono text-[11px] text-primary">Order #{c.orderId}</p>
                    ) : null}
                    <p className="mt-1 truncate text-xs text-muted-foreground">{c.lastMessagePreview || 'Open chat'}</p>
                  </button>
                );
              })}
            </div>
          </Card>

          <Card>
            {active ? (
              <>
                <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 border-b py-4">
                  <div>
                    <CardTitle className="text-base">{active.partnerName}</CardTitle>
                    <CardDescription>
                      {active.orderId ? `Order #${active.orderId}` : 'General inquiry'}
                      {active.pickupPointName ? ` · ${active.pickupPointName}` : ''}
                    </CardDescription>
                  </div>
                  {active.orderId ? (
                    <Button variant="outline" size="sm" asChild>
                      <Link href={`/orders/${encodeURIComponent(active.orderId)}`}>
                        View order <ArrowRight className="size-3.5" />
                      </Link>
                    </Button>
                  ) : null}
                </CardHeader>
                <CardContent className="pt-4">
                  <ChatThread
                    conversationId={active.conversationId}
                    role="customer"
                    onMessageSent={() => void loadConversations()}
                  />
                </CardContent>
              </>
            ) : (
              <CardContent className="py-16 text-center text-sm text-muted-foreground">
                Select a conversation to view messages.
              </CardContent>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

