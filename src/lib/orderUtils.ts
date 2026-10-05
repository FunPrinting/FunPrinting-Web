import { NextResponse } from 'next/server';

export interface OrderValidationError {
  field: string;
  message: string;
  code: string;
}

export interface OrderValidationResult {
  isValid: boolean;
  errors: OrderValidationError[];
}

export interface OrderStateTransition {
  from: OrderStatus;
  to: OrderStatus;
  allowed: boolean;
  reason?: string;
}

export type OrderStatus =
  | 'draft'
  | 'pending_payment'
  | 'paid'
  | 'processing'
  | 'printing'
  | 'printed'
  | 'dispatched'
  | 'delivered'
  | 'refunded';

export interface OrderData {
  customerInfo: {
    name: string;
    phone: string;
    email: string;
  };
  orderType: 'file' | 'template';
  fileURL?: string;
  fileType?: string;
  originalFileName?: string;
  templateData?: any;
  printingOptions: {
    pageSize: 'A4' | 'A3';
    color: 'color' | 'bw' | 'mixed';
    sided: 'single' | 'double';
    copies: number;
    pageCount?: number;
    serviceOption?: 'binding' | 'file' | 'service';
    pageColors?: {
      colorPages: number[];
      bwPages: number[];
    };
  };
  deliveryOption: {
    type: 'pickup' | 'delivery';
    pickupLocationId?: string;
    deliveryCharge?: number;
    address?: string;
    city?: string;
    pinCode?: string;
  };
  expectedDate?: Date;
  amount: number;
}

const ORDER_STATE_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  draft: ['pending_payment'],
  pending_payment: ['paid'],
  paid: ['processing', 'printing', 'refunded'], // Allow direct transition to printing
  processing: ['printing', 'refunded'],
  printing: ['printed', 'dispatched', 'refunded'],
  printed: ['dispatched', 'refunded'],
  dispatched: ['delivered', 'refunded'],
  delivered: ['refunded'],
  refunded: [] // Terminal state
};

