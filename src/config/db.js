// =============================================================================
// src/config/db.js
//
// Purpose : Create and export a single PrismaClient instance (singleton).
//           A singleton is essential — creating multiple PrismaClient instances
//           in a Node.js process exhausts the connection pool.
//
// Usage patterns in this codebase:
//
//   1. Services (default import):
//        const db = require("../../config/db");
//        await db.user.findUnique(...)
//
//   2. server.js (named imports):
//        const { connectDB, disconnectDB } = require("./config/db");
//        await connectDB();   // before app.listen()
//        await disconnectDB();// in graceful shutdown
//
//   3. app.js health check (default import):
//        const prisma = require("./config/db");
//        await prisma.$queryRaw`SELECT 1`
//
// All three patterns work because module.exports IS the PrismaClient instance,
// and connectDB / disconnectDB are attached as properties on that same object.
// =============================================================================

"use strict";

const { PrismaClient } = require("@prisma/client");

// ---------------------------------------------------------------------------
// Singleton — reuse the same instance across all hot-reloads in development.
// In production this is just a module-level singleton (Node caches requires).
// ---------------------------------------------------------------------------

/** @type {PrismaClient} */
const prisma =
    global.__prisma ??
    new PrismaClient({
        log:
            process.env.NODE_ENV === "development"
                ? ["query", "warn", "error"]
                : ["warn", "error"],
    });

if (process.env.NODE_ENV !== "production") {
    // Cache on global so hot-reload (nodemon) doesn't create a new client
    global.__prisma = prisma;
}

// =============================================================================
// connectDB
//
// Explicitly opens the database connection and verifies reachability.
// Called once at server startup before accepting traffic.
// =============================================================================
const connectDB = async () => {
    try {
        await prisma.$connect();
        console.log("  ✓ Database connected successfully");
    } catch (error) {
        console.error("  ✗ Database connection failed:", error.message);
        throw error; // Let server.js handle the exit
    }
};

// =============================================================================
// disconnectDB
//
// Gracefully closes the Prisma connection pool.
// Called during graceful shutdown (SIGINT / SIGTERM) in server.js.
// =============================================================================
const disconnectDB = async () => {
    try {
        await prisma.$disconnect();
        console.log("  ✓ Database disconnected");
    } catch (error) {
        console.error("  ✗ Database disconnect error:", error.message);
    }
};

// ---------------------------------------------------------------------------
// Attach helpers as properties so both import patterns work:
//   const db = require("./config/db")   → db.user, db.financialRecord ...
//   const { connectDB } = require(...)  → connectDB()
// ---------------------------------------------------------------------------
prisma.connectDB = connectDB;
prisma.disconnectDB = disconnectDB;

module.exports = prisma;