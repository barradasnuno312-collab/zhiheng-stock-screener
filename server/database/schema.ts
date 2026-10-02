/* eslint-disable */
/** auto generated, do not edit */
import { bigint, index, integer, jsonb, pgTable, text, uniqueIndex, uuid, varchar, customType } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm";

export const customTimestamptz = customType<{
  data: Date;
  driverData: string;
  config: { precision?: number };
}>({
  dataType(config) {
    const precision = typeof config?.precision !== 'undefined'
      ? ` (${config.precision})`
      : '';
    return `timestamptz${precision}`;
  },
  toDriver(value: Date | string | number) {
    if (value == null) return value as any;
    if (typeof value === 'number') return new Date(value).toISOString();
    if (typeof value === 'string') return value;
    if (value instanceof Date) return value.toISOString();
    throw new Error('Invalid timestamp value');
  },
  fromDriver(value: string | Date): Date {
    if (value instanceof Date) return value;
    return new Date(value);
  },
});

export const userProfile = customType<{
  data: string;
  driverData: string;
}>({
  dataType() {
    return 'user_profile';
  },
  toDriver(value: string) {
    return sql`ROW(${value})::user_profile`;
  },
  fromDriver(value: string) {
    const [userId] = value.slice(1, -1).split(',');
    return userId.trim();
  },
});

export type FileAttachment = {
  bucket_id: string;
  file_path: string;
};

export const fileAttachment = customType<{
  data: FileAttachment;
  driverData: string;
}>({
  dataType() {
    return 'file_attachment';
  },
  toDriver(value: FileAttachment) {
    return sql`ROW(${value.bucket_id},${value.file_path})::file_attachment`;
  },
  fromDriver(value: string): FileAttachment {
    const [bucketId, filePath] = value.slice(1, -1).split(',');
    return { bucket_id: bucketId.trim(), file_path: filePath.trim() };
  },
});

export function escapeLiteral(str: string): string {
  return "'" + str.replace(/'/g, "''") + "'";
}

export const userProfileArray = customType<{
  data: string[];
  driverData: string;
}>({
  dataType() {
    return 'user_profile[]';
  },
  toDriver(value: string[]) {
    if (!value || value.length === 0) {
      return sql`'{}'::user_profile[]`;
    }
    const elements = value.map(id => `ROW(${escapeLiteral(id)})::user_profile`).join(',');
    return sql.raw(`ARRAY[${elements}]::user_profile[]`);
  },
  fromDriver(value: string): string[] {
    if (!value || value === '{}') return [];
    const inner = value.slice(1, -1);
    const matches = inner.match(/\([^)]*\)/g) || [];
    return matches.map(m => m.slice(1, -1).split(',')[0].trim());
  },
});

export const fileAttachmentArray = customType<{
  data: FileAttachment[];
  driverData: string;
}>({
  dataType() {
    return 'file_attachment[]';
  },
  toDriver(value: FileAttachment[]) {
    if (!value || value.length === 0) {
      return sql`'{}'::file_attachment[]`;
    }
    const elements = value.map(f =>
      `ROW(${escapeLiteral(f.bucket_id)},${escapeLiteral(f.file_path)})::file_attachment`
    ).join(',');
    return sql.raw(`ARRAY[${elements}]::file_attachment[]`);
  },
  fromDriver(value: string): FileAttachment[] {
    if (!value || value === '{}') return [];
    const inner = value.slice(1, -1);
    const matches = inner.match(/\([^)]*\)/g) || [];
    return matches.map(m => {
      const [bucketId, filePath] = m.slice(1, -1).split(',');
      return { bucket_id: bucketId.trim(), file_path: filePath.trim() };
    });
  },
});

export const zhLocks = pgTable("zh_locks", {
  id: varchar("id", { length: 100 }).primaryKey(),
  holder: varchar("holder", { length: 100 }).notNull(),
  expiresMs: bigint("expires_ms", { mode: 'number' }).notNull(),
});

export const zhJobs = pgTable("zh_jobs", {
  id: uuid("id").primaryKey(),
  kind: varchar("kind", { length: 32 }).notNull(),
  ownerId: varchar("owner_id", { length: 128 }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default('pending'),
  payload: jsonb("payload").notNull(),
  result: jsonb("result"),
  progress: integer("progress").notNull().default(0),
  message: text("message").notNull(),
  createdMs: bigint("created_ms", { mode: 'number' }).notNull(),
  updatedMs: bigint("updated_ms", { mode: 'number' }).notNull(),
  leaseUntilMs: bigint("lease_until_ms", { mode: 'number' }).notNull().default(0),
}, (table) => [
  index("zh_jobs_status").on(table.status, table.createdMs),
]);

export const zhLimits = pgTable("zh_limits", {
  id: varchar("id", { length: 200 }).primaryKey(),
  used: integer("used").notNull().default(0),
  expiresMs: bigint("expires_ms", { mode: 'number' }).notNull(),
});

export const zhSessions = pgTable("zh_sessions", {
  tokenHash: varchar("token_hash", { length: 64 }).primaryKey(),
  ownerId: varchar("owner_id", { length: 128 }).notNull(),
  expiresMs: bigint("expires_ms", { mode: 'number' }).notNull(),
});

export const zhObjects = pgTable("zh_objects", {
  id: uuid("id").primaryKey(),
  kind: varchar("kind", { length: 32 }).notNull(),
  ownerId: varchar("owner_id", { length: 128 }).notNull(),
  refId: uuid("ref_id"),
  revision: integer("revision"),
  payload: jsonb("payload").notNull(),
  createdMs: bigint("created_ms", { mode: 'number' }).notNull(),
  updatedMs: bigint("updated_ms", { mode: 'number' }).notNull(),
}, (table) => [
  index("zh_objects_owner_kind").on(table.ownerId, table.kind, table.createdMs),
  index("zh_objects_ref").on(table.refId),
  uniqueIndex("zh_version_unique").on(table.kind, table.refId, table.revision),
]);

// table aliases
export const zhJobsTable = zhJobs;
export const zhLimitsTable = zhLimits;
export const zhLocksTable = zhLocks;
export const zhObjectsTable = zhObjects;
export const zhSessionsTable = zhSessions;
