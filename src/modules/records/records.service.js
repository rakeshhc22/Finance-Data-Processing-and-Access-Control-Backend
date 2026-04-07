// =============================================================================
// src/modules/records/records.service.js
//
// Business logic for the financial records module.
//
// Functions:
//   listRecords    → paginated, filtered, searchable list (soft-delete aware)
//   getRecordById  → single record by id (soft-delete aware)
//   createRecord   → ADMIN creates a record (writes CREATE audit log)
//   updateRecord   → ADMIN updates a record (writes UPDATE audit log)
//   deleteRecord   → ADMIN soft-deletes a record (writes DELETE audit log)
//
// Role access (enforced in routes + here as belt-and-suspenders):
//   VIEWER   → listRecords, getRecordById    (read only)
//   ANALYST  → listRecords, getRecordById    (read only)
//   ADMIN    → all operations
//
// Soft delete:
//   deleteRecord sets deletedAt = now() and deletedById = currentUser.id.
//   All list and single-fetch queries filter WHERE deletedAt IS NULL.
//   Records are never hard-deleted via this API.
//
// Decimal handling:
//   Prisma returns Decimal objects for amount (Decimal(12,2) field).
//   We convert to string via .toString() before returning to avoid precision
//   issues when serialising to JSON (JSON.stringify loses Decimal precision).
// =============================================================================

const db = require("../../config/db");
const { AppError } = require("../../middlewares/error.middleware");

// ---------------------------------------------------------------------------
// Helper — safe record projection used in every select/return
// Converts Prisma Decimal amount to string for safe JSON serialisation.
// ---------------------------------------------------------------------------
const RECORD_SELECT = {
    id: true,
    amount: true,
    type: true,
    description: true,
    notes: true,
    date: true,
    reference: true,
    categoryId: true,
    category: {
        select: { id: true, name: true, color: true, icon: true },
    },
    createdById: true,
    createdBy: {
        select: { id: true, name: true, email: true },
    },
    deletedAt: true,
    deletedById: true,
    createdAt: true,
    updatedAt: true,
};

// Serialise a record row — converts Prisma Decimal to string
const serialiseRecord = (record) => ({
    ...record,
    amount: record.amount.toString(),
});

// ---------------------------------------------------------------------------
// Helper — write to AuditLog (fire-and-forget, never blocks the response)
// ---------------------------------------------------------------------------
const writeAuditLog = async ({
    action,
    entity,
    entityId,
    userId,
    before,
    after,
    ipAddress,
    userAgent,
}) => {
    try {
        await db.auditLog.create({
            data: {
                action,
                entity,
                entityId,
                userId,
                before: before ?? undefined,
                after: after ?? undefined,
                ipAddress: ipAddress ?? null,
                userAgent: userAgent ?? null,
            },
        });
    } catch (_err) {
        console.error("[AuditLog] Failed to write entry:", _err.message);
    }
};

// =============================================================================
// listRecords
//
// Returns a paginated, filtered list of non-deleted records.
//
// Filters:
//   type        → RecordType enum (INCOME | EXPENSE)
//   categoryId  → UUID of a Category row
//   startDate   → lower bound on record.date (inclusive)
//   endDate     → upper bound on record.date (inclusive)
//   search      → case-insensitive partial match on description or notes
//
// Pagination + sorting via page, limit, sortBy, order.
// Returns meta: { total, page, limit, totalPages }
//
// @param {object} query  - Validated + coerced by listRecordsQuerySchema
// @returns {{ records: [], meta: {} }}
// =============================================================================
const listRecords = async (query) => {
    const { type, categoryId, startDate, endDate, search, page, limit, sortBy, order } = query;

    // ── Build where clause — always exclude soft-deleted rows ─────────────────
    const where = { deletedAt: null };

    if (type) where.type = type;
    if (categoryId) where.categoryId = categoryId;

    // Date range filter on the real-world transaction date field
    if (startDate || endDate) {
        where.date = {};
        if (startDate) where.date.gte = startDate;
        if (endDate) where.date.lte = endDate;
    }

    // Search on description or notes
    if (search) {
        where.OR = [
            { description: { contains: search, mode: "insensitive" } },
            { notes: { contains: search, mode: "insensitive" } },
        ];
    }

    // ── Pagination ────────────────────────────────────────────────────────────
    const skip = (page - 1) * limit;
    const take = limit;

    // ── Execute count + data in parallel ─────────────────────────────────────
    const [total, records] = await Promise.all([
        db.financialRecord.count({ where }),
        db.financialRecord.findMany({
            where,
            select: RECORD_SELECT,
            orderBy: { [sortBy]: order },
            skip,
            take,
        }),
    ]);

    return {
        records: records.map(serialiseRecord),
        meta: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
        },
    };
};

