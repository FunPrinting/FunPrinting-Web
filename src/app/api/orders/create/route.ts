import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import Order from '@/models/Order';
import { createRazorpayOrder } from '@/lib/razorpay';
import { validateOrderData, sanitizeOrderData, handleOrderError, logOrderEvent } from '@/lib/orderUtils';
import { sendNewOrderNotification, sendCustomerOrderConfirmation } from '@/lib/notificationService';
import { getFileTypeFromFilename } from '@/lib/fileTypeDetection';
import { orderCreationRateLimit, getClientIdentifier, checkRateLimit } from '@/lib/ratelimit';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export async function POST(request: NextRequest) {
  // Rate limit check
  const clientId = getClientIdentifier(request);
  const rateLimitResponse = await checkRateLimit(orderCreationRateLimit, clientId);
  if (rateLimitResponse) return rateLimitResponse;

  // Authentication check — only signed-in users can create orders
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json(
      { success: false, error: 'Authentication required. Please sign in to place an order.' },
      { status: 401 }
    );
  }

  try {
    await connectDB();

    // Check if this is a new template order (with templateId)
    const contentType = request.headers.get('content-type');

    if (contentType?.includes('application/json')) {
      const body = await request.json();

      // Check if this is a new template order
      if (body.templateId && body.formData) {
        console.log('🔄 Detected new template order, routing to template endpoint...');

        try {
          // Route to our new template order endpoint
          const templateOrderResponse = await fetch(`${process.env.NEXTAUTH_URL || 'https://www.funprinting.store'}/api/orders/template`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
          });

          if (templateOrderResponse.ok) {
            const templateResult = await templateOrderResponse.json();
            return NextResponse.json(templateResult);
          } else {
            const errorResult = await templateOrderResponse.json();
            logOrderEvent('template_order_routing_failed', 'unknown', {
              status: templateOrderResponse.status,
              error: errorResult.error
            }, 'error');
            return NextResponse.json(errorResult, { status: templateOrderResponse.status });
          }
        } catch (error) {
          logOrderEvent('template_order_routing_error', 'unknown', {
            error: error instanceof Error ? error.message : 'Unknown error'
          }, 'error');
          return NextResponse.json(
            { success: false, error: 'Template order processing failed. Please try again.' },
            { status: 500 }
          );
        }
      }
    }

    // Continue with existing order processing for file orders and legacy template orders

    let customerInfo, orderType, fileURL, fileType, originalFileName, templateData, printingOptions, deliveryOption, expectedDate;
    let fileURLs: string[] | undefined, originalFileNames: string[] | undefined, fileTypes: string[] | undefined;

    if (contentType?.includes('multipart/form-data')) {
      // Handle file upload
      const formData = await request.formData();
      const file = formData.get('file') as File;
      orderType = formData.get('orderType') as string;
      customerInfo = JSON.parse(formData.get('customerInfo') as string);
      printingOptions = JSON.parse(formData.get('printingOptions') as string);
      deliveryOption = JSON.parse(formData.get('deliveryOption') as string);
      templateData = formData.get('templateData') ? JSON.parse(formData.get('templateData') as string) : null;
      expectedDate = formData.get('expectedDate') as string;

      // Debug: Log the parsed data
      console.log('🔍 DEBUG - Parsed FormData:');
      console.log('  - customerInfo:', JSON.stringify(customerInfo, null, 2));
      console.log('  - printingOptions:', JSON.stringify(printingOptions, null, 2));
      console.log('  - deliveryOption:', JSON.stringify(deliveryOption, null, 2));
      console.log('  - expectedDate:', expectedDate);

      // Upload file to storage if it's a file order
      if (orderType === 'file' && file) {
        try {
          const { uploadFile } = await import('@/lib/storage');
          const bytes = await file.arrayBuffer();
          const buffer = Buffer.from(bytes);
          fileURL = await uploadFile(buffer, 'print-service', file.type);
          console.log(`File uploaded successfully to: ${fileURL}`);

          // Store file type and original filename for later use
          fileType = file.type;
          originalFileName = file.name;
          console.log(`File type: ${fileType}, Original filename: ${originalFileName}`);
        } catch (error) {
          console.error('Error uploading file:', error);
          throw new Error('Failed to upload file');
        }
      }
    } else {
      // Handle JSON data (for template orders or pre-uploaded files)
      const body = await request.json();
      ({
        customerInfo,
        orderType,
        fileURL,
        fileURLs, // Support for multiple files
        originalFileName,
        originalFileNames, // Support for multiple file names
        fileTypes, // Support for multiple file types
        templateData,
        printingOptions,
        deliveryOption,
        expectedDate
      } = body as any);

      // Use fileURLs if available, otherwise fall back to fileURL for backward compatibility
      if (fileURLs && fileURLs.length > 0) {
        fileURL = fileURLs[0]; // Set first file as legacy fileURL
      }

      // Debug: Log the parsed JSON data
      console.log('🔍 DEBUG - Parsed JSON:');
      console.log('  - customerInfo:', JSON.stringify(customerInfo, null, 2));
      console.log('  - printingOptions:', JSON.stringify(printingOptions, null, 2));
      console.log('  - deliveryOption:', JSON.stringify(deliveryOption, null, 2));
      console.log('  - fileURLs:', fileURLs?.length || 0, 'files');
    }

    // Sanitize and validate order data
    const sanitizedOrderData = sanitizeOrderData({
      customerInfo,
      orderType,
      fileURL,
      fileType,
      originalFileName,
      templateData,
      printingOptions,
      deliveryOption,
      expectedDate
    });

    // Validate order data
    const validation = validateOrderData(sanitizedOrderData);
    if (!validation.isValid) {
      logOrderEvent('validation_failed', 'unknown', { errors: validation.errors }, 'warn');
      return NextResponse.json(
        {
          success: false,
          error: 'Order validation failed',
          details: validation.errors
        },
        { status: 400 }
      );
    }

    let amount = 0;

    // Use pageCount from frontend
    const pageCount = printingOptions.pageCount || 1;
    console.log(`📥 Backend received pageCount: ${pageCount}`);

    // Calculate amount based on printing options AND page count using pricing from database
    const { getPricing } = await import('@/lib/pricing');
    const pricing = await getPricing();

    const basePrice = pricing.basePrices[printingOptions.pageSize as keyof typeof pricing.basePrices];
    const sidedMultiplier = printingOptions.sided === 'double' ? pricing.multipliers.doubleSided : 1;

    // Calculate total amount based on color option
    if (printingOptions.color === 'mixed' && printingOptions.pageColors) {
      // Mixed color pricing: calculate separately for color and B&W pages
      const colorPages = printingOptions.pageColors.colorPages.length;
      const bwPages = printingOptions.pageColors.bwPages.length;

      // If not all pages are specified, treat unspecified pages as B&W
      const unspecifiedPages = pageCount - (colorPages + bwPages);
      const totalBwPages = bwPages + (unspecifiedPages > 0 ? unspecifiedPages : 0);

      const colorCost = basePrice * colorPages * pricing.multipliers.color;
      const bwCost = basePrice * totalBwPages;

      amount = (colorCost + bwCost) * sidedMultiplier * printingOptions.copies;

      console.log(`🔍 Mixed color pricing calculation:`);
      console.log(`  - Color pages: ${colorPages} (₹${colorCost})`);
      console.log(`  - B&W pages: ${totalBwPages} (₹${bwCost})`);
      console.log(`  - Unspecified pages treated as B&W: ${unspecifiedPages}`);
    } else {
      // Standard pricing for all color or all B&W
      const colorMultiplier = printingOptions.color === 'color' ? pricing.multipliers.color : 1;
      amount = basePrice * pageCount * colorMultiplier * sidedMultiplier * printingOptions.copies;
    }

    // Add compulsory service option cost (only for multi-page jobs)
    if (pageCount > 1) {
      if (printingOptions.serviceOption === 'binding') {
        amount += pricing.additionalServices.binding;
      } else if (printingOptions.serviceOption === 'file') {
        amount += 10; // File handling fee (keep pages inside file)
      } else if (printingOptions.serviceOption === 'service') {
        amount += 5; // Minimal service fee
      }
    }

    // Add delivery charge if delivery option is selected
    if (deliveryOption.type === 'delivery' && deliveryOption.deliveryCharge) {
      amount += deliveryOption.deliveryCharge;
    }

    console.log(`🔍 BACKEND CALCULATION DEBUG:`);
    console.log(`  - Base Price (${printingOptions.pageSize}): ₹${basePrice}`);
    console.log(`  - Page Count: ${pageCount}`);
    console.log(`  - Color Option: ${printingOptions.color}`);

    if (printingOptions.color === 'mixed' && printingOptions.pageColors) {
      console.log(`  - Color Pages: ${printingOptions.pageColors.colorPages.length} pages (₹${basePrice * printingOptions.pageColors.colorPages.length * pricing.multipliers.color})`);
      console.log(`  - B&W Pages: ${printingOptions.pageColors.bwPages.length} pages (₹${basePrice * printingOptions.pageColors.bwPages.length})`);
    } else {
      const colorMultiplier = printingOptions.color === 'color' ? pricing.multipliers.color : 1;
      console.log(`  - Color Multiplier: ${colorMultiplier}x`);
    }

    console.log(`  - Sided (${printingOptions.sided}): ${sidedMultiplier}x`);
    console.log(`  - Copies: ${printingOptions.copies}`);
    console.log(`  - Service Option: ${pageCount > 1 ? printingOptions.serviceOption : 'N/A (single page)'}`);
    if (pageCount > 1) {
      if (printingOptions.serviceOption === 'binding') {
        console.log(`  - Binding Cost: ₹${pricing.additionalServices.binding}`);
      } else if (printingOptions.serviceOption === 'file') {
        console.log(`  - File Handling Cost: ₹10`);
      } else if (printingOptions.serviceOption === 'service') {
        console.log(`  - Service Fee: ₹5`);
      }
    }
    console.log(`  - Delivery: ${deliveryOption.type === 'delivery' ? `₹${deliveryOption.deliveryCharge}` : 'Free pickup'}`);
    console.log(`  - Total: ₹${amount}`);

    // Add 3% Razorpay processing fee (disclosed to customer on order page)
    // This ensures we receive at least the base amount after Razorpay's 2% fee deduction
    const RAZORPAY_FEE_PERCENT = 3;
    const baseAmount = amount;
    const finalAmount = Math.round(baseAmount * (1 + RAZORPAY_FEE_PERCENT / 100));
    const razorpayFee = finalAmount - baseAmount;

    console.log(`💳 Razorpay fee calculation:`);
    console.log(`  - Base amount: ₹${baseAmount}`);
    console.log(`  - Razorpay fee (${RAZORPAY_FEE_PERCENT}%): ₹${razorpayFee}`);
    console.log(`  - Final amount (with fee): ₹${finalAmount}`);

    // Create Razorpay order with final amount (including hidden fee)
    const razorpayOrder = await createRazorpayOrder({
      amount: finalAmount,
      receipt: `order_${Date.now()}`,
      notes: {
        orderType,
        customerName: customerInfo.name,
        pageCount: pageCount.toString(),
        amount: baseAmount.toString(), // Store original amount in notes
        razorpayFee: razorpayFee.toString(), // Store fee for tracking
      },
    });

    // Validate required fields
    if (!customerInfo.name || !customerInfo.phone || !customerInfo.email) {
      throw new Error('Missing required fields: name, phone, and email are required');
    }

    // Fetch pickup location details if pickup is selected
    let enhancedDeliveryOption = deliveryOption;
    if (deliveryOption.type === 'pickup' && deliveryOption.pickupLocationId) {
      try {
        // Import the PickupLocation model directly
        const PickupLocation = (await import('@/models/PickupLocation')).default;
        const selectedLocation = await PickupLocation.findById(deliveryOption.pickupLocationId);

        if (selectedLocation) {
          enhancedDeliveryOption = {
            ...deliveryOption,
            pickupLocation: {
              _id: selectedLocation._id,
              name: selectedLocation.name,
              address: selectedLocation.address,
              lat: selectedLocation.lat,
              lng: selectedLocation.lng,
              contactPerson: selectedLocation.contactPerson,
              contactPhone: selectedLocation.contactPhone,
              operatingHours: selectedLocation.operatingHours,
              gmapLink: selectedLocation.gmapLink
            }
          };
          logOrderEvent('pickup_location_enhanced', 'unknown', {
            locationId: deliveryOption.pickupLocationId,
            locationName: selectedLocation.name
          }, 'info');
        } else {
          logOrderEvent('pickup_location_not_found', 'unknown', {
            locationId: deliveryOption.pickupLocationId
          }, 'warn');
          // Continue with original delivery option - pickup location not found
        }
      } catch (error) {
        logOrderEvent('pickup_location_fetch_error', 'unknown', {
          error: error instanceof Error ? error.message : 'Unknown error',
          locationId: deliveryOption.pickupLocationId
        }, 'error');
        console.error('Error fetching pickup location details:', error);
        // Continue with original delivery option if fetch fails
      }
    }

    // Get fileURLs, originalFileNames, and fileTypes - use from parsed variables if available, otherwise use single file values
    let fileURLsArray: string[] = [];
    let originalFileNamesArray: string[] = [];
    let fileTypesArray: string[] = [];

    // Check if we have fileURLs from the parsed body (for JSON requests)
    // For multipart/form-data, we only have single file, so use fileURL
    if (fileURLs && Array.isArray(fileURLs) && fileURLs.length > 0) {
      fileURLsArray = fileURLs;
    } else if (fileURL) {
      fileURLsArray = [fileURL];
    }

    if (originalFileNames && Array.isArray(originalFileNames) && originalFileNames.length > 0) {
      originalFileNamesArray = originalFileNames;
    } else if (originalFileName) {
      originalFileNamesArray = [originalFileName];
    }

    // Extract fileTypes array
    if (fileTypes && Array.isArray(fileTypes) && fileTypes.length > 0) {
      fileTypesArray = fileTypes;
    } else if (fileType) {
      // For legacy single file or multipart/form-data
      fileTypesArray = [fileType];
    }

    // Detect fileType from filenames if not provided
    if (orderType === 'file' && fileURLsArray.length > 0) {
      // Detect fileType for each file if missing
      for (let i = 0; i < fileURLsArray.length; i++) {
        if (!fileTypesArray[i] || fileTypesArray[i] === 'application/octet-stream') {
          const detectedType = originalFileNamesArray[i]
            ? getFileTypeFromFilename(originalFileNamesArray[i], fileURLsArray[i])
            : getFileTypeFromFilename('', fileURLsArray[i]);

          if (fileTypesArray[i]) {
            fileTypesArray[i] = detectedType;
          } else {
            fileTypesArray.push(detectedType);
          }
          console.log(`🔍 Detected fileType for file ${i + 1}: ${detectedType}`);
        }
      }

      // Also set legacy fileType if not set
      if (!fileType && fileTypesArray.length > 0) {
        fileType = fileTypesArray[0];
        console.log(`🔍 Set legacy fileType: ${fileType}`);
      }
    }

    // Ensure fileTypes array matches fileURLs array length
    if (fileTypesArray.length !== fileURLsArray.length && fileURLsArray.length > 0) {
      // If fileTypes array is shorter, pad with detected types or 'application/octet-stream'
      while (fileTypesArray.length < fileURLsArray.length) {
        const idx = fileTypesArray.length;
        const detectedType = originalFileNamesArray[idx]
          ? getFileTypeFromFilename(originalFileNamesArray[idx], fileURLsArray[idx])
          : 'application/octet-stream';
        fileTypesArray.push(detectedType);
      }
      // If fileTypes array is longer, trim it
      fileTypesArray = fileTypesArray.slice(0, fileURLsArray.length);
    }

    // Ensure all required fields are present and handle optional fields
    const orderData: any = {
      customerInfo: {
        name: customerInfo.name,
        phone: customerInfo.phone,
        email: customerInfo.email,
      },
      orderType,
      fileURL: orderType === 'file' ? fileURL : undefined,
      fileURLs: orderType === 'file' && fileURLsArray.length > 0 ? fileURLsArray : undefined,
      fileType: orderType === 'file' ? fileType : undefined, // Legacy support
      fileTypes: orderType === 'file' && fileTypesArray.length > 0 ? fileTypesArray : undefined,
      originalFileName: orderType === 'file' ? originalFileName : undefined,
      originalFileNames: orderType === 'file' && originalFileNamesArray.length > 0 ? originalFileNamesArray : undefined,
      templateData: orderType === 'template' ? templateData : undefined,
      printingOptions: {
        ...printingOptions,
        pageCount: pageCount, // Add page count to printing options
      },
      deliveryOption: enhancedDeliveryOption,
      expectedDate: expectedDate ? (() => {
        const date = new Date(expectedDate);
        return isNaN(date.getTime()) ? undefined : date;
      })() : undefined,
      amount,
      razorpayOrderId: razorpayOrder.id,
      status: 'pending_payment', // Use consistent status field
      paymentStatus: 'pending', // Use consistent payment status
      orderStatus: 'pending', // Use consistent order status
    };

    console.log('🔍 DEBUG - Order data being saved:', JSON.stringify(orderData, null, 2));

    // Create order in database
    const order = new Order(orderData);

    // Save order (orderId will be auto-generated by pre-save hook)
    try {
      await order.save();
      console.log(`✅ Order created successfully with ID: ${order.orderId}, Amount: ₹${amount}, Pages: ${pageCount}`);
    } catch (saveError) {
      console.error('❌ Error saving order to database:', saveError);
      if (saveError instanceof Error) {
        console.error('❌ Validation errors:', saveError.message);
      }
      throw saveError;
    }

    console.log('🔑 Razorpay Key ID:', process.env.RAZORPAY_KEY_ID ? 'Present' : 'Missing');
    console.log('🔑 Razorpay Key Secret:', process.env.RAZORPAY_KEY_SECRET ? 'Present' : 'Missing');

    logOrderEvent('order_created', order.orderId, {
      orderType: sanitizedOrderData.orderType,
      amount,
      pageCount,
      customerEmail: sanitizedOrderData.customerInfo.email
    });

    // Send notifications (both admin and customer)
    const notificationData = {
      orderId: order.orderId,
      customerName: sanitizedOrderData.customerInfo.name,
      customerEmail: sanitizedOrderData.customerInfo.email,
      customerPhone: sanitizedOrderData.customerInfo.phone,
      orderType: sanitizedOrderData.orderType,
      amount,
      pageCount,
      printingOptions: sanitizedOrderData.printingOptions,
      deliveryOption: sanitizedOrderData.deliveryOption,
      createdAt: order.createdAt,
      paymentStatus: order.paymentStatus,
      orderStatus: order.orderStatus,
      fileName: sanitizedOrderData.originalFileName
    };

    // Send admin notification
    try {
      await sendNewOrderNotification(notificationData);
    } catch (notificationError) {
      console.error('❌ Failed to send admin notification:', notificationError);
      // Don't fail the order creation if notification fails
    }

    // Send customer confirmation email
    try {
      await sendCustomerOrderConfirmation(notificationData);
    } catch (customerNotificationError) {
      console.error('❌ Failed to send customer confirmation:', customerNotificationError);
      // Don't fail the order creation if customer notification fails
    }

    return NextResponse.json({
      success: true,
      orderId: order.orderId,
      razorpayOrderId: razorpayOrder.id,
      amount,
      pageCount,
      key: process.env.RAZORPAY_KEY_ID,
    });
  } catch (error) {
    logOrderEvent('order_creation_failed', 'unknown', { error: error instanceof Error ? error.message : 'Unknown error' }, 'error');
    return handleOrderError(error);
  }
}
