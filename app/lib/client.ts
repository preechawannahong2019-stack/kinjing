'use client';

import { upload as blobUpload } from '@vercel/blob/client';

// ==================== Shared types ====================
export interface MediaItem {
    type: 'image' | 'video';
    url: string;
}

export type Tier = 'free' | 'member' | 'store' | 'store_vip';

export interface TierInfo {
    id: Exclude<Tier, 'free'>;
    name: string;
    priceSatang: number;
    menuLimit: number;
    isStore: boolean;
    perks: string[];
}

export interface Membership {
    isVip: boolean;
    tier: Tier;
    tierName: string;
    since: string | null;
    menuLimit: number;
    isStore: boolean;
}

export interface UserProfile {
    displayName: string | null;
    phoneMasked: string | null;
    hasPhone: boolean;
    termsAccepted: boolean;
    blocked: boolean;
    blockedReason: string | null;
}

export interface StoreStatus {
    status: 'pending' | 'approved' | 'rejected';
    store_name: string;
    admin_note: string | null;
}

// ==================== Helpers ====================
export const baht = (satang: number) =>
    `฿${(satang / 100).toLocaleString('th-TH', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })}`;

export async function api<T>(
    path: string,
    init?: RequestInit
): Promise<{ ok: boolean; status: number; data: T | null }> {
    try {
        const res = await fetch(path, {
            credentials: 'same-origin',
            cache: 'no-store',
            ...init,
            headers: {
                'Content-Type': 'application/json',
                ...(init?.headers || {}),
            },
        });
        const data = (await res.json().catch(() => null)) as T | null;
        return { ok: res.ok, status: res.status, data };
    } catch {
        return { ok: false, status: 0, data: null };
    }
}

// ==================== Media upload ====================
export const MAX_VIDEO_MB = 200;
/** ระบบตรวจวิดีโออัตโนมัติรองรับคลิปไม่เกิน 60 วินาที */
export const MAX_VIDEO_SECONDS = 60;

/** ย่อรูปในเบราว์เซอร์ก่อนอัปโหลด (ด้านยาวไม่เกิน maxSide px, JPEG 85%) */
export async function compressImage(file: File, maxSide = 1920): Promise<File> {
    if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;
    try {
        const bitmap = await createImageBitmap(file);
        const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
        const w = Math.round(bitmap.width * scale);
        const h = Math.round(bitmap.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return file;
        ctx.drawImage(bitmap, 0, 0, w, h);
        bitmap.close?.();
        const blob = await new Promise<Blob | null>((res) =>
            canvas.toBlob(res, 'image/jpeg', 0.85)
        );
        if (!blob || blob.size >= file.size) return file;
        const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
        return new File([blob], name, { type: 'image/jpeg' });
    } catch {
        return file; // เช่น HEIC ที่เบราว์เซอร์อ่านไม่ได้ → ใช้ไฟล์เดิม
    }
}

function videoDuration(file: File): Promise<number> {
    return new Promise((resolve) => {
        const url = URL.createObjectURL(file);
        const v = document.createElement('video');
        v.preload = 'metadata';
        v.onloadedmetadata = () => {
            URL.revokeObjectURL(url);
            resolve(Number.isFinite(v.duration) ? v.duration : 0);
        };
        v.onerror = () => {
            URL.revokeObjectURL(url);
            resolve(0);
        };
        v.src = url;
    });
}

/**
 * อัปโหลดตรงจากเบราว์เซอร์ไป Vercel Blob แล้วส่งให้ระบบตรวจเนื้อหาทันที
 * ถ้าพบภาพลามก/ยาเสพติด/การพนัน/ความรุนแรง → ไฟล์ถูกลบ และ throw ข้อความเตือน
 */
export async function uploadMedia(
    original: File,
    opts: { imageOnly?: boolean } = {}
): Promise<MediaItem> {
    const isVideo = original.type.startsWith('video/');
    if (opts.imageOnly && !original.type.startsWith('image/'))
        throw new Error('กรุณาเลือกไฟล์รูปภาพ');
    if (!isVideo && !original.type.startsWith('image/'))
        throw new Error(`ไฟล์ ${original.name} ไม่ใช่รูปภาพหรือวิดีโอ`);
    if (isVideo && original.size > MAX_VIDEO_MB * 1024 * 1024)
        throw new Error(`วิดีโอใหญ่เกิน ${MAX_VIDEO_MB}MB`);
    if (isVideo) {
        const sec = await videoDuration(original);
        if (sec > MAX_VIDEO_SECONDS + 0.5)
            throw new Error(`วิดีโอต้องยาวไม่เกิน ${MAX_VIDEO_SECONDS} วินาที`);
    }

    const file = isVideo ? original : await compressImage(original);
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-60) || 'file';
    let item: MediaItem;
    try {
        const blob = await blobUpload(`kinjing/${Date.now()}-${safe}`, file, {
            access: 'public',
            handleUploadUrl: '/api/upload',
            contentType: file.type || undefined,
            multipart: file.size > 8 * 1024 * 1024,
        });
        item = { type: isVideo ? 'video' : 'image', url: blob.url };
    } catch (err) {
        const probe = await fetch('/api/upload', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}',
        }).catch(() => null);
        const data = probe ? await probe.json().catch(() => null) : null;
        if (probe?.status === 503 && data?.error) throw new Error(data.error);
        console.error(err);
        throw new Error(`อัพโหลด ${original.name} ไม่สำเร็จ`);
    }

    // ตรวจเนื้อหา (ภาพลามก ยาเสพติด การพนัน ความรุนแรง)
    const mod = await api<{ error?: string }>('/api/moderate', {
        method: 'POST',
        body: JSON.stringify(item),
    });
    if (!mod.ok) throw new Error(mod.data?.error ?? 'ตรวจสอบไฟล์ไม่สำเร็จ กรุณาลองใหม่');
    return item;
}
