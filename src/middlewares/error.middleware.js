// =============================================================================
// src/middlewares/error.middleware.js
//
// Purpose : Centralised error handling for the entire Express app.
//
// Exports:
//   AppError        — Custom error class for operational errors
//   errorMiddleware — Express 4-argument error handler (must be last middleware)
//
// How errors flow:
//   1. Any module throws: throw new AppError("message", statusCode)
//   2. Controller catches it and calls next(err)
//   3. Express skips all normal middleware and lands here
//   4. We format a consistent JSON error response
//
// Two categories of error:
//   Operational — AppError instances: bad input, 404, 401, 403, 409 etc.
//                 These are predictable, user-facing, have a clear message.
//   Programming — all other Errors: unhandled promises, null references, etc.
//                 These are bugs. We log the stack and return a generic 500.
// =============================================================================

"use strict";

const env = require("../config/env");

// =============================================================================
// AppError
//
// All intentional errors thrown in services / controllers should use this.
//
// @param {string}  message    — User-facing error description
// @param {number}  statusCode — HTTP status code (400, 401, 403, 404, 409, etc.)
// =============================================================================
class AppError extends Error {
    constructor(message, statusCode) {
        super(message);
        this.statusCode = statusCode;
        this.isOperational = true;

        // Capture clean stack trace (V8 only — no-op on other engines)
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, AppError);
        }
    }
}

// =============================================================================
// handleZodError
//
// Zod validation errors arrive as a plain Error with a .errors array attached
// by the validate middleware. Convert them to a user-friendly shape.
//
// @param {object} err  — Zod error object
// @param {object} res  — Express response
// =============================================================================
const handleZodError = (err, res) => {
    const errors = err.errors.map((e) => ({
        field: e.path.join("."),
        message: e.message,
    }));

    return res.status(400).json({
        success: false,
        message: "Validation failed.",
        errors,
    });
};

// =============================================================================
// handlePrismaError
//
// Translate Prisma-specific error codes into user-friendly responses.
// Only handles codes relevant to this application.
//
// @param {object} err  — Prisma error
// @param {object} res  — Express response
// =============================================================================
const handlePrismaError = (err, res) => {
    switch (err.code) {
        // Unique constraint violation (e.g. duplicate email)
        case "P2002": {
            const field = err.meta?.target?.[0] ?? "field";
            return res.status(409).json({
                success: false,
                message: `A record with this ${field} already exists.`,
            });
        }

        // Record not found (e.g. update/delete on non-existent id)
        case "P2025":
            return res.status(404).json({
                success: false,
                message: "Record not found.",
            });

        // Foreign key constraint failed
        case "P2003":
            return res.status(400).json({
                success: false,
                message: "Related record does not exist.",
            });

        default:
            // Unknown Prisma error — treat as 500
            return null;
    }
};

// =============================================================================
// errorMiddleware
//
// Must be registered as the very last app.use() in app.js.
// Express identifies it as an error handler because it takes 4 arguments.
//
// @param {Error}    err
// @param {Request}  req
// @param {Response} res
// @param {Function} next  — required by Express even if unused
// =============================================================================
// eslint-disable-next-line no-unused-vars
const errorMiddleware = (err, req, res, next) => {
    // ── 1. Zod validation errors (set by validate.middleware.js) ─────────────
    if (err.isZodError) {
        return handleZodError(err, res);
    }

    // ── 2. Prisma errors ──────────────────────────────────────────────────────
    if (err.code && err.code.startsWith("P2")) {
        const handled = handlePrismaError(err, res);
        if (handled) return handled;
    }

    // ── 3. Operational errors (AppError instances) ────────────────────────────
    if (err.isOperational) {
        return res.status(err.statusCode).json({
            success: false,
            message: err.message,
        });
    }

    // ── 4. JWT errors ─────────────────────────────────────────────────────────
    if (err.name === "JsonWebTokenError" || err.name === "NotBeforeError") {
        return res.status(401).json({
            success: false,
            message: "Invalid token. Please log in again.",
        });
    }

    if (err.name === "TokenExpiredError") {
        return res.status(401).json({
            success: false,
            message: "Token has expired. Please log in again.",
        });
    }

    // ── 5. CORS errors ────────────────────────────────────────────────────────
    if (err.message && err.message.startsWith("CORS:")) {
        return res.status(403).json({
            success: false,
            message: err.message,
        });
    }

    // ── 6. Unknown / programming errors ──────────────────────────────────────
    // Log full stack in non-production so developers see the root cause.
    console.error("\n  ✗ Unhandled error:", err);

    // In production hide implementation details from the client.
    const message =
        env.NODE_ENV === "production"
            ? "An unexpected error occurred. Please try again later."
            : err.message;

    return res.status(500).json({
        success: false,
        message,
        // Only include stack trace in development
        ...(env.NODE_ENV !== "production" && { stack: err.stack }),
    });
};

module.exports = { AppError, errorMiddleware };