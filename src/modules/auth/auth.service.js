// =============================================================================
// src/modules/auth/auth.service.js
//
// Business logic for every auth operation.
// Controllers call these functions and handle the HTTP layer.
//
// Functions:
//   registerUser        → create account, issue tokens
//   loginUser           → verify credentials, issue tokens
//   refreshAccessToken  → rotate refresh token, issue new access token
//   logoutUser          → delete refresh token row from DB
//   changePassword      → verify current password, hash + save new one
//   getMe               → return the authenticated user's own profile
//
// Token flow:
//   1. On login / register:
//        - Sign raw access token  (signAccessToken)
//        - Sign raw refresh token (signRefreshToken)
//        - Hash the raw refresh token (hashToken) → store hash in DB
//        - Return both raw tokens to controller → sent to client
//   2. On refresh:
//        - Verify raw refresh token signature (verifyRefreshToken)
//        - Find ALL RefreshToken rows for this user, compare each hash
//        - Delete the matched row (token rotation — old token invalidated)
//        - Issue new access + refresh token pair
//   3. On logout:
//        - Find + delete the RefreshToken row matching the raw token
//
// AuditLog entries written here:
//   LOGIN, LOGOUT, STATUS_CHANGE (indirectly, not here — in users.service)
// =============================================================================

const db = require("../../config/db");
const { hashPassword, comparePassword, hashToken, compareToken } =
    require("../../utils/hash");
const {
    signAccessToken,
    signRefreshToken,
    verifyRefreshToken,
    REFRESH_EXPIRY,
} = require("../../utils/jwt");
const { AppError } = require("../../middlewares/error.middleware");

// ---------------------------------------------------------------------------
// Helper — compute the absolute expiry Date for a new RefreshToken row.
// REFRESH_EXPIRY is "7d" so we parse it into milliseconds.
// ---------------------------------------------------------------------------
const getRefreshExpiresAt = () => {
    const days = parseInt(REFRESH_EXPIRY, 10); // "7d" → 7
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
};

// ---------------------------------------------------------------------------
// Helper — build the safe user object returned in every auth response.
// Never exposes password or internal fields.
// ---------------------------------------------------------------------------
const safeUser = (user) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt,
});

// ---------------------------------------------------------------------------
// Helper — write to AuditLog (fire-and-forget, never blocks the response).
// ---------------------------------------------------------------------------
const writeAuditLog = async ({ action, entity, entityId, userId, before, after, ipAddress, userAgent }) => {
    try {
        await db.auditLog.create({
            data: {
                action,
                entity,
                entityId,
                userId,
                before: before ?? undefined,
                after: after ?? undefined,
                ipAddress,
                userAgent,
            },
        });
    } catch (_err) {
        // Audit log failures must never crash the main flow
        console.error("[AuditLog] Failed to write entry:", _err.message);
    }
};

// =============================================================================
// registerUser
//
// Creates a new user account with the VIEWER role (schema default).
// Issues a full token pair immediately so the client is logged in on register.
//
// @param {{ name, email, password }} body   - Validated + coerced by Zod
// @param {{ userAgent?, ipAddress? }} meta  - Request metadata
// @returns {{ user, accessToken, refreshToken }}
// =============================================================================
const registerUser = async (body, meta = {}) => {
    const { name, email, password } = body;

    // ── Duplicate email check (friendlier than letting P2002 bubble up) ───────
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
            // role defaults to VIEWER, status defaults to ACTIVE (per schema)
        },
    });

    // ── Issue token pair ──────────────────────────────────────────────────────
    const accessToken = signAccessToken(user);
    const rawRefresh = signRefreshToken(user);
    const hashedRefresh = await hashToken(rawRefresh);

    await db.refreshToken.create({
        data: {
            token: hashedRefresh,
            userId: user.id,
            expiresAt: getRefreshExpiresAt(),
            userAgent: meta.userAgent ?? null,
            ipAddress: meta.ipAddress ?? null,
        },
    });

    // ── Audit ─────────────────────────────────────────────────────────────────
    await writeAuditLog({
        action: "CREATE",
        entity: "User",
        entityId: user.id,
        userId: user.id,
        before: null,
        after: safeUser(user),
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
    });

    return {
        user: safeUser(user),
        accessToken,
        refreshToken: rawRefresh,
    };
};

