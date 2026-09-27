// public/js/api.js
// Client API Service for PulsePoint Phase 2 Relational System

const API_BASE = '/api';

const api = {
  /**
   * Fetch sorted active queue from MySQL
   */
  async getLiveQueue(params = {}) {
    const query = new URLSearchParams();
    if (params.doctorId) query.append('doctorId', params.doctorId);
    if (params.severity) query.append('severity', params.severity);
    if (params.status) query.append('status', params.status);
    if (params.search) query.append('search', params.search);
    if (params.includeCompleted) query.append('includeCompleted', 'true');

    const res = await fetch(`${API_BASE}/queue/live?${query.toString()}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `Failed to fetch queue (${res.status})`);
    }
    return res.json();
  },

  /**
   * Fetch live KPI stats from MySQL
   */
  async getStats() {
    const res = await fetch(`${API_BASE}/queue/stats`);
    if (!res.ok) throw new Error('Failed to fetch stats');
    return res.json();
  },

  /**
   * Fetch all doctors with caseload
   */
  async getDoctors() {
    const res = await fetch(`${API_BASE}/doctors`);
    if (!res.ok) throw new Error('Failed to fetch doctors list');
    return res.json();
  },

  /**
   * Book standard routine appointment
   */
  async bookRoutine(data) {
    const res = await fetch(`${API_BASE}/appointments/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const result = await res.json();
    if (!res.ok || !result.success) {
      throw new Error(result.message || (result.errors && result.errors[0]) || 'Booking failed');
    }
    return result;
  },

  /**
   * Submit priority emergency triage intake
   */
  async intakeEmergency(data) {
    const res = await fetch(`${API_BASE}/emergency/intake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const result = await res.json();
    if (!res.ok || !result.success) {
      throw new Error(result.message || (result.errors && result.errors[0]) || 'Emergency intake failed');
    }
    return result;
  },

  /**
   * Update queue status (e.g. 'in_consultation', 'completed', 'cancelled')
   * Supports optional prescriptionNotes and doctorId
   */
  async updateQueueStatus(id, status, extra = {}) {
    const res = await fetch(`${API_BASE}/queue/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, ...extra }),
    });
    const result = await res.json();
    if (!res.ok || !result.success) {
      throw new Error(result.message || 'Status update failed');
    }
    return result;
  },

  /**
   * Assign or reassign doctor directly from Reception Desk
   */
  async assignDoctor(id, doctorId) {
    const res = await fetch(`${API_BASE}/queue/${id}/assign`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ doctorId }),
    });
    const result = await res.json();
    if (!res.ok || !result.success) {
      throw new Error(result.message || 'Doctor assignment failed');
    }
    return result;
  },

  /**
   * Fetch token status and live queue position for Patient Portal
   */
  async getTokenStatus(tokenNumber) {
    const res = await fetch(`${API_BASE}/queue/token/${encodeURIComponent(tokenNumber)}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || 'Token not found');
    }
    return res.json();
  },

  /**
   * Doctor Login (verifies ID and password)
   */
  async doctorLogin(doctorId, password) {
    const res = await fetch(`${API_BASE}/doctor/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ doctorId, password }),
    });
    const result = await res.json();
    if (!res.ok || !result.success) {
      throw new Error(result.message || 'Authentication failed');
    }
    return result;
  },

  /**
   * Patient Login by Registered Phone
   */
  async patientLogin(phone) {
    const res = await fetch(`${API_BASE}/patient/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone }),
    });
    const result = await res.json();
    if (!res.ok || !result.success) {
      throw new Error(result.message || 'Patient record lookup failed');
    }
    return result;
  },

  /**
   * Doctor Call Next Patient (broadcasts audio/visual alarm to patient and reception)
   */
  async doctorCallNext(doctorId, appointmentId = null) {
    const res = await fetch(`${API_BASE}/doctor/call-next`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ doctorId, appointmentId }),
    });
    const result = await res.json();
    if (!res.ok || !result.success) {
      throw new Error(result.message || 'Failed to call patient');
    }
    return result;
  },

  /**
   * Reset database to default clinical seed data for live demo
   */
  async resetQueue() {
    const res = await fetch(`${API_BASE}/queue/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    return res.json();
  },
};

window.api = api;
