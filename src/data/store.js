// src/data/store.js
const fs = require('fs');
const path = require('path');
const { initialDoctors, initialPatients, initialQueue } = require('./seed');

const DATA_DIR = path.join(__dirname, '../../data');
const DB_FILE = path.join(DATA_DIR, 'clinic_db.json');

class ClinicStore {
  constructor() {
    this.doctors = [];
    this.patients = [];
    this.queue = [];
    this.counters = {
      emergency: 2, // EM-001 and EM-002 already seeded
      routine: 103, // RT-101, RT-102, RT-103 already seeded
    };
    this.init();
  }

  init() {
    if (!fs.existsSync(DATA_DIR)) {
      try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      } catch (err) {
        console.error('Error creating data directory:', err);
      }
    }

    if (fs.existsSync(DB_FILE)) {
      try {
        const raw = fs.readFileSync(DB_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        this.doctors = parsed.doctors || [];
        this.patients = parsed.patients || [];
        this.queue = parsed.queue || [];
        this.counters = parsed.counters || { emergency: 2, routine: 103 };
        return;
      } catch (e) {
        console.warn('Could not read existing clinic_db.json, re-seeding...', e.message);
      }
    }

    // Default initialization with rich seed data
    this.resetToSeedData();
  }

  persist() {
    try {
      const data = {
        doctors: this.doctors,
        patients: this.patients,
        queue: this.queue,
        counters: this.counters,
        savedAt: new Date().toISOString(),
      };
      fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
      console.error('Failed to persist database to file:', err.message);
    }
  }

  resetToSeedData() {
    this.doctors = JSON.parse(JSON.stringify(initialDoctors));
    this.patients = JSON.parse(JSON.stringify(initialPatients));
    this.queue = JSON.parse(JSON.stringify(initialQueue));
    this.counters = { emergency: 2, routine: 103 };
    this.persist();
  }

  // Doctors
  getDoctors() {
    return [...this.doctors];
  }

  getDoctorById(id) {
    return this.doctors.find(d => d.id === id) || null;
  }

  // Patients
  getPatients() {
    return [...this.patients];
  }

  getPatientById(id) {
    return this.patients.find(p => p.id === id) || null;
  }

  findPatientByPhone(phone) {
    const cleanPhone = (phone || '').replace(/\D/g, '');
    return this.patients.find(p => p.phone.replace(/\D/g, '') === cleanPhone) || null;
  }

  savePatient(patientData) {
    const existing = patientData.id ? this.getPatientById(patientData.id) : null;
    const now = new Date().toISOString();

    if (existing) {
      Object.assign(existing, patientData, { updatedAt: now });
      this.persist();
      return existing;
    }

    const newPatient = {
      id: patientData.id || `pat-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 4)}`,
      name: patientData.name,
      phone: patientData.phone,
      age: parseInt(patientData.age, 10),
      bloodGroup: patientData.bloodGroup || 'UNKNOWN',
      emergencyContact: patientData.emergencyContact || null,
      medicalNotes: patientData.medicalNotes || null,
      createdAt: now,
      updatedAt: now,
    };

    this.patients.push(newPatient);
    this.persist();
    return newPatient;
  }

  // Queue & Appointments
  getQueue() {
    return [...this.queue];
  }

  getAppointmentById(id) {
    return this.queue.find(item => item.id === id) || null;
  }

  getNextToken(type = 'routine') {
    if (type === 'emergency') {
      this.counters.emergency += 1;
      const token = `EM-${String(this.counters.emergency).padStart(3, '0')}`;
      this.persist();
      return token;
    }
    this.counters.routine += 1;
    const token = `RT-${String(this.counters.routine).padStart(3, '0')}`;
    this.persist();
    return token;
  }

  saveAppointment(itemData) {
    const now = new Date().toISOString();
    const newAppointment = {
      id: itemData.id || `app-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 4)}`,
      patientId: itemData.patientId,
      doctorId: itemData.doctorId || null,
      type: itemData.type || 'routine',
      severity: itemData.severity || 'green',
      status: itemData.status || 'waiting',
      tokenNumber: itemData.tokenNumber,
      estimatedWaitMinutes: itemData.estimatedWaitMinutes || 0,
      heartRate: itemData.heartRate || null,
      spo2: itemData.spo2 || null,
      bloodPressure: itemData.bloodPressure || null,
      triageReason: itemData.triageReason || null,
      chiefComplaint: itemData.chiefComplaint || null,
      consultationStartAt: itemData.consultationStartAt || null,
      completedAt: itemData.completedAt || null,
      createdAt: itemData.createdAt || now,
      updatedAt: now,
    };

    this.queue.push(newAppointment);
    this.persist();
    return newAppointment;
  }

  updateAppointment(id, updates) {
    const item = this.getAppointmentById(id);
    if (!item) return null;

    Object.assign(item, updates, { updatedAt: new Date().toISOString() });
    this.persist();
    return item;
  }
}

const store = new ClinicStore();
module.exports = store;
