import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <main className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="max-w-md text-center">
        <p className="text-sm font-medium text-primary">404</p>
        <h1 className="mt-1 text-2xl font-semibold">We can’t find that page</h1>
        <p className="mt-2 text-muted-foreground">The link may be old, or the page may have moved.</p>
        <div className="mt-6 flex justify-center gap-3">
          <Button asChild><Link href="/">Go home</Link></Button>
          <Button asChild variant="outline"><Link href="/my-orders">My orders</Link></Button>
        </div>
      </div>
    </main>
  );
}
