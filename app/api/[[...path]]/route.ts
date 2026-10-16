/**
 * กินจริง (KinJing) - Backend ทั้งหมดในไฟล์เดียว
 * ตำแหน่งไฟล์: app/api/[[...path]]/route.ts (Next.js 15+/16, App Router)
 */

import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { Pool, PoolClient, QueryResultRow } from 'pg';
import { del, put } from '@vercel/blob';
import generatePayload from 'promptpay-qr';
import QRCode from 'qrcode';

// ==================== DB ====================
declare global {
    // eslint-disable-next-line no-var
    var _kjPool: Pool | undefined;
}

const DB_URL =
    process.env.DATABASE_URL ||
    'postgresql://neondb_owner:npg_PUwk1aVbMv5i@ep-lucky-glade-b3yt1rvl-pooler.c-4.ap-southeast-1.aws.neon.tech/neondb?sslmode=require';

const pool =
    global._kjPool ??
    new Pool({
        connectionString: DB_URL,
        ssl: { rejectUnauthorized: false },
        max: 10,
    });

if (process.env.NODE_ENV !== 'production') global._kjPool = pool;

async function query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params: unknown[] = []
): Promise<T[]> {
    const res = await pool.query<T>(text, params);
    return res.rows;
}

async function withTx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const out = await fn(client);
        await client.query('COMMIT');
        return out;
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

const isUuid = (v: unknown): v is string =>
    typeof v === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

// ==================== SCHEMA (lazy, idempotent migration) ====================
let schemaReady: Promise<void> | null = null;

function ensureSchema(): Promise<void> {
    if (!schemaReady) {
        schemaReady = pool
            .query(
                `ALTER TABLE plans ADD COLUMN IF NOT EXISTS tier text NOT NULL DEFAULT 'basic';
                 ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS rating_count int NOT NULL DEFAULT 0;
                 ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS boosted_until timestamptz;
                 CREATE TABLE IF NOT EXISTS review_ratings (
                     id bigserial PRIMARY KEY,
                     restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
                     user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                     score smallint NOT NULL CHECK (score BETWEEN 1 AND 5),
                     ip_hash text,
                     created_at timestamptz NOT NULL DEFAULT now(),
                     UNIQUE (restaurant_id, user_id)
                 );
                 CREATE INDEX IF NOT EXISTS review_ratings_ip_idx
                     ON review_ratings (restaurant_id, ip_hash);
                 CREATE TABLE IF NOT EXISTS promotions (
                     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                     restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
                     owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                     title text NOT NULL,
                     description text,
                     coupon_code text,
                     discount_text text,
                     starts_at timestamptz NOT NULL DEFAULT now(),
                     ends_at timestamptz NOT NULL,
                     created_at timestamptz NOT NULL DEFAULT now()
                 );
                 CREATE INDEX IF NOT EXISTS promotions_restaurant_idx
                     ON promotions (restaurant_id, ends_at);
                 -- ===== ปรับแก้: สมาชิกจ่ายครั้งเดียว / ร้านค้า / ตรวจเนื้อหา =====
                 ALTER TABLE users ADD COLUMN IF NOT EXISTS phone text;
                 ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz;
                 ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked_at timestamptz;
                 ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked_reason text;
                 CREATE UNIQUE INDEX IF NOT EXISTS users_phone_uidx ON users (phone) WHERE phone IS NOT NULL;
                 ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS is_exclusive boolean NOT NULL DEFAULT false;
                 ALTER TABLE promotions ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'discount';
                 ALTER TABLE promotions ADD COLUMN IF NOT EXISTS quota int;
                 ALTER TABLE promotions ADD COLUMN IF NOT EXISTS claimed_count int NOT NULL DEFAULT 0;
                 CREATE TABLE IF NOT EXISTS promotion_claims (
                     id bigserial PRIMARY KEY,
                     promotion_id uuid NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
                     user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                     ip_hash text,
                     code text NOT NULL,
                     created_at timestamptz NOT NULL DEFAULT now(),
                     UNIQUE (promotion_id, user_id)
                 );
                 CREATE TABLE IF NOT EXISTS memberships (
                     user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                     tier text NOT NULL,
                     order_id uuid,
                     activated_at timestamptz NOT NULL DEFAULT now(),
                     updated_at timestamptz NOT NULL DEFAULT now()
                 );
                 CREATE TABLE IF NOT EXISTS membership_orders (
                     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                     user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                     tier text NOT NULL,
                     amount_satang int NOT NULL,
                     status text NOT NULL DEFAULT 'pending',
                     slip_ref text,
                     slip_sender text,
                     verify_attempts int NOT NULL DEFAULT 0,
                     created_at timestamptz NOT NULL DEFAULT now(),
                     paid_at timestamptz
                 );
                 CREATE UNIQUE INDEX IF NOT EXISTS membership_orders_slip_ref_uidx
                     ON membership_orders (slip_ref) WHERE slip_ref IS NOT NULL;
                 CREATE TABLE IF NOT EXISTS store_profiles (
                     user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                     store_name text NOT NULL,
                     map_url text,
                     latitude double precision,
                     longitude double precision,
                     address text,
                     storefront_url text NOT NULL,
                     contact_phone text,
                     status text NOT NULL DEFAULT 'pending',
                     admin_note text,
                     reviewed_at timestamptz,
                     created_at timestamptz NOT NULL DEFAULT now(),
                     updated_at timestamptz NOT NULL DEFAULT now()
                 );
                 CREATE TABLE IF NOT EXISTS store_listings (
                     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                     owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                     title text NOT NULL,
                     price_satang int,
                     description text,
                     image_url text,
                     active boolean NOT NULL DEFAULT true,
                     created_at timestamptz NOT NULL DEFAULT now(),
                     updated_at timestamptz NOT NULL DEFAULT now()
                 );
                 CREATE INDEX IF NOT EXISTS store_listings_owner_idx ON store_listings (owner_id, active);
                 CREATE TABLE IF NOT EXISTS content_reports (
                     id bigserial PRIMARY KEY,
                     target_type text NOT NULL,
                     target_id uuid NOT NULL,
                     reporter_id uuid REFERENCES users(id) ON DELETE SET NULL,
                     reason text NOT NULL,
                     status text NOT NULL DEFAULT 'open',
                     admin_note text,
                     created_at timestamptz NOT NULL DEFAULT now(),
                     resolved_at timestamptz
                 );
                 ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash text;
                 ALTER TABLE store_listings ADD COLUMN IF NOT EXISTS promo_price_satang int;
                 ALTER TABLE store_listings ADD COLUMN IF NOT EXISTS coupon_code text;
                 ALTER TABLE store_listings ADD COLUMN IF NOT EXISTS discount_text text;
                 ALTER TABLE store_listings ADD COLUMN IF NOT EXISTS boosted_until timestamptz;
                 ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at timestamptz;
                 ALTER TABLE membership_orders ADD COLUMN IF NOT EXISTS slip_url text;
                 ALTER TABLE membership_orders ADD COLUMN IF NOT EXISTS fail_reason text;
                 CREATE TABLE IF NOT EXISTS media_checks (
                     url text PRIMARY KEY,
                     ok boolean NOT NULL,
                     reason text,
                     checked_at timestamptz NOT NULL DEFAULT now()
                 );`
            )
            .then(() => undefined)
            .catch((e) => {
                schemaReady = null;
                throw e;
            });
    }
    return schemaReady;
}

// ==================== HUMAN / BOT CHECK ====================
const BOT_UA =
    /bot|crawl|spider|slurp|headless|puppeteer|playwright|selenium|phantom|curl|wget|python|axios|node-fetch|go-http|java\/|okhttp|httpclient|scrapy|facebookexternalhit|preview/i;

function isBotUA(req: NextRequest): boolean {
    const ua = req.headers.get('user-agent') ?? '';
    return ua.length < 10 || BOT_UA.test(ua);
}

/** ตรวจว่าเป็นมนุษย์: UA + honeypot + เวลาที่ใช้ + Cloudflare Turnstile */
async function verifyHuman(
    req: NextRequest,
    body: { turnstileToken?: unknown; hp?: unknown; openedAt?: unknown }
): Promise<string | null> {
    if (isBotUA(req)) return 'ตรวจพบการใช้งานอัตโนมัติ';
    if (typeof body.hp === 'string' && body.hp.length > 0)
        return 'ตรวจพบการใช้งานอัตโนมัติ';
    const openedAt = Number(body.openedAt);
    if (!Number.isFinite(openedAt) || Date.now() - openedAt < 1500)
        return 'กรุณาใช้เวลาพิจารณาก่อนให้คะแนน';

    const secretKey = process.env.TURNSTILE_SECRET_KEY;
    if (!secretKey) {
        return null;
    }
    if (typeof body.turnstileToken !== 'string' || !body.turnstileToken)
        return 'กรุณายืนยันว่าคุณไม่ใช่บอท';

    const form = new URLSearchParams({
        secret: secretKey,
        response: body.turnstileToken,
    });
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim();
    if (ip) form.set('remoteip', ip);
    try {
        const r = await fetch(
            'https://challenges.cloudflare.com/turnstile/v0/siteverify',
            { method: 'POST', body: form }
        );
        const j = (await r.json()) as { success?: boolean };
        return j.success ? null : 'ยืนยันตัวตนไม่สำเร็จ กรุณาลองใหม่';
    } catch {
        return 'ยืนยันตัวตนไม่สำเร็จ กรุณาลองใหม่';
    }
}

// ==================== AUTH ====================
const SESSION_COOKIE = 'kj_session';
const ADMIN_COOKIE = 'kj_admin';

function secret(): string {
    const s =
        process.env.SESSION_SECRET ||
        'KJ_2026_dev_secret_abcdefghijklmnopqrstuvwxyz_1234567890';
    return s;
}

function signToken(payload: Record<string, unknown>, ttlSec: number): string {
    const body = Buffer.from(
        JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSec })
    ).toString('base64url');
    const sig = crypto
        .createHmac('sha256', secret())
        .update(body)
        .digest('base64url');
    return `${body}.${sig}`;
}

function verifyToken(token?: string): Record<string, unknown> | null {
    if (!token) return null;
    const [body, sig] = token.split('.');
    if (!body || !sig) return null;
    const expected = crypto
        .createHmac('sha256', secret())
        .update(body)
        .digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    try {
        const p = JSON.parse(Buffer.from(body, 'base64url').toString());
        if (typeof p.exp !== 'number' || p.exp < Date.now() / 1000) return null;
        return p;
    } catch {
        return null;
    }
}

function setAuthCookie(
    res: NextResponse,
    name: string,
    value: string,
    maxAgeSec: number
) {
    res.cookies.set(name, value, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: maxAgeSec,
    });
}

function clearAuthCookie(res: NextResponse, name: string) {
    res.cookies.set(name, '', { httpOnly: true, path: '/', maxAge: 0 });
}

function getUserId(req: NextRequest): string | null {
    const p = verifyToken(req.cookies.get(SESSION_COOKIE)?.value);
    return p && typeof p.uid === 'string' ? (p.uid as string) : null;
}

function isAdminReq(req: NextRequest): boolean {
    const p = verifyToken(req.cookies.get(ADMIN_COOKIE)?.value);
    return !!p && p.role === 'admin';
}

function ipHash(req: NextRequest): string {
    const ip =
        req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
    return crypto
        .createHash('sha256')
        .update(ip + secret())
        .digest('hex')
        .slice(0, 32);
}

function safeEqual(a: string, b: string): boolean {
    const ha = crypto.createHash('sha256').update(a).digest();
    const hb = crypto.createHash('sha256').update(b).digest();
    return crypto.timingSafeEqual(ha, hb);
}

// ==================== AUDIT ====================
const AUDIT_SQL =
    'INSERT INTO audit_logs (actor, action, detail, ip_hash) VALUES ($1,$2,$3,$4)';

async function audit(
    actor: string | null,
    action: string,
    detail: Record<string, unknown> = {},
    ip: string | null = null
) {
    await pool.query(AUDIT_SQL, [actor, action, JSON.stringify(detail), ip]);
}

async function auditTx(
    c: PoolClient,
    actor: string | null,
    action: string,
    detail: Record<string, unknown> = {},
    ip: string | null = null
) {
    await c.query(AUDIT_SQL, [actor, action, JSON.stringify(detail), ip]);
}

// ==================== MEMBERSHIP (จ่ายครั้งเดียว) ====================
// รายได้ของระบบมาจาก "แอดโฆษณา" และ "ค่าสมัครสมาชิก" เท่านั้น — ไม่มีการแบ่งรายได้ให้ผู้ใช้ทั่วไป
type Tier = 'free' | 'member' | 'store' | 'store_vip';
type PaidTier = Exclude<Tier, 'free'>;

interface TierInfo {
    id: PaidTier;
    name: string;
    priceSatang: number;
    menuLimit: number;
    isStore: boolean;
    perks: string[];
}

const TIERS: Record<PaidTier, TierInfo> = {
    member: {
        id: 'member',
        name: 'สมาชิกระดับต้น',
        priceSatang: 9900,
        menuLimit: 0,
        isStore: false,
        perks: [
            'จ่ายครั้งเดียว ใช้ได้ตลอด',
            'ปิดโฆษณาทั้งหมด',
            'อ่านรีวิวได้ไม่จำกัด',
            'โพสต์รีวิว และให้คะแนนรีวิว',
        ],
    },
    store: {
        id: 'store',
        name: 'สมาชิกระดับร้านค้า',
        priceSatang: 29900,
        menuLimit: 10,
        isStore: true,
        perks: [
            'จ่ายครั้งเดียว ใช้ได้ตลอด',
            'ทุกสิทธิ์ของสมาชิกระดับต้น',
            'เพิ่มการมองเห็น (บูสต์รีวิว)',
            'เข้าถึงรีวิว Exclusive',
            'สร้างคูปองส่วนลด + คูปองกินฟรีรายเดือน',
            'ลงประกาศขายสินค้า/อาหาร 10 เมนู',
            'ต้องยืนยันตัวตนร้านค้า (แผนที่ + รูปหน้าร้าน)',
        ],
    },
    store_vip: {
        id: 'store_vip',
        name: 'สมาชิกร้านค้า VIP',
        priceSatang: 59900,
        menuLimit: 20,
        isStore: true,
        perks: [
            'จ่ายครั้งเดียว ใช้ได้ตลอด',
            'ทุกสิทธิ์ของสมาชิกระดับร้านค้า',
            'ลงประกาศขายสินค้า/อาหาร 20 เมนู',
            'ต้องยืนยันตัวตนร้านค้า (แผนที่ + รูปหน้าร้าน)',
        ],
    },
};

const TIER_RANK: Record<Tier, number> = { free: 0, member: 1, store: 2, store_vip: 3 };
const isPaidTier = (v: unknown): v is PaidTier =>
    v === 'member' || v === 'store' || v === 'store_vip';
const isStoreTier = (t: Tier) => t === 'store' || t === 'store_vip';

interface Membership {
    isVip: boolean;
    tier: Tier;
    tierName: string;
    since: string | null;
    menuLimit: number;
    isStore: boolean;
}

async function getMembership(userId: string): Promise<Membership> {
    let tier: Tier = 'free';
    let since: string | null = null;

    const rows = await query<{ tier: string; activated_at: string }>(
        'SELECT tier, activated_at FROM memberships WHERE user_id=$1',
        [userId]
    );
    if (rows[0] && isPaidTier(rows[0].tier)) {
        tier = rows[0].tier;
        since = rows[0].activated_at;
    }

    // สมาชิกจากระบบเดิม (Omise รายเดือน) ที่ยังไม่หมดอายุ: basic → ระดับต้น, premium → ร้านค้า
    if (tier === 'free') {
        try {
            const legacy = await query<{ tier: string; current_period_start: string }>(
                `SELECT COALESCE(pl.tier,'basic') AS tier, s.current_period_start
                 FROM subscriptions s JOIN plans pl ON pl.id = s.plan_id
                 WHERE s.user_id=$1 AND s.status='active' AND s.current_period_end > now()
                 ORDER BY (pl.tier='premium') DESC LIMIT 1`,
                [userId]
            );
            if (legacy[0]) {
                tier = legacy[0].tier === 'premium' ? 'store' : 'member';
                since = legacy[0].current_period_start;
            }
        } catch {
            /* ไม่มีตารางระบบเดิม */
        }
    }

    return {
        isVip: tier !== 'free',
        tier,
        tierName: tier === 'free' ? 'ผู้ใช้ทั่วไป' : TIERS[tier].name,
        since,
        menuLimit: tier === 'free' ? 0 : TIERS[tier].menuLimit,
        isStore: isStoreTier(tier),
    };
}

// ==================== USER FLAGS (บล็อก / เบอร์โทร) ====================
const PHONE_RE = /^0[689]\d{8}$/;
const maskPhone = (p: string | null) =>
    p ? `${p.slice(0, 3)}-xxx-${p.slice(-4)}` : null;

async function blockedResponse(uid: string): Promise<NextResponse | null> {
    const r = await query<{ blocked_at: string | null; blocked_reason: string | null }>(
        'SELECT blocked_at, blocked_reason FROM users WHERE id=$1',
        [uid]
    );
    if (r[0]?.blocked_at) {
        return NextResponse.json(
            {
                error: `บัญชีนี้ถูกระงับการใช้งานโดยแอดมิน${
                    r[0].blocked_reason ? ` (${r[0].blocked_reason})` : ''
                }`,
                blocked: true,
            },
            { status: 403 }
        );
    }
    return null;
}

// ==================== PROMPTPAY QR (สร้างเอง ไม่ต้องใช้ API ธนาคาร) ====================
const PROMPTPAY_ID = (process.env.PROMPTPAY_ID || '0638733553').replace(/\D/g, '');

async function buildPromptPayQr(amountBaht: number): Promise<string> {
    const payload = generatePayload(PROMPTPAY_ID, { amount: amountBaht });
    return QRCode.toDataURL(payload, { margin: 1, width: 480 });
}

