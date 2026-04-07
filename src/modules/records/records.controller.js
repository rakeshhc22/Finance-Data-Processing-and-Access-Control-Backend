// =============================================================================
// src/modules/records/records.controller.js
//
// Thin HTTP layer — extracts data from req, calls the service, sends response.
// No business logic lives here. All logic is in records.service.js.
//
// Controllers:
//   list      → GET    /records
//   getById   → GET    /records/:id
//   create    → POST   /records
//   update    → PATCH  /records/:id
//   remove    → DELETE /records/:id
// =============================================================================

const recordsService = require("./records.service");
const { sendSuccess } = require("../../utils/response");

// ---------------------------------------------------------------------------
// Helper — extract request metadata for audit logs
// ---------------------------------------------------------------------------
const getRequestMeta = (req) => ({
    ipAddress: req.ip ?? req.connection?.remoteAddress ?? null,
    userAgent: req.headers["user-agent"] ?? null,
});

// ---------------------------------------------------------------------------
// GET /api/records
// Query validated by listRecordsQuerySchema via validate middleware.
// Accessible by: VIEWER, ANALYST, ADMIN
// ---------------------------------------------------------------------------
const list = async (req, res, next) => {
    try {
        const { records, meta } = await recordsService.listRecords(req.query);

        return sendSuccess(res, 200, "Records fetched successfully.", { records }, meta);
    } catch (err) {
        return next(err);
    }
};

// ---------------------------------------------------------------------------
// GET /api/records/:id
// Param validated by recordIdParamSchema via validate middleware.
// Accessible by: VIEWER, ANALYST, ADMIN
// ---------------------------------------------------------------------------
const getById = async (req, res, next) => {
    try {
        const record = await recordsService.getRecordById(req.params.id);

        return sendSuccess(res, 200, "Record fetched successfully.", { record });
    } catch (err) {
        return next(err);
    }
};

// ---------------------------------------------------------------------------
// POST /api/records
// Body validated by createRecordSchema via validate middleware.
// ADMIN only.
// ---------------------------------------------------------------------------
const create = async (req, res, next) => {
    try {
        const record = await recordsService.createRecord(
            req.body,
            req.user,
            getRequestMeta(req)
        );

        return sendSuccess(res, 201, "Record created successfully.", { record });
    } catch (err) {
        return next(err);
    }
};

// ---------------------------------------------------------------------------
// PATCH /api/records/:id
// Param validated by recordIdParamSchema, body by updateRecordSchema.
// ADMIN only.
// ---------------------------------------------------------------------------
const update = async (req, res, next) => {
    try {
        const record = await recordsService.updateRecord(
            req.params.id,
            req.body,
            req.user,
            getRequestMeta(req)
        );

        return sendSuccess(res, 200, "Record updated successfully.", { record });
    } catch (err) {
        return next(err);
    }
};

// ---------------------------------------------------------------------------
// DELETE /api/records/:id
// Param validated by recordIdParamSchema via validate middleware.
// Performs a soft delete — sets deletedAt + deletedById on the row.
// ADMIN only.
// ---------------------------------------------------------------------------
const remove = async (req, res, next) => {
    try {
        await recordsService.deleteRecord(
            req.params.id,
            req.user,
            getRequestMeta(req)
        );

        return sendSuccess(res, 200, "Record deleted successfully.");
    } catch (err) {
        return next(err);
    }
};

module.exports = {
    list,
    getById,
    create,
    update,
    remove,
};