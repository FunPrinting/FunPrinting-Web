import { NextRequest, NextResponse } from 'next/server';
import { checkTemplateAccess } from '@/lib/payments/templateAccess';
import { fillDocxTemplate } from '@/lib/docxProcessor';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { templateId } = body;
    // Paid templates need a purchase; its stored form data is used
    const access = await checkTemplateAccess(templateId, body.formData, body.paymentRef);
    if (access instanceof NextResponse) return access;
    const formData = body.formData === undefined ? undefined : access.formData;

    if (!templateId || !formData) {
      return NextResponse.json(
        { success: false, error: 'templateId and formData are required' },
        { status: 400 }
      );
    }

    // Fetch template details to get the source DOCX URL and name (server requires absolute URL)
    const origin = new URL(request.url).origin;
    const templateRes = await fetch(`${origin}/api/admin/save-template?id=${encodeURIComponent(templateId)}`);
    if (!templateRes.ok) {
      return NextResponse.json(
        { success: false, error: 'Failed to fetch template details' },
        { status: 404 }
      );
    }
    const templateJson = await templateRes.json();
    if (!templateJson.success || !templateJson.data?.template?.wordUrl) {
      return NextResponse.json(
        { success: false, error: 'Template or wordUrl not found' },
        { status: 404 }
      );
    }

    const template = templateJson.data.template as { name: string; wordUrl: string };

    // Fetch the DOCX file from the wordUrl
    const sourceRes = await fetch(template.wordUrl);
    if (!sourceRes.ok) {
      return NextResponse.json(
        { success: false, error: 'Failed to fetch source DOCX' },
        { status: 400 }
      );
    }
    const sourceBuffer = Buffer.from(await sourceRes.arrayBuffer());

    // Fill the DOCX with form data
    const filledBuffer = await fillDocxTemplate(sourceBuffer, formData);

    const safeName = (template.name || 'document')
      .replace(/[^\w\-\s\.]/g, '')
      .trim()
      .replace(/\s+/g, '-');
    const filename = `${safeName}.docx`;

    return new NextResponse(new Uint8Array(filledBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
        'Content-Length': String(filledBuffer.length),
      },
    });
  } catch (error) {
    console.error('❌ Error generating DOCX download:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to generate document' },
      { status: 500 }
    );
  }
}

// (removed duplicate implementation)
