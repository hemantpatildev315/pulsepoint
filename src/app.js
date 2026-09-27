// src/app.js
const express = require('express');
const cors = require('cors');
const path = require('path');

const appointmentsRoutes = require('./routes/appointments');
const emergencyRoutes = require('./routes/emergency');
const queueRoutes = require('./routes/queue');
const doctorsRoutes = require('./routes/doctors');
const authRoutes = require('./routes/auth');

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve frontend static assets
app.use(express.static(path.join(__dirname, '../public')));

// API Routes
app.use('/api/appointments', appointmentsRoutes);
app.use('/api/emergency', emergencyRoutes);
app.use('/api/queue', queueRoutes);
app.use('/api/doctors', doctorsRoutes);
app.use('/api', authRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    system: 'Clinic Appointment, Patient & Emergency Management System',
    version: '1.0.0-phase1',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// Fallback for SPA-style client routing or 404
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({
      success: false,
      message: `API Route ${req.method} ${req.path} not found`,
    });
  }
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Central Error Handler
app.use((err, req, res, next) => {
  console.error('Unhandled Server Error:', err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error',
  });
});

module.exports = app;