// ==================== SLIP VERIFICATION (SlipOK) ====================
interface SlipParty {
    displayName?: string;
    name?: string;
    proxy?: { type?: string; value?: string } | null;
    account?: { type?: string; value?: string } | null;
}
interface SlipOkData {
    success?: boolean;
    message?: string;
    transRef?: string;
    transTimestamp?: string;
    amount?: number;
    sender?: SlipParty;
    receiver?: SlipParty;
}

const SLIPOK_ERRORS: Record<number, string> = {
    1006: 'รูปภาพไม่ถูกต้อง',
    1007: 'ไม่พบ QR Code ในรูปสลิป กรุณาแนบสลิปที่ชัดเจน',
    1008: 'QR Code นี้ไม่ใช่สลิปโอนเงิน',
    1010: 'ธนาคารยังไม่ยืนยันรายการ กรุณารอสักครู่แล้วลองใหม่',
    1012: 'สลิปนี้ถูกใช้ไปแล้ว',
    1013: 'ยอดเงินในสลิปไม่ตรงกับแพ็กเกจ',
    1014: 'บัญชีผู้รับในสลิปไม่ตรงกับบัญชีของระบบ',
};

async function verifySlipWithSlipOk(
    file: Blob,
    amountBaht: number
): Promise<{ ok: true; data: SlipOkData } | { ok: false; error: string }> {
    const branch = process.env.SLIPOK_BRANCH_ID;
    const key = process.env.SLIPOK_API_KEY;
    if (!branch || !key)
        return {
            ok: false,
            error: 'ระบบตรวจสลิปยังไม่ได้ตั้งค่า กรุณาติดต่อแอดมิน',
        };

    const fd = new FormData();
    fd.append('files', file, 'slip.jpg');
    fd.append('amount', String(amountBaht));
    if (process.env.SLIPOK_LOG === 'true') fd.append('log', 'true');

    let res: Response;
    try {
        res = await fetch(
            `https://api.slipok.com/api/line/apikey/${encodeURIComponent(branch)}`,
            {
                method: 'POST',
                headers: { 'x-authorization': key },
                body: fd,
                cache: 'no-store',
            }
        );
    } catch (err) {
        console.error('slipok fetch failed', err);
        return { ok: false, error: 'เชื่อมต่อระบบตรวจสลิปไม่ได้ กรุณาลองใหม่' };
    }
    const json = (await res.json().catch(() => null)) as {
        success?: boolean;
        code?: number;
        message?: string;
        data?: SlipOkData;
    } | null;
    if (!res.ok || !json?.success || !json.data?.success) {
        const code = Number(json?.code);
        return {
            ok: false,
            error:
                SLIPOK_ERRORS[code] ??
                (json?.message ? `ตรวจสลิปไม่ผ่าน: ${json.message}` : 'ตรวจสลิปไม่ผ่าน'),
        };
    }
    return { ok: true, data: json.data };
}

const NAME_PREFIX = /^(นาย|นาง|นางสาว|น\.ส\.|mr\.?|mrs\.?|ms\.?|miss)$/i;

/** ชื่อบัญชีผู้รับตรงไหม? (ป้องกันเอาสลิปที่โอนให้ร้านอื่นมาแนบ) */
function receiverMatches(r: SlipParty | undefined): boolean {
    if (!r) return false;
    const hay = `${r.displayName ?? ''} ${r.name ?? ''}`.toLowerCase();

    const words = (process.env.PROMPTPAY_RECEIVER_NAMES || '')
        .toLowerCase()
        .split(/[,\s]+/)
        .map((w) => w.trim())
        .filter((w) => w.length >= 2 && !NAME_PREFIX.test(w));
    if (words.some((w) => hay.includes(w))) return true;

    // เทียบเลข PromptPay / เลขบัญชี (ธนาคารปิดบางหลักไว้ จึงเทียบ 4 หลักท้าย)
    const proxy = (r.proxy?.value ?? '').replace(/\D/g, '');
    if (proxy.length >= 4 && proxy.endsWith(PROMPTPAY_ID.slice(-4))) return true;
    const accLast = (process.env.PROMPTPAY_ACCOUNT_LAST_DIGITS || '').replace(/\D/g, '');
    const acc = (r.account?.value ?? '').replace(/\D/g, '');
    if (accLast.length >= 3 && acc.includes(accLast)) return true;
    return false;
}

/** เปิดสิทธิ์สมาชิก (เลือกระดับที่สูงกว่าเสมอ) — ใช้ร่วมกันทั้งตรวจสลิปอัตโนมัติและแอดมินอนุมัติเอง */
async function activateMembershipTx(
    c: PoolClient,
    userId: string,
    tier: PaidTier,
    orderId: string
) {
    const cur = await c.query(
        'SELECT tier FROM memberships WHERE user_id=$1 FOR UPDATE',
        [userId]
    );
    const curTier: Tier = isPaidTier(cur.rows[0]?.tier) ? cur.rows[0].tier : 'free';
    if (!cur.rows[0]) {
        await c.query(
            'INSERT INTO memberships (user_id, tier, order_id) VALUES ($1,$2,$3)',
            [userId, tier, orderId]
        );
    } else if (TIER_RANK[tier] > TIER_RANK[curTier]) {
        await c.query(
            'UPDATE memberships SET tier=$2, order_id=$3, updated_at=now() WHERE user_id=$1',
            [userId, tier, orderId]
        );
    }
}

// ==================== CONTENT MODERATION ====================
const DEFAULT_COVER =
    'https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=900&q=80';
const BLOB_HOST_RE = /\.public\.blob\.vercel-storage\.com$/i;
const SE_MODELS = 'nudity-2.1,recreational_drug,gambling,gore-2.0,violence';

const VIOLATION_MSG = (label: string) =>
    `⚠️ ตรวจพบเนื้อหาไม่เหมาะสม (${label}) — ระบบไม่อนุญาตให้นำเข้าภาพลามก ยาเสพติด การพนัน หรือข้อมูลอาชญากรรม/ความรุนแรง ซึ่งไม่เกี่ยวกับอาหาร ข้อมูลนี้จึงไม่ถูกบันทึก (หากฝ่าฝืนซ้ำ แอดมินอาจระงับบัญชี)`;

/** คำต้องห้ามในข้อความ (ตรวจเบื้องต้น ก่อนบันทึก) */
const BANNED_TEXT: { re: RegExp; label: string }[] = [
    {
        re: /(หนังโป๊|คลิปโป๊|คลิปหลุด|\bxxx\b|porn|onlyfans|เย็ด|ขายตัว|ไซด์ไลน์|sideline|ขายบริการทางเพศ)/i,
        label: 'เนื้อหาลามก',
    },
    {
        re: /(ยาบ้า|ยาไอซ์|เฮโรอีน|heroin|โคเคน|cocaine|ecstasy|เคตามีน|ketamine|methamphetamine|ขายยาเสพติด)/i,
        label: 'ยาเสพติด',
    },
    {
        re: /(บาคาร่า|baccarat|สล็อต|slot\s*online|แทงบอล|คาสิโน|casino|เว็บพนัน|พนันออนไลน์|หวยออนไลน์|ufabet|pgslot|เครดิตฟรี)/i,
        label: 'การพนัน',
    },
    {
        re: /(รับจ้างทำร้าย|รับจ้างฆ่า|ขายปืน|ปืนเถื่อน|ทำร้ายร่างกาย|ฆ่าคน)/i,
        label: 'อาชญากรรม/ความรุนแรง',
    },
];

function textViolation(...parts: (string | null | undefined)[]): string | null {
    const s = parts.filter(Boolean).join(' ');
    for (const b of BANNED_TEXT) if (b.re.test(s)) return VIOLATION_MSG(b.label);
    return null;
}

type SeResult = {
    status?: string;
    error?: { message?: string };
    nudity?: Record<string, unknown>;
    recreational_drug?: { prob?: number };
    gambling?: { prob?: number };
    gore?: { prob?: number };
    violence?: { prob?: number };
    data?: { frames?: SeResult[] };
};

function seViolation(r: SeResult): string | null {
    const n = r.nudity ?? {};
    const nud = Math.max(
        Number(n.sexual_activity ?? 0),
        Number(n.sexual_display ?? 0),
        Number(n.erotica ?? 0)
    );
    if (nud >= 0.5) return 'ภาพลามก/อนาจาร';
    if ((r.recreational_drug?.prob ?? 0) >= 0.6) return 'ยาเสพติด';
    if ((r.gambling?.prob ?? 0) >= 0.6) return 'การพนัน';
    if ((r.gore?.prob ?? 0) >= 0.6 || (r.violence?.prob ?? 0) >= 0.6)
        return 'ความรุนแรง/การทำร้ายร่างกาย';
    return null;
}

const moderationEnabled = () =>
    !!(process.env.SIGHTENGINE_API_USER && process.env.SIGHTENGINE_API_SECRET);

/** ส่งภาพ/วิดีโอไปตรวจที่ Sightengine — คืนชื่อหมวดที่ผิด หรือ null ถ้าผ่าน */
async function sightengineCheck(url: string, type: 'image' | 'video'): Promise<string | null> {
    const params = new URLSearchParams({
        models: SE_MODELS,
        api_user: process.env.SIGHTENGINE_API_USER!,
        api_secret: process.env.SIGHTENGINE_API_SECRET!,
    });
    let endpoint = 'https://api.sightengine.com/1.0/check.json';
    if (type === 'video') {
        endpoint = 'https://api.sightengine.com/1.0/video/check-sync.json';
        params.set('stream_url', url);
    } else {
        params.set('url', url);
    }
    const res = await fetch(`${endpoint}?${params}`, { cache: 'no-store' });
    const json = (await res.json().catch(() => null)) as SeResult | null;
    if (!res.ok || json?.status !== 'success')
        throw new Error(json?.error?.message ?? `sightengine ${res.status}`);
    if (type === 'video') {
        for (const f of json.data?.frames ?? []) {
            const v = seViolation(f);
            if (v) return v;
        }
        return null;
    }
    return seViolation(json);
}

let warnedNoModeration = false;

type ModerationResult = { ok: true } | { ok: false; status: number; error: string };

/** ตรวจไฟล์ทุกชิ้นก่อนบันทึก — ถ้าผิดกฎ: ลบไฟล์ทิ้ง, ขึ้นคำเตือน, ไม่บันทึกข้อมูล */
async function moderateMedia(
    items: MediaItem[],
    actor: string,
    ip: string,
    skipUrls: Set<string> = new Set()
): Promise<ModerationResult> {
    for (const m of items) {
        if (m.url === DEFAULT_COVER || skipUrls.has(m.url)) continue;
        let host = '';
        try {
            host = new URL(m.url).hostname;
        } catch {
            /* invalid */
        }
        if (!BLOB_HOST_RE.test(host))
            return {
                ok: false,
                status: 400,
                error: 'รองรับเฉพาะรูป/วิดีโอที่อัปโหลดผ่านระบบเท่านั้น',
            };

        const cached = await query<{ ok: boolean; reason: string | null }>(
            'SELECT ok, reason FROM media_checks WHERE url=$1',
            [m.url]
        );
        if (cached[0]) {
            if (!cached[0].ok)
                return { ok: false, status: 422, error: VIOLATION_MSG(cached[0].reason ?? 'ไม่เหมาะสม') };
            continue;
        }

        if (!moderationEnabled()) {
            if (!warnedNoModeration) {
                console.warn('SIGHTENGINE_API_USER/SECRET not set — media moderation is OFF');
                warnedNoModeration = true;
            }
            continue;
        }

        let violation: string | null;
        try {
            violation = await sightengineCheck(m.url, m.type);
        } catch (err) {
            console.error('moderation failed', m.url, err);
            return {
                ok: false,
                status: 503,
                error:
                    m.type === 'video'
                        ? 'ตรวจสอบวิดีโอไม่สำเร็จ (วิดีโอต้องยาวไม่เกิน 60 วินาที) กรุณาลองใหม่'
                        : 'ระบบตรวจสอบเนื้อหาขัดข้องชั่วคราว กรุณาลองใหม่',
            };
        }

        await query(
            `INSERT INTO media_checks (url, ok, reason) VALUES ($1,$2,$3)
             ON CONFLICT (url) DO UPDATE SET ok=EXCLUDED.ok, reason=EXCLUDED.reason, checked_at=now()`,
            [m.url, !violation, violation]
        );
        if (violation) {
            await del(m.url).catch(() => undefined);
            await audit(actor, 'media_rejected', { url: m.url, reason: violation }, ip);
            return { ok: false, status: 422, error: VIOLATION_MSG(violation) };
        }
    }
    return { ok: true };
}

// ==================== MEDIA VALIDATION ====================
interface MediaItem {
    type: 'image' | 'video';
    url: string;
}

const MAX_MEDIA_ITEMS = 10;

function parseMediaItems(raw: unknown): MediaItem[] {
    if (!Array.isArray(raw)) return [];
    const out: MediaItem[] = [];
    for (const item of raw.slice(0, MAX_MEDIA_ITEMS)) {
        if (
            item &&
            typeof item === 'object' &&
            (item as { type?: string }).type &&
            ((item as { type: string }).type === 'image' ||
                (item as { type: string }).type === 'video') &&
            typeof (item as { url?: string }).url === 'string' &&
            (item as { url: string }).url.length > 0 &&
            (item as { url: string }).url.length <= 500
        ) {
            out.push({
                type: (item as { type: 'image' | 'video' }).type,
                url: (item as { url: string }).url.trim(),
            });
        }
    }
    return out;
}
// ==================== ROUTE: auth/guest ====================
async function h_auth_guest_POST(req: NextRequest) {
    const userId = getUserId(req);
    if (userId) {
        const found = await query('SELECT id FROM users WHERE id=$1', [userId]);
        if (found[0]) return NextResponse.json({ ok: true });
    }
    const [user] = await query<{ id: string }>(
        'INSERT INTO users DEFAULT VALUES RETURNING id'
    );
    const year = 60 * 60 * 24 * 365;
    const res = NextResponse.json({ ok: true });
    setAuthCookie(res, SESSION_COOKIE, signToken({ uid: user.id }, year), year);
    return res;
}

// ==================== ROUTE: me ====================
async function h_me_GET(req: NextRequest) {
    const userId = getUserId(req);
    if (!userId)
        return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

    const [membership, users, stores] = await Promise.all([
        getMembership(userId),
        query<{
            display_name: string | null;
            phone: string | null;
            terms_accepted_at: string | null;
            blocked_at: string | null;
            blocked_reason: string | null;
            has_password: boolean;
        }>(
            `SELECT display_name, phone, terms_accepted_at, blocked_at, blocked_reason,
                    (password_hash IS NOT NULL) AS has_password
             FROM users WHERE id=$1`,
            [userId]
        ),
        query<{ status: string; store_name: string; admin_note: string | null }>(
            'SELECT status, store_name, admin_note FROM store_profiles WHERE user_id=$1',
            [userId]
        ),
    ]);
    const u = users[0];
    return NextResponse.json({
        membership,
        tiers: Object.values(TIERS),
        isAdmin: isAdminReq(req),
        profile: {
            displayName: u?.display_name ?? null,
            phoneMasked: maskPhone(u?.phone ?? null),
            hasPhone: !!u?.phone,
            termsAccepted: !!u?.terms_accepted_at,
            blocked: !!u?.blocked_at,
            blockedReason: u?.blocked_reason ?? null,
            hasPassword: !!u?.has_password,
        },
        store: stores[0] ?? null,
        pendingOrder:
            (
                await query(
                    `SELECT id, tier, amount_satang, status, fail_reason, created_at
                     FROM membership_orders
                     WHERE user_id=$1 AND (status IN ('pending','review')
                        OR (status='rejected' AND created_at > now() - interval '3 days'))
                     ORDER BY created_at DESC LIMIT 1`,
                    [userId]
                )
            )[0] ?? null,
    });
}

