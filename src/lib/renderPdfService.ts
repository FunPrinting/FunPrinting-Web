/**
 * Render PDF Service Client
 * Handles communication with the Render PDF conversion service at https://render-pdf-service.fly.dev/
 */

const RENDER_SERVICE_URL = process.env.RENDER_SERVICE_URL || 'https://render-pdf-service.fly.dev';

export interface ConversionJob {
  jobId: string;
  status: 'processing' | 'completed' | 'failed';
  wordUrl?: string;
  pdfUrl?: string;
  error?: string;
  progress?: number;
}

/**
 * Request queue to prevent concurrent conversions
 * Processes one conversion at a time to avoid resource conflicts
 */
interface QueuedRequest {
  docxUrl: string;
  timeout: number;
  resolve: (result: { success: boolean; pdfBuffer?: string; error?: string }) => void;
  reject: (error: Error) => void;
}

class ConversionQueue {
  private queue: QueuedRequest[] = [];
  private processing = false;

  async enqueue(
    docxUrl: string,
    timeout: number
  ): Promise<{ success: boolean; pdfBuffer?: string; error?: string }> {
    return new Promise((resolve, reject) => {
      this.queue.push({ docxUrl, timeout, resolve, reject });
      this.processQueue();
    });
  }

  private async processQueue() {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;
    const request = this.queue.shift();

    if (!request) {
      this.processing = false;
      return;
    }

    try {
      const result = await this.executeConversion(request.docxUrl, request.timeout);
      request.resolve(result);
    } catch (error) {
      request.reject(error instanceof Error ? error : new Error('Unknown error'));
    } finally {
      // Add a small delay between requests to prevent overwhelming the service
      await new Promise(resolve => setTimeout(resolve, 500));
      this.processing = false;
      this.processQueue();
    }
  }

  private async executeConversion(
    docxUrl: string,
    timeout: number
  ): Promise<{ success: boolean; pdfBuffer?: string; error?: string }> {
    const serviceUrl = RENDER_SERVICE_URL.replace(/\/+$/, '');
    const convertUrl = `${serviceUrl}/api/convert-sync`;

    console.log(`🔄 Converting DOCX to PDF (sync): ${docxUrl}`);
    console.log(`📡 Render service URL: ${convertUrl}`);
    console.log(`📊 DOCX URL length: ${docxUrl.length} characters`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(convertUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ docxUrl }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        let errorDetails = errorText;
        try {
          const errorJson = JSON.parse(errorText);
          errorDetails = JSON.stringify(errorJson, null, 2);
        } catch {
          // Not JSON, use as-is
        }
        console.error(`❌ Conversion failed: ${response.status}`);
        console.error(`❌ Error details: ${errorDetails}`);
        return {
          success: false,
          error: `Conversion failed: ${response.status}`,
        };
      }

      const result = await response.json();
      
      if (result.success && result.pdfBuffer) {
        console.log(`✅ PDF conversion successful: ${result.size} bytes`);
        return {
          success: true,
          pdfBuffer: result.pdfBuffer,
        };
      } else {
        const errorMsg = result.error || 'Unknown error';
        console.error('❌ Conversion failed:', errorMsg);
        console.error('❌ Full result:', JSON.stringify(result, null, 2));
        return {
          success: false,
          error: errorMsg,
        };
      }
    } catch (fetchError) {
      clearTimeout(timeoutId);
      
      if (fetchError instanceof Error) {
        if (fetchError.name === 'AbortError') {
          console.error('❌ Conversion timeout');
          return {
            success: false,
            error: 'Conversion timeout',
          };
        }
        if (fetchError.message === 'fetch failed') {
          console.error('❌ Conversion service unreachable (fetch failed)');
          return {
            success: false,
            error: 'PDF Conversion Service is currently unreachable or offline.',
          };
        }
      }
      
      throw fetchError;
    }
  }
}

const conversionQueue = new ConversionQueue();

/**
 * Check if error is retryable
 */
