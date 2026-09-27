// src/services/queueManager.js
const store = require('../data/store');

const CONSULT_DURATION = {
  emergencyRed: 25,
  emergencyYellow: 20,
  routine: 15,
};

const SEVERITY_WEIGHT = {
  red: 1,
  yellow: 2,
  green: 3,
};

/**
 * Returns prioritized, sorted queue with calculated positions and wait times.
 * 
 * @param {Object} options
 * @param {string} [options.doctorId] - filter by specific doctor
 * @param {string} [options.severity] - filter by severity (red, yellow, green)
 * @param {string} [options.status] - filter by status (waiting, in_consultation, completed)
 * @param {string} [options.search] - search by patient name, phone, or token
 * @param {boolean} [options.includeCompleted] - whether to include completed/cancelled
 */
function getSortedActiveQueue(options = {}) {
  const { doctorId, severity, status, search, includeCompleted = false } = options;
  const rawQueue = store.getQueue();
  const doctors = store.getDoctors();
  const patients = store.getPatients();

  const doctorMap = new Map(doctors.map(d => [d.id, d]));
  const patientMap = new Map(patients.map(p => [p.id, p]));

  // 1. Filter
  let filtered = rawQueue.filter(item => {
    if (!includeCompleted && (item.status === 'completed' || item.status === 'cancelled')) {
      return false;
    }
    if (status && item.status !== status) {
      return false;
    }
    if (doctorId && item.doctorId !== doctorId) {
      return false;
    }
    if (severity && item.severity !== severity) {
      return false;
    }
    return true;
  });

  // 2. Strict Triage Sorting Algorithm
  // - In consultation items are presented at the active consultation slot
  // - Waiting queue is strictly sorted:
  //   1) Severity: Red (1) > Yellow (2) > Green (3)
  //   2) Within same severity: createdAt Ascending (FIFO)
  filtered.sort((a, b) => {
    // If one is in_consultation and the other is waiting:
    if (a.status === 'in_consultation' && b.status !== 'in_consultation') return -1;
    if (b.status === 'in_consultation' && a.status !== 'in_consultation') return 1;

    // Both in_consultation
    if (a.status === 'in_consultation' && b.status === 'in_consultation') {
      const aStart = a.consultationStartAt ? new Date(a.consultationStartAt).getTime() : 0;
      const bStart = b.consultationStartAt ? new Date(b.consultationStartAt).getTime() : 0;
      return aStart - bStart;
    }

    // Both waiting: check severity weight
    const weightA = SEVERITY_WEIGHT[a.severity] || 3;
    const weightB = SEVERITY_WEIGHT[b.severity] || 3;

    if (weightA !== weightB) {
      return weightA - weightB; // 1 (red) before 2 (yellow) before 3 (green)
    }

    // Same severity: FIFO by creation time
    const timeA = new Date(a.createdAt).getTime();
    const timeB = new Date(b.createdAt).getTime();
    return timeA - timeB;
  });

  // 3. Compute dynamic queue positions & estimated wait times per doctor stream
  const doctorAccumulatedWait = {};
  doctors.forEach(d => {
    doctorAccumulatedWait[d.id] = 0;
  });
  let generalAccumulatedWait = 0;
  let waitingIndex = 1;

  const now = Date.now();

  const enriched = filtered.map(item => {
    const patient = patientMap.get(item.patientId) || {
      name: 'Unknown Patient',
      phone: 'N/A',
      age: 0,
      bloodGroup: 'UNKNOWN',
    };
    const doctor = doctorMap.get(item.doctorId) || null;

    const createdTime = new Date(item.createdAt).getTime();
    const elapsedMinutes = Math.max(0, Math.floor((now - createdTime) / 60000));

    let queuePosition = null;
    let dynamicWait = item.estimatedWaitMinutes;

    if (item.status === 'waiting') {
      queuePosition = waitingIndex++;

      // Emergency overrides have minimal wait
      if (item.severity === 'red') {
        dynamicWait = 0; // Immediate resuscitation bay slot
      } else if (item.severity === 'yellow') {
        dynamicWait = Math.min(10, 5 * (queuePosition - 1));
      } else {
        // Routine visit: calculate wait based on queue ahead
        const docKey = item.doctorId || 'general';
        const docWait = doctorAccumulatedWait[docKey] !== undefined ? doctorAccumulatedWait[docKey] : generalAccumulatedWait;
        dynamicWait = Math.max(5, docWait);

        // Increment accumulator for subsequent patients of this doctor
        if (doctorAccumulatedWait[docKey] !== undefined) {
          doctorAccumulatedWait[docKey] += CONSULT_DURATION.routine;
        } else {
          generalAccumulatedWait += CONSULT_DURATION.routine;
        }
      }
    } else if (item.status === 'in_consultation') {
      const startTime = item.consultationStartAt ? new Date(item.consultationStartAt).getTime() : now;
      const consultElapsed = Math.floor((now - startTime) / 60000);
      const standardTime = item.severity === 'red' ? CONSULT_DURATION.emergencyRed : CONSULT_DURATION.routine;
      dynamicWait = Math.max(1, standardTime - consultElapsed);
    } else {
      dynamicWait = 0;
    }

    return {
      ...item,
      patient,
      doctor,
      queuePosition,
      elapsedWaitMinutes: elapsedMinutes,
      calculatedWaitMinutes: dynamicWait,
    };
  });

  // 4. Text Search (if specified)
  if (search && search.trim()) {
    const q = search.toLowerCase().trim();
    return enriched.filter(item => {
      const matchToken = item.tokenNumber.toLowerCase().includes(q);
      const matchName = item.patient.name.toLowerCase().includes(q);
      const matchPhone = item.patient.phone.toLowerCase().includes(q);
      const matchDoctor = item.doctor ? item.doctor.name.toLowerCase().includes(q) : false;
      return matchToken || matchName || matchPhone || matchDoctor;
    });
  }

  return enriched;
}

/**
 * Calculates aggregate stats for clinic desk KPI bar
 */
function getQueueStats() {
  const allQueue = store.getQueue();
  const doctors = store.getDoctors();

  const waiting = allQueue.filter(i => i.status === 'waiting');
  const inConsult = allQueue.filter(i => i.status === 'in_consultation');
  const completed = allQueue.filter(i => i.status === 'completed');

  const criticalRed = waiting.filter(i => i.severity === 'red').length;
  const urgentYellow = waiting.filter(i => i.severity === 'yellow').length;
  const routineGreen = waiting.filter(i => i.severity === 'green').length;

  return {
    totalWaiting: waiting.length,
    inConsultationCount: inConsult.length,
    completedToday: completed.length,
    criticalRedCount: criticalRed,
    urgentYellowCount: urgentYellow,
    routineGreenCount: routineGreen,
    doctorsOnDutyCount: doctors.filter(d => d.isAvailable).length,
    lastUpdated: new Date().toISOString(),
  };
}

module.exports = {
  getSortedActiveQueue,
  getQueueStats,
};