// ==================== ROUTE: membership/checkout ====================
// สร้างรายการสั่งซื้อ + QR PromptPay พร้อมยอดเงิน (เก็บเบอร์โทรจริง + การยอมรับเงื่อนไข)
async function h_membership_checkout_POST(req: NextRequest) {
    const uid = getUserId(req);
    if (!uid)
        return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    const blocked = await blockedResponse(uid);
    if (blocked) return blocked;

    const body = await req.json().catch(() => ({}));
    const tier = body?.tier;
    if (!isPaidTier(tier))
        return NextResponse.json({ error: 'ไม่พบแพ็กเกจ' }, { status: 400 });
    const info = TIERS[tier];

    const m = await getMembership(uid);
    if (TIER_RANK[m.tier] >= TIER_RANK[tier])
        return NextResponse.json(
            { error: `คุณมีสิทธิ์ ${m.tierName} อยู่แล้ว` },
            { status: 400 }
        );

    const phone = String(body?.phone ?? '').replace(/\D/g, '');
    if (!PHONE_RE.test(phone))
        return NextResponse.json(
            { error: 'กรุณากรอกเบอร์มือถือจริง 10 หลัก (เช่น 08x-xxx-xxxx)' },
            { status: 400 }
        );
    if (body?.acceptTerms !== true)
        return NextResponse.json(
            { error: 'กรุณาอ่านและยอมรับเงื่อนไขการใช้งาน' },
            { status: 400 }
        );
    const displayName = str(body?.displayName, 50);
    const password = typeof body?.password === 'string' ? body.password : '';
    const pwRow = await query<{ has: boolean }>(
        'SELECT (password_hash IS NOT NULL) AS has FROM users WHERE id=$1',
        [uid]
    );
    const needPassword = !pwRow[0]?.has;
    if (needPassword && password.length < PW_MIN)
        return NextResponse.json(
            { error: `กรุณาตั้งรหัสผ่านอย่างน้อย ${PW_MIN} ตัวอักษร (ใช้เข้าสู่ระบบสมาชิกจากเครื่องอื่น)` },
            { status: 400 }
        );
    const badName = textViolation(displayName);
    if (badName) return NextResponse.json({ error: badName }, { status: 422 });

    const taken = await query<{ blocked_at: string | null }>(
        'SELECT blocked_at FROM users WHERE phone=$1 AND id<>$2',
        [phone, uid]
    );
    if (taken[0])
        return NextResponse.json(
            {
                error: taken[0].blocked_at
                    ? 'เบอร์โทรนี้ถูกระงับการใช้งาน'
                    : 'เบอร์โทรนี้เป็นสมาชิกอยู่แล้ว — กรุณากด "เข้าสู่ระบบสมาชิก" ด้วยเบอร์และรหัสผ่าน',
                needLogin: !taken[0].blocked_at,
            },
            { status: 409 }
        );

    if (info.isStore) {
        const sp = await query<{ status: string }>(
            'SELECT status FROM store_profiles WHERE user_id=$1',
            [uid]
        );
        if (!sp[0])
            return NextResponse.json(
                { error: 'กรุณากรอกข้อมูลยืนยันตัวตนร้านค้า (แผนที่ + รูปหน้าร้าน) ก่อนชำระเงิน', needStore: true },
                { status: 400 }
            );
        if (sp[0].status === 'rejected')
            return NextResponse.json(
                { error: 'ข้อมูลร้านค้าไม่ผ่านการตรวจสอบ กรุณาแก้ไขแล้วส่งใหม่', needStore: true },
                { status: 400 }
            );
    }

    const [recent] = await query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM membership_orders
         WHERE user_id=$1 AND created_at > now() - interval '1 hour'`,
        [uid]
    );
    if (recent.n >= 5)
        return NextResponse.json(
            { error: 'สร้างรายการบ่อยเกินไป กรุณารอสักครู่' },
            { status: 429 }
        );

    try {
        await query(
            `UPDATE users SET phone=$2,
                    terms_accepted_at = COALESCE(terms_accepted_at, now()),
                    display_name = COALESCE(NULLIF($3,''), display_name),
                    password_hash = COALESCE(password_hash, $4)
             WHERE id=$1`,
            [uid, phone, displayName, needPassword ? hashPassword(password) : null]
        );
    } catch (err) {
        if ((err as { code?: string }).code === '23505')
            return NextResponse.json(
                { error: 'เบอร์โทรนี้ถูกใช้สมัครสมาชิกแล้ว' },
                { status: 409 }
            );
        throw err;
    }

    const [order] = await query<{ id: string; created_at: string }>(
        `INSERT INTO membership_orders (user_id, tier, amount_satang)
         VALUES ($1,$2,$3) RETURNING id, created_at`,
        [uid, tier, info.priceSatang]
    );
    const qrDataUrl = await buildPromptPayQr(info.priceSatang / 100);
    await audit(uid, 'membership_order_created', { orderId: order.id, tier }, ipHash(req));

    return NextResponse.json({
        orderId: order.id,
        tier,
        tierName: info.name,
        amountSatang: info.priceSatang,
        qrDataUrl,
        promptpayId: maskPhone(PROMPTPAY_ID),
        expiresAt: new Date(Date.parse(order.created_at) + 24 * 3600_000).toISOString(),
    });
}

// ==================== ROUTE: membership/verify (แนบสลิป) ====================
const MAX_SLIP_BYTES = 4 * 1024 * 1024;

async function h_membership_verify_POST(req: NextRequest) {
    const uid = getUserId(req);
    if (!uid)
        return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    const blocked = await blockedResponse(uid);
    if (blocked) return blocked;

    const form = await req.formData().catch(() => null);
    const orderId = form?.get('orderId');
    const slip = form?.get('slip');
    if (!isUuid(orderId) || !(slip instanceof Blob) || slip.size === 0)
        return NextResponse.json({ error: 'กรุณาแนบรูปสลิปการโอนเงิน' }, { status: 400 });
    if (slip.size > MAX_SLIP_BYTES)
        return NextResponse.json({ error: 'รูปสลิปใหญ่เกิน 4MB' }, { status: 400 });
    if (slip.type && !slip.type.startsWith('image/'))
        return NextResponse.json({ error: 'ไฟล์สลิปต้องเป็นรูปภาพ' }, { status: 400 });

    const rows = await query<{
        id: string;
        tier: string;
        amount_satang: number;
        status: string;
        created_at: string;
        verify_attempts: number;
    }>(
        `SELECT id, tier, amount_satang, status, created_at, verify_attempts
         FROM membership_orders WHERE id=$1 AND user_id=$2`,
        [orderId, uid]
    );
    const order = rows[0];
    if (!order) return NextResponse.json({ error: 'ไม่พบรายการ' }, { status: 404 });
    if (order.status === 'succeeded')
        return NextResponse.json({ ok: true, status: 'succeeded' });
    if (order.status === 'review')
        return NextResponse.json({ ok: true, status: 'review' });
    if (order.status !== 'pending' || !isPaidTier(order.tier))
        return NextResponse.json(
            { error: 'รายการนี้หมดอายุแล้ว กรุณาเริ่มสมัครใหม่' },
            { status: 400 }
        );
    if (order.verify_attempts >= 10)
        return NextResponse.json(
            { error: 'แนบสลิปเกินจำนวนครั้งที่กำหนด กรุณาติดต่อแอดมิน' },
            { status: 429 }
        );
    await query(
        'UPDATE membership_orders SET verify_attempts = verify_attempts + 1 WHERE id=$1',
        [order.id]
    );

    const ip = ipHash(req);
    const fail = async (error: string, status = 400) => {
        await audit(uid, 'slip_rejected', { orderId: order.id, error }, ip);
        return NextResponse.json({ error }, { status });
    };

    // 0) ยังไม่ได้ตั้งค่า SlipOK → เก็บสลิปชั่วคราวให้แอดมินตรวจเอง (ลบทิ้งเมื่ออนุมัติ/ปฏิเสธ)
    if (!process.env.SLIPOK_BRANCH_ID || !process.env.SLIPOK_API_KEY) {
        let slipUrl: string | null = null;
        if (process.env.BLOB_READ_WRITE_TOKEN) {
            try {
                const blob = await put(`kinjing/slips/${order.id}.jpg`, slip, {
                    access: 'public',
                    addRandomSuffix: true,
                    contentType: slip.type || 'image/jpeg',
                });
                slipUrl = blob.url;
            } catch (err) {
                console.error('slip upload failed', err);
            }
        }
        await query(
            `UPDATE membership_orders SET status='review', slip_url=$2 WHERE id=$1 AND status='pending'`,
            [order.id, slipUrl]
        );
        await audit(uid, 'slip_submitted_for_review', { orderId: order.id }, ip);
        return NextResponse.json({ ok: true, status: 'review' });
    }

    // 1) ส่งรูปไปให้ Slip API ตรวจ (รูปสลิปไม่ถูกเก็บไว้ที่ใดเลย — ประหยัดพื้นที่)
    const v = await verifySlipWithSlipOk(slip, order.amount_satang / 100);
    if (!v.ok) return fail(v.error);
    const d = v.data;

    // 2) ยอดเงินตรงไหม?
    const paid = Math.round(Number(d.amount) * 100);
    if (paid !== order.amount_satang)
        return fail(
            `ยอดเงินในสลิป (${Number(d.amount).toLocaleString()} บาท) ไม่ตรงกับแพ็กเกจ (${order.amount_satang / 100} บาท)`
        );

    // 3) ชื่อบัญชีผู้รับตรงไหม?
    if (!receiverMatches(d.receiver))
        return fail('บัญชีผู้รับในสลิปไม่ตรงกับบัญชีของระบบ');

    // 4) ต้องเป็นการโอนหลังสร้างรายการ (กันเอาสลิปเก่ามาใช้)
    const t = d.transTimestamp ? Date.parse(d.transTimestamp) : NaN;
    if (Number.isFinite(t) && t < Date.parse(order.created_at) - 10 * 60_000)
        return fail('สลิปนี้เป็นการโอนก่อนสร้างรายการชำระเงิน');

    // 5) สลิปนี้เคยใช้หรือยัง? (เช็ค Ref Number กับ Database)
    const ref = String(d.transRef ?? '').trim();
    if (!ref) return fail('อ่านเลขอ้างอิงจากสลิปไม่ได้');

    const result = await withTx(async (c) => {
        const dup = await c.query(
            'SELECT 1 FROM membership_orders WHERE slip_ref=$1',
            [ref]
        );
        if (dup.rows[0]) return 'duplicate' as const;
        const upd = await c.query(
            `UPDATE membership_orders
             SET status='succeeded', paid_at=now(), slip_ref=$2, slip_sender=$3
             WHERE id=$1 AND status='pending' RETURNING id`,
            [order.id, ref, str(d.sender?.displayName ?? d.sender?.name, 120) || null]
        );
        if (!upd.rows[0]) return 'not_pending' as const;
        await activateMembershipTx(c, uid, order.tier as PaidTier, order.id);
        await auditTx(c, uid, 'membership_activated', {
            orderId: order.id,
            tier: order.tier,
            amount: order.amount_satang,
            ref,
        }, ip);
        return 'ok' as const;
    }).catch((err) => {
        if ((err as { code?: string }).code === '23505') return 'duplicate' as const;
        throw err;
    });

    if (result === 'duplicate') return fail('สลิปนี้ถูกใช้ไปแล้ว', 409);
    if (result === 'not_pending')
        return NextResponse.json({ error: 'รายการนี้ถูกดำเนินการแล้ว' }, { status: 409 });

    return NextResponse.json({
        ok: true,
        status: 'succeeded',
        tier: order.tier,
        tierName: TIERS[order.tier as PaidTier].name,
    });
}

// ==================== ROUTE: moderate (ตรวจไฟล์ทันทีหลังอัปโหลด) ====================
async function h_moderate_POST(req: NextRequest) {
    const uid = getUserId(req);
    if (!uid)
        return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    const blocked = await blockedResponse(uid);
    if (blocked) return blocked;
    const body = await req.json().catch(() => ({}));
    const items = parseMediaItems([body]);
    if (!items[0]) return NextResponse.json({ error: 'bad request' }, { status: 400 });
    const r = await moderateMedia(items, uid, ipHash(req));
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ ok: true });
}

// ==================== ROUTE: reviews ====================
const FREE_REVIEW_LIMIT = 20;

async function h_reviews_GET(req: NextRequest) {
    const uid = getUserId(req);
    const m = uid ? await getMembership(uid) : null;
    const tier: Tier = m?.tier ?? 'free';
    const admin = isAdminReq(req);
    const canSeeExclusive = isStoreTier(tier) || admin;

    let limit = Math.min(
        Math.max(parseInt(req.nextUrl.searchParams.get('limit') ?? '20', 10) || 20, 1),
        50
    );
    const offset = Math.max(
        parseInt(req.nextUrl.searchParams.get('offset') ?? '0', 10) || 0,
        0
    );
    // ผู้ใช้ทั่วไปอ่านได้จำกัด — สมาชิกอ่านรีวิวได้ไม่จำกัด
    const limited = tier === 'free' && !admin;
    if (limited) limit = Math.min(limit, Math.max(FREE_REVIEW_LIMIT - offset, 0));

    const [total] = await query<{ n: number }>(
        'SELECT COUNT(*)::int AS n FROM restaurants'
    );
    if (limit === 0)
        return NextResponse.json({
            reviews: [],
            isVip: m?.isVip ?? false,
            tier,
            limited,
            freeLimit: FREE_REVIEW_LIMIT,
            total: total.n,
        });

    const rows = await query<Record<string, unknown> & { is_exclusive: boolean }>(
        `SELECT r.id, r.name, r.category, r.rating, r.rating_count, r.must_try, r.tags,
                r.media_items, r.reviewer_name, r.view_count, r.created_at,
                r.latitude, r.longitude, r.address, r.recommender_name, r.is_exclusive,
                (r.boosted_until IS NOT NULL AND r.boosted_until > now()) AS boosted,
                ($3::uuid IS NOT NULL AND r.reviewer_id = $3::uuid) AS is_mine,
                (SELECT score FROM review_ratings rr
                  WHERE rr.restaurant_id = r.id AND rr.user_id = $3::uuid) AS my_score,
                COALESCE((
                    SELECT json_agg(json_build_object(
                        'id', p.id, 'title', p.title, 'description', p.description,
                        'coupon_code', p.coupon_code, 'discount_text', p.discount_text,
                        'ends_at', p.ends_at, 'kind', p.kind, 'quota', p.quota,
                        'claimed_count', p.claimed_count,
                        'my_code', (SELECT pc.code FROM promotion_claims pc
                                    WHERE pc.promotion_id = p.id AND pc.user_id = $3::uuid))
                        ORDER BY p.ends_at)
                    FROM promotions p
                    WHERE p.restaurant_id = r.id AND now() BETWEEN p.starts_at AND p.ends_at
                ), '[]'::json) AS promotions
         FROM restaurants r
         LEFT JOIN users ru ON ru.id = r.reviewer_id
         WHERE ru.blocked_at IS NULL
         ORDER BY (r.boosted_until IS NOT NULL AND r.boosted_until > now()) DESC,
                  r.view_count DESC, r.created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset, uid]
    );

    // รีวิว Exclusive: เห็นเต็มเฉพาะสมาชิกระดับร้านค้าขึ้นไป
    const reviews = rows.map((r) =>
        r.is_exclusive && !canSeeExclusive
            ? {
                  ...r,
                  name: '🔒 รีวิว Exclusive',
                  must_try: 'เนื้อหานี้สำหรับสมาชิกระดับร้านค้าขึ้นไป',
                  media_items: [],
                  address: null,
                  latitude: null,
                  longitude: null,
                  recommender_name: null,
                  promotions: [],
                  exclusive_locked: true,
              }
            : r
    );
    return NextResponse.json({
        reviews,
        isVip: m?.isVip ?? false,
        tier,
        limited,
        freeLimit: FREE_REVIEW_LIMIT,
        total: total.n,
    });
}

