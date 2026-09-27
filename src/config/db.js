// src/config/db.js
// MySQL / MariaDB Connection Pool for Node.js (cPanel / Local phpMyAdmin / TiDB Cloud Serverless)
require('dotenv').config();
const mysql = require('mysql2/promise');

const host = process.env.DB_HOST || 'localhost';
const port = parseInt(process.env.DB_PORT || '3306', 10);
const user = process.env.DB_USER || 'root';
const password = process.env.DB_PASSWORD !== undefined ? process.env.DB_PASSWORD : '';
const database = process.env.DB_NAME || 'clinic_db';

// SSL Detection: TiDB Cloud Serverless strictly prohibits unencrypted transport
const isTiDB = host.toLowerCase().includes('tidbcloud') || port === 4000;
const sslEnv = process.env.DB_SSL ? process.env.DB_SSL.toLowerCase() === 'true' : null;
const isProduction = process.env.NODE_ENV === 'production';
const requiresSSL = sslEnv !== null ? sslEnv : (isTiDB || (isProduction && !host.includes('localhost') && !host.includes('127.0.0.1')));

const sslConfig = requiresSSL
  ? {
      minVersion: 'TLSv1.2',
      rejectUnauthorized: true,
    }
  : undefined;

const dbConfig = {
  host,
  user,
  password,
  database,
  port,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
  dateStrings: true, // returns ISO formatted strings instead of JS Date objects for strict consistency
  ...(sslConfig ? { ssl: sslConfig } : {}),
};

// Create the connection pool
const pool = mysql.createPool(dbConfig);

/**
 * Initializes database & tables if not already imported via phpMyAdmin.
 * Guarantees zero-config instant startup across local and cloud environments.
 */
