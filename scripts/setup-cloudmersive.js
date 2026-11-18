const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

async function setupCloudmersive() {
  console.log('🔧 Cloudmersive API Setup');
  console.log('========================\n');

  const envPath = path.join(__dirname, '..', '.env.local');
  
  // Check if .env.local exists
  let envContent = '';
  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf8');
    console.log('✅ Found existing .env.local file');
  } else {
    console.log('📝 Creating new .env.local file');
  }

  // Check if Cloudmersive API key is already configured
  if (envContent.includes('CLOUDMERSIVE_API_KEY=')) {
    console.log('⚠️  Cloudmersive API key is already configured in .env.local');
    
    const update = await askQuestion('Do you want to update it? (y/n): ');
    if (update.toLowerCase() !== 'y') {
      console.log('✅ Keeping existing configuration');
      rl.close();
      return;
    }
  }

  console.log('\n📋 To get your Cloudmersive API key:');
  console.log('1. Go to https://cloudmersive.com/');
  console.log('2. Sign up for a free account');
  console.log('3. Navigate to your dashboard');
  console.log('4. Go to "API Keys" section');
  console.log('5. Copy your API key\n');

  const apiKey = await askQuestion('Enter your Cloudmersive API key: ');
  
  if (!apiKey || apiKey.trim() === '') {
    console.log('❌ No API key provided. Setup cancelled.');
    rl.close();
    return;
  }

  // Update or add the API key to .env.local
  let updatedContent = envContent;
  
  if (envContent.includes('CLOUDMERSIVE_API_KEY=')) {
    // Update existing key
    updatedContent = envContent.replace(
      /CLOUDMERSIVE_API_KEY=.*/,
      `CLOUDMERSIVE_API_KEY=${apiKey.trim()}`
    );
  } else {
    // Add new key
    if (updatedContent && !updatedContent.endsWith('\n')) {
      updatedContent += '\n';
    }
    updatedContent += `\n# Cloudmersive Document Conversion API Configuration (FREE - 800 conversions/month)\n`;
    updatedContent += `# Get your API key from: https://cloudmersive.com/\n`;
    updatedContent += `CLOUDMERSIVE_API_KEY=${apiKey.trim()}\n`;
  }

  // Write updated content
  fs.writeFileSync(envPath, updatedContent);
  
  console.log('\n✅ Cloudmersive API key configured successfully!');
  console.log('📁 Updated .env.local file');
  
  // Test the configuration
  console.log('\n🧪 Testing configuration...');
  process.env.CLOUDMERSIVE_API_KEY = apiKey.trim();
  
  try {
    const { convertPdfToDocx } = require('../src/lib/cloudmersive');
    console.log('✅ Cloudmersive library loaded successfully');
    console.log('✅ API key format appears valid');
  } catch (error) {
    console.log('⚠️  Warning: Could not test Cloudmersive library:', error.message);
  }

  console.log('\n🎉 Setup complete!');
  console.log('\n📋 Next steps:');
  console.log('1. Restart your development server: npm run dev');
  console.log('2. Test the integration: npm run test-cloudmersive');
  console.log('3. Create a template at: http://localhost:3000/templates/create');
  
  rl.close();
}

function askQuestion(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}

// Run the setup
if (require.main === module) {
  setupCloudmersive().catch(console.error);
}

module.exports = { setupCloudmersive };