async function h_reviews_POST(req: NextRequest) {
    const uid = getUserId(req);
    if (!uid)
        return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    const blocked = await blockedResponse(uid);
    if (blocked) return blocked;

    const body = await req.json().catch(() => ({}));
    const name =
        typeof body?.name === 'string' ? body.name.trim().slice(0, 200) : '';
    const category =
        typeof body?.category === 'string'
            ? body.category.trim().slice(0, 100)
            : 'สตรีทฟู้ดร้านลับ';
    const mustTry =
        typeof body?.mustTry === 'string' ? body.mustTry.trim().slice(0, 300) : '';
    const mediaType = body?.mediaType === 'video' ? 'video' : 'image';
    const mediaUrl =
        typeof body?.mediaUrl === 'string' ? body.mediaUrl.trim().slice(0, 500) : '';

    const mediaItems = parseMediaItems(body?.mediaItems);

    const latitude = Number.isFinite(Number(body?.latitude))
        ? Number(body.latitude)
        : null;
    const longitude = Number.isFinite(Number(body?.longitude))
        ? Number(body.longitude)
        : null;
    const address =
        typeof body?.address === 'string'
            ? body.address.trim().slice(0, 500)
            : null;
    const recommenderName =
        typeof body?.recommenderName === 'string'
            ? body.recommenderName.trim().slice(0, 50)
            : null;

    if (!name || !mustTry) {
        return NextResponse.json(
            { error: 'กรุณากรอกชื่อร้านและเมนูต้องลอง' },
            { status: 400 }
        );
    }

    // ตรวจข้อความ + ภาพ/วิดีโอ ก่อนบันทึก (ผิดกฎ → เตือนและไม่บันทึก)
    const badText = textViolation(name, category, mustTry, address, recommenderName);
    if (badText) {
        await audit(uid, 'review_rejected_text', { name }, ipHash(req));
        return NextResponse.json({ error: badText }, { status: 422 });
    }
    const mod = await moderateMedia(
        mediaUrl ? [...mediaItems, { type: mediaType, url: mediaUrl }] : mediaItems,
        uid,
        ipHash(req)
    );
    if (!mod.ok) return NextResponse.json({ error: mod.error }, { status: mod.status });

    const users = await query<{ display_name: string }>(
        'SELECT display_name FROM users WHERE id=$1',
        [uid]
    );
    const reviewerName = users[0]?.display_name ?? '@Anonymous';

    const [row] = await query<{ id: string }>(
        `INSERT INTO restaurants
         (name, category, must_try, media_type, media_url, media_items,
          reviewer_id, reviewer_name, latitude, longitude, address, recommender_name)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [
            name,
            category,
            mustTry,
            mediaType,
            mediaUrl,
            JSON.stringify(mediaItems),
            uid,
            reviewerName,
            latitude,
            longitude,
            address,
            recommenderName,
        ]
    );
    await audit(
        uid,
        'review_created',
        { restaurantId: row.id, mediaCount: mediaItems.length },
        ipHash(req)
    );
    return NextResponse.json({ ok: true, id: row.id });
}

// ==================== ROUTE: reviews/:id (PATCH — แก้ไข) ====================
async function h_reviews_id_PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    if (!isUuid(id))
        return NextResponse.json({ error: 'bad request' }, { status: 400 });

    const uid = getUserId(req);
    if (!uid)
        return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

    const owners = await query<{ reviewer_id: string | null; media_items: unknown }>(
        'SELECT reviewer_id, media_items FROM restaurants WHERE id=$1',
        [id]
    );
    if (!owners[0])
        return NextResponse.json({ error: 'not found' }, { status: 404 });

    const isAdmin = isAdminReq(req);
    if (!isAdmin) {
        const blocked = await blockedResponse(uid);
        if (blocked) return blocked;
    }
    if (owners[0].reviewer_id !== uid && !isAdmin) {
        return NextResponse.json(
            { error: 'คุณไม่ใช่เจ้าของรีวิวนี้ — กรุณาส่งคำขอให้แอดมิน' },
            { status: 403 }
        );
    }

    const body = await req.json().catch(() => ({}));
    const name =
        typeof body?.name === 'string' ? body.name.trim().slice(0, 200) : '';
    const category =
        typeof body?.category === 'string'
            ? body.category.trim().slice(0, 100)
            : 'สตรีทฟู้ดร้านลับ';
    const mustTry =
        typeof body?.mustTry === 'string' ? body.mustTry.trim().slice(0, 300) : '';
    const mediaItems = parseMediaItems(body?.mediaItems);

    if (!name || !mustTry) {
        return NextResponse.json(
            { error: 'กรุณากรอกชื่อร้านและเมนูต้องลอง' },
            { status: 400 }
        );
    }

    const badText = textViolation(name, category, mustTry);
    if (badText) return NextResponse.json({ error: badText }, { status: 422 });
    const existing = new Set(
        parseMediaItems(
            typeof owners[0].media_items === 'string'
                ? JSON.parse(owners[0].media_items as string)
                : owners[0].media_items
        ).map((x) => x.url)
    );
    const mod = await moderateMedia(mediaItems, isAdmin ? 'admin' : uid, ipHash(req), existing);
    if (!mod.ok) return NextResponse.json({ error: mod.error }, { status: mod.status });

    const firstMedia = mediaItems[0];
    const mediaType = firstMedia?.type ?? 'image';
    const mediaUrl = firstMedia?.url ?? null;

    await query(
        `UPDATE restaurants
         SET name=$2, category=$3, must_try=$4,
             media_type=$5, media_url=$6, media_items=$7::jsonb,
             updated_at=now()
         WHERE id=$1`,
        [
            id,
            name,
            category,
            mustTry,
            mediaType,
            mediaUrl,
            JSON.stringify(mediaItems),
        ]
    );

    await audit(
        uid,
        'review_updated',
        { restaurantId: id, mediaCount: mediaItems.length },
        ipHash(req)
    );

    return NextResponse.json({ ok: true });
}

// ==================== ROUTE: reviews/:id (DELETE — ลบ) ====================
async function h_reviews_id_DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    if (!isUuid(id))
        return NextResponse.json({ error: 'bad request' }, { status: 400 });

    const uid = getUserId(req);
    const isAdmin = isAdminReq(req);

    if (!uid && !isAdmin)
        return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

    const owners = await query<{ reviewer_id: string | null }>(
        'SELECT reviewer_id FROM restaurants WHERE id=$1',
        [id]
    );
    if (!owners[0])
        return NextResponse.json({ error: 'not found' }, { status: 404 });

    if (owners[0].reviewer_id !== uid && !isAdmin) {
        return NextResponse.json(
            { error: 'คุณไม่ใช่เจ้าของรีวิวนี้' },
            { status: 403 }
        );
    }

    await query('DELETE FROM restaurants WHERE id=$1', [id]);

    await audit(
        isAdmin ? 'admin' : uid,
        'review_deleted',
        { restaurantId: id },
        ipHash(req)
    );

    return NextResponse.json({ ok: true });
}

// ==================== ROUTE: reviews/:id/edit_request ====================
async function h_reviews_id_edit_request_POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    if (!isUuid(id))
        return NextResponse.json({ error: 'bad request' }, { status: 400 });

    const uid = getUserId(req);
    if (!uid)
        return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

    const found = await query<{ id: string }>(
        'SELECT id FROM restaurants WHERE id=$1',
        [id]
    );
    if (!found[0])
        return NextResponse.json({ error: 'not found' }, { status: 404 });

    const body = await req.json().catch(() => ({}));
    const reason =
        typeof body?.reason === 'string' ? body.reason.trim().slice(0, 500) : '';
    const blockedEr = await blockedResponse(uid);
    if (blockedEr) return blockedEr;
    const badEr = textViolation(reason, body?.name, body?.mustTry);
    if (badEr) return NextResponse.json({ error: badEr }, { status: 422 });
    if (!reason || reason.length < 5) {
        return NextResponse.json(
            { error: 'กรุณาระบุเหตุผล (อย่างน้อย 5 ตัวอักษร)' },
            { status: 400 }
        );
    }

    const pending = await query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM review_edit_requests
         WHERE requester_id=$1 AND restaurant_id=$2 AND status='pending'`,
        [uid, id]
    );
    if (pending[0].n >= 3) {
        return NextResponse.json(
            { error: 'คุณมีคำขอที่รออยู่แล้ว 3 รายการสำหรับรีวิวนี้' },
            { status: 429 }
        );
    }

    const users = await query<{ display_name: string }>(
        'SELECT display_name FROM users WHERE id=$1',
        [uid]
    );
    const requesterName = users[0]?.display_name ?? '@Anonymous';

    const proposedChanges: Record<string, unknown> = {};
    if (typeof body?.name === 'string' && body.name.trim())
        proposedChanges.name = body.name.trim().slice(0, 200);
    if (typeof body?.category === 'string' && body.category.trim())
        proposedChanges.category = body.category.trim().slice(0, 100);
    if (typeof body?.mustTry === 'string' && body.mustTry.trim())
        proposedChanges.mustTry = body.mustTry.trim().slice(0, 300);
    if (Array.isArray(body?.mediaItems))
        proposedChanges.mediaItems = parseMediaItems(body.mediaItems);

    const [row] = await query<{ id: string }>(
        `INSERT INTO review_edit_requests
         (restaurant_id, requester_id, requester_name, reason, proposed_changes, status)
         VALUES ($1,$2,$3,$4,$5::jsonb,'pending') RETURNING id`,
        [id, uid, requesterName, reason, JSON.stringify(proposedChanges)]
    );

    await audit(
        uid,
        'review_edit_requested',
        { restaurantId: id, requestId: row.id, reason },
        ipHash(req)
    );

    return NextResponse.json({ ok: true, requestId: row.id });
}

// ==================== ROUTE: reviews/:id/view ====================
async function h_reviews_id_view_POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    if (!isUuid(id))
        return NextResponse.json({ error: 'bad request' }, { status: 400 });

    const uid = getUserId(req);
    const ip = ipHash(req);

    // บอทไม่นับวิว (ป้องกันปั่นยอดเพื่อรับค่าตอบแทน)
    if (isBotUA(req)) return NextResponse.json({ ok: true, counted: 0 });

    const dup = await query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM review_views
         WHERE restaurant_id=$1 AND ip_hash=$2 AND created_at > now() - interval '1 hour'`,
        [id, ip]
    );

    const counted = dup[0].n === 0 ? 1 : 0;

    await withTx(async (c) => {
        if (counted) {
            await c.query(
                `INSERT INTO review_views (restaurant_id, viewer_id, ip_hash)
                 VALUES ($1,$2,$3)`,
                [id, uid, ip]
            );
            await c.query(
                `UPDATE restaurants SET view_count = view_count + 1 WHERE id=$1`,
                [id]
            );
        }
    });

    const [row] = await query<{ view_count: number }>(
        'SELECT view_count FROM restaurants WHERE id=$1',
        [id]
    );
    return NextResponse.json({
        ok: true,
        counted,
        viewCount: row?.view_count ?? 0,
    });
}

// ==================== ROUTE: reviews/:id/rate ====================
// สมาชิก (basic ขึ้นไป) ให้คะแนนได้ 1 ครั้ง/คน/รีวิว, ต้องผ่านการยืนยันว่าเป็นมนุษย์
async function h_reviews_id_rate_POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    if (!isUuid(id))
        return NextResponse.json({ error: 'bad request' }, { status: 400 });

    const uid = getUserId(req);
    if (!uid)
        return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

    const blockedRt = await blockedResponse(uid);
    if (blockedRt) return blockedRt;
    const m = await getMembership(uid);
    if (m.tier === 'free') {
        return NextResponse.json(
            { error: 'ให้คะแนนได้เฉพาะสมาชิก กรุณาสมัครสมาชิกก่อน' },
            { status: 403 }
        );
    }

    const body = await req.json().catch(() => ({}));
    const score = Number(body?.score);
    if (!Number.isInteger(score) || score < 1 || score > 5)
        return NextResponse.json({ error: 'คะแนนต้องเป็น 1-5' }, { status: 400 });

    const humanErr = await verifyHuman(req, body ?? {});
    if (humanErr)
        return NextResponse.json({ error: humanErr }, { status: 403 });

    const ip = ipHash(req);

    const result = await withTx(async (c) => {
        const rest = await c.query(
            'SELECT reviewer_id FROM restaurants WHERE id=$1 FOR UPDATE',
            [id]
        );
        if (!rest.rows[0]) return { status: 404, error: 'not found' };
        if (rest.rows[0].reviewer_id === uid)
            return { status: 403, error: 'ไม่สามารถให้คะแนนรีวิวของตัวเองได้' };

        // 1 คน (บัญชี) และ 1 อุปกรณ์/IP ต่อ 1 รีวิว
        const dup = await c.query(
            `SELECT 1 FROM review_ratings
             WHERE restaurant_id=$1 AND (user_id=$2 OR ip_hash=$3) LIMIT 1`,
            [id, uid, ip]
        );
        if (dup.rows[0])
            return { status: 409, error: 'คุณให้คะแนนรีวิวนี้ไปแล้ว' };

        // จำกัดความถี่: ไม่เกิน 30 คะแนน/ชั่วโมง/บัญชี
        const rate = await c.query(
            `SELECT COUNT(*)::int AS n FROM review_ratings
             WHERE user_id=$1 AND created_at > now() - interval '1 hour'`,
            [uid]
        );
        if (rate.rows[0].n >= 30)
            return { status: 429, error: 'ให้คะแนนบ่อยเกินไป กรุณารอสักครู่' };

        await c.query(
            `INSERT INTO review_ratings (restaurant_id, user_id, score, ip_hash)
             VALUES ($1,$2,$3,$4) ON CONFLICT (restaurant_id, user_id) DO NOTHING`,
            [id, uid, score, ip]
        );
        const agg = await c.query(
            `UPDATE restaurants r SET
                rating = s.avg, rating_count = s.n
             FROM (SELECT ROUND(AVG(score)::numeric, 2) AS avg, COUNT(*)::int AS n
                   FROM review_ratings WHERE restaurant_id=$1) s
             WHERE r.id=$1 RETURNING r.rating, r.rating_count`,
            [id]
        );
        await auditTx(c, uid, 'review_rated', { restaurantId: id, score }, ip);
        return {
            status: 200,
            rating: Number(agg.rows[0].rating),
            ratingCount: agg.rows[0].rating_count as number,
        };
    });

    if (result.status !== 200)
        return NextResponse.json(
            { error: result.error },
            { status: result.status }
        );
    return NextResponse.json({ ok: true, ...result, myScore: score });
}

// ==================== ROUTE: reviews/:id/boost (premium) ====================
const BOOST_DAYS = 7;
/** โควตาบูสต์ = จำนวนเมนูที่สิทธิ์ลงขายได้ (ร้านค้า 10 / VIP 20) — นับรวมรีวิวและเมนูขาย */
async function activeBoostCount(uid: string, excludeId: string | null = null): Promise<number> {
    const [r] = await query<{ n: number }>(
        `SELECT (SELECT COUNT(*) FROM restaurants
                  WHERE reviewer_id=$1 AND boosted_until > now() AND id IS DISTINCT FROM $2::uuid)
              + (SELECT COUNT(*) FROM store_listings
                  WHERE owner_id=$1 AND boosted_until > now() AND id IS DISTINCT FROM $2::uuid) AS n`,
        [uid, excludeId]
    );
    return Number(r.n);
}

async function h_reviews_id_boost_POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    if (!isUuid(id))
        return NextResponse.json({ error: 'bad request' }, { status: 400 });
    const uid = getUserId(req);
    if (!uid)
        return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    const blockedSt = await blockedResponse(uid);
    if (blockedSt) return blockedSt;
    const m = await getMembership(uid);
    if (!m.isStore)
        return NextResponse.json(
            { error: 'ฟีเจอร์นี้สำหรับสมาชิกระดับร้านค้า' },
            { status: 403 }
        );

    const own = await query<{ reviewer_id: string | null }>(
        'SELECT reviewer_id FROM restaurants WHERE id=$1',
        [id]
    );
    if (!own[0]) return NextResponse.json({ error: 'not found' }, { status: 404 });
    if (own[0].reviewer_id !== uid)
        return NextResponse.json({ error: 'คุณไม่ใช่เจ้าของรีวิวนี้' }, { status: 403 });

    if ((await activeBoostCount(uid, id)) >= m.menuLimit)
        return NextResponse.json(
            { error: `บูสต์พร้อมกันได้สูงสุด ${m.menuLimit} รายการ (รีวิว + เมนูขาย)` },
            { status: 429 }
        );

    const [row] = await query<{ boosted_until: string }>(
        `UPDATE restaurants
         SET boosted_until = GREATEST(COALESCE(boosted_until, now()), now())
                             + make_interval(days => $2)
         WHERE id=$1 RETURNING boosted_until`,
        [id, BOOST_DAYS]
    );
    await audit(uid, 'review_boosted', { restaurantId: id }, ipHash(req));
    return NextResponse.json({ ok: true, boostedUntil: row.boosted_until });
}

// ==================== ROUTE: promotions (premium) ====================
async function h_promotions_POST(req: NextRequest) {
    const uid = getUserId(req);
    if (!uid)
        return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    const blockedSt = await blockedResponse(uid);
    if (blockedSt) return blockedSt;
    const m = await getMembership(uid);
    if (!m.isStore)
        return NextResponse.json(
            { error: 'ฟีเจอร์นี้สำหรับสมาชิกระดับร้านค้า' },
            { status: 403 }
        );

    const b = await req.json().catch(() => ({}));
    const restaurantId = isUuid(b?.restaurantId) ? b.restaurantId : null;
    const title = str(b?.title, 120);
    const description = str(b?.description, 500);
    const couponCode = str(b?.couponCode, 40).toUpperCase();
    const discountText = str(b?.discountText, 60);
    const days = Math.min(Math.max(parseInt(String(b?.days ?? '7'), 10) || 7, 1), 90);
    const kind = b?.kind === 'free_meal' ? 'free_meal' : 'discount';
    const quota =
        kind === 'free_meal'
            ? Math.min(Math.max(parseInt(String(b?.quota ?? '10'), 10) || 10, 1), 200)
            : null;
    const badPromo = textViolation(title, description, discountText);
    if (badPromo) return NextResponse.json({ error: badPromo }, { status: 422 });

    if (!restaurantId || !title)
        return NextResponse.json(
            { error: 'กรุณากรอกหัวข้อโปรโมชัน' },
            { status: 400 }
        );
    if (couponCode && !/^[A-Z0-9_-]{3,40}$/.test(couponCode))
        return NextResponse.json(
            { error: 'โค้ดคูปองใช้ได้เฉพาะ A-Z, 0-9, - และ _' },
            { status: 400 }
        );

    const own = await query<{ reviewer_id: string | null }>(
        'SELECT reviewer_id FROM restaurants WHERE id=$1',
        [restaurantId]
    );
    if (!own[0] || own[0].reviewer_id !== uid)
        return NextResponse.json(
            { error: 'สร้างโปรโมชันได้เฉพาะรีวิวของคุณ' },
            { status: 403 }
        );

    const [cnt] = await query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM promotions
         WHERE restaurant_id=$1 AND ends_at > now()`,
        [restaurantId]
    );
    if (cnt.n >= 3)
        return NextResponse.json(
            { error: 'มีโปรโมชันที่ใช้งานอยู่ครบ 3 รายการแล้ว' },
            { status: 429 }
        );

    // คูปองกินฟรี: สร้างได้เดือนละ 1 แคมเปญต่อร้าน (นับตามเวลาไทย)
    if (kind === 'free_meal') {
        const [fm] = await query<{ n: number }>(
            `SELECT COUNT(*)::int AS n FROM promotions
             WHERE owner_id=$1 AND kind='free_meal'
               AND date_trunc('month', created_at AT TIME ZONE 'Asia/Bangkok')
                 = date_trunc('month', now() AT TIME ZONE 'Asia/Bangkok')`,
            [uid]
        );
        if (fm.n >= 1)
            return NextResponse.json(
                { error: 'สร้างคูปองกินฟรีได้เดือนละ 1 แคมเปญ' },
                { status: 429 }
            );
    }

    const [row] = await query<{ id: string }>(
        `INSERT INTO promotions
         (restaurant_id, owner_id, title, description, coupon_code, discount_text, ends_at, kind, quota)
         VALUES ($1,$2,$3,$4,$5,$6, now() + make_interval(days => $7), $8, $9) RETURNING id`,
        [
            restaurantId,
            uid,
            title,
            description || null,
            couponCode || null,
            discountText || null,
            kind === 'free_meal' ? Math.min(days, 31) : days,
            kind,
            quota,
        ]
    );
    await audit(uid, 'promotion_created', { promotionId: row.id, restaurantId }, ipHash(req));
    return NextResponse.json({ ok: true, id: row.id });
}

async function h_promotions_id_DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    if (!isUuid(id))
        return NextResponse.json({ error: 'bad request' }, { status: 400 });
    const uid = getUserId(req);
    const admin = isAdminReq(req);
    const rows = await query(
        `DELETE FROM promotions WHERE id=$1 AND (owner_id=$2::uuid OR $3) RETURNING id`,
        [id, uid, admin]
    );
    if (!rows[0]) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
}

