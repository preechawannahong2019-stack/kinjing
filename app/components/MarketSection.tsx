'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { api, baht } from '../lib/client';

interface PublicListing {
    id: string;
    title: string;
    price_satang: number | null;
    description: string | null;
    image_url: string | null;
    store_name: string;
    latitude: number | null;
    longitude: number | null;
    address: string | null;
    map_url: string | null;
    is_mine: boolean;
    boosted: boolean;
    promo_price_satang: number | null;
    coupon_code: string | null;
    discount_text: string | null;
}

/** ประกาศขายสินค้า/อาหาร จากร้านค้าที่ยืนยันตัวตนแล้ว */
export default function MarketSection({
    refreshKey,
    isAdmin,
    onReport,
    showToast,
}: {
    refreshKey: number;
    isAdmin: boolean;
    onReport: (target: { type: 'listing'; id: string; title: string }) => void;
    showToast: (m: string) => void;
}) {
    const [items, setItems] = useState<PublicListing[]>([]);

    const load = useCallback(async () => {
        const r = await api<{ listings: PublicListing[] }>('/api/listings');
        if (r.ok && r.data) setItems(r.data.listings);
    }, []);

    useEffect(() => {
        load();
    }, [load, refreshKey]);

    if (items.length === 0) return null;

    const remove = async (l: PublicListing) => {
        if (!window.confirm(`ลบประกาศ "${l.title}"?`)) return;
        const r = await api(`/api/listings/${l.id}`, { method: 'DELETE' });
        if (r.ok) {
            showToast('ลบประกาศแล้ว');
            load();
        }
    };

    return (
        <section className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
            {items.some((l) => l.boosted) && (
                <div className="flex items-center justify-between">
                    <h2 className="text-base font-black text-amber-300">⭐ เมนูเด็ดแนะนำ</h2>
                    <span className="text-[11px] text-slate-500">จากร้านค้าที่ยืนยันแล้ว • มีคูปองส่วนลด</span>
                </div>
            )}
            {[items.filter((l) => l.boosted), items.filter((l) => !l.boosted)].map((group, gi) =>
                group.length === 0 ? null : (
            <div key={gi} className="space-y-2">
            {gi === 1 && (
                <div className="flex items-center justify-between">
                    <h2 className="text-sm font-black text-white">🛒 เมนูขายจากร้านค้าที่ยืนยันแล้ว</h2>
                    <span className="text-[11px] text-slate-500">{group.length} รายการ</span>
                </div>
            )}
            <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 snap-x">
                {group.map((l) => {
                    const map =
                        l.map_url ||
                        (l.latitude != null && l.longitude != null
                            ? `https://www.google.com/maps/search/?api=1&query=${l.latitude},${l.longitude}`
                            : null);
                    return (
                        <article key={l.id} className={`snap-start shrink-0 ${l.boosted ? 'w-56 border-2 border-amber-400 shadow-lg shadow-amber-500/20' : 'w-48 border border-slate-800'} bg-slate-950 rounded-xl overflow-hidden relative`}>
                            {l.boosted && (
                                <span className="absolute top-2 left-2 z-10 text-[10px] font-black bg-gradient-to-r from-amber-400 to-orange-500 text-slate-950 px-2 py-0.5 rounded-full">🔥 เมนูเด็ด</span>
                            )}
                            {l.image_url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={l.image_url} alt={l.title} className="w-full h-28 object-cover" />
                            ) : (
                                <div className="w-full h-28 bg-slate-800 flex items-center justify-center text-3xl">🍽️</div>
                            )}
                            <div className="p-2.5 space-y-1">
                                <p className="text-xs font-bold text-white line-clamp-1">{l.title}</p>
                                <p className="text-[11px] text-amber-300 font-bold">
                                    {l.promo_price_satang != null ? (
                                        <>
                                            {baht(l.promo_price_satang)}{' '}
                                            {l.price_satang != null && <s className="text-slate-500 font-normal">{baht(l.price_satang)}</s>}
                                        </>
                                    ) : l.price_satang != null ? (
                                        baht(l.price_satang)
                                    ) : (
                                        '—'
                                    )}
                                </p>
                                {l.discount_text && <p className="text-[10px] text-emerald-300">{l.discount_text}</p>}
                                {l.coupon_code && (
                                    <button
                                        onClick={async () => {
                                            try {
                                                await navigator.clipboard.writeText(l.coupon_code!);
                                            } catch {
                                                /* ignore */
                                            }
                                            showToast(`คัดลอกโค้ด ${l.coupon_code} แล้ว — แสดงที่ร้านเพื่อรับส่วนลด`);
                                        }}
                                        className="w-full text-[11px] font-mono font-bold bg-emerald-900/50 border border-emerald-500/50 text-emerald-300 px-2 py-1 rounded cursor-pointer"
                                    >
                                        🏷️ {l.coupon_code} • คัดลอก
                                    </button>
                                )}
                                <p className="text-[10px] text-slate-400 line-clamp-1">✅ {l.store_name}</p>
                                {l.description && <p className="text-[10px] text-slate-500 line-clamp-2">{l.description}</p>}
                                <div className="flex gap-1 pt-1">
                                    {map && (
                                        <a href={map} target="_blank" rel="noopener noreferrer" className="text-[10px] bg-emerald-500/20 text-emerald-300 px-2 py-1 rounded">
                                            แผนที่
                                        </a>
                                    )}
                                    {!l.is_mine && (
                                        <button onClick={() => onReport({ type: 'listing', id: l.id, title: l.title })} className="text-[10px] bg-slate-800 text-slate-400 px-2 py-1 rounded cursor-pointer">
                                            แจ้ง
                                        </button>
                                    )}
                                    {isAdmin && (
                                        <button onClick={() => remove(l)} className="text-[10px] bg-rose-500/20 text-rose-300 px-2 py-1 rounded cursor-pointer">ลบ</button>
                                    )}
                                </div>
                            </div>
                        </article>
                    );
                })}
            </div>
            </div>
                )
            )}
        </section>
    );
}
