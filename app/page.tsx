'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';

// ==================== Types ====================
interface Plan {
    id: string;
    name: string;
    price_satang: number;
    interval_days: number;
    perks: string[];
}

interface Membership {
    isVip: boolean;
    planId: string | null;
    periodEnd: string | null;
}

interface MeResponse {
    membership: Membership;
    plans: Plan[];
    isAdmin: boolean;
}

interface Sponsorship {
    id: string;
    brand_name: string;
    headline: string;
    sub_text: string | null;
    cta_text: string;
    badge_text: string;
    target_url: string;
    restaurant_name: string | null;
}

interface Checkout {
    paymentId: string;
    planId: string;
    amountSatang: number;
    qrImageUrl: string | null;
    expiresAt: string | null;
}

interface MediaItem {
    type: 'image' | 'video';
    url: string;
}

interface Review {
    id: string;
    name: string;
    category: string;
    rating: number;
    must_try: string;
    tags: string[];
    media_items: MediaItem[] | string | null;
    reviewer_name: string;
    view_count: number;
    created_at: string;
}

interface ReviewEditRequest {
    id: string;
    restaurant_id: string;
    requester_id: string | null;
    requester_name: string;
    reason: string;
    proposed_changes: {
        name?: string;
        category?: string;
        mustTry?: string;
        mediaItems?: MediaItem[];
    } | null;
    status: 'pending' | 'approved' | 'rejected' | 'done';
    admin_note: string | null;
    reviewed_by: string | null;
    reviewed_at: string | null;
    created_at: string;
    restaurant_name?: string;
    restaurant_must_try?: string;
    restaurant_category?: string;
    restaurant_reviewer_name?: string;
}

interface AdminReviewRequest {
    id: string;
    restaurant_id: string;
    requester_name: string;
    reason: string;
    proposed_changes: Record<string, unknown> | null;
    status: 'pending' | 'approved' | 'rejected' | 'done';
    admin_note: string | null;
    created_at: string;
    restaurant_name: string;
    restaurant_must_try: string;
    restaurant_category: string;
    restaurant_reviewer_name: string;
}

interface AdminReviewRequestsResponse {
    requests: AdminReviewRequest[];
    counts: {
        pending: number;
        approved: number;
        rejected: number;
        done: number;
    };
}

interface Payout {
    id: string;
    view_count: number;
    amount_satang: number;
    status: 'pending' | 'paid' | 'void';
    paid_at: string | null;
    period_start: string;
    period_end: string;
}

interface AdminSponsorship {
    id: string;
    brand_name: string;
    headline: string;
    sub_text?: string | null;
    cta_text?: string;
    target_url?: string;
    status: 'pending' | 'active' | 'paused' | 'expired';
    monthly_fee_satang: number;
    starts_at: string;
    ends_at: string;
    restaurant_name: string | null;
    invoice_id: string | null;
    invoice_status: 'issued' | 'paid' | 'overdue' | 'void' | null;
    invoice_amount: number | null;
    invoice_period_start: string | null;
}

interface TopReview {
    id: string;
    name: string;
    reviewer_name: string;
    reviewer_id: string | null;
    view_count: number;
    total_payout_satang: number;
}

interface AuditLog {
    id: number;
    created_at: string;
    actor: string | null;
    action: string;
    detail: Record<string, unknown> | null;
    ip_hash: string | null;
}

interface AdminSummary {
    revenue: {
        subscriptionsSatang: number;
        sponsorshipInvoicesSatang: number;
        totalSatang: number;
        payoutsPaidSatang: number;
    };
    activeSubscribers: number;
    sponsorships: AdminSponsorship[];
    topReviews: TopReview[];
    logs: AuditLog[];
}

// ==================== Helpers ====================
const baht = (satang: number) =>
    `฿${(satang / 100).toLocaleString('th-TH', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })}`;

const fmtDate = (s: string | null) =>
    s
        ? new Date(s).toLocaleDateString('th-TH', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
          })
        : '-';

const fmtDateTime = (s: string) =>
    new Date(s).toLocaleString('th-TH', {
        dateStyle: 'short',
        timeStyle: 'medium',
    });

const DEFAULT_START_DATE = '2026-01-01';
const DEFAULT_END_DATE = '2026-01-31';

async function api<T>(
    path: string,
    init?: RequestInit
): Promise<{ ok: boolean; status: number; data: T | null }> {
    try {
        const res = await fetch(path, {
            credentials: 'same-origin',
            cache: 'no-store',
            ...init,
            headers: {
                'Content-Type': 'application/json',
                ...(init?.headers || {}),
            },
        });
        const data = (await res.json().catch(() => null)) as T | null;
        return { ok: res.ok, status: res.status, data };
    } catch {
        return { ok: false, status: 0, data: null };
    }
}

function parseMediaItems(raw: MediaItem[] | string | null): MediaItem[] {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string') {
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) return parsed;
        } catch {
            /* ignore */
        }
    }
    return [];
}

const SPONSOR_STATUS: Record<string, { label: string; cls: string }> = {
    pending: { label: 'รอชำระ', cls: 'bg-slate-700 text-slate-200' },
    active: { label: 'ใช้งาน', cls: 'bg-emerald-500/20 text-emerald-300' },
    paused: { label: 'พักชั่วคราว', cls: 'bg-amber-500/20 text-amber-300' },
    expired: { label: 'สิ้นสุด', cls: 'bg-rose-500/20 text-rose-300' },
};

const INVOICE_STATUS: Record<string, string> = {
    issued: 'รอชำระ',
    paid: 'ชำระแล้ว',
    overdue: 'เกินกำหนด',
    void: 'ยกเลิก',
};

const PAYOUT_STATUS: Record<string, string> = {
    pending: 'รอโอน',
    paid: 'โอนแล้ว',
    void: 'ยกเลิก',
};

const MAX_MEDIA_ITEMS = 10;

