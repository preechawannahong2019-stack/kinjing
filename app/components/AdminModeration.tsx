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
    membership_tier: string | null;
    activated_at: string | null;
}
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
    const [tab, setTab] = useState<Tab>('stores');
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
            const r = await api<{ users: AdminUser[] }>(`/api/admin/users?q=${encodeURIComponent(q)}`);
            if (r.data) setUsers(r.data.users);
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
        users: [],
        orders: ['pending', 'succeeded', 'expired', 'all'],
    };

    return (
        <section className="bg-slate-900 border-2 border-violet-500/40 rounded-2xl p-4 space-y-3">
            <div className="flex flex-wrap gap-2 items-center justify-between">
                <h2 className="text-xs font-black uppercase text-violet-300">🛡️ ตรวจสอบ & ความปลอดภัย</h2>
                <div className="flex flex-wrap gap-1.5">
                    {([
                        ['stores', 'ยืนยันร้านค้า'],
                        ['reports', 'รายงานการละเมิด'],
                        ['users', 'สมาชิก/บล็อก'],
                        ['orders', 'รายการชำระเงิน'],
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
                        {f === 'pending' ? (tab === 'reports' ? 'open' : 'pending') : f}
                    </button>
                ))}
                {tab === 'users' && (
                    <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาด้วยเบอร์โทร (เว้นว่าง = สมาชิก/ผู้ถูกบล็อก)" className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white w-72" />
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
                    {users.length === 0 && <p className="text-xs text-slate-500">ไม่พบผู้ใช้</p>}
                    {users.map((u) => (
                        <div key={u.id} className="bg-slate-950 border border-slate-800 rounded-xl p-3 flex items-center justify-between gap-2">
                            <div className="text-[11px] text-slate-300 min-w-0">
                                <p className="text-xs font-bold text-white">{u.display_name ?? '@Anonymous'} • {u.phone ?? 'ไม่มีเบอร์'}</p>
                                <p>สมาชิก: {u.membership_tier ?? '-'} {u.activated_at ? `(ตั้งแต่ ${fmt(u.activated_at)})` : ''}</p>
                                {u.blocked_at && <p className="text-rose-300">ถูกบล็อก {fmt(u.blocked_at)} — {u.blocked_reason}</p>}
                                <p className="text-slate-600 font-mono text-[10px]">{u.id}</p>
                            </div>
                            {u.blocked_at ? (
                                <button onClick={() => act(`/api/admin/users/${u.id}/unblock`, 'POST', undefined, 'ปลดบล็อกแล้ว')} className={`${btn} bg-emerald-700 text-white`}>ปลดบล็อก</button>
                            ) : (
                                <button onClick={() => blockUser(u.id)} className={`${btn} bg-rose-600 text-white`}>บล็อก</button>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {tab === 'orders' && (
                <div className="space-y-2">
                    {orders.length === 0 && <p className="text-xs text-slate-500">ไม่มีรายการ</p>}
                    {orders.map((o) => (
                        <div key={o.id} className="bg-slate-950 border border-slate-800 rounded-xl p-3 flex items-center justify-between gap-2">
                            <div className="text-[11px] text-slate-300 min-w-0">
                                <p className="text-xs font-bold text-white">{o.tier} • {baht(o.amount_satang)} • {o.status}</p>
                                <p>โทร {o.phone ?? '-'} • สร้าง {fmt(o.created_at)} • แนบสลิป {o.verify_attempts} ครั้ง</p>
                                {o.slip_ref && <p>Ref: {o.slip_ref} {o.slip_sender ? `• ผู้โอน ${o.slip_sender}` : ''}</p>}
                            </div>
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
