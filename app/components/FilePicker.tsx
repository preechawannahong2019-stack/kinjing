'use client';

import React from 'react';

/** ปุ่มเลือกไฟล์แบบไอคอนสีเหลือง (แทนปุ่ม Choose File ของเบราว์เซอร์) */
export default function FilePicker({
    label,
    accept,
    multiple,
    disabled,
    busy,
    onChange,
    hint,
    full,
}: {
    label: string;
    accept: string;
    multiple?: boolean;
    disabled?: boolean;
    busy?: boolean;
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    hint?: string;
    full?: boolean;
}) {
    const off = disabled || busy;
    return (
        <div className="space-y-1">
            <label
                className={`${full ? 'flex w-full' : 'inline-flex'} items-center justify-center gap-2 bg-gradient-to-r from-amber-400 to-yellow-500 hover:from-amber-500 hover:to-yellow-600 text-slate-950 font-black text-sm px-5 py-3 rounded-xl shadow-lg shadow-amber-500/20 transition cursor-pointer ${
                    off ? 'opacity-50 pointer-events-none' : ''
                }`}
            >
                <svg viewBox="0 0 24 24" className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
                    <circle cx="12" cy="13" r="3.5" />
                </svg>
                <span>{busy ? 'กำลังอัปโหลดและตรวจสอบ...' : label}</span>
                <input type="file" accept={accept} multiple={multiple} disabled={off} onChange={onChange} className="hidden" />
            </label>
            {hint && <p className="text-[10px] text-slate-500">{hint}</p>}
        </div>
    );
}
