-- schemas/cpanel_phpmyadmin_schema.sql
-- Relational MySQL / MariaDB Schema for cPanel / phpMyAdmin
-- Clinic Appointment, Patient & Emergency Management System

-- Create Database if importing on local or root environment
CREATE DATABASE IF NOT EXISTS `clinic_db` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `clinic_db`;

-- -------------------------------------------------------------
-- Table 1: patients
-- -------------------------------------------------------------
DROP TABLE IF EXISTS `appointments_queue`;
DROP TABLE IF EXISTS `doctors`;
DROP TABLE IF EXISTS `patients`;

CREATE TABLE `patients` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `full_name` VARCHAR(255) NOT NULL,
  `phone` VARCHAR(30) NOT NULL,
  `age` INT NOT NULL,
  `blood_group` VARCHAR(10) NOT NULL DEFAULT 'UNKNOWN',
  `emergency_contact` VARCHAR(255) DEFAULT NULL,
  `medical_notes` TEXT DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_patients_phone` (`phone`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------------------------
-- Table 2: doctors
-- -------------------------------------------------------------
CREATE TABLE `doctors` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `full_name` VARCHAR(255) NOT NULL,
  `specialty` VARCHAR(100) NOT NULL,
  `cabin_number` VARCHAR(50) NOT NULL,
  `is_available` TINYINT(1) NOT NULL DEFAULT 1,
  INDEX `idx_doctors_specialty` (`specialty`),
  INDEX `idx_doctors_available` (`is_available`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------------------------
-- Table 3: appointments_queue
-- -------------------------------------------------------------
CREATE TABLE `appointments_queue` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `patient_id` INT NOT NULL,
  `doctor_id` INT DEFAULT NULL,
  `token_number` VARCHAR(50) NOT NULL UNIQUE,
  `type` ENUM('routine', 'emergency') NOT NULL DEFAULT 'routine',
  `severity` ENUM('red', 'yellow', 'green') NOT NULL DEFAULT 'green',
  `priority_score` INT NOT NULL DEFAULT 3 COMMENT '1: Red (Critical), 2: Yellow (Urgent), 3: Green (Routine)',
  `status` ENUM('waiting', 'in_consultation', 'completed', 'cancelled') NOT NULL DEFAULT 'waiting',
  `symptoms_summary` TEXT DEFAULT NULL,
  `estimated_wait_minutes` INT NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (`patient_id`) REFERENCES `patients` (`id`) ON DELETE CASCADE,
  FOREIGN KEY (`doctor_id`) REFERENCES `doctors` (`id`) ON DELETE SET NULL,
  INDEX `idx_queue_priority` (`status`, `priority_score`, `created_at`),
  INDEX `idx_queue_token` (`token_number`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------------------------
-- Seed Initial Doctors
-- -------------------------------------------------------------
INSERT INTO `doctors` (`id`, `full_name`, `specialty`, `cabin_number`, `is_available`) VALUES
(1, 'Dr. Marcus Thorne, MD', 'Emergency & Trauma', 'Resuscitation Bay 1', 1),
(2, 'Dr. Sarah Vance, FACC', 'Cardiology', 'Cabin 102', 1),
(3, 'Dr. Priya Patel, MD', 'General Internal Medicine', 'Cabin 104', 1),
(4, 'Dr. James Wilson, MD', 'Pediatrics & Family Health', 'Cabin 106', 1);

-- -------------------------------------------------------------
-- Seed Initial Patients
-- -------------------------------------------------------------
INSERT INTO `patients` (`id`, `full_name`, `phone`, `age`, `blood_group`, `emergency_contact`, `medical_notes`) VALUES
(1, 'Elena Rostova', '+1 (555) 234-8901', 58, 'O+', 'Dmitri Rostova (+1 555-234-8902)', 'Known hypertension, coronary stent in 2023'),
(2, 'David Kim', '+1 (555) 871-3320', 29, 'A+', 'Sarah Kim (+1 555-871-3321)', 'No chronic conditions. Allergic to Penicillin'),
(3, 'Amara Okafor', '+1 (555) 492-1184', 42, 'B+', 'Chidi Okafor (+1 555-492-1185)', 'Type 2 Diabetes, well controlled'),
(4, 'Lucas Miller', '+1 (555) 912-7744', 9, 'AB+', 'Karen Miller (+1 555-912-7745)', 'Mild seasonal asthma'),
(5, 'Robert Hastings', '+1 (555) 304-6291', 64, 'O-', 'Mary Hastings (+1 555-304-6292)', 'Previous MI, on anticoagulant therapy');

-- -------------------------------------------------------------
-- Seed Initial Appointments & Priority Queue
-- -------------------------------------------------------------
INSERT INTO `appointments_queue` 
(`id`, `patient_id`, `doctor_id`, `token_number`, `type`, `severity`, `priority_score`, `status`, `symptoms_summary`, `estimated_wait_minutes`, `created_at`) VALUES
-- 1. Code Red: Robert Hastings (Critical MI / Chest Pain -> priority_score = 1)
(1, 5, 1, 'EM-001', 'emergency', 'red', 1, 'waiting', 'Critical Flag: Severe Chest Pain; SpO2: 89%; HR: 142 bpm; BP: 190/115 mmHg. Retrosternal crushing pain with diaphoresis', 0, DATE_SUB(NOW(), INTERVAL 15 MINUTE)),

-- 2. Code Yellow: Amara Okafor (Acute Abdominal Pain -> priority_score = 2)
(2, 3, 3, 'EM-002', 'emergency', 'yellow', 2, 'waiting', 'Urgent Indicator: Acute Abdominal Guarding; VAS Pain: 8/10; Temp: 102.1°F. Suspected appendicitis', 10, DATE_SUB(NOW(), INTERVAL 25 MINUTE)),

-- 3. In Consultation: Elena Rostova (Routine review with Dr. Vance)
(3, 1, 2, 'RT-101', 'routine', 'green', 3, 'in_consultation', 'Quarterly cardiovascular review and blood pressure medication titration', 0, DATE_SUB(NOW(), INTERVAL 50 MINUTE)),

-- 4. Routine Green: David Kim (Waiting for Dr. Patel -> priority_score = 3)
(4, 2, 3, 'RT-102', 'routine', 'green', 3, 'waiting', 'Annual corporate physical and routine blood work referral', 25, DATE_SUB(NOW(), INTERVAL 40 MINUTE)),

-- 5. Routine Green: Lucas Miller (Waiting for Dr. Wilson -> priority_score = 3)
(5, 4, 4, 'RT-103', 'routine', 'green', 3, 'waiting', 'Pre-school allergy clearance and booster vaccination', 15, DATE_SUB(NOW(), INTERVAL 30 MINUTE));
