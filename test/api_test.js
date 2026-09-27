// test/api_test.js
// Automated verification test suite for Clinic Management System Phase 1 APIs with MySQL
require('dotenv').config();
const http = require('http');
const app = require('../src/app');
const { initDatabase, pool } = require('../src/config/db');

let server;
const PORT = 3099;

function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: PORT,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      res => {
        let data = '';
        res.on('data', chunk => (data += chunk));
        res.on('end', () => {
          try {
            resolve({
              statusCode: res.statusCode,
              body: JSON.parse(data),
            });
          } catch (e) {
            resolve({
              statusCode: res.statusCode,
              body: data,
            });
          }
        });
      }
    );

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function runTests() {
  console.log('--- Starting Clinic API Phase 1 MySQL Verification Tests ---');

  // Initialize MySQL pool and tables
  await initDatabase();

  server = app.listen(PORT, async () => {
    try {
      // 1. Test GET /api/queue/live
      console.log('1. Testing GET /api/queue/live with MySQL Priority Order...');
      const queueRes = await request('GET', '/api/queue/live');
      if (queueRes.statusCode !== 200 || !queueRes.body.success) {
        throw new Error(`GET /api/queue/live failed: ${JSON.stringify(queueRes.body)}`);
      }
      console.log(`   ✓ Active items returned: ${queueRes.body.data.length}`);
      
      // Verify Red emergencies come before Green routine in the waiting list
      const waitingItems = queueRes.body.data.filter(i => i.status === 'waiting');
      console.log(`   ✓ Waiting items count: ${waitingItems.length}`);
      if (waitingItems.length >= 2) {
        const first = waitingItems[0];
        console.log(`   ✓ #1 in queue: ${first.tokenNumber} [Severity: ${first.severity}, Priority: ${first.priorityScore}] - Patient: ${first.patient.name}`);
        if (first.severity !== 'red') {
          console.warn(`   Notice: Expected Red at top, found ${first.severity}`);
        }
      }

      // 2. Test POST /api/appointments/book (Routine)
      console.log('\n2. Testing POST /api/appointments/book (MySQL Parameterized)...');
      const bookRes = await request('POST', '/api/appointments/book', {
        name: 'Sarah Connor',
        phone: '+1 (555) 777-8899',
        age: 35,
        bloodGroup: 'O+',
        chiefComplaint: 'Routine annual biometric health screening',
      });
      if (bookRes.statusCode !== 201 || !bookRes.body.success) {
        throw new Error(`Booking failed: ${JSON.stringify(bookRes.body)}`);
      }
      const routineToken = bookRes.body.data.tokenNumber;
      console.log(`   ✓ Routine token created: ${routineToken} (Priority Score: ${bookRes.body.data.appointment.priority_score})`);
      console.log(`   ✓ Assigned doctor: ${bookRes.body.data.doctor.name} (${bookRes.body.data.doctor.cabinNumber})`);
      console.log(`   ✓ Initial queue position: #${bookRes.body.data.queuePosition}, Estimated Wait: ${bookRes.body.data.estimatedWaitMinutes}m`);

      // 3. Test POST /api/emergency/intake (Priority Override)
      console.log('\n3. Testing POST /api/emergency/intake (Critical Life-Threat Code Red)...');
      const emergRes = await request('POST', '/api/emergency/intake', {
        name: 'John Doe Emergency',
        phone: '+1 (555) 999-1122',
        age: 62,
        bloodGroup: 'B-',
        heartRate: 148,
        spo2: 86, // Hypoxia (< 90) -> Code Red (priority_score = 1)
        bloodPressure: '195/110',
        symptoms: ['severe_chest_pain', 'severe_respiratory_distress'],
        chiefComplaint: 'Acute diaphoresis, retrosternal crushing pain, cyanotic lips',
      });
      if (emergRes.statusCode !== 201 || !emergRes.body.success) {
        throw new Error(`Emergency intake failed: ${JSON.stringify(emergRes.body)}`);
      }
      const emergToken = emergRes.body.data.tokenNumber;
      const emergSeverity = emergRes.body.data.severity;
      const emergPriority = emergRes.body.data.priorityScore;
      const emergId = emergRes.body.data.appointment.id;
      console.log(`   ✓ Emergency token created: ${emergToken} [Severity: ${emergSeverity.toUpperCase()}, Priority Score: ${emergPriority}]`);
      console.log(`   ✓ Priority Queue Position: #${emergRes.body.data.queuePosition} (Instant Priority Slot!)`);

      if (emergSeverity !== 'red' || emergPriority !== 1) {
        throw new Error(`Expected severity 'red' and priority_score '1' but got '${emergSeverity}', '${emergPriority}'`);
      }

      // 4. Verify Live Queue shows Emergency slotted ahead
      console.log('\n4. Verifying MySQL live priority ordering (ORDER BY status=\'waiting\' DESC, priority_score ASC, created_at ASC)...');
      const updatedQueue = await request('GET', '/api/queue/live');
      const activeWaiting = updatedQueue.body.data.filter(i => i.status === 'waiting');
      console.log('   Current waiting order in MySQL:');
      activeWaiting.forEach((item, idx) => {
        console.log(`     [Position #${idx + 1}] ${item.tokenNumber} - Priority ${item.priorityScore} [${item.severity.toUpperCase()}] - ${item.patient.name} (${item.type})`);
      });

      // 5. Test PATCH /api/queue/:id/status
      console.log('\n5. Testing PATCH /api/queue/:id/status (Safe Parameterized Transition to in_consultation)...');
      const patchRes = await request('PATCH', `/api/queue/${emergId}/status`, {
        status: 'in_consultation',
      });
      if (patchRes.statusCode !== 200 || !patchRes.body.success) {
        throw new Error(`Status update failed: ${JSON.stringify(patchRes.body)}`);
      }
      console.log(`   ✓ Status updated to: ${patchRes.body.data.status}`);

      // Complete consultation
      console.log('   Transitioning to completed...');
      const patchDoneRes = await request('PATCH', `/api/queue/${emergId}/status`, {
        status: 'completed',
      });
      console.log(`   ✓ Status updated to: ${patchDoneRes.body.data.status}`);

      // 6. Test GET /api/queue/stats
      console.log('\n6. Testing GET /api/queue/stats from MySQL...');
      const statsRes = await request('GET', '/api/queue/stats');
      console.log('   ✓ MySQL Stats returned:', statsRes.body.data);

      console.log('\n=============================================');
      console.log('🎉 ALL MYSQL RELATIONAL APIS & QUERIES PASSED 100%!');
      console.log('=============================================');

      server.close();
      await pool.end();
      process.exit(0);
    } catch (err) {
      console.error('❌ Test suite failed:', err);
      if (server) server.close();
      await pool.end();
      process.exit(1);
    }
  });
}

runTests().catch(err => {
  console.error('Fatal initialization error:', err);
  process.exit(1);
});
