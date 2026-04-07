// =============================================================================
// tests/integration/api.test.js
//
// Integration tests for the Finance Dashboard REST API.
//
// Strategy:
//   - Uses supertest to fire real HTTP requests against the Express app
//   - The Prisma db client IS mocked — no real PostgreSQL connection needed
//   - Rate limiter IS mocked out to prevent 429s during test runs
//   - JWT helpers are real (uses actual signing with test secrets)
//   - Tests cover the full middleware chain:
//       rate limit → validate → authenticate → authorize → controller → service
//
// Environment:
//   Tests set process.env vars before importing the app so config/env.js
//   receives valid values.
//
// Coverage:
//   Auth routes
//     POST /api/auth/register     — 201 success, 422 missing fields, 409 duplicate
//     POST /api/auth/login        — 200 success, 422 missing fields, 401 bad creds
//     GET  /api/auth/me           — 200 success, 401 no token
//
//   Records routes
//     GET  /api/records           — 200 as VIEWER, 401 no token
//     POST /api/records           — 201 as ADMIN, 403 as VIEWER
//
//   Dashboard routes
//     GET  /api/dashboard/summary        — 200 as VIEWER
//     GET  /api/dashboard/trends/monthly — 200 as ANALYST, 403 as VIEWER
// =============================================================================

// ---------------------------------------------------------------------------
// Set environment variables BEFORE any module is imported.
// This ensures config/env.js and utils/jwt.js read the correct values.
// ---------------------------------------------------------------------------
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-access-secret-that-is-long-enough-32chars";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret-that-is-long-enough-32chars";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.PORT = "4001";

