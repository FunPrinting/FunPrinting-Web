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
}

interface MapComponentProps {
  userLocation: [number, number];
  partners: Partner[];
  onSelectPartner: (partner: Partner) => void;
  selectedPartnerId?: string;
}

export default function MapComponent({ userLocation, partners, onSelectPartner, selectedPartnerId }: MapComponentProps) {
  return (
    <MapContainer 
      center={userLocation} 
      zoom={13} 
      style={{ height: '400px', width: '100%', borderRadius: '0.75rem', zIndex: 0 }}
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

      {/* Partner Markers */}
      {partners.map((partner) => {
        const [lng, lat] = partner.location.coordinates;
        const isSelected = partner._id === selectedPartnerId;
        
        return (
          <Marker 
            key={partner._id} 
            position={[lat, lng]} 
            icon={customIcon}
            eventHandlers={{
              click: () => onSelectPartner(partner),
            }}
          >
            <Popup>
              <div className="font-sans">
                <h3 className="font-bold text-lg mb-1">{partner.businessName}</h3>
                <p className="text-sm text-gray-600 mb-2">{partner.address.street}, {partner.address.city}</p>
                
                {partner.servicesOffered && (
                  <div className="flex flex-wrap gap-1 mb-3">
                    {partner.servicesOffered.printing && <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded-full font-medium">Printing</span>}
                    {partner.servicesOffered.binding && <span className="px-2 py-1 bg-purple-100 text-purple-700 text-xs rounded-full font-medium">Binding</span>}
                    {partner.servicesOffered.cashOnDelivery && <span className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded-full font-medium">Cash on Delivery</span>}
                  </div>
                )}

                <button 
                  onClick={() => onSelectPartner(partner)}
                  className={`w-full py-2 px-4 rounded font-bold text-white transition-colors ${isSelected ? 'bg-green-600' : 'bg-indigo-600 hover:bg-indigo-700'}`}
                >
                  {isSelected ? 'Selected' : 'Select Partner'}
                </button>
              </div>
            </Popup>
          </Marker>
        );
      })}
    </MapContainer>
  );
}