// ==================== ROUTE: sponsorships/active ====================
async function h_sponsorships_active_GET(req: NextRequest) {
    const uid = getUserId(req);
    if (uid) {
        const m = await getMembership(uid);
        if (m.isVip) return NextResponse.json({ sponsorship: null });
    }

    const rows = await query(
        `SELECT s.id, s.brand_name, s.headline, s.sub_text, s.cta_text,
                s.badge_text, s.target_url, r.name AS restaurant_name
         FROM sponsorships s
         LEFT JOIN restaurants r ON r.id = s.restaurant_id
         WHERE s.status='active' AND now() BETWEEN s.starts_at AND s.ends_at
         ORDER BY random() LIMIT 1`
    );
    return NextResponse.json(
        { sponsorship: rows[0] ?? null },
        { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
}
// ==================== ROUTE: admin/login ====================
const attempts = new Map<string, { n: number; reset: number }>();

async function h_admin_login_POST(req: NextRequest) {
    const expected = process.env.ADMIN_PASSWORD || 'admin1234';

    const ip = ipHash(req);
    const now = Date.now();
    const rec = attempts.get(ip);
    if (rec && rec.reset > now && rec.n >= 5) {
        return NextResponse.json(
            { error: 'too many attempts' },
            { status: 429 }
        );
    }

    const body = await req.json().catch(() => ({}));
    const password = typeof body?.password === 'string' ? body.password : '';

    if (!safeEqual(password, expected)) {
        attempts.set(
            ip,
            rec && rec.reset > now
                ? { n: rec.n + 1, reset: rec.reset }
                : { n: 1, reset: now + 15 * 60_000 }
        );
        await audit('admin', 'admin_login_failed', {}, ip);
        return NextResponse.json({ error: 'invalid' }, { status: 401 });
    }
    attempts.delete(ip);
    await audit('admin', 'admin_login', {}, ip);
    const ttl = 60 * 60 * 8;
    const res = NextResponse.json({ ok: true });
    setAuthCookie(res, ADMIN_COOKIE, signToken({ role: 'admin' }, ttl), ttl);
    return res;
}

// ==================== ROUTE: admin/logout ====================
async function h_admin_logout_POST() {
    const res = NextResponse.json({ ok: true });
    clearAuthCookie(res, ADMIN_COOKIE);
    return res;
}

// ==================== ROUTE: admin/summary ====================
async function h_admin_summary_GET(req: NextRequest) {
    if (!isAdminReq(req))
        return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    const [subs] = await query<{ total: string }>(
        `SELECT COALESCE(SUM(amount_satang), 0) AS total FROM payments
         WHERE kind='subscription' AND status='succeeded'`
    );
    const [inv] = await query<{ total: string }>(
        `SELECT COALESCE(SUM(amount_satang), 0) AS total FROM sponsorship_invoices
         WHERE status='paid'`
    );
    const [active] = await query<{ n: number }>(
        `SELECT (SELECT COUNT(*) FROM subscriptions
                  WHERE status='active' AND current_period_end > now())::int
              + (SELECT COUNT(*) FROM memberships)::int AS n`
    );
    const [mem] = await query<{ total: string }>(
        `SELECT COALESCE(SUM(amount_satang), 0) AS total FROM membership_orders
         WHERE status='succeeded'`
    );
    const [payouts] = await query<{ total: string }>(
        `SELECT COALESCE(SUM(amount_satang), 0) AS total FROM payouts
         WHERE status='paid'`
    );

    const sponsorships = await query(
        `SELECT s.id, s.brand_name, s.headline, s.sub_text, s.cta_text, s.target_url,
                s.status, s.monthly_fee_satang,
                s.starts_at, s.ends_at, r.name AS restaurant_name,
                i.id AS invoice_id, i.status AS invoice_status,
                i.amount_satang AS invoice_amount, i.period_start AS invoice_period_start
         FROM sponsorships s
         LEFT JOIN restaurants r ON r.id = s.restaurant_id
         LEFT JOIN LATERAL (
            SELECT id, status, amount_satang, period_start FROM sponsorship_invoices
            WHERE sponsorship_id = s.id
            ORDER BY period_start DESC LIMIT 1
         ) i ON true
         ORDER BY s.created_at DESC`
    );

    const topReviews = await query(
        `SELECT r.id, r.name, r.reviewer_name, r.view_count,
                u.id AS reviewer_id,
                COALESCE(p.total_satang, 0) AS total_payout_satang
         FROM restaurants r
         LEFT JOIN users u ON u.id = r.reviewer_id
         LEFT JOIN LATERAL (
            SELECT SUM(amount_satang)::int AS total_satang FROM payouts
            WHERE user_id = u.id AND status IN ('pending','paid')
         ) p ON true
         ORDER BY r.view_count DESC LIMIT 20`
    );

    const logs = await query(
        `SELECT id, created_at, actor, action, detail, ip_hash
         FROM audit_logs ORDER BY id DESC LIMIT 50`
    );

    const subsTotal = Number(subs.total) + Number(mem.total);
    const invTotal = Number(inv.total);
    const payoutTotal = Number(payouts.total);

    return NextResponse.json({
        revenue: {
            subscriptionsSatang: subsTotal,
            sponsorshipInvoicesSatang: invTotal,
            totalSatang: subsTotal + invTotal,
            payoutsPaidSatang: payoutTotal,
        },
        activeSubscribers: active.n,
        sponsorships,
        topReviews,
        logs,
    });
}

// ==================== ROUTE: admin/sponsorships ====================
function str(v: unknown, max = 300): string {
    return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

async function h_admin_sponsorships_POST(req: NextRequest) {
    if (!isAdminReq(req))
        return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    const b = await req.json().catch(() => ({}));
    const brandName = str(b.brandName, 120);
    const headline = str(b.headline, 200);
    const subText = str(b.subText, 300);
    const ctaText = str(b.ctaText, 60) || 'ดูโปรโมชัน →';
    const targetUrl = str(b.targetUrl, 500);
    const feeSatang = Math.round(Number(b.monthlyFeeBaht) * 100);
    const startsAt = new Date(b.startsAt);
    const endsAt = new Date(b.endsAt);
    const restaurantId = isUuid(b.restaurantId) ? b.restaurantId : null;

    let urlOk = false;
    try {
        urlOk = new URL(targetUrl).protocol === 'https:';
    } catch {
        urlOk = false;
    }

    if (
        !brandName ||
        !headline ||
        !urlOk ||
        !Number.isFinite(feeSatang) ||
        feeSatang <= 0 ||
        isNaN(startsAt.getTime()) ||
        isNaN(endsAt.getTime()) ||
        endsAt <= startsAt
    ) {
        return NextResponse.json(
            { error: 'ข้อมูลไม่ครบหรือไม่ถูกต้อง (ลิงก์ต้องขึ้นต้นด้วย https://)' },
            { status: 400 }
        );
    }

    const result = await withTx(async (c) => {
        const s = await c.query(
            `INSERT INTO sponsorships
             (restaurant_id, brand_name, headline, sub_text, cta_text, target_url,
              monthly_fee_satang, starts_at, ends_at, status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending') RETURNING id`,
            [
                restaurantId,
                brandName,
                headline,
                subText || null,
                ctaText,
                targetUrl,
                feeSatang,
                startsAt.toISOString(),
                endsAt.toISOString(),
            ]
        );
        await c.query(
            `INSERT INTO sponsorship_invoices
             (sponsorship_id, period_start, period_end, amount_satang, status, due_date)
             VALUES ($1, $2::date,
                     ($2::date + INTERVAL '1 month' - INTERVAL '1 day')::date,
                     $3, 'issued', ($2::date + 7))`,
            [s.rows[0].id, startsAt.toISOString().slice(0, 10), feeSatang]
        );
        await auditTx(
            c,
            'admin',
            'sponsorship_created',
            { sponsorshipId: s.rows[0].id, brandName, feeSatang },
            ipHash(req)
        );
        return s.rows[0].id as string;
    });

    return NextResponse.json({ ok: true, id: result });
}

async function h_admin_sponsorships_id_PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    if (!isAdminReq(req))
        return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    const { id } = await params;
    if (!isUuid(id))
        return NextResponse.json({ error: 'bad request' }, { status: 400 });

    const body = await req.json().catch(() => ({}));

    if (
        body?.status &&
        Object.keys(body).length === 1 &&
        ['pending', 'active', 'paused', 'expired'].includes(body.status)
    ) {
        const rows = await query(
            `UPDATE sponsorships SET status=$2 WHERE id=$1 RETURNING id`,
            [id, body.status]
        );
        if (!rows[0])
            return NextResponse.json({ error: 'not found' }, { status: 404 });

        await audit(
            'admin',
            'sponsorship_status_changed',
            { sponsorshipId: id, status: body.status },
            ipHash(req)
        );
        return NextResponse.json({ ok: true });
    }

    const brandName = str(body.brandName, 120);
    const headline = str(body.headline, 200);
    const subText = str(body.subText, 300);
    const ctaText = str(body.ctaText, 60) || 'ดูโปรโมชัน →';
    const targetUrl = str(body.targetUrl, 500);
    const feeSatang = Math.round(Number(body.monthlyFeeBaht) * 100);
    const startsAt = new Date(body.startsAt);
    const endsAt = new Date(body.endsAt);

    let urlOk = false;
    try {
        urlOk = new URL(targetUrl).protocol === 'https:';
    } catch {
        urlOk = false;
    }

    if (
        !brandName ||
        !headline ||
        !urlOk ||
        !Number.isFinite(feeSatang) ||
        feeSatang <= 0 ||
        isNaN(startsAt.getTime()) ||
        isNaN(endsAt.getTime()) ||
        endsAt <= startsAt
    ) {
        return NextResponse.json(
            { error: 'ข้อมูลไม่ครบหรือไม่ถูกต้อง (ลิงก์ต้องขึ้นต้นด้วย https://)' },
            { status: 400 }
        );
    }

    const rows = await query(
        `UPDATE sponsorships
         SET brand_name=$2, headline=$3, sub_text=$4, cta_text=$5, target_url=$6,
             monthly_fee_satang=$7, starts_at=$8, ends_at=$9
         WHERE id=$1 RETURNING id`,
        [
            id,
            brandName,
            headline,
            subText || null,
            ctaText,
            targetUrl,
            feeSatang,
            startsAt.toISOString(),
            endsAt.toISOString(),
        ]
    );
    if (!rows[0])
        return NextResponse.json({ error: 'not found' }, { status: 404 });

    await audit(
        'admin',
        'sponsorship_updated',
        { sponsorshipId: id, brandName, feeSatang },
        ipHash(req)
    );
    return NextResponse.json({ ok: true });
}

// ==================== ROUTE: admin/sponsorship_invoices/:id/paid ====================
async function h_admin_sponsorship_invoices_paid_POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    if (!isAdminReq(req))
        return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    if (!isUuid(id))
        return NextResponse.json({ error: 'bad request' }, { status: 400 });
    const ref =
        typeof body?.ref === 'string' ? body.ref.trim().slice(0, 100) : '';

    const ok = await withTx(async (c) => {
        const inv = await c.query(
            `UPDATE sponsorship_invoices SET status='paid', paid_at=now(), paid_ref=$2
             WHERE id=$1 AND status IN ('issued','overdue')
             RETURNING sponsorship_id, amount_satang`,
            [id, ref || null]
        );
        if (!inv.rows[0]) return false;
        await c.query(
            `UPDATE sponsorships SET status='active'
             WHERE id=$1 AND status IN ('pending','paused') AND ends_at > now()`,
            [inv.rows[0].sponsorship_id]
        );
        await auditTx(
            c,
            'admin',
            'sponsorship_invoice_marked_paid',
            { invoiceId: id, ref, amount: inv.rows[0].amount_satang },
            ipHash(req)
        );
        return true;
    });

    if (!ok)
        return NextResponse.json(
            { error: 'ไม่พบใบแจ้งหนี้ที่รอชำระ' },
            { status: 404 }
        );
    return NextResponse.json({ ok: true });
}

// ==================== ROUTE: admin/run_payout ====================
/**
 * สูตรค่าตอบแทน (ต่อรีวิว):
 *   อัตราต่อ 2,000 วิว = 100–200 บาท ตามคะแนนเฉลี่ย (1★ = 100, 5★ = 200, ยังไม่มีคะแนน = ขั้นต่ำ)
 *   ค่าตอบแทน = (วิวในรอบ / 2,000) × อัตรา × ส่วนแบ่ง 20–40%
 */
// ปรับแก้: ไม่มีการสร้างรายได้ให้ผู้ใช้ทั่วไป — ซ่อนระบบแบ่งรายได้ไว้ (เปิดได้ด้วย PAYOUTS_ENABLED=true)
const PAYOUTS_ENABLED = process.env.PAYOUTS_ENABLED === 'true';
const payoutsDisabled = () =>
    NextResponse.json({ error: 'ระบบแบ่งรายได้ถูกปิดใช้งาน' }, { status: 404 });

const VIEWS_PER_UNIT = 2000;
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

async function h_admin_run_payout_POST(req: NextRequest) {
    if (!PAYOUTS_ENABLED) return payoutsDisabled();
    if (!isAdminReq(req))
        return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const periodStart = str(body.periodStart, 10);
    const periodEnd = str(body.periodEnd, 10);
    const sharePercent = clamp(Number(body.sharePercent) || 30, 20, 40);
    const minRateSatang = clamp(Number(body.minRateBaht) || 100, 100, 200) * 100;
    const maxRateSatang =
        Math.max(clamp(Number(body.maxRateBaht) || 200, 100, 200) * 100, minRateSatang);

    if (
        !/^\d{4}-\d{2}-\d{2}$/.test(periodStart) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)
    ) {
        return NextResponse.json({ error: 'bad dates' }, { status: 400 });
    }

    const result = await withTx(async (c) => {
        const rev = await c.query(
            `SELECT
                COALESCE((
                    SELECT SUM(amount_satang) FROM payments
                    WHERE kind='subscription' AND status='succeeded'
                      AND paid_at >= $1::date AND paid_at < ($2::date + 1)
                ), 0)::bigint AS subs,
                COALESCE((
                    SELECT SUM(amount_satang) FROM sponsorship_invoices
                    WHERE status='paid'
                      AND paid_at >= $1::date AND paid_at < ($2::date + 1)
                ), 0)::bigint AS inv`,
            [periodStart, periodEnd]
        );
        const subs = Number(rev.rows[0].subs);
        const inv = Number(rev.rows[0].inv);
        const totalRevenue = subs + inv;

        const views = await c.query(
            `SELECT COUNT(*)::bigint AS n FROM review_views
             WHERE created_at >= $1::date AND created_at < ($2::date + 1)`,
            [periodStart, periodEnd]
        );
        const totalViews = Number(views.rows[0].n);

        // วิวต่อรีวิว + คะแนนเฉลี่ย → คำนวณเงินต่อผู้รีวิว
        const perReview = await c.query(
            `SELECT r.id, r.reviewer_id AS user_id, COUNT(*)::int AS views,
                    (SELECT AVG(score)::float FROM review_ratings rr
                      WHERE rr.restaurant_id = r.id) AS avg_score
             FROM review_views v
             JOIN restaurants r ON r.id = v.restaurant_id
             WHERE v.created_at >= $1::date AND v.created_at < ($2::date + 1)
               AND r.reviewer_id IS NOT NULL
               AND (v.viewer_id IS NULL OR v.viewer_id <> r.reviewer_id)
             GROUP BY r.id, r.reviewer_id`,
            [periodStart, periodEnd]
        );
        const byUser = new Map<string, { views: number; amount: number }>();
        for (const row of perReview.rows) {
            const avg = row.avg_score == null ? 1 : Number(row.avg_score);
            const rate =
                minRateSatang +
                ((clamp(avg, 1, 5) - 1) / 4) * (maxRateSatang - minRateSatang);
            const amount =
                (Number(row.views) / VIEWS_PER_UNIT) * rate * (sharePercent / 100);
            const cur = byUser.get(row.user_id) ?? { views: 0, amount: 0 };
            cur.views += Number(row.views);
            cur.amount += amount;
            byUser.set(row.user_id, cur);
        }
        const perUser = {
            rows: Array.from(byUser.entries()).map(([user_id, v]) => ({
                user_id,
                views: v.views,
                amount: Math.floor(v.amount),
            })),
        };
        const poolSatang = perUser.rows.reduce((s, r) => s + r.amount, 0);

        const pool = await c.query(
            `INSERT INTO revenue_pools
             (period_start, period_end, total_revenue_satang, share_percent,
              pool_satang, total_views, status)
             VALUES ($1,$2,$3,$4,$5,$6,'open')
             ON CONFLICT (period_start, period_end)
             DO UPDATE SET
                total_revenue_satang = EXCLUDED.total_revenue_satang,
                share_percent = EXCLUDED.share_percent,
                pool_satang = EXCLUDED.pool_satang,
                total_views = EXCLUDED.total_views,
                status = 'open'
             RETURNING id`,
            [
                periodStart,
                periodEnd,
                totalRevenue,
                sharePercent,
                poolSatang,
                totalViews,
            ]
        );
        const poolId = pool.rows[0].id as string;

        await c.query(
            `DELETE FROM payouts WHERE pool_id=$1 AND status='pending'`,
            [poolId]
        );

        if (totalViews === 0 || poolSatang === 0) {
            await c.query(
                `UPDATE revenue_pools SET status='distributed' WHERE id=$1`,
                [poolId]
            );
            return {
                poolId,
                totalRevenue,
                poolSatang,
                totalViews,
                distributed: 0,
            };
        }

        let distributed = 0;
        for (const row of perUser.rows) {
            const views = row.views;
            const amount = row.amount;
            if (amount <= 0) continue;
            distributed += amount;
            await c.query(
                `INSERT INTO payouts (pool_id, user_id, view_count, amount_satang, status)
                 VALUES ($1,$2,$3,$4,'pending')
                 ON CONFLICT (pool_id, user_id)
                 DO UPDATE SET view_count = EXCLUDED.view_count,
                               amount_satang = EXCLUDED.amount_satang`,
                [poolId, row.user_id, views, amount]
            );
        }

        await c.query(
            `UPDATE revenue_pools SET status='distributed' WHERE id=$1`,
            [poolId]
        );

        await auditTx(c, 'admin', 'payout_run', {
            poolId,
            sharePercent,
            minRateSatang,
            maxRateSatang,
            periodStart,
            periodEnd,
            totalRevenue,
            poolSatang,
            totalViews,
            distributed,
            userCount: perUser.rows.length,
        });

        return {
            poolId,
            totalRevenue,
            poolSatang,
            totalViews,
            distributed,
            userCount: perUser.rows.length,
        };
    });

    return NextResponse.json({ ok: true, ...result });
}

