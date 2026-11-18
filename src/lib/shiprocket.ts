/**
 * Shiprocket API Integration
 * 
 * Handles authentication, order creation, AWB assignment, and shipment tracking.
 * API Docs: https://apiv2.shiprocket.in/v1/external/
 */

const SHIPROCKET_BASE_URL = 'https://apiv2.shiprocket.in/v1/external';

// In-memory token cache (auto-refreshes when expired)
let cachedToken: string | null = null;
let tokenExpiresAt: number = 0;

// ─── Authentication ───────────────────────────────────────────────────────────

/**
 * Get a valid Shiprocket auth token (cached for ~9 days, auto-refreshes)
 */
export async function getAuthToken(): Promise<string> {
    // Return cached token if still valid (with 1-hour buffer)
    if (cachedToken && Date.now() < tokenExpiresAt - 3600000) {
        return cachedToken;
    }

    const email = process.env.SHIPROCKET_EMAIL;
    const password = process.env.SHIPROCKET_PASSWORD;

    if (!email || !password) {
        throw new Error('Shiprocket credentials not configured. Set SHIPROCKET_EMAIL and SHIPROCKET_PASSWORD env vars.');
    }

    const response = await fetch(`${SHIPROCKET_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Shiprocket auth failed (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    cachedToken = data.token;
    // Token valid for 10 days, we cache for 9 days
    tokenExpiresAt = Date.now() + 9 * 24 * 60 * 60 * 1000;

    console.log('✅ Shiprocket auth token obtained successfully');
    return cachedToken!;
}

/**
 * Make an authenticated API request to Shiprocket
 */
async function shiprocketRequest(
    endpoint: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
    body?: Record<string, unknown>
): Promise<any> {
    const token = await getAuthToken();

    const options: RequestInit = {
        method,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
        },
    };

    if (body && method !== 'GET') {
        options.body = JSON.stringify(body);
    }

    const response = await fetch(`${SHIPROCKET_BASE_URL}${endpoint}`, options);

    if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ Shiprocket API error (${response.status}): ${errorText}`);
        throw new Error(`Shiprocket API error (${response.status}): ${errorText}`);
    }

    return response.json();
}

// ─── Order Creation ───────────────────────────────────────────────────────────

interface ShiprocketOrderInput {
    orderId: string;
    orderDate: string; // ISO date string
    customerName: string;
    customerEmail: string;
    customerPhone: string;
    address: string;
    city: string;
    pinCode: string;
    state?: string;
    country?: string;
    amount: number;
    items: Array<{
        name: string;
        sku: string;
        units: number;
        sellingPrice: number;
    }>;
    weight?: number; // in kg
    length?: number; // in cm
    breadth?: number; // in cm
    height?: number; // in cm
    paymentMethod?: 'Prepaid' | 'COD';
    pickupLocation: string; // the shop's Shiprocket pickup nickname (see ensureCourierPickup)
}

interface ShiprocketOrderResult {
    success: boolean;
    shiprocketOrderId?: number;
    shipmentId?: number;
    error?: string;
}

/**
 * Create an order in Shiprocket from our order data
 */
