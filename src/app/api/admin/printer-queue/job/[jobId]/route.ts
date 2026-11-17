import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import axios from 'axios';

/**
 * Helper function to safely join URL with path
 */
function joinUrl(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.replace(/\/+$/, '');
  const normalizedPath = path.replace(/^\/+/, '');
  return `${normalizedBase}/${normalizedPath}`;
}

/**
 * DELETE /api/admin/printer-queue/job/[jobId]
 * Delete a job from the printer queue
 */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ jobId: string }> }
) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  try {
    const { jobId } = await context.params;

    const printerUrls: string[] = [];
    const urlsEnv = process.env.PRINTER_API_URLS;
    if (urlsEnv) {
      const trimmed = urlsEnv.trim();
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) {
            printerUrls.push(...parsed);
          }
        } catch {
          const urlMatch = trimmed.match(/\[(.*?)\]/);
          if (urlMatch && urlMatch[1]) {
            printerUrls.push(urlMatch[1].trim());
          }
        }
      } else {
        printerUrls.push(...trimmed.split(',').map(url => url.trim()).filter(url => url.length > 0));
        if (printerUrls.length === 0 && trimmed.length > 0) {
          printerUrls.push(trimmed);
        }
      }
      printerUrls.forEach((url, idx) => {
        printerUrls[idx] = url.replace(/\/+$/, '');
      });
    }

    if (printerUrls.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'No printer API URLs configured'
      }, { status: 400 });
    }

    const printerUrl = printerUrls[0];
    const apiKey = process.env.PRINTER_API_KEY || '';

    try {
      const response = await axios.delete(joinUrl(printerUrl, `/api/queue/job/${jobId}`), {
        headers: {
          'X-API-Key': apiKey
        },
        timeout: 5000
      });

      return NextResponse.json({
        success: response.data.success,
        message: response.data.message || `Job ${jobId} deleted successfully`
      });
    } catch (error: any) {
      console.error('Error deleting job:', error);
      if (error.response?.status === 404) {
        return NextResponse.json({
          success: false,
          error: `Job ${jobId} not found in queue`
        }, { status: 404 });
      }
      return NextResponse.json({
        success: false,
        error: error.response?.data?.error || error.message || 'Failed to delete job'
      }, { status: 500 });
    }
  } catch (error) {
    console.error('Error in delete job endpoint:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete job'
    }, { status: 500 });
  }
}


