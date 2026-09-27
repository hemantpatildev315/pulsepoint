// src/routes/doctors.js
// Doctors List and Load Route with MySQL
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');

/**
 * GET /api/doctors
 * Fetches all clinical staff, availability, cabins, and live caseload from MySQL
 */
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        d.id, 
        d.full_name, 
        d.specialty, 
        d.cabin_number, 
        d.is_available,
        COUNT(CASE WHEN aq.status = 'waiting' THEN 1 END) AS waiting_count,
        MAX(CASE WHEN aq.status = 'in_consultation' THEN aq.token_number END) AS current_in_consultation
      FROM doctors d
      LEFT JOIN appointments_queue aq ON d.id = aq.doctor_id
      GROUP BY d.id, d.full_name, d.specialty, d.cabin_number, d.is_available
      ORDER BY d.id ASC
    `);

    const enriched = rows.map(doc => ({
      id: doc.id,
      name: doc.full_name,
      full_name: doc.full_name,
      specialty: doc.specialty,
      department: doc.specialty,
      cabinNumber: doc.cabin_number,
      cabin_number: doc.cabin_number,
      isAvailable: Boolean(doc.is_available),
      waitingCount: parseInt(doc.waiting_count || 0, 10),
      currentInConsultation: doc.current_in_consultation || null,
    }));

    return res.status(200).json({
      success: true,
      count: enriched.length,
      data: enriched,
    });
  } catch (error) {
    console.error('Error in GET /api/doctors:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch doctors list from MySQL',
      error: error.message,
    });
  }
});

module.exports = router;
