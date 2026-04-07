// =============================================================================
// tests/unit/auth.test.js
//
// Unit tests for src/modules/auth/auth.service.js
//
// Strategy:
//   - All external dependencies (db, hash, jwt) are mocked with jest.mock()
//   - No real database, no real bcrypt, no real JWT signing
//   - Every test describes one logical branch of the service function
//
// Coverage:
//   registerUser       — success, duplicate email
//   loginUser          — success, user not found, inactive, suspended, wrong password
//   refreshAccessToken — success, invalid JWT, no rows, no match, expired row
//   logoutUser         — success (token found), success (token not found / idempotent)
//   changePassword     — success, user not found, wrong current password
//   getMe              — success, user not found
// =============================================================================

// ---------------------------------------------------------------------------
// Mock all external dependencies BEFORE importing the module under test.
// jest.mock() is hoisted to the top of the file by Jest automatically.
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
    auditLog: {
        create: jest.fn(),
    },
    $transaction: jest.fn(),
}));

jest.mock("../../src/utils/hash", () => ({
    hashPassword: jest.fn(),
    comparePassword: jest.fn(),
    hashToken: jest.fn(),
    compareToken: jest.fn(),
}));

jest.mock("../../src/utils/jwt", () => ({
    signAccessToken: jest.fn(),
    signRefreshToken: jest.fn(),
    verifyRefreshToken: jest.fn(),
    REFRESH_EXPIRY: "7d",
}));

// ---------------------------------------------------------------------------
// Imports — after mocks are registered
// ---------------------------------------------------------------------------
const db = require("../../src/config/db");
const { hashPassword, comparePassword, hashToken, compareToken } = require("../../src/utils/hash");
const { signAccessToken, signRefreshToken, verifyRefreshToken } = require("../../src/utils/jwt");
const { AppError } = require("../../src/middlewares/error.middleware");
const authService = require("../../src/modules/auth/auth.service");

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------
const mockUser = {
    id: "user-uuid-1",
    name: "Test User",
    email: "test@example.com",
    password: "hashed_password",
    role: "VIEWER",
    status: "ACTIVE",
    createdAt: new Date("2024-01-01T00:00:00.000Z"),
    updatedAt: new Date("2024-01-01T00:00:00.000Z"),
};

const mockRefreshTokenRow = {
    id: "rt-uuid-1",
    token: "hashed_refresh_token",
    userId: mockUser.id,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
    userAgent: null,
    ipAddress: null,
    createdAt: new Date(),
};

// ---------------------------------------------------------------------------
// Reset all mocks before each test so call counts don't bleed across tests
// ---------------------------------------------------------------------------
beforeEach(() => {
    jest.clearAllMocks();
    // Default auditLog.create to resolve silently
    db.auditLog.create.mockResolvedValue({});
});

// =============================================================================
// registerUser
// =============================================================================
describe("authService.registerUser", () => {
    const body = { name: "Test User", email: "test@example.com", password: "Password1" };
    const meta = { ipAddress: "127.0.0.1", userAgent: "jest" };

    it("should register a new user and return user + token pair", async () => {
        db.user.findUnique.mockResolvedValue(null);          // no duplicate
        db.user.create.mockResolvedValue(mockUser);
        hashPassword.mockResolvedValue("hashed_password");
        signAccessToken.mockReturnValue("access_token");
        signRefreshToken.mockReturnValue("raw_refresh_token");
        hashToken.mockResolvedValue("hashed_refresh_token");
        db.refreshToken.create.mockResolvedValue({});

        const result = await authService.registerUser(body, meta);

        expect(db.user.findUnique).toHaveBeenCalledWith({ where: { email: body.email } });
        expect(hashPassword).toHaveBeenCalledWith(body.password);
        expect(db.user.create).toHaveBeenCalledTimes(1);
        expect(signAccessToken).toHaveBeenCalledWith(mockUser);
        expect(signRefreshToken).toHaveBeenCalledWith(mockUser);
        expect(hashToken).toHaveBeenCalledWith("raw_refresh_token");
        expect(db.refreshToken.create).toHaveBeenCalledTimes(1);

        expect(result).toHaveProperty("accessToken", "access_token");
        expect(result).toHaveProperty("refreshToken", "raw_refresh_token");
        expect(result.user).toMatchObject({
            id: mockUser.id,
            email: mockUser.email,
            role: mockUser.role,
        });
        // password must never appear in the returned user object
        expect(result.user).not.toHaveProperty("password");
    });

    it("should throw AppError 409 when email already exists", async () => {
        db.user.findUnique.mockResolvedValue(mockUser); // email taken

        await expect(authService.registerUser(body, meta)).rejects.toThrow(AppError);
        await expect(authService.registerUser(body, meta)).rejects.toMatchObject({
            statusCode: 409,
            message: "An account with this email already exists.",
        });

        expect(db.user.create).not.toHaveBeenCalled();
    });
});