async function initDatabase() {
  let bootstrapConn = null;
  try {
    // 1. Ensure database exists
    try {
      bootstrapConn = await mysql.createConnection({
        host: dbConfig.host,
        user: dbConfig.user,
        password: dbConfig.password,
        port: dbConfig.port,
        ...(dbConfig.ssl ? { ssl: dbConfig.ssl } : {}),
      });

      await bootstrapConn.query(`CREATE DATABASE IF NOT EXISTS \`${dbConfig.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`);
      await bootstrapConn.end();
    } catch (bootstrapErr) {
      if (bootstrapConn) {
        try { await bootstrapConn.end(); } catch (_) {}
      }
      // Cloud providers (such as TiDB Serverless) may pre-create databases or restrict CREATE DATABASE
      console.log(`[MySQL] Note: Pre-check (${bootstrapErr.message}). Continuing to connection pool for '${dbConfig.database}'...`);
    }

    // 2. Ensure Core Tables exist in phpMyAdmin database
    const conn = await pool.getConnection();
    try {
      // Patients table
      await conn.query(`
        CREATE TABLE IF NOT EXISTS \`patients\` (
          \`id\` INT AUTO_INCREMENT PRIMARY KEY,
          \`full_name\` VARCHAR(255) NOT NULL,
          \`phone\` VARCHAR(30) NOT NULL,
          \`age\` INT NOT NULL,
          \`blood_group\` VARCHAR(10) NOT NULL DEFAULT 'UNKNOWN',
          \`emergency_contact\` VARCHAR(255) DEFAULT NULL,
          \`medical_notes\` TEXT DEFAULT NULL,
          \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          INDEX \`idx_patients_phone\` (\`phone\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      // Doctors table
      await conn.query(`
        CREATE TABLE IF NOT EXISTS \`doctors\` (
          \`id\` INT AUTO_INCREMENT PRIMARY KEY,
          \`full_name\` VARCHAR(255) NOT NULL,
          \`specialty\` VARCHAR(100) NOT NULL,
          \`cabin_number\` VARCHAR(50) NOT NULL,
          \`is_available\` TINYINT(1) NOT NULL DEFAULT 1,
          INDEX \`idx_doctors_specialty\` (\`specialty\`),
          INDEX \`idx_doctors_available\` (\`is_available\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      // Appointments Queue table with priority score
      await conn.query(`
        CREATE TABLE IF NOT EXISTS \`appointments_queue\` (
          \`id\` INT AUTO_INCREMENT PRIMARY KEY,
          \`patient_id\` INT NOT NULL,
          \`doctor_id\` INT DEFAULT NULL,
          \`token_number\` VARCHAR(50) NOT NULL UNIQUE,
          \`type\` ENUM('routine', 'emergency') NOT NULL DEFAULT 'routine',
          \`severity\` ENUM('red', 'yellow', 'green') NOT NULL DEFAULT 'green',
          \`priority_score\` INT NOT NULL DEFAULT 3 COMMENT '1: Red (Critical), 2: Yellow (Urgent), 3: Green (Routine)',
          \`status\` ENUM('waiting', 'in_consultation', 'completed', 'cancelled') NOT NULL DEFAULT 'waiting',
          \`symptoms_summary\` TEXT DEFAULT NULL,
          \`prescription_notes\` TEXT DEFAULT NULL,
          \`estimated_wait_minutes\` INT NOT NULL DEFAULT 0,
          \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          \`updated_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          FOREIGN KEY (\`patient_id\`) REFERENCES \`patients\` (\`id\`) ON DELETE CASCADE,
          FOREIGN KEY (\`doctor_id\`) REFERENCES \`doctors\` (\`id\`) ON DELETE SET NULL,
          INDEX \`idx_queue_priority\` (\`status\`, \`priority_score\`, \`created_at\`),
          INDEX \`idx_queue_token\` (\`token_number\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      // Safe column migration for diagnosis, advice, prescription_notes, and doctor password
      try {
        await conn.query('ALTER TABLE `appointments_queue` ADD COLUMN `prescription_notes` TEXT DEFAULT NULL;');
      } catch (e) {}
      try {
        await conn.query('ALTER TABLE `appointments_queue` ADD COLUMN `diagnosis` VARCHAR(255) DEFAULT NULL;');
      } catch (e) {}
      try {
        await conn.query('ALTER TABLE `appointments_queue` ADD COLUMN `advice` TEXT DEFAULT NULL;');
      } catch (e) {}
      try {
        await conn.query("ALTER TABLE `doctors` ADD COLUMN `password` VARCHAR(255) NOT NULL DEFAULT 'doctor123';");
      } catch (e) {}

      // 3. Seed doctors if empty
      const [existingDoctors] = await conn.query('SELECT COUNT(*) AS cnt FROM `doctors`');
      if (existingDoctors[0].cnt === 0) {
        await seedDefaultData(conn);
      }

      // 4. Guarantee demo patient (9876543210) exists with complete historical clinical records
      const [alexPatient] = await conn.query("SELECT id FROM `patients` WHERE phone = '9876543210'");
      if (alexPatient.length === 0) {
        await conn.query(`
          INSERT INTO \`patients\` (\`full_name\`, \`phone\`, \`age\`, \`blood_group\`, \`emergency_contact\`, \`medical_notes\`)
          VALUES ('Alexander Wright', '9876543210', 45, 'O+', 'Sarah Wright (+1 555-871-3321)', 'Known Stage 1 Hypertension. Regular annual follow-up patient.')
        `);
        const [alexCreated] = await conn.query("SELECT id FROM `patients` WHERE phone = '9876543210'");
        const alexId = alexCreated[0].id;
        await conn.query(`
          INSERT INTO \`appointments_queue\` 
          (\`patient_id\`, \`doctor_id\`, \`token_number\`, \`type\`, \`severity\`, \`priority_score\`, \`status\`, \`symptoms_summary\`, \`diagnosis\`, \`prescription_notes\`, \`advice\`, \`estimated_wait_minutes\`, \`created_at\`) VALUES
          (?, 3, 'RT-088', 'routine', 'green', 3, 'completed', 'Persistent mild fatigue, daytime headache and elevated home BP readings.', 'Essential Hypertension Stage 1 & Tension Headache', 'Rx: Lisinopril 10mg PO once daily in morning. Paracetamol 500mg PRN for headache.', 'Maintain low sodium diet (<2g/day). Log BP twice daily. Routine follow-up in 2 weeks.', 0, DATE_SUB(NOW(), INTERVAL 14 DAY)),
          (?, 2, 'RT-074', 'routine', 'green', 3, 'completed', 'Routine annual cardiovascular baseline screening.', 'Borderline Hyperlipidemia', 'Rx: Atorvastatin 10mg PO QHS. Omega-3 Fish Oil 1000mg once daily.', 'Aerobic exercise 30 mins 4x/week. Re-evaluate lipid profile in 3 months.', 0, DATE_SUB(NOW(), INTERVAL 35 DAY))
          ON DUPLICATE KEY UPDATE \`token_number\`=\`token_number\`
        `, [alexId, alexId]);
      }
      console.log(`[MySQL] Connected successfully to ${dbConfig.database} @ ${dbConfig.host}:${dbConfig.port}`);
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error('[MySQL] Database Initialization Warning / Error:', err.message);
  }
}