// =============================================================================
// loginUser
//
// Verifies credentials and issues a new token pair.
// Checks that the account is ACTIVE before issuing tokens.
//
// @param {{ email, password }} body
// @param {{ userAgent?, ipAddress? }} meta
// @returns {{ user, accessToken, refreshToken }}
// =============================================================================
const loginUser = async (body, meta = {}) => {
    const { email, password } = body;

    // ── Find user ─────────────────────────────────────────────────────────────
    const user = await db.user.findUnique({ where: { email } });

    // Intentionally the same error for "not found" and "wrong password"
    // to prevent user enumeration attacks.
    if (!user) {
        throw new AppError("Invalid email or password.", 401);
    }

    // ── Check account status before anything else ─────────────────────────────
    if (user.status === "INACTIVE") {
        throw new AppError("Your account has been deactivated. Contact an administrator.", 403);
    }
    if (user.status === "SUSPENDED") {
        throw new AppError("Your account has been suspended. Contact an administrator.", 403);
    }

    // ── Verify password ───────────────────────────────────────────────────────
    const isValid = await comparePassword(password, user.password);
    if (!isValid) {
        throw new AppError("Invalid email or password.", 401);
    }

    // ── Issue token pair ──────────────────────────────────────────────────────
    const accessToken = signAccessToken(user);
    const rawRefresh = signRefreshToken(user);
    const hashedRefresh = await hashToken(rawRefresh);

    await db.refreshToken.create({
        data: {
            token: hashedRefresh,
            userId: user.id,
            expiresAt: getRefreshExpiresAt(),
            userAgent: meta.userAgent ?? null,
            ipAddress: meta.ipAddress ?? null,
        },
    });

    // ── Audit ─────────────────────────────────────────────────────────────────
    await writeAuditLog({
        action: "LOGIN",
        entity: "User",
        entityId: user.id,
        userId: user.id,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
    });

    return {
        user: safeUser(user),
        accessToken,
        refreshToken: rawRefresh,
    };
};

// =============================================================================
// refreshAccessToken
//
// Token rotation flow:
//   1. Verify raw refresh token signature + expiry.
//   2. Load all RefreshToken rows for this user.
//   3. Find the row whose stored hash matches the raw token.
//   4. Check the row has not passed its expiresAt.
//   5. Delete the matched row (old token now invalid).
//   6. Issue a new access token + refresh token pair.
//
// @param {{ refreshToken: string }} body
// @param {{ userAgent?, ipAddress? }} meta
// @returns {{ accessToken, refreshToken }}
// =============================================================================
const refreshAccessToken = async (body, meta = {}) => {
    const { refreshToken: rawToken } = body;

    // ── 1. Verify JWT signature ───────────────────────────────────────────────
    let payload;
    try {
        payload = verifyRefreshToken(rawToken);
    } catch {
        throw new AppError("Invalid or expired refresh token.", 401);
    }

    // ── 2. Load all refresh token rows for this user ──────────────────────────
    const tokenRows = await db.refreshToken.findMany({
        where: { userId: payload.sub },
    });

    if (tokenRows.length === 0) {
        throw new AppError("Refresh token not found. Please log in again.", 401);
    }

    // ── 3. Find the matching row by comparing hashes ──────────────────────────
    let matchedRow = null;
    for (const row of tokenRows) {
        const isMatch = await compareToken(rawToken, row.token);
        if (isMatch) {
            matchedRow = row;
            break;
        }
    }

    if (!matchedRow) {
        throw new AppError("Refresh token not recognised. Please log in again.", 401);
    }

    // ── 4. Check row-level expiry (belt-and-suspenders alongside JWT expiry) ──
    if (matchedRow.expiresAt < new Date()) {
        await db.refreshToken.delete({ where: { id: matchedRow.id } });
        throw new AppError("Refresh token has expired. Please log in again.", 401);
    }

    // ── 5. Delete old token row (rotation — single use) ───────────────────────
    await db.refreshToken.delete({ where: { id: matchedRow.id } });

    // ── Confirm user still exists and is ACTIVE ───────────────────────────────
    const user = await db.user.findUnique({ where: { id: payload.sub } });
    if (!user) {
        throw new AppError("User account no longer exists.", 401);
    }
    if (user.status !== "ACTIVE") {
        throw new AppError("Your account is inactive or suspended.", 403);
    }

    // ── 6. Issue new token pair ───────────────────────────────────────────────
    const newAccessToken = signAccessToken(user);
    const newRawRefresh = signRefreshToken(user);
    const newHashedRefresh = await hashToken(newRawRefresh);

    await db.refreshToken.create({
        data: {
            token: newHashedRefresh,
            userId: user.id,
            expiresAt: getRefreshExpiresAt(),
            userAgent: meta.userAgent ?? null,
            ipAddress: meta.ipAddress ?? null,
        },
    });

    return {
        accessToken: newAccessToken,
        refreshToken: newRawRefresh,
    };
};

