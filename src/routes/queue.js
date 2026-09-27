// src/routes/queue.js
// Live Priority Queue & Status Transition Route with MySQL Parameterized Queries
const express = require('express');
const router = express.Router();
const { pool, resetDatabase } = require('../config/db');
const { validateStatusUpdate } = require('../utils/validator');
const { broadcast } = require('../services/wsServer');

/**
 * GET /api/queue/live
 * Fetches sorted active appointments using the requested MySQL ordering:
 * ORDER BY aq.status = 'waiting' DESC, aq.priority_score ASC, aq.created_at ASC
 * (Guarantees Code Red [1] sits at the top before Yellow [2] and Green [3])
 */
router.get('/live', async (req, res) => {
  try {
    const { doctorId, severity, status, search, includeCompleted } = req.query;

    const conditions = [];
    const params = [];

    // Filter completed/cancelled unless explicitly requested
    if (includeCompleted !== 'true') {
      conditions.push("aq.status IN ('waiting', 'in_consultation')");
    }

    if (doctorId) {
      conditions.push('aq.doctor_id = ?');
      params.push(doctorId);
    }

    if (severity) {
      conditions.push('aq.severity = ?');
      params.push(severity);
    }

    if (status) {
      conditions.push('aq.status = ?');
      params.push(status);
    }

    if (search && search.trim()) {
      const q = `%${search.trim()}%`;
      conditions.push('(aq.token_number LIKE ? OR p.full_name LIKE ? OR p.phone LIKE ? OR d.full_name LIKE ?)');
      params.push(q, q, q, q);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Primary priority query with requested sorting
    const sql = `
      SELECT 
        aq.id,
        aq.patient_id,
        aq.doctor_id,
        aq.token_number,
        aq.type,
        aq.severity,
        aq.priority_score,
        aq.status,
        aq.symptoms_summary,
        aq.prescription_notes,
        aq.estimated_wait_minutes,
        aq.created_at,
        aq.updated_at,
        p.full_name AS patient_name,
        p.phone AS patient_phone,
        p.age AS patient_age,
        p.blood_group AS patient_blood_group,
        p.emergency_contact AS patient_emergency_contact,
        p.medical_notes AS patient_medical_notes,
        d.full_name AS doctor_name,
        d.specialty AS doctor_specialty,
        d.cabin_number AS doctor_cabin_number
      FROM appointments_queue aq
      JOIN patients p ON aq.patient_id = p.id
      LEFT JOIN doctors d ON aq.doctor_id = d.id
      ${whereClause}
      ORDER BY aq.status = 'waiting' DESC, aq.priority_score ASC, aq.created_at ASC
    `;

    const [rows] = await pool.query(sql, params);

    // Compute dynamic queue positions & elapsed wait times
    let waitingRank = 1;
    const now = Date.now();

    const enriched = rows.map(row => {
      const createdTime = new Date(row.created_at).getTime();
      const elapsedMinutes = Math.max(0, Math.floor((now - createdTime) / 60000));

      const isWaiting = row.status === 'waiting';
      const queuePosition = isWaiting ? waitingRank++ : null;

      // Extract vitals from symptoms_summary if stored
      const spo2Match = (row.symptoms_summary || '').match(/SpO2:\s*(\d+)%/i);
      const hrMatch = (row.symptoms_summary || '').match(/HR:\s*(\d+)\s*bpm/i);
      const bpMatch = (row.symptoms_summary || '').match(/BP:\s*([0-9/]+)\s*mmHg/i);

      return {
        id: row.id,
        patientId: row.patient_id,
        doctorId: row.doctor_id,
        tokenNumber: row.token_number,
        token_number: row.token_number,
        type: row.type,
        severity: row.severity,
        priorityScore: row.priority_score,
        priority_score: row.priority_score,
        status: row.status,
        chiefComplaint: row.symptoms_summary,
        symptoms_summary: row.symptoms_summary,
        prescriptionNotes: row.prescription_notes,
        prescription_notes: row.prescription_notes,
        estimatedWaitMinutes: row.estimated_wait_minutes,
        calculatedWaitMinutes: row.estimated_wait_minutes,
        elapsedWaitMinutes: elapsedMinutes,
        queuePosition,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        spo2: spo2Match ? parseInt(spo2Match[1], 10) : null,
        heartRate: hrMatch ? parseInt(hrMatch[1], 10) : null,
        bloodPressure: bpMatch ? bpMatch[1] : null,
        triageReason: row.severity === 'red' ? 'Critical Triage Override (Level 1)' : row.severity === 'yellow' ? 'Urgent Assessment (Level 2)' : 'Routine Consultation',
        patient: {
          id: row.patient_id,
          name: row.patient_name,
          full_name: row.patient_name,
          phone: row.patient_phone,
          age: row.patient_age,
          bloodGroup: row.patient_blood_group,
          blood_group: row.patient_blood_group,
          emergencyContact: row.patient_emergency_contact,
          medicalNotes: row.patient_medical_notes,
        },
        doctor: row.doctor_id ? {
          id: row.doctor_id,
          name: row.doctor_name,
          full_name: row.doctor_name,
          specialty: row.doctor_specialty,
          department: row.doctor_specialty,
          cabinNumber: row.doctor_cabin_number,
          cabin_number: row.doctor_cabin_number,
        } : null,
      };
    });

    // Fetch live summary stats
    const stats = await fetchQueueStats();

    return res.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      stats,
      count: enriched.length,
      data: enriched,
    });
  } catch (error) {
    console.error('Error in GET /api/queue/live:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve live queue from MySQL',
      error: error.message,
    });
  }
});

