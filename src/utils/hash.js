// =============================================================================
// src/utils/hash.js
//
// Purpose : Provide hashing utilities for passwords and tokens.
//
// Exports:
//   hashPassword(plain)         → bcrypt hash (cost factor 12)
//   comparePassword(plain, hash)→ boolean — true if match
//   hashToken(rawToken)         → SHA-256 hex string
//   compareToken(rawToken, hash)→ boolean — true if hash matches
//
// Why two different strategies?
//   Passwords  — bcrypt: intentionally slow (cost 12 ~= ~250 ms), salted,
//                resistant to brute force. Password databases are high-value
//                targets so slow hashing is a deliberate defence.
//
//   Tokens     — SHA-256: fast and deterministic. Refresh tokens are random
//                JWTs (already high entropy). We only need to protect against
//                DB compromise, not brute force. bcrypt is overkill and would
//                slow down every token rotation.
// =============================================================================

"use strict";

const bcrypt = require("bcrypt");
const crypto = require("crypto"); // built-in Node.js module — no install needed

// Cost factor for bcrypt — 12 is the industry standard for 2024+ hardware.
// At 12 rounds a single hash takes ~250 ms, making brute-force infeasible.
const BCRYPT_SALT_ROUNDS = 12;

// =============================================================================
// hashPassword
//
// Hashes a plain-text password with bcrypt.
// Auto-generates a unique salt on every call.
//
// @param {string} plain  — the raw password from the user
// @returns {Promise<string>} bcrypt hash
// =============================================================================
const hashPassword = async (plain) =>
    bcrypt.hash(plain, BCRYPT_SALT_ROUNDS);

// =============================================================================
// comparePassword
//
// Safely compares a plain password against a stored bcrypt hash.
// Uses bcrypt.compare which is timing-attack resistant.
//
// @param {string} plain  — the raw password to verify
// @param {string} hash   — the stored bcrypt hash
// @returns {Promise<boolean>}
// =============================================================================
const comparePassword = async (plain, hash) =>
    bcrypt.compare(plain, hash);

// =============================================================================
// hashToken
//
// Hashes a raw JWT refresh token with SHA-256.
// The hash is stored in the RefreshToken table; the raw token is sent to the
// client. This means a DB breach does not expose usable tokens.
//
// @param {string} rawToken  — raw refresh token string (a signed JWT)
// @returns {Promise<string>} hex-encoded SHA-256 digest
// =============================================================================
const hashToken = async (rawToken) => {
    // crypto.createHash is synchronous and fast for SHA-256 — wrap in Promise
    // only to keep a consistent async interface with the rest of this module.
    return Promise.resolve(
        crypto.createHash("sha256").update(rawToken).digest("hex")
    );
};

// =============================================================================
// compareToken
//
// Compares a raw refresh token against a stored SHA-256 hash.
// Re-hashes the raw token and does a constant-time comparison to prevent
// timing attacks.
//
// @param {string} rawToken  — the raw token sent by the client
// @param {string} storedHash — the SHA-256 hex string from the DB
// @returns {Promise<boolean>}
// =============================================================================
const compareToken = async (rawToken, storedHash) => {
    const incomingHash = crypto
        .createHash("sha256")
        .update(rawToken)
        .digest("hex");

    // crypto.timingSafeEqual requires Buffer inputs of equal length
    try {
        return crypto.timingSafeEqual(
            Buffer.from(incomingHash, "hex"),
            Buffer.from(storedHash, "hex")
        );
    } catch {
        // Length mismatch (corrupted data) — treat as no match
        return false;
    }
};

module.exports = {
    hashPassword,
    comparePassword,
    hashToken,
    compareToken,
};