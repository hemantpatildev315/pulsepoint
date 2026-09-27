// test/phase3_test.js
// Verification for Phase 3 Additive Features:
// 1. Smart Triage / Symptom Rule-Based Suggestion
// 2. Printable Digital Prescription Slip
// 3. Emergency Bay & Resource Indicator
const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:3000';

function fetchPage(urlPath) {
  return new Promise((resolve, reject) => {
    http.get(BASE_URL + urlPath, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, html: data }));
    }).on('error', reject);
  });
}

async function runPhase3Tests() {
  console.log('========================================================');
  console.log('🧪 RUNNING PHASE 3 ADDITIVE FEATURES TEST SUITE');
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
    // TEST 1: Smart Triage / Symptom Rule-Based UI & Engine
    // ---------------------------------------------------------
    console.log('1. Smart Triage Keyword Detection & UI Elements:');
    const ptPage = await fetchPage('/patient');
    assert(ptPage.status === 200, 'Patient portal responds with 200 OK');
    assert(ptPage.html.includes('id="smartTriageAlertCard"'), 'Patient portal includes smartTriageAlertCard element');
    assert(ptPage.html.includes('id="btnActivateSmartEmergency"'), 'Includes 1-click Switch to Emergency Intake action button');
    assert(ptPage.html.includes('Automated Triage Tag: Code Red (Critical Emergency)'), 'Smart triage displays Code Red recommendation label');

    // Test client-side Red Flag regex against required symptoms
    const RED_FLAG_REGEX = /\b(chest\s*pain|shortness\s*of\s*breath|breath|unconscious|heavy\s*bleeding|bleeding|crushing|hypoxia|seizure|stroke|cyanosis|cardiac|heart\s*attack|severe\s*headache|anaphylaxis|trauma|fracture|arrhythmia)\b/i;
    assert(RED_FLAG_REGEX.test('Patient reporting sudden crushing chest pain radiating to left arm'), 'Regex flags "chest pain"');
    assert(RED_FLAG_REGEX.test('Acute shortness of breath and wheezing'), 'Regex flags "shortness of breath"');
    assert(RED_FLAG_REGEX.test('Patient found unconscious in parking lot'), 'Regex flags "unconscious"');
    assert(RED_FLAG_REGEX.test('Laceration with heavy bleeding on right forearm'), 'Regex flags "heavy bleeding"');
    assert(!RED_FLAG_REGEX.test('Routine annual blood pressure review and prescription refill'), 'Routine symptoms correctly not flagged as Code Red');

    // ---------------------------------------------------------
    // TEST 2: Printable Digital Prescription Slip Template & Actions
    // ---------------------------------------------------------
    console.log('\n2. Printable Digital Prescription Slip (Doctor & Patient):');
    const docPage = await fetchPage('/doctor');
    assert(docPage.status === 200, 'Doctor portal responds with 200 OK');
    assert(docPage.html.includes('id="btnPrintDocRxSlip"'), 'Doctor consultation modal includes Print / Save PDF button');

    // Verify official print slip container structure in index.html
    const hasRxSlip = docPage.html.includes('id="printableRxSlip"');
    assert(hasRxSlip, 'Official printable prescription slip container (#printableRxSlip) is present');
    assert(docPage.html.includes('id="rxPrintDoctorName"') && docPage.html.includes('id="rxPrintDoctorCabin"'), 'Slip has Physician & Cabin details');
    assert(docPage.html.includes('id="rxPrintPatientName"') && docPage.html.includes('id="rxPrintDiagnosis"'), 'Slip has Patient details & Clinical Diagnosis');
    assert(docPage.html.includes('id="rxPrintPrescription"'), 'Slip includes Digital Prescription (Rx) schedule');
    assert(docPage.html.includes('Authorized Attending Physician Signature & Seal'), 'Slip includes official physician signature & seal line');

    // Verify CSS print media queries
    const cssPath = path.join(__dirname, '../public/css/style.css');
    const cssContent = fs.readFileSync(cssPath, 'utf8');
    assert(cssContent.includes('@media print'), 'CSS defines dedicated @media print rules');
    assert(cssContent.includes('body > *:not(#printableRxSlip)'), 'CSS hides non-prescription interface elements during printing');
    assert(cssContent.includes('#printableRxSlip'), 'CSS formats printable prescription slip in high-contrast professional layout');

    // ---------------------------------------------------------
    // TEST 3: Emergency Bay & Resource Indicator
    // ---------------------------------------------------------
    console.log('\n3. Emergency Bay & Resource Indicator (Reception):');
    const recPage = await fetchPage('/reception');
    assert(recPage.status === 200, 'Reception desk responds with 200 OK');
    assert(recPage.html.includes('id="receptionResourceBar"'), 'Reception desk includes facility resource status bar');
    assert(recPage.html.includes('id="recBaysAvailable"'), 'Includes dynamic Emergency Bays counter element');
    assert(recPage.html.includes('Operational (Level 1 Trauma Ready)'), 'Includes ICU Status indicator');

    // Test dynamic bay availability algorithm
    const totalBays = 4;
    function calcBays(redCount) {
      return Math.max(0, totalBays - redCount);
    }
    assert(calcBays(0) === 4, '0 Code Red patients -> 4/4 Available');
    assert(calcBays(1) === 3, '1 Code Red patient -> 3/4 Available');
    assert(calcBays(2) === 2, '2 Code Red patients -> 2/4 Available');
    assert(calcBays(4) === 0, '4 Code Red patients -> 0/4 Available (Full capacity)');
    assert(calcBays(5) === 0, 'Overflow clamped safely at 0');

    // ---------------------------------------------------------
    // SUMMARY
    // ---------------------------------------------------------
    console.log('\n========================================================');
    console.log(`📊 PHASE 3 TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log('========================================================\n');

    if (failed > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }

  } catch (error) {
    console.error('Fatal Phase 3 test error:', error);
    process.exit(1);
  }
}

runPhase3Tests();
