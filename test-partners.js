const mongoose = require('mongoose');
require('dotenv').config({ path: '.env' });
async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const Partner = mongoose.model('Partner', new mongoose.Schema({}, { strict: false }));
  const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }));
  const Order = mongoose.model('Order', new mongoose.Schema({}, { strict: false }));
  
  const partners = await Partner.find({});
  console.log("Partners:", partners.map(p => ({ email: p.email, id: p._id.toString(), userId: p.userId })));
  
  const users = await User.find({ email: /ananya/i });
  console.log("Users ananya:", users.map(u => ({ email: u.email, id: u._id.toString() })));
  
  const orders = await Order.find({ "deliveryOption.partnerId": { $exists: true } });
  console.log("Some orders partnerIds:", orders.slice(0, 5).map(o => o.deliveryOption?.partnerId));
  
  mongoose.disconnect();
}
run();
