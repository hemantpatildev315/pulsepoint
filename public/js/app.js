// public/js/app.js
// Phase 2 Refinement: Role Isolation, Dedicated Consoles, Patient History & Real-Time Alarms

(function () {
  'use strict';

  // --- State ---
  let doctorsList = [];
  let currentDoctorUser = null;
  let currentPatientUser = null;
  let activePatientToken = null;
  let ws = null;
  let activeAlarmOsc = null;

  // --- Audio Synthesis via Web Audio API ---
  let audioCtx = null;

  function initAudioContext() {
    if (!audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) audioCtx = new AudioContext();
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
  }

  function playSound(type = 'chime') {
    try {
      initAudioContext();
      if (!audioCtx) return;
      const now = audioCtx.currentTime;

      if (type === 'alarm') {
        // High-visibility turn alarm: 3 alternating urgent beeps
        [0, 0.16, 0.32, 0.48].forEach((delay, idx) => {
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(idx % 2 === 0 ? 880 : 1174.66, now + delay);
          gain.gain.setValueAtTime(0.25, now + delay);
          gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.12);
          osc.connect(gain);
          gain.connect(audioCtx.destination);
          osc.start(now + delay);
          osc.stop(now + delay + 0.12);
        });
      } else {
        // Melodic hospital desk chime (A5 -> E5)
        const osc1 = audioCtx.createOscillator();
        const osc2 = audioCtx.createOscillator();
        const gain1 = audioCtx.createGain();
        const gain2 = audioCtx.createGain();

        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(880, now);
        gain1.gain.setValueAtTime(0.18, now);
        gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(659.25, now + 0.14);
        gain2.gain.setValueAtTime(0.18, now + 0.14);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.55);

        osc1.connect(gain1);
        gain1.connect(audioCtx.destination);
        osc2.connect(gain2);
        gain2.connect(audioCtx.destination);

        osc1.start(now);
        osc1.stop(now + 0.35);
        osc2.start(now + 0.14);
        osc2.stop(now + 0.55);
      }
    } catch (e) {
      // Audio autoplay policy fallback
    }
  }

  // --- Toast Notifications ---
  function showToast(message, type = 'info') {
    const stack = document.getElementById('toastNotificationStack');
    if (!stack) return;
    const toast = document.createElement('div');
    toast.className = `toast-item-clean ${type === 'error' ? 'error' : type === 'success' ? 'success' : ''}`;
    toast.innerHTML = `
      <span>${type === 'error' ? '⚠️' : type === 'success' ? '✓' : '🔔'}</span>
      <span>${escapeHtml(message)}</span>
    `;
    stack.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.25s ease';
      setTimeout(() => toast.remove(), 250);
    }, 4000);
  }

  // --- Clock Sync ---
  function initClocks() {
    function tick() {
      const timeStr = new Date().toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      const recClock = document.getElementById('recClock');
      const patientClock = document.getElementById('patientClock');
      if (recClock) recClock.textContent = timeStr;
      if (patientClock) patientClock.textContent = timeStr;
    }
    setInterval(tick, 1000);
    tick();
  }

  // -------------------------------------------------------------
  // 1. ROUTE ISOLATION CONTROLLER
  // Strictly renders only the portal matching window.location.pathname
  // -------------------------------------------------------------
  function resolveRoute() {
    const path = window.location.pathname.toLowerCase();

    const rootHub = document.getElementById('rootDirectoryHub');
    const recPortal = document.getElementById('roleReceptionPortal');
    const docPortal = document.getElementById('roleDoctorPortal');
    const patPortal = document.getElementById('rolePatientPortal');

    // Hide all
    rootHub.style.display = 'none';
    recPortal.style.display = 'none';
    docPortal.style.display = 'none';
    patPortal.style.display = 'none';

    if (path.startsWith('/reception')) {
      recPortal.style.display = 'block';
      document.title = 'Reception Desk | PulsePoint Clinical OS';
      initReceptionPortal();
    } else if (path.startsWith('/doctor')) {
      docPortal.style.display = 'block';
      document.title = 'Doctor Portal | PulsePoint Clinical OS';
      initDoctorPortal();
    } else if (path.startsWith('/patient')) {
      patPortal.style.display = 'block';
      document.title = 'Patient Portal | PulsePoint Clinical OS';
      initPatientPortal();
    } else {
      // Root '/' hub
      rootHub.style.display = 'block';
      document.title = 'PulsePoint Workstation Directory';
    }
  }

  // -------------------------------------------------------------
  // 2. WEBSOCKET REAL-TIME TELEMETRY
  // -------------------------------------------------------------
  function initWebSocketSync() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;

    try {
      ws = new WebSocket(wsUrl);

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          
          // Case 1: General Queue Update
          if (msg.type === 'QUEUE_UPDATED') {
            onQueueUpdated(msg.payload);
          }

          // Case 2: Specific Doctor Called Patient Event
          if (msg.type === 'DOCTOR_CALLED_PATIENT') {
            onDoctorCalledPatient(msg.payload || msg);
          }
        } catch (e) {
          // ignore
        }
      };

      ws.onclose = () => {
        setTimeout(initWebSocketSync, 3000);
      };
    } catch (err) {
      setTimeout(initWebSocketSync, 4000);
    }
  }

  function onQueueUpdated(payload) {
    const path = window.location.pathname.toLowerCase();
    if (path.startsWith('/reception')) {
      refreshReceptionTable();
    } else if (path.startsWith('/doctor')) {
      if (currentDoctorUser) refreshDoctorWorkspace();
    } else if (path.startsWith('/patient')) {
      if (activePatientToken) refreshPatientDigitalToken();
    }
  }

  function onDoctorCalledPatient(eventData) {
    const path = window.location.pathname.toLowerCase();
    const { doctorName, cabinNumber, tokenNumber, patientName } = eventData;

    // A. If on Reception Desk: Play subtle desk chime and show toast notice
    if (path.startsWith('/reception')) {
      playSound('chime');
      showToast(`${doctorName} (${cabinNumber}) is calling ${patientName} (Token ${tokenNumber})`);
      refreshReceptionTable();
    }

    // B. If on Patient Portal: Check if active token matches
    if (path.startsWith('/patient')) {
      const savedToken = activePatientToken || sessionStorage.getItem('activePatientToken');
      if (savedToken && savedToken === tokenNumber) {
        // Trigger high-urgency audible alarm and visual overlay
        playSound('alarm');
        triggerPatientTurnOverlay(doctorName, cabinNumber);
        refreshPatientDigitalToken();
      }
    }

    // C. If on Doctor Console: Refresh workspace
    if (path.startsWith('/doctor')) {
      if (currentDoctorUser) refreshDoctorWorkspace();
    }
  }

  // -------------------------------------------------------------
  // 3. RECEPTION DESK PORTAL (/reception)
  // -------------------------------------------------------------
  async function initReceptionPortal() {
    await fetchDoctorsRoster();
    await refreshReceptionTable();

    const btnRefresh = document.getElementById('btnReceptionRefresh');
    if (btnRefresh) {
      btnRefresh.addEventListener('click', () => {
        refreshReceptionTable();
        showToast('Queue refreshed');
      });
    }

    // Polling fallback
    setInterval(() => {
      if (window.location.pathname.startsWith('/reception')) {
        refreshReceptionTable();
      }
    }, 4500);
  }

  async function refreshReceptionTable() {
    try {
      const [statsRes, queueRes] = await Promise.all([
        api.getStats(),
        api.getLiveQueue({ includeCompleted: false }),
      ]);

      const stats = statsRes.data || {};
      const queue = queueRes.data || [];

      // 3 Large Simple Metric Cards
      const critEl = document.getElementById('recMetricCritical');
      const waitEl = document.getElementById('recMetricWaiting');
      const consultEl = document.getElementById('recMetricConsulting');

      if (critEl) critEl.textContent = stats.criticalRedCount ?? 0;
      if (waitEl) waitEl.textContent = stats.totalWaiting ?? 0;
      if (consultEl) consultEl.textContent = stats.inConsultationCount ?? 0;

      // Phase 3: Emergency Bay & Resource Indicator
      const redCount = stats.criticalRedCount ?? 0;
      const totalBays = 4;
      const availableBays = Math.max(0, totalBays - redCount);
      const bayEl = document.getElementById('recBaysAvailable');
      if (bayEl) {
        bayEl.textContent = `${availableBays}/${totalBays} Available`;
        if (availableBays === 0) {
          bayEl.className = 'facility-stat-val val-red';
        } else if (availableBays <= 1) {
          bayEl.className = 'facility-stat-val val-amber';
        } else {
          bayEl.className = 'facility-stat-val val-green';
        }
      }

      const tbody = document.getElementById('receptionQueueTableBody');
      if (!tbody) return;

      if (!queue.length) {
        tbody.innerHTML = `
          <tr>
            <td colspan="6" style="text-align: center; padding: 3rem; color: var(--text-subtle);">
              <strong>All patient queues are clear.</strong>
              <p style="font-size: 0.85rem; margin-top: 0.25rem;">New arrivals from the Patient Portal will appear here automatically.</p>
            </td>
          </tr>
        `;
        return;
      }

      tbody.innerHTML = queue.map(item => {
        const isRed = item.severity === 'red';
        const isYellow = item.severity === 'yellow';
        const isInConsult = item.status === 'in_consultation';

        const tagClass = isRed ? 'red' : isYellow ? 'amber' : 'green';
        const tagLabel = isRed ? 'CRITICAL EMERGENCY' : isYellow ? 'URGENT' : 'ROUTINE';
        const tokenClass = isRed ? 'red' : isYellow ? 'amber' : '';

        // Doctor options dropdown
        const docOptions = doctorsList.map(doc => `
          <option value="${doc.id}" ${item.doctorId === doc.id ? 'selected' : ''}>
            ${escapeHtml(doc.name)} (${escapeHtml(doc.cabinNumber)})
          </option>
        `).join('');

        return `
          <tr class="${isRed ? 'row-red-triage' : ''}">
            <!-- Priority & Token -->
            <td>
              <div style="display: flex; flex-direction: column; gap: 0.35rem; align-items: start;">
                <span class="token-badge-clean ${tokenClass}">${escapeHtml(item.tokenNumber)}</span>
                <span class="triage-indicator-pill ${tagClass}">${tagLabel}</span>
              </div>
            </td>

            <!-- Patient Details -->
            <td>
              <div style="font-weight: 700; color: var(--text-main); font-size: 0.95rem;">
                ${escapeHtml(item.patient.name)}
              </div>
              <div style="font-size: 0.8rem; color: var(--text-subtle); margin-top: 0.1rem;">
                Age: ${item.patient.age}y • Blood: <strong>${escapeHtml(item.patient.bloodGroup || 'UNK')}</strong>
              </div>
            </td>

            <!-- Symptoms / Triage Reason -->
            <td>
              <div style="font-size: 0.875rem; color: var(--text-main); line-height: 1.35;">
                ${escapeHtml(item.chiefComplaint || 'Clinical evaluation')}
              </div>
              ${item.triageReason && isRed ? `
                <div style="font-size: 0.75rem; color: var(--urgency-red); font-weight: 700; margin-top: 0.2rem;">
                  🚨 ${escapeHtml(item.triageReason)}
                </div>
              ` : ''}
            </td>

            <!-- Doctor Assignment Dropdown -->
            <td>
              <select class="doctor-reassign-select" onchange="handleReceptionAssignDoctor('${item.id}', this.value)">
                <option value="">-- Assign Physician --</option>
                ${docOptions}
              </select>
            </td>

            <!-- Wait Time -->
            <td>
              <div class="num" style="font-weight: 700; color: var(--text-main);">
                ${isInConsult ? '<span style="color: var(--status-consult);">In Cabin</span>' : item.calculatedWaitMinutes <= 0 ? '<span style="color: var(--urgency-red);">Immediate</span>' : `~${item.calculatedWaitMinutes}m`}
              </div>
              <div style="font-size: 0.75rem; color: var(--text-subtle);">Wait: ${item.elapsedWaitMinutes}m</div>
            </td>

            <!-- Action -->
            <td style="text-align: right;">
              ${item.status === 'waiting' ? `
                <button type="button" class="btn-solid-dark" style="padding: 0.45rem 0.9rem; font-size: 0.8rem;" onclick="handleReceptionCallIn('${item.id}', '${escapeHtml(item.tokenNumber)}')">
                  Call In
                </button>
              ` : `
                <span class="status-badge-clean in-consult">In Cabin</span>
              `}
            </td>
          </tr>
        `;
      }).join('');

    } catch (err) {
      console.warn('Reception refresh error:', err);
    }
  }

  window.handleReceptionAssignDoctor = async function (appointmentId, doctorId) {
    try {
      await api.assignDoctor(appointmentId, doctorId ? parseInt(doctorId, 10) : null);
      showToast('Doctor assignment updated', 'success');
      refreshReceptionTable();
    } catch (e) {
      showToast(e.message || 'Failed to assign doctor', 'error');
    }
  };

  window.handleReceptionCallIn = async function (appointmentId, tokenNumber) {
    try {
      playSound('chime');
      await api.updateQueueStatus(appointmentId, 'in_consultation');
      showToast(`Token ${tokenNumber} called into consultation cabin!`, 'success');
      refreshReceptionTable();
    } catch (e) {
      showToast(e.message || 'Error calling patient', 'error');
    }
  };

  // -------------------------------------------------------------
  // 4. DOCTOR PORTAL (/doctor)
  // Dedicated Login + Dedicated Workspace
  // -------------------------------------------------------------
  async function initDoctorPortal() {
    await fetchDoctorsRoster();

    // Check existing doctor session
    const savedDoc = sessionStorage.getItem('authenticatedDoctor');
    if (savedDoc) {
      try {
        currentDoctorUser = JSON.parse(savedDoc);
      } catch (e) {
        currentDoctorUser = null;
      }
    }

    if (currentDoctorUser) {
      renderDoctorWorkspace();
    } else {
      renderDoctorLoginScreen();
    }

    // Attach Doctor Login form
    const loginForm = document.getElementById('doctorLoginForm');
    if (loginForm) {
      loginForm.onsubmit = handleDoctorLoginSubmit;
    }

    // Attach Doctor Logout button
    const btnLogout = document.getElementById('btnDoctorLogout');
    if (btnLogout) {
      btnLogout.onclick = () => {
        sessionStorage.removeItem('authenticatedDoctor');
        currentDoctorUser = null;
        renderDoctorLoginScreen();
        showToast('Signed out of Physician Workspace');
      };
    }

    // Attach Doctor Refresh button
    const btnDocRefresh = document.getElementById('btnDocQueueRefresh');
    if (btnDocRefresh) {
      btnDocRefresh.onclick = () => {
        refreshDoctorWorkspace();
        showToast('Queue refreshed');
      };
    }

    // Polling fallback
    setInterval(() => {
      if (window.location.pathname.startsWith('/doctor') && currentDoctorUser) {
        refreshDoctorWorkspace();
      }
    }, 4500);
  }

  function renderDoctorLoginScreen() {
    document.getElementById('doctorLoginView').style.display = 'block';
    document.getElementById('doctorWorkspaceView').style.display = 'none';

    const select = document.getElementById('selectDoctorRoster');
    if (select) {
      select.innerHTML = '<option value="">-- Choose Your Physician Profile --</option>';
      doctorsList.forEach(doc => {
        const opt = document.createElement('option');
        opt.value = doc.id;
        opt.textContent = `${doc.name} — ${doc.specialty} (${doc.cabinNumber})`;
        select.appendChild(opt);
      });
    }
  }

  async function handleDoctorLoginSubmit(e) {
    e.preventDefault();
    const select = document.getElementById('selectDoctorRoster');
    const pwdInput = document.getElementById('doctorPasswordInput');

    const doctorId = select.value;
    const password = pwdInput.value;

    if (!doctorId) {
      showToast('Please select your physician name from the roster.', 'error');
      return;
    }

    try {
      const res = await api.doctorLogin(doctorId, password);
      currentDoctorUser = res.doctor;
      sessionStorage.setItem('authenticatedDoctor', JSON.stringify(res.doctor));

      showToast(`Authenticated as ${currentDoctorUser.name}`, 'success');
      renderDoctorWorkspace();
    } catch (err) {
      showToast(err.message || 'Login failed', 'error');
    }
  }

  function renderDoctorWorkspace() {
    document.getElementById('doctorLoginView').style.display = 'none';
    document.getElementById('doctorWorkspaceView').style.display = 'block';

    document.getElementById('docHeaderName').textContent = currentDoctorUser.name;
    document.getElementById('docHeaderCabin').textContent = `${currentDoctorUser.cabinNumber} • ${currentDoctorUser.specialty}`;

    refreshDoctorWorkspace();
  }

  async function refreshDoctorWorkspace() {
    if (!currentDoctorUser) return;
    try {
      const res = await api.getLiveQueue();
      const allItems = res.data || [];

      // 1. Current active patient in cabin with this doctor
      const activeInCabin = allItems.find(i => i.doctorId === currentDoctorUser.id && i.status === 'in_consultation');
      renderDoctorActiveHero(activeInCabin, allItems);

      // 2. Upcoming patients assigned to this doctor or unassigned emergency red
      const upcoming = allItems.filter(i => {
        if (i.status !== 'waiting') return false;
        if (i.doctorId === currentDoctorUser.id) return true;
        if (!i.doctorId && i.severity === 'red') return true;
        return false;
      });

      renderDoctorUpcomingQueue(upcoming);

    } catch (err) {
      console.warn('Doctor workspace refresh error:', err);
    }
  }

  function renderDoctorActiveHero(item, allItems) {
    const container = document.getElementById('docActivePatientContainer');
    if (!container) return;

    if (!item) {
      const nextInLine = allItems.find(i => (i.doctorId === currentDoctorUser.id || (!i.doctorId && i.severity === 'red')) && i.status === 'waiting');

      container.innerHTML = `
        <div class="active-patient-cabin-card vacant">
          <div style="font-size: 1.2rem; font-weight: 800; color: var(--text-main); margin-bottom: 0.35rem;">
            ${escapeHtml(currentDoctorUser.cabinNumber)} is Currently Available
          </div>
          <p style="font-size: 0.875rem; color: var(--text-subtle); margin-bottom: 1.25rem;">
            ${nextInLine ? `Next waiting patient in priority queue: <strong>${escapeHtml(nextInLine.patient.name)} (${escapeHtml(nextInLine.tokenNumber)})</strong>` : 'No waiting patients currently assigned to your cabin.'}
          </p>
          ${nextInLine ? `
            <button type="button" class="btn-solid-dark btn-solid-green" style="padding: 0.85rem 2rem; font-size: 1rem;" onclick="handleDoctorCallNext('${nextInLine.id}')">
              <span>▶</span>
              <span>Call Next Patient (${escapeHtml(nextInLine.tokenNumber)})</span>
            </button>
          ` : `
            <span style="font-size: 0.85rem; color: var(--text-subtle);">Waiting for receptionist assignment or new patient check-in</span>
          `}
        </div>
      `;
      return;
    }

    const isRed = item.severity === 'red';
    const tagClass = isRed ? 'red' : item.severity === 'yellow' ? 'amber' : 'green';
    const tagLabel = isRed ? 'CRITICAL EMERGENCY' : item.severity === 'yellow' ? 'URGENT' : 'ROUTINE';

    container.innerHTML = `
      <div class="active-patient-cabin-card">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem;">
          <div>
            <span class="status-badge-clean in-consult" style="margin-right: 0.5rem;">Active in Cabin</span>
            <span class="triage-indicator-pill ${tagClass}">${tagLabel}</span>
          </div>
          <span class="token-badge-clean ${isRed ? 'red' : ''}" style="font-size: 1.25rem; padding: 0.35rem 0.85rem;">
            ${escapeHtml(item.tokenNumber)}
          </span>
        </div>

        <div style="font-size: 1.5rem; font-weight: 800; color: var(--text-main); margin-bottom: 0.5rem;">
          ${escapeHtml(item.patient.name)}
        </div>

        <div style="display: flex; flex-wrap: wrap; gap: 1.5rem; font-size: 0.9rem; color: var(--text-muted); margin-bottom: 1.25rem;">
          <div><strong>Age:</strong> ${item.patient.age} yrs</div>
          <div><strong>Contact:</strong> ${escapeHtml(item.patient.phone)}</div>
          <div><strong>Blood:</strong> ${escapeHtml(item.patient.bloodGroup || 'Unknown')}</div>
          ${item.spo2 ? `<div><strong>SpO2:</strong> <span style="color: ${item.spo2 < 90 ? 'var(--urgency-red)' : 'inherit'}; font-weight: 700;">${item.spo2}%</span></div>` : ''}
          ${item.heartRate ? `<div><strong>HR:</strong> ${item.heartRate} bpm</div>` : ''}
          ${item.bloodPressure ? `<div><strong>BP:</strong> ${escapeHtml(item.bloodPressure)}</div>` : ''}
        </div>

        <div style="background: var(--bg-subtle); padding: 1rem 1.25rem; border-radius: 8px; margin-bottom: 1.5rem;">
          <div style="font-size: 0.75rem; text-transform: uppercase; font-weight: 700; color: var(--text-subtle); margin-bottom: 0.25rem;">
            Chief Complaint & Clinical Symptoms:
          </div>
          <div style="font-weight: 600; color: var(--text-main); line-height: 1.4;">
            ${escapeHtml(item.chiefComplaint || 'Clinical evaluation')}
          </div>
          ${item.triageReason ? `
            <div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 0.4rem; padding-top: 0.4rem; border-top: 1px solid var(--border-light);">
              <strong>Triage Assessment:</strong> ${escapeHtml(item.triageReason)}
            </div>
          ` : ''}
        </div>

        <div style="display: flex; justify-content: flex-end;">
          <button type="button" class="btn-solid-dark btn-solid-green" style="padding: 0.75rem 1.75rem; font-size: 0.95rem;" onclick="openDoctorCompleteModal('${item.id}', '${escapeHtml(item.patient.name)}', '${escapeHtml(item.tokenNumber)}')">
            <span>✓</span>
            <span>Complete Visit & Prescribe</span>
          </button>
        </div>
      </div>
    `;
  }

  function renderDoctorUpcomingQueue(upcoming) {
    const tbody = document.getElementById('docQueueTableBody');
    if (!tbody) return;

    if (!upcoming.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" style="text-align: center; padding: 2.5rem; color: var(--text-subtle);">
            <strong>No upcoming patients in your queue.</strong>
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = upcoming.map(item => {
      const isRed = item.severity === 'red';
      const isYellow = item.severity === 'yellow';
      const tagClass = isRed ? 'red' : isYellow ? 'amber' : 'green';
      const tagLabel = isRed ? 'CRITICAL' : isYellow ? 'URGENT' : 'ROUTINE';

      return `
        <tr class="${isRed ? 'row-red-triage' : ''}">
          <td>
            <div style="display: flex; flex-direction: column; gap: 0.35rem; align-items: start;">
              <span class="token-badge-clean ${isRed ? 'red' : isYellow ? 'amber' : ''}">${escapeHtml(item.tokenNumber)}</span>
              <span class="triage-indicator-pill ${tagClass}">${tagLabel}</span>
            </div>
          </td>
          <td>
            <div style="font-weight: 700; color: var(--text-main); font-size: 0.95rem;">
              ${escapeHtml(item.patient.name)}
            </div>
            <div style="font-size: 0.8rem; color: var(--text-subtle);">
              Age: ${item.patient.age}y • Blood: ${escapeHtml(item.patient.bloodGroup || 'UNK')}
            </div>
          </td>
          <td>
            <div style="font-size: 0.875rem; color: var(--text-main);">
              ${escapeHtml(item.chiefComplaint || 'Clinical evaluation')}
            </div>
          </td>
          <td>
            <div class="num" style="font-weight: 700;">
              ${item.calculatedWaitMinutes <= 0 ? '<span style="color: var(--urgency-red);">Immediate</span>' : `~${item.calculatedWaitMinutes}m`}
            </div>
            <div style="font-size: 0.75rem; color: var(--text-subtle);">Wait: ${item.elapsedWaitMinutes}m</div>
          </td>
          <td style="text-align: right;">
            <button type="button" class="btn-solid-dark" style="padding: 0.45rem 1rem; font-size: 0.8rem;" onclick="handleDoctorCallNext('${item.id}')">
              <span>▶ Call In</span>
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }

  window.handleDoctorCallNext = async function (appointmentId) {
    if (!currentDoctorUser) return;
    try {
      const res = await api.doctorCallNext(currentDoctorUser.id, appointmentId);
      playSound('chime');
      showToast(`Calling ${res.data.patientName} (${res.data.tokenNumber}) to ${currentDoctorUser.cabinNumber}!`, 'success');
      refreshDoctorWorkspace();
    } catch (e) {
      showToast(e.message || 'Error calling patient', 'error');
    }
  };

  // Doctor Complete Visit Modal
  let activeCompletingId = null;

  window.openDoctorCompleteModal = function (id, patientName, tokenNumber) {
    activeCompletingId = id;
    document.getElementById('modalDocPatientName').textContent = patientName;
    document.getElementById('modalDocToken').textContent = tokenNumber;
    document.getElementById('modalInputDiagnosis').value = '';
    document.getElementById('modalInputPrescription').value = '';
    document.getElementById('modalInputAdvice').value = '';
    document.getElementById('modalDoctorComplete').classList.remove('hidden');
  };

  function closeDoctorCompleteModal() {
    document.getElementById('modalDoctorComplete').classList.add('hidden');
    activeCompletingId = null;
  }

  const btnCloseDocModal = document.getElementById('btnCloseDocCompleteModal');
  const btnCancelDocModal = document.getElementById('btnCancelDocComplete');
  const btnConfirmDocModal = document.getElementById('btnConfirmDocComplete');

  if (btnCloseDocModal) btnCloseDocModal.onclick = closeDoctorCompleteModal;
  if (btnCancelDocModal) btnCancelDocModal.onclick = closeDoctorCompleteModal;

  if (btnConfirmDocModal) {
    btnConfirmDocModal.onclick = async () => {
      if (!activeCompletingId) return;

      const diagnosis = document.getElementById('modalInputDiagnosis').value.trim();
      const prescriptionNotes = document.getElementById('modalInputPrescription').value.trim();
      const advice = document.getElementById('modalInputAdvice').value.trim();

      if (!diagnosis && !prescriptionNotes) {
        showToast('Please enter a clinical diagnosis or prescription note.', 'error');
        return;
      }

      try {
        btnConfirmDocModal.disabled = true;
        await api.updateQueueStatus(activeCompletingId, 'completed', {
          diagnosis,
          prescriptionNotes,
          advice,
        });

        showToast('Consultation marked completed and clinical record saved permanently!', 'success');
        closeDoctorCompleteModal();
        refreshDoctorWorkspace();
      } catch (err) {
        showToast(err.message || 'Failed to complete visit', 'error');
      } finally {
        btnConfirmDocModal.disabled = false;
      }
    };
  }

  // Phase 3: Doctor Print / Save PDF Slip
  const btnPrintDocSlip = document.getElementById('btnPrintDocRxSlip');
  if (btnPrintDocSlip) {
    btnPrintDocSlip.onclick = () => {
      const patientName = document.getElementById('modalDocPatientName').textContent;
      const tokenNumber = document.getElementById('modalDocToken').textContent;
      const diagnosis = document.getElementById('modalInputDiagnosis').value.trim();
      const prescriptionNotes = document.getElementById('modalInputPrescription').value.trim();
      const advice = document.getElementById('modalInputAdvice').value.trim();

      printPrescriptionSlip({
        tokenNumber,
        date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }),
        doctorName: currentDoctorUser ? currentDoctorUser.name : 'Attending Physician, MD',
        doctorSpecialty: currentDoctorUser ? currentDoctorUser.specialty : 'Clinical Medicine',
        cabinNumber: currentDoctorUser ? currentDoctorUser.cabinNumber : 'Consultation Cabin',
        patientName: patientName || 'Patient',
        patientAge: '--',
        patientBlood: 'Recorded',
        patientPhone: 'Confidential',
        emergencyContact: 'On File',
        diagnosis: diagnosis || 'Clinical Outpatient Consultation',
        prescriptionNotes: prescriptionNotes || 'Pending clinical digital prescription entry.',
        advice: advice || 'Follow physician guidance.',
      });
    };
  }

  // -------------------------------------------------------------
  // 5. PATIENT PORTAL (/patient)
  // Clean Check-in, Emergency Triage, Live Token & Records History
  // -------------------------------------------------------------
  function initPatientPortal() {
    // Navigation inside Patient Portal: Check-in vs Records History
    const btnNavCheckin = document.getElementById('ptNavCheckin');
    const btnNavHistory = document.getElementById('ptNavHistory');
    const secCheckin = document.getElementById('ptCheckinSection');
    const secHistory = document.getElementById('ptHistorySection');

    btnNavCheckin.onclick = () => {
      btnNavCheckin.classList.add('active');
      btnNavHistory.classList.remove('active');
      secCheckin.style.display = 'block';
      secHistory.style.display = 'none';
    };

    btnNavHistory.onclick = () => {
      btnNavHistory.classList.add('active');
      btnNavCheckin.classList.remove('active');
      secCheckin.style.display = 'none';
      secHistory.style.display = 'block';
      renderPatientHistoryView();
    };

    // Emergency Check-in trigger banner
    const btnTriggerEmerg = document.getElementById('btnTriggerEmergencyMode');
    if (btnTriggerEmerg) {
      btnTriggerEmerg.onclick = () => {
        document.getElementById('ptFormTitle').textContent = '🚨 Emergency Priority Triage Check-in';
        document.getElementById('ptFormSubtitle').textContent = 'Critical and life-threatening symptoms are given immediate priority bay override.';
        document.getElementById('ptFormSubtitle').style.color = 'var(--urgency-red)';
        const emergBox = document.getElementById('emergencyFlagsContainer');
        if (emergBox) emergBox.style.display = 'block';
        document.getElementById('btnPtSubmitCheckin').style.background = 'var(--urgency-red)';
        document.getElementById('btnPtSubmitCheckin').innerHTML = '<span>🚨 Dispatch Priority Emergency Token</span>';
        showToast('Emergency priority intake active. Enter name and age.');
      };
    }

    const btnCancelEmerg = document.getElementById('btnCancelEmergencyMode');
    if (btnCancelEmerg) {
      btnCancelEmerg.onclick = () => {
        document.getElementById('ptFormTitle').textContent = 'Outpatient Consultation Check-in';
        document.getElementById('ptFormSubtitle').textContent = 'Please enter your details to receive an incremental queue token.';
        document.getElementById('ptFormSubtitle').style.color = 'var(--text-subtle)';
        const emergBox = document.getElementById('emergencyFlagsContainer');
        if (emergBox) emergBox.style.display = 'none';
        document.getElementById('btnPtSubmitCheckin').style.background = 'var(--slate-dark)';
        document.getElementById('btnPtSubmitCheckin').innerHTML = '<span>Complete Check-in & Get Token</span>';
        showToast('Switched back to Outpatient Routine Check-in.');
      };
    }

    // Symptom quick-select suggestion chips
    const chipsContainer = document.getElementById('ptSymptomChips');
    const symptomsInput = document.getElementById('ptInputSymptoms');

    // Phase 3: Smart Triage / Symptom Rule-Based Suggestion
    const smartCard = document.getElementById('smartTriageAlertCard');
    const btnActivateSmart = document.getElementById('btnActivateSmartEmergency');
    const RED_FLAG_REGEX = /\b(chest\s*pain|shortness\s*of\s*breath|breath|unconscious|heavy\s*bleeding|bleeding|crushing|hypoxia|seizure|stroke|cyanosis|cardiac|heart\s*attack|severe\s*headache|anaphylaxis|trauma|fracture|arrhythmia)\b/i;

    function evaluateSmartTriage() {
      if (!smartCard || !symptomsInput) return;
      const isEmergMode = document.getElementById('emergencyFlagsContainer') && document.getElementById('emergencyFlagsContainer').style.display === 'block';
      if (isEmergMode) {
        smartCard.style.display = 'none';
        return;
      }
      const text = symptomsInput.value.trim();
      if (RED_FLAG_REGEX.test(text)) {
        smartCard.style.display = 'block';
      } else {
        smartCard.style.display = 'none';
      }
    }

    if (symptomsInput) {
      symptomsInput.addEventListener('input', evaluateSmartTriage);
    }

    if (btnActivateSmart) {
      btnActivateSmart.onclick = () => {
        if (btnTriggerEmerg) btnTriggerEmerg.click();
        if (smartCard) smartCard.style.display = 'none';
      };
    }

    if (chipsContainer && symptomsInput) {
      chipsContainer.addEventListener('click', (e) => {
        const chip = e.target.closest('.chip-suggestion-item');
        if (chip) {
          const text = chip.getAttribute('data-text');
          if (symptomsInput.value.trim().length > 0) {
            symptomsInput.value += `, ${text}`;
          } else {
            symptomsInput.value = text;
          }
          evaluateSmartTriage();
          showToast(`Added: ${chip.textContent}`);
        }
      });
    }

    // Patient Intake Form submission
    const intakeForm = document.getElementById('ptIntakeForm');
    if (intakeForm) {
      intakeForm.onsubmit = handlePatientIntakeSubmit;
    }

    // Check In Another Patient button
    const btnResetCheckin = document.getElementById('btnPtResetToCheckin');
    if (btnResetCheckin) {
      btnResetCheckin.onclick = () => {
        sessionStorage.removeItem('activePatientToken');
        activePatientToken = null;
        intakeForm.reset();
        document.getElementById('ptRegistrationFormCard').style.display = 'block';
        document.getElementById('ptDigitalTokenCard').style.display = 'none';
        document.getElementById('ptFormTitle').textContent = 'Outpatient Consultation Check-in';
        document.getElementById('ptFormSubtitle').textContent = 'Please enter your details to receive an incremental queue token.';
        document.getElementById('ptFormSubtitle').style.color = 'var(--text-subtle)';
        document.getElementById('btnPtSubmitCheckin').style.background = 'var(--slate-dark)';
        document.getElementById('btnPtSubmitCheckin').innerHTML = '<span>Complete Check-in & Get Token</span>';
        document.getElementById('emergencyFlagsContainer').style.display = 'none';
      };
    }

    // Patient Phone Login form
    const phoneAuthForm = document.getElementById('ptPhoneAuthForm');
    if (phoneAuthForm) {
      phoneAuthForm.onsubmit = handlePatientPhoneAuthSubmit;
    }

    // Patient Sign Out button
    const btnPtLogout = document.getElementById('btnPtLogout');
    if (btnPtLogout) {
      btnPtLogout.onclick = () => {
        currentPatientUser = null;
        sessionStorage.removeItem('authenticatedPatient');
        document.getElementById('ptHistoryLoginForm').style.display = 'block';
        document.getElementById('ptRecordsDisplay').style.display = 'none';
        showToast('Signed out of medical records');
      };
    }

    // Book Follow-up Consultation button
    const btnFollowup = document.getElementById('btnPtBookFollowup');
    if (btnFollowup) {
      btnFollowup.onclick = () => {
        if (!currentPatientUser) return;
        btnNavCheckin.click();
        document.getElementById('ptInputName').value = currentPatientUser.name;
        document.getElementById('ptInputPhone').value = currentPatientUser.phone;
        document.getElementById('ptInputAge').value = currentPatientUser.age;
        document.getElementById('ptInputSymptoms').value = 'Scheduled routine follow-up consultation';
        showToast('Follow-up details pre-filled. Click Complete Check-in.');
      };
    }

    // Cabin Call Acknowledge button
    const btnAckCall = document.getElementById('btnAcknowledgeCabinCall');
    if (btnAckCall) {
      btnAckCall.onclick = () => {
        document.getElementById('ptCabinCallOverlay').style.display = 'none';
      };
    }

    // Check if active digital token exists in session
    const savedToken = sessionStorage.getItem('activePatientToken');
    if (savedToken) {
      activePatientToken = savedToken;
      refreshPatientDigitalToken();
    }
  }

  async function handlePatientIntakeSubmit(e) {
    e.preventDefault();

    const name = document.getElementById('ptInputName').value.trim();
    const phone = document.getElementById('ptInputPhone').value.trim();
    const age = parseInt(document.getElementById('ptInputAge').value, 10);
    const symptoms = document.getElementById('ptInputSymptoms').value.trim();

    if (!name || isNaN(age)) {
      showToast('Please enter your full legal name and age.', 'error');
      return;
    }

    const emergBox = document.getElementById('emergencyFlagsContainer');
    const isEmergency = emergBox && emergBox.style.display === 'block';

    if (!isEmergency && (!phone || phone.length < 5)) {
      showToast('Please enter a valid contact phone number for routine check-in.', 'error');
      return;
    }

    try {
      const btnSubmit = document.getElementById('btnPtSubmitCheckin');
      btnSubmit.disabled = true;

      let result;
      if (isEmergency) {
        result = await api.intakeEmergency({
          name,
          phone: phone || 'EMERGENCY_WALKIN',
          age,
          chiefComplaint: symptoms || 'Acute emergency triage presentation',
          symptoms: ['severe_chest_pain'],
        });
      } else {
        result = await api.bookRoutine({
          name,
          phone,
          age,
          chiefComplaint: symptoms || 'Routine consultation check-in',
        });
      }

      const tokenNumber = result.data.tokenNumber;
      activePatientToken = tokenNumber;
      sessionStorage.setItem('activePatientToken', tokenNumber);

      showToast(`Check-in complete! Assigned Token: ${tokenNumber}`, 'success');
      renderDigitalTokenCard(result.data);

    } catch (err) {
      showToast(err.message || 'Check-in failed', 'error');
    } finally {
      document.getElementById('btnPtSubmitCheckin').disabled = false;
    }
  }

  function renderDigitalTokenCard(data) {
    document.getElementById('ptRegistrationFormCard').style.display = 'none';
    document.getElementById('ptDigitalTokenCard').style.display = 'block';

    const isRed = data.severity === 'red';
    const heroNum = document.getElementById('ptHeroTokenNumber');
    heroNum.textContent = data.tokenNumber;
    heroNum.className = `digital-token-hero num ${isRed ? 'red' : ''}`;

    document.getElementById('ptHeroQueuePos').textContent = data.queuePosition ? `#${data.queuePosition} in Line` : 'Next';
    document.getElementById('ptHeroWaitTime').textContent = data.estimatedWaitMinutes <= 0 ? 'Immediate Attention' : `~${data.estimatedWaitMinutes} mins`;
    document.getElementById('ptHeroDocName').textContent = data.doctor ? data.doctor.name : 'Assigned in Triage';
    document.getElementById('ptHeroCabinName').textContent = data.doctor ? data.doctor.cabinNumber : 'Resuscitation Bay';

    const statusBanner = document.getElementById('ptHeroStatusBanner');
    const statusText = document.getElementById('ptHeroStatusText');
    statusBanner.style.background = 'var(--bg-subtle)';
    statusBanner.style.color = 'var(--text-muted)';
    statusText.textContent = 'Waiting for Physician Cabin Call';
  }

  async function refreshPatientDigitalToken() {
    const savedToken = activePatientToken || sessionStorage.getItem('activePatientToken');
    if (!savedToken) return;

    try {
      const res = await api.getTokenStatus(savedToken);
      const data = res.data;

      document.getElementById('ptRegistrationFormCard').style.display = 'none';
      document.getElementById('ptDigitalTokenCard').style.display = 'block';

      const heroNum = document.getElementById('ptHeroTokenNumber');
      heroNum.textContent = data.tokenNumber;
      heroNum.className = `digital-token-hero num ${data.severity === 'red' ? 'red' : ''}`;

      const statusBanner = document.getElementById('ptHeroStatusBanner');
      const statusText = document.getElementById('ptHeroStatusText');

      if (data.status === 'in_consultation') {
        statusBanner.style.background = 'var(--urgency-green-bg)';
        statusBanner.style.color = 'var(--urgency-green)';
        statusText.textContent = `🔔 PLEASE PROCEED TO ${data.doctor ? data.doctor.cabinNumber.toUpperCase() : 'CABIN'}`;
        document.getElementById('ptHeroQueuePos').textContent = 'In Consultation';
        document.getElementById('ptHeroWaitTime').textContent = '0 mins (Your Turn)';
      } else if (data.status === 'completed') {
        statusBanner.style.background = 'var(--bg-subtle)';
        statusBanner.style.color = 'var(--text-muted)';
        statusText.textContent = '✓ Consultation Completed. Thank you.';
        document.getElementById('ptHeroQueuePos').textContent = 'Finished';
        document.getElementById('ptHeroWaitTime').textContent = '0 mins';
      } else {
        statusBanner.style.background = 'var(--bg-subtle)';
        statusBanner.style.color = 'var(--text-muted)';
        statusText.textContent = 'Waiting for Physician Cabin Call';
        document.getElementById('ptHeroQueuePos').textContent = data.queuePosition ? `#${data.queuePosition} in Line` : 'Next';
        document.getElementById('ptHeroWaitTime').textContent = data.estimatedWaitMinutes <= 0 ? 'Immediate' : `~${data.estimatedWaitMinutes} mins`;
      }

      document.getElementById('ptHeroDocName').textContent = data.doctor ? data.doctor.name : 'Assigned in Triage';
      document.getElementById('ptHeroCabinName').textContent = data.doctor ? data.doctor.cabinNumber : 'Resuscitation Bay';

    } catch (e) {
      // Token not found
    }
  }

  function triggerPatientTurnOverlay(doctorName, cabinNumber) {
    const overlay = document.getElementById('ptCabinCallOverlay');
    if (!overlay) return;

    document.getElementById('ptAlertCabinTarget').textContent = cabinNumber || 'Physician Cabin';
    document.getElementById('ptAlertDoctorTarget').textContent = doctorName || 'Attending Physician';
    overlay.style.display = 'flex';
  }

  // Patient Medical Records Phone Authentication
  async function handlePatientPhoneAuthSubmit(e) {
    e.preventDefault();
    const phoneInput = document.getElementById('ptAuthPhoneInput');
    const phone = phoneInput.value.trim();

    if (!phone) {
      showToast('Please enter your registered phone number.', 'error');
      return;
    }

    try {
      const res = await api.patientLogin(phone);
      currentPatientUser = res.patient;
      sessionStorage.setItem('authenticatedPatient', JSON.stringify(res));

      showToast(`Welcome back, ${res.patient.name}`, 'success');
      renderPatientHistoryRecords(res);
    } catch (err) {
      showToast(err.message || 'Phone lookup failed', 'error');
    }
  }

  function renderPatientHistoryView() {
    const saved = sessionStorage.getItem('authenticatedPatient');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        currentPatientUser = parsed.patient;
        renderPatientHistoryRecords(parsed);
        return;
      } catch (e) {}
    }

    document.getElementById('ptHistoryLoginForm').style.display = 'block';
    document.getElementById('ptRecordsDisplay').style.display = 'none';
  }

  let currentPatientUserRecords = null;

  function renderPatientHistoryRecords(data) {
    currentPatientUserRecords = data;
    document.getElementById('ptHistoryLoginForm').style.display = 'none';
    document.getElementById('ptRecordsDisplay').style.display = 'block';

    const pt = data.patient;
    document.getElementById('ptRecordName').textContent = pt.name;
    document.getElementById('ptRecordMeta').textContent = `Age: ${pt.age} yrs • Blood Group: ${pt.bloodGroup || 'O+'} • Phone: ${pt.phone}`;

    const listContainer = document.getElementById('ptHistoryListContainer');
    const history = data.history || [];

    if (!history.length) {
      listContainer.innerHTML = `
        <div style="background: #FFF; border: 1px solid var(--border-light); border-radius: 12px; padding: 2rem; text-align: center; color: var(--text-subtle);">
          No past completed consultations recorded yet.
        </div>
      `;
      return;
    }

    listContainer.innerHTML = history.map(item => {
      const visitDate = new Date(item.createdAt).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });

      return `
        <div class="patient-history-card-item">
          <div class="history-card-header">
            <div>
              <div style="font-weight: 800; font-size: 1rem; color: var(--text-main);">
                ${item.doctor ? escapeHtml(item.doctor.name) : 'Consulting Physician'}
              </div>
              <div style="font-size: 0.8rem; color: var(--text-subtle);">
                ${item.doctor ? escapeHtml(item.doctor.cabinNumber) : 'Cabin'} • ${escapeHtml(item.doctor ? item.doctor.specialty : 'General')}
              </div>
            </div>
            <div style="text-align: right;">
              <span class="token-badge-clean" style="font-size: 0.8rem;">${escapeHtml(item.tokenNumber)}</span>
              <div style="font-size: 0.75rem; color: var(--text-subtle); margin-top: 0.2rem;">${visitDate}</div>
            </div>
          </div>

          <div style="font-size: 0.875rem; color: var(--text-main); margin-bottom: 0.65rem;">
            <strong>Chief Complaint:</strong> ${escapeHtml(item.symptomsSummary || 'Consultation review')}
          </div>

          ${item.diagnosis ? `
            <div style="font-size: 0.875rem; color: var(--status-consult); font-weight: 700; margin-bottom: 0.5rem;">
              ● Diagnosis: ${escapeHtml(item.diagnosis)}
            </div>
          ` : ''}

          ${item.prescriptionNotes ? `
            <div class="rx-box-clinical">
              <strong style="color: var(--text-main);">Digital Prescriptions (Rx):</strong>
              <div style="margin-top: 0.25rem; font-family: ui-monospace, SFMono-Regular, monospace; font-size: 0.825rem; color: var(--text-main); line-height: 1.4;">
                ${escapeHtml(item.prescriptionNotes)}
              </div>
            </div>
          ` : ''}

          ${item.advice ? `
            <div style="font-size: 0.825rem; color: var(--text-muted); margin-top: 0.4rem;">
              <strong>Physician Advice:</strong> ${escapeHtml(item.advice)}
            </div>
          ` : ''}

          <!-- Phase 3: Printable Digital Prescription Slip Action -->
          <div style="display: flex; justify-content: flex-end; margin-top: 0.75rem; padding-top: 0.5rem; border-top: 1px solid var(--border-light);">
            <button type="button" class="btn-outline-clean" style="font-size: 0.75rem; padding: 0.3rem 0.75rem; display: inline-flex; align-items: center; gap: 0.35rem;" onclick="handlePatientDownloadRx('${escapeHtml(item.id)}')">
              <span>🖨️ Download / Print Rx</span>
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  // Phase 3: Patient Download / Print Prescription Slip Handler
  window.handlePatientDownloadRx = function(apptId) {
    if (!currentPatientUser || !currentPatientUserRecords) return;
    const history = currentPatientUserRecords.history || [];
    const item = history.find(h => String(h.id) === String(apptId));
    if (!item) return;

    printPrescriptionSlip({
      tokenNumber: item.tokenNumber,
      date: new Date(item.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }),
      doctorName: item.doctor ? item.doctor.name : 'Attending Physician, MD',
      doctorSpecialty: item.doctor ? item.doctor.specialty : 'Clinical Medicine',
      cabinNumber: item.doctor ? item.doctor.cabinNumber : 'Outpatient Cabin',
      patientName: currentPatientUser.name,
      patientAge: currentPatientUser.age,
      patientBlood: currentPatientUser.bloodGroup || 'Unknown',
      patientPhone: currentPatientUser.phone,
      emergencyContact: currentPatientUser.emergencyContact,
      diagnosis: item.diagnosis || 'Clinical Consultation',
      prescriptionNotes: item.prescriptionNotes || 'Routine consultation completed.',
      advice: item.advice || 'Follow routine clinical recommendations.',
    });
  };

  // Phase 3: Print Prescription Slip Core Engine
  function printPrescriptionSlip(data) {
    const slip = document.getElementById('printableRxSlip');
    if (!slip) return;

    const elToken = document.getElementById('rxPrintToken');
    const elDate = document.getElementById('rxPrintDate');
    const elDocName = document.getElementById('rxPrintDoctorName');
    const elDocSpec = document.getElementById('rxPrintDoctorSpecialty');
    const elDocCabin = document.getElementById('rxPrintDoctorCabin');
    const elPtName = document.getElementById('rxPrintPatientName');
    const elPtMeta = document.getElementById('rxPrintPatientMeta');
    const elPtEmerg = document.getElementById('rxPrintEmergency');
    const elDiag = document.getElementById('rxPrintDiagnosis');
    const elRx = document.getElementById('rxPrintPrescription');
    const elAdvice = document.getElementById('rxPrintAdvice');

    if (elToken) elToken.textContent = `TOKEN: ${data.tokenNumber || 'RX-00'}`;
    if (elDate) elDate.textContent = `Date: ${data.date || new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}`;
    if (elDocName) elDocName.textContent = data.doctorName || 'Dr. Physician, MD';
    if (elDocSpec) elDocSpec.textContent = data.doctorSpecialty || 'General Medicine';
    if (elDocCabin) elDocCabin.textContent = data.cabinNumber || 'Cabin';
    if (elPtName) elPtName.textContent = data.patientName || 'Patient';
    if (elPtMeta) elPtMeta.textContent = `Age: ${data.patientAge || '--'} yrs • Blood: ${data.patientBlood || 'Unknown'} • Phone: ${data.patientPhone || '--'}`;
    if (elPtEmerg) elPtEmerg.textContent = data.emergencyContact ? `Emergency Contact: ${data.emergencyContact}` : 'Emergency Contact: On File';
    if (elDiag) elDiag.textContent = data.diagnosis || 'Clinical Outpatient Consultation';
    if (elRx) elRx.textContent = data.prescriptionNotes || 'No medication prescribed.';
    if (elAdvice) elAdvice.textContent = data.advice || 'Follow routine outpatient recommendations.';

    window.print();
  }

  // -------------------------------------------------------------
  // Helpers & Initialization
  // -------------------------------------------------------------
  async function fetchDoctorsRoster() {
    try {
      const res = await api.getDoctors();
      doctorsList = res.data || [];
    } catch (e) {
      console.warn('Failed to fetch doctors list:', e);
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Audio initialization on first user interaction
  document.addEventListener('click', () => {
    initAudioContext();
  }, { once: true });

  window.addEventListener('popstate', resolveRoute);

  async function init() {
    initClocks();
    initWebSocketSync();
    resolveRoute();
  }

  init();

})();
