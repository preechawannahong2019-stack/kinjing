/**
 * กินจริง (KinJing) - Backend ทั้งหมดในไฟล์เดียว
 * ตำแหน่งไฟล์: app/api/[[...path]]/route.ts (Next.js 15+/16, App Router)
 */

import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { Pool, PoolClient, QueryResultRow } from 'pg';

// ==================== DB ====================
declare global {
    // eslint-disable-next-line no-var
    var _kjPool: Pool | undefined;
}

const pool =
    global._kjPool ??
    new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl:
            process.env.DATABASE_SSL === 'true'
                ? { rejectUnauthorized: false }
                : undefined,
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

// ==================== AUTH ====================
const SESSION_COOKIE = 'kj_session';
const ADMIN_COOKIE = 'kj_admin';

function secret(): string {
    const s = process.env.SESSION_SECRET;
    if (!s || s.length < 32)
        throw new Error('SESSION_SECRET ต้องตั้งค่าและยาวอย่างน้อย 32 ตัวอักษร');
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

// ==================== BILLING (Omise) ====================
const OMISE_API = 'https://api.omise.co';

function omiseAuth(): string {
    const key = process.env.OMISE_SECRET_KEY;
    if (!key) throw new Error('ไม่ได้ตั้งค่า OMISE_SECRET_KEY');
    return 'Basic ' + Buffer.from(`${key}:`).toString('base64');
}

interface OmiseCharge {
    id: string;
    amount: number;
    currency: string;
    status: string;
    paid: boolean;
    expires_at?: string;
    source?: {
        scannable_code?: {
            image?: { download_uri?: string };
        };
    };
}

async function createPromptPayCharge(
    amountSatang: number,
    metadata: Record<string, string>
): Promise<OmiseCharge> {
    const body = new URLSearchParams({
        amount: String(amountSatang),
        currency: 'thb',
        'source[type]': 'promptpay',
    });
    for (const [k, v] of Object.entries(metadata)) body.set(`metadata[${k}]`, v);

    const res = await fetch(`${OMISE_API}/charges`, {
        method: 'POST',
        headers: {
            Authorization: omiseAuth(),
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
    });
    const json = await res.json();
    if (!res.ok || json.object === 'error')
        throw new Error(`Omise: ${json.message ?? res.status}`);
    return json as OmiseCharge;
}

async function getCharge(id: string): Promise<OmiseCharge> {
    const res = await fetch(`${OMISE_API}/charges/${encodeURIComponent(id)}`, {
        headers: { Authorization: omiseAuth() },
        cache: 'no-store',
    });
    const json = await res.json();
    if (!res.ok || json.object === 'error')
        throw new Error(`Omise: ${json.message ?? res.status}`);
    return json as OmiseCharge;
}

// ==================== SETTLE CHARGE ====================
async function settleCharge(charge: OmiseCharge): Promise<string | null> {
    return withTx(async (c) => {
        const found = await c.query(
            'SELECT * FROM payments WHERE gateway_charge_id = $1 FOR UPDATE',
            [charge.id]
        );
        const p = found.rows[0];
        if (!p) return null;
        if (p.status !== 'pending') return p.status as string;

        const amountOk =
            charge.amount === p.amount_satang &&
            charge.currency.toLowerCase() === 'thb';

        if (charge.status === 'successful' && charge.paid && amountOk) {
            await c.query(
                `UPDATE payments SET status='succeeded', paid_at=now() WHERE id=$1`,
                [p.id]
            );

            const subRes = await c.query(
                `SELECT s.id, s.user_id, pl.interval_days
                 FROM subscriptions s JOIN plans pl ON pl.id = s.plan_id
                 WHERE s.id = $1 FOR UPDATE`,
                [p.ref_id]
            );
            const sub = subRes.rows[0];
            if (sub) {
                await c.query(
                    `UPDATE subscriptions SET status='canceled'
                     WHERE user_id=$1 AND status='active' AND id<>$2`,
                    [sub.user_id, sub.id]
                );
                await c.query(
                    `UPDATE subscriptions
                     SET status='active', current_period_start=now(),
                         current_period_end = now() + make_interval(days => $2)
                     WHERE id=$1`,
                    [sub.id, sub.interval_days]
                );
            }
            await auditTx(c, 'system', 'payment_succeeded', {
                paymentId: p.id,
                charged: charge.id,
                amount: p.amount_satang,
            });
            return 'succeeded';
        }

        if (charge.status === 'successful' && !amountOk) {
            await auditTx(c, 'system', 'payment_amount_mismatch', {
                paymentId: p.id,
                charged: charge.id,
                expected: p.amount_satang,
                got: charge.amount,
            });
            return 'pending';
        }

        if (['failed', 'expired', 'reversed'].includes(charge.status)) {
            await c.query(`UPDATE payments SET status='failed' WHERE id=$1`, [p.id]);
            await c.query(
                `UPDATE subscriptions SET status='canceled'
                 WHERE id=$1 AND status='pending'`,
                [p.ref_id]
            );
            await auditTx(c, 'system', 'payment_failed', {
                paymentId: p.id,
                charged: charge.id,
                status: charge.status,
            });
            return 'failed';
        }

        return 'pending';
    });
}

// ==================== HELPERS ====================
async function getMembership(userId: string) {
    const rows = await query<{ plan_id: string; current_period_end: string }>(
        `SELECT plan_id, current_period_end
         FROM subscriptions
         WHERE user_id=$1 AND status='active' AND current_period_end > now()
         ORDER BY current_period_end DESC LIMIT 1`,
        [userId]
    );
    return rows[0]
        ? {
              isVip: true,
              planId: rows[0].plan_id,
              periodEnd: rows[0].current_period_end,
          }
        : { isVip: false, planId: null, periodEnd: null };
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

    const [membership, plans] = await Promise.all([
        getMembership(userId),
        query(
            `SELECT id, name, price_satang, interval_days, perks
             FROM plans WHERE active ORDER BY price_satang`
        ),
    ]);
    return NextResponse.json({
        membership,
        plans,
        isAdmin: isAdminReq(req),
    });
}

// ==================== ROUTE: subscriptions ====================
async function h_subscriptions_POST(req: NextRequest) {
    const uid = getUserId(req);
    if (!uid)
        return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const plans = await query<{ id: string; price_satang: number }>(
        `SELECT id, price_satang FROM plans WHERE id=$1 AND active`,
        [body?.planId]
    );
    const plan = plans[0];
    if (!plan)
        return NextResponse.json({ error: 'ไม่พบแพ็กเกจ' }, { status: 400 });

    const recent = await query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM payments
         WHERE user_id=$1 AND status='pending' AND created_at > now() - interval '1 hour'`,
        [uid]
    );
    if (recent[0].n >= 3) {
        return NextResponse.json(
            { error: 'มีรายการชำระหลายรายการ กรุณารอสักครู่' },
            { status: 429 }
        );
    }

    const { subId, paymentId } = await withTx(async (c) => {
        const s = await c.query(
            `INSERT INTO subscriptions (user_id, plan_id, status)
             VALUES ($1,$2,'pending') RETURNING id`,
            [uid, plan.id]
        );
        const p = await c.query(
            `INSERT INTO payments (user_id, kind, ref_id, amount_satang, status, gateway)
             VALUES ($1,'subscription',$2,$3,'pending','omise') RETURNING id`,
            [uid, s.rows[0].id, plan.price_satang]
        );
        return {
            subId: s.rows[0].id as string,
            paymentId: p.rows[0].id as string,
        };
    });

    try {
        const charge = await createPromptPayCharge(plan.price_satang, {
            payment_id: paymentId,
            subscription_id: subId,
        });
        await query(`UPDATE payments SET gateway_charge_id=$1 WHERE id=$2`, [
            charge.id,
            paymentId,
        ]);
        return NextResponse.json({
            paymentId,
            planId: plan.id,
            amountSatang: plan.price_satang,
            qrImageUrl:
                charge.source?.scannable_code?.image?.download_uri ?? null,
            expiresAt: charge.expires_at ?? null,
        });
    } catch (err) {
        console.error('create charge failed', err);
        await query(`UPDATE payments SET status='failed' WHERE id=$1`, [paymentId]);
        await query(`UPDATE subscriptions SET status='canceled' WHERE id=$1`, [
            subId,
        ]);
        return NextResponse.json(
            { error: 'สร้างรายการชำระเงินไม่สำเร็จ กรุณาลองใหม่' },
            { status: 502 }
        );
    }
}

// ==================== ROUTE: subscriptions/status ====================
async function h_subscriptions_status_GET(req: NextRequest) {
    const uid = getUserId(req);
    if (!uid)
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const paymentId = req.nextUrl.searchParams.get('paymentId');
    if (!isUuid(paymentId))
        return NextResponse.json({ error: 'bad request' }, { status: 400 });

    const rows = await query<{
        status: string;
        gateway_charge_id: string | null;
    }>(
        `SELECT status, gateway_charge_id FROM payments WHERE id=$1 AND user_id=$2`,
        [paymentId, uid]
    );
    const p = rows[0];
    if (!p) return NextResponse.json({ error: 'not found' }, { status: 404 });

    if (p.status === 'pending' && p.gateway_charge_id) {
        try {
            const status = await settleCharge(
                await getCharge(p.gateway_charge_id)
            );
            return NextResponse.json({ status: status ?? p.status });
        } catch (err) {
            console.error('status check failed', err);
        }
    }
    return NextResponse.json({ status: p.status });
}

// ==================== ROUTE: webhooks/omise ====================
async function h_webhooks_omise_POST(req: NextRequest) {
    const event = await req.json().catch(() => null);
    if (event?.key !== 'charge.complete' || typeof event?.data?.id !== 'string') {
        return NextResponse.json({ ok: true });
    }
    try {
        const charge = await getCharge(event.data.id);
        await settleCharge(charge);
        return NextResponse.json({ ok: true });
    } catch (err) {
        console.error('omise webhook error', err);
        return NextResponse.json({ error: 'retry' }, { status: 500 });
    }
}

// ==================== ROUTE: reviews ====================
async function h_reviews_GET(req: NextRequest) {
    const uid = getUserId(req);
    let isVip = false;
    if (uid) {
        const m = await getMembership(uid);
        isVip = m.isVip;
    }

    const limit = Math.min(
        Math.max(parseInt(req.nextUrl.searchParams.get('limit') ?? '20', 10), 1),
        50
    );
    const offset = Math.max(
        parseInt(req.nextUrl.searchParams.get('offset') ?? '0', 10),
        0
    );

    const rows = await query(
        `SELECT id, name, category, rating, must_try, tags,
                media_items, reviewer_name, view_count, created_at,
                latitude, longitude, address, recommender_name
         FROM restaurants
         ORDER BY view_count DESC, created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
    );
    return NextResponse.json({ reviews: rows, isVip });
}

async function h_reviews_POST(req: NextRequest) {
    const uid = getUserId(req);
    if (!uid)
        return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

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

    const owners = await query<{ reviewer_id: string | null }>(
        'SELECT reviewer_id FROM restaurants WHERE id=$1',
        [id]
    );
    if (!owners[0])
        return NextResponse.json({ error: 'not found' }, { status: 404 });

    const isAdmin = isAdminReq(req);
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
    const expected = process.env.ADMIN_PASSWORD;
    if (!expected)
        return NextResponse.json(
            { error: 'server misconfigured' },
            { status: 500 }
        );

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
        `SELECT COUNT(*)::int AS n FROM subscriptions
         WHERE status='active' AND current_period_end > now()`
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

    const subsTotal = Number(subs.total);
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
const str = (v: unknown, max = 300) =>
    typeof v === 'string' ? v.trim().slice(0, max) : '';

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
async function h_admin_run_payout_POST(req: NextRequest) {
    if (!isAdminReq(req))
        return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const periodStart = str(body.periodStart, 10);
    const periodEnd = str(body.periodEnd, 10);
    const sharePercent =
        Number.isFinite(Number(body.sharePercent)) &&
        Number(body.sharePercent) > 0 &&
        Number(body.sharePercent) <= 100
            ? Number(body.sharePercent)
            : 30;

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
        const poolSatang = Math.floor((totalRevenue * sharePercent) / 100);

        const views = await c.query(
            `SELECT COUNT(*)::bigint AS n FROM review_views
             WHERE created_at >= $1::date AND created_at < ($2::date + 1)`,
            [periodStart, periodEnd]
        );
        const totalViews = Number(views.rows[0].n);

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

        const perUser = await c.query(
            `SELECT r.reviewer_id AS user_id, COUNT(*)::int AS views
             FROM review_views v
             JOIN restaurants r ON r.id = v.restaurant_id
             WHERE v.created_at >= $1::date AND v.created_at < ($2::date + 1)
               AND r.reviewer_id IS NOT NULL
             GROUP BY r.reviewer_id`,
            [periodStart, periodEnd]
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
            const views = Number(row.views);
            const amount = Math.floor((poolSatang * views) / totalViews);
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

// ==================== DISPATCHER ====================
type RouteCtx = { params: Promise<{ path?: string[] }> };

type StaticRoute = (req: NextRequest, ctx: RouteCtx) => Promise<Response>;

const STATIC_ROUTES: Record<string, StaticRoute> = {
    'POST auth/guest': h_auth_guest_POST as StaticRoute,
    'GET me': h_me_GET as StaticRoute,
    'GET me/payouts': h_me_payouts_GET as StaticRoute,
    'GET me/review_requests': h_me_review_requests_GET as StaticRoute,
    'POST subscriptions': h_subscriptions_POST as StaticRoute,
    'GET subscriptions/status': h_subscriptions_status_GET as StaticRoute,
    'POST webhooks/omise': h_webhooks_omise_POST as StaticRoute,
    'GET reviews': h_reviews_GET as StaticRoute,
    'POST reviews': h_reviews_POST as StaticRoute,
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
        const key = `${method} ${path.join('/')}`;
        const fn = STATIC_ROUTES[key];
        if (fn) return await fn(req, ctx);

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