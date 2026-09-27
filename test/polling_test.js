// test/polling_test.js
// Verification for Serverless / Vercel Database-Driven Short Polling & Call Alarm
const http = require('http');

const BASE_URL = 'http://localhost:3000';

function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch (e) {
          json = data;
        }
        resolve({ status: res.statusCode, data: json });
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runPollingTests() {
  console.log('========================================================');
  console.log('🧪 TESTING DATABASE-DRIVEN SHORT POLLING FOR VERCEL');
  console.log('========================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${message}`);
      failed++;
    }
  }

  try {
    // 1. Validation for missing token/patientId
    console.log('1. Parameter Validation:');
    const noParams = await request('GET', '/api/queue/patient-status');
    assert(noParams.status === 400, 'GET /api/queue/patient-status without params returns 400 Bad Request');

    // 2. Querying a non-existent token
    const notFound = await request('GET', '/api/queue/patient-status?tokenNumber=NON_EXISTENT_9999');
    assert(notFound.status === 404, 'Non-existent token returns 404 Not Found');

    // 3. Book a fresh outpatient to test the waiting -> in_consultation transition
    console.log('\n2. Outpatient Booking & Initial Polling State:');
    const bookRes = await request('POST', '/api/appointments/book', {
      name: 'Vercel Polling Test Patient',
      phone: '+1 555-987-6543',
      age: 32,
      chiefComplaint: 'Mild seasonal allergies and cough',
    });
    assert(bookRes.status === 201, 'Booked test patient (201 Created)');

    const tokenNumber = bookRes.data.data.tokenNumber;
    const appointmentId = bookRes.data.data.appointment.id;
    console.log(`   Assigned Token: ${tokenNumber} (Appointment #${appointmentId})`);

    // Poll status while waiting
    const waitPoll = await request('GET', `/api/queue/patient-status?tokenNumber=${encodeURIComponent(tokenNumber)}`);
    assert(waitPoll.status === 200, 'Poll returned 200 OK');
    assert(waitPoll.data.data.status === 'waiting', 'Patient status is "waiting"');
    assert(waitPoll.data.data.isCalled === false, 'isCalled flag is false while waiting');
    assert(waitPoll.data.data.queuePosition >= 1, `Queue position calculated (#${waitPoll.data.data.queuePosition})`);

    // 4. Doctor calls patient into cabin (commits directly to MySQL)
    console.log('\n3. Doctor Calls Patient & Real-Time Polling Detection:');
    const callRes = await request('PATCH', `/api/queue/${appointmentId}/status`, {
      status: 'in_consultation',
      doctorId: 3, // Dr. Priya Patel, Cabin 104
    });
    assert(callRes.status === 200, 'Doctor called patient in (status updated in DB)');

    // Simulate next 2-second short poll tick from Patient Portal
    const calledPoll = await request('GET', `/api/queue/patient-status?tokenNumber=${encodeURIComponent(tokenNumber)}`);
    assert(calledPoll.status === 200, 'Poll after doctor call returned 200 OK');
    assert(calledPoll.data.data.status === 'in_consultation', 'Status transitioned to "in_consultation" in database');
    assert(calledPoll.data.data.isCalled === true, 'isCalled flag is TRUE for audio chime & visual modal trigger');
    assert(Boolean(calledPoll.data.data.cabinNumber), `Cabin number populated: "${calledPoll.data.data.cabinNumber}"`);
    assert(Boolean(calledPoll.data.data.doctorName), `Doctor name populated: "${calledPoll.data.data.doctorName}"`);
    assert(Boolean(calledPoll.data.data.calledAt), `calledAt timestamp recorded: "${calledPoll.data.data.calledAt}"`);

    // 5. Query by patientId parameter
    console.log('\n4. Querying by patientId parameter:');
    const patientId = bookRes.data.data.patient.id;
    const byPatientId = await request('GET', `/api/queue/patient-status?patientId=${patientId}`);
    assert(byPatientId.status === 200, 'Query by patientId returned 200 OK');
    assert(byPatientId.data.data.tokenNumber === tokenNumber, 'Matches expected patient token');

    // ---------------------------------------------------------
    // SUMMARY
    // ---------------------------------------------------------
    console.log('\n========================================================');
    console.log(`📊 POLLING TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log('========================================================\n');

    if (failed > 0) process.exit(1);
    else process.exit(0);

  } catch (error) {
    console.error('Fatal test error:', error);
    process.exit(1);
  }
}

runPollingTests();
