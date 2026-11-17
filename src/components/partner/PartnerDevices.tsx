'use client';

import { useCallback, useEffect, useState } from 'react';

interface Device {
  deviceId: string;
  name: string;
  platform: 'desktop' | 'mobile' | 'other';
  appVersion?: string;
  lastSeenAt: string;
  createdAt: string;
}

const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 2) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} days ago`;
};

/** The shop's signed-in Partner apps, with sign-out. */
export default function PartnerDevices() {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/partner/devices');
    const data = await res.json().catch(() => ({}));
    setDevices(data.success ? data.devices : []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const signOut = async (d: Device) => {
    if (!window.confirm(`Sign out "${d.name}"? It will need to sign in again to receive orders.`)) return;
    setBusy(d.deviceId);
    await fetch('/api/partner/devices', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceId: d.deviceId }) });
    setBusy(null);
    await load();
  };

  return (
    <div className="mt-8 bg-white shadow-lg rounded-xl p-6 border border-gray-100">
      <h3 className="text-lg font-bold text-gray-900">Signed-in apps</h3>
      <p className="mt-1 text-sm text-gray-600">Computers and phones signed in to the FunPrinting Partner app. Sign out any you don&apos;t recognise.</p>
      {devices === null ? (
        <p className="mt-4 text-sm text-gray-500">Loading…</p>
      ) : devices.length === 0 ? (
        <p className="mt-4 text-sm text-gray-500">No apps signed in with the new sign-in yet. Apps installed earlier keep working until they are updated.</p>
      ) : (
        <ul className="mt-4 divide-y divide-gray-100">
          {devices.map((d) => (
            <li key={d.deviceId} className="flex items-center justify-between py-3">
              <div>
                <p className="font-medium text-gray-900">
                  {d.name} <span className="text-xs text-gray-500">({d.platform}{d.appVersion ? ` · v${d.appVersion}` : ''})</span>
                </p>
                <p className="text-xs text-gray-500">Last active {ago(d.lastSeenAt)} · signed in {new Date(d.createdAt).toLocaleDateString('en-IN')}</p>
              </div>
              <button type="button" disabled={busy === d.deviceId} onClick={() => signOut(d)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                Sign out
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
