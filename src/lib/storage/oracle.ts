/**
 * Oracle Cloud Object Storage Provider
 * 
 * Implements the StorageProvider interface for Oracle Cloud Infrastructure (OCI) Object Storage
 * 
 * Benefits:
 * - 20GB free storage (10GB standard + 10GB infrequent access)
 * - No file size limits
 * - No monthly API call limits
 * - Full API access
 */

import * as objectstorage from 'oci-objectstorage';
import * as common from 'oci-common';

import * as fs from 'fs';
import * as path from 'path';
import type { StorageProvider } from '../storage';

export class OracleProvider implements StorageProvider {
  private objectStorageClient: objectstorage.ObjectStorageClient;
  private namespace: string;
  private bucketName: string;
  private region: string;

  constructor() {
    // Validate required environment variables
    const requiredVars = [
      'OCI_TENANCY_OCID',
      'OCI_USER_OCID',
      'OCI_FINGERPRINT',
      'OCI_REGION',
      'OCI_NAMESPACE',
      'OCI_BUCKET_NAME',
    ];

    const missingVars = requiredVars.filter(
      (varName) => !process.env[varName]
    );

    if (missingVars.length > 0) {
      throw new Error(
        `Missing required Oracle Cloud configuration: ${missingVars.join(', ')}`
      );
    }

    this.region = process.env.OCI_REGION!;
    this.namespace = process.env.OCI_NAMESPACE!;
    this.bucketName = process.env.OCI_BUCKET_NAME!;

    // Initialize OCI configuration
    const provider = this.createConfigurationProvider();
    this.objectStorageClient = new objectstorage.ObjectStorageClient({
      authenticationDetailsProvider: provider,
    });

    // Ensure bucket exists (create if it doesn't)
    this.ensureBucketExists().catch((error) => {
      console.error('⚠️ Warning: Could not verify bucket existence:', error);
    });
  }

  /**
   * Create OCI configuration provider from environment variables
   */
  private createConfigurationProvider(): common.SimpleAuthenticationDetailsProvider {
    const tenancyId = process.env.OCI_TENANCY_OCID!;
    const userId = process.env.OCI_USER_OCID!;
    const fingerprint = process.env.OCI_FINGERPRINT!;
    const privateKeyPath = process.env.OCI_PRIVATE_KEY_PATH;
    const privateKeyContent = process.env.OCI_PRIVATE_KEY;

    let privateKey: string;

    if (privateKeyContent) {
      // Use private key from environment variable
      privateKey = privateKeyContent.replace(/\\n/g, '\n');
    } else if (privateKeyPath) {
      // Read private key from file
      const keyPath = privateKeyPath.startsWith('~')
        ? path.join(process.env.HOME || process.env.USERPROFILE || '', privateKeyPath.slice(1))
        : privateKeyPath;
      
      if (!fs.existsSync(keyPath)) {
        throw new Error(`Private key file not found: ${keyPath}`);
      }
      privateKey = fs.readFileSync(keyPath, 'utf8');
    } else {
      throw new Error(
        'Either OCI_PRIVATE_KEY or OCI_PRIVATE_KEY_PATH must be set'
      );
    }

    return new common.SimpleAuthenticationDetailsProvider(
      tenancyId,
      userId,
      fingerprint,
      privateKey,
      null,
      common.Region.fromRegionId(this.region)
    );
  }

  /**
   * Ensure the bucket exists, create it if it doesn't
   */
  private async ensureBucketExists(): Promise<void> {
    try {
      const getBucketRequest: objectstorage.requests.GetBucketRequest = {
        namespaceName: this.namespace,
        bucketName: this.bucketName,
      };

      await this.objectStorageClient.getBucket(getBucketRequest);
      console.log(`✅ Oracle bucket verified: ${this.bucketName}`);
    } catch (error: any) {
      if (error.statusCode === 404) {
        // Bucket doesn't exist, create it
        console.log(`📦 Creating Oracle bucket: ${this.bucketName}`);
        const createBucketRequest: objectstorage.requests.CreateBucketRequest = {
          createBucketDetails: {
            name: this.bucketName,
            compartmentId: process.env.OCI_COMPARTMENT_OCID || process.env.OCI_TENANCY_OCID!,
            publicAccessType: objectstorage.models.CreateBucketDetails.PublicAccessType.NoPublicAccess,
          },
          namespaceName: this.namespace,
        };

        await this.objectStorageClient.createBucket(createBucketRequest);
        console.log(`✅ Oracle bucket created: ${this.bucketName}`);
      } else {
        throw error;
      }
    }
  }

