import { NextRequest, NextResponse } from 'next/server';
import { createRazorpayOrder } from '@/lib/razorpay';
import { getPricing } from '@/lib/pricing';
import connectDB from '@/lib/mongodb';
import Order from '@/models/Order';
import { getFileTypeFromFilename, getFileTypeFromFileNames } from '@/lib/fileTypeDetection';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

/**
 * Get page colors for a specific file (handles both array and legacy single object formats)
 */
function getFilePageColors(
  fileIndex: number,
  pageColors?: { colorPages: number[]; bwPages: number[] } | Array<{ colorPages: number[]; bwPages: number[] }>
): { colorPages: number[]; bwPages: number[] } {
  if (!pageColors) {
    return { colorPages: [], bwPages: [] };
  }
  
  // Handle array format (per-file)
  if (Array.isArray(pageColors)) {
    if (fileIndex >= 0 && fileIndex < pageColors.length) {
      return pageColors[fileIndex];
    }
    return { colorPages: [], bwPages: [] };
  }
  
  // Handle legacy single object format (backward compatibility)
  if (fileIndex === 0) {
    return pageColors;
  }
  
  return { colorPages: [], bwPages: [] };
}

/**
 * Calculate cost for a single file
 */
function calculateFileCost(
  filePageCount: number,
  fileColorPages: number,
  fileBwPages: number,
  basePrice: number,
  colorMultiplier: number,
  sidedMultiplier: number,
  copies: number,
  colorMode: 'color' | 'bw' | 'mixed'
): number {
  if (colorMode === 'mixed') {
    // Mixed: calculate color and B&W pages separately
    const colorCost = fileColorPages * basePrice * colorMultiplier;
    const bwCost = fileBwPages * basePrice;
    return (colorCost + bwCost) * sidedMultiplier * copies;
  } else if (colorMode === 'color') {
    // All color: apply multiplier to all pages
    return filePageCount * basePrice * colorMultiplier * sidedMultiplier * copies;
  } else {
    // All B&W: no multiplier
    return filePageCount * basePrice * sidedMultiplier * copies;
  }
}

