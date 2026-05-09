// Set required env vars BEFORE any module that reads them on import
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

// The blog markdown pipeline uses dynamic import() of ESM-only modules
// (unified, remark-*, rehype-*) which Jest can't load without
// --experimental-vm-modules. Stub it to a deterministic pure-JS impl.
jest.mock("../blog/markdown.service", () => ({
    processMarkdown: async (md) => {
        const html = `<p>${String(md || "").replace(/\s+/g, " ").trim()}</p>`;
        const wordCount = String(md || "").trim().split(/\s+/).filter(Boolean).length;
        return {
            html,
            tableOfContents: [],
            wordCount,
            readingTime: Math.max(1, Math.ceil(wordCount / 200)),
        };
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
