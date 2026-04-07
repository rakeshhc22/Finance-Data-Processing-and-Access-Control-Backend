// =============================================================================
// src/modules/records/records.routes.js
//
// Route definitions for the financial records module.
//
// Mounted at /api/records in app.js → full paths:
//   GET    /api/records        — list records (VIEWER, ANALYST, ADMIN)
//   GET    /api/records/:id    — get single record (VIEWER, ANALYST, ADMIN)
//   POST   /api/records        — create record (ADMIN only)
//   PATCH  /api/records/:id    — update record (ADMIN only)
//   DELETE /api/records/:id    — soft-delete record (ADMIN only)
//
// Middleware chain:
//   authenticate              — all routes require a valid access token
//   authorize(...)            — role-based access per route
//   validate(...)             — Zod schema on params + body / query
//   controller handler
// =============================================================================

const { Router } = require("express");

const recordsController = require("./records.controller");
const {
    createRecordSchema,
    updateRecordSchema,
    listRecordsQuerySchema,
    recordIdParamSchema,
} = require("./records.schema");

const { validate } = require("../../middlewares/validate.middleware");
const { authenticate } = require("../../middlewares/auth.middleware");
const { authorize } = require("../../middlewares/role.middleware");

const router = Router();

// ---------------------------------------------------------------------------
// All records routes require authentication
// ---------------------------------------------------------------------------
router.use(authenticate);

// ---------------------------------------------------------------------------
// GET /api/records
// All authenticated roles can read records.
// ---------------------------------------------------------------------------
router.get(
    "/",
    authorize("VIEWER", "ANALYST", "ADMIN"),
    validate(listRecordsQuerySchema, "query"),
    recordsController.list
);

// ---------------------------------------------------------------------------
// POST /api/records
// ADMIN only — create a new financial record.
// ---------------------------------------------------------------------------
router.post(
    "/",
    authorize("ADMIN"),
    validate(createRecordSchema),
    recordsController.create
);

// ---------------------------------------------------------------------------
// GET /api/records/:id
// All authenticated roles can read a single record.
// ---------------------------------------------------------------------------
router.get(
    "/:id",
    authorize("VIEWER", "ANALYST", "ADMIN"),
    validate(recordIdParamSchema, "params"),
    recordsController.getById
);

// ---------------------------------------------------------------------------
// PATCH /api/records/:id
// ADMIN only — update an existing record.
// ---------------------------------------------------------------------------
router.patch(
    "/:id",
    authorize("ADMIN"),
    validate(recordIdParamSchema, "params"),
    validate(updateRecordSchema),
    recordsController.update
);

// ---------------------------------------------------------------------------
// DELETE /api/records/:id
// ADMIN only — soft-delete a record.
// ---------------------------------------------------------------------------
router.delete(
    "/:id",
    authorize("ADMIN"),
    validate(recordIdParamSchema, "params"),
    recordsController.remove
);

module.exports = router;