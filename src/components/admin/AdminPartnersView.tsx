'use client';

import { useState, useEffect } from 'react';
import { DollarIcon, BuildingIcon, CheckIcon, WarningIcon } from '@/components/SocialIcons';

interface Partner {
  _id: string;
  businessName: string;
  isOnline: boolean;
  isActive: boolean;
  servicesOffered: {
    printing: boolean;
    binding: boolean;
    cashOnDelivery: boolean;
  };
  earnings: {
    totalRevenue: number;
    pendingPayout: number;
  };
  createdAt: string;
}

interface AdminPartnersViewProps {
  onSelectPartner: (partnerId: string | null) => void;
  selectedPartnerId: string | null;
}

export default function AdminPartnersView({ onSelectPartner, selectedPartnerId }: AdminPartnersViewProps) {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchPartners();
  }, []);

  const fetchPartners = async () => {
    try {
      setIsLoading(true);
      const res = await fetch('/api/admin/partners');
      const data = await res.json();
      if (data.success) {
        setPartners(data.partners);
      } else {
        setError(data.error || 'Failed to fetch partners');
      }
    } catch (err) {
      console.error('Error fetching partners:', err);
      setError('An error occurred while fetching partners.');
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return <div className="p-8 text-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto"></div></div>;
  }

  if (error) {
    return <div className="p-4 bg-red-50 text-red-700 rounded-lg">{error}</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900">Franchise Partners</h2>
        {selectedPartnerId && (
          <button 
            onClick={() => onSelectPartner(null)}
            className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition-colors text-sm font-medium"
          >
            Clear Filter (Show All Orders)
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {partners.map(partner => (
          <div 
            key={partner._id} 
            className={`bg-white rounded-xl shadow-md border overflow-hidden cursor-pointer transition-all hover:shadow-lg ${selectedPartnerId === partner._id ? 'border-indigo-500 ring-2 ring-indigo-200' : 'border-gray-200'}`}
            onClick={() => onSelectPartner(partner._id)}
          >
            <div className="p-5">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                    <BuildingIcon size={20} className="text-gray-500" />
                    {partner.businessName || 'Unnamed Shop'}
                  </h3>
                  <div className="flex gap-2 mt-2">
                    <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${partner.isActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                      {partner.isActive ? 'Active' : 'Inactive'}
                    </span>
                    <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${partner.isOnline ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800'}`}>
                      {partner.isOnline ? 'Online' : 'Offline'}
                    </span>
                  </div>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4 py-3 border-t border-gray-100">
                <div>
                  <p className="text-xs text-gray-500 mb-1">Total Revenue</p>
                  <p className="font-bold text-gray-900">₹{partner.earnings?.totalRevenue || 0}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1">Pending Payout</p>
                  <p className="font-bold text-indigo-600">₹{partner.earnings?.pendingPayout || 0}</p>
                </div>
              </div>

              <div className="pt-3 border-t border-gray-100 flex flex-wrap gap-1">
                 {partner.servicesOffered?.printing && <span className="px-2 py-1 bg-blue-50 text-blue-600 text-xs rounded border border-blue-100">Printing</span>}
                 {partner.servicesOffered?.binding && <span className="px-2 py-1 bg-purple-50 text-purple-600 text-xs rounded border border-purple-100">Binding</span>}
                 {partner.servicesOffered?.cashOnDelivery && <span className="px-2 py-1 bg-green-50 text-green-600 text-xs rounded border border-green-100">COD</span>}
              </div>
            </div>
          </div>
        ))}

        {partners.length === 0 && (
          <div className="col-span-full p-8 text-center bg-white rounded-xl border border-gray-200">
            <p className="text-gray-500 mb-2">No partners registered yet.</p>
          </div>
        )}
      </div>
    </div>
  );
}
