/**
 * Migration script to update existing templates to new schema format
 * 
 * This script:
 * 1. Updates existing templates with createdBy: 'admin' to new schema
 * 2. Sets createdByType: 'admin' for existing admin templates
 * 3. Sets isPublic: false for existing templates (or true if they should be public)
 * 4. Handles templates without user context
 * 
 * Run with: npx ts-node scripts/migrate-templates.ts
 */

import mongoose from 'mongoose';
import connectDB from '../src/lib/mongodb';
import DynamicTemplate from '../src/models/DynamicTemplate';
import User from '../src/models/User';

// Note: This script should be run with ts-node or compiled first
// Run with: npx ts-node scripts/migrate-templates.ts

async function migrateTemplates() {
  try {
    console.log('🔄 Starting template migration...');
    
    // Connect to database
    await connectDB();
    console.log('✅ Connected to database');

    // Find all templates
    const templates = await DynamicTemplate.find({});
    console.log(`📋 Found ${templates.length} templates to migrate`);

    let migrated = 0;
    let skipped = 0;

    for (const template of templates) {
      const updates: any = {};

      // If template doesn't have new fields, migrate it
      if (!template.createdByType) {
        // Determine createdByType based on createdBy field
        if (template.createdBy === 'admin' || !template.createdBy) {
          updates.createdByType = 'admin';
          updates.isPublic = false; // Default to private
          
          // Try to find admin user
          const adminEmail = process.env.ADMIN_EMAIL?.toLowerCase();
          const adminUser = await User.findOne({ 
            $or: [
              ...(adminEmail ? [{ email: adminEmail }] : []),
              { role: 'admin' }
            ]
          });

          if (adminUser) {
            updates.createdByUserId = adminUser._id;
            updates.createdByEmail = adminUser.email;
            updates.createdByName = adminUser.name;
          } else {
            // If no admin user found, set defaults
            updates.createdByEmail = template.createdBy || 'admin';
            updates.createdByName = 'Admin';
          }
        } else {
          // Try to find user by email
          const user = await User.findOne({ email: template.createdBy.toLowerCase() });
          
          if (user) {
            updates.createdByType = 'user';
            updates.createdByUserId = user._id;
            updates.createdByEmail = user.email;
            updates.createdByName = user.name;
            updates.isPublic = false; // Default to private
          } else {
            // User not found, treat as admin
            updates.createdByType = 'admin';
            updates.createdByEmail = template.createdBy;
            updates.createdByName = 'Admin';
            updates.isPublic = false;
          }
        }

        // Update template
        await DynamicTemplate.updateOne(
          { _id: template._id },
          { $set: updates }
        );

        migrated++;
        console.log(`✅ Migrated template: ${template.name} (${template.id})`);
      } else {
        skipped++;
        console.log(`⏭️  Skipped template (already migrated): ${template.name} (${template.id})`);
      }
    }

    console.log('\n📊 Migration Summary:');
    console.log(`   ✅ Migrated: ${migrated}`);
    console.log(`   ⏭️  Skipped: ${skipped}`);
    console.log(`   📋 Total: ${templates.length}`);
    console.log('\n✅ Migration completed successfully!');

    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

// Run migration
migrateTemplates();

