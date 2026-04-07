// =============================================================================
// src/middlewares/rateLimit.middleware.js
//
// Purpose : Protect high-value endpoints from brute-force and abuse.
//           Uses express-rate-limit which works with an in-memory store by
//           default (suitable for single-process deployments).
//
// Exports:
//   authLimiter   — strict limiter for /auth/* routes (login, register, refresh)
//   apiLimiter    — general limiter (can be applied globally in app.js if needed)
//
// In a multi-process / clustered deployment, swap the default MemoryStore for
// a shared store such as rate-limit-redis or rate-limit-mongo.
// =============================================================================

"use strict";

const rateLimit = require("express-rate-limit");
const env = require("../config/env");

// =============================================================================
// authLimiter
//
// Applied to: POST /auth/register, POST /auth/login, POST /auth/refresh
//
// Allows 20 requests per 15-minute window per IP address.
// This allows normal usage (retrying a wrong password a few times) while
// blocking automated brute-force attacks.
//
// In production you may want to tighten this further.
// =============================================================================
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20,                   // limit each IP to 20 requests per window
    standardHeaders: true,     // Return rate limit info in `RateLimit-*` headers
    legacyHeaders: false,      // Disable the deprecated `X-RateLimit-*` headers

    // Skip rate limiting in test environment to avoid flaky tests
    skip: () => env.NODE_ENV === "test",

    handler: (_req, res) => {
        res.status(429).json({
            success: false,
            message:
                "Too many requests from this IP address. " +
                "Please wait 15 minutes before trying again.",
        });
    },
});

// =============================================================================
// apiLimiter
//
// General-purpose limiter — can be mounted globally in app.js if needed.
// More permissive than authLimiter since API reads are not security-critical.
// =============================================================================
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 200,                  // 200 requests per window
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => env.NODE_ENV === "test",

    handler: (_req, res) => {
        res.status(429).json({
            success: false,
            message: "Too many requests. Please slow down.",
        });
    },
});

module.exports = { authLimiter, apiLimiter };