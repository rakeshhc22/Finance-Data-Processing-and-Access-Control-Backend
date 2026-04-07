// =============================================================================
// tests/unit/records.test.js
//
// Unit tests for src/modules/records/records.service.js
//
// Strategy:
//   - db is fully mocked — no real database
//   - Prisma Decimal behaviour is simulated with a plain object that has
//     a .toString() method (mirrors what the real Prisma client returns)
//   - Every logical branch of each service function is tested
//
// Coverage:
//   listRecords    — success (no filters), with type filter, with search
//   getRecordById  — success, not found (null), soft-deleted (null from findFirst)
//   createRecord   — success, invalid categoryId
//   updateRecord   — success, record not found, invalid new categoryId
//   deleteRecord   — success, record not found, already soft-deleted
// =============================================================================

jest.mock("../../src/config/db", () => ({
    financialRecord: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
    },
    category: {
        findUnique: jest.fn(),
    },
    auditLog: {
        create: jest.fn(),
    },
}));

const db = require("../../src/config/db");
const { AppError } = require("../../src/middlewares/error.middleware");
const recordsService = require("../../src/modules/records/records.service");

// ---------------------------------------------------------------------------
// Helper — simulate a Prisma Decimal object
// ---------------------------------------------------------------------------
const makeDecimal = (value) => ({
    toString: () => String(value),
});

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------
const mockUser = {
    id: "admin-uuid-1",
    email: "admin@example.com",
    role: "ADMIN",
};

const mockCategory = {
    id: "cat-uuid-1",
    name: "Salary",
};

const mockRecord = {
    id: "rec-uuid-1",
    amount: makeDecimal("1500.00"),
    type: "INCOME",
    description: "Monthly salary",
    notes: null,
    date: new Date("2024-03-01T00:00:00.000Z"),
    reference: null,
    categoryId: mockCategory.id,
    category: { id: mockCategory.id, name: "Salary", color: null, icon: null },
    createdById: mockUser.id,
    createdBy: { id: mockUser.id, name: "Admin", email: mockUser.email },
    deletedAt: null,
    deletedById: null,
    createdAt: new Date("2024-03-01T00:00:00.000Z"),
    updatedAt: new Date("2024-03-01T00:00:00.000Z"),
};

const meta = { ipAddress: "127.0.0.1", userAgent: "jest" };

beforeEach(() => {
    jest.clearAllMocks();
    db.auditLog.create.mockResolvedValue({});
});

// =============================================================================
// listRecords
// =============================================================================
describe("recordsService.listRecords", () => {
    const baseQuery = {
        page: 1,
        limit: 10,
        sortBy: "date",
        order: "desc",
    };

    it("should return paginated records with meta when no filters applied", async () => {
        db.financialRecord.count.mockResolvedValue(1);
        db.financialRecord.findMany.mockResolvedValue([mockRecord]);

        const result = await recordsService.listRecords(baseQuery);

        // where must always include deletedAt: null
        expect(db.financialRecord.count).toHaveBeenCalledWith(
            expect.objectContaining({ where: expect.objectContaining({ deletedAt: null }) })
        );
        expect(db.financialRecord.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ deletedAt: null }),
                skip: 0,
                take: 10,
                orderBy: { date: "desc" },
            })
        );

        expect(result.records).toHaveLength(1);
        // amount should be serialised to a string
        expect(typeof result.records[0].amount).toBe("string");
        expect(result.records[0].amount).toBe("1500.00");
        expect(result.meta).toEqual({ total: 1, page: 1, limit: 10, totalPages: 1 });
    });

    it("should add type to where clause when type filter is provided", async () => {
        db.financialRecord.count.mockResolvedValue(0);
        db.financialRecord.findMany.mockResolvedValue([]);

        await recordsService.listRecords({ ...baseQuery, type: "INCOME" });

        expect(db.financialRecord.count).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ deletedAt: null, type: "INCOME" }),
            })
        );
    });

    it("should add OR search clause when search term is provided", async () => {
        db.financialRecord.count.mockResolvedValue(0);
        db.financialRecord.findMany.mockResolvedValue([]);

        await recordsService.listRecords({ ...baseQuery, search: "salary" });

        expect(db.financialRecord.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({
                    OR: [
                        { description: { contains: "salary", mode: "insensitive" } },
                        { notes: { contains: "salary", mode: "insensitive" } },
                    ],
                }),
            })
        );
    });

    it("should compute correct skip value for page 2", async () => {
        db.financialRecord.count.mockResolvedValue(20);
        db.financialRecord.findMany.mockResolvedValue([]);

        await recordsService.listRecords({ ...baseQuery, page: 2, limit: 10 });

        expect(db.financialRecord.findMany).toHaveBeenCalledWith(
            expect.objectContaining({ skip: 10, take: 10 })
        );
    });
});

