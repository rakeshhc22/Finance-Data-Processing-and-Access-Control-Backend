// =============================================================================
// src/modules/users/users.controller.js
//
// Thin HTTP layer — extracts data from req, calls the service, sends response.
// No business logic lives here. All logic is in users.service.js.
//
// Controllers:
//   list          → GET    /users
//   getById       → GET    /users/:id
//   create        → POST   /users
//   update        → PATCH  /users/:id
//   updateRole    → PATCH  /users/:id/role
//   updateStatus  → PATCH  /users/:id/status
//   remove        → DELETE /users/:id
// =============================================================================

const usersService = require("./users.service");
const { sendSuccess } = require("../../utils/response");

// ---------------------------------------------------------------------------
// Helper — extract request metadata for audit logs (same pattern as auth)
// ---------------------------------------------------------------------------
const getRequestMeta = (req) => ({
    ipAddress: req.ip ?? req.connection?.remoteAddress ?? null,
    userAgent: req.headers["user-agent"] ?? null,
});

// ---------------------------------------------------------------------------
// GET /api/users
// Query params validated by listUsersQuerySchema via validate middleware.
// ADMIN only.
// ---------------------------------------------------------------------------
const list = async (req, res, next) => {
    try {
        const { users, meta } = await usersService.listUsers(req.query);

        return sendSuccess(res, 200, "Users fetched successfully.", { users }, meta);
    } catch (err) {
        return next(err);
    }
};

// ---------------------------------------------------------------------------
// GET /api/users/:id
// Param validated by userIdParamSchema via validate middleware.
// ADMIN only.
// ---------------------------------------------------------------------------
const getById = async (req, res, next) => {
    try {
        const user = await usersService.getUserById(req.params.id);

        return sendSuccess(res, 200, "User fetched successfully.", { user });
    } catch (err) {
        return next(err);
    }
};

// ---------------------------------------------------------------------------
// POST /api/users
// Body validated by createUserSchema via validate middleware.
// ADMIN only.
// ---------------------------------------------------------------------------
const create = async (req, res, next) => {
    try {
        const user = await usersService.createUser(
            req.body,
            req.user,
            getRequestMeta(req)
        );

        return sendSuccess(res, 201, "User created successfully.", { user });
    } catch (err) {
        return next(err);
    }
};

// ---------------------------------------------------------------------------
// PATCH /api/users/:id
// Param validated by userIdParamSchema, body by updateUserSchema.
// ADMIN only.
// ---------------------------------------------------------------------------
const update = async (req, res, next) => {
    try {
        const user = await usersService.updateUser(
            req.params.id,
            req.body,
            req.user,
            getRequestMeta(req)
        );

        return sendSuccess(res, 200, "User updated successfully.", { user });
    } catch (err) {
        return next(err);
    }
};

// ---------------------------------------------------------------------------
// PATCH /api/users/:id/role
// Param validated by userIdParamSchema, body by updateRoleSchema.
// ADMIN only.
// ---------------------------------------------------------------------------
const updateRole = async (req, res, next) => {
    try {
        const user = await usersService.updateRole(
            req.params.id,
            req.body,
            req.user,
            getRequestMeta(req)
        );

        return sendSuccess(res, 200, "User role updated successfully.", { user });
    } catch (err) {
        return next(err);
    }
};

// ---------------------------------------------------------------------------
// PATCH /api/users/:id/status
// Param validated by userIdParamSchema, body by updateStatusSchema.
// ADMIN only.
// ---------------------------------------------------------------------------
const updateStatus = async (req, res, next) => {
    try {
        const user = await usersService.updateStatus(
            req.params.id,
            req.body,
            req.user,
            getRequestMeta(req)
        );

        return sendSuccess(res, 200, "User status updated successfully.", { user });
    } catch (err) {
        return next(err);
    }
};

// ---------------------------------------------------------------------------
// DELETE /api/users/:id
// Param validated by userIdParamSchema via validate middleware.
// ADMIN only.
// ---------------------------------------------------------------------------
const remove = async (req, res, next) => {
    try {
        await usersService.deleteUser(
            req.params.id,
            req.user,
            getRequestMeta(req)
        );

        return sendSuccess(res, 200, "User deleted successfully.");
    } catch (err) {
        return next(err);
    }
};

module.exports = {
    list,
    getById,
    create,
    update,
    updateRole,
    updateStatus,
    remove,
};