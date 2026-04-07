// =============================================================================
// src/middlewares/validate.middleware.js
//
// Purpose : Run Zod schema validation against req.body, req.query, or req.params.
//           On success, replaces the target with the coerced Zod output.
//           On failure, calls next(err) with a tagged error for errorMiddleware.
//
// Exports:
//   validate(schema, target?)
//
// Usage:
//   validate(createUserSchema)              — validates req.body (default)
//   validate(listUsersQuerySchema, "query") — validates req.query
//   validate(userIdParamSchema, "params")   — validates req.params
//
// Why replace req[target] with the Zod output?
//   Zod schemas may transform values (e.g. string → Date, "1" → 1, trim whitespace).
//   By replacing the source, controllers and services always receive clean,
//   type-correct data — no manual coercion needed downstream.
// =============================================================================

"use strict";

// =============================================================================
// validate
//
// @param {import("zod").ZodTypeAny} schema — Zod schema to validate against
// @param {"body"|"query"|"params"}  [target="body"]
// @returns {Function} Express middleware
// =============================================================================
const validate = (schema, target = "body") => {
    return (req, _res, next) => {
        const result = schema.safeParse(req[target]);

        if (!result.success) {
            // Tag the error so errorMiddleware knows how to format it
            const err = new Error("Validation failed.");
            err.isZodError = true;
            err.errors = result.error.errors; // ZodIssue[]
            return next(err);
        }

        // Replace with Zod's coerced + transformed output
        req[target] = result.data;

        return next();
    };
};

module.exports = { validate };