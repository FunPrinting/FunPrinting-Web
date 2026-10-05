'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';

// Dynamically import the map to avoid SSR issues with Leaflet
const MapComponent = dynamic(() => import('./MapComponent'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[400px] bg-gray-100 rounded-xl flex items-center justify-center border border-gray-200">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
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
  calculatedPrice?: number;
  distance?: number; // In km
}

interface PartnerMapSelectorProps {
  onPartnerSelected: (partnerId: string, deliveryPointName?: string, calculatedPrice?: number) => void;
  selectedPartnerId?: string;
  cartItems: any[];
}

function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Radius of the earth in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
  return R * c; 
}

export default function PartnerMapSelector({ onPartnerSelected, selectedPartnerId, cartItems }: PartnerMapSelectorProps) {
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedDeliveryPoint, setSelectedDeliveryPoint] = useState<string | undefined>();
  
  // UI State
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list');
  const [expandedPartnerId, setExpandedPartnerId] = useState<string | null>(null);

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

          // Calculate price and distance for each valid partner
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

            const pLat = p.location?.coordinates[1] || 0;
            const pLng = p.location?.coordinates[0] || 0;
            const distance = calculateDistance(lat, lng, pLat, pLng);

            return { ...p, calculatedPrice: Math.ceil(total), distance };
          });
          
          // Sort by distance
          validPartners.sort((a: Partner, b: Partner) => (a.distance || 0) - (b.distance || 0));

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

  const handlePartnerSelect = (partner: Partner, deliveryPointName?: string) => {
    setSelectedDeliveryPoint(deliveryPointName);
    onPartnerSelected(partner._id, deliveryPointName, partner.calculatedPrice);
  };

  return (
    <div className="w-full">
      {/* Header and Toggle */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
        <h2 className="text-xl font-bold text-gray-900">Select a Printing Partner</h2>
        
        {/* View Toggle */}
        <div className="flex bg-gray-100 p-1 rounded-lg border border-gray-200">
          <button 
            onClick={() => setViewMode('list')}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${viewMode === 'list' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
            List
          </button>
          <button 
            onClick={() => setViewMode('map')}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${viewMode === 'map' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" /></svg>
            Map
          </button>
        </div>
      </div>
      
      {error && (
        <div className="mb-4 p-4 bg-red-50 text-red-700 rounded-lg border border-red-200 text-sm">
          {error}
        </div>
      )}

      {!userLocation ? (
        <div className="w-full h-[400px] bg-gray-50 rounded-xl flex flex-col items-center justify-center border border-gray-200">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mb-4"></div>
          <p className="text-gray-500">Locating you to find nearby partners...</p>
        </div>
      ) : (
        <>
          {viewMode === 'map' ? (
            <div className="rounded-xl overflow-hidden border border-gray-200 shadow-sm">
              <MapComponent 
                userLocation={userLocation} 
                partners={partners}
                onSelectPartner={(p, dp) => handlePartnerSelect(p as Partner, dp)}
                selectedPartnerId={selectedPartnerId}
                selectedDeliveryPoint={selectedDeliveryPoint}
              />
            </div>
          ) : (
            <div className="space-y-4">
              {partners.length === 0 && !isLoading ? (
                <div className="text-center p-8 bg-gray-50 rounded-xl border border-gray-200">
                  <svg className="w-12 h-12 text-gray-400 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                  <h3 className="text-lg font-medium text-gray-900 mb-1">No Partners Found</h3>
                  <p className="text-gray-500">Try expanding your search radius or changing options.</p>
                </div>
              ) : (
                partners.map(partner => (
                  <div 
                    key={partner._id} 
                    className={`bg-white rounded-xl border transition-all duration-200 ${selectedPartnerId === partner._id ? 'border-blue-500 shadow-md ring-1 ring-blue-500' : 'border-gray-200 shadow-sm hover:border-gray-300 hover:shadow-md'}`}
                  >
                    {/* Card Main Body */}
                    <div className="p-5 flex flex-col sm:flex-row justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-start justify-between">
                          <div>
                            <h3 className="font-bold text-gray-900 text-lg flex items-center gap-2">
                              {partner.businessName}
                              {selectedPartnerId === partner._id && (
                                <svg className="w-5 h-5 text-blue-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
                              )}
                            </h3>
                            <p className="text-gray-500 text-sm mt-1">{partner.address.street}, {partner.address.city}</p>
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-4 mt-4">
                           <div className="flex items-center text-sm text-gray-600 bg-gray-100 px-2.5 py-1 rounded-md">
                             <svg className="w-4 h-4 mr-1.5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                             {partner.distance?.toFixed(1)} km away
                           </div>
                           <button 
                             onClick={() => setExpandedPartnerId(expandedPartnerId === partner._id ? null : partner._id)}
                             className="text-sm font-medium text-blue-600 hover:text-blue-700 flex items-center gap-1"
                           >
                             {expandedPartnerId === partner._id ? 'Hide details' : 'View more details'}
                             <svg className={`w-4 h-4 transition-transform ${expandedPartnerId === partner._id ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                           </button>
                        </div>
                      </div>
                      
                      <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center border-t sm:border-t-0 sm:border-l border-gray-100 pt-4 sm:pt-0 sm:pl-6 min-w-[140px]">
                        <div className="text-left sm:text-right">
                          <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Total Price</p>
                          <p className="text-2xl font-bold text-gray-900">₹{partner.calculatedPrice}</p>
                        </div>
                        <button
                          onClick={() => handlePartnerSelect(partner, undefined)}
                          className={`mt-0 sm:mt-3 px-6 py-2.5 rounded-lg font-medium text-sm transition-colors ${selectedPartnerId === partner._id && !selectedDeliveryPoint ? 'bg-blue-600 text-white shadow-md' : 'bg-gray-900 text-white hover:bg-gray-800'}`}
                        >
                          {selectedPartnerId === partner._id && !selectedDeliveryPoint ? 'Selected' : 'Select'}
                        </button>
                      </div>
                    </div>

                    {/* Expanded Details Section */}
                    {expandedPartnerId === partner._id && (
                      <div className="bg-gray-50 p-5 border-t border-gray-200 rounded-b-xl text-sm">
                        
                        {/* Base Pricing Matrix */}
                        <div className="mb-6">
                          <h4 className="font-semibold text-gray-900 mb-3 text-xs uppercase tracking-wider">Base Pricing</h4>
                          <div className="grid grid-cols-3 gap-4">
                            <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm">
                              <p className="text-gray-500 text-xs mb-1">B&W Print</p>
                              <p className="font-semibold text-gray-900">₹{partner.pricing?.perPageBW || 2} <span className="text-xs text-gray-500 font-normal">/ page</span></p>
                            </div>
                            <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm">
                              <p className="text-gray-500 text-xs mb-1">Color Print</p>
                              <p className="font-semibold text-gray-900">₹{partner.pricing?.perPageColor || 10} <span className="text-xs text-gray-500 font-normal">/ page</span></p>
                            </div>
                            <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm">
                              <p className="text-gray-500 text-xs mb-1">Binding</p>
                              <p className="font-semibold text-gray-900">₹{partner.pricing?.binding || 30} <span className="text-xs text-gray-500 font-normal">/ doc</span></p>
                            </div>
                          </div>
                        </div>

                        {/* Delivery Points */}
                        {partner.deliveryPoints && partner.deliveryPoints.length > 0 && (
                          <div>
                            <h4 className="font-semibold text-gray-900 mb-3 text-xs uppercase tracking-wider">Delivery Points</h4>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              {partner.deliveryPoints.map((dp, idx) => (
                                <div key={idx} className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                                    <span className="font-medium text-gray-800">{dp.name}</span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <a 
                                      href={`https://www.google.com/maps?q=${dp.location.coordinates[1]},${dp.location.coordinates[0]}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                                      title="Open in Maps"
                                    >
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                                    </a>
                                    <button
                                      onClick={() => handlePartnerSelect(partner, dp.name)}
                                      className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${selectedPartnerId === partner._id && selectedDeliveryPoint === dp.name ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                                    >
                                      Select Point
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </>
      )}

      {selectedPartnerId && viewMode === 'list' && (
        <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-xl flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
            </div>
            <div>
              <p className="font-bold text-blue-900">Partner Selected</p>
              <p className="text-sm text-blue-700">
                Your order will be routed to {selectedDeliveryPoint ? `the ${selectedDeliveryPoint} delivery point.` : 'the selected shop.'}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
