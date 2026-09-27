// src/routes/emergency.js
// Priority Emergency Intake Route with MySQL Parameterized Queries
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { validateEmergencyIntake } = require('../utils/validator');
const { evaluateTriage } = require('../services/triageEngine');
const { generateNextToken } = require('../services/mysqlTokenService');
const { broadcast } = require('../services/wsServer');

/**
 * POST /api/emergency/intake
 * Instant priority override endpoint.
 * Evaluates vitals/flags, auto-tags severity ('red' or 'yellow'),
 * sets priority_score = 1 (Red) or 2 (Yellow), generates EM-XXX token,
 * and inserts into appointments_queue with parameterized query.
 */
router.post('/intake', async (req, res) => {
  let conn = null;
  try {
    const validation = validateEmergencyIntake(req.body);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        message: 'Emergency intake validation failed',
        errors: validation.errors,
      });
    }

    const {
      name,
      full_name,
      phone = 'EMERGENCY_WALKIN',
      age,
      bloodGroup,
      blood_group,
      emergencyContact,
      emergency_contact,
      medicalNotes,
      medical_notes,
      heartRate,
      spo2,
      bloodPressure,
      systolicBP,
      temperature,
      painScale,
      symptoms = [],
      chiefComplaint,
      symptoms_summary,
      doctorId,
      doctor_id,
      severityOverride,
    } = req.body;

    const patientName = (name || full_name || 'Emergency Patient').trim();
    const patientPhone = (phone || 'EMERGENCY_WALKIN').trim();
    const patientAge = parseInt(age, 10);
    const patientBlood = (bloodGroup || blood_group || 'UNKNOWN').toUpperCase();
    const patientEmergency = (emergencyContact || emergency_contact || null);
    const patientNotes = (medicalNotes || medical_notes || null);

    // 1. Clinical Algorithmic Triage Scoring
    const triageResult = evaluateTriage({
      heartRate: heartRate ? Number(heartRate) : undefined,
      spo2: spo2 !== undefined && spo2 !== '' ? Number(spo2) : undefined,
      systolicBP: systolicBP || (bloodPressure ? bloodPressure.split('/')[0] : undefined),
      painScale: painScale !== undefined && painScale !== '' ? Number(painScale) : undefined,
      temperature: temperature ? Number(temperature) : undefined,
      symptoms: Array.isArray(symptoms) ? symptoms : [symptoms].filter(Boolean),
      chiefComplaint: chiefComplaint || symptoms_summary,
    });

    let finalSeverity = triageResult.severity;
    if (severityOverride && (severityOverride === 'red' || severityOverride === 'yellow')) {
      finalSeverity = severityOverride;
    }
    // Emergency intake must be at least yellow or red
    if (finalSeverity === 'green') {
      finalSeverity = 'yellow';
    }

    // Automatically set priority_score: 1 for Red, 2 for Yellow, 3 for Green
    const priorityScore = finalSeverity === 'red' ? 1 : 2;

    // Build comprehensive symptoms summary
    const vitalsParts = [];
    if (spo2) vitalsParts.push(`SpO2: ${spo2}%`);
    if (heartRate) vitalsParts.push(`HR: ${heartRate} bpm`);
    if (bloodPressure) vitalsParts.push(`BP: ${bloodPressure} mmHg`);
    const vitalsSummary = vitalsParts.length ? `[Vitals: ${vitalsParts.join(', ')}] ` : '';
    const summaryText = `${vitalsSummary}${chiefComplaint || symptoms_summary || 'Emergency triage intake'}. Triage: ${triageResult.triageReason}`.trim();

    conn = await pool.getConnection();
    await conn.beginTransaction();

    // 2. Find or insert patient
    let patientId;
    if (patientPhone && patientPhone !== 'EMERGENCY_WALKIN') {
      const [existing] = await conn.query('SELECT id FROM patients WHERE phone = ? LIMIT 1', [patientPhone]);
      if (existing.length > 0) {
        patientId = existing[0].id;
        await conn.query(
          `UPDATE patients 
           SET full_name = ?, age = ?, blood_group = ?, emergency_contact = COALESCE(?, emergency_contact) 
           WHERE id = ?`,
          [patientName, patientAge, patientBlood, patientEmergency, patientId]
        );
      }
    }

    if (!patientId) {
      const [insertPat] = await conn.query(
        `INSERT INTO patients (full_name, phone, age, blood_group, emergency_contact, medical_notes) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [patientName, patientPhone, patientAge, patientBlood, patientEmergency, patientNotes]
      );
      patientId = insertPat.insertId;
    }

    // 3. Resolve Doctor (Emergency Medicine / Trauma or Cardio for chest pain)
    let targetDoctorId = doctorId || doctor_id || null;
    let assignedDoctor = null;

    if (targetDoctorId) {
      const [docRows] = await conn.query('SELECT * FROM doctors WHERE id = ?', [targetDoctorId]);
      if (docRows.length > 0) assignedDoctor = docRows[0];
    }

    if (!assignedDoctor) {
      // Auto-assign: if chest pain -> Cardiology, else Trauma / Emergency
      const isCardio = symptoms.includes('severe_chest_pain') || symptoms.includes('cardiac_arrest');
      const deptMatch = isCardio ? '%Cardio%' : '%Emergency%';
      const [docMatch] = await conn.query(
        `SELECT * FROM doctors WHERE specialty LIKE ? AND is_available = 1 LIMIT 1`,
        [deptMatch]
      );
      if (docMatch.length > 0) {
        assignedDoctor = docMatch[0];
        targetDoctorId = assignedDoctor.id;
      } else {
        const [anyDoc] = await conn.query('SELECT * FROM doctors WHERE is_available = 1 LIMIT 1');
        if (anyDoc.length > 0) {
          assignedDoctor = anyDoc[0];
          targetDoctorId = assignedDoctor.id;
        }
      }
    }

    // 4. Generate Incremental Emergency Token (EM-XXX)
    const tokenNumber = await generateNextToken('emergency', conn);

    // 5. Estimated Wait: 0 mins for Red (immediate), 5-8 mins for Yellow
    const estimatedWaitMinutes = finalSeverity === 'red' ? 0 : 8;

    // 6. Safe Parameterized Insert into appointments_queue
    const [queueResult] = await conn.query(
      `INSERT INTO appointments_queue 
       (patient_id, doctor_id, token_number, type, severity, priority_score, status, symptoms_summary, estimated_wait_minutes, created_at)
       VALUES (?, ?, ?, 'emergency', ?, ?, 'waiting', ?, ?, NOW())`,
      [patientId, targetDoctorId, tokenNumber, finalSeverity, priorityScore, summaryText, estimatedWaitMinutes]
    );
    const appointmentId = queueResult.insertId;

    await conn.commit();

    // 7. Calculate exact position in MySQL priority order:
    // ORDER BY status = 'waiting' DESC, priority_score ASC, created_at ASC
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
      action: 'EMERGENCY_INTAKE',
      token: tokenNumber,
      severity: finalSeverity,
      patientName,
      queuePosition,
    });

    return res.status(201).json({
      success: true,
      message: `Emergency priority intake registered. Severity: ${finalSeverity.toUpperCase()}`,
      data: {
        appointment: {
          id: appointmentId,
          patient_id: patientId,
          doctor_id: targetDoctorId,
          token_number: tokenNumber,
          tokenNumber,
          type: 'emergency',
          severity: finalSeverity,
          priority_score: priorityScore,
          priorityScore,
          status: 'waiting',
          symptoms_summary: summaryText,
          chiefComplaint: summaryText,
          estimated_wait_minutes: estimatedWaitMinutes,
          estimatedWaitMinutes,
          triageReason: triageResult.triageReason,
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
        severity: finalSeverity,
        priorityScore,
        triageReason: triageResult.triageReason,
        recommendedAction: triageResult.recommendedAction,
        queuePosition,
        estimatedWaitMinutes,
        isPriorityOverride: true,
      },
    });

  } catch (error) {
    if (conn) await conn.rollback();
    console.error('Error in POST /api/emergency/intake:', error);
    return res.status(500).json({
      success: false,
      message: 'Database error processing emergency intake',
      error: error.message,
    });
  } finally {
    if (conn) conn.release();
  }
});

module.exports = router;
