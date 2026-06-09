import mongoose from "mongoose";

let connected = false;

export async function connectDb(uri?: string): Promise<void> {
  if (connected) return;
  const mongoUri = uri ?? process.env.MONGODB_URI;
  if (!mongoUri) throw new Error("MONGODB_URI is not set");
  await mongoose.connect(mongoUri);
  connected = true;
}

export async function disconnectDb(): Promise<void> {
  if (!connected) return;
  await mongoose.disconnect();
  connected = false;
}

export { mongoose };