/**
 * GET /api/queue/token/:tokenNumber
 * Fetches real-time status and live queue position for a specific patient token
 */
router.get('/token/:tokenNumber', async (req, res) => {
  try {
    const { tokenNumber } = req.params;

    const [rows] = await pool.query(`
      SELECT 
        aq.*,
        p.full_name AS patient_name, p.phone AS patient_phone, p.age AS patient_age, p.blood_group AS patient_blood_group,
        d.full_name AS doctor_name, d.specialty AS doctor_specialty, d.cabin_number AS doctor_cabin_number
      FROM appointments_queue aq
      JOIN patients p ON aq.patient_id = p.id
      LEFT JOIN doctors d ON aq.doctor_id = d.id
      WHERE aq.token_number = ?
      LIMIT 1
    `, [tokenNumber]);

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: `Token ${tokenNumber} not found`,
      });
    }

    const item = rows[0];

    // Compute live position among waiting patients
    let queuePosition = null;
    if (item.status === 'waiting') {
      const [posRows] = await pool.query(`
        SELECT COUNT(*) AS pos 
        FROM appointments_queue 
        WHERE status = 'waiting' 
          AND (priority_score < ? OR (priority_score = ? AND created_at <= ?))
      `, [item.priority_score, item.priority_score, item.created_at]);
      queuePosition = posRows[0].pos || 1;
    }

    return res.status(200).json({
      success: true,
      data: {
        id: item.id,
        tokenNumber: item.token_number,
        token_number: item.token_number,
        type: item.type,
        severity: item.severity,
        priorityScore: item.priority_score,
        status: item.status,
        queuePosition,
        estimatedWaitMinutes: item.estimated_wait_minutes,
        symptoms_summary: item.symptoms_summary,
        prescription_notes: item.prescription_notes,
        createdAt: item.created_at,
        patient: {
          name: item.patient_name,
          age: item.patient_age,
          phone: item.patient_phone,
          bloodGroup: item.patient_blood_group,
        },
        doctor: item.doctor_id ? {
          id: item.doctor_id,
          name: item.doctor_name,
          specialty: item.doctor_specialty,
          cabinNumber: item.doctor_cabin_number,
        } : null,
      },
    });
  } catch (error) {
    console.error('Error fetching token:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch token status',
      error: error.message,
    });
  }
});

/**
 * GET /api/queue/stats
 * Real-time queue counters from MySQL
 */
router.get('/stats', async (req, res) => {
  try {
    const stats = await fetchQueueStats();
    return res.status(200).json({
      success: true,
      data: stats,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch queue stats',
      error: error.message,
    });
  }
});

/**
 * PATCH /api/queue/:id/status
 * Safe parameterized query for changing status from 'waiting' -> 'in_consultation' -> 'completed'.
 * Supports optional prescription_notes and doctor assignment.
 */
