import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';

export async function POST(req: NextRequest) {
    try {
        const formData = await req.formData();
        const file = formData.get('file') as File | null;

        if (!file) {
            return NextResponse.json(
                { error: 'ไม่พบไฟล์' },
                { status: 400 }
            );
        }

        // จำกัดขนาด 10 MB
        if (file.size > 10 * 1024 * 1024) {
            return NextResponse.json(
                { error: 'ไฟล์ใหญ่เกิน 10MB' },
                { status: 400 }
            );
        }

        // พยายามอัพโหลดไป Vercel Blob ถ้ามี Token
        if (process.env.BLOB_READ_WRITE_TOKEN) {
            try {
                const blob = await put(`kinjing/${Date.now()}-${file.name}`, file, {
                    access: 'public',
                });
                return NextResponse.json({
                    ok: true,
                    url: blob.url,
                    type: file.type.startsWith('video/') ? 'video' : 'image',
                });
            } catch (blobErr) {
                console.warn('Vercel Blob upload failed, fallback to base64 Data URL:', blobErr);
            }
        }

        // Fallback: แปลงเป็น Base64 Data URL ให้ใช้งานได้ทันที แม้ยังไม่ได้ต่อ Vercel Blob
        const bytes = await file.arrayBuffer();
        const buffer = Buffer.from(bytes);
        const mime = file.type || (file.name.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg');
        const dataUrl = `data:${mime};base64,${buffer.toString('base64')}`;

        return NextResponse.json({
            ok: true,
            url: dataUrl,
            type: file.type.startsWith('video/') ? 'video' : 'image',
        });
    } catch (err) {
        console.error('upload failed', err);
        return NextResponse.json(
            { error: 'อัพโหลดไม่สำเร็จ' },
            { status: 500 }
        );
    }
}
