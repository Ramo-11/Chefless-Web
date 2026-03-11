import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { vi } from "vitest";

let mongoServer: MongoMemoryServer;

// Mock Firebase Admin before any imports that use it
vi.mock("firebase-admin", () => {
  const mockVerifyIdToken = vi.fn().mockResolvedValue({
    uid: "test-firebase-uid",
    email: "test@example.com",
  });

  return {
    default: {
      apps: [{ name: "mock-app" }],
      initializeApp: vi.fn(),
      auth: () => ({
        verifyIdToken: mockVerifyIdToken,
      }),
    },
  };
});

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri);
});

afterEach(async () => {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});
