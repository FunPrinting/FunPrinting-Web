'use client';

import { useState, useRef, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useRazorpay } from '@/hooks/useRazorpay';
import { checkPendingPaymentVerification, handlePaymentSuccess, handlePaymentFailure, startPaymentStatusPolling } from '@/lib/paymentUtils';
import { useAuth } from '@/hooks/useAuth';
import InlineAuthModal from '@/components/InlineAuthModal';
import InlinePhoneModal from '@/components/InlinePhoneModal';
import { saveOrderState, restoreOrderState, clearOrderState } from '@/lib/orderStatePersistence';
import { DocumentIcon, WarningIcon, InfoIcon, FolderIcon, CheckIcon, TruckIcon, BuildingIcon, LockIcon, ClockIcon, UploadIcon, RefreshIcon, MoneyIcon } from '@/components/SocialIcons';
import toast from 'react-hot-toast';
import { getCart, addToCart, removeFromCart, clearCart, getCartItemCount, getCartWeight, estimateItemPrice, estimateCartTotal, fileToDataUrl, dataUrlToFile, generateCartId, getCartItem, updateCartItem, CartItem } from '@/lib/cartUtils';
import { PricingData } from '@/lib/pricing';
import PartnerMapSelector from '@/components/PartnerMapSelector';

interface FilePrintingOptions {
  pageSize: 'A4' | 'A3';
  color: 'color' | 'bw' | 'mixed';
  sided: 'single' | 'double';
  copies: number;
  pageColors?: {
    colorPages: number[];
    bwPages: number[];
  };
}

interface PrintingOptions {
  // Legacy: single printing options (for backward compatibility)
  pageSize?: 'A4' | 'A3';
  color?: 'color' | 'bw' | 'mixed';
  sided?: 'single' | 'double';
  copies?: number;
  serviceOption?: 'binding' | 'file' | 'service'; // Legacy support
  serviceOptions?: ('binding' | 'file' | 'service')[]; // Per-file service options
  pageColors?: {
    colorPages: number[];
    bwPages: number[];
  } | Array<{ // Per-file page colors (new format)
    colorPages: number[];
    bwPages: number[];
  }>;
  // Per-file printing options (new format)
  fileOptions?: FilePrintingOptions[];
}

interface CustomerInfo {
  name: string;
  phone: string;
  email: string;
}

interface DeliveryOption {
  type: 'pickup' | 'delivery';
  location?: {
    lat: number;
    lng: number;
    address: string;
  };
  distance?: number;
  deliveryCharge?: number;
  recipientName?: string;
  recipientPhone?: string;
  flatBuilding?: string;
  address?: string;
  landmark?: string;
  city?: string;
  state?: string;
  pinCode?: string;
  pickupLocationId?: string;
  partnerId?: string;
  partnerDeliveryPoint?: string;
}

interface PickupLocation {
  _id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  isActive: boolean;
  isDefault: boolean;
  description?: string;
  contactPerson?: string;
  contactPhone?: string;
  operatingHours?: string;
  gmapLink?: string;
}

// Helper functions for page color selection
interface ParsePageRangeResult {
  pages: number[];
  errors: string[];
  warnings: string[];
}

const parsePageRange = (input: string, maxPages?: number): ParsePageRangeResult => {
  const result: ParsePageRangeResult = {
    pages: [],
    errors: [],
    warnings: []
  };

  if (!input || !input.trim()) {
    return result;
  }

  try {
    const pages: number[] = [];
    const parts = input.split(',');

    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue; // Skip empty parts

      if (trimmed.includes('-')) {
        // Handle range like "5-8" or "5-" (open-ended)
        const rangeParts = trimmed.split('-');
        if (rangeParts.length === 2) {
          const startStr = rangeParts[0].trim();
          const endStr = rangeParts[1].trim();

          if (!startStr) {
            result.errors.push(`Invalid range "${trimmed}": missing start page`);
            continue;
          }

          const start = parseInt(startStr);
          if (isNaN(start) || start <= 0) {
            result.errors.push(`Invalid range "${trimmed}": start page must be a positive number`);
            continue;
          }

          if (!endStr) {
            // Open-ended range like "5-" means from 5 to end
            if (maxPages) {
              if (start > maxPages) {
                result.errors.push(`Range "${trimmed}": start page ${start} exceeds total pages ${maxPages}`);
                continue;
              }
              for (let i = start; i <= maxPages; i++) {
                pages.push(i);
              }
            } else {
              result.warnings.push(`Range "${trimmed}": cannot determine end page without total page count`);
            }
          } else {
            const end = parseInt(endStr);
            if (isNaN(end)) {
              result.errors.push(`Invalid range "${trimmed}": end page must be a number`);
              continue;
            }

            if (start > end) {
              result.errors.push(`Invalid range "${trimmed}": start page (${start}) must be less than or equal to end page (${end})`);
              continue;
            }

            if (maxPages && end > maxPages) {
              result.warnings.push(`Range "${trimmed}": end page ${end} exceeds total pages ${maxPages}, using ${maxPages} instead`);
            }

            const actualEnd = maxPages ? Math.min(end, maxPages) : end;
            for (let i = start; i <= actualEnd; i++) {
              pages.push(i);
            }
          }
        } else {
          result.errors.push(`Invalid range format "${trimmed}": use format "start-end"`);
        }
      } else {
        // Handle single page
        const page = parseInt(trimmed);
        if (isNaN(page)) {
          result.errors.push(`Invalid page number "${trimmed}": must be a number`);
          continue;
        }

        if (page <= 0) {
          result.errors.push(`Invalid page number "${trimmed}": must be greater than 0`);
          continue;
        }

        if (maxPages && page > maxPages) {
          result.warnings.push(`Page ${page} exceeds total pages ${maxPages}`);
          continue;
        }

        pages.push(page);
      }
    }

    // Remove duplicates and sort
    result.pages = [...new Set(pages)].sort((a, b) => a - b);

    // Check for duplicates in input (before parsing)
    const inputParts = input.split(',').map(p => p.trim()).filter(p => p);
    const uniqueInputParts = [...new Set(inputParts)];
    if (inputParts.length !== uniqueInputParts.length) {
      result.warnings.push('Duplicate page numbers detected in input');
    }

  } catch (error) {
    console.error('Error parsing page range:', error);
    result.errors.push('An error occurred while parsing page range');
  }

  return result;
};

const generateBwPages = (totalPages: number, colorPages: number[]): number[] => {
  const allPages = Array.from({ length: totalPages }, (_, i) => i + 1);
  return allPages.filter(page => !colorPages.includes(page));
};

/**
 * Truncate file name to maintain length of ~10 characters
 * Example: "adityapandey.pdf" -> "adi..ya.pdf"
 * Keeps first 3-4 chars, then "..", then last 2-3 chars before extension
 */
const truncateFileName = (fileName: string, maxLength: number = 10): string => {
  if (fileName.length <= maxLength) {
    return fileName;
  }

  // Extract extension
  const lastDotIndex = fileName.lastIndexOf('.');
  if (lastDotIndex === -1) {
    // No extension, just truncate with ellipsis
    return fileName.substring(0, maxLength - 3) + '...';
  }

  const nameWithoutExt = fileName.substring(0, lastDotIndex);
  const extension = fileName.substring(lastDotIndex);

  // If name without extension is short enough, return as is
  if (nameWithoutExt.length + extension.length <= maxLength) {
    return fileName;
  }

  // Calculate how much space we have for the name (excluding extension and "..")
  const availableLength = maxLength - extension.length - 2; // 2 for ".."

  if (availableLength < 2) {
    // Very short, just show extension
    return '..' + extension;
  }

  // For better readability: first part gets slightly more (3-4 chars), last part gets 2-3 chars
  // This creates patterns like "adi..ya.pdf" (3+2=5) or "very..me.pdf" (4+2=6)
  const firstPartLength = Math.min(4, Math.ceil(availableLength * 0.6)); // Prefer 3-4 chars for first part
  const lastPartLength = Math.max(2, availableLength - firstPartLength); // At least 2 chars for last part

  const firstPart = nameWithoutExt.substring(0, firstPartLength);
  const lastPart = nameWithoutExt.substring(nameWithoutExt.length - lastPartLength);

  return firstPart + '..' + lastPart + extension;
};

/**
 * Get printing options for a specific file (handles both per-file and legacy formats)
 */
const getFilePrintingOptions = (
  fileIndex: number,
  printingOptions: PrintingOptions
): FilePrintingOptions => {
  // Check if we have per-file options
  if (printingOptions.fileOptions && printingOptions.fileOptions.length > fileIndex) {
    return printingOptions.fileOptions[fileIndex];
  }

  // Fall back to legacy single options
  return {
    pageSize: printingOptions.pageSize || 'A4',
    color: printingOptions.color || 'bw',
    sided: printingOptions.sided || 'single',
    copies: printingOptions.copies || 1,
    pageColors: (() => {
      const filePageColors = getFilePageColors(fileIndex, printingOptions.pageColors);
      return filePageColors.colorPages.length > 0 || filePageColors.bwPages.length > 0
        ? filePageColors
        : undefined;
    })()
  };
};

/**
 * Get page colors for a specific file (handles both array and legacy single object formats)
 */
const getFilePageColors = (
  fileIndex: number,
  pageColors?: { colorPages: number[]; bwPages: number[] } | Array<{ colorPages: number[]; bwPages: number[] }>
): { colorPages: number[]; bwPages: number[] } => {
  if (!pageColors) {
    return { colorPages: [], bwPages: [] };
  }

  // Handle array format (per-file)
  if (Array.isArray(pageColors)) {
    if (fileIndex >= 0 && fileIndex < pageColors.length) {
      return pageColors[fileIndex];
    }
    return { colorPages: [], bwPages: [] };
  }

  // Handle legacy single object format (backward compatibility)
  // For legacy format, we'd need to distribute pages across files, but that's complex
  // For now, return empty for files beyond the first one
  if (fileIndex === 0) {
    return pageColors;
  }

  return { colorPages: [], bwPages: [] };
};

/**
 * Calculate cost for a single file
 */
const calculateFileCost = (
  filePageCount: number,
  fileColorPages: number,
  fileBwPages: number,
  basePrice: number,
  colorMultiplier: number,
  sidedMultiplier: number,
  copies: number,
  colorMode: 'color' | 'bw' | 'mixed'
): number => {
  if (colorMode === 'mixed') {
    // Mixed: calculate color and B&W pages separately
    const colorCost = fileColorPages * basePrice * colorMultiplier;
    const bwCost = fileBwPages * basePrice;
    return (colorCost + bwCost) * sidedMultiplier * copies;
  } else if (colorMode === 'color') {
    // All color: apply multiplier to all pages
    return filePageCount * basePrice * colorMultiplier * sidedMultiplier * copies;
  } else {
    // All B&W: no multiplier
    return filePageCount * basePrice * sidedMultiplier * copies;
  }
};

const getPageColorPreview = (totalPages: number, pageColors?: { colorPages: number[]; bwPages: number[] } | Array<{ colorPages: number[]; bwPages: number[] }>): string => {
  if (!pageColors) return 'All pages in Black & White';

  // Handle array format (per-file) - show summary
  if (Array.isArray(pageColors)) {
    // Some entries may be undefined if a file has no explicit pageColors set
    const safeEntries = pageColors.filter(Boolean) as Array<{ colorPages: number[]; bwPages: number[] }>;
    const totalColor = safeEntries.reduce((sum, pc) => {
      const colorLen = Array.isArray(pc?.colorPages) ? pc.colorPages.length : 0;
      return sum + colorLen;
    }, 0);
    const totalBw = safeEntries.reduce((sum, pc) => {
      const bwLen = Array.isArray(pc?.bwPages) ? pc.bwPages.length : 0;
      return sum + bwLen;
    }, 0);
    if (totalColor === 0) return 'All pages in Black & White';
    if (totalBw === 0) return 'All pages in Color';
    return `${totalColor} pages in Color, ${totalBw} pages in Black & White`;
  }

  // Handle legacy single object format
  const colorCount = pageColors.colorPages.length;
  const bwCount = pageColors.bwPages.length;

  if (colorCount === 0) return 'All pages in Black & White';
  if (bwCount === 0) return 'All pages in Color';

  return `${colorCount} pages in Color, ${bwCount} pages in Black & White`;
};

// Helper function to count pages in a file
const countPagesInFile = async (file: File): Promise<number> => {
  if (file.type === 'application/pdf') {
    try {
      const formData = new FormData();
      formData.append('file', file);
      
      console.log(`[Phase 10 Security] Verifying PDF server-side: ${file.name}`);
      const response = await fetch('/api/upload/verify', {
        method: 'POST',
        body: formData,
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.verifiedPageCount) {
          console.log(`[Phase 10 Security] Server verified page count: ${data.verifiedPageCount}`);
          return data.verifiedPageCount;
        }
      }
      throw new Error('Server validation failed');
    } catch (error) {
      console.error('Error verifying PDF on server:', error);
      // Fallback only if absolutely necessary, but in a true business app this should block checkout
      return Math.max(1, Math.floor(file.size / 50000));
    }
  } else if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    file.type === 'application/msword') {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const base64Buffer = buffer.toString('base64');

      const response = await fetch('/api/parse-docx-structure', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ docxBuffer: base64Buffer }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.totalPages) {
          return data.totalPages;
        }
      }
      throw new Error('Failed to parse docx pages via API');
    } catch (error) {
      console.error('Error parsing Word document:', error);
      throw error;
    }
  } else {
    // For other file types (images, etc.), assume 1 page
    return 1;
  }
};

// Helper function to extract customer info from template form data
// Checks multiple field name variations to find name, email, and phone
function extractCustomerInfo(customerData: Record<string, any>): CustomerInfo {
  if (!customerData || typeof customerData !== 'object') {
    return { name: '', email: '', phone: '' };
  }

  // Helper to find value by multiple possible keys (case-insensitive)
  const findField = (keys: string[]): string => {
    for (const key of keys) {
      // Check exact match
      if (customerData[key] && typeof customerData[key] === 'string') {
        return customerData[key].trim();
      }
      // Check case-insensitive match
      const lowerKey = key.toLowerCase();
      for (const dataKey in customerData) {
        if (dataKey.toLowerCase() === lowerKey && typeof customerData[dataKey] === 'string') {
          return customerData[dataKey].trim();
        }
      }
    }
    return '';
  };

  return {
    name: findField(['name', 'studentName', 'fullName', 'student_name', 'full_name']),
    email: findField(['email', 'emailAddress', 'e_mail', 'e-mail']),
    phone: findField(['phone', 'mobile', 'contact', 'phoneNumber', 'contactNumber', 'tel', 'telephone'])
  };
}

