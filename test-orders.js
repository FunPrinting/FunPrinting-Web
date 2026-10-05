const mongoose = require('mongoose');
require('dotenv').config({ path: '.env' });
async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const Order = mongoose.model('Order', new mongoose.Schema({}, { strict: false }));
  
  const ordersAnanya = await Order.countDocuments({ "deliveryOption.partnerId": '6ac28e02344b3b0bc24b24e5' });
  const ordersOther = await Order.countDocuments({ "deliveryOption.partnerId": '6ac295e73ac514a3d663b65c' });
  const ordersTotal = await Order.countDocuments({});
  
  console.log("Ananya orders:", ordersAnanya);
  console.log("Other orders:", ordersOther);
  console.log("Total orders:", ordersTotal);
  
  mongoose.disconnect();
}
run();
