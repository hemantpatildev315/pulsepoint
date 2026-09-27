// src/routes/auth.js
// Authentication and Profile Management for Doctor and Patient Portals
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { broadcast } = require('../services/wsServer');

/**
 * POST /api/doctor/login
 * Validates doctor credentials (demo password: doctor123)
 */
router.post('/doctor/login', async (req, res) => {
  try {
    const { doctorId, password } = req.body;

    if (!doctorId) {
      return res.status(400).json({
        success: false,
        message: 'Please select or enter your Physician ID.',
      });
    }

    if (!password) {
      return res.status(400).json({
        success: false,
        message: 'Password is required.',
      });
    }

    const [rows] = await pool.query(
      'SELECT id, full_name, specialty, cabin_number, is_available, password FROM doctors WHERE id = ? OR full_name LIKE ?',
      [doctorId, `%${doctorId}%`]
    );

    if (rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Physician not found in hospital roster.',
      });
    }

    const doctor = rows[0];

    // Check password (matches stored password or default demo password 'doctor123')
    const isValid = (password === doctor.password) || (password === 'doctor123');
    if (!isValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid password. (Demo access: doctor123)',
      });
    }

    return res.status(200).json({
      success: true,
      message: `Welcome back, ${doctor.full_name}`,
      doctor: {
        id: doctor.id,
        name: doctor.full_name,
        specialty: doctor.specialty,
        cabinNumber: doctor.cabin_number,
        isAvailable: Boolean(doctor.is_available),
      },
      token: `doc-token-${doctor.id}-${Date.now()}`,
    });

  } catch (error) {
    console.error('Error in /api/doctor/login:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error during doctor authentication.',
      error: error.message,
    });
  }
});

/**
 * POST /api/patient/login
 * Patient authentication via registered phone number.
 * Returns patient profile and complete clinical medical record history.
 */
router.post('/patient/login', async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone || typeof phone !== 'string' || phone.trim().length < 4) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid registered phone number.',
      });
    }

    const rawPhone = phone.trim();
    const cleanDigits = rawPhone.replace(/\D/g, '');

    // Search patient by phone
    const [patients] = await pool.query(
      `SELECT * FROM patients 
       WHERE phone = ? OR REPLACE(REPLACE(REPLACE(REPLACE(phone, '-', ''), ' ', ''), '(', ''), ')', '') LIKE ?
       LIMIT 1`,
      [rawPhone, `%${cleanDigits}%`]
    );

    if (patients.length === 0) {
      return res.status(404).json({
        success: false,
        message: `No clinical records found for phone ${rawPhone}. Try demo phone: 9876543210 or complete a new check-in.`,
      });
    }

    const patient = patients[0];

    // Fetch complete medical history (past and current appointments)
    const [historyRows] = await pool.query(
      `SELECT 
         aq.id,
         aq.token_number,
         aq.type,
         aq.severity,
         aq.priority_score,
         aq.status,
         aq.symptoms_summary,
         aq.diagnosis,
         aq.prescription_notes,
         aq.advice,
         aq.estimated_wait_minutes,
         aq.created_at,
         aq.updated_at,
         d.id AS doctor_id,
         d.full_name AS doctor_name,
         d.specialty AS doctor_specialty,
         d.cabin_number AS doctor_cabin_number
       FROM appointments_queue aq
       LEFT JOIN doctors d ON aq.doctor_id = d.id
       WHERE aq.patient_id = ?
       ORDER BY aq.created_at DESC`,
      [patient.id]
    );

    const appointments = historyRows.map(row => ({
      id: row.id,
      tokenNumber: row.token_number,
      type: row.type,
      severity: row.severity,
      status: row.status,
      symptomsSummary: row.symptoms_summary,
      diagnosis: row.diagnosis,
      prescriptionNotes: row.prescription_notes,
      advice: row.advice,
      createdAt: row.created_at,
      doctor: row.doctor_id ? {
        id: row.doctor_id,
        name: row.doctor_name,
        specialty: row.doctor_specialty,
        cabinNumber: row.doctor_cabin_number,
      } : null,
    }));

    const completedCount = appointments.filter(a => a.status === 'completed').length;
    const activeAppointment = appointments.find(a => a.status === 'waiting' || a.status === 'in_consultation') || null;

    return res.status(200).json({
      success: true,
      message: `Welcome, ${patient.full_name}`,
      patient: {
        id: patient.id,
        name: patient.full_name,
        phone: patient.phone,
        age: patient.age,
        bloodGroup: patient.blood_group,
        emergencyContact: patient.emergency_contact,
        medicalNotes: patient.medical_notes,
        createdAt: patient.created_at,
      },
      stats: {
        totalVisits: appointments.length,
        completedVisits: completedCount,
        hasActiveQueue: Boolean(activeAppointment),
        activeToken: activeAppointment ? activeAppointment.tokenNumber : null,
      },
      history: appointments,
    });

  } catch (error) {
    console.error('Error in /api/patient/login:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error retrieving patient records.',
      error: error.message,
    });
  }
});

