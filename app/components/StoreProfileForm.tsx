'use client';

import React, { useState } from 'react';
import { api, uploadMedia } from '../lib/client';

export interface StoreProfileData {
    store_name: string;
    map_url: string | null;
    latitude: number | null;
    longitude: number | null;
    address: string | null;
    storefront_url: string;
    contact_phone: string | null;
    status?: string;
    admin_note?: string | null;
}

const input =
    'w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500';

/** ฟอร์มยืนยันตัวตนร้านค้า: ชื่อร้าน + ตำแหน่ง (Google Maps / GPS) + รูปหน้าร้าน */
export default function StoreProfileForm({
    initial,
    onSubmitted,
    showToast,
}: {
    initial?: StoreProfileData | null;
    onSubmitted: () => void;
    showToast: (m: string) => void;
}) {
    const [storeName, setStoreName] = useState(initial?.store_name ?? '');
    const [mapUrl, setMapUrl] = useState(initial?.map_url ?? '');
    const [lat, setLat] = useState<number | null>(initial?.latitude ?? null);
    const [lng, setLng] = useState<number | null>(initial?.longitude ?? null);
    const [address, setAddress] = useState(initial?.address ?? '');
    const [contactPhone, setContactPhone] = useState(initial?.contact_phone ?? '');
    const [storefrontUrl, setStorefrontUrl] = useState(initial?.storefront_url ?? '');
    const [uploading, setUploading] = useState(false);
    const [locating, setLocating] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const useGps = () => {
        if (!navigator.geolocation) return showToast('เบราว์เซอร์ไม่รองรับ GPS');
        setLocating(true);
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                setLat(pos.coords.latitude);
                setLng(pos.coords.longitude);
                setLocating(false);
            },
            () => {
                setLocating(false);
                showToast('ไม่สามารถดึงตำแหน่งได้');
            },
            { enableHighAccuracy: true, timeout: 10000 }
        );
    };

    const onPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (!f) return;
        setUploading(true);
        setError(null);
        try {
            const item = await uploadMedia(f, { imageOnly: true });
            setStorefrontUrl(item.url);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'อัปโหลดไม่สำเร็จ');
        } finally {
            setUploading(false);
        }
    };

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setSaving(true);
        const r = await api<{ error?: string }>('/api/store/profile', {
            method: 'POST',
            body: JSON.stringify({
                storeName,
                mapUrl,
                latitude: lat,
                longitude: lng,
                address,
                contactPhone,
                storefrontUrl,
            }),
        });
        setSaving(false);
        if (!r.ok) {
            setError(r.data?.error ?? 'บันทึกไม่สำเร็จ');
            return;
        }
        showToast('ส่งข้อมูลร้านค้าแล้ว รอแอดมินตรวจสอบ');
        onSubmitted();
    };

    return (
        <form onSubmit={submit} className="space-y-3">
            <div className="text-[11px] text-slate-400 bg-slate-950/60 border border-slate-800 rounded-xl p-3">
                ยืนยันตัวตนร้านค้าเพื่อป้องกันการสวมรอยมาสแปมประกาศขายของ — แอดมินจะตรวจสอบแผนที่และรูปหน้าร้านก่อนเปิดให้ลงประกาศ
            </div>
            {initial?.status === 'rejected' && (
                <p className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-lg p-2">
                    ไม่ผ่านการตรวจสอบ{initial.admin_note ? `: ${initial.admin_note}` : ''} — แก้ไขแล้วส่งใหม่ได้
                </p>
            )}
            <div>
                <label className="text-xs font-bold text-slate-300 block mb-1">ชื่อร้าน *</label>
                <input className={input} value={storeName} onChange={(e) => setStoreName(e.target.value)} required maxLength={120} />
            </div>
            <div>
                <label className="text-xs font-bold text-slate-300 block mb-1">ตำแหน่งร้าน * (ลิงก์ Google Maps หรือใช้ GPS ที่ร้าน)</label>
                <input className={input} placeholder="https://maps.app.goo.gl/..." value={mapUrl} onChange={(e) => setMapUrl(e.target.value)} />
                <div className="flex items-center gap-2 mt-1.5">
                    <button type="button" onClick={useGps} className="text-[11px] bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 px-3 py-1.5 rounded-lg cursor-pointer">
                        {locating ? 'กำลังหาพิกัด...' : '📍 ใช้ตำแหน่งปัจจุบัน'}
                    </button>
                    {lat != null && lng != null && (
                        <span className="text-[11px] text-emerald-300">{lat.toFixed(5)}, {lng.toFixed(5)}</span>
                    )}
                </div>
            </div>
            <div>
                <label className="text-xs font-bold text-slate-300 block mb-1">ที่อยู่ร้าน</label>
                <input className={input} value={address} onChange={(e) => setAddress(e.target.value)} maxLength={300} />
            </div>
            <div>
                <label className="text-xs font-bold text-slate-300 block mb-1">เบอร์ติดต่อร้าน</label>
                <input className={input} inputMode="tel" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} maxLength={12} />
            </div>
            <div>
                <label className="text-xs font-bold text-slate-300 block mb-1">รูปหน้าร้าน * (เห็นป้ายชื่อร้านชัดเจน)</label>
                <input type="file" accept="image/*" onChange={onPhoto} disabled={uploading} className="text-xs text-slate-300" />
                {uploading && <p className="text-[11px] text-amber-300 mt-1">กำลังอัปโหลดและตรวจสอบรูป...</p>}
                {storefrontUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={storefrontUrl} alt="หน้าร้าน" className="mt-2 h-32 rounded-lg object-cover border border-slate-700" />
                )}
            </div>
            {error && <p className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-lg p-2">{error}</p>}
            <button type="submit" disabled={saving || uploading} className="w-full bg-gradient-to-r from-amber-400 to-yellow-500 disabled:opacity-50 text-slate-950 font-black py-2.5 rounded-xl text-xs cursor-pointer">
                {saving ? 'กำลังส่ง...' : 'ส่งข้อมูลยืนยันร้านค้า'}
            </button>
        </form>
    );
}
