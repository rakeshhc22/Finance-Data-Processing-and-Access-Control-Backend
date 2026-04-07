// =============================================================================
// src/config/swagger.js
//
// Purpose : Configure and export the Swagger UI middleware and OpenAPI spec.
//           Mounted in app.js at /api-docs (UI) and /api-docs.json (raw spec).
//
// Exports : { swaggerUi, swaggerSpec, swaggerUiOptions }
// =============================================================================

"use strict";

const swaggerJsdoc = require("swagger-jsdoc");
const swaggerUi = require("swagger-ui-express");
const env = require("./env");

// =============================================================================
// OpenAPI definition — base document
// =============================================================================

const swaggerDefinition = {
    openapi: "3.0.3",
    info: {
        title: "Finance Dashboard API",
        version: "1.0.0",
        description:
            "REST API for the Finance Dashboard SaaS — manages users, " +
            "financial records, and dashboard analytics with role-based access control.",
        contact: {
            name: "Finance Dashboard",
        },
    },
    servers: [
        {
            url: `http://localhost:${env.PORT}${env.API_PREFIX}`,
            description: "Local development server",
        },
    ],
    components: {
        securitySchemes: {
            BearerAuth: {
                type: "http",
                scheme: "bearer",
                bearerFormat: "JWT",
                description: "Enter the access token returned from /auth/login or /auth/register.",
            },
        },
        schemas: {
            // ── Shared response wrappers ───────────────────────────────────
            SuccessResponse: {
                type: "object",
                properties: {
                    success: { type: "boolean", example: true },
                    message: { type: "string", example: "Operation successful." },
                    data: { type: "object" },
                },
            },
            ErrorResponse: {
                type: "object",
                properties: {
                    success: { type: "boolean", example: false },
                    message: { type: "string", example: "Something went wrong." },
                    errors: {
                        type: "array",
                        items: { type: "object" },
                    },
                },
            },
            // ── User ──────────────────────────────────────────────────────
            User: {
                type: "object",
                properties: {
                    id: { type: "string", format: "uuid" },
                    name: { type: "string" },
                    email: { type: "string", format: "email" },
                    role: { type: "string", enum: ["VIEWER", "ANALYST", "ADMIN"] },
                    status: { type: "string", enum: ["ACTIVE", "INACTIVE", "SUSPENDED"] },
                    createdAt: { type: "string", format: "date-time" },
                    updatedAt: { type: "string", format: "date-time" },
                },
            },
            // ── Financial Record ──────────────────────────────────────────
            FinancialRecord: {
                type: "object",
                properties: {
                    id: { type: "string", format: "uuid" },
                    amount: { type: "string", example: "1500.00" },
                    type: { type: "string", enum: ["INCOME", "EXPENSE"] },
                    description: { type: "string", nullable: true },
                    notes: { type: "string", nullable: true },
                    date: { type: "string", format: "date-time" },
                    reference: { type: "string", nullable: true },
                    categoryId: { type: "string", format: "uuid", nullable: true },
                    createdAt: { type: "string", format: "date-time" },
                    updatedAt: { type: "string", format: "date-time" },
                },
            },
            // ── Pagination meta ───────────────────────────────────────────
            PaginationMeta: {
                type: "object",
                properties: {
                    total: { type: "integer" },
                    page: { type: "integer" },
                    limit: { type: "integer" },
                    totalPages: { type: "integer" },
                },
            },
        },
    },
    security: [{ BearerAuth: [] }],
    tags: [
        { name: "Auth", description: "Authentication and session management" },
        { name: "Users", description: "User and role management (ADMIN only)" },
        { name: "Records", description: "Financial record CRUD" },
        { name: "Dashboard", description: "Aggregated analytics and summaries" },
    ],
};

// =============================================================================
// swagger-jsdoc options
// Scans route files for JSDoc @swagger annotations.
// =============================================================================

const options = {
    swaggerDefinition,
    apis: [
        "./src/modules/auth/auth.routes.js",
        "./src/modules/users/users.routes.js",
        "./src/modules/records/records.routes.js",
        "./src/modules/dashboard/dashboard.routes.js",
    ],
};

const swaggerSpec = swaggerJsdoc(options);

// =============================================================================
// Swagger UI customisation options
// =============================================================================

const swaggerUiOptions = {
    customSiteTitle: "Finance Dashboard API Docs",
    swaggerOptions: {
        persistAuthorization: true, // keep the JWT token across page reloads
        displayRequestDuration: true,
        filter: true,
        tryItOutEnabled: true,
    },
};

module.exports = { swaggerUi, swaggerSpec, swaggerUiOptions };