// =============================================================================
// getRecordById
// =============================================================================
describe("recordsService.getRecordById", () => {
    it("should return a serialised record when found", async () => {
        db.financialRecord.findFirst.mockResolvedValue(mockRecord);

        const result = await recordsService.getRecordById("rec-uuid-1");

        expect(db.financialRecord.findFirst).toHaveBeenCalledWith({
            where: { id: "rec-uuid-1", deletedAt: null },
            select: expect.any(Object),
        });
        expect(result.id).toBe("rec-uuid-1");
        expect(typeof result.amount).toBe("string");
        expect(result.amount).toBe("1500.00");
    });

    it("should throw AppError 404 when record is not found", async () => {
        db.financialRecord.findFirst.mockResolvedValue(null);

        await expect(recordsService.getRecordById("nonexistent-id")).rejects.toMatchObject({
            statusCode: 404,
            message: "Financial record not found.",
        });
    });

    it("should throw AppError 404 when record is soft-deleted (findFirst returns null)", async () => {
        // findFirst with { id, deletedAt: null } returns null when the record
        // exists but deletedAt is set
        db.financialRecord.findFirst.mockResolvedValue(null);

        await expect(recordsService.getRecordById("rec-uuid-1")).rejects.toMatchObject({
            statusCode: 404,
        });
    });
});

// =============================================================================
// createRecord
// =============================================================================
describe("recordsService.createRecord", () => {
    const body = {
        amount: 1500,
        type: "INCOME",
        date: new Date("2024-03-01T00:00:00.000Z"),
        description: "Monthly salary",
        categoryId: mockCategory.id,
    };

    it("should create and return a serialised record", async () => {
        db.category.findUnique.mockResolvedValue(mockCategory);
        db.financialRecord.create.mockResolvedValue(mockRecord);

        const result = await recordsService.createRecord(body, mockUser, meta);

        expect(db.category.findUnique).toHaveBeenCalledWith({ where: { id: mockCategory.id } });
        expect(db.financialRecord.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    amount: body.amount,
                    type: "INCOME",
                    createdById: mockUser.id,
                }),
            })
        );
        expect(typeof result.amount).toBe("string");
        expect(db.auditLog.create).toHaveBeenCalledTimes(1);
    });

    it("should throw AppError 404 when categoryId does not exist", async () => {
        db.category.findUnique.mockResolvedValue(null); // category not found

        await expect(recordsService.createRecord(body, mockUser, meta)).rejects.toMatchObject({
            statusCode: 404,
            message: "Category not found.",
        });
        expect(db.financialRecord.create).not.toHaveBeenCalled();
    });

    it("should skip category check when categoryId is not provided", async () => {
        const bodyNoCategory = { ...body, categoryId: undefined };
        db.financialRecord.create.mockResolvedValue({ ...mockRecord, categoryId: null });

        await recordsService.createRecord(bodyNoCategory, mockUser, meta);

        expect(db.category.findUnique).not.toHaveBeenCalled();
        expect(db.financialRecord.create).toHaveBeenCalledTimes(1);
    });
});

