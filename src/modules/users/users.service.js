// =============================================================================
// src/modules/users/users.service.js
//
// Business logic for the users module.
// All functions are ADMIN-only unless noted.
//
// Functions:
//   listUsers      → paginated, filtered, searchable list of all users
//   getUserById    → fetch a single user by id
//   createUser     → admin provisions a new account with any role
//   updateUser     → update name / email
//   updateRole     → change role (writes ROLE_CHANGE audit log)
//   updateStatus   → change status (writes STATUS_CHANGE audit log)
//   deleteUser     → hard delete — also wipes refresh tokens (cascade in DB)
//
// AuditLog actions used:
//   CREATE        → createUser
//   UPDATE        → updateUser
//   ROLE_CHANGE   → updateRole
//   STATUS_CHANGE → updateStatus
//   DELETE        → deleteUser
//
// Safe user shape (never exposes password):
//   { id, name, email, role, status, createdAt, updatedAt, createdById }
// =============================================================================

const db = require("../../config/db");
const { hashPassword } = require("../../utils/hash");
const { AppError } = require("../../middlewares/error.middleware");

// ---------------------------------------------------------------------------
// Helper — safe user projection (no password, no internal relations)
// ---------------------------------------------------------------------------
const USER_SELECT = {
    id: true,
    name: true,
    email: true,
    role: true,
    status: true,
    createdAt: true,
    updatedAt: true,
    createdById: true,
    // Include who created this user for admin views
    createdBy: {
        select: { id: true, name: true, email: true },
    },
};

// ---------------------------------------------------------------------------
// Helper — write to AuditLog (fire-and-forget, never blocks the response)
// Identical pattern to auth.service.js — kept local to avoid coupling
// ---------------------------------------------------------------------------
const writeAuditLog = async ({
    action,
    entity,
    entityId,
    userId,
    before,
    after,
    ipAddress,
    userAgent,
}) => {
    try {
        await db.auditLog.create({
            data: {
                action,
                entity,
                entityId,
                userId,
                before: before ?? undefined,
                after: after ?? undefined,
                ipAddress: ipAddress ?? null,
                userAgent: userAgent ?? null,
            },
        });
    } catch (_err) {
        console.error("[AuditLog] Failed to write entry:", _err.message);
    }
};

// =============================================================================
// listUsers
//
// Returns a paginated list of users.
// Supports:
//   - Filtering by role, status
//   - Case-insensitive search on name and email (Prisma mode: "insensitive")
//   - Sorting by any allowed field
//   - Pagination via page + limit → returns meta: { total, page, limit, totalPages }
//
// @param {object} query  - Validated + coerced by listUsersQuerySchema
// @returns {{ users: [], meta: {} }}
// =============================================================================
const listUsers = async (query) => {
    const { role, status, search, page, limit, sortBy, order } = query;

    // ── Build where clause ────────────────────────────────────────────────────
    const where = {};

    if (role) where.role = role;
    if (status) where.status = status;

    if (search) {
        where.OR = [
            { name: { contains: search, mode: "insensitive" } },
            { email: { contains: search, mode: "insensitive" } },
        ];
    }

    // ── Pagination ────────────────────────────────────────────────────────────
    const skip = (page - 1) * limit;
    const take = limit;

    // ── Execute count + data queries in parallel ──────────────────────────────
    const [total, users] = await Promise.all([
        db.user.count({ where }),
        db.user.findMany({
            where,
            select: USER_SELECT,
            orderBy: { [sortBy]: order },
            skip,
            take,
        }),
    ]);

    return {
        users,
        meta: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
        },
    };
};

// =============================================================================
// getUserById
//
// Fetches a single user. Throws 404 if not found.
//
// @param {string} id
// @returns {object} user
// =============================================================================
const getUserById = async (id) => {
    const user = await db.user.findUnique({
        where: { id },
        select: USER_SELECT,
    });

    if (!user) {
        throw new AppError("User not found.", 404);
    }

    return user;
};

