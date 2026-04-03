const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

// Set env vars needed by auth middleware
process.env.ADMIN_API_KEY = "test-secret-key";

let mongoServer;

beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await mongoose.connect(uri);
});

afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
});

afterEach(async () => {
    const collections = mongoose.connection.collections;
    for (const key in collections) {
        await collections[key].deleteMany({});
    }
});
