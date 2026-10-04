'use client';

import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix for default marker icon in Leaflet + Next.js
const customIcon = new L.Icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

// Component to dynamically center map when location changes
function MapCenterUpdater({ center }: { center: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, map.getZoom());
  }, [center, map]);
  return null;
}

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
  deliveryPoints?: Array<{
    name: string;
    location: {
      type: 'Point';
      coordinates: [number, number];
    };
    isActive: boolean;
  }>;
  calculatedPrice?: number;
}

interface MapComponentProps {
  userLocation: [number, number];
  partners: Partner[];
  onSelectPartner: (partner: Partner, deliveryPointName?: string) => void;
  selectedPartnerId?: string;
  selectedDeliveryPoint?: string;
}

function getMarkerIcon(color: string, isSelected: boolean) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${color}" stroke="${isSelected ? '#000000' : '#ffffff'}" stroke-width="${isSelected ? '2' : '1'}"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>`;
  return L.divIcon({
    className: 'custom-div-icon',
    html: `<div style="width: 36px; height: 36px; margin-top: -36px; margin-left: -18px; filter: drop-shadow(0 4px 3px rgb(0 0 0 / 0.4)); ${isSelected ? 'transform: scale(1.3); z-index: 1000;' : ''}">${svg}</div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 36],
    popupAnchor: [0, -36]
  });
}

export default function MapComponent({ userLocation, partners, onSelectPartner, selectedPartnerId, selectedDeliveryPoint }: MapComponentProps) {
  
  // Calculate price bounds for gradient
  const prices = partners.map(p => p.calculatedPrice || 0).filter(p => p > 0);
  const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
  const maxPrice = prices.length > 0 ? Math.max(...prices) : 0;

  const getMarkerColor = (price: number) => {
    if (!price || maxPrice === minPrice) return '#10b981'; // Default green
    const ratio = (price - minPrice) / (maxPrice - minPrice);
    // Green (16, 185, 129) to Red (239, 68, 68)
    const r = Math.round(16 + ratio * (239 - 16));
    const g = Math.round(185 + ratio * (68 - 185));
    const b = Math.round(129 + ratio * (68 - 129));
    return `rgb(${r}, ${g}, ${b})`;
  };

  return (
    <MapContainer 
      center={userLocation} 
      zoom={13} 
      style={{ height: '500px', width: '100%', borderRadius: '0.75rem', zIndex: 0 }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <MapCenterUpdater center={userLocation} />

      {/* User Location Marker */}
      <Marker position={userLocation} icon={customIcon}>
        <Popup>Your Location</Popup>
      </Marker>

      {/* Partner Delivery Point Markers */}
      {partners.flatMap((partner) => {
        const markers: any[] = [];
        const priceColor = getMarkerColor(partner.calculatedPrice || 0);

        // ONLY render Delivery Points as requested
        if (partner.deliveryPoints && partner.deliveryPoints.length > 0) {
          partner.deliveryPoints.forEach(dp => {
            if (!dp.isActive) return;
            const [dpLng, dpLat] = dp.location.coordinates;
            const isDpSelected = partner._id === selectedPartnerId && selectedDeliveryPoint === dp.name;
            
            markers.push(
              <Marker 
                key={`${partner._id}-dp-${dp.name}`} 
                position={[dpLat, dpLng]} 
                icon={getMarkerIcon(priceColor, isDpSelected)}
                eventHandlers={{
                  click: () => onSelectPartner(partner, dp.name),
                }}
                zIndexOffset={isDpSelected ? 1000 : 0}
              >
                <Popup>
                  <div className="font-sans min-w-[220px]">
                    <div className="flex justify-between items-start mb-2">
                      <h3 className="font-bold text-lg leading-tight text-gray-900">{dp.name}</h3>
                      <span className="bg-indigo-100 text-indigo-800 text-sm px-2 py-1 rounded font-bold whitespace-nowrap ml-2">
                        ₹{partner.calculatedPrice}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600 mb-3 border-b pb-2">Serviced by {partner.businessName}</p>
                    
                    <div className="mb-3">
                      <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Pricing Rates</p>
                      <ul className="text-sm space-y-1 text-gray-700">
                        <li className="flex justify-between"><span>B&W Page:</span> <strong>₹{partner.pricing?.perPageBW || 2}</strong></li>
                        <li className="flex justify-between"><span>Color Page:</span> <strong>₹{partner.pricing?.perPageColor || 10}</strong></li>
                        <li className="flex justify-between"><span>Binding:</span> <strong>₹{partner.pricing?.binding || 30}</strong></li>
                      </ul>
                    </div>

                    <div className="mb-4 flex flex-wrap gap-1">
                      {partner.servicesOffered?.printing && <span className="text-[10px] bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200 font-medium">Printing</span>}
                      {partner.servicesOffered?.binding && <span className="text-[10px] bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200 font-medium">Binding</span>}
                      {partner.servicesOffered?.cashOnDelivery && <span className="text-[10px] bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200 font-medium">COD</span>}
                    </div>
                    
                    <button 
                      className={`w-full py-2.5 rounded-lg font-bold transition-all shadow-sm ${
                        isDpSelected 
                          ? 'bg-green-600 text-white hover:bg-green-700' 
                          : 'bg-indigo-600 text-white hover:bg-indigo-700'
                      }`}
                      onClick={() => onSelectPartner(partner, dp.name)}
                    >
                      {isDpSelected ? '✓ Selected' : 'Select This Location'}
                    </button>
                  </div>
                </Popup>
              </Marker>
            );
          });
        }

        return markers;
      })}
    </MapContainer>
  );
}