// =============================================================================
// loginUser
// =============================================================================
describe("authService.loginUser", () => {
    const body = { email: "test@example.com", password: "Password1" };
    const meta = { ipAddress: "127.0.0.1", userAgent: "jest" };

    it("should login successfully and return user + token pair", async () => {
        db.user.findUnique.mockResolvedValue(mockUser);
        comparePassword.mockResolvedValue(true);
        signAccessToken.mockReturnValue("access_token");
        signRefreshToken.mockReturnValue("raw_refresh_token");
        hashToken.mockResolvedValue("hashed_refresh_token");
        db.refreshToken.create.mockResolvedValue({});

        const result = await authService.loginUser(body, meta);

        expect(comparePassword).toHaveBeenCalledWith(body.password, mockUser.password);
        expect(result).toHaveProperty("accessToken", "access_token");
        expect(result).toHaveProperty("refreshToken", "raw_refresh_token");
        expect(result.user).not.toHaveProperty("password");
    });

    it("should throw AppError 401 when user is not found", async () => {
        db.user.findUnique.mockResolvedValue(null);

        await expect(authService.loginUser(body, meta)).rejects.toMatchObject({
            statusCode: 401,
            message: "Invalid email or password.",
        });
        expect(comparePassword).not.toHaveBeenCalled();
    });

    it("should throw AppError 403 when user status is INACTIVE", async () => {
        db.user.findUnique.mockResolvedValue({ ...mockUser, status: "INACTIVE" });

        await expect(authService.loginUser(body, meta)).rejects.toMatchObject({
            statusCode: 403,
        });
        expect(comparePassword).not.toHaveBeenCalled();
    });

    it("should throw AppError 403 when user status is SUSPENDED", async () => {
        db.user.findUnique.mockResolvedValue({ ...mockUser, status: "SUSPENDED" });

        await expect(authService.loginUser(body, meta)).rejects.toMatchObject({
            statusCode: 403,
        });
        expect(comparePassword).not.toHaveBeenCalled();
    });

    it("should throw AppError 401 when password does not match", async () => {
        db.user.findUnique.mockResolvedValue(mockUser);
        comparePassword.mockResolvedValue(false);

        await expect(authService.loginUser(body, meta)).rejects.toMatchObject({
            statusCode: 401,
            message: "Invalid email or password.",
        });
        expect(signAccessToken).not.toHaveBeenCalled();
    });
});

// =============================================================================
// refreshAccessToken
// =============================================================================
describe("authService.refreshAccessToken", () => {
    const body = { refreshToken: "raw_refresh_token" };
    const meta = { ipAddress: "127.0.0.1", userAgent: "jest" };

    it("should rotate refresh token and return new token pair", async () => {
        verifyRefreshToken.mockReturnValue({ sub: mockUser.id });
        db.refreshToken.findMany.mockResolvedValue([mockRefreshTokenRow]);
        compareToken.mockResolvedValue(true);
        db.refreshToken.delete.mockResolvedValue({});
        db.user.findUnique.mockResolvedValue(mockUser);
        signAccessToken.mockReturnValue("new_access_token");
        signRefreshToken.mockReturnValue("new_raw_refresh");
        hashToken.mockResolvedValue("new_hashed_refresh");
        db.refreshToken.create.mockResolvedValue({});

        const result = await authService.refreshAccessToken(body, meta);

        expect(verifyRefreshToken).toHaveBeenCalledWith("raw_refresh_token");
        expect(db.refreshToken.findMany).toHaveBeenCalledWith({ where: { userId: mockUser.id } });
        expect(compareToken).toHaveBeenCalledWith("raw_refresh_token", mockRefreshTokenRow.token);
        expect(db.refreshToken.delete).toHaveBeenCalledWith({ where: { id: mockRefreshTokenRow.id } });
        expect(db.refreshToken.create).toHaveBeenCalledTimes(1);
        expect(result).toEqual({ accessToken: "new_access_token", refreshToken: "new_raw_refresh" });
    });

    it("should throw AppError 401 when JWT signature is invalid", async () => {
        verifyRefreshToken.mockImplementation(() => { throw new Error("jwt malformed"); });

        await expect(authService.refreshAccessToken(body, meta)).rejects.toMatchObject({
            statusCode: 401,
            message: "Invalid or expired refresh token.",
        });
    });

    it("should throw AppError 401 when no token rows exist for user", async () => {
        verifyRefreshToken.mockReturnValue({ sub: mockUser.id });
        db.refreshToken.findMany.mockResolvedValue([]);

        await expect(authService.refreshAccessToken(body, meta)).rejects.toMatchObject({
            statusCode: 401,
            message: "Refresh token not found. Please log in again.",
        });
    });

    it("should throw AppError 401 when no row hash matches the token", async () => {
        verifyRefreshToken.mockReturnValue({ sub: mockUser.id });
        db.refreshToken.findMany.mockResolvedValue([mockRefreshTokenRow]);
        compareToken.mockResolvedValue(false); // no match

        await expect(authService.refreshAccessToken(body, meta)).rejects.toMatchObject({
            statusCode: 401,
            message: "Refresh token not recognised. Please log in again.",
        });
    });

    it("should throw AppError 401 when matched row has expired", async () => {
        const expiredRow = {
            ...mockRefreshTokenRow,
            expiresAt: new Date(Date.now() - 1000), // already past
        };
        verifyRefreshToken.mockReturnValue({ sub: mockUser.id });
        db.refreshToken.findMany.mockResolvedValue([expiredRow]);
        compareToken.mockResolvedValue(true);
        db.refreshToken.delete.mockResolvedValue({});

        await expect(authService.refreshAccessToken(body, meta)).rejects.toMatchObject({
            statusCode: 401,
            message: "Refresh token has expired. Please log in again.",
        });
        // The expired row must be deleted
        expect(db.refreshToken.delete).toHaveBeenCalledWith({ where: { id: expiredRow.id } });
    });
});