export async function createShiprocketOrder(input: ShiprocketOrderInput): Promise<ShiprocketOrderResult> {
    try {
        const pickupLocation = input.pickupLocation;
        const defaultWeight = parseFloat(process.env.SHIPROCKET_DEFAULT_WEIGHT || '0.5');

        const payload = {
            order_id: input.orderId,
            order_date: new Date(input.orderDate).toISOString().split('T')[0] + ' ' +
                new Date(input.orderDate).toTimeString().split(' ')[0],
            pickup_location: pickupLocation,
            channel_id: '',
            comment: `FunPrinting Order #${input.orderId}`,
            billing_customer_name: input.customerName.split(' ')[0] || input.customerName,
            billing_last_name: input.customerName.split(' ').slice(1).join(' ') || '',
            billing_address: input.address,
            billing_city: input.city,
            billing_pincode: input.pinCode,
            billing_state: input.state || '',
            billing_country: input.country || 'India',
            billing_email: input.customerEmail,
            billing_phone: input.customerPhone.replace(/[^0-9]/g, '').slice(-10),
            shipping_is_billing: true,
            order_items: input.items.map(item => ({
                name: item.name,
                sku: item.sku,
                units: item.units,
                selling_price: item.sellingPrice.toString(),
                discount: '0',
                tax: '0',
                hsn: '4901', // HSN code for printed material
            })),
            payment_method: input.paymentMethod || 'Prepaid',
            sub_total: input.amount,
            length: input.length || 30,
            breadth: input.breadth || 22,
            height: input.height || 3,
            weight: input.weight || defaultWeight,
        };

        console.log(`📦 Creating Shiprocket order for: ${input.orderId}`);
        const data = await shiprocketRequest('/orders/create/adhoc', 'POST', payload);

        console.log(`✅ Shiprocket order created:`, {
            orderId: data.order_id,
            shipmentId: data.shipment_id,
            status: data.status,
        });

        return {
            success: true,
            shiprocketOrderId: data.order_id,
            shipmentId: data.shipment_id,
        };
    } catch (error: any) {
        console.error('❌ Failed to create Shiprocket order:', error.message);
        return {
            success: false,
            error: error.message || 'Failed to create Shiprocket order',
        };
    }
}

// ─── AWB Assignment ───────────────────────────────────────────────────────────

interface AWBResult {
    success: boolean;
    awbCode?: string;
    courierName?: string;
    courierCompanyId?: number;
    error?: string;
}

/**
 * Assign a courier and generate AWB (tracking number) for a shipment
 */
export async function assignAWB(shipmentId: number, courierId?: number): Promise<AWBResult> {
    try {
        const payload: Record<string, unknown> = { shipment_id: shipmentId };
        if (courierId) {
            payload.courier_id = courierId;
        }

        console.log(`🚚 Assigning AWB for shipment: ${shipmentId}`);
        const data = await shiprocketRequest('/courier/assign/awb', 'POST', payload);

        const awbAssignData = data.response?.data;

        if (awbAssignData?.awb_code) {
            console.log(`✅ AWB assigned:`, {
                awbCode: awbAssignData.awb_code,
                courierName: awbAssignData.courier_name,
            });

            return {
                success: true,
                awbCode: awbAssignData.awb_code,
                courierName: awbAssignData.courier_name,
                courierCompanyId: awbAssignData.courier_company_id,
            };
        }

        // Sometimes the response structure differs
        if (data.awb_code) {
            return {
                success: true,
                awbCode: data.awb_code,
                courierName: data.courier_name || 'Unknown',
            };
        }

        throw new Error(data.message || 'AWB assignment failed - no AWB code in response');
    } catch (error: any) {
        console.error('❌ Failed to assign AWB:', error.message);
        return {
            success: false,
            error: error.message || 'Failed to assign AWB',
        };
    }
}

// ─── Tracking ─────────────────────────────────────────────────────────────────
/**
 * Get the public Shiprocket tracking URL for an AWB
 */
export function getTrackingUrl(awbCode: string): string {
    return `https://shiprocket.co/tracking/${awbCode}`;
}


// ─── Courier Serviceability & Rate Check ──────────────────────────────────────

interface CourierRate {
    courierId: number;
    courierName: string;
    rate: number;
    estimatedDays: number;
    codAvailable: boolean;
}

interface ServiceabilityResult {
    success: boolean;
    cheapestRate?: number;
    estimatedDays?: number;
    courierName?: string;
    allRates?: CourierRate[];
    error?: string;
}

/**
 * Check courier serviceability and get shipping rates for a route.
 * Uses Shiprocket's courier serviceability API.
 */
