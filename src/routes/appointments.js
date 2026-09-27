// src/routes/appointments.js
// Routine Appointment Booking with MySQL Parameterized Queries
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { validateBooking } = require('../utils/validator');
const { generateNextToken } = require('../services/mysqlTokenService');
const { broadcast } = require('../services/wsServer');

/**
 * POST /api/appointments/book
 * Books standard visits, assigns an incremental routine token (RT-XXX),
 * sets priority_score = 3 (Green Routine), and calculates queue position.
 */
router.post('/book', async (req, res) => {
  let conn = null;
  try {
    const validation = validateBooking(req.body);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: validation.errors,
      });
    }

    const {
      name,
      full_name,
      phone,
      age,
      bloodGroup,
      blood_group,
      emergencyContact,
      emergency_contact,
      medicalNotes,
      medical_notes,
      doctorId,
      doctor_id,
      chiefComplaint,
      symptoms_summary,
    } = req.body;

    const patientName = (name || full_name || '').trim();
    const patientPhone = (phone || '').trim();
    const patientAge = parseInt(age, 10);
    const patientBlood = (bloodGroup || blood_group || 'UNKNOWN').toUpperCase();
    const patientEmergency = (emergencyContact || emergency_contact || null);
    const patientNotes = (medicalNotes || medical_notes || null);
    const summary = (chiefComplaint || symptoms_summary || 'Routine consultation').trim();

    conn = await pool.getConnection();
    await conn.beginTransaction();

    // 1. Find or insert patient in MySQL
    let patientId;
    const [existingPatients] = await conn.query(
      'SELECT id FROM patients WHERE phone = ? LIMIT 1',
      [patientPhone]
    );

    if (existingPatients.length > 0) {
      patientId = existingPatients[0].id;
      // Update patient profile if changed
      await conn.query(
        `UPDATE patients 
         SET full_name = ?, age = ?, blood_group = ?, emergency_contact = COALESCE(?, emergency_contact), medical_notes = COALESCE(?, medical_notes)
         WHERE id = ?`,
        [patientName, patientAge, patientBlood, patientEmergency, patientNotes, patientId]
      );
    } else {
      const [insertPatientResult] = await conn.query(
        `INSERT INTO patients (full_name, phone, age, blood_group, emergency_contact, medical_notes)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [patientName, patientPhone, patientAge, patientBlood, patientEmergency, patientNotes]
      );
      patientId = insertPatientResult.insertId;
    }

    // 2. Resolve Doctor
    let targetDoctorId = doctorId || doctor_id || null;
    let assignedDoctor = null;

    if (targetDoctorId) {
      const [docRows] = await conn.query(
        'SELECT id, full_name, specialty, cabin_number, is_available FROM doctors WHERE id = ?',
        [targetDoctorId]
      );
      if (docRows.length > 0) {
        assignedDoctor = docRows[0];
      }
    }

    if (!assignedDoctor) {
      // Default to general medicine or first available doctor
      const [availableDocs] = await conn.query(
        `SELECT id, full_name, specialty, cabin_number, is_available 
         FROM doctors 
         WHERE is_available = 1 
         ORDER BY (specialty LIKE '%General%') DESC, id ASC 
         LIMIT 1`
      );
      if (availableDocs.length > 0) {
        assignedDoctor = availableDocs[0];
        targetDoctorId = assignedDoctor.id;
      }
    }

    // 3. Generate Incremental Routine Token (RT-XXX)
    const tokenNumber = await generateNextToken('routine', conn);

    // 4. Calculate initial wait time based on active queue ahead for this doctor
    const [waitAheadRows] = await conn.query(
      `SELECT COUNT(*) AS waiting_count 
       FROM appointments_queue 
       WHERE doctor_id = ? AND status = 'waiting'`,
      [targetDoctorId]
    );
    const waitingAhead = waitAheadRows[0].waiting_count || 0;
    const estimatedWaitMinutes = Math.max(5, (waitingAhead * 15) + 10);

    // 5. Insert into appointments_queue with priority_score = 3 (Green Routine)
    const priorityScore = 3;
    const [queueInsert] = await conn.query(
      `INSERT INTO appointments_queue 
       (patient_id, doctor_id, token_number, type, severity, priority_score, status, symptoms_summary, estimated_wait_minutes, created_at)
       VALUES (?, ?, ?, 'routine', 'green', ?, 'waiting', ?, ?, NOW())`,
      [patientId, targetDoctorId, tokenNumber, priorityScore, summary, estimatedWaitMinutes]
    );
    const appointmentId = queueInsert.insertId;

    await conn.commit();

    // 6. Calculate position in live active queue
    const [posRows] = await conn.query(
      `SELECT COUNT(*) AS pos 
       FROM appointments_queue 
       WHERE status = 'waiting' 
         AND (priority_score < ? OR (priority_score = ? AND created_at <= (SELECT created_at FROM appointments_queue WHERE id = ?)))`,
      [priorityScore, priorityScore, appointmentId]
    );
    const queuePosition = posRows[0].pos || 1;

    // Real-time synchronization broadcast across all consoles
    broadcast('QUEUE_UPDATED', {
      action: 'BOOKING_CREATED',
      token: tokenNumber,
      patientName,
      queuePosition,
    });

    return res.status(201).json({
      success: true,
      message: 'Routine appointment booked successfully',
      data: {
        appointment: {
          id: appointmentId,
          patient_id: patientId,
          doctor_id: targetDoctorId,
          token_number: tokenNumber,
          tokenNumber,
          type: 'routine',
          severity: 'green',
          priority_score: priorityScore,
          status: 'waiting',
          symptoms_summary: summary,
          chiefComplaint: summary,
          estimated_wait_minutes: estimatedWaitMinutes,
          estimatedWaitMinutes,
        },
        patient: {
          id: patientId,
          name: patientName,
          full_name: patientName,
          phone: patientPhone,
          age: patientAge,
          bloodGroup: patientBlood,
          blood_group: patientBlood,
          emergencyContact: patientEmergency,
          medicalNotes: patientNotes,
        },
        doctor: assignedDoctor ? {
          id: assignedDoctor.id,
          name: assignedDoctor.full_name,
          full_name: assignedDoctor.full_name,
          specialty: assignedDoctor.specialty,
          department: assignedDoctor.specialty,
          cabinNumber: assignedDoctor.cabin_number,
          cabin_number: assignedDoctor.cabin_number,
        } : null,
        tokenNumber,
        token_number: tokenNumber,
        queuePosition,
        estimatedWaitMinutes,
      },
    });

  } catch (error) {
    if (conn) await conn.rollback();
    console.error('Error in POST /api/appointments/book:', error);
    return res.status(500).json({
      success: false,
      message: 'Database error booking appointment',
      error: error.message,
    });
  } finally {
    if (conn) conn.release();
  }
});

module.exports = router;
