# PulsePoint Clinical Desk — Phase 2 Refined
## Dedicated Consoles, Authentication Flows, Role Isolation & Clinical Records
### MySQL / MariaDB Relational Architecture (cPanel & phpMyAdmin Ready)

A clean, minimalist, high-contrast clinical triage, patient intake, and physician consultation system built for hospital and ambulatory clinic environments with **strict role isolation**, **dedicated authentication screens**, **Web Audio API alarms**, and **complete patient clinical histories**.

---

## 🔒 1. Strict Route Isolation & Navbar Cleanup

Cross-role navigation switchers have been completely eliminated. Each role operates exclusively within its dedicated path:

```
                          ┌─────────────────────────────┐
                          │   Workstation Hub ('/')     │
                          │   Selection Directory       │
                          └──────┬───────┬───────┬──────┘
                                 │       │       │
                 ┌───────────────┘       │       └───────────────┐
                 ▼                       ▼                       ▼
    ┌─────────────────────────┐  ┌─────────────────────────┐  ┌─────────────────────────┐
    │ Reception Desk          │  │ Doctor Portal           │  │ Patient Portal          │
    │ /reception              │  │ /doctor                 │  │ /patient                │
    │ No Doctor/Patient tabs  │  │ Authentication Screen   │  │ Dual-Action Landing     │
    │ Real-time Call Sync     │  │ Cabin-Only Workspace    │  │ Medical Record History  │
    │ Desk Melodic Chime      │  │ Next Patient Alarm      │  │ Turn Beeping Alarm      │
    └─────────────────────────┘  └─────────────────────────┘  └─────────────────────────┘
```

---

## 🩺 2. Doctor Portal & Workspace (`/doctor`)

- **Dedicated Authentication Screen**:
  - Open dropdown role-switching has been removed.
  - Physicians authenticate via roster selection or Physician ID + password.
  - **Demo Password**: `doctor123` (Visible hint card on login view: *Demo Access: Select 'Dr. Priya Patel' or 'Dr. Marcus Thorne' | Password: doctor123*).
- **Authenticated Cabin Console**:
  - Displays exclusively the logged-in doctor's assigned patients, cabin number, and active consultation.
  - **"Call Next Patient"**:
    - Triggers an audible beeping alarm and high-visibility visual overlay on the patient's screen (`/patient`).
    - Pings the Reception Desk (`/reception`) with an audio chime and toast notice.
  - **"Complete Visit" Clinical Modal**:
    - Captures primary clinical diagnosis, digital prescriptions (Rx), and physician advice.
    - Saves directly into MySQL (`appointments_queue.diagnosis`, `appointments_queue.prescription_notes`, `appointments_queue.advice`) and appends permanently to `patients.medical_notes`.
  - **Sign Out**: Returns the physician securely to the doctor login screen.

---

## 📱 3. Patient Portal (`/patient`)

- **Dual-Action Landing**:
  - **Primary Emergency Check-In**: Prominent emergency banner for acute presentations (chest pain, trauma, acute hypoxia) bypassing routine intake.
  - **Routine Booking**: Clean manual input fields for Name, Phone, and Age.
    - **Personal fields start completely empty** (no prefilled identity).
    - **Symptom suggestion chips**: Clickable chips (Chest Pain, Shortness of Breath, High Fever, Severe Migraine, Abdominal Pain, Suspected Fracture, Routine Blood Pressure, Annual Physical) that append directly into the complaint box.
- **Patient Login / Medical Records Access**:
  - "Patient Login / View History" subnav.
  - Authentication via registered phone number (**Demo Phone: `9876543210` - Alexander Wright**).
  - Displays full clinical history timeline:
    - Past visit dates & consulting physician names/cabins.
    - Chief complaints & primary clinical diagnoses.
    - Digital prescriptions (Rx) formatted in clean clinical monospace font.
    - Physician advice notes.
    - **"Book Follow-Up"** action button to schedule routine review with their physician.