export async function checkServiceability(
    pickupPincode: string,
    deliveryPincode: string,
    weightKg: number,
    cod: boolean = false
): Promise<ServiceabilityResult> {
    try {
        const token = await getAuthToken();

        const params = new URLSearchParams({
            pickup_postcode: pickupPincode,
            delivery_postcode: deliveryPincode,
            weight: weightKg.toString(),
            cod: cod ? '1' : '0',
        });

        const response = await fetch(
            `${SHIPROCKET_BASE_URL}/courier/serviceability/?${params.toString()}`,
            {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
            }
        );

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`❌ Shiprocket serviceability check failed (${response.status}): ${errorText}`);
            throw new Error(`Serviceability check failed: ${errorText}`);
        }

        const data = await response.json();
        const couriers = data?.data?.available_courier_companies || [];

        if (couriers.length === 0) {
            return {
                success: false,
                error: 'No couriers available for this route',
            };
        }

        const rates: CourierRate[] = couriers.map((c: any) => ({
            courierId: c.courier_company_id,
            courierName: c.courier_name,
            rate: parseFloat(c.freight_charge || c.rate || 0),
            estimatedDays: parseInt(c.estimated_delivery_days || c.etd || '7'),
            codAvailable: c.cod === 1,
        }));

        // Sort by rate to find cheapest
        rates.sort((a, b) => a.rate - b.rate);

        const cheapest = rates[0];
        console.log(`📦 Cheapest courier for ${pickupPincode} → ${deliveryPincode} (${weightKg}kg): ${cheapest.courierName} @ ₹${cheapest.rate}`);

        return {
            success: true,
            cheapestRate: cheapest.rate,
            estimatedDays: cheapest.estimatedDays,
            courierName: cheapest.courierName,
            allRates: rates,
        };
    } catch (error: any) {
        console.error('❌ Serviceability check failed:', error.message);
        return {
            success: false,
            error: error.message || 'Failed to check serviceability',
        };
    }
}

/**
 * Check if Shiprocket is configured (credentials present)
 */
export function isShiprocketConfigured(): boolean {
    return !!(process.env.SHIPROCKET_EMAIL && process.env.SHIPROCKET_PASSWORD);
}

// ─── Pickup addresses (one per partner shop) ─────────────────────────────────

export interface PickupAddressInput {
    nickname: string; // max 36 characters, unique in our Shiprocket account
    name: string;
    email: string;
    phone: string; // 10-digit Indian mobile
    address: string;
    address2?: string;
    city: string;
    state: string;
    pinCode: string;
}

export type PickupAddressResult = { ok: true; nickname: string; alreadyExisted: boolean } | { ok: false; error: string };

/**
 * Adds a pickup address (POST /settings/company/addpickup) so couriers collect from
 * that shop. Re-registering the same nickname is treated as success.
 * Shiprocket asks to verify the pickup phone number the first time it is used.
 */
export async function addPickupAddress(input: PickupAddressInput): Promise<PickupAddressResult> {
    const phone = input.phone.replace(/\D/g, '').slice(-10);
    if (!/^[6-9]\d{9}$/.test(phone)) return { ok: false, error: 'The shop needs a valid 10-digit mobile number' };
    if (!/^[1-9]\d{5}$/.test(input.pinCode)) return { ok: false, error: 'The shop address needs a valid 6-digit pincode' };
    // Shiprocket limits the first address line to 80 characters and rejects very short ones
    const line = input.address.trim();
    if (line.length < 10) return { ok: false, error: 'The shop address is too short for the courier (add the building and street)' };
    try {
        await shiprocketRequest('/settings/company/addpickup', 'POST', {
            pickup_location: input.nickname.slice(0, 36),
            name: input.name.slice(0, 100),
            email: input.email,
            phone,
            address: line.slice(0, 80),
            address_2: [line.slice(80), input.address2].filter(Boolean).join(', ').slice(0, 80),
            city: input.city,
            state: input.state,
            country: 'India',
            pin_code: input.pinCode,
        });
        return { ok: true, nickname: input.nickname, alreadyExisted: false };
    } catch (error: any) {
        const message = String(error?.message || '');
        if (/already|exists|in use/i.test(message)) return { ok: true, nickname: input.nickname, alreadyExisted: true };
        return { ok: false, error: message.slice(0, 300) || 'Shiprocket rejected the pickup address' };
    }
}
