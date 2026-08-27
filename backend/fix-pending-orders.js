const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function fixPendingOrders() {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error('MONGODB_URI is missing');
    process.exit(1);
  }

  await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB');

  const db = mongoose.connection.db;

  const ordersCollection = db.collection('orders');
  const paymentAttemptsCollection = db.collection('paymentattempts');
  const paymentsCollection = db.collection('payments');

  const pendingOrders = await ordersCollection.find({ paymentStatus: 'PENDING' }).toArray();
  console.log(`Found ${pendingOrders.length} pending orders.`);

  let updatedCount = 0;

  for (const order of pendingOrders) {
    const attempt = await paymentAttemptsCollection.findOne({ orderId: order._id });
    const payment = await paymentsCollection.findOne({ orderId: order._id });

    if (attempt || payment) {
      console.log(`Updating order ${order.orderNumber} (_id: ${order._id}) to PAID/CONFIRMED...`);
      await ordersCollection.updateOne(
        { _id: order._id },
        {
          $set: {
            paymentStatus: 'PAID',
            status: 'CONFIRMED',
            updatedAt: new Date()
          }
        }
      );

      if (attempt) {
        await paymentAttemptsCollection.updateOne(
          { _id: attempt._id },
          { $set: { status: 'CAPTURED', updatedAt: new Date() } }
        );
      }

      if (payment) {
        await paymentsCollection.updateOne(
          { _id: payment._id },
          { $set: { status: 'CAPTURED', updatedAt: new Date() } }
        );
      }

      updatedCount++;
    }
  }

  console.log(`Successfully updated ${updatedCount} orders to PAID & CONFIRMED.`);
  await mongoose.disconnect();
}

fixPendingOrders().catch((err) => {
  console.error('Script error:', err);
  process.exit(1);
});
