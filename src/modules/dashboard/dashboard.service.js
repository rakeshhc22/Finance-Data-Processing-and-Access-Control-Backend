// =============================================================================
// src/modules/dashboard/dashboard.service.js
//
// Business logic for the dashboard module.
// All queries exclude soft-deleted records (WHERE deletedAt IS NULL).
//
// Functions:
//   getSummary          → total income, total expenses, net balance
//   getCategoryTotals   → income + expense breakdown per category
//   getMonthlyTrends    → month-by-month income vs expense for a given year
//   getWeeklyTrends     → week-by-week totals for a rolling period
//   getRecentActivity   → latest N non-deleted records
//
// Role access (enforced in routes):
//   VIEWER   → getSummary, getCategoryTotals, getRecentActivity
//   ANALYST  → all endpoints
//   ADMIN    → all endpoints
//
// Decimal handling:
//   Prisma aggregate (sum) returns Decimal objects.
//   All monetary values are returned as strings to preserve precision.
//
// Date handling:
//   All date arithmetic uses UTC to avoid timezone drift in aggregations.
// =============================================================================

const db = require("../../config/db");
const { AppError } = require("../../middlewares/error.middleware");

// ---------------------------------------------------------------------------
// Helper — convert a Prisma Decimal (or null) to a number string
// ---------------------------------------------------------------------------
const toDecimalString = (value) =>
    value === null || value === undefined ? "0.00" : value.toString();

// =============================================================================
// getSummary
//
// Returns high-level totals for the dashboard header cards:
//   totalIncome    — sum of all INCOME records
//   totalExpenses  — sum of all EXPENSE records
//   netBalance     — totalIncome - totalExpenses
//   recordCount    — total number of non-deleted records
//
// Optional filters:
//   startDate, endDate — restrict aggregation to a date range on record.date
//
// @param {{ startDate?: Date, endDate?: Date }} filters
// @returns {{ totalIncome, totalExpenses, netBalance, recordCount }}
// =============================================================================
const getSummary = async (filters = {}) => {
    const { startDate, endDate } = filters;

    // Build base where — always exclude soft-deleted rows
    const baseWhere = { deletedAt: null };

    // Optional date range on real-world transaction date
    if (startDate || endDate) {
        baseWhere.date = {};
        if (startDate) baseWhere.date.gte = startDate;
        if (endDate) baseWhere.date.lte = endDate;
    }

    // Run all three aggregations in parallel
    const [incomeResult, expenseResult, recordCount] = await Promise.all([
        db.financialRecord.aggregate({
            where: { ...baseWhere, type: "INCOME" },
            _sum: { amount: true },
        }),
        db.financialRecord.aggregate({
            where: { ...baseWhere, type: "EXPENSE" },
            _sum: { amount: true },
        }),
        db.financialRecord.count({ where: baseWhere }),
    ]);

    const totalIncome = incomeResult._sum.amount ?? 0;
    const totalExpenses = expenseResult._sum.amount ?? 0;

    // Net balance computed in JS using Decimal-safe arithmetic.
    // Prisma Decimal objects support subtraction via their library methods,
    // but since we need a plain numeric result for JSON, we parse via string.
    const netBalance = (
        parseFloat(toDecimalString(totalIncome)) -
        parseFloat(toDecimalString(totalExpenses))
    ).toFixed(2);

    return {
        totalIncome: toDecimalString(totalIncome),
        totalExpenses: toDecimalString(totalExpenses),
        netBalance,
        recordCount,
    };
};