// =============================================================================
// updateRecord
// =============================================================================
describe("recordsService.updateRecord", () => {
    const updateBody = { description: "Updated salary" };

    it("should update and return the serialised record", async () => {
        db.financialRecord.findFirst.mockResolvedValue(mockRecord);
        const updatedRecord = { ...mockRecord, description: "Updated salary" };
        db.financialRecord.update.mockResolvedValue(updatedRecord);

        const result = await recordsService.updateRecord("rec-uuid-1", updateBody, mockUser, meta);

        expect(db.financialRecord.findFirst).toHaveBeenCalledWith({
            where: { id: "rec-uuid-1", deletedAt: null },
            select: expect.any(Object),
        });
        expect(db.financialRecord.update).toHaveBeenCalledWith({
            where: { id: "rec-uuid-1" },
            data: updateBody,
            select: expect.any(Object),
        });
        expect(result.description).toBe("Updated salary");
        expect(db.auditLog.create).toHaveBeenCalledTimes(1);
    });

    it("should throw AppError 404 when record does not exist or is soft-deleted", async () => {
        db.financialRecord.findFirst.mockResolvedValue(null);

        await expect(
            recordsService.updateRecord("nonexistent", updateBody, mockUser, meta)
        ).rejects.toMatchObject({
            statusCode: 404,
            message: "Financial record not found.",
        });
        expect(db.financialRecord.update).not.toHaveBeenCalled();
    });

    it("should throw AppError 404 when new categoryId does not exist", async () => {
        db.financialRecord.findFirst.mockResolvedValue(mockRecord);
        db.category.findUnique.mockResolvedValue(null); // new category not found

        await expect(
            recordsService.updateRecord("rec-uuid-1", { categoryId: "bad-cat-id" }, mockUser, meta)
        ).rejects.toMatchObject({
            statusCode: 404,
            message: "Category not found.",
        });
        expect(db.financialRecord.update).not.toHaveBeenCalled();
    });

    it("should skip category validation when categoryId is null (clearing category)", async () => {
        db.financialRecord.findFirst.mockResolvedValue(mockRecord);
        const updatedRecord = { ...mockRecord, categoryId: null };
        db.financialRecord.update.mockResolvedValue(updatedRecord);

        await recordsService.updateRecord("rec-uuid-1", { categoryId: null }, mockUser, meta);

        // category.findUnique must NOT be called when clearing the category
        expect(db.category.findUnique).not.toHaveBeenCalled();
        expect(db.financialRecord.update).toHaveBeenCalledTimes(1);
    });
});

// =============================================================================
// deleteRecord
// =============================================================================
describe("recordsService.deleteRecord", () => {
    it("should soft-delete the record by setting deletedAt and deletedById", async () => {
        db.financialRecord.findFirst.mockResolvedValue(mockRecord);
        db.financialRecord.update.mockResolvedValue({});

        await recordsService.deleteRecord("rec-uuid-1", mockUser, meta);

        expect(db.financialRecord.update).toHaveBeenCalledWith({
            where: { id: "rec-uuid-1" },
            data: {
                deletedAt: expect.any(Date),
                deletedById: mockUser.id,
            },
        });
        expect(db.auditLog.create).toHaveBeenCalledTimes(1);
    });

    it("should throw AppError 404 when record is not found", async () => {
        db.financialRecord.findFirst.mockResolvedValue(null);

        await expect(
            recordsService.deleteRecord("nonexistent", mockUser, meta)
        ).rejects.toMatchObject({
            statusCode: 404,
            message: "Financial record not found.",
        });
        expect(db.financialRecord.update).not.toHaveBeenCalled();
    });

    it("should throw AppError 404 when record is already soft-deleted", async () => {
        // findFirst with deletedAt: null returns null for already-deleted records
        db.financialRecord.findFirst.mockResolvedValue(null);

        await expect(
            recordsService.deleteRecord("rec-uuid-1", mockUser, meta)
        ).rejects.toMatchObject({
            statusCode: 404,
        });
    });
});