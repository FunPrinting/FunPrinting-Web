/**
 * HTTPS API Client for PDF Operations
 * Provides methods to upload, fetch, and process PDFs via HTTPS endpoints
 */

export interface PDFUploadResponse {
  success: boolean;
  fileId: string;
  pdfUrl: string;
  fileName: string;
  fileSize: number;
  uploadDate: string;
  message: string;
}

export interface PDFFetchResponse {
  success: boolean;
  fileId?: string;
  pdfUrl: string;
  metadata?: {
    size: number | null;
    type: string | null;
    lastModified: string | null;
    fetchDate: string;
  };
  message: string;
}

export interface PDFConversionResponse {
  success: boolean;
  wordContent?: any;
  pdfBuffer?: string;
  message: string;
}

export class PDFApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = process.env.NEXTAUTH_URL || 'https://www.funprinting.store') {
    this.baseUrl = baseUrl;
  }

  /**
   * Upload PDF file via HTTPS API
   */
  async uploadPDF(file: File, metadata?: { folder?: string; description?: string }): Promise<PDFUploadResponse> {
    try {
      const formData = new FormData();
      formData.append('file', file);
      
      if (metadata) {
        formData.append('metadata', JSON.stringify(metadata));
      }

      const response = await fetch(`${this.baseUrl}/api/pdf/upload`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.status} ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('PDF upload error:', error);
      throw error;
    }
  }

  /**
   * Fetch PDF file via HTTPS API
   */
  async fetchPDF(pdfUrl: string): Promise<Blob> {
    try {
      const response = await fetch(`${this.baseUrl}/api/pdf/fetch?url=${encodeURIComponent(pdfUrl)}`);
      
      if (!response.ok) {
        throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
      }

      return await response.blob();
    } catch (error) {
      console.error('PDF fetch error:', error);
      throw error;
    }
  }

  /**
   * Get PDF metadata via HTTPS API
   */
  async getPDFMetadata(pdfUrl: string, fileId?: string): Promise<PDFFetchResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/api/pdf/fetch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          pdfUrl,
          fileId,
        }),
      });

      if (!response.ok) {
        throw new Error(`Metadata fetch failed: ${response.status} ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('PDF metadata fetch error:', error);
      throw error;
    }
  }

  /**
   * Convert PDF to Word via HTTPS API
   */
  async convertPDFToWord(file?: File, pdfUrl?: string): Promise<PDFConversionResponse> {
    try {
      const formData = new FormData();
      
      if (file) {
        formData.append('file', file);
      } else if (pdfUrl) {
        formData.append('pdfUrl', pdfUrl);
      } else {
        throw new Error('Either file or pdfUrl must be provided');
      }

      const response = await fetch(`${this.baseUrl}/api/convert-pdf-to-word`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`PDF to Word conversion failed: ${response.status} ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('PDF to Word conversion error:', error);
      throw error;
    }
  }

  /**
   * Convert Word to PDF via HTTPS API
   */
  async convertWordToPDF(file?: File, wordUrl?: string): Promise<Blob> {
    try {
      const formData = new FormData();
      
      if (file) {
        formData.append('wordFile', file);
      } else if (wordUrl) {
        formData.append('wordUrl', wordUrl);
      } else {
        throw new Error('Either file or wordUrl must be provided');
      }

      const response = await fetch(`${this.baseUrl}/api/convert-word-to-pdf`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Word to PDF conversion failed: ${response.status} ${response.statusText}`);
      }

      return await response.blob();
    } catch (error) {
      console.error('Word to PDF conversion error:', error);
      throw error;
    }
  }

  /**
   * Replace placeholders in Word document via HTTPS API
   */
  async replacePlaceholders(wordFile: string, placeholders: Record<string, string>): Promise<PDFConversionResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/api/replace-placeholders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          wordFile,
          placeholders,
        }),
      });

      if (!response.ok) {
        throw new Error(`Placeholder replacement failed: ${response.status} ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Placeholder replacement error:', error);
      throw error;
    }
  }

  /**
   * Generate dynamic form configuration via HTTPS API
   */
  async generateDynamicForm(placeholders: string[]): Promise<{ success: boolean; formConfig: any; message: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/api/generate-dynamic-form`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          placeholders,
        }),
      });

      if (!response.ok) {
        throw new Error(`Form generation failed: ${response.status} ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Form generation error:', error);
      throw error;
    }
  }

  /**
   * Generate custom document via HTTPS API
   */
  async generateCustomDocument(templateId: string, formData: Record<string, string>): Promise<PDFConversionResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/api/templates/generate-custom`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          templateId,
          formData,
        }),
      });

      if (!response.ok) {
        throw new Error(`Custom document generation failed: ${response.status} ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Custom document generation error:', error);
      throw error;
    }
  }
}

// Export a default instance
export const pdfApiClient = new PDFApiClient();
