import {
  CanActivate, ExecutionContext, Inject, Injectable, ServiceUnavailableException, UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import type { AccessSession } from '../../../shared/api.interface';
import { StorageService } from './storage.service';

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

  async session(req: Request): Promise<AccessSession> {
    const raw: string = token(req);
    const session = raw ? await this.storage.getSession(hash(raw)) : null;
    if (session) this.owners.set(req, session.ownerId);
    return { authorized: !!session, expiresAt: session ? new Date(session.expiresMs).toISOString() : null };
  }
  owner(req: Request): string {
    const ownerId: string | undefined = this.owners.get(req);
    if (!ownerId) throw new UnauthorizedException('请先输入访问码');
    return ownerId;
  }
  async login(req: Request, res: Response, code: string): Promise<AccessSession> {
    if (!process.env.ZH_ACCESS_CODE) throw new ServiceUnavailableException('评审入口尚未开放');
    const hour: number = Math.floor(Date.now() / 3600000);
    const expiresMs: number = (hour + 1) * 3600000;
    await this.storage.consumeLimit(`access:${hash(req.ip ?? req.socket.remoteAddress ?? 'unknown')}:${hour}`, 30, expiresMs);
    await this.storage.consumeLimit(`access-global:${hour}`, 300, expiresMs);
    if (!equalSecret(code, process.env.ZH_ACCESS_CODE)) throw new UnauthorizedException('访问码不正确');
    const existing: AccessSession = await this.session(req);
    if (existing.authorized) return existing;
    const raw: string = randomBytes(32).toString('hex');
    const expiry: number = Date.now() + SESSION_MS;
    await this.storage.createSession(hash(raw), randomUUID(), expiry);
    res.cookie(COOKIE, raw, { httpOnly: true, secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax', path: '/', maxAge: SESSION_MS });
    return { authorized: true, expiresAt: new Date(expiry).toISOString() };
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
    if (!session.authorized) throw new UnauthorizedException('访客会话已失效，请重新输入访问码');
    return true;
  }
}
