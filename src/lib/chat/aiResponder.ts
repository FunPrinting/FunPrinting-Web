import 'server-only';
import ChatMessage, { type IChatMessage } from '@/models/ChatMessage';
import Conversation, { type IConversation } from '@/models/Conversation';
import Order from '@/models/Order';
import Partner from '@/models/Partner';
import PickupBroadcast from '@/models/PickupBroadcast';
import { normalisePartnerCod, type PartnerCodConfig } from '@/lib/cod';
import { appendChatMessage } from '@/lib/chat/service';
import { logger } from '@/lib/logger';
import {
  buildDeterministicGroundedReply,
  buildEscalationHandoffMessage,
  detectEscalation,
  type AiGroundContext,
} from '@/lib/chat/aiLogic';
import { notifyPartnerChat } from '@/lib/wssClient';

function formatAddress(addr?: { street?: string; city?: string; state?: string; zipCode?: string }): string | undefined {
  if (!addr) return undefined;
  const s = [addr.street, addr.city, addr.state, addr.zipCode].filter(Boolean).join(', ');
  return s || undefined;
}

export async function loadAiGroundContext(conv: Pick<IConversation, 'partnerId' | 'orderId' | 'pickupPointName'>): Promise<AiGroundContext | null> {
  const [partner, order] = await Promise.all([
    Partner.findById(conv.partnerId)
      .select('businessName address phoneNumbers deliveryPoints scheduleSlots cod aiAssistant')
      .lean<{
        businessName?: string;
        address?: { street?: string; city?: string; state?: string; zipCode?: string };
        phoneNumbers?: string[];
        deliveryPoints?: Array<{ name: string; contactNumber?: string; isActive?: boolean }>;
        scheduleSlots?: Array<{ target: string; pickupPointName?: string; label?: string; startTime: string; endTime: string; isActive?: boolean }>;
        cod?: Partial<PartnerCodConfig>;
        aiAssistant?: { enabled?: boolean; faqNotes?: string; autoPauseMinutes?: number };
      } | null>(),
    conv.orderId
      ? Order.findOne({ orderId: conv.orderId })
          .select('orderId status paymentMethod paymentStatus amount deliveryNumber expectedDate deliveryOption shiprocket')
          .lean<Record<string, any> | null>()
      : null,
  ]);

  if (!partner) return null;

  const pickupPointName = order?.deliveryOption?.partnerDeliveryPoint || conv.pickupPointName;
  const recentCutoff = new Date(Date.now() - 24 * 3600_000);
  const latestBroadcast = pickupPointName
    ? await PickupBroadcast.findOne({
        partnerId: String(conv.partnerId),
        pickupPointName,
        createdAt: { $gte: recentCutoff },
      })
        .sort({ createdAt: -1 })
        .select('pickupPointName message createdAt')
        .lean<{ pickupPointName: string; message: string; createdAt: Date } | null>()
    : null;

  const activeSlots = (partner.scheduleSlots || []).filter((s) => s.isActive !== false);
  const scheduleSummary = activeSlots.map(
    (s) =>
      `${s.target === 'pickup_point' ? s.pickupPointName || 'Pickup Point' : 'Main Store'}: ${s.label || `${s.startTime}-${s.endTime}`}`
  );

  return {
    shop: {
      businessName: partner.businessName || 'Print Shop',
      address: formatAddress(partner.address),
      phoneNumbers: partner.phoneNumbers || [],
      faqNotes: partner.aiAssistant?.faqNotes || undefined,
      deliveryPoints: (partner.deliveryPoints || [])
        .filter((d) => d.isActive !== false)
        .map((d) => ({ name: d.name, contactNumber: d.contactNumber })),
      scheduleSummary,
      cod: normalisePartnerCod(partner.cod),
    },
    order: order
      ? {
          orderId: order.orderId,
          status: order.status,
          deliveryNumber: order.deliveryNumber,
          paymentMethod: order.paymentMethod || 'online',
          paymentStatus: order.paymentStatus,
          amount: order.amount,
          expectedDate: order.expectedDate ? new Date(order.expectedDate).toISOString().slice(0, 10) : undefined,
          deliveryType: order.deliveryOption?.type,
          pickupPointName: order.deliveryOption?.partnerDeliveryPoint,
          scheduledSlot: order.deliveryOption?.scheduledSlot?.date
            ? {
                date: order.deliveryOption.scheduledSlot.date,
                label: order.deliveryOption.scheduledSlot.label || '',
              }
            : undefined,
          trackingUrl: order.shiprocket?.trackingUrl,
          awbCode: order.shiprocket?.awbCode,
        }
      : null,
    latestBroadcast: latestBroadcast
      ? {
          pickupPointName: latestBroadcast.pickupPointName,
          message: latestBroadcast.message,
          createdAt: new Date(latestBroadcast.createdAt).toISOString(),
        }
      : null,
  };
}

type GeminiOutcome =
  | { ok: true; text: string; model: string }
  | { ok: false; reason: string };

