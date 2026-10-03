import {
  CanActivate, ConflictException, ExecutionContext, Inject, Injectable, UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import type { AccessSession, AccountStatus } from '../../../shared/api.interface';
import { StorageService } from './storage.service';
import {
  type AccountRecord, hashPassword, normalizeUsername, passwordMatches, usernameRef,
} from './access-account';

const COOKIE = 'zh-session';
const SESSION_MS = 30 * 24 * 3600 * 1000;
function hash(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function equalSecret(value: string, expected: string | undefined): boolean {
  return !!expected && timingSafeEqual(Buffer.from(hash(value)), Buffer.from(hash(expected)));
}
function token(req: Request): string {
  const value: string = req.headers.cookie?.split(';').map((item: string) => item.trim())
    .find((item: string) => item.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) ?? '';
  return /^[a-f0-9]{64}$/.test(value) ? value : '';
}
@Injectable()
export class AccessService {
  private readonly owners: WeakMap<Request, string> = new WeakMap();
  constructor(@Inject(StorageService) private readonly storage: StorageService) {}

  private async issueSession(req: Request, res: Response, ownerId: string): Promise<AccessSession> {
    const raw: string = randomBytes(32).toString('hex');
    const expiry: number = Date.now() + SESSION_MS;
    await this.storage.createSession(hash(raw), ownerId, expiry);
    this.owners.set(req, ownerId);
    res.cookie(COOKIE, raw, { httpOnly: true, secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax', path: '/', maxAge: SESSION_MS });
    return { authorized: true, expiresAt: new Date(expiry).toISOString() };
  }
  async session(req: Request): Promise<AccessSession> {
    const raw: string = token(req);
    const session = raw ? await this.storage.getSession(hash(raw)) : null;
    if (session) this.owners.set(req, session.ownerId);
    return { authorized: !!session, expiresAt: session ? new Date(session.expiresMs).toISOString() : null };
  }
  owner(req: Request): string {
    const ownerId: string | undefined = this.owners.get(req);
    if (!ownerId) throw new UnauthorizedException('访客会话未建立，请刷新页面');
    return ownerId;
  }
  async start(req: Request, res: Response): Promise<AccessSession> {
    const existing: AccessSession = await this.session(req);
    if (existing.authorized) return existing;
    const hour: number = Math.floor(Date.now() / 3600000);
    const expiresMs: number = (hour + 1) * 3600000;
    const address: string = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    await this.storage.consumeLimit(`guest-session:${hash(address)}:${hour}`, 60, expiresMs);
    await this.storage.consumeLimit(`guest-session-global:${hour}`, 1000, expiresMs);
    return this.issueSession(req, res, randomUUID());
  }
  async account(req: Request): Promise<AccountStatus> {
    const records = await this.storage.listObjects<AccountRecord>('account', this.owner(req), undefined, 1);
    return records[0]
      ? { registered: true, username: records[0].username }
      : { registered: false, username: null };
  }
  async register(req: Request, username: string, password: string): Promise<AccountStatus> {
    const ownerId: string = this.owner(req);
    const normalized: string = normalizeUsername(username);
    const ref: string = usernameRef(normalized);
    const hour: number = Math.floor(Date.now() / 3600000);
    const expiresMs: number = (hour + 1) * 3600000;
    await this.storage.consumeLimit(`account-register:${hash(req.ip ?? 'unknown')}:${hour}`, 20, expiresMs);
    if ((await this.storage.listObjects<AccountRecord>('account', undefined, ref, 1)).length) {
      throw new ConflictException('该账号名已被使用，请更换或直接登录');
    }
    const passwordData = await hashPassword(password);
    const record: AccountRecord = {
      ownerId, username: normalized, usernameRef: ref,
      passwordSalt: passwordData.salt, passwordHash: passwordData.passwordHash,
      createdAt: new Date().toISOString(),
    };
    await this.storage.insertObject(ref, 'account', ownerId, record, ref);
    const saved = await this.storage.listObjects<AccountRecord>('account', undefined, ref, 1);
    if (saved[0]?.ownerId !== ownerId) throw new ConflictException('该账号名已被使用，请直接登录');
    return { registered: true, username: normalized };
  }
  async login(req: Request, res: Response, username: string, password: string): Promise<AccessSession> {
    const normalized: string = normalizeUsername(username);
    const ref: string = usernameRef(normalized);
    const hour: number = Math.floor(Date.now() / 3600000);
    const expiresMs: number = (hour + 1) * 3600000;
    const address: string = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    await this.storage.consumeLimit(`account-login:${hash(address)}:${hour}`, 30, expiresMs);
    await this.storage.consumeLimit(`account-login-name:${ref}:${hour}`, 10, expiresMs);
    const record = (await this.storage.listObjects<AccountRecord>('account', undefined, ref, 1))[0];
    const matches = await passwordMatches(
      password, record?.passwordSalt ?? '0'.repeat(32), record?.passwordHash ?? '0'.repeat(128),
    );
    if (!record || !matches) throw new UnauthorizedException('账号名或密码不正确');
    const raw: string = token(req);
    const next: AccessSession = await this.issueSession(req, res, record.ownerId);
    if (raw) await this.storage.removeSession(hash(raw));
    return next;
  }
  async logout(req: Request, res: Response): Promise<AccessSession> {
    const raw: string = token(req);
    if (raw) await this.storage.removeSession(hash(raw));
    res.clearCookie(COOKIE, { path: '/', httpOnly: true, sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production' });
    return { authorized: false, expiresAt: null };
  }
  requireAdmin(req: Request): void {
    if (!equalSecret(String(req.headers['x-zh-admin'] ?? ''), process.env.ZH_ADMIN_TOKEN)) {
      throw new UnauthorizedException('需要维护权限');
    }
  }
}
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(@Inject(AccessService) private readonly access: AccessService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const session: AccessSession = await this.access.session(context.switchToHttp().getRequest<Request>());
    if (!session.authorized) throw new UnauthorizedException('访客会话已失效，请刷新页面');
    return true;
  }
}
