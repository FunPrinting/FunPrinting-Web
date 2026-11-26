'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';
import { Loader2, MessageSquare } from 'lucide-react';
import { ChatThread } from '@/components/chat/ChatThread';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function OrderChatCard({
  orderId,
  shopName,
}: {
  orderId: string;
  shopName?: string;
}) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  const openChat = async () => {
    setOpening(true);
    try {
      const res = await fetch('/api/chat/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success || !data.conversation?.conversationId) {
        throw new Error(data.error || 'Could not open shop chat');
      }
      setConversationId(data.conversation.conversationId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not open chat');
    } finally {
      setOpening(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageSquare className="size-4 text-primary" aria-hidden />
          Chat with {shopName || 'Print Shop'}
        </CardTitle>
        <CardDescription>Ask about pickup timing, changes, or collection updates.</CardDescription>
      </CardHeader>
      <CardContent>
        {conversationId ? (
          <ChatThread
            conversationId={conversationId}
            role="customer"
            emptyHint={`Ask ${shopName || 'the print shop'} anything about order #${orderId}.`}
          />
        ) : (
          <Button variant="outline" className="w-full" onClick={openChat} disabled={opening}>
            {opening ? <Loader2 className="size-4 animate-spin" /> : <MessageSquare className="size-4" />}
            Open live chat
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