// =============================================================================
// getCategoryTotals
//
// Returns income and expense totals grouped by category.
// Records with no category are grouped under a synthetic "Uncategorised" entry.
//
// Result shape:
//   [
//     {
//       categoryId:   string | null,
//       categoryName: string,
//       color:        string | null,
//       icon:         string | null,
//       totalIncome:  string,
//       totalExpense: string,
//       netAmount:    string,
//       recordCount:  number,
//     },
//     ...
//   ]
//
// @param {{ startDate?: Date, endDate?: Date }} filters
// @returns {Array}
// =============================================================================
const getCategoryTotals = async (filters = {}) => {
    const { startDate, endDate } = filters;

    const dateFilter = {};
    if (startDate || endDate) {
        dateFilter.date = {};
        if (startDate) dateFilter.date.gte = startDate;
        if (endDate) dateFilter.date.lte = endDate;
    }

    // Fetch all non-deleted records with their category in the date range
    const records = await db.financialRecord.findMany({
        where: { deletedAt: null, ...dateFilter },
        select: {
            type: true,
            amount: true,
            categoryId: true,
            category: {
                select: { id: true, name: true, color: true, icon: true },
            },
        },
    });

    // Group in JS — more portable than raw SQL and avoids Prisma groupBy
    // limitations with nullable foreign keys across databases.
    const map = new Map();

    for (const record of records) {
        const key = record.categoryId ?? "uncategorised";
        const name = record.category?.name ?? "Uncategorised";
        const color = record.category?.color ?? null;
        const icon = record.category?.icon ?? null;

        if (!map.has(key)) {
            map.set(key, {
                categoryId: record.categoryId ?? null,
                categoryName: name,
                color,
                icon,
                totalIncome: 0,
                totalExpense: 0,
                recordCount: 0,
            });
        }

        const entry = map.get(key);
        const amount = parseFloat(record.amount.toString());

        if (record.type === "INCOME") {
            entry.totalIncome += amount;
        } else {
            entry.totalExpense += amount;
        }
        entry.recordCount += 1;
    }

    // Convert numeric accumulators to fixed-decimal strings
    return Array.from(map.values()).map((entry) => ({
        ...entry,
        totalIncome: entry.totalIncome.toFixed(2),
        totalExpense: entry.totalExpense.toFixed(2),
        netAmount: (entry.totalIncome - entry.totalExpense).toFixed(2),
    }));
};

// =============================================================================
// getMonthlyTrends
//
// Returns month-by-month income vs expense totals for a given calendar year.
// All 12 months are always present — months with no records have 0 values.
//
// Result shape:
//   [
//     { month: 1, monthName: "Jan", totalIncome: "0.00", totalExpense: "0.00", netAmount: "0.00" },
//     ...
//   ]
//
// @param {{ year?: number }} options
//   year defaults to the current UTC year
// @returns {Array}
// =============================================================================
const getMonthlyTrends = async (options = {}) => {
    const year = options.year ?? new Date().getUTCFullYear();

    // Validate year is a reasonable calendar year
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
        throw new AppError("year must be an integer between 2000 and 2100.", 400);
    }

    const startOfYear = new Date(Date.UTC(year, 0, 1));   // Jan 1 00:00:00 UTC
    const endOfYear = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999)); // Dec 31 UTC

    const records = await db.financialRecord.findMany({
        where: {
            deletedAt: null,
            date: { gte: startOfYear, lte: endOfYear },
        },
        select: { type: true, amount: true, date: true },
    });

    // Initialise all 12 months with zero values
    const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const months = Array.from({ length: 12 }, (_, i) => ({
        month: i + 1,
        monthName: MONTH_NAMES[i],
        totalIncome: 0,
        totalExpense: 0,
    }));

    // Accumulate
    for (const record of records) {
        const monthIndex = record.date.getUTCMonth(); // 0-based
        const amount = parseFloat(record.amount.toString());
        if (record.type === "INCOME") {
            months[monthIndex].totalIncome += amount;
        } else {
            months[monthIndex].totalExpense += amount;
        }
    }

    // Serialise to fixed-decimal strings
    return months.map((m) => ({
        ...m,
        totalIncome: m.totalIncome.toFixed(2),
        totalExpense: m.totalExpense.toFixed(2),
        netAmount: (m.totalIncome - m.totalExpense).toFixed(2),
    }));
};

