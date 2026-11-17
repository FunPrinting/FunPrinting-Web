/**
 * Migration script to validate and clean phone numbers
 * 
 * This script:
 * 1. Validates phone numbers in User collection (phone field)
 * 2. Validates phone numbers in Order collection (customerInfo.phone field)
 * 3. Validates phone numbers in AdminInfo collection (phone field)
 * 4. Validates phone numbers in PickupLocation collection (contactPhone field)
 * 
 * Phone numbers are set to null/empty if:
 * - They don't have a country code (don't start with +)
 * - They don't meet the minimum length requirement for their country code
 * 
 * Run with: npx ts-node scripts/migrate-phone-numbers.ts
 */

import mongoose from 'mongoose';
import connectDB from './lib/db';
import User from '../src/models/User';
import Order from '../src/models/Order';
import AdminInfo from '../src/models/AdminInfo';
import PickupLocation from '../src/models/PickupLocation';
import { validatePhoneNumberLength, parsePhoneNumber } from '../src/lib/phoneValidation';

async function migratePhoneNumbers() {
  try {
    console.log('🔄 Starting phone number migration...');
    
    // Connect to database
    await connectDB();
    console.log('✅ Connected to database');

    let totalProcessed = 0;
    let totalInvalid = 0;
    let totalUpdated = 0;

    // Process User collection
    console.log('\n📋 Processing User collection...');
    const users = await User.find({ phone: { $exists: true, $ne: null, $nin: ['', null] } });
    console.log(`   Found ${users.length} users with phone numbers`);

    for (const user of users) {
      totalProcessed++;
      if (!user.phone) continue;

      const validation = validatePhoneNumberLength(user.phone);
      if (!validation.valid) {
        console.log(`   ⚠️  Invalid phone for user ${user.email}: ${validation.error}`);
        await User.updateOne(
          { _id: user._id },
          { $set: { phone: null } }
        );
        totalInvalid++;
        totalUpdated++;
      }
    }

    // Process Order collection
    console.log('\n📋 Processing Order collection...');
    const orders = await Order.find({ 'customerInfo.phone': { $exists: true, $ne: null, $nin: ['', null] } });
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
      }
    }

    // Process AdminInfo collection
    console.log('\n📋 Processing AdminInfo collection...');
    const adminInfos = await AdminInfo.find({ phone: { $exists: true, $ne: null, $nin: ['', null] } });
    console.log(`   Found ${adminInfos.length} admin info records with phone numbers`);

    for (const adminInfo of adminInfos) {
      totalProcessed++;
      if (!adminInfo.phone) continue;

      const validation = validatePhoneNumberLength(adminInfo.phone);
      if (!validation.valid) {
        console.log(`   ⚠️  Invalid phone for admin info ${adminInfo.email}: ${validation.error}`);
        await AdminInfo.updateOne(
          { _id: adminInfo._id },
          { $set: { phone: '' } }
        );
        totalInvalid++;
        totalUpdated++;
      }
    }

    // Process PickupLocation collection
    console.log('\n📋 Processing PickupLocation collection...');
    const pickupLocations = await PickupLocation.find({ contactPhone: { $exists: true, $ne: null, $nin: ['', null] } });
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
      }
    }

    console.log('\n📊 Migration Summary:');
    console.log(`   📋 Total phone numbers processed: ${totalProcessed}`);
    console.log(`   ⚠️  Invalid phone numbers found: ${totalInvalid}`);
    console.log(`   ✅ Records updated: ${totalUpdated}`);
    console.log(`   ✅ Valid phone numbers: ${totalProcessed - totalInvalid}`);
    console.log('\n✅ Migration completed successfully!');

    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

// Run migration
migratePhoneNumbers();

