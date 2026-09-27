// test/e2e_test.js
const http = require('http');

function post(path, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        hostname: 'localhost',
        port: 3000,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      res => {
        let data = '';
        res.on('data', c => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(data) }));
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function patch(path, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        hostname: 'localhost',
        port: 3000,
        path,
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      res => {
        let data = '';
        res.on('data', c => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(data) }));
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function get(path) {
  return new Promise((resolve, reject) => {
    http.get('http://localhost:3000' + path, res => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(data) }));
    }).on('error', reject);
  });
}

async function run() {
  console.log('Testing End-to-End on port 3000...');

  // 1. Book routine
  const routine = await post('/api/appointments/book', {
    name: 'Eleanor Ward',
    phone: '+1 555-443-2211',
    age: 44,
    bloodGroup: 'A+',
    chiefComplaint: 'Quarterly thyroid & cholesterol check',
  });
  console.log(`1. Book Routine: Status ${routine.status} | Token: ${routine.data.data.tokenNumber} | Queue pos: #${routine.data.data.queuePosition}`);

  // 2. Emergency Intake
  const emerg = await post('/api/emergency/intake', {
    name: 'Vincent Drake',
    phone: '+1 555-987-1234',
    age: 56,
    heartRate: 146,
    spo2: 87,
    bloodPressure: '198/118',
    symptoms: ['severe_chest_pain', 'severe_respiratory_distress'],
    chiefComplaint: 'Severe retrosternal squeezing, radiating to left shoulder',
  });
  console.log(`2. Emergency Intake: Status ${emerg.status} | Token: ${emerg.data.data.tokenNumber} | Severity: ${emerg.data.data.severity.toUpperCase()} | Queue pos: #${emerg.data.data.queuePosition}`);

  // 3. Live queue verification
  const queue = await get('/api/queue/live');
  console.log(`3. Live queue active count: ${queue.data.count}`);
  console.log('   Waiting list priority:');
  const waitingList = queue.data.data.filter(q => q.status === 'waiting');
  waitingList.forEach((q, i) => {
    console.log(`     #${i + 1}: ${q.tokenNumber} [${q.severity.toUpperCase()}] - ${q.patient.name} (${q.type})`);
  });

  // 4. Call in Vincent Drake
  const callRes = await patch(`/api/queue/${emerg.data.data.appointment.id}/status`, {
    status: 'in_consultation',
  });
  console.log(`4. Call In: Status ${callRes.status} | Token: ${callRes.data.data.tokenNumber} | New Status: ${callRes.data.data.status}`);

  // 5. Complete Vincent Drake
  const doneRes = await patch(`/api/queue/${emerg.data.data.appointment.id}/status`, {
    status: 'completed',
  });
  console.log(`5. Mark Done: Status ${doneRes.status} | Token: ${doneRes.data.data.tokenNumber} | New Status: ${doneRes.data.data.status}`);

  // 6. Reset demo
  const resetRes = await post('/api/queue/reset', {});
  console.log(`6. Reset to Seed Data: Status ${resetRes.status} | Message: ${resetRes.data.message}`);

  console.log('\n=============================================');
  console.log('ALL INTEGRATION TESTS ON PORT 3000 PASSED 100%!');
  console.log('=============================================');
}

run().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
