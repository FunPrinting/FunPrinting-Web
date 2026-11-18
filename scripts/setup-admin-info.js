require('dotenv').config({ path: '.env.local' });
const mongoose = require('mongoose');
const AdminInfo = require('../src/models/AdminInfo').default || require('../src/models/AdminInfo');

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('Please define MONGODB_URI environment variable in .env.local');
  process.exit(1);
}

async function setupAdminInfo() {
  try {
    // Connect to MongoDB
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Admin information data
    const adminInfoData = {
      name: 'Fun Printing Service',
      email: process.env.ADMIN_INFO_EMAIL || process.env.ADMIN_EMAIL || '',
      phone: '7060179070',
      website: 'https://adityapandey-dev.github.io',
      address: 'Laldath',
      city: 'Haldwani',
      state: 'Uttarakhand', // Haldwani is in Uttarakhand
      pincode: '263139',
      country: 'India',
      socialMedia: {
        linkedin: 'https://www.linkedin.com/in/adityapandey-dev/',
      },
      businessHours: {
        monday: '9-5',
        tuesday: '9-5',
        wednesday: '9-5',
        thursday: '9-5',
        friday: '9-5',
        saturday: '9-5',
        sunday: 'Closed',
      },
      description: 'Fun Printing Service offers professional printing services including color prints, B/W prints, binding, and document templates. Fast, reliable, and affordable printing solutions for college students and professionals.',
      logo: 'https://www.google.com/imgres?q=printing&imgurl=https%3A%2F%2Fwww.studio22online.co.za%2Fwp-content%2Fuploads%2F2024%2F06%2Fprinter-with-picture-mountain-it-1024x585.jpg&imgrefurl=https%3A%2F%2Fwww.studio22online.co.za%2Fthe-art-of-printing-a-guide-for-photographers-and-artists%2F&docid=X2INixrC1emcwM&tbnid=E31MFFkAu3y8FM&vet=12ahUKEwiCtN6XwMGPAxVcdfUHHXufA24QM3oECBYQAA..i&w=1024&h=585&hcb=2&ved=2ahUKEwiCtN6XwMGPAxVcdfUHHXufA24QM3oECBYQAA',
      favicon: 'https://www.google.com/imgres?q=printing&imgurl=https%3A%2F%2Fwww.studio22online.co.za%2Fwp-content%2Fuploads%2F2024%2F06%2Fprinter-with-picture-mountain-it-1024x585.jpg&imgrefurl=https%3A%2F%2Fwww.studio22online.co.za%2Fthe-art-of-printing-a-guide-for-photographers-and-artists%2F&docid=X2INixrC1emcwM&tbnid=E31MFFkAu3y8FM&vet=12ahUKEwiCtN6XwMGPAxVcdfUHHXufA24QM3oECBYQAA..i&w=1024&h=585&hcb=2&ved=2ahUKEwiCtN6XwMGPAxVcdfUHHXufA24QM3oECBYQAA',
      seoTitle: 'Fun Printing - Professional Printing Services',
      seoDescription: 'Fun Printing offers professional printing services including color prints, B/W prints, binding, and document templates.',
      seoKeywords: 'fun printing, printing service, print shop, document printing',
      ogImage: 'https://www.funprinting.store/og-image.jpg',
      isActive: true,
    };

    // Check if admin info already exists
    const existingAdmin = await AdminInfo.findOne({ isActive: true });

    if (existingAdmin) {
      // Update existing admin
      const updatedAdmin = await AdminInfo.findByIdAndUpdate(
        existingAdmin._id,
        adminInfoData,
        { new: true, runValidators: true }
      );
      console.log('✅ Admin information updated successfully!');
      console.log('📋 Updated admin info:', JSON.stringify(updatedAdmin, null, 2));
    } else {
      // Create new admin
      const admin = new AdminInfo(adminInfoData);
      await admin.save();
      console.log('✅ Admin information created successfully!');
      console.log('📋 Created admin info:', JSON.stringify(admin, null, 2));
    }

    console.log('\n✨ Setup completed successfully!');
  } catch (error) {
    console.error('❌ Error setting up admin info:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
}

setupAdminInfo();

