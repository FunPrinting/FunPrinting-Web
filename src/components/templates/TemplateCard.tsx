'use client';

import Link from 'next/link';
import { Heart, Medal } from 'lucide-react';
import { categoryLabel, priceLabel } from '@/lib/templates';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardTitle } from '@/components/ui/card';

export interface TemplateSummary {
  id: string;
  name: string;
  description: string;
  category: string;
  isPublic: boolean;
  isPaid: boolean;
  price: number;
  createdByType?: string;
  createdByName?: string;
  isMine: boolean;
  purchaseCount: number;
  rank: number | null;
  isFavorite: boolean;
}

const RANK = {
  1: { label: 'Most used', colour: '#fbbf24' },
  2: { label: '2nd most used', colour: '#9ca3af' },
  3: { label: '3rd most used', colour: '#ea580c' },
} as const;

export function TemplateCard({ t, favouriteStyle, onToggleFavourite }: { t: TemplateSummary; favouriteStyle?: React.CSSProperties; onToggleFavourite: (t: TemplateSummary) => void }) {
  const rank = t.rank ? RANK[t.rank as 1 | 2 | 3] : null;
  const style = rank ? { borderWidth: 3, borderStyle: 'solid', borderColor: rank.colour } : t.isFavorite ? favouriteStyle : undefined;
  return (
    <Card className="h-full gap-4" style={style}>
      <div className="flex items-start justify-between gap-2 px-(--card-spacing)">
        <div className="min-w-0 space-y-2">
          <CardTitle className="line-clamp-2 text-base">{t.name}</CardTitle>
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="secondary">{categoryLabel(t.category)}</Badge>
            <Badge variant={t.isPaid ? 'default' : 'outline'}>{priceLabel(t)}</Badge>
            {rank ? <Badge variant="outline" className="gap-1"><Medal className="size-3" style={{ color: rank.colour }} aria-hidden />{rank.label}</Badge> : null}
            {t.isMine && !t.isPublic ? <Badge variant="outline">Only you</Badge> : null}
          </div>
        </div>
        <Button variant="ghost" size="icon" className="-mr-2 -mt-1 shrink-0" onClick={() => onToggleFavourite(t)} aria-pressed={t.isFavorite} aria-label={t.isFavorite ? `Remove ${t.name} from favourites` : `Add ${t.name} to favourites`}>
          <Heart className={cn(t.isFavorite && 'fill-current text-destructive')} />
        </Button>
      </div>
      <CardContent className="flex-1">
        <p className="line-clamp-3 text-sm text-muted-foreground">{t.description || 'No description.'}</p>
      </CardContent>
      <CardFooter className="items-center justify-between gap-2">
        <span className="truncate text-xs text-muted-foreground">
          {t.createdByType === 'admin' ? 'By Fun Printing' : t.createdByName ? `By ${t.createdByName}` : ''}
          {t.purchaseCount > 0 ? `${t.createdByName || t.createdByType === 'admin' ? ' · ' : ''}Used ${t.purchaseCount} ${t.purchaseCount === 1 ? 'time' : 'times'}` : ''}
        </span>
        <Button asChild size="sm"><Link href={`/templates/fill/${t.id}`}>Use template</Link></Button>
      </CardFooter>
    </Card>
  );
}
