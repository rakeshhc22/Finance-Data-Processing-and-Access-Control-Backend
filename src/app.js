// =============================================================================
// src/app.js
//
// Purpose : Create and configure the Express application.
//           This file is the single place where every middleware, route, and
//           error handler is mounted. server.js simply calls createApp() and
//           starts listening — it owns no configuration itself.
//
// Exports : createApp() — returns the configured Express app instance
// =============================================================================

"use strict";

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const compression = require("compression");

const env = require("./config/env");
const { swaggerUi, swaggerSpec, swaggerUiOptions } = require("./config/swagger");

// ── Route modules (imported once, mounted below) ────────────────────────────
// These will be uncommented automatically as each phase is built.
// For now they are referenced so app.js never needs a rewrite later.
const authRoutes = require("./modules/auth/auth.routes");
const usersRoutes = require("./modules/users/users.routes");
const recordsRoutes = require("./modules/records/records.routes");
const dashboardRoutes = require("./modules/dashboard/dashboard.routes");

// ── Global error handler (always last middleware) ───────────────────────────
const { errorMiddleware } = require("./middlewares/error.middleware");

// =============================================================================
// APP FACTORY
// =============================================================================

function createApp() {
    const app = express();

    // ===========================================================================
    // SECTION 1 — SECURITY HEADERS
    // helmet sets sensible HTTP security headers on every response.
    // contentSecurityPolicy is relaxed slightly to allow Swagger UI assets.
    // ===========================================================================
    app.use(
        helmet({
            contentSecurityPolicy: {
                directives: {
                    defaultSrc: ["'self'"],
                    scriptSrc: ["'self'", "'unsafe-inline'", "unpkg.com", "cdn.jsdelivr.net"],
                    styleSrc: ["'self'", "'unsafe-inline'"],
                    imgSrc: ["'self'", "data:", "validator.swagger.io"],
                    connectSrc: ["'self'"],
                },
            },
            // Allow Swagger UI to render in an iframe during development
            crossOriginEmbedderPolicy: env.NODE_ENV === "production",
        })
    );

    // ===========================================================================
    // SECTION 2 — CORS
    // Only origins listed in CORS_ORIGIN env variable are allowed.
    // Supports comma-separated list: "http://localhost:3000,https://prod.com"
    // ===========================================================================
    const allowedOrigins = env.CORS_ORIGIN.split(",").map((o) => o.trim());

    app.use(
        cors({
            origin: (origin, callback) => {
                // Allow requests with no origin (e.g. mobile apps, curl, Postman)
                if (!origin) return callback(null, true);
                if (allowedOrigins.includes(origin)) return callback(null, true);
                callback(new Error(`CORS: origin "${origin}" is not allowed`));
            },
            credentials: true, // allow cookies and Authorization header
            methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
            allowedHeaders: ["Content-Type", "Authorization"],
        })
    );

    // ===========================================================================
    // SECTION 3 — REQUEST PARSING
    // ===========================================================================
    app.use(express.json({ limit: "10kb" }));      // reject huge JSON payloads
    app.use(express.urlencoded({ extended: true, limit: "10kb" }));

    // ===========================================================================
    // SECTION 4 — COMPRESSION
    // gzip responses — especially useful for large record listing payloads
    // ===========================================================================
    app.use(compression());

    // ===========================================================================
    // SECTION 5 — HTTP REQUEST LOGGING
    // Development : colorful "dev" format — method, path, status, response time
    // Production  : "combined" Apache format — structured, log-aggregator friendly
    // ===========================================================================
    if (env.NODE_ENV !== "test") {
        app.use(morgan(env.NODE_ENV === "production" ? "combined" : "dev"));
    }

    // ===========================================================================
    // SECTION 6 — API DOCUMENTATION
    // Swagger UI served at /api-docs
    // Raw OpenAPI JSON at /api-docs.json (useful for Postman import)
    // ===========================================================================
    app.use(
        "/api-docs",
        swaggerUi.serve,
        swaggerUi.setup(swaggerSpec, swaggerUiOptions)
    );

    app.get("/api-docs.json", (_req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.send(swaggerSpec);
    });

    // ===========================================================================
    // SECTION 7 — HEALTH CHECK
    // A simple endpoint that load balancers and uptime monitors can ping.
    // Does not require authentication. Returns database status.
    // ===========================================================================
    app.get("/health", async (_req, res) => {
        const prisma = require("./config/db");
        let dbStatus = "ok";

        try {
            await prisma.$queryRaw`SELECT 1`;
        } catch {
            dbStatus = "unreachable";
        }

        const status = dbStatus === "ok" ? 200 : 503;
        res.status(status).json({
            success: dbStatus === "ok",
            status: dbStatus === "ok" ? "healthy" : "degraded",
            timestamp: new Date().toISOString(),
            environment: env.NODE_ENV,
            version: "1.0.0",
            services: {
                database: dbStatus,
            },
        });
    });

    // ===========================================================================
    // SECTION 8 — API ROUTES
    // All routes are prefixed with /api/v1 (configured via API_PREFIX env var).
    // ===========================================================================
    const prefix = env.API_PREFIX; // default: "/api/v1"

    app.use(`${prefix}/auth`, authRoutes);
    app.use(`${prefix}/users`, usersRoutes);
    app.use(`${prefix}/records`, recordsRoutes);
    app.use(`${prefix}/dashboard`, dashboardRoutes);

    // ===========================================================================
    // SECTION 9 — 404 HANDLER
    // Catches any request that didn't match a route above.
    // Must come after all routes but before the error handler.
    // ===========================================================================
    app.use((req, res) => {
        res.status(404).json({
            success: false,
            message: `Route not found: ${req.method} ${req.originalUrl}`,
        });
    });

    // ===========================================================================
    // SECTION 10 — GLOBAL ERROR HANDLER
    // Express identifies a 4-argument function as an error handler.
    // All errors thrown with next(err) anywhere in the app land here.
    // Must be the very last app.use() call.
    // ===========================================================================
    app.use(errorMiddleware);

    return app;
}

module.exports = createApp;