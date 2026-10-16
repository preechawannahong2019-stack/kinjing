'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { api, baht } from '../lib/client';

type Tab = 'stores' | 'reports' | 'users' | 'orders';

interface AdminStore {
    user_id: string;
    store_name: string;
    map_url: string | null;
    latitude: number | null;
    longitude: number | null;
    address: string | null;
    storefront_url: string;
    contact_phone: string | null;
    status: string;
    admin_note: string | null;
    updated_at: string;
    phone: string | null;
    membership_tier: string | null;
}
interface AdminReport {
    id: number;
    target_type: 'review' | 'listing';
    target_id: string;
    reason: string;
    status: string;
    created_at: string;
    target_title: string | null;
    owner_id: string | null;
    owner_blocked: boolean | null;
}
interface AdminUser {
    id: string;
    display_name: string | null;
    phone: string | null;
    blocked_at: string | null;
    blocked_reason: string | null;
    membership_tier: string;
    activated_at: string | null;
    last_login_at: string | null;
    has_password: boolean;
    review_count: number;
    paid_satang: number;
    store_name: string | null;
    store_status: string | null;
}
interface UserCounts {
    member: number;
    store: number;
    store_vip: number;
    blocked: number;
    pending_orders: number;
    review_orders: number;
}
const TIER_LABEL: Record<string, string> = {
    free: 'ทั่วไป',
    member: 'ระดับต้น 99',
    store: 'ร้านค้า 299',
    store_vip: 'ร้านค้า VIP 599',
};
interface AdminOrder {
    id: string;
    user_id: string;
    tier: string;
    amount_satang: number;
    status: string;
    slip_ref: string | null;
    slip_sender: string | null;
    verify_attempts: number;
    created_at: string;
    phone: string | null;
    display_name: string | null;
    slip_url: string | null;
    fail_reason: string | null;
}

const fmt = (s: string | null) => (s ? new Date(s).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '-');
const btn = 'text-[11px] font-bold px-2.5 py-1.5 rounded-lg cursor-pointer';

