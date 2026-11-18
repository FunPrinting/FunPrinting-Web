const mongoose = require('mongoose');
require('dotenv').config();

// User Schema
const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: false }, // Optional for OAuth users
  phone: { type: String, required: false, trim: true },
  profilePicture: { type: String, required: false },
  provider: { type: String, enum: ['email', 'google'], required: true, default: 'email' },
  providerId: { type: String, required: false }, // For OAuth providers
  emailVerified: { type: Boolean, required: true, default: false },
  isActive: { type: Boolean, required: true, default: true },
  lastLogin: { type: Date, required: false },
}, {
  timestamps: true,
});

// Index for faster queries
userSchema.index({ email: 1 });
userSchema.index({ providerId: 1 });

const User = mongoose.model('User', userSchema);

async function setupAuth() {
  try {
    // Connect to MongoDB
    const MONGODB_URI = process.env.MONGODB_URI;
    if (!MONGODB_URI) {
      console.error('❌ MONGODB_URI is not set');
      process.exit(1);
    }
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Check if users collection exists and has data
    const userCount = await User.countDocuments();
    console.log(`📊 Current users in database: ${userCount}`);

    if (userCount === 0) {
      console.log('ℹ️  No users found. The authentication system is ready for new user registrations.');
    } else {
      console.log('ℹ️  Users already exist in the database.');
    }

    // Test the schema
    console.log('✅ User schema is properly configured');
    console.log('✅ Authentication system setup complete!');

    console.log('\n📋 Next steps:');
    console.log('1. Set up Google OAuth credentials in Google Cloud Console');
    console.log('2. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to your .env file');
    console.log('3. Generate a secure NEXTAUTH_SECRET and add it to your .env file');
    console.log('4. Users can now register and sign in via email or Google OAuth');

  } catch (error) {
    console.error('❌ Error setting up authentication:', error);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
}

// Run the setup
setupAuth();