export const validateOrderData = (orderData: OrderData): OrderValidationResult => {
  const errors: OrderValidationError[] = [];

  // Validate customer information
  if (!orderData.customerInfo.name || orderData.customerInfo.name.trim().length < 2) {
    errors.push({
      field: 'customerInfo.name',
      message: 'Name must be at least 2 characters long',
      code: 'INVALID_NAME'
    });
  }

  if (!orderData.customerInfo.email || !isValidEmail(orderData.customerInfo.email)) {
    errors.push({
      field: 'customerInfo.email',
      message: 'Valid email address is required',
      code: 'INVALID_EMAIL'
    });
  }

  if (!orderData.customerInfo.phone || !isValidPhone(orderData.customerInfo.phone)) {
    errors.push({
      field: 'customerInfo.phone',
      message: 'Valid phone number is required',
      code: 'INVALID_PHONE'
    });
  }

  // Validate printing options
  if (!orderData.printingOptions.pageSize || !['A4', 'A3'].includes(orderData.printingOptions.pageSize)) {
    errors.push({
      field: 'printingOptions.pageSize',
      message: 'Page size must be A4 or A3',
      code: 'INVALID_PAGE_SIZE'
    });
  }

  if (!orderData.printingOptions.color || !['color', 'bw', 'mixed'].includes(orderData.printingOptions.color)) {
    errors.push({
      field: 'printingOptions.color',
      message: 'Color option must be color, bw, or mixed',
      code: 'INVALID_COLOR_OPTION'
    });
  }

  if (!orderData.printingOptions.sided || !['single', 'double'].includes(orderData.printingOptions.sided)) {
    errors.push({
      field: 'printingOptions.sided',
      message: 'Sided option must be single or double',
      code: 'INVALID_SIDED_OPTION'
    });
  }

  if (!orderData.printingOptions.copies || orderData.printingOptions.copies < 1 || orderData.printingOptions.copies > 100) {
    errors.push({
      field: 'printingOptions.copies',
      message: 'Copies must be between 1 and 100',
      code: 'INVALID_COPIES'
    });
  }

  if (!orderData.printingOptions.pageCount || orderData.printingOptions.pageCount < 1 || orderData.printingOptions.pageCount > 1000) {
    errors.push({
      field: 'printingOptions.pageCount',
      message: 'Page count must be between 1 and 1000',
      code: 'INVALID_PAGE_COUNT'
    });
  }

  // Validate mixed color pages
  if (orderData.printingOptions.color === 'mixed') {
    if (!orderData.printingOptions.pageColors) {
      errors.push({
        field: 'printingOptions.pageColors',
        message: 'Page colors must be specified for mixed color printing',
        code: 'MISSING_PAGE_COLORS'
      });
    } else {
      const { colorPages, bwPages } = orderData.printingOptions.pageColors;
      const totalSpecifiedPages = colorPages.length + bwPages.length;

      // More lenient validation - allow partial specification but warn
      if (totalSpecifiedPages === 0) {
        errors.push({
          field: 'printingOptions.pageColors',
          message: 'At least one page must be specified as color or B&W',
          code: 'NO_PAGES_SPECIFIED'
        });
      } else if (orderData.printingOptions.pageCount && totalSpecifiedPages > orderData.printingOptions.pageCount) {
        errors.push({
          field: 'printingOptions.pageColors',
          message: `Too many pages specified (${totalSpecifiedPages}) for document with ${orderData.printingOptions.pageCount} pages`,
          code: 'TOO_MANY_PAGES_SPECIFIED'
        });
      }

      // Check for duplicate pages
      const allPages = [...colorPages, ...bwPages];
      const uniquePages = [...new Set(allPages)];
      if (allPages.length !== uniquePages.length) {
        errors.push({
          field: 'printingOptions.pageColors',
          message: 'Pages cannot be specified as both color and B&W',
          code: 'DUPLICATE_PAGE_COLORS'
        });
      }

      // Check for invalid page numbers
      if (orderData.printingOptions.pageCount) {
        const pageCount = orderData.printingOptions.pageCount;
        const invalidPages = allPages.filter(page => page < 1 || page > pageCount);
        if (invalidPages.length > 0) {
          errors.push({
            field: 'printingOptions.pageColors',
            message: `Invalid page numbers: ${invalidPages.join(', ')}. Pages must be between 1 and ${pageCount}`,
            code: 'INVALID_PAGE_NUMBERS'
          });
        }
      }
    }
  }

  // Validate service option for multi-page orders
  if (orderData.printingOptions.pageCount && orderData.printingOptions.pageCount > 1) {
    if (!orderData.printingOptions.serviceOption || !['binding', 'file', 'service'].includes(orderData.printingOptions.serviceOption)) {
      errors.push({
        field: 'printingOptions.serviceOption',
        message: 'Service option is required for multi-page orders',
        code: 'MISSING_SERVICE_OPTION'
      });
    }
  }

  // Validate delivery option
  if (!orderData.deliveryOption.type || !['pickup', 'delivery'].includes(orderData.deliveryOption.type)) {
    errors.push({
      field: 'deliveryOption.type',
      message: 'Delivery type must be pickup or delivery',
      code: 'INVALID_DELIVERY_TYPE'
    });
  }

  if (orderData.deliveryOption.type === 'pickup' && !orderData.deliveryOption.pickupLocationId) {
    errors.push({
      field: 'deliveryOption.pickupLocationId',
      message: 'Pickup location is required for pickup orders',
      code: 'MISSING_PICKUP_LOCATION'
    });
  }

  if (orderData.deliveryOption.type === 'delivery') {
    if (!orderData.deliveryOption.address || orderData.deliveryOption.address.trim().length < 10) {
      errors.push({
        field: 'deliveryOption.address',
        message: 'Complete delivery address is required',
        code: 'INVALID_DELIVERY_ADDRESS'
      });
    }

    if (!orderData.deliveryOption.city || orderData.deliveryOption.city.trim().length < 2) {
      errors.push({
        field: 'deliveryOption.city',
        message: 'City is required for delivery',
        code: 'INVALID_CITY'
      });
    }

    if (!orderData.deliveryOption.pinCode || !isValidPinCode(orderData.deliveryOption.pinCode)) {
      errors.push({
        field: 'deliveryOption.pinCode',
        message: 'Valid PIN code is required for delivery',
        code: 'INVALID_PIN_CODE'
      });
    }
  }

  // Validate amount
  if (!orderData.amount || orderData.amount <= 0 || orderData.amount > 100000) {
    errors.push({
      field: 'amount',
      message: 'Amount must be between ₹1 and ₹1,00,000',
      code: 'INVALID_AMOUNT'
    });
  }

  // Validate expected date
  if (orderData.expectedDate) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const expectedDate = new Date(orderData.expectedDate);
    expectedDate.setHours(0, 0, 0, 0);

    if (expectedDate < today) {
      errors.push({
        field: 'expectedDate',
        message: 'Expected date cannot be in the past',
        code: 'INVALID_EXPECTED_DATE'
      });
    }
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};

export const validateOrderStateTransition = (from: OrderStatus, to: OrderStatus, isAdminOverride: boolean = false): OrderStateTransition => {
  const allowedTransitions = ORDER_STATE_TRANSITIONS[from] || [];
  let isAllowed = allowedTransitions.includes(to);

  // Allow admin overrides for common business transitions
  if (!isAllowed && isAdminOverride) {
    const adminAllowedTransitions = [
      // Allow admins to move orders forward in the workflow
      ['paid', 'printing'],
      ['paid', 'dispatched'],
      ['paid', 'delivered'],
      ['processing', 'dispatched'],
      ['processing', 'delivered'],
      ['printing', 'delivered'],
      ['printed', 'delivered'],
      // Allow admins to move orders backward for corrections
      ['printing', 'processing'],
      ['printed', 'printing'],
      ['dispatched', 'printed'],
      ['dispatched', 'printing'],
      ['delivered', 'dispatched'],
      ['delivered', 'printing'],
      ['delivered', 'processing']
    ];

    const isAdminAllowed = adminAllowedTransitions.some(([fromStatus, toStatus]) =>
      fromStatus === from && toStatus === to
    );

    if (isAdminAllowed) {
      isAllowed = true;
    }
  }

  return {
    from,
    to,
    allowed: isAllowed,
    reason: isAllowed ? undefined : `Transition from ${from} to ${to} is not allowed`
  };
};

