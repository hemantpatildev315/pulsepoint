// src/services/wsServer.js
// Lightweight WebSocket Broadcast Server for Real-Time Synchronization across Consoles
const { WebSocketServer, WebSocket } = require('ws');

let wss = null;

function initWebSocket(server) {
  wss = new WebSocketServer({ server });

  wss.on('connection', (ws, req) => {
    // Send immediate initial sync acknowledgment
    ws.send(JSON.stringify({
      type: 'CONNECTED',
      message: 'PulsePoint Real-Time Telemetry Connected',
      timestamp: new Date().toISOString(),
    }));

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);
        if (data.type === 'PING') {
          ws.send(JSON.stringify({ type: 'PONG', timestamp: new Date().toISOString() }));
        }
      } catch (e) {
        // ignore non-json
      }
    });

    ws.on('error', (err) => {
      console.warn('[WS] Client connection error:', err.message);
    });
  });

  console.log('[WS] WebSocket Server active on /');
  return wss;
}

/**
 * Broadcasts an event to all open consoles (Reception, Doctor, Patient)
 * @param {string} type 
 * @param {Object} payload 
 */
function broadcast(type, payload = {}) {
  if (!wss) return;
  const message = JSON.stringify({
    type,
    payload,
    timestamp: new Date().toISOString(),
  });

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(message);
      } catch (err) {
        console.warn('[WS] Failed to send to client:', err.message);
      }
    }
  });
}

module.exports = {
  initWebSocket,
  broadcast,
};