/**
 * POST /api/doctor/call-next
 * Doctor calls the next patient into their cabin.
 * Broadcasts an audio & visual alarm to the patient's screen and a chime to Reception.
 */
router.post('/doctor/call-next', async (req, res) => {
  try {
    const { doctorId, appointmentId } = req.body;

    if (!doctorId) {
      return res.status(400).json({ success: false, message: 'Doctor ID is required.' });
    }

    // 1. Fetch doctor details
    const [docRows] = await pool.query('SELECT * FROM doctors WHERE id = ?', [doctorId]);
    if (docRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Doctor not found.' });
    }
    const doctor = docRows[0];

    // 2. Resolve target appointment
    let targetAppt = null;
    if (appointmentId) {
      const [apptRows] = await pool.query(
        `SELECT aq.*, p.full_name AS patient_name, p.phone AS patient_phone 
         FROM appointments_queue aq 
         JOIN patients p ON aq.patient_id = p.id 
         WHERE aq.id = ?`,
        [appointmentId]
      );
      if (apptRows.length > 0) targetAppt = apptRows[0];
    }

    // If no specific appointment provided, pick the top waiting patient for this doctor or emergency red
    if (!targetAppt) {
      const [nextRows] = await pool.query(
        `SELECT aq.*, p.full_name AS patient_name, p.phone AS patient_phone 
         FROM appointments_queue aq 
         JOIN patients p ON aq.patient_id = p.id 
         WHERE aq.status = 'waiting' AND (aq.doctor_id = ? OR (aq.doctor_id IS NULL AND aq.severity = 'red'))
         ORDER BY aq.priority_score ASC, aq.created_at ASC 
         LIMIT 1`,
        [doctorId]
      );
      if (nextRows.length > 0) targetAppt = nextRows[0];
    }

    if (!targetAppt) {
      return res.status(404).json({
        success: false,
        message: 'No waiting patients found in your queue stream.',
      });
    }

    // 3. Update appointment to in_consultation
    await pool.query(
      `UPDATE appointments_queue 
       SET status = 'in_consultation', doctor_id = ?, updated_at = NOW() 
       WHERE id = ?`,
      [doctorId, targetAppt.id]
    );

    // 4. Real-time broadcast: DOCTOR_CALLED_PATIENT
    // Reception receives desk chime + notification badge.
    // Patient Portal receives loud chime/beeping alarm + visual overlay: "Your Turn! Please proceed to Cabin [Cabin Number]"
    broadcast('DOCTOR_CALLED_PATIENT', {
      doctorId: doctor.id,
      doctorName: doctor.full_name,
      cabinNumber: doctor.cabin_number,
      specialty: doctor.specialty,
      appointmentId: targetAppt.id,
      tokenNumber: targetAppt.token_number,
      patientName: targetAppt.patient_name,
      patientPhone: targetAppt.patient_phone,
      calledAt: new Date().toISOString(),
    });

    broadcast('QUEUE_UPDATED', {
      action: 'STATUS_CHANGED',
      id: targetAppt.id,
      token: targetAppt.token_number,
      status: 'in_consultation',
      doctorId: doctor.id,
    });

    return res.status(200).json({
      success: true,
      message: `Called ${targetAppt.patient_name} (${targetAppt.token_number}) to ${doctor.cabin_number}`,
      data: {
        appointmentId: targetAppt.id,
        tokenNumber: targetAppt.token_number,
        patientName: targetAppt.patient_name,
        doctorName: doctor.full_name,
        cabinNumber: doctor.cabin_number,
      },
    });

  } catch (error) {
    console.error('Error in /api/doctor/call-next:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to call patient.',
      error: error.message,
    });
  }
});

module.exports = router;
