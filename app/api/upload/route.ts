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

        // อัพโหลดไป Vercel Blob
        const blob = await put(`kinjing/${Date.now()}-${file.name}`, file, {
            access: 'public',
        });

        return NextResponse.json({
            ok: true,
            url: blob.url,
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