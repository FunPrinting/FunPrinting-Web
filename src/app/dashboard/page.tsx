'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { DocumentIcon, LocationIcon, ClockIcon, CheckIcon } from '@/components/SocialIcons';

export default function CustomerDashboard() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [orders, setOrders] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/auth/signin?callbackUrl=/dashboard');
    }
  }, [status, router]);

  useEffect(() => {
    if (status === 'authenticated') {
      const fetchOrders = async () => {
        try {
          const res = await fetch('/api/user/orders');
          const data = await res.json();
          if (data.success) {
            setOrders(data.orders);
          }
        } catch (error) {
          console.error("Error fetching orders:", error);
        } finally {
          setIsLoading(false);
        }
      };

      fetchOrders();
    }
  }, [status]);

  if (isLoading || status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  const getStatusColor = (orderStatus: string) => {
    switch (orderStatus) {
      case 'completed': return 'bg-green-100 text-green-800 border-green-200';
      case 'ready_for_pickup': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'printing': return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'assigned': return 'bg-indigo-100 text-indigo-800 border-indigo-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getStatusText = (orderStatus: string) => {
    switch (orderStatus) {
      case 'completed': return 'Delivered';
      case 'ready_for_pickup': return 'Ready for Pickup';
      case 'printing': return 'Printing at Shop';
      case 'assigned': return 'Dispatched to Shop';
      case 'paid': return 'Payment Confirmed';
      default: return orderStatus;
    }
  };

  const getGoogleMapsUrl = (location: any) => {
    if (!location || !location.coordinates) return null;
    const [lng, lat] = location.coordinates;
    return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* Header */}
      <div className="bg-indigo-600 pb-32">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 pb-16">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold text-white">My Print Jobs</h1>
              <p className="mt-2 text-indigo-100">Track active orders and view your receipt history.</p>
            </div>
            <Link href="/order" className="bg-white text-indigo-600 px-6 py-3 rounded-lg font-bold shadow hover:bg-indigo-50 transition-colors">
              + New Print
            </Link>
          </div>
        </div>
      </div>

      <main className="-mt-32 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden">
          
          {orders.length === 0 ? (
            <div className="p-16 text-center">
              <DocumentIcon size={64} className="mx-auto text-gray-300 mb-4" />
              <h3 className="text-xl font-bold text-gray-900 mb-2">No Print Jobs Yet</h3>
              <p className="text-gray-500 mb-6">You haven&apos;t ordered any prints. Get started by uploading a document.</p>
              <Link href="/order" className="inline-block bg-indigo-600 text-white px-8 py-3 rounded-lg font-bold hover:bg-indigo-700 transition">
                Start Printing
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {orders.map((order) => {
                const mapsUrl = getGoogleMapsUrl(order.partnerDetails?.location);
                const isReady = order.status === 'ready_for_pickup';
                
                return (
                  <div key={order.orderId} className="p-6 sm:p-8 hover:bg-gray-50 transition-colors">
                    <div className="flex flex-col lg:flex-row justify-between gap-6">
                      
                      {/* Left: Document Info */}
                      <div className="flex gap-4">
                        <div className="w-16 h-16 bg-indigo-50 rounded-lg flex items-center justify-center shrink-0 border border-indigo-100">
                          <DocumentIcon size={32} className="text-indigo-600" />
                        </div>
                        <div>
                          <h4 className="text-lg font-bold text-gray-900 mb-1">{order.originalFileName || 'Document'}</h4>
                          <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-gray-500">
                            <span className="flex items-center gap-1">
                              <span className="font-medium text-gray-700">Order ID:</span> {order.orderId.substring(0, 8)}
                            </span>
                            <span className="flex items-center gap-1">
                              <ClockIcon size={16} />
                              {new Date(order.createdAt).toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Middle: Partner Info */}
                      <div className="flex-1 lg:pl-8 lg:border-l border-gray-100">
                        <h5 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-2">Printing Partner</h5>
                        {order.partnerDetails ? (
                          <div>
                            <p className="font-bold text-gray-900">{order.partnerDetails.businessName}</p>
                            <p className="text-sm text-gray-500 mt-0.5">{order.partnerDetails.address?.street}</p>
                            
                            {mapsUrl && (
                              <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm font-bold text-indigo-600 hover:text-indigo-800 mt-2">
                                <LocationIcon size={16} />
                                Get Directions
                              </a>
                            )}
                          </div>
                        ) : (
                          <p className="text-sm text-gray-500">Assigning partner...</p>
                        )}
                      </div>

                      {/* Right: Status & Action */}
                      <div className="flex flex-col items-end gap-3 min-w-[150px]">
                        <span className="text-xl font-black text-gray-900">₹{order.amount}</span>
                        <div className={`px-3 py-1.5 rounded-full border text-sm font-bold flex items-center gap-2 ${getStatusColor(order.status)}`}>
                          {order.status === 'completed' && <CheckIcon size={16} />}
                          {getStatusText(order.status)}
                        </div>
                        
                        {isReady && (
                          <div className="mt-2 text-xs font-bold text-red-600 animate-pulse text-right">
                            Action Required:<br/>Pick up at shop!
                          </div>
                        )}
                      </div>

                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