// =============================================================================
// createUser
//
// ADMIN provisions a new account with a specified role and status.
// Unlike /auth/register, this allows setting any role at creation time.
// The createdById field is set to the acting ADMIN's id.
//
// @param {object} body          - Validated by createUserSchema
// @param {object} currentUser   - req.user (the ADMIN performing the action)
// @param {object} meta          - { ipAddress, userAgent }
// @returns {object} created user (safe projection)
// =============================================================================
const createUser = async (body, currentUser, meta = {}) => {
    const { name, email, password, role, status } = body;

    // ── Duplicate email check ─────────────────────────────────────────────────
    const existing = await db.user.findUnique({ where: { email } });
    if (existing) {
        throw new AppError("An account with this email already exists.", 409);
    }

    // ── Hash password ─────────────────────────────────────────────────────────
    const hashedPassword = await hashPassword(password);

    // ── Create user ───────────────────────────────────────────────────────────
    const user = await db.user.create({
        data: {
            name,
            email,
            password: hashedPassword,
            role,
            status,
            createdById: currentUser.id,
        },
        select: USER_SELECT,
    });

    // ── Audit ─────────────────────────────────────────────────────────────────
    await writeAuditLog({
        action: "CREATE",
        entity: "User",
        entityId: user.id,
        userId: currentUser.id,
        before: null,
        after: user,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
    });

    return user;
};

// =============================================================================
// updateUser
//
// Updates a user's name and/or email.
// Role and status changes are handled by dedicated functions below.
//
// Guards:
//   - Cannot update a non-existent user (404)
//   - If email is being changed, check it is not already taken (409)
//
// @param {string} id            - Target user id (from :id param)
// @param {object} body          - Validated by updateUserSchema { name?, email? }
// @param {object} currentUser   - req.user (the ADMIN performing the action)
// @param {object} meta          - { ipAddress, userAgent }
// @returns {object} updated user (safe projection)
// =============================================================================
const updateUser = async (id, body, currentUser, meta = {}) => {
    // ── Confirm target user exists ────────────────────────────────────────────
    const existing = await db.user.findUnique({
        where: { id },
        select: USER_SELECT,
    });
    if (!existing) {
        throw new AppError("User not found.", 404);
    }

    // ── If changing email, ensure it is not already taken ─────────────────────
    if (body.email && body.email !== existing.email) {
        const emailTaken = await db.user.findUnique({ where: { email: body.email } });
        if (emailTaken) {
            throw new AppError("An account with this email already exists.", 409);
        }
    }

    // ── Perform update ────────────────────────────────────────────────────────
    const updated = await db.user.update({
        where: { id },
        data: body,
        select: USER_SELECT,
    });

    // ── Audit ─────────────────────────────────────────────────────────────────
    await writeAuditLog({
        action: "UPDATE",
        entity: "User",
        entityId: id,
        userId: currentUser.id,
        before: existing,
        after: updated,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
    });

    return updated;
};

// =============================================================================
// updateRole
//
// Changes a user's role. Uses ROLE_CHANGE audit action.
//
// Guards:
//   - Cannot change role of a non-existent user (404)
//   - An ADMIN cannot demote their own role (prevents accidental lockout)
//
// @param {string} id            - Target user id
// @param {{ role: string }} body - Validated by updateRoleSchema
// @param {object} currentUser   - req.user
// @param {object} meta          - { ipAddress, userAgent }
// @returns {object} updated user (safe projection)
// =============================================================================
const updateRole = async (id, body, currentUser, meta = {}) => {
    // ── Self-demotion guard ───────────────────────────────────────────────────
    if (id === currentUser.id) {
        throw new AppError("You cannot change your own role.", 403);
    }

    // ── Fetch current state ───────────────────────────────────────────────────
    const existing = await db.user.findUnique({
        where: { id },
        select: USER_SELECT,
    });
    if (!existing) {
        throw new AppError("User not found.", 404);
    }

    // ── No-op guard — role is already what was requested ─────────────────────
    if (existing.role === body.role) {
        throw new AppError(`User already has the role ${body.role}.`, 400);
    }

    // ── Update role ───────────────────────────────────────────────────────────
    const updated = await db.user.update({
        where: { id },
        data: { role: body.role },
        select: USER_SELECT,
    });

    // ── Audit with ROLE_CHANGE action ─────────────────────────────────────────
    await writeAuditLog({
        action: "ROLE_CHANGE",
        entity: "User",
        entityId: id,
        userId: currentUser.id,
        before: { role: existing.role },
        after: { role: updated.role },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
    });

    return updated;
};

