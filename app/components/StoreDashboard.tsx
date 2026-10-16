'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { api, baht, uploadMedia } from '../lib/client';
import StoreProfileForm, { type StoreProfileData } from './StoreProfileForm';

interface Listing {
    id: string;
    title: string;
    price_satang: number | null;
    description: string | null;
    image_url: string | null;
    active: boolean;
}

interface StoreResp {
    profile: StoreProfileData | null;
    listings: Listing[];
    menuLimit: number;
    isStore: boolean;
}

const input =
    'w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500';

const emptyForm = { id: '', title: '', priceBaht: '', description: '', imageUrl: '' };

const STATUS: Record<string, string> = {
    pending: '⏳ รอแอดมินตรวจสอบ',
    approved: '✅ ยืนยันแล้ว',
    rejected: '❌ ไม่ผ่านการตรวจสอบ',
};

/** ร้านค้าของฉัน: สถานะยืนยันตัวตน + จัดการประกาศขาย (10/20 เมนู) */
export default function StoreDashboard({
    open,
    onClose,
    showToast,
    onChanged,
    onUpgrade,
    inline = false,
    refreshKey = 0,
}: {
    inline?: boolean;
    refreshKey?: number;
    open: boolean;
    onClose: () => void;
    showToast: (m: string) => void;
    onChanged: () => void;
    onUpgrade: () => void;
}) {
    const [data, setData] = useState<StoreResp | null>(null);
    const [editProfile, setEditProfile] = useState(false);
    const [form, setForm] = useState(emptyForm);
    const [showForm, setShowForm] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        const r = await api<StoreResp>('/api/me/store');
        if (r.ok && r.data) setData(r.data);
    }, []);

    useEffect(() => {
        if (open) {
            load();
            setShowForm(false);
            setEditProfile(false);
        }
    }, [open, load, refreshKey]);

    if (!open) return null;

    const activeCount = data?.listings.filter((l) => l.active).length ?? 0;
    const approved = data?.profile?.status === 'approved';

    const onImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (!f) return;
        setUploading(true);
        setError(null);
        try {
            const item = await uploadMedia(f, { imageOnly: true });
            setForm((x) => ({ ...x, imageUrl: item.url }));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'อัปโหลดไม่สำเร็จ');
        } finally {
            setUploading(false);
        }
    };

    const save = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        const body = JSON.stringify({
            title: form.title,
            priceBaht: form.priceBaht,
            description: form.description,
            imageUrl: form.imageUrl,
        });
        const r = form.id
            ? await api<{ error?: string }>(`/api/listings/${form.id}`, { method: 'PATCH', body })
            : await api<{ error?: string }>('/api/listings', { method: 'POST', body });
        if (!r.ok) {
            setError(r.data?.error ?? 'บันทึกไม่สำเร็จ');
            return;
        }
        showToast(form.id ? 'แก้ไขประกาศแล้ว' : 'ลงประกาศขายแล้ว');
        setForm(emptyForm);
        setShowForm(false);
        await load();
        onChanged();
    };

    const toggle = async (l: Listing) => {
        const r = await api<{ error?: string }>(`/api/listings/${l.id}`, {
            method: 'PATCH',
            body: JSON.stringify({
                title: l.title,
                priceBaht: l.price_satang != null ? l.price_satang / 100 : '',
                description: l.description ?? '',
                imageUrl: l.image_url ?? '',
                active: !l.active,
            }),
        });
        if (!r.ok) showToast(r.data?.error ?? 'ดำเนินการไม่สำเร็จ');
        await load();
        onChanged();
    };

    const remove = async (l: Listing) => {
        if (!window.confirm(`ลบประกาศ "${l.title}"?`)) return;
        await api(`/api/listings/${l.id}`, { method: 'DELETE' });
        await load();
        onChanged();
    };

    return (
        <div className={inline ? '' : 'fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-4'} onClick={inline ? undefined : onClose}>
            <div className={inline ? 'bg-slate-950/40 border border-slate-800 rounded-2xl p-4 space-y-4' : 'bg-slate-900 border border-amber-500/40 rounded-2xl max-w-2xl w-full p-5 space-y-4 shadow-2xl max-h-[92vh] overflow-y-auto'} onClick={(e) => e.stopPropagation()}>
                <div className="flex justify-between items-start">
                    <div>
                        <h3 className="text-base font-bold text-white">{inline ? '🛒 สินค้า/เมนูขาย ของร้าน' : '🏪 ร้านค้าของฉัน'}</h3>
                        {data?.profile && (
                            <p className="text-xs text-slate-400 mt-0.5">
                                {data.profile.store_name} • {STATUS[data.profile.status ?? 'pending']}
                            </p>
                        )}
                    </div>
                    {!inline && <button onClick={onClose} className="text-slate-400 hover:text-white cursor-pointer text-lg p-1">✕</button>}
                </div>

                {!data ? (
                    <p className="text-xs text-slate-400">กำลังโหลด...</p>
                ) : !data.isStore ? (
                    <div className="text-center space-y-3 py-4">
                        <p className="text-sm text-slate-300">ลงประกาศขายสินค้า/อาหารได้เฉพาะสมาชิกระดับร้านค้า (299 บาท • 10 เมนู) หรือร้านค้า VIP (599 บาท • 20 เมนู)</p>
                        <button onClick={onUpgrade} className="bg-gradient-to-r from-amber-400 to-yellow-500 text-slate-950 font-black text-xs px-5 py-2.5 rounded-xl cursor-pointer">
                            สมัครสมาชิกระดับร้านค้า
                        </button>
                    </div>
                ) : !data.profile || editProfile || data.profile.status === 'rejected' ? (
                    <StoreProfileForm
                        initial={data.profile}
                        showToast={showToast}
                        onSubmitted={async () => {
                            setEditProfile(false);
                            await load();
                            onChanged();
                        }}
                    />
                ) : (
                    <>
                        <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-950/60 border border-slate-800 rounded-xl p-3">
                            <span className="text-xs text-slate-300">
                                ประกาศที่เปิดอยู่ <b className="text-amber-300">{activeCount}</b> / {data.menuLimit} เมนู
                            </span>
                            <div className="flex gap-2">
                                <button onClick={() => setEditProfile(true)} className="text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded-lg cursor-pointer">
                                    แก้ไขข้อมูลร้าน
                                </button>
                                <button
                                    onClick={() => {
                                        setForm(emptyForm);
                                        setShowForm(true);
                                    }}
                                    disabled={!approved || activeCount >= data.menuLimit}
                                    className="text-[11px] bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white font-bold px-3 py-1.5 rounded-lg cursor-pointer"
                                >
                                    + ลงประกาศขาย
                                </button>
                            </div>
                        </div>
                        {!approved && (
                            <p className="text-[11px] text-amber-300">ลงประกาศขายได้หลังแอดมินยืนยันร้านค้า (การแก้ไขข้อมูลร้านจะต้องรอตรวจสอบใหม่)</p>
                        )}

                        {showForm && (
                            <form onSubmit={save} className="space-y-2.5 bg-slate-950/60 border border-slate-800 rounded-xl p-3">
                                <input className={input} placeholder="ชื่อสินค้า/เมนู *" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required maxLength={120} />
                                <input className={input} placeholder="ราคา (บาท)" inputMode="decimal" value={form.priceBaht} onChange={(e) => setForm({ ...form, priceBaht: e.target.value })} />
                                <textarea className={input} rows={2} placeholder="รายละเอียด" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={500} />
                                <div className="flex items-center gap-2">
                                    <input type="file" accept="image/*" onChange={onImage} disabled={uploading} className="text-xs text-slate-300" />
                                    {uploading && <span className="text-[11px] text-amber-300">กำลังอัปโหลดและตรวจสอบ...</span>}
                                </div>
                                {form.imageUrl && (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={form.imageUrl} alt="" className="h-24 rounded-lg object-cover" />
                                )}
                                {error && <p className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-lg p-2">{error}</p>}
                                <div className="flex gap-2">
                                    <button type="button" onClick={() => setShowForm(false)} className="flex-1 bg-slate-800 text-slate-300 text-xs py-2 rounded-lg cursor-pointer">ยกเลิก</button>
                                    <button type="submit" disabled={uploading} className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-xs py-2 rounded-lg cursor-pointer">บันทึก</button>
                                </div>
                            </form>
                        )}

                        <div className="space-y-2">
                            {data.listings.length === 0 && <p className="text-xs text-slate-500">ยังไม่มีประกาศขาย</p>}
                            {data.listings.map((l) => (
                                <div key={l.id} className={`flex gap-3 items-center bg-slate-950 border rounded-xl p-2.5 ${l.active ? 'border-slate-800' : 'border-slate-800 opacity-50'}`}>
                                    {l.image_url ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img src={l.image_url} alt="" className="w-14 h-14 rounded-lg object-cover shrink-0" />
                                    ) : (
                                        <div className="w-14 h-14 rounded-lg bg-slate-800 flex items-center justify-center shrink-0">🍽️</div>
                                    )}
                                    <div className="min-w-0 flex-1">
                                        <p className="text-xs font-bold text-white truncate">{l.title}</p>
                                        <p className="text-[11px] text-amber-300">{l.price_satang != null ? baht(l.price_satang) : 'ไม่ระบุราคา'}</p>
                                    </div>
                                    <div className="flex gap-1 shrink-0">
                                        <button
                                            onClick={() => {
                                                setForm({
                                                    id: l.id,
                                                    title: l.title,
                                                    priceBaht: l.price_satang != null ? String(l.price_satang / 100) : '',
                                                    description: l.description ?? '',
                                                    imageUrl: l.image_url ?? '',
                                                });
                                                setShowForm(true);
                                            }}
                                            className="text-[10px] bg-sky-500/20 text-sky-300 px-2 py-1 rounded cursor-pointer"
                                        >
                                            แก้ไข
                                        </button>
                                        <button onClick={() => toggle(l)} className="text-[10px] bg-slate-700 text-slate-200 px-2 py-1 rounded cursor-pointer">
                                            {l.active ? 'ปิด' : 'เปิด'}
                                        </button>
                                        <button onClick={() => remove(l)} className="text-[10px] bg-rose-500/20 text-rose-300 px-2 py-1 rounded cursor-pointer">ลบ</button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
