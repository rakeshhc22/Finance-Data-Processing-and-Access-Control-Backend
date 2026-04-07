// =============================================================================
// src/modules/auth/auth.schema.js
//
// Zod validation schemas for every auth endpoint.
//
// Schemas exported:
//   registerSchema  → POST /auth/register
//   loginSchema     → POST /auth/login
//   refreshSchema   → POST /auth/refresh
//   changePasswordSchema → PATCH /auth/change-password
//
// These are consumed by validate.middleware.js which calls schema.safeParse()
// and replaces req.body with the coerced output on success.
// =============================================================================

const { z } = require("zod");

// ---------------------------------------------------------------------------
// Reusable field definitions
// ---------------------------------------------------------------------------

// Password must be at least 8 characters and contain:
//   - at least one uppercase letter
//   - at least one lowercase letter
//   - at least one digit
const passwordField = z
    .string({ required_error: "Password is required." })
    .min(8, "Password must be at least 8 characters.")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter.")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter.")
    .regex(/[0-9]/, "Password must contain at least one digit.");

const emailField = z
    .string({ required_error: "Email is required." })
    .email("Please provide a valid email address.")
    .toLowerCase()   // normalise to lowercase before any DB lookup
    .trim();

const nameField = z
    .string({ required_error: "Name is required." })
    .min(2, "Name must be at least 2 characters.")
    .max(100, "Name must not exceed 100 characters.")
    .trim();

// ---------------------------------------------------------------------------
// POST /auth/register
//
// Public endpoint — any visitor can create a VIEWER account.
// Role is intentionally excluded here; it defaults to VIEWER in the DB schema.
// An ADMIN can promote a user's role after registration via the users module.
// ---------------------------------------------------------------------------
const registerSchema = z.object({
    name: nameField,
    email: emailField,
    password: passwordField,
});

// ---------------------------------------------------------------------------
// POST /auth/login
// ---------------------------------------------------------------------------
const loginSchema = z.object({
    email: emailField,
    password: z
        .string({ required_error: "Password is required." })
        .min(1, "Password cannot be empty."),
    // Optional: client can send these for session metadata stored on RefreshToken
    userAgent: z.string().optional(),
    ipAddress: z.string().optional(),
});

// ---------------------------------------------------------------------------
// POST /auth/refresh
//
// Client sends the raw refresh token (received at login) in the request body.
// ---------------------------------------------------------------------------
const refreshSchema = z.object({
    refreshToken: z
        .string({ required_error: "Refresh token is required." })
        .min(1, "Refresh token cannot be empty."),
});

// ---------------------------------------------------------------------------
// PATCH /auth/change-password
//
// Authenticated route — user supplies current + new passwords.
// ---------------------------------------------------------------------------
const changePasswordSchema = z
    .object({
        currentPassword: z
            .string({ required_error: "Current password is required." })
            .min(1, "Current password cannot be empty."),
        newPassword: passwordField,
        confirmPassword: z
            .string({ required_error: "Please confirm your new password." })
            .min(1, "Confirm password cannot be empty."),
    })
    .refine((data) => data.newPassword === data.confirmPassword, {
        message: "New password and confirm password do not match.",
        path: ["confirmPassword"],
    })
    .refine((data) => data.currentPassword !== data.newPassword, {
        message: "New password must be different from the current password.",
        path: ["newPassword"],
    });

module.exports = {
    registerSchema,
    loginSchema,
    refreshSchema,
    changePasswordSchema,
};