// =============================================================================
// updateStatus
//
// Changes a user's status (ACTIVE | INACTIVE | SUSPENDED).
// Uses STATUS_CHANGE audit action.
//
// Guards:
//   - Cannot change status of a non-existent user (404)
//   - An ADMIN cannot deactivate or suspend their own account
//
// @param {string} id              - Target user id
// @param {{ status: string }} body - Validated by updateStatusSchema
// @param {object} currentUser     - req.user
// @param {object} meta            - { ipAddress, userAgent }
// @returns {object} updated user (safe projection)
// =============================================================================
const updateStatus = async (id, body, currentUser, meta = {}) => {
    // ── Self-suspension guard ─────────────────────────────────────────────────
    if (id === currentUser.id) {
        throw new AppError("You cannot change your own account status.", 403);
    }

    // ── Fetch current state ───────────────────────────────────────────────────
    const existing = await db.user.findUnique({
        where: { id },
        select: USER_SELECT,
    });
    if (!existing) {
        throw new AppError("User not found.", 404);
    }

    // ── No-op guard ───────────────────────────────────────────────────────────
    if (existing.status === body.status) {
        throw new AppError(`User status is already ${body.status}.`, 400);
    }

    // ── Update status ─────────────────────────────────────────────────────────
    const updated = await db.user.update({
        where: { id },
        data: { status: body.status },
        select: USER_SELECT,
    });

    // ── If user is being deactivated or suspended, revoke all their sessions ──
    if (body.status === "INACTIVE" || body.status === "SUSPENDED") {
        await db.refreshToken.deleteMany({ where: { userId: id } });
    }

    // ── Audit with STATUS_CHANGE action ───────────────────────────────────────
    await writeAuditLog({
        action: "STATUS_CHANGE",
        entity: "User",
        entityId: id,
        userId: currentUser.id,
        before: { status: existing.status },
        after: { status: updated.status },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
    });

    return updated;
};

// =============================================================================
// deleteUser
//
// Hard deletes a user.
// The DB cascade (onDelete: Cascade on RefreshToken.userId) removes their
// refresh tokens automatically. AuditLog rows are preserved (userId FK on
// AuditLog has no onDelete rule, so logs remain for traceability).
//
// Guards:
//   - Cannot delete a non-existent user (404)
//   - An ADMIN cannot delete their own account
//
// @param {string} id            - Target user id
// @param {object} currentUser   - req.user
// @param {object} meta          - { ipAddress, userAgent }
// =============================================================================
const deleteUser = async (id, currentUser, meta = {}) => {
    // ── Self-deletion guard ───────────────────────────────────────────────────
    if (id === currentUser.id) {
        throw new AppError("You cannot delete your own account.", 403);
    }

    // ── Confirm user exists ───────────────────────────────────────────────────
    const existing = await db.user.findUnique({
        where: { id },
        select: USER_SELECT,
    });
    if (!existing) {
        throw new AppError("User not found.", 404);
    }

    // ── Hard delete ───────────────────────────────────────────────────────────
    await db.user.delete({ where: { id } });

    // ── Audit ─────────────────────────────────────────────────────────────────
    await writeAuditLog({
        action: "DELETE",
        entity: "User",
        entityId: id,
        userId: currentUser.id,
        before: existing,
        after: null,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
    });
};

module.exports = {
    listUsers,
    getUserById,
    createUser,
    updateUser,
    updateRole,
    updateStatus,
    deleteUser,
};