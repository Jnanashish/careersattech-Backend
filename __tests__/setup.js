// Set required env vars BEFORE any module that reads them on import.
// config/index.js exits the process if any of these are missing. Locally they
// come from .env via dotenv; CI (GitHub Actions) has no .env, so stub them here.
// Values are dummies — the DB is mongodb-memory-server and Firebase/Cloudinary
// are mocked below, so none of these are ever used for real connections.
process.env.DATABASE = process.env.DATABASE || "mongodb://127.0.0.1/test";
process.env.CLOUD_NAME = process.env.CLOUD_NAME || "test";
process.env.API_KEY = process.env.API_KEY || "test";
process.env.API_SECRET = process.env.API_SECRET || "test";
process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "test";
process.env.FIREBASE_PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY || "test";
process.env.FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL || "test@test.com";
process.env.ADMIN_API_KEY = "test-secret-key";
process.env.ADMIN_SECRET = "test-admin-secret";
process.env.CLICK_HASH_PEPPER = "test-pepper";
process.env.NODE_ENV = "test";

// Mock firebase-admin so config/firebase.js doesn't try to init with real creds.
// Set up before any test file requires middleware/auth.js.
jest.mock("firebase-admin", () => {
    const auth = () => ({
        verifyIdToken: jest.fn().mockRejectedValue(new Error("no firebase in tests")),
    });
    return {
        // config/firebase.js guards init with `admin.apps.length`; a non-empty
        // array means "already initialized" so initializeApp is never called.
        apps: [{ name: "[DEFAULT]" }],
        initializeApp: jest.fn(),
        credential: { cert: jest.fn() },
        auth,
    };
});

// Mock cloudinary uploader so no real network calls.
jest.mock("cloudinary", () => ({
    v2: {
        config: jest.fn(),
        uploader: {
            upload: jest.fn().mockResolvedValue({ secure_url: "https://cloudinary.test/x.jpg" }),
        },
    },
}));

const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

let mongoServer;

beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
    await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
});

afterEach(async () => {
    const collections = mongoose.connection.collections;
    for (const key in collections) {
        await collections[key].deleteMany({});
    }
});