export const getOrderStatusDisplay = (status: OrderStatus): { label: string; color: string; description: string } => {
  const statusMap: Record<OrderStatus, { label: string; color: string; description: string }> = {
    draft: { label: 'Draft', color: 'gray', description: 'Order is being prepared' },
    pending_payment: { label: 'Pending Payment', color: 'yellow', description: 'Waiting for payment' },
    paid: { label: 'Paid', color: 'green', description: 'Payment received, processing order' },
    processing: { label: 'Processing', color: 'blue', description: 'Order is being processed' },
    printing: { label: 'Printing', color: 'purple', description: 'Document is being printed' },
    printed: { label: 'Printed', color: 'teal', description: 'Printing completed, ready for dispatch' },
    dispatched: { label: 'Dispatched', color: 'indigo', description: 'Order has been dispatched' },
    delivered: { label: 'Delivered', color: 'green', description: 'Order has been delivered' },
    refunded: { label: 'Refunded', color: 'orange', description: 'Order has been refunded' }
  };

  return statusMap[status] || { label: 'Unknown', color: 'gray', description: 'Unknown status' };
};

export const sanitizeOrderData = (orderData: any): OrderData => {
  return {
    customerInfo: {
      name: String(orderData.customerInfo?.name || '').trim(),
      phone: String(orderData.customerInfo?.phone || '').trim(),
      email: String(orderData.customerInfo?.email || '').trim().toLowerCase()
    },
    orderType: orderData.orderType || 'file',
    fileURL: orderData.fileURL,
    fileType: orderData.fileType,
    originalFileName: orderData.originalFileName,
    templateData: orderData.templateData,
    printingOptions: {
      pageSize: orderData.printingOptions?.pageSize || 'A4',
      color: orderData.printingOptions?.color || 'bw',
      sided: orderData.printingOptions?.sided || 'single',
      copies: Math.max(1, Math.min(100, parseInt(orderData.printingOptions?.copies) || 1)),
      pageCount: Math.max(1, Math.min(1000, parseInt(orderData.printingOptions?.pageCount) || 1)),
      serviceOption: orderData.printingOptions?.serviceOption,
      pageColors: orderData.printingOptions?.pageColors
    },
    deliveryOption: {
      type: orderData.deliveryOption?.type || 'pickup',
      pickupLocationId: orderData.deliveryOption?.pickupLocationId,
      deliveryCharge: orderData.deliveryOption?.deliveryCharge,
      address: orderData.deliveryOption?.address?.trim(),
      city: orderData.deliveryOption?.city?.trim(),
      pinCode: orderData.deliveryOption?.pinCode?.trim(),
      partnerId: orderData.deliveryOption?.partnerId,
      partnerDeliveryPoint: orderData.deliveryOption?.partnerDeliveryPoint
    },
    expectedDate: orderData.expectedDate ? new Date(orderData.expectedDate) : undefined,
    amount: Math.max(0, Math.min(100000, parseFloat(orderData.amount) || 0))
  };
};

export const handleOrderError = (error: unknown): NextResponse => {
  console.error('Order error:', error);

  if (error instanceof Error) {
    // Handle specific error types
    if (error.message.includes('validation') || error.message.includes('invalid')) {
      return NextResponse.json(
        { success: false, error: 'Invalid order data provided' },
        { status: 400 }
      );
    }

    if (error.message.includes('duplicate') || error.message.includes('already exists')) {
      return NextResponse.json(
        { success: false, error: 'Order already exists' },
        { status: 409 }
      );
    }

    if (error.message.includes('not found')) {
      return NextResponse.json(
        { success: false, error: 'Order not found' },
        { status: 404 }
      );
    }
  }

  // Generic error response
  return NextResponse.json(
    { success: false, error: 'Order processing failed' },
    { status: 500 }
  );
};

// Helper functions
const isValidEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

const isValidPhone = (phone: string): boolean => {
  const phoneRegex = /^[+]?[\d\s\-\(\)]{10,15}$/;
  return phoneRegex.test(phone);
};

const isValidPinCode = (pinCode: string): boolean => {
  const pinCodeRegex = /^[1-9][0-9]{5}$/;
  return pinCodeRegex.test(pinCode);
};

export const logOrderEvent = (event: string, orderId: string, data: any, level: 'info' | 'warn' | 'error' = 'info') => {
  const sanitizedData = {
    orderId,
    event,
    timestamp: new Date().toISOString(),
    ...data
  };

  const logMessage = `[ORDER-${event.toUpperCase()}] ${JSON.stringify(sanitizedData)}`;

  switch (level) {
    case 'error':
      console.error(logMessage);
      break;
    case 'warn':
      console.warn(logMessage);
      break;
    default:
      console.log(logMessage);
  }
};