- **Live Digital Token & Call Alarm System**:
  - Real-time queue position and estimated wait time display.
  - When called by doctor or reception:
    1. Plays synthesized audio alarm via browser Web Audio API.
    2. Displays high-visibility modal overlay: **"YOUR TURN! Please proceed to Cabin [Cabin Number / Doctor Name]"**.

---

## 📋 4. Reception Desk Refinements (`/reception`)

- Removed "Reset Demo Data" and testing mock widgets.
- **Real-Time Doctor Call Sync**:
  - When any physician clicks "Call Next Patient", Reception Desk instantly receives a WebSocket update.
  - Melodic desk chime sounds and a notification toast displays: e.g. `Dr. Priya Patel (Cabin 104) is calling...`.
- Triage priority sorted view: **Code Red emergency pinned at the top ➔ Urgent Amber ➔ Routine Green (FIFO)**.
- Live in-row physician reassignment.

---

## 🔊 5. Audio Synthesis & State Sync

- **Web Audio API**:
  - Melodic Desk Chime: Sine wave oscillators ($A_5 \to E_5$) for reception call alerts.
  - Urgent Turn Alarm: Multi-beep triangle oscillator sequence for patient turn notifications.
  - Completely zero-dependency: requires no external audio file hosting or MP3 downloads.
- **State Synchronization**:
  - Bidirectional WebSockets (`ws://localhost:3000`) broadcast `DOCTOR_CALLED_PATIENT` and `QUEUE_UPDATED` events across all open browser tabs.
  - Automatic 4.5-second polling fallback ensures uninterrupted synchronization.

---

## 🔄 Real-Time WebSocket Synchronization

- Built with native `ws` WebSocket broadcast attached to the HTTP server (`ws://localhost:3000`).
- Any state change (patient check-in at `/patient`, doctor assignment at `/reception`, patient call-in or visit completion at `/doctor`) broadcasts a `QUEUE_UPDATED` event to all open browser windows.
- All consoles update immediately with **zero latency** and **no page reload required**.
- Includes a 4-second short-polling fallback for 100% network resilience.

---

## 🗄️ Relational MySQL / MariaDB Database Architecture

Operates on relational MySQL / MariaDB via connection pooling (`mysql2/promise`) using standard parameterized queries.

