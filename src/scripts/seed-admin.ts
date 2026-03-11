import mongoose from "mongoose";
import AdminUser from "../models/AdminUser";

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/chefless";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@chefless.app";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123!";
const ADMIN_NAME = process.env.ADMIN_NAME || "Admin";

async function seedAdmin() {
  await mongoose.connect(MONGODB_URI);
  console.log("Connected to MongoDB");

  const existing = await AdminUser.findOne({ email: ADMIN_EMAIL });
  if (existing) {
    console.log(`Admin user already exists: ${ADMIN_EMAIL}`);
    await mongoose.disconnect();
    return;
  }

  await AdminUser.create({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    name: ADMIN_NAME,
    role: "super_admin",
    isActive: true,
  });

  console.log(`Admin user created: ${ADMIN_EMAIL}`);
  await mongoose.disconnect();
}

seedAdmin().catch((err) => {
  console.error("Failed to seed admin:", err);
  process.exit(1);
});