function isRetryableError(error: { success: boolean; error?: string }): boolean {
  if (!error.success && error.error) {
    const errorMsg = error.error.toLowerCase();
    // Retry on: timeout, 500 errors, network errors, service unavailable, LibreOffice failures, service not ready
    return (
      errorMsg.includes('timeout') ||
      errorMsg.includes('500') ||
      errorMsg.includes('network') ||
      errorMsg.includes('fetch') ||
      errorMsg.includes('service unavailable') ||
      errorMsg.includes('conversion failed: 500') ||
      errorMsg.includes('libreoffice conversion failed') ||
      errorMsg.includes('service not ready')
    );
  }
  return false;
}

/**
 * Convert DOCX to PDF using Render service (synchronous)
 * Uses request queuing to prevent concurrent conversions and retry logic for transient failures
 * @param docxUrl - URL of the DOCX file to convert
 * @param timeout - Timeout in milliseconds (default: 60000 = 60 seconds)
 * @param retries - Number of retry attempts (default: 3)
 * @returns Promise with PDF buffer as base64 string
 */
export async function convertDocxToPdfSync(
  docxUrl: string,
  timeout: number = 90000, // Increased to 90 seconds to allow for service startup delays
  retries: number = 3
): Promise<{ success: boolean; pdfBuffer?: string; error?: string }> {
  try {
    // Validate DOCX URL
    if (!docxUrl || typeof docxUrl !== 'string') {
      console.error('❌ Invalid DOCX URL provided');
      return {
        success: false,
        error: 'Invalid DOCX URL',
      };
    }

    if (!docxUrl.startsWith('http://') && !docxUrl.startsWith('https://')) {
      console.error('❌ DOCX URL must be an absolute URL');
      return {
        success: false,
        error: 'DOCX URL must be an absolute URL',
      };
    }

    // Check service health before attempting conversion
    console.log('🔍 Checking service health before conversion...');
    const healthCheck = await checkServiceHealth();
    
    if (!healthCheck.available) {
      console.warn('⚠️ Service not available, waiting 2 seconds and retrying health check...');
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const retryHealthCheck = await checkServiceHealth();
      if (!retryHealthCheck.available) {
        console.error('❌ Service still not available after retry');
        return {
          success: false,
          error: `Service unavailable: ${retryHealthCheck.error || 'Health check failed'}`,
        };
      }
      console.log('✅ Service became available after wait');
    } else {
      console.log(`✅ Service is healthy (response time: ${healthCheck.responseTime}ms)`);
    }

    // Use retry logic with exponential backoff
    console.log(`🔄 Starting conversion with ${retries} retry attempts...`);
    
    let lastResult: { success: boolean; pdfBuffer?: string; error?: string } | null = null;
    
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        // Queue the request to prevent concurrent conversions
        const result = await conversionQueue.enqueue(docxUrl, timeout);
        lastResult = result;
        
        // If successful, return immediately
        if (result.success) {
          if (attempt > 0) {
            console.log(`✅ Conversion succeeded on attempt ${attempt + 1}`);
          }
          return result;
        }
        
        // If failed but not retryable, return immediately
        if (!isRetryableError(result)) {
          console.log(`❌ Conversion failed with non-retryable error: ${result.error}`);
          return result;
        }
        
        // If failed but retryable and we have retries left, wait and retry
        if (attempt < retries) {
          const delay = 1000 * Math.pow(2, attempt); // Exponential backoff: 1s, 2s, 4s
          console.log(`⚠️ Conversion attempt ${attempt + 1} failed (${result.error}), retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          // All retries exhausted
          console.error(`❌ All ${retries + 1} conversion attempts failed`);
          return result;
        }
      } catch (error) {
        // If queue throws an error, check if it's retryable
        const errorResult = {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
        lastResult = errorResult;
        
        if (attempt < retries && isRetryableError(errorResult)) {
          const delay = 1000 * Math.pow(2, attempt);
          console.log(`⚠️ Conversion attempt ${attempt + 1} threw error, retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          console.error(`❌ Conversion error (attempt ${attempt + 1}):`, error);
          return errorResult;
        }
      }
    }
    
    // Fallback (shouldn't reach here, but TypeScript needs it)
    return lastResult || {
      success: false,
      error: 'Conversion failed after all retries',
    };
  } catch (error) {
    console.error('❌ Error in PDF conversion:', error);
    let errorMessage = error instanceof Error ? error.message : 'Unknown error';
    if (errorMessage === 'fetch failed') {
      errorMessage = 'PDF Conversion Service is currently unreachable or offline.';
    }
    console.error('❌ Error details:', errorMessage);
    
    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Convert DOCX to PDF using Render service (asynchronous)
 * @param docxUrl - URL of the DOCX file to convert
 * @param callbackUrl - URL to call when conversion is complete
 * @returns Promise with job ID
 */
export async function convertDocxToPdfAsync(
  docxUrl: string,
  callbackUrl?: string
): Promise<{ success: boolean; jobId?: string; error?: string }> {
  try {
    const serviceUrl = RENDER_SERVICE_URL.replace(/\/+$/, '');
    const convertUrl = `${serviceUrl}/api/convert`;

    console.log(`🔄 Converting DOCX to PDF (async): ${docxUrl}`);
    console.log(`📡 Render service URL: ${convertUrl}`);

    const response = await fetch(convertUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        docxUrl,
        callbackUrl,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      console.error(`❌ Conversion request failed: ${response.status} - ${errorText}`);
      return {
        success: false,
        error: `Conversion request failed: ${response.status}`,
      };
    }

    const result = await response.json();
    
    if (result.success && result.jobId) {
      console.log(`✅ Conversion job created: ${result.jobId}`);
      return {
        success: true,
        jobId: result.jobId,
      };
    } else {
      console.error('❌ Conversion job creation failed:', result.error || 'Unknown error');
      return {
        success: false,
        error: result.error || 'Conversion job creation failed',
      };
    }
  } catch (error) {
    console.error('❌ Error creating conversion job:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Check conversion status
 * @param jobId - Job ID from async conversion
 * @returns Promise with conversion status
 */
export async function checkConversionStatus(
  jobId: string
): Promise<ConversionJob> {
  try {
    const serviceUrl = RENDER_SERVICE_URL.replace(/\/+$/, '');
    const statusUrl = `${serviceUrl}/api/status/${jobId}`;

    console.log(`🔍 Checking conversion status: ${jobId}`);

    const response = await fetch(statusUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      console.error(`❌ Status check failed: ${response.status} - ${errorText}`);
      return {
        jobId,
        status: 'failed',
        error: `Status check failed: ${response.status}`,
      };
    }

    const result = await response.json();
    
    return {
      jobId,
      status: result.status || 'processing',
      pdfUrl: result.pdfUrl,
      error: result.error,
      progress: result.progress,
    };
  } catch (error) {
    console.error('❌ Error checking conversion status:', error);
    let errorMsg = error instanceof Error ? error.message : 'Unknown error';
    if (errorMsg === 'fetch failed') {
      errorMsg = 'PDF Conversion Service is currently unreachable or offline.';
    }
    return {
      jobId,
      status: 'failed',
      error: errorMsg,
    };
  }
}

/**
 * Check if Render service is available
 * @returns Promise with availability status
 */
export async function checkServiceHealth(): Promise<{
  available: boolean;
  responseTime?: number;
  error?: string;
}> {
  try {
    const serviceUrl = RENDER_SERVICE_URL.replace(/\/+$/, '');
    const healthUrl = `${serviceUrl}/health`;

    console.log(`🔍 Checking Render service health: ${healthUrl}`);

    const startTime = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(healthUrl, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const responseTime = Date.now() - startTime;

      if (!response.ok) {
        return {
          available: false,
          responseTime,
          error: `Health check failed: ${response.status}`,
        };
      }

      const result = await response.json().catch(() => ({ status: 'ok' }));
      const isHealthy = result.status === 'ok' || result.status === 'healthy' || response.status === 200;

      return {
        available: isHealthy,
        responseTime,
      };
    } catch (fetchError) {
      clearTimeout(timeoutId);
      const responseTime = Date.now() - startTime;

      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        return {
          available: false,
          responseTime,
          error: 'Health check timeout',
        };
      }

      return {
        available: false,
        responseTime,
        error: fetchError instanceof Error ? fetchError.message : 'Unknown error',
      };
    }
  } catch (error) {
    console.error('❌ Error checking service health:', error);
    return {
      available: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

