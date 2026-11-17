import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import connectDB from '@/lib/mongodb';
import User from '@/models/User';
import Order from '@/models/Order';
import AdminInfo from '@/models/AdminInfo';
import PickupLocation from '@/models/PickupLocation';
import { validatePhoneNumberLength } from '@/lib/phoneValidation';

/**
 * API endpoint to validate and clean phone numbers
 * 
 * This endpoint:
 * 1. Validates phone numbers in User collection (phone field)
 * 2. Validates phone numbers in Order collection (customerInfo.phone field)
 * 3. Validates phone numbers in AdminInfo collection (phone field)
 * 4. Validates phone numbers in PickupLocation collection (contactPhone field)
 * 
 * Phone numbers are set to null/empty if:
 * - They don't have a country code (don't start with +)
 * - They don't meet the minimum length requirement for their country code
 * 
 * Access: Admin only
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  try {

    await connectDB();
    console.log('🔄 Starting phone number migration via API...');

    let totalProcessed = 0;
    let totalInvalid = 0;
    let totalUpdated = 0;
    const invalidPhones: Array<{ collection: string; id: string; phone: string; error: string }> = [];

    // Process User collection
    console.log('\n📋 Processing User collection...');
    const users = await User.find({ phone: { $exists: true, $nin: [null, ''] } });
    console.log(`   Found ${users.length} users with phone numbers`);

    for (const user of users) {
      totalProcessed++;
      if (!user.phone) continue;

      const validation = validatePhoneNumberLength(user.phone);
      if (!validation.valid) {
        console.log(`   ⚠️  Invalid phone for user ${user._id}: ${validation.error}`);
        await User.updateOne(
          { _id: user._id },
          { $set: { phone: null } }
        );
        totalInvalid++;
        totalUpdated++;
        invalidPhones.push({
          collection: 'User',
          id: user._id.toString(),
          phone: user.phone,
          error: validation.error || 'Invalid phone number'
        });
      }
    }

    // Process Order collection
    console.log('\n📋 Processing Order collection...');
    const orders = await Order.find({ 'customerInfo.phone': { $exists: true, $nin: [null, ''] } });
    console.log(`   Found ${orders.length} orders with phone numbers`);

    for (const order of orders) {
      totalProcessed++;
      if (!order.customerInfo?.phone) continue;

      const validation = validatePhoneNumberLength(order.customerInfo.phone);
      if (!validation.valid) {
        console.log(`   ⚠️  Invalid phone for order ${order.orderId || order._id}: ${validation.error}`);
        await Order.updateOne(
          { _id: order._id },
          { $set: { 'customerInfo.phone': null } }
        );
        totalInvalid++;
        totalUpdated++;
        invalidPhones.push({
          collection: 'Order',
          id: order.orderId || order._id.toString(),
          phone: order.customerInfo.phone,
          error: validation.error || 'Invalid phone number'
        });
      }
    }

    // Process AdminInfo collection
    console.log('\n📋 Processing AdminInfo collection...');
    const adminInfos = await AdminInfo.find({ phone: { $exists: true, $nin: [null, ''] } });
    console.log(`   Found ${adminInfos.length} admin info records with phone numbers`);

    for (const adminInfo of adminInfos) {
      totalProcessed++;
      if (!adminInfo.phone) continue;

      const validation = validatePhoneNumberLength(adminInfo.phone);
      if (!validation.valid) {
        console.log(`   ⚠️  Invalid phone for admin info ${adminInfo._id}: ${validation.error}`);
        await AdminInfo.updateOne(
          { _id: adminInfo._id },
          { $set: { phone: '' } }
        );
        totalInvalid++;
        totalUpdated++;
        invalidPhones.push({
          collection: 'AdminInfo',
          id: adminInfo._id.toString(),
          phone: adminInfo.phone,
          error: validation.error || 'Invalid phone number'
        });
      }
    }

    // Process PickupLocation collection
    console.log('\n📋 Processing PickupLocation collection...');
    const pickupLocations = await PickupLocation.find({ contactPhone: { $exists: true, $nin: [null, ''] } });
    console.log(`   Found ${pickupLocations.length} pickup locations with phone numbers`);

    for (const location of pickupLocations) {
      totalProcessed++;
      if (!location.contactPhone) continue;

      const validation = validatePhoneNumberLength(location.contactPhone);
      if (!validation.valid) {
        console.log(`   ⚠️  Invalid phone for location ${location.name}: ${validation.error}`);
        await PickupLocation.updateOne(
          { _id: location._id },
          { $set: { contactPhone: null } }
        );
        totalInvalid++;
        totalUpdated++;
        invalidPhones.push({
          collection: 'PickupLocation',
          id: location._id.toString(),
          phone: location.contactPhone,
          error: validation.error || 'Invalid phone number'
        });
      }
    }

    console.log('\n📊 Migration Summary:');
    console.log(`   📋 Total phone numbers processed: ${totalProcessed}`);
    console.log(`   ⚠️  Invalid phone numbers found: ${totalInvalid}`);
    console.log(`   ✅ Records updated: ${totalUpdated}`);
    console.log(`   ✅ Valid phone numbers: ${totalProcessed - totalInvalid}`);

    return NextResponse.json({
      success: true,
      message: 'Migration completed successfully',
      summary: {
        totalProcessed,
        totalInvalid,
        totalUpdated,
        validPhones: totalProcessed - totalInvalid
      },
      invalidPhones: invalidPhones.slice(0, 100) // Limit to first 100 for response size
    });

  } catch (error) {
    console.error('❌ Migration failed:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Migration failed' 
      },
      { status: 500 }
    );
  }
}

