// =============================================================================
// src/server.js
//
// Purpose : Entry point for the Node.js process.
//           - Validates environment (via env.js import)
//           - Connects to the database
//           - Starts the HTTP server
//           - Handles graceful shutdown on SIGINT / SIGTERM
//
// Start   : node src/server.js
//           or via package.json scripts: npm run dev / npm start
// =============================================================================

"use strict";

// env.js runs its validation the moment it is imported.
// If any required variable is missing the process exits here — before anything
// else initialises — with a clear error message.
const env = require("./config/env");
const { connectDB, disconnectDB } = require("./config/db");
const createApp = require("./app");

// =============================================================================
// BOOT SEQUENCE
// =============================================================================

async function startServer() {
    console.log("\n╔══════════════════════════════════════════════════╗");
    console.log("║         Finance Dashboard API — Starting         ║");
    console.log("╚══════════════════════════════════════════════════╝\n");

    // Step 1 — Verify database is reachable before accepting any traffic
    console.log("  Connecting to database...");
    await connectDB();

    // Step 2 — Build the Express app (all middleware + routes registered)
    const app = createApp();

    // Step 3 — Start listening
    const server = app.listen(env.PORT, () => {
        console.log(`\n  ✓ Server running in ${env.NODE_ENV} mode`);
        console.log(`  ✓ API        : http://localhost:${env.PORT}${env.API_PREFIX}`);
        console.log(`  ✓ Swagger UI : http://localhost:${env.PORT}/api-docs`);
        console.log(`  ✓ Health     : http://localhost:${env.PORT}/health`);
        console.log("\n──────────────────────────────────────────────────\n");
    });

    // =============================================================================
    // GRACEFUL SHUTDOWN
    // When the process receives SIGINT (Ctrl+C) or SIGTERM (container stop /
    // process manager), we:
    //   1. Stop accepting new connections immediately
    //   2. Wait for in-flight requests to complete
    //   3. Close the database connection pool
    //   4. Exit cleanly with code 0
    //
    // This prevents dropped requests and connection pool leaks.
    // =============================================================================

    async function shutdown(signal) {
        console.log(`\n  Received ${signal} — shutting down gracefully...`);

        // Stop accepting new connections
        server.close(async () => {
            console.log("  ✓ HTTP server closed");

            // Disconnect Prisma
            await disconnectDB();

            console.log("  ✓ Shutdown complete\n");
            process.exit(0);
        });

        // Force exit after 10 seconds if something hangs
        setTimeout(() => {
            console.error("  ✗ Forced shutdown — some connections did not close");
            process.exit(1);
        }, 10_000);
    }

    process.on("SIGINT", () => shutdown("SIGINT"));   // Ctrl+C
    process.on("SIGTERM", () => shutdown("SIGTERM")); // Docker / PM2 stop

    // =============================================================================
    // UNHANDLED ERRORS
    // Log and exit — a process manager (PM2, Docker) will restart the server.
    // Never swallow these silently.
    // =============================================================================

    process.on("unhandledRejection", (reason) => {
        console.error("\n  ✗ Unhandled Promise Rejection:", reason);
        // Exit so the process manager restarts with a clean state
        process.exit(1);
    });

    process.on("uncaughtException", (error) => {
        console.error("\n  ✗ Uncaught Exception:", error.message);
        process.exit(1);
    });

    return server;
}

// =============================================================================
// START
// =============================================================================

startServer().catch((error) => {
    console.error("\n  ✗ Failed to start server:", error.message);
    process.exit(1);
});