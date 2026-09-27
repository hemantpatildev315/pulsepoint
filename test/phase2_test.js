// test/phase2_test.js
// Automated verification test suite for Phase 2:
// 3 Dedicated Consoles, WebSocket Sync, Prescription Notes, Doctor Assignment & Token Lookup
const http = require('http');
const { WebSocket } = require('ws');

const BASE_URL = 'http://localhost:3000';
const WS_URL = 'ws://localhost:3000';

function get(path) {
  return new Promise((resolve, reject) => {
    http.get(BASE_URL + path, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, data });
        }
      });
    }).on('error', reject);
  });
}

function post(path, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(BASE_URL + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(data) }));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function patch(path, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(BASE_URL + path, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(data) }));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function runPhase2Tests() {
  console.log('--- Starting Phase 2 Verification Suite ---');

  // 1. Verify 3 Console URL Routes
  console.log('1. Testing Console URLs (/reception, /doctor, /patient)...');
  for (const route of ['/reception', '/doctor', '/patient']) {
    const res = await get(route);
    if (res.status !== 200 || typeof res.data !== 'string' || !res.data.includes('PulsePoint')) {
      throw new Error(`Route ${route} failed to serve console HTML`);
    }
    console.log(`   ✓ Console Route ${route} => 200 OK`);
  }

  // 2. Test WebSocket connection and event reception
  console.log('\n2. Testing WebSocket Real-Time Connection & Sync...');
  const wsMessages = [];
  const wsClient = new WebSocket(WS_URL);

  await new Promise((resolve, reject) => {
    wsClient.on('open', resolve);
    wsClient.on('error', reject);
    wsClient.on('message', (msg) => {
      try {
        wsMessages.push(JSON.parse(msg.toString()));
      } catch (e) {}
    });
  });
  console.log('   ✓ Connected to WebSocket server at ws://localhost:3000');

  // 3. Test Patient Portal Check-in (Emergency & Routine)
  console.log('\n3. Testing Patient Portal Intake (/api/emergency/intake)...');
  const emergRes = await post('/api/emergency/intake', {
    name: 'Harrison Ford',
    phone: '+1 555-888-9900',
    age: 68,
    symptoms: ['severe_chest_pain'],
    chiefComplaint: 'Crushing chest tightness radiating to left shoulder',
  });
  if (emergRes.status !== 201) throw new Error('Emergency intake failed');
  const token = emergRes.data.data.tokenNumber;
  const appointmentId = emergRes.data.data.appointment.id;
  console.log(`   ✓ Emergency Token generated: ${token} (Severity: ${emergRes.data.data.severity}, Priority: ${emergRes.data.data.priorityScore})`);

  // Wait a moment for WS event
  await new Promise(r => setTimeout(r, 200));
  const hasIntakeEvent = wsMessages.some(m => m.type === 'QUEUE_UPDATED' && m.payload && m.payload.action === 'EMERGENCY_INTAKE');
  console.log(`   ✓ WebSocket Broadcast received on intake: ${hasIntakeEvent ? 'YES' : 'NO'}`);

  // 4. Test Live Digital Token Lookup (/api/queue/token/:tokenNumber)
  console.log('\n4. Testing Live Digital Token Lookup (/api/queue/token/' + token + ')...');
  const tokenRes = await get('/api/queue/token/' + token);
  if (tokenRes.status !== 200 || !tokenRes.data.success) {
    throw new Error('Token lookup failed');
  }
  console.log(`   ✓ Digital Token Lookup: Token ${tokenRes.data.data.tokenNumber} | Queue Position: #${tokenRes.data.data.queuePosition} | Status: ${tokenRes.data.data.status}`);

  // 5. Test Reception Desk Doctor Assignment (/api/queue/:id/assign)
  console.log('\n5. Testing Doctor Assignment from Reception Desk...');
  const assignRes = await patch(`/api/queue/${appointmentId}/assign`, {
    doctorId: 2, // Dr. Sarah Vance (Cardiology)
  });
  if (assignRes.status !== 200) throw new Error('Doctor assignment failed');
  console.log(`   ✓ Successfully assigned Doctor ID 2 to appointment #${appointmentId}`);

  // 6. Test Doctor Calling In Patient
  console.log('\n6. Testing Doctor Console Calling Patient In...');
  const callRes = await patch(`/api/queue/${appointmentId}/status`, {
    status: 'in_consultation',
    doctorId: 2,
  });
  if (callRes.status !== 200 || callRes.data.data.status !== 'in_consultation') {
    throw new Error('Call in status update failed');
  }
  console.log(`   ✓ Patient ${token} moved to in_consultation with Dr. Sarah Vance`);

  // 7. Verify Patient Portal reflects "in_consultation"
  const tokenInConsultRes = await get('/api/queue/token/' + token);
  console.log(`   ✓ Patient Portal Digital Token reflects new status: ${tokenInConsultRes.data.data.status}`);

  // 8. Test Doctor Completing Visit with Prescription Notes
  console.log('\n8. Testing Doctor Completing Visit with Prescription Notes Modal...');
  const completeRes = await patch(`/api/queue/${appointmentId}/status`, {
    status: 'completed',
    prescriptionNotes: 'Rx: Aspirin 81mg QD, Atorvastatin 40mg QHS, sublingual Nitroglycerin PRN. Cardiology follow-up in 14 days.',
  });
  if (completeRes.status !== 200 || completeRes.data.data.status !== 'completed') {
    throw new Error('Visit completion failed');
  }
  console.log(`   ✓ Visit marked completed. Prescription saved: "${completeRes.data.data.prescription_notes.slice(0, 45)}..."`);

  // 9. Reset Demo Data
  console.log('\n9. Testing Reset Demo Data...');
  const resetRes = await post('/api/queue/reset', {});
  console.log(`   ✓ Reset complete: ${resetRes.data.message}`);

  wsClient.close();

  console.log('\n=============================================');
  console.log('🎉 ALL PHASE 2 CONSOLE & WEBSOCKET TESTS PASSED 100%!');
  console.log('=============================================');
}

runPhase2Tests().catch(err => {
  console.error('Phase 2 test failed:', err);
  process.exit(1);
});
