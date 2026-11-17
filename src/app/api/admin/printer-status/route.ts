import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { printerClient } from '@/lib/printerClient';
import axios from 'axios';

/**
 * Helper function to safely join URL with path, avoiding double slashes
 */
function joinUrl(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.replace(/\/+$/, ''); // Remove trailing slashes
  const normalizedPath = path.replace(/^\/+/, ''); // Remove leading slashes
  return `${normalizedBase}/${normalizedPath}`;
}

/**
 * GET /api/admin/printer-status
 * Get printer API status and queue information
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const printerIndex = parseInt(searchParams.get('printerIndex') || '1', 10);

    // Get printer API URLs
    let printerUrls: string[] = [];
    const urlsEnv = process.env.PRINTER_API_URLS;
    if (urlsEnv) {
      const trimmed = urlsEnv.trim();
      // Check if it looks like a JSON array (starts with [ and ends with ])
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        try {
          printerUrls = JSON.parse(trimmed);
          // Ensure it's an array
          if (!Array.isArray(printerUrls)) {
            printerUrls = [];
          }
        } catch {
          // Invalid JSON array format like [https://...] - extract URL from brackets
          const urlMatch = trimmed.match(/\[(.*?)\]/);
          if (urlMatch && urlMatch[1]) {
            printerUrls = [urlMatch[1].trim()];
          } else {
            printerUrls = [];
          }
        }
      } else {
        // Not a JSON array - treat as comma-separated string or single URL
        printerUrls = trimmed.split(',').map(url => url.trim()).filter(url => url.length > 0);
        // If no commas, treat as single URL
        if (printerUrls.length === 0 && trimmed.length > 0) {
          printerUrls = [trimmed];
        }
      }

      // Normalize all URLs: remove trailing slashes
      printerUrls = printerUrls.map(url => url.replace(/\/+$/, ''));
    }

    if (printerUrls.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'No printer API URLs configured'
      });
    }

    // Get printer URL for the index
    const printerUrl = printerUrls[(printerIndex - 1) % printerUrls.length];
    const apiKey = process.env.PRINTER_API_KEY || '';

    // Fetch printer API health and queue status
    let printerHealth = { available: false, message: 'Not checked' };
    let queueStatus = { total: 0, pending: 0, jobs: [] };
    let printerApiHealth: any = { status: 'unknown', timestamp: new Date().toISOString() };

    try {
      // Check health endpoint (no auth required)
      const healthResponse = await axios.get(joinUrl(printerUrl, '/health'), {
        timeout: 5000
      });
      printerApiHealth = healthResponse.data;
    } catch (error: any) {
      printerApiHealth = {
        status: 'unhealthy',
        error: error.message || 'Health check failed',
        timestamp: new Date().toISOString()
      };
    }

    try {
      // Check queue status (requires auth)
      const queueResponse = await axios.get(joinUrl(printerUrl, '/api/queue/status'), {
        headers: {
          'X-API-Key': apiKey
        },
        timeout: 5000
      });

      if (queueResponse.data.success) {
        queueStatus = queueResponse.data;
      }
    } catch (error: any) {
      console.error('Error fetching queue status:', error.message);
      // Continue without queue status
    }

    // Check printer client health
    printerHealth = await printerClient.checkHealth(printerIndex);

    return NextResponse.json({
      success: true,
      printerIndex,
      printerUrl,
      printerApi: {
        health: printerApiHealth,
        queue: queueStatus
      },
      funPrinting: {
        printerHealth
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error getting printer status:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get printer status'
      },
      { status: 500 }
    );
  }
}

