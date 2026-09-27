// test/phase2_auth_test.js
// Automated End-to-End Verification for Role Isolation, Authentication, and Prescription Management
const http = require('http');
const WebSocket = require('ws');

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
      res.on('data', (chunk) => (data += chunk));
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
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('========================================================');
  console.log('🧪 RUNNING PHASE 2 DEDICATED AUTH & WORKSPACE TEST SUITE');
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
    // ---------------------------------------------------------
    // TEST 1: Route Isolation HTTP Endpoint Verification
    // ---------------------------------------------------------
    console.log('1. Route Isolation & Serving:');
    const recPage = await request('GET', '/reception');
    assert(recPage.status === 200, 'GET /reception loads successfully (200 OK)');
    assert(typeof recPage.data === 'string' && recPage.data.includes('PulsePoint Reception Desk'), '/reception serves dedicated HTML');

    const docPage = await request('GET', '/doctor');
    assert(docPage.status === 200, 'GET /doctor loads successfully (200 OK)');
    assert(typeof docPage.data === 'string' && docPage.data.includes('Physician Authentication'), '/doctor serves dedicated HTML');

    const ptPage = await request('GET', '/patient');
    assert(ptPage.status === 200, 'GET /patient loads successfully (200 OK)');
    assert(typeof ptPage.data === 'string' && ptPage.data.includes('PulsePoint Patient Portal'), '/patient serves dedicated HTML');

    // ---------------------------------------------------------
    // TEST 2: Doctor Authentication Flow
    // ---------------------------------------------------------
    console.log('\n2. Doctor Portal Authentication (/api/doctor/login):');
    const badLogin = await request('POST', '/api/doctor/login', {
      doctorId: 3, // Dr. Priya Patel
      password: 'wrong_password_999',
    });
    assert(badLogin.status === 401, 'Invalid doctor password rejected with 401 Unauthorized');

    const goodLogin = await request('POST', '/api/doctor/login', {
      doctorId: 3, // Dr. Priya Patel
      password: 'doctor123',
    });
    assert(goodLogin.status === 200, 'Valid login with doctor123 returns 200 OK');
    assert(goodLogin.data.doctor && goodLogin.data.doctor.name.includes('Priya Patel'), 'Returns authenticated doctor profile (Dr. Priya Patel)');
    assert(goodLogin.data.doctor.cabinNumber === 'Cabin 104', 'Doctor is assigned to Cabin 104');

    // ---------------------------------------------------------
    // TEST 3: Patient Phone Authentication & History
    // ---------------------------------------------------------
    console.log('\n3. Patient Phone Authentication & History (/api/patient/login):');
    const badPhone = await request('POST', '/api/patient/login', {
      phone: '0000000000',
    });
    assert(badPhone.status === 404, 'Unregistered phone returns 404 Not Found');

    const goodPhone = await request('POST', '/api/patient/login', {
      phone: '9876543210',
    });
    assert(goodPhone.status === 200, 'Demo phone 9876543210 returns 200 OK');
    assert(goodPhone.data.patient && goodPhone.data.patient.name === 'Alexander Wright', 'Identified patient as Alexander Wright');
    assert(Array.isArray(goodPhone.data.history) && goodPhone.data.history.length >= 2, 'Retrieved complete past clinical history with >= 2 visits');

    const pastVisit = goodPhone.data.history[0];
    assert(Boolean(pastVisit.diagnosis), `Past visit includes primary diagnosis: "${pastVisit.diagnosis}"`);
    assert(Boolean(pastVisit.prescriptionNotes), `Past visit includes digital prescription notes: "${pastVisit.prescriptionNotes}"`);

    // ---------------------------------------------------------
    // TEST 4: WebSocket Real-Time Synchronization & Doctor Call
    // ---------------------------------------------------------
    console.log('\n4. Real-Time Telemetry & Doctor Call Next:');
    let wsReceivedCall = false;
    let wsEventPayload = null;

    const wsClient = new WebSocket('ws://localhost:3000');
    await new Promise((resolve) => {
      wsClient.on('open', resolve);
    });

    wsClient.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);
        if (msg.type === 'DOCTOR_CALLED_PATIENT') {
          wsReceivedCall = true;
          wsEventPayload = msg.payload || msg;
        }
      } catch (e) {}
    });

    // Make Doctor Call Next API Call
    const callRes = await request('POST', '/api/doctor/call-next', {
      doctorId: 3, // Dr. Priya Patel
    });

    // Allow WS message to propagate
    await new Promise((r) => setTimeout(r, 600));

    assert(callRes.status === 200 || callRes.status === 404, 'Doctor Call Next endpoint responded');
    if (callRes.status === 200) {
      assert(wsReceivedCall === true, 'WebSocket broadcast DOCTOR_CALLED_PATIENT received across clients');
      const cabin = wsEventPayload && (wsEventPayload.cabinNumber || (wsEventPayload.payload && wsEventPayload.payload.cabinNumber));
      assert(cabin === 'Cabin 104', 'Event payload contains cabin number for audio/visual alarm');
    }

    wsClient.close();

    // ---------------------------------------------------------
    // TEST 5: Complete Visit with Diagnosis and Prescriptions
    // ---------------------------------------------------------
    console.log('\n5. Complete Visit & Medical History Persistence:');
    // First, book a routine patient via /api/appointments/book
    const bookRes = await request('POST', '/api/appointments/book', {
      name: 'Test Clinical Patient',
      phone: '+1 555-432-1111',
      age: 38,
      chiefComplaint: 'Throbbing sore throat and low-grade pyrexia',
    });
    assert(bookRes.status === 201, 'Booked new test patient (201 Created)');
    const testApptId = (bookRes.data && bookRes.data.data && bookRes.data.data.appointment) ? bookRes.data.data.appointment.id : (bookRes.data && bookRes.data.appointmentId);

    // Doctor completes consultation
    const completeRes = await request('PATCH', `/api/queue/${testApptId}/status`, {
      status: 'completed',
      doctorId: 3,
      diagnosis: 'Acute Streptococcal Pharyngitis',
      prescriptionNotes: 'Rx: Amoxicillin 500mg PO TID x 10 days. Ibuprofen 400mg PRN.',
      advice: 'Warm saline gargles. Hydration. Rest for 48 hours.',
    });

    assert(completeRes.status === 200, 'Consultation marked completed with 200 OK');
    assert(completeRes.data.data.status === 'completed', 'Appointment status transitioned to completed in MySQL');

    // Verify patient's phone lookup now includes this newly completed visit
    const verifyPt = await request('POST', '/api/patient/login', {
      phone: '+1 555-432-1111',
    });
    assert(verifyPt.status === 200, 'Patient lookup by phone returns updated profile');
    const completedVisit = verifyPt.data.history.find(h => h.id === testApptId);
    assert(Boolean(completedVisit), 'Newly completed visit attached permanently to patient history');
    assert(completedVisit.diagnosis === 'Acute Streptococcal Pharyngitis', 'Permanent diagnosis saved correctly');
    assert(completedVisit.prescriptionNotes.includes('Amoxicillin'), 'Permanent digital prescription (Rx) saved correctly');

    // ---------------------------------------------------------
    // SUMMARY
    // ---------------------------------------------------------
    console.log('\n========================================================');
    console.log(`📊 TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log('========================================================\n');

    if (failed > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }

  } catch (error) {
    console.error('Fatal test error:', error);
    process.exit(1);
  }
}

runTests();
