import { type Client, createClient } from "@libsql/client";
import * as dotenv from "dotenv";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

dotenv.config();

const envUrl = process.env.TURSO_DATABASE_URL || "file:local.db";
const authToken =
  process.env.TURSO_API_KEY || process.env.TURSO_AUTH_TOKEN || undefined;

export const client: Client = createClient({
  url: envUrl,
  authToken,
});

export const db = drizzle(client, { schema });
