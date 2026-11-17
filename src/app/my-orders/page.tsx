'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useRouter } from 'next/navigation';
import { startOrderPayment } from '@/lib/payments/client';
import { MoneyIcon, EyeIcon, TrashIcon } from '@/components/SocialIcons';

interface Order {
  _id: string;
  orderId: string;
  customerInfo: {
    name: string;
    phone: string;
    email: string;
  };
  orderType: 'file' | 'template';
  fileURL?: string;
  fileURLs?: string[];
  fileType?: string;
  originalFileName?: string;
  originalFileNames?: string[];
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
    serviceOption?: 'binding' | 'file' | 'service';
    serviceOptions?: ('binding' | 'file' | 'service')[];
    pageColors?: {
      colorPages: number[];
      bwPages: number[];
    };
    fileOptions?: Array<{
      pageSize: 'A4' | 'A3';
      color: 'color' | 'bw' | 'mixed';
      sided: 'single' | 'double';
      copies: number;
    }>;
  };
  deliveryOption?: {
    type: 'pickup' | 'delivery';
    pickupLocation?: {
      name: string;
      address: string;
    };
    deliveryCharge?: number;
    address?: string;
    city?: string;
    pinCode?: string;
  };
  paymentStatus: 'pending' | 'completed' | 'failed';
  orderStatus: 'pending' | 'printing' | 'dispatched' | 'delivered';
  status?: 'pending_payment' | 'paid' | 'processing' | 'completed';
  amount: number;
  razorpayOrderId?: string;
  paymentRef?: string;
  razorpayPaymentId?: string;
  createdAt: string;
  shiprocket?: {
    orderId?: number;
    shipmentId?: number;
    awbCode?: string;
    courierName?: string;
    trackingUrl?: string;
    status?: string;
    lastTrackedAt?: string;
  };
}

