'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { api, baht, ORDER_CHANNELS, SERVICE_MODES } from '../lib/client';

interface PublicListing {
    id: string;
    title: string;
    price_satang: number | null;
    description: string | null;
    image_url: string | null;
    store_name: string;
    storefront_url: string | null;
    contact_phone: string | null;
    latitude: number | null;
    longitude: number | null;
    address: string | null;
    map_url: string | null;
    is_mine: boolean;
    boosted: boolean;
    promo_price_satang: number | null;
    coupon_code: string | null;
    discount_text: string | null;
    order_links: Record<string, string> | null;
    service_modes: string[] | null;
}

function ServiceBadges({ modes, big }: { modes: string[] | null; big?: boolean }) {
    const list = SERVICE_MODES.filter((m) => modes?.includes(m.key));
    if (list.length === 0) return null;
    return (
        <div className="flex flex-wrap gap-1">
            {list.map((m) => (
                <span key={m.key} className={`${big ? 'text-xs px-2.5 py-1' : 'text-[9px] px-1.5 py-0.5'} font-bold rounded-full border ${m.cls}`}>
                    {m.icon} {m.label}
                </span>
            ))}
        </div>
    );
}

const mapOf = (l: PublicListing) =>
    l.map_url ||
    (l.latitude != null && l.longitude != null
        ? `https://www.google.com/maps/search/?api=1&query=${l.latitude},${l.longitude}`
        : null);

function Price({ l, big }: { l: PublicListing; big?: boolean }) {
    const cls = big ? 'text-2xl' : 'text-[11px]';
    if (l.promo_price_satang != null)
        return (
            <p className={`${cls} text-amber-300 font-black`}>
                {baht(l.promo_price_satang)}{' '}
                {l.price_satang != null && <s className={`${big ? 'text-base' : ''} text-slate-500 font-normal`}>{baht(l.price_satang)}</s>}
            </p>
        );
    return <p className={`${cls} text-amber-300 font-black`}>{l.price_satang != null ? baht(l.price_satang) : '—'}</p>;
}

