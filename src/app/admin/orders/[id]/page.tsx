'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import AdminNavigation from '@/components/admin/AdminNavigation';
import LoadingSpinner from '@/components/admin/LoadingSpinner';
import AdminGoogleAuth from '@/components/admin/AdminGoogleAuth';
import NotificationProvider from '@/components/admin/NotificationProvider';
import { showSuccess, showError } from '@/lib/adminNotifications';
import { formatDate } from '@/lib/adminUtils';
import { OrderDetailView } from '@/components/OrderDetailView';

interface Order {
  _id: string;
  orderId: string;
  customerInfo?: {
    name: string;
    phone: string;
    email: string;
  };
  studentInfo?: {
    name: string;
    rollNo?: string;
    hostel?: string;
    roomNo?: string;
    phone: string;
    email: string;
    studentType?: 'hostler' | 'non-hostler';
    block?: string;
    address?: string;
    city?: string;
    state?: string;
    pinCode?: string;
    landmark?: string;
  };
  orderType: 'file' | 'template';
  fileURL?: string; // Legacy: single file URL (for backward compatibility)
  fileURLs?: string[]; // Array of file URLs for multiple files
  fileType?: string; // Legacy support
  fileTypes?: string[]; // Array of file types for multiple files (MIME types)
  originalFileName?: string; // Legacy: single file name (for backward compatibility)
  originalFileNames?: string[]; // Array of original file names for multiple files
  templateData?: {
    templateType: string;
    formData: Record<string, string | number | boolean>;
    generatedPDF?: string;
  };
  printingOptions: {
    pageSize: 'A4' | 'A3';
    color: 'color' | 'bw' | 'mixed';
    sided: 'single' | 'double';
    copies: number;
    pageCount?: number;
    serviceOption?: 'binding' | 'file' | 'service'; // Legacy support
    serviceOptions?: ('binding' | 'file' | 'service')[]; // Per-file service options
    pageColors?: {
      colorPages: number[];
      bwPages: number[];
    } | Array<{ // Per-file page colors (new format)
      colorPages: number[];
      bwPages: number[];
    }>;
    fileOptions?: Array<{ // Per-file printing options (new format)
      pageSize: 'A4' | 'A3';
      color: 'color' | 'bw' | 'mixed';
      sided: 'single' | 'double';
      copies: number;
      pageColors?: {
        colorPages: number[];
        bwPages: number[];
      };
    }>;
  };
  deliveryOption?: {
    type: 'pickup' | 'delivery';
    pickupLocationId?: string;
    pickupLocation?: {
      _id: string;
      name: string;
      address: string;
      lat: number;
      lng: number;
      contactPerson?: string;
      contactPhone?: string;
      operatingHours?: string;
      gmapLink?: string;
    };
    deliveryCharge?: number;
    address?: string;
    city?: string;
    pinCode?: string;
    coordinates?: {
      lat: number;
      lng: number;
    };
  };
  paymentStatus: 'pending' | 'completed' | 'failed';
  orderStatus: 'pending' | 'processing' | 'printing' | 'printed' | 'dispatched' | 'delivered';
  amount: number;
  expectedDate?: string | Date;
  createdAt: string;
}

