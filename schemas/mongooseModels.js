// schemas/mongooseModels.js
// Mongoose Schema Definitions for MongoDB
const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * Patient Schema
 */
const PatientSchema = new Schema(
  {
    name: {
      type: String,
      required: [true, 'Patient name is required'],
      trim: true,
    },
    phone: {
      type: String,
      required: [true, 'Phone number is required'],
      trim: true,
      index: true,
    },
    age: {
      type: Number,
      required: [true, 'Patient age is required'],
      min: [0, 'Age cannot be negative'],
      max: [130, 'Invalid age'],
    },
    bloodGroup: {
      type: String,
      enum: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'UNKNOWN'],
      default: 'UNKNOWN',
    },
    emergencyContact: {
      type: String,
      trim: true,
    },
    medicalNotes: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true }
);

/**
 * Doctor Schema
 */
const DoctorSchema = new Schema(
  {
    name: {
      type: String,
      required: [true, 'Doctor name is required'],
      trim: true,
    },
    department: {
      type: String,
      required: [true, 'Specialty department is required'],
      trim: true,
      index: true,
    },
    cabinNumber: {
      type: String,
      required: [true, 'Cabin number is required'],
      trim: true,
    },
    isAvailable: {
      type: Boolean,
      default: true,
    },
    maxSlotsPerDay: {
      type: Number,
      default: 30,
      min: 1,
    },
  },
  { timestamps: true }
);

/**
 * Appointment & Queue Schema
 */
const AppointmentQueueSchema = new Schema(
  {
    patientId: {
      type: Schema.Types.ObjectId,
      ref: 'Patient',
      required: true,
      index: true,
    },
    doctorId: {
      type: Schema.Types.ObjectId,
      ref: 'Doctor',
      index: true,
      default: null,
    },
    type: {
      type: String,
      enum: ['routine', 'emergency'],
      default: 'routine',
      required: true,
    },
    severity: {
      type: String,
      enum: ['red', 'yellow', 'green'],
      default: 'green',
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['waiting', 'in_consultation', 'completed', 'cancelled'],
      default: 'waiting',
      required: true,
      index: true,
    },
    tokenNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    estimatedWaitMinutes: {
      type: Number,
      default: 0,
      min: 0,
    },
    // Vitals & Clinical notes
    heartRate: { type: Number },
    spo2: { type: Number },
    bloodPressure: { type: String },
    triageReason: { type: String },
    chiefComplaint: { type: String },
    consultationStartAt: { type: Date },
    completedAt: { type: Date },
  },
  { timestamps: true }
);

// Compound index for lightning-fast priority queue retrieval
AppointmentQueueSchema.index({ status: 1, severity: 1, createdAt: 1 });

const Patient = mongoose.models.Patient || mongoose.model('Patient', PatientSchema);
const Doctor = mongoose.models.Doctor || mongoose.model('Doctor', DoctorSchema);
const AppointmentQueue = mongoose.models.AppointmentQueue || mongoose.model('AppointmentQueue', AppointmentQueueSchema);

module.exports = {
  Patient,
  Doctor,
  AppointmentQueue,
  PatientSchema,
  DoctorSchema,
  AppointmentQueueSchema,
};
