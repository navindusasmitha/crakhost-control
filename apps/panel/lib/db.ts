import { Pool } from 'pg';

declare global { var __crakhostPool: Pool | undefined }

export const db = global.__crakhostPool ?? new Pool({ connectionString: process.env.DATABASE_URL });
if (process.env.NODE_ENV !== 'production') global.__crakhostPool = db;