// ---------------------------------------------------------------------------
// Mock the Prisma db client — must happen before app is imported
// ---------------------------------------------------------------------------
jest.mock("../../src/config/db", () => ({
    user: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
    },
    refreshToken: {
        create: jest.fn(),
        findMany: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(),
    },
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
    $transaction: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Mock express-rate-limit to be a passthrough in tests.
// This prevents authLimiter from blocking requests after 10 hits.
// ---------------------------------------------------------------------------
jest.mock("express-rate-limit", () =>
    () => (req, res, next) => next()
);

// ---------------------------------------------------------------------------
// Imports — after mocks
// ---------------------------------------------------------------------------
const request = require("supertest");
const app = require("../../src/app");
const db = require("../../src/config/db");
const { signAccessToken } = require("../../src/utils/jwt");
const { hashPassword } = require("../../src/utils/hash");

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------
const makeUser = (overrides = {}) => ({
    id: "user-uuid-1",
    name: "Test User",
    email: "test@example.com",
    password: "hashed_password",
    role: "VIEWER",
    status: "ACTIVE",
    createdAt: new Date("2024-01-01T00:00:00.000Z"),
    updatedAt: new Date("2024-01-01T00:00:00.000Z"),
    ...overrides,
});

const makeRecord = () => ({
    id: "rec-uuid-1",
    amount: { toString: () => "1500.00" },
    type: "INCOME",
    description: "Test record",
    notes: null,
    date: new Date("2024-03-01T00:00:00.000Z"),
    reference: null,
    categoryId: null,
    category: null,
    createdById: "user-uuid-1",
    createdBy: { id: "user-uuid-1", name: "Test User", email: "test@example.com" },
    deletedAt: null,
    deletedById: null,
    createdAt: new Date("2024-03-01T00:00:00.000Z"),
    updatedAt: new Date("2024-03-01T00:00:00.000Z"),
});

// Helper — generate a real signed access token for a given user fixture
const tokenFor = (user) => signAccessToken(user);

beforeEach(() => {
    jest.clearAllMocks();
    // auditLog.create always succeeds silently
    db.auditLog.create.mockResolvedValue({});
});

// =============================================================================
// POST /api/auth/register
// =============================================================================
describe("POST /api/auth/register", () => {
    it("should return 201 and token pair on valid registration", async () => {
        const user = makeUser();
        db.user.findUnique.mockResolvedValue(null);          // no duplicate
        db.user.create.mockResolvedValue(user);
        db.refreshToken.create.mockResolvedValue({});

        const res = await request(app)
            .post("/api/auth/register")
            .send({ name: "Test User", email: "test@example.com", password: "Password1" });

        expect(res.status).toBe(201);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toHaveProperty("accessToken");
        expect(res.body.data).toHaveProperty("refreshToken");
        expect(res.body.data.user).toHaveProperty("id");
        expect(res.body.data.user).not.toHaveProperty("password");
    });

    it("should return 422 when required fields are missing", async () => {
        const res = await request(app)
            .post("/api/auth/register")
            .send({ email: "test@example.com" }); // missing name + password

        expect(res.status).toBe(422);
        expect(res.body.success).toBe(false);
        expect(Array.isArray(res.body.errors)).toBe(true);
        expect(res.body.errors.length).toBeGreaterThan(0);
    });

    it("should return 422 when password does not meet strength requirements", async () => {
        const res = await request(app)
            .post("/api/auth/register")
            .send({ name: "Test User", email: "test@example.com", password: "weak" });

        expect(res.status).toBe(422);
        expect(res.body.success).toBe(false);
    });

    it("should return 409 when email is already registered", async () => {
        db.user.findUnique.mockResolvedValue(makeUser()); // email taken

        const res = await request(app)
            .post("/api/auth/register")
            .send({ name: "Test User", email: "test@example.com", password: "Password1" });

        expect(res.status).toBe(409);
        expect(res.body.success).toBe(false);
    });
});

// =============================================================================
// POST /api/auth/login
// =============================================================================
describe("POST /api/auth/login", () => {
    it("should return 200 and token pair on valid credentials", async () => {
        const user = makeUser();
        // hashPassword is real but we mock comparePassword via the db return
        // The service calls comparePassword(plainPw, user.password)
        // We need to store a real bcrypt hash so comparePassword returns true.
        // To avoid the bcrypt overhead in integration tests, we mock hash.js here.
        jest.spyOn(require("../../src/utils/hash"), "comparePassword").mockResolvedValue(true);
        db.user.findUnique.mockResolvedValue(user);
        db.refreshToken.create.mockResolvedValue({});

        const res = await request(app)
            .post("/api/auth/login")
            .send({ email: "test@example.com", password: "Password1" });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toHaveProperty("accessToken");
        expect(res.body.data.user).not.toHaveProperty("password");
    });

    it("should return 422 when email or password is missing", async () => {
        const res = await request(app)
            .post("/api/auth/login")
            .send({ email: "test@example.com" }); // missing password

        expect(res.status).toBe(422);
        expect(res.body.success).toBe(false);
    });

    it("should return 401 when user is not found", async () => {
        db.user.findUnique.mockResolvedValue(null);

        const res = await request(app)
            .post("/api/auth/login")
            .send({ email: "nobody@example.com", password: "Password1" });

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });

    it("should return 401 when password is incorrect", async () => {
        db.user.findUnique.mockResolvedValue(makeUser());
        jest.spyOn(require("../../src/utils/hash"), "comparePassword").mockResolvedValue(false);

        const res = await request(app)
            .post("/api/auth/login")
            .send({ email: "test@example.com", password: "WrongPass1" });

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });
});

// =============================================================================
// GET /api/auth/me
// =============================================================================
describe("GET /api/auth/me", () => {
    it("should return 200 and user profile with a valid token", async () => {
        const user = makeUser();
        // authenticate middleware calls db.user.findUnique to confirm user is ACTIVE
        db.user.findUnique.mockResolvedValue(user);

        const token = tokenFor(user);

        const res = await request(app)
            .get("/api/auth/me")
            .set("Authorization", `Bearer ${token}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.user).toHaveProperty("id", user.id);
        expect(res.body.data.user).not.toHaveProperty("password");
    });

    it("should return 401 when no token is provided", async () => {
        const res = await request(app).get("/api/auth/me");

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });

    it("should return 401 when an invalid token is provided", async () => {
        const res = await request(app)
            .get("/api/auth/me")
            .set("Authorization", "Bearer this.is.not.a.valid.jwt");

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });
});

// =============================================================================
// GET /api/records
// =============================================================================
describe("GET /api/records", () => {
    it("should return 200 and records list for a VIEWER", async () => {
        const user = makeUser({ role: "VIEWER" });
        db.user.findUnique.mockResolvedValue(user);
        db.financialRecord.count.mockResolvedValue(1);
        db.financialRecord.findMany.mockResolvedValue([makeRecord()]);

        const token = tokenFor(user);

        const res = await request(app)
            .get("/api/records")
            .set("Authorization", `Bearer ${token}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(Array.isArray(res.body.data.records)).toBe(true);
        expect(res.body.meta).toHaveProperty("total", 1);
    });

    it("should return 401 when no token is provided", async () => {
        const res = await request(app).get("/api/records");

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });

    it("should return 200 for an ANALYST", async () => {
        const user = makeUser({ role: "ANALYST" });
        db.user.findUnique.mockResolvedValue(user);
        db.financialRecord.count.mockResolvedValue(0);
        db.financialRecord.findMany.mockResolvedValue([]);

        const token = tokenFor(user);

        const res = await request(app)
            .get("/api/records")
            .set("Authorization", `Bearer ${token}`);

        expect(res.status).toBe(200);
    });
});

// =============================================================================
// POST /api/records
// =============================================================================
describe("POST /api/records", () => {
    const validBody = {
        amount: 1500,
        type: "INCOME",
        date: "2024-03-01T00:00:00.000Z",
        description: "Test income",
    };

    it("should return 201 when an ADMIN creates a record", async () => {
        const admin = makeUser({ role: "ADMIN" });
        db.user.findUnique.mockResolvedValue(admin);
        db.financialRecord.create.mockResolvedValue(makeRecord());

        const token = tokenFor(admin);

        const res = await request(app)
            .post("/api/records")
            .set("Authorization", `Bearer ${token}`)
            .send(validBody);

        expect(res.status).toBe(201);
        expect(res.body.success).toBe(true);
        expect(res.body.data.record).toHaveProperty("id");
    });

    it("should return 403 when a VIEWER tries to create a record", async () => {
        const viewer = makeUser({ role: "VIEWER" });
        db.user.findUnique.mockResolvedValue(viewer);

        const token = tokenFor(viewer);

        const res = await request(app)
            .post("/api/records")
            .set("Authorization", `Bearer ${token}`)
            .send(validBody);

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
    });

    it("should return 403 when an ANALYST tries to create a record", async () => {
        const analyst = makeUser({ role: "ANALYST" });
        db.user.findUnique.mockResolvedValue(analyst);

        const token = tokenFor(analyst);

        const res = await request(app)
            .post("/api/records")
            .set("Authorization", `Bearer ${token}`)
            .send(validBody);

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
    });

    it("should return 422 when required fields are missing", async () => {
        const admin = makeUser({ role: "ADMIN" });
        db.user.findUnique.mockResolvedValue(admin);

        const token = tokenFor(admin);

        const res = await request(app)
            .post("/api/records")
            .set("Authorization", `Bearer ${token}`)
            .send({ description: "Missing amount, type, date" });

        expect(res.status).toBe(422);
        expect(res.body.success).toBe(false);
        expect(Array.isArray(res.body.errors)).toBe(true);
    });
});

// =============================================================================
// GET /api/dashboard/summary
// =============================================================================
describe("GET /api/dashboard/summary", () => {
    it("should return 200 for a VIEWER", async () => {
        const viewer = makeUser({ role: "VIEWER" });
        db.user.findUnique.mockResolvedValue(viewer);
        // dashboard.service.getSummary calls financialRecord.aggregate and count
        // These are not on our mock — we mock aggregate via the aggregate mock below
        db.financialRecord.count.mockResolvedValue(5);

        // Prisma aggregate is not on our simplified mock, so we add it here
        db.financialRecord.aggregate = jest.fn().mockResolvedValue({ _sum: { amount: null } });

        const token = tokenFor(viewer);

        const res = await request(app)
            .get("/api/dashboard/summary")
            .set("Authorization", `Bearer ${token}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toHaveProperty("totalIncome");
        expect(res.body.data).toHaveProperty("totalExpenses");
        expect(res.body.data).toHaveProperty("netBalance");
        expect(res.body.data).toHaveProperty("recordCount");
    });

    it("should return 401 when no token is provided", async () => {
        const res = await request(app).get("/api/dashboard/summary");

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });
});

// =============================================================================
// GET /api/dashboard/trends/monthly
// =============================================================================
describe("GET /api/dashboard/trends/monthly", () => {
    it("should return 200 for an ANALYST", async () => {
        const analyst = makeUser({ role: "ANALYST" });
        db.user.findUnique.mockResolvedValue(analyst);
        db.financialRecord.findMany.mockResolvedValue([]);

        const token = tokenFor(analyst);

        const res = await request(app)
            .get("/api/dashboard/trends/monthly")
            .set("Authorization", `Bearer ${token}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(Array.isArray(res.body.data.trends)).toBe(true);
        // Always returns all 12 months
        expect(res.body.data.trends).toHaveLength(12);
    });

    it("should return 403 when a VIEWER accesses monthly trends", async () => {
        const viewer = makeUser({ role: "VIEWER" });
        db.user.findUnique.mockResolvedValue(viewer);

        const token = tokenFor(viewer);

        const res = await request(app)
            .get("/api/dashboard/trends/monthly")
            .set("Authorization", `Bearer ${token}`);

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
    });

    it("should return 200 for an ADMIN", async () => {
        const admin = makeUser({ role: "ADMIN" });
        db.user.findUnique.mockResolvedValue(admin);
        db.financialRecord.findMany.mockResolvedValue([]);

        const token = tokenFor(admin);

        const res = await request(app)
            .get("/api/dashboard/trends/monthly")
            .set("Authorization", `Bearer ${token}`);

        expect(res.status).toBe(200);
    });
});