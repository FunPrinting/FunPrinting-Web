import axios, { AxiosInstance } from 'axios';
import { IOrder } from '@/models/Order';

export interface PrintJobRequest {
  // Phase 5: Routing
  partnerId?: string;

  // Legacy: single file (for backward compatibility)
  fileUrl?: string;
  fileName?: string;
  fileType?: string;
  // Multiple files support
  fileURLs?: string[];
  originalFileNames?: string[];
  fileTypes?: string[];
  printingOptions: {
    pageSize: 'A4' | 'A3';
    color: 'color' | 'bw' | 'mixed';
    sided: 'single' | 'double';
    copies: number;
    pageCount?: number;
    pageColors?: {
      colorPages: number[];
      bwPages: number[];
    } | Array<{ // Per-file page colors (new format)
      colorPages: number[];
      bwPages: number[];
    }>;
  };
  printerIndex: number;
  orderId?: string;
  customerInfo?: {
    name: string;
    email: string;
    phone: string;
  };
  orderDetails?: {
    orderType: 'file' | 'template';
    pageSize: 'A4' | 'A3';
    color: 'color' | 'bw' | 'mixed';
    sided: 'single' | 'double';
    copies: number;
    pages: number;
    serviceOptions: Array<{
      fileName: string;
      options: string[];
    }>;
    totalAmount: number;
    expectedDelivery: string;
  };
}

export interface PrintJobResponse {
  success: boolean;
  message: string;
  jobId?: string;
  deliveryNumber?: string;
  error?: string;
}

/**
 * Printer API Client
 */
export class PrinterClient {
  private apiUrls: string[];
  private apiKey: string;
  private timeout: number;


  constructor() {
    // Parse PRINTER_API_URLS from environment
    const urlsEnv = process.env.PRINTER_API_URLS;
    if (!urlsEnv) {
      console.warn('PRINTER_API_URLS not configured');
      this.apiUrls = [];
    } else {
      const trimmed = urlsEnv.trim();
      // Check if it looks like a JSON array (starts with [ and ends with ])
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        try {
          this.apiUrls = JSON.parse(trimmed);
          // Ensure it's an array
          if (!Array.isArray(this.apiUrls)) {
            this.apiUrls = [];
          }
        } catch {
          // Invalid JSON array format like [https://...] - extract URL from brackets
          const urlMatch = trimmed.match(/\[(.*?)\]/);
          if (urlMatch && urlMatch[1]) {
            this.apiUrls = [urlMatch[1].trim()];
          } else {
            this.apiUrls = [];
          }
        }
      } else {
        // Not a JSON array - treat as comma-separated string or single URL
        this.apiUrls = trimmed.split(',').map(url => url.trim()).filter(url => url.length > 0);
        // If no commas, treat as single URL
        if (this.apiUrls.length === 0 && trimmed.length > 0) {
          this.apiUrls = [trimmed];
        }
      }

      // Normalize all URLs: remove trailing slashes
      this.apiUrls = this.apiUrls.map(url => url.replace(/\/+$/, ''));
    }