  /**
   * Upload a file to Oracle Object Storage
   */
  async uploadFile(
    buffer: Buffer,
    folder: string = 'print-service',
    mimetype?: string
  ): Promise<string> {
    try {
      console.log(
        `📤 Uploading file to Oracle Object Storage (${buffer.length} bytes) to folder: ${folder}`
      );

      // Generate unique object name
      const timestamp = Date.now();
      const randomId = Math.random().toString(36).substring(2, 11);
      const objectName = `${folder}/document_${timestamp}_${randomId}`;

      // Prepare upload request
      const putObjectRequest: objectstorage.requests.PutObjectRequest = {
        namespaceName: this.namespace,
        bucketName: this.bucketName,
        putObjectBody: buffer,
        objectName: objectName,
        contentLength: buffer.length,
        contentType: mimetype || 'application/octet-stream',
      };

      // Upload the file
      const response = await this.objectStorageClient.putObject(putObjectRequest);

      if (response.opcRequestId) {
        // Generate pre-authenticated URL for file access
        // For public access, we can use the direct URL
        // For private access, we need to create a pre-authenticated request
        const fileUrl = await this.generateFileUrl(objectName);

        console.log(`✅ Oracle upload successful: ${fileUrl}`);
        return fileUrl;
      } else {
        throw new Error('Upload succeeded but no request ID returned');
      }
    } catch (error) {
      console.error('❌ Error uploading to Oracle Object Storage:', error);
      throw new Error(
        `Failed to upload file: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Generate a file URL (pre-authenticated or public)
   */
  private async generateFileUrl(objectName: string): Promise<string> {
    try {
      // Try to create a pre-authenticated request (valid for 1 year)
      const createPreauthenticatedRequestDetails: objectstorage.models.CreatePreauthenticatedRequestDetails = {
        name: `par_${Date.now()}`,
        objectName: objectName,
        accessType: objectstorage.models.CreatePreauthenticatedRequestDetails.AccessType.ObjectRead,
        timeExpires: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
      };

      const createParRequest: objectstorage.requests.CreatePreauthenticatedRequestRequest = {
        namespaceName: this.namespace,
        bucketName: this.bucketName,
        createPreauthenticatedRequestDetails: createPreauthenticatedRequestDetails,
      };

      const parResponse = await this.objectStorageClient.createPreauthenticatedRequest(
        createParRequest
      );

      if (parResponse.preauthenticatedRequest?.accessUri) {
        // Construct full URL
        const regionEndpoint = `https://objectstorage.${this.region}.oraclecloud.com`;
        return `${regionEndpoint}${parResponse.preauthenticatedRequest.accessUri}`;
      }
    } catch (error) {
      console.warn('⚠️ Could not create pre-authenticated request, using direct URL:', error);
    }

    // Fallback to direct URL (requires bucket to be public or proper IAM)
    const regionEndpoint = `https://objectstorage.${this.region}.oraclecloud.com`;
    return `${regionEndpoint}/n/${this.namespace}/b/${this.bucketName}/o/${encodeURIComponent(objectName)}`;
  }

  /**
   * Get a file URL (for display/embedding)
   */
  getFileUrl(fileUrl: string, filename: string = 'document'): string {
    // Oracle URLs are already complete, return as-is
    return fileUrl;
  }

  /**
   * Get a downloadable file URL
   */
  getDownloadableFileUrl(fileUrl: string, filename: string = 'document'): string {
    // Append download parameter if not already present
    const url = new URL(fileUrl);
    url.searchParams.set('download', filename);
    return url.toString();
  }

  /**
   * Delete a file from Oracle Object Storage
   */
  async deleteFile(objectName: string): Promise<void> {
    try {
      // Extract object name from URL if full URL is provided
      let actualObjectName = objectName;
      if (objectName.includes('/o/')) {
        // Extract from Oracle URL format: .../o/objectName
        const parts = objectName.split('/o/');
        if (parts.length > 1) {
          actualObjectName = decodeURIComponent(parts[1].split('?')[0]);
        }
      }

      const deleteObjectRequest: objectstorage.requests.DeleteObjectRequest = {
        namespaceName: this.namespace,
        bucketName: this.bucketName,
        objectName: actualObjectName,
      };

      await this.objectStorageClient.deleteObject(deleteObjectRequest);
      console.log(`✅ File deleted from Oracle: ${actualObjectName}`);
    } catch (error) {
      console.error('Error deleting from Oracle Object Storage:', error);
      throw error;
    }
  }
}

