'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { PrinterIcon, DollarIcon, DocumentIcon } from '@/components/SocialIcons';

export default function PartnerDashboard() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [partnerData, setPartnerData] = useState<any>(null);
  const [partnerOrders, setPartnerOrders] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Download logic states
  const [downloadLink, setDownloadLink] = useState('https://github.com/FunPrinting/partner-desktop/releases/latest/download/FunPrintingPartner-Setup.exe');
  const [downloadText, setDownloadText] = useState('For Windows PC');
  const [downloadBtnText, setDownloadBtnText] = useState('Download .exe');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const userAgent = window.navigator.userAgent.toLowerCase();
      if (userAgent.indexOf('mac') !== -1) {
        setDownloadText('For macOS');
        setDownloadBtnText('Download .dmg');
        setDownloadLink('https://github.com/FunPrinting/partner-desktop/releases/latest/download/FunPrintingPartner-Setup.dmg');
      } else if (userAgent.indexOf('win') !== -1) {
        setDownloadText('For Windows PC');
        setDownloadBtnText('Download .exe');
        setDownloadLink('https://github.com/FunPrinting/partner-desktop/releases/latest/download/FunPrintingPartner-Setup.exe');
      }
    }
  }, []);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/auth/signin?callbackUrl=/partner/dashboard');
    }
  }, [status, router]);

  useEffect(() => {
    if (status === 'authenticated') {
      const fetchProfileAndOrders = async () => {
        try {
          const res = await fetch('/api/partner/profile');
          const data = await res.json();
          if (data.success && data.partner) {
            setPartnerData(data.partner);
            
            // Phase 8: Fetch Orders
            const ordersRes = await fetch('/api/partner/orders');
            const ordersData = await ordersRes.json();
            if (ordersData.success) {
              setPartnerOrders(ordersData.orders);
            }
          } else {
            setPartnerData({
              businessName: '',
              razorpayAccountId: '',
              isActive: false,
              isOnline: false,
              earnings: { totalRevenue: 0, pendingPayout: 0 }
            });
          }
        } catch (err) {
          console.error("Error fetching partner profile", err);
        } finally {
          setIsLoading(false);
        }
      };
      fetchProfileAndOrders();
    }
  }, [status]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  const isProfileComplete = partnerData?.businessName && partnerData?.businessName.length > 0;

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <div className="bg-indigo-600 pb-32">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 pb-16">
          <h1 className="text-3xl font-bold text-white">Partner Control Center</h1>
          <p className="mt-2 text-indigo-100">Manage your printing franchise, monitor hardware, and track earnings.</p>
        </div>
      </div>

      <main className="-mt-32 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {!isProfileComplete ? (
          <div className="bg-white rounded-xl shadow-lg p-8 border border-gray-100">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">Complete Your Partner Profile</h2>
            <form className="space-y-6 max-w-2xl" onSubmit={(e) => { 
              e.preventDefault(); 
              
              if (!navigator.geolocation) {
                alert("Geolocation is not supported by your browser. Please use a supported browser.");
                return;
              }

              // Ask for location - strictly no fallback data to prevent routing errors
              navigator.geolocation.getCurrentPosition(
                async (position) => {
                  const form = e.target as HTMLFormElement;
                  const businessName = (form.elements.namedItem('businessName') as HTMLInputElement).value;
                  const razorpayAccountId = (form.elements.namedItem('razorpayAccountId') as HTMLInputElement).value;
                  
                  const payload = {
                    businessName,
                    razorpayAccountId,
                    location: { type: 'Point', coordinates: [position.coords.longitude, position.coords.latitude] },
                    address: { street: 'Provided Location', city: 'Dynamic' } // Usually reverse geocoded, kept simple here
                  };
                  
                  const res = await fetch('/api/partner/profile', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                  });
                  
                  const data = await res.json();
                  if (data.success) {
                    setPartnerData(data.partner);
                  } else {
                    alert(data.error);
                  }
                },
                (error) => {
                  console.error("Location access error:", error);
                  alert("Location access is required to become a partner so customers can find you. Please enable location permissions and try again.");
                }
              );
            }}>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Business/Shop Name</label>
                <input 
                  type="text" 
                  className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" 
                  placeholder="e.g. Campus Quick Print"
                  name="businessName"
                  defaultValue={partnerData?.businessName || ''}
                  required 
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Razorpay Linked Account ID (for payouts)</label>
                <input 
                  type="text" 
                  className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" 
                  placeholder="e.g. acc_XXXXXX"
                  name="razorpayAccountId"
                  defaultValue={partnerData?.razorpayAccountId || ''}
                  required 
                />
                <p className="text-xs text-gray-500 mt-1">Required for instant split payments (Razorpay Route) when customers order from your shop.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Shop Location</label>
                <div className="flex gap-4">
                  <button type="button" className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 border border-gray-300">
                    📍 Pin on Map
                  </button>
                  <span className="self-center text-sm text-gray-500">Location required for customers to find you.</span>
                </div>
              </div>
              <button type="submit" className="w-full sm:w-auto px-8 py-3 bg-indigo-600 text-white rounded-lg font-bold hover:bg-indigo-700 transition-colors shadow-md">
                Save & Continue
              </button>
            </form>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Quick Stats */}
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              <div className="bg-white overflow-hidden shadow-lg rounded-xl border border-gray-100">
                <div className="p-6">
                  <div className="flex items-center">
                    <div className="flex-shrink-0 bg-indigo-100 rounded-lg p-3">
                      <DollarIcon className="h-8 w-8 text-indigo-600" />
                    </div>
                    <div className="ml-5 w-0 flex-1">
                      <dl>
                        <dt className="text-sm font-medium text-gray-500 truncate">Pending Payout</dt>
                        <dd className="text-2xl font-bold text-gray-900">₹{partnerData.earnings.pendingPayout}</dd>
                      </dl>
                    </div>
                  </div>
                </div>
              </div>
              <div className="bg-white overflow-hidden shadow-lg rounded-xl border border-gray-100">
                <div className="p-6">
                  <div className="flex items-center">
                    <div className="flex-shrink-0 bg-green-100 rounded-lg p-3">
                      <PrinterIcon className="h-8 w-8 text-green-600" />
                    </div>
                    <div className="ml-5 w-0 flex-1">
                      <dl>
                        <dt className="text-sm font-medium text-gray-500 truncate">Total Revenue</dt>
                        <dd className="text-2xl font-bold text-gray-900">₹{partnerData.earnings.totalRevenue}</dd>
                      </dl>
                    </div>
                  </div>
                </div>
              </div>
              <div className="bg-white overflow-hidden shadow-lg rounded-xl border border-gray-100">
                <div className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-medium text-gray-500">Store Status</h3>
                      <p className="text-2xl font-bold text-gray-900 mt-1">
                        {partnerData.isOnline ? '🟢 Online' : '🔴 Offline'}
                      </p>
                    </div>
                    <button 
                      onClick={async () => {
                        const newState = !partnerData.isOnline;
                        const res = await fetch('/api/partner/profile', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ isOnline: newState })
                        });
                        if (res.ok) {
                          setPartnerData({...partnerData, isOnline: newState});
                        }
                      }}
                      className={`px-6 py-2 rounded-lg font-bold text-white transition-colors shadow-md ${partnerData.isOnline ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'}`}
                    >
                      {partnerData.isOnline ? 'Go Offline' : 'Go Online'}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Hardware & Downloads */}
            <div className="grid grid-cols-1 gap-8 mt-8">
              <div className="bg-white shadow-lg rounded-xl p-6 border border-gray-100" id="download">
                <h3 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                  <PrinterIcon className="w-6 h-6 text-gray-500" />
                  Partner Hardware Apps
                </h3>
                <p className="text-gray-600 mb-6">
                  To start receiving print jobs automatically, you must install the Partner App on the device connected to your printer. The app will maintain a secure connection to the FunPrinting Cloud.
                </p>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* PC/Mac Download */}
                  <div className="bg-gray-50 rounded-lg p-6 border border-gray-200 flex flex-col items-center text-center">
                    <svg className="w-12 h-12 text-indigo-600 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>
                    <h4 className="font-bold text-lg text-gray-900">{downloadText}</h4>
                    <p className="text-sm text-gray-500 mb-4 flex-1">For shops using a computer connected to USB/WiFi printers. Zero configuration required.</p>
                    <a href={downloadLink} target="_blank" className="w-full px-6 py-2 bg-indigo-600 text-white rounded-lg font-bold hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                      {downloadBtnText}
                    </a>
                  </div>

                  {/* Mobile Download */}
                  <div className="bg-gray-50 rounded-lg p-6 border border-gray-200 flex flex-col items-center text-center">
                    <svg className="w-12 h-12 text-green-600 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"></path></svg>
                    <h4 className="font-bold text-lg text-gray-900">For Android Mobile</h4>
                    <p className="text-sm text-gray-500 mb-4 flex-1">For shops running entirely from a smartphone. Uses Android PrintManager to connect to WiFi printers.</p>
                    <a href="https://github.com/funprinting/partner-apps/releases/latest/download/FunPrintingPartner.apk" target="_blank" className="w-full px-6 py-2 bg-green-600 text-white rounded-lg font-bold hover:bg-green-700 transition-colors flex items-center justify-center gap-2">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                      Download .apk
                    </a>
                  </div>
                </div>

                <div className="mt-6 p-4 bg-indigo-50 rounded-lg border border-indigo-100 flex items-start gap-3">
                  <svg className="w-5 h-5 text-indigo-600 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                  <div>
                    <h5 className="text-sm font-bold text-indigo-900">Connection Details</h5>
                    <p className="text-sm text-indigo-700 mt-1">
                      When you launch the app, enter your Partner ID: <code className="bg-indigo-100 px-1 py-0.5 rounded text-indigo-900 font-mono select-all">{partnerData._id}</code>
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Phase 8: Order Management Table */}
            <div className="mt-8 bg-white shadow-lg rounded-xl overflow-hidden border border-gray-100">
              <div className="px-6 py-5 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                  <DocumentIcon className="w-6 h-6 text-indigo-600" />
                  Order Management
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500 text-sm border-b border-gray-200">
                      <th className="px-6 py-4 font-medium">Order ID</th>
                      <th className="px-6 py-4 font-medium">Date</th>
                      <th className="px-6 py-4 font-medium">Document</th>
                      <th className="px-6 py-4 font-medium">Revenue</th>
                      <th className="px-6 py-4 font-medium">Status</th>
                      <th className="px-6 py-4 font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {partnerOrders.length > 0 ? (
                      partnerOrders.map((order) => (
                        <tr key={order.orderId} className="hover:bg-gray-50 transition-colors">
                          <td className="px-6 py-4 text-sm font-mono text-gray-900">{order.orderId.substring(0, 8)}</td>
                          <td className="px-6 py-4 text-sm text-gray-500">{new Date(order.createdAt).toLocaleDateString()}</td>
                          <td className="px-6 py-4 text-sm font-medium text-gray-900 max-w-[150px] truncate">{order.originalFileName || 'Document'}</td>
                          <td className="px-6 py-4 text-sm font-bold text-green-600">₹{(order.amount * 0.9).toFixed(2)}</td>
                          <td className="px-6 py-4">
                            <span className={`px-2 py-1 text-xs rounded-full font-medium ${
                              order.status === 'completed' ? 'bg-green-100 text-green-800' :
                              order.status === 'ready_for_pickup' ? 'bg-yellow-100 text-yellow-800' :
                              order.status === 'printing' ? 'bg-blue-100 text-blue-800' :
                              'bg-gray-100 text-gray-800'
                            }`}>
                              {order.status}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-sm">
                            {order.status !== 'completed' && (
                              <select 
                                className="bg-white border border-gray-300 rounded px-2 py-1 text-sm focus:ring-indigo-500 focus:border-indigo-500"
                                value={order.status}
                                onChange={async (e) => {
                                  const newStatus = e.target.value;
                                  const res = await fetch(`/api/partner/orders/${order.orderId}`, {
                                    method: 'PATCH',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ status: newStatus })
                                  });
                                  if (res.ok) {
                                    setPartnerOrders(partnerOrders.map(o => o.orderId === order.orderId ? {...o, status: newStatus} : o));
                                  }
                                }}
                              >
                                <option value="paid">Received</option>
                                <option value="printing">Printing</option>
                                <option value="ready_for_pickup">Ready for Pickup</option>
                                <option value="completed">Completed / Delivered</option>
                              </select>
                            )}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                          No orders received yet. Stay online to get orders!
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        )}
      </main>
    </div>
  );
}