function OrderDetailPageContent() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromPage = searchParams.get('fromPage');
  const adminBackUrl = fromPage ? `/admin?page=${fromPage}` : '/admin';
  const [order, setOrder] = useState<Order | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  const [isShipping, setIsShipping] = useState(false);
  const [pdfLoaded, setPdfLoaded] = useState(false);
  const [selectedFileIndex, setSelectedFileIndex] = useState(0); // For multiple file preview

  const fetchOrder = useCallback(async (orderId: string) => {
    try {
      const response = await fetch(`/api/admin/orders/${orderId}`);
      const data = await response.json();

      if (data.success) {
        const orderData = data.order;

        // Normalize file data: ensure safe arrays and legacy compatibility
        if (orderData) {
          // Ensure arrays are initialized
          orderData.fileURLs = Array.isArray(orderData.fileURLs) ? orderData.fileURLs : [];
          orderData.originalFileNames = Array.isArray(orderData.originalFileNames)
            ? orderData.originalFileNames
            : [];

          // Convert legacy single fields, if present
          if ((orderData.fileURLs?.length ?? 0) === 0 && orderData.fileURL) {
            orderData.fileURLs = [orderData.fileURL];
          }
          if ((orderData.originalFileNames?.length ?? 0) === 0 && orderData.originalFileName) {
            orderData.originalFileNames = [orderData.originalFileName];
          }

          // Ensure name list matches file list
          if (orderData.fileURLs.length > 0) {
            if (!Array.isArray(orderData.originalFileNames)) {
              orderData.originalFileNames = orderData.fileURLs.map((_: string, idx: number) => `File ${idx + 1}`);
            }
            if (orderData.originalFileNames.length !== orderData.fileURLs.length) {
              while (orderData.originalFileNames.length < orderData.fileURLs.length) {
                orderData.originalFileNames.push(`File ${orderData.originalFileNames.length + 1}`);
              }
              orderData.originalFileNames = orderData.originalFileNames.slice(0, orderData.fileURLs.length);
            }
            console.log(`✅ Order has ${orderData.fileURLs.length} files:`, orderData.originalFileNames);
          }
        }

        console.log('📋 Order data after normalization:', {
          hasFileURLs: !!orderData?.fileURLs,
          fileURLsLength: orderData?.fileURLs?.length || 0,
          hasFileURL: !!orderData?.fileURL,
          originalFileNamesLength: orderData?.originalFileNames?.length || 0
        });

        setOrder(orderData);
      } else {
        showError('Failed to fetch order details');
        router.push(adminBackUrl);
      }
    } catch (error) {
      console.error('Error fetching order:', error);
      showError('Failed to fetch order details');
      router.push(adminBackUrl);
    } finally {
      setIsLoading(false);
    }
  }, [router]);

  useEffect(() => {
    if (params.id) {
      fetchOrder(params.id as string);
      setPdfLoaded(false); // Reset PDF loaded state when order changes
      setSelectedFileIndex(0); // Reset to first file when order changes
    }
  }, [params.id, fetchOrder]);

  // Add timeout to prevent stuck loading state (onLoad may not fire for PDFs)
  useEffect(() => {
    const currentFileURL = (Array.isArray(order?.fileURLs) && order!.fileURLs.length > 0)
      ? order.fileURLs[selectedFileIndex]
      : order?.fileURL;
    if (order && currentFileURL && !pdfLoaded) {
      const timeout = setTimeout(() => {
        console.log('⏱️ Showing PDF preview after 3 seconds (onLoad may not fire for PDFs)');
        setPdfLoaded(true);
      }, 3000); // 3 second timeout as fallback

      return () => clearTimeout(timeout);
    }
  }, [order, order?.fileURL, order?.fileURLs, selectedFileIndex, pdfLoaded]);

  const updateOrderStatus = async (newStatus: string) => {
    if (!order) return;

    setIsUpdating(true);
    try {
      console.log(`🔄 Updating order ${order._id} status to: ${newStatus}`);

      const response = await fetch(`/api/admin/orders/${order._id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ orderStatus: newStatus }),
      });

      const data = await response.json();
      console.log('📋 API Response:', data);

      if (data.success) {
        setOrder({ ...order, orderStatus: newStatus as any });
        showSuccess(`Order status updated successfully to: ${newStatus}`);
      } else {
        console.error('❌ API Error:', data.error);
        showError(`Failed to update order status: ${data.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('❌ Network Error updating order status:', error);
      showError('Network error occurred while updating order status. Please check your connection and try again.');
    } finally {
      setIsUpdating(false);
    }
  };

  const sendToPrintQueue = async () => {
    if (!order) return;

    // Check if order has files to print
    const hasFiles = (order.fileURLs && order.fileURLs.length > 0) || order.fileURL;
    if (!hasFiles) {
      showError('Order has no files to print');
      return;
    }

    // Check if payment is completed
    if (order.paymentStatus !== 'completed') {
      showError('Order payment must be completed before printing');
      return;
    }

    setIsPrinting(true);
    try {
      console.log(`🖨️ Sending order ${order.orderId} to print queue`);

      const response = await fetch(`/api/admin/orders/${encodeURIComponent(order.orderId)}/job`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resend' }),
      });

      const data = await response.json();

      if (data.success) {
        showSuccess(`Order #${order.orderId} is in the shop's print queue`);
        // Refresh order data to get updated delivery number
        if (params.id) {
          await fetchOrder(params.id as string);
        }
      } else {
        showError(`Failed to send to print queue: ${data.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error sending to print queue:', error);
      showError('Failed to send the order to the shop.');
    } finally {
      setIsPrinting(false);
    }
  };

  const markAsPrinted = async () => {
    await updateOrderStatus('printed');
  };

  const deleteOrder = async () => {
    if (!order) return;

    // Confirmation dialog
    const confirmed = window.confirm(
      `Are you sure you want to delete order #${order.orderId}?\n\nThis action cannot be undone and will permanently remove the order from the system.`
    );

    if (!confirmed) return;

    setIsUpdating(true);
    try {
      const response = await fetch(`/api/admin/orders/${order._id}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();

      if (data.success) {
        showSuccess('Order deleted successfully!');
        router.push(adminBackUrl);
      } else {
        showError('Failed to delete order');
      }
    } catch (error) {
      console.error('Error deleting order:', error);
      showError('Failed to delete order');
    } finally {
      setIsUpdating(false);
    }
  };

  const shipOrder = async () => {
    if (!order) return;

    const confirmed = window.confirm(
      `Ship order #${order.orderId} via Shiprocket?\n\nThis will create a shipping order and assign a tracking number.`
    );
    if (!confirmed) return;

    setIsShipping(true);
    try {
      const response = await fetch(`/api/admin/orders/${order._id}/ship`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      const data = await response.json();

      if (data.success) {
        showSuccess(data.message || 'Order shipped via Shiprocket!');
        if (data.warning) {
          showError(data.warning);
        }
        // Refresh order data to get shiprocket fields
        if (params.id) {
          await fetchOrder(params.id as string);
        }
      } else {
        showError(`Failed to ship order: ${data.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error shipping order:', error);
      showError('Failed to ship order. Please try again.');
    } finally {
      setIsShipping(false);
    }
  };

  if (isLoading) {
    return <LoadingSpinner message="Loading order details..." size="large" />;
  }

  if (!order) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600">Order not found</p>
          <button
            onClick={() => router.push(adminBackUrl)}
            className="mt-4 bg-black text-white px-4 py-2 rounded-lg hover:bg-gray-800 transition-colors"
          >
            Back to Admin Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <AdminNavigation
          title={`Order #${order.orderId}`}
          subtitle={`Placed on ${formatDate(order.createdAt, 'long')}`}
          showBackButton
          backUrl={adminBackUrl}
          actions={
            <>
              <select
                value={order.orderStatus}
                onChange={(e) => updateOrderStatus(e.target.value)}
                disabled={isUpdating}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-black focus:border-black disabled:opacity-50"
              >
                <option value="pending">Pending</option>
                <option value="processing">Processing</option>
                <option value="printing">Printing</option>
                <option value="printed">Printed</option>
                <option value="dispatched">Dispatched</option>
                <option value="delivered">Delivered</option>
              </select>

              <button
                onClick={() => router.push(adminBackUrl)}
                className="bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-700 transition-colors"
              >
                Close
              </button>
            </>
          }
        />

        <OrderDetailView
          order={order}
          mode="admin"
          selectedFileIndex={selectedFileIndex}
          setSelectedFileIndex={setSelectedFileIndex}
          pdfLoaded={pdfLoaded}
          setPdfLoaded={setPdfLoaded}
          isUpdating={isUpdating}
          isPrinting={isPrinting}
          isShipping={isShipping}
          onUpdateStatus={updateOrderStatus}
          onSendToPrintQueue={sendToPrintQueue}
          onDeleteOrder={deleteOrder}
          onShipOrder={shipOrder}
          onMarkAsPrinted={markAsPrinted}
        />
      </div>
    </div>
  );
}

export default function OrderDetailPage() {
  return (
    <AdminGoogleAuth
      title="Order Details"
      subtitle="Sign in with Google to view and manage order details"
    >
      <NotificationProvider>
        <Suspense fallback={<LoadingSpinner message="Loading order details..." size="large" />}>
          <OrderDetailPageContent />
        </Suspense>
      </NotificationProvider>
    </AdminGoogleAuth>
  );
}