router.patch('/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, doctorId, doctor_id, prescriptionNotes, prescription_notes, diagnosis, advice } = req.body;

    const validation = validateStatusUpdate(req.body);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status update',
        errors: validation.errors,
      });
    }

    // 1. Check if record exists
    const [existing] = await pool.query(
      'SELECT id, token_number, patient_id, doctor_id, status FROM appointments_queue WHERE id = ?',
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: `Appointment #${id} not found in MySQL`,
      });
    }

    const assignedDoctorId = doctorId || doctor_id || null;
    const rx = (prescriptionNotes || prescription_notes || null);
    const diag = (diagnosis || null);
    const adv = (advice || null);

    // 2. Execute safe parameterized UPDATE query
    await pool.query(
      `UPDATE appointments_queue 
       SET status = ?, 
           doctor_id = COALESCE(?, doctor_id),
           prescription_notes = COALESCE(?, prescription_notes),
           diagnosis = COALESCE(?, diagnosis),
           advice = COALESCE(?, advice),
           updated_at = NOW() 
       WHERE id = ?`,
      [status, assignedDoctorId, rx, diag, adv, id]
    );

    // If clinical notes added, append permanently to patient's medical history
    if (rx || diag || adv) {
      const summaryParts = [];
      if (diag) summaryParts.push(`Diagnosis: ${diag}`);
      if (rx) summaryParts.push(`Prescription: ${rx}`);
      if (adv) summaryParts.push(`Advice: ${adv}`);
      const entry = `[Visit Note ${new Date().toLocaleDateString()}]: ${summaryParts.join(' • ')}`;

      await pool.query(
        `UPDATE patients 
         SET medical_notes = CONCAT(COALESCE(medical_notes, ''), ' | ', ?) 
         WHERE id = ?`,
        [entry, existing[0].patient_id]
      );
    }

    // 3. Return updated appointment details
    const [updatedRows] = await pool.query(
      `SELECT 
         aq.*, 
         p.full_name AS patient_name, p.phone AS patient_phone, p.age AS patient_age, p.blood_group AS patient_blood_group,
         d.full_name AS doctor_name, d.specialty AS doctor_specialty, d.cabin_number AS doctor_cabin_number
       FROM appointments_queue aq
       JOIN patients p ON aq.patient_id = p.id
       LEFT JOIN doctors d ON aq.doctor_id = d.id
       WHERE aq.id = ?`,
      [id]
    );

    const updated = updatedRows[0];
    const liveStats = await fetchQueueStats();

    // Broadcast real-time event across all open consoles
    broadcast('QUEUE_UPDATED', {
      action: 'STATUS_CHANGED',
      id: updated.id,
      token: updated.token_number,
      status: updated.status,
      doctorId: updated.doctor_id,
    });

    return res.status(200).json({
      success: true,
      message: `Appointment ${updated.token_number} transitioned to ${status}`,
      data: {
        id: updated.id,
        tokenNumber: updated.token_number,
        token_number: updated.token_number,
        status: updated.status,
        severity: updated.severity,
        priority_score: updated.priority_score,
        prescription_notes: updated.prescription_notes,
        patient: {
          name: updated.patient_name,
          phone: updated.patient_phone,
          age: updated.patient_age,
          bloodGroup: updated.patient_blood_group,
        },
        doctor: updated.doctor_id ? {
          id: updated.doctor_id,
          name: updated.doctor_name,
          specialty: updated.doctor_specialty,
          cabinNumber: updated.doctor_cabin_number,
        } : null,
      },
      stats: liveStats,
    });

  } catch (error) {
    console.error('Error in PATCH /api/queue/:id/status:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update appointment status in MySQL',
      error: error.message,
    });
  }
});

/**
 * PATCH /api/queue/:id/assign
 * Directly assigns or reassigns a doctor to an appointment from Reception Desk
 */
router.patch('/:id/assign', async (req, res) => {
  try {
    const { id } = req.params;
    const { doctorId, doctor_id } = req.body;
    const targetDoctorId = doctorId || doctor_id || null;

    await pool.query(
      'UPDATE appointments_queue SET doctor_id = ?, updated_at = NOW() WHERE id = ?',
      [targetDoctorId, id]
    );

    broadcast('QUEUE_UPDATED', {
      action: 'DOCTOR_REASSIGNED',
      id,
      doctorId: targetDoctorId,
    });

    return res.status(200).json({
      success: true,
      message: 'Doctor assignment updated successfully',
      doctorId: targetDoctorId,
    });
  } catch (error) {
    console.error('Error in PATCH /api/queue/:id/assign:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to assign doctor in MySQL',
      error: error.message,
    });
  }
});

/**
 * POST /api/queue/reset
 * Resets database to standard demo seed data
 */
router.post('/reset', async (req, res) => {
  try {
    await resetDatabase();
    const stats = await fetchQueueStats();

    broadcast('QUEUE_UPDATED', { action: 'QUEUE_RESET' });

    return res.status(200).json({
      success: true,
      message: 'Clinic MySQL database successfully reset to standard clinical seed data',
      stats,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to reset MySQL database',
      error: error.message,
    });
  }
});

/**
 * Helper: Computes live queue stats directly from MySQL
 */
async function fetchQueueStats() {
  const [statsRows] = await pool.query(`
    SELECT
      COUNT(CASE WHEN status = 'waiting' THEN 1 END) AS totalWaiting,
      COUNT(CASE WHEN status = 'in_consultation' THEN 1 END) AS inConsultationCount,
      COUNT(CASE WHEN status = 'completed' AND DATE(created_at) = CURDATE() THEN 1 END) AS completedToday,
      COUNT(CASE WHEN status = 'waiting' AND priority_score = 1 THEN 1 END) AS criticalRedCount,
      COUNT(CASE WHEN status = 'waiting' AND priority_score = 2 THEN 1 END) AS urgentYellowCount,
      COUNT(CASE WHEN status = 'waiting' AND priority_score = 3 THEN 1 END) AS routineGreenCount
    FROM appointments_queue
  `);

  const [docRows] = await pool.query(
    'SELECT COUNT(*) AS doctorsOnDutyCount FROM doctors WHERE is_available = 1'
  );

  const row = statsRows[0];
  return {
    totalWaiting: parseInt(row.totalWaiting || 0, 10),
    inConsultationCount: parseInt(row.inConsultationCount || 0, 10),
    completedToday: parseInt(row.completedToday || 0, 10),
    criticalRedCount: parseInt(row.criticalRedCount || 0, 10),
    urgentYellowCount: parseInt(row.urgentYellowCount || 0, 10),
    routineGreenCount: parseInt(row.routineGreenCount || 0, 10),
    doctorsOnDutyCount: parseInt(docRows[0].doctorsOnDutyCount || 0, 10),
    lastUpdated: new Date().toISOString(),
  };
}

module.exports = router;
