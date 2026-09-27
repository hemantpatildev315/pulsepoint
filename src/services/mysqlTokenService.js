// src/services/mysqlTokenService.js
// Incremental Token Generator using MySQL parameterized queries
const { pool } = require('../config/db');

/**
 * Generates the next sequential token (e.g. EM-001 or RT-101) directly from MySQL.
 * 
 * @param {string} type - 'emergency' or 'routine'
 * @param {Object} [clientConn] - Optional transaction connection
 * @returns {Promise<string>} e.g. "EM-003" or "RT-104"
 */
async function generateNextToken(type = 'routine', clientConn = null) {
  const conn = clientConn || pool;
  const prefix = type === 'emergency' ? 'EM' : 'RT';

  const [rows] = await conn.query(
    'SELECT token_number FROM appointments_queue WHERE token_number LIKE ? ORDER BY id DESC LIMIT 1',
    [`${prefix}-%`]
  );

  let nextNumber = type === 'emergency' ? 1 : 101;

  if (rows.length > 0 && rows[0].token_number) {
    const parts = rows[0].token_number.split('-');
    const currentNum = parseInt(parts[1], 10);
    if (!isNaN(currentNum)) {
      nextNumber = currentNum + 1;
    }
  }

  return `${prefix}-${String(nextNumber).padStart(3, '0')}`;
}

module.exports = {
  generateNextToken,
};