export async function POST(request: NextRequest) {
  try {
    // Authentication check — only signed-in users can initiate payments
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      console.error('❌ Unauthenticated user attempted to initiate payment');
      return NextResponse.json(
        { success: false, error: 'Authentication required. Please sign in to place an order.' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const {
      customerInfo,
      orderType,
      printingOptions,
      deliveryOption,
      expectedDate,
      fileURL,
      fileURLs, // Support for multiple files
      fileType,
      originalFileName,
      originalFileNames, // Support for multiple file names
      templateData,
      razorpayOrderId, // For completing payment on existing order
      amount, // For completing payment on existing order
      filePageCounts // Per-file page counts from frontend
    } = body;
    
    // Debug: Log file data received
    console.log('📋 Payment initiation - File data received:');
    console.log('  - fileURL:', fileURL ? 'Present' : 'Missing');
    console.log('  - fileURLs:', fileURLs && Array.isArray(fileURLs) ? `${fileURLs.length} files` : 'Missing or not array');
    console.log('  - originalFileName:', originalFileName ? 'Present' : 'Missing');
    console.log('  - originalFileNames:', originalFileNames && Array.isArray(originalFileNames) ? `${originalFileNames.length} files` : 'Missing or not array');

    // If this is for completing payment on an existing order
    if (razorpayOrderId && amount) {
      console.log(`🔄 Completing payment for existing order: ${razorpayOrderId}, amount: ₹${amount}`);
      
      if (!process.env.RAZORPAY_KEY_ID) {
        console.error('❌ RAZORPAY_KEY_ID not found in environment variables');
        return NextResponse.json(
          { success: false, error: 'Payment gateway configuration error' },
          { status: 500 }
        );
      }

      // Validate amount is reasonable (prevent manipulation)
      if (amount <= 0 || amount > 100000) { // Max ₹1,00,000
        console.error(`❌ Invalid amount: ₹${amount}`);
        return NextResponse.json(
          { success: false, error: 'Invalid payment amount' },
          { status: 400 }
        );
      }
      
      return NextResponse.json({
        success: true,
        razorpayOrderId,
        amount,
        key: process.env.RAZORPAY_KEY_ID,
      });
    }

    // Validate required fields for new orders
    if (!customerInfo.name || !customerInfo.phone || !customerInfo.email) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: name, phone, and email are required' },
        { status: 400 }
      );
    }

    // Calculate amount based on printing options
    const pageCount = printingOptions.pageCount || 1;
    console.log(`📥 Payment initiation - pageCount: ${pageCount}`);

    // Connect to database to fetch Partner Razorpay account & pricing
    await connectDB();
    
    let partnerPricing: { perPageBW: number; perPageColor: number; binding: number } | null = null;
    let partnerRazorpayId: string | null = null;
    let partnerIdString: string | null = null;
    
    if (deliveryOption.partnerId) {
      const Partner = (await import('@/models/Partner')).default;
      const partner = await Partner.findById(deliveryOption.partnerId);
      if (partner) {
        partnerIdString = partner._id.toString();
        if (partner.pricing) {
          partnerPricing = partner.pricing;
          console.log(`✅ Using custom pricing from Partner: ${partner.shopName}`);
        }
        if (partner.razorpayAccountId) {
          partnerRazorpayId = partner.razorpayAccountId;
        }
      }
    }

    // Get pricing from database (fallback)
    const pricing = await getPricing();
    
    // Prepare file data first - prioritize arrays over single file fields
    let fileURLsArray: string[] | undefined;
    let originalFileNamesArray: string[] | undefined;
    let singleFileURL: string | undefined;
    let singleOriginalFileName: string | undefined;
    
    // Check if we have fileURLs array (multiple files)
    if (fileURLs && Array.isArray(fileURLs) && fileURLs.length > 0) {
      fileURLsArray = fileURLs;
      singleFileURL = fileURLs[0]; // Set first file as legacy fileURL for backward compatibility
      console.log(`✅ Using fileURLs array with ${fileURLs.length} files`);
    } else if (fileURL) {
      // Fall back to single file for backward compatibility
      fileURLsArray = [fileURL];
      singleFileURL = fileURL;
      console.log(`📄 Using single fileURL, converted to array format`);
    }
    
    // Check if we have originalFileNames array
    if (originalFileNames && Array.isArray(originalFileNames) && originalFileNames.length > 0) {
      originalFileNamesArray = originalFileNames;
      singleOriginalFileName = originalFileNames[0]; // Set first file as legacy originalFileName
      console.log(`✅ Using originalFileNames array with ${originalFileNames.length} files`);
    } else if (originalFileName) {
      // Fall back to single file name for backward compatibility
      originalFileNamesArray = [originalFileName];
      singleOriginalFileName = originalFileName;
      console.log(`📄 Using single originalFileName, converted to array format`);
    }
    
    // Ensure arrays match in length
    if (fileURLsArray && originalFileNamesArray) {
      if (fileURLsArray.length !== originalFileNamesArray.length) {
        console.warn(`⚠️ Mismatch: fileURLs has ${fileURLsArray.length} items, originalFileNames has ${originalFileNamesArray.length} items`);
        // Pad or truncate to match
        if (originalFileNamesArray.length < fileURLsArray.length) {
          while (originalFileNamesArray.length < fileURLsArray.length) {
            originalFileNamesArray.push(`File ${originalFileNamesArray.length + 1}`);
          }
        } else {
          originalFileNamesArray = originalFileNamesArray.slice(0, fileURLsArray.length);
        }
      }
    }
    
    // Calculate pricing per file
    const colorMultiplier = pricing.multipliers.color;
    const minServiceFeePageLimit = pricing.additionalServices.minServiceFeePageLimit || 1;
    
    // Get file counts - we need to calculate per file
    const numFiles = (fileURLsArray && fileURLsArray.length > 0) ? fileURLsArray.length : 1;
    
    // Use filePageCounts from frontend if available, otherwise estimate
    let pagesPerFile: number[] = [];
    if (filePageCounts && Array.isArray(filePageCounts) && filePageCounts.length === numFiles) {
      pagesPerFile = filePageCounts;
      console.log(`✅ Using filePageCounts from frontend: ${JSON.stringify(pagesPerFile)}`);
    } else {
      // Estimate pages per file
      const estimatedPagesPerFile = numFiles > 0 ? Math.ceil(pageCount / numFiles) : pageCount;
      pagesPerFile = Array(numFiles).fill(estimatedPagesPerFile);
      console.log(`⚠️ Estimating pages per file: ${estimatedPagesPerFile} (filePageCounts not provided or mismatch)`);
    }
    
    let calculatedAmount = 0;
    
    // Helper function to get file printing options (with fallback to legacy)
    const getFilePrintingOptions = (fileIndex: number): {
      pageSize: 'A4' | 'A3';
      color: 'color' | 'bw' | 'mixed';
      sided: 'single' | 'double';
      copies: number;
      pageColors?: { colorPages: number[]; bwPages: number[] };
    } => {
      // Check if we have per-file options
      if ((printingOptions as any).fileOptions && Array.isArray((printingOptions as any).fileOptions) && (printingOptions as any).fileOptions.length > fileIndex) {
        return (printingOptions as any).fileOptions[fileIndex];
      }
      
      // Fall back to legacy single options
      return {
        pageSize: printingOptions.pageSize || 'A4',
        color: printingOptions.color || 'bw',
        sided: printingOptions.sided || 'single',
        copies: printingOptions.copies || 1,
        pageColors: (() => {
          const filePageColors = getFilePageColors(fileIndex, printingOptions.pageColors);
          return filePageColors.colorPages.length > 0 || filePageColors.bwPages.length > 0 
            ? filePageColors 
            : undefined;
        })()
      };
    };
    
    // Calculate cost for each file
    for (let i = 0; i < numFiles; i++) {
      const filePageCount = pagesPerFile[i] || 1;
      
      // Get per-file printing options
      const fileOpts = getFilePrintingOptions(i);
      const fileBasePrice = pricing.basePrices[fileOpts.pageSize as keyof typeof pricing.basePrices];
      const fileSidedMultiplier = fileOpts.sided === 'double' ? pricing.multipliers.doubleSided : 1;
      
      // Get page colors for this file
      const filePageColors = getFilePageColors(i, printingOptions.pageColors);
      const effectivePageColors = fileOpts.pageColors || filePageColors;
      const fileColorPages = effectivePageColors.colorPages.length;
      const fileBwPages = effectivePageColors.bwPages.length;
      
      // Calculate base cost for this file using helper function
      let fileBaseCost = 0;
      if (partnerPricing) {
        const pageSizeMultiplier = fileOpts.pageSize === 'A3' ? 2 : 1;
        const sidedMultiplier = fileOpts.sided === 'double' ? 1.5 : 1;
        
        if (fileOpts.color === 'mixed' && effectivePageColors) {
          fileBaseCost = ((fileColorPages * partnerPricing.perPageColor) + (fileBwPages * partnerPricing.perPageBW)) * pageSizeMultiplier * sidedMultiplier;
        } else if (fileOpts.color === 'color') {
          fileBaseCost = filePageCount * partnerPricing.perPageColor * pageSizeMultiplier * sidedMultiplier;
        } else {
          fileBaseCost = filePageCount * partnerPricing.perPageBW * pageSizeMultiplier * sidedMultiplier;
        }
        
        fileBaseCost *= fileOpts.copies;
        
        const fileServiceOption = printingOptions.serviceOptions?.[i] || printingOptions.serviceOption || 'service';
        if (fileServiceOption === 'binding') {
          fileBaseCost += partnerPricing.binding * fileOpts.copies; 
        }
        
        calculatedAmount += Math.ceil(fileBaseCost);
      } else {
        fileBaseCost = calculateFileCost(
          filePageCount,
          fileColorPages,
          fileBwPages,
          fileBasePrice,
          colorMultiplier,
          fileSidedMultiplier,
          fileOpts.copies,
          fileOpts.color
        );
        calculatedAmount += fileBaseCost;
        
        // Add service option cost for this file if it exceeds limit
        if (filePageCount > minServiceFeePageLimit) {
          const fileServiceOption = printingOptions.serviceOptions?.[i] || printingOptions.serviceOption || 'service';
          if (fileServiceOption === 'binding') {
            calculatedAmount += pricing.additionalServices.binding;
          } else if (fileServiceOption === 'file') {
            calculatedAmount += 10; // File handling fee
          } else if (fileServiceOption === 'service') {
            calculatedAmount += pricing.additionalServices.minServiceFee;
          }
        }
      }
    }

    
    console.log(`🔍 Payment initiation - Per-file pricing:`);
    console.log(`  - Files: ${numFiles}`);
    console.log(`  - Pages per file: ${JSON.stringify(pagesPerFile)}`);
    console.log(`  - Service options: ${JSON.stringify(printingOptions.serviceOptions || printingOptions.serviceOption)}`);
    console.log(`  - Color mode: ${printingOptions.color}`);
    if (printingOptions.color === 'mixed') {
      console.log(`  - Per-file page colors:`, JSON.stringify(printingOptions.pageColors));
      // Log per-file breakdown for math verification
      for (let i = 0; i < numFiles; i++) {
        const filePageColors = getFilePageColors(i, printingOptions.pageColors);
        console.log(`    File ${i + 1}: ${filePageColors.colorPages.length} color pages, ${filePageColors.bwPages.length} B&W pages`);
      }
    }
    
    // Add delivery charge if delivery option is selected
    if (deliveryOption.type === 'delivery' && deliveryOption.deliveryCharge) {
      calculatedAmount += deliveryOption.deliveryCharge;
    }

    console.log(`💰 Payment initiation - calculated amount: ₹${calculatedAmount}`);

    // Add 3% Razorpay processing fee as hidden charge
    // This ensures we receive at least the base amount after Razorpay's 2% fee deduction
    const RAZORPAY_FEE_PERCENT = 3;
    const baseAmount = calculatedAmount;
    const finalAmount = Math.round(baseAmount * (1 + RAZORPAY_FEE_PERCENT / 100));
    const razorpayFee = finalAmount - baseAmount;
    
    console.log(`💳 Razorpay fee calculation:`);
    console.log(`  - Base amount: ₹${baseAmount}`);
    console.log(`  - Razorpay fee (${RAZORPAY_FEE_PERCENT}%): ₹${razorpayFee}`);
    console.log(`  - Final amount (with fee): ₹${finalAmount}`);

    // Validate calculated amount is reasonable
    if (baseAmount <= 0 || baseAmount > 100000) { // Max ₹1,00,000
      console.error(`❌ Invalid calculated amount: ₹${baseAmount}`);
      return NextResponse.json(
        { success: false, error: 'Invalid order amount. Please contact support.' },
        { status: 400 }
      );
    }

    let transfers = undefined;
    if (deliveryOption.partnerId) {
      if (partnerRazorpayId && partnerIdString) {
        // Calculate Partner share (e.g., 90% of baseAmount, we keep 10% platform fee)
        const partnerSharePercent = 90;
        const partnerAmountInPaise = Math.round((baseAmount * 100) * (partnerSharePercent / 100));
        
        transfers = [{
          account: partnerRazorpayId,
          amount: partnerAmountInPaise,
          currency: 'INR',
          notes: {
            orderType,
            partnerId: partnerIdString
          },
          linked_account_notes: ['orderType'],
          on_hold: false
        }];
        
        console.log(`🔗 Razorpay Route configured for Partner ${partnerIdString}: ${partnerSharePercent}% split (₹${partnerAmountInPaise / 100})`);
      } else {
         console.warn(`⚠️ Partner ${deliveryOption.partnerId} does not have a linked Razorpay account. Payment will be fully routed to the platform.`);
      }
    }

    // Create Razorpay order with final amount (including hidden fee)
    const razorpayOrder = await createRazorpayOrder({
      amount: finalAmount,
      receipt: `payment_${Date.now()}`,
      notes: {
        orderType,
        customerName: customerInfo.name,
        pageCount: pageCount.toString(),
        amount: baseAmount.toString(), // Store original amount in notes
        razorpayFee: razorpayFee.toString(), // Store fee for tracking
      },
      transfers,
    });

    console.log(`✅ Razorpay order created: ${razorpayOrder.id}`);

    // Fetch pickup location details if pickup is selected (Legacy fallback)
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
          console.log(`✅ Pickup location enhanced: ${selectedLocation.name}`);
        } else {
          console.warn(`⚠️ Pickup location not found: ${deliveryOption.pickupLocationId}`);
        }
      } catch (error) {
        console.error('Error fetching pickup location details:', error);
        // Continue with original delivery option if fetch fails
        console.log('Continuing with original delivery option...');
      }
    }

    console.log(`📋 Creating order with ${fileURLsArray?.length || 0} file(s)`);

    // Determine global color based on file count and per-file options
    // Multi-file orders = Multiple independent orders (each file can independently have mixed color)
    // Each file can have: 'color', 'bw', or 'mixed' (some pages color, some B&W)
    // Global color = Display field: 'mixed' if ANY file has mixed color, otherwise use first file's color
    let finalColor = printingOptions.color || 'bw';
    const totalFiles = (fileURLsArray && fileURLsArray.length > 0) ? fileURLsArray.length : 1;
    
    if (printingOptions.fileOptions && Array.isArray(printingOptions.fileOptions) && printingOptions.fileOptions.length > 0) {
      if (totalFiles === 1) {
        // Single file: use that file's color (can be 'mixed' if it has mixed pages)
        const fileOpt = printingOptions.fileOptions[0];
        if (fileOpt?.color) {
          finalColor = fileOpt.color;
          // Verify it's truly mixed (has both colorPages and bwPages)
          if (fileOpt.color === 'mixed') {
            const filePageColors = getFilePageColors(0, printingOptions.pageColors);
            const hasColorPages = filePageColors.colorPages.length > 0;
            const hasBwPages = filePageColors.bwPages.length > 0;
            if (!hasColorPages || !hasBwPages) {
              // Not truly mixed, default to B&W
              finalColor = 'bw';
              console.log('⚠️ File marked as mixed but missing colorPages or bwPages, defaulting to B&W');
            } else {
              console.log('✅ Single file with true mixed color (has both color and B&W pages)');
            }
          }
        }
      } else {
        // Multiple files: Each file can independently have mixed color
        // Check if ANY file has mixed color - if so, set global color to 'mixed' for display
        const fileOptionsArr = Array.isArray(printingOptions.fileOptions) ? printingOptions.fileOptions : [];
        const hasAnyMixedColor = fileOptionsArr.some((fileOpt: any, fileIndex: number) => {
          if (fileOpt?.color !== 'mixed') return false;
          // Verify it's truly mixed (has both colorPages and bwPages)
          const filePageColors = getFilePageColors(fileIndex, printingOptions.pageColors || []);
          const hasColorPages = (filePageColors?.colorPages?.length || 0) > 0;
          const hasBwPages = (filePageColors?.bwPages?.length || 0) > 0;
          return hasColorPages && hasBwPages;
        });
        
        if (hasAnyMixedColor) {
          // At least one file has mixed color - set global color to 'mixed' for display
          finalColor = 'mixed';
          console.log('✅ Multi-file order: at least one file has mixed color, setting global color to "mixed"');
        } else {
          // No files have mixed color - use first file's color
          const firstFileOpt = fileOptionsArr[0];
          if (firstFileOpt?.color) {
            finalColor = firstFileOpt.color;
            console.log(`✅ Multi-file order: using first file's color (${firstFileOpt.color})`);
          }
        }
      }
    }

    // Detect fileType from filenames if not provided
    let detectedFileType = fileType;
    if (orderType === 'file' && !detectedFileType) {
      if (originalFileNamesArray && originalFileNamesArray.length > 0) {
        // Multi-file: detect from array
        detectedFileType = getFileTypeFromFileNames(originalFileNamesArray, fileURLsArray);
        console.log(`🔍 Detected fileType from filenames array: ${detectedFileType}`);
      } else if (singleOriginalFileName) {
        // Single file: detect from filename
        detectedFileType = getFileTypeFromFilename(singleOriginalFileName, singleFileURL);
        console.log(`🔍 Detected fileType from filename: ${detectedFileType}`);
      }
    }
    
    console.log(`📋 Creating order with ${fileURLsArray?.length || 0} file(s), fileType: ${detectedFileType || 'not set'}`);

    // Create pending order in database
    const orderData = {
      customerInfo,
      orderType,
      fileURL: orderType === 'file' ? singleFileURL : undefined, // Legacy support
      fileURLs: orderType === 'file' && fileURLsArray && fileURLsArray.length > 0 ? fileURLsArray : undefined,
      fileType: orderType === 'file' ? detectedFileType : undefined,
      originalFileName: orderType === 'file' ? singleOriginalFileName : undefined, // Legacy support
      originalFileNames: orderType === 'file' && originalFileNamesArray && originalFileNamesArray.length > 0 ? originalFileNamesArray : undefined,
      templateData,
      printingOptions: {
        ...printingOptions,
        color: finalColor, // Use the updated color (mixed if any file has mixed)
        pageCount: pageCount,
        serviceOptions: printingOptions.serviceOptions, // Store per-file service options
        serviceOption: printingOptions.serviceOption, // Legacy support
        pageColors: printingOptions.pageColors, // Store per-file page colors
        fileOptions: printingOptions.fileOptions, // Store per-file printing options
      },
      deliveryOption: enhancedDeliveryOption,
      partnerId: deliveryOption.partnerId, // Link order to specific partner
      expectedDate: expectedDate ? new Date(expectedDate) : undefined,
      amount: calculatedAmount,
      razorpayOrderId: razorpayOrder.id,
      paymentStatus: 'pending', // Will be updated by webhook
      orderStatus: 'pending',
      status: 'pending_payment',
    };

    const order = new Order(orderData);
    await order.save();
    
    console.log(`✅ Pending order created: ${order.orderId} (Razorpay Order: ${razorpayOrder.id})`);

    return NextResponse.json({
      success: true,
      razorpayOrderId: razorpayOrder.id,
      orderId: order.orderId,
      amount: calculatedAmount,
      pageCount,
      key: process.env.RAZORPAY_KEY_ID,
    });
  } catch (error) {
    console.error('Error initiating payment:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to initiate payment' },
      { status: 500 }
    );
  }
}