/** เมนูขายจากร้านค้าที่ยืนยันแล้ว + เมนูเด็ดแนะนำ (บูสต์) — กดดูรายละเอียดแบบภาพใหญ่และสั่งซื้อออนไลน์ */
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
    const [sel, setSel] = useState<PublicListing | null>(null);
    const [mode, setMode] = useState<string>('all');

    const load = useCallback(async () => {
        const r = await api<{ listings: PublicListing[] }>('/api/listings');
        if (r.ok && r.data) setItems(r.data.listings);
    }, []);

    useEffect(() => {
        load();
    }, [load, refreshKey]);

    useEffect(() => {
        if (!sel) return;
        const h = (e: KeyboardEvent) => e.key === 'Escape' && setSel(null);
        window.addEventListener('keydown', h);
        return () => window.removeEventListener('keydown', h);
    }, [sel]);

    if (items.length === 0) return null;

    const remove = async (l: PublicListing) => {
        if (!window.confirm(`ลบประกาศ "${l.title}"?`)) return;
        const r = await api(`/api/listings/${l.id}`, { method: 'DELETE' });
        if (r.ok) {
            showToast('ลบประกาศแล้ว');
            setSel(null);
            load();
        }
    };

    const copyCode = async (code: string) => {
        try {
            await navigator.clipboard.writeText(code);
        } catch {
            /* ignore */
        }
        showToast(`คัดลอกโค้ด ${code} แล้ว — แสดงที่ร้าน/ใส่ในแอปเพื่อรับส่วนลด`);
    };

    const shown = mode === 'all' ? items : items.filter((l) => l.service_modes?.includes(mode));
    const groups: [string, PublicListing[]][] = [
        ['⭐ เมนูเด็ดแนะนำ', shown.filter((l) => l.boosted)],
        ['🛒 เมนูขายจากร้านค้าที่ยืนยันแล้ว', shown.filter((l) => !l.boosted)],
    ];

    return (
        <section className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-4">
            <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-slate-400 mr-1">รูปแบบบริการ:</span>
                {[{ key: 'all', label: 'ทั้งหมด', icon: '🍴' }, ...SERVICE_MODES].map((m) => {
                    const n = m.key === 'all' ? items.length : items.filter((l) => l.service_modes?.includes(m.key)).length;
                    return (
                        <button
                            key={m.key}
                            onClick={() => setMode(m.key)}
                            className={`text-xs font-bold px-3 py-1.5 rounded-lg cursor-pointer transition ${
                                mode === m.key ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                            }`}
                        >
                            {m.icon} {m.label} <span className="opacity-70">({n})</span>
                        </button>
                    );
                })}
            </div>
            {shown.length === 0 && <p className="text-xs text-slate-500">ยังไม่มีเมนูที่รองรับรูปแบบบริการนี้</p>}
            {groups.map(([title, group]) =>
                group.length === 0 ? null : (
                    <div key={title} className="space-y-2">
                        <div className="flex items-center justify-between">
                            <h2 className={`font-black ${title.startsWith('⭐') ? 'text-base text-amber-300' : 'text-sm text-white'}`}>{title}</h2>
                            <span className="text-[11px] text-slate-500">{group.length} รายการ • กดเพื่อดูรายละเอียด/สั่งซื้อ</span>
                        </div>
                        <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 snap-x">
                            {group.map((l) => (
                                <article
                                    key={l.id}
                                    onClick={() => setSel(l)}
                                    className={`snap-start shrink-0 cursor-pointer hover:-translate-y-0.5 transition ${
                                        l.boosted ? 'w-56 border-2 border-amber-400 shadow-lg shadow-amber-500/20' : 'w-48 border border-slate-800 hover:border-amber-500/50'
                                    } bg-slate-950 rounded-xl overflow-hidden relative`}
                                >
                                    {l.boosted && (
                                        <span className="absolute top-2 left-2 z-10 text-[10px] font-black bg-gradient-to-r from-amber-400 to-orange-500 text-slate-950 px-2 py-0.5 rounded-full">🔥 เมนูเด็ด</span>
                                    )}
                                    {l.image_url ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img src={l.image_url} alt={l.title} className="w-full h-32 object-cover" />
                                    ) : (
                                        <div className="w-full h-32 bg-slate-800 flex items-center justify-center text-3xl">🍽️</div>
                                    )}
                                    <div className="p-2.5 space-y-1">
                                        <p className="text-xs font-bold text-white line-clamp-1">{l.title}</p>
                                        <Price l={l} />
                                        <p className="text-[10px] text-slate-400 line-clamp-1">✅ {l.store_name}</p>
                                        <ServiceBadges modes={l.service_modes} />
                                        {(l.coupon_code || l.discount_text) && (
                                            <p className="text-[10px] font-bold text-emerald-300 line-clamp-1">🏷️ {l.discount_text || `โค้ด ${l.coupon_code}`}</p>
                                        )}
                                        {l.order_links && Object.keys(l.order_links).length > 0 && (
                                            <p className="text-[10px] text-sky-300">🛵 สั่งออนไลน์ได้</p>
                                        )}
                                        <p className="text-[10px] text-amber-300/80 pt-0.5">ดูรายละเอียด →</p>
                                    </div>
                                </article>
                            ))}
                        </div>
                    </div>
                )
            )}

            {sel && (
                <div className="fixed inset-0 bg-black/85 backdrop-blur-sm z-[65] flex items-center justify-center p-3 sm:p-6" onClick={() => setSel(null)}>
                    <div
                        className="bg-slate-900 border border-amber-500/40 rounded-2xl max-w-3xl w-full max-h-[94vh] overflow-y-auto shadow-2xl grid grid-cols-1 md:grid-cols-2"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="relative bg-black md:rounded-l-2xl overflow-hidden">
                            {sel.image_url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={sel.image_url} alt={sel.title} className="w-full h-72 md:h-full max-h-[70vh] object-cover" />
                            ) : (
                                <div className="w-full h-72 md:h-full bg-slate-800 flex items-center justify-center text-6xl">🍽️</div>
                            )}
                            {sel.boosted && (
                                <span className="absolute top-3 left-3 text-xs font-black bg-gradient-to-r from-amber-400 to-orange-500 text-slate-950 px-3 py-1 rounded-full">🔥 เมนูเด็ดแนะนำ</span>
                            )}
                            <button onClick={() => setSel(null)} className="absolute top-3 right-3 md:hidden bg-black/70 text-white w-9 h-9 rounded-full cursor-pointer" aria-label="ปิด">
                                ✕
                            </button>
                        </div>
                        <div className="p-5 space-y-3">
                            <div className="flex justify-between items-start gap-2">
                                <h3 className="text-lg font-black text-white">{sel.title}</h3>
                                <button onClick={() => setSel(null)} className="hidden md:block text-slate-400 hover:text-white cursor-pointer text-lg" aria-label="ปิด">
                                    ✕
                                </button>
                            </div>
                            <Price l={sel} big />
                            <ServiceBadges modes={sel.service_modes} big />
                            {sel.description && <p className="text-sm text-slate-300 whitespace-pre-line">{sel.description}</p>}

                            {(sel.coupon_code || sel.discount_text) && (
                                <div className="bg-emerald-950/50 border border-emerald-500/40 rounded-xl p-3 space-y-2">
                                    <p className="text-xs font-bold text-emerald-300">🏷️ คูปองส่วนลด</p>
                                    {sel.discount_text && <p className="text-sm text-white">{sel.discount_text}</p>}
                                    {sel.coupon_code && (
                                        <button onClick={() => copyCode(sel.coupon_code!)} className="w-full font-mono font-black text-base bg-emerald-600 hover:bg-emerald-700 text-white py-2 rounded-lg cursor-pointer">
                                            {sel.coupon_code} • กดคัดลอก
                                        </button>
                                    )}
                                </div>
                            )}

                            {sel.order_links && Object.keys(sel.order_links).length > 0 && (
                                <div className="space-y-1.5">
                                    <p className="text-xs font-bold text-white">🛵 สั่งซื้อออนไลน์</p>
                                    <div className="grid grid-cols-2 gap-2">
                                        {ORDER_CHANNELS.filter((c) => sel.order_links?.[c.key]).map((c) => (
                                            <a
                                                key={c.key}
                                                href={sel.order_links![c.key]}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className={`${c.cls} text-center font-bold text-sm py-2.5 rounded-xl hover:opacity-90`}
                                            >
                                                สั่งผ่าน {c.label}
                                            </a>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3 text-xs text-slate-300 space-y-1">
                                <p className="font-bold text-white">✅ {sel.store_name}</p>
                                {sel.address && <p>📍 {sel.address}</p>}
                                <div className="flex flex-wrap gap-2 pt-1">
                                    {mapOf(sel) && (
                                        <a href={mapOf(sel)!} target="_blank" rel="noopener noreferrer" className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-3 py-1.5 rounded-lg font-bold">
                                            🗺️ แผนที่ร้าน
                                        </a>
                                    )}
                                    {sel.contact_phone && (
                                        <a href={`tel:${sel.contact_phone}`} className="bg-sky-500/20 text-sky-300 border border-sky-500/40 px-3 py-1.5 rounded-lg font-bold">
                                            📞 โทรสั่ง {sel.contact_phone}
                                        </a>
                                    )}
                                </div>
                            </div>

                            <div className="flex gap-2 pt-1">
                                {!sel.is_mine && (
                                    <button
                                        onClick={() => {
                                            onReport({ type: 'listing', id: sel.id, title: sel.title });
                                            setSel(null);
                                        }}
                                        className="text-[11px] bg-slate-800 text-slate-400 px-3 py-1.5 rounded-lg cursor-pointer"
                                    >
                                        🚩 แจ้งเนื้อหาไม่เหมาะสม
                                    </button>
                                )}
                                {isAdmin && (
                                    <button onClick={() => remove(sel)} className="text-[11px] bg-rose-500/20 text-rose-300 px-3 py-1.5 rounded-lg cursor-pointer">
                                        ลบ (แอดมิน)
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </section>
    );
}
