import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';

const MAX_IMAGE_BYTES = 15 * 1024 * 1024; // 15 MB
const MAX_VIDEO_BYTES = 200 * 1024 * 1024; // 200 MB

const ALLOWED_TYPES = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/heic',
    'image/heif',
    'video/mp4',
    'video/quicktime',
    'video/webm',
    'video/3gpp',
    'video/x-m4v',
];

const NO_BLOB_MSG =
    'ยังไม่ได้เชื่อมต่อที่เก็บไฟล์ (Vercel Blob) — ไปที่ Vercel > Storage > Create Blob แล้ว Redeploy';

/**
 * อัปโหลดไฟล์ 2 แบบ:
 * 1) JSON (แนะนำ) — เบราว์เซอร์ขอ token แล้วอัปโหลดตรงไป Vercel Blob
 *    ไม่ผ่านเซิร์ฟเวอร์ จึงไม่ติดลิมิต 4.5MB ของ Vercel และรองรับวิดีโอขนาดใหญ่
 * 2) multipart/form-data — สำหรับไฟล์เล็ก (ไม่เกิน ~4MB)
 */
export async function POST(req: NextRequest) {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
        return NextResponse.json({ error: NO_BLOB_MSG }, { status: 503 });
    }

    const contentType = req.headers.get('content-type') ?? '';

    // ---------- 1) Client direct upload (token handshake) ----------
    if (contentType.includes('application/json')) {
        try {
            const body = (await req.json()) as HandleUploadBody;
            const result = await handleUpload({
                body,
                request: req,
                onBeforeGenerateToken: async () => ({
                    allowedContentTypes: ALLOWED_TYPES,
                    maximumSizeInBytes: MAX_VIDEO_BYTES,
                    addRandomSuffix: true,
                }),
            });
            return NextResponse.json(result);
        } catch (err) {
            console.error('client upload token failed', err);
            return NextResponse.json(
                { error: 'อัพโหลดไม่สำเร็จ' },
                { status: 400 }
            );
        }
    }

    // ---------- 2) Small file via form-data ----------
    try {
        const formData = await req.formData();
        const file = formData.get('file') as File | null;
        if (!file) {
            return NextResponse.json({ error: 'ไม่พบไฟล์' }, { status: 400 });
        }
        const isVideo = file.type.startsWith('video/');
        if (file.size > (isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES)) {
            return NextResponse.json({ error: 'ไฟล์ใหญ่เกินกำหนด' }, { status: 400 });
        }
        const blob = await put(`kinjing/${Date.now()}-${file.name}`, file, {
            access: 'public',
            addRandomSuffix: true,
        });
        return NextResponse.json({
            ok: true,
            url: blob.url,
            type: isVideo ? 'video' : 'image',
        });
    } catch (err) {
        console.error('upload failed', err);
        return NextResponse.json({ error: 'อัพโหลดไม่สำเร็จ' }, { status: 500 });
    }
}
