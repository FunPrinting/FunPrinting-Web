'use client';

import { use } from 'react';
import { Suspense } from 'react';
import AdminGoogleAuth from '@/components/admin/AdminGoogleAuth';
import NotificationProvider from '@/components/admin/NotificationProvider';
import LoadingSpinner from '@/components/admin/LoadingSpinner';
import { AdminDashboardContent } from '@/app/admin/page';

export default function PartnerOrdersPage({ params }: { params: Promise<{ partnerId: string }> }) {
  // Unwrap the Promise params
  const { partnerId } = use(params);

  return (
    <AdminGoogleAuth>
      <NotificationProvider>
        <Suspense fallback={<LoadingSpinner message="Loading partner orders..." />}>
          <AdminDashboardContent initialPartnerId={partnerId} />
        </Suspense>
      </NotificationProvider>
    </AdminGoogleAuth>
  );
}
