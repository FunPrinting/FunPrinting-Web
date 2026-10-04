import Razorpay from 'razorpay';
import crypto from 'crypto';

let razorpay: Razorpay | null = null;

if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
  razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
}

export interface CreateOrderParams {
  amount: number;
  currency?: string;
  receipt?: string;
  notes?: Record<string, string>;
  transfers?: Array<{
    account: string;
    amount: number;
    currency: string;
    notes: Record<string, string>;
    linked_account_notes: string[];
    on_hold: boolean;
  }>;
}

export const createRazorpayOrder = async (params: CreateOrderParams) => {
  if (!razorpay) {
    throw new Error('Razorpay not configured');
  }

  try {
    console.log('💳 Creating Razorpay order with params:', {
      amount: params.amount,
      amountInPaise: params.amount * 100,
      currency: params.currency || 'INR',
      receipt: params.receipt,
      transfers: params.transfers ? 'Configured for Split Payments' : 'None'
    });

    const orderOptions: any = {
      amount: params.amount * 100, // Razorpay expects amount in paise
      currency: params.currency || 'INR',
      receipt: params.receipt,
      notes: params.notes,
    };

    if (params.transfers) {
      orderOptions.transfers = params.transfers;
    }

    const order = await razorpay.orders.create(orderOptions);

    console.log('✅ Razorpay order created successfully:', order.id);
    return order;
  } catch (error: any) {
    console.error('❌ Error creating Razorpay order:', error);
    
    // Preserve the actual error message from Razorpay
    let errorMessage = 'Failed to create payment order';
    
    if (error instanceof Error) {
      errorMessage = error.message;
      console.error('Error details:', {
        message: error.message,
        stack: error.stack,
        name: error.name
      });
    } else if (error && typeof error === 'object') {
      // Razorpay SDK errors often have additional properties
      if (error.error) {
        errorMessage = error.error.description || error.error.reason || error.message || errorMessage;
        console.error('Razorpay API error:', {
          code: error.error.code,
          description: error.error.description,
          field: error.error.field,
          source: error.error.source,
          step: error.error.step,
          reason: error.error.reason,
          metadata: error.error.metadata
        });
      } else if (error.message) {
        errorMessage = error.message;
      }
    }
    
    throw new Error(errorMessage);
  }
};

export const verifyPayment = (razorpay_order_id: string, razorpay_payment_id: string, razorpay_signature: string) => {
  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET!)
    .update(razorpay_order_id + '|' + razorpay_payment_id)
    .digest('hex');

  return expectedSignature === razorpay_signature;
};

export default razorpay;