    this.apiKey = process.env.PRINTER_API_KEY || '';
    this.timeout = parseInt(process.env.PRINTER_API_TIMEOUT || '5000', 10);
  }

  /**
   * Create axios instance for a printer API URL
   */
  private createAxiosInstance(baseURL: string): AxiosInstance {
    // Ensure baseURL doesn't have trailing slash to avoid double slashes
    const normalizedBaseURL = baseURL.replace(/\/+$/, '');
    return axios.create({
      baseURL: normalizedBaseURL,
      timeout: this.timeout,
      headers: {
        'X-API-Key': this.apiKey,
        'Content-Type': 'application/json'
      }
    });
  }

  /**
   * Extract error message from axios error
   */
  private extractErrorMessage(error: any): string {
    // Check if it's an axios error with response
    if (error.response) {
      const status = error.response.status;
      const statusText = error.response.statusText;
      const responseData = error.response.data;

      // Try to extract error message from response data
      let errorMessage = '';
      if (responseData) {
        if (typeof responseData === 'string') {
          errorMessage = responseData;
        } else if (responseData.error) {
          errorMessage = responseData.error;
        } else if (responseData.message) {
          errorMessage = responseData.message;
        }
      }

      // Build comprehensive error message
      if (errorMessage) {
        return `${status} ${statusText}: ${errorMessage}`;
      } else {
        return `${status} ${statusText}`;
      }
    }

    // Fall back to error message or default
    return error.message || 'Unknown error';
  }

  /**
   * Select printer API URL based on printer index
   */
  private getPrinterUrl(printerIndex: number): string | null {
    if (this.apiUrls.length === 0) {
      return null;
    }
    // Use modulo to cycle through available printers
    const index = (printerIndex - 1) % this.apiUrls.length;
    return this.apiUrls[index];
  }

  /**
   * Send print job to printer API
   */
  async sendPrintJob(request: PrintJobRequest): Promise<PrintJobResponse> {
    
    // Phase 5 Route: If partnerId is provided, route directly to local WebSocket Engine
    if (request.partnerId) {
      console.log(`☁️ Phase 5: Routing print job to WebSocket Engine for Partner ${request.partnerId}`);
      try {
        const wsResponse = await axios.post('http://localhost:3001/api/dispatch-print-job', {
          partnerId: request.partnerId,
          order: {
            orderId: request.orderId,
            fileURL: request.fileUrl,
            fileURLs: request.fileURLs,
            printingOptions: request.printingOptions
          }
        });
        
        return {
          success: wsResponse.data.success,
          message: wsResponse.data.message || 'Dispatched via WS Engine',
          jobId: request.orderId,
          deliveryNumber: `WS-${Date.now().toString().slice(-4)}`
        };
      } catch (err: any) {
        console.error('❌ Failed to route via WebSocket Engine:', err.message);
        return {
          success: false,
          message: 'WebSocket Engine unavailable',
          error: err.message
        };
      }
    }

    // Legacy Route
    const printerUrl = this.getPrinterUrl(request.printerIndex);

    if (!printerUrl) {
      console.error('No printer API URL available');
      return {
        success: false,
        message: 'No printer API available',
        error: 'PRINTER_API_URLS not configured'
      };
    }

    try {
      console.log(`🖨️ Sending print job to printer API: ${printerUrl}`);
      const axiosInstance = this.createAxiosInstance(printerUrl);

      // Prepare request body - support both single file and multiple files
      const requestBody: any = {
        printingOptions: request.printingOptions,
        printerIndex: request.printerIndex,
        orderId: request.orderId,
        customerInfo: request.customerInfo,
        orderDetails: request.orderDetails
      };

      // Log complete request body including customerInfo and orderDetails
      console.log('📤 Request body being sent to Printer API:', {
        orderId: requestBody.orderId,
        printerIndex: requestBody.printerIndex,
        hasCustomerInfo: !!requestBody.customerInfo,
        customerInfo: requestBody.customerInfo,
        hasOrderDetails: !!requestBody.orderDetails,
        orderDetails: requestBody.orderDetails,
        hasFileURLs: !!request.fileURLs,
        hasFileUrl: !!request.fileUrl
      });

      // If multiple files exist, send arrays
      if (request.fileURLs && request.fileURLs.length > 0) {
        requestBody.fileURLs = request.fileURLs;
        requestBody.originalFileNames = request.originalFileNames || request.fileURLs.map((_, idx) => `File ${idx + 1}`);
        requestBody.fileTypes = request.fileTypes || request.fileURLs.map(() => 'application/octet-stream');
        console.log(`📦 Sending ${request.fileURLs.length} files to printer:`, {
          fileURLs: request.fileURLs,
          originalFileNames: requestBody.originalFileNames,
          fileTypes: requestBody.fileTypes
        });
      } else if (request.fileUrl) {
        // Legacy: single file format
        requestBody.fileUrl = request.fileUrl;
        requestBody.fileName = request.fileName || 'document.pdf';
        requestBody.fileType = request.fileType || 'application/pdf';
        console.log(`📄 Sending single file to printer: ${requestBody.fileName}`);
      } else {
        return {
          success: false,
          message: 'No file URL provided',
          error: 'Either fileUrl or fileURLs must be provided'
        };
      }

      const response = await axiosInstance.post<PrintJobResponse>('/api/print', requestBody);

      // Validate response - check if success is actually true
      if (!response.data || response.data.success !== true) {
        const errorMessage = response.data?.error || response.data?.message || 'Printer API returned unsuccessful response';
        console.error(`❌ Printer API returned unsuccessful response:`, {
          success: response.data?.success,
          message: response.data?.message,
          error: response.data?.error,
          data: response.data
        });

        return {
          success: false,
          message: 'Printer API returned unsuccessful response',
          error: errorMessage
        };
      }

      console.log(`✅ Print job sent successfully: ${response.data.jobId}, Delivery: ${response.data.deliveryNumber || 'N/A'}`);
      return response.data;
    } catch (error: any) {
      // Extract full error details from axios error
      const errorMessage = this.extractErrorMessage(error);
      const statusCode = error.response?.status;
      const statusText = error.response?.statusText;
      const responseData = error.response?.data;

      // Log full error details
      console.error(`❌ Error sending print job to ${printerUrl}:`, {
        message: errorMessage,
        status: statusCode,
        statusText: statusText,
        responseData: responseData,
        error: error.message
      });

      return {
        success: false,
        message: 'Failed to send print job',
        error: errorMessage
      };
    }
  }

  /**
   * Check printer API health
   */
  async checkHealth(printerIndex: number): Promise<{ available: boolean; message: string }> {
    const printerUrl = this.getPrinterUrl(printerIndex);

    if (!printerUrl) {
      return { available: false, message: 'No printer API URL configured' };
    }

    try {
      const axiosInstance = this.createAxiosInstance(printerUrl);
      await axiosInstance.get('/health');
      return { available: true, message: 'Printer API is healthy' };
    } catch (error: any) {
      return { available: false, message: error.message || 'Health check failed' };
    }
  }
}

