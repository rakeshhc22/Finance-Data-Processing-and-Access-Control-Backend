// =============================================================================
// src/middlewares/role.middleware.js
//
// Purpose : Enforce role-based access control after authentication.
//           The authenticate middleware must always run before authorize().
//
// Exports:
//   authorize(...roles) — factory that returns a middleware checking req.user.role
//
// Usage in routes:
//   authorize("ADMIN")                        — only ADMINs
//   authorize("ANALYST", "ADMIN")             — ANALYSTs and ADMINs
//   authorize("VIEWER", "ANALYST", "ADMIN")   — all authenticated roles
//
// Roles (from schema.prisma):
//   VIEWER  — read-only dashboard + records
//   ANALYST — read + analytics/insights endpoints
//   ADMIN   — full access: records CRUD + user management
//
// Error behaviour:
//   - If req.user is missing (authenticate was skipped) → 500 server error
//   - If role is not in the allowed list → 403 Forbidden
// =============================================================================

"use strict";

const { AppError } = require("./error.middleware");

// =============================================================================
// authorize
//
// Returns an Express middleware that checks whether the authenticated user's
// role is included in the allowed roles list.
//
// @param {...string} allowedRoles — one or more Role enum values
// @returns {Function} Express middleware (req, res, next)
// =============================================================================
const authorize = (...allowedRoles) => {
    if (allowedRoles.length === 0) {
        throw new Error(
            "authorize() requires at least one role. " +
            "Example: authorize('ADMIN') or authorize('VIEWER','ANALYST','ADMIN')"
        );
    }

    return (req, _res, next) => {
        // Defensive check — authenticate should always run first
        if (!req.user) {
            return next(
                new AppError(
                    "Authentication required before authorization check.",
                    500
                )
            );
        }

        // Check if the user's role is in the allowed set
        if (!allowedRoles.includes(req.user.role)) {
            return next(
                new AppError(
                    `Access denied. Required role: ${allowedRoles.join(" or ")}.`,
                    403
                )
            );
        }

        return next();
    };
};

module.exports = { authorize };