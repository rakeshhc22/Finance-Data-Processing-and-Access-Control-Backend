// =============================================================================
// src/middlewares/auth.middleware.js
//
// Purpose : Protect routes by verifying the JWT access token sent in the
//           Authorization header. On success, attaches req.user for downstream
//           controllers and services to use.
//
// Exports:
//   authenticate — Express middleware that validates Bearer tokens
//
// Usage in routes:
//   router.use(authenticate)            — protect all routes in a file
//   router.get("/me", authenticate, ...) — protect a single route
//
// Token format expected in request:
//   Authorization: Bearer <access_token>
//
// On success:
//   req.user = { id, email, role, iat, exp }  (decoded JWT payload)
//
// On failure:
//   Calls next(AppError) → caught by errorMiddleware → 401 JSON response
//
// Note: This middleware validates the ACCESS token only.
//       Refresh token validation is handled in auth.service.js (refreshAccessToken).
// =============================================================================

"use strict";

const { verifyAccessToken } = require("../utils/jwt");
const { AppError } = require("./error.middleware");
const db = require("../config/db");

// =============================================================================
// authenticate
//
// Extracts the Bearer token from the Authorization header, verifies it, then
// performs a lightweight DB check to ensure the user still exists and is ACTIVE.
//
// The DB check costs one extra query per request but is important because:
//   - Users can be SUSPENDED / INACTIVE after a token was issued.
//   - The JWT would otherwise remain valid until its natural expiry.
//   - For a finance dashboard, this security guarantee is worth the cost.
//
// If you prioritise performance over this guarantee, you can remove the DB
// check and rely solely on JWT verification + short expiry.
// =============================================================================
const authenticate = async (req, res, next) => {
    try {
        // ── 1. Extract token from header ──────────────────────────────────────
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return next(
                new AppError("Access token is missing. Please log in.", 401)
            );
        }

        const token = authHeader.slice(7); // Remove "Bearer " prefix

        if (!token) {
            return next(
                new AppError("Access token is missing. Please log in.", 401)
            );
        }

        // ── 2. Verify JWT signature + expiry ──────────────────────────────────
        let payload;
        try {
            payload = verifyAccessToken(token);
        } catch (jwtError) {
            // Let the errorMiddleware handle JsonWebTokenError / TokenExpiredError
            return next(jwtError);
        }

        // ── 3. Confirm user still exists and is ACTIVE ────────────────────────
        const user = await db.user.findUnique({
            where: { id: payload.sub },
            select: {
                id: true,
                email: true,
                role: true,
                status: true,
            },
        });

        if (!user) {
            return next(
                new AppError("The user associated with this token no longer exists.", 401)
            );
        }

        if (user.status === "INACTIVE") {
            return next(
                new AppError("Your account has been deactivated. Contact an administrator.", 403)
            );
        }

        if (user.status === "SUSPENDED") {
            return next(
                new AppError("Your account has been suspended. Contact an administrator.", 403)
            );
        }

        // ── 4. Attach user to request ─────────────────────────────────────────
        // Downstream controllers/services access the authenticated user via req.user.
        req.user = {
            id: user.id,
            email: user.email,
            role: user.role,
        };

        return next();
    } catch (err) {
        return next(err);
    }
};

module.exports = { authenticate };