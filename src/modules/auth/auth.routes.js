// =============================================================================
// src/modules/auth/auth.routes.js
//
// Route definitions for the auth module.
//
// Mounted at /api/auth in app.js → full paths:
//   POST   /api/auth/register
//   POST   /api/auth/login
//   POST   /api/auth/refresh
//   POST   /api/auth/logout          (protected)
//   PATCH  /api/auth/change-password (protected)
//   GET    /api/auth/me              (protected)
//
// Middleware chain per route:
//   authLimiter     — rate limit (strict, auth routes only)
//   validate(...)   — Zod body validation
//   authenticate    — JWT verification (protected routes only)
//   controller      — handler
//
// No role guard here — all authenticated users can access their own profile
// and change their own password regardless of role.
// =============================================================================

const { Router } = require("express");

const authController = require("./auth.controller");
const {
    registerSchema,
    loginSchema,
    refreshSchema,
    changePasswordSchema,
} = require("./auth.schema");

const { validate } = require("../../middlewares/validate.middleware");
const { authenticate } = require("../../middlewares/auth.middleware");
const { authLimiter } = require("../../middlewares/rateLimit.middleware");

const router = Router();

// ---------------------------------------------------------------------------
// Public routes — no authentication required
// ---------------------------------------------------------------------------

// POST /api/auth/register
router.post(
    "/register",
    authLimiter,
    validate(registerSchema),
    authController.register
);

// POST /api/auth/login
router.post(
    "/login",
    authLimiter,
    validate(loginSchema),
    authController.login
);

// POST /api/auth/refresh
// authLimiter applied — refresh endpoint should also be protected from abuse
router.post(
    "/refresh",
    authLimiter,
    validate(refreshSchema),
    authController.refresh
);

// ---------------------------------------------------------------------------
// Protected routes — valid access token required
// ---------------------------------------------------------------------------

// POST /api/auth/logout
router.post(
    "/logout",
    authenticate,
    validate(refreshSchema),  // client must send the refresh token to revoke it
    authController.logout
);

// PATCH /api/auth/change-password
router.patch(
    "/change-password",
    authenticate,
    validate(changePasswordSchema),
    authController.changePassword
);

// GET /api/auth/me
router.get(
    "/me",
    authenticate,
    authController.getMe
);

module.exports = router;