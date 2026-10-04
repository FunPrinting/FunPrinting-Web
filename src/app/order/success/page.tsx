'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { CheckIcon, LocationIcon, PrinterIcon } from '@/components/SocialIcons';

function OrderSuccessContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const orderId = searchParams.get('orderId');
  const [orderDetails, setOrderDetails] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!orderId) {
      router.push('/dashboard');
      return;
    }

    const fetchOrder = async () => {
      try {
        const res = await fetch(`/api/user/orders/${orderId}`);
        const data = await res.json();
        
        if (data.success) {
          setOrderDetails(data.order);
        }
      } catch (err) {
        console.error('Error fetching order details:', err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchOrder();
  }, [orderId, router]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  if (!orderDetails) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Order Not Found</h1>
        <p className="text-gray-500 mb-6">We couldn&apos;t retrieve the details for this order.</p>
        <Link href="/dashboard" className="px-6 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition">
          Go to Dashboard
        </Link>
      </div>
    );
  }

  // Generate Google Maps URL using Partner's GeoJSON coordinates
  const partnerLocation = orderDetails.partnerDetails?.location?.coordinates;
  let mapsUrl = '';
  if (partnerLocation && partnerLocation.length === 2) {
    // MongoDB stores as [lng, lat], Google Maps needs lat,lng
    const [lng, lat] = partnerLocation;
    mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto">
        <div className="bg-white rounded-2xl shadow-xl overflow-hidden border border-gray-100">
          
          {/* Header */}
          <div className="bg-indigo-600 px-8 py-10 text-center text-white">
            <div className="w-20 h-20 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-6 backdrop-blur-sm">
              <CheckIcon size={40} className="text-white" />
            </div>
            <h1 className="text-3xl font-bold mb-2">Payment Successful!</h1>
            <p className="text-indigo-100 text-lg">Your order #{(orderId || '').substring(0, 8).toUpperCase()} has been dispatched to the printer.</p>
          </div>

          <div className="p-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              
              {/* Order Summary */}
              <div>
                <h2 className="text-lg font-bold text-gray-900 mb-4 border-b pb-2">Order Details</h2>
                <div className="space-y-3">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Amount Paid</span>
                    <span className="font-bold text-gray-900">₹{orderDetails.amount}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Document</span>
                    <span className="font-medium text-gray-900 truncate max-w-[150px]">{orderDetails.originalFileName || 'Document'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Delivery Type</span>
                    <span className="font-medium text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded capitalize">
                      {orderDetails.deliveryType || 'pickup'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Status</span>
                    <span className="font-medium text-yellow-600 bg-yellow-50 px-2 py-0.5 rounded capitalize">
                      {orderDetails.status}
                    </span>
                  </div>
                </div>
              </div>

              {/* Partner Details */}
              <div className="bg-gray-50 p-6 rounded-xl border border-gray-200">
                <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                  <PrinterIcon size={20} className="text-indigo-600" />
                  Printing Partner
                </h2>
                
                {orderDetails.partnerDetails ? (
                  <div className="space-y-4">
                    <div>
                      <p className="font-bold text-gray-900 text-lg">{orderDetails.partnerDetails.businessName}</p>
                      <p className="text-sm text-gray-500 mt-1">{orderDetails.partnerDetails.address?.street}, {orderDetails.partnerDetails.address?.city}</p>
                    </div>

                    {mapsUrl && (
                      <a 
                        href={mapsUrl} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-indigo-600 text-white rounded-lg font-bold hover:bg-indigo-700 transition-colors shadow-md"
                      >
                        <LocationIcon size={20} />
                        Navigate to Shop
                      </a>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500 italic">Partner details will be available shortly.</p>
                )}
              </div>
            </div>

            <div className="mt-10 pt-6 border-t border-gray-100 flex flex-col sm:flex-row gap-4 justify-center">
              <Link href="/dashboard" className="px-8 py-3 bg-gray-900 text-white rounded-lg font-bold hover:bg-gray-800 transition-colors text-center">
                View My Orders
              </Link>
              <Link href="/order" className="px-8 py-3 bg-white text-indigo-600 border border-indigo-200 rounded-lg font-bold hover:bg-indigo-50 transition-colors text-center">
                Print Another Document
              </Link>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}

export default function OrderSuccessPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      </div>
    }>
      <OrderSuccessContent />
    </Suspense>
  );
}
