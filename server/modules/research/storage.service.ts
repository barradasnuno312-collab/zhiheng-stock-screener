import { Inject, Injectable, NotFoundException, HttpException } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { and, desc, eq, gt, lt, or, sql } from 'drizzle-orm';
import { zhJobs, zhLimits, zhLocks, zhObjects, zhSessions } from '../../database/schema';

export type ObjectRow = typeof zhObjects.$inferSelect;
export type JobRow = typeof zhJobs.$inferSelect;
export type JobInsert = typeof zhJobs.$inferInsert;

@Injectable()
export class StorageService {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  async insertObject(
    id: string, kind: string, ownerId: string, payload: unknown, refId?: string, revision?: number,
  ): Promise<void> {
    await this.db.insert(zhObjects).values({
      id, kind, ownerId, payload, refId, revision, createdMs: Date.now(), updatedMs: Date.now(),
    }).onConflictDoNothing({ target: zhObjects.id });
  }
  async getObject<T>(id: string, kind: string, ownerId: string): Promise<T> {
    const rows: ObjectRow[] = await this.db.select().from(zhObjects)
      .where(and(eq(zhObjects.id, id), eq(zhObjects.kind, kind), eq(zhObjects.ownerId, ownerId))).limit(1);
    if (!rows[0]) throw new NotFoundException('记录不存在或不属于当前访客');
    return rows[0].payload as T;
  }
  async listObjects<T>(kind: string, ownerId?: string, refId?: string, limit = 100): Promise<T[]> {
    const rows: ObjectRow[] = await this.db.select().from(zhObjects).where(and(
      eq(zhObjects.kind, kind),
      ownerId !== undefined ? eq(zhObjects.ownerId, ownerId) : undefined,
      refId !== undefined ? eq(zhObjects.refId, refId) : undefined,
    )).orderBy(desc(zhObjects.createdMs), desc(zhObjects.id)).limit(limit);
    return rows.map((row: ObjectRow) => row.payload as T);
  }
  async updateObject(id: string, kind: string, ownerId: string, payload: unknown): Promise<void> {
    if (['snapshot', 'run', 'version', 'event', 'invocation', 'stock'].includes(kind)) {
      throw new Error('不可变记录不能覆盖');
    }
    const rows = await this.db.update(zhObjects).set({ payload, updatedMs: Date.now() }).where(and(
      eq(zhObjects.id, id), eq(zhObjects.kind, kind), eq(zhObjects.ownerId, ownerId),
    )).returning({ id: zhObjects.id });
    if (!rows.length) throw new NotFoundException('记录不存在');
  }
  async latestRevision(refId: string, ownerId: string): Promise<number> {
    const rows = await this.db.select({ revision: zhObjects.revision }).from(zhObjects)
      .where(and(eq(zhObjects.kind, 'version'), eq(zhObjects.refId, refId), eq(zhObjects.ownerId, ownerId)))
      .orderBy(desc(zhObjects.revision)).limit(1);
    return rows[0]?.revision ?? 0;
  }
  async consumeLimit(id: string, maximum: number, expiresMs: number): Promise<void> {
    const now: number = Date.now();
    const rows = await this.db.insert(zhLimits).values({ id, used: 1, expiresMs })
      .onConflictDoUpdate({
        target: zhLimits.id,
        set: {
          used: sql`case when ${zhLimits.expiresMs} < ${now} then 1 else ${zhLimits.used} + 1 end`,
          expiresMs,
        },
        setWhere: or(lt(zhLimits.expiresMs, now), lt(zhLimits.used, maximum)),
      }).returning({ used: zhLimits.used });
    if (!rows.length) throw new HttpException('请求次数已达本时段上限，请稍后再试', 429);
  }
  async acquireLock(id: string, holder: string, durationMs: number): Promise<boolean> {
    const now: number = Date.now();
    const rows = await this.db.insert(zhLocks).values({ id, holder, expiresMs: now + durationMs })
      .onConflictDoUpdate({
        target: zhLocks.id, set: { holder, expiresMs: now + durationMs },
        setWhere: or(lt(zhLocks.expiresMs, now), eq(zhLocks.holder, holder)),
      }).returning({ id: zhLocks.id });
    return rows.length > 0;
  }
  async releaseLock(id: string, holder: string): Promise<void> {
    await this.db.delete(zhLocks).where(and(eq(zhLocks.id, id), eq(zhLocks.holder, holder)));
  }
  async createSession(hash: string, ownerId: string, expiresMs: number): Promise<void> {
    await this.db.insert(zhSessions).values({ tokenHash: hash, ownerId, expiresMs });
  }
  async getSession(hash: string): Promise<{ ownerId: string; expiresMs: number } | null> {
    const rows = await this.db.select({ ownerId: zhSessions.ownerId, expiresMs: zhSessions.expiresMs })
      .from(zhSessions).where(and(eq(zhSessions.tokenHash, hash), gt(zhSessions.expiresMs, Date.now()))).limit(1);
    return rows[0] ?? null;
  }
  async removeSession(hash: string): Promise<void> {
    await this.db.delete(zhSessions).where(eq(zhSessions.tokenHash, hash));
  }
  async objectExists(id: string, kind: string, ownerId: string): Promise<boolean> {
    const rows = await this.db.select({ id: zhObjects.id }).from(zhObjects).where(and(
      eq(zhObjects.id, id), eq(zhObjects.kind, kind), eq(zhObjects.ownerId, ownerId),
    )).limit(1);
    return rows.length > 0;
  }
  async objectRows(kind: string, limit = 1000): Promise<ObjectRow[]> {
    return this.db.select().from(zhObjects).where(eq(zhObjects.kind, kind))
      .orderBy(zhObjects.createdMs, zhObjects.id).limit(limit);
  }
  async insertJob(job: JobInsert): Promise<void> {
    await this.db.insert(zhJobs).values(job).onConflictDoNothing({ target: zhJobs.id });
  }
  async getJob(id: string, ownerId?: string): Promise<JobRow> {
    const rows: JobRow[] = await this.db.select().from(zhJobs).where(and(
      eq(zhJobs.id, id), ownerId !== undefined ? eq(zhJobs.ownerId, ownerId) : undefined,
    )).limit(1);
    if (!rows[0]) throw new NotFoundException('任务不存在或不属于当前访客');
    return rows[0];
  }
  async claimJob(id: string): Promise<JobRow | null> {
    const now = Date.now();
    const rows: JobRow[] = await this.db.update(zhJobs).set({
      status: 'running', leaseUntilMs: now + 120000, updatedMs: now,
    }).where(and(eq(zhJobs.id, id), or(
      eq(zhJobs.status, 'pending'),
      and(eq(zhJobs.status, 'running'), lt(zhJobs.leaseUntilMs, now)),
    ))).returning();
    return rows[0] ?? null;
  }
  async updateJob(id: string, patch: Partial<Pick<JobInsert,
    'status' | 'result' | 'progress' | 'message' | 'payload' | 'leaseUntilMs'>>): Promise<void> {
    await this.db.update(zhJobs).set({ ...patch, updatedMs: Date.now() }).where(eq(zhJobs.id, id));
  }
  async latestRefresh(): Promise<JobRow | null> {
    const rows: JobRow[] = await this.db.select().from(zhJobs)
      .where(eq(zhJobs.kind, 'refresh')).orderBy(desc(zhJobs.createdMs)).limit(1);
    return rows[0] ?? null;
  }
  /** Only unreferenced market snapshots are eligible; saved runs and versions retain their evidence. */
  async pruneSnapshots(): Promise<void> {
    const snapshots: ObjectRow[] = await this.objectRows('snapshot', 10000);
    const runs: ObjectRow[] = await this.objectRows('run', 10000);
    const referenced: Set<string> = new Set(runs.flatMap((row: ObjectRow): string[] => {
      const payload = row.payload as { snapshot?: { id?: string } };
      return payload.snapshot?.id ? [payload.snapshot.id] : [];
    }));
    for (const snapshot of snapshots.slice(0, Math.max(0, snapshots.length - 7))) {
      if (referenced.has(snapshot.id)) continue;
      await this.db.delete(zhObjects).where(and(eq(zhObjects.kind, 'stock'), eq(zhObjects.refId, snapshot.id)));
      await this.db.delete(zhObjects).where(and(eq(zhObjects.kind, 'snapshot'), eq(zhObjects.id, snapshot.id)));
    }
    await this.db.delete(zhSessions).where(lt(zhSessions.expiresMs, Date.now()));
    await this.db.delete(zhLimits).where(lt(zhLimits.expiresMs, Date.now()));
  }
  async unfinishedJobs(): Promise<JobRow[]> {
    return this.db.select().from(zhJobs).where(or(
      eq(zhJobs.status, 'pending'),
      and(eq(zhJobs.status, 'running'), lt(zhJobs.leaseUntilMs, Date.now())),
    )).orderBy(zhJobs.createdMs).limit(5);
  }
}
