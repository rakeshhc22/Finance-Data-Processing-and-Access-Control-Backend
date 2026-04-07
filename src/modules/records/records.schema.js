// =============================================================================
// src/modules/records/records.schema.js
//
// Zod validation schemas for the records module.
//
// Schemas exported:
//   createRecordSchema      → POST   /records          (ADMIN only)
//   updateRecordSchema      → PATCH  /records/:id      (ADMIN only)
//   listRecordsQuerySchema  → GET    /records           (query params)
//   recordIdParamSchema     → every route with :id param
//
// FinancialRecord fields sourced directly from the Prisma schema:
//   amount      Decimal(12,2)    — never Float
//   type        RecordType       — INCOME | EXPENSE
//   description String?
//   notes       String?
//   date        DateTime         — real-world transaction date
//   reference   String?          — receipt / invoice number
//   categoryId  String? (UUID)   — nullable FK to Category
// =============================================================================

const { z } = require("zod");

// ---------------------------------------------------------------------------
// Reusable field definitions
// ---------------------------------------------------------------------------

// RecordType enum — exactly matches Prisma schema
const RecordTypeEnum = z.enum(["INCOME", "EXPENSE"], {
    errorMap: () => ({
        message: "type must be one of: INCOME, EXPENSE.",
    }),
});

// amount: positive number with at most 2 decimal places.
// Comes in as a number from JSON. Prisma accepts JS numbers for Decimal fields.
const amountField = z
    .number({ required_error: "amount is required.", invalid_type_error: "amount must be a number." })
    .positive("amount must be a positive number.")
    .multipleOf(0.01, "amount must have at most 2 decimal places.")
    .max(9999999999.99, "amount exceeds the maximum allowed value.");

// date: ISO 8601 string coerced to a JS Date object.
// Prisma DateTime fields accept JS Date objects.
const dateField = z
    .string({ required_error: "date is required." })
    .datetime({ message: "date must be a valid ISO 8601 datetime string (e.g. 2024-01-15T00:00:00.000Z)." })
    .transform((val) => new Date(val));

// ---------------------------------------------------------------------------
// POST /api/records
//
// ADMIN creates a new financial record.
// createdById is set from req.user.id in the service — not accepted from body.
// ---------------------------------------------------------------------------
const createRecordSchema = z.object({
    amount: amountField,
    type: RecordTypeEnum,
    date: dateField,
    description: z.string().trim().max(500, "description must not exceed 500 characters.").optional(),
    notes: z.string().trim().max(1000, "notes must not exceed 1000 characters.").optional(),
    reference: z.string().trim().max(100, "reference must not exceed 100 characters.").optional(),
    categoryId: z
        .string()
        .uuid("categoryId must be a valid UUID.")
        .optional()
        .nullable(),
});

// ---------------------------------------------------------------------------
// PATCH /api/records/:id
//
// ADMIN updates an existing record.
// All fields optional — at least one must be provided (enforced with .refine).
// type is excluded from updates intentionally:
//   Changing INCOME→EXPENSE after the fact alters financial history silently.
//   If type must change, the record should be deleted and recreated.
// ---------------------------------------------------------------------------
const updateRecordSchema = z
    .object({
        amount: amountField.optional(),
        date: dateField.optional(),
        description: z.string().trim().max(500, "description must not exceed 500 characters.").optional().nullable(),
        notes: z.string().trim().max(1000, "notes must not exceed 1000 characters.").optional().nullable(),
        reference: z.string().trim().max(100, "reference must not exceed 100 characters.").optional().nullable(),
        categoryId: z
            .string()
            .uuid("categoryId must be a valid UUID.")
            .optional()
            .nullable(),
    })
    .refine(
        (data) => Object.keys(data).length > 0,
        { message: "At least one field must be provided for update." }
    );

// ---------------------------------------------------------------------------
// GET /api/records  (query string validation)
//
// Supports:
//   type        → filter by RecordType (INCOME | EXPENSE)
//   categoryId  → filter by category UUID
//   startDate   → ISO date string — inclusive lower bound on record.date
//   endDate     → ISO date string — inclusive upper bound on record.date
//   search      → partial match on description or notes (case-insensitive)
//   page        → page number (default 1)
//   limit       → results per page (default 10, max 100)
//   sortBy      → field to sort by (default: date)
//   order       → asc | desc (default: desc)
//
// Note: all query params arrive as strings — numeric fields use .transform()
// ---------------------------------------------------------------------------
const listRecordsQuerySchema = z.object({
    type: RecordTypeEnum.optional(),

    categoryId: z
        .string()
        .uuid("categoryId must be a valid UUID.")
        .optional(),

    // Date range filters — accept ISO date strings, coerce to Date objects
    startDate: z
        .string()
        .datetime({ message: "startDate must be a valid ISO 8601 datetime string." })
        .transform((val) => new Date(val))
        .optional(),

    endDate: z
        .string()
        .datetime({ message: "endDate must be a valid ISO 8601 datetime string." })
        .transform((val) => new Date(val))
        .optional(),

    search: z.string().trim().optional(),

    page: z
        .string()
        .optional()
        .default("1")
        .transform(Number)
        .refine((v) => Number.isInteger(v) && v >= 1, {
            message: "page must be a positive integer.",
        }),

    limit: z
        .string()
        .optional()
        .default("10")
        .transform(Number)
        .refine((v) => Number.isInteger(v) && v >= 1 && v <= 100, {
            message: "limit must be between 1 and 100.",
        }),

    sortBy: z
        .enum(["date", "amount", "createdAt", "type"], {
            errorMap: () => ({
                message: "sortBy must be one of: date, amount, createdAt, type.",
            }),
        })
        .optional()
        .default("date"),

    order: z
        .enum(["asc", "desc"], {
            errorMap: () => ({ message: "order must be asc or desc." }),
        })
        .optional()
        .default("desc"),
})
    // Cross-field refinement: if both startDate and endDate provided, start <= end
    .refine(
        (data) => {
            if (data.startDate && data.endDate) {
                return data.startDate <= data.endDate;
            }
            return true;
        },
        { message: "startDate must be before or equal to endDate.", path: ["startDate"] }
    );

// ---------------------------------------------------------------------------
// Param schema — reused across all routes that accept :id
// ---------------------------------------------------------------------------
const recordIdParamSchema = z.object({
    id: z
        .string({ required_error: "Record ID is required." })
        .uuid("Record ID must be a valid UUID."),
});

module.exports = {
    createRecordSchema,
    updateRecordSchema,
    listRecordsQuerySchema,
    recordIdParamSchema,
};