// =============================================================================
// getWeeklyTrends
//
// Returns week-by-week income vs expense totals for the last N weeks
// (default 12 weeks = ~3 months of weekly context).
//
// Each bucket covers a Mon–Sun ISO week aligned to UTC.
// Weeks are identified by their ISO week start date (Monday).
//
// Result shape:
//   [
//     { weekStart: "2024-01-01", weekEnd: "2024-01-07", totalIncome: "0.00", totalExpense: "0.00", netAmount: "0.00" },
//     ...
//   ]
// ordered oldest → newest.
//
// @param {{ weeks?: number }} options
//   weeks defaults to 12, max 52
// @returns {Array}
// =============================================================================
const getWeeklyTrends = async (options = {}) => {
    const weeks = options.weeks ?? 12;

    if (!Number.isInteger(weeks) || weeks < 1 || weeks > 52) {
        throw new AppError("weeks must be an integer between 1 and 52.", 400);
    }

    // Compute rolling window: from (weeks) Mondays ago to end of current week (Sunday)
    const now = new Date();

    // Find the most recent Monday (UTC)
    const dayOfWeek = now.getUTCDay(); // 0=Sun,1=Mon,...,6=Sat
    const daysSinceMon = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

    const thisMonday = new Date(Date.UTC(
        now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceMon,
        0, 0, 0, 0
    ));

    const thisSunday = new Date(thisMonday.getTime() + 6 * 24 * 60 * 60 * 1000);
    thisSunday.setUTCHours(23, 59, 59, 999);

    // Start = (weeks - 1) Mondays before thisMonday
    const windowStart = new Date(thisMonday.getTime() - (weeks - 1) * 7 * 24 * 60 * 60 * 1000);

    const records = await db.financialRecord.findMany({
        where: {
            deletedAt: null,
            date: { gte: windowStart, lte: thisSunday },
        },
        select: { type: true, amount: true, date: true },
    });

    // Build week buckets
    const buckets = [];
    for (let i = 0; i < weeks; i++) {
        const weekStart = new Date(windowStart.getTime() + i * 7 * 24 * 60 * 60 * 1000);
        const weekEnd = new Date(weekStart.getTime() + 6 * 24 * 60 * 60 * 1000);
        weekEnd.setUTCHours(23, 59, 59, 999);
        buckets.push({
            weekStart: weekStart.toISOString().split("T")[0],
            weekEnd: weekEnd.toISOString().split("T")[0],
            _start: weekStart,
            _end: weekEnd,
            totalIncome: 0,
            totalExpense: 0,
        });
    }

    // Assign records to buckets
    for (const record of records) {
        const recDate = new Date(record.date);
        const amount = parseFloat(record.amount.toString());

        for (const bucket of buckets) {
            if (recDate >= bucket._start && recDate <= bucket._end) {
                if (record.type === "INCOME") {
                    bucket.totalIncome += amount;
                } else {
                    bucket.totalExpense += amount;
                }
                break;
            }
        }
    }

    // Serialise — strip internal _start/_end helpers
    return buckets.map(({ weekStart, weekEnd, totalIncome, totalExpense }) => ({
        weekStart,
        weekEnd,
        totalIncome: totalIncome.toFixed(2),
        totalExpense: totalExpense.toFixed(2),
        netAmount: (totalIncome - totalExpense).toFixed(2),
    }));
};

// =============================================================================
// getRecentActivity
//
// Returns the N most recently created non-deleted records for a live feed.
// Default N = 10, max = 50.
//
// @param {{ limit?: number }} options
// @returns {Array} records ordered by createdAt DESC
// =============================================================================
const getRecentActivity = async (options = {}) => {
    const limit = options.limit ?? 10;

    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
        throw new AppError("limit must be an integer between 1 and 50.", 400);
    }

    const records = await db.financialRecord.findMany({
        where: { deletedAt: null },
        select: {
            id: true,
            amount: true,
            type: true,
            description: true,
            date: true,
            category: {
                select: { id: true, name: true, color: true, icon: true },
            },
            createdBy: {
                select: { id: true, name: true, email: true },
            },
            createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: limit,
    });

    // Serialise Decimal amounts to strings
    return records.map((r) => ({
        ...r,
        amount: r.amount.toString(),
    }));
};

module.exports = {
    getSummary,
    getCategoryTotals,
    getMonthlyTrends,
    getWeeklyTrends,
    getRecentActivity,
};