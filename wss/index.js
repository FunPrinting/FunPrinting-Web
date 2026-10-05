const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const jwt = require('jsonwebtoken');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const JWT_SECRET = process.env.NEXTAUTH_SECRET || 'fallback-secret-for-development';

// Middleware for WebSocket Auth
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) {
    return next(new Error('Authentication error: No token provided'));
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'partner' && decoded.role !== 'admin') {
      return next(new Error('Authentication error: Invalid role'));
    }
    
    // Store partner info in socket
    socket.partnerId = decoded.partnerId || decoded.sub; // Adjust based on your NextAuth JWT payload
    next();
  } catch (err) {
    return next(new Error('Authentication error: Invalid token'));
  }
});

io.on('connection', (socket) => {
  console.log(`🟢 Partner connected: ${socket.partnerId} (Socket ID: ${socket.id})`);
  
  // Join a room specific to this partner
  socket.join(`partner_${socket.partnerId}`);

  // Partner updates their hardware status
  socket.on('hardware_status_update', (data) => {
    console.log(`🖨️ Hardware update from ${socket.partnerId}:`, data);
    // In a full implementation, you would update the MongoDB Partner record here
  });

  // Partner ACKs a print job
  socket.on('print_job_ack', (data) => {
    console.log(`✅ Job ${data.jobId} ACKed by ${socket.partnerId}`);
    // Here we would implement the AIMD congestion control scaling (Phase 7)
  });

  // Phase 5: Remote Control Forwarding (Mobile App -> PC App)
  socket.on('remote_control', (data) => {
    console.log(`📱 Remote control action '${data.action}' from ${socket.partnerId}`);
    // Forward the command to all other devices in the partner's room (e.g. the PC App)
    socket.to(`partner_${socket.partnerId}`).emit('remote_control_action', data);
  });

  socket.on('disconnect', () => {
    console.log(`🔴 Partner disconnected: ${socket.partnerId}`);
  });
});

// HTTP Webhook for the Next.js API to trigger print jobs
// When Razorpay confirms payment, Next.js calls this endpoint.
app.post('/api/dispatch-print-job', (req, res) => {
  const { partnerId, order } = req.body;
  
  if (!partnerId || !order) {
    return res.status(400).json({ error: 'Missing partnerId or order data' });
  }

  console.log(`🚀 Dispatching print job for Order ${order.orderId} to Partner ${partnerId}`);
  
  // Emit exclusively to the partner's room
  io.to(`partner_${partnerId}`).emit('new_print_job', {
    jobId: order.orderId,
    timestamp: Date.now(),
    documentUrl: order.fileURL || (order.fileURLs ? order.fileURLs[0] : null), // legacy
    fileURLs: order.fileURLs,
    originalFileNames: order.originalFileNames,
    fileTypes: order.fileTypes,
    options: order.printingOptions,
    customer: order.customerInfo,
    orderDetails: order
  });

  res.status(200).json({ success: true, message: 'Print job dispatched to socket room' });
});

app.post('/api/cancel-print-job', (req, res) => {
  const { partnerId, orderId } = req.body;
  
  if (!partnerId || !orderId) {
    return res.status(400).json({ error: 'Missing partnerId or orderId' });
  }

  console.log(`🛑 Cancelling print job for Order ${orderId} to Partner ${partnerId}`);
  
  // Emit cancel event to partner's room
  io.to(`partner_${partnerId}`).emit('cancel_print_job', { jobId: orderId });

  res.status(200).json({ success: true, message: 'Cancel request dispatched to socket room' });
});

const PORT = process.env.WSS_PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 FunPrinting WebSocket Cloud Engine running on port ${PORT}`);
});