// ==================== ROUTE: admin/payouts/:id ====================
async function h_admin_payouts_id_PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    if (!PAYOUTS_ENABLED) return payoutsDisabled();
    if (!isAdminReq(req))
        return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    if (!isUuid(id))
        return NextResponse.json({ error: 'bad request' }, { status: 400 });
    const ref = str(body?.ref, 100);

    const rows = await query(
        `UPDATE payouts SET status='paid', paid_at=now(), paid_ref=$2
         WHERE id=$1 AND status='pending' RETURNING id, user_id, amount_satang`,
        [id, ref || null]
    );
    if (!rows[0])
        return NextResponse.json({ error: 'not found' }, { status: 404 });

    await audit(
        'admin',
        'payout_marked_paid',
        {
            payoutId: id,
            userId: rows[0].user_id,
            amount: rows[0].amount_satang,
            ref,
        },
        ipHash(req)
    );
    return NextResponse.json({ ok: true });
}

// ==================== ROUTE: admin/review_requests ====================
async function h_admin_review_requests_GET(req: NextRequest) {
    if (!isAdminReq(req))
        return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    const status = req.nextUrl.searchParams.get('status') ?? 'pending';
    const allowed = ['pending', 'approved', 'rejected', 'done', 'all'];
    const filter = allowed.includes(status) ? status : 'pending';

    const rows = await query(
        `SELECT r.id, r.restaurant_id, r.requester_id, r.requester_name,
                r.reason, r.proposed_changes, r.status, r.admin_note,
                r.reviewed_by, r.reviewed_at, r.created_at,
                rest.name AS restaurant_name,
                rest.must_try AS restaurant_must_try,
                rest.category AS restaurant_category,
                rest.reviewer_name AS restaurant_reviewer_name
         FROM review_edit_requests r
         JOIN restaurants rest ON rest.id = r.restaurant_id
         WHERE ($1 = 'all' OR r.status = $1)
         ORDER BY r.created_at DESC LIMIT 100`,
        [filter]
    );

    const [counts] = await query<{
        pending: number;
        approved: number;
        rejected: number;
        done: number;
    }>(
        `SELECT
            COUNT(*) FILTER (WHERE status='pending')::int AS pending,
            COUNT(*) FILTER (WHERE status='approved')::int AS approved,
            COUNT(*) FILTER (WHERE status='rejected')::int AS rejected,
            COUNT(*) FILTER (WHERE status='done')::int AS done
         FROM review_edit_requests`
    );

    return NextResponse.json({ requests: rows, counts });
}

async function h_admin_review_requests_id_PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    if (!isAdminReq(req))
        return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    const { id } = await params;
    if (!isUuid(id))
        return NextResponse.json({ error: 'bad request' }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const action = body?.action;
    const adminNote =
        typeof body?.adminNote === 'string'
            ? body.adminNote.trim().slice(0, 500)
            : null;

    if (!['approve', 'reject', 'done'].includes(action)) {
        return NextResponse.json({ error: 'bad request' }, { status: 400 });
    }

    const result = await withTx(async (c) => {
        const found = await c.query(
            `SELECT * FROM review_edit_requests WHERE id=$1 FOR UPDATE`,
            [id]
        );
        const r = found.rows[0];
        if (!r) return { ok: false as const, error: 'not found' };

        if (action === 'approve') {
            const changes = (r.proposed_changes ?? {}) as Record<string, unknown>;

            const orig = await c.query(
                `SELECT name, category, must_try, media_items
                 FROM restaurants WHERE id=$1 FOR UPDATE`,
                [r.restaurant_id]
            );
            if (!orig.rows[0])
                return { ok: false as const, error: 'restaurant not found' };

            const old = orig.rows[0];
            const newName =
                typeof changes.name === 'string' ? changes.name : old.name;
            const newCategory =
                typeof changes.category === 'string'
                    ? changes.category
                    : old.category;
            const newMustTry =
                typeof changes.mustTry === 'string'
                    ? changes.mustTry
                    : old.must_try;

            let newMedia = old.media_items;
            if (
                Array.isArray(changes.mediaItems) &&
                changes.mediaItems.length > 0
            ) {
                newMedia = JSON.stringify(changes.mediaItems);
            }

            const mediaArr =
                typeof newMedia === 'string' ? JSON.parse(newMedia) : newMedia;
            const firstMedia =
                Array.isArray(mediaArr) && mediaArr[0] ? mediaArr[0] : null;

            await c.query(
                `UPDATE restaurants
                 SET name=$2, category=$3, must_try=$4,
                     media_type=$5, media_url=$6, media_items=$7::jsonb,
                     updated_at=now()
                 WHERE id=$1`,
                [
                    r.restaurant_id,
                    newName,
                    newCategory,
                    newMustTry,
                    firstMedia?.type ?? 'image',
                    firstMedia?.url ?? null,
                    typeof newMedia === 'string'
                        ? newMedia
                        : JSON.stringify(newMedia),
                ]
            );
        }

        const newStatus =
            action === 'approve'
                ? 'approved'
                : action === 'reject'
                ? 'rejected'
                : 'done';

        await c.query(
            `UPDATE review_edit_requests
             SET status=$2, admin_note=$3, reviewed_by='admin',
                 reviewed_at=now()
             WHERE id=$1`,
            [id, newStatus, adminNote]
        );

        await auditTx(
            c,
            'admin',
            `review_request_${action}`,
            { requestId: id, restaurantId: r.restaurant_id, adminNote },
            ipHash(req)
        );

        return { ok: true as const };
    });

    if (!result.ok) {
        if (result.error === 'not found')
            return NextResponse.json({ error: 'not found' }, { status: 404 });
        return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
}

// ==================== ROUTE: me/payouts ====================
async function h_me_payouts_GET(req: NextRequest) {
    if (!PAYOUTS_ENABLED) return payoutsDisabled();
    const uid = getUserId(req);
    if (!uid)
        return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

    const rows = await query(
        `SELECT p.id, p.view_count, p.amount_satang, p.status, p.paid_at,
                p.created_at, rp.period_start, rp.period_end
         FROM payouts p
         JOIN revenue_pools rp ON rp.id = p.pool_id
         WHERE p.user_id=$1
         ORDER BY p.created_at DESC LIMIT 50`,
        [uid]
    );

    const [total] = await query<{ n: string }>(
        `SELECT COALESCE(SUM(amount_satang),0)::text AS n FROM payouts
         WHERE user_id=$1 AND status='paid'`,
        [uid]
    );
    const [pending] = await query<{ n: string }>(
        `SELECT COALESCE(SUM(amount_satang),0)::text AS n FROM payouts
         WHERE user_id=$1 AND status='pending'`,
        [uid]
    );

    return NextResponse.json({
        payouts: rows,
        totalPaidSatang: Number(total.n),
        totalPendingSatang: Number(pending.n),
    });
}

// ==================== ROUTE: me/review_requests ====================
async function h_me_review_requests_GET(req: NextRequest) {
    const uid = getUserId(req);
    if (!uid)
        return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

    const rows = await query(
        `SELECT r.id, r.restaurant_id, r.reason, r.status, r.admin_note,
                r.created_at, r.reviewed_at,
                rest.name AS restaurant_name
         FROM review_edit_requests r
         JOIN restaurants rest ON rest.id = r.restaurant_id
         WHERE r.requester_id=$1
         ORDER BY r.created_at DESC LIMIT 50`,
        [uid]
    );
    return NextResponse.json({ requests: rows });
}

// ==================== ROUTE: cron/daily ====================
async function h_cron_daily_GET(req: NextRequest) {
    const secretValue = process.env.CRON_SECRET;
    const auth = req.headers.get('authorization') ?? '';
    if (!secretValue || !safeEqual(auth, `Bearer ${secretValue}`)) {
        return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    await query(
        `UPDATE subscriptions SET status='expired'
         WHERE status='active' AND current_period_end < now()`
    );

    await query(
        `UPDATE payments SET status='failed'
         WHERE status='pending' AND created_at < now() - interval '2 days'`
    );
    await query(
        `UPDATE subscriptions SET status='canceled'
         WHERE status='pending' AND created_at < now() - interval '2 days'`
    );

    await query(
        `UPDATE membership_orders SET status='expired'
         WHERE status='pending' AND created_at < now() - interval '2 days'`
    );

    await query(
        `UPDATE sponsorships SET status='expired'
         WHERE status='active' AND ends_at < now()`
    );

    await query(
        `INSERT INTO sponsorship_invoices
            (sponsorship_id, period_start, period_end, amount_satang, status, due_date)
         SELECT s.id, l.period_end + 1,
                (l.period_end + 1 + INTERVAL '1 month' - INTERVAL '1 day')::date,
                s.monthly_fee_satang, 'issued', l.period_end + 1 + 7
         FROM sponsorships s
         JOIN LATERAL (
            SELECT period_end FROM sponsorship_invoices
            WHERE sponsorship_id = s.id
            ORDER BY period_start DESC LIMIT 1
         ) l ON true
         WHERE s.status='active'
           AND (l.period_end + 1) <= s.ends_at::date
           AND l.period_end <= current_date + 3
         ON CONFLICT (sponsorship_id, period_start) DO NOTHING`
    );

    return NextResponse.json({ ok: true });
}

// ==================== ROUTE: store/profile (ยืนยันตัวตนร้านค้า) ====================
// ป้องกันผู้ใช้ทั่วไปจ่ายเงินสวมรอยมาสแปมประกาศขายของ: ต้องมีแผนที่ร้าน + รูปหน้าร้าน และแอดมินอนุมัติ
function httpUrl(v: unknown, max = 500): string {
    const s = str(v, max);
    if (!s) return '';
    try {
        const u = new URL(s);
        return u.protocol === 'https:' || u.protocol === 'http:' ? s : '';
    } catch {
        return '';
    }
}

async function h_store_profile_POST(req: NextRequest) {
    const uid = getUserId(req);
    if (!uid)
        return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    const blocked = await blockedResponse(uid);
    if (blocked) return blocked;

    const b = await req.json().catch(() => ({}));
    const storeName = str(b?.storeName, 120);
    const mapUrl = httpUrl(b?.mapUrl);
    const lat = Number.isFinite(Number(b?.latitude)) && b?.latitude !== null && b?.latitude !== '' ? Number(b.latitude) : null;
    const lng = Number.isFinite(Number(b?.longitude)) && b?.longitude !== null && b?.longitude !== '' ? Number(b.longitude) : null;
    const address = str(b?.address, 300);
    const storefrontUrl = str(b?.storefrontUrl, 500);
    const contactPhone = String(b?.contactPhone ?? '').replace(/[^\d]/g, '').slice(0, 10);

    if (!storeName)
        return NextResponse.json({ error: 'กรุณากรอกชื่อร้าน' }, { status: 400 });
    if (!mapUrl && (lat === null || lng === null))
        return NextResponse.json(
            { error: 'กรุณาระบุตำแหน่งร้าน (ลิงก์ Google Maps หรือกดใช้ GPS)' },
            { status: 400 }
        );
    if (!storefrontUrl)
        return NextResponse.json({ error: 'กรุณาอัปโหลดรูปหน้าร้าน' }, { status: 400 });

    const bad = textViolation(storeName, address);
    if (bad) return NextResponse.json({ error: bad }, { status: 422 });
    const mod = await moderateMedia([{ type: 'image', url: storefrontUrl }], uid, ipHash(req));
    if (!mod.ok) return NextResponse.json({ error: mod.error }, { status: mod.status });

    await query(
        `INSERT INTO store_profiles
            (user_id, store_name, map_url, latitude, longitude, address, storefront_url, contact_phone, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending')
         ON CONFLICT (user_id) DO UPDATE SET
            store_name=EXCLUDED.store_name, map_url=EXCLUDED.map_url,
            latitude=EXCLUDED.latitude, longitude=EXCLUDED.longitude,
            address=EXCLUDED.address, storefront_url=EXCLUDED.storefront_url,
            contact_phone=EXCLUDED.contact_phone,
            status='pending', admin_note=NULL, reviewed_at=NULL, updated_at=now()`,
        [uid, storeName, mapUrl || null, lat, lng, address || null, storefrontUrl, contactPhone || null]
    );
    await audit(uid, 'store_profile_submitted', { storeName }, ipHash(req));
    return NextResponse.json({ ok: true, status: 'pending' });
}

// ==================== ROUTE: me/store ====================
async function h_me_store_GET(req: NextRequest) {
    const uid = getUserId(req);
    if (!uid)
        return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    const [m, profiles, listings] = await Promise.all([
        getMembership(uid),
        query(
            `SELECT store_name, map_url, latitude, longitude, address, storefront_url,
                    contact_phone, status, admin_note, updated_at
             FROM store_profiles WHERE user_id=$1`,
            [uid]
        ),
        query(
            `SELECT id, title, price_satang, promo_price_satang, coupon_code, discount_text,
                    description, image_url, active, created_at, boosted_until,
                    (boosted_until IS NOT NULL AND boosted_until > now()) AS boosted
             FROM store_listings WHERE owner_id=$1 ORDER BY created_at DESC`,
            [uid]
        ),
    ]);
    const [myReviews, [stats]] = await Promise.all([
        query(
            `SELECT r.id, r.name, r.category, r.view_count, r.rating, r.created_at, r.boosted_until,
                    (r.boosted_until IS NOT NULL AND r.boosted_until > now()) AS boosted,
                    (SELECT COUNT(*)::int FROM promotions p
                      WHERE p.restaurant_id = r.id AND now() BETWEEN p.starts_at AND p.ends_at) AS active_promos
             FROM restaurants r WHERE r.reviewer_id=$1
             ORDER BY r.created_at DESC LIMIT 50`,
            [uid]
        ),
        query<{ active_boosts: number; free_meal_month: number; active_promos: number }>(
            `SELECT
                ((SELECT COUNT(*) FROM restaurants
                  WHERE reviewer_id=$1 AND boosted_until > now())
                 + (SELECT COUNT(*) FROM store_listings
                  WHERE owner_id=$1 AND boosted_until > now()))::int AS active_boosts,
                (SELECT COUNT(*)::int FROM promotions
                  WHERE owner_id=$1 AND kind='free_meal'
                    AND date_trunc('month', created_at AT TIME ZONE 'Asia/Bangkok')
                      = date_trunc('month', now() AT TIME ZONE 'Asia/Bangkok')) AS free_meal_month,
                (SELECT COUNT(*)::int FROM promotions
                  WHERE owner_id=$1 AND now() BETWEEN starts_at AND ends_at) AS active_promos`,
            [uid]
        ),
    ]);
    return NextResponse.json({
        profile: profiles[0] ?? null,
        listings,
        menuLimit: m.menuLimit,
        isStore: m.isStore,
        tierName: m.tierName,
        myReviews,
        stats: {
            activeBoosts: stats.active_boosts,
            maxBoosts: m.menuLimit,
            boostDays: BOOST_DAYS,
            freeMealThisMonth: stats.free_meal_month,
            freeMealLimit: 1,
            activePromos: stats.active_promos,
        },
    });
}

// ==================== ROUTE: listings (ประกาศขายสินค้า/อาหาร) ====================
async function h_listings_GET(req: NextRequest) {
    const uid = getUserId(req);
    const rows = await query(
        `SELECT l.id, l.title, l.price_satang, l.promo_price_satang, l.coupon_code, l.discount_text,
                l.description, l.image_url, l.created_at,
                (l.boosted_until IS NOT NULL AND l.boosted_until > now()) AS boosted,
                sp.store_name, sp.latitude, sp.longitude, sp.address, sp.map_url,
                ($1::uuid IS NOT NULL AND l.owner_id = $1::uuid) AS is_mine
         FROM store_listings l
         JOIN store_profiles sp ON sp.user_id = l.owner_id AND sp.status = 'approved'
         JOIN users u ON u.id = l.owner_id AND u.blocked_at IS NULL
         WHERE l.active
         ORDER BY (l.boosted_until IS NOT NULL AND l.boosted_until > now()) DESC,
                  l.created_at DESC LIMIT 60`,
        [uid]
    );
    return NextResponse.json({ listings: rows });
}

function parseListing(b: Record<string, unknown> | null) {
    const title = str(b?.title, 120);
    const description = str(b?.description, 500);
    const priceBaht = Number(b?.priceBaht);
    const priceSatang =
        b?.priceBaht === '' || b?.priceBaht == null || !Number.isFinite(priceBaht)
            ? null
            : Math.round(Math.min(Math.max(priceBaht, 0), 100000) * 100);
    const imageUrl = str(b?.imageUrl, 500);
    const promoBaht = Number(b?.promoPriceBaht);
    const promoPriceSatang =
        b?.promoPriceBaht === '' || b?.promoPriceBaht == null || !Number.isFinite(promoBaht)
            ? null
            : Math.round(Math.min(Math.max(promoBaht, 0), 100000) * 100);
    const couponCode = str(b?.couponCode, 40).toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    const discountText = str(b?.discountText, 80);
    return { title, description, priceSatang, imageUrl, promoPriceSatang, couponCode, discountText };
}

async function storeGate(uid: string): Promise<NextResponse | { menuLimit: number }> {
    const blocked = await blockedResponse(uid);
    if (blocked) return blocked;
    const m = await getMembership(uid);
    if (!m.isStore)
        return NextResponse.json(
            { error: 'ลงประกาศขายได้เฉพาะสมาชิกระดับร้านค้า' },
            { status: 403 }
        );
    const sp = await query<{ status: string }>(
        'SELECT status FROM store_profiles WHERE user_id=$1',
        [uid]
    );
    if (!sp[0])
        return NextResponse.json(
            { error: 'กรุณากรอกข้อมูลยืนยันตัวตนร้านค้า (แผนที่ + รูปหน้าร้าน) ก่อน' },
            { status: 403 }
        );
    if (sp[0].status === 'rejected')
        return NextResponse.json(
            { error: 'ข้อมูลร้านค้าไม่ผ่านการตรวจสอบ กรุณาแก้ไขแล้วส่งใหม่' },
            { status: 403 }
        );
    // ร้านที่รออนุมัติ ลงเมนูเตรียมไว้ได้ แต่จะแสดงต่อสาธารณะเมื่อแอดมินอนุมัติแล้ว
    return { menuLimit: m.menuLimit };
}

async function h_listings_POST(req: NextRequest) {
    const uid = getUserId(req);
    if (!uid)
        return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    const gate = await storeGate(uid);
    if (gate instanceof NextResponse) return gate;

    const l = parseListing(await req.json().catch(() => null));
    if (!l.title)
        return NextResponse.json({ error: 'กรุณากรอกชื่อสินค้า/เมนู' }, { status: 400 });
    const bad = textViolation(l.title, l.description, l.discountText);
    if (bad) return NextResponse.json({ error: bad }, { status: 422 });
    if (l.imageUrl) {
        const mod = await moderateMedia([{ type: 'image', url: l.imageUrl }], uid, ipHash(req));
        if (!mod.ok) return NextResponse.json({ error: mod.error }, { status: mod.status });
    }

    const [cnt] = await query<{ n: number }>(
        'SELECT COUNT(*)::int AS n FROM store_listings WHERE owner_id=$1 AND active',
        [uid]
    );
    if (cnt.n >= gate.menuLimit)
        return NextResponse.json(
            { error: `ลงประกาศได้สูงสุด ${gate.menuLimit} เมนูตามระดับสมาชิก` },
            { status: 429 }
        );

    const [row] = await query<{ id: string }>(
        `INSERT INTO store_listings
            (owner_id, title, price_satang, description, image_url, promo_price_satang, coupon_code, discount_text)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [uid, l.title, l.priceSatang, l.description || null, l.imageUrl || null,
         l.promoPriceSatang, l.couponCode || null, l.discountText || null]
    );
    await audit(uid, 'listing_created', { listingId: row.id }, ipHash(req));
    return NextResponse.json({ ok: true, id: row.id });
}

async function h_listings_id_PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: 'bad request' }, { status: 400 });
    const uid = getUserId(req);
    if (!uid)
        return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    const gate = await storeGate(uid);
    if (gate instanceof NextResponse) return gate;

    const own = await query<{ image_url: string | null; active: boolean }>(
        'SELECT image_url, active FROM store_listings WHERE id=$1 AND owner_id=$2',
        [id, uid]
    );
    if (!own[0]) return NextResponse.json({ error: 'not found' }, { status: 404 });

    const body = await req.json().catch(() => null);
    const l = parseListing(body);
    const active = typeof body?.active === 'boolean' ? body.active : own[0].active;
    if (!l.title)
        return NextResponse.json({ error: 'กรุณากรอกชื่อสินค้า/เมนู' }, { status: 400 });
    const bad = textViolation(l.title, l.description, l.discountText);
    if (bad) return NextResponse.json({ error: bad }, { status: 422 });
    if (l.imageUrl && l.imageUrl !== own[0].image_url) {
        const mod = await moderateMedia([{ type: 'image', url: l.imageUrl }], uid, ipHash(req));
        if (!mod.ok) return NextResponse.json({ error: mod.error }, { status: mod.status });
    }
    if (active && !own[0].active) {
        const [cnt] = await query<{ n: number }>(
            'SELECT COUNT(*)::int AS n FROM store_listings WHERE owner_id=$1 AND active',
            [uid]
        );
        if (cnt.n >= gate.menuLimit)
            return NextResponse.json(
                { error: `ลงประกาศได้สูงสุด ${gate.menuLimit} เมนูตามระดับสมาชิก` },
                { status: 429 }
            );
    }
    await query(
        `UPDATE store_listings SET title=$3, price_satang=$4, description=$5,
                image_url=$6, active=$7, promo_price_satang=$8, coupon_code=$9,
                discount_text=$10, updated_at=now()
         WHERE id=$1 AND owner_id=$2`,
        [id, uid, l.title, l.priceSatang, l.description || null, l.imageUrl || null, active,
         l.promoPriceSatang, l.couponCode || null, l.discountText || null]
    );
    return NextResponse.json({ ok: true });
}

async function h_listings_id_DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: 'bad request' }, { status: 400 });
    const uid = getUserId(req);
    const admin = isAdminReq(req);
    if (!uid && !admin)
        return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    const rows = await query(
        `DELETE FROM store_listings WHERE id=$1 AND (owner_id=$2::uuid OR $3) RETURNING id`,
        [id, uid, admin]
    );
    if (!rows[0]) return NextResponse.json({ error: 'not found' }, { status: 404 });
    await audit(admin ? 'admin' : uid!, 'listing_deleted', { listingId: id }, ipHash(req));
    return NextResponse.json({ ok: true });
}

// ==================== ROUTE: listings/:id/boost (เมนูเด็ดแนะนำ) ====================
async function h_listings_id_boost_POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: 'bad request' }, { status: 400 });
    const uid = getUserId(req);
    if (!uid)
        return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    const gate = await storeGate(uid);
    if (gate instanceof NextResponse) return gate;
    const own = await query<{ active: boolean }>(
        'SELECT active FROM store_listings WHERE id=$1 AND owner_id=$2',
        [id, uid]
    );
    if (!own[0]) return NextResponse.json({ error: 'not found' }, { status: 404 });
    if (!own[0].active)
        return NextResponse.json({ error: 'เปิดขายเมนูนี้ก่อนจึงบูสต์ได้' }, { status: 400 });
    if ((await activeBoostCount(uid, id)) >= gate.menuLimit)
        return NextResponse.json(
            { error: `บูสต์พร้อมกันได้สูงสุด ${gate.menuLimit} รายการ (รีวิว + เมนูขาย)` },
            { status: 429 }
        );
    const [row] = await query<{ boosted_until: string }>(
        `UPDATE store_listings
         SET boosted_until = GREATEST(COALESCE(boosted_until, now()), now()) + make_interval(days => $2)
         WHERE id=$1 RETURNING boosted_until`,
        [id, BOOST_DAYS]
    );
    await audit(uid, 'listing_boosted', { listingId: id }, ipHash(req));
    return NextResponse.json({ ok: true, boostedUntil: row.boosted_until });
}

// ==================== ROUTE: promotions/:id/claim (คูปองกินฟรี) ====================
async function h_promotions_id_claim_POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: 'bad request' }, { status: 400 });
    const uid = getUserId(req);
    if (!uid)
        return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    const blocked = await blockedResponse(uid);
    if (blocked) return blocked;
    if (isBotUA(req))
        return NextResponse.json({ error: 'ตรวจพบการใช้งานอัตโนมัติ' }, { status: 403 });
    const ip = ipHash(req);

    const result = await withTx(async (c) => {
        const p = await c.query(
            `SELECT id, owner_id, quota, claimed_count FROM promotions
             WHERE id=$1 AND kind='free_meal' AND now() BETWEEN starts_at AND ends_at
             FOR UPDATE`,
            [id]
        );
        const promo = p.rows[0];
        if (!promo) return { status: 404, error: 'คูปองนี้หมดอายุหรือไม่มีอยู่' };
        if (promo.owner_id === uid)
            return { status: 403, error: 'ไม่สามารถรับคูปองของร้านตัวเองได้' };
        const mine = await c.query(
            'SELECT code FROM promotion_claims WHERE promotion_id=$1 AND user_id=$2',
            [id, uid]
        );
        if (mine.rows[0]) return { status: 200, code: mine.rows[0].code as string };
        const sameIp = await c.query(
            'SELECT 1 FROM promotion_claims WHERE promotion_id=$1 AND ip_hash=$2',
            [id, ip]
        );
        if (sameIp.rows[0])
            return { status: 409, error: 'อุปกรณ์นี้รับคูปองนี้ไปแล้ว' };
        if (promo.quota != null && promo.claimed_count >= promo.quota)
            return { status: 409, error: 'คูปองกินฟรีเดือนนี้ถูกรับครบแล้ว' };

        const code = 'FREE-' + crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 6);
        await c.query(
            `INSERT INTO promotion_claims (promotion_id, user_id, ip_hash, code)
             VALUES ($1,$2,$3,$4)`,
            [id, uid, ip, code]
        );
        await c.query(
            'UPDATE promotions SET claimed_count = claimed_count + 1 WHERE id=$1',
            [id]
        );
        await auditTx(c, uid, 'free_meal_claimed', { promotionId: id, code }, ip);
        return { status: 200, code };
    });

    if (result.status !== 200)
        return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true, code: result.code });
}

// ==================== ROUTE: reports (แจ้งเนื้อหาผิดกฎหมาย) ====================
async function h_reports_POST(req: NextRequest) {
    const uid = getUserId(req);
    if (!uid)
        return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    const b = await req.json().catch(() => ({}));
    const targetType = b?.targetType === 'listing' ? 'listing' : b?.targetType === 'review' ? 'review' : null;
    const targetId = isUuid(b?.targetId) ? b.targetId : null;
    const reason = str(b?.reason, 300);
    if (!targetType || !targetId)
        return NextResponse.json({ error: 'bad request' }, { status: 400 });
    if (reason.length < 3)
        return NextResponse.json({ error: 'กรุณาระบุเหตุผลที่แจ้ง' }, { status: 400 });

    const [today] = await query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM content_reports
         WHERE reporter_id=$1 AND created_at > now() - interval '1 day'`,
        [uid]
    );
    if (today.n >= 20)
        return NextResponse.json({ error: 'แจ้งบ่อยเกินไป กรุณารอสักครู่' }, { status: 429 });

    const dup = await query(
        `SELECT 1 FROM content_reports
         WHERE reporter_id=$1 AND target_type=$2 AND target_id=$3 AND status='open'`,
        [uid, targetType, targetId]
    );
    if (dup[0]) return NextResponse.json({ ok: true, duplicate: true });

    await query(
        `INSERT INTO content_reports (target_type, target_id, reporter_id, reason)
         VALUES ($1,$2,$3,$4)`,
        [targetType, targetId, uid, reason]
    );
    await audit(uid, 'content_reported', { targetType, targetId, reason }, ipHash(req));
    return NextResponse.json({ ok: true });
}

// ==================== ADMIN: moderation ====================
function forbidden() {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
}

async function h_admin_stores_GET(req: NextRequest) {
    if (!isAdminReq(req)) return forbidden();
    const status = req.nextUrl.searchParams.get('status') ?? 'pending';
    const rows = await query(
        `SELECT sp.user_id, sp.store_name, sp.map_url, sp.latitude, sp.longitude, sp.address,
                sp.storefront_url, sp.contact_phone, sp.status, sp.admin_note,
                sp.created_at, sp.updated_at, u.phone, u.blocked_at,
                m.tier AS membership_tier
         FROM store_profiles sp
         JOIN users u ON u.id = sp.user_id
         LEFT JOIN memberships m ON m.user_id = sp.user_id
         WHERE ($1 = 'all' OR sp.status = $1)
         ORDER BY sp.updated_at DESC LIMIT 100`,
        [status]
    );
    return NextResponse.json({ stores: rows });
}

async function h_admin_stores_id_PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    if (!isAdminReq(req)) return forbidden();
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: 'bad request' }, { status: 400 });
    const b = await req.json().catch(() => ({}));
    const action = b?.action;
    if (action !== 'approve' && action !== 'reject')
        return NextResponse.json({ error: 'bad action' }, { status: 400 });
    const rows = await query(
        `UPDATE store_profiles SET status=$2, admin_note=$3, reviewed_at=now(), updated_at=now()
         WHERE user_id=$1 RETURNING user_id`,
        [id, action === 'approve' ? 'approved' : 'rejected', str(b?.note, 300) || null]
    );
    if (!rows[0]) return NextResponse.json({ error: 'not found' }, { status: 404 });
    await audit('admin', `store_${action}d`, { userId: id }, ipHash(req));
    return NextResponse.json({ ok: true });
}

