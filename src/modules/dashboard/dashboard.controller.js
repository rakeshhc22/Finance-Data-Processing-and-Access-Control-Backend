// =============================================================================
// src/modules/dashboard/dashboard.controller.js
//
// Controller layer for dashboard APIs.
// Responsibilities:
//   - Parse and sanitize query parameters
//   - Call service layer
//   - Return formatted response
//
// Business logic is handled in dashboard.service.js
//
// Endpoints:
//   GET /api/dashboard/summary
//   GET /api/dashboard/by-category
//   GET /api/dashboard/trends/monthly
//   GET /api/dashboard/trends/weekly
//   GET /api/dashboard/recent
// =============================================================================

const dashboardService = require("./dashboard.service");
const { sendSuccess } = require("../../utils/response");

// ---------------------------------------------------------------------------
// Helper: Parse ISO date safely
// ---------------------------------------------------------------------------
const parseDate = (value) => {
    if (!value) return undefined;
    const date = new Date(value);
    return isNaN(date.getTime()) ? undefined : date;
};

// ---------------------------------------------------------------------------
// Helper: Parse positive integer safely
// ---------------------------------------------------------------------------
const parsePositiveInt = (value) => {
    if (value === undefined || value === null) return undefined;
    const num = parseInt(value, 10);
    return Number.isInteger(num) && num > 0 ? num : undefined;
};

// ---------------------------------------------------------------------------
// GET /api/dashboard/summary
// Returns:
//   - total income
//   - total expenses
//   - net balance
//   - record count
// ---------------------------------------------------------------------------
const summary = async (req, res, next) => {
    try {
        const filters = {
            startDate: parseDate(req.query.startDate),
            endDate: parseDate(req.query.endDate),
        };

        const data = await dashboardService.getSummary(filters);

        return sendSuccess(
            res,
            200,
            "Dashboard summary fetched successfully.",
            data
        );
    } catch (err) {
        next(err);
    }
};

// ---------------------------------------------------------------------------
// GET /api/dashboard/by-category
// Returns:
//   - category-wise totals (income + expense)
// ---------------------------------------------------------------------------
const categoryTotals = async (req, res, next) => {
    try {
        const filters = {
            startDate: parseDate(req.query.startDate),
            endDate: parseDate(req.query.endDate),
        };

        const categories = await dashboardService.getCategoryTotals(filters);

        return sendSuccess(
            res,
            200,
            "Category breakdown fetched successfully.",
            { categories }
        );
    } catch (err) {
        next(err);
    }
};

// ---------------------------------------------------------------------------
// GET /api/dashboard/trends/monthly
// Returns:
//   - income & expense grouped by month
// ---------------------------------------------------------------------------
const monthlyTrends = async (req, res, next) => {
    try {
        const year = parsePositiveInt(req.query.year);

        const trends = await dashboardService.getMonthlyTrends({ year });

        return sendSuccess(
            res,
            200,
            "Monthly trends fetched successfully.",
            { trends }
        );
    } catch (err) {
        next(err);
    }
};

// ---------------------------------------------------------------------------
// GET /api/dashboard/trends/weekly
// Returns:
//   - income & expense grouped by week
// ---------------------------------------------------------------------------
const weeklyTrends = async (req, res, next) => {
    try {
        const weeks = parsePositiveInt(req.query.weeks);

        const trends = await dashboardService.getWeeklyTrends({ weeks });

        return sendSuccess(
            res,
            200,
            "Weekly trends fetched successfully.",
            { trends }
        );
    } catch (err) {
        next(err);
    }
};

// ---------------------------------------------------------------------------
// GET /api/dashboard/recent
// Returns:
//   - latest transactions
// ---------------------------------------------------------------------------
const recentActivity = async (req, res, next) => {
    try {
        const limit = parsePositiveInt(req.query.limit);

        const records = await dashboardService.getRecentActivity({ limit });

        return sendSuccess(
            res,
            200,
            "Recent activity fetched successfully.",
            { records }
        );
    } catch (err) {
        next(err);
    }
};

module.exports = {
    summary,
    categoryTotals,
    monthlyTrends,
    weeklyTrends,
    recentActivity,
};