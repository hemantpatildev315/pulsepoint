-- schemas/schema.sql
-- Relational SQL DDL for PostgreSQL / SQLite / MySQL
-- Clinic Appointment, Patient & Emergency Management System

-- Drop tables if re-initializing
DROP TABLE IF EXISTS appointment_queue;
DROP TABLE IF EXISTS doctors;
DROP TABLE IF EXISTS patients;

-- 1. Patients Table
CREATE TABLE patients (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    age INT NOT NULL CHECK (age >= 0 AND age <= 130),
    blood_group VARCHAR(10) DEFAULT 'UNKNOWN',
    emergency_contact VARCHAR(100),
    medical_notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_patients_phone ON patients(phone);

-- 2. Doctors Table
CREATE TABLE doctors (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    department VARCHAR(100) NOT NULL,
    cabin_number VARCHAR(50) NOT NULL,
    is_available BOOLEAN DEFAULT TRUE,
    max_slots_per_day INT DEFAULT 30,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_doctors_department ON doctors(department);
CREATE INDEX idx_doctors_available ON doctors(is_available);

-- 3. Appointment & Queue Table
CREATE TABLE appointment_queue (
    id VARCHAR(36) PRIMARY KEY,
    patient_id VARCHAR(36) NOT NULL,
    doctor_id VARCHAR(36),
    type VARCHAR(20) NOT NULL DEFAULT 'routine' CHECK (type IN ('routine', 'emergency')),
    severity VARCHAR(10) NOT NULL DEFAULT 'green' CHECK (severity IN ('red', 'yellow', 'green')),
    status VARCHAR(20) NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'in_consultation', 'completed', 'cancelled')),
    token_number VARCHAR(50) NOT NULL UNIQUE,
    estimated_wait_minutes INT DEFAULT 0 CHECK (estimated_wait_minutes >= 0),
    
    -- Clinical Vitals & Triage Data
    heart_rate INT,
    spo2 INT,
    blood_pressure VARCHAR(20),
    triage_reason TEXT,
    chief_complaint TEXT,
    
    -- Consultation tracking
    consultation_start_at TIMESTAMP NULL,
    completed_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
    FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE SET NULL
);

-- Essential composite index for Emergency Priority Queue sorting:
-- Red (1) -> Yellow (2) -> Green (3), then by created_at ascending
CREATE INDEX idx_queue_priority ON appointment_queue(status, severity, created_at);
CREATE INDEX idx_queue_doctor ON appointment_queue(doctor_id, status);
