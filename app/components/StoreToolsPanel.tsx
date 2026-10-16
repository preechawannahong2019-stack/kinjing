'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { api, type Membership } from '../lib/client';
import StoreDashboard from './StoreDashboard';

interface MyReview {
    id: string;
    name: string;
    category: string;
    view_count: number;
    boosted: boolean;
    boosted_until: string | null;
    active_promos: number;
}

interface Stats {
    activeBoosts: number;
    maxBoosts: number;
    boostDays: number;
    freeMealThisMonth: number;
    freeMealLimit: number;
    activePromos: number;
}

const fmtDate = (s: string | null) =>
    s ? new Date(s).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }) : '';

/**
 * เครื่องมือสมาชิกร้านค้า (299/599) ในหน้าลงรีวิว:
 * เพิ่มการมองเห็น • สร้างคูปอง/คูปองกินฟรี • ลงขายสินค้า 10/20 เมนู
 * สมาชิกทั่วไป/ระดับต้นจะเห็นการ์ดสิทธิ์ที่ยังไม่มีแทน
 */
export default function StoreToolsPanel({
    membership,
    refreshKey,
    onBoost,
    onPromo,
    onUpgrade,
    showToast,
    onChanged,
}: {
    membership: Membership;
    refreshKey: number;
    onBoost: (r: { id: string; name: string }) => Promise<void>;
    onPromo: (r: { id: string; name: string }) => void;
    onUpgrade: () => void;
    showToast: (m: string) => void;
    onChanged: () => void;
}) {
    const [reviews, setReviews] = useState<MyReview[]>([]);
    const [stats, setStats] = useState<Stats | null>(null);
    const [listingCount, setListingCount] = useState(0);

    const load = useCallback(async () => {
        const r = await api<{ myReviews: MyReview[]; stats: Stats; listings: { active: boolean }[] }>('/api/me/store');
        if (r.ok && r.data) {
            setReviews(r.data.myReviews ?? []);
            setStats(r.data.stats ?? null);
            setListingCount((r.data.listings ?? []).filter((l) => l.active).length);
        }
    }, []);

    useEffect(() => {
        if (membership.isStore) load();
    }, [membership.isStore, load, refreshKey]);

    if (!membership.isStore) {
        return (
            <section className="bg-gradient-to-r from-amber-950/40 to-slate-900 border border-amber-500/30 rounded-2xl p-4 space-y-2">
                <p className="text-sm font-bold text-amber-300">🏪 สิทธิ์เพิ่มเติมสำหรับสมาชิกระดับร้านค้า</p>
                <ul className="text-xs text-slate-300 grid grid-cols-1 sm:grid-cols-3 gap-1.5">
                    <li>🚀 บูสต์ 10 ครั้ง ขึ้น “เมนูเด็ดแนะนำ” หน้าแรก</li>
                    <li>🏷️ สร้างคูปองส่วนลด + 🎟️ คูปองกินฟรีรายเดือน</li>
                    <li>🛒 ลงขายสินค้า/อาหาร 10 เมนู (VIP 20 เมนู)</li>
                </ul>
                <button onClick={onUpgrade} className="bg-gradient-to-r from-amber-400 to-yellow-500 text-slate-950 font-black text-xs px-4 py-2 rounded-xl cursor-pointer">
                    อัปเกรดเป็นสมาชิกร้านค้า 299 บาท
                </button>
            </section>
        );
    }

    const boostFull = !!stats && stats.activeBoosts >= stats.maxBoosts;

    return (
        <section className="bg-slate-900 border-2 border-amber-500/40 rounded-2xl p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-black text-amber-300">🏪 เครื่องมือร้านค้า — {membership.tierName}</h2>
                <span className="text-[11px] text-slate-400">สิทธิ์เฉพาะสมาชิกร้านค้า</span>
            </div>

            {stats && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {[
                        ['🚀 บูสต์ที่ใช้งาน (รีวิว+เมนู)', `${stats.activeBoosts} / ${stats.maxBoosts}`],
                        ['🏷️ โปรโมชัน/คูปองที่เปิดอยู่', `${stats.activePromos}`],
                        ['🎟️ คูปองกินฟรีเดือนนี้', `${stats.freeMealThisMonth} / ${stats.freeMealLimit}`],
                        ['🛒 เมนูขายที่เปิดอยู่', `${listingCount} / ${membership.menuLimit}`],
                    ].map(([label, val]) => (
                        <div key={label} className="bg-slate-950 border border-amber-500/30 rounded-xl px-3 py-2">
                            <span className="text-[10px] text-amber-200 block">{label}</span>
                            <span className="text-lg font-black text-amber-400">{val}</span>
                        </div>
                    ))}
                </div>
            )}

            <div className="space-y-2">
                <p className="text-xs font-bold text-white">รีวิว/ร้านของฉัน — เพิ่มการมองเห็น และสร้างคูปอง</p>
                {reviews.length === 0 && (
                    <p className="text-xs text-slate-500">ยังไม่มีรีวิว — โพสต์รีวิวร้านของคุณด้านบนก่อน แล้วจึงบูสต์หรือสร้างคูปองได้</p>
                )}
                {reviews.map((r) => (
                    <div key={r.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-slate-950 border border-slate-800 rounded-xl p-3">
                        <div className="min-w-0">
                            <p className="text-xs font-bold text-white truncate">{r.name}</p>
                            <p className="text-[11px] text-slate-400">
                                {r.category} • {r.view_count.toLocaleString()} วิว
                                {r.boosted && <span className="text-amber-300"> • 🔥 บูสต์ถึง {fmtDate(r.boosted_until)}</span>}
                                {r.active_promos > 0 && <span className="text-emerald-300"> • โปรที่เปิด {r.active_promos}</span>}
                            </p>
                        </div>
                        <div className="flex gap-1.5 shrink-0">
                            <button
                                disabled={boostFull && !r.boosted}
                                onClick={async () => {
                                    await onBoost({ id: r.id, name: r.name });
                                    load();
                                }}
                                className="text-[11px] font-bold bg-amber-500/20 hover:bg-amber-500/30 disabled:opacity-40 text-amber-300 border border-amber-500/40 px-3 py-1.5 rounded-lg cursor-pointer"
                            >
                                🚀 {r.boosted ? 'ต่อเวลาบูสต์' : `บูสต์ ${stats?.boostDays ?? 7} วัน`}
                            </button>
                            <button
                                onClick={() => onPromo({ id: r.id, name: r.name })}
                                className="text-[11px] font-bold bg-orange-500/20 hover:bg-orange-500/30 text-orange-300 border border-orange-500/40 px-3 py-1.5 rounded-lg cursor-pointer"
                            >
                                🏷️ สร้างคูปอง
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            <StoreDashboard
                inline
                open
                refreshKey={refreshKey}
                onClose={() => undefined}
                showToast={showToast}
                onChanged={() => {
                    load();
                    onChanged();
                }}
                onUpgrade={onUpgrade}
            />
        </section>
    );
}