async function h_admin_reports_GET(req: NextRequest) {
    if (!isAdminReq(req)) return forbidden();
    const status = req.nextUrl.searchParams.get('status') ?? 'open';
    const rows = await query(
        `SELECT cr.id, cr.target_type, cr.target_id, cr.reason, cr.status, cr.admin_note,
                cr.created_at,
                COALESCE(r.name, l.title) AS target_title,
                COALESCE(r.reviewer_id, l.owner_id) AS owner_id,
                (SELECT blocked_at IS NOT NULL FROM users WHERE id = COALESCE(r.reviewer_id, l.owner_id)) AS owner_blocked
         FROM content_reports cr
         LEFT JOIN restaurants r ON cr.target_type='review' AND r.id = cr.target_id
         LEFT JOIN store_listings l ON cr.target_type='listing' AND l.id = cr.target_id
         WHERE ($1 = 'all' OR cr.status = $1)
         ORDER BY cr.created_at DESC LIMIT 100`,
        [status]
    );
    return NextResponse.json({ reports: rows });
}

async function h_admin_reports_id_PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    if (!isAdminReq(req)) return forbidden();
    const { id } = await params;
    const reportId = Number(id);
    if (!Number.isInteger(reportId))
        return NextResponse.json({ error: 'bad request' }, { status: 400 });
    const b = await req.json().catch(() => ({}));
    const status = b?.status === 'dismissed' ? 'dismissed' : 'resolved';
    await query(
        `UPDATE content_reports SET status=$2, admin_note=$3, resolved_at=now() WHERE id=$1`,
        [reportId, status, str(b?.note, 300) || null]
    );
    return NextResponse.json({ ok: true });
}

async function h_admin_users_GET(req: NextRequest) {
    if (!isAdminReq(req)) return forbidden();
    const q = (req.nextUrl.searchParams.get('q') ?? '').replace(/[^\d]/g, '');
    const rows = await query(
        `SELECT u.id, u.display_name, u.phone, u.terms_accepted_at, u.blocked_at, u.blocked_reason,
                u.last_login_at, (u.password_hash IS NOT NULL) AS has_password,
                COALESCE(m.tier, 'free') AS membership_tier, m.activated_at,
                (SELECT COUNT(*)::int FROM restaurants r WHERE r.reviewer_id = u.id) AS review_count,
                (SELECT COALESCE(SUM(amount_satang),0)::int FROM membership_orders o
                  WHERE o.user_id = u.id AND o.status='succeeded') AS paid_satang,
                sp.store_name, sp.status AS store_status
         FROM users u
         LEFT JOIN memberships m ON m.user_id = u.id
         LEFT JOIN store_profiles sp ON sp.user_id = u.id
         WHERE (u.phone IS NOT NULL OR m.user_id IS NOT NULL OR u.blocked_at IS NOT NULL)
           AND ($1 = '' OR u.phone LIKE '%' || $1 || '%')
           AND ($2 = 'all' OR COALESCE(m.tier,'free') = $2 OR ($2 = 'blocked' AND u.blocked_at IS NOT NULL))
         ORDER BY COALESCE(m.activated_at, u.terms_accepted_at) DESC NULLS LAST LIMIT 200`,
        [q, req.nextUrl.searchParams.get('tier') ?? 'all']
    );
    const [counts] = await query<Record<string, number>>(
        `SELECT
            COUNT(*) FILTER (WHERE tier='member')::int AS member,
            COUNT(*) FILTER (WHERE tier='store')::int AS store,
            COUNT(*) FILTER (WHERE tier='store_vip')::int AS store_vip,
            (SELECT COUNT(*)::int FROM users WHERE blocked_at IS NOT NULL) AS blocked,
            (SELECT COUNT(*)::int FROM membership_orders WHERE status IN ('pending','review')
               AND created_at > now() - interval '2 days') AS pending_orders,
            (SELECT COUNT(*)::int FROM membership_orders WHERE status='review') AS review_orders
         FROM memberships`
    );
    return NextResponse.json({ users: rows, counts });
}

async function h_admin_users_id_block_POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    if (!isAdminReq(req)) return forbidden();
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: 'bad request' }, { status: 400 });
    const b = await req.json().catch(() => ({}));
    const reason = str(b?.reason, 200) || 'ละเมิดเงื่อนไขการใช้งาน';
    const deleteContent = b?.deleteContent === true;

    await withTx(async (c) => {
        await c.query(
            'UPDATE users SET blocked_at=now(), blocked_reason=$2 WHERE id=$1',
            [id, reason]
        );
        await c.query('UPDATE store_listings SET active=false WHERE owner_id=$1', [id]);
        if (deleteContent) {
            await c.query('DELETE FROM restaurants WHERE reviewer_id=$1', [id]);
            await c.query('DELETE FROM store_listings WHERE owner_id=$1', [id]);
            await c.query('DELETE FROM promotions WHERE owner_id=$1', [id]);
        }
        await auditTx(c, 'admin', 'user_blocked', { userId: id, reason, deleteContent }, ipHash(req));
    });
    return NextResponse.json({ ok: true });
}

async function h_admin_users_id_unblock_POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    if (!isAdminReq(req)) return forbidden();
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: 'bad request' }, { status: 400 });
    await query('UPDATE users SET blocked_at=NULL, blocked_reason=NULL WHERE id=$1', [id]);
    await audit('admin', 'user_unblocked', { userId: id }, ipHash(req));
    return NextResponse.json({ ok: true });
}

async function h_admin_reviews_id_exclusive_PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    if (!isAdminReq(req)) return forbidden();
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: 'bad request' }, { status: 400 });
    const b = await req.json().catch(() => ({}));
    await query('UPDATE restaurants SET is_exclusive=$2 WHERE id=$1', [id, b?.exclusive === true]);
    return NextResponse.json({ ok: true });
}

async function h_admin_membership_orders_GET(req: NextRequest) {
    if (!isAdminReq(req)) return forbidden();
    const status = req.nextUrl.searchParams.get('status') ?? 'pending';
    const rows = await query(
        `SELECT o.id, o.user_id, o.tier, o.amount_satang, o.status, o.slip_ref, o.slip_sender,
                o.verify_attempts, o.created_at, o.paid_at, o.slip_url, o.fail_reason,
                u.phone, u.display_name
         FROM membership_orders o JOIN users u ON u.id = o.user_id
         WHERE ($1 = 'all' OR o.status = $1 OR ($1 = 'pending' AND o.status = 'review'))
         ORDER BY o.created_at DESC LIMIT 100`,
        [status]
    );
    return NextResponse.json({ orders: rows });
}

