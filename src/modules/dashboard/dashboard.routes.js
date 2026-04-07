// =============================================================================
// src/modules/dashboard/dashboard.routes.js
//
// Route definitions for the dashboard module.
//
// Mounted at /api/dashboard in app.js → full paths:
//
//   GET  /api/dashboard/summary           — totals (VIEWER, ANALYST, ADMIN)
//   GET  /api/dashboard/by-category       — category breakdown (VIEWER, ANALYST, ADMIN)
//   GET  /api/dashboard/trends/monthly    — monthly trends (ANALYST, ADMIN)
//   GET  /api/dashboard/trends/weekly     — weekly trends (ANALYST, ADMIN)
//   GET  /api/dashboard/recent            — recent activity (VIEWER, ANALYST, ADMIN)
//
// All routes:
//   1. authenticate           — valid access token required (applied via router.use)
//   2. authorize(...)         — role guard per route
//   3. controller handler     — no validate() needed; query params are parsed
//                               safely in the controller helpers (parseDate,
//                               parsePositiveInt) and validated in the service.
//
// No Zod validate() on query params here because:
//   - Dashboard query params are all optional with safe defaults.
//   - Type coercion and range validation happen in the service, which throws
//     AppError with a clear message on invalid values.
//   - This avoids over-engineering a schema for params that are purely advisory.
// =============================================================================

const { Router } = require("express");

const dashboardController = require("./dashboard.controller");
const { authenticate } = require("../../middlewares/auth.middleware");
const { authorize } = require("../../middlewares/role.middleware");

const router = Router();

// ---------------------------------------------------------------------------
// All dashboard routes require a valid access token
// ---------------------------------------------------------------------------
router.use(authenticate);

// ---------------------------------------------------------------------------
// GET /api/dashboard/summary
// VIEWER, ANALYST, ADMIN — read-only aggregate, accessible to all roles
// ---------------------------------------------------------------------------
router.get(
    "/summary",
    authorize("VIEWER", "ANALYST", "ADMIN"),
    dashboardController.summary
);

// ---------------------------------------------------------------------------
// GET /api/dashboard/by-category
// VIEWER, ANALYST, ADMIN
// ---------------------------------------------------------------------------
router.get(
    "/by-category",
    authorize("VIEWER", "ANALYST", "ADMIN"),
    dashboardController.categoryTotals
);

// ---------------------------------------------------------------------------
// GET /api/dashboard/trends/monthly
// ANALYST, ADMIN — deeper analytics; VIEWERs do not have access
// ---------------------------------------------------------------------------
router.get(
    "/trends/monthly",
    authorize("ANALYST", "ADMIN"),
    dashboardController.monthlyTrends
);

// ---------------------------------------------------------------------------
// GET /api/dashboard/trends/weekly
// ANALYST, ADMIN
// ---------------------------------------------------------------------------
router.get(
    "/trends/weekly",
    authorize("ANALYST", "ADMIN"),
    dashboardController.weeklyTrends
);

// ---------------------------------------------------------------------------
// GET /api/dashboard/recent
// VIEWER, ANALYST, ADMIN — live feed of recent transactions
// ---------------------------------------------------------------------------
router.get(
    "/recent",
    authorize("VIEWER", "ANALYST", "ADMIN"),
    dashboardController.recentActivity
);

module.exports = router;