/**
 * Storage Abstraction Layer
 *
 * Provides a unified interface for file storage operations across multiple providers.
 * Supports Cloudflare R2, Oracle Cloud Object Storage, and Cloudinary.
 */

export interface StorageProvider {
  uploadFile(buffer: Buffer, folder: string, mimetype?: string): Promise<string>;
  getFileUrl(fileUrl: string, filename?: string): string;
  getDownloadableFileUrl(fileUrl: string, filename?: string): string;
  deleteFile(identifier: string): Promise<void>;
}

import { CloudinaryProvider } from './storage/cloudinary';
import { OracleProvider } from './storage/oracle';
import { R2Provider, isR2Configured, type PresignedUploadResult } from './storage/r2';

export { getFileExtension, getMimeType } from './storage/utils';
export { isR2Configured, type PresignedUploadResult };

let storageProvider: StorageProvider | null = null;
let cachedProviderName: string | null = null;

export function resolveStorageProviderName(): 'r2' | 'oracle' | 'cloudinary' {
  const explicit = process.env.STORAGE_PROVIDER?.trim().toLowerCase();
  if (explicit === 'r2') return 'r2';
  if (explicit === 'oracle') return 'oracle';
  if (explicit === 'cloudinary') return 'cloudinary';
  // If STORAGE_PROVIDER is omitted but Cloudflare R2 env vars are configured, prefer R2
  if (isR2Configured()) return 'r2';
  return 'cloudinary';
}

function getStorageProvider(): StorageProvider {
  const providerName = resolveStorageProviderName();
  if (storageProvider && cachedProviderName === providerName) {
    return storageProvider;
  }

  switch (providerName) {
    case 'r2':
      storageProvider = new R2Provider();
      break;
    case 'oracle':
      storageProvider = new OracleProvider();
      break;
    case 'cloudinary':
    default:
      storageProvider = new CloudinaryProvider();
      break;
  }
  cachedProviderName = providerName;
  return storageProvider;
}

/**
 * Create a short-lived presigned PUT URL for direct browser-to-storage uploads (R2).
 * Returns null if the active storage provider does not support presigned browser uploads.
 */
export async function createPresignedUpload(opts: {
  folder?: string;
  fileName?: string;
  contentType?: string;
  expiresInSeconds?: number;
}): Promise<PresignedUploadResult | null> {
  if (resolveStorageProviderName() !== 'r2' || !isR2Configured()) {
    return null;
  }
  const r2 = new R2Provider();
  return r2.createPresignedUpload(opts);
}

/** Upload a file to the configured storage provider. */
export const uploadFile = async (
  buffer: Buffer,
  folder: string = 'print-service',
  mimetype?: string
): Promise<string> => {
  const provider = getStorageProvider();
  return provider.uploadFile(buffer, folder, mimetype);
};

/** Get a file URL (for display/embedding). */
export const getFileUrl = (fileUrl: string, filename: string = 'document'): string => {
  const provider = getStorageProvider();
  return provider.getFileUrl(fileUrl, filename);
};

/** Get a downloadable file URL. */
export const getDownloadableFileUrl = (
  fileUrl: string,
  filename: string = 'document'
): string => {
  const provider = getStorageProvider();
  return provider.getDownloadableFileUrl(fileUrl, filename);
};

/** Delete a file from storage. */
export const deleteFile = async (identifier: string): Promise<void> => {
  const provider = getStorageProvider();
  return provider.deleteFile(identifier);
};

// Export for backward compatibility (legacy function name)
export const uploadToCloudinary = uploadFile;
export const deleteFromCloudinary = deleteFile;
