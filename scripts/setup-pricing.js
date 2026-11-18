const mongoose = require('mongoose');
require('dotenv').config();

// Define the Pricing schema
const pricingSchema = new mongoose.Schema({
  basePrices: {
    A4: { type: Number, required: true, default: 5 },
    A3: { type: Number, required: true, default: 10 },
  },
  multipliers: {
    color: { type: Number, required: true, default: 2 },
    doubleSided: { type: Number, required: true, default: 1.5 },
  },
  deliveryCharges: {
    pickup: { type: Number, required: true, default: 0 },
    delivery: {
      '0-5': { type: Number, required: true, default: 10 },
      '5-10': { type: Number, required: true, default: 20 },
      '10-15': { type: Number, required: true, default: 30 },
      '15-20': { type: Number, required: true, default: 40 },
      '20+': { type: Number, required: true, default: 50 },
    },
  },
  additionalServices: {
    binding: { type: Number, required: true, default: 20 },
    resumeTemplate: { type: Number, required: true, default: 0 },
  },
  updatedBy: { type: String, required: true },
}, {
  timestamps: true,
});

// Ensure only one pricing document exists
pricingSchema.index({}, { unique: true });

const Pricing = mongoose.model('Pricing', pricingSchema);

async function setupPricing() {
  try {
    // Connect to MongoDB
    const MONGODB_URI = process.env.MONGODB_URI;
    if (!MONGODB_URI) {
      console.error('❌ MONGODB_URI is not set');
      process.exit(1);
    }
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Check if pricing already exists
    const existingPricing = await Pricing.findOne();
    
    if (existingPricing) {
      console.log('ℹ️  Pricing already exists in database');
      console.log('Current pricing configuration:');
      console.log(JSON.stringify(existingPricing, null, 2));
      
      // Delete existing pricing to recreate with correct structure
      console.log('🗑️  Deleting existing pricing to recreate with correct structure...');
      await Pricing.deleteMany({});
      console.log('✅ Existing pricing deleted');
    }

    // Create default pricing
    const defaultPricing = new Pricing({
      basePrices: {
        A4: 5,
        A3: 10,
      },
      multipliers: {
        color: 2,
        doubleSided: 1.5,
      },
      deliveryCharges: {
        pickup: 0,
        delivery: {
          '0-5': 10,
          '5-10': 20,
          '10-15': 30,
          '15-20': 40,
          '20+': 50,
        },
      },
      additionalServices: {
        binding: 20,
        resumeTemplate: 0,
      },
      updatedBy: 'system',
    });

    await defaultPricing.save();
    console.log('✅ Default pricing created successfully!');
    console.log('Pricing configuration:');
    console.log(JSON.stringify(defaultPricing, null, 2));

  } catch (error) {
    console.error('❌ Error setting up pricing:', error);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
}

// Run the setup
setupPricing();