### Core Tables:
Import script located at [`schemas/cpanel_phpmyadmin_schema.sql`](file:///c:/Users/Om/Desktop/clinic/schemas/cpanel_phpmyadmin_schema.sql).

- `patients` (`id`, `full_name`, `phone`, `age`, `blood_group`, `emergency_contact`, `medical_notes`, `created_at`)
- `doctors` (`id`, `full_name`, `specialty`, `cabin_number`, `is_available`)
- `appointments_queue` (`id`, `patient_id`, `doctor_id`, `token_number`, `type`, `severity`, `priority_score`, `status`, `symptoms_summary`, `prescription_notes`, `estimated_wait_minutes`, `created_at`, `updated_at`)

### Priority Sorting Query:
```sql
SELECT 
  aq.*, 
  p.full_name AS patient_name, p.phone AS patient_phone, p.age AS patient_age, p.blood_group AS patient_blood_group,
  d.full_name AS doctor_name, d.specialty AS doctor_specialty, d.cabin_number AS doctor_cabin_number
FROM appointments_queue aq
JOIN patients p ON aq.patient_id = p.id
LEFT JOIN doctors d ON aq.doctor_id = d.id
WHERE aq.status IN ('waiting', 'in_consultation')
ORDER BY aq.status = 'waiting' DESC, aq.priority_score ASC, aq.created_at ASC;
```

---

## 🚀 REST API Reference (Phase 2)

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/appointments/book` | Books standard routine visit, generates `RT-XXX` token, sets `priority_score = 3`, broadcasts event. |
| `POST` | `/api/emergency/intake` | Instant priority override, auto-tags severity (`red`/`yellow`), sets `priority_score = 1` or `2`, generates `EM-XXX`, broadcasts event. |
| `GET` | `/api/queue/live` | Fetches active queue ordered by: `ORDER BY status = 'waiting' DESC, priority_score ASC, created_at ASC`. |
| `GET` | `/api/queue/patient-status` | Lightweight endpoint for Vercel/serverless 2s short polling (`tokenNumber` or `patientId`). Returns status, cabinNumber, doctorName, isCalled, calledAt. |
| `GET` | `/api/queue/token/:tokenNumber` | Real-time status, live queue rank, and cabin call instructions for a specific patient token. |
| `PATCH` | `/api/queue/:id/status` | Updates status (`'waiting'` ➔ `'in_consultation'` ➔ `'completed'`), saves `prescription_notes`, broadcasts event. |
| `PATCH` | `/api/queue/:id/assign` | Assigns / reassigns doctor from Reception Desk dropdown, broadcasts event. |
| `GET` | `/api/doctors` | Returns all doctors with cabins and current active caseload. |
| `GET` | `/api/queue/stats` | SQL aggregation counters for waiting, critical red, urgent yellow, routine green, and active consultations. |
| `POST` | `/api/queue/reset` | 1-click restore to standard clinical demo state. |

---

## ⚡ Phase 3 Additive Enhancements

1. **Smart Triage / Symptom Rule-Based Suggestion (`/patient`)**:
   - Real-time client-side keyword and regex evaluation on the Chief Complaint field and suggestion chips.
   - Detects critical presentations: *chest pain, shortness of breath, unconsciousness, heavy bleeding, stroke, seizure, hypoxia, acute trauma*.
   - Displays clean inline alert card: **"Automated Triage Tag: Code Red (Critical Emergency) | Recommended Bay: Emergency Care"** with a 1-click **"Switch to Emergency Intake ➔"** action that dispatches with `priority_score = 1`.

2. **Printable Digital Prescription Slip (`/doctor` & `/patient`)**:
   - **Doctor Console**: Direct **"Print / Save PDF"** button in the "Complete Consultation" modal.
   - **Patient Portal**: **"Download / Print Rx"** button on each past completed clinical record.
   - Clean, high-contrast, professional hospital slip layout utilizing standard `@media print` CSS and `window.print()` (zero external dependencies).

3. **Emergency Bay & Resource Indicator (`/reception`)**:
   - Status bar across the top of the Reception Desk: **"Emergency Bays: [X/4 Available]"** | **"ICU Status: Operational (Level 1 Trauma Ready)"**.
   - Dynamically decrements available bays as active Code Red patients enter the queue.

4. **Vercel & Serverless Resilient Polling & Mobile Audio Unlocking**:
   - Replaced WebSocket dependency on serverless environments with a dedicated **2-second database-driven short-polling loop** (`/api/queue/patient-status`).
   - Automatically detects call transitions (`isCalled: true`), fires the Web Audio alarm, displays the prominent cabin turn modal, and repeats until acknowledged.
   - Primed audio context on touch and interaction events (`click`, `touchstart`, `touchend`, `pointerdown`, `keydown`, `submit`) to prevent mobile browser autoplay blocking.

---

## 💻 Running & Demonstrating

```bash
# 1. Install dependencies
npm install

# 2. Run automated test suites
node test/phase2_auth_test.js # Phase 2 Dedicated Authentication & Role Isolation (26 tests)
node test/phase3_test.js      # Phase 3 Smart Triage, Printable Slip & Bay Indicators (28 tests)
node test/polling_test.js     # Serverless / Vercel Short-Polling & Call Alarm Test (16 tests)

# 3. Start the application
npm start
# Server running at: http://localhost:3000
```

### Try the 3 Isolated Consoles:
1. **Reception Desk**: [http://localhost:3000/reception](http://localhost:3000/reception)
2. **Doctor Console**: [http://localhost:3000/doctor](http://localhost:3000/doctor)
3. **Patient Portal**: [http://localhost:3000/patient](http://localhost:3000/patient)
