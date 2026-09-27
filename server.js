// server.js
require('dotenv').config();
const app = require('./src/app');
const { initDatabase, dbConfig } = require('./src/config/db');

const { initWebSocket } = require('./src/services/wsServer');

const PORT = process.env.PORT || 3000;

async function startServer() {
  // Ensure MySQL database & tables are initialized
  await initDatabase();

  const server = app.listen(PORT, () => {
    console.log(`=====================================================`);
    console.log(`🏥 CLINIC APPOINTMENT & EMERGENCY MANAGEMENT SYSTEM`);
    console.log(`   Phase 2 Dedicated Consoles & Real-Time Sync`);
    console.log(`   Database: ${dbConfig.database} @ ${dbConfig.host}:${dbConfig.port}`);
    console.log(`   Server running on http://localhost:${PORT}`);
    console.log(`=====================================================`);
    console.log(`   - Reception Desk:   http://localhost:${PORT}/reception`);
    console.log(`   - Doctor Console:   http://localhost:${PORT}/doctor`);
    console.log(`   - Patient Portal:   http://localhost:${PORT}/patient`);
    console.log(`   - Real-Time WS:     ws://localhost:${PORT}`);
    console.log(`=====================================================`);
  });

  // Attach WebSocket server for real-time broadcasts across consoles
  initWebSocket(server);

  // Graceful shutdown handling
  process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    server.close(() => {
      console.log('HTTP server closed');
    });
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
});