// =============================================================================
// getRecordById
//
// Fetches a single non-deleted record by id.
// Throws 404 if not found or already soft-deleted.
//
// @param {string} id
// @returns {object} record
// =============================================================================
const getRecordById = async (id) => {
    const record = await db.financialRecord.findFirst({
        where: { id, deletedAt: null },
        select: RECORD_SELECT,
    });

    if (!record) {
        throw new AppError("Financial record not found.", 404);
    }

    return serialiseRecord(record);
};

// =============================================================================
// createRecord
//
// ADMIN creates a new financial record.
// createdById is always set from req.user.id — never trusted from the body.
//
// @param {object} body          - Validated by createRecordSchema
// @param {object} currentUser   - req.user { id, email, role }
// @param {object} meta          - { ipAddress, userAgent }
// @returns {object} created record
// =============================================================================
const createRecord = async (body, currentUser, meta = {}) => {
    const { amount, type, date, description, notes, reference, categoryId } = body;

    // ── If categoryId provided, confirm it exists ─────────────────────────────
    if (categoryId) {
        const category = await db.category.findUnique({ where: { id: categoryId } });
        if (!category) {
            throw new AppError("Category not found.", 404);
        }
    }

    const record = await db.financialRecord.create({
        data: {
            amount,
            type,
            date,
            description: description ?? null,
            notes: notes ?? null,
            reference: reference ?? null,
            categoryId: categoryId ?? null,
            createdById: currentUser.id,
        },
        select: RECORD_SELECT,
    });

    // ── Audit ─────────────────────────────────────────────────────────────────
    await writeAuditLog({
        action: "CREATE",
        entity: "FinancialRecord",
        entityId: record.id,
        userId: currentUser.id,
        before: null,
        after: serialiseRecord(record),
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
    });

    return serialiseRecord(record);
};

// =============================================================================
// updateRecord
//
// ADMIN updates fields on an existing non-deleted record.
// type is intentionally not updatable — see records.schema.js for rationale.
//
// @param {string} id            - Record id from :id param
// @param {object} body          - Validated by updateRecordSchema
// @param {object} currentUser   - req.user
// @param {object} meta          - { ipAddress, userAgent }
// @returns {object} updated record
// =============================================================================
const updateRecord = async (id, body, currentUser, meta = {}) => {
    // ── Confirm record exists and is not soft-deleted ─────────────────────────
    const existing = await db.financialRecord.findFirst({
        where: { id, deletedAt: null },
        select: RECORD_SELECT,
    });
    if (!existing) {
        throw new AppError("Financial record not found.", 404);
    }

    // ── If categoryId is being changed, confirm the new category exists ────────
    if (body.categoryId !== undefined && body.categoryId !== null) {
        const category = await db.category.findUnique({ where: { id: body.categoryId } });
        if (!category) {
            throw new AppError("Category not found.", 404);
        }
    }

    const updated = await db.financialRecord.update({
        where: { id },
        data: body,
        select: RECORD_SELECT,
    });

    // ── Audit ─────────────────────────────────────────────────────────────────
    await writeAuditLog({
        action: "UPDATE",
        entity: "FinancialRecord",
        entityId: id,
        userId: currentUser.id,
        before: serialiseRecord(existing),
        after: serialiseRecord(updated),
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
    });

    return serialiseRecord(updated);
};

// =============================================================================
// deleteRecord
//
// ADMIN soft-deletes a record by setting deletedAt + deletedById.
// The row is never removed from the database.
// Subsequent listRecords / getRecordById calls will not return this record.
//
// @param {string} id            - Record id from :id param
// @param {object} currentUser   - req.user
// @param {object} meta          - { ipAddress, userAgent }
// =============================================================================
const deleteRecord = async (id, currentUser, meta = {}) => {
    // ── Confirm record exists and is not already soft-deleted ─────────────────
    const existing = await db.financialRecord.findFirst({
        where: { id, deletedAt: null },
        select: RECORD_SELECT,
    });
    if (!existing) {
        throw new AppError("Financial record not found.", 404);
    }

    // ── Soft delete ───────────────────────────────────────────────────────────
    await db.financialRecord.update({
        where: { id },
        data: {
            deletedAt: new Date(),
            deletedById: currentUser.id,
        },
    });

    // ── Audit ─────────────────────────────────────────────────────────────────
    await writeAuditLog({
        action: "DELETE",
        entity: "FinancialRecord",
        entityId: id,
        userId: currentUser.id,
        before: serialiseRecord(existing),
        after: null,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
    });
};

module.exports = {
    listRecords,
    getRecordById,
    createRecord,
    updateRecord,
    deleteRecord,
};