/** แอดมินอนุมัติเอง (กรณีระบบตรวจสลิปขัดข้อง แต่ตรวจสอบยอดเข้าบัญชีแล้ว) */
async function h_admin_membership_orders_id_approve_POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    if (!isAdminReq(req)) return forbidden();
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: 'bad request' }, { status: 400 });
    const b = await req.json().catch(() => ({}));
    const ref = str(b?.ref, 60) || null;
    const res = await withTx(async (c) => {
        const o = await c.query(
            `UPDATE membership_orders SET status='succeeded', paid_at=now(),
                    slip_ref=COALESCE($2, slip_ref)
             WHERE id=$1 AND status IN ('pending','review','expired','rejected')
             RETURNING user_id, tier, slip_url`,
            [id, ref]
        );
        const row = o.rows[0];
        if (!row || !isPaidTier(row.tier)) return false;
        await activateMembershipTx(c, row.user_id, row.tier, id);
        await auditTx(c, 'admin', 'membership_manual_approved', { orderId: id, ref }, ipHash(req));
        return true;
    });
    if (!res) return NextResponse.json({ error: 'not found' }, { status: 404 });
    // ลบรูปสลิปทิ้งเพื่อประหยัดพื้นที่
    const s = await query<{ slip_url: string | null }>(
        'SELECT slip_url FROM membership_orders WHERE id=$1',
        [id]
    );
    if (s[0]?.slip_url) {
        await del(s[0].slip_url).catch(() => undefined);
        await query('UPDATE membership_orders SET slip_url=NULL WHERE id=$1', [id]);
    }
    return NextResponse.json({ ok: true });
}

// ==================== MEMBER LOGIN (เบอร์โทร + รหัสผ่าน) ====================
const PW_MIN = 6;

function hashPassword(pw: string): string {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
    return `scrypt$${salt}$${hash}`;
}

function checkPassword(pw: string, stored: string | null): boolean {
    if (!stored) return false;
    const [algo, salt, hash] = stored.split('$');
    if (algo !== 'scrypt' || !salt || !hash) return false;
    const calc = crypto.scryptSync(pw, salt, 64);
    const want = Buffer.from(hash, 'hex');
    return want.length === calc.length && crypto.timingSafeEqual(calc, want);
}

const loginAttempts = new Map<string, { n: number; reset: number }>();
const SESSION_TTL = 60 * 60 * 24 * 365;

async function h_auth_login_POST(req: NextRequest) {
    const ip = ipHash(req);
    const now = Date.now();
    const rec = loginAttempts.get(ip);
    if (rec && rec.reset > now && rec.n >= 8)
        return NextResponse.json(
            { error: 'ลองเข้าสู่ระบบหลายครั้งเกินไป กรุณารอ 15 นาที' },
            { status: 429 }
        );

    const b = await req.json().catch(() => ({}));
    const phone = String(b?.phone ?? '').replace(/\D/g, '');
    const password = typeof b?.password === 'string' ? b.password : '';

    const rows = await query<{
        id: string;
        password_hash: string | null;
        blocked_at: string | null;
        blocked_reason: string | null;
    }>(
        'SELECT id, password_hash, blocked_at, blocked_reason FROM users WHERE phone=$1',
        [phone]
    );
    const u = rows[0];
    if (!u || !checkPassword(password, u.password_hash)) {
        loginAttempts.set(
            ip,
            rec && rec.reset > now
                ? { n: rec.n + 1, reset: rec.reset }
                : { n: 1, reset: now + 15 * 60_000 }
        );
        await audit(u?.id ?? 'anonymous', 'member_login_failed', { phone: maskPhone(phone) }, ip);
        return NextResponse.json(
            { error: 'เบอร์โทรหรือรหัสผ่านไม่ถูกต้อง' },
            { status: 401 }
        );
    }
    if (u.blocked_at)
        return NextResponse.json(
            {
                error: `บัญชีนี้ถูกระงับการใช้งาน${u.blocked_reason ? ` (${u.blocked_reason})` : ''}`,
            },
            { status: 403 }
        );
    loginAttempts.delete(ip);
    await query('UPDATE users SET last_login_at=now() WHERE id=$1', [u.id]);
    await audit(u.id, 'member_login', {}, ip);
    const res = NextResponse.json({ ok: true });
    setAuthCookie(res, SESSION_COOKIE, signToken({ uid: u.id }, SESSION_TTL), SESSION_TTL);
    return res;
}

/** ออกจากระบบ → ได้บัญชีผู้ใช้ทั่วไป (guest) ใหม่ */
async function h_auth_logout_POST() {
    const [user] = await query<{ id: string }>('INSERT INTO users DEFAULT VALUES RETURNING id');
    const res = NextResponse.json({ ok: true });
    setAuthCookie(res, SESSION_COOKIE, signToken({ uid: user.id }, SESSION_TTL), SESSION_TTL);
    return res;
}

/** ตั้ง/เปลี่ยนรหัสผ่าน (ต้องมีเบอร์โทรแล้ว) */
async function h_me_password_POST(req: NextRequest) {
    const uid = getUserId(req);
    if (!uid)
        return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    const blocked = await blockedResponse(uid);
    if (blocked) return blocked;
    const b = await req.json().catch(() => ({}));
    const newPw = typeof b?.newPassword === 'string' ? b.newPassword : '';
    const curPw = typeof b?.currentPassword === 'string' ? b.currentPassword : '';
    if (newPw.length < PW_MIN)
        return NextResponse.json(
            { error: `รหัสผ่านต้องมีอย่างน้อย ${PW_MIN} ตัวอักษร` },
            { status: 400 }
        );
    const rows = await query<{ phone: string | null; password_hash: string | null }>(
        'SELECT phone, password_hash FROM users WHERE id=$1',
        [uid]
    );
    if (!rows[0]?.phone)
        return NextResponse.json(
            { error: 'ต้องสมัครสมาชิก (ยืนยันเบอร์โทร) ก่อนตั้งรหัสผ่าน' },
            { status: 400 }
        );
    if (rows[0].password_hash && !checkPassword(curPw, rows[0].password_hash))
        return NextResponse.json({ error: 'รหัสผ่านเดิมไม่ถูกต้อง' }, { status: 400 });
    await query('UPDATE users SET password_hash=$2 WHERE id=$1', [uid, hashPassword(newPw)]);
    await audit(uid, 'password_changed', {}, ipHash(req));
    return NextResponse.json({ ok: true });
}

// ==================== ADMIN: จัดการสมาชิก ====================
async function h_admin_users_id_tier_POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    if (!isAdminReq(req)) return forbidden();
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: 'bad request' }, { status: 400 });
    const b = await req.json().catch(() => ({}));
    const tier = b?.tier;
    if (tier !== 'free' && !isPaidTier(tier))
        return NextResponse.json({ error: 'ระดับไม่ถูกต้อง' }, { status: 400 });
    await withTx(async (c) => {
        if (tier === 'free') {
            await c.query('DELETE FROM memberships WHERE user_id=$1', [id]);
            await c.query(
                `UPDATE subscriptions SET status='canceled' WHERE user_id=$1 AND status='active'`,
                [id]
            ).catch(() => undefined);
        } else {
            await c.query(
                `INSERT INTO memberships (user_id, tier) VALUES ($1,$2)
                 ON CONFLICT (user_id) DO UPDATE SET tier=EXCLUDED.tier, updated_at=now()`,
                [id, tier]
            );
        }
        await auditTx(c, 'admin', 'member_tier_set', { userId: id, tier }, ipHash(req));
    });
    return NextResponse.json({ ok: true });
}

/** แอดมินรีเซ็ตรหัสผ่าน → คืนรหัสชั่วคราวให้แอดมินแจ้งสมาชิก */
async function h_admin_users_id_reset_password_POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    if (!isAdminReq(req)) return forbidden();
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: 'bad request' }, { status: 400 });
    const temp = crypto.randomBytes(6).toString('base64url').slice(0, 8);
    const rows = await query(
        'UPDATE users SET password_hash=$2 WHERE id=$1 AND phone IS NOT NULL RETURNING id',
        [id, hashPassword(temp)]
    );
    if (!rows[0])
        return NextResponse.json({ error: 'ผู้ใช้นี้ยังไม่มีเบอร์โทร' }, { status: 400 });
    await audit('admin', 'member_password_reset', { userId: id }, ipHash(req));
    return NextResponse.json({ ok: true, tempPassword: temp });
}

/** แอดมินปฏิเสธสลิปที่รอตรวจ */
async function h_admin_membership_orders_id_reject_POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    if (!isAdminReq(req)) return forbidden();
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: 'bad request' }, { status: 400 });
    const b = await req.json().catch(() => ({}));
    const rows = await query<{ slip_url: string | null }>(
        `UPDATE membership_orders SET status='rejected', fail_reason=$2
         WHERE id=$1 AND status IN ('pending','review') RETURNING slip_url`,
        [id, str(b?.note, 200) || 'สลิปไม่ถูกต้อง']
    );
    if (!rows[0]) return NextResponse.json({ error: 'not found' }, { status: 404 });
    if (rows[0].slip_url) {
        await del(rows[0].slip_url).catch(() => undefined);
        await query('UPDATE membership_orders SET slip_url=NULL WHERE id=$1', [id]);
    }
    await audit('admin', 'membership_order_rejected', { orderId: id }, ipHash(req));
    return NextResponse.json({ ok: true });
}

// ==================== DISPATCHER ====================
type RouteCtx = { params: Promise<{ path?: string[] }> };

type StaticRoute = (req: NextRequest, ctx: RouteCtx) => Promise<Response>;

type IdRoute = (
    req: NextRequest,
    ctx: { params: Promise<{ id: string }> }
) => Promise<Response>;

/** เส้นทางที่มี :id — pattern ใช้ ':id' แทนตำแหน่งของ id */
const ID_ROUTES: { method: string; pattern: string[]; handler: IdRoute }[] = [
    { method: 'PATCH', pattern: ['listings', ':id'], handler: h_listings_id_PATCH },
    { method: 'DELETE', pattern: ['listings', ':id'], handler: h_listings_id_DELETE },
    { method: 'POST', pattern: ['listings', ':id', 'boost'], handler: h_listings_id_boost_POST },
    { method: 'POST', pattern: ['promotions', ':id', 'claim'], handler: h_promotions_id_claim_POST },
    { method: 'PATCH', pattern: ['admin', 'stores', ':id'], handler: h_admin_stores_id_PATCH },
    { method: 'PATCH', pattern: ['admin', 'reports', ':id'], handler: h_admin_reports_id_PATCH },
    { method: 'POST', pattern: ['admin', 'users', ':id', 'block'], handler: h_admin_users_id_block_POST },
    { method: 'POST', pattern: ['admin', 'users', ':id', 'unblock'], handler: h_admin_users_id_unblock_POST },
    { method: 'PATCH', pattern: ['admin', 'reviews', ':id', 'exclusive'], handler: h_admin_reviews_id_exclusive_PATCH },
    { method: 'POST', pattern: ['admin', 'membership_orders', ':id', 'approve'], handler: h_admin_membership_orders_id_approve_POST },
    { method: 'POST', pattern: ['admin', 'membership_orders', ':id', 'reject'], handler: h_admin_membership_orders_id_reject_POST },
    { method: 'POST', pattern: ['admin', 'users', ':id', 'tier'], handler: h_admin_users_id_tier_POST },
    { method: 'POST', pattern: ['admin', 'users', ':id', 'reset_password'], handler: h_admin_users_id_reset_password_POST },
];

function matchIdRoute(method: string, path: string[]) {
    for (const r of ID_ROUTES) {
        if (r.method !== method || r.pattern.length !== path.length) continue;
        let id: string | null = null;
        const ok = r.pattern.every((seg, i) => {
            if (seg === ':id') {
                id = path[i];
                return true;
            }
            return seg === path[i];
        });
        if (ok && id !== null) return { handler: r.handler, id: id as string };
    }
    return null;
}

const STATIC_ROUTES: Record<string, StaticRoute> = {
    'POST auth/guest': h_auth_guest_POST as StaticRoute,
    'GET me': h_me_GET as StaticRoute,
    'GET me/payouts': h_me_payouts_GET as StaticRoute,
    'GET me/review_requests': h_me_review_requests_GET as StaticRoute,
    'POST membership/checkout': h_membership_checkout_POST as StaticRoute,
    'POST auth/login': h_auth_login_POST as StaticRoute,
    'POST auth/logout': h_auth_logout_POST as StaticRoute,
    'POST me/password': h_me_password_POST as StaticRoute,
    'POST membership/verify': h_membership_verify_POST as StaticRoute,
    'POST moderate': h_moderate_POST as StaticRoute,
    'GET me/store': h_me_store_GET as StaticRoute,
    'POST store/profile': h_store_profile_POST as StaticRoute,
    'GET listings': h_listings_GET as StaticRoute,
    'POST listings': h_listings_POST as StaticRoute,
    'POST reports': h_reports_POST as StaticRoute,
    'GET admin/stores': h_admin_stores_GET as StaticRoute,
    'GET admin/reports': h_admin_reports_GET as StaticRoute,
    'GET admin/users': h_admin_users_GET as StaticRoute,
    'GET admin/membership_orders': h_admin_membership_orders_GET as StaticRoute,
    'GET reviews': h_reviews_GET as StaticRoute,
    'POST reviews': h_reviews_POST as StaticRoute,
    'POST promotions': h_promotions_POST as StaticRoute,
    'GET sponsorships/active': h_sponsorships_active_GET as StaticRoute,
    'POST admin/login': h_admin_login_POST as StaticRoute,
    'POST admin/logout': h_admin_logout_POST as StaticRoute,
    'GET admin/summary': h_admin_summary_GET as StaticRoute,
    'POST admin/sponsorships': h_admin_sponsorships_POST as StaticRoute,
    'POST admin/run_payout': h_admin_run_payout_POST as StaticRoute,
    'GET admin/review_requests': h_admin_review_requests_GET as StaticRoute,
    'GET cron/daily': h_cron_daily_GET as StaticRoute,
};

async function dispatch(
    req: NextRequest,
    ctx: RouteCtx,
    method: string
): Promise<Response> {
    const { path = [] } = await ctx.params;

    try {
        await ensureSchema();
        const key = `${method} ${path.join('/')}`;
        const fn = STATIC_ROUTES[key];
        if (fn) return await fn(req, ctx);

        const idRoute = matchIdRoute(method, path);
        if (idRoute)
            return await idRoute.handler(req, {
                params: Promise.resolve({ id: idRoute.id }),
            });

        // PATCH /api/reviews/:id
        if (
            method === 'PATCH' &&
            path.length === 2 &&
            path[0] === 'reviews'
        ) {
            return await h_reviews_id_PATCH(req, {
                params: Promise.resolve({ id: path[1] }),
            });
        }

        // DELETE /api/reviews/:id
        if (
            method === 'DELETE' &&
            path.length === 2 &&
            path[0] === 'reviews'
        ) {
            return await h_reviews_id_DELETE(req, {
                params: Promise.resolve({ id: path[1] }),
            });
        }

        // POST /api/reviews/:id/edit_request
        if (
            method === 'POST' &&
            path.length === 3 &&
            path[0] === 'reviews' &&
            path[2] === 'edit_request'
        ) {
            return await h_reviews_id_edit_request_POST(req, {
                params: Promise.resolve({ id: path[1] }),
            });
        }

        // POST /api/reviews/:id/rate | /boost
        if (
            method === 'POST' &&
            path.length === 3 &&
            path[0] === 'reviews' &&
            (path[2] === 'rate' || path[2] === 'boost')
        ) {
            const h =
                path[2] === 'rate' ? h_reviews_id_rate_POST : h_reviews_id_boost_POST;
            return await h(req, { params: Promise.resolve({ id: path[1] }) });
        }

        // DELETE /api/promotions/:id
        if (
            method === 'DELETE' &&
            path.length === 2 &&
            path[0] === 'promotions'
        ) {
            return await h_promotions_id_DELETE(req, {
                params: Promise.resolve({ id: path[1] }),
            });
        }

        // POST /api/reviews/:id/view
        if (
            method === 'POST' &&
            path.length === 3 &&
            path[0] === 'reviews' &&
            path[2] === 'view'
        ) {
            return await h_reviews_id_view_POST(req, {
                params: Promise.resolve({ id: path[1] }),
            });
        }

        // PATCH /api/admin/sponsorships/:id
        if (
            method === 'PATCH' &&
            path.length === 3 &&
            path[0] === 'admin' &&
            path[1] === 'sponsorships'
        ) {
            return await h_admin_sponsorships_id_PATCH(req, {
                params: Promise.resolve({ id: path[2] }),
            });
        }

        // PATCH /api/admin/payouts/:id
        if (
            method === 'PATCH' &&
            path.length === 3 &&
            path[0] === 'admin' &&
            path[1] === 'payouts'
        ) {
            return await h_admin_payouts_id_PATCH(req, {
                params: Promise.resolve({ id: path[2] }),
            });
        }

        // POST /api/admin/sponsorship_invoices/:id/paid
        if (
            method === 'POST' &&
            path.length === 4 &&
            path[0] === 'admin' &&
            path[1] === 'sponsorship_invoices' &&
            path[3] === 'paid'
        ) {
            return await h_admin_sponsorship_invoices_paid_POST(req, {
                params: Promise.resolve({ id: path[2] }),
            });
        }

        // PATCH /api/admin/review_requests/:id
        if (
            method === 'PATCH' &&
            path.length === 3 &&
            path[0] === 'admin' &&
            path[1] === 'review_requests'
        ) {
            return await h_admin_review_requests_id_PATCH(req, {
                params: Promise.resolve({ id: path[2] }),
            });
        }
    } catch (err) {
        console.error('API error', method, path.join('/'), err);
        return NextResponse.json({ error: 'server error' }, { status: 500 });
    }
    return NextResponse.json({ error: 'not found' }, { status: 404 });
}

export async function GET(req: NextRequest, ctx: RouteCtx) {
    return dispatch(req, ctx, 'GET');
}
export async function POST(req: NextRequest, ctx: RouteCtx) {
    return dispatch(req, ctx, 'POST');
}
export async function PATCH(req: NextRequest, ctx: RouteCtx) {
    return dispatch(req, ctx, 'PATCH');
}
export async function DELETE(req: NextRequest, ctx: RouteCtx) {
    return dispatch(req, ctx, 'DELETE');
}