async function callGeminiModel(
  apiKey: string,
  model: string,
  systemPrompt: string,
  question: string
): Promise<GeminiOutcome & { status?: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7500);

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        signal: controller.signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: 'user', parts: [{ text: question }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 1024 },
        }),
      }
    );
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      logger.warn({ model, status: res.status, body: errText.slice(0, 300) }, 'Gemini chat request returned error');
      return { ok: false, reason: `http_${res.status}`, status: res.status };
    }
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
    };
    const text = data.candidates?.[0]?.content?.parts
      ?.filter((p) => !p.thought)
      .map((p) => p.text || '')
      .join('')
      .trim();
    if (!text) {
      logger.warn({ model }, 'Gemini returned empty text');
      return { ok: false, reason: 'empty_response' };
    }
    return { ok: true, text: text.slice(0, 1200), model };
  } catch (error) {
    const isAbort = (error as { name?: string })?.name === 'AbortError';
    logger.warn({ model, err: error }, isAbort ? 'Gemini chat request timed out' : 'Gemini chat request failed');
    return { ok: false, reason: isAbort ? 'timeout' : 'network_error' };
  } finally {
    clearTimeout(timer);
  }
}

async function generateGeminiReply(ctx: AiGroundContext, question: string): Promise<GeminiOutcome> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false, reason: 'missing_api_key' };
  }

  const primary = process.env.GEMINI_CHAT_MODEL?.trim() || 'gemini-3.5-flash-lite';
  const models = [...new Set([primary, 'gemini-2.5-flash'])];

  const systemPrompt = [
    `You are the helpful customer support AI assistant for print shop "${ctx.shop.businessName}" on FunPrinting.`,
    'Rules:',
    '1. Answer ONLY using the JSON CONTEXT below. Never invent prices, timings, addresses, tracking numbers, or delivery promises.',
    '2. Keep replies concise (1-3 sentences), polite, and directly helpful.',
    '3. Online payments always use Razorpay only. Never claim to issue a refund or override COD approval yourself.',
    `CONTEXT JSON:\n${JSON.stringify(ctx)}`,
  ].join('\n');

  let lastReason = 'unknown';
  for (const model of models) {
    const out = await callGeminiModel(apiKey, model, systemPrompt, question);
    if (out.ok) return out;
    lastReason = out.reason;
    // Retry fallback model only if the primary model id wasn't found / bad request
    if (out.status !== 404 && out.status !== 400) break;
  }
  return { ok: false, reason: lastReason };
}

export async function maybeHandleAiAutoReply(opts: {
  conversationId: string;
  messageBody: string;
}): Promise<{ aiMessage: IChatMessage; conversation: IConversation } | null> {
  const conv = await Conversation.findOne({ conversationId: opts.conversationId }).lean<IConversation | null>();
  if (!conv) return null;

  const partner = await Partner.findById(conv.partnerId)
    .select('businessName aiAssistant')
    .lean<{ businessName?: string; aiAssistant?: { enabled?: boolean; autoPauseMinutes?: number } } | null>();
  if (!partner) return null;

  const ctx = await loadAiGroundContext(conv);
  if (!ctx) return null;

  const escalation = detectEscalation(opts.messageBody, {
    orderStatus: ctx.order?.status,
    paymentMethod: ctx.order?.paymentMethod,
  });

  if (escalation.escalate) {
    await Conversation.updateOne(
      { conversationId: conv.conversationId },
      { $set: { needsHumanAttention: true, escalationReason: escalation.reason } }
    );
    void notifyPartnerChat(conv.partnerId, {
      conversationId: conv.conversationId,
      orderId: conv.orderId,
      senderName: conv.customerName,
      preview: `⚠️ ${escalation.reason}`,
    }).catch(() => undefined);
  }

  // Respect partner opt-out or active manual takeover window
  if (partner.aiAssistant?.enabled === false) return null;
  if (conv.aiPausedUntil && new Date(conv.aiPausedUntil) > new Date()) return null;

  // Prevent duplicate bot messages within 3 seconds
  const recentBot = await ChatMessage.findOne({
    conversationId: conv.conversationId,
    senderType: 'ai_bot',
    createdAt: { $gte: new Date(Date.now() - 3000) },
  }).lean();
  if (recentBot) return null;

  let replyBody: string;
  let source: 'escalation' | 'gemini' | 'grounded_fallback' = 'grounded_fallback';
  let usedModel: string | undefined;
  let fallbackReason: string | undefined;

  if (escalation.escalate) {
    replyBody = buildEscalationHandoffMessage(escalation, ctx);
    source = 'escalation';
  } else {
    const llmReply = await generateGeminiReply(ctx, opts.messageBody);
    if (llmReply.ok) {
      replyBody = llmReply.text;
      source = 'gemini';
      usedModel = llmReply.model;
    } else {
      replyBody = buildDeterministicGroundedReply(ctx, opts.messageBody);
      fallbackReason = llmReply.reason;
    }
  }

  const saved = await appendChatMessage({
    conversationId: conv.conversationId,
    senderType: 'ai_bot',
    senderId: 'ai_bot',
    senderName: `${partner.businessName || 'Shop'} Assistant`,
    body: replyBody,
    metadata: {
      kind: escalation.escalate ? 'ai_escalation' : 'ai_reply',
      source,
      ...(usedModel ? { model: usedModel } : {}),
      ...(fallbackReason ? { fallbackReason } : {}),
      ...(escalation.escalate ? { category: escalation.category } : {}),
    },
  });

  return { aiMessage: saved.message, conversation: saved.conversation };
}

