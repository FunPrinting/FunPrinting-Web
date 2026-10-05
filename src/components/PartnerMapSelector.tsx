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
  pricing?: {
    perPageBW: number;
    perPageColor: number;
    binding: number;
  };
  supportedPrinters?: Array<{
    name: string;
    isColor: boolean;
    paperSizes: string[];
  }>;
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
  onPartnerSelected: (partnerId: string, deliveryPointName?: string, calculatedPrice?: number) => void;
  selectedPartnerId?: string;
  cartItems: any[];
}

export default function PartnerMapSelector({ onPartnerSelected, selectedPartnerId, cartItems }: PartnerMapSelectorProps) {
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
        const res = await fetch(`/api/partners/nearby?lat=${lat}&lng=${lng}&radius=20`);
        const data = await res.json();
        
        if (data.success) {
          // Filter partners based on cart requirements
          const requiresColor = cartItems.some(item => item.options?.color === 'color' || item.options?.color === 'mixed' || item.printingOptions?.color === 'color' || item.printingOptions?.color === 'mixed');
          const requiresBinding = cartItems.some(item => item.options?.serviceOptions?.includes('binding') || item.options?.serviceOption === 'binding' || item.printingOptions?.serviceOptions?.includes('binding') || item.printingOptions?.serviceOption === 'binding');
          const requiresA3 = cartItems.some(item => item.options?.pageSize === 'A3' || item.printingOptions?.pageSize === 'A3');

          let validPartners = data.partners.filter((p: Partner) => {
            if (requiresColor) {
              const hasColorPrinter = p.supportedPrinters?.some(pr => pr.isColor);
              if (!hasColorPrinter) return false;
            }
            if (requiresBinding && !p.servicesOffered?.binding) return false;
            if (requiresA3) {
              const hasA3Printer = p.supportedPrinters?.some(pr => pr.paperSizes?.includes('A3'));
              if (!hasA3Printer) return false;
            }
            return true;
          });

          // Calculate price for each valid partner
          validPartners = validPartners.map((p: Partner) => {
            const pricing = p.pricing || { perPageBW: 2, perPageColor: 10, binding: 30 }; // Fallback pricing
            
            // Calculate total for cart
            let total = 0;
            for (const item of cartItems) {
               const opts = item.options || item.printingOptions || {};
               const copies = opts.copies || 1;
               const pageSizeMultiplier = opts.pageSize === 'A3' ? 2 : 1;
               const sidedMultiplier = opts.sided === 'double' ? 1.5 : 1;

               let itemTotal = 0;
               if (opts.color === 'mixed' && opts.pageColors) {
                 const colorCount = opts.pageColors.colorPages?.length || 0;
                 const bwCount = opts.pageColors.bwPages?.length || 0;
                 itemTotal = ((colorCount * pricing.perPageColor) + (bwCount * pricing.perPageBW)) * pageSizeMultiplier * sidedMultiplier;
               } else if (opts.color === 'color') {
                 itemTotal = item.pageCount * pricing.perPageColor * pageSizeMultiplier * sidedMultiplier;
               } else {
                 itemTotal = item.pageCount * pricing.perPageBW * pageSizeMultiplier * sidedMultiplier;
               }
               itemTotal *= copies;

               if (opts.serviceOption === 'binding' || (opts.serviceOptions && opts.serviceOptions.includes('binding'))) {
                 itemTotal += pricing.binding * copies;
               }
               total += itemTotal;
            }

            return { ...p, calculatedPrice: Math.ceil(total) };
          });

          setPartners(validPartners);
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
  }, [userLocation, cartItems]);

  const handlePartnerSelect = (partner: Partner & { calculatedPrice?: number }, deliveryPointName?: string) => {
    setSelectedDeliveryPoint(deliveryPointName);
    onPartnerSelected(partner._id, deliveryPointName, partner.calculatedPrice);
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
