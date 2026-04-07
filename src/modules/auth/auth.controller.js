// =============================================================================
// src/modules/auth/auth.controller.js
//
// Thin HTTP layer — extracts data from req, calls the service, sends response.
// No business logic lives here. All logic is in auth.service.js.
//
// Controllers:
//   register        → POST /auth/register
//   login           → POST /auth/login
//   refresh         → POST /auth/refresh
//   logout          → POST /auth/logout        (protected)
//   changePassword  → PATCH /auth/change-password (protected)
//   getMe           → GET  /auth/me             (protected)
// =============================================================================

const authService = require("./auth.service");
const { sendSuccess } = require("../../utils/response");

// ---------------------------------------------------------------------------
// Helper — extract request metadata passed to service for audit logs
// and RefreshToken session storage.
// ---------------------------------------------------------------------------
const getRequestMeta = (req) => ({
    ipAddress: req.ip ?? req.connection?.remoteAddress ?? null,
    userAgent: req.headers["user-agent"] ?? null,
});

// ---------------------------------------------------------------------------
// POST /auth/register
// Body validated by registerSchema via validate middleware.
// ---------------------------------------------------------------------------
const register = async (req, res, next) => {
    try {
        const result = await authService.registerUser(req.body, getRequestMeta(req));

        return sendSuccess(res, 201, "Account created successfully.", {
            user: result.user,
            accessToken: result.accessToken,
            refreshToken: result.refreshToken,
        });
    } catch (err) {
        return next(err);
    }
};

// ---------------------------------------------------------------------------
// POST /auth/login
// Body validated by loginSchema via validate middleware.
// ---------------------------------------------------------------------------
const login = async (req, res, next) => {
    try {
        const result = await authService.loginUser(req.body, getRequestMeta(req));

        return sendSuccess(res, 200, "Logged in successfully.", {
            user: result.user,
            accessToken: result.accessToken,
            refreshToken: result.refreshToken,
        });
    } catch (err) {
        return next(err);
    }
};

// ---------------------------------------------------------------------------
// POST /auth/refresh
// Body validated by refreshSchema via validate middleware.
// No authenticate middleware — the refresh token IS the credential here.
// ---------------------------------------------------------------------------
const refresh = async (req, res, next) => {
    try {
        const result = await authService.refreshAccessToken(
            req.body,
            getRequestMeta(req)
        );

        return sendSuccess(res, 200, "Token refreshed successfully.", {
            accessToken: result.accessToken,
            refreshToken: result.refreshToken,
        });
    } catch (err) {
        return next(err);
    }
};

// ---------------------------------------------------------------------------
// POST /auth/logout
// Protected — authenticate middleware must run before this.
// Body validated by refreshSchema (client must send the refresh token to revoke).
// ---------------------------------------------------------------------------
const logout = async (req, res, next) => {
    try {
        await authService.logoutUser(req.body, req.user, getRequestMeta(req));

        return sendSuccess(res, 200, "Logged out successfully.");
    } catch (err) {
        return next(err);
    }
};

// ---------------------------------------------------------------------------
// PATCH /auth/change-password
// Protected — authenticate middleware must run before this.
// Body validated by changePasswordSchema via validate middleware.
// ---------------------------------------------------------------------------
const changePassword = async (req, res, next) => {
    try {
        await authService.changePassword(req.body, req.user);

        return sendSuccess(
            res,
            200,
            "Password changed successfully. Please log in again on all devices."
        );
    } catch (err) {
        return next(err);
    }
};

// ---------------------------------------------------------------------------
// GET /auth/me
// Protected — authenticate middleware must run before this.
// Returns the authenticated user's own profile (fresh from DB).
// ---------------------------------------------------------------------------
const getMe = async (req, res, next) => {
    try {
        const user = await authService.getMe(req.user);

        return sendSuccess(res, 200, "Profile fetched successfully.", { user });
    } catch (err) {
        return next(err);
    }
};

module.exports = {
    register,
    login,
    refresh,
    logout,
    changePassword,
    getMe,
};