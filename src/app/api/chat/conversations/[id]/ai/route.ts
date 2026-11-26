import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import connectDB from '@/lib/mongodb';
import { resolveChatActor } from '@/lib/chat/service';
import Conversation from '@/models/Conversation';
import Partner from '@/models/Partner';

const actionSchema = z.object({
  action: z.enum(['pause', 'resume', 'clear_escalation']),
});

/**
 * POST /api/chat/conversations/[id]/ai?role=partner
 * Allows a partner to manually pause/resume the AI assistant or clear an escalation flag.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const actor = await resolveChatActor(req, req.nextUrl.searchParams.get('role') || 'partner');
    if ('error' in actor) {
      return NextResponse.json({ success: false, error: actor.error }, { status: actor.status });
    }
    if (actor.role !== 'partner') {
      return NextResponse.json({ success: false, error: 'Partner authentication required' }, { status: 403 });
    }

    const parsed = actionSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: 'Invalid AI control action' }, { status: 400 });
    }

    const { id } = await ctx.params;
    await connectDB();

    const conv = await Conversation.findOne({ conversationId: id, partnerId: actor.partnerId });
    if (!conv) {
      return NextResponse.json({ success: false, error: 'Conversation not found' }, { status: 404 });
    }

    let update: Record<string, unknown>;
    if (parsed.data.action === 'pause') {
      const partnerCfg = await Partner.findById(actor.partnerId)
        .select('aiAssistant.autoPauseMinutes')
        .lean<{ aiAssistant?: { autoPauseMinutes?: number } } | null>();
      const mins = Math.min(240, Math.max(5, partnerCfg?.aiAssistant?.autoPauseMinutes ?? 45));
      update = { $set: { aiPausedUntil: new Date(Date.now() + mins * 60_000) } };
    } else if (parsed.data.action === 'resume') {
      update = { $unset: { aiPausedUntil: '' }, $set: { needsHumanAttention: false, escalationReason: '' } };
    } else {
      update = { $set: { needsHumanAttention: false, escalationReason: '' } };
    }

    const updated = await Conversation.findOneAndUpdate(
      { conversationId: id, partnerId: actor.partnerId },
      update,
      { returnDocument: 'after' }
    ).lean();

    return NextResponse.json({ success: true, conversation: updated });
  } catch (error) {
    console.error('Error updating conversation AI state:', error);
    return NextResponse.json({ success: false, error: 'Failed to update AI state' }, { status: 500 });
  }
}

