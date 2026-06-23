import { PrismaClient } from '@prisma/client';

// Single shared Prisma instance for the whole app.
export const prisma = new PrismaClient();
