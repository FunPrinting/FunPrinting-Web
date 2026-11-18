import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import DynamicTemplate from '@/models/DynamicTemplate';
import { uploadFile } from '@/lib/storage';
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType } from 'docx';
import { v4 as uuidv4 } from 'uuid';
import { getCurrentUser } from '@/lib/templateAuth';
import User from '@/models/User';
import { extractPlaceholders, generateFormSchema } from '@/lib/docxProcessor';
import { fetchTrustedFile, isTrustedFileUrl } from '@/lib/documents/fileUrls';

const TEMPLATE_MAX_BYTES = 20 * 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    const { 
      templateName, 
      wordContent, 
      placeholders, 
      description, 
      category, 
      pdfUrl,
      isPublic,
      isPaid,
      price,
      allowFreeDownload,
    } = await request.json();

    if (!templateName || !wordContent) {
      return NextResponse.json(
        { success: false, error: 'Template name and content are required' },
        { status: 400 }
      );
    }

    // Get current user from session
    const session = await getCurrentUser();
    if (!session || !session.email) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    await connectDB();

    // Get user details
    const user = await User.findOne({ email: session.email.toLowerCase() });
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 404 }
      );
    }

    // Check if user has payout info for paid templates
    const hasPayoutInfo = !!(user.upiId || user.bankDetails?.accountNumber);
    
    // Validate and sanitize monetization fields
    const safeIsPaid = !!isPaid && hasPayoutInfo && (price ?? 0) > 0;
    const safePrice = safeIsPaid ? Math.max(0, Number(price) || 0) : 0;
    const safeAllowFreeDownload = allowFreeDownload === false ? false : true;
    const safeIsPublic = !!isPublic;

    // If user tried to set isPaid but doesn't have payout info, return error
    if (isPaid && !hasPayoutInfo) {
      return NextResponse.json(
        { success: false, error: 'Please set up payout settings before creating a paid template' },
        { status: 400 }
      );
    }

    // If isPaid but price is invalid
    if (isPaid && (price ?? 0) <= 0) {
      return NextResponse.json(
        { success: false, error: 'Please enter a valid price greater than 0 for a paid template' },
        { status: 400 }
      );
    }

    // Generate unique template ID
    const templateId = uuidv4();

    let wordUrl: string | undefined;
    let finalPlaceholders: string[] | undefined;
    let formSchema: any[] | undefined;

    // Check if pdfUrl (uploaded DOCX) is provided
    if (pdfUrl) {
      console.log('📄 Using uploaded Word file directly...');
      
      try {
        // Download DOCX from pdfUrl
        // Only our own storage (the file was uploaded through /api/upload-raw-file)
        const { buffer: docxBuffer } = await fetchTrustedFile(pdfUrl, { maxBytes: TEMPLATE_MAX_BYTES });
        console.log(`✅ DOCX downloaded: ${docxBuffer.length} bytes`);

        // PRIORITIZE placeholders from frontend (more accurate, handles split placeholders)
        // Only re-extract if placeholders not provided from frontend
        let extractedPlaceholders: string[] = [];
        if (placeholders && Array.isArray(placeholders) && placeholders.length > 0) {
          console.log(`[CREATE] Using placeholders from frontend:`, placeholders);
          extractedPlaceholders = placeholders;
        } else {
          // Fallback: Extract placeholders from uploaded DOCX
          console.log('🔍 Extracting placeholders from uploaded DOCX (fallback)...');
          extractedPlaceholders = await extractPlaceholders(docxBuffer);
          console.log(`[CREATE] Extracted ${extractedPlaceholders.length} placeholders from DOCX:`, extractedPlaceholders);
        }
        console.log(`[CREATE] Final placeholders to use:`, extractedPlaceholders);
        console.log(`[CREATE] Placeholder keys:`, extractedPlaceholders.map(p => p));

        // Upload DOCX directly to storage (no generation)
        console.log('☁️ Uploading original DOCX file to storage...');
        wordUrl = await uploadFile(
          docxBuffer,
          `templates/word/${templateId}`,
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        );
        console.log('✅ Original DOCX file uploaded to cloud storage:', wordUrl);

        // Generate formSchema from placeholders (prioritize frontend placeholders)
        const schemaObject = generateFormSchema(extractedPlaceholders);
        console.log(`[CREATE] Generated formSchema object keys:`, Object.keys(schemaObject));
        formSchema = Object.entries(schemaObject).map(([key, value]) => ({
          key,
          ...value,
          defaultPlaceholder: value.defaultPlaceholder || value.placeholder || `Enter ${key}`
        }));
        console.log(`[CREATE] FormSchema array (${formSchema.length} fields):`, formSchema.map(f => ({ key: f.key, label: f.label })));
        console.log(`[CREATE] FormSchema keys array:`, formSchema.map(f => f.key));

        // Use placeholders (from frontend or extracted)
        finalPlaceholders = extractedPlaceholders;

      } catch (error) {
        console.error('❌ Error processing uploaded DOCX:', error);
        // Fallback to generation if upload processing fails
        console.log('⚠️ Falling back to generation from wordContent...');
        wordUrl = undefined; // Ensure it's undefined for fallback
        finalPlaceholders = undefined;
        formSchema = undefined;
      }
    }

    // Fallback: Generate from wordContent if pdfUrl not provided or processing failed
    if (!wordUrl || !finalPlaceholders || !formSchema) {
      console.log('📄 Creating Word document from template content...');

      // Create Word document from the structured content
      const doc = new Document({
        sections: [{
          properties: {},
          children: [
            // Add paragraphs
            ...wordContent.paragraphs.map((p: any) => {
              if (p.style === 'heading') {
                return new Paragraph({
                  children: [new TextRun({
                    text: p.text,
                    bold: true,
                    size: p.level === 1 ? 32 : p.level === 2 ? 28 : 24
                  })]
                });
              } else {
                return new Paragraph({
                  children: [new TextRun({
                    text: p.text,
                    size: 20,
                    color: p.isPlaceholder ? "FF0000" : undefined,
                    bold: p.isPlaceholder ? true : undefined
                  })]
                });
              }
            }),
            
            // Add tables
            ...wordContent.tables.map((table: any) => {
              return new Table({
                width: {
                  size: 100,
                  type: WidthType.PERCENTAGE,
                },
                rows: [
                  // Header row
                  new TableRow({
                    children: table.headers.map((header: string) => 
                      new TableCell({
                        children: [new Paragraph({
                          children: [new TextRun({
                            text: header,
                            bold: true
                          })]
                        })]
                      })
                    )
                  }),
                  // Data rows
                  ...table.rows.map((row: string[]) =>
                    new TableRow({
                      children: row.map((cell: string) =>
                        new TableCell({
                          children: [new Paragraph({
                            children: [new TextRun({
                              text: cell,
                              color: cell.includes('@') ? "FF0000" : undefined,
                              bold: cell.includes('@') ? true : undefined
                            })]
                          })]
                        })
                      )
                    })
                  )
                ]
              });
            })
          ]
        }]
      });

      // Generate Word document buffer
      const wordBuffer = await Packer.toBuffer(doc);
      
      console.log('✅ Word document created, size:', wordBuffer.length, 'bytes');

      // Upload Word document to storage
      wordUrl = await uploadFile(
        wordBuffer,
        `templates/word/${templateId}`,
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      );

      console.log('✅ Word document uploaded to cloud storage:', wordUrl);

      // Use placeholders from request or empty array
      finalPlaceholders = placeholders || [];
      
      // Generate formSchema from placeholders if provided
      if (finalPlaceholders && finalPlaceholders.length > 0) {
        const schemaObject = generateFormSchema(finalPlaceholders);
        formSchema = Object.entries(schemaObject).map(([key, value]) => ({
          key,
          ...value,
          defaultPlaceholder: value.defaultPlaceholder || value.placeholder || `Enter ${key}`
        }));
      } else {
        formSchema = [];
      }
    }

    // Ensure all variables are defined
    if (!wordUrl) {
      throw new Error('Failed to create or upload Word document');
    }
    if (!finalPlaceholders) {
      finalPlaceholders = [];
    }
    if (!formSchema) {
      formSchema = [];
    }

    // Create new dynamic template with user context and monetization
    console.log(`[CREATE] Saving to database: placeholders=[${finalPlaceholders?.length || 0}], formSchema=[${formSchema?.length || 0}]`);
    console.log(`[CREATE] Placeholders to save:`, finalPlaceholders);
    console.log(`[CREATE] FormSchema keys to save:`, formSchema?.map(f => f.key) || []);
    
    const template = new DynamicTemplate({
      id: templateId,
      name: templateName,
      description: description || 'Dynamic template',
      category: category || 'other',
      // Stored only when it is our own file (it is downloaded again later)
      pdfUrl: isTrustedFileUrl(pdfUrl) ? pdfUrl : '',
      wordUrl: wordUrl,
      wordContent: wordContent, // Keep JSON structure for backward compatibility
      placeholders: finalPlaceholders || [],
      formSchema: formSchema || [],
      createdBy: user.email, // Backward compatible
      createdByUserId: user._id,
      createdByEmail: user.email,
      createdByName: user.name,
      isPublic: safeIsPublic,
      createdByType: 'user',
      // Monetization fields
      isPaid: safeIsPaid,
      price: safePrice,
      allowFreeDownload: safeAllowFreeDownload,
      creatorPayoutMethod: user.upiId ? 'upi' : (user.bankDetails?.accountNumber ? 'bank' : undefined),
      creatorUpiId: user.upiId,
      creatorBankDetails: user.bankDetails,
    });

    await template.save();

    // Verify what was actually saved
    const savedTemplate = await DynamicTemplate.findOne({ id: templateId });
    console.log(`[CREATE] ✅ Template saved to database: ${templateId}`);
    console.log(`[CREATE] Verified saved placeholders:`, savedTemplate?.placeholders);
    console.log(`[CREATE] Verified saved formSchema count:`, savedTemplate?.formSchema?.length || 0);
    console.log(`[CREATE] Verified saved formSchema keys:`, savedTemplate?.formSchema?.map((f: any) => f.key) || []);

    return NextResponse.json({
      success: true,
      templateId: templateId,
      wordUrl: wordUrl,
      message: 'Template saved successfully with Word file in cloud storage'
    });

  } catch (error) {
    console.error('Error saving template:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to save template' },
      { status: 500 }
    );
  }
}

