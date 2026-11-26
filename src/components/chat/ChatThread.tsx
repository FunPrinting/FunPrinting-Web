'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Bot, Loader2, Megaphone, Send } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

export interface ChatMsg {
  _id: string;
  conversationId: string;
  senderType: 'customer' | 'partner' | 'ai_bot' | 'system';
  senderId: string;
  senderName: string;
  body: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

interface ChatThreadProps {
  conversationId: string;
  role: 'customer' | 'partner';
  emptyHint?: string;
  className?: string;
  onMessageSent?: () => void;
}

export function ChatThread({
  conversationId,
  role,
  emptyHint = 'No messages yet. Send a message below.',
  className,
  onMessageSent,
}: ChatThreadProps) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const latestAtRef = useRef<string | null>(null);

  const loadMessages = useCallback(
    async (incremental: boolean) => {
      try {
        const qs = new URLSearchParams({ role });
        if (incremental && latestAtRef.current) {
          qs.set('after', latestAtRef.current);
        }
        const res = await fetch(
          `/api/chat/conversations/${encodeURIComponent(conversationId)}/messages?${qs.toString()}`,
          { cache: 'no-store' }
        );
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.success || !Array.isArray(data.messages)) return;

        const incoming = data.messages as ChatMsg[];
        if (!incremental) {
          setMessages(incoming);
          if (incoming.length > 0) latestAtRef.current = incoming[incoming.length - 1].createdAt;
        } else if (incoming.length > 0) {
          setMessages((prev) => {
            const seen = new Set(prev.map((m) => m._id));
            const merged = [...prev];
            for (const m of incoming) {
              if (!seen.has(m._id)) merged.push(m);
            }
            return merged;
          });
          latestAtRef.current = incoming[incoming.length - 1].createdAt;
        }
      } catch {
        // silent poll retry
      }
    },
    [conversationId, role]
  );

  useEffect(() => {
    latestAtRef.current = null;
    setMessages([]);
    setLoading(true);
    loadMessages(false).finally(() => setLoading(false));

    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        void loadMessages(true);
      }
    }, 3500);

    return () => clearInterval(timer);
  }, [conversationId, loadMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const res = await fetch(
        `/api/chat/conversations/${encodeURIComponent(conversationId)}/messages?role=${role}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Could not send message');
      }
      setDraft('');
      if (data.message) {
        setMessages((prev) => [...prev, data.message]);
        latestAtRef.current = data.message.createdAt;
      } else {
        await loadMessages(true);
      }
      onMessageSent?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send');
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div className={cn('flex h-72 items-center justify-center', className)}>
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col', className)}>
      <div className="flex-1 space-y-3 overflow-y-auto px-1 py-3 max-h-96 min-h-52">
        {messages.length === 0 ? (
          <p className="py-10 text-center text-xs text-muted-foreground">{emptyHint}</p>
        ) : (
          messages.map((m) => {
            if (m.senderType === 'system') {
              return (
                <div
                  key={m._id}
                  className="mx-auto max-w-[90%] rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-foreground"
                >
                  <div className="mb-0.5 flex items-center gap-1.5 font-semibold text-primary">
                    <Megaphone className="size-3.5" aria-hidden />
                    <span>{m.senderName}</span>
                    <span className="ml-auto font-normal text-[10px] text-muted-foreground">
                      {new Date(m.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap">{m.body}</p>
                </div>
              );
            }

            const isOwn =
              (role === 'customer' && m.senderType === 'customer') ||
              (role === 'partner' && (m.senderType === 'partner' || m.senderType === 'ai_bot'));

            return (
              <div key={m._id} className={cn('flex flex-col', isOwn ? 'items-end' : 'items-start')}>
                <div className="mb-0.5 flex items-center gap-1.5 px-1 text-[10px] text-muted-foreground">
                  {m.senderType === 'ai_bot' ? (
                    <span className="inline-flex items-center gap-1 font-medium text-primary">
                      <Bot className="size-3" aria-hidden />
                      {m.senderName} (AI)
                    </span>
                  ) : (
                    <span>{isOwn ? 'You' : m.senderName}</span>
                  )}
                  <span>·</span>
                  <span>{new Date(m.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <div
                  className={cn(
                    'max-w-[85%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap break-words',
                    isOwn
                      ? 'rounded-br-sm bg-primary text-primary-foreground'
                      : 'rounded-bl-sm bg-muted text-foreground'
                  )}
                >
                  {m.body}
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="mt-2 flex items-end gap-2 border-t pt-3"
      >
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Type a message…"
          rows={2}
          maxLength={2000}
          className="min-h-[44px] max-h-28 resize-none text-sm"
        />
        <Button type="submit" size="icon" disabled={!draft.trim() || sending} className="size-10 shrink-0" aria-label="Send message">
          {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        </Button>
      </form>
    </div>
  );
}