function OrderPageContent() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { isLoaded: isRazorpayLoaded, error: razorpayError, openRazorpay } = useRazorpay();
  const { user, isAuthenticated } = useAuth();

  // Removed step management - single page now

  // Step 1: File upload and preview
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [fileURLs, setFileURLs] = useState<string[]>([]);
  const [orderType, setOrderType] = useState<'file' | 'template'>('file');
  const [printingOptions, setPrintingOptions] = useState<PrintingOptions>({
    pageSize: 'A4',
    color: 'bw',
    sided: 'single',
    copies: 1,
    serviceOption: 'service', // Legacy support
    serviceOptions: [], // Per-file service options
    pageColors: [], // Per-file page colors array
  });
  const [expectedDate, setExpectedDate] = useState<string>(() => {
    const d = new Date(); d.setDate(d.getDate() + 5);
    return d.toISOString().split('T')[0];
  });
  const [deliverySpeed, setDeliverySpeed] = useState<'standard' | 'express' | 'sameday'>('standard');
  const [pageCount, setPageCount] = useState(1);
  const [filePageCounts, setFilePageCounts] = useState<number[]>([]); // Track page count for each file
  const [pdfUrls, setPdfUrls] = useState<string[]>([]);
  const [pdfLoaded, setPdfLoaded] = useState(false);
  const [isLoadingPdf, setIsLoadingPdf] = useState(false);
  const [isCountingPages, setIsCountingPages] = useState(false);

  // Step 2: Details, delivery, and payment
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo>({
    name: user?.name || '',
    phone: '',
    email: user?.email || '',
  });
  const [deliveryOption, setDeliveryOption] = useState<DeliveryOption>({ type: 'pickup' });
  const [showMapModal, setShowMapModal] = useState(false);
  const [isPincodeLookup, setIsPincodeLookup] = useState(false);
  const [pincodeError, setPincodeError] = useState<string>('');
  const [isDetectingLocation, setIsDetectingLocation] = useState(false);
  const [isFetchingRate, setIsFetchingRate] = useState(false);
  const [deliveryRateInfo, setDeliveryRateInfo] = useState<{
    charge: number; estimatedDays: number; courierName: string; weight: number;
    tiers?: Array<{ id: string; label: string; description: string; emoji: string; deliveryCharge: number; estimatedDays: number; courierName: string }>;
  } | null>(null);

  // Calculate package weight from page count and paper size
  const calculatePackageWeight = (): number => {
    const totalPages = selectedFiles.reduce((sum: number, _: any, idx: number) => {
      const fileOpts = getFilePrintingOptions(idx, printingOptions);
      const pageCount = filePageCounts[idx] || 1;
      return sum + (pageCount * fileOpts.copies);
    }, 0);
    const perSheetGrams = printingOptions.pageSize === 'A3' ? 10 : 5;
    const totalGrams = (totalPages * perSheetGrams) + 10;
    return Math.max(0.1, parseFloat((totalGrams / 1000).toFixed(2)));
  };

  // Get the delivery charge for the selected speed tier
  const getSelectedTierCharge = (): number => {
    if (!deliveryRateInfo?.tiers) return 0;
    const tier = deliveryRateInfo.tiers.find((t: { id: string }) => t.id === deliverySpeed);
    return tier?.deliveryCharge || deliveryRateInfo.charge || 0;
  };

  // Fetch delivery rate tiers from API
  const fetchDeliveryRate = async (pincode: string) => {
    if (pincode.length !== 6 || selectedFiles.length === 0) return;
    setIsFetchingRate(true);
    try {
      const weight = calculatePackageWeight();
      const res = await fetch(`/api/delivery/rate?delivery_pincode=${pincode}&weight=${weight}`);
      const data = await res.json();
      if (data.success) {
        setDeliveryRateInfo({
          charge: data.deliveryCharge,
          estimatedDays: data.estimatedDays,
          courierName: data.courierName,
          weight: data.weight,
          tiers: data.tiers || [],
        });
        // Set delivery charge based on currently selected speed
        const selectedTier = (data.tiers || []).find((t: any) => t.id === deliverySpeed);
        const charge = selectedTier?.deliveryCharge || data.deliveryCharge;
        setDeliveryOption((prev: DeliveryOption) => ({ ...prev, deliveryCharge: charge }));
      }
    } catch {
      // Silently fail
    } finally {
      setIsFetchingRate(false);
    }
  };

  // Auto-fetch delivery rate when pincode or files change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (
      deliveryOption.type === 'delivery' &&
      deliveryOption.pinCode &&
      deliveryOption.pinCode.length === 6 &&
      selectedFiles.length > 0
    ) {
      fetchDeliveryRate(deliveryOption.pinCode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deliveryOption.pinCode, deliveryOption.type, selectedFiles.length, printingOptions.pageSize, printingOptions.copies]);

  const [pickupLocations, setPickupLocations] = useState<PickupLocation[]>([]);
  const [selectedPickupLocation, setSelectedPickupLocation] = useState<PickupLocation | null>(null);
  const [colorPagesInput, setColorPagesInput] = useState<string>(''); // Legacy - will be replaced with per-file
  const [colorPagesInputs, setColorPagesInputs] = useState<string[]>([]); // Per-file color pages input
  const [colorPagesValidation, setColorPagesValidation] = useState<{ errors: string[]; warnings: string[] }>({ errors: [], warnings: [] });
  const [colorPagesValidations, setColorPagesValidations] = useState<Array<{ errors: string[]; warnings: string[] }>>([]); // Per-file validations

  // Auth modal state
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');

  // Phone modal state
  const [showPhoneModal, setShowPhoneModal] = useState(false);

  // Cart state
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [showCartDrawer, setShowCartDrawer] = useState(false);
  const [isAddingToCart, setIsAddingToCart] = useState(false);
  const [editingCartItemId, setEditingCartItemId] = useState<string | null>(null);
  const [pricing, setPricing] = useState<PricingData | undefined>(undefined);

  // Search params for cart editing
  const searchParams = useSearchParams();

  // Load cart from localStorage on mount
  useEffect(() => {
    setCartItems(getCart());
  }, []);

  // Fetch pricing on mount
  useEffect(() => {
    const fetchPricing = async () => {
      try {
        const res = await fetch('/api/pricing');
        if (res.ok) {
          const data = await res.json();
          if (data.success && data.pricing) {
            setPricing(data.pricing);
          }
        }
      } catch (error) {
        console.error('Failed to fetch pricing:', error);
      }
    };
    fetchPricing();
  }, []);

  // Helper to load cart items into order state (for checkout)
  const loadCartForCheckout = () => {
    setShowCartDrawer(false);
    // Restore all cart items as files for checkout
    const files: File[] = [];
    const pageCounts: number[] = [];
    const fileOptions: Array<{
      pageSize: 'A4' | 'A3';
      color: 'color' | 'bw' | 'mixed';
      sided: 'single' | 'double';
      copies: number;
      pageColors?: {
        colorPages: number[];
        bwPages: number[];
      };
    }> = [];
    const serviceOpts: ('file' | 'binding' | 'service')[] = [];
    const pageColorsArr: Array<{
      colorPages: number[];
      bwPages: number[];
    }> = [];

    const initialColorPagesInputs: string[] = [];
    const initialColorPagesValidations: Array<{ errors: string[]; warnings: string[] }> = [];

    const currentCart = getCart(); // Get fresh cart data
    if (currentCart.length === 0) return;

    for (const item of currentCart) {
      const file = dataUrlToFile(item.fileDataUrl, item.fileName, item.fileType);
      files.push(file);
      pageCounts.push(item.pageCount);
      fileOptions.push({
        pageSize: item.printingOptions.pageSize,
        color: item.printingOptions.color,
        sided: item.printingOptions.sided,
        copies: item.printingOptions.copies,
        pageColors: item.printingOptions.pageColors,
      });
      serviceOpts.push((item.printingOptions.serviceOption as 'file' | 'binding' | 'service') || 'service');
      pageColorsArr.push(item.printingOptions.pageColors || {
        colorPages: [],
        bwPages: []
      });

      // Restore color pages input state
      if (item.printingOptions.color === 'mixed' && item.printingOptions.pageColors) {
        const colorPages = item.printingOptions.pageColors.colorPages || [];
        initialColorPagesInputs.push(colorPages.join(', '));
        initialColorPagesValidations.push({ errors: [], warnings: [] });
      } else {
        initialColorPagesInputs.push('');
        initialColorPagesValidations.push({ errors: [], warnings: [] });
      }
    }

    // Load cart items into order state
    setSelectedFiles(files);
    setFilePageCounts(pageCounts);
    const totalPages = pageCounts.reduce((sum: number, p: number) => sum + p, 0);
    setPageCount(totalPages);

    // Set color page inputs - crucial for validation and UI sync
    setColorPagesInputs(initialColorPagesInputs);
    setColorPagesValidations(initialColorPagesValidations);

    setPrintingOptions((prev: PrintingOptions) => ({
      ...prev,
      fileOptions,
      serviceOptions: serviceOpts,
      pageColors: pageColorsArr,
      pageSize: fileOptions[0]?.pageSize || 'A4',
      color: fileOptions.some((f: {
        color: string
      }) => f.color === 'mixed') ? 'mixed' :
        fileOptions.some((f: {
          color: string
        }) => f.color === 'color') ? 'color' : 'bw',
      sided: fileOptions[0]?.sided || 'single',
      copies: fileOptions[0]?.copies || 1,
    }));
  };

  // Auto-checkout when query param is present
  useEffect(() => {
    if (searchParams.get('checkout') === 'true') {
      // Small delay to ensure cart is loaded
      setTimeout(() => {
        loadCartForCheckout();
        toast.success('Checkout started! Review details & pay.');
      }, 500);
    }
  }, [searchParams]);

  // Load cart item for editing when editCartItem query param is present
  useEffect(() => {
    const editId = searchParams.get('editCartItem');
    if (!editId) return;

    const cartItem = getCartItem(editId);
    if (!cartItem) {
      toast.error('Cart item not found');
      return;
    }

    setEditingCartItemId(editId);

    // Convert stored data URL back to File object
    try {
      const file = dataUrlToFile(cartItem.fileDataUrl, cartItem.fileName, cartItem.fileType);
      setSelectedFiles([file]);
      setFilePageCounts([cartItem.pageCount]);
      setPageCount(cartItem.pageCount);

      // Set printing options from cart item
      setPrintingOptions(prev => ({
        ...prev,
        pageSize: cartItem.printingOptions.pageSize,
        color: cartItem.printingOptions.color,
        sided: cartItem.printingOptions.sided,
        copies: cartItem.printingOptions.copies,
        serviceOption: (cartItem.printingOptions.serviceOption as 'service' | 'binding' | 'file') || 'service',
        serviceOptions: [(cartItem.printingOptions.serviceOption as 'service' | 'binding' | 'file') || 'service'],
        fileOptions: [{
          pageSize: cartItem.printingOptions.pageSize,
          color: cartItem.printingOptions.color,
          sided: cartItem.printingOptions.sided,
          copies: cartItem.printingOptions.copies,
        }],
      }));

      toast.success(`Editing: ${cartItem.fileName}`);
    } catch (err) {
      console.error('Failed to load cart item for editing:', err);
      toast.error('Failed to load cart item');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Update customer info when user authentication changes
  // This takes priority over template data - authenticated user info should never be overwritten
  useEffect(() => {
    if (user && isAuthenticated) {
      setCustomerInfo(prev => ({
        // Always use authenticated user info if available, only fall back to prev if user info is missing
        name: user.name || prev.name,
        email: user.email || prev.email,
        // Preserve phone if user doesn't have one yet
        phone: prev.phone || '',
      }));
    }
  }, [user, isAuthenticated]);

  // Re-merge user info after authentication if template data exists
  // This ensures authenticated user info takes priority even if template data was loaded first
  useEffect(() => {
    if (isAuthenticated && user) {
      const pendingTemplateDoc = sessionStorage.getItem('pendingTemplateDocument');
      if (pendingTemplateDoc) {
        // Template data exists - ensure authenticated user info is preserved
        setCustomerInfo(prev => ({
          // Always prioritize authenticated user info
          name: user.name || prev.name,
          email: user.email || prev.email,
          // Preserve phone - don't overwrite if already set
          phone: prev.phone || '',
        }));
        console.log('✅ Re-merged authenticated user info after signup (template data present)');
      }
    }
  }, [isAuthenticated, user]);

  // Load user profile and apply default location
  useEffect(() => {
    const loadUserProfile = async () => {
      if (isAuthenticated && user?.email) {
        try {
          const response = await fetch('/api/user/profile');
          const data = await response.json();

          if (data.success && data.profile) {
            // Set phone number if available AND current phone is empty (preserve template-loaded phone)
            if (data.profile.phone) {
              setCustomerInfo(prev => {
                // Only update phone if it's currently empty (preserve template-loaded phone)
                if (!prev.phone || prev.phone.trim() === '') {
                  return {
                    ...prev,
                    phone: data.profile.phone
                  };
                }
                return prev;
              });
            }

            // Apply default location if available
            if (data.profile.defaultLocation) {
              const defaultLoc = data.profile.defaultLocation;
              setSelectedPickupLocation(defaultLoc);
              setDeliveryOption(prev => ({
                ...prev,
                type: 'pickup',
                pickupLocationId: defaultLoc._id
              }));
            }
          }
        } catch (error) {
          console.error('Error loading user profile:', error);
        }
      }
    };

    loadUserProfile();
  }, [isAuthenticated, user]);

  // Check if phone number is needed after authentication
  useEffect(() => {
    if (isAuthenticated && user && !customerInfo.phone) {
      // Check user profile for phone number
      const checkPhone = async () => {
        try {
          const response = await fetch('/api/user/profile');
          const data = await response.json();
          if (data.success && !data.profile?.phone) {
            // No phone number in profile - show modal
            setShowPhoneModal(true);
          }
        } catch (error) {
          console.error('Error checking phone:', error);
        }
      };
      // Small delay to ensure profile loading is complete
      const timer = setTimeout(() => {
        checkPhone();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [isAuthenticated, user, customerInfo.phone]);

  // Ensure serviceOptions array matches selectedFiles length
  useEffect(() => {
    if (selectedFiles.length > 0) {
      const currentServiceOptions = printingOptions.serviceOptions || [];
      if (currentServiceOptions.length < selectedFiles.length) {
        const updatedOptions = [...currentServiceOptions];
        while (updatedOptions.length < selectedFiles.length) {
          updatedOptions.push('service');
        }
        setPrintingOptions(prev => ({ ...prev, serviceOptions: updatedOptions }));
        console.log(`📋 Synchronized serviceOptions: ${updatedOptions.length} options for ${selectedFiles.length} files`);
      }
    } else if (selectedFiles.length === 0 && printingOptions.serviceOptions && printingOptions.serviceOptions.length > 0) {
      // Clear service options when no files are selected
      setPrintingOptions(prev => ({ ...prev, serviceOptions: [] }));
    }
  }, [selectedFiles.length]);

  // Check for pending payment verification on page load (iPhone Safari recovery)
  useEffect(() => {
    checkPendingPaymentVerification().then((result) => {
      if (result && result.success) {
        console.log('🔄 Payment verification recovered, redirecting to my orders...');
        router.push('/my-orders');
      }
    });
  }, [router]);


  // General state
  const [isLoading, setIsLoading] = useState(false);
  const [amount, setAmount] = useState(0);
  const [pricingData, setPricingData] = useState<any>(null);
  const [pricingLoading, setPricingLoading] = useState(true);

  // Debug: Log pricingData changes
  useEffect(() => {
    console.log('🔍 PricingData updated:', pricingData);
  }, [pricingData]);

  // Payment state
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [isSavingPhone, setIsSavingPhone] = useState(false);
  const [phoneSaveStatus, setPhoneSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [paymentVerificationStatus, setPaymentVerificationStatus] = useState<{
    verifying: boolean;
    orderId: string | null;
    razorpayOrderId: string | null;
    startTime: number | null;
    polling: boolean;
  }>({
    verifying: false,
    orderId: null,
    razorpayOrderId: null,
    startTime: null,
    polling: false,
  });
  const [uploadProgress, setUploadProgress] = useState<{
    uploading: boolean;
    currentFile: number;
    totalFiles: number;
    fileName: string;
    progress: number;
    startTime: number | null;
    estimatedTimeRemaining: number | null;
    isSlowNetwork: boolean;
  }>({
    uploading: false,
    currentFile: 0,
    totalFiles: 0,
    fileName: '',
    progress: 0,
    startTime: null,
    estimatedTimeRemaining: null,
    isSlowNetwork: false,
  });

  // Handle visibility change for mobile recovery (when user switches apps/tabs)
  useEffect(() => {
    let lastHiddenTime: number | null = null;
    const VISIBILITY_TIMEOUT = 5 * 60 * 1000; // 5 minutes

    const handleVisibilityChange = () => {
      if (document.hidden) {
        // Page became hidden - store the time
        lastHiddenTime = Date.now();
        console.log('📱 Page hidden - storing timestamp for recovery');
      } else {
        // Page became visible - check if we were hidden for too long
        if (lastHiddenTime && isProcessingPayment) {
          const hiddenDuration = Date.now() - lastHiddenTime;
          if (hiddenDuration > VISIBILITY_TIMEOUT) {
            console.log('⚠️ Page was hidden for too long during payment - resetting processing state');
            setIsProcessingPayment(false);
            // Check if payment was actually completed via polling/recovery
            if (paymentVerificationStatus.razorpayOrderId) {
              console.log('🔄 Attempting to recover payment status...');
              // The polling mechanism should handle this, but we reset the UI state
            }
          }
          lastHiddenTime = null;
        }
      }
    };

    // Handle page unload (browser closed, tab closed)
    const handleBeforeUnload = () => {
      if (isProcessingPayment) {
        console.log('⚠️ Page unloading during payment - storing state for recovery');
        // State is already stored in localStorage by paymentUtils
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [isProcessingPayment, paymentVerificationStatus.razorpayOrderId]);

  // Pickup locations
  const [defaultPickupLocation, setDefaultPickupLocation] = useState<{
    _id: string;
    name: string;
    address: string;
    lat: number;
    lng: number;
    gmapLink?: string;
  } | null>(null);

  // Restore order state after Google OAuth redirect
  useEffect(() => {
    const restoreState = async () => {
      const savedState = await restoreOrderState();
      if (savedState) {
        try {
          console.log('📋 Restoring order state after Google OAuth...');

          // Restore all state (files are already converted to File objects)
          setSelectedFiles(savedState.selectedFiles);
          setFileURLs(savedState.fileURLs);
          setOrderType(savedState.orderType);
          setPrintingOptions(savedState.printingOptions);
          setExpectedDate(savedState.expectedDate);
          setPageCount(savedState.pageCount);
          setFilePageCounts(savedState.filePageCounts);
          setPdfUrls(savedState.pdfUrls);
          setPdfLoaded(savedState.pdfLoaded);
          setCustomerInfo(savedState.customerInfo);
          setDeliveryOption(savedState.deliveryOption);
          setSelectedPickupLocation(savedState.selectedPickupLocation);
          setColorPagesInput(savedState.colorPagesInput);
          setColorPagesInputs(savedState.colorPagesInputs);
          setColorPagesValidations(savedState.colorPagesValidations);

          // Clear saved state after restoration
          clearOrderState();

          console.log('✅ Order state restored successfully');
        } catch (error) {
          console.error('Error restoring order state:', error);
          clearOrderState();
        }
      }
    };

    restoreState();
  }, []);

  // Check for pending order from custom template workflow
  useEffect(() => {
    const pendingOrder = sessionStorage.getItem('pendingOrder');
    if (pendingOrder) {
      try {
        const orderData = JSON.parse(pendingOrder);
        console.log('📋 Found pending order from custom template:', orderData);

        // Set the order type to template
        setOrderType('template');

        // Set the PDF URL for preview
        if (orderData.pdfUrl) {
          setPdfUrls([orderData.pdfUrl]);
          setPdfLoaded(true);
        }

        // Set customer info from the form data
        // IMPORTANT: If user is authenticated, authenticated user info takes priority
        if (orderData.customerData) {
          const extractedInfo = extractCustomerInfo(orderData.customerData);
          console.log('📋 Extracted customer info from pending order:', extractedInfo);
          setCustomerInfo(prev => {
            // If user is authenticated, never overwrite authenticated user info with template data
            if (isAuthenticated && user) {
              return {
                // Always preserve authenticated user info
                name: user.name || prev.name,
                email: user.email || prev.email,
                // Only use template phone if user doesn't have one and template has it
                phone: prev.phone || ((extractedInfo.phone && extractedInfo.phone.trim()) ? extractedInfo.phone.trim() : ''),
              };
            }
            // If not authenticated, only update fields that have non-empty values
            return {
              name: (extractedInfo.name && extractedInfo.name.trim()) ? extractedInfo.name.trim() : prev.name,
              email: (extractedInfo.email && extractedInfo.email.trim()) ? extractedInfo.email.trim() : prev.email,
              phone: (extractedInfo.phone && extractedInfo.phone.trim()) ? extractedInfo.phone.trim() : prev.phone
            };
          });
        }

        // Set page count to 1 for template orders (will be updated based on actual PDF)
        setPageCount(1);

        // Clear the pending order from session storage
        sessionStorage.removeItem('pendingOrder');

        console.log('✅ Pending order loaded successfully');
      } catch (error) {
        console.error('Error loading pending order:', error);
        sessionStorage.removeItem('pendingOrder');
      }
    }
  }, []);

  // Check for pending template document (from template payment flow)
  useEffect(() => {
    const pendingTemplateDoc = sessionStorage.getItem('pendingTemplateDocument');
    if (pendingTemplateDoc) {
      const loadTemplateDocument = async () => {
        try {
          const templateData = JSON.parse(pendingTemplateDoc);
          console.log('📋 Found pending template document:', templateData);

          // Set the order type to file (since we're uploading the file)
          setOrderType('file');

          // Priority: Handle PDF URL if present (new flow with PDF conversion)
          // Check for PDF first - prioritize PDF over Word when both are available
          if (templateData.pdfUrl) {
            console.log('📄 PDF URL found, prioritizing PDF file...');
            console.log('  - PDF URL:', templateData.pdfUrl);
            console.log('  - isPdf flag:', templateData.isPdf);
            console.log('  - Word URL available:', !!templateData.wordUrl);

            setIsLoadingPdf(true); // Mark that we're loading PDF
            setIsCountingPages(true);
            setPdfLoaded(false);

            try {
              // Fetch PDF file from URL
              const response = await fetch(templateData.pdfUrl);
              if (!response.ok) {
                throw new Error(`Failed to fetch PDF file from URL: ${response.status}`);
              }

              const blob = await response.blob();
              console.log('✅ PDF blob fetched:', blob.size, 'bytes', 'type:', blob.type);

              // Explicitly set blob type to ensure it's recognized as PDF
              const pdfBlob = blob.type === 'application/pdf'
                ? blob
                : new Blob([blob], { type: 'application/pdf' });

              console.log('✅ PDF blob type verified:', pdfBlob.type);

              // Convert blob to File object with explicit MIME type
              const fileName = `${templateData.templateName?.replace(/[^\w\-\s\.]/g, '').trim().replace(/\s+/g, '-') || 'document'}.pdf`;
              const file = new File([pdfBlob], fileName, {
                type: 'application/pdf' // Explicitly set MIME type
              });

              // Add file to selectedFiles
              setSelectedFiles([file]);

              // Create preview URL from the correctly typed PDF blob
              const previewUrl = URL.createObjectURL(pdfBlob);
              setPdfUrls([previewUrl]);
              setFileURLs([templateData.pdfUrl]);

              // Count pages for PDF file
              const pageCount = await countPagesInFile(file);
              setFilePageCounts([pageCount]);
              setPageCount(pageCount);

              setPdfLoaded(true);
              setIsLoadingPdf(false);
              setIsCountingPages(false);

              console.log('✅ PDF file loaded from URL and added to upload');
              console.log('  - File name:', fileName);
              console.log('  - File type:', file.type);
              console.log('  - File size:', file.size, 'bytes');
              console.log('  - Page count:', pageCount);
              console.log('  - Preview URL created:', previewUrl.substring(0, 50) + '...');

              // PDF loaded successfully - exit early, don't load Word
              // Customer info will be set below after this block
              // Clear the pending template document
              sessionStorage.removeItem('pendingTemplateDocument');

              // Set customer info from the form data (for PDF case)
              // IMPORTANT: If user is authenticated, authenticated user info takes priority
              if (templateData.customerData) {
                const extractedInfo = extractCustomerInfo(templateData.customerData);
                console.log('📋 Extracted customer info from template:', extractedInfo);
                setCustomerInfo(prev => {
                  // If user is authenticated, never overwrite authenticated user info with template data
                  if (isAuthenticated && user) {
                    return {
                      // Always preserve authenticated user info
                      name: user.name || prev.name,
                      email: user.email || prev.email,
                      // Only use template phone if user doesn't have one and template has it
                      phone: prev.phone || ((extractedInfo.phone && extractedInfo.phone.trim()) ? extractedInfo.phone.trim() : ''),
                    };
                  }
                  // If not authenticated, only update fields that have non-empty values
                  return {
                    name: (extractedInfo.name && extractedInfo.name.trim()) ? extractedInfo.name.trim() : prev.name,
                    phone: (extractedInfo.phone && extractedInfo.phone.trim()) ? extractedInfo.phone.trim() : prev.phone,
                    email: (extractedInfo.email && extractedInfo.email.trim()) ? extractedInfo.email.trim() : prev.email,
                  };
                });
              }

              return; // Exit early - PDF loaded successfully, don't load Word
            } catch (error) {
              console.error('❌ Error loading PDF file from URL:', error);
              setIsLoadingPdf(false);
              setIsCountingPages(false);
              // PDF failed - will fall through to Word fallback below
              console.log('⚠️ PDF loading failed, will try Word file fallback...');
            }
          }

          // Fallback: Handle Word URL only if:
          // 1. PDF URL is not available, AND
          // 2. PDF loading is not in progress, AND
          // 3. PDF was not successfully loaded
          if (!templateData.pdfUrl && !isLoadingPdf && !pdfLoaded && templateData.wordUrl) {
            // Fallback: Handle Word URL if PDF not available or failed to load
            console.log('📄 Loading Word file from template generation (PDF not available or failed)...');
            console.log('  - Word URL:', templateData.wordUrl);
            setIsCountingPages(true);
            setPdfLoaded(false);

            try {
              // Fetch Word file from URL
              const response = await fetch(templateData.wordUrl);
              if (!response.ok) {
                throw new Error(`Failed to fetch Word file from URL: ${response.status}`);
              }

              const blob = await response.blob();
              console.log('✅ Word blob fetched:', blob.size, 'bytes');

              // Convert blob to File object
              const fileName = `${templateData.templateName?.replace(/[^\w\-\s\.]/g, '').trim().replace(/\s+/g, '-') || 'document'}.docx`;
              const file = new File([blob], fileName, {
                type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
              });

              // Add file to selectedFiles
              setSelectedFiles([file]);

              // Create preview URL
              const previewUrl = URL.createObjectURL(blob);
              setPdfUrls([previewUrl]);
              setFileURLs([templateData.wordUrl]);

              // Count pages for Word file
              const pageCount = await countPagesInFile(file);
              setFilePageCounts([pageCount]);
              setPageCount(pageCount);

              setPdfLoaded(true);
              setIsCountingPages(false);

              console.log('✅ Word file loaded from URL and added to upload');
              console.log('  - File name:', fileName);
              console.log('  - Page count:', pageCount);
            } catch (error) {
              console.error('❌ Error loading Word file from URL:', error);
              setIsCountingPages(false);
            }
          }

          // Note: PDF handling is done above with priority
          // If we reach here without pdfLoaded being true, it means:
          // 1. PDF URL was not provided, OR
          // 2. PDF loading failed (and we're now trying Word fallback)

          // Set customer info from the form data
          // IMPORTANT: If user is authenticated, authenticated user info takes priority
          if (templateData.customerData) {
            const extractedInfo = extractCustomerInfo(templateData.customerData);
            console.log('📋 Extracted customer info from template:', extractedInfo);
            setCustomerInfo(prev => {
              // If user is authenticated, never overwrite authenticated user info with template data
              if (isAuthenticated && user) {
                return {
                  // Always preserve authenticated user info
                  name: user.name || prev.name,
                  email: user.email || prev.email,
                  // Only use template phone if user doesn't have one and template has it
                  phone: prev.phone || ((extractedInfo.phone && extractedInfo.phone.trim()) ? extractedInfo.phone.trim() : ''),
                };
              }
              // If not authenticated, only update fields that have non-empty values
              return {
                name: (extractedInfo.name && extractedInfo.name.trim()) ? extractedInfo.name.trim() : prev.name,
                email: (extractedInfo.email && extractedInfo.email.trim()) ? extractedInfo.email.trim() : prev.email,
                phone: (extractedInfo.phone && extractedInfo.phone.trim()) ? extractedInfo.phone.trim() : prev.phone
              };
            });
          }

          // Clear the pending template document from session storage
          sessionStorage.removeItem('pendingTemplateDocument');

          console.log('✅ Pending template document loaded successfully');
        } catch (error) {
          console.error('Error loading pending template document:', error);
          sessionStorage.removeItem('pendingTemplateDocument');
        }
      };

      loadTemplateDocument();
    }
  }, []);

  // Fetch pickup locations
  useEffect(() => {
    const fetchPickupLocations = async () => {
      try {
        const response = await fetch('/api/pickup-locations');
        const data = await response.json();

        if (data.success) {
          setPickupLocations(data.locations || []);
          setDefaultPickupLocation(data.defaultLocation);

          // Set default pickup location as selected
          if (data.defaultLocation) {
            setSelectedPickupLocation(data.defaultLocation);
            setDeliveryOption(prev => ({
              ...prev,
              pickupLocationId: data.defaultLocation._id
            }));
          }
        }
      } catch (error) {
        console.error('Error fetching pickup locations:', error);
      }
    };

    fetchPickupLocations();
  }, []);

  // Calculate amount based on printing options and delivery
  useEffect(() => {
    const calculateAmount = async () => {
      console.log('🔄 Pricing calculation triggered:', { pageCount, copies: printingOptions.copies || 1 });
      // Always run pricing calculation to show base prices, even with default values
      if ((printingOptions.copies || 1) > 0) {
        try {
          setPricingLoading(true);
          // Fetch pricing from API
          console.log('🔍 Fetching pricing from API...');
          const response = await fetch('/api/pricing');
          const data = await response.json();

          console.log('📊 Pricing API response:', data);

          if (data.success) {
            const pricing = data.pricing;
            setPricingData(pricing); // Store pricing data for UI display
            setPricingLoading(false);

            // Calculate pricing per file
            let total = 0;
            const minServiceFeePageLimit = pricing.additionalServices.minServiceFeePageLimit || 1;
            const colorMultiplier = pricing.multipliers.color;

            // Calculate cost for each file
            for (let i = 0; i < selectedFiles.length; i++) {
              const filePageCount = filePageCounts[i] || 1;

              // Get per-file printing options
              const fileOpts = getFilePrintingOptions(i, printingOptions);
              const fileBasePrice = pricing.basePrices[fileOpts.pageSize];
              const fileSidedMultiplier = fileOpts.sided === 'double' ? pricing.multipliers.doubleSided : 1;

              // Get page colors for this file
              const filePageColors = getFilePageColors(i, printingOptions.pageColors);
              // Use file-specific pageColors if available in fileOpts, otherwise use global
              const effectivePageColors = fileOpts.pageColors || filePageColors;
              const fileColorPages = effectivePageColors.colorPages.length;
              const fileBwPages = effectivePageColors.bwPages.length;

              // Calculate base cost for this file using helper function
              const fileBaseCost = calculateFileCost(
                filePageCount,
                fileColorPages,
                fileBwPages,
                fileBasePrice,
                colorMultiplier,
                fileSidedMultiplier,
                fileOpts.copies,
                fileOpts.color
              );
              total += fileBaseCost;

              // Add service option cost for this file if it exceeds limit
              if (filePageCount > minServiceFeePageLimit) {
                const fileServiceOption = printingOptions.serviceOptions?.[i] || printingOptions.serviceOption || 'service';
                if (fileServiceOption === 'binding') {
                  total += pricing.additionalServices.binding;
                } else if (fileServiceOption === 'file') {
                  total += 10; // Plastic file fee
                } else if (fileServiceOption === 'service') {
                  total += pricing.additionalServices.minServiceFee;
                }
              }
            }

            // Add delivery charge if applicable (includes tier-based speed pricing)
            if (deliveryOption.type === 'delivery' && deliveryOption.deliveryCharge) {
              total += deliveryOption.deliveryCharge;
            }

            console.log(`💰 Frontend pricing calculation:`, {
              pageCount,
              color: printingOptions.color,
              sided: printingOptions.sided,
              copies: printingOptions.copies,
              serviceOptions: printingOptions.serviceOptions,
              total,
              perFileBreakdown: selectedFiles.map((_, i) => {
                const filePageCount = filePageCounts[i] || 1;
                const fileOpts = getFilePrintingOptions(i, printingOptions);
                const filePageColors = getFilePageColors(i, printingOptions.pageColors);
                const effectivePageColors = fileOpts.pageColors || filePageColors;
                const fileColorPages = effectivePageColors.colorPages.length;
                const fileBwPages = effectivePageColors.bwPages.length;
                const fileBasePrice = pricing.basePrices[fileOpts.pageSize];
                const fileSidedMultiplier = fileOpts.sided === 'double' ? pricing.multipliers.doubleSided : 1;
                const fileCost = calculateFileCost(
                  filePageCount,
                  fileColorPages,
                  fileBwPages,
                  fileBasePrice,
                  colorMultiplier,
                  fileSidedMultiplier,
                  fileOpts.copies,
                  fileOpts.color
                );
                return {
                  fileIndex: i + 1,
                  filePageCount,
                  filePageSize: fileOpts.pageSize,
                  fileColor: fileOpts.color,
                  fileSided: fileOpts.sided,
                  fileCopies: fileOpts.copies,
                  fileColorPages,
                  fileBwPages,
                  fileCost
                };
              })
            });

            setAmount(total);
          } else {
            console.error('❌ Pricing API failed:', data.error);
            console.log('🔄 Using fallback pricing...');
            setPricingLoading(false);
            // Fallback to hardcoded pricing if API fails
            const basePrice = printingOptions.pageSize === 'A3' ? 10 : 5;
            console.log(`💰 Fallback base price for ${printingOptions.pageSize}: ₹${basePrice}`);

            // Calculate pricing per file (fallback)
            let total = 0;
            const colorMultiplier = 2; // Default fallback color multiplier

            // Calculate cost for each file
            for (let i = 0; i < selectedFiles.length; i++) {
              const filePageCount = filePageCounts[i] || 1;

              // Get per-file printing options
              const fileOpts = getFilePrintingOptions(i, printingOptions);
              const fileBasePrice = fileOpts.pageSize === 'A3' ? 10 : 5;
              const fileSidedMultiplier = fileOpts.sided === 'double' ? 1.5 : 1;

              // Get page colors for this file
              const filePageColors = getFilePageColors(i, printingOptions.pageColors);
              const effectivePageColors = fileOpts.pageColors || filePageColors;
              const fileColorPages = effectivePageColors.colorPages.length;
              const fileBwPages = effectivePageColors.bwPages.length;

              // Calculate base cost for this file using helper function
              const fileBaseCost = calculateFileCost(
                filePageCount,
                fileColorPages,
                fileBwPages,
                fileBasePrice,
                colorMultiplier,
                fileSidedMultiplier,
                fileOpts.copies,
                fileOpts.color
              );
              total += fileBaseCost;

              // Add service option cost for this file if it exceeds limit
              if (filePageCount > 1) {
                const fileServiceOption = printingOptions.serviceOptions?.[i] || printingOptions.serviceOption || 'service';
                if (fileServiceOption === 'binding') {
                  total += 20; // Default binding cost
                } else if (fileServiceOption === 'file') {
                  total += 10;
                } else if (fileServiceOption === 'service') {
                  total += 5; // Default minimal service fee
                }
              }
            }

            if (deliveryOption.type === 'delivery' && deliveryOption.deliveryCharge) {
              total += deliveryOption.deliveryCharge;
            }

            console.log(`💰 Frontend fallback pricing calculation:`, {
              pageCount,
              basePrice,
              color: printingOptions.color,
              sided: printingOptions.sided,
              copies: printingOptions.copies,
              serviceOptions: printingOptions.serviceOptions,
              total
            });

            setAmount(total);
          }
        } catch (error) {
          console.error('❌ Error fetching pricing:', error);
          console.log('🔄 Using fallback pricing due to error...');
          // Fallback to hardcoded pricing
          const basePrice = printingOptions.pageSize === 'A3' ? 10 : 5;
          console.log(`💰 Fallback base price for ${printingOptions.pageSize}: ₹${basePrice}`);

          // Calculate pricing per file (error fallback)
          let total = 0;
          const colorMultiplier = 2; // Default fallback color multiplier

          // Calculate cost for each file
          for (let i = 0; i < selectedFiles.length; i++) {
            const filePageCount = filePageCounts[i] || 1;

            // Get per-file printing options
            const fileOpts = getFilePrintingOptions(i, printingOptions);
            const fileBasePrice = fileOpts.pageSize === 'A3' ? 10 : 5;
            const fileSidedMultiplier = fileOpts.sided === 'double' ? 1.5 : 1;

            // Get page colors for this file
            const filePageColors = getFilePageColors(i, printingOptions.pageColors);
            const effectivePageColors = fileOpts.pageColors || filePageColors;
            const fileColorPages = effectivePageColors.colorPages.length;
            const fileBwPages = effectivePageColors.bwPages.length;

            // Calculate base cost for this file using helper function
            const fileBaseCost = calculateFileCost(
              filePageCount,
              fileColorPages,
              fileBwPages,
              fileBasePrice,
              colorMultiplier,
              fileSidedMultiplier,
              fileOpts.copies,
              fileOpts.color
            );
            total += fileBaseCost;

            // Add service option cost for this file if it exceeds limit
            if (filePageCount > 1) {
              const fileServiceOption = printingOptions.serviceOptions?.[i] || printingOptions.serviceOption || 'service';
              if (fileServiceOption === 'binding') {
                total += 20; // Default binding cost
              } else if (fileServiceOption === 'file') {
                total += 10;
              } else if (fileServiceOption === 'service') {
                total += 5; // Default minimal service fee
              }
            }
          }

          if (deliveryOption.type === 'delivery' && deliveryOption.deliveryCharge) {
            total += deliveryOption.deliveryCharge;
          }

          console.log(`💰 Frontend error fallback pricing calculation:`, {
            pageCount,
            basePrice,
            color: printingOptions.color,
            sided: printingOptions.sided,
            copies: printingOptions.copies,
            serviceOptions: printingOptions.serviceOptions,
            total
          });

          setAmount(total);
        }
      } else {
        // Reset amount if copies is invalid
        console.log('🔄 Resetting amount - copies is 0 or invalid');
        setAmount(0);
      }
    };

    calculateAmount();
  }, [pageCount, printingOptions, deliveryOption, selectedFiles, filePageCounts]);


  // Save phone number immediately (bypassing debounce)
  const handleSavePhoneNumber = async () => {
    // Validate phone number before saving
    if (!isAuthenticated || !customerInfo.phone) {
      setPhoneSaveStatus('error');
      setTimeout(() => setPhoneSaveStatus('idle'), 3000);
      return;
    }

    // Strip non-digit characters for validation
    const digitsOnly = customerInfo.phone.replace(/\D/g, '');

    // Only save if phone number has at least 10 digits
    if (digitsOnly.length < 10) {
      alert('Please enter a valid phone number (minimum 10 digits)');
      setPhoneSaveStatus('error');
      setTimeout(() => setPhoneSaveStatus('idle'), 3000);
      return;
    }

    setIsSavingPhone(true);
    setPhoneSaveStatus('idle');

    try {
      const response = await fetch('/api/user/update-phone', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ phone: customerInfo.phone }),
      });

      const data = await response.json();
      if (data.success) {
        console.log('✅ Phone number saved to profile');
        setPhoneSaveStatus('success');
        // Clear success status after 3 seconds
        setTimeout(() => setPhoneSaveStatus('idle'), 3000);
      } else {
        throw new Error(data.error || 'Failed to save phone number');
      }
    } catch (error) {
      console.error('Error saving phone number:', error);
      setPhoneSaveStatus('error');
      alert('Failed to save phone number. Please try again.');
      // Clear error status after 3 seconds
      setTimeout(() => setPhoneSaveStatus('idle'), 3000);
    } finally {
      setIsSavingPhone(false);
    }
  };

  // Validation helper function for required fields
  const validateRequiredFields = (): { isValid: boolean; missingFields: string[] } => {
    const missingFields: string[] = [];

    // Check expected date
    if (!expectedDate) {
      missingFields.push('expectedDate');
      toast.error('Please select an expected delivery date');
    }

    // Check location info based on delivery type
    if (deliveryOption.type === 'pickup') {
      if (!selectedPickupLocation) {
        missingFields.push('pickupLocation');
        toast.error('Please select a pickup location');
      }
    } else if (deliveryOption.type === 'delivery') {
      if (!deliveryOption.recipientName) {
        missingFields.push('recipientName');
        toast.error('Please fill in the recipient name');
      }
      if (!deliveryOption.recipientPhone) {
        missingFields.push('recipientPhone');
        toast.error('Please fill in the recipient phone number');
      }
      if (!deliveryOption.flatBuilding) {
        missingFields.push('flatBuilding');
        toast.error('Please fill in flat/house/building details');
      }
      if (!deliveryOption.address) {
        missingFields.push('deliveryAddress');
        toast.error('Please fill in the delivery address');
      }
      if (!deliveryOption.pinCode || deliveryOption.pinCode.length !== 6) {
        missingFields.push('deliveryPinCode');
        toast.error('Please enter a valid 6-digit PIN code');
      }
      if (!deliveryOption.city) {
        missingFields.push('deliveryCity');
        toast.error('Please fill in the delivery city');
      }
      if (!deliveryOption.state) {
        missingFields.push('deliveryState');
        toast.error('Please fill in the delivery state');
      }
    }

    return {
      isValid: missingFields.length === 0,
      missingFields
    };
  };

  // Add current file(s) to cart
  const handleAddToCart = async () => {
    if (selectedFiles.length === 0) {
      toast.error('Please upload a file first');
      return;
    }

    setIsAddingToCart(true);
    try {
      for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i];
        const fileOpts = getFilePrintingOptions(i, printingOptions);
        const fileDataUrl = await fileToDataUrl(file);

        const cartItem: CartItem = {
          id: generateCartId(),
          fileName: file.name,
          fileSize: file.size,
          pageCount: filePageCounts[i] || 1,
          printingOptions: {
            pageSize: fileOpts.pageSize,
            color: fileOpts.color,
            sided: fileOpts.sided,
            copies: fileOpts.copies,
            serviceOption: printingOptions.serviceOptions?.[i] || printingOptions.serviceOption || 'service',
            pageColors: fileOpts.pageColors,
          },
          fileDataUrl,
          fileType: file.type,
          addedAt: Date.now(),
        };

        addToCart(cartItem);
      }

      setCartItems(getCart());
      toast.success(`${selectedFiles.length} file${selectedFiles.length > 1 ? 's' : ''} added to cart!`);

      // Reset form for next item
      setSelectedFiles([]);
      setFilePageCounts([]);
      setPdfUrls([]);
      setPdfLoaded(false);
      setPrintingOptions({
        pageSize: 'A4',
        color: 'bw',
        sided: 'single',
        copies: 1,
        serviceOption: 'service',
        serviceOptions: [],
        pageColors: [],
      });
      setPageCount(1);
    } catch (err) {
      console.error('Failed to add to cart:', err);
      toast.error('Failed to add to cart. File may be too large.');
    } finally {
      setIsAddingToCart(false);
    }
  };

  // Remove item from cart
  const handleRemoveFromCart = (id: string) => {
    const updated = removeFromCart(id);
    setCartItems(updated);
    toast.success('Item removed from cart');
  };

  // Clear the cart
  const handleClearCart = () => {
    clearCart();
    setCartItems([]);
    toast.success('Cart cleared');
  };

  // Payment function
  const handlePayment = async () => {
    // Check if user is authenticated
    if (!isAuthenticated) {
      setAuthMode('signin');
      setShowAuthModal(true);
      return;
    }

    // Check if Razorpay is loaded
    if (!isRazorpayLoaded) {
      alert('Payment gateway is still loading. Please wait a moment and try again.');
      return;
    }

    if (razorpayError) {
      alert(`Payment gateway error: ${razorpayError}`);
      return;
    }

    // Validate required fields (expected date and location info)
    const fieldValidation = validateRequiredFields();
    if (!fieldValidation.isValid) {
      return;
    }

    // Validate service options for each file exceeding minimum service fee page limit
    const minServiceFeePageLimit = pricingData?.additionalServices?.minServiceFeePageLimit || 1;
    for (let i = 0; i < selectedFiles.length; i++) {
      const filePageCount = filePageCounts[i] || 1;
      if (filePageCount > minServiceFeePageLimit) {
        const fileServiceOption = printingOptions.serviceOptions?.[i];
        if (!fileServiceOption) {
          alert(`Please select a service option for File ${i + 1} (${selectedFiles[i].name}) which has more than ${minServiceFeePageLimit} page(s)`);
          return;
        }
      }
    }

    // Validate mixed color page selection (per-file)
    if (printingOptions.color === 'mixed') {
      if (!printingOptions.pageColors) {
        alert('Please select which pages should be printed in color for each file');
        return;
      }

      // Validate per-file page colors
      const pageColorsArray = Array.isArray(printingOptions.pageColors) ? printingOptions.pageColors : (printingOptions.pageColors ? [printingOptions.pageColors] : []);
      for (let i = 0; i < selectedFiles.length; i++) {
        // Skip validation if this specific file is not set to mixed mode
        // Note: printingOptions.fileOptions might not be fully populated if coming from older state, 
        // but loadCartForCheckout populates it correctly.
        const fileSpecificOption = printingOptions.fileOptions?.[i];
        if (fileSpecificOption && fileSpecificOption.color !== 'mixed') {
          continue;
        }

        const filePageCount = filePageCounts[i] || 1;
        const filePageColors = pageColorsArray[i] || { colorPages: [], bwPages: [] };
        const totalSpecifiedPages = filePageColors.colorPages.length + filePageColors.bwPages.length;

        if (filePageCount > 1 && totalSpecifiedPages === 0) {
          alert(`Please select which pages should be printed in color for File ${i + 1}`);
          return;
        }

        // Check for duplicate pages in this file
        const allPages = [...filePageColors.colorPages, ...filePageColors.bwPages];
        const uniquePages = [...new Set(allPages)];
        if (allPages.length !== uniquePages.length) {
          alert(`Pages cannot be specified as both color and B&W for File ${i + 1}. Please check your selection.`);
          return;
        }
      }
    }

    // Validate phone number
    if (!customerInfo.phone || customerInfo.phone.length < 10) {
      alert('Please enter a valid phone number (minimum 10 digits)');
      return;
    }

    setIsProcessingPayment(true);
    try {

      // First, upload files if it's a file order
      const fileURLs: string[] = [];
      const originalFileNames: string[] = [];
      const fileTypes: string[] = [];
      if (selectedFiles.length > 0 && orderType === 'file') {
        try {
          // Initialize upload progress
          setUploadProgress({
            uploading: true,
            currentFile: 0,
            totalFiles: selectedFiles.length,
            fileName: '',
            progress: 0,
            startTime: Date.now(),
            estimatedTimeRemaining: null,
            isSlowNetwork: false,
          });

          // Upload all files with progress tracking
          for (let i = 0; i < selectedFiles.length; i++) {
            const file = selectedFiles[i];
            const fileStartTime = Date.now();

            setUploadProgress(prev => ({
              ...prev,
              currentFile: i + 1,
              fileName: file.name,
              progress: 0,
              startTime: fileStartTime,
              estimatedTimeRemaining: null,
            }));

            const uploadFormData = new FormData();
            uploadFormData.append('file', file);

            // Track upload time for slow network detection
            const uploadTimeout = setTimeout(() => {
              setUploadProgress(prev => ({
                ...prev,
                isSlowNetwork: true,
              }));
            }, 30000); // Warn if upload takes > 30 seconds

            const uploadResponse = await fetch('/api/upload-file', {
              method: 'POST',
              body: uploadFormData,
            });

            clearTimeout(uploadTimeout);

            const uploadDuration = Date.now() - fileStartTime;
            const fileSizeMB = file.size / (1024 * 1024);
            const uploadSpeedMBps = fileSizeMB / (uploadDuration / 1000);

            // Detect slow network (< 1 MB/s is considered slow)
            const isSlowNetwork = uploadSpeedMBps < 1 && fileSizeMB > 1;

            setUploadProgress(prev => ({
              ...prev,
              progress: 100,
              isSlowNetwork: prev.isSlowNetwork || isSlowNetwork,
            }));

            // Check if response is ok before trying to parse JSON
            if (!uploadResponse.ok) {
              let errorMessage = 'Upload failed';
              try {
                const errorData = await uploadResponse.json();
                errorMessage = errorData.error || errorMessage;
              } catch (parseError) {
                // If we can't parse JSON, it might be an HTML error page from Vercel
                if (uploadResponse.status === 413) {
                  errorMessage = 'File size too large. Please try a smaller file.';
                } else if (uploadResponse.status >= 500) {
                  errorMessage = 'Server error. Please try again later.';
                } else {
                  errorMessage = `Upload failed with status ${uploadResponse.status}`;
                }
              }
              throw new Error(errorMessage);
            }

            const uploadData = await uploadResponse.json();

            if (uploadData.success) {
              fileURLs.push(uploadData.fileURL);
              originalFileNames.push(uploadData.originalFileName);
              fileTypes.push(file.type); // Collect file type (MIME type)
              console.log(`✅ File uploaded successfully: ${uploadData.fileURL}, type: ${file.type} (${Math.round(uploadDuration / 1000)}s)`);

              // Update progress for next file
              setUploadProgress(prev => ({
                ...prev,
                progress: 100,
                estimatedTimeRemaining: null,
              }));
            } else {
              throw new Error(uploadData.error || 'Upload failed');
            }
          }

          // Clear upload progress
          setUploadProgress({
            uploading: false,
            currentFile: 0,
            totalFiles: 0,
            fileName: '',
            progress: 0,
            startTime: null,
            estimatedTimeRemaining: null,
            isSlowNetwork: false,
          });
        } catch (error) {
          console.error('Error uploading files:', error);
          const errorMessage = error instanceof Error ? error.message : 'Failed to upload files. Please try again.';
          alert(`Upload Error: ${errorMessage}`);
          setUploadProgress({
            uploading: false,
            currentFile: 0,
            totalFiles: 0,
            fileName: '',
            progress: 0,
            startTime: null,
            estimatedTimeRemaining: null,
            isSlowNetwork: false,
          });
          setIsProcessingPayment(false);
          return;
        }
      }

      // Prepare order data for payment initiation
      const orderData = {
        customerInfo,
        orderType,
        fileURLs: orderType === 'file' && fileURLs.length > 0 ? fileURLs : undefined,
        fileURL: orderType === 'file' && fileURLs.length > 0 ? fileURLs[0] : undefined, // Legacy support
        originalFileNames: orderType === 'file' && originalFileNames.length > 0 ? originalFileNames : undefined,
        originalFileName: orderType === 'file' && originalFileNames.length > 0 ? originalFileNames[0] : undefined, // Legacy support
        fileTypes: orderType === 'file' && fileTypes.length > 0 ? fileTypes : undefined, // File types array
        filePageCounts: orderType === 'file' && filePageCounts.length > 0 ? filePageCounts : undefined, // Per-file page counts
        templateData: orderType === 'template' ? {
          templateType: 'custom',
          formData: {
            name: customerInfo.name,
            email: customerInfo.email,
            phone: customerInfo.phone,
          }
        } : undefined,
        printingOptions: {
          ...printingOptions,
          pageCount,
          serviceOptions: printingOptions.serviceOptions, // Include per-file service options
          serviceOption: printingOptions.serviceOption, // Legacy support
          pageColors: printingOptions.pageColors, // Include per-file page colors
          fileOptions: printingOptions.fileOptions, // Include per-file printing options
        },
        deliveryOption,
        expectedDate,
      };

      console.log('🔍 Initiating payment with order data:', orderData);

      // Initiate payment (this will NOT create order in database yet)
      const response = await fetch('/api/payment/initiate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(orderData),
      });

      const data = await response.json();

      if (data.success) {
        // Show order ID immediately
        if (data.orderId) {
          alert(`Order #${data.orderId} created! Please complete payment to confirm your order.`);
        }

        // Initialize Razorpay payment
        const options = {
          key: data.key,
          amount: data.amount * 100, // Razorpay expects amount in paise
          currency: 'INR',
          name: 'College Print Service',
          description: `Print Order Payment - Order #${data.orderId || 'N/A'}`,
          order_id: data.razorpayOrderId,
          // Configure payment methods - enable all available methods as fallback
          // This ensures users can use cards, UPI, netbanking, wallets if GPay doesn't work
          method: {
            upi: true,
            card: true,
            netbanking: true,
            wallet: true,
            emi: false,
            paylater: false,
          },
          handler: async function (response: any) {
            try {
              console.log('💳 Payment response received:', response);

              // Set verification status
              setPaymentVerificationStatus({
                verifying: true,
                orderId: data.orderId,
                razorpayOrderId: data.razorpayOrderId,
                startTime: Date.now(),
                polling: false,
              });

              // Start polling for payment status as fallback
              const stopPolling = startPaymentStatusPolling(
                data.razorpayOrderId,
                data.orderId,
                (pollData) => {
                  // Payment completed via polling
                  console.log('✅ Payment verified via polling:', pollData);
                  setIsProcessingPayment(false); // Reset processing state
                  setPaymentVerificationStatus({
                    verifying: false,
                    orderId: null,
                    razorpayOrderId: null,
                    startTime: null,
                    polling: false,
                  });
                  alert(`Payment successful! Your order #${data.orderId} has been placed.`);
                  window.location.href = '/my-orders';
                },
                (error) => {
                  // Payment failed
                  console.error('❌ Payment failed via polling:', error);
                  setIsProcessingPayment(false); // Reset processing state
                  setPaymentVerificationStatus({
                    verifying: false,
                    orderId: null,
                    razorpayOrderId: null,
                    startTime: null,
                    polling: false,
                  });
                  alert(`Payment failed: ${error}`);
                },
                () => {
                  // Polling timeout - keep verification status active for manual check
                  console.log('⏱️ Payment status polling timeout');
                  setIsProcessingPayment(false); // Reset processing state
                  setPaymentVerificationStatus(prev => ({
                    ...prev,
                    polling: true, // Mark as polling timeout, show manual check button
                  }));
                }
              );

              // Use the new payment success handler with iPhone Safari recovery
              const result = await handlePaymentSuccess(response, data.orderId);

              // Stop polling if verification succeeds
              stopPolling();

              if (result.success) {
                console.log('✅ Payment verified successfully:', result.data);
                setIsProcessingPayment(false); // Reset processing state
                setPaymentVerificationStatus({
                  verifying: false,
                  orderId: null,
                  razorpayOrderId: null,
                  startTime: null,
                  polling: false,
                });
                alert(`🎉 Payment successful! Your order #${result.data.order.orderId} has been placed.`);
                // Redirect to my orders page
                window.location.href = '/my-orders';
              } else {
                console.error('❌ Payment verification failed:', result.error);
                setIsProcessingPayment(false); // Reset processing state (but keep polling active)
                // Keep verification status active for polling/manual check
                setPaymentVerificationStatus(prev => ({
                  ...prev,
                  polling: true, // Allow manual check
                }));
                alert(`Payment verification is taking longer than expected. Please wait or check your order status.`);
              }
            } catch (error) {
              console.error('❌ Error in payment handler:', error);
              setIsProcessingPayment(false); // Reset processing state on error
              const failureResult = handlePaymentFailure(error, data.orderId);
              setPaymentVerificationStatus(prev => ({
                ...prev,
                polling: true, // Allow manual check on error
              }));
              alert(`Payment verification encountered an issue. Please check your order status.`);
            }
          },
          modal: {
            ondismiss: function () {
              console.log('Payment modal dismissed');
              // Clean up temporary order data
              if (data.razorpayOrderId) {
                fetch('/api/payment/cleanup', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    razorpay_order_id: data.razorpayOrderId,
                  }),
                }).catch(cleanupError => {
                  console.error('Error cleaning up payment data:', cleanupError);
                });
              }
              setIsProcessingPayment(false);
            }
          },
          callback_url: window.location.origin + '/payment-callback',
          prefill: {
            name: customerInfo.name,
            email: customerInfo.email,
            contact: customerInfo.phone,
          },
          // Ensure proper mobile handling
          readonly: {
            email: true,
            contact: true,
          },
          // Mobile-specific options for better iPhone Safari compatibility
          notes: {
            order_id: data.orderId,
            customer_email: customerInfo.email,
          },
          // Add retry mechanism for mobile
          retry: {
            enabled: true,
            max_count: 3,
          },
          // Configure to show payment method selection first instead of auto-opening GPay
          // This prevents getting stuck when GPay app is not installed or deep link fails
          // Note: Razorpay will show payment method selection when all methods are enabled
          // The method configuration above ensures all options are available
          config: {
            display: {
              blocks: {
                banks: {
                  name: "All payment methods"
                }
              }
            }
          },
          theme: {
            color: '#000000',
          },
        };

        try {
          const razorpay = openRazorpay(options);

          // Add error handlers for Razorpay modal
          razorpay.on('payment.failed', function (response: any) {
            console.error('❌ Payment failed:', response);
            setIsProcessingPayment(false);
            setPaymentVerificationStatus({
              verifying: false,
              orderId: null,
              razorpayOrderId: null,
              startTime: null,
              polling: false,
            });
            alert(`Payment failed: ${response.error?.description || response.error?.reason || 'Payment could not be processed. Please try again.'}`);
          });

          razorpay.on('payment.error', function (error: any) {
            console.error('❌ Payment error:', error);
            setIsProcessingPayment(false);
            setPaymentVerificationStatus({
              verifying: false,
              orderId: null,
              razorpayOrderId: null,
              startTime: null,
              polling: false,
            });
            alert(`Payment error: ${error.error?.description || error.error?.reason || 'An error occurred during payment. Please try again.'}`);
          });

          // Add timeout detection for stuck modals (30 seconds)
          const MODAL_TIMEOUT = 30000; // 30 seconds
          const modalTimeout = setTimeout(() => {
            console.warn('⚠️ Razorpay modal timeout - modal may be stuck at processing screen');
            // Don't auto-close, but log for debugging
            // User can still manually close the modal
          }, MODAL_TIMEOUT);

          // Track if user went to external app (GPay, etc.)
          let appRedirectDetected = false;
          const handleVisibilityChange = () => {
            if (document.hidden) {
              // Page became hidden - user might have switched to GPay app
              appRedirectDetected = true;
              console.log('📱 Page hidden - possible app redirect to GPay');
            } else {
              // Page became visible again - user returned from app
              if (appRedirectDetected) {
                console.log('🔄 User returned from app - checking payment status');
                appRedirectDetected = false;
                // Don't reset processing state here - let Razorpay handle it
                // The payment handler or failed handler will be called if needed
              }
            }
          };

          // Add visibility change listener for app redirect detection
          document.addEventListener('visibilitychange', handleVisibilityChange);

          razorpay.on('modal.close', function () {
            console.log('🔄 Razorpay modal closed');
            // Clean up visibility listener
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            if (modalTimeout) {
              clearTimeout(modalTimeout);
            }
          });

          // Handle payment authorization (when user completes payment in app)
          razorpay.on('payment.authorized', function (response: any) {
            console.log('✅ Payment authorized:', response);
            // This will be handled by the main handler function
          });

          // Handle external wallet selection (GPay, PhonePe, etc.)
          razorpay.on('external.wallet.selected', function (response: any) {
            console.log('📱 External wallet selected:', response);
            // Log when user selects GPay or other external wallet
          });

          razorpay.open();
          console.log('✅ Razorpay payment UI opened');

          // Clear modal timeout if payment UI loads successfully (handler fires)
          // The timeout will be cleared when handler fires or modal closes

          // Add timeout to detect stuck payments (extended for slow networks)
          // Default: 10 minutes, can be up to 15 minutes for very slow connections
          const timeoutDuration = 600000; // 10 minutes (600 seconds)
          setTimeout(() => {
            if (isProcessingPayment) {
              console.log('⚠️ Payment timeout detected - resetting processing state');
              setIsProcessingPayment(false);
              // Show notification but don't alert (less intrusive)
              console.log('Payment is taking longer than expected. The payment may still be processing. Please check your order status in a few minutes.');
            }
          }, timeoutDuration);
        } catch (razorpayError) {
          console.error('❌ Error opening Razorpay:', razorpayError);
          setIsProcessingPayment(false);
          setPaymentVerificationStatus({
            verifying: false,
            orderId: null,
            razorpayOrderId: null,
            startTime: null,
            polling: false,
          });

          let errorMessage = 'Failed to open payment gateway. Please try again.';
          if (razorpayError instanceof Error) {
            if (razorpayError.message.includes('not loaded')) {
              errorMessage = 'Payment gateway is still loading. Please wait a moment and try again.';
            } else if (razorpayError.message.includes('not available')) {
              errorMessage = 'Payment gateway is not available. Please refresh the page and try again.';
            }
          }

          alert(errorMessage);
        }
      } else {
        alert(`Failed to create order: ${data.error}`);
      }
    } catch (error) {
      console.error('Error processing payment:', error);
      alert('Failed to process payment. Please try again.');
    } finally {
      setIsProcessingPayment(false);
    }
  };

  return (
    <>
      <div className="min-h-screen bg-gray-100 py-12">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-4">Place Your Print Order</h1>
            <p className="text-lg text-gray-600">
              Upload your documents or choose from our templates and get them printed
            </p>
          </div>

          {/* Welcome Header with Trust Badges */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-2 mb-4">
              <span className="text-sm bg-green-100 text-green-800 px-3 py-1 rounded-full font-medium">✓ Secure Payment</span>
              <span className="text-sm bg-blue-100 text-blue-800 px-3 py-1 rounded-full font-medium">🚀 Fast Delivery</span>
              <span className="text-sm bg-purple-100 text-purple-800 px-3 py-1 rounded-full font-medium">⭐ 1000+ Happy Customers</span>
            </div>
          </div>

          {/* Single Page Layout - Grid with Left (Content) and Right (Sticky Summary) */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left Column - Main Content */}
            <div className="lg:col-span-2 space-y-6">
              <div className="bg-white rounded-lg shadow-xl p-8 border border-gray-200">
                {/* File Upload & Options Section */}
                <div className="space-y-8">
                  <div className="text-center mb-6">
                    <h2 className="text-2xl font-bold text-gray-900 mb-2 flex items-center justify-center gap-2">
                      <DocumentIcon size={24} className="w-6 h-6" />
                      Upload Your Files
                    </h2>
                    <p className="text-gray-600">Upload your documents and configure printing options</p>
                  </div>

                  {/* Order Type Selection */}
                  <div>
                    <h3 className="text-xl font-semibold text-gray-900 mb-4">Order Type</h3>
                    <div className="flex space-x-4">
                      <label className="flex items-center">
                        <input
                          type="radio"
                          name="orderType"
                          value="file"
                          checked={orderType === 'file'}
                          onChange={(e) => setOrderType(e.target.value as 'file' | 'template')}
                          className="mr-2"
                        />
                        Upload File
                      </label>
                      <label className="flex items-center">
                        <input
                          type="radio"
                          name="orderType"
                          value="template"
                          checked={orderType === 'template'}
                          onChange={() => {
                            // Redirect to templates page with notification
                            alert('📝 To use templates: 1) Go to Templates page, 2) Fill the form with your information, 3) Download the document, 4) Convert to PDF, 5) Come back here to order it!');
                            window.location.href = '/templates';
                          }}
                          className="mr-2"
                        />
                        Use Template
                      </label>
                    </div>
                  </div>

                  {/* File Upload */}
                  {orderType === 'file' && (
                    <div>
                      <h3 className="text-xl font-semibold text-gray-900 mb-4">Upload Files</h3>
                      <div className="form-file-upload">
                        <input
                          ref={fileInputRef}
                          type="file"
                          multiple
                          accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.gif,.bmp,.tiff,.webp,.svg"
                          onChange={async (e) => {
                            const validFiles = Array.from(e.target.files || []);
                            
                            if (validFiles.length > 0) {
                              setIsCountingPages(true);
                              setPdfLoaded(false);

                              // Add new files to the existing list
                              setSelectedFiles(prev => [...prev, ...validFiles]);

                              // Create preview URLs for all files
                              const newUrls = validFiles.map(file => URL.createObjectURL(file));
                              setPdfUrls(prev => [...prev, ...newUrls]);

                              // Count pages for each new file
                              const newPageCounts: number[] = [];
                              let hasErrors = false;
                              for (const file of validFiles) {
                                try {
                                  const pageCount = await countPagesInFile(file);
                                  newPageCounts.push(pageCount);
                                } catch (error) {
                                  console.error(`Failed to parse file: ${file.name}`, error);
                                  alert(`❌ We couldn't automatically read the page count for "${file.name}". Please save it as a .PDF and try again to guarantee accurate pricing.`);
                                  hasErrors = true;
                                  break;
                                }
                              }

                              if (hasErrors) {
                                // Revert UI states if parsing failed
                                setIsCountingPages(false);
                                setSelectedFiles(prev => prev.slice(0, prev.length - validFiles.length));
                                setPdfUrls(prev => prev.slice(0, prev.length - validFiles.length));
                                return;
                              }

                              // Update page counts
                              setFilePageCounts(prev => [...prev, ...newPageCounts]);

                              // Initialize service options for new files (default to 'service')
                              setPrintingOptions(prev => {
                                const currentServiceOptions = prev.serviceOptions || [];
                                const newServiceOptions = [...currentServiceOptions, ...validFiles.map(() => 'service' as const)];
                                console.log(`📋 Initializing service options: ${currentServiceOptions.length} existing + ${validFiles.length} new = ${newServiceOptions.length} total`);

                                // Initialize per-file pageColors array if mixed color is selected
                                let updatedPageColors = prev.pageColors;
                                if (prev.color === 'mixed') {
                                  const currentPageColors = Array.isArray(prev.pageColors) ? prev.pageColors : (prev.pageColors ? [prev.pageColors] : []);
                                  const newPageColors = [...currentPageColors, ...validFiles.map(() => ({ colorPages: [] as number[], bwPages: [] as number[] }))];
                                  updatedPageColors = newPageColors;
                                  console.log(`📋 Initializing per-file pageColors: ${currentPageColors.length} existing + ${validFiles.length} new = ${newPageColors.length} total`);
                                }

                                // Initialize per-file printing options
                                const currentFileOptions = prev.fileOptions || [];
                                const newFileOptions = [...currentFileOptions, ...validFiles.map(() => ({
                                  pageSize: prev.pageSize || 'A4',
                                  color: prev.color || 'bw',
                                  sided: prev.sided || 'single',
                                  copies: prev.copies || 1,
                                }))];
                                console.log(`📋 Initializing per-file printing options: ${currentFileOptions.length} existing + ${validFiles.length} new = ${newFileOptions.length} total`);

                                return {
                                  ...prev,
                                  serviceOptions: newServiceOptions,
                                  pageColors: updatedPageColors,
                                  fileOptions: newFileOptions
                                };
                              });

                              // Calculate total page count
                              const totalPages = [...filePageCounts, ...newPageCounts].reduce((sum, count) => sum + count, 0);
                              setPageCount(totalPages);

                              setIsCountingPages(false);
                              setPdfLoaded(true);
                            }
                          }}
                          className="hidden"
                        />
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="bg-black text-white px-6 py-3 rounded-lg hover:bg-gray-800 transition-colors"
                        >
                          Choose Files
                        </button>
                        {selectedFiles.length > 0 && (
                          <div className="mt-4 space-y-2">
                            <p className="text-sm font-medium text-gray-700">
                              Selected Files ({selectedFiles.length}):
                            </p>
                            <div className="space-y-1">
                              {selectedFiles.map((file, index) => (
                                <div key={index} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                                  <span className="text-sm text-gray-600 truncate flex-1">{truncateFileName(file.name)}</span>
                                  <span className="text-xs text-gray-500 ml-2">
                                    {filePageCounts[index] || 1} page{filePageCounts[index] !== 1 ? 's' : ''}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* File Preview with Service Options */}
                  {pdfUrls.length > 0 && (
                    <div>
                      <h3 className="text-xl font-semibold text-gray-900 mb-4">Document Preview</h3>
                      <div className="space-y-6">
                        {selectedFiles.map((file, index) => {
                          const filePageCount = filePageCounts[index] || 1;
                          const minServiceFeePageLimit = pricingData?.additionalServices?.minServiceFeePageLimit ?? 1;
                          // Show service option if file has more pages than the limit (default to 1, so files with 2+ pages show options)
                          const needsServiceOption = filePageCount > minServiceFeePageLimit;
                          // Ensure serviceOptions array has an entry for this file index
                          const currentServiceOptions = printingOptions.serviceOptions || [];
                          // Initialize if needed (but don't setState during render - use useEffect)
                          const currentServiceOption = currentServiceOptions[index] || 'service';

                          console.log(`📄 File ${index + 1}: ${filePageCount} pages, needsServiceOption: ${needsServiceOption}, currentOption: ${currentServiceOption}`);

                          return (
                            <div key={index} className="space-y-4 mb-6">
                              {/* File Preview */}
                              <div className={`border rounded-lg overflow-hidden ${printingOptions.color === 'bw' ? 'grayscale' : ''}`}>
                                <div className="p-2 bg-gray-100 border-b">
                                  <p className="text-sm font-medium text-gray-700">
                                    File {index + 1}: {truncateFileName(file.name)} ({filePageCount} page{filePageCount !== 1 ? 's' : ''})
                                  </p>
                                </div>
                                <div className="h-64">
                                  {/* Image files - show directly */}
                                  {file.type.startsWith('image/') && (
                                    <img
                                      src={pdfUrls[index]}
                                      alt={`Preview ${file.name}`}
                                      className="w-full h-full object-contain"
                                      onLoad={() => setPdfLoaded(true)}
                                    />
                                  )}

                                  {/* PDF files - use iframe */}
                                  {file.type === 'application/pdf' && (
                                    <iframe
                                      src={pdfUrls[index]}
                                      className="w-full h-full"
                                      onLoad={() => setPdfLoaded(true)}
                                    />
                                  )}

                                  {/* Other files - show file info */}
                                  {!file.type.startsWith('image/') &&
                                    file.type !== 'application/pdf' && (
                                      <div className="w-full h-full flex items-center justify-center bg-gray-50">
                                        <div className="text-center">
                                          <div className="flex justify-center mb-2">
                                            <DocumentIcon size={40} className="w-10 h-10" />
                                          </div>
                                          <p className="text-sm text-gray-600">
                                            {file.type}
                                          </p>
                                          <p className="text-xs text-gray-500">
                                            {(file.size / 1024).toFixed(1)} KB
                                          </p>
                                        </div>
                                      </div>
                                    )}
                                </div>
                              </div>

                              {/* Service Option for this file - Always show for files with more than 1 page */}
                              {needsServiceOption ? (
                                <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                                  <label className="block text-sm font-semibold text-gray-900 mb-3">
                                    Service Option for File {index + 1} (required)
                                  </label>
                                  <div className="bg-white p-4 rounded-lg border-2 border-blue-300 shadow-sm">
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                      <label className="flex items-center cursor-pointer p-3 rounded-lg border-2 transition-all hover:bg-blue-50 hover:border-blue-400 hover:shadow-md" style={{ borderColor: currentServiceOption === 'binding' ? '#3b82f6' : '#e5e7eb' }}>
                                        <input
                                          type="radio"
                                          name={`serviceOption-${index}`}
                                          checked={currentServiceOption === 'binding'}
                                          onChange={() => {
                                            setPrintingOptions(prev => {
                                              const currentOptions = prev.serviceOptions || [];
                                              const newServiceOptions = [...currentOptions];
                                              // Ensure array is long enough
                                              while (newServiceOptions.length <= index) {
                                                newServiceOptions.push('service');
                                              }
                                              newServiceOptions[index] = 'binding';
                                              console.log(`✅ File ${index + 1} service option set to: binding`);
                                              return { ...prev, serviceOptions: newServiceOptions };
                                            });
                                          }}
                                          className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                                        />
                                        <span className="ml-3 text-sm font-medium text-gray-700">
                                          📎 Binding (+₹{pricingData?.additionalServices?.binding || 40})
                                        </span>
                                      </label>

                                      <label className="flex items-center cursor-pointer p-3 rounded-lg border-2 transition-all hover:bg-blue-50 hover:border-blue-400 hover:shadow-md" style={{ borderColor: currentServiceOption === 'file' ? '#3b82f6' : '#e5e7eb' }}>
                                        <input
                                          type="radio"
                                          name={`serviceOption-${index}`}
                                          checked={currentServiceOption === 'file'}
                                          onChange={() => {
                                            setPrintingOptions(prev => {
                                              const currentOptions = prev.serviceOptions || [];
                                              const newServiceOptions = [...currentOptions];
                                              // Ensure array is long enough
                                              while (newServiceOptions.length <= index) {
                                                newServiceOptions.push('service');
                                              }
                                              newServiceOptions[index] = 'file';
                                              console.log(`✅ File ${index + 1} service option set to: file`);
                                              return { ...prev, serviceOptions: newServiceOptions };
                                            });
                                          }}
                                          className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                                        />
                                        <span className="ml-3 text-sm font-medium text-gray-700">
                                          <span className="flex items-center gap-1">
                                            <FolderIcon size={16} className="w-4 h-4" />
                                            Plastic file (₹10)
                                          </span>
                                        </span>
                                      </label>

                                      <label className="flex items-center cursor-pointer p-3 rounded-lg border-2 transition-all hover:bg-blue-50 hover:border-blue-400 hover:shadow-md" style={{ borderColor: currentServiceOption === 'service' ? '#3b82f6' : '#e5e7eb' }}>
                                        <input
                                          type="radio"
                                          name={`serviceOption-${index}`}
                                          checked={currentServiceOption === 'service'}
                                          onChange={() => {
                                            setPrintingOptions(prev => {
                                              const currentOptions = prev.serviceOptions || [];
                                              const newServiceOptions = [...currentOptions];
                                              // Ensure array is long enough
                                              while (newServiceOptions.length <= index) {
                                                newServiceOptions.push('service');
                                              }
                                              newServiceOptions[index] = 'service';
                                              console.log(`✅ File ${index + 1} service option set to: service`);
                                              return { ...prev, serviceOptions: newServiceOptions };
                                            });
                                          }}
                                          className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                                        />
                                        <span className="ml-3 text-sm font-medium text-gray-700 flex items-center gap-1">
                                          <CheckIcon size={16} className="w-4 h-4" />
                                          Minimal service fee (₹{pricingData?.additionalServices?.minServiceFee || 5})
                                        </span>
                                      </label>
                                    </div>
                                    <p className="text-xs text-gray-600 mt-3 font-medium">
                                      💡 Choose one: Binding, Plastic file to keep pages inside file, or minimal service fee.
                                    </p>
                                  </div>
                                </div>
                              ) : (
                                <div className="mt-2 p-2 bg-gray-50 border border-gray-200 rounded text-xs text-gray-500">
                                  Service option not required for single-page files
                                </div>
                              )}

                              {/* Per-File Printing Options - After Service Option */}
                              <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
                                <label className="block text-sm font-semibold text-gray-900 mb-3">
                                  Printing Options for File {index + 1}
                                </label>
                                {(() => {
                                  const fileOpts = getFilePrintingOptions(index, printingOptions);
                                  return (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                      {/* Page Size */}
                                      <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">
                                          Page Size
                                        </label>
                                        <select
                                          value={fileOpts.pageSize}
                                          onChange={(e) => {
                                            setPrintingOptions(prev => {
                                              const currentFileOptions = prev.fileOptions || [];
                                              const newFileOptions = [...currentFileOptions];
                                              while (newFileOptions.length <= index) {
                                                newFileOptions.push({
                                                  pageSize: prev.pageSize || 'A4',
                                                  color: prev.color || 'bw',
                                                  sided: prev.sided || 'single',
                                                  copies: prev.copies || 1,
                                                });
                                              }
                                              newFileOptions[index] = {
                                                ...newFileOptions[index],
                                                pageSize: e.target.value as 'A4' | 'A3'
                                              };
                                              return { ...prev, fileOptions: newFileOptions };
                                            });
                                          }}
                                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                                        >
                                          <option value="A4">A4</option>
                                          <option value="A3">A3</option>
                                        </select>
                                      </div>

                                      {/* Color */}
                                      <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">
                                          Color
                                        </label>
                                        <div className="grid grid-cols-3 gap-2">
                                          {/* Colorful Button */}
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setPrintingOptions(prev => {
                                                const currentFileOptions = prev.fileOptions || [];
                                                const newFileOptions = [...currentFileOptions];
                                                while (newFileOptions.length <= index) {
                                                  newFileOptions.push({
                                                    pageSize: prev.pageSize || 'A4',
                                                    color: prev.color || 'bw',
                                                    sided: prev.sided || 'single',
                                                    copies: prev.copies || 1,
                                                  });
                                                }
                                                newFileOptions[index] = {
                                                  ...newFileOptions[index],
                                                  color: 'color',
                                                  pageColors: undefined
                                                };

                                                // Update global color: single file uses that color, multi-file uses first file's color
                                                const isSingleFile = selectedFiles.length === 1;
                                                let updatedGlobalColor = prev.color;
                                                if (isSingleFile && index === 0) {
                                                  updatedGlobalColor = 'color';
                                                } else if (!isSingleFile && index === 0) {
                                                  updatedGlobalColor = 'color'; // First file sets global color
                                                } else if (!isSingleFile) {
                                                  // Not first file: keep first file's color
                                                  const firstFileColor = newFileOptions[0]?.color || 'color';
                                                  updatedGlobalColor = firstFileColor !== 'mixed' ? firstFileColor : 'bw';
                                                }

                                                return {
                                                  ...prev,
                                                  color: updatedGlobalColor,
                                                  fileOptions: newFileOptions
                                                };
                                              });
                                            }}
                                            className={`px-3 py-2 rounded-lg text-xs font-medium transition-all ${fileOpts.color === 'color'
                                              ? 'ring-2 ring-blue-500 shadow-md'
                                              : 'hover:shadow-sm'
                                              }`}
                                            style={{
                                              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 25%, #f093fb 50%, #4facfe 75%, #00f2fe 100%)',
                                              color: 'white'
                                            }}
                                          >
                                            Color
                                          </button>

                                          {/* B&W Button */}
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setPrintingOptions(prev => {
                                                const currentFileOptions = prev.fileOptions || [];
                                                const newFileOptions = [...currentFileOptions];
                                                while (newFileOptions.length <= index) {
                                                  newFileOptions.push({
                                                    pageSize: prev.pageSize || 'A4',
                                                    color: prev.color || 'bw',
                                                    sided: prev.sided || 'single',
                                                    copies: prev.copies || 1,
                                                  });
                                                }
                                                newFileOptions[index] = {
                                                  ...newFileOptions[index],
                                                  color: 'bw',
                                                  pageColors: undefined
                                                };

                                                // Update global color: single file uses that color, multi-file uses first file's color
                                                const isSingleFile = selectedFiles.length === 1;
                                                let updatedGlobalColor = prev.color;
                                                if (isSingleFile && index === 0) {
                                                  updatedGlobalColor = 'bw';
                                                } else if (!isSingleFile && index === 0) {
                                                  updatedGlobalColor = 'bw'; // First file sets global color
                                                } else if (!isSingleFile) {
                                                  // Not first file: keep first file's color
                                                  const firstFileColor = newFileOptions[0]?.color || 'bw';
                                                  updatedGlobalColor = firstFileColor !== 'mixed' ? firstFileColor : 'bw';
                                                }

                                                return {
                                                  ...prev,
                                                  color: updatedGlobalColor,
                                                  fileOptions: newFileOptions
                                                };
                                              });
                                            }}
                                            className={`px-3 py-2 rounded-lg text-xs font-medium transition-all ${fileOpts.color === 'bw'
                                              ? 'ring-2 ring-gray-500 shadow-md'
                                              : 'hover:shadow-sm'
                                              }`}
                                            style={{
                                              background: 'linear-gradient(to right, #000000 0%, #000000 50%, #ffffff 50%, #ffffff 100%)',
                                              color: fileOpts.color === 'bw' ? 'white' : 'black',
                                              border: '1px solid #333'
                                            }}
                                          >
                                            B&W
                                          </button>

                                          {/* Mixed Button */}
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setPrintingOptions(prev => {
                                                const currentFileOptions = prev.fileOptions || [];
                                                const newFileOptions = [...currentFileOptions];
                                                while (newFileOptions.length <= index) {
                                                  newFileOptions.push({
                                                    pageSize: prev.pageSize || 'A4',
                                                    color: prev.color || 'bw',
                                                    sided: prev.sided || 'single',
                                                    copies: prev.copies || 1,
                                                  });
                                                }
                                                // Initialize pageColors for this file if not exists
                                                const filePageColors = getFilePageColors(index, prev.pageColors);

                                                // Ensure pageColors array exists and is long enough
                                                const currentPageColors = Array.isArray(prev.pageColors) ? prev.pageColors : [];
                                                const newPageColors = [...currentPageColors];
                                                while (newPageColors.length <= index) {
                                                  newPageColors.push({ colorPages: [], bwPages: [] });
                                                }

                                                newFileOptions[index] = {
                                                  ...newFileOptions[index],
                                                  color: 'mixed',
                                                  pageColors: filePageColors.colorPages.length > 0 || filePageColors.bwPages.length > 0
                                                    ? filePageColors
                                                    : undefined
                                                };

                                                // Multi-file orders = Multiple independent orders (each file can independently have mixed color)
                                                // Each file can have: 'color', 'bw', or 'mixed' (some pages color, some B&W)
                                                // Global color = Display field: 'mixed' if ANY file has mixed color, otherwise use first file's color
                                                const isSingleFile = selectedFiles.length === 1;
                                                let updatedGlobalColor = prev.color;

                                                if (isSingleFile && index === 0) {
                                                  // Single file with mixed color: set global color to 'mixed'
                                                  updatedGlobalColor = 'mixed';
                                                } else if (!isSingleFile) {
                                                  // Multi-file order: Check if ANY file has mixed color
                                                  const hasAnyMixedColor = newFileOptions.some((opt: any) => opt?.color === 'mixed');

                                                  if (hasAnyMixedColor) {
                                                    // At least one file has mixed color - set global color to 'mixed' for display
                                                    updatedGlobalColor = 'mixed';
                                                  } else {
                                                    // No files have mixed color - use first file's color
                                                    const firstFileColor = newFileOptions[0]?.color;
                                                    if (firstFileColor) {
                                                      updatedGlobalColor = firstFileColor;
                                                    } else {
                                                      updatedGlobalColor = 'bw'; // Default
                                                    }
                                                  }
                                                }

                                                return {
                                                  ...prev,
                                                  color: updatedGlobalColor,
                                                  fileOptions: newFileOptions,
                                                  pageColors: newPageColors
                                                };
                                              });
                                            }}
                                            className={`px-3 py-2 rounded-lg text-xs font-medium transition-all ${fileOpts.color === 'mixed'
                                              ? 'ring-2 ring-purple-500 shadow-md'
                                              : 'hover:shadow-sm'
                                              }`}
                                            style={{
                                              background: 'linear-gradient(135deg, #667eea 0%, #667eea 33%, #000000 33%, #000000 66%, #ffffff 66%, #ffffff 100%)',
                                              color: 'white',
                                              border: '1px solid #333'
                                            }}
                                          >
                                            Mixed
                                          </button>
                                        </div>
                                      </div>

                                      {/* Per-File Mixed Color Selection - Show when Mixed is selected for this file */}
                                      {fileOpts.color === 'mixed' && filePageCount > 1 && (
                                        <div className="md:col-span-2 mt-4 p-4 bg-purple-50 border border-purple-200 rounded-lg">
                                          <label className="block text-sm font-semibold text-gray-900 mb-3">
                                            Select Page Colors for File {index + 1} ({filePageCount} pages)
                                          </label>
                                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <div>
                                              <label className="block text-sm font-medium text-green-700 mb-2">
                                                Color Pages (1-{filePageCount})
                                              </label>
                                              <input
                                                type="text"
                                                placeholder={`e.g., 1-3 or 2,4 or 1-3,5 for pages 1-${filePageCount}`}
                                                value={colorPagesInputs[index] || ''}
                                                onChange={(e) => {
                                                  const inputValue = e.target.value;
                                                  // Update per-file input
                                                  const newInputs = [...colorPagesInputs];
                                                  while (newInputs.length <= index) {
                                                    newInputs.push('');
                                                  }
                                                  newInputs[index] = inputValue;
                                                  setColorPagesInputs(newInputs);

                                                  // Parse and update page colors with validation (per-file)
                                                  const parseResult = parsePageRange(inputValue, filePageCount);
                                                  const newValidations = [...colorPagesValidations];
                                                  while (newValidations.length <= index) {
                                                    newValidations.push({ errors: [], warnings: [] });
                                                  }
                                                  newValidations[index] = {
                                                    errors: parseResult.errors,
                                                    warnings: parseResult.warnings
                                                  };
                                                  setColorPagesValidations(newValidations);

                                                  // Update per-file pageColors in array
                                                  setPrintingOptions(prev => {
                                                    const currentPageColors = Array.isArray(prev.pageColors) ? prev.pageColors : [];
                                                    const newPageColors = [...currentPageColors];
                                                    while (newPageColors.length <= index) {
                                                      newPageColors.push({ colorPages: [], bwPages: [] });
                                                    }
                                                    newPageColors[index] = {
                                                      colorPages: parseResult.pages,
                                                      bwPages: generateBwPages(filePageCount, parseResult.pages)
                                                    };

                                                    // Also update fileOptions pageColors for this file
                                                    const currentFileOptions = prev.fileOptions || [];
                                                    const newFileOptions = [...currentFileOptions];
                                                    while (newFileOptions.length <= index) {
                                                      newFileOptions.push({
                                                        pageSize: prev.pageSize || 'A4',
                                                        color: prev.color || 'bw',
                                                        sided: prev.sided || 'single',
                                                        copies: prev.copies || 1,
                                                      });
                                                    }
                                                    newFileOptions[index] = {
                                                      ...newFileOptions[index],
                                                      pageColors: {
                                                        colorPages: parseResult.pages,
                                                        bwPages: generateBwPages(filePageCount, parseResult.pages)
                                                      }
                                                    };

                                                    return {
                                                      ...prev,
                                                      pageColors: newPageColors,
                                                      fileOptions: newFileOptions
                                                    };
                                                  });
                                                }}
                                                className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 ${(colorPagesValidations[index]?.errors?.length || 0) > 0
                                                  ? 'border-red-300 focus:ring-red-500 focus:border-red-500'
                                                  : 'border-green-300 focus:ring-green-500 focus:border-green-500'
                                                  }`}
                                              />

                                              {/* Validation Messages */}
                                              {colorPagesValidations[index]?.errors && colorPagesValidations[index].errors.length > 0 && (
                                                <div className="mt-2 space-y-1">
                                                  {colorPagesValidations[index].errors.map((error, idx) => (
                                                    <p key={idx} className="text-xs text-red-600 flex items-center gap-1">
                                                      <WarningIcon size={14} className="w-3.5 h-3.5" />
                                                      {error}
                                                    </p>
                                                  ))}
                                                </div>
                                              )}

                                              {colorPagesValidations[index]?.warnings && colorPagesValidations[index].warnings.length > 0 && colorPagesValidations[index].errors.length === 0 && (
                                                <div className="mt-2 space-y-1">
                                                  {colorPagesValidations[index].warnings.map((warning, idx) => (
                                                    <p key={idx} className="text-xs text-yellow-600 flex items-center gap-1">
                                                      <InfoIcon size={14} className="w-3.5 h-3.5" />
                                                      {warning}
                                                    </p>
                                                  ))}
                                                </div>
                                              )}

                                              {/* Helper Text */}
                                              <p className="text-xs text-green-600 mt-2">
                                                <strong>Examples:</strong> 1-3 (pages 1 to 3), 2,4 (pages 2 and 4), 1-3,5 (pages 1-3 and 5)
                                              </p>
                                            </div>
                                            <div>
                                              <label className="block text-sm font-medium text-gray-700 mb-2">
                                                Black & White Pages
                                              </label>
                                              <input
                                                type="text"
                                                placeholder="Auto-generated"
                                                value={(() => {
                                                  const filePageColors = getFilePageColors(index, printingOptions.pageColors);
                                                  return filePageColors.bwPages.join(',') || '';
                                                })()}
                                                readOnly
                                                className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-600"
                                              />
                                              <p className="text-xs text-gray-500 mt-1">
                                                Automatically calculated from remaining pages
                                              </p>
                                            </div>
                                          </div>

                                          {/* Visual Page Preview for this file */}
                                          {filePageCount > 0 && (
                                            <div className="mt-4">
                                              <label className="block text-sm font-medium text-gray-700 mb-2">
                                                Page Preview for File {index + 1} ({filePageCount} total pages)
                                              </label>
                                              <div className="flex flex-wrap gap-2 p-3 bg-white rounded-lg border border-gray-200 max-h-48 overflow-y-auto">
                                                {Array.from({ length: filePageCount }, (_, i) => i + 1).map((pageNum) => {
                                                  const filePageColors = getFilePageColors(index, printingOptions.pageColors);
                                                  const isColor = filePageColors.colorPages.includes(pageNum);
                                                  const isBw = filePageColors.bwPages.includes(pageNum);
                                                  return (
                                                    <div
                                                      key={pageNum}
                                                      className={`px-3 py-1 rounded text-xs font-medium transition-all ${isColor
                                                        ? 'bg-gradient-to-r from-green-400 to-green-600 text-white shadow-sm'
                                                        : isBw
                                                          ? 'bg-gray-300 text-gray-800'
                                                          : 'bg-gray-100 text-gray-500 border border-gray-300'
                                                        }`}
                                                      title={isColor ? `Page ${pageNum} - Color` : isBw ? `Page ${pageNum} - Black & White` : `Page ${pageNum} - Not specified`}
                                                    >
                                                      {pageNum}
                                                    </div>
                                                  );
                                                })}
                                              </div>
                                              {(() => {
                                                const filePageColors = getFilePageColors(index, printingOptions.pageColors);
                                                const totalSpecified = filePageColors.colorPages.length + filePageColors.bwPages.length;
                                                if (totalSpecified < filePageCount) {
                                                  return (
                                                    <p className="text-xs text-yellow-600 mt-2 flex items-center gap-1">
                                                      <WarningIcon size={14} className="w-3.5 h-3.5" />
                                                      Not all pages are specified. Unspecified pages will be printed in Black & White.
                                                    </p>
                                                  );
                                                }
                                                return null;
                                              })()}
                                            </div>
                                          )}

                                          {/* Summary for this file */}
                                          <div className="mt-3 p-2 bg-white rounded border border-purple-200">
                                            <div className="text-sm text-purple-700">
                                              <strong>Summary for File {index + 1}:</strong> {(() => {
                                                const filePageColors = getFilePageColors(index, printingOptions.pageColors);
                                                const colorCount = filePageColors.colorPages.length;
                                                const bwCount = filePageColors.bwPages.length;
                                                if (colorCount === 0) return 'All pages in Black & White';
                                                if (bwCount === 0) return 'All pages in Color';
                                                return `${colorCount} pages in Color, ${bwCount} pages in Black & White`;
                                              })()}
                                            </div>
                                            {(() => {
                                              const filePageColors = getFilePageColors(index, printingOptions.pageColors);
                                              const totalSpecified = filePageColors.colorPages.length + filePageColors.bwPages.length;
                                              return (
                                                <div className="text-xs text-gray-600 mt-1">
                                                  Color: {filePageColors.colorPages.length} pages |
                                                  B&W: {filePageColors.bwPages.length} pages |
                                                  Unspecified: {filePageCount - totalSpecified} pages
                                                </div>
                                              );
                                            })()}
                                          </div>
                                        </div>
                                      )}

                                      {/* Sided */}
                                      <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">
                                          Sided
                                        </label>
                                        <select
                                          value={fileOpts.sided}
                                          onChange={(e) => {
                                            setPrintingOptions(prev => {
                                              const currentFileOptions = prev.fileOptions || [];
                                              const newFileOptions = [...currentFileOptions];
                                              while (newFileOptions.length <= index) {
                                                newFileOptions.push({
                                                  pageSize: prev.pageSize || 'A4',
                                                  color: prev.color || 'bw',
                                                  sided: prev.sided || 'single',
                                                  copies: prev.copies || 1,
                                                });
                                              }
                                              newFileOptions[index] = {
                                                ...newFileOptions[index],
                                                sided: e.target.value as 'single' | 'double'
                                              };
                                              return { ...prev, fileOptions: newFileOptions };
                                            });
                                          }}
                                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                                        >
                                          <option value="single">Single-sided</option>
                                          <option value="double">Double-sided</option>
                                        </select>
                                      </div>

                                      {/* Copies */}
                                      <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">
                                          Number of Copies
                                        </label>
                                        <input
                                          type="number"
                                          min="1"
                                          value={fileOpts.copies || ''}
                                          onChange={(e) => {
                                            const value = e.target.value;
                                            setPrintingOptions(prev => {
                                              const currentFileOptions = prev.fileOptions || [];
                                              const newFileOptions = [...currentFileOptions];
                                              while (newFileOptions.length <= index) {
                                                newFileOptions.push({
                                                  pageSize: prev.pageSize || 'A4',
                                                  color: prev.color || 'bw',
                                                  sided: prev.sided || 'single',
                                                  copies: prev.copies || 1,
                                                });
                                              }
                                              if (value === '') {
                                                newFileOptions[index] = { ...newFileOptions[index], copies: 0 };
                                              } else {
                                                const numValue = parseInt(value);
                                                if (!isNaN(numValue) && numValue >= 1) {
                                                  newFileOptions[index] = { ...newFileOptions[index], copies: numValue };
                                                }
                                              }
                                              return { ...prev, fileOptions: newFileOptions };
                                            });
                                          }}
                                          onBlur={(e) => {
                                            const value = parseInt(e.target.value);
                                            setPrintingOptions(prev => {
                                              const currentFileOptions = prev.fileOptions || [];
                                              const newFileOptions = [...currentFileOptions];
                                              while (newFileOptions.length <= index) {
                                                newFileOptions.push({
                                                  pageSize: prev.pageSize || 'A4',
                                                  color: prev.color || 'bw',
                                                  sided: prev.sided || 'single',
                                                  copies: prev.copies || 1,
                                                });
                                              }
                                              if (isNaN(value) || value < 1) {
                                                newFileOptions[index] = { ...newFileOptions[index], copies: 1 };
                                              }
                                              return { ...prev, fileOptions: newFileOptions };
                                            });
                                          }}
                                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                                        />
                                      </div>
                                    </div>
                                  );
                                })()}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Legacy Printing Options - Hidden when files are selected (for backward compatibility) */}
                  {selectedFiles.length === 0 && (
                    <div>
                      <h3 className="text-xl font-semibold text-gray-900 mb-4">Printing Options</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Page Size
                          </label>
                          <select
                            value={printingOptions.pageSize}
                            onChange={(e) => setPrintingOptions(prev => ({ ...prev, pageSize: e.target.value as 'A4' | 'A3' }))}
                            className="form-select"
                          >
                            <option value="A4">A4</option>
                            <option value="A3">A3</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Color
                          </label>
                          <div className="grid grid-cols-3 gap-3">
                            {/* Colorful Button */}
                            <button
                              type="button"
                              onClick={() => {
                                setPrintingOptions(prev => ({
                                  ...prev,
                                  color: 'color',
                                  pageColors: undefined
                                }));
                              }}
                              className={`px-4 py-3 rounded-lg font-medium transition-all transform hover:scale-105 ${printingOptions.color === 'color'
                                ? 'ring-4 ring-blue-500 ring-offset-2 shadow-lg'
                                : 'hover:shadow-md'
                                }`}
                              style={{
                                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 25%, #f093fb 50%, #4facfe 75%, #00f2fe 100%)',
                                color: 'white'
                              }}
                            >
                              Colorful
                            </button>

                            {/* Black/White Split Button */}
                            <button
                              type="button"
                              onClick={() => {
                                setPrintingOptions(prev => ({
                                  ...prev,
                                  color: 'bw',
                                  pageColors: undefined
                                }));
                              }}
                              className={`px-4 py-3 rounded-lg font-medium transition-all transform hover:scale-105 ${printingOptions.color === 'bw'
                                ? 'ring-4 ring-gray-500 ring-offset-2 shadow-lg'
                                : 'hover:shadow-md'
                                }`}
                              style={{
                                background: 'linear-gradient(to right, #000000 0%, #000000 50%, #ffffff 50%, #ffffff 100%)',
                                color: printingOptions.color === 'bw' ? 'white' : 'black',
                                border: '2px solid #333'
                              }}
                            >
                              B&W
                            </button>

                            {/* Mixed Button */}
                            <button
                              type="button"
                              onClick={() => {
                                setPrintingOptions(prev => {
                                  // Initialize per-file pageColors array if not already an array
                                  let updatedPageColors = prev.pageColors;
                                  if (!Array.isArray(updatedPageColors)) {
                                    // Convert legacy format to array or initialize new array
                                    if (selectedFiles.length > 0) {
                                      updatedPageColors = selectedFiles.map(() => ({ colorPages: [] as number[], bwPages: [] as number[] }));
                                    } else {
                                      updatedPageColors = [];
                                    }
                                  } else if (updatedPageColors.length < selectedFiles.length) {
                                    // Ensure array matches file count
                                    const newPageColors = [...updatedPageColors];
                                    while (newPageColors.length < selectedFiles.length) {
                                      newPageColors.push({ colorPages: [], bwPages: [] });
                                    }
                                    updatedPageColors = newPageColors;
                                  }
                                  return {
                                    ...prev,
                                    color: 'mixed',
                                    pageColors: updatedPageColors
                                  };
                                });
                                setColorPagesInput('');
                                setColorPagesValidation({ errors: [], warnings: [] });
                              }}
                              className={`px-4 py-3 rounded-lg font-medium transition-all transform hover:scale-105 ${printingOptions.color === 'mixed'
                                ? 'ring-4 ring-purple-500 ring-offset-2 shadow-lg'
                                : 'hover:shadow-md'
                                }`}
                              style={{
                                background: 'linear-gradient(135deg, #667eea 0%, #667eea 33%, #000000 33%, #000000 66%, #ffffff 66%, #ffffff 100%)',
                                color: 'white',
                                border: '2px solid #333'
                              }}
                            >
                              Mixed
                            </button>
                          </div>
                        </div>

                        {/* Page Color Selection - Only show when Mixed is selected */}
                        {printingOptions.color === 'mixed' && pageCount > 1 && (
                          <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                            <label className="block text-sm font-medium text-gray-700 mb-3">
                              Select Page Colors
                            </label>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div>
                                <label className="block text-sm font-medium text-green-700 mb-2">
                                  Color Pages
                                </label>
                                <input
                                  type="text"
                                  placeholder="e.g., 1-4 or 3,5 or 1-4,7,9"
                                  value={colorPagesInput}
                                  onChange={(e) => {
                                    const inputValue = e.target.value;
                                    setColorPagesInput(inputValue);

                                    // Parse and update page colors with validation
                                    const parseResult = parsePageRange(inputValue, pageCount);
                                    setColorPagesValidation({
                                      errors: parseResult.errors,
                                      warnings: parseResult.warnings
                                    });

                                    setPrintingOptions(prev => ({
                                      ...prev,
                                      pageColors: {
                                        colorPages: parseResult.pages,
                                        bwPages: generateBwPages(pageCount, parseResult.pages)
                                      }
                                    }));
                                  }}
                                  className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 ${colorPagesValidation.errors.length > 0
                                    ? 'border-red-300 focus:ring-red-500 focus:border-red-500'
                                    : 'border-green-300 focus:ring-green-500 focus:border-green-500'
                                    }`}
                                />

                                {/* Validation Messages */}
                                {colorPagesValidation.errors.length > 0 && (
                                  <div className="mt-2 space-y-1">
                                    {colorPagesValidation.errors.map((error, idx) => (
                                      <p key={idx} className="text-xs text-red-600 flex items-center gap-1">
                                        <WarningIcon size={14} className="w-3.5 h-3.5" />
                                        {error}
                                      </p>
                                    ))}
                                  </div>
                                )}

                                {colorPagesValidation.warnings.length > 0 && colorPagesValidation.errors.length === 0 && (
                                  <div className="mt-2 space-y-1">
                                    {colorPagesValidation.warnings.map((warning, idx) => (
                                      <p key={idx} className="text-xs text-yellow-600 flex items-center gap-1">
                                        <InfoIcon size={14} className="w-3.5 h-3.5" />
                                        {warning}
                                      </p>
                                    ))}
                                  </div>
                                )}

                                {/* Helper Text */}
                                <p className="text-xs text-green-600 mt-2">
                                  <strong>Examples:</strong> 1-4 (pages 1 to 4), 3,5 (pages 3 and 5), 1-4,7 (pages 1-4 and 7)
                                </p>
                              </div>
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                  Black & White Pages
                                </label>
                                <input
                                  type="text"
                                  placeholder="Auto-generated"
                                  value={(() => {
                                    if (!printingOptions.pageColors) return '';
                                    if (Array.isArray(printingOptions.pageColors)) {
                                      // For array format, show summary (legacy UI - should be removed)
                                      const totalBw = printingOptions.pageColors.reduce((sum, pc) => sum + pc.bwPages.length, 0);
                                      return totalBw > 0 ? `${totalBw} pages total` : '';
                                    }
                                    return printingOptions.pageColors.bwPages.join(',') || '';
                                  })()}
                                  readOnly
                                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-600"
                                />
                                <p className="text-xs text-gray-500 mt-1">
                                  Automatically calculated from remaining pages
                                </p>
                              </div>
                            </div>

                            {/* Visual Page Preview */}
                            {pageCount > 0 && (
                              <div className="mt-4">
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                  Page Preview ({pageCount} total pages)
                                </label>
                                <div className="flex flex-wrap gap-2 p-3 bg-white rounded-lg border border-gray-200 max-h-48 overflow-y-auto">
                                  {Array.from({ length: pageCount }, (_, i) => i + 1).map((pageNum) => {
                                    // Legacy: handle both array and single object format
                                    let isColor = false;
                                    let isBw = false;
                                    if (printingOptions.pageColors) {
                                      if (Array.isArray(printingOptions.pageColors)) {
                                        // For array format, check all files (legacy UI - should be removed)
                                        isColor = printingOptions.pageColors.some(pc => pc.colorPages.includes(pageNum));
                                        isBw = printingOptions.pageColors.some(pc => pc.bwPages.includes(pageNum));
                                      } else {
                                        isColor = printingOptions.pageColors.colorPages.includes(pageNum);
                                        isBw = printingOptions.pageColors.bwPages.includes(pageNum);
                                      }
                                    }
                                    return (
                                      <div
                                        key={pageNum}
                                        className={`px-3 py-1 rounded text-xs font-medium transition-all ${isColor
                                          ? 'bg-gradient-to-r from-green-400 to-green-600 text-white shadow-sm'
                                          : isBw
                                            ? 'bg-gray-300 text-gray-800'
                                            : 'bg-gray-100 text-gray-500 border border-gray-300'
                                          }`}
                                        title={isColor ? `Page ${pageNum} - Color` : isBw ? `Page ${pageNum} - Black & White` : `Page ${pageNum} - Not specified`}
                                      >
                                        {pageNum}
                                      </div>
                                    );
                                  })}
                                </div>
                                {(() => {
                                  if (!printingOptions.pageColors) return null;
                                  let totalSpecified = 0;
                                  if (Array.isArray(printingOptions.pageColors)) {
                                    totalSpecified = printingOptions.pageColors.reduce((sum, pc) => sum + pc.colorPages.length + pc.bwPages.length, 0);
                                  } else {
                                    totalSpecified = printingOptions.pageColors.colorPages.length + printingOptions.pageColors.bwPages.length;
                                  }
                                  if (totalSpecified < pageCount) {
                                    return (
                                      <p className="text-xs text-yellow-600 mt-2 flex items-center gap-1">
                                        <WarningIcon size={14} className="w-3.5 h-3.5" />
                                        Not all pages are specified. Unspecified pages will be printed in Black & White.
                                      </p>
                                    );
                                  }
                                  return null;
                                })()}
                              </div>
                            )}

                            {/* Summary */}
                            <div className="mt-3 p-2 bg-white rounded border border-blue-200">
                              <div className="text-sm text-blue-700">
                                <strong>Summary:</strong> {getPageColorPreview(pageCount, printingOptions.pageColors)}
                              </div>
                              {printingOptions.pageColors && (() => {
                                let colorCount = 0;
                                let bwCount = 0;
                                if (Array.isArray(printingOptions.pageColors)) {
                                  colorCount = printingOptions.pageColors.reduce((sum, pc) => sum + pc.colorPages.length, 0);
                                  bwCount = printingOptions.pageColors.reduce((sum, pc) => sum + pc.bwPages.length, 0);
                                } else {
                                  colorCount = printingOptions.pageColors.colorPages.length;
                                  bwCount = printingOptions.pageColors.bwPages.length;
                                }
                                return (
                                  <div className="text-xs text-gray-600 mt-1">
                                    Color: {colorCount} pages |
                                    B&W: {bwCount} pages |
                                    Unspecified: {pageCount - (colorCount + bwCount)} pages
                                  </div>
                                );
                              })()}
                            </div>
                          </div>
                        )}

                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Sided
                          </label>
                          <select
                            value={printingOptions.sided}
                            onChange={(e) => setPrintingOptions(prev => ({ ...prev, sided: e.target.value as 'single' | 'double' }))}
                            className="form-select"
                          >
                            <option value="single">Single-sided</option>
                            <option value="double">Double-sided</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Number of Copies
                          </label>
                          <input
                            type="number"
                            min="1"
                            value={printingOptions.copies || ''}
                            onChange={(e) => {
                              const value = e.target.value;
                              if (value === '') {
                                // Allow empty value temporarily
                                setPrintingOptions(prev => ({ ...prev, copies: 0 }));
                              } else {
                                const numValue = parseInt(value);
                                if (!isNaN(numValue) && numValue >= 1) {
                                  setPrintingOptions(prev => ({ ...prev, copies: numValue }));
                                }
                              }
                            }}
                            onBlur={(e) => {
                              const value = parseInt(e.target.value);
                              if (isNaN(value) || value < 1) {
                                setPrintingOptions(prev => ({ ...prev, copies: 1 }));
                              }
                            }}
                            className="form-select"
                          />
                        </div>
                      </div>
                    </div>
                  )}


                  {/* Order Summary */}
                  <div className="bg-gray-50 p-6 rounded-lg border border-gray-200">
                    <h3 className="text-xl font-semibold text-gray-800 mb-4">Order Summary</h3>
                    <div className="space-y-3">
                      <div className="flex justify-between items-start">
                        <span className="text-gray-600">Files:</span>
                        <div className="text-right max-w-xs">
                          {selectedFiles.length > 0 ? (
                            <div className="space-y-1">
                              {selectedFiles.map((file, index) => (
                                <div key={index} className="text-sm">
                                  <span className="font-medium text-gray-800 truncate block">{truncateFileName(file.name)}</span>
                                  <span className="text-xs text-gray-500">
                                    {filePageCounts[index] || 1} page{filePageCounts[index] !== 1 ? 's' : ''}
                                  </span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <span className="font-medium text-gray-800">No files selected</span>
                          )}
                        </div>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-gray-600">Pages:</span>
                        <span className="font-medium text-gray-800">
                          {isCountingPages ? (
                            <span className="flex items-center">
                              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-600 mr-2"></div>
                              Counting...
                            </span>
                          ) : (
                            pageCount
                          )}
                        </span>
                      </div>
                      {/* Per-File Printing Options Summary */}
                      {selectedFiles.length > 0 && printingOptions.fileOptions && printingOptions.fileOptions.length > 0 ? (
                        <div className="space-y-2">
                          {selectedFiles.map((file, index) => {
                            const fileOpts = getFilePrintingOptions(index, printingOptions);
                            return (
                              <div key={index} className="p-2 bg-white rounded border border-gray-200">
                                <div className="text-xs font-semibold text-gray-700 mb-1">
                                  {truncateFileName(file.name)}:
                                </div>
                                <div className="text-xs space-y-1 text-gray-600">
                                  <div className="flex justify-between">
                                    <span>Size:</span>
                                    <span className="font-medium">{fileOpts.pageSize}</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span>Color:</span>
                                    <span className="font-medium">
                                      {fileOpts.color === 'color' ? 'Color' :
                                        fileOpts.color === 'bw' ? 'B&W' :
                                          'Mixed'}
                                    </span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span>Sided:</span>
                                    <span className="font-medium">
                                      {fileOpts.sided === 'double' ? 'Double' : 'Single'}
                                    </span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span>Copies:</span>
                                    <span className="font-medium">{fileOpts.copies}</span>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <>
                          <div className="flex justify-between items-center">
                            <span className="text-gray-600">Size:</span>
                            <span className="font-medium text-gray-800">{printingOptions.pageSize || 'A4'}</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-gray-600">Color:</span>
                            <span className="font-medium text-gray-800">
                              {printingOptions.color === 'color' ? 'Color' :
                                printingOptions.color === 'bw' ? 'Black & White' :
                                  printingOptions.color === 'mixed' ? 'Mixed' : 'B&W'}
                            </span>
                          </div>
                        </>
                      )}
                      {printingOptions.color === 'mixed' && printingOptions.pageColors && (() => {
                        let colorCount = 0;
                        let bwCount = 0;
                        if (Array.isArray(printingOptions.pageColors)) {
                          colorCount = printingOptions.pageColors.reduce((sum, pc) => sum + pc.colorPages.length, 0);
                          bwCount = printingOptions.pageColors.reduce((sum, pc) => sum + pc.bwPages.length, 0);
                        } else {
                          colorCount = printingOptions.pageColors.colorPages.length;
                          bwCount = printingOptions.pageColors.bwPages.length;
                        }
                        return (
                          <>
                            <div className="flex justify-between items-center">
                              <span className="text-gray-600">Color Pages:</span>
                              <span className="font-medium text-green-600">
                                {colorCount} pages
                              </span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-gray-600">B&W Pages:</span>
                              <span className="font-medium text-gray-600">
                                {bwCount} pages
                              </span>
                            </div>
                          </>
                        );
                      })()}
                      {(!printingOptions.fileOptions || printingOptions.fileOptions.length === 0) && (
                        <>
                          <div className="flex justify-between items-center">
                            <span className="text-gray-600">Sided:</span>
                            <span className="font-medium text-gray-800">
                              {printingOptions.sided === 'double' ? 'Double-sided' : 'Single-sided'}
                            </span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-gray-600">Copies:</span>
                            <span className="font-medium text-gray-800">{printingOptions.copies || 1}</span>
                          </div>
                        </>
                      )}
                      {/* Service Options per File */}
                      {selectedFiles.length > 0 && printingOptions.serviceOptions && printingOptions.serviceOptions.length > 0 && (
                        <div className="space-y-2">
                          {selectedFiles.map((file, index) => {
                            const filePageCount = filePageCounts[index] || 1;
                            const minServiceFeePageLimit = pricingData?.additionalServices?.minServiceFeePageLimit || 1;
                            const fileServiceOption = printingOptions.serviceOptions?.[index];

                            if (filePageCount > minServiceFeePageLimit && fileServiceOption) {
                              return (
                                <div key={index} className="flex justify-between items-center text-sm">
                                  <span className="text-gray-600">
                                    {truncateFileName(file.name)}:
                                  </span>
                                  <span className="font-medium text-gray-800">
                                    {fileServiceOption === 'binding' && `Binding (+₹${pricingData?.additionalServices?.binding || 20})`}
                                    {fileServiceOption === 'file' && 'Plastic file (₹10)'}
                                    {fileServiceOption === 'service' && `Service fee (₹${pricingData?.additionalServices?.minServiceFee || 5})`}
                                  </span>
                                </div>
                              );
                            }
                            return null;
                          })}
                        </div>
                      )}
                      {/* Legacy support for single serviceOption */}
                      {(!printingOptions.serviceOptions || printingOptions.serviceOptions.length === 0) && pageCount > 1 && printingOptions.serviceOption === 'binding' && (
                        <div className="flex justify-between items-center">
                          <span className="text-gray-600">Binding:</span>
                          <span className="font-medium text-blue-600">Yes (+₹{pricingData?.additionalServices?.binding || 20})</span>
                        </div>
                      )}
                      {(!printingOptions.serviceOptions || printingOptions.serviceOptions.length === 0) && pageCount > 1 && printingOptions.serviceOption === 'file' && (
                        <div className="flex justify-between items-center">
                          <span className="text-gray-600">Plastic file:</span>
                          <span className="font-medium text-gray-800">₹10</span>
                        </div>
                      )}
                      {(!printingOptions.serviceOptions || printingOptions.serviceOptions.length === 0) && pageCount > (pricingData?.additionalServices?.minServiceFeePageLimit || 1) && printingOptions.serviceOption === 'service' && (
                        <div className="flex justify-between items-center">
                          <span className="text-gray-600">Service fee:</span>
                          <span className="font-medium text-gray-800">₹{pricingData?.additionalServices?.minServiceFee || 5}</span>
                        </div>
                      )}
                      <div className="border-t pt-3 mt-4 space-y-2">
                        <div className="flex justify-between items-center text-sm">
                          <span className="text-gray-600">Subtotal:</span>
                          <span className="font-medium text-gray-800">₹{amount.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between items-center text-sm">
                          <span className="text-gray-500 flex items-center gap-1">Processing fee (3%) <span className="text-xs text-gray-400" title="Covers payment gateway charges">ℹ️</span></span>
                          <span className="font-medium text-gray-600">₹{(amount * 0.03).toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between items-center pt-2 border-t border-gray-200">
                          <span className="text-xl font-bold text-gray-800">Total:</span>
                          <span className="text-2xl font-bold text-gray-800">₹{(amount * 1.03).toFixed(2)}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Upload More Button */}
                  {selectedFiles.length > 0 && (
                    <div className="text-center">
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg font-medium hover:bg-gray-300 transition-colors"
                      >
                        + Upload More Files
                      </button>
                    </div>
                  )}

                </div>

                {/* Delivery Options Section - Inline after file upload */}
                {selectedFiles.length > 0 && (
                  <div className="bg-white rounded-lg shadow-xl p-8 border border-gray-200 mt-6">
                    <h3 className="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
                      <TruckIcon size={24} className="w-6 h-6" />
                      Delivery Options
                    </h3>


                    {!isAuthenticated && (
                      <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                        <p className="text-sm text-yellow-800 mb-3 flex items-center gap-2">
                          <WarningIcon size={18} className="w-4.5 h-4.5" />
                          <strong>Sign in required:</strong> You need to sign in to place an order.
                        </p>
                        <div className="flex gap-3 mt-3">
                          <button
                            onClick={() => {
                              setAuthMode('signin');
                              setShowAuthModal(true);
                            }}
                            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-sm font-medium"
                          >
                            Sign In
                          </button>
                          <button
                            onClick={() => {
                              setAuthMode('signup');
                              setShowAuthModal(true);
                            }}
                            className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors text-sm font-medium"
                          >
                            Create Account
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="space-y-4">
                      <div className="flex items-center space-x-4">
                        <label className="flex items-center">
                          <input
                            type="radio"
                            name="deliveryType"
                            value="pickup"
                            checked={deliveryOption.type === 'pickup'}
                            onChange={() => setDeliveryOption({ type: 'pickup', pickupLocationId: selectedPickupLocation?._id })}
                            className="mr-2"
                          />
                          <span className="font-medium flex items-center gap-1">
                            <BuildingIcon size={18} className="w-4.5 h-4.5" />
                            Pickup from Campus (FREE)
                          </span>
                        </label>
                      </div>

                      {deliveryOption.type === 'pickup' && (
                        <div className="ml-6 mt-4">
                          <PartnerMapSelector 
                            onPartnerSelected={(id, dpName) => setDeliveryOption(prev => ({ ...prev, partnerId: id, pickupLocationId: undefined, partnerDeliveryPoint: dpName }))}
                            selectedPartnerId={deliveryOption.partnerId}
                          />
                        </div>
                      )}

                      <div className="flex items-center space-x-4">
                        <label className="flex items-center">
                          <input
                            type="radio"
                            name="deliveryType"
                            value="delivery"
                            checked={deliveryOption.type === 'delivery'}
                            onChange={() => setDeliveryOption(prev => ({
                              type: 'delivery',
                              recipientName: prev.recipientName || customerInfo.name || '',
                              recipientPhone: prev.recipientPhone || customerInfo.phone || '',
                            }))}
                            className="mr-2"
                          />
                          <span className="font-medium flex items-center gap-1">
                            <TruckIcon size={18} className="w-4.5 h-4.5" />
                            Home Delivery {deliveryRateInfo ? `(₹${deliveryRateInfo.charge})` : ''}
                          </span>
                        </label>
                      </div>

                      {deliveryOption.type === 'delivery' && (
                        <div className="ml-6 p-5 bg-gradient-to-br from-blue-50 to-purple-50 rounded-xl border border-blue-200 shadow-sm">
                          <div className="flex items-center justify-between mb-4">
                            <h4 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                              📍 Delivery Address
                            </h4>
                            <button
                              type="button"
                              disabled={isDetectingLocation}
                              onClick={async () => {
                                if (!navigator.geolocation) {
                                  toast.error('Geolocation is not supported by your browser');
                                  return;
                                }
                                setIsDetectingLocation(true);
                                navigator.geolocation.getCurrentPosition(
                                  async (position) => {
                                    try {
                                      const { latitude, longitude } = position.coords;
                                      const res = await fetch(
                                        `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json&addressdetails=1`,
                                        { headers: { 'Accept-Language': 'en' } }
                                      );
                                      const data = await res.json();
                                      if (data?.address) {
                                        const addr = data.address;
                                        const pin = addr.postcode || '';
                                        setDeliveryOption(prev => ({
                                          ...prev,
                                          flatBuilding: [addr.house_number, addr.building, addr.apartment].filter(Boolean).join(', ') || prev.flatBuilding || '',
                                          address: [addr.road, addr.neighbourhood, addr.suburb].filter(Boolean).join(', ') || '',
                                          landmark: addr.amenity || addr.commercial || prev.landmark || '',
                                          city: addr.city || addr.town || addr.county || addr.state_district || '',
                                          state: addr.state || '',
                                          pinCode: pin,
                                        }));
                                        toast.success('Location detected! Please verify the details.');
                                      } else {
                                        toast.error('Could not determine address from location');
                                      }
                                    } catch {
                                      toast.error('Failed to fetch address from location');
                                    } finally {
                                      setIsDetectingLocation(false);
                                    }
                                  },
                                  (err) => {
                                    setIsDetectingLocation(false);
                                    if (err.code === err.PERMISSION_DENIED) {
                                      toast.error('Location permission denied. Please allow location access.');
                                    } else {
                                      toast.error('Could not detect location. Please enter manually.');
                                    }
                                  },
                                  { enableHighAccuracy: true, timeout: 10000 }
                                );
                              }}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-100 hover:bg-blue-200 rounded-lg border border-blue-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {isDetectingLocation ? (
                                <>
                                  <div className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-blue-600 border-t-transparent"></div>
                                  Detecting...
                                </>
                              ) : (
                                <>
                                  📍 Use My Location
                                </>
                              )}
                            </button>
                          </div>
                          <div className="space-y-4">
                            {/* Recipient Info */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <div>
                                <label className="block text-xs font-medium text-gray-600 mb-1">Recipient Name *</label>
                                <input
                                  type="text"
                                  required
                                  value={deliveryOption.recipientName || ''}
                                  onChange={(e) => setDeliveryOption(prev => ({ ...prev, recipientName: e.target.value }))}
                                  placeholder="Full name"
                                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm bg-white"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-gray-600 mb-1">Phone Number *</label>
                                <input
                                  type="tel"
                                  required
                                  value={deliveryOption.recipientPhone || ''}
                                  onChange={(e) => {
                                    const val = e.target.value.replace(/[^0-9]/g, '').slice(0, 10);
                                    setDeliveryOption(prev => ({ ...prev, recipientPhone: val }));
                                  }}
                                  placeholder="10-digit mobile"
                                  maxLength={10}
                                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm bg-white"
                                />
                              </div>
                            </div>

                            {/* Flat / House / Building */}
                            <div>
                              <label className="block text-xs font-medium text-gray-600 mb-1">Flat / House No. / Building *</label>
                              <input
                                type="text"
                                required
                                value={deliveryOption.flatBuilding || ''}
                                onChange={(e) => setDeliveryOption(prev => ({ ...prev, flatBuilding: e.target.value }))}
                                placeholder="e.g. Flat 302, Tower B, Green Valley Apartments"
                                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm bg-white"
                              />
                            </div>

                            {/* Area / Street / Locality */}
                            <div>
                              <label className="block text-xs font-medium text-gray-600 mb-1">Area / Street / Locality *</label>
                              <textarea
                                required
                                value={deliveryOption.address || ''}
                                onChange={(e) => setDeliveryOption(prev => ({ ...prev, address: e.target.value }))}
                                rows={2}
                                placeholder="e.g. Sector 62, Near Metro Station"
                                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm bg-white resize-none"
                              />
                            </div>

                            {/* Landmark */}
                            <div>
                              <label className="block text-xs font-medium text-gray-600 mb-1">Landmark (Optional)</label>
                              <input
                                type="text"
                                value={deliveryOption.landmark || ''}
                                onChange={(e) => setDeliveryOption(prev => ({ ...prev, landmark: e.target.value }))}
                                placeholder="e.g. Near SBI Bank, Opposite City Mall"
                                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm bg-white"
                              />
                            </div>

                            {/* PIN Code, City, State */}
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                              <div>
                                <label className="block text-xs font-medium text-gray-600 mb-1">PIN Code *</label>
                                <div className="relative">
                                  <input
                                    type="text"
                                    required
                                    value={deliveryOption.pinCode || ''}
                                    onChange={async (e) => {
                                      const pin = e.target.value.replace(/[^0-9]/g, '').slice(0, 6);
                                      setDeliveryOption(prev => ({ ...prev, pinCode: pin }));
                                      setPincodeError('');

                                      if (pin.length === 6) {
                                        setIsPincodeLookup(true);
                                        try {
                                          const res = await fetch(`https://api.postalpincode.in/pincode/${pin}`);
                                          const data = await res.json();
                                          if (data?.[0]?.Status === 'Success' && data[0].PostOffice?.length > 0) {
                                            const po = data[0].PostOffice[0];
                                            setDeliveryOption((prev: DeliveryOption) => ({
                                              ...prev,
                                              city: po.District || po.Division || '',
                                              state: po.State || '',
                                            }));
                                            // Fetch delivery rate after pincode lookup succeeds
                                            fetchDeliveryRate(pin);
                                          } else {
                                            setPincodeError('Invalid PIN code');
                                          }
                                        } catch {
                                          // Silently fail — user can still type manually
                                        } finally {
                                          setIsPincodeLookup(false);
                                        }
                                      } else {
                                        // Clear auto-filled fields when pincode changes
                                        setDeliveryOption(prev => ({ ...prev, city: '', state: '' }));
                                      }
                                    }}
                                    maxLength={6}
                                    placeholder="6-digit PIN"
                                    className={`w-full px-3 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm bg-white ${pincodeError ? 'border-red-400' : 'border-gray-300'
                                      }`}
                                  />
                                  {isPincodeLookup && (
                                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                                      <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-500 border-t-transparent"></div>
                                    </div>
                                  )}
                                </div>
                                {pincodeError && <p className="text-xs text-red-500 mt-1">{pincodeError}</p>}
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-gray-600 mb-1">City *</label>
                                <input
                                  type="text"
                                  required
                                  value={deliveryOption.city || ''}
                                  onChange={(e) => setDeliveryOption(prev => ({ ...prev, city: e.target.value }))}
                                  placeholder={isPincodeLookup ? 'Loading...' : 'City'}
                                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm bg-white"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-gray-600 mb-1">State *</label>
                                <input
                                  type="text"
                                  required
                                  value={deliveryOption.state || ''}
                                  onChange={(e) => setDeliveryOption(prev => ({ ...prev, state: e.target.value }))}
                                  placeholder={isPincodeLookup ? 'Loading...' : 'State'}
                                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm bg-white"
                                />
                              </div>
                            </div>

                            {/* Delivery note */}
                            <div className="flex items-start gap-2 p-3 bg-white rounded-lg border border-blue-100">
                              <span className="text-blue-500 mt-0.5">ℹ️</span>
                              <p className="text-xs text-gray-600">
                                Enter your 6-digit PIN code and City & State will be auto-filled. Delivery charges vary based on your location.
                              </p>
                            </div>

                            {/* Delivery Speed Options - shown only for Home Delivery */}
                            <div className="mt-5">
                              <label className="block text-sm font-semibold text-gray-800 mb-3 flex items-center gap-2">
                                ⚡ Delivery Speed
                              </label>
                              {isFetchingRate ? (
                                <div className="flex items-center gap-2 text-sm text-gray-500 py-4">
                                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-500 border-t-transparent"></div>
                                  Fetching delivery rates...
                                </div>
                              ) : deliveryRateInfo?.tiers && deliveryRateInfo.tiers.length > 0 ? (
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                  {deliveryRateInfo.tiers.map((tier: { id: string; label: string; description: string; emoji: string; deliveryCharge: number; estimatedDays: number; courierName: string }) => {
                                    const isSelected = deliverySpeed === tier.id;
                                    const colorMap: Record<string, { border: string; bg: string; ring: string; hover: string; text: string; checkBg: string }> = {
                                      standard: { border: 'border-green-500', bg: 'bg-green-50', ring: 'ring-green-200', hover: 'hover:border-green-300', text: 'text-green-600', checkBg: 'bg-green-500' },
                                      express: { border: 'border-blue-500', bg: 'bg-blue-50', ring: 'ring-blue-200', hover: 'hover:border-blue-300', text: 'text-blue-600', checkBg: 'bg-blue-500' },
                                      sameday: { border: 'border-purple-500', bg: 'bg-purple-50', ring: 'ring-purple-200', hover: 'hover:border-purple-300', text: 'text-purple-600', checkBg: 'bg-purple-500' },
                                    };
                                    const colors = colorMap[tier.id] || colorMap.standard;

                                    return (
                                      <button
                                        key={tier.id}
                                        type="button"
                                        onClick={() => {
                                          setDeliverySpeed(tier.id as 'standard' | 'sameday');
                                          const d = new Date();
                                          d.setDate(d.getDate() + (tier.estimatedDays || 5));
                                          setExpectedDate(d.toISOString().split('T')[0]);
                                          setDeliveryOption((prev: DeliveryOption) => ({ ...prev, deliveryCharge: tier.deliveryCharge }));
                                        }}
                                        className={`relative p-4 rounded-xl border-2 text-left transition-all duration-200 ${isSelected
                                          ? `${colors.border} ${colors.bg} ring-2 ${colors.ring} shadow-md`
                                          : `border-gray-200 bg-white ${colors.hover} hover:shadow-sm`
                                          }`}
                                      >
                                        {isSelected && (
                                          <div className={`absolute -top-2 -right-2 ${colors.checkBg} text-white rounded-full w-5 h-5 flex items-center justify-center text-xs`}>✓</div>
                                        )}
                                        {tier.id === 'sameday' && (
                                          <span className="absolute -top-2 left-3 bg-gradient-to-r from-orange-500 to-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">EXPRESS</span>
                                        )}
                                        <div className="text-xl mb-1">{tier.emoji}</div>
                                        <div className="font-semibold text-gray-800 text-sm">{tier.label}</div>
                                        <div className="text-xs text-gray-500">{tier.description}</div>
                                        <div className={`mt-2 text-sm font-bold ${colors.text}`}>
                                          ₹{tier.deliveryCharge}
                                        </div>
                                        <div className="text-[10px] text-gray-400 mt-0.5">via {tier.courierName}</div>
                                      </button>
                                    );
                                  })}
                                </div>
                              ) : (
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                  {(['standard', 'express', 'sameday'] as const).map((speed) => {
                                    const info = {
                                      standard: { emoji: '📦', label: 'Standard', desc: '3-5 business days', color: 'green' },
                                      express: { emoji: '🚀', label: 'Express', desc: '1-2 business days', color: 'blue' },
                                      sameday: { emoji: '⚡', label: 'Same Day', desc: 'Within 4-6 hours', color: 'purple' },
                                    }[speed];
                                    const isSelected = deliverySpeed === speed;
                                    return (
                                      <button
                                        key={speed}
                                        type="button"
                                        onClick={() => {
                                          setDeliverySpeed(speed);
                                          const d = new Date();
                                          d.setDate(d.getDate() + (speed === 'sameday' ? 0 : speed === 'express' ? 2 : 5));
                                          setExpectedDate(d.toISOString().split('T')[0]);
                                        }}
                                        className={`relative p-4 rounded-xl border-2 text-left transition-all duration-200 ${isSelected
                                          ? `border-${info.color}-500 bg-${info.color}-50 ring-2 ring-${info.color}-200 shadow-md`
                                          : `border-gray-200 bg-white hover:border-${info.color}-300 hover:shadow-sm`
                                          }`}
                                      >
                                        {isSelected && (
                                          <div className={`absolute -top-2 -right-2 bg-${info.color}-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs`}>✓</div>
                                        )}
                                        {speed === 'sameday' && (
                                          <span className="absolute -top-2 left-3 bg-gradient-to-r from-orange-500 to-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">EXPRESS</span>
                                        )}
                                        <div className="text-xl mb-1">{info.emoji}</div>
                                        <div className="font-semibold text-gray-800 text-sm">{info.label}</div>
                                        <div className="text-xs text-gray-500">{info.desc}</div>
                                        <div className="mt-2 text-sm font-bold text-gray-400">
                                          Enter PIN for rate
                                        </div>
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                              <p className="mt-2 text-xs text-gray-500 flex items-center gap-1">
                                📅 Est. delivery: {expectedDate ? new Date(expectedDate + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }) : 'Select a speed'}
                                {deliveryRateInfo?.tiers && deliverySpeed !== 'standard' && <span className="text-orange-600 font-medium"> • Express charges apply</span>}
                              </p>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Delivery speed is now selected above in the main form */}
                  </div>
                )}
              </div>
            </div>

            {/* Right Column - Sticky Order Summary & Payment */}
            <div className="lg:col-span-1">
              <div className="sticky top-6">
                <div className="bg-white rounded-lg shadow-xl p-6 border border-gray-200">
                  <h3 className="text-xl font-semibold text-gray-800 mb-4 flex items-center gap-2">
                    <DocumentIcon size={24} className="w-6 h-6" />
                    Order Summary
                  </h3>

                  {/* Quick Summary */}
                  <div className="space-y-3 mb-6">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Files:</span>
                      <span className="font-medium">{selectedFiles.length > 0 ? `${selectedFiles.length} file${selectedFiles.length !== 1 ? 's' : ''}` : 'No files'}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Pages:</span>
                      <span className="font-medium">{isCountingPages ? '...' : pageCount}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Size:</span>
                      <span className="font-medium">{printingOptions.pageSize}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Color:</span>
                      <span className="font-medium">
                        {printingOptions.color === 'color' ? 'Color' :
                          printingOptions.color === 'bw' ? 'B&W' : 'Mixed'}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Copies:</span>
                      <span className="font-medium">{printingOptions.copies}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Delivery:</span>
                      <span className="font-medium text-xs flex items-center gap-1">
                        {deliveryOption.type === 'pickup' ? (
                          <>
                            <BuildingIcon size={14} className="w-3.5 h-3.5" />
                            Pickup (Free)
                          </>
                        ) : (
                          <>
                            <TruckIcon size={14} className="w-3.5 h-3.5" />
                            {isFetchingRate ? (
                              <span className="flex items-center gap-1">
                                <div className="animate-spin rounded-full h-3 w-3 border-2 border-blue-500 border-t-transparent"></div>
                                Calculating...
                              </span>
                            ) : deliveryRateInfo ? (
                              <span>₹{deliveryRateInfo.charge} ({deliveryRateInfo.estimatedDays}d)</span>
                            ) : (
                              <span>Enter PIN for rate</span>
                            )}
                          </>
                        )}
                      </span>
                    </div>
                    {deliveryOption.type === 'delivery' && deliveryRateInfo && (
                      <div className="flex justify-between text-xs text-gray-500 mt-1">
                        <span>📦 {(deliveryRateInfo.weight * 1000).toFixed(0)}g via {deliveryRateInfo.courierName}</span>
                        <span>~{deliveryRateInfo.estimatedDays} days</span>
                      </div>
                    )}
                  </div>

                  {/* Total Amount */}
                  <div className="border-t pt-4 mb-6 space-y-2">
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-gray-600">Subtotal:</span>
                      <span className="font-medium">₹{amount.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-gray-500">Processing fee (3%)</span>
                      <span className="text-gray-500">₹{(amount * 0.03).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between items-center pt-2 border-t border-gray-100">
                      <span className="text-lg font-semibold text-gray-800">Total:</span>
                      <span className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">₹{(amount * 1.03).toFixed(2)}</span>
                    </div>
                  </div>

                  {/* Payment Button */}
                  <button
                    onClick={() => {
                      if (!isAuthenticated) {
                        setAuthMode('signin');
                        setShowAuthModal(true);
                      } else {
                        handlePayment();
                      }
                    }}
                    disabled={isProcessingPayment || uploadProgress.uploading || (isAuthenticated && !isRazorpayLoaded)}
                    className="w-full px-6 py-4 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg font-semibold hover:from-blue-700 hover:to-purple-700 transition-all text-lg shadow-lg hover:shadow-xl transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
                  >
                    {!isAuthenticated ? (
                      <span className="flex items-center justify-center gap-2">
                        <LockIcon size={20} className="w-5 h-5" />
                        Sign In to Place Order
                      </span>
                    ) : !isRazorpayLoaded ? (
                      <span className="flex items-center justify-center gap-2">
                        <ClockIcon size={20} className="w-5 h-5" />
                        Loading...
                      </span>
                    ) : uploadProgress.uploading ? (
                      <span className="flex items-center justify-center gap-2">
                        <UploadIcon size={20} className="w-5 h-5" />
                        Uploading... ({uploadProgress.currentFile}/{uploadProgress.totalFiles})
                      </span>
                    ) : isProcessingPayment ? (
                      <span className="flex items-center justify-center gap-2">
                        <RefreshIcon size={20} className="w-5 h-5 animate-spin" />
                        Processing...
                      </span>
                    ) : (
                      <span className="flex items-center justify-center gap-2">
                        <MoneyIcon size={20} className="w-5 h-5" />
                        Pay ₹{amount.toFixed(2)}
                      </span>
                    )}
                  </button>

                  {/* Cart Edit Mode: Update & Remove buttons */}
                  {editingCartItemId && selectedFiles.length > 0 && (
                    <div className="mt-3 space-y-2">
                      <button
                        onClick={async () => {
                          try {
                            const file = selectedFiles[0];
                            const fileOpts = getFilePrintingOptions(0, printingOptions);
                            const newDataUrl = await fileToDataUrl(file);
                            updateCartItem(editingCartItemId, {
                              fileName: file.name,
                              fileSize: file.size,
                              pageCount: filePageCounts[0] || 1,
                              printingOptions: {
                                pageSize: fileOpts.pageSize,
                                color: fileOpts.color,
                                sided: fileOpts.sided,
                                copies: fileOpts.copies,
                                serviceOption: printingOptions.serviceOptions?.[0] || printingOptions.serviceOption || 'service',
                                pageColors: fileOpts.pageColors,
                              },
                              fileDataUrl: newDataUrl,
                              fileType: file.type,
                            });
                            toast.success('Cart item updated!');
                            router.push('/cart');
                          } catch (err) {
                            console.error('Failed to update cart item:', err);
                            toast.error('Failed to update cart item');
                          }
                        }}
                        className="w-full px-6 py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-lg font-semibold hover:from-green-600 hover:to-emerald-700 transition-all shadow-md hover:shadow-lg"
                      >
                        <span className="flex items-center justify-center gap-2">
                          ✅ Update Cart Item
                        </span>
                      </button>
                      <button
                        onClick={() => {
                          removeFromCart(editingCartItemId);
                          toast.success('Removed from cart');
                          router.push('/cart');
                        }}
                        className="w-full px-6 py-3 bg-gradient-to-r from-red-500 to-rose-600 text-white rounded-lg font-semibold hover:from-red-600 hover:to-rose-700 transition-all shadow-md hover:shadow-lg"
                      >
                        <span className="flex items-center justify-center gap-2">
                          🗑️ Remove from Cart
                        </span>
                      </button>
                    </div>
                  )}

                  {/* Add to Cart Button (only when NOT in edit mode) */}
                  {!editingCartItemId && selectedFiles.length > 0 && (
                    <button
                      onClick={handleAddToCart}
                      disabled={isAddingToCart || selectedFiles.length === 0}
                      className="w-full mt-3 px-6 py-3 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-lg font-semibold hover:from-amber-600 hover:to-orange-600 transition-all shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isAddingToCart ? (
                        <span className="flex items-center justify-center gap-2">
                          <RefreshIcon size={18} className="w-4.5 h-4.5 animate-spin" />
                          Adding...
                        </span>
                      ) : (
                        <span className="flex items-center justify-center gap-2">
                          🛒 Add to Cart & Continue
                        </span>
                      )}
                    </button>
                  )}

                  {/* Cart Items Count */}
                  {cartItems.length > 0 && (
                    <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                      <button
                        onClick={() => setShowCartDrawer(true)}
                        className="w-full flex items-center justify-between text-sm"
                      >
                        <span className="flex items-center gap-2 text-amber-800 font-medium">
                          🛒 {cartItems.length} item{cartItems.length !== 1 ? 's' : ''} in cart
                        </span>
                        <span className="text-amber-600 text-xs font-semibold">View Cart →</span>
                      </button>
                    </div>
                  )}

                  {/* Upload Progress Indicator */}
                  {uploadProgress.uploading && (
                    <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-blue-900">
                          📤 Uploading {uploadProgress.currentFile} of {uploadProgress.totalFiles} file(s)
                        </span>
                        <span className="text-sm text-blue-700">
                          {uploadProgress.fileName ? uploadProgress.fileName.substring(0, 30) + (uploadProgress.fileName.length > 30 ? '...' : '') : ''}
                        </span>
                      </div>
                      <div className="w-full bg-blue-200 rounded-full h-2 mb-2">
                        <div
                          className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                          style={{ width: `${((uploadProgress.currentFile - 1) * 100 + uploadProgress.progress) / uploadProgress.totalFiles}%` }}
                        ></div>
                      </div>
                      {uploadProgress.isSlowNetwork && (
                        <div className="mt-2 p-2 bg-yellow-50 border border-yellow-200 rounded text-sm text-yellow-800">
                          <span className="flex items-center gap-1">
                            <WarningIcon size={16} className="w-4 h-4" />
                            Slow network detected. Upload is taking longer than expected. Please wait...
                          </span>
                        </div>
                      )}
                      {uploadProgress.startTime && uploadProgress.progress > 0 && uploadProgress.progress < 100 && (
                        <div className="text-xs text-blue-600 mt-1">
                          Upload in progress... This may take a while on slow connections.
                        </div>
                      )}
                    </div>
                  )}

                  {/* Payment Verification Status */}
                  {paymentVerificationStatus.verifying && (
                    <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center space-x-2">
                          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
                          <span className="text-sm font-medium text-blue-900">
                            Verifying payment...
                          </span>
                        </div>
                        {paymentVerificationStatus.startTime && (
                          <span className="text-xs text-blue-600">
                            {Math.floor((Date.now() - paymentVerificationStatus.startTime) / 1000)}s
                          </span>
                        )}
                      </div>
                      {paymentVerificationStatus.startTime && Date.now() - paymentVerificationStatus.startTime > 60000 && (
                        <div className="mt-2 p-2 bg-yellow-50 border border-yellow-200 rounded text-sm text-yellow-800">
                          <span className="flex items-center gap-1">
                            <WarningIcon size={16} className="w-4 h-4" />
                            Verification is taking longer than expected. Please wait...
                          </span>
                        </div>
                      )}
                      {paymentVerificationStatus.polling && (
                        <div className="mt-2">
                          <button
                            onClick={async () => {
                              if (!paymentVerificationStatus.razorpayOrderId) return;
                              try {
                                const response = await fetch('/api/payment/check-status', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({
                                    razorpay_order_id: paymentVerificationStatus.razorpayOrderId,
                                  }),
                                });
                                const data = await response.json();
                                if (data.success && data.payment_status === 'completed') {
                                  alert(`Payment successful! Your order #${data.order.orderId} has been placed.`);
                                  setPaymentVerificationStatus({
                                    verifying: false,
                                    orderId: null,
                                    razorpayOrderId: null,
                                    startTime: null,
                                    polling: false,
                                  });
                                  window.location.href = '/my-orders';
                                } else if (data.payment_status === 'failed') {
                                  alert(`Payment failed: ${data.message}`);
                                  setPaymentVerificationStatus({
                                    verifying: false,
                                    orderId: null,
                                    razorpayOrderId: null,
                                    startTime: null,
                                    polling: false,
                                  });
                                } else {
                                  alert(`Payment status: ${data.message}`);
                                }
                              } catch (error) {
                                console.error('Error checking payment status:', error);
                                alert('Failed to check payment status. Please try again later.');
                              }
                            }}
                            className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
                          >
                            🔍 Check Payment Status
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {!isAuthenticated && (
                    <div className="mt-4 text-center">
                      <button
                        onClick={() => {
                          setAuthMode('signin');
                          setShowAuthModal(true);
                        }}
                        className="text-sm text-blue-600 hover:text-blue-800 underline"
                      >
                        Sign in to continue
                      </button>
                    </div>
                  )}

                  {/* Trust Badges */}
                  <div className="mt-6 pt-6 border-t space-y-2">
                    <div className="flex items-center text-xs text-gray-600">
                      <span className="mr-2">🔒</span>
                      <span>Secure Payment</span>
                    </div>
                    <div className="flex items-center text-xs text-gray-600">
                      <span className="mr-2">🚀</span>
                      <span>Fast Delivery</span>
                    </div>
                    <div className="flex items-center text-xs text-gray-600">
                      <span className="mr-2">⭐</span>
                      <span>1000+ Happy Customers</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Inline Auth Modal */}
      <InlineAuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        onAuthSuccess={() => {
          // Auth success is handled by useEffect that watches isAuthenticated
          // This callback is called after successful authentication
          setShowAuthModal(false);
        }}
        initialMode={authMode}
        onBeforeGoogleSignIn={async () => {
          // Save order state before Google OAuth redirect
          // This preserves files and form data during the OAuth flow
          try {
            await saveOrderState({
              selectedFiles,
              fileURLs,
              orderType,
              printingOptions,
              expectedDate,
              pageCount,
              filePageCounts,
              pdfUrls,
              pdfLoaded,
              customerInfo,
              deliveryOption,
              selectedPickupLocation,
              colorPagesInput,
              colorPagesInputs,
              colorPagesValidations,
            });
            console.log('✅ Order state saved before Google OAuth');
          } catch (error) {
            console.error('Error saving order state:', error);
            // Don't block OAuth flow if save fails
          }
        }}
      />

      {/* Mobile Sticky Bottom Bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)] z-40 lg:hidden safe-area-bottom">
        <div className="flex items-center justify-between gap-4 max-w-7xl mx-auto">
          <div>
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Total</p>
            <p className="text-xl font-bold text-gray-900">₹{amount.toFixed(2)}</p>
          </div>

          {editingCartItemId ? (
            <div className="flex gap-2 flex-1 justify-end">
              <button
                onClick={() => {
                  removeFromCart(editingCartItemId);
                  toast.success('Removed');
                  router.push('/cart');
                }}
                className="px-4 py-3 bg-red-100 text-red-600 rounded-lg font-semibold hover:bg-red-200"
              >
                <span className="text-xl">🗑️</span>
              </button>
              <button
                onClick={async () => {
                  try {
                    const file = selectedFiles[0];
                    const fileOpts = getFilePrintingOptions(0, printingOptions);
                    const newDataUrl = await fileToDataUrl(file);
                    updateCartItem(editingCartItemId, {
                      fileName: file.name,
                      fileSize: file.size,
                      pageCount: filePageCounts[0] || 1,
                      printingOptions: {
                        pageSize: fileOpts.pageSize,
                        color: fileOpts.color,
                        sided: fileOpts.sided,
                        copies: fileOpts.copies,
                        serviceOption: printingOptions.serviceOptions?.[0] || printingOptions.serviceOption || 'service',
                        pageColors: fileOpts.pageColors,
                      },
                      fileDataUrl: newDataUrl,
                      fileType: file.type,
                    });
                    toast.success('Updated!');
                    router.push('/cart');
                  } catch (err) {
                    console.error('Failed to update:', err);
                    toast.error('Failed to update');
                  }
                }}
                className="flex-1 px-4 py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-lg font-semibold shadow-md"
              >
                Update
              </button>
            </div>
          ) : (
            selectedFiles.length > 0 ? (
              <button
                onClick={handleAddToCart}
                disabled={isAddingToCart || selectedFiles.length === 0}
                className="flex-1 px-6 py-3 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-lg font-semibold hover:from-amber-600 hover:to-orange-600 transition-all shadow-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isAddingToCart ? (
                  <>
                    <RefreshIcon size={18} className="w-4.5 h-4.5 animate-spin" />
                    Adding...
                  </>
                ) : (
                  <>
                    🛒 Add to Cart
                  </>
                )}
              </button>
            ) : (
              <button
                onClick={() => {
                  // Scroll to top or trigger file input
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                  toast('Please upload a file first', { icon: '👆' });
                }}
                className="flex-1 px-6 py-3 bg-gray-100 text-gray-400 rounded-lg font-semibold cursor-not-allowed"
              >
                Select File
              </button>
            )
          )}
        </div>
      </div>

      <InlinePhoneModal
        isOpen={showPhoneModal}
        onClose={() => setShowPhoneModal(false)}
        onPhoneSaved={(phone) => {
          setCustomerInfo(prev => ({ ...prev, phone }));
          setShowPhoneModal(false);
        }}
      />

      {/* Floating Cart Badge */}
      {cartItems.length > 0 && !showCartDrawer && (
        <button
          onClick={() => setShowCartDrawer(true)}
          className="fixed bottom-6 right-6 z-50 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-full w-16 h-16 flex items-center justify-center shadow-xl hover:shadow-2xl transform hover:scale-110 transition-all"
        >
          <span className="text-2xl">🛒</span>
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full w-6 h-6 flex items-center justify-center">
            {cartItems.length}
          </span>
        </button>
      )}

      {/* Cart Drawer */}
      {showCartDrawer && (
        <div className="fixed inset-0 z-50 flex justify-end">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setShowCartDrawer(false)}
          />

          {/* Drawer Panel */}
          <div className="relative w-full max-w-md bg-white shadow-2xl flex flex-col animate-slide-in-right">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b bg-gradient-to-r from-amber-50 to-orange-50">
              <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                🛒 Cart ({cartItems.length} item{cartItems.length !== 1 ? 's' : ''})
              </h2>
              <div className="flex items-center gap-2">
                {cartItems.length > 0 && (
                  <button
                    onClick={handleClearCart}
                    className="text-xs text-red-500 hover:text-red-700 font-medium px-2 py-1 rounded hover:bg-red-50 transition-colors"
                  >
                    Clear All
                  </button>
                )}
                <button
                  onClick={() => setShowCartDrawer(false)}
                  className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors text-xl"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Cart Items List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {cartItems.length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                  <div className="text-4xl mb-3">🛒</div>
                  <p className="font-medium">Your cart is empty</p>
                  <p className="text-sm mt-1">Add files to batch your orders together</p>
                </div>
              ) : (
                cartItems.map((item: CartItem) => (
                  <div
                    key={item.id}
                    className="bg-gray-50 border border-gray-200 rounded-xl p-4 relative group"
                  >
                    <button
                      onClick={() => handleRemoveFromCart(item.id)}
                      className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded-full bg-red-100 text-red-500 hover:bg-red-200 opacity-0 group-hover:opacity-100 transition-opacity text-xs"
                    >
                      ✕
                    </button>

                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center text-lg flex-shrink-0">
                        {item.fileName.endsWith('.pdf') ? '📄' :
                          item.fileName.endsWith('.docx') || item.fileName.endsWith('.doc') ? '📝' :
                            item.fileName.match(/\.(jpg|jpeg|png|gif)$/i) ? '🖼️' : '📁'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-800 text-sm truncate">{item.fileName}</p>
                        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
                          <span className="text-xs text-gray-500">{item.pageCount} page{item.pageCount !== 1 ? 's' : ''}</span>
                          <span className="text-xs text-gray-500">{item.printingOptions.pageSize}</span>
                          <span className="text-xs text-gray-500">
                            {item.printingOptions.color === 'color' ? '🎨 Color' :
                              item.printingOptions.color === 'mixed' ? '🎨 Mixed' : '⬛ B&W'}
                          </span>
                          <span className="text-xs text-gray-500">{item.printingOptions.sided === 'double' ? '↔ Double' : '→ Single'}</span>
                          {item.printingOptions.copies > 1 && (
                            <span className="text-xs text-gray-500">×{item.printingOptions.copies}</span>
                          )}
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        {pricing ? (
                          <p className="font-bold text-sm text-gray-800">₹{estimateItemPrice(item, pricing)}</p>
                        ) : (
                          <div className="h-5 w-16 bg-gray-200 animate-pulse rounded ml-auto"></div>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Cart Footer */}
            {cartItems.length > 0 && (
              <div className="border-t p-4 bg-white">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-sm text-gray-600">Est. Subtotal:</span>
                  {pricing ? (
                    <span className="font-bold text-lg text-gray-800">₹{estimateCartTotal(pricing)}</span>
                  ) : (
                    <div className="h-7 w-24 bg-gray-200 animate-pulse rounded"></div>
                  )}
                </div>
                <p className="text-xs text-gray-400 mb-3">+ delivery charges • exact price at checkout</p>

                <div className="bg-green-50 border border-green-200 rounded-lg p-2 mb-3">
                  <p className="text-xs text-green-700 flex items-center gap-1">
                    💰 <strong>Saving on delivery!</strong> Combined weight: {(getCartWeight() * 1000).toFixed(0)}g — one delivery charge for all items
                  </p>
                </div>

                <button
                  onClick={loadCartForCheckout}
                  className="w-full px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg font-semibold hover:from-blue-700 hover:to-purple-700 transition-all shadow-lg"
                >
                  <span className="flex items-center justify-center gap-2">
                    🛍️ Checkout Cart ({cartItems.length} item{cartItems.length !== 1 ? 's' : ''})
                  </span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export default function OrderPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div></div>}>
      <OrderPageContent />
    </Suspense>
  );
}
