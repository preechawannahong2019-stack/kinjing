'use client';

import React, { useEffect, useState } from 'react';
import {
    api,
    baht,
    compressImage,
    type Membership,
    type StoreStatus,
    type TierInfo,
    type UserProfile,
} from '../lib/client';
import { TERMS } from '../lib/terms';
import StoreProfileForm from './StoreProfileForm';

interface Order {
    orderId: string;
    tier: TierInfo['id'];
    tierName: string;
    amountSatang: number;
    qrDataUrl: string;
    promptpayId: string | null;
}

type Step = 'choose' | 'details' | 'store' | 'pay' | 'done';

const RANK: Record<string, number> = { free: 0, member: 1, store: 2, store_vip: 3 };

const input =
    'w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500';

/** สมัครสมาชิก: เลือกระดับ → เบอร์โทร + ยอมรับเงื่อนไข (+ ยืนยันร้านค้า) → QR PromptPay → แนบสลิป */
export default function MembershipModal({
    open,
    onClose,
    tiers,
    membership,
    profile,
    store,
    onChanged,
    showToast,
}: {
    open: boolean;
    onClose: () => void;
    tiers: TierInfo[];
    membership: Membership;
    profile: UserProfile | null;
    store: StoreStatus | null;
    onChanged: () => Promise<void> | void;
    showToast: (m: string) => void;
}) {
    const [step, setStep] = useState<Step>('choose');
    const [tier, setTier] = useState<TierInfo | null>(null);
    const [phone, setPhone] = useState('');
    const [displayName, setDisplayName] = useState('');
    const [accept, setAccept] = useState(false);
    const [order, setOrder] = useState<Order | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [slipPreview, setSlipPreview] = useState<string | null>(null);

    useEffect(() => {
        if (open) {
            setStep('choose');
            setOrder(null);
            setError(null);
            setSlipPreview(null);
            setAccept(!!profile?.termsAccepted);
        }
    }, [open, profile?.termsAccepted]);

    if (!open) return null;

    const pick = (t: TierInfo) => {
        setTier(t);
        setError(null);
        setStep(t.isStore && (!store || store.status === 'rejected') ? 'store' : 'details');
    };

    const createOrder = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!tier) return;
        setError(null);
        setBusy(true);
        const r = await api<Order & { error?: string; needStore?: boolean }>(
            '/api/membership/checkout',
            {
                method: 'POST',
                body: JSON.stringify({
                    tier: tier.id,
                    phone,
                    displayName,
                    acceptTerms: accept,
                }),
            }
        );
        setBusy(false);
        if (!r.ok || !r.data) {
            setError(r.data?.error ?? 'สร้างรายการชำระเงินไม่สำเร็จ');
            if (r.data?.needStore) setStep('store');
            return;
        }
        setOrder(r.data);
        setStep('pay');
    };

    const onSlip = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (!f || !order) return;
        if (!f.type.startsWith('image/')) {
            setError('กรุณาเลือกรูปสลิป');
            return;
        }
        setError(null);
        setBusy(true);
        try {
            const small = await compressImage(f, 1600);
            setSlipPreview(URL.createObjectURL(small));
            const fd = new FormData();
            fd.append('orderId', order.orderId);
            fd.append('slip', small, small.name || 'slip.jpg');
            const res = await fetch('/api/membership/verify', {
                method: 'POST',
                body: fd,
                credentials: 'same-origin',
            });
            const data = await res.json().catch(() => null);
            if (!res.ok) {
                setError(data?.error ?? 'ตรวจสลิปไม่ผ่าน');
                return;
            }
            setStep('done');
            await onChanged();
            showToast(`ชำระเงินสำเร็จ! เปิดสิทธิ์ ${order.tierName} แล้ว`);
        } catch {
            setError('ส่งสลิปไม่สำเร็จ กรุณาลองใหม่');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-4">
            <div className="bg-slate-900 border-2 border-amber-500/50 rounded-2xl max-w-3xl w-full p-5 sm:p-6 space-y-5 shadow-2xl max-h-[92vh] overflow-y-auto">
                <div className="flex justify-between items-start border-b border-slate-800 pb-3 gap-3">
                    <div>
                        <h3 className="text-lg font-bold text-white">สมัครสมาชิก กินจริง</h3>
                        <p className="text-xs text-slate-400 mt-0.5">
                            จ่ายครั้งเดียว ผ่าน PromptPay QR • ยืนยันด้วยสลิปอัตโนมัติ
                        </p>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-white cursor-pointer text-lg p-1" aria-label="ปิด">
                        ✕
                    </button>
                </div>

                {profile?.blocked && (
                    <p className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-lg p-3">
                        บัญชีนี้ถูกระงับการใช้งาน{profile.blockedReason ? ` (${profile.blockedReason})` : ''}
                    </p>
                )}

                {step === 'choose' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                        <div className="rounded-2xl p-4 bg-slate-950 border border-slate-800 space-y-2">
                            <span className="text-[11px] font-black px-2.5 py-0.5 rounded-full bg-slate-700 text-slate-200">
                                ผู้ใช้งานทั่วไป
                            </span>
                            <div className="text-2xl font-black text-white">ฟรี</div>
                            <ul className="text-xs text-slate-300 space-y-1.5">
                                <li>✓ เห็นรีวิว (จำกัดจำนวน)</li>
                                <li>✓ โพสต์รีวิวได้</li>
                                <li className="text-slate-500">• เห็นแอดโฆษณา</li>
                            </ul>
                            {membership.tier === 'free' && (
                                <p className="text-[11px] text-slate-500 pt-1">สถานะปัจจุบันของคุณ</p>
                            )}
                        </div>
                        {tiers.map((t) => {
                            const owned = RANK[membership.tier] >= RANK[t.id];
                            return (
                                <div
                                    key={t.id}
                                    className={`rounded-2xl p-4 flex flex-col justify-between gap-3 ${
                                        t.id === 'store_vip'
                                            ? 'bg-gradient-to-b from-amber-950/40 to-slate-950 border-2 border-amber-500'
                                            : 'bg-slate-950 border border-slate-800'
                                    }`}
                                >
                                    <div className="space-y-2">
                                        <span className="text-[11px] font-black px-2.5 py-0.5 rounded-full bg-amber-400 text-slate-950">
                                            {t.name}
                                        </span>
                                        <div className="text-2xl font-black text-white">
                                            {baht(t.priceSatang)}
                                            <span className="text-xs font-normal text-slate-400"> /ครั้งเดียว</span>
                                        </div>
                                        <ul className="text-xs text-slate-300 space-y-1.5">
                                            {t.perks.map((p) => (
                                                <li key={p}>✓ {p}</li>
                                            ))}
                                        </ul>
                                    </div>
                                    <button
                                        onClick={() => pick(t)}
                                        disabled={owned || profile?.blocked}
                                        className="w-full bg-gradient-to-r from-amber-400 to-yellow-500 hover:from-amber-500 hover:to-yellow-600 disabled:opacity-40 text-slate-950 font-black py-2.5 rounded-xl text-xs cursor-pointer disabled:cursor-not-allowed"
                                    >
                                        {owned ? 'มีสิทธิ์แล้ว' : `สมัคร ${t.name}`}
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                )}

                {step === 'store' && tier && (
                    <div className="space-y-3 max-w-lg mx-auto">
                        <p className="text-sm font-bold text-white">ขั้นที่ 1: ยืนยันตัวตนร้านค้า ({tier.name})</p>
                        <StoreProfileForm
                            showToast={showToast}
                            onSubmitted={async () => {
                                await onChanged();
                                setStep('details');
                            }}
                        />
                        <button onClick={() => setStep('choose')} className="text-xs text-slate-400 hover:text-white cursor-pointer">
                            ← เลือกแพ็กเกจใหม่
                        </button>
                    </div>
                )}

                {step === 'details' && tier && (
                    <form onSubmit={createOrder} className="space-y-4 max-w-lg mx-auto">
                        <p className="text-sm font-bold text-white">
                            {tier.isStore ? 'ขั้นที่ 2: ' : ''}ข้อมูลสมาชิก — {tier.name} {baht(tier.priceSatang)}
                        </p>
                        {tier.isStore && store && (
                            <p className="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg p-2">
                                ร้าน “{store.store_name}” — สถานะ: {store.status === 'approved' ? 'ยืนยันแล้ว ✅' : 'รอแอดมินตรวจสอบ (ชำระเงินได้เลย จะลงประกาศขายได้เมื่ออนุมัติ)'}
                            </p>
                        )}
                        <div>
                            <label className="text-xs font-bold text-slate-300 block mb-1">
                                เบอร์โทรศัพท์มือถือจริง * {profile?.phoneMasked && <span className="text-slate-500 font-normal">(เดิม {profile.phoneMasked})</span>}
                            </label>
                            <input
                                className={input}
                                inputMode="tel"
                                placeholder="08x-xxx-xxxx"
                                value={phone}
                                onChange={(e) => setPhone(e.target.value)}
                                required
                                maxLength={12}
                            />
                            <p className="text-[10px] text-slate-500 mt-1">ใช้สำหรับให้แอดมินตรวจสอบย้อนหลัง ไม่แสดงต่อสาธารณะ</p>
                        </div>
                        <div>
                            <label className="text-xs font-bold text-slate-300 block mb-1">ชื่อที่แสดงในรีวิว (ไม่บังคับ)</label>
                            <input className={input} value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={50} placeholder={profile?.displayName ?? '@ชื่อของคุณ'} />
                        </div>
                        <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 max-h-44 overflow-y-auto">
                            <p className="text-xs font-bold text-white mb-1.5">เงื่อนไขการใช้งาน</p>
                            <ol className="list-decimal pl-4 space-y-1 text-[11px] text-slate-300">
                                {TERMS.map((t) => (
                                    <li key={t}>{t}</li>
                                ))}
                            </ol>
                        </div>
                        <label className="flex items-start gap-2 text-xs text-slate-200 cursor-pointer">
                            <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} className="mt-0.5" />
                            ข้าพเจ้าได้อ่านและยอมรับเงื่อนไขการใช้งานทั้งหมด
                        </label>
                        {error && <p className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-lg p-2">{error}</p>}
                        <div className="flex gap-2">
                            <button type="button" onClick={() => setStep('choose')} className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs py-2.5 rounded-xl cursor-pointer">
                                ย้อนกลับ
                            </button>
                            <button type="submit" disabled={busy || !accept} className="flex-1 bg-gradient-to-r from-amber-400 to-yellow-500 disabled:opacity-50 text-slate-950 font-black text-xs py-2.5 rounded-xl cursor-pointer">
                                {busy ? 'กำลังสร้าง QR...' : 'ไปหน้าชำระเงิน'}
                            </button>
                        </div>
                    </form>
                )}

                {step === 'pay' && order && (
                    <div className="max-w-sm mx-auto text-center space-y-3">
                        <p className="text-sm font-bold text-white">
                            ชำระ {order.tierName} {baht(order.amountSatang)}
                        </p>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={order.qrDataUrl} alt="PromptPay QR" className="mx-auto w-60 h-60 bg-white rounded-xl p-2" />
                        <p className="text-[11px] text-slate-400">
                            PromptPay {order.promptpayId} • ยอด {baht(order.amountSatang)} (ห้ามแก้ไขยอด)
                        </p>
                        <a href={order.qrDataUrl} download={`kinjing-${order.tier}.png`} className="inline-block text-[11px] text-sky-300 underline">
                            บันทึกรูป QR
                        </a>
                        <ol className="text-left text-[11px] text-slate-300 list-decimal pl-5 space-y-0.5 bg-slate-950/60 border border-slate-800 rounded-xl p-3">
                            <li>สแกน QR ด้วยแอปธนาคาร แล้วโอนตามยอด</li>
                            <li>บันทึกภาพสลิปการโอนเงิน</li>
                            <li>กดปุ่มด้านล่างเพื่อแนบสลิป ระบบจะตรวจและเปิดสิทธิ์ให้ทันที</li>
                        </ol>
                        <label className={`block w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-xl text-sm cursor-pointer ${busy ? 'opacity-50 pointer-events-none' : ''}`}>
                            {busy ? 'กำลังตรวจสลิป...' : '📎 แนบสลิปการโอนเงิน'}
                            <input type="file" accept="image/*" className="hidden" onChange={onSlip} disabled={busy} />
                        </label>
                        {slipPreview && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={slipPreview} alt="สลิป" className="mx-auto max-h-40 rounded-lg border border-slate-700" />
                        )}
                        {error && <p className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-lg p-2">{error}</p>}
                        <p className="text-[10px] text-slate-500">รูปสลิปใช้ตรวจสอบเท่านั้น ระบบไม่เก็บรูปไว้</p>
                    </div>
                )}

                {step === 'done' && order && (
                    <div className="text-center space-y-3 py-4">
                        <p className="text-4xl">✅</p>
                        <p className="text-sm font-bold text-emerald-300">ชำระเงินสำเร็จ เปิดสิทธิ์ {order.tierName} แล้ว</p>
                        {order.tier !== 'member' && (
                            <p className="text-xs text-slate-400">
                                เมื่อแอดมินยืนยันร้านค้าแล้ว คุณจะลงประกาศขายได้ที่เมนู “ร้านค้าของฉัน”
                            </p>
                        )}
                        <button onClick={onClose} className="bg-slate-700 hover:bg-slate-600 text-white font-bold px-6 py-2.5 rounded-xl text-xs cursor-pointer">
                            ปิด
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
