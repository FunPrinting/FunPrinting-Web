'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';
import { Bot, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

export interface PartnerAiConfig {
  enabled: boolean;
  faqNotes: string;
  autoPauseMinutes: number;
}

export function PartnerAiCard({
  partner,
  onSaveAi,
}: {
  partner: { aiAssistant?: Partial<PartnerAiConfig> };
  onSaveAi: (aiAssistant: PartnerAiConfig) => Promise<void>;
}) {
  const initial = partner.aiAssistant;
  const [enabled, setEnabled] = useState(initial?.enabled !== false);
  const [faqNotes, setFaqNotes] = useState(initial?.faqNotes || '');
  const [autoPauseMinutes, setAutoPauseMinutes] = useState(String(initial?.autoPauseMinutes ?? 45));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const mins = Math.round(Number(autoPauseMinutes));
    if (!Number.isFinite(mins) || mins < 5 || mins > 240) {
      return toast.error('Auto-pause duration must be between 5 and 240 minutes');
    }
    setSaving(true);
    try {
      await onSaveAi({
        enabled,
        faqNotes: faqNotes.trim(),
        autoPauseMinutes: mins,
      });
      toast.success('AI chat assistant settings saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save AI settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot className="size-5 text-primary" aria-hidden />
          AI Support Assistant
        </CardTitle>
        <CardDescription>
          Instantly answers routine customer questions in chat using your live order statuses, pickup slots, COD rules, and shop notes. Pauses automatically whenever you reply in person.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <Label htmlFor="ai-enabled">Auto-answer customer queries in chat</Label>
            <p className="text-sm text-muted-foreground">
              Replies are tagged as AI and automatically hand off refund, damaged print, urgent, or COD approval queries to you.
            </p>
          </div>
          <Switch id="ai-enabled" checked={enabled} onCheckedChange={setEnabled} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="ai-faq">Shop FAQ &amp; pickup instructions (used by AI)</Label>
          <Textarea
            id="ai-faq"
            value={faqNotes}
            onChange={(e) => setFaqNotes(e.target.value)}
            maxLength={1500}
            rows={4}
            placeholder="e.g. Store is open Mon–Sat 9 AM to 8 PM near main gate. For Let Me Bake pickup point, our rider wears a blue FunPrinting bag and waits near the entrance during the scheduled slot."
          />
          <p className="text-xs text-muted-foreground">
            Give exact landmarks, lunch breaks, or binding turnaround notes ({faqNotes.length}/1500).
          </p>
        </div>

        <div className="max-w-xs space-y-2">
          <Label htmlFor="ai-pause-mins">Auto-pause after your manual reply (minutes)</Label>
          <Input
            id="ai-pause-mins"
            type="number"
            inputMode="numeric"
            min={5}
            max={240}
            value={autoPauseMinutes}
            onChange={(e) => setAutoPauseMinutes(e.target.value)}
          />
        </div>
      </CardContent>
      <CardFooter className="border-t pt-6">
        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2 className="animate-spin" /> : null}
          Save AI settings
        </Button>
      </CardFooter>
    </Card>
  );
}

