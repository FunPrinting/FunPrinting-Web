/**
 * Cart utility functions using localStorage.
 * Cart items represent individual file print jobs that can be combined
 * into a single order at checkout for shared delivery costs.
 */

export interface CartItemPrintingOptions {
    pageSize: 'A4' | 'A3';
    color: 'color' | 'bw' | 'mixed';
    sided: 'single' | 'double';
    copies: number;
    serviceOption: string;
    pageColors?: { colorPages: number[]; bwPages: number[] };
}

export interface CartItem {
    id: string;
    fileName: string;
    fileSize: number;         // bytes
    pageCount: number;
    printingOptions: CartItemPrintingOptions;
    // File data stored as base64 for localStorage persistence
    fileDataUrl: string;
    fileType: string;         // MIME type
    addedAt: number;          // timestamp
}

// Serializable cart data stored in localStorage
interface CartData {
    items: CartItem[];
    updatedAt: number;
}

const CART_KEY = 'funprinting_cart';

/**
 * Get all cart items from localStorage
 */
export function getCart(): CartItem[] {
    if (typeof window === 'undefined') return [];
    try {
        const data = localStorage.getItem(CART_KEY);
        if (!data) return [];
        const parsed: CartData = JSON.parse(data);
        return parsed.items || [];
    } catch {
        return [];
    }
}

/**
 * Save cart items to localStorage
 */
function saveCart(items: CartItem[]): void {
    if (typeof window === 'undefined') return;
    const data: CartData = {
        items,
        updatedAt: Date.now(),
    };
    try {
        localStorage.setItem(CART_KEY, JSON.stringify(data));
    } catch (err) {
        console.error('Failed to save cart:', err);
        // localStorage might be full — try to notify
        if (err instanceof DOMException && err.name === 'QuotaExceededError') {
            console.warn('Cart storage quota exceeded. Try removing some items.');
        }
    }
}

/**
 * Add an item to the cart
 */
export function addToCart(item: CartItem): CartItem[] {
    const items = getCart();
    items.push(item);
    saveCart(items);
    return items;
}

/**
 * Remove an item from the cart by ID
 */
export function removeFromCart(id: string): CartItem[] {
    const items = getCart().filter(item => item.id !== id);
    saveCart(items);
    return items;
}

/**
 * Clear all items from the cart
 */
export function clearCart(): void {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(CART_KEY);
}

/**
 * Get the number of items in the cart
 */
export function getCartItemCount(): number {
    return getCart().length;
}

/**
 * Calculate total weight for all cart items (in kg)
 * Uses same logic as order page: A4=5g/sheet, A3=10g/sheet + 10g safety margin per item
 */
export function getCartWeight(): number {
    const items = getCart();
    let totalGrams = 0;
    for (const item of items) {
        const perSheetGrams = item.printingOptions.pageSize === 'A3' ? 10 : 5;
        totalGrams += (item.pageCount * item.printingOptions.copies * perSheetGrams) + 10;
    }
    return Math.max(0.1, parseFloat((totalGrams / 1000).toFixed(2)));
}

/**
 * Calculate estimated price for a single cart item (frontend estimation only).
 * Uses same pricing logic as server: base × pages × color × sided × copies.
 * Pricing defaults match DB defaults (A4=5/page, A3=10/page).
 */
export function estimateItemPrice(item: CartItem, pricing?: { basePrices?: { A4: number; A3: number }; multipliers?: { color: number; doubleSided: number }; additionalServices?: { binding: number } }): number {
    const basePrice = pricing?.basePrices?.[item.printingOptions.pageSize]
        ?? (item.printingOptions.pageSize === 'A3' ? 10 : 5);

    const colorMultiplier = item.printingOptions.color === 'color'
        ? (pricing?.multipliers?.color ?? 2)
        : 1;

    const sidedMultiplier = item.printingOptions.sided === 'double'
        ? (pricing?.multipliers?.doubleSided ?? 1.5)
        : 1;

    let total = item.pageCount * basePrice * colorMultiplier * sidedMultiplier * item.printingOptions.copies;

    // Add binding cost if service option is binding
    if (item.printingOptions.serviceOption === 'binding') {
        total += pricing?.additionalServices?.binding ?? 20;
    }

    return Math.ceil(total);
}

/**
 * Calculate price for a single cart item based on a specific partner's custom pricing.
 */
export function calculatePartnerItemPrice(item: CartItem, partnerPricing: { perPageBW: number; perPageColor: number; binding: number }): number {
    let total = 0;
    const copies = item.printingOptions.copies || 1;
    const pageSizeMultiplier = item.printingOptions.pageSize === 'A3' ? 2 : 1;
    const sidedMultiplier = item.printingOptions.sided === 'double' ? 1.5 : 1; // Assuming 1.5x for double sided like the default

    if (item.printingOptions.color === 'mixed' && item.printingOptions.pageColors) {
        const colorCount = item.printingOptions.pageColors.colorPages.length;
        const bwCount = item.printingOptions.pageColors.bwPages.length;
        total = ((colorCount * partnerPricing.perPageColor) + (bwCount * partnerPricing.perPageBW)) * pageSizeMultiplier * sidedMultiplier;
    } else if (item.printingOptions.color === 'color') {
        total = item.pageCount * partnerPricing.perPageColor * pageSizeMultiplier * sidedMultiplier;
    } else {
        total = item.pageCount * partnerPricing.perPageBW * pageSizeMultiplier * sidedMultiplier;
    }

    total *= copies;

    // Add binding cost if service option is binding
    if (item.printingOptions.serviceOption === 'binding') {
        total += partnerPricing.binding * copies; // Usually binding is per copy
    }

    return Math.ceil(total);
}

/**
 * Calculate estimated total price for all cart items
 */
export function estimateCartTotal(pricing?: { basePrices?: { A4: number; A3: number }; multipliers?: { color: number; doubleSided: number }; additionalServices?: { binding: number } }): number {
    return getCart().reduce((sum, item) => sum + estimateItemPrice(item, pricing), 0);
}

/**
 * Calculate total price for all cart items based on a specific partner's pricing.
 */
export function calculatePartnerCartTotal(partnerPricing: { perPageBW: number; perPageColor: number; binding: number }): number {
    if (!partnerPricing) return 0;
    return getCart().reduce((sum, item) => sum + calculatePartnerItemPrice(item, partnerPricing), 0);
}

/**
 * Update a cart item by ID (for edit flow)
 */
export function updateCartItem(id: string, updates: Partial<CartItem>): CartItem[] {
    const items = getCart().map(item =>
        item.id === id ? { ...item, ...updates } : item
    );
    saveCart(items);
    return items;
}

/**
 * Get a single cart item by ID
 */
export function getCartItem(id: string): CartItem | undefined {
    return getCart().find(item => item.id === id);
}

/**
 * Convert a File object to a data URL for localStorage storage.
 * Note: Large files may exceed localStorage limits (~5-10MB).
 */
export function fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
    });
}

/**
 * Convert a data URL back to a File object
 */
export function dataUrlToFile(dataUrl: string, fileName: string, mimeType: string): File {
    const arr = dataUrl.split(',');
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
    }
    return new File([u8arr], fileName, { type: mimeType });
}

/**
 * Generate a unique ID for cart items
 */
export function generateCartId(): string {
    return `cart_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}