// Export singleton instance
export const printerClient = new PrinterClient();

/**
 * Generate delivery number based on printer index
 * Format: {LETTER}{YYYYMMDD}{PRINTER_INDEX}{FILE_NUMBER}
 * This is a simplified version - the actual delivery number is generated by the printer API
 * The printer API will add the file number (1-10) at the end
 */
export function generateDeliveryNumber(printerIndex: number): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const dateStr = `${year}${month}${day}`;

  // Start with 'A' for now - actual letter cycling and file number are handled by printer API
  // The printer API will generate the full delivery number with file number
  return `A${dateStr}${printerIndex}0`; // Placeholder - printer API will replace with actual file number
}

// Helper function to detect file type from URL or filename
function getFileTypeFromURL(url: string, fileName: string): string {
  // Try to get extension from filename first
  const fileNameLower = fileName.toLowerCase();
  const urlLower = url.toLowerCase();

  // Extract extension from filename
  const fileNameMatch = fileNameLower.match(/\.([a-z0-9]+)$/);
  if (fileNameMatch) {
    const ext = fileNameMatch[1];
    const mimeTypes: Record<string, string> = {
      // Images
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'webp': 'image/webp',
      'bmp': 'image/bmp',
      'svg': 'image/svg+xml',
      // Documents
      'pdf': 'application/pdf',
      'doc': 'application/msword',
      'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'xls': 'application/vnd.ms-excel',
      'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'ppt': 'application/vnd.ms-powerpoint',
      'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      // Text
      'txt': 'text/plain',
      'rtf': 'application/rtf',
    };

    if (mimeTypes[ext]) {
      return mimeTypes[ext];
    }
  }

  // Try to get extension from URL
  const urlMatch = urlLower.match(/\.([a-z0-9]+)(\?|$)/);
  if (urlMatch) {
    const ext = urlMatch[1];
    const mimeTypes: Record<string, string> = {
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'webp': 'image/webp',
      'bmp': 'image/bmp',
      'svg': 'image/svg+xml',
      'pdf': 'application/pdf',
      'doc': 'application/msword',
      'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };

    if (mimeTypes[ext]) {
      return mimeTypes[ext];
    }
  }

  // Default fallback
  return 'application/octet-stream';
}

/**
 * Send print job from order
 */
export async function sendPrintJobFromOrder(order: IOrder, printerIndex: number): Promise<PrintJobResponse> {
  // Validate required fields
  if (!order.orderType) {
    console.error('❌ Missing required field: orderType');
    return {
      success: false,
      message: 'Order is missing required field: orderType',
      error: 'orderType is required to create order summary'
    };
  }

  // Handle customerInfo fallback: use studentInfo if customerInfo is missing
  // Note: studentInfo might exist in the actual MongoDB document even if not in TypeScript interface
  const customerInfo = order.customerInfo || ((order as any).studentInfo ? {
    name: (order as any).studentInfo.name,
    email: (order as any).studentInfo.email,
    phone: (order as any).studentInfo.phone
  } : undefined);

  if (!customerInfo) {
    console.error('❌ Missing required field: customerInfo or studentInfo');
    return {
      success: false,
      message: 'Order is missing required field: customerInfo or studentInfo',
      error: 'customerInfo or studentInfo is required to create order summary'
    };
  }

  // Log order data before creating printJob
  console.log('📋 Order data before creating printJob:', {
    orderId: order.orderId,
    customerInfo: order.customerInfo,
    studentInfo: (order as any).studentInfo,
    orderType: order.orderType,
    amount: order.amount,
    expectedDate: order.expectedDate,
    hasCustomerInfo: !!order.customerInfo,
    hasStudentInfo: !!(order as any).studentInfo,
    usingCustomerInfo: !!order.customerInfo,
    usingStudentInfo: !order.customerInfo && !!(order as any).studentInfo
  });

  // Check for multiple files first, then fall back to single file
  const hasMultipleFiles = Array.isArray(order.fileURLs) && order.fileURLs.length > 0;
  const hasSingleFile = order.fileURL && !hasMultipleFiles;

  if (!hasMultipleFiles && !hasSingleFile) {
    return {
      success: false,
      message: 'Order has no file URL',
      error: 'File URL is required'
    };
  }

  // If multiple files exist, send them as arrays
  if (hasMultipleFiles) {
    const fileURLs = order.fileURLs!;
    const originalFileNames = Array.isArray(order.originalFileNames)
      ? order.originalFileNames
      : fileURLs.map((_, idx) => `File ${idx + 1}`);

    console.log(`📋 Preparing print job for ${fileURLs.length} files:`, {
      fileURLs,
      originalFileNames,
      orderId: order.orderId
    });

    // Detect file types for each file
    const fileTypes = fileURLs.map((url, idx) => {
      const fileName = originalFileNames[idx] || `File ${idx + 1}`;
      return getFileTypeFromURL(url, fileName);
    });

    // Prepare service options per file
    const serviceOptions: Array<{ fileName: string; options: string[] }> = [];
    const serviceOptionsArray = Array.isArray(order.printingOptions.serviceOptions)
      ? order.printingOptions.serviceOptions
      : (order.printingOptions.serviceOption ? [order.printingOptions.serviceOption] : []);

    // If serviceOptions is per-file array, map each file
    if (Array.isArray(order.printingOptions.serviceOptions) && order.printingOptions.serviceOptions.length === fileURLs.length) {
      originalFileNames.forEach((fileName, idx) => {
        const fileServiceOptions = order.printingOptions.serviceOptions![idx];
        if (fileServiceOptions) {
          serviceOptions.push({
            fileName,
            options: Array.isArray(fileServiceOptions) ? fileServiceOptions : [fileServiceOptions]
          });
        }
      });
    } else {
      // Single service option for all files or per-file array with single element
      originalFileNames.forEach((fileName) => {
        serviceOptions.push({
          fileName,
          options: serviceOptionsArray.length > 0 ? serviceOptionsArray : []
        });
      });
    }

    // Calculate total pages
    const totalPages = order.printingOptions.pageCount || fileURLs.length;

    // Format expected delivery date (with fallback)
    let expectedDelivery = '';
    if (order.expectedDate) {
      const expectedDate = new Date(order.expectedDate);
      expectedDelivery = expectedDate.toLocaleDateString('en-IN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    }

    const printJob: PrintJobRequest = {
      partnerId: order.partnerId,
      fileURLs,
      originalFileNames,
      fileTypes,
      printingOptions: {
        pageSize: order.printingOptions.pageSize,
        color: order.printingOptions.color,
        sided: order.printingOptions.sided,
        copies: order.printingOptions.copies,
        pageCount: order.printingOptions.pageCount || 1,
        pageColors: order.printingOptions.pageColors
      },
      printerIndex,
      orderId: order.orderId,
      customerInfo: customerInfo,
      orderDetails: {
        orderType: order.orderType,
        pageSize: order.printingOptions.pageSize,
        color: order.printingOptions.color,
        sided: order.printingOptions.sided,
        copies: order.printingOptions.copies,
        pages: totalPages,
        serviceOptions: serviceOptions.length > 0 ? serviceOptions : [],
        totalAmount: order.amount || 0,
        expectedDelivery
      }
    };

    // Log printJob after creation
    console.log('✅ Print job request prepared with', fileURLs.length, 'files');
    console.log('📦 PrintJob data:', {
      orderId: printJob.orderId,
      hasCustomerInfo: !!printJob.customerInfo,
      customerInfo: printJob.customerInfo,
      hasOrderDetails: !!printJob.orderDetails,
      orderDetails: printJob.orderDetails
    });

    return await printerClient.sendPrintJob(printJob);
  }

  // Legacy: single file format (backward compatibility)
  const fileName = order.originalFileName || 'document.pdf';

  // Prepare service options for single file
  const serviceOptions: Array<{ fileName: string; options: string[] }> = [];
  const serviceOptionsArray = Array.isArray(order.printingOptions.serviceOptions)
    ? order.printingOptions.serviceOptions
    : (order.printingOptions.serviceOption ? [order.printingOptions.serviceOption] : []);

  serviceOptions.push({
    fileName,
    options: serviceOptionsArray.length > 0 ? serviceOptionsArray : []
  });

  // Calculate total pages
  const totalPages = order.printingOptions.pageCount || 1;

  // Format expected delivery date (with fallback)
  let expectedDelivery = '';
  if (order.expectedDate) {
    const expectedDate = new Date(order.expectedDate);
    expectedDelivery = expectedDate.toLocaleDateString('en-IN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  const printJob: PrintJobRequest = {
    partnerId: order.partnerId,
    fileUrl: order.fileURL!,
    fileName,
    fileType: order.fileType || getFileTypeFromURL(order.fileURL!, fileName),
    printingOptions: {
      pageSize: order.printingOptions.pageSize,
      color: order.printingOptions.color,
      sided: order.printingOptions.sided,
      copies: order.printingOptions.copies,
      pageCount: order.printingOptions.pageCount || 1,
      pageColors: order.printingOptions.pageColors
    },
    printerIndex,
    orderId: order.orderId,
    customerInfo: customerInfo,
    orderDetails: {
      orderType: order.orderType,
      pageSize: order.printingOptions.pageSize,
      color: order.printingOptions.color,
      sided: order.printingOptions.sided,
      copies: order.printingOptions.copies,
      pages: totalPages,
      serviceOptions: serviceOptions.length > 0 ? serviceOptions : [],
      totalAmount: order.amount || 0,
      expectedDelivery
    }
  };

  // Log printJob after creation
  console.log('✅ Print job request prepared for single file');
  console.log('📦 PrintJob data:', {
    orderId: printJob.orderId,
    hasCustomerInfo: !!printJob.customerInfo,
    customerInfo: printJob.customerInfo,
    hasOrderDetails: !!printJob.orderDetails,
    orderDetails: printJob.orderDetails
  });

  return await printerClient.sendPrintJob(printJob);
}

