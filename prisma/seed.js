// =============================================================================
// prisma/seed.js
//
// Purpose : Seed the database with:
//   1. A default ADMIN user (for first-time login)
//   2. A set of system-level Category rows (visible to all users)
//
// Run with: npx prisma db seed
//           (configured in package.json under "prisma.seed")
//
// This script is idempotent — it uses upsert so running it multiple times
// will not create duplicate rows.
// =============================================================================

"use strict";

const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcrypt");

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// System categories — created once, not owned by any user (userId = null)
// ---------------------------------------------------------------------------
const SYSTEM_CATEGORIES = [
    { name: "Salary", description: "Employment income", color: "#22c55e", icon: "briefcase" },
    { name: "Freelance", description: "Freelance / contract income", color: "#16a34a", icon: "laptop" },
    { name: "Investment", description: "Dividends, interest, returns", color: "#15803d", icon: "trending-up" },
    { name: "Food", description: "Groceries and dining", color: "#ef4444", icon: "utensils" },
    { name: "Transport", description: "Fuel, public transit, taxi", color: "#f97316", icon: "car" },
    { name: "Utilities", description: "Electricity, water, internet", color: "#eab308", icon: "zap" },
    { name: "Rent", description: "Rent and mortgage payments", color: "#8b5cf6", icon: "home" },
    { name: "Healthcare", description: "Medical and pharmacy", color: "#06b6d4", icon: "heart" },
    { name: "Education", description: "Courses, books, subscriptions", color: "#3b82f6", icon: "book-open" },
    { name: "Entertainment", description: "Movies, streaming, hobbies", color: "#ec4899", icon: "music" },
    { name: "Shopping", description: "Clothing and personal items", color: "#f59e0b", icon: "shopping-bag" },
    { name: "Other", description: "Miscellaneous", color: "#6b7280", icon: "more-horizontal" },
];

async function main() {
    console.log("\n  Seeding database...\n");

    // ── 1. Create default ADMIN user ─────────────────────────────────────────
    const adminEmail = "admin@financedashboard.com";
    const adminPassword = "Admin@1234"; // Change this after first login!

    const hashedPassword = await bcrypt.hash(adminPassword, 12);

    const admin = await prisma.user.upsert({
        where: { email: adminEmail },
        update: {},
        create: {
            name: "Super Admin",
            email: adminEmail,
            password: hashedPassword,
            role: "ADMIN",
            status: "ACTIVE",
        },
    });

    console.log(`  ✓ Admin user: ${admin.email}  (password: ${adminPassword})`);
    console.log("    ⚠️  Change this password immediately after first login!\n");

    // ── 2. Upsert system categories ──────────────────────────────────────────
    // Prisma's upsert requires a unique where clause. The @@unique([name, userId])
    // constraint cannot be used in upsert's `where` when userId is null (Prisma
    // limitation with nullable FK fields). We use findFirst + create/update instead.
    let categoryCount = 0;

    for (const cat of SYSTEM_CATEGORIES) {
        const existing = await prisma.category.findFirst({
            where: { name: cat.name, userId: null },
        });

        if (!existing) {
            await prisma.category.create({
                data: {
                    name: cat.name,
                    description: cat.description,
                    color: cat.color,
                    icon: cat.icon,
                    isSystem: true,
                    userId: null,
                },
            });
            categoryCount++;
        } else {
            // Update metadata in case seed is re-run with new values
            await prisma.category.update({
                where: { id: existing.id },
                data: {
                    description: cat.description,
                    color: cat.color,
                    icon: cat.icon,
                },
            });
        }
    }

    console.log(`  ✓ System categories seeded: ${SYSTEM_CATEGORIES.length} (${categoryCount} new)`);
    console.log("\n  Seeding complete!\n");
}

main()
    .catch((err) => {
        console.error("  ✗ Seed failed:", err);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });