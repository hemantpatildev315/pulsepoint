// src/services/triageEngine.js
/**
 * Clinical Algorithmic Triage Engine
 * Based on Emergency Severity Index (ESI) & Manchester Triage protocols.
 * Evaluates patient physiological vitals and critical symptom flags
 * to determine urgency: 'red' (critical), 'yellow' (urgent), or 'green' (routine).
 */

const CRITICAL_FLAGS = [
  'cardiac_arrest',
  'unresponsive',
  'severe_chest_pain',
  'severe_respiratory_distress',
  'massive_hemorrhage',
  'anaphylaxis',
  'stroke_symptoms',
  'severe_head_trauma',
];

const URGENT_FLAGS = [
  'moderate_asthma',
  'suspected_fracture',
  'acute_abdominal_pain',
  'high_fever_lethargy',
  'persistent_vomiting_dehydration',
  'deep_laceration',
  'burns_moderate',
  'severe_migraine',
];

/**
 * Evaluates vitals and symptom flags to compute clinical triage output.
 * 
 * @param {Object} input
 * @param {number} [input.heartRate] - bpm
 * @param {number} [input.spo2] - percentage 0-100
 * @param {string|number} [input.systolicBP] - mmHg
 * @param {number} [input.painScale] - 0 to 10
 * @param {number} [input.temperature] - Fahrenheit
 * @param {string[]} [input.symptoms] - list of symptom flags
 * @param {string} [input.chiefComplaint] - textual description
 * @returns {Object} Triage result with severity, reason, priorityScore
 */
function evaluateTriage(input = {}) {
  const {
    heartRate,
    spo2,
    systolicBP,
    painScale,
    temperature,
    symptoms = [],
    chiefComplaint = '',
  } = input;

  const redReasons = [];
  const yellowReasons = [];

  // 1. Critical Flags Check (Immediate Level 1 Red)
  for (const symptom of symptoms) {
    if (CRITICAL_FLAGS.includes(symptom)) {
      redReasons.push(`Critical Flag: ${formatFlagName(symptom)}`);
    }
  }

  // Text search in complaint for emergency keywords
  const lowerComplaint = (chiefComplaint || '').toLowerCase();
  if (lowerComplaint.includes('unconscious') || lowerComplaint.includes('not breathing') || lowerComplaint.includes('cardiac arrest')) {
    redReasons.push('Complaint indicates immediate life-threat');
  }

  // 2. Physiological Vitals Evaluation
  // SpO2 (Oxygen Saturation)
  if (typeof spo2 === 'number' && !isNaN(spo2)) {
    if (spo2 < 90) {
      redReasons.push(`Critical Hypoxia (SpO2: ${spo2}% < 90%)`);
    } else if (spo2 >= 90 && spo2 <= 94) {
      yellowReasons.push(`Borderline Hypoxia (SpO2: ${spo2}%)`);
    }
  }

  // Heart Rate
  if (typeof heartRate === 'number' && !isNaN(heartRate)) {
    if (heartRate > 135 || heartRate < 40) {
      redReasons.push(`Severe Arrhythmia / Tachycardia (HR: ${heartRate} bpm)`);
    } else if ((heartRate >= 115 && heartRate <= 135) || (heartRate >= 40 && heartRate < 50)) {
      yellowReasons.push(`Elevated / Depressed Heart Rate (HR: ${heartRate} bpm)`);
    }
  }

  // Blood Pressure (Systolic)
  const sysNum = parseInt(systolicBP, 10);
  if (!isNaN(sysNum)) {
    if (sysNum < 85) {
      redReasons.push(`Severe Hypotension / Shock risk (Systolic BP: ${sysNum} mmHg)`);
    } else if (sysNum >= 185) {
      redReasons.push(`Hypertensive Crisis (Systolic BP: ${sysNum} mmHg)`);
    } else if ((sysNum >= 150 && sysNum < 185) || (sysNum >= 85 && sysNum < 95)) {
      yellowReasons.push(`Abnormal Blood Pressure (Systolic BP: ${sysNum} mmHg)`);
    }
  }

  // Pain Scale (0-10)
  if (typeof painScale === 'number' && !isNaN(painScale)) {
    if (painScale >= 8) {
      yellowReasons.push(`Severe Acute Pain (VAS: ${painScale}/10)`);
    }
  }

  // Temperature
  if (typeof temperature === 'number' && !isNaN(temperature)) {
    if (temperature >= 103.0) {
      yellowReasons.push(`High Hyperthermia (Temp: ${temperature}°F)`);
    }
  }

  // Urgent Flags Check
  for (const symptom of symptoms) {
    if (URGENT_FLAGS.includes(symptom)) {
      yellowReasons.push(`Urgent Indicator: ${formatFlagName(symptom)}`);
    }
  }

  // 3. Final Severity Determination
  if (redReasons.length > 0) {
    return {
      severity: 'red',
      priorityRank: 1,
      triageReason: redReasons.join('; '),
      recommendedAction: 'Immediate Resuscitation & Emergency Bay Dispatch',
      isEmergencyOverride: true,
    };
  }

  if (yellowReasons.length > 0) {
    return {
      severity: 'yellow',
      priorityRank: 2,
      triageReason: yellowReasons.join('; '),
      recommendedAction: 'Urgent Assessment within 10-15 Minutes',
      isEmergencyOverride: true,
    };
  }

  // Default to Green (Stable Routine)
  return {
    severity: 'green',
    priorityRank: 3,
    triageReason: 'Vitals stable, routine outpatient assessment',
    recommendedAction: 'Scheduled Consultation',
    isEmergencyOverride: false,
  };
}

function formatFlagName(flag) {
  return flag
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

module.exports = {
  evaluateTriage,
  CRITICAL_FLAGS,
  URGENT_FLAGS,
};