// =============================================================================
// logoutUser
// =============================================================================
describe("authService.logoutUser", () => {
    const body = { refreshToken: "raw_refresh_token" };
    const currentUser = { id: mockUser.id };
    const meta = { ipAddress: "127.0.0.1", userAgent: "jest" };

    it("should delete the matching refresh token row and write audit log", async () => {
        db.refreshToken.findMany.mockResolvedValue([mockRefreshTokenRow]);
        compareToken.mockResolvedValue(true);
        db.refreshToken.delete.mockResolvedValue({});

        await authService.logoutUser(body, currentUser, meta);

        expect(db.refreshToken.delete).toHaveBeenCalledWith({ where: { id: mockRefreshTokenRow.id } });
        expect(db.auditLog.create).toHaveBeenCalledTimes(1);
    });

    it("should succeed idempotently when no matching token row is found", async () => {
        db.refreshToken.findMany.mockResolvedValue([mockRefreshTokenRow]);
        compareToken.mockResolvedValue(false); // no match

        // Should not throw
        await expect(authService.logoutUser(body, currentUser, meta)).resolves.toBeUndefined();
        expect(db.refreshToken.delete).not.toHaveBeenCalled();
        // Audit log is still written
        expect(db.auditLog.create).toHaveBeenCalledTimes(1);
    });
});

// =============================================================================
// changePassword
// =============================================================================
describe("authService.changePassword", () => {
    const body = { currentPassword: "OldPass1", newPassword: "NewPass1" };
    const currentUser = { id: mockUser.id };

    it("should update password and invalidate all sessions atomically", async () => {
        db.user.findUnique.mockResolvedValue(mockUser);
        comparePassword.mockResolvedValue(true);
        hashPassword.mockResolvedValue("new_hashed_password");
        db.$transaction.mockResolvedValue([]);

        await authService.changePassword(body, currentUser);

        expect(comparePassword).toHaveBeenCalledWith(body.currentPassword, mockUser.password);
        expect(hashPassword).toHaveBeenCalledWith(body.newPassword);
        expect(db.$transaction).toHaveBeenCalledTimes(1);
        // Verify transaction array contains update + deleteMany calls
        const txArgs = db.$transaction.mock.calls[0][0];
        expect(Array.isArray(txArgs)).toBe(true);
        expect(txArgs).toHaveLength(2);
    });

    it("should throw AppError 404 when user does not exist", async () => {
        db.user.findUnique.mockResolvedValue(null);

        await expect(authService.changePassword(body, currentUser)).rejects.toMatchObject({
            statusCode: 404,
            message: "User not found.",
        });
        expect(comparePassword).not.toHaveBeenCalled();
    });

    it("should throw AppError 401 when current password is incorrect", async () => {
        db.user.findUnique.mockResolvedValue(mockUser);
        comparePassword.mockResolvedValue(false);

        await expect(authService.changePassword(body, currentUser)).rejects.toMatchObject({
            statusCode: 401,
            message: "Current password is incorrect.",
        });
        expect(hashPassword).not.toHaveBeenCalled();
        expect(db.$transaction).not.toHaveBeenCalled();
    });
});

// =============================================================================
// getMe
// =============================================================================
describe("authService.getMe", () => {
    const currentUser = { id: mockUser.id };

    it("should return the authenticated user profile", async () => {
        const safeProfile = {
            id: mockUser.id,
            name: mockUser.name,
            email: mockUser.email,
            role: mockUser.role,
            status: mockUser.status,
            createdAt: mockUser.createdAt,
            updatedAt: mockUser.updatedAt,
        };
        db.user.findUnique.mockResolvedValue(safeProfile);

        const result = await authService.getMe(currentUser);

        expect(db.user.findUnique).toHaveBeenCalledWith({
            where: { id: currentUser.id },
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                status: true,
                createdAt: true,
                updatedAt: true,
            },
        });
        expect(result).toMatchObject({ id: mockUser.id, email: mockUser.email });
        expect(result).not.toHaveProperty("password");
    });

    it("should throw AppError 404 when user does not exist", async () => {
        db.user.findUnique.mockResolvedValue(null);

        await expect(authService.getMe(currentUser)).rejects.toMatchObject({
            statusCode: 404,
            message: "User not found.",
        });
    });
});