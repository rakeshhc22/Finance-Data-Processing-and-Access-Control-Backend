// =============================================================================
// src/modules/users/users.schema.js
//
// Zod validation schemas for the users module.
//
// Schemas exported:
//   createUserSchema      → POST   /users          (ADMIN only)
//   updateUserSchema      → PATCH  /users/:id      (ADMIN only)
//   updateRoleSchema      → PATCH  /users/:id/role (ADMIN only)
//   updateStatusSchema    → PATCH  /users/:id/status (ADMIN only)
//   listUsersQuerySchema  → GET    /users           (query params)
//   userIdParamSchema     → every route with :id param
//
// Role and status values are taken directly from the Prisma enum definitions:
//   Role       → VIEWER | ANALYST | ADMIN
//   UserStatus → ACTIVE | INACTIVE | SUSPENDED
// =============================================================================

const { z } = require("zod");

// ---------------------------------------------------------------------------
// Reusable field definitions (mirrors auth.schema.js — kept local to avoid
// cross-module coupling; both files are the single source of truth for their
// own module)
// ---------------------------------------------------------------------------

const passwordField = z
    .string({ required_error: "Password is required." })
    .min(8, "Password must be at least 8 characters.")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter.")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter.")
    .regex(/[0-9]/, "Password must contain at least one digit.");

const emailField = z
    .string({ required_error: "Email is required." })
    .email("Please provide a valid email address.")
    .toLowerCase()
    .trim();

const nameField = z
    .string({ required_error: "Name is required." })
    .min(2, "Name must be at least 2 characters.")
    .max(100, "Name must not exceed 100 characters.")
    .trim();

// Valid Role enum values — must exactly match Prisma schema enum
const RoleEnum = z.enum(["VIEWER", "ANALYST", "ADMIN"], {
    errorMap: () => ({
        message: "Role must be one of: VIEWER, ANALYST, ADMIN.",
    }),
});

// Valid UserStatus enum values — must exactly match Prisma schema enum
const StatusEnum = z.enum(["ACTIVE", "INACTIVE", "SUSPENDED"], {
    errorMap: () => ({
        message: "Status must be one of: ACTIVE, INACTIVE, SUSPENDED.",
    }),
});

// ---------------------------------------------------------------------------
// POST /api/users
//
// ADMIN creates a new user and can set role + status at creation time.
// Unlike /auth/register (which defaults to VIEWER), this endpoint allows
// an ADMIN to provision an ANALYST or ADMIN account directly.
// ---------------------------------------------------------------------------
const createUserSchema = z.object({
    name: nameField,
    email: emailField,
    password: passwordField,
    role: RoleEnum.optional().default("VIEWER"),
    status: StatusEnum.optional().default("ACTIVE"),
});

// ---------------------------------------------------------------------------
// PATCH /api/users/:id
//
// ADMIN updates a user's name and/or email.
// Role and status are intentionally excluded — they have dedicated endpoints
// so audit logs can capture them with their own AuditAction types.
// At least one field must be provided (enforced with .refine).
// ---------------------------------------------------------------------------
const updateUserSchema = z
    .object({
        name: nameField.optional(),
        email: emailField.optional(),
    })
    .refine(
        (data) => data.name !== undefined || data.email !== undefined,
        { message: "At least one field (name or email) must be provided." }
    );

// ---------------------------------------------------------------------------
// PATCH /api/users/:id/role
//
// ADMIN-only endpoint to promote or demote a user's role.
// Isolated so the AuditLog action can be ROLE_CHANGE specifically.
// ---------------------------------------------------------------------------
const updateRoleSchema = z.object({
    role: RoleEnum,
});

// ---------------------------------------------------------------------------
// PATCH /api/users/:id/status
//
// ADMIN-only endpoint to activate, deactivate, or suspend a user.
// Isolated so the AuditLog action can be STATUS_CHANGE specifically.
// ---------------------------------------------------------------------------
const updateStatusSchema = z.object({
    status: StatusEnum,
});

// ---------------------------------------------------------------------------
// GET /api/users  (query string validation)
//
// Supports filtering, searching, and pagination.
// All fields optional — omitting them returns all users paginated.
//
// Fields:
//   role     → filter by Role enum value
//   status   → filter by UserStatus enum value
//   search   → partial match on name or email (case-insensitive)
//   page     → page number (default 1)
//   limit    → results per page (default 10, max 100)
//   sortBy   → field to sort by (default: createdAt)
//   order    → sort direction asc | desc (default: desc)
// ---------------------------------------------------------------------------
const listUsersQuerySchema = z.object({
    role: RoleEnum.optional(),
    status: StatusEnum.optional(),
    search: z.string().trim().optional(),

    page: z
        .string()
        .optional()
        .default("1")
        .transform(Number)
        .refine((v) => Number.isInteger(v) && v >= 1, {
            message: "page must be a positive integer.",
        }),

    limit: z
        .string()
        .optional()
        .default("10")
        .transform(Number)
        .refine((v) => Number.isInteger(v) && v >= 1 && v <= 100, {
            message: "limit must be between 1 and 100.",
        }),

    sortBy: z
        .enum(["createdAt", "name", "email", "role", "status"], {
            errorMap: () => ({
                message: "sortBy must be one of: createdAt, name, email, role, status.",
            }),
        })
        .optional()
        .default("createdAt"),

    order: z
        .enum(["asc", "desc"], {
            errorMap: () => ({ message: "order must be asc or desc." }),
        })
        .optional()
        .default("desc"),
});

// ---------------------------------------------------------------------------
// Param schema — reused across all routes that accept :id
// ---------------------------------------------------------------------------
const userIdParamSchema = z.object({
    id: z
        .string({ required_error: "User ID is required." })
        .uuid("User ID must be a valid UUID."),
});

module.exports = {
    createUserSchema,
    updateUserSchema,
    updateRoleSchema,
    updateStatusSchema,
    listUsersQuerySchema,
    userIdParamSchema,
};