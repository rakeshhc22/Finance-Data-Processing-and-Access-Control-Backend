// =============================================================================
// src/utils/jwt.js
//
// Purpose : Sign and verify JSON Web Tokens for access and refresh flows.
//
// Exports:
//   signAccessToken(user)      → short-lived JWT (15 m by default)
//   signRefreshToken(user)     → long-lived JWT (7 d by default)
//   verifyAccessToken(token)   → decoded payload or throws
//   verifyRefreshToken(token)  → decoded payload or throws
//   ACCESS_EXPIRY              → string e.g. "15m"
//   REFRESH_EXPIRY             → string e.g. "7d"
//
// Token payload shape:
//   {
//     sub:   string  — user.id
//     email: string  — user.email
//     role:  string  — user.role (VIEWER | ANALYST | ADMIN)
//     iat:   number  — issued at
//     exp:   number  — expiry
//   }
//
// auth_service.js uses REFRESH_EXPIRY to calculate the expiresAt Date stored
// in the RefreshToken table. It does parseInt(REFRESH_EXPIRY, 10) to get the
// numeric day count — so the value must start with an integer (e.g. "7d").
// =============================================================================

"use strict";

const jwt = require("jsonwebtoken");
const env = require("../config/env");

// ---------------------------------------------------------------------------
// Expiry constants — read once from env, exported for other modules
// ---------------------------------------------------------------------------
const ACCESS_EXPIRY = env.JWT_EXPIRES_IN;         // default "15m"
const REFRESH_EXPIRY = env.JWT_REFRESH_EXPIRES_IN; // default "7d"

// ---------------------------------------------------------------------------
// Payload builder — only the fields needed for auth decisions
// ---------------------------------------------------------------------------
const buildPayload = (user) => ({
    sub: user.id,
    email: user.email,
    role: user.role,
});

// =============================================================================
// signAccessToken
//
// Signs a short-lived JWT with the access token secret.
// Returned raw to the client — stored in memory / Authorization header.
//
// @param {{ id, email, role }} user
// @returns {string} signed JWT
// =============================================================================
const signAccessToken = (user) =>
    jwt.sign(buildPayload(user), env.JWT_SECRET, {
        expiresIn: ACCESS_EXPIRY,
        algorithm: "HS256",
    });

// =============================================================================
// signRefreshToken
//
// Signs a long-lived JWT with the refresh token secret.
// The RAW token is returned to the client; only the HASH is stored in the DB.
//
// @param {{ id, email, role }} user
// @returns {string} signed JWT
// =============================================================================
const signRefreshToken = (user) =>
    jwt.sign(buildPayload(user), env.JWT_REFRESH_SECRET, {
        expiresIn: REFRESH_EXPIRY,
        algorithm: "HS256",
    });

// =============================================================================
// verifyAccessToken
//
// Verifies an access token. Throws a JsonWebTokenError or TokenExpiredError
// on failure — callers should wrap in try/catch.
//
// @param {string} token
// @returns {object} decoded payload { sub, email, role, iat, exp }
// =============================================================================
const verifyAccessToken = (token) =>
    jwt.verify(token, env.JWT_SECRET);

// =============================================================================
// verifyRefreshToken
//
// Verifies a refresh token. Throws on failure.
//
// @param {string} token
// @returns {object} decoded payload
// =============================================================================
const verifyRefreshToken = (token) =>
    jwt.verify(token, env.JWT_REFRESH_SECRET);

module.exports = {
    signAccessToken,
    signRefreshToken,
    verifyAccessToken,
    verifyRefreshToken,
    ACCESS_EXPIRY,
    REFRESH_EXPIRY,
};