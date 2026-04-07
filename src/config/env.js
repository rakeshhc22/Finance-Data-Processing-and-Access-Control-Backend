// =============================================================================
// src/config/env.js
//
// Purpose : Load, validate, and export environment variables.
//           This module runs its validation the moment it is imported.
//           If any required variable is missing, the process exits immediately
//           with a clear diagnostic message — before any server logic starts.
//
// Exports : Plain object with all validated env values.
//           All other modules import from here rather than reading process.env
//           directly, so every env access is typed and documented in one place.
// =============================================================================

"use strict";

const path = require("path");

// Load .env file into process.env (safe to call multiple times — no-op if
// the variable is already set, so production env vars are never overwritten).
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

// =============================================================================
// REQUIRED VARIABLES
// If any of these are missing the process will exit with a descriptive error.
// =============================================================================

const REQUIRED = [
    "DATABASE_URL",
    "JWT_SECRET",
    "JWT_REFRESH_SECRET",
];

const missing = REQUIRED.filter((key) => !process.env[key]);

if (missing.length > 0) {
    console.error("\n  ✗ Missing required environment variables:");
    missing.forEach((key) => console.error(`      - ${key}`));
    console.error("\n  Copy .env.example to .env and fill in the values.\n");
    process.exit(1);
}

// =============================================================================
// EXPORT — with sensible defaults for optional variables
// =============================================================================

module.exports = Object.freeze({
    // ── Server ───────────────────────────────────────────────────────────────
    PORT: parseInt(process.env.PORT ?? "5000", 10),
    NODE_ENV: process.env.NODE_ENV ?? "development",

    // ── API ──────────────────────────────────────────────────────────────────
    // API_PREFIX is the base path mounted in app.js for all routes.
    // .env sets this to /api — routes become /api/auth, /api/users, etc.
    API_PREFIX: process.env.API_PREFIX ?? "/api",

    // ── CORS ─────────────────────────────────────────────────────────────────
    // Comma-separated list of allowed origins e.g. "http://localhost:3000"
    CORS_ORIGIN: process.env.CORS_ORIGIN ?? "http://localhost:3000",

    // ── Database ─────────────────────────────────────────────────────────────
    DATABASE_URL: process.env.DATABASE_URL,

    // ── JWT ──────────────────────────────────────────────────────────────────
    JWT_SECRET: process.env.JWT_SECRET,
    JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,

    // Access token expiry — short-lived (15 minutes)
    JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN ?? "15m",

    // Refresh token expiry — longer-lived (7 days)
    JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN ?? "7d",
});