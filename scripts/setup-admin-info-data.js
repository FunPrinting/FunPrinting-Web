/**
 * Script to save admin information to the database
 * Run this script to populate admin information from the provided data
 */

require('dotenv').config({ path: '.env.local' });

const adminInfoData = {
  name: 'Fun Printing Service',
  email: process.env.ADMIN_INFO_EMAIL || process.env.ADMIN_EMAIL || '',
  phone: '7060179070',
  website: 'https://adityapandey-dev.github.io',
  address: 'Laldath',
  city: 'Haldwani',
  state: 'Uttarakhand', // Corrected: Haldwani is in Uttarakhand, not India
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

console.log('📋 Admin Information Data:');
console.log(JSON.stringify(adminInfoData, null, 2));
console.log('\n💡 To save this data, you can:');
console.log('1. Use the admin panel at /admin/info');
console.log('2. Or use the API endpoint POST /api/admin/info with this JSON data');
console.log('\n📝 Note: Logo and Favicon URLs appear to be Google search URLs.');
console.log('   Consider updating them to direct image URLs for better performance.');

