// src/utils/validator.js

const VALID_BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'UNKNOWN'];
const VALID_STATUSES = ['waiting', 'in_consultation', 'completed', 'cancelled'];

function validateBooking(body) {
  const errors = [];
  const { name, phone, age, doctorId, bloodGroup } = body || {};

  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    errors.push('Patient name must be at least 2 characters.');
  }

  if (!phone || typeof phone !== 'string' || phone.trim().length < 7) {
    errors.push('A valid phone number is required.');
  }

  const parsedAge = parseInt(age, 10);
  if (isNaN(parsedAge) || parsedAge < 0 || parsedAge > 130) {
    errors.push('Age must be a valid number between 0 and 130.');
  }

  if (bloodGroup && !VALID_BLOOD_GROUPS.includes(bloodGroup.toUpperCase())) {
    errors.push(`Blood group must be one of: ${VALID_BLOOD_GROUPS.join(', ')}`);
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

function validateEmergencyIntake(body) {
  const errors = [];
  const { name, age, heartRate, spo2, bloodPressure } = body || {};

  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    errors.push('Patient identifier or name is required.');
  }

  const parsedAge = parseInt(age, 10);
  if (isNaN(parsedAge) || parsedAge < 0 || parsedAge > 130) {
    errors.push('Age must be a valid number between 0 and 130.');
  }

  if (heartRate !== undefined && heartRate !== null && heartRate !== '') {
    const hr = Number(heartRate);
    if (isNaN(hr) || hr < 20 || hr > 300) {
      errors.push('Heart rate must be between 20 and 300 bpm.');
    }
  }

  if (spo2 !== undefined && spo2 !== null && spo2 !== '') {
    const ox = Number(spo2);
    if (isNaN(ox) || ox < 0 || ox > 100) {
      errors.push('SpO2 percentage must be between 0% and 100%.');
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

function validateStatusUpdate(body) {
  const errors = [];
  const { status } = body || {};

  if (!status || !VALID_STATUSES.includes(status)) {
    errors.push(`Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`);
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

module.exports = {
  validateBooking,
  validateEmergencyIntake,
  validateStatusUpdate,
  VALID_BLOOD_GROUPS,
  VALID_STATUSES,
};