/** แอดมิน: อนุมัติร้านค้า / จัดการรายงาน / บล็อกสมาชิก / ตรวจรายการชำระเงิน */
export default function AdminModeration({
    showToast,
    onContentChanged,
}: {
    showToast: (m: string) => void;
    onContentChanged: () => void;
}) {
    const [tab, setTab] = useState<Tab>('users');
    const [counts, setCounts] = useState<UserCounts | null>(null);
    const [stores, setStores] = useState<AdminStore[]>([]);
    const [reports, setReports] = useState<AdminReport[]>([]);
    const [users, setUsers] = useState<AdminUser[]>([]);
    const [orders, setOrders] = useState<AdminOrder[]>([]);
    const [filter, setFilter] = useState('pending');
    const [q, setQ] = useState('');

    const load = useCallback(async () => {
        if (tab === 'stores') {
            const r = await api<{ stores: AdminStore[] }>(`/api/admin/stores?status=${filter}`);
            if (r.data) setStores(r.data.stores);
        } else if (tab === 'reports') {
            const r = await api<{ reports: AdminReport[] }>(`/api/admin/reports?status=${filter === 'pending' ? 'open' : filter}`);
            if (r.data) setReports(r.data.reports);
        } else if (tab === 'users') {
            const r = await api<{ users: AdminUser[]; counts: UserCounts }>(
                `/api/admin/users?q=${encodeURIComponent(q)}&tier=${filter === 'pending' ? 'all' : filter}`
            );
            if (r.data) {
                setUsers(r.data.users);
                setCounts(r.data.counts);
            }
        } else {
            const r = await api<{ orders: AdminOrder[] }>(`/api/admin/membership_orders?status=${filter}`);
            if (r.data) setOrders(r.data.orders);
        }
    }, [tab, filter, q]);

    useEffect(() => {
        load();
    }, [load]);

    const act = async (path: string, method: string, body?: unknown, msg = 'ดำเนินการแล้ว') => {
        const r = await api<{ error?: string }>(path, { method, body: body ? JSON.stringify(body) : undefined });
        if (!r.ok) showToast(r.data?.error ?? 'ดำเนินการไม่สำเร็จ');
        else showToast(msg);
        await load();
        return r.ok;
    };

    const blockUser = async (userId: string) => {
        const reason = window.prompt('เหตุผลในการบล็อก (แสดงให้ผู้ใช้เห็น)', 'ละเมิดเงื่อนไขการใช้งาน');
        if (reason === null) return;
        const deleteContent = window.confirm('ลบรีวิว/ประกาศ/โปรโมชันทั้งหมดของผู้ใช้นี้ด้วยหรือไม่?\n(OK = ลบทั้งหมด, Cancel = บล็อกอย่างเดียว)');
        if (await act(`/api/admin/users/${userId}/block`, 'POST', { reason, deleteContent }, 'บล็อกสมาชิกแล้ว')) onContentChanged();
    };

    const deleteTarget = async (r: AdminReport) => {
        if (!window.confirm(`ลบ "${r.target_title ?? r.target_id}"?`)) return;
        const path = r.target_type === 'review' ? `/api/reviews/${r.target_id}` : `/api/listings/${r.target_id}`;
        const res = await api(path, { method: 'DELETE' });
        if (res.ok || res.status === 404) {
            await act(`/api/admin/reports/${r.id}`, 'PATCH', { status: 'resolved', note: 'ลบเนื้อหาแล้ว' }, 'ลบเนื้อหาแล้ว');
            onContentChanged();
        } else showToast('ลบไม่สำเร็จ');
    };

    const filters: Record<Tab, string[]> = {
        stores: ['pending', 'approved', 'rejected', 'all'],
        reports: ['pending', 'resolved', 'dismissed', 'all'],
        users: ['pending', 'member', 'store', 'store_vip', 'free', 'blocked'],
        orders: ['pending', 'succeeded', 'rejected', 'expired', 'all'],
    };

    return (
        <section className="bg-slate-900 border-2 border-violet-500/40 rounded-2xl p-4 space-y-3">
            <div className="flex flex-wrap gap-2 items-center justify-between">
                <h2 className="text-xs font-black uppercase text-violet-300">👥 จัดการสมาชิก • ชำระเงิน • ร้านค้า • รายงาน</h2>
                <div className="flex flex-wrap gap-1.5">
                    {([
                        ['users', '👥 สมาชิก'],
                        ['orders', `💳 รายการชำระเงิน${counts?.pending_orders ? ` (${counts.pending_orders})` : ''}`],
                        ['stores', '🏪 ยืนยันร้านค้า'],
                        ['reports', '🚩 รายงานการละเมิด'],
                    ] as [Tab, string][]).map(([k, label]) => (
                        <button
                            key={k}
                            onClick={() => {
                                setTab(k);
                                setFilter('pending');
                            }}
                            className={`${btn} ${tab === k ? 'bg-violet-500 text-white' : 'bg-slate-800 text-slate-300'}`}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex flex-wrap gap-1.5 items-center">
                {filters[tab].map((f) => (
                    <button key={f} onClick={() => setFilter(f)} className={`${btn} ${filter === f ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-400'}`}>
                        {tab === 'users'
                            ? f === 'pending'
                                ? 'ทั้งหมด'
                                : f === 'blocked'
                                ? 'ถูกบล็อก'
                                : TIER_LABEL[f]
                            : tab === 'orders' && f === 'pending'
                            ? 'รอตรวจ'
                            : f === 'pending' && tab === 'reports'
                            ? 'open'
                            : f}
                    </button>
                ))}
                {tab === 'users' && (
                    <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาด้วยเบอร์โทร" className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white w-full sm:w-56" />
                )}
                <button onClick={load} className={`${btn} bg-slate-800 text-slate-300`}>รีเฟรช</button>
            </div>

            {tab === 'stores' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {stores.length === 0 && <p className="text-xs text-slate-500">ไม่มีรายการ</p>}
                    {stores.map((s) => {
                        const map = s.map_url || (s.latitude != null ? `https://www.google.com/maps/search/?api=1&query=${s.latitude},${s.longitude}` : null);
                        return (
                            <div key={s.user_id} className="bg-slate-950 border border-slate-800 rounded-xl p-3 flex gap-3">
                                <a href={s.storefront_url} target="_blank" rel="noopener noreferrer" className="shrink-0">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={s.storefront_url} alt="" className="w-24 h-24 object-cover rounded-lg" />
                                </a>
                                <div className="min-w-0 flex-1 space-y-1 text-[11px] text-slate-300">
                                    <p className="text-xs font-bold text-white">{s.store_name}</p>
                                    <p>สถานะ: {s.status} • สมาชิก: {s.membership_tier ?? '-'}</p>
                                    <p>โทรสมาชิก: {s.phone ?? '-'} • ร้าน: {s.contact_phone ?? '-'}</p>
                                    {s.address && <p className="truncate">📍 {s.address}</p>}
                                    {map && <a href={map} target="_blank" rel="noopener noreferrer" className="text-sky-300 underline">เปิดแผนที่</a>}
                                    <div className="flex gap-1.5 pt-1">
                                        <button onClick={() => act(`/api/admin/stores/${s.user_id}`, 'PATCH', { action: 'approve' }, 'อนุมัติร้านค้าแล้ว')} className={`${btn} bg-emerald-600 text-white`}>อนุมัติ</button>
                                        <button
                                            onClick={() => {
                                                const note = window.prompt('เหตุผลที่ไม่อนุมัติ', 'รูปหน้าร้าน/แผนที่ไม่ชัดเจน');
                                                if (note !== null) act(`/api/admin/stores/${s.user_id}`, 'PATCH', { action: 'reject', note }, 'ปฏิเสธแล้ว');
                                            }}
                                            className={`${btn} bg-rose-600 text-white`}
                                        >
                                            ไม่อนุมัติ
                                        </button>
                                        <button onClick={() => blockUser(s.user_id)} className={`${btn} bg-slate-800 text-rose-300`}>บล็อก</button>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {tab === 'reports' && (
                <div className="space-y-2">
                    {reports.length === 0 && <p className="text-xs text-slate-500">ไม่มีรายงาน</p>}
                    {reports.map((r) => (
                        <div key={r.id} className="bg-slate-950 border border-slate-800 rounded-xl p-3 flex flex-col md:flex-row md:items-center gap-2 justify-between">
                            <div className="text-[11px] text-slate-300 min-w-0">
                                <p className="text-xs font-bold text-white truncate">
                                    [{r.target_type === 'review' ? 'รีวิว' : 'ประกาศขาย'}] {r.target_title ?? '(ถูกลบแล้ว)'}
                                </p>
                                <p>เหตุผล: {r.reason}</p>
                                <p className="text-slate-500">{fmt(r.created_at)} • {r.status}{r.owner_blocked ? ' • เจ้าของถูกบล็อกแล้ว' : ''}</p>
                            </div>
                            <div className="flex flex-wrap gap-1.5 shrink-0">
                                {r.target_title && <button onClick={() => deleteTarget(r)} className={`${btn} bg-rose-600 text-white`}>ลบเนื้อหา</button>}
                                {r.owner_id && !r.owner_blocked && <button onClick={() => blockUser(r.owner_id!)} className={`${btn} bg-rose-900 text-rose-200`}>บล็อกเจ้าของ</button>}
                                {r.status === 'open' && (
                                    <button onClick={() => act(`/api/admin/reports/${r.id}`, 'PATCH', { status: 'dismissed' }, 'ปิดรายงานแล้ว')} className={`${btn} bg-slate-800 text-slate-300`}>ไม่ผิด/ปิด</button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {tab === 'users' && (
                <div className="space-y-2">
                    {counts && (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            {[
                                ['ระดับต้น', counts.member],
                                ['ร้านค้า', counts.store],
                                ['ร้านค้า VIP', counts.store_vip],
                                ['ถูกบล็อก', counts.blocked],
                            ].map(([label, n]) => (
                                <div key={label as string} className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2">
                                    <span className="text-[10px] text-slate-400 block">{label}</span>
                                    <span className="text-lg font-black text-white">{n}</span>
                                </div>
                            ))}
                        </div>
                    )}
                    {users.length === 0 && <p className="text-xs text-slate-500">ไม่พบสมาชิก</p>}
                    {users.map((u) => (
                        <div key={u.id} className="bg-slate-950 border border-slate-800 rounded-xl p-3 flex flex-col md:flex-row md:items-center justify-between gap-2">
                            <div className="text-[11px] text-slate-300 min-w-0 space-y-0.5">
                                <p className="text-xs font-bold text-white">
                                    {u.display_name ?? '@Anonymous'} • {u.phone ?? 'ไม่มีเบอร์'}{' '}
                                    <span className="ml-1 px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-[10px]">{TIER_LABEL[u.membership_tier] ?? u.membership_tier}</span>
                                </p>
                                <p>
                                    สมัคร {fmt(u.activated_at)} • ชำระแล้ว {baht(u.paid_satang)} • รีวิว {u.review_count} • {u.has_password ? 'ตั้งรหัสผ่านแล้ว' : 'ยังไม่ตั้งรหัสผ่าน'} • เข้าระบบล่าสุด {fmt(u.last_login_at)}
                                </p>
                                {u.store_name && <p>ร้าน: {u.store_name} ({u.store_status})</p>}
                                {u.blocked_at && <p className="text-rose-300">ถูกบล็อก {fmt(u.blocked_at)} — {u.blocked_reason}</p>}
                            </div>
                            <div className="flex flex-wrap gap-1.5 shrink-0 items-center">
                                <select
                                    value={u.membership_tier}
                                    onChange={(e) => {
                                        const t = e.target.value;
                                        if (window.confirm(`เปลี่ยนระดับของ ${u.phone ?? u.id} เป็น "${TIER_LABEL[t]}"?`))
                                            act(`/api/admin/users/${u.id}/tier`, 'POST', { tier: t }, 'เปลี่ยนระดับสมาชิกแล้ว');
                                    }}
                                    className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-[11px] text-white"
                                >
                                    {Object.entries(TIER_LABEL).map(([k, v]) => (
                                        <option key={k} value={k}>{v}</option>
                                    ))}
                                </select>
                                {u.phone && (
                                    <button
                                        onClick={async () => {
                                            if (!window.confirm('รีเซ็ตรหัสผ่านของสมาชิกนี้?')) return;
                                            const r = await api<{ tempPassword?: string; error?: string }>(`/api/admin/users/${u.id}/reset_password`, { method: 'POST' });
                                            if (r.ok && r.data?.tempPassword) window.alert(`รหัสผ่านชั่วคราว: ${r.data.tempPassword}\nแจ้งสมาชิกให้เข้าสู่ระบบแล้วเปลี่ยนรหัสผ่านที่ "บัญชีของฉัน"`);
                                            else showToast(r.data?.error ?? 'รีเซ็ตไม่สำเร็จ');
                                            load();
                                        }}
                                        className={`${btn} bg-sky-700 text-white`}
                                    >
                                        รีเซ็ตรหัสผ่าน
                                    </button>
                                )}
                                {u.blocked_at ? (
                                    <button onClick={() => act(`/api/admin/users/${u.id}/unblock`, 'POST', undefined, 'ปลดบล็อกแล้ว')} className={`${btn} bg-emerald-700 text-white`}>ปลดบล็อก</button>
                                ) : (
                                    <button onClick={() => blockUser(u.id)} className={`${btn} bg-rose-600 text-white`}>บล็อก</button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {tab === 'orders' && (
                <div className="space-y-2">
                    {orders.length === 0 && <p className="text-xs text-slate-500">ไม่มีรายการ</p>}
                    {orders.map((o) => (
                        <div key={o.id} className="bg-slate-950 border border-slate-800 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                            <div className="text-[11px] text-slate-300 min-w-0">
                                <p className="text-xs font-bold text-white">{o.tier} • {baht(o.amount_satang)} • {o.status}</p>
                                <p>{o.display_name ?? '@Anonymous'} • โทร {o.phone ?? '-'} • สร้าง {fmt(o.created_at)} • แนบสลิป {o.verify_attempts} ครั้ง</p>
                                {o.slip_ref && <p>Ref: {o.slip_ref} {o.slip_sender ? `• ผู้โอน ${o.slip_sender}` : ''}</p>}
                                {o.fail_reason && <p className="text-rose-300">{o.fail_reason}</p>}
                                {o.status === 'review' && <p className="text-sky-300 font-bold">⏳ ผู้ใช้แนบสลิปแล้ว รอตรวจ — ตรวจยอดเข้าบัญชีก่อนอนุมัติ</p>}
                                {o.slip_url && (
                                    <a href={o.slip_url} target="_blank" rel="noopener noreferrer" className="inline-block mt-1">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img src={o.slip_url} alt="สลิป" className="h-40 rounded-lg border border-slate-700" />
                                    </a>
                                )}
                            </div>
                            {(o.status === 'review' || o.status === 'pending') && (
                                <button
                                    onClick={() => {
                                        const note = window.prompt('เหตุผลที่ไม่อนุมัติ', 'ยอดเงิน/สลิปไม่ถูกต้อง');
                                        if (note !== null) act(`/api/admin/membership_orders/${o.id}/reject`, 'POST', { note }, 'ปฏิเสธรายการแล้ว');
                                    }}
                                    className={`${btn} bg-rose-600 text-white shrink-0`}
                                >
                                    ไม่อนุมัติ
                                </button>
                            )}
                            {o.status !== 'succeeded' && (
                                <button
                                    onClick={() => {
                                        const ref = window.prompt('ตรวจยอดเข้าบัญชีแล้ว? ใส่เลขอ้างอิงการโอน (ถ้ามี)');
                                        if (ref !== null) act(`/api/admin/membership_orders/${o.id}/approve`, 'POST', { ref }, 'อนุมัติและเปิดสิทธิ์แล้ว');
                                    }}
                                    className={`${btn} bg-emerald-600 text-white shrink-0`}
                                >
                                    อนุมัติเอง
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </section>
    );
}
