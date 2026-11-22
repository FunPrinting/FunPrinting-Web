#!/usr/bin/env node
/**
 * Migration script: Convert Partner servicesOffered from flat structure to categorized structure
 * 
 * Old structure:
 * - servicesOffered: { printing, colorPrinting, blackAndWhitePrinting, binding, lamination, ... }
 * - pricing: { perPageBW, perPageColor, binding }
 * 
 * New structure:
 * - servicesOffered.printing: { enabled, maxPaperSize, supportsColor, supportsBlackAndWhite, supportsDoubleSided }
 * - servicesOffered.binding: { enabled, types: { spiral, perfect, staple } }
 * - pricing.printing.a4.blackAndWhite: { singleSided, doubleSided }
 * - pricing.binding: { spiral, perfect, staple }
 */

import mongoose from 'mongoose';
import connectDB from './lib/db';

interface OldPartner {
  _id: string;
  servicesOffered?: {
    printing?: boolean;
    colorPrinting?: boolean;
    blackAndWhitePrinting?: boolean;
    binding?: boolean;
    lamination?: boolean;
    scanning?: boolean;
    photocopying?: boolean;
    delivery?: boolean;
    plasticFiles?: boolean;
  };
  pricing?: {
    perPageBW?: number;
    perPageColor?: number;
    binding?: number;
    lamination?: number;
    scanning?: number;
    photocopying?: number;
    plasticFiles?: number;
  };
}

async function migratePartners() {
  await connectDB();
  const db = mongoose.connection.db;
  if (!db) throw new Error('Database connection not established');
  
  const partners = await db.collection('partners').find<OldPartner>({}).toArray();
  
  console.log(`Found ${partners.length} partners to migrate`);
  
  let migrated = 0;
  let skipped = 0;
  
  for (const partner of partners) {
    const old = partner.servicesOffered;
    const oldPricing = partner.pricing;
    
    // Check if already migrated (has new structure)
    if (old && typeof old === 'object' && 'printing' in old && typeof old.printing === 'object' && 'enabled' in old.printing) {
      console.log(`Partner ${partner._id}: Already migrated, skipping`);
      skipped++;
      continue;
    }
    
    // Build new servicesOffered structure
    const newServicesOffered = {
      printing: {
        enabled: old?.printing ?? true,
        maxPaperSize: 'a4' as const, // Default to A4, partners can update
        supportsColor: old?.colorPrinting ?? true,
        supportsBlackAndWhite: old?.blackAndWhitePrinting ?? true,
        supportsDoubleSided: false, // Default to single-sided, partners can enable
      },
      binding: {
        enabled: old?.binding ?? false,
        types: {
          spiral: old?.binding ?? false, // If binding was enabled, assume spiral
          perfect: false,
          staple: false,
        },
      },
      lamination: {
        enabled: old?.lamination ?? false,
        maxSize: 'a4' as const,
      },
      scanning: {
        enabled: old?.scanning ?? false,
      },
      photocopying: {
        enabled: old?.photocopying ?? false,
        supportsColor: false, // Default to B&W only
      },
      plasticFiles: {
        enabled: old?.plasticFiles ?? false,
      },
      delivery: {
        enabled: old?.delivery ?? false,
      },
      customServices: [],
    };
    
    // Build new pricing structure
    const bwPrice = oldPricing?.perPageBW ?? 2;
    const colorPrice = oldPricing?.perPageColor ?? 10;
    const bindingPrice = oldPricing?.binding ?? 30;
    
    const newPricing = {
      printing: {
        a4: {
          blackAndWhite: { singleSided: bwPrice, doubleSided: Math.round(bwPrice * 1.5) },
          color: { singleSided: colorPrice, doubleSided: Math.round(colorPrice * 1.5) },
        },
        a3: {
          blackAndWhite: { singleSided: bwPrice * 2, doubleSided: Math.round(bwPrice * 3) },
          color: { singleSided: colorPrice * 2, doubleSided: Math.round(colorPrice * 3) },
        },
        letter: {
          blackAndWhite: { singleSided: bwPrice, doubleSided: Math.round(bwPrice * 1.5) },
          color: { singleSided: colorPrice, doubleSided: Math.round(colorPrice * 1.5) },
        },
        legal: {
          blackAndWhite: { singleSided: bwPrice, doubleSided: Math.round(bwPrice * 1.5) },
          color: { singleSided: colorPrice, doubleSided: Math.round(colorPrice * 1.5) },
        },
      },
      binding: {
        spiral: bindingPrice,
        perfect: bindingPrice * 1.5,
        staple: Math.round(bindingPrice / 3),
      },
      lamination: {
        a4: oldPricing?.lamination ?? 20,
        a3: (oldPricing?.lamination ?? 20) * 2,
      },
      scanning: oldPricing?.scanning ?? 5,
      photocopying: {
        blackAndWhite: oldPricing?.photocopying ?? 2,
        color: (oldPricing?.photocopying ?? 2) * 5,
      },
      plasticFiles: oldPricing?.plasticFiles ?? 10,
      customServices: [],
    };
    
    // Update the partner
    const result = await db.collection('partners').updateOne(
      { _id: partner._id },
      {
        $set: {
          servicesOffered: newServicesOffered,
          pricing: newPricing,
        },
      }
    );
    
    if (result.modifiedCount > 0) {
      console.log(`Partner ${partner._id}: Migrated successfully`);
      migrated++;
    } else {
      console.log(`Partner ${partner._id}: No changes made`);
    }
  }
  
  console.log(`\nMigration complete:`);
  console.log(`- Migrated: ${migrated}`);
  console.log(`- Skipped (already migrated): ${skipped}`);
  console.log(`- Total: ${partners.length}`);
  
  process.exit(0);
}

migratePartners().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
