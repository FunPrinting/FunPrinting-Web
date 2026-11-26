/**
 * Cloudflare R2 Storage Provider (S3-compatible)
 *
 * Implements StorageProvider plus presigned direct browser uploads so files up to 50 MB+
 * upload straight from the browser to R2 without hitting Vercel's 4.5 MB request body limit.
 */

import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { StorageProvider } from '../storage';

export interface PresignedUploadResult {
  uploadUrl: string;
  fileUrl: string;
  key: string;
}

function getR2Config() {
  const accountId = process.env.R2_ACCOUNT_ID?.trim();
  const endpoint = process.env.R2_ENDPOINT?.trim() || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : '');
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim() || '';
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim() || '';
  const bucketName = process.env.R2_BUCKET_NAME?.trim() || '';
  const publicUrl = process.env.R2_PUBLIC_URL?.trim().replace(/\/+$/, '') || '';
  return { accountId, endpoint, accessKeyId, secretAccessKey, bucketName, publicUrl };
}

export function isR2Configured(): boolean {
  const cfg = getR2Config();
  return Boolean(cfg.endpoint && cfg.accessKeyId && cfg.secretAccessKey && cfg.bucketName);
}

const MIME_EXT: Record<string, string> = {
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/bmp': '.bmp',
  'image/tiff': '.tiff',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
};

function safeExt(fileName?: string, mimetype?: string): string {
  if (fileName) {
    const match = fileName.toLowerCase().match(/(\.[a-z0-9]{1,8})$/);
    if (match) return match[1];
  }
  if (mimetype && MIME_EXT[mimetype]) return MIME_EXT[mimetype];
  return '';
}

function cleanFolder(folder: string): string {
  return folder.replace(/^\/+|\/+$/g, '').replace(/[^a-zA-Z0-9/_-]/g, '') || 'print-service';
}

export class R2Provider implements StorageProvider {
  private client: S3Client;
  private bucketName: string;
  private publicUrl: string;

  constructor() {
    const cfg = getR2Config();
    if (!cfg.endpoint || !cfg.accessKeyId || !cfg.secretAccessKey || !cfg.bucketName) {
      throw new Error(
        'Missing required Cloudflare R2 configuration (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME).'
      );
    }
    this.bucketName = cfg.bucketName;
    this.publicUrl = cfg.publicUrl;
    this.client = new S3Client({
      region: 'auto',
      endpoint: cfg.endpoint,
      credentials: {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
      },
    });
  }

  private async resolveReadUrl(key: string): Promise<string> {
    if (this.publicUrl) {
      return `${this.publicUrl}/${key}`;
    }
    // Fallback when R2_PUBLIC_URL isn't configured: 7-day presigned GET URL
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucketName, Key: key }),
      { expiresIn: 7 * 24 * 60 * 60 }
    );
  }

  async uploadFile(
    buffer: Buffer,
    folder: string = 'print-service',
    mimetype?: string
  ): Promise<string> {
    const ext = safeExt(undefined, mimetype);
    const key = `${cleanFolder(folder)}/document_${Date.now()}_${Math.random().toString(36).slice(2, 11)}${ext}`;

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: buffer,
        ContentLength: buffer.length,
        ContentType: mimetype || 'application/octet-stream',
      })
    );

    return this.resolveReadUrl(key);
  }

  async createPresignedUpload(opts: {
    folder?: string;
    fileName?: string;
    contentType?: string;
    expiresInSeconds?: number;
  }): Promise<PresignedUploadResult> {
    const ext = safeExt(opts.fileName, opts.contentType);
    const folder = cleanFolder(opts.folder || 'print-service');
    const key = `${folder}/document_${Date.now()}_${Math.random().toString(36).slice(2, 11)}${ext}`;
    const contentType = opts.contentType || 'application/octet-stream';

    const uploadUrl = await getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        ContentType: contentType,
      }),
      { expiresIn: opts.expiresInSeconds ?? 300 }
    );

    const fileUrl = await this.resolveReadUrl(key);
    return { uploadUrl, fileUrl, key };
  }

  getFileUrl(fileUrl: string): string {
    return fileUrl;
  }

  getDownloadableFileUrl(fileUrl: string, filename: string = 'document'): string {
    try {
      const url = new URL(fileUrl);
      url.searchParams.set('download', filename);
      return url.toString();
    } catch {
      return fileUrl;
    }
  }

  async deleteFile(identifier: string): Promise<void> {
    let key = identifier;
    if (identifier.startsWith('http://') || identifier.startsWith('https://')) {
      try {
        const url = new URL(identifier);
        key = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
        if (key.startsWith(`${this.bucketName}/`)) {
          key = key.slice(this.bucketName.length + 1);
        }
      } catch {
        // Use identifier as raw key
      }
    }
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      })
    );
  }
}

