'use client';

import React, { useState } from 'react';
import { api, type Membership, type UserProfile } from '../lib/client';

const input =
    'w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500';

function Shell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-slate-900 border border-amber-500/40 rounded-2xl max-w-sm w-full p-5 space-y-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <div className="flex justify-between items-center">
                    <h3 className="text-base font-bold text-white">{title}</h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-white cursor-pointer text-lg p-1" aria-label="ปิด">✕</button>
                </div>
                {children}
            </div>
        </div>
    );
}

/** เข้าสู่ระบบสมาชิก (ทุกระดับ) ด้วยเบอร์โทร + รหัสผ่าน */
export function LoginModal({
    open,
    onClose,
    onDone,
    onRegister,
}: {
    open: boolean;
    onClose: () => void;
    onDone: () => Promise<void> | void;
    onRegister: () => void;
}) {
    const [phone, setPhone] = useState('');
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    if (!open) return null;

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const r = await api<{ error?: string }>('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ phone, password }),
        });
        setBusy(false);
        if (!r.ok) {
            setError(r.data?.error ?? 'เข้าสู่ระบบไม่สำเร็จ');
            return;
        }
        setPassword('');
        await onDone();
        onClose();
    };

    return (
        <Shell title="🔑 เข้าสู่ระบบสมาชิก" onClose={onClose}>
            <form onSubmit={submit} className="space-y-3">
                <p className="text-[11px] text-slate-400">
                    สำหรับสมาชิกทุกระดับ (ระดับต้น / ร้านค้า / ร้านค้า VIP) — ใช้เบอร์มือถือและรหัสผ่านที่ตั้งตอนสมัคร
                </p>
                <input className={input} inputMode="tel" placeholder="เบอร์มือถือ 08x-xxx-xxxx" value={phone} onChange={(e) => setPhone(e.target.value)} required maxLength={12} autoComplete="username" />
                <input className={input} type="password" placeholder="รหัสผ่าน" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
                {error && <p className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-lg p-2">{error}</p>}
                <button type="submit" disabled={busy} className="w-full bg-gradient-to-r from-amber-400 to-yellow-500 disabled:opacity-50 text-slate-950 font-black py-2.5 rounded-xl text-sm cursor-pointer">
                    {busy ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}
                </button>
                <p className="text-[11px] text-slate-500 text-center">
                    ลืมรหัสผ่าน? ติดต่อแอดมินเพื่อรีเซ็ต •{' '}
                    <button type="button" onClick={onRegister} className="text-amber-300 underline cursor-pointer">
                        สมัครสมาชิกใหม่
                    </button>
                </p>
            </form>
        </Shell>
    );
}

/** บัญชีของฉัน: ระดับสมาชิก, ตั้ง/เปลี่ยนรหัสผ่าน, ออกจากระบบ */
export function AccountModal({
    open,
    onClose,
    membership,
    profile,
    onLoggedOut,
    showToast,
    onUpgrade,
}: {
    open: boolean;
    onClose: () => void;
    membership: Membership;
    profile: UserProfile | null;
    onLoggedOut: () => Promise<void> | void;
    showToast: (m: string) => void;
    onUpgrade: () => void;
}) {
    const [cur, setCur] = useState('');
    const [pw, setPw] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    if (!open) return null;

    const savePw = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const r = await api<{ error?: string }>('/api/me/password', {
            method: 'POST',
            body: JSON.stringify({ currentPassword: cur, newPassword: pw }),
        });
        setBusy(false);
        if (!r.ok) {
            setError(r.data?.error ?? 'บันทึกไม่สำเร็จ');
            return;
        }
        setCur('');
        setPw('');
        showToast('บันทึกรหัสผ่านแล้ว');
        onClose();
    };

    const logout = async () => {
        if (!profile?.hasPassword && !window.confirm('บัญชีนี้ยังไม่ได้ตั้งรหัสผ่าน หากออกจากระบบจะเข้ากลับมาไม่ได้ ต้องการออกจากระบบหรือไม่?')) return;
        await api('/api/auth/logout', { method: 'POST' });
        await onLoggedOut();
        onClose();
        showToast('ออกจากระบบแล้ว');
    };

    return (
        <Shell title="👤 บัญชีของฉัน" onClose={onClose}>
            <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3 text-xs text-slate-300 space-y-1">
                <p>ระดับ: <b className="text-amber-300">{membership.tierName}</b></p>
                {profile?.displayName && <p>ชื่อที่แสดง: {profile.displayName}</p>}
                <p>เบอร์โทร: {profile?.phoneMasked ?? '-'}</p>
                {membership.isStore && <p>ลงประกาศขายได้: {membership.menuLimit} เมนู</p>}
            </div>
            {membership.tier !== 'store_vip' && (
                <button onClick={onUpgrade} className="w-full bg-gradient-to-r from-amber-400 to-yellow-500 text-slate-950 font-black py-2 rounded-xl text-xs cursor-pointer">
                    {membership.isVip ? 'อัปเกรดระดับสมาชิก' : 'สมัครสมาชิก'}
                </button>
            )}
            {profile?.hasPhone && (
                <form onSubmit={savePw} className="space-y-2">
                    <p className="text-xs font-bold text-white">{profile.hasPassword ? 'เปลี่ยนรหัสผ่าน' : '⚠️ ตั้งรหัสผ่าน (ใช้เข้าสู่ระบบจากเครื่องอื่น)'}</p>
                    {profile.hasPassword && (
                        <input className={input} type="password" placeholder="รหัสผ่านเดิม" value={cur} onChange={(e) => setCur(e.target.value)} required autoComplete="current-password" />
                    )}
                    <input className={input} type="password" placeholder="รหัสผ่านใหม่ (อย่างน้อย 6 ตัว)" value={pw} onChange={(e) => setPw(e.target.value)} required minLength={6} autoComplete="new-password" />
                    {error && <p className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-lg p-2">{error}</p>}
                    <button type="submit" disabled={busy} className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold py-2 rounded-xl text-xs cursor-pointer">
                        บันทึกรหัสผ่าน
                    </button>
                </form>
            )}
            <button onClick={logout} className="w-full bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-2 rounded-xl text-xs cursor-pointer">
                🚪 ออกจากระบบ
            </button>
        </Shell>
    );
}