export default function MyOrdersPage() {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [orders, setOrders] = useState<Order[]>([]);
  const [processingPayment, setProcessingPayment] = useState<string | null>(null);
  const [deletingOrder, setDeletingOrder] = useState<string | null>(null);

  // Redirect to sign in if not authenticated
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/auth/signin?callbackUrl=/my-orders');
    }
  }, [isAuthenticated, authLoading, router]);

  // Load orders when user is authenticated
  useEffect(() => {
    if (isAuthenticated && user?.email) {
      loadOrders();
    }
  }, [isAuthenticated, user?.email]);

  // Load orders for authenticated user
  const loadOrders = async () => {
    if (!user?.email) return;

    setIsLoading(true);
    try {
      const response = await fetch(`/api/orders?email=${encodeURIComponent(user.email)}`);
      const data = await response.json();

      if (data.success) {
        setOrders(data.orders);
      } else {
        console.error('Failed to fetch orders:', data.error);
      }
    } catch (error) {
      console.error('Error fetching orders:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending':
        return 'bg-yellow-100 text-yellow-800';
      case 'printing':
        return 'bg-blue-100 text-blue-800';
      case 'dispatched':
        return 'bg-purple-100 text-purple-800';
      case 'delivered':
        return 'bg-green-100 text-green-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getPaymentStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-800';
      case 'pending':
        return 'bg-yellow-100 text-yellow-800';
      case 'failed':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-IN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Pay for a pending order: the server reuses the open Payment Link or creates a new one
  const handlePayment = async (order: Order) => {
    setProcessingPayment(order._id);
    try {
      await startOrderPayment(order.orderId); // redirects to Razorpay
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to start the payment. Please try again.');
      setProcessingPayment(null);
    }
  };

  // Handle order deletion
  const handleDeleteOrder = async (order: Order) => {
    // Validate that order can be deleted
    if (order.paymentStatus === 'completed') {
      alert('Cannot delete a paid order. Please contact support for refunds.');
      return;
    }

    if (!confirm(`Are you sure you want to delete order #${order.orderId}? This action cannot be undone.`)) {
      return;
    }

    setDeletingOrder(order._id);

    try {
      const response = await fetch(`/api/orders/${order._id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      if (data.success) {
        alert(`✅ Order #${order.orderId} has been deleted successfully.`);
        await loadOrders(); // Refresh orders
      } else {
        alert(`Failed to delete order: ${data.error}`);
      }
    } catch (error) {
      console.error('Error deleting order:', error);
      alert('Failed to cancel order. Please try again.');
    } finally {
      setDeletingOrder(null);
    }
  };

  // Show loading state while checking authentication
  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-50 py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">Loading...</p>
          </div>
        </div>
      </div>
    );
  }

  // Show sign in prompt if not authenticated
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gray-50 py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center py-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-4">My Orders</h1>
            <p className="text-lg text-gray-600 mb-8">
              Please sign in to view your orders
            </p>
            <a
              href="/auth/signin?callbackUrl=/my-orders"
              className="bg-blue-600 text-white px-6 py-3 rounded-lg text-lg font-medium hover:bg-blue-700 transition-colors"
            >
              Sign In
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-4">My Orders</h1>
          <p className="text-lg text-gray-600">
            Welcome back, {user?.name || user?.email}! Here are your printing orders.
          </p>
        </div>

        {/* Refresh Button */}
        <div className="text-center mb-8">
          <button
            onClick={loadOrders}
            disabled={isLoading}
            className="bg-blue-600 text-white px-6 py-3 rounded-lg text-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? 'Refreshing...' : 'Refresh Orders'}
          </button>
        </div>

        {/* Pending Payment Notification */}
        {!isLoading && orders.filter(order => order.paymentStatus === 'pending' && order.status === 'pending_payment').length > 0 && (
          <div className="mb-8">
            <div className="bg-orange-50 border-l-4 border-orange-400 p-4 rounded-lg">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <svg className="h-5 w-5 text-orange-400" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="ml-3">
                  <p className="text-sm text-orange-700">
                    <span className="font-medium">Payment Required:</span> You have {orders.filter(order => order.paymentStatus === 'pending' && order.status === 'pending_payment').length} order(s) waiting for payment. Complete payment within 24 hours or your order will expire.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* All Orders List */}
        {isLoading && (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">Loading orders...</p>
          </div>
        )}

        {!isLoading && orders.length > 0 && (
          <div className="space-y-6">
            {orders.map((order) => {
              const isPendingPayment = order.paymentStatus === 'pending' && order.status === 'pending_payment';
              return (
                <div key={order._id} className={`rounded-lg shadow-lg p-6 ${isPendingPayment
                  ? 'bg-orange-50 border-2 border-orange-200'
                  : 'bg-white'
                  }`}>
                  <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between mb-4">
                    <div>
                      <h3 className={`text-lg font-semibold ${isPendingPayment ? 'text-orange-900' : 'text-gray-900'
                        }`}>
                        Order #{order.orderId}
                        {isPendingPayment && (
                          <span className="ml-2 text-orange-600 font-normal text-sm">
                            - Payment Required
                          </span>
                        )}
                      </h3>
                      <p className={`text-sm ${isPendingPayment ? 'text-orange-700' : 'text-gray-600'
                        }`}>
                        Placed on {formatDate(order.createdAt)}
                        {isPendingPayment && (
                          <span className="ml-2 font-medium">• Amount: ₹{order.amount}</span>
                        )}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2 mt-2 lg:mt-0">
                      <span className={`px-3 py-1 rounded-full text-xs font-medium ${isPendingPayment ? 'bg-orange-200 text-orange-800' : getStatusColor(order.orderStatus)
                        }`}>
                        {isPendingPayment ? 'Payment Pending' : order.orderStatus.charAt(0).toUpperCase() + order.orderStatus.slice(1)}
                      </span>
                      {!isPendingPayment && (
                        <span className={`px-3 py-1 rounded-full text-xs font-medium ${getPaymentStatusColor(order.paymentStatus)}`}>
                          Payment {order.paymentStatus.charAt(0).toUpperCase() + order.paymentStatus.slice(1)}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Multi-file badge + Printing Options */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                    <div>
                      <span className={`text-sm font-medium ${isPendingPayment ? 'text-orange-700' : 'text-gray-700'}`}>Order Type:</span>
                      <p className={`text-sm ${isPendingPayment ? 'text-orange-900' : 'text-gray-900'}`}>
                        {order.orderType === 'file' ? 'File Upload' : 'Template Generated'}
                        {order.fileURLs && order.fileURLs.length > 1 && (
                          <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                            📎 {order.fileURLs.length} files
                          </span>
                        )}
                      </p>
                    </div>
                    <div>
                      <span className={`text-sm font-medium ${isPendingPayment ? 'text-orange-700' : 'text-gray-700'}`}>Page Size:</span>
                      <p className={`text-sm ${isPendingPayment ? 'text-orange-900' : 'text-gray-900'}`}>{order.printingOptions.pageSize}</p>
                    </div>
                    <div>
                      <span className={`text-sm font-medium ${isPendingPayment ? 'text-orange-700' : 'text-gray-700'}`}>Color:</span>
                      <p className={`text-sm ${isPendingPayment ? 'text-orange-900' : 'text-gray-900'}`}>
                        {order.printingOptions.color === 'color' ? 'Color' :
                          order.printingOptions.color === 'bw' ? 'Black & White' : 'Mixed'}
                      </p>
                    </div>
                    <div>
                      <span className={`text-sm font-medium ${isPendingPayment ? 'text-orange-700' : 'text-gray-700'}`}>Copies:</span>
                      <p className={`text-sm ${isPendingPayment ? 'text-orange-900' : 'text-gray-900'}`}>{order.printingOptions.copies}</p>
                    </div>
                  </div>

                  {/* Delivery Info */}
                  {order.deliveryOption && (
                    <div className={`mb-4 p-3 rounded-lg ${isPendingPayment ? 'bg-orange-50' : 'bg-gray-50'}`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-base">{order.deliveryOption.type === 'pickup' ? '🏢' : '🚚'}</span>
                          <div>
                            <p className={`text-sm font-medium ${isPendingPayment ? 'text-orange-800' : 'text-gray-800'}`}>
                              {order.deliveryOption.type === 'pickup' ? 'Pickup' : 'Home Delivery'}
                            </p>
                            <p className="text-xs text-gray-500">
                              {order.deliveryOption.type === 'pickup'
                                ? order.deliveryOption.pickupLocation?.name || 'Pickup location'
                                : order.deliveryOption.address
                                  ? `${order.deliveryOption.address}${order.deliveryOption.city ? `, ${order.deliveryOption.city}` : ''}${order.deliveryOption.pinCode ? ` - ${order.deliveryOption.pinCode}` : ''}`
                                  : 'Delivery address'}
                            </p>
                          </div>
                        </div>
                        {order.deliveryOption.deliveryCharge != null && order.deliveryOption.deliveryCharge > 0 && (
                          <span className="text-xs font-medium text-gray-600 bg-white px-2 py-1 rounded">
                            +₹{order.deliveryOption.deliveryCharge} delivery
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Shiprocket Tracking Status + Progress Bar */}
                  {order.shiprocket?.awbCode && order.paymentStatus === 'completed' && (
                    <div className="mb-4 p-3 bg-purple-50 border border-purple-100 rounded-lg">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <span className="text-base">📦</span>
                          <div>
                            <p className="text-sm font-medium text-purple-800">
                              {order.shiprocket.status || 'Shipped'} {order.shiprocket.courierName ? `via ${order.shiprocket.courierName}` : ''}
                            </p>
                            <p className="text-xs text-purple-600">
                              AWB: {order.shiprocket.awbCode}
                            </p>
                          </div>
                        </div>
                        {order.shiprocket.trackingUrl && (
                          <a
                            href={order.shiprocket.trackingUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs font-medium text-purple-700 bg-purple-100 px-3 py-1 rounded-full hover:bg-purple-200 transition-colors"
                          >
                            Track Live →
                          </a>
                        )}
                      </div>
                      {/* 4-step progress bar */}
                      {(() => {
                        const statusMap: Record<string, number> = {
                          'pending': 0, 'NEW': 0,
                          'printing': 1, 'READY TO SHIP': 1, 'PICKUP SCHEDULED': 1,
                          'dispatched': 2, 'PICKED UP': 2, 'IN TRANSIT': 2, 'OUT FOR DELIVERY': 2, 'SHIPPED': 2,
                          'delivered': 3, 'DELIVERED': 3,
                        };
                        const step = Math.max(
                          statusMap[order.orderStatus] ?? 0,
                          statusMap[order.shiprocket?.status || ''] ?? 0
                        );
                        const steps = ['Ordered', 'Printing', 'Shipped', 'Delivered'];
                        return (
                          <div className="flex items-center gap-1">
                            {steps.map((label, i) => (
                              <div key={label} className="flex-1 flex flex-col items-center">
                                <div className={`w-full h-1.5 rounded-full ${i <= step ? 'bg-purple-500' : 'bg-purple-200'}`} />
                                <span className={`text-[10px] mt-1 ${i <= step ? 'text-purple-700 font-medium' : 'text-gray-400'}`}>{label}</span>
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  <div className={`border-t pt-4 ${isPendingPayment ? 'border-orange-200' : 'border-gray-200'
                    }`}>
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                      {!isPendingPayment && (
                        <div>
                          <span className="text-sm font-medium text-gray-700">Amount:</span>
                          <span className="text-lg font-semibold text-gray-900 ml-2">₹{order.amount}</span>
                        </div>
                      )}

                      <div className="flex flex-wrap gap-2">
                        {/* Pending Payment Actions */}
                        {order.paymentStatus === 'pending' && order.status === 'pending_payment' && (
                          <>
                            <button
                              onClick={() => handlePayment(order)}
                              disabled={processingPayment === order._id}
                              className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {processingPayment === order._id ? (
                                'Processing...'
                              ) : (
                                <span className="flex items-center gap-2">
                                  <MoneyIcon size={16} className="w-4 h-4" />
                                  Complete Payment
                                </span>
                              )}
                            </button>
                            {order.paymentRef && (
                              <a
                                href={`/payment/status/${encodeURIComponent(order.paymentRef)}`}
                                className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                              >
                                <span className="flex items-center gap-2">
                                  <EyeIcon size={16} className="w-4 h-4" />
                                  Check Payment Status
                                </span>
                              </a>
                            )}
                            <button
                              onClick={() => handleDeleteOrder(order)}
                              disabled={deletingOrder === order._id}
                              className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {deletingOrder === order._id ? (
                                'Cancelling...'
                              ) : (
                                <span className="flex items-center gap-2">
                                  <TrashIcon size={16} className="w-4 h-4" />
                                  Cancel Order
                                </span>
                              )}
                            </button>
                          </>
                        )}

                        {/* Completed Order Actions */}
                        {order.paymentStatus === 'completed' && (
                          <>
                            {order.orderType === 'template' && order.templateData?.generatedPDF && (
                              <a
                                href={order.templateData.generatedPDF}
                                download
                                className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 transition-colors"
                              >
                                Download PDF
                              </a>
                            )}

                            <button
                              onClick={() => router.push(`/orders/${order._id}`)}
                              className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                            >
                              <span className="flex items-center gap-2">
                                <EyeIcon size={16} className="w-4 h-4" />
                                View Order Details
                              </span>
                            </button>

                            {/* Shiprocket Track Order Button */}
                            {order.shiprocket?.awbCode && (
                              <a
                                href={order.shiprocket.trackingUrl || `https://shiprocket.co/tracking/${order.shiprocket.awbCode}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="bg-purple-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-purple-700 transition-colors"
                              >
                                <span className="flex items-center gap-2">
                                  📦 Track Order
                                </span>
                              </a>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Template Details */}
                  {order.orderType === 'template' && order.templateData && (
                    <div className="mt-4 p-4 bg-gray-50 rounded-lg">
                      <h4 className="font-medium text-gray-900 mb-2">Template Details</h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                        <div>
                          <span className="text-gray-600">Template:</span>
                          <span className="ml-2 text-gray-900">
                            {order.templateData.templateType.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                          </span>
                        </div>
                        {order.templateData.formData.subject && (
                          <div>
                            <span className="text-gray-600">Subject:</span>
                            <span className="ml-2 text-gray-900">{String(order.templateData.formData.subject)}</span>
                          </div>
                        )}
                        {order.templateData.formData.course && (
                          <div>
                            <span className="text-gray-600">Course:</span>
                            <span className="ml-2 text-gray-900">{String(order.templateData.formData.course)}</span>
                          </div>
                        )}
                        {order.templateData.formData.semester && (
                          <div>
                            <span className="text-gray-600">Semester:</span>
                            <span className="ml-2 text-gray-900">{String(order.templateData.formData.semester)}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {!isLoading && orders.length === 0 && (
          <div className="text-center py-8">
            <div className="text-gray-500 text-lg">No orders found.</div>
            <p className="text-gray-400 mt-2">You haven&apos;t placed any orders yet. <a href="/order" className="text-blue-600 hover:text-blue-800 underline">Place your first order</a> to get started!</p>
          </div>
        )}
      </div>
    </div>
  );
}
