// =============================================================================
// src/utils/response.js
//
// Purpose : Provide a single sendSuccess helper that every controller uses
//           to send consistent, well-structured JSON responses.
//
// Response envelope shape:
//   {
//     success : true
//     message : string
//     data    : object | undefined   (omitted on empty responses like DELETE)
//     meta    : object | undefined   (omitted unless pagination info present)
//   }
//
// Exports:
//   sendSuccess(res, statusCode, message, data?, meta?)
//
// Usage examples:
//   sendSuccess(res, 200, "Logged out successfully.")
//   sendSuccess(res, 200, "User fetched.", { user })
//   sendSuccess(res, 200, "Users fetched.", { users }, { total, page, ... })
//   sendSuccess(res, 201, "Created.", { record })
// =============================================================================

"use strict";

// =============================================================================
// sendSuccess
//
// @param {import("express").Response} res
// @param {number}  statusCode  — HTTP status code (200, 201, etc.)
// @param {string}  message     — Human-readable success message
// @param {object}  [data]      — Optional payload (omit for 204-style responses)
// @param {object}  [meta]      — Optional metadata (pagination, totals, etc.)
// =============================================================================
const sendSuccess = (res, statusCode, message, data, meta) => {
    const body = {
        success: true,
        message,
    };

    // Only include data/meta keys if the caller provided them.
    // This keeps empty-response bodies (e.g. logout, delete) clean.
    if (data !== undefined) {
        body.data = data;
    }

    if (meta !== undefined) {
        body.meta = meta;
    }

    return res.status(statusCode).json(body);
};

module.exports = { sendSuccess };