/**
 * Seeds default doctors and demo patients if tables are empty
 */
async function seedDefaultData(conn) {
  console.log('[MySQL] Seeding initial doctors and queue into MySQL...');
  await conn.query(`
    INSERT INTO \`doctors\` (\`id\`, \`full_name\`, \`specialty\`, \`cabin_number\`, \`is_available\`, \`password\`) VALUES
    (1, 'Dr. Marcus Thorne, MD', 'Emergency & Trauma', 'Resuscitation Bay 1', 1, 'doctor123'),
    (2, 'Dr. Sarah Vance, FACC', 'Cardiology', 'Cabin 102', 1, 'doctor123'),
    (3, 'Dr. Priya Patel, MD', 'General Internal Medicine', 'Cabin 104', 1, 'doctor123'),
    (4, 'Dr. James Wilson, MD', 'Pediatrics & Family Health', 'Cabin 106', 1, 'doctor123')
    ON DUPLICATE KEY UPDATE \`full_name\`=\`full_name\`;
  `);

  await conn.query(`
    INSERT INTO \`patients\` (\`id\`, \`full_name\`, \`phone\`, \`age\`, \`blood_group\`, \`emergency_contact\`, \`medical_notes\`) VALUES
    (1, 'Elena Rostova', '+1 (555) 234-8901', 58, 'O+', 'Dmitri Rostova (+1 555-234-8902)', 'Known hypertension, coronary stent in 2023'),
    (2, 'David Kim', '+1 (555) 871-3320', 29, 'A+', 'Sarah Kim (+1 555-871-3321)', 'No chronic conditions. Allergic to Penicillin'),
    (3, 'Amara Okafor', '+1 (555) 492-1184', 42, 'B+', 'Chidi Okafor (+1 555-492-1185)', 'Type 2 Diabetes, well controlled'),
    (4, 'Lucas Miller', '+1 (555) 912-7744', 9, 'AB+', 'Karen Miller (+1 555-912-7745)', 'Mild seasonal asthma'),
    (5, 'Robert Hastings', '+1 (555) 304-6291', 64, 'O-', 'Mary Hastings (+1 555-304-6292)', 'Previous MI, on anticoagulant therapy'),
    (6, 'Alexander Wright', '9876543210', 45, 'O+', 'Sarah Wright (+1 555-871-3321)', 'Known Stage 1 Hypertension. Regular annual follow-up patient.')
    ON DUPLICATE KEY UPDATE \`phone\`=\`phone\`;
  `);

  await conn.query(`
    INSERT INTO \`appointments_queue\` 
    (\`id\`, \`patient_id\`, \`doctor_id\`, \`token_number\`, \`type\`, \`severity\`, \`priority_score\`, \`status\`, \`symptoms_summary\`, \`diagnosis\`, \`prescription_notes\`, \`advice\`, \`estimated_wait_minutes\`, \`created_at\`) VALUES
    -- Code Red Emergency
    (1, 5, 1, 'EM-001', 'emergency', 'red', 1, 'waiting', 'Critical Flag: Severe Chest Pain; SpO2: 89%; HR: 142 bpm; BP: 190/115 mmHg. Retrosternal crushing pain with diaphoresis', NULL, NULL, NULL, 0, DATE_SUB(NOW(), INTERVAL 15 MINUTE)),
    -- Code Yellow Urgent
    (2, 3, 3, 'EM-002', 'emergency', 'yellow', 2, 'waiting', 'Urgent Indicator: Acute Abdominal Guarding; VAS Pain: 8/10; Temp: 102.1°F. Suspected appendicitis', NULL, NULL, NULL, 10, DATE_SUB(NOW(), INTERVAL 25 MINUTE)),
    -- In Consultation
    (3, 1, 2, 'RT-101', 'routine', 'green', 3, 'in_consultation', 'Quarterly cardiovascular review and blood pressure medication titration', NULL, NULL, NULL, 0, DATE_SUB(NOW(), INTERVAL 50 MINUTE)),
    -- Waiting Routine
    (4, 2, 3, 'RT-102', 'routine', 'green', 3, 'waiting', 'Annual corporate physical and routine blood work referral', NULL, NULL, NULL, 25, DATE_SUB(NOW(), INTERVAL 40 MINUTE)),
    (5, 4, 4, 'RT-103', 'routine', 'green', 3, 'waiting', 'Pre-school allergy clearance and booster vaccination', NULL, NULL, NULL, 15, DATE_SUB(NOW(), INTERVAL 30 MINUTE)),
    -- Completed Past Visits for Demo Patient 9876543210
    (6, 6, 3, 'RT-088', 'routine', 'green', 3, 'completed', 'Persistent mild fatigue, daytime headache and elevated home BP readings.', 'Essential Hypertension Stage 1 & Tension Headache', 'Rx: Lisinopril 10mg PO once daily in morning. Paracetamol 500mg PRN for headache.', 'Maintain low sodium diet (<2g/day). Log BP twice daily. Routine follow-up in 2 weeks.', 0, DATE_SUB(NOW(), INTERVAL 14 DAY)),
    (7, 6, 2, 'RT-074', 'routine', 'green', 3, 'completed', 'Routine annual cardiovascular baseline screening.', 'Borderline Hyperlipidemia', 'Rx: Atorvastatin 10mg PO QHS. Omega-3 Fish Oil 1000mg once daily.', 'Aerobic exercise 30 mins 4x/week. Re-evaluate lipid profile in 3 months.', 0, DATE_SUB(NOW(), INTERVAL 35 DAY))
    ON DUPLICATE KEY UPDATE \`token_number\`=\`token_number\`;
  `);
}

/**
 * Reset helper for demo presentations
 */
async function resetDatabase() {
  const conn = await pool.getConnection();
  try {
    await conn.query('DELETE FROM `appointments_queue`;');
    await conn.query('DELETE FROM `patients`;');
    await conn.query('DELETE FROM `doctors`;');
    await conn.query('ALTER TABLE `appointments_queue` AUTO_INCREMENT = 1;');
    await conn.query('ALTER TABLE `patients` AUTO_INCREMENT = 1;');
    await conn.query('ALTER TABLE `doctors` AUTO_INCREMENT = 1;');
    await seedDefaultData(conn);
  } finally {
    conn.release();
  }
}

module.exports = {
  pool,
  initDatabase,
  resetDatabase,
  dbConfig,
};
