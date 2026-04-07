// =============================================================================
// src/modules/users/users.routes.js
//
// Route definitions for the users module.
//
// Mounted at /api/users in app.js → full paths:
//   GET    /api/users                  — list all users (paginated + filtered)
//   GET    /api/users/:id              — get single user by id
//   POST   /api/users                  — create a new user
//   PATCH  /api/users/:id              — update name / email
//   PATCH  /api/users/:id/role         — change role (ROLE_CHANGE audit)
//   PATCH  /api/users/:id/status       — change status (STATUS_CHANGE audit)
//   DELETE /api/users/:id              — hard delete a user
//
// All routes:
//   1. authenticate  — valid access token required
//   2. authorize("ADMIN") — only ADMINs can manage users
//   3. validate(...)     — Zod schema validation (params + body / query)
//   4. controller handler
//
// The :id/role and :id/status sub-routes are declared BEFORE :id to prevent
// Express from interpreting "role" or "status" as an id value.
// =============================================================================

const { Router } = require("express");

const usersController = require("./users.controller");
const {
    createUserSchema,
    updateUserSchema,
    updateRoleSchema,
    updateStatusSchema,
    listUsersQuerySchema,
    userIdParamSchema,
} = require("./users.schema");

const { validate } = require("../../middlewares/validate.middleware");
const { authenticate } = require("../../middlewares/auth.middleware");
const { authorize } = require("../../middlewares/role.middleware");

const router = Router();

// ---------------------------------------------------------------------------
// Apply authenticate + authorize("ADMIN") to every route in this file.
// Using router.use() so it is not repeated on each route definition.
// ---------------------------------------------------------------------------
router.use(authenticate, authorize("ADMIN"));

// ---------------------------------------------------------------------------
// GET /api/users
// ---------------------------------------------------------------------------
router.get(
    "/",
    validate(listUsersQuerySchema, "query"),
    usersController.list
);

// ---------------------------------------------------------------------------
// POST /api/users
// ---------------------------------------------------------------------------
router.post(
    "/",
    validate(createUserSchema),
    usersController.create
);

// ---------------------------------------------------------------------------
// PATCH /api/users/:id/role
// Must be declared before PATCH /api/users/:id to avoid route collision.
// ---------------------------------------------------------------------------
router.patch(
    "/:id/role",
    validate(userIdParamSchema, "params"),
    validate(updateRoleSchema),
    usersController.updateRole
);

// ---------------------------------------------------------------------------
// PATCH /api/users/:id/status
// Must be declared before PATCH /api/users/:id to avoid route collision.
// ---------------------------------------------------------------------------
router.patch(
    "/:id/status",
    validate(userIdParamSchema, "params"),
    validate(updateStatusSchema),
    usersController.updateStatus
);

// ---------------------------------------------------------------------------
// GET /api/users/:id
// ---------------------------------------------------------------------------
router.get(
    "/:id",
    validate(userIdParamSchema, "params"),
    usersController.getById
);

// ---------------------------------------------------------------------------
// PATCH /api/users/:id
// ---------------------------------------------------------------------------
router.patch(
    "/:id",
    validate(userIdParamSchema, "params"),
    validate(updateUserSchema),
    usersController.update
);

// ---------------------------------------------------------------------------
// DELETE /api/users/:id
// ---------------------------------------------------------------------------
router.delete(
    "/:id",
    validate(userIdParamSchema, "params"),
    usersController.remove
);

module.exports = router;