// =============================================================================
// logoutUser
//
// Deletes the RefreshToken row matching the provided raw token.
// If the token is not found, we still return success — idempotent logout.
//
// @param {{ refreshToken: string }} body
// @param {{ id: string }} currentUser  - from req.user (authenticate middleware)
// @param {{ userAgent?, ipAddress? }} meta
// =============================================================================
const logoutUser = async (body, currentUser, meta = {}) => {
    const { refreshToken: rawToken } = body;

    // Load all rows for this user and find the matching one
    const tokenRows = await db.refreshToken.findMany({
        where: { userId: currentUser.id },
    });

    let matchedRow = null;
    for (const row of tokenRows) {
        const isMatch = await compareToken(rawToken, row.token);
        if (isMatch) {
            matchedRow = row;
            break;
        }
    }

    if (matchedRow) {
        await db.refreshToken.delete({ where: { id: matchedRow.id } });
    }
    // If not found — already logged out. Treat as success (idempotent).

    // ── Audit ─────────────────────────────────────────────────────────────────
    await writeAuditLog({
        action: "LOGOUT",
        entity: "User",
        entityId: currentUser.id,
        userId: currentUser.id,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
    });
};

// =============================================================================
// changePassword
//
// Verifies the current password, then hashes and saves the new one.
// All existing refresh token rows for this user are deleted — forces
// re-login on all sessions after a password change.
//
// @param {{ currentPassword, newPassword }} body
// @param {{ id: string }} currentUser  - from req.user
// =============================================================================
const changePassword = async (body, currentUser) => {
    const { currentPassword, newPassword } = body;

    // ── Load full user record (need stored hash) ──────────────────────────────
    const user = await db.user.findUnique({ where: { id: currentUser.id } });
    if (!user) {
        throw new AppError("User not found.", 404);
    }

    // ── Verify current password ───────────────────────────────────────────────
    const isValid = await comparePassword(currentPassword, user.password);
    if (!isValid) {
        throw new AppError("Current password is incorrect.", 401);
    }

    // ── Hash new password ─────────────────────────────────────────────────────
    const newHashedPassword = await hashPassword(newPassword);

    // ── Update password + invalidate all sessions ─────────────────────────────
    // Using a transaction so both operations succeed or both fail atomically.
    await db.$transaction([
        db.user.update({
            where: { id: user.id },
            data: { password: newHashedPassword },
        }),
        db.refreshToken.deleteMany({
            where: { userId: user.id },
        }),
    ]);
};

// =============================================================================
// getMe
//
// Returns the authenticated user's own profile.
// Always fetches fresh data from DB (not just the JWT payload).
//
// @param {{ id: string }} currentUser  - from req.user
// @returns {object} safe user profile
// =============================================================================
const getMe = async (currentUser) => {
    const user = await db.user.findUnique({
        where: { id: currentUser.id },
        select: {
            id: true,
            name: true,
            email: true,
            role: true,
            status: true,
            createdAt: true,
            updatedAt: true,
        },
    });

    if (!user) {
        throw new AppError("User not found.", 404);
    }

    return user;
};

module.exports = {
    registerUser,
    loginUser,
    refreshAccessToken,
    logoutUser,
    changePassword,
    getMe,
};