// ==================== Main Component ====================
export default function Home() {
    // --- user/membership ---
    const [ready, setReady] = useState(false);
    const [membership, setMembership] = useState<Membership>({
        isVip: false,
        planId: null,
        periodEnd: null,
    });
    const [plans, setPlans] = useState<Plan[]>([]);
    const [isAdmin, setIsAdmin] = useState(false);
    const [toast, setToast] = useState<string | null>(null);
    const [myPayouts, setMyPayouts] = useState<Payout[]>([]);
    const [payoutTotals, setPayoutTotals] = useState({
        paid: 0,
        pending: 0,
    });

    // --- VIP ---
    const [showVipModal, setShowVipModal] = useState(false);
    const [checkout, setCheckout] = useState<Checkout | null>(null);
    const [checkoutState, setCheckoutState] = useState<
        'waiting' | 'succeeded' | 'failed'
    >('waiting');
    const [creatingCheckout, setCreatingCheckout] = useState(false);

    // --- Sponsorship ---
    const [sponsorship, setSponsorship] = useState<Sponsorship | null>(null);

    // --- Reviews ---
    const [reviews, setReviews] = useState<Review[]>([]);
    const [reviewsLoading, setReviewsLoading] = useState(false);
    const [lightboxIndex, setLightboxIndex] = useState<{
        items: MediaItem[];
        index: number;
    } | null>(null);
    const [showAddForm, setShowAddForm] = useState(false);
    const [newName, setNewName] = useState('');
    const [newCategory, setNewCategory] = useState('สตรีทฟู้ดร้านลับ');
    const [newMustTry, setNewMustTry] = useState('');
    const [newMedia, setNewMedia] = useState<MediaItem[]>([]);
    const [uploading, setUploading] = useState(false);
    const [activeTab, setActiveTab] = useState('ทั้งหมด');
    const [searchQuery, setSearchQuery] = useState('');

    // --- Admin ---
    const [showLogin, setShowLogin] = useState(false);
    const [password, setPassword] = useState('');
    const [summary, setSummary] = useState<AdminSummary | null>(null);
    const [showLogs, setShowLogs] = useState(false);
    const [showSponsorManager, setShowSponsorManager] = useState(false);
    const [showPayoutManager, setShowPayoutManager] = useState(false);

    // --- Edit Sponsorship ---
    const [editingSponsorship, setEditingSponsorship] =
        useState<AdminSponsorship | null>(null);
    const [editForm, setEditForm] = useState({
        brandName: '',
        headline: '',
        subText: '',
        ctaText: 'ดูโปรโมชัน →',
        targetUrl: 'https://',
        monthlyFeeBaht: '5000',
        startsAt: '',
        endsAt: '',
    });

    // --- Edit Review ---
    const [editingReview, setEditingReview] = useState<Review | null>(null);
    const [editReviewForm, setEditReviewForm] = useState({
        name: '',
        category: 'สตรีทฟู้ดร้านลับ',
        mustTry: '',
        mediaItems: [] as MediaItem[],
    });

    // --- Request Edit Modal ---
    const [showRequestModal, setShowRequestModal] = useState<Review | null>(
        null
    );
    const [requestReason, setRequestReason] = useState('');
    const [requestProposed, setRequestProposed] = useState({
        name: '',
        category: '',
        mustTry: '',
    });

    // --- Admin: Review Requests ---
    const [showReviewRequests, setShowReviewRequests] = useState(false);
    const [reviewRequests, setReviewRequests] = useState<AdminReviewRequest[]>(
        []
    );
    const [reviewRequestCounts, setReviewRequestCounts] = useState({
        pending: 0,
        approved: 0,
        rejected: 0,
        done: 0,
    });
    const [reviewRequestsFilter, setReviewRequestsFilter] = useState<
        'pending' | 'approved' | 'rejected' | 'done' | 'all'
    >('pending');
    const [expandedRequest, setExpandedRequest] = useState<string | null>(null);
    const [adminNote, setAdminNote] = useState('');

    // --- Forms ---
    const [form, setForm] = useState({
        brandName: '',
        headline: '',
        subText: '',
        ctaText: 'ดูโปรโมชัน →',
        targetUrl: 'https://',
        monthlyFeeBaht: '5000',
        startsAt: DEFAULT_START_DATE,
        endsAt: DEFAULT_END_DATE,
        restaurantId: '',
    });
    const [payoutForm, setPayoutForm] = useState({
        periodStart: '2026-01-01',
        periodEnd: '2026-01-31',
        sharePercent: '30',
    });

    const showToast = useCallback((msg: string) => {
        setToast(msg);
        setTimeout(() => setToast(null), 4000);
    }, []);

// ### ⬇️⬇️⬇️  ⬇️⬇️⬇️
    // ==================== Refresh Functions ====================
    const refreshMe = useCallback(async () => {
        const r = await api<MeResponse>('/api/me');
        if (r.ok && r.data) {
            setMembership(r.data.membership);
            setPlans(r.data.plans);
            setIsAdmin(r.data.isAdmin);
        }
    }, []);

    const refreshPayouts = useCallback(async () => {
        const r = await api<{
            payouts: Payout[];
            totalPaidSatang: number;
            totalPendingSatang: number;
        }>('/api/me/payouts');
        if (r.ok && r.data) {
            setMyPayouts(r.data.payouts);
            setPayoutTotals({
                paid: r.data.totalPaidSatang,
                pending: r.data.totalPendingSatang,
            });
        }
    }, []);

    const refreshReviews = useCallback(async () => {
        setReviewsLoading(true);
        const r = await api<{ reviews: Review[] }>('/api/reviews?limit=30');
        if (r.ok && r.data) setReviews(r.data.reviews);
        setReviewsLoading(false);
    }, []);

    const refreshSponsorship = useCallback(async () => {
        const r = await api<{ sponsorship: Sponsorship | null }>(
            '/api/sponsorships/active'
        );
        setSponsorship(r.data?.sponsorship ?? null);
    }, []);

    // ==================== Effects ====================
    // Load initial data on mount
    useEffect(() => {
        (async () => {
            await api('/api/auth/guest', { method: 'POST' });
            await Promise.all([refreshMe(), refreshReviews()]);
            setReady(true);
        })();
    }, [refreshMe, refreshReviews]);

    // Set current dates after mount
    useEffect(() => {
        const today = new Date().toISOString().slice(0, 10);
        const end = new Date(Date.now() + 30 * 86400000)
            .toISOString()
            .slice(0, 10);
        setForm((f) => ({ ...f, startsAt: today, endsAt: end }));
        setPayoutForm((p) => ({
            ...p,
            periodStart: today.slice(0, 8) + '01',
            periodEnd: today,
        }));
    }, []);

    // Refresh sponsorship when membership changes
    useEffect(() => {
        if (!ready) return;
        refreshSponsorship();
    }, [ready, membership.isVip, refreshSponsorship]);

    // Refresh payouts when ready
    useEffect(() => {
        if (!ready) return;
        refreshPayouts();
    }, [ready, refreshPayouts]);

    // ESC/Arrow keys for lightbox
    useEffect(() => {
        if (!lightboxIndex) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setLightboxIndex(null);
            if (e.key === 'ArrowLeft' && lightboxIndex) {
                setLightboxIndex({
                    items: lightboxIndex.items,
                    index:
                        (lightboxIndex.index -
                            1 +
                            lightboxIndex.items.length) %
                        lightboxIndex.items.length,
                });
            }
            if (e.key === 'ArrowRight' && lightboxIndex) {
                setLightboxIndex({
                    items: lightboxIndex.items,
                    index:
                        (lightboxIndex.index + 1) %
                        lightboxIndex.items.length,
                });
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [lightboxIndex]);

    // ==================== Tracking ====================
    const trackView = useCallback(async (reviewId: string) => {
        const r = await api<{ counted: number; viewCount: number }>(
            `/api/reviews/${reviewId}/view`,
            { method: 'POST' }
        );
        if (r.ok && r.data) {
            setReviews((prev) =>
                prev.map((x) =>
                    x.id === reviewId
                        ? { ...x, view_count: r.data!.viewCount }
                        : x
                )
            );
        }
    }, []);

    // ==================== Payment Polling ====================
    const paymentId = checkout?.paymentId;
    useEffect(() => {
        if (!paymentId) return;
        let stopped = false;
        const startedAt = Date.now();
        const timer = setInterval(async () => {
            if (stopped) return;
            if (Date.now() - startedAt > 15 * 60_000) {
                clearInterval(timer);
                return;
            }
            const r = await api<{ status: string }>(
                `/api/subscriptions/status?paymentId=${paymentId}`
            );
            if (stopped || !r.ok || !r.data) return;
            if (r.data.status === 'succeeded') {
                clearInterval(timer);
                setCheckoutState('succeeded');
                await refreshMe();
                showToast('ชำระเงินสำเร็จ! เปิดสิทธิ์ VIP เรียบร้อยแล้ว');
            } else if (r.data.status === 'failed') {
                clearInterval(timer);
                setCheckoutState('failed');
            }
        }, 3000);
        return () => {
            stopped = true;
            clearInterval(timer);
        };
    }, [paymentId, refreshMe, showToast]);

    const closeCheckout = () => setCheckout(null);

    // ==================== Checkout ====================
    const startCheckout = async (planId: string) => {
        setCreatingCheckout(true);
        const r = await api<Checkout>('/api/subscriptions', {
            method: 'POST',
            body: JSON.stringify({ planId }),
        });
        setCreatingCheckout(false);
        if (!r.ok || !r.data) {
            showToast('สร้างรายการชำระเงินไม่สำเร็จ');
            return;
        }
        setCheckout(r.data);
        setCheckoutState('waiting');
    };

    // ==================== Admin Actions ====================
    const loadSummary = useCallback(async () => {
        const r = await api<AdminSummary>('/api/admin/summary');
        if (r.ok && r.data) setSummary(r.data);
        else if (r.status === 403) {
            setIsAdmin(false);
            setSummary(null);
        }
    }, []);

    useEffect(() => {
        if (isAdmin) loadSummary();
    }, [isAdmin, loadSummary]);

    const handleAdminLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        const r = await api('/api/admin/login', {
            method: 'POST',
            body: JSON.stringify({ password }),
        });
        setPassword('');
        if (r.ok) {
            setIsAdmin(true);
            setShowLogin(false);
            showToast('เข้าสู่ระบบสำเร็จ');
        } else if (r.status === 429) {
            showToast('ลองหลายครั้งเกินไป กรุณารอสักครู่');
        } else {
            showToast('รหัสผ่านไม่ถูกต้อง');
        }
    };

    const handleAdminLogout = async () => {
        await api('/api/admin/logout', { method: 'POST' });
        setIsAdmin(false);
        setSummary(null);
        setShowLogs(false);
        setShowSponsorManager(false);
        setShowPayoutManager(false);
        setShowReviewRequests(false);
        showToast('ออกจากระบบแล้ว');
    };

    const adminAction = async (
        path: string,
        method: string,
        body?: unknown
    ) => {
        const r = await api<{ error?: string }>(path, {
            method,
            body: body ? JSON.stringify(body) : undefined,
        });
        if (!r.ok) showToast(`❌ ${r.data?.error ?? 'ดำเนินการไม่สำเร็จ'}`);
        else await loadSummary();
        return r.ok;
    };

    // ==================== Sponsorship CRUD ====================
    const handleCreateSponsorship = async (e: React.FormEvent) => {
        e.preventDefault();
        const ok = await adminAction('/api/admin/sponsorships', 'POST', form);
        if (ok) {
            showToast('สร้างสปอนเซอร์และใบแจ้งหนี้งวดแรกแล้ว');
            setForm({
                ...form,
                brandName: '',
                headline: '',
                subText: '',
                restaurantId: '',
            });
        }
    };

    const openEditSponsorship = (c: AdminSponsorship) => {
        setEditingSponsorship(c);
        setEditForm({
            brandName: c.brand_name,
            headline: c.headline,
            subText: c.sub_text ?? '',
            ctaText: c.cta_text ?? 'ดูโปรโมชัน →',
            targetUrl: c.target_url ?? 'https://',
            monthlyFeeBaht: String(Math.round(c.monthly_fee_satang / 100)),
            startsAt: c.starts_at.slice(0, 10),
            endsAt: c.ends_at.slice(0, 10),
        });
    };

    const handleUpdateSponsorship = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editingSponsorship) return;
        const ok = await adminAction(
            `/api/admin/sponsorships/${editingSponsorship.id}`,
            'PATCH',
            editForm
        );
        if (ok) {
            showToast('อัปเดตสปอนเซอร์แล้ว');
            setEditingSponsorship(null);
        }
    };

    const markSponsorshipInvoicePaid = async (invoiceId: string) => {
        const ref =
            window.prompt('เลขอ้างอิงการโอน/หมายเหตุ (เว้นว่างได้)') ?? null;
        if (ref === null) return;
        if (
            await adminAction(
                `/api/admin/sponsorship_invoices/${invoiceId}/paid`,
                'POST',
                { ref }
            )
        ) {
            showToast('บันทึกการชำระเงินแล้ว');
        }
    };

    // ==================== Payout ====================
    const runPayout = async (e: React.FormEvent) => {
        e.preventDefault();
        const ok = await adminAction('/api/admin/run_payout', 'POST', {
            periodStart: payoutForm.periodStart,
            periodEnd: payoutForm.periodEnd,
            sharePercent: Number(payoutForm.sharePercent),
        });
        if (ok) showToast('คำนวณและสร้างรายการจ่ายรางวัลแล้ว');
    };

    // ==================== Edit Review ====================
    const openEditReview = (r: Review) => {
        setEditingReview(r);
        setEditReviewForm({
            name: r.name,
            category: r.category,
            mustTry: r.must_try,
            mediaItems: parseMediaItems(r.media_items),
        });
    };

    const handleUpdateReview = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editingReview) return;
        const r = await api<{ error?: string }>(
            `/api/reviews/${editingReview.id}`,
            {
                method: 'PATCH',
                body: JSON.stringify({
                    name: editReviewForm.name,
                    category: editReviewForm.category,
                    mustTry: editReviewForm.mustTry,
                    mediaItems: editReviewForm.mediaItems,
                }),
            }
        );
        if (!r.ok) {
            showToast(`❌ ${r.data?.error ?? 'แก้ไขไม่สำเร็จ'}`);
            return;
        }
        showToast('✓ แก้ไขรีวิวสำเร็จ');
        setEditingReview(null);
        await refreshReviews();
    };

    const handleEditReviewMedia = (
        e: React.ChangeEvent<HTMLInputElement>
    ) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;
        const remaining = MAX_MEDIA_ITEMS - editReviewForm.mediaItems.length;
        if (remaining <= 0) {
            showToast(`เพิ่มได้สูงสุด ${MAX_MEDIA_ITEMS} ไฟล์`);
            return;
        }
        const toAdd = Array.from(files).slice(0, remaining);
        const newItems: MediaItem[] = toAdd.map((file) => ({
            type: file.type.startsWith('video/') ? 'video' : 'image',
            url: URL.createObjectURL(file),
        }));
        setEditReviewForm((f) => ({
            ...f,
            mediaItems: [...f.mediaItems, ...newItems],
        }));
        e.target.value = '';
    };

    const removeEditMedia = (index: number) => {
        setEditReviewForm((f) => ({
            ...f,
            mediaItems: f.mediaItems.filter((_, i) => i !== index),
        }));
    };

    // ==================== Request Edit ====================
    const openRequestModal = (r: Review) => {
        setShowRequestModal(r);
        setRequestReason('');
        setRequestProposed({
            name: r.name,
            category: r.category,
            mustTry: r.must_try,
        });
    };

    const handleSubmitRequest = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!showRequestModal) return;
        if (requestReason.trim().length < 5) {
            showToast('กรุณาระบุเหตุผล (อย่างน้อย 5 ตัวอักษร)');
            return;
        }
        const r = await api<{ error?: string }>(
            `/api/reviews/${showRequestModal.id}/edit_request`,
            {
                method: 'POST',
                body: JSON.stringify({
                    reason: requestReason,
                    name: requestProposed.name,
                    category: requestProposed.category,
                    mustTry: requestProposed.mustTry,
                }),
            }
        );
        if (!r.ok) {
            showToast(`❌ ${r.data?.error ?? 'ส่งคำขอไม่สำเร็จ'}`);
            return;
        }
        showToast('✓ ส่งคำขอให้แอดมินแล้ว');
        setShowRequestModal(null);
        setRequestReason('');
    };

    // ==================== Admin: Review Requests ====================
    const loadReviewRequests = useCallback(
        async (filter: typeof reviewRequestsFilter = reviewRequestsFilter) => {
            const r = await api<AdminReviewRequestsResponse>(
                `/api/admin/review_requests?status=${filter}`
            );
            if (r.ok && r.data) {
                setReviewRequests(r.data.requests);
                setReviewRequestCounts(r.data.counts);
            }
        },
        [reviewRequestsFilter]
    );

    useEffect(() => {
        if (isAdmin && showReviewRequests) {
            loadReviewRequests();
        }
    }, [isAdmin, showReviewRequests, loadReviewRequests]);

    const handleReviewRequestAction = async (
        requestId: string,
        action: 'approve' | 'reject' | 'done',
        note?: string
    ) => {
        const ok = await adminAction(
            `/api/admin/review_requests/${requestId}`,
            'PATCH',
            { action, adminNote: note ?? adminNote }
        );
        if (ok) {
            showToast(
                action === 'approve'
                    ? '✓ อนุมัติและแก้ไขรีวิวแล้ว'
                    : action === 'reject'
                    ? '✗ ปฏิเสธคำขอแล้ว'
                    : '✓ ทำเครื่องหมายเสร็จสิ้น'
            );
            setAdminNote('');
            setExpandedRequest(null);
            await loadReviewRequests();
            await refreshReviews();
        }
    };

    // ==================== Multi-Media Upload ====================
    const handleFilesUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;

        const remaining = MAX_MEDIA_ITEMS - newMedia.length;
        if (remaining <= 0) {
            showToast(`เพิ่มได้สูงสุด ${MAX_MEDIA_ITEMS} ไฟล์`);
            return;
        }

        const toAdd = Array.from(files).slice(0, remaining);
        setUploading(true);

        const newItems: MediaItem[] = toAdd.map((file) => ({
            type: file.type.startsWith('video/') ? 'video' : 'image',
            url: URL.createObjectURL(file),
        }));

        setNewMedia((prev) => [...prev, ...newItems]);
        setUploading(false);
        e.target.value = '';
    };

    const removeMedia = (index: number) => {
        setNewMedia((prev) => prev.filter((_, i) => i !== index));
    };

    const moveMedia = (index: number, direction: -1 | 1) => {
        setNewMedia((prev) => {
            const next = [...prev];
            const target = index + direction;
            if (target < 0 || target >= next.length) return prev;
            [next[index], next[target]] = [next[target], next[index]];
            return next;
        });
    };

    // ==================== Create Review ====================
    const handleAddReview = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newName.trim() || !newMustTry.trim()) return;

        const defaultImage =
            'https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=900&q=80';

        const mediaItems: MediaItem[] =
            newMedia.length > 0
                ? newMedia
                : [{ type: 'image', url: defaultImage }];

        const r = await api('/api/reviews', {
            method: 'POST',
            body: JSON.stringify({
                name: newName,
                category: newCategory,
                mustTry: newMustTry,
                mediaItems,
            }),
        });

        if (!r.ok) {
            showToast('บันทึกรีวิวไม่สำเร็จ');
            return;
        }

        showToast(`โพสต์รีวิวสำเร็จ! (${mediaItems.length} ไฟล์)`);
        setNewName('');
        setNewMustTry('');
        setNewMedia([]);
        setShowAddForm(false);
        await refreshReviews();
    };

    // ==================== Filter Reviews ====================
    const categories = useMemo(() => {
        const set = new Set(reviews.map((r) => r.category));
        return ['ทั้งหมด', ...Array.from(set)];
    }, [reviews]);

    const filteredReviews = useMemo(() => {
        return reviews.filter((r) => {
            if (activeTab !== 'ทั้งหมด' && r.category !== activeTab)
                return false;
            if (searchQuery.trim()) {
                const q = searchQuery.toLowerCase();
                return (
                    r.name.toLowerCase().includes(q) ||
                    r.must_try.toLowerCase().includes(q) ||
                    r.reviewer_name.toLowerCase().includes(q)
                );
            }
            return true;
        });
    }, [reviews, activeTab, searchQuery]);

    // ==================== Return JSX ====================
    return (
        <div className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-6 space-y-6">


            {/* Toast */}
            {toast && (
                <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] bg-slate-800 border border-slate-600 text-white text-sm px-4 py-2.5 rounded-xl shadow-2xl">
                    {toast}
                </div>
            )}

            {/* Header */}
            <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-xl">
                <div>
                    <div className="flex items-center gap-2.5">
                        <span className="text-2xl">🍜</span>
                        <h1 className="text-2xl font-black tracking-tight text-white">
                            กินจริง (KinJing)
                        </h1>
                        <span className="text-xs font-bold uppercase tracking-wider bg-orange-500/20 text-orange-400 px-2.5 py-0.5 rounded-full border border-orange-500/30">
                            Review
                        </span>
                    </div>
                    <p className="text-sm text-slate-400 mt-1">
                        คอมมูนิตี้รีวิวร้านอร่อย ปลอดหน้าม้า • รายได้แบ่งตามยอดวิว
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2.5 justify-end">
                    {membership.isVip ? (
                        <span className="inline-block text-xs font-black px-3 py-1 rounded-full bg-gradient-to-r from-amber-400 to-yellow-500 text-slate-950 shadow">
                            สมาชิก VIP • ไม่มีโฆษณา • ถึง{' '}
                            {fmtDate(membership.periodEnd)}
                        </span>
                    ) : (
                        <span className="inline-block text-xs font-bold px-3 py-1 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                            ผู้ใช้ฟรี (เห็นสปอนเซอร์)
                        </span>
                    )}
                    <button
                        onClick={() => setShowVipModal(true)}
                        disabled={!ready}
                        className="bg-gradient-to-r from-amber-400 to-yellow-500 hover:from-amber-500 hover:to-yellow-600 disabled:opacity-50 text-slate-950 font-black text-xs px-4 py-2.5 rounded-xl shadow-lg transition cursor-pointer"
                    >
                        {membership.isVip
                            ? 'ต่ออายุ / เปลี่ยนแพ็กเกจ'
                            : 'สมัคร VIP'}
                    </button>
                    {!isAdmin ? (
                        <button
                            onClick={() => setShowLogin(true)}
                            className="bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-400 hover:text-white text-xs px-3 py-2.5 rounded-xl transition cursor-pointer"
                            aria-label="Admin login"
                        >
                            🔒
                        </button>
                    ) : (
                        <button
                            onClick={handleAdminLogout}
                            className="bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs px-3 py-2.5 rounded-xl transition cursor-pointer"
                            aria-label="Admin logout"
                        >
                            ออกจากแอดมิน
                        </button>
                    )}
                </div>
            </header>

            {/* My Earnings */}
            {membership.isVip &&
                (payoutTotals.paid > 0 || payoutTotals.pending > 0) && (
                    <section className="bg-gradient-to-r from-emerald-950/60 to-slate-900 border border-emerald-500/40 rounded-2xl p-4">
                        <h2 className="text-xs font-black uppercase text-emerald-400 mb-2">
                            รายได้ของฉัน (แบ่งตามยอดวิว)
                        </h2>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                            <div className="bg-slate-950 border border-emerald-500/30 px-4 py-2 rounded-xl">
                                <span className="text-[10px] text-emerald-300 block">
                                    รอโอน
                                </span>
                                <span className="text-base font-black text-emerald-400">
                                    {baht(payoutTotals.pending)}
                                </span>
                            </div>
                            <div className="bg-slate-950 border border-emerald-500/30 px-4 py-2 rounded-xl">
                                <span className="text-[10px] text-emerald-300 block">
                                    โอนแล้ว
                                </span>
                                <span className="text-base font-black text-emerald-400">
                                    {baht(payoutTotals.paid)}
                                </span>
                            </div>
                        </div>
                        {myPayouts.length > 0 && (
                            <div className="mt-2 text-[11px] text-slate-400 space-y-0.5">
                                {myPayouts.slice(0, 3).map((p) => (
                                    <div key={p.id}>
                                        งวด {fmtDate(p.period_start)} –{' '}
                                        {fmtDate(p.period_end)}: {p.view_count} วิว •{' '}
                                        {baht(p.amount_satang)} (
                                        {PAYOUT_STATUS[p.status]})
                                    </div>
                                ))}
                            </div>
                        )}
                    </section>
                )}

            {/* Admin Console */}
            {isAdmin && (
                <section className="bg-rose-950/30 border-2 border-rose-500/50 rounded-2xl p-4 space-y-3 shadow-xl">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                        <span className="text-xs font-black uppercase text-rose-400">
                            Admin Console
                        </span>
                        <div className="flex flex-wrap gap-2">
                            <button
                                onClick={() =>
                                    setShowSponsorManager(!showSponsorManager)
                                }
                                className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs px-3 py-2 rounded-xl cursor-pointer"
                            >
                                {showSponsorManager ? 'ปิด' : 'จัดการสปอนเซอร์'}
                            </button>
                            <button
                                onClick={() =>
                                    setShowPayoutManager(!showPayoutManager)
                                }
                                className="bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold text-xs px-3 py-2 rounded-xl cursor-pointer"
                            >
                                {showPayoutManager ? 'ปิด' : 'จ่ายรางวัล'}
                            </button>
                            <button
                                onClick={() => setShowLogs(!showLogs)}
                                className="bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-200 font-bold text-xs px-3.5 py-2 rounded-xl cursor-pointer"
                            >
                                Audit Logs
                            </button>
                            <button
                                onClick={() =>
                                    setShowReviewRequests(!showReviewRequests)
                                }
                                className="bg-violet-500/20 hover:bg-violet-500/30 border border-violet-500/40 text-violet-200 font-bold text-xs px-3.5 py-2 rounded-xl cursor-pointer relative"
                            >
                                📝 คำขอแก้ไข
                                {reviewRequestCounts.pending > 0 && (
                                    <span className="absolute -top-1 -right-1 bg-rose-500 text-white text-[10px] font-black w-5 h-5 rounded-full flex items-center justify-center">
                                        {reviewRequestCounts.pending}
                                    </span>
                                )}
                            </button>
                            <button
                                onClick={loadSummary}
                                className="bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs px-3.5 py-2 rounded-xl cursor-pointer"
                            >
                                รีเฟรช
                            </button>
                        </div>
                    </div>
                    {summary ? (
                        <>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                {[
                                    {
                                        label: 'รายได้ VIP',
                                        value: baht(
                                            summary.revenue.subscriptionsSatang
                                        ),
                                    },
                                    {
                                        label: 'รายได้สปอนเซอร์',
                                        value: baht(
                                            summary.revenue
                                                .sponsorshipInvoicesSatang
                                        ),
                                    },
                                    {
                                        label: 'รายได้รวม',
                                        value: baht(summary.revenue.totalSatang),
                                    },
                                    {
                                        label: 'จ่ายรางวัลแล้ว',
                                        value: baht(
                                            summary.revenue.payoutsPaidSatang
                                        ),
                                    },
                                ].map((s) => (
                                    <div
                                        key={s.label}
                                        className="bg-slate-950 border border-indigo-500/40 px-4 py-2 rounded-xl"
                                    >
                                        <span className="text-[10px] text-indigo-300 block">
                                            {s.label}
                                        </span>
                                        <span className="text-base font-black text-indigo-400">
                                            {s.value}
                                        </span>
                                    </div>
                                ))}
                            </div>
                            <div className="text-xs text-slate-400">
                                สมาชิก VIP ที่ใช้งานอยู่: {summary.activeSubscribers} คน
                            </div>
                        </>
                    ) : (
                        <p className="text-xs text-slate-400">
                            กำลังโหลดข้อมูล...
                        </p>
                    )}
                </section>
            )}

            {/* Sponsor Manager */}
            {isAdmin && showSponsorManager && summary && (
                <section className="bg-slate-900 border-2 border-amber-500/40 rounded-2xl p-5 space-y-4 shadow-2xl">
                    <div className="flex justify-between items-center border-b border-slate-800 pb-3">
                        <h2 className="text-sm font-bold text-white">
                            จัดการสปอนเซอร์
                        </h2>
                        <button
                            onClick={() => setShowSponsorManager(false)}
                            className="text-xs bg-slate-800 px-3 py-1 rounded-lg text-slate-300 cursor-pointer"
                        >
                            X
                        </button>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse text-xs">
                            <thead>
                                <tr className="bg-slate-950 text-slate-400 border-b border-slate-800">
                                    <th className="py-2 px-3">แบรนด์ / ข้อความ</th>
                                    <th className="py-2 px-3">สถานะ</th>
                                    <th className="py-2 px-3">ค่าเช่า/เดือน</th>
                                    <th className="py-2 px-3">ใบแจ้งหนี้ล่าสุด</th>
                                    <th className="py-2 px-3">ต้องการ</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800">
                                {summary.sponsorships.length === 0 && (
                                    <tr>
                                        <td
                                            colSpan={5}
                                            className="py-4 px-3 text-slate-500"
                                        >
                                            ยังไม่มีสปอนเซอร์
                                        </td>
                                    </tr>
                                )}
                                {summary.sponsorships.map((c) => (
                                    <tr key={c.id}>
                                        <td className="py-2 px-3">
                                            <div className="font-bold text-white">
                                                {c.brand_name}
                                            </div>
                                            <div className="text-slate-400">
                                                {c.headline}
                                            </div>
                                            <div className="text-[10px] text-slate-500">
                                                {fmtDate(c.starts_at)} –{' '}
                                                {fmtDate(c.ends_at)}
                                            </div>
                                            {c.restaurant_name && (
                                                <div className="text-[10px] text-amber-400">
                                                    ร้าน: {c.restaurant_name}
                                                </div>
                                            )}
                                        </td>
                                        <td className="py-2 px-3">
                                            <span
                                                className={`px-2 py-0.5 rounded text-[10px] ${
                                                    SPONSOR_STATUS[c.status]
                                                        ?.cls ?? ''
                                                }`}
                                            >
                                                {SPONSOR_STATUS[c.status]?.label ??
                                                    c.status}
                                            </span>
                                        </td>
                                        <td className="py-2 px-3">
                                            {baht(c.monthly_fee_satang)}
                                        </td>
                                        <td className="py-2 px-3">
                                            {c.invoice_status ? (
                                                <div className="space-y-1">
                                                    <div>
                                                        {baht(
                                                            c.invoice_amount ?? 0
                                                        )}{' '}
                                                        •{' '}
                                                        {
                                                            INVOICE_STATUS[
                                                                c.invoice_status
                                                            ]
                                                        }
                                                    </div>
                                                    {c.invoice_id &&
                                                        (c.invoice_status ===
                                                            'issued' ||
                                                            c.invoice_status ===
                                                                'overdue') && (
                                                            <button
                                                                onClick={() =>
                                                                    markSponsorshipInvoicePaid(
                                                                        c.invoice_id as string
                                                                    )
                                                                }
                                                                className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-2 py-1 rounded cursor-pointer text-[10px]"
                                                            >
                                                                ✓
                                                                บันทึกว่าชำระแล้ว
                                                            </button>
                                                        )}
                                                </div>
                                            ) : (
                                                '-'
                                            )}
                                        </td>
                                        <td className="py-2 px-3">
                                            <div className="flex flex-wrap gap-1">
                                                <button
                                                    onClick={() =>
                                                        openEditSponsorship(c)
                                                    }
                                                    className="bg-sky-500/20 text-sky-300 text-[10px] font-bold px-2 py-1 rounded cursor-pointer"
                                                >
                                                    ✏️ แก้ไข
                                                </button>
                                                {c.status === 'active' && (
                                                    <button
                                                        onClick={() =>
                                                            adminAction(
                                                                `/api/admin/sponsorships/${c.id}`,
                                                                'PATCH',
                                                                {
                                                                    status: 'paused',
                                                                }
                                                            )
                                                        }
                                                        className="bg-amber-500/20 text-amber-300 text-[10px] font-bold px-2 py-1 rounded cursor-pointer"
                                                    >
                                                        พัก
                                                    </button>
                                                )}
                                                {(c.status === 'paused' ||
                                                    c.status === 'pending') && (
                                                    <button
                                                        onClick={() =>
                                                            adminAction(
                                                                `/api/admin/sponsorships/${c.id}`,
                                                                'PATCH',
                                                                {
                                                                    status: 'active',
                                                                }
                                                            )
                                                        }
                                                        className="bg-emerald-500/20 text-emerald-300 text-[10px] font-bold px-2 py-1 rounded cursor-pointer"
                                                    >
                                                        เปิด
                                                    </button>
                                                )}
                                                {c.status !== 'expired' && (
                                                    <button
                                                        onClick={() =>
                                                            adminAction(
                                                                `/api/admin/sponsorships/${c.id}`,
                                                                'PATCH',
                                                                {
                                                                    status: 'expired',
                                                                }
                                                            )
                                                        }
                                                        className="bg-rose-500/20 text-rose-300 text-[10px] font-bold px-2 py-1 rounded cursor-pointer"
                                                    >
                                                        ปิด
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <form
                        onSubmit={handleCreateSponsorship}
                        className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-2"
                    >
                        <span className="text-xs font-bold text-amber-400 block">
                            + เพิ่มสปอนเซอร์ใหม่
                        </span>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            <input
                                className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white"
                                placeholder="ชื่อแบรนด์/ร้านอาหาร"
                                value={form.brandName}
                                onChange={(e) =>
                                    setForm({
                                        ...form,
                                        brandName: e.target.value,
                                    })
                                }
                                required
                            />
                            <input
                                className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white"
                                type="number"
                                min="1"
                                placeholder="ค่าเช่ารายเดือน (บาท)"
                                value={form.monthlyFeeBaht}
                                onChange={(e) =>
                                    setForm({
                                        ...form,
                                        monthlyFeeBaht: e.target.value,
                                    })
                                }
                                required
                            />
                            <input
                                className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white md:col-span-2"
                                placeholder="ข้อความโปรโมชันหลัก"
                                value={form.headline}
                                onChange={(e) =>
                                    setForm({
                                        ...form,
                                        headline: e.target.value,
                                    })
                                }
                                required
                            />
                            <input
                                className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white md:col-span-2"
                                placeholder="ข้อความรอง (ไม่บังคับ)"
                                value={form.subText}
                                onChange={(e) =>
                                    setForm({
                                        ...form,
                                        subText: e.target.value,
                                    })
                                }
                            />
                            <input
                                className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white"
                                placeholder="ข้อความปุ่ม"
                                value={form.ctaText}
                                onChange={(e) =>
                                    setForm({
                                        ...form,
                                        ctaText: e.target.value,
                                    })
                                }
                            />
                            <input
                                className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white"
                                type="url"
                                placeholder="ลิงก์ปลายทาง https://..."
                                value={form.targetUrl}
                                onChange={(e) =>
                                    setForm({
                                        ...form,
                                        targetUrl: e.target.value,
                                    })
                                }
                                required
                            />
                            <label className="text-[10px] text-slate-400 space-y-1">
                                วันเริ่ม
                                <input
                                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white"
                                    type="date"
                                    value={form.startsAt}
                                    onChange={(e) =>
                                        setForm({
                                            ...form,
                                            startsAt: e.target.value,
                                        })
                                    }
                                    required
                                />
                            </label>
                            <label className="text-[10px] text-slate-400 space-y-1">
                                วันสิ้นสุด
                                <input
                                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white"
                                    type="date"
                                    value={form.endsAt}
                                    onChange={(e) =>
                                        setForm({
                                            ...form,
                                            endsAt: e.target.value,
                                        })
                                    }
                                    required
                                />
                            </label>
                        </div>
                        <button
                            type="submit"
                            className="w-full bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold py-1.5 rounded-lg text-xs cursor-pointer"
                        >
                            + บันทึกสปอนเซอร์และออกใบแจ้งหนี้งวดแรก
                        </button>
                    </form>
                </section>
            )}

            {/* Payout Manager */}
            {isAdmin && showPayoutManager && summary && (
                <section className="bg-slate-900 border-2 border-emerald-500/40 rounded-2xl p-5 space-y-4 shadow-2xl">
                    <div className="flex justify-between items-center border-b border-slate-800 pb-3">
                        <h2 className="text-sm font-bold text-white">
                            จ่ายรางวัลตามยอดวิว (Revenue Pool)
                        </h2>
                        <button
                            onClick={() => setShowPayoutManager(false)}
                            className="text-xs bg-slate-800 px-3 py-1 rounded-lg text-slate-300 cursor-pointer"
                        >
                            X
                        </button>
                    </div>

                    <form
                        onSubmit={runPayout}
                        className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3"
                    >
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                            <label className="text-[10px] text-slate-400 space-y-1">
                                เริ่มรอบ
                                <input
                                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white"
                                    type="date"
                                    value={payoutForm.periodStart}
                                    onChange={(e) =>
                                        setPayoutForm({
                                            ...payoutForm,
                                            periodStart: e.target.value,
                                        })
                                    }
                                    required
                                />
                            </label>
                            <label className="text-[10px] text-slate-400 space-y-1">
                                สิ้นสุดรอบ
                                <input
                                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white"
                                    type="date"
                                    value={payoutForm.periodEnd}
                                    onChange={(e) =>
                                        setPayoutForm({
                                            ...payoutForm,
                                            periodEnd: e.target.value,
                                        })
                                    }
                                    required
                                />
                            </label>
                            <label className="text-[10px] text-slate-400 space-y-1">
                                % แบ่งให้ผู้รีวิว
                                <input
                                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white"
                                    type="number"
                                    min="1"
                                    max="100"
                                    value={payoutForm.sharePercent}
                                    onChange={(e) =>
                                        setPayoutForm({
                                            ...payoutForm,
                                            sharePercent: e.target.value,
                                        })
                                    }
                                    required
                                />
                            </label>
                        </div>
                        <button
                            type="submit"
                            className="w-full bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold py-2 rounded-lg text-xs cursor-pointer"
                        >
                            คำนวณและสร้างรายการจ่ายรางวัล
                        </button>
                    </form>

                    <div>
                        <h3 className="text-xs font-bold text-slate-300 mb-2">
                            Top รีวิวตามยอดวิว
                        </h3>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse text-xs">
                                <thead>
                                    <tr className="bg-slate-950 text-slate-400 border-b border-slate-800">
                                        <th className="py-2 px-3">ร้าน</th>
                                        <th className="py-2 px-3">ผู้รีวิว</th>
                                        <th className="py-2 px-3">ยอดวิว</th>
                                        <th className="py-2 px-3">รายได้สะสม</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-800">
                                    {summary.topReviews.map((r) => (
                                        <tr key={r.id}>
                                            <td className="py-2 px-3 text-white">
                                                {r.name}
                                            </td>
                                            <td className="py-2 px-3 text-slate-400">
                                                {r.reviewer_name}
                                            </td>
                                            <td className="py-2 px-3 text-amber-300 font-bold">
                                                {r.view_count.toLocaleString()}
                                            </td>
                                            <td className="py-2 px-3 text-emerald-300 font-bold">
                                                {baht(r.total_payout_satang)}
                                            </td>
                                        </tr>
                                    ))}
                                    {summary.topReviews.length === 0 && (
                                        <tr>
                                            <td
                                                colSpan={4}
                                                className="py-4 px-3 text-slate-500"
                                            >
                                                ยังไม่มีข้อมูล
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </section>
            )}

            {/* Audit Logs */}
            {isAdmin && showLogs && summary && (
                <section className="bg-slate-900 border border-rose-500/40 rounded-2xl p-5 space-y-3 shadow-2xl">
                    <div className="flex justify-between items-center border-b border-slate-800 pb-2">
                        <h2 className="text-sm font-bold text-white">
                            Audit Logs (50 รายการล่าสุด)
                        </h2>
                        <button
                            onClick={() => setShowLogs(false)}
                            className="text-xs bg-slate-800 px-3 py-1 rounded-lg text-slate-300 cursor-pointer"
                        >
                            X
                        </button>
                    </div>
                    <div className="overflow-x-auto max-h-72">
                        <table className="w-full text-left border-collapse text-xs">
                            <thead>
                                <tr className="bg-slate-950 text-slate-400 border-b border-slate-800">
                                    <th className="py-2 px-3">เวลา</th>
                                    <th className="py-2 px-3">ผู้ทำรายการ</th>
                                    <th className="py-2 px-3">เหตุการณ์</th>
                                    <th className="py-2 px-3">รายละเอียด</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800 font-mono">
                                {summary.logs.map((log) => (
                                    <tr key={log.id}>
                                        <td className="py-2 px-3 text-slate-400 whitespace-nowrap">
                                            {fmtDateTime(log.created_at)}
                                        </td>
                                        <td className="py-2 px-3 text-white">
                                            {log.actor ?? '-'}
                                        </td>
                                        <td className="py-2 px-3">
                                            <span className="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 text-[10px]">
                                                {log.action}
                                            </span>
                                        </td>
                                        <td className="py-2 px-3 text-slate-300 break-all">
                                            {log.detail &&
                                            Object.keys(log.detail).length
                                                ? JSON.stringify(log.detail)
                                                : ''}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>
            )}

            {/* Review Edit Requests Panel */}
            {isAdmin && showReviewRequests && (
                <section className="bg-slate-900 border-2 border-violet-500/40 rounded-2xl p-5 space-y-4 shadow-2xl">
                    <div className="flex justify-between items-center border-b border-slate-800 pb-3">
                        <div>
                            <h2 className="text-sm font-bold text-white">
                                📝 คำขอแก้ไขรีวิว
                            </h2>
                            <p className="text-[10px] text-slate-400 mt-0.5">
                                ผู้ใช้ส่งคำขอมา — Admin ตรวจสอบและอนุมัติ
                            </p>
                        </div>
                        <button
                            onClick={() => setShowReviewRequests(false)}
                            className="text-xs bg-slate-800 px-3 py-1 rounded-lg text-slate-300 cursor-pointer"
                        >
                            X
                        </button>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                        {(
                            [
                                'pending',
                                'approved',
                                'rejected',
                                'done',
                                'all',
                            ] as const
                        ).map((s) => (
                            <button
                                key={s}
                                onClick={() => {
                                    setReviewRequestsFilter(s);
                                    loadReviewRequests(s);
                                }}
                                className={`text-[11px] px-3 py-1.5 rounded-lg cursor-pointer transition ${
                                    reviewRequestsFilter === s
                                        ? 'bg-violet-500 text-white font-bold'
                                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                                }`}
                            >
                                {s === 'pending'
                                    ? `รอตรวจสอบ (${reviewRequestCounts.pending})`
                                    : s === 'approved'
                                    ? `อนุมัติแล้ว (${reviewRequestCounts.approved})`
                                    : s === 'rejected'
                                    ? `ปฏิเสธ (${reviewRequestCounts.rejected})`
                                    : s === 'done'
                                    ? `เสร็จสิ้น (${reviewRequestCounts.done})`
                                    : 'ทั้งหมด'}
                            </button>
                        ))}
                    </div>

                    {reviewRequests.length === 0 ? (
                        <p className="text-xs text-slate-400 text-center py-6">
                            ไม่มีคำขอในสถานะนี้
                        </p>
                    ) : (
                        <div className="space-y-2">
                            {reviewRequests.map((r) => (
                                <div
                                    key={r.id}
                                    className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden"
                                >
                                    <button
                                        onClick={() =>
                                            setExpandedRequest(
                                                expandedRequest === r.id
                                                    ? null
                                                    : r.id
                                            )
                                        }
                                        className="w-full text-left px-4 py-3 hover:bg-slate-900 transition cursor-pointer"
                                    >
                                        <div className="flex justify-between items-start gap-2">
                                            <div className="flex-1">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <span className="text-xs font-bold text-white">
                                                        {r.restaurant_name}
                                                    </span>
                                                    <span
                                                        className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                                                            r.status ===
                                                            'pending'
                                                                ? 'bg-amber-500/20 text-amber-300'
                                                                : r.status ===
                                                                  'approved'
                                                                ? 'bg-emerald-500/20 text-emerald-300'
                                                                : r.status ===
                                                                  'rejected'
                                                                ? 'bg-rose-500/20 text-rose-300'
                                                                : 'bg-slate-700 text-slate-300'
                                                        }`}
                                                    >
                                                        {r.status === 'pending'
                                                            ? 'รอตรวจสอบ'
                                                            : r.status ===
                                                              'approved'
                                                            ? 'อนุมัติแล้ว'
                                                            : r.status ===
                                                              'rejected'
                                                            ? 'ปฏิเสธ'
                                                            : 'เสร็จสิ้น'}
                                                    </span>
                                                </div>
                                                <div className="text-[11px] text-slate-400 mt-1">
                                                    โดย {r.requester_name} •{' '}
                                                    {fmtDateTime(r.created_at)}
                                                </div>
                                                <div className="text-xs text-slate-300 mt-1 line-clamp-2">
                                                    <strong>เหตุผล:</strong>{' '}
                                                    {r.reason}
                                                </div>
                                            </div>
                                            <span className="text-slate-500 text-xs shrink-0">
                                                {expandedRequest === r.id
                                                    ? '▲'
                                                    : '▼'}
                                            </span>
                                        </div>
                                    </button>

                                    {expandedRequest === r.id && (
                                        <div className="px-4 pb-4 border-t border-slate-800 space-y-3 pt-3">
                                            <div className="bg-slate-900 rounded-lg p-3 space-y-1">
                                                <div className="text-[10px] font-bold text-slate-400 uppercase">
                                                    ข้อมูลปัจจุบัน
                                                </div>
                                                <div className="text-xs text-slate-300">
                                                    <div>
                                                        <strong>ชื่อ:</strong>{' '}
                                                        {r.restaurant_name}
                                                    </div>
                                                    <div>
                                                        <strong>หมวด:</strong>{' '}
                                                        {r.restaurant_category}
                                                    </div>
                                                    <div>
                                                        <strong>
                                                            เมนูต้องลอง:
                                                        </strong>{' '}
                                                        {r.restaurant_must_try}
                                                    </div>
                                                </div>
                                            </div>

                                            {r.proposed_changes &&
                                                Object.keys(r.proposed_changes)
                                                    .length > 0 && (
                                                    <div className="bg-sky-950/40 border border-sky-500/30 rounded-lg p-3 space-y-1">
                                                        <div className="text-[10px] font-bold text-sky-300 uppercase">
                                                            สิ่งที่ผู้ใช้เสนอแก้
                                                        </div>
                                                        <div className="text-xs text-sky-100 space-y-0.5">
                                                            {typeof r
                                                                .proposed_changes
                                                                .name ===
                                                                'string' && (
                                                                <div>
                                                                    <strong>
                                                                        ชื่อใหม่:
                                                                    </strong>{' '}
                                                                    {
                                                                        r
                                                                            .proposed_changes
                                                                            .name
                                                                    }
                                                                </div>
                                                            )}
                                                            {typeof r
                                                                .proposed_changes
                                                                .category ===
                                                                'string' && (
                                                                <div>
                                                                    <strong>
                                                                        หมวดใหม่:
                                                                    </strong>{' '}
                                                                    {
                                                                        r
                                                                            .proposed_changes
                                                                            .category
                                                                    }
                                                                </div>
                                                            )}
                                                            {typeof r
                                                                .proposed_changes
                                                                .mustTry ===
                                                                'string' && (
                                                                <div>
                                                                    <strong>
                                                                        เมนูใหม่:
                                                                    </strong>{' '}
                                                                    {
                                                                        r
                                                                            .proposed_changes
                                                                            .mustTry
                                                                    }
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                )}

                                            {r.status === 'pending' && (
                                                <textarea
                                                    placeholder="หมายเหตุสำหรับผู้ใช้ (ไม่บังคับ)"
                                                    value={adminNote}
                                                    onChange={(e) =>
                                                        setAdminNote(
                                                            e.target.value
                                                        )
                                                    }
                                                    rows={2}
                                                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white resize-none"
                                                />
                                            )}

                                            {r.admin_note &&
                                                r.status !== 'pending' && (
                                                    <div className="bg-slate-900 rounded-lg p-3 text-xs text-slate-300">
                                                        <strong className="text-slate-400">
                                                            หมายเหตุ Admin:
                                                        </strong>{' '}
                                                        {r.admin_note}
                                                    </div>
                                                )}

                                            {r.status === 'pending' && (
                                                <div className="flex flex-wrap gap-2">
                                                    <button
                                                        onClick={() =>
                                                            handleReviewRequestAction(
                                                                r.id,
                                                                'approve'
                                                            )
                                                        }
                                                        className="bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-xs px-3 py-2 rounded-lg cursor-pointer"
                                                    >
                                                        ✓ อนุมัติและแก้ไข
                                                    </button>
                                                    <button
                                                        onClick={() =>
                                                            handleReviewRequestAction(
                                                                r.id,
                                                                'reject'
                                                            )
                                                        }
                                                        className="bg-rose-500 hover:bg-rose-600 text-white font-bold text-xs px-3 py-2 rounded-lg cursor-pointer"
                                                    >
                                                        ✗ ปฏิเสธ
                                                    </button>
                                                    <button
                                                        onClick={() =>
                                                            handleReviewRequestAction(
                                                                r.id,
                                                                'done'
                                                            )
                                                        }
                                                        className="bg-slate-700 hover:bg-slate-600 text-white font-bold text-xs px-3 py-2 rounded-lg cursor-pointer"
                                                    >
                                                        ✓ ทำเครื่องหมายเสร็จ
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </section>
            )}

            {/* Sponsorship Banner */}
            {sponsorship && !membership.isVip && (
                <section className="bg-gradient-to-r from-amber-950/70 via-slate-900 to-orange-950/60 border-2 border-amber-500/50 rounded-2xl p-5 shadow-xl">
                    <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                        <div className="space-y-1.5 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="text-[10px] font-black uppercase px-2.5 py-0.5 rounded-full bg-amber-500 text-slate-950">
                                    {sponsorship.badge_text}
                                </span>
                                <span className="text-xs font-bold text-amber-300">
                                    {sponsorship.brand_name}
                                </span>
                            </div>
                            <h3 className="text-base md:text-lg font-extrabold text-white">
                                {sponsorship.headline}
                            </h3>
                            {sponsorship.sub_text && (
                                <p className="text-xs text-slate-300">
                                    {sponsorship.sub_text}
                                </p>
                            )}
                            {sponsorship.restaurant_name && (
                                <p className="text-[11px] text-amber-400">
                                    ร้าน: {sponsorship.restaurant_name}
                                </p>
                            )}
                        </div>
                        <div className="flex flex-col gap-2 shrink-0">
                            <a
                                href={sponsorship.target_url}
                                target="_blank"
                                rel="noopener noreferrer nofollow sponsored"
                                className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-xs px-4 py-2 rounded-xl shadow-md transition text-center"
                            >
                                {sponsorship.cta_text}
                            </a>
                            <button
                                onClick={() => setShowVipModal(true)}
                                className="text-[11px] text-amber-300 hover:underline text-right cursor-pointer"
                            >
                                ปิดสปอนเซอร์ด้วยแพ็กเกจ VIP
                            </button>
                        </div>
                    </div>
                </section>
            )}

            {/* Reviews Header */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900 border border-slate-800 p-4 rounded-2xl">
                <div className="flex flex-wrap gap-1.5">
                    {categories.map((c) => (
                        <button
                            key={c}
                            onClick={() => setActiveTab(c)}
                            className={`text-xs px-3 py-1.5 rounded-lg cursor-pointer transition ${
                                activeTab === c
                                    ? 'bg-amber-500 text-slate-950 font-bold'
                                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                            }`}
                        >
                            {c}
                        </button>
                    ))}
                </div>
                <div className="flex gap-2 w-full md:w-auto">
                    <input
                        type="text"
                        placeholder="ค้นหาร้าน / เมนู / ผู้รีวิว..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white w-full md:w-64"
                    />
                    <button
                        onClick={() => setShowAddForm(!showAddForm)}
                        className="inline-flex items-center justify-center gap-2 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white font-bold px-4 py-2 rounded-xl shadow-lg transition cursor-pointer text-xs shrink-0"
                    >
                        {showAddForm ? 'X ปิดฟอร์ม' : '+ เขียนรีวิว'}
                    </button>
                </div>
            </div>

            {/* Add Review Form */}
            {showAddForm && (
                <form
                    onSubmit={handleAddReview}
                    className="bg-slate-900 border border-slate-800 p-6 rounded-2xl space-y-4 shadow-2xl"
                >
                    <h2 className="text-lg font-bold text-white">
                        เขียนรีวิวร้านอาหารใหม่
                    </h2>
                    <p className="text-[11px] text-amber-300">
                        อัปโหลดได้สูงสุด {MAX_MEDIA_ITEMS} ไฟล์ (รูปภาพ + วิดีโอ)
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <input
                            type="text"
                            placeholder="ชื่อร้านอาหาร เช่น เจ้าไฟ ประตูนี้"
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                            required
                        />
                        <select
                            value={newCategory}
                            onChange={(e) => setNewCategory(e.target.value)}
                            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                        >
                            <option value="สตรีทฟู้ดร้านลับ">
                                สตรีทฟู้ดร้านลับ
                            </option>
                            <option value="เดตสุดพิเศษ">เดตสุดพิเศษ</option>
                            <option value="คาเฟ่นั่งทำงาน">คาเฟ่นั่งทำงาน</option>
                        </select>
                    </div>

                    <input
                        type="text"
                        placeholder="เมนูต้องลอง เช่น ปูจียวไข่"
                        value={newMustTry}
                        onChange={(e) => setNewMustTry(e.target.value)}
                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                        required
                    />

                    <div className="space-y-2">
                        <label className="block text-xs font-bold text-slate-300">
                            รูปภาพ / วิดีโอ ({newMedia.length}/{MAX_MEDIA_ITEMS})
                        </label>
                        <input
                            type="file"
                            accept="image/*,video/*"
                            multiple
                            onChange={handleFilesUpload}
                            disabled={newMedia.length >= MAX_MEDIA_ITEMS}
                            className="block w-full text-xs text-slate-300 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-orange-500 file:text-white cursor-pointer disabled:opacity-50"
                        />
                        <p className="text-[10px] text-slate-500">
                            เลือกได้หลายไฟล์พร้อมกัน (กด Shift/Ctrl ค้างไว้)
                        </p>
                    </div>

                    {newMedia.length > 0 && (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            {newMedia.map((m, i) => (
                                <div
                                    key={i}
                                    className="relative group bg-slate-950 border border-slate-800 rounded-xl overflow-hidden"
                                >
                                    <div className="aspect-square">
                                        {m.type === 'video' ? (
                                            <video
                                                src={m.url}
                                                muted
                                                playsInline
                                                className="w-full h-full object-cover"
                                            />
                                        ) : (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img
                                                src={m.url}
                                                alt={`media-${i}`}
                                                className="w-full h-full object-cover"
                                            />
                                        )}
                                    </div>
                                    <div className="absolute top-1 left-1">
                                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-black/70 text-white">
                                            {m.type === 'video' ? '🎬' : '📷'}{' '}
                                            {i + 1}
                                        </span>
                                    </div>
                                    <div className="absolute top-1 right-1 flex gap-1">
                                        {i > 0 && (
                                            <button
                                                type="button"
                                                onClick={() => moveMedia(i, -1)}
                                                className="bg-black/70 hover:bg-black text-white text-[10px] w-5 h-5 rounded flex items-center justify-center cursor-pointer"
                                                title="เลื่อนซ้าย"
                                            >
                                                ←
                                            </button>
                                        )}
                                        {i < newMedia.length - 1 && (
                                            <button
                                                type="button"
                                                onClick={() => moveMedia(i, 1)}
                                                className="bg-black/70 hover:bg-black text-white text-[10px] w-5 h-5 rounded flex items-center justify-center cursor-pointer"
                                                title="เลื่อนขวา"
                                            >
                                                →
                                            </button>
                                        )}
                                        <button
                                            type="button"
                                            onClick={() => removeMedia(i)}
                                            className="bg-rose-600/90 hover:bg-rose-600 text-white text-[10px] w-5 h-5 rounded flex items-center justify-center cursor-pointer"
                                            title="ลบ"
                                        >
                                            ×
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {uploading && (
                        <p className="text-xs text-amber-300">กำลังโหลดไฟล์...</p>
                    )}

                    <button
                        type="submit"
                        disabled={uploading}
                        className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold py-2.5 rounded-xl transition cursor-pointer"
                    >
                        ✓ โพสต์รีวิว
                    </button>
                </form>
            )}

            {/* Reviews Grid */}
            <main className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {reviewsLoading && reviews.length === 0 && (
                    <p className="text-sm text-slate-400">กำลังโหลดรีวิว...</p>
                )}
                {!reviewsLoading && filteredReviews.length === 0 && (
                    <p className="text-sm text-slate-400">ยังไม่มีรีวิว</p>
                )}
                {filteredReviews.map((res) => {
                    const items = parseMediaItems(res.media_items);
                    const cover: MediaItem = items[0] ?? {
                        type: 'image',
                        url: 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=900&q=80',
                    };

                    return (
                        <article
                            key={res.id}
                            className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-lg hover:border-amber-500/50 transition"
                        >
                            <div className="relative h-56 w-full bg-slate-950 overflow-hidden group">
                                <div
                                    className="cursor-pointer w-full h-full"
                                    onClick={() => {
                                        trackView(res.id);
                                        if (items.length > 0) {
                                            setLightboxIndex({
                                                items,
                                                index: 0,
                                            });
                                        }
                                    }}
                                >
                                    {cover.type === 'video' ? (
                                        <video
                                            src={cover.url}
                                            muted
                                            playsInline
                                            loop
                                            className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                                        />
                                    ) : (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img
                                            src={cover.url}
                                            alt={res.name}
                                            className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                                        />
                                    )}
                                </div>

                                <div className="absolute top-3 left-3 flex gap-1.5">
                                    <span className="text-[11px] font-bold px-2.5 py-1 rounded-full backdrop-blur-md bg-black/65 text-white border border-white/15">
                                        {cover.type === 'video'
                                            ? '🎬 วิดีโอ'
                                            : '📷 รูปภาพ'}
                                    </span>
                                    {items.length > 1 && (
                                        <span className="text-[11px] font-bold px-2.5 py-1 rounded-full backdrop-blur-md bg-sky-500/90 text-white">
                                            📚 {items.length} ไฟล์
                                        </span>
                                    )}
                                </div>
                                <div className="absolute top-3 right-3">
                                    <span className="text-[11px] font-bold px-2.5 py-1 rounded-full backdrop-blur-md bg-amber-500/90 text-slate-950">
                                        👁 {res.view_count.toLocaleString()} วิว
                                    </span>
                                </div>

                                {items.length > 1 && (
                                    <div className="absolute bottom-2 left-2 right-2 flex gap-1 overflow-x-auto pb-1">
                                        {items.slice(0, 6).map((m, i) => (
                                            <button
                                                key={i}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    trackView(res.id);
                                                    setLightboxIndex({
                                                        items,
                                                        index: i,
                                                    });
                                                }}
                                                className="w-10 h-10 shrink-0 rounded-md overflow-hidden border-2 border-white/30 hover:border-amber-400 transition cursor-pointer"
                                            >
                                                {m.type === 'video' ? (
                                                    <video
                                                        src={m.url}
                                                        muted
                                                        className="w-full h-full object-cover"
                                                    />
                                                ) : (
                                                    // eslint-disable-next-line @next/next/no-img-element
                                                    <img
                                                        src={m.url}
                                                        alt=""
                                                        className="w-full h-full object-cover"
                                                    />
                                                )}
                                            </button>
                                        ))}
                                        {items.length > 6 && (
                                            <div className="w-10 h-10 shrink-0 rounded-md bg-black/70 text-white text-[10px] font-bold flex items-center justify-center">
                                                +{items.length - 6}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            <div className="p-4 space-y-3">
                                <div className="flex justify-between items-start gap-2">
                                    <div>
                                        <h3 className="text-sm font-bold text-white">
                                            {res.name}
                                        </h3>
                                        <p className="text-[11px] text-slate-400">
                                            {res.category} • {res.reviewer_name}
                                        </p>
                                    </div>
                                    <span className="bg-amber-500/20 text-amber-400 font-black text-sm px-2.5 py-1 rounded-lg border border-amber-500/30 shrink-0">
                                        ★ {Number(res.rating).toFixed(1)}
                                    </span>
                                </div>
                                <p className="text-xs text-slate-300 bg-slate-950/60 p-3 rounded-xl border border-slate-800/80">
                                    <strong className="text-white">
                                        เมนูต้องลอง:
                                    </strong>{' '}
                                    {res.must_try}
                                </p>
                                {Array.isArray(res.tags) && res.tags.length > 0 && (
                                    <div className="flex flex-wrap gap-1.5">
                                        {res.tags.map((tag, i) => (
                                            <span
                                                key={i}
                                                className="text-[11px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded-md"
                                            >
                                                {tag}
                                            </span>
                                        ))}
                                    </div>
                                )}

                                <button
                                    onClick={() => {
                                        trackView(res.id);
                                        if (items.length > 0) {
                                            setLightboxIndex({
                                                items,
                                                index: 0,
                                            });
                                        }
                                    }}
                                    className="w-full text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-300 py-2 rounded-lg cursor-pointer transition"
                                >
                                    👁 เปิดดู ({items.length} ไฟล์ • นับวิว)
                                </button>

                                <div className="flex gap-1.5">
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            openEditReview(res);
                                        }}
                                        className="flex-1 text-[11px] bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-500/40 py-2 rounded-lg cursor-pointer transition"
                                    >
                                        ✏️ แก้ไข
                                    </button>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            openRequestModal(res);
                                        }}
                                        className="flex-1 text-[11px] bg-violet-500/20 hover:bg-violet-500/30 text-violet-300 border border-violet-500/40 py-2 rounded-lg cursor-pointer transition"
                                    >
                                        📨 ส่งคำขอ
                                    </button>
                                </div>
                            </div>
                        </article>
                    );
                })}
            </main>

            {/* Admin Login Modal */}
            {showLogin && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <form
                        onSubmit={handleAdminLogin}
                        className="bg-slate-900 border border-slate-700 rounded-2xl max-w-sm w-full p-6 space-y-4 shadow-2xl"
                    >
                        <div className="flex justify-between items-center">
                            <h3 className="text-base font-bold text-white">
                                กรอกรหัสผ่านแอดมิน
                            </h3>
                            <button
                                type="button"
                                onClick={() => {
                                    setShowLogin(false);
                                    setPassword('');
                                }}
                                className="text-slate-400 hover:text-white cursor-pointer"
                            >
                                X
                            </button>
                        </div>
                        <input
                            type="password"
                            placeholder="••••••••"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white text-center tracking-widest focus:outline-none focus:border-slate-500"
                            autoFocus
                            autoComplete="off"
                        />
                        <button
                            type="submit"
                            className="w-full bg-slate-700 hover:bg-slate-600 text-white font-bold py-2.5 rounded-xl text-xs transition cursor-pointer"
                        >
                            เข้าสู่ระบบ
                        </button>
                    </form>
                </div>
            )}

            {/* Edit Review Modal */}
            {editingReview && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <form
                        onSubmit={handleUpdateReview}
                        className="bg-slate-900 border-2 border-sky-500/50 rounded-2xl max-w-2xl w-full p-6 space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto"
                    >
                        <div className="flex justify-between items-center border-b border-slate-800 pb-3">
                            <h3 className="text-lg font-bold text-white">
                                ✏️ แก้ไขรีวิว
                            </h3>
                            <button
                                type="button"
                                onClick={() => setEditingReview(null)}
                                className="text-slate-400 hover:text-white cursor-pointer text-lg"
                            >
                                X
                            </button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <input
                                className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white"
                                placeholder="ชื่อร้าน"
                                value={editReviewForm.name}
                                onChange={(e) =>
                                    setEditReviewForm({
                                        ...editReviewForm,
                                        name: e.target.value,
                                    })
                                }
                                required
                            />
                            <select
                                className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white"
                                value={editReviewForm.category}
                                onChange={(e) =>
                                    setEditReviewForm({
                                        ...editReviewForm,
                                        category: e.target.value,
                                    })
                                }
                            >
                                <option value="สตรีทฟู้ดร้านลับ">
                                    สตรีทฟู้ดร้านลับ
                                </option>
                                <option value="เดตสุดพิเศษ">
                                    เดตสุดพิเศษ
                                </option>
                                <option value="คาเฟ่นั่งทำงาน">
                                    คาเฟ่นั่งทำงาน
                                </option>
                            </select>
                        </div>
                        <input
                            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white"
                            placeholder="เมนูต้องลอง"
                            value={editReviewForm.mustTry}
                            onChange={(e) =>
                                setEditReviewForm({
                                    ...editReviewForm,
                                    mustTry: e.target.value,
                                })
                            }
                            required
                        />

                        <div className="space-y-2">
                            <label className="block text-xs font-bold text-slate-300">
                                รูป/วิดีโอ ({editReviewForm.mediaItems.length}/
                                {MAX_MEDIA_ITEMS})
                            </label>
                            <input
                                type="file"
                                accept="image/*,video/*"
                                multiple
                                onChange={handleEditReviewMedia}
                                disabled={
                                    editReviewForm.mediaItems.length >=
                                    MAX_MEDIA_ITEMS
                                }
                                className="block w-full text-xs text-slate-300 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-orange-500 file:text-white cursor-pointer disabled:opacity-50"
                            />
                        </div>

                        {editReviewForm.mediaItems.length > 0 && (
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                {editReviewForm.mediaItems.map((m, i) => (
                                    <div
                                        key={i}
                                        className="relative group bg-slate-950 border border-slate-800 rounded-xl overflow-hidden"
                                    >
                                        <div className="aspect-square">
                                            {m.type === 'video' ? (
                                                <video
                                                    src={m.url}
                                                    muted
                                                    playsInline
                                                    className="w-full h-full object-cover"
                                                />
                                            ) : (
                                                // eslint-disable-next-line @next/next/no-img-element
                                                <img
                                                    src={m.url}
                                                    alt=""
                                                    className="w-full h-full object-cover"
                                                />
                                            )}
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => removeEditMedia(i)}
                                            className="absolute top-1 right-1 bg-rose-600/90 hover:bg-rose-600 text-white text-[10px] w-5 h-5 rounded flex items-center justify-center cursor-pointer"
                                        >
                                            ×
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}

                        <div className="flex gap-2">
                            <button
                                type="submit"
                                className="flex-1 bg-sky-500 hover:bg-sky-600 text-white font-bold py-2.5 rounded-xl text-xs cursor-pointer"
                            >
                                💾 บันทึกการแก้ไข
                            </button>
                            <button
                                type="button"
                                onClick={() => setEditingReview(null)}
                                className="flex-1 bg-slate-700 hover:bg-slate-600 text-white font-bold py-2.5 rounded-xl text-xs cursor-pointer"
                            >
                                ยกเลิก
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {/* Request Edit Modal */}
            {showRequestModal && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <form
                        onSubmit={handleSubmitRequest}
                        className="bg-slate-900 border-2 border-violet-500/50 rounded-2xl max-w-xl w-full p-6 space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto"
                    >
                        <div className="flex justify-between items-center border-b border-slate-800 pb-3">
                            <div>
                                <h3 className="text-lg font-bold text-white">
                                    📨 ส่งคำขอให้แอดมินแก้ไข
                                </h3>
                                <p className="text-[11px] text-slate-400 mt-0.5">
                                    รีวิว: {showRequestModal.name}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setShowRequestModal(null)}
                                className="text-slate-400 hover:text-white cursor-pointer text-lg"
                            >
                                X
                            </button>
                        </div>

                        <div className="space-y-1">
                            <label className="block text-xs font-bold text-slate-300">
                                เหตุผลที่ขอแก้ไข *
                            </label>
                            <textarea
                                placeholder="เช่น ข้อมูลเมนูผิด, ต้องการเพิ่มรูป, ลบข้อมูลที่ไม่เหมาะสม ฯลฯ"
                                value={requestReason}
                                onChange={(e) =>
                                    setRequestReason(e.target.value)
                                }
                                rows={3}
                                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white resize-none"
                                required
                                minLength={5}
                            />
                            <p className="text-[10px] text-slate-500">
                                อย่างน้อย 5 ตัวอักษร
                            </p>
                        </div>

                        <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 space-y-2">
                            <div className="text-[10px] font-bold text-slate-400 uppercase">
                                ข้อเสนอการแก้ไข (ไม่บังคับ)
                            </div>
                            <input
                                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white"
                                placeholder="ชื่อร้านใหม่"
                                value={requestProposed.name}
                                onChange={(e) =>
                                    setRequestProposed({
                                        ...requestProposed,
                                        name: e.target.value,
                                    })
                                }
                            />
                            <input
                                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white"
                                placeholder="หมวดใหม่"
                                value={requestProposed.category}
                                onChange={(e) =>
                                    setRequestProposed({
                                        ...requestProposed,
                                        category: e.target.value,
                                    })
                                }
                            />
                            <input
                                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white"
                                placeholder="เมนูต้องลองใหม่"
                                value={requestProposed.mustTry}
                                onChange={(e) =>
                                    setRequestProposed({
                                        ...requestProposed,
                                        mustTry: e.target.value,
                                    })
                                }
                            />
                        </div>

                        <div className="flex gap-2">
                            <button
                                type="submit"
                                className="flex-1 bg-violet-500 hover:bg-violet-600 text-white font-bold py-2.5 rounded-xl text-xs cursor-pointer"
                            >
                                📨 ส่งคำขอ
                            </button>
                            <button
                                type="button"
                                onClick={() => setShowRequestModal(null)}
                                className="flex-1 bg-slate-700 hover:bg-slate-600 text-white font-bold py-2.5 rounded-xl text-xs cursor-pointer"
                            >
                                ยกเลิก
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {/* Edit Sponsorship Modal */}
            {editingSponsorship && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <form
                        onSubmit={handleUpdateSponsorship}
                        className="bg-slate-900 border-2 border-sky-500/50 rounded-2xl max-w-2xl w-full p-6 space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto"
                    >
                        <div className="flex justify-between items-center border-b border-slate-800 pb-3">
                            <h3 className="text-lg font-bold text-white">
                                ✏️ แก้ไขสปอนเซอร์
                            </h3>
                            <button
                                type="button"
                                onClick={() => setEditingSponsorship(null)}
                                className="text-slate-400 hover:text-white cursor-pointer text-lg"
                            >
                                X
                            </button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <input
                                className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white"
                                placeholder="ชื่อแบรนด์"
                                value={editForm.brandName}
                                onChange={(e) =>
                                    setEditForm({
                                        ...editForm,
                                        brandName: e.target.value,
                                    })
                                }
                                required
                            />
                            <input
                                className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white"
                                type="number"
                                min="1"
                                placeholder="ค่าเช่า/เดือน (บาท)"
                                value={editForm.monthlyFeeBaht}
                                onChange={(e) =>
                                    setEditForm({
                                        ...editForm,
                                        monthlyFeeBaht: e.target.value,
                                    })
                                }
                                required
                            />
                            <input
                                className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white md:col-span-2"
                                placeholder="ข้อความโปรโมชันหลัก"
                                value={editForm.headline}
                                onChange={(e) =>
                                    setEditForm({
                                        ...editForm,
                                        headline: e.target.value,
                                    })
                                }
                                required
                            />
                            <input
                                className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white md:col-span-2"
                                placeholder="ข้อความรอง (ไม่บังคับ)"
                                value={editForm.subText}
                                onChange={(e) =>
                                    setEditForm({
                                        ...editForm,
                                        subText: e.target.value,
                                    })
                                }
                            />
                            <input
                                className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white"
                                placeholder="ข้อความปุ่ม"
                                value={editForm.ctaText}
                                onChange={(e) =>
                                    setEditForm({
                                        ...editForm,
                                        ctaText: e.target.value,
                                    })
                                }
                            />
                            <input
                                className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white"
                                type="url"
                                placeholder="ลิงก์ปลายทาง https://..."
                                value={editForm.targetUrl}
                                onChange={(e) =>
                                    setEditForm({
                                        ...editForm,
                                        targetUrl: e.target.value,
                                    })
                                }
                                required
                            />
                            <label className="text-[10px] text-slate-400 space-y-1">
                                วันเริ่ม
                                <input
                                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white"
                                    type="date"
                                    value={editForm.startsAt}
                                    onChange={(e) =>
                                        setEditForm({
                                            ...editForm,
                                            startsAt: e.target.value,
                                        })
                                    }
                                    required
                                />
                            </label>
                            <label className="text-[10px] text-slate-400 space-y-1">
                                วันสิ้นสุด
                                <input
                                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white"
                                    type="date"
                                    value={editForm.endsAt}
                                    onChange={(e) =>
                                        setEditForm({
                                            ...editForm,
                                            endsAt: e.target.value,
                                        })
                                    }
                                    required
                                />
                            </label>
                        </div>

                        <div className="flex gap-2">
                            <button
                                type="submit"
                                className="flex-1 bg-sky-500 hover:bg-sky-600 text-white font-bold py-2.5 rounded-xl text-xs cursor-pointer"
                            >
                                💾 บันทึกการแก้ไข
                            </button>
                            <button
                                type="button"
                                onClick={() => setEditingSponsorship(null)}
                                className="flex-1 bg-slate-700 hover:bg-slate-600 text-white font-bold py-2.5 rounded-xl text-xs cursor-pointer"
                            >
                                ยกเลิก
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {/* VIP Modal */}
            {showVipModal && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-slate-900 border-2 border-amber-500/50 rounded-2xl max-w-2xl w-full p-6 space-y-5 shadow-2xl max-h-[90vh] overflow-y-auto">
                        <div className="flex justify-between items-center border-b border-slate-800 pb-3">
                            <div>
                                <h3 className="text-lg font-bold text-white">
                                    สมัครสมาชิก VIP
                                </h3>
                                <p className="text-xs text-slate-400 mt-0.5">
                                    ชำระผ่าน PromptPay QR • ปิดสปอนเซอร์ทั้งหมด
                                </p>
                            </div>
                            <button
                                onClick={() => setShowVipModal(false)}
                                className="text-slate-400 hover:text-white cursor-pointer text-lg"
                            >
                                X
                            </button>
                        </div>
                        {plans.length === 0 ? (
                            <p className="text-xs text-slate-400">
                                กำลังโหลดแพ็กเกจ...
                            </p>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {plans.map((p, i) => (
                                    <div
                                        key={p.id}
                                        className={`rounded-2xl p-5 flex flex-col justify-between space-y-4 ${
                                            i === plans.length - 1 &&
                                            plans.length > 1
                                                ? 'bg-gradient-to-b from-amber-950/40 to-slate-950 border-2 border-amber-500'
                                                : 'bg-slate-950 border border-slate-800'
                                        }`}
                                    >
                                        <div className="space-y-2">
                                            <span className="text-[11px] font-black uppercase px-2.5 py-0.5 rounded-full bg-amber-400 text-slate-950">
                                                {p.name}
                                            </span>
                                            <div className="text-2xl font-black text-white">
                                                {baht(p.price_satang)}
                                                <span className="text-xs font-normal text-slate-400">
                                                    /{p.interval_days} วัน
                                                </span>
                                            </div>
                                            <ul className="text-xs text-slate-300 space-y-2 pt-2">
                                                {p.perks.map((perk) => (
                                                    <li key={perk}>✓ {perk}</li>
                                                ))}
                                            </ul>
                                        </div>
                                        <button
                                            onClick={() =>
                                                startCheckout(p.id)
                                            }
                                            disabled={creatingCheckout}
                                            className="w-full bg-gradient-to-r from-amber-400 to-yellow-500 hover:from-amber-500 hover:to-yellow-600 disabled:opacity-50 text-slate-950 font-black py-2.5 rounded-xl text-xs shadow-lg transition cursor-pointer"
                                        >
                                            {creatingCheckout
                                                ? 'กำลังสร้าง QR...'
                                                : `สมัคร ${p.name}`}
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Checkout Modal */}
            {checkout && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-sm w-full p-6 space-y-4 shadow-2xl text-center">
                        <div className="flex justify-between items-center">
                            <h3 className="text-base font-bold text-white">
                                ชำระเงิน VIP {baht(checkout.amountSatang)}
                            </h3>
                            <button
                                onClick={closeCheckout}
                                className="text-slate-400 hover:text-white cursor-pointer"
                            >
                                X
                            </button>
                        </div>
                        {checkoutState === 'waiting' && (
                            <>
                                {checkout.qrImageUrl ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                        src={checkout.qrImageUrl}
                                        alt="PromptPay QR"
                                        className="mx-auto w-56 h-56 bg-white rounded-xl p-2"
                                    />
                                ) : (
                                    <p className="text-xs text-rose-300">
                                        ไม่พบ QR กรุณาปิดแล้วลองใหม่
                                    </p>
                                )}
                                <p className="text-xs text-slate-300">
                                    สแกนด้วยแอปธนาคารเพื่อชำระเงิน
                                    ระบบจะเปิดสิทธิ์ให้อัตโนมัติ
                                </p>
                                {checkout.expiresAt && (
                                    <p className="text-[11px] text-slate-500">
                                        QR หมดอายุ{' '}
                                        {fmtDateTime(checkout.expiresAt)}
                                    </p>
                                )}
                                <p className="text-[11px] text-amber-300 animate-pulse">
                                    กำลังรอการชำระเงิน...
                                </p>
                            </>
                        )}
                        {checkoutState === 'succeeded' && (
                            <>
                                <p className="text-3xl">✅</p>
                                <p className="text-sm font-bold text-emerald-300">
                                    ชำระเงินสำเร็จ เปิดสิทธิ์ VIP แล้ว
                                </p>
                                <button
                                    onClick={closeCheckout}
                                    className="w-full bg-slate-700 hover:bg-slate-600 text-white font-bold py-2.5 rounded-xl text-xs cursor-pointer"
                                >
                                    ปิด
                                </button>
                            </>
                        )}
                        {checkoutState === 'failed' && (
                            <>
                                <p className="text-sm font-bold text-rose-300">
                                    การชำระเงินไม่สำเร็จหรือ QR หมดอายุ
                                </p>
                                <button
                                    onClick={() => {
                                        closeCheckout();
                                        setShowVipModal(true);
                                    }}
                                    className="w-full bg-slate-700 hover:bg-slate-600 text-white font-bold py-2.5 rounded-xl text-xs cursor-pointer"
                                >
                                    ลองใหม่
                                </button>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* Lightbox Gallery */}
            {lightboxIndex && (
                <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-[70] flex flex-col">
                    <div className="flex items-center justify-between p-4 border-b border-white/10">
                        <div className="text-white text-sm font-bold">
                            {lightboxIndex.index + 1} /{' '}
                            {lightboxIndex.items.length}
                            {lightboxIndex.items[lightboxIndex.index]
                                ?.type === 'video' ? (
                                <span className="ml-2 text-xs bg-rose-500 px-2 py-0.5 rounded">
                                    🎬 วิดีโอ
                                </span>
                            ) : (
                                <span className="ml-2 text-xs bg-sky-500 px-2 py-0.5 rounded">
                                    📷 รูปภาพ
                                </span>
                            )}
                        </div>
                        <button
                            onClick={() => setLightboxIndex(null)}
                            className="text-white hover:bg-white/20 w-10 h-10 rounded-full flex items-center justify-center cursor-pointer transition"
                            aria-label="ปิด"
                        >
                            ✕
                        </button>
                    </div>

                    <div className="flex-1 flex items-center justify-center p-4 relative">
                        {lightboxIndex.items.length > 1 && (
                            <button
                                onClick={() =>
                                    setLightboxIndex({
                                        items: lightboxIndex.items,
                                        index:
                                            (lightboxIndex.index -
                                                1 +
                                                lightboxIndex.items.length) %
                                            lightboxIndex.items.length,
                                    })
                                }
                                className="absolute left-4 top-1/2 -translate-y-1/2 bg-white/10 hover:bg-white/30 text-white w-12 h-12 rounded-full flex items-center justify-center cursor-pointer transition text-2xl"
                                aria-label="ก่อนหน้า"
                            >
                                ‹
                            </button>
                        )}

                        <div className="max-w-6xl max-h-full flex items-center justify-center">
                            {lightboxIndex.items[lightboxIndex.index]
                                ?.type === 'video' ? (
                                <video
                                    key={lightboxIndex.index}
                                    src={
                                        lightboxIndex.items[
                                            lightboxIndex.index
                                        ].url
                                    }
                                    controls
                                    autoPlay
                                    playsInline
                                    className="max-w-full max-h-[80vh] rounded-xl shadow-2xl"
                                />
                            ) : (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                    key={lightboxIndex.index}
                                    src={
                                        lightboxIndex.items[
                                            lightboxIndex.index
                                        ].url
                                    }
                                    alt={`media-${lightboxIndex.index}`}
                                    className="max-w-full max-h-[80vh] rounded-xl shadow-2xl object-contain"
                                />
                            )}
                        </div>

                        {lightboxIndex.items.length > 1 && (
                            <button
                                onClick={() =>
                                    setLightboxIndex({
                                        items: lightboxIndex.items,
                                        index:
                                            (lightboxIndex.index + 1) %
                                            lightboxIndex.items.length,
                                    })
                                }
                                className="absolute right-4 top-1/2 -translate-y-1/2 bg-white/10 hover:bg-white/30 text-white w-12 h-12 rounded-full flex items-center justify-center cursor-pointer transition text-2xl"
                                aria-label="ถัดไป"
                            >
                                ›
                            </button>
                        )}
                    </div>

                    {lightboxIndex.items.length > 1 && (
                        <div className="p-4 border-t border-white/10 overflow-x-auto">
                            <div className="flex gap-2 justify-center">
                                {lightboxIndex.items.map((m, i) => (
                                    <button
                                        key={i}
                                        onClick={() =>
                                            setLightboxIndex({
                                                items: lightboxIndex.items,
                                                index: i,
                                            })
                                        }
                                        className={`w-16 h-16 shrink-0 rounded-lg overflow-hidden border-2 transition cursor-pointer ${
                                            i === lightboxIndex.index
                                                ? 'border-amber-400 ring-2 ring-amber-400/50'
                                                : 'border-white/20 hover:border-white/50'
                                        }`}
                                    >
                                        {m.type === 'video' ? (
                                            <video
                                                src={m.url}
                                                muted
                                                className="w-full h-full object-cover"
                                            />
                                        ) : (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img
                                                src={m.url}
                                                alt={`thumb-${i}`}
                                                className="w-full h-full object-cover"
                                            />
                                        )}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
