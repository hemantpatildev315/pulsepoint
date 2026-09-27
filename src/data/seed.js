// src/data/seed.js
// Realistic Clinical Seed Data for Instant Demonstration

const initialDoctors = [
  {
    id: 'doc-001',
    name: 'Dr. Marcus Thorne, MD',
    department: 'Emergency & Trauma',
    cabinNumber: 'Resuscitation Bay 1',
    isAvailable: true,
    maxSlotsPerDay: 40,
    createdAt: new Date(Date.now() - 3600000 * 24 * 10).toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'doc-002',
    name: 'Dr. Sarah Vance, FACC',
    department: 'Cardiology',
    cabinNumber: 'Cabin 102',
    isAvailable: true,
    maxSlotsPerDay: 25,
    createdAt: new Date(Date.now() - 3600000 * 24 * 10).toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'doc-003',
    name: 'Dr. Priya Patel, MD',
    department: 'General Internal Medicine',
    cabinNumber: 'Cabin 104',
    isAvailable: true,
    maxSlotsPerDay: 30,
    createdAt: new Date(Date.now() - 3600000 * 24 * 10).toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'doc-004',
    name: 'Dr. James Wilson, MD',
    department: 'Pediatrics & Family Health',
    cabinNumber: 'Cabin 106',
    isAvailable: true,
    maxSlotsPerDay: 28,
    createdAt: new Date(Date.now() - 3600000 * 24 * 10).toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

const initialPatients = [
  {
    id: 'pat-001',
    name: 'Elena Rostova',
    phone: '+1 (555) 234-8901',
    age: 58,
    bloodGroup: 'O+',
    emergencyContact: 'Dmitri Rostova (+1 555-234-8902)',
    medicalNotes: 'Known hypertension, coronary stent placed in 2023.',
    createdAt: new Date(Date.now() - 3600000 * 2).toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'pat-002',
    name: 'David Kim',
    phone: '+1 (555) 871-3320',
    age: 29,
    bloodGroup: 'A+',
    emergencyContact: 'Sarah Kim (+1 555-871-3321)',
    medicalNotes: 'No chronic conditions. Allergic to Penicillin.',
    createdAt: new Date(Date.now() - 3600000 * 1.5).toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'pat-003',
    name: 'Amara Okafor',
    phone: '+1 (555) 492-1184',
    age: 42,
    bloodGroup: 'B+',
    emergencyContact: 'Chidi Okafor (+1 555-492-1185)',
    medicalNotes: 'Type 2 Diabetes, well controlled.',
    createdAt: new Date(Date.now() - 3600000 * 1).toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'pat-004',
    name: 'Lucas Miller',
    phone: '+1 (555) 912-7744',
    age: 9,
    bloodGroup: 'AB+',
    emergencyContact: 'Karen Miller (Mother: +1 555-912-7745)',
    medicalNotes: 'Mild seasonal asthma.',
    createdAt: new Date(Date.now() - 3600000 * 0.7).toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'pat-005',
    name: 'Robert Hastings',
    phone: '+1 (555) 304-6291',
    age: 64,
    bloodGroup: 'O-',
    emergencyContact: 'Mary Hastings (+1 555-304-6292)',
    medicalNotes: 'Previous myocardial infarction, on anticoagulant therapy.',
    createdAt: new Date(Date.now() - 60000 * 12).toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

const initialQueue = [
  // 1. Critical Red Emergency: Hastings (Sudden crushing chest pain & diaphoresis)
  {
    id: 'app-005',
    patientId: 'pat-005',
    doctorId: 'doc-001', // Emergency & Trauma
    type: 'emergency',
    severity: 'red',
    status: 'waiting',
    tokenNumber: 'EM-001',
    estimatedWaitMinutes: 0, // Top priority immediate
    heartRate: 142,
    spo2: 89,
    bloodPressure: '190/115',
    triageReason: 'Critical Flag: Severe Chest Pain; Critical Hypoxia (SpO2: 89%); Severe Arrhythmia / Tachycardia (HR: 142 bpm); Hypertensive Crisis (Systolic BP: 190 mmHg)',
    chiefComplaint: 'Acute retrosternal chest pain radiating to left jaw, diaphoresis',
    consultationStartAt: null,
    completedAt: null,
    createdAt: new Date(Date.now() - 60000 * 8).toISOString(), // 8 mins ago
    updatedAt: new Date(Date.now() - 60000 * 8).toISOString(),
  },
  // 2. Urgent Yellow Emergency: Amara Okafor (Severe acute abdominal pain & fever)
  {
    id: 'app-003',
    patientId: 'pat-003',
    doctorId: 'doc-003', // General Internal Medicine
    type: 'emergency',
    severity: 'yellow',
    status: 'waiting',
    tokenNumber: 'EM-002',
    estimatedWaitMinutes: 10,
    heartRate: 118,
    spo2: 95,
    bloodPressure: '148/92',
    triageReason: 'Urgent Indicator: Acute Abdominal Pain; Severe Acute Pain (VAS: 8/10)',
    chiefComplaint: 'Right lower quadrant abdominal guarding, fever 102.1F',
    consultationStartAt: null,
    completedAt: null,
    createdAt: new Date(Date.now() - 60000 * 25).toISOString(), // 25 mins ago
    updatedAt: new Date(Date.now() - 60000 * 25).toISOString(),
  },
  // 3. Routine Patient: Elena Rostova (In Consultation with Dr. Vance)
  {
    id: 'app-001',
    patientId: 'pat-001',
    doctorId: 'doc-002', // Cardiology
    type: 'routine',
    severity: 'green',
    status: 'in_consultation',
    tokenNumber: 'RT-101',
    estimatedWaitMinutes: 0,
    heartRate: 74,
    spo2: 98,
    bloodPressure: '128/82',
    triageReason: 'Vitals stable, routine outpatient assessment',
    chiefComplaint: 'Quarterly cardiovascular review and blood pressure titration',
    consultationStartAt: new Date(Date.now() - 60000 * 10).toISOString(), // Started 10m ago
    completedAt: null,
    createdAt: new Date(Date.now() - 60000 * 55).toISOString(),
    updatedAt: new Date().toISOString(),
  },
  // 4. Routine Patient: David Kim (Waiting for Dr. Patel)
  {
    id: 'app-002',
    patientId: 'pat-002',
    doctorId: 'doc-003', // General Internal Medicine
    type: 'routine',
    severity: 'green',
    status: 'waiting',
    tokenNumber: 'RT-102',
    estimatedWaitMinutes: 25,
    heartRate: 68,
    spo2: 99,
    bloodPressure: '118/76',
    triageReason: 'Vitals stable, routine outpatient assessment',
    chiefComplaint: 'Annual corporate physical and routine blood work referral',
    consultationStartAt: null,
    completedAt: null,
    createdAt: new Date(Date.now() - 60000 * 45).toISOString(),
    updatedAt: new Date().toISOString(),
  },
  // 5. Routine Patient: Lucas Miller (Waiting for Dr. Wilson)
  {
    id: 'app-004',
    patientId: 'pat-004',
    doctorId: 'doc-004', // Pediatrics
    type: 'routine',
    severity: 'green',
    status: 'waiting',
    tokenNumber: 'RT-103',
    estimatedWaitMinutes: 15,
    heartRate: 90,
    spo2: 98,
    bloodPressure: '105/65',
    triageReason: 'Vitals stable, routine outpatient assessment',
    chiefComplaint: 'Pre-school allergy clearance and booster vaccination',
    consultationStartAt: null,
    completedAt: null,
    createdAt: new Date(Date.now() - 60000 * 30).toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

module.exports = {
  initialDoctors,
  initialPatients,
  initialQueue,
};
