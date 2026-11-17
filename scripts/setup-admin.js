const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');

// Connect to MongoDB
const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI is not set');
  process.exit(1);
}

async function setupAdmin() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    // Define Admin schema
    const adminSchema = new mongoose.Schema({
      email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
      },
      password: {
        type: String,
        required: true,
      },
      name: {
        type: String,
        required: true,
      },
      role: {
        type: String,
        enum: ['admin', 'super-admin'],
        default: 'admin',
      },
    }, {
      timestamps: true,
    });

    const Admin = mongoose.models.Admin || mongoose.model('Admin', adminSchema);

    // Check if admin already exists
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;
    if (!adminEmail || !adminPassword) {
      console.error('❌ ADMIN_EMAIL and ADMIN_PASSWORD must be set to run this script');
      return;
    }
    const existingAdmin = await Admin.findOne({ email: adminEmail.toLowerCase() });
    
    if (existingAdmin) {
      console.log('Admin user already exists');
      return;
    }

    // Create admin user
    const hashedPassword = await bcrypt.hash(adminPassword, 10);
    
    const admin = new Admin({
      email: adminEmail.toLowerCase(),
      password: hashedPassword,
      name: 'System Administrator',
      role: 'super-admin',
    });

    await admin.save();
    console.log('Admin user created successfully');
    console.log(`Email: ${adminEmail}`);

  } catch (error) {
    console.error('Error setting up admin:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

setupAdmin();
