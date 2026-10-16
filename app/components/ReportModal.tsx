'use client';

import React, { useState } from 'react';
import { api } from '../lib/client';

export interface ReportTarget {
    type: 'review' | 'listing';
    id: string;
    title: string;
}

const REASONS = [
    'ภาพลามก/อนาจาร',
    'ยาเสพติด',
    'การพนัน',
    'ความรุนแรง/อาชญากรรม',
    'สแปม/หลอกลวง',
    'ไม่เกี่ยวกับอาหาร',
];

/** แจ้งเนื้อหาละเมิดกฎหมาย/เงื่อนไข → ส่งให้แอดมินพิจารณาลบ/บล็อก */
export default function ReportModal({
    target,
    onClose,
    showToast,
}: {
    target: ReportTarget | null;
    onClose: () => void;
    showToast: (m: string) => void;
}) {
    const [reason, setReason] = useState(REASONS[0]);
    const [detail, setDetail] = useState('');
    const [busy, setBusy] = useState(false);
    if (!target) return null;

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        const r = await api<{ error?: string }>('/api/reports', {
            method: 'POST',
            body: JSON.stringify({
                targetType: target.type,
                targetId: target.id,
                reason: detail.trim() ? `${reason}: ${detail.trim()}` : reason,
            }),
        });
        setBusy(false);
        if (!r.ok) {
            showToast(r.data?.error ?? 'ส่งรายงานไม่สำเร็จ');
            return;
        }
        showToast('ส่งรายงานให้แอดมินแล้ว ขอบคุณครับ');
        setDetail('');
        onClose();
    };

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
            <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="bg-slate-900 border border-rose-500/40 rounded-2xl max-w-sm w-full p-5 space-y-3 shadow-2xl">
                <h3 className="text-base font-bold text-white">🚩 แจ้งเนื้อหาไม่เหมาะสม</h3>
                <p className="text-xs text-slate-400 truncate">{target.title}</p>
                <select value={reason} onChange={(e) => setReason(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white">
                    {REASONS.map((r) => (
                        <option key={r}>{r}</option>
                    ))}
                </select>
                <textarea rows={2} value={detail} onChange={(e) => setDetail(e.target.value)} maxLength={250} placeholder="รายละเอียดเพิ่มเติม (ไม่บังคับ)" className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white" />
                <div className="flex gap-2">
                    <button type="button" onClick={onClose} className="flex-1 bg-slate-800 text-slate-300 text-xs font-bold py-2.5 rounded-xl cursor-pointer">ยกเลิก</button>
                    <button type="submit" disabled={busy} className="flex-1 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-xs font-bold py-2.5 rounded-xl cursor-pointer">ส่งรายงาน</button>
                </div>
            </form>
        </div>
    );
}
