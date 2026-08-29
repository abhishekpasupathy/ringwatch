/**
 * RingWatch — Neon/Postgres connection (singleton)
 *
 * Uses @neondatabase/serverless for Vercel Edge/serverless compatibility.
 * Falls back to standard postgres URL for local development.
 */

import { neon } from "@neondatabase/serverless";
import { PrismaClient } from "@prisma/client";

// Singleton Prisma client for script use (not edge runtime)
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error"] : [],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// Neon serverless SQL for API routes (edge-compatible)
export const sql = neon(process.env.DATABASE_URL!);

export default prisma;
