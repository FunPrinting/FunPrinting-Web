'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';

// Dynamically import the map to avoid SSR issues with Leaflet
const MapComponent = dynamic(() => import('./MapComponent'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[400px] bg-gray-100 rounded-xl flex items-center justify-center border border-gray-200">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
    </div>
  ),
});

interface Partner {
  _id: string;
  businessName: string;
  location: {
    coordinates: [number, number]; // [lng, lat]
  };
  address: {
    street: string;
    city: string;
  };
  servicesOffered?: {
    printing: boolean;
    binding: boolean;
    cashOnDelivery: boolean;
  };
  deliveryPoints?: Array<{
    name: string;
    location: {
      type: 'Point';
      coordinates: [number, number];
    };
    isActive: boolean;
  }>;
}

interface PartnerMapSelectorProps {
  onPartnerSelected: (partnerId: string, deliveryPointName?: string) => void;
  selectedPartnerId?: string;
}

export default function PartnerMapSelector({ onPartnerSelected, selectedPartnerId }: PartnerMapSelectorProps) {
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedDeliveryPoint, setSelectedDeliveryPoint] = useState<string | undefined>();

  // 1. Get User Location
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation([position.coords.latitude, position.coords.longitude]);
        },
        (err) => {
          console.error('Geolocation error:', err);
          setError('Please enable location services in your browser to find nearby printing partners.');
          setIsLoading(false);
        }
      );
    } else {
      setError('Geolocation is not supported by your browser. Please use a modern browser.');
      setIsLoading(false);
    }
  }, []);

  // 2. Fetch Nearby Partners
  useEffect(() => {
    if (!userLocation) return;

    const fetchPartners = async () => {
      try {
        setIsLoading(true);
        const [lat, lng] = userLocation;
        const res = await fetch(`/api/partners/nearby?lat=${lat}&lng=${lng}&radius=20`); // 20km radius
        const data = await res.json();
        
        if (data.success) {
          setPartners(data.partners);
        } else {
          setError(data.error);
        }
      } catch (err) {
        console.error('Error fetching partners:', err);
        setError('Failed to load nearby print shops.');
      } finally {
        setIsLoading(false);
      }
    };

    fetchPartners();
  }, [userLocation]);

  const handlePartnerSelect = (partner: Partner, deliveryPointName?: string) => {
    setSelectedDeliveryPoint(deliveryPointName);
    onPartnerSelected(partner._id, deliveryPointName);
  };

  return (
    <div className="bg-white rounded-xl shadow-md p-6 border border-gray-100 mb-8">
      <h2 className="text-xl font-bold text-gray-900 mb-4">Select a Printing Partner</h2>
      
      {error && (
        <div className="mb-4 p-4 bg-red-50 text-red-700 rounded-lg border border-red-200 text-sm">
          {error}
        </div>
      )}

      {!userLocation ? (
        <div className="w-full h-[400px] bg-gray-50 rounded-xl flex flex-col items-center justify-center border border-gray-200">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mb-4"></div>
          <p className="text-gray-500">Locating you...</p>
        </div>
      ) : (
        <MapComponent 
          userLocation={userLocation} 
          partners={partners}
          onSelectPartner={handlePartnerSelect}
          selectedPartnerId={selectedPartnerId}
          selectedDeliveryPoint={selectedDeliveryPoint}
        />
      )}

      {partners.length === 0 && !isLoading && userLocation && (
        <p className="mt-4 text-center text-gray-500 italic">
          No printing partners found nearby. Try expanding your radius.
        </p>
      )}

      {selectedPartnerId && (
        <div className="mt-6 p-4 bg-green-50 border border-green-200 rounded-lg flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-green-100 text-green-600 rounded-full flex items-center justify-center">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
            </div>
            <div>
              <p className="font-bold text-green-800">Partner Selected</p>
              <p className="text-sm text-green-600">
                Your order will be routed to {selectedDeliveryPoint ? `the ${selectedDeliveryPoint} delivery point.` : 'the selected shop.'}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
