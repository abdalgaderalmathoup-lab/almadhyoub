// ============================================================
// محاسب المذيوب — نظام محاسبي متكامل
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, initializeFirestore, persistentLocalCache, collection, doc, setDoc, deleteDoc, onSnapshot, query, getDocs } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyBRFXVq_GU3OMOHTp8SMo1KRKFW0o-TowU",
    authDomain: "almadhyoub-app.firebaseapp.com",
    projectId: "almadhyoub-app",
    storageBucket: "almadhyoub-app.firebasestorage.app",
    messagingSenderId: "440549958032",
    appId: "1:440549958032:web:7b50055281601ab5461315"
};
const ADMIN_EMAIL = "abdalgaderalmathoup@gmail.com";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = initializeFirestore(app, { localCache: persistentLocalCache() });
let currentUser = null;

// ============================================================
// 1. الأدوات المساعدة
// ============================================================
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const fmt = n => { const v = Number(n); return isFinite(v) ? v.toFixed(2) : '0.00'; };
const fmt0 = n => { const v = Number(n); return isFinite(v) ? Math.round(v).toLocaleString('en-US') : '0'; };
const today = () => new Date().toISOString();
const dstr = iso => { try { return new Date(iso).toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' }); } catch { return ''; } };
const dstrT = iso => { try { return new Date(iso).toLocaleString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
const CURR_SYM = { USD: '$', YER: 'ر.ي', SAR: 'ر.س' };

function toast(msg, type = 'info') {
    const wrap = $('toast-wrap');
    const colors = { success: 't-success', error: 't-error', info: 't-info', warning: 't-warning' };
    const icons = { success: 'fa-check-circle', error: 'fa-exclamation-circle', info: 'fa-info-circle', warning: 'fa-exclamation-triangle' };
    const t = document.createElement('div');
    t.className = 'toast ' + (colors[type] || 't-info');
    t.innerHTML = `<i class="fas ${icons[type] || icons.info}"></i><span>${esc(msg)}</span>`;
    wrap.appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 350); }, 2600);
}

// تحويل مبلغ من عملة إلى دولار
function toUSD(amount, curr) {
    if (curr === 'USD') return amount;
    if (curr === 'YER') return amount / DB.rates.YER;
    if (curr === 'SAR') return amount / DB.rates.SAR;
    return amount;
}
function fromUSD(amount, curr) {
    if (curr === 'USD') return amount;
    if (curr === 'YER') return amount * DB.rates.YER;
    if (curr === 'SAR') return amount * DB.rates.SAR;
    return amount;
}

// ============================================================
// 2. قاعدة البيانات المحلية + Firestore
// ============================================================
const COLS = ['items', 'sales', 'purch', 'vouchers', 'transfers', 'journal', 'customers', 'suppliers', 'expenses', 'payments', 'accounts'];
const DB = {
    items: [], sales: [], purch: [], vouchers: [], transfers: [], journal: [],
    customers: [], suppliers: [], expenses: [], payments: [], accounts: [],
    rates: { YER: 530, SAR: 3.75 }
};
let unsubs = [];

// ============================================================
// 2.5 التخزين المحلي (وضع الضيف — بدون حساب)
// ============================================================
function persistLocal(col) {
    try { localStorage.setItem('alm_local_' + col, JSON.stringify(DB[col])); } catch {}
}
function persistAllLocal() { COLS.forEach(persistLocal); }
function loadLocalData() {
    COLS.forEach(c => {
        try {
            const v = localStorage.getItem('alm_local_' + c);
            DB[c] = v ? JSON.parse(v) : [];
        } catch { DB[c] = []; }
        sortCol(c);
    });
    try { const l = JSON.parse(localStorage.getItem('alm_rates')); if (l) DB.rates = { ...DB.rates, ...l }; } catch {}
}
loadLocalData();

// شجرة الحسابات الافتراضية (لا تُحذف — الحسابات المخصصة تُضاف من مجموعة accounts)
const DEFAULT_ACCOUNTS = [
    { code: '101', name: 'الصندوق الرئيسي', type: 'الأصول' },
    { code: '102', name: 'العملاء (ذمم مدينة)', type: 'الأصول' },
    { code: '103', name: 'المخزون', type: 'الأصول' },
    { code: '104', name: 'البنك', type: 'الأصول' },
    { code: '201', name: 'الموردون (ذمم دائنة)', type: 'الالتزامات' },
    { code: '202', name: 'القروض', type: 'الالتزامات' },
    { code: '301', name: 'رأس المال', type: 'حقوق الملكية' },
    { code: '302', name: 'مسحوبات المالك', type: 'حقوق الملكية' },
    { code: '401', name: 'المبيعات', type: 'الإيرادات' },
    { code: '402', name: 'إيرادات أخرى', type: 'الإيرادات' },
    { code: '501', name: 'تكلفة البضاعة المباعة', type: 'المصروفات' },
    { code: '502', name: 'مصاريف تشغيلية', type: 'المصروفات' },
    { code: '503', name: 'رواتب وأجور', type: 'المصروفات' },
    { code: '504', name: 'إيجار', type: 'المصروفات' },
    { code: '505', name: 'كهرباء وماء واتصالات', type: 'المصروفات' },
    { code: '506', name: 'مواصلات ونقل', type: 'المصروفات' },
    { code: '507', name: 'مصروفات متنوعة', type: 'المصروفات' }
];
const allAccounts = () => [...DEFAULT_ACCOUNTS, ...DB.accounts];
const accByCode = code => allAccounts().find(a => a.code === code);

const NORMAL_SIDE = { 'الأصول': 'D', 'المصروفات': 'D', 'الالتزامات': 'C', 'حقوق الملكية': 'C', 'الإيرادات': 'C' };

function startListeners(uid) {
    unsubs.forEach(u => u()); unsubs = [];
    COLS.forEach(col => {
        const unsub = onSnapshot(query(collection(db, 'users', uid, col)), snap => {
            DB[col] = [];
            snap.forEach(d => DB[col].push(d.data()));
            sortCol(col);
            persistLocal(col);
            renderAll();
        }, err => console.error(col, err));
        unsubs.push(unsub);
    });
    // إعدادات (أسعار الصرف)
    const unsubSet = onSnapshot(doc(db, 'users', uid, 'settings', 'main'), snap => {
        if (snap.exists()) {
            const r = snap.data().rates;
            if (r) { DB.rates.YER = r.YER || 530; DB.rates.SAR = r.SAR || 3.75; try { localStorage.setItem('alm_rates', JSON.stringify(DB.rates)); } catch {} }
        } else {
            try { const l = JSON.parse(localStorage.getItem('alm_rates')); if (l) DB.rates = { ...DB.rates, ...l }; } catch {}
        }
        renderAll();
    }, () => {});
    unsubs.push(unsubSet);
}

function sortCol(col) {
    if (['items', 'customers', 'suppliers', 'accounts'].includes(col)) return;
    DB[col].sort((a, b) => (b.id || 0) - (a.id || 0));
}

async function saveToCloud(col, id, data) {
    const key = String(id);
    const idx = DB[col].findIndex(x => String(x.id ?? x.code) === key);
    if (idx > -1) DB[col][idx] = data; else DB[col].push(data);
    sortCol(col); renderAll();
    persistLocal(col);
    if (!currentUser) return;
    try { await setDoc(doc(db, 'users', currentUser.uid, col, key), data); }
    catch (e) { console.error(e); toast('حُفظ محلياً — بانتظار الاتصال', 'warning'); }
}

async function deleteFromCloud(col, id) {
    DB[col] = DB[col].filter(x => String(x.id ?? x.code) !== String(id));
    renderAll();
    persistLocal(col);
    if (!currentUser) return;
    try { await deleteDoc(doc(db, 'users', currentUser.uid, col, String(id))); }
    catch (e) { console.error(e); toast('فشل الحذف', 'error'); }
}

// رفع كل البيانات المحلية إلى Firestore (عند تسجيل الدخول من وضع الضيف)
async function pushLocalToCloud(uid) {
    let total = 0;
    for (const col of COLS) {
        for (const d of DB[col]) {
            const key = String(d.id ?? d.code);
            try { await setDoc(doc(db, 'users', uid, col, key), d); total++; }
            catch (e) { console.error('push failed', col, key, e); }
        }
    }
    try { await setDoc(doc(db, 'users', uid, 'settings', 'main'), { rates: DB.rates }); } catch {}
    if (total) toast('تمت مزامنة ' + total + ' سجل إلى حسابك', 'success');
}

function nextNo(prefix, col, field) {
    let max = 1000;
    DB[col].forEach(d => {
        const n = parseInt(String(d[field] || '').split('-')[1]);
        if (!isNaN(n) && n > max) max = n;
    });
    return prefix + '-' + (max + 1);
}

// ============================================================
// 3. محرك الأرصدة المحاسبية (مدين - دائن، الموجب = مدين)
// ============================================================
// بنية الفاتورة الموحدة (تدعم الصيغة القديمة ذات السطر الواحد)
function invLines(d) {
    if (Array.isArray(d.items) && d.items.length) return d.items;
    if (d.itemCode) return [{ code: d.itemCode, name: d.itemName, qty: d.qty || 0, priceUSD: d.priceUSD || 0, costUSD: d.costUSD || 0, amtUSD: d.amtUSD || 0 }];
    return [];
}

function computeBalances() {
    const bal = {};
    const add = (code, amt) => { bal[code] = (bal[code] || 0) + amt; };

    DB.sales.forEach(s => {
        const amt = s.amtUSD || 0;
        const cost = invLines(s).reduce((t, l) => t + (l.costUSD || 0) * (l.qty || 0), 0);
        if (s.payType === 'CREDIT') add('102', amt); else add('101', amt);
        add('401', -amt);            // إيراد = دائن
        add('103', -cost);           // مخزون ينقص = دائن
        add('501', cost);            // تكلفة = مدين
    });
    DB.purch.forEach(p => {
        const amt = p.amtUSD || 0;
        const cost = invLines(p).reduce((t, l) => t + (l.costUSD || 0) * (l.qty || 0), 0);
        if (p.payType === 'CREDIT') add('201', -amt); else add('101', -amt);
        add('103', cost);
    });
    DB.vouchers.forEach(v => add(v.accCode || '101', (v.type === 'RECEIPT' ? 1 : -1) * (v.amtUSD || 0)));
    DB.transfers.forEach(t => { add(t.toCode, t.amtUSD || 0); add(t.fromCode, -(t.amtUSD || 0)); });
    DB.expenses.forEach(x => {
        add(x.accCode || '507', (x.amtUSD || 0));       // مصروف = مدين
        add(x.paidFrom || '101', -(x.amtUSD || 0));     // من نقداً = دائن
    });
    DB.payments.forEach(p => {
        const amt = p.amtUSD || 0;
        if (p.partyType === 'customer') { add(p.accCode || '101', amt); add('102', -amt); }
        else { add(p.accCode || '101', -amt); add('201', amt); }
    });
    DB.journal.forEach(j => {
        if (Array.isArray(j.lines)) {
            j.lines.forEach(l => { add(l.acc, (l.debit || 0) - (l.credit || 0)); });
        } else if (j.accCode) {
            // صيغة قديمة: إيداع/سحب
            add(j.accCode, (j.type === 'DEPOSIT' ? 1 : -1) * (j.amtUSD || 0));
        }
    });
    return bal;
}

function accBalance(code) { return computeBalances()[code] || 0; }

function partyBalances() {
    const cust = {}, supp = {};
    DB.sales.forEach(s => {
        if (s.payType !== 'CREDIT') return;
        const n = (s.customer || 'بدون اسم').trim();
        cust[n] = (cust[n] || 0) + (s.amtUSD || 0);
    });
    DB.purch.forEach(p => {
        if (p.payType !== 'CREDIT') return;
        const n = (p.supplier || 'بدون اسم').trim();
        supp[n] = (supp[n] || 0) + (p.amtUSD || 0);
    });
    DB.payments.forEach(p => {
        const map = p.partyType === 'customer' ? cust : supp;
        const n = (p.party || 'بدون اسم').trim();
        map[n] = (map[n] || 0) - (p.amtUSD || 0);
    });
    return { customers: cust, suppliers: supp };
}

// ============================================================
// 4. التنقل والعرض
// ============================================================
const VIEW_TITLES = {
    home: 'الرئيسية', sales: 'المبيعات', purchases: 'المشتريات', inventory: 'المخزون',
    accounts: 'الحسابات', reports: 'التقارير', expenses: 'المصروفات',
    customers: 'العملاء', suppliers: 'الموردون', transactions: 'سجل العمليات', admin: 'الإدارة'
};
const VIEW_RENDER = {
    home: renderHome, sales: renderSales, purchases: renderPurchases, inventory: renderItems,
    accounts: renderAccountsPage, reports: renderReports, expenses: renderExpenses,
    customers: renderCustomers, suppliers: renderSuppliers, transactions: renderTransactions, admin: renderAdmin
};

function showView(name) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const el = $('view-' + name);
    if (el) el.classList.add('active');
    document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === name));
    $('header-title').textContent = VIEW_TITLES[name] || '';
    toggleDrawer(false);
    if (VIEW_RENDER[name]) VIEW_RENDER[name]();
    document.querySelector('.pages').scrollTop = 0;
}
const go = showView;
window.showView = showView;
window.go = go;

function toggleDrawer(open) {
    $('drawerOverlay').classList.toggle('open', open === true);
}
window.toggleDrawer = toggleDrawer;

// ============================================================
// 5. النوافذ المنبثقة (Modal builder)
// ============================================================
function openModal({ title, icon = 'fa-edit', body, foot = '', wide = false }) {
    const root = $('modal-root');
    root.innerHTML = `
        <div class="modal-overlay open" id="m-overlay">
            <div class="modal" ${wide ? 'style="max-width:760px"' : ''}>
                <div class="modal-head">
                    <div class="modal-title"><i class="fas ${icon}"></i>${esc(title)}</div>
                    <button class="modal-close" onclick="closeModal()"><i class="fas fa-times"></i></button>
                </div>
                <div class="modal-body">${body}</div>
                ${foot ? `<div class="modal-foot">${foot}</div>` : ''}
            </div>
        </div>`;
    $('m-overlay').addEventListener('click', e => { if (e.target.id === 'm-overlay') closeModal(); });
}
function closeModal() { stopCamera(); $('modal-root').innerHTML = ''; }
window.closeModal = closeModal;

function acctOptions(sel, types) {
    return allAccounts()
        .filter(a => !types || types.includes(a.type))
        .map(a => `<option value="${a.code}" ${a.code === sel ? 'selected' : ''}>${a.code} — ${esc(a.name)}</option>`).join('');
}
function currOptions(sel) {
    return ['USD', 'YER', 'SAR'].map(c => `<option value="${c}" ${c === sel ? 'selected' : ''}>${c} (${CURR_SYM[c]})</option>`).join('');
}
function partyOptions(list, sel) {
    return list.map(p => `<option value="${esc(p.name)}" ${p.name === sel ? 'selected' : ''}>${esc(p.name)}${p.phone ? ' — ' + esc(p.phone) : ''}</option>`).join('');
}

// ============================================================
// 5.5 ماسح الباركود بالكاميرا (BarcodeDetector API)
// ============================================================
let scannerStream = null;
function stopCamera() {
    if (scannerStream) { scannerStream.getTracks().forEach(t => t.stop()); scannerStream = null; }
}

async function openBarcodeScanner() {
    if (!('BarcodeDetector' in window)) {
        return toast('المتصفح لا يدعم المسح بالكاميرا — أدخل الباركود يدوياً', 'warning');
    }
    if (!navigator.mediaDevices?.getUserMedia) {
        return toast('الكاميرا غير متاحة في هذا المتصفح', 'error');
    }
    try {
        const supported = await BarcodeDetector.getSupportedFormats();
        const formats = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'code_93', 'qr_code', 'data_matrix']
            .filter(f => supported.includes(f));
        if (!formats.length) return toast('لا توجد صيغ باركود مدعومة', 'warning');

        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        scannerStream = stream;
        const detector = new BarcodeDetector({ formats });

        openModal({
            title: 'مسح الباركود', icon: 'fa-barcode',
            body: `<div style="border-radius:12px;overflow:hidden;background:#000"><video id="scan-video" autoplay playsinline muted style="width:100%;display:block"></video></div>
                   <p style="text-align:center;margin-top:12px;color:var(--muted);font-size:12.5px">وجّه الكاميرا نحو الباركود — سيُملأ الحقل تلقائياً</p>`,
            foot: `<button class="btn btn-ghost" onclick="closeModal()">إغلاق</button>`
        });

        const video = $('scan-video');
        video.srcObject = stream;

        const tick = async () => {
            if (!scannerStream || !video.videoWidth) { requestAnimationFrame(tick); return; }
            try {
                const codes = await detector.detect(video);
                if (codes.length) {
                    const val = codes[0].rawValue;
                    stopCamera();
                    closeModal();
                    const inp = $('f-item-code');
                    if (inp) { inp.value = val; inp.focus(); }
                    toast('تم مسح الباركود: ' + val, 'success');
                    return;
                }
            } catch {}
            requestAnimationFrame(tick);
        };
        video.onloadedmetadata = () => tick();
    } catch (e) {
        stopCamera();
        toast('تعذر فتح الكاميرا — تحقق من الأذونات', 'error');
    }
}
window.openBarcodeScanner = openBarcodeScanner;

// ============================================================
// 6. لوحة التحكم
// ============================================================
function renderHome() {
    $('home-date').textContent = new Date().toLocaleDateString('ar-EG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const bal = computeBalances();
    const pb = partyBalances();
    const cash = bal['101'] || 0;
    const receivable = Math.max(0, pb.customers && Object.values(pb.customers).reduce((s, v) => s + Math.max(0, v), 0));
    const payable = Math.max(0, Object.values(pb.suppliers).reduce((s, v) => s + Math.max(0, v), 0));

    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const mSales = DB.sales.filter(s => new Date(s.date) >= monthStart).reduce((s, x) => s + (x.amtUSD || 0), 0);
    const mPurch = DB.purch.filter(p => new Date(p.date) >= monthStart).reduce((s, x) => s + (x.amtUSD || 0), 0);
    const mExp = DB.expenses.filter(x => new Date(x.date) >= monthStart).reduce((s, x) => s + (x.amtUSD || 0), 0);

    $('home-stats').innerHTML = `
        <div class="stat-card c-green"><div class="stat-label">💰 رصيد الصندوق</div><div class="stat-value">$${fmt(cash)}</div></div>
        <div class="stat-card c-blue"><div class="stat-label">📈 مبيعات الشهر</div><div class="stat-value">$${fmt(mSales)}</div></div>
        <div class="stat-card c-amber"><div class="stat-label">📦 مشتريات الشهر</div><div class="stat-value">$${fmt(mPurch)}</div></div>
        <div class="stat-card c-red"><div class="stat-label">🧾 مصروفات الشهر</div><div class="stat-value">$${fmt(mExp)}</div></div>
        <div class="stat-card c-purple"><div class="stat-label">👥 ذمم العملاء</div><div class="stat-value">$${fmt(receivable)}</div></div>
        <div class="stat-card c-cyan"><div class="stat-label">🚚 ذمم الموردين</div><div class="stat-value">$${fmt(payable)}</div></div>`;

    // تنبيهات المخزون
    const low = DB.items.filter(i => (i.qty || 0) <= (i.minQty || 0));
    $('home-alerts').innerHTML = low.length
        ? `<div class="alert-bar"><i class="fas fa-exclamation-triangle"></i> ${low.length} صنف الحد الأدنى: ${low.slice(0, 3).map(i => esc(i.name)).join('، ')}${low.length > 3 ? '...' : ''}</div>`
        : '';

    // آخر العمليات
    const all = [];
    const push = (arr, kind, label, no, party, amt, date) => arr.forEach(x => all.push({ kind, label, no, party, amt, date }));
    DB.sales.forEach(s => all.push({ kind: 'SALES', label: 'مبيعات', no: s.invNo, party: s.customer, amt: s.display || ('$' + fmt(s.amtUSD)), date: s.date }));
    DB.purch.forEach(p => all.push({ kind: 'PURCH', label: 'مشتريات', no: p.invNo, party: p.supplier, amt: p.display || ('$' + fmt(p.amtUSD)), date: p.date }));
    DB.expenses.forEach(x => all.push({ kind: 'EXPENSE', label: 'مصروف', no: x.expNo, party: x.notes || x.accName, amt: x.display || ('$' + fmt(x.amtUSD)), date: x.date }));
    DB.vouchers.forEach(v => all.push({ kind: 'VOUCHER', label: v.type === 'RECEIPT' ? 'سند قبض' : 'سند صرف', no: v.vouchNo, party: v.party, amt: v.display || ('$' + fmt(v.amtUSD)), date: v.date }));
    all.sort((a, b) => new Date(b.date) - new Date(a.date));
    $('home-recent').innerHTML = all.length === 0
        ? '<p class="empty-state" style="padding:20px">لا توجد عمليات بعد — ابدأ بإنشاء أول فاتورة</p>'
        : all.slice(0, 8).map(o => `
            <div class="doc-item" onclick="txDetail('${o.kind}', '${esc(o.no)}')">
                <div class="di-main"><div class="di-no">${esc(o.no)} <span class="badge b-blue">${o.label}</span></div>
                <div class="di-sub">${esc(o.party || '')} — ${dstrT(o.date)}</div></div>
                <div class="di-amt">${esc(o.amt)}</div>
            </div>`).join('');
}

// ============================================================
// 7. الأصناف والمخزون
// ============================================================
const jsq = s => `'${String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

function openItemForm(item) {
    const isEdit = !!item;
    openModal({
        title: isEdit ? 'تعديل الصنف' : 'صنف جديد', icon: 'fa-box',
        body: `
            <div class="form-grid">
                <div class="fgroup"><label class="flabel">اسم الصنف *</label><input class="finput" id="f-item-name" value="${esc(item?.name || '')}" placeholder="مثال: أرز بسمتي 5كجم"></div>
                <div class="fgroup"><label class="flabel">الباركود / الكود *</label>
                    <div style="display:flex;gap:6px">
                        <input class="finput" id="f-item-code" value="${esc(item?.code || '')}" ${isEdit ? 'readonly' : ''} placeholder="6281000000001">
                        ${isEdit ? '' : `<button type="button" class="btn btn-soft" onclick="openBarcodeScanner()" title="مسح باركود بالكاميرا" style="padding:11px 14px"><i class="fas fa-barcode"></i></button>`}
                    </div>
                </div>
                <div class="fgroup"><label class="flabel">سعر البيع ($) *</label><input class="finput" type="number" step="0.01" min="0" id="f-item-price" value="${item?.priceUSD ?? ''}"></div>
                <div class="fgroup"><label class="flabel">سعر التكلفة ($) *</label><input class="finput" type="number" step="0.01" min="0" id="f-item-cost" value="${item?.costUSD ?? ''}"></div>
                <div class="fgroup"><label class="flabel">الكمية الحالية</label><input class="finput" type="number" min="0" id="f-item-qty" value="${item?.qty ?? 0}"></div>
                <div class="fgroup"><label class="flabel">حد النقص (تنبيه)</label><input class="finput" type="number" min="0" id="f-item-min" value="${item?.minQty ?? 5}"></div>
                <div class="fgroup"><label class="flabel">الوحدة الأساسية</label><input class="finput" id="f-item-unit" value="${esc(item?.unit || 'قطعة')}"></div>
                <div class="fgroup"><label class="flabel">وحدة تعبئة (اختياري)</label><input class="finput" id="f-item-pack" value="${esc(item?.packName || '')}" placeholder="مثال: كرتون"></div>
                <div class="fgroup"><label class="flabel">عدد الوحدات في التعبئة</label><input class="finput" type="number" min="0" id="f-item-packqty" value="${item?.packQty ?? 0}" placeholder="مثال: 24"></div>
                <div class="fgroup full"><label class="flabel">ملاحظة</label><input class="finput" id="f-item-note" value="${esc(item?.note || '')}" placeholder="وصف إضافي للصنف"></div>
            </div>`,
        foot: `<button class="btn btn-ghost" onclick="closeModal()">إلغاء</button>
               <button class="btn btn-primary" onclick="saveItem(${isEdit ? jsq(item.code) : 'null'})">${isEdit ? 'حفظ التعديل' : 'حفظ الصنف'}</button>`
    });
}
window.jsq = jsq;

async function saveItem(editCode) {
    const code = $('f-item-code').value.trim();
    const name = $('f-item-name').value.trim();
    const priceUSD = parseFloat($('f-item-price').value);
    const costUSD = parseFloat($('f-item-cost').value);
    const qty = parseInt($('f-item-qty').value) || 0;
    const minQty = parseInt($('f-item-min').value) || 0;
    const unit = $('f-item-unit').value.trim() || 'قطعة';
    const packName = $('f-item-pack').value.trim();
    const packQty = parseInt($('f-item-packqty').value) || 0;
    const note = $('f-item-note').value.trim();
    if (!code || !name) return toast('أدخل الاسم والكود', 'error');
    if (!isFinite(priceUSD) || !isFinite(costUSD) || priceUSD < 0 || costUSD < 0) return toast('أسعار غير صحيحة', 'error');

    if (editCode) {
        const it = DB.items.find(i => i.code === editCode);
        if (!it) return;
        await saveToCloud('items', editCode, { ...it, name, priceUSD, costUSD, qty, minQty, unit, packName, packQty, note });
    } else {
        if (DB.items.some(i => i.code === code)) return toast('الكود مستخدم مسبقاً', 'error');
        await saveToCloud('items', code, { code, name, priceUSD, costUSD, qty, minQty, unit, packName, packQty, note });
    }
    closeModal(); toast('تم الحفظ', 'success');
}
window.openItemForm = openItemForm;
window.editItemAt = i => openItemForm(DB.items[i]);
window.delItemAt = i => { const it = DB.items[i]; if (it) delItem(it.code); };
window.saveItem = saveItem;

function renderItems() {
    const q = ($('items-search')?.value || '').toLowerCase();
    let items = DB.items;
    if (q) items = items.filter(i => (i.name || '').toLowerCase().includes(q) || (i.code || '').toLowerCase().includes(q));

    const low = DB.items.filter(i => (i.qty || 0) <= (i.minQty || 0));
    $('items-alerts').innerHTML = low.length
        ? `<div class="alert-bar"><i class="fas fa-exclamation-triangle"></i> ${low.length} صنف تحت الحد الأدنى — راجع المخزون</div>` : '';

    $('items-tbody').innerHTML = items.length === 0
        ? '<tr><td colspan="6"><p class="empty-state" style="padding:20px">لا توجد أصناف</p></td></tr>'
        : items.map(i => {
            const isLow = (i.qty || 0) <= (i.minQty || 0);
            return `<tr>
                <td><strong>${esc(i.name)}</strong><br><small style="color:var(--muted)">${esc(i.unit || 'قطعة')}${i.packName && i.packQty ? ` • ${esc(i.packName)} = ${i.packQty}` : ''}</small></td>
                <td class="num">${esc(i.code)}</td>
                <td class="num" style="${isLow ? 'color:var(--danger);font-weight:800' : ''}">${fmt0(i.qty || 0)} ${isLow ? '⚠️' : ''}</td>
                <td class="num">$${fmt(i.priceUSD)}</td>
                <td class="num">$${fmt(i.costUSD)}</td>
                <td style="white-space:nowrap">
                    <button class="btn btn-soft btn-sm" onclick="editItemAt(${DB.items.indexOf(i)})"><i class="fas fa-edit"></i></button>
                    <button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="delItemAt(${DB.items.indexOf(i)})"><i class="fas fa-trash"></i></button>
                </td></tr>`;
        }).join('');
}
window.renderItems = renderItems;

async function delItem(code) {
    if (!confirm('حذف الصنف نهائياً؟')) return;
    const used = DB.sales.some(s => invLines(s).some(l => l.code === code)) || DB.purch.some(p => invLines(p).some(l => l.code === code));
    if (used) return toast('لا يمكن حذف صنف له حركات سابقة', 'error');
    await deleteFromCloud('items', code);
    toast('تم الحذف', 'success');
}
window.delItem = delItem;

// ============================================================
// 8. فواتير المبيعات والمشتريات (متعددة الأصناف)
// ============================================================
let invState = { type: 'sale', lines: [], editId: null };

// وحدات البيع المتاحة للصنف: الوحدة الأساسية + وحدة التعبئة إن وجدت
function lineUnits(it) {
    const units = [{ u: it?.unit || 'قطعة', f: 1 }];
    if (it && it.packName && (it.packQty || 0) > 0) units.push({ u: it.packName, f: it.packQty });
    return units;
}
function lineFactor(l) {
    const it = DB.items.find(x => x.code === l.itemCode);
    const u = lineUnits(it).find(x => x.u === l.unit) || lineUnits(it)[0];
    return u ? u.f : 1;
}
function lineBaseQty(l) { return (l.qty || 0) * lineFactor(l); }
function lineUnitPriceUSD(l) {
    const it = DB.items.find(x => x.code === l.itemCode);
    if (!it) return 0;
    const p = invState.type === 'sale' ? it.priceUSD : it.costUSD;
    return p * lineFactor(l);
}

function openInvoiceForm(type, doc = null) {
    invState = { type, lines: [], editId: doc ? doc.id : null };
    const isSale = type === 'sale';
    const partyLabel = isSale ? 'العميل' : 'المورد';
    const partyList = isSale ? DB.customers : DB.suppliers;
    openModal({
        title: (doc ? 'تعديل ' : '') + (isSale ? 'فاتورة مبيعات' : 'فاتورة مشتريات'),
        icon: isSale ? 'fa-shopping-cart' : 'fa-cart-arrow-down', wide: true,
        body: `
            <div class="form-grid">
                <div class="fgroup"><label class="flabel">${partyLabel} *</label>
                    <input class="finput" id="inv-party" list="inv-party-list" placeholder="اكتب أو اختر ${partyLabel}" required>
                    <datalist id="inv-party-list">${partyOptions(partyList)}</datalist>
                </div>
                <div class="fgroup"><label class="flabel">نوع الدفع</label>
                    <select class="fselect" id="inv-pay"><option value="CASH">نقداً</option><option value="CREDIT">آجل (ذمم)</option></select>
                </div>
                <div class="fgroup"><label class="flabel">العملة</label>
                    <select class="fselect" id="inv-curr" onchange="invRecalc()">${currOptions('USD')}</select>
                </div>
                <div class="fgroup"><label class="flabel">تاريخ الفاتورة</label>
                    <input class="finput" type="date" id="inv-date" value="${new Date().toISOString().slice(0, 10)}">
                </div>
                <div class="fgroup full"><label class="flabel">ملاحظات</label><input class="finput" id="inv-notes" placeholder="اختياري"></div>
            </div>
            <div class="card-title" style="margin-top:6px"><i class="fas fa-list"></i>الأصناف</div>
            <div class="inv-lines" id="inv-lines"></div>
            <button class="add-line-btn" onclick="invAddLine()"><i class="fas fa-plus"></i> إضافة صنف آخر</button>
            <div class="inv-total-bar"><span class="t-label">الإجمالي</span><span class="t-val" id="inv-total">$0.00</span></div>
            <div style="font-size:12px;color:var(--muted)" id="inv-rate-note"></div>`,
        foot: `<button class="btn btn-ghost" onclick="closeModal()">إلغاء</button>
               <button class="btn ${isSale ? 'btn-success' : 'btn-warning'}" onclick="saveInvoice()"><i class="fas fa-save"></i> ${doc ? 'حفظ التعديل' : 'حفظ الفاتورة'}</button>`
    });
    if (doc) {
        $('inv-party').value = isSale ? (doc.customer || '') : (doc.supplier || '');
        $('inv-pay').value = doc.payType || 'CASH';
        $('inv-curr').value = doc.curr || 'USD';
        $('inv-date').value = (doc.date || '').slice(0, 10);
        $('inv-notes').value = doc.notes || '';
        invState.lines = invLines(doc).map(l => ({
            itemCode: l.code,
            qty: l.qtyIn || l.qty || 1,
            unit: l.unit || (DB.items.find(x => x.code === l.code)?.unit || 'قطعة')
        }));
        if (!invState.lines.length) invState.lines = [{ itemCode: '', qty: 1, unit: 'قطعة' }];
    } else {
        invState.lines = [{ itemCode: '', qty: 1, unit: 'قطعة' }];
    }
    renderInvLines();
}
window.openInvoiceForm = openInvoiceForm;
window.editInvoice = (kind, id) => {
    const col = kind === 'sales' ? 'sales' : 'purch';
    const d = DB[col].find(x => x.id === id);
    if (d) openInvoiceForm(kind === 'sales' ? 'sale' : 'purch', d);
};

function invItems() { return DB.items; }

function invAddLine() {
    invState.lines.push({ itemCode: '', qty: 1, unit: 'قطعة' });
    renderInvLines();
}
window.invAddLine = invAddLine;

function invDelLine(i) {
    if (invState.lines.length <= 1) return toast('يجب وجود صنف واحد على الأقل', 'warning');
    invState.lines.splice(i, 1);
    renderInvLines();
}
window.invDelLine = invDelLine;

function renderInvLines() {
    const isSale = invState.type === 'sale';
    $('inv-lines').innerHTML = invState.lines.map((l, i) => {
        const it = DB.items.find(x => x.code === l.itemCode);
        const opts = invItems().map(it2 => `<option value="${esc(it2.code)}" ${it2.code === l.itemCode ? 'selected' : ''}>${esc(it2.name)} — متوفر: ${fmt0(it2.qty || 0)}</option>`).join('');
        const units = lineUnits(it);
        if (!units.find(u => u.u === l.unit)) l.unit = units[0].u;
        const priceUSD = it ? (isSale ? it.priceUSD : it.costUSD) : 0;
        const lineTotal = (l.qty || 0) * priceUSD * lineFactor(l);
        const unitOpts = units.map(u => `<option value="${esc(u.u)}" ${u.u === l.unit ? 'selected' : ''}>${esc(u.u)}${u.f > 1 ? ' ×' + u.f : ''}</option>`).join('');
        return `<div class="inv-line">
            <div class="l-item"><select class="fselect" style="padding:8px;font-size:13px" onchange="invSetItem(${i}, this.value)"><option value="">— اختر الصنف —</option>${opts}</select></div>
            <select class="fselect l-unit" onchange="invSetUnit(${i}, this.value)">${unitOpts}</select>
            <input class="l-qty" type="number" min="0.5" step="0.5" value="${l.qty}" oninput="invSetQty(${i}, this.value)">
            <div class="l-total" id="inv-lt-${i}">$${fmt(lineTotal)}</div>
            <button class="l-del" onclick="invDelLine(${i})"><i class="fas fa-times"></i></button>
        </div>`;
    }).join('');
    invRecalc();
}
window.renderInvLines = renderInvLines;

function invSetItem(i, code) {
    const it = DB.items.find(x => x.code === code);
    invState.lines[i].itemCode = code;
    if (it) invState.lines[i].unit = it.unit || 'قطعة';
    renderInvLines();
}
window.invSetItem = invSetItem;

function invSetUnit(i, u) {
    invState.lines[i].unit = u;
    renderInvLines();
}
window.invSetUnit = invSetUnit;

function invSetQty(i, v) {
    invState.lines[i].qty = parseFloat(v) || 0;
    const l = invState.lines[i];
    const el = document.getElementById('inv-lt-' + i);
    if (el) el.textContent = '$' + fmt((l.qty || 0) * lineUnitPriceUSD(l));
    invRecalc();
}
window.invSetQty = invSetQty;

function invRecalc() {
    const curr = $('inv-curr')?.value || 'USD';
    let totalUSD = 0;
    invState.lines.forEach(l => { totalUSD += (l.qty || 0) * lineUnitPriceUSD(l); });
    const conv = fromUSD(totalUSD, curr);
    const el = $('inv-total'); if (el) el.textContent = conv.toFixed(2) + ' ' + CURR_SYM[curr];
    const note = $('inv-rate-note');
    if (note) note.textContent = curr !== 'USD' ? `≈ $${fmt(totalUSD)} (سعر الصرف: 1$ = ${DB.rates[curr === 'YER' ? 'YER' : 'SAR']} ${curr === 'YER' ? 'ر.ي' : 'ر.س'})` : '';
}
window.invRecalc = invRecalc;

async function saveInvoice() {
    const isSale = invState.type === 'sale';
    const party = $('inv-party').value.trim();
    const payType = $('inv-pay').value;
    const curr = $('inv-curr').value;
    const date = $('inv-date').value || today();
    const notes = $('inv-notes').value.trim();

    if (!party) return toast('أدخل ' + (isSale ? 'العميل' : 'المورد'), 'error');
    if (!invState.lines.length || invState.lines.some(l => !l.itemCode || !(l.qty > 0))) {
        return toast('أكمل بيانات الأصناف (صنف + كمية)', 'error');
    }

    const col = isSale ? 'sales' : 'purch';
    const rate = curr === 'USD' ? 1 : (curr === 'YER' ? DB.rates.YER : DB.rates.SAR);

    // الكمية الأساسية لكل بند (الكمية المدخلة × معامل الوحدة)
    const prepared = invState.lines.map(l => {
        const it = DB.items.find(x => x.code === l.itemCode);
        const baseQty = lineBaseQty(l);
        const priceUSD = isSale ? it.priceUSD : it.costUSD;
        return { l, it, baseQty, priceUSD, amtUSD: baseQty * priceUSD };
    });

    // التحقق من المخزون للمبيعات (بالكمية الأساسية)
    if (isSale) {
        const need = {};
        prepared.forEach(p => need[p.it.code] = (need[p.it.code] || 0) + p.baseQty);
        for (const code in need) {
            const it = DB.items.find(x => x.code === code);
            if (it && it.qty < need[code]) return toast(`المخزون لا يكفي: ${it.name} (متوفر ${it.qty} ${it.unit || 'قطعة'})`, 'error');
        }
    }

    // عند التعديل: عكس حركة المخزون للفاتورة القديمة أولاً
    if (invState.editId) {
        const old = DB[col].find(x => x.id === invState.editId);
        if (old) {
            for (const ol of invLines(old)) {
                const it = DB.items.find(x => x.code === ol.code);
                if (!it) continue;
                const oq = isSale ? it.qty + (ol.qty || 0) : it.qty - (ol.qty || 0);
                if (oq < 0) return toast(`لا يمكن التعديل — رصيد ${it.name} لا يكفي لعكس الفاتورة القديمة`, 'error');
                await saveToCloud('items', it.code, { ...it, qty: oq });
            }
        }
    }

    // بناء بنود الفاتورة (تُخزن بالكمية الأساسية + كمية الوحدة المعروضة)
    const items = prepared.map(p => ({
        code: p.it.code, name: p.it.name,
        qty: p.baseQty, qtyIn: p.l.qty, unit: p.l.unit || p.it.unit || 'قطعة',
        priceUSD: p.priceUSD, costUSD: p.it.costUSD, amtUSD: p.amtUSD
    }));
    const amtUSD = items.reduce((s, l) => s + l.amtUSD, 0);
    const amtOrig = fromUSD(amtUSD, curr);

    // تطبيق حركة المخزون الجديدة
    for (const l of items) {
        const it = DB.items.find(x => x.code === l.code);
        const newQty = isSale ? it.qty - l.qty : it.qty + l.qty;
        await saveToCloud('items', it.code, { ...it, qty: newQty });
    }

    const old = invState.editId ? DB[col].find(x => x.id === invState.editId) : null;
    const id = invState.editId || Date.now();
    const docData = {
        id, date: new Date(date).toISOString(), payType, curr, notes, rate,
        amtOrig, amtUSD, display: amtOrig.toFixed(2) + ' ' + CURR_SYM[curr],
        items,
        ...(isSale ? { invNo: old?.invNo || nextNo('S', 'sales', 'invNo'), customer: party } : { invNo: old?.invNo || nextNo('P', 'purch', 'invNo'), supplier: party })
    };
    // توافق مع الصيغة القديمة
    if (items.length === 1) { docData.itemCode = items[0].code; docData.itemName = items[0].name; docData.qty = items[0].qty; docData.priceUSD = items[0].priceUSD; docData.costUSD = items[0].costUSD; docData.qtyIn = items[0].qtyIn; docData.unit = items[0].unit; }

    await saveToCloud(col, id, docData);

    // إضافة الطرف تلقائياً إلى دليله إن كان جديداً
    const pcol = isSale ? 'customers' : 'suppliers';
    if (!DB[pcol].some(p => p.name === party)) {
        const pid = Date.now() + 1;
        await saveToCloud(pcol, pid, { id: pid, name: party, phone: '' });
    }

    closeModal();
    toast('تم حفظ الفاتورة ' + docData.invNo, 'success');
    showView(isSale ? 'sales' : 'purchases');
}
window.saveInvoice = saveInvoice;

// ============================================================
// 9. عرض قوائم الفواتير
// ============================================================
function renderSales() {
    const q = ($('sales-search')?.value || '').toLowerCase();
    let list = [...DB.sales];
    if (q) list = list.filter(s => (s.invNo || '').toLowerCase().includes(q) || (s.customer || '').toLowerCase().includes(q));
    $('sales-list').innerHTML = list.length === 0
        ? '<p class="empty-state"><i class="fas fa-shopping-cart"></i>لا توجد فواتير مبيعات</p>'
        : list.map(s => `
            <div class="doc-item" onclick="invoiceDetail('sales', ${s.id})">
                <div class="di-main">
                    <div class="di-no">${esc(s.invNo)} ${s.payType === 'CREDIT' ? '<span class="badge b-amber">آجل</span>' : '<span class="badge b-green">نقدي</span>'}</div>
                    <div class="di-sub">${esc(s.customer)} — ${invLines(s).length} صنف — ${dstr(s.date)}</div>
                </div>
                <div class="di-amt">${esc(s.display || ('$' + fmt(s.amtUSD)))}<small>${dstr(s.date)}</small></div>
            </div>`).join('');
}
window.renderSales = renderSales;

function renderPurchases() {
    const q = ($('purch-search')?.value || '').toLowerCase();
    let list = [...DB.purch];
    if (q) list = list.filter(p => (p.invNo || '').toLowerCase().includes(q) || (p.supplier || '').toLowerCase().includes(q));
    $('purch-list').innerHTML = list.length === 0
        ? '<p class="empty-state"><i class="fas fa-cart-arrow-down"></i>لا توجد فواتير مشتريات</p>'
        : list.map(p => `
            <div class="doc-item" onclick="invoiceDetail('purch', ${p.id})">
                <div class="di-main">
                    <div class="di-no">${esc(p.invNo)} ${p.payType === 'CREDIT' ? '<span class="badge b-amber">آجل</span>' : '<span class="badge b-green">نقدي</span>'}</div>
                    <div class="di-sub">${esc(p.supplier)} — ${invLines(p).length} صنف — ${dstr(p.date)}</div>
                </div>
                <div class="di-amt">${esc(p.display || ('$' + fmt(p.amtUSD)))}<small>${dstr(p.date)}</small></div>
            </div>`).join('');
}
window.renderPurchases = renderPurchases;

// ============================================================
// 10. تفاصيل المستند + الطباعة + المشاركة + الحذف
// ============================================================
function findDoc(kind, noOrId) {
    const map = { sales: DB.sales, purch: DB.purch, vouchers: DB.vouchers, transfers: DB.transfers, journal: DB.journal, expenses: DB.expenses, payments: DB.payments };
    const arr = map[kind] || [];
    return arr.find(x => x.id === noOrId || x.invNo === noOrId || x.vouchNo === noOrId || x.trNo === noOrId || x.jeNo === noOrId || x.expNo === noOrId || x.payNo === noOrId);
}

function invoiceDetail(kind, id) {
    const col = kind === 'sales' ? 'sales' : 'purch';
    const d = DB[col].find(x => x.id === id);
    if (!d) return;
    const isSale = kind === 'sales';
    const party = isSale ? d.customer : d.supplier;
    const lines = invLines(d);
    const rate = d.rate || (d.curr === 'USD' ? 1 : (d.curr === 'YER' ? DB.rates.YER : DB.rates.SAR));
    const cur = d.curr || 'USD';
    const qtyLabel = l => `${fmt0(l.qtyIn || l.qty || 0)} ${l.unit || ''}`.trim();
    openModal({
        title: (isSale ? 'فاتورة مبيعات' : 'فاتورة مشتريات') + ' ' + d.invNo,
        icon: isSale ? 'fa-shopping-cart' : 'fa-cart-arrow-down', wide: true,
        body: `
            <div class="detail-row"><span class="k">${isSale ? 'العميل' : 'المورد'}</span><span class="v">${esc(party)}</span></div>
            <div class="detail-row"><span class="k">التاريخ</span><span class="v">${dstrT(d.date)}</span></div>
            <div class="detail-row"><span class="k">الدفع</span><span class="v">${d.payType === 'CREDIT' ? 'آجل' : 'نقداً'}</span></div>
            <div class="detail-row"><span class="k">العملة</span><span class="v">${cur} — سعر الصرف: 1$ = ${fmt(rate)}</span></div>
            ${d.notes ? `<div class="detail-row"><span class="k">ملاحظات</span><span class="v">${esc(d.notes)}</span></div>` : ''}
            <div class="tbl-wrap" style="margin-top:12px"><table class="tbl">
                <thead><tr><th>الصنف</th><th>الكمية</th><th>سعر الوحدة (${cur})</th><th>الإجمالي (${cur})</th></tr></thead>
                <tbody>${lines.map(l => {
                    const qIn = l.qtyIn || l.qty || 0;
                    const amtOrig = (l.amtUSD || 0) * rate;
                    const upOrig = qIn ? amtOrig / qIn : 0;
                    return `<tr><td>${esc(l.name)}</td><td class="num">${qtyLabel(l)}</td><td class="num">${upOrig.toFixed(2)}</td><td class="num">${amtOrig.toFixed(2)}</td></tr>`;
                }).join('')}</tbody>
            </table></div>
            <div class="inv-total-bar" style="margin-top:12px"><span class="t-label">الإجمالي</span><span class="t-val">${esc(d.display || ('$' + fmt(d.amtUSD)))}</span></div>`,
        foot: `<button class="btn btn-soft" onclick="closeModal(); editInvoice('${kind}', ${d.id})"><i class="fas fa-edit"></i> تعديل</button>
               <button class="btn btn-soft" onclick="printInvoice('${kind}', ${d.id})"><i class="fas fa-print"></i> طباعة</button>
               <button class="btn btn-ghost" onclick="closeModal()">إغلاق</button>
               <button class="btn btn-danger" onclick="closeModal(); delInvoice('${kind}', ${d.id})"><i class="fas fa-trash"></i></button>`
    });
}
window.invoiceDetail = invoiceDetail;

function printInvoice(kind, id) {
    const d = findDoc(kind === 'sales' ? 'sales' : 'purch', id);
    if (!d) return;
    const isSale = kind === 'sales';
    const party = isSale ? d.customer : d.supplier;
    const lines = invLines(d);
    const rate = d.rate || (d.curr === 'USD' ? 1 : (d.curr === 'YER' ? DB.rates.YER : DB.rates.SAR));
    const cur = d.curr || 'USD';
    $('print-area').innerHTML = `
        <div class="p-header"><h1>محاسب المذيوب</h1><p>إعداد م. عبدالقادر حسين المذيوب</p><p>${isSale ? 'فاتورة مبيعات' : 'فاتورة مشتريات'} — ${esc(d.invNo)}</p></div>
        <table class="p-meta">
            <tr><td>${isSale ? 'العميل' : 'المورد'}:</td><td>${esc(party)}</td></tr>
            <tr><td>التاريخ:</td><td>${dstrT(d.date)}</td></tr>
            <tr><td>نوع الدفع:</td><td>${d.payType === 'CREDIT' ? 'آجل' : 'نقداً'}</td></tr>
            <tr><td>العملة:</td><td>${cur} (1$ = ${fmt(rate)})</td></tr>
        </table>
        <table class="p-items"><thead><tr><th>م</th><th>الصنف</th><th>الكمية</th><th>سعر الوحدة (${cur})</th><th>الإجمالي (${cur})</th></tr></thead>
        <tbody>${lines.map((l, i) => {
            const qIn = l.qtyIn || l.qty || 0;
            const amtOrig = (l.amtUSD || 0) * rate;
            const upOrig = qIn ? amtOrig / qIn : 0;
            return `<tr><td>${i + 1}</td><td>${esc(l.name)}</td><td>${fmt0(qIn)} ${esc(l.unit || '')}</td><td>${upOrig.toFixed(2)}</td><td>${amtOrig.toFixed(2)}</td></tr>`;
        }).join('')}</tbody></table>
        <div class="p-total">الإجمالي: ${esc(d.display || ('$' + fmt(d.amtUSD)))} &nbsp;|&nbsp; ${fmt(d.amtUSD)} USD</div>
        <div class="p-footer">محاسب المذيوب — جميع الحقوق محفوظة — ${new Date().getFullYear()}</div>`;
    setTimeout(() => window.print(), 100);
}
window.printInvoice = printInvoice;

async function delInvoice(kind, id) {
    const col = kind === 'sales' ? 'sales' : 'purch';
    const d = DB[col].find(x => x.id === id);
    if (!d) return;
    if (!confirm(`حذف الفاتورة ${d.invNo}؟\n${kind === 'sales' ? 'سيتم إرجاع الكميات للمخزون.' : 'سيتم خصم الكميات من المخزون.'}`)) return;

    const isSale = kind === 'sales';
    for (const l of invLines(d)) {
        const it = DB.items.find(x => x.code === l.code);
        if (!it) continue;
        const newQty = isSale ? it.qty + l.qty : it.qty - l.qty;
        if (newQty < 0) return toast('لا يمكن الحذف — الكمية مباعت ولا يمكن خصمها', 'error');
        await saveToCloud('items', it.code, { ...it, qty: newQty });
    }
    await deleteFromCloud(col, id);
    toast('تم حذف الفاتورة', 'success');
}
window.delInvoice = delInvoice;

function txDetail(kind, no) {
    const colMap = { SALES: 'sales', PURCH: 'purch', EXPENSE: 'expenses', VOUCHER: 'vouchers', TRANSFER: 'transfers', JOURNAL: 'journal', PAYMENT: 'payments' };
    const col = colMap[kind];
    if (!col) return;
    const d = DB[col].find(x => x.invNo === no || x.vouchNo === no || x.trNo === no || x.jeNo === no || x.expNo === no || x.payNo === no);
    if (!d) return;
    if (kind === 'SALES') return invoiceDetail('sales', d.id);
    if (kind === 'PURCH') return invoiceDetail('purch', d.id);
    // عرض عام
    let extra = '';
    if (kind === 'JOURNAL' && Array.isArray(d.lines)) {
        extra = `<div class="tbl-wrap" style="margin-top:10px"><table class="tbl"><thead><tr><th>الحساب</th><th>مدين</th><th>دائن</th></tr></thead><tbody>${d.lines.map(l => `<tr><td>${esc(l.accName || l.acc)}</td><td class="num">${l.debit ? '$' + fmt(l.debit) : '—'}</td><td class="num">${l.credit ? '$' + fmt(l.credit) : '—'}</td></tr>`).join('')}</tbody></table></div>`;
    }
    const rows = Object.entries(d)
        .filter(([k, v]) => !['id', 'items', 'lines'].includes(k) && typeof v !== 'object')
        .map(([k, v]) => `<div class="detail-row"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`).join('');
    let foot = `<button class="btn btn-ghost" onclick="closeModal()">إغلاق</button>`;
    if (kind === 'EXPENSE') foot = `<button class="btn btn-soft" onclick="closeModal(); editExpenseDoc(${d.id})"><i class="fas fa-edit"></i> تعديل</button>` + foot;
    if (kind === 'VOUCHER') foot = `<button class="btn btn-soft" onclick="closeModal(); editVoucherDoc(${d.id})"><i class="fas fa-edit"></i> تعديل</button>` + foot;
    foot += `<button class="btn btn-danger" onclick="delDoc('${col}', ${d.id})"><i class="fas fa-trash"></i> حذف</button>`;
    openModal({ title: no, icon: 'fa-file-alt', body: rows + extra, foot });
}
window.txDetail = txDetail;

// ============================================================
// 11. المصروفات
// ============================================================
function openExpenseForm(exp) {
    const isEdit = !!exp;
    openModal({
        title: isEdit ? 'تعديل مصروف' : 'مصروف جديد', icon: 'fa-file-invoice-dollar',
        body: `
            <div class="form-grid">
                <div class="fgroup"><label class="flabel">حساب المصروف *</label><select class="fselect" id="exp-acc">${acctOptions(exp?.accCode || '507', ['المصروفات'])}</select></div>
                <div class="fgroup"><label class="flabel">المبلغ *</label><div style="display:flex;gap:6px"><input class="finput" type="number" step="0.01" min="0.01" id="exp-amt" value="${exp ? fromUSD(exp.amtUSD, exp.curr).toFixed(2) : ''}"><select class="fselect" id="exp-curr" style="width:90px">${currOptions(exp?.curr || 'USD')}</select></div></div>
                <div class="fgroup"><label class="flabel">دُفع من</label><select class="fselect" id="exp-from">${acctOptions(exp?.paidFrom || '101', ['الأصول'])}</select></div>
                <div class="fgroup"><label class="flabel">التاريخ</label><input class="finput" type="date" id="exp-date" value="${(exp?.date || today()).slice(0, 10)}"></div>
                <div class="fgroup full"><label class="flabel">البيان / الجهة</label><input class="finput" id="exp-notes" value="${esc(exp?.notes || '')}" placeholder="مثال: فاتورة كهرباء شهر November"></div>
            </div>`,
        foot: `<button class="btn btn-ghost" onclick="closeModal()">إلغاء</button>
               <button class="btn btn-danger" onclick="saveExpense(${isEdit ? exp.id : 'null'})">${isEdit ? 'حفظ' : 'تسجيل المصروف'}</button>`
    });
}
window.openExpenseForm = openExpenseForm;
window.editExpenseDoc = id => { const d = DB.expenses.find(x => x.id === id); if (d) openExpenseForm(d); };

async function saveExpense(editId) {
    const amt = parseFloat($('exp-amt').value);
    const curr = $('exp-curr').value;
    if (!isFinite(amt) || amt <= 0) return toast('أدخل مبلغاً صحيحاً', 'error');
    const amtUSD = toUSD(amt, curr);
    const data = {
        id: editId || Date.now(),
        expNo: editId ? DB.expenses.find(x => x.id === editId)?.expNo : nextNo('E', 'expenses', 'expNo'),
        date: new Date($('exp-date').value || today()).toISOString(),
        accCode: $('exp-acc').value,
        accName: accByCode($('exp-acc').value)?.name || '',
        paidFrom: $('exp-from').value,
        notes: $('exp-notes').value.trim(),
        amtOrig: amt, amtUSD, curr,
        display: amt.toFixed(2) + ' ' + CURR_SYM[curr]
    };
    await saveToCloud('expenses', data.id, data);
    closeModal(); toast('تم تسجيل المصروف', 'success');
}
window.saveExpense = saveExpense;

function renderExpenses() {
    $('expenses-list').innerHTML = DB.expenses.length === 0
        ? '<p class="empty-state"><i class="fas fa-file-invoice-dollar"></i>لا توجد مصروفات</p>'
        : DB.expenses.map(x => `
            <div class="doc-item" onclick="txDetail('EXPENSE', '${x.expNo}')">
                <div class="di-main"><div class="di-no">${esc(x.expNo)}</div>
                <div class="di-sub">${esc(x.accName || x.accCode)} — ${esc(x.notes || '')} — ${dstr(x.date)}</div></div>
                <div class="di-amt neg">-${esc(x.display || ('$' + fmt(x.amtUSD)))}</div>
            </div>`).join('');
}
window.renderExpenses = renderExpenses;

// ============================================================
// 12. سندات القبض والصرف
// ============================================================
async function delDoc(col, id) {
    if (!confirm('هل تريد حذف هذا السجل نهائياً؟')) return;
    await deleteFromCloud(col, id);
    closeModal();
    toast('تم الحذف', 'success');
}
window.delDoc = delDoc;

function openVoucherForm(v = null) {
    openModal({
        title: v ? 'تعديل سند ' + v.vouchNo : 'سند قبض / صرف', icon: 'fa-receipt',
        body: `
            <div class="form-grid">
                <div class="fgroup"><label class="flabel">نوع السند</label><select class="fselect" id="v-type"><option value="RECEIPT" ${v?.type === 'RECEIPT' ? 'selected' : ''}>سند قبض (+)</option><option value="PAYMENT" ${v?.type === 'PAYMENT' ? 'selected' : ''}>سند صرف (-)</option></select></div>
                <div class="fgroup"><label class="flabel">الحساب *</label><select class="fselect" id="v-acc">${acctOptions(v?.accCode || '101', ['الأصول'])}</select></div>
                <div class="fgroup"><label class="flabel">المبلغ *</label><div style="display:flex;gap:6px"><input class="finput" type="number" step="0.01" min="0.01" id="v-amt" value="${v ? fromUSD(v.amtUSD, v.curr).toFixed(2) : ''}"><select class="fselect" id="v-curr" style="width:90px">${currOptions(v?.curr || 'USD')}</select></div></div>
                <div class="fgroup"><label class="flabel">الجهة / الطرف</label><input class="finput" id="v-party" value="${esc(v?.party || '')}" placeholder="اسم الجهة"></div>
                <div class="fgroup full"><label class="flabel">البيان *</label><input class="finput" id="v-notes" value="${esc(v?.notes || '')}" placeholder="وصف العملية"></div>
            </div>`,
        foot: `<button class="btn btn-ghost" onclick="closeModal()">إلغاء</button>
               <button class="btn btn-primary" onclick="saveVoucher(${v ? v.id : 'null'})">${v ? 'حفظ التعديل' : 'حفظ السند'}</button>`
    });
}
window.openVoucherForm = openVoucherForm;
window.editVoucherDoc = id => { const d = DB.vouchers.find(x => x.id === id); if (d) openVoucherForm(d); };

async function saveVoucher(editId) {
    const amt = parseFloat($('v-amt').value);
    const curr = $('v-curr').value;
    const notes = $('v-notes').value.trim();
    if (!isFinite(amt) || amt <= 0) return toast('أدخل مبلغاً صحيحاً', 'error');
    if (!notes) return toast('أدخل البيان', 'error');
    const amtUSD = toUSD(amt, curr);
    const old = editId ? DB.vouchers.find(x => x.id === editId) : null;
    const v = {
        id: editId || Date.now(), vouchNo: old?.vouchNo || nextNo('V', 'vouchers', 'vouchNo'), date: today(),
        type: $('v-type').value, accCode: $('v-acc').value,
        party: $('v-party').value.trim(), notes,
        amtOrig: amt, amtUSD, curr, display: amt.toFixed(2) + ' ' + CURR_SYM[curr]
    };
    await saveToCloud('vouchers', v.id, v);
    closeModal(); toast('تم حفظ السند ' + v.vouchNo, 'success');
}
window.saveVoucher = saveVoucher;

// ============================================================
// 13. التحويل بين الحسابات
// ============================================================
function openTransferForm() {
    openModal({
        title: 'تحويل بين الحسابات', icon: 'fa-exchange-alt',
        body: `
            <div class="form-grid">
                <div class="fgroup"><label class="flabel">من حساب</label><select class="fselect" id="tr-from">${acctOptions('101')}</select></div>
                <div class="fgroup"><label class="flabel">إلى حساب</label><select class="fselect" id="tr-to">${acctOptions('104')}</select></div>
                <div class="fgroup"><label class="flabel">المبلغ *</label><div style="display:flex;gap:6px"><input class="finput" type="number" step="0.01" min="0.01" id="tr-amt"><select class="fselect" id="tr-curr" style="width:90px">${currOptions('USD')}</select></div></div>
                <div class="fgroup"><label class="flabel">البيان</label><input class="finput" id="tr-notes"></div>
            </div>`,
        foot: `<button class="btn btn-ghost" onclick="closeModal()">إلغاء</button>
               <button class="btn btn-primary" onclick="saveTransfer()">تنفيذ التحويل</button>`
    });
}
window.openTransferForm = openTransferForm;

async function saveTransfer() {
    const from = $('tr-from').value, to = $('tr-to').value;
    if (from === to) return toast('الحسابان متطابقان', 'error');
    const amt = parseFloat($('tr-amt').value);
    const curr = $('tr-curr').value;
    if (!isFinite(amt) || amt <= 0) return toast('أدخل مبلغاً صحيحاً', 'error');
    const amtUSD = toUSD(amt, curr);
    const tr = {
        id: Date.now(), trNo: nextNo('T', 'transfers', 'trNo'), date: today(),
        fromCode: from, fromName: accByCode(from)?.name, toCode: to, toName: accByCode(to)?.name,
        amtOrig: amt, amtUSD, curr, display: amt.toFixed(2) + ' ' + CURR_SYM[curr],
        notes: $('tr-notes').value.trim()
    };
    await saveToCloud('transfers', tr.id, tr);
    closeModal(); toast('تم التحويل', 'success');
}
window.saveTransfer = saveTransfer;

// ============================================================
// 14. القيود اليومية (قيد مزدوج حقيقي)
// ============================================================
let jeLines = [{ acc: '101', debit: 0, credit: 0 }];

function openJournalForm() {
    jeLines = [{ acc: '101', debit: 0, credit: 0 }, { acc: '401', debit: 0, credit: 0 }];
    window.jeLines = jeLines;
    openModal({
        title: 'قيد يومية جديد', icon: 'fa-pen', wide: true,
        body: `
            <div class="form-grid" style="margin-bottom:12px">
                <div class="fgroup"><label class="flabel">التاريخ</label><input class="finput" type="date" id="je-date" value="${today().slice(0, 10)}"></div>
                <div class="fgroup"><label class="flabel">البيان *</label><input class="finput" id="je-memo" placeholder="وصف القيد"></div>
            </div>
            <div class="card-title"><i class="fas fa-list"></i>البنود (مدين / دائن)</div>
            <div class="inv-lines" id="je-lines"></div>
            <button class="add-line-btn" onclick="jeAddLine()"><i class="fas fa-plus"></i> إضافة بند</button>
            <div class="inv-total-bar"><span class="t-label">إجمالي المدين</span><span class="t-val" id="je-total">$0.00</span></div>
            <div id="je-balance-msg" style="font-size:12.5px;font-weight:700"></div>`,
        foot: `<button class="btn btn-ghost" onclick="closeModal()">إلغاء</button>
               <button class="btn btn-primary" onclick="saveJournal()"><i class="fas fa-save"></i> حفظ القيد</button>`
    });
    renderJeLines();
}
window.openJournalForm = openJournalForm;

function jeAddLine() { jeLines.push({ acc: '101', debit: 0, credit: 0 }); renderJeLines(); }
window.jeAddLine = jeAddLine;
function jeDelLine(i) { if (jeLines.length <= 2) return toast('قيد يومية يحتاج بندين على الأقل', 'warning'); jeLines.splice(i, 1); renderJeLines(); }
window.jeDelLine = jeDelLine;

function renderJeLines() {
    $('je-lines').innerHTML = jeLines.map((l, i) => `
        <div class="inv-line" style="grid-template-columns:1fr 100px 100px 30px">
            <select class="fselect" style="padding:8px;font-size:13px" onchange="jeLines[${i}].acc=this.value;jeRecalc()">${acctOptions(l.acc)}</select>
            <input class="l-qty" type="number" min="0" step="0.01" placeholder="مدين" value="${l.debit || ''}" oninput="jeLines[${i}].debit=parseFloat(this.value)||0;jeRecalc()">
            <input class="l-qty" type="number" min="0" step="0.01" placeholder="دائن" value="${l.credit || ''}" oninput="jeLines[${i}].credit=parseFloat(this.value)||0;jeRecalc()">
            <button class="l-del" onclick="jeDelLine(${i})"><i class="fas fa-times"></i></button>
        </div>`).join('');
    jeRecalc();
}
window.renderJeLines = renderJeLines;

function jeRecalc() {
    const total = jeLines.reduce((s, l) => s + (l.debit || 0), 0);
    const cred = jeLines.reduce((s, l) => s + (l.credit || 0), 0);
    const el = $('je-total'); if (el) el.textContent = '$' + fmt(total);
    const msg = $('je-balance-msg');
    if (msg) {
        if (total === 0 && cred === 0) { msg.textContent = ''; msg.style.color = 'var(--muted)'; }
        else if (Math.abs(total - cred) < 0.005) { msg.textContent = '✓ القيد متوازن'; msg.style.color = 'var(--success)'; }
        else { msg.textContent = `✗ غير متوازن — فرق $${fmt(Math.abs(total - cred))}`; msg.style.color = 'var(--danger)'; }
    }
}
window.jeRecalc = jeRecalc;

async function saveJournal() {
    const memo = $('je-memo').value.trim();
    if (!memo) return toast('أدخل البيان', 'error');
    const valid = jeLines.filter(l => (l.debit || 0) > 0 || (l.credit || 0) > 0);
    if (valid.length < 2) return toast('أدخل بندين على الأقل بمبالغ', 'error');
    const totalD = valid.reduce((s, l) => s + (l.debit || 0), 0);
    const totalC = valid.reduce((s, l) => s + (l.credit || 0), 0);
    if (Math.abs(totalD - totalC) > 0.005) return toast('القيد غير متوازن — عدّل المبالغ', 'error');
    if (valid.some(l => (l.debit || 0) > 0 && (l.credit || 0) > 0)) return toast('كل بند يجب أن يكون مديناً أو دائناً فقط', 'error');

    const j = {
        id: Date.now(), jeNo: nextNo('J', 'journal', 'jeNo'),
        date: new Date($('je-date').value || today()).toISOString(),
        memo, lines: valid.map(l => ({ acc: l.acc, accName: accByCode(l.acc)?.name || l.acc, debit: l.debit || 0, credit: l.credit || 0 })),
        total: totalD
    };
    await saveToCloud('journal', j.id, j);
    closeModal(); toast('تم حفظ القيد ' + j.jeNo, 'success');
}
window.saveJournal = saveJournal;

// ============================================================
// 15. الحسابات — صفحة + إضافة حساب
// ============================================================
function renderAccountsPage() {
    const bal = computeBalances();
    const accs = allAccounts().sort((a, b) => a.code.localeCompare(b.code));
    $('accounts-tbody').innerHTML = accs.map(a => {
        const b = bal[a.code] || 0;
        const normal = NORMAL_SIDE[a.type] || 'D';
        // عرض الرصيد حسب طبيعته: للمدين الموجب = مدين، للدائن السالب = دائن
        const disp = normal === 'D' ? b : -b;
        const col = disp >= 0 ? 'var(--success)' : 'var(--danger)';
        return `<tr><td class="num">${a.code}</td><td>${esc(a.name)}</td><td><span class="badge ${a.type === 'الأصول' || a.type === 'المصروفات' ? 'b-blue' : a.type === 'الإيرادات' ? 'b-green' : 'b-amber'}">${a.type}</span></td>
        <td class="num" style="color:${col}">${disp >= 0 ? '' : '-'}$${fmt(Math.abs(disp))}</td></tr>`;
    }).join('');

    // آخر السندات والقيود
    const docs = [];
    DB.vouchers.forEach(v => docs.push({ no: v.vouchNo, t: v.type === 'RECEIPT' ? 'قبض' : 'صرف', p: v.party, d: v.date, a: v.display }));
    DB.transfers.forEach(t => docs.push({ no: t.trNo, t: 'تحويل', p: `${t.fromName} ← ${t.toName}`, d: t.date, a: t.display }));
    DB.journal.forEach(j => docs.push({ no: j.jeNo, t: 'قيد', p: j.memo || j.notes || '', d: j.date, a: '$' + fmt(j.total ?? j.amtUSD ?? 0) }));
    docs.sort((a, b) => new Date(b.d) - new Date(a.d));
    $('accounts-docs').innerHTML = docs.length === 0
        ? '<p class="empty-state" style="padding:16px">لا توجد حركات</p>'
        : docs.slice(0, 15).map(x => `<div class="doc-item"><div class="di-main"><div class="di-no">${esc(x.no)} <span class="badge b-gray">${x.t}</span></div><div class="di-sub">${esc(x.p || '')} — ${dstr(x.d)}</div></div><div class="di-amt">${esc(x.a)}</div></div>`).join('');
}
window.renderAccountsPage = renderAccountsPage;

function openAccountForm() {
    openModal({
        title: 'إضافة حساب جديد', icon: 'fa-folder-plus',
        body: `
            <div class="form-grid">
                <div class="fgroup"><label class="flabel">كود الحساب *</label><input class="finput" id="acc-code" placeholder="مثال: 508"></div>
                <div class="fgroup"><label class="flabel">نوع الحساب *</label><select class="fselect" id="acc-type"><option>المصروفات</option><option>الإيرادات</option><option>الأصول</option><option>الالتزامات</option><option>حقوق الملكية</option></select></div>
                <div class="fgroup full"><label class="flabel">اسم الحساب *</label><input class="finput" id="acc-name" placeholder="مثال: دعاية وإعلان"></div>
            </div>`,
        foot: `<button class="btn btn-ghost" onclick="closeModal()">إلغاء</button>
               <button class="btn btn-primary" onclick="saveAccount()">حفظ الحساب</button>`
    });
}
window.openAccountForm = openAccountForm;

async function saveAccount() {
    const code = $('acc-code').value.trim();
    const name = $('acc-name').value.trim();
    const type = $('acc-type').value;
    if (!code || !name) return toast('أدخل الكود والاسم', 'error');
    if (allAccounts().some(a => a.code === code)) return toast('الكود موجود مسبقاً', 'error');
    await saveToCloud('accounts', code, { code, name, type });
    closeModal(); toast('تمت إضافة الحساب', 'success');
}
window.saveAccount = saveAccount;

// ============================================================
// 16. العملاء والموردون + دفعات الذمم
// ============================================================
function renderCustomers() {
    const pb = partyBalances().customers;
    $('customers-list').innerHTML = DB.customers.length === 0
        ? '<p class="empty-state"><i class="fas fa-users"></i>لا يوجد عملاء — يُضافون تلقائياً عند كتابة اسم جديد في الفاتورة</p>'
        : DB.customers.map(c => {
            const bal = pb[c.name] || 0;
            return `<div class="doc-item">
                <div class="di-main"><div class="di-no">${esc(c.name)}</div>
                <div class="di-sub">${esc(c.phone || '—')} ${bal > 0.005 ? `• عليه <b class="neg">$${fmt(bal)}</b>` : bal < -0.005 ? `• له <b class="pos">$${fmt(-bal)}</b>` : '• مسدد'}</div></div>
                <div style="display:flex;gap:6px">
                    ${bal > 0.005 ? `<button class="btn btn-success btn-sm" onclick="openPaymentFor('customers', ${c.id})"><i class="fas fa-money-bill"></i> تحصيل</button>` : ''}
                    <button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="delParty('customers', ${c.id})"><i class="fas fa-trash"></i></button>
                </div></div>`;
        }).join('');
}
window.renderCustomers = renderCustomers;

function renderSuppliers() {
    const pb = partyBalances().suppliers;
    $('suppliers-list').innerHTML = DB.suppliers.length === 0
        ? '<p class="empty-state"><i class="fas fa-truck"></i>لا يوجد موردون — يُضافون تلقائياً عند كتابة اسم جديد في الفاتورة</p>'
        : DB.suppliers.map(s => {
            const bal = pb[s.name] || 0; // موجب = له علينا (ذمم دائنة)
            return `<div class="doc-item">
                <div class="di-main"><div class="di-no">${esc(s.name)}</div>
                <div class="di-sub">${esc(s.phone || '—')} ${bal > 0.005 ? `• له علينا <b class="neg">$${fmt(bal)}</b>` : bal < -0.005 ? `• له رصيد/سلفة <b class="pos">$${fmt(-bal)}</b>` : '• مسدد'}</div></div>
                <div style="display:flex;gap:6px">
                    ${bal > 0.005 ? `<button class="btn btn-warning btn-sm" onclick="openPaymentFor('suppliers', ${s.id})"><i class="fas fa-money-bill"></i> سداد</button>` : ''}
                    <button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="delParty('suppliers', ${s.id})"><i class="fas fa-trash"></i></button>
                </div></div>`;
        }).join('');
}
window.renderSuppliers = renderSuppliers;

function openPartyForm(type) {
    const isCust = type === 'customer';
    openModal({
        title: isCust ? 'عميل جديد' : 'مورد جديد', icon: isCust ? 'fa-user' : 'fa-truck',
        body: `
            <div class="form-grid">
                <div class="fgroup"><label class="flabel">الاسم *</label><input class="finput" id="party-name"></div>
                <div class="fgroup"><label class="flabel">الهاتف</label><input class="finput" id="party-phone"></div>
            </div>`,
        foot: `<button class="btn btn-ghost" onclick="closeModal()">إلغاء</button>
               <button class="btn btn-primary" onclick="saveParty('${type}')">حفظ</button>`
    });
}
window.openPartyForm = openPartyForm;

async function saveParty(type) {
    const name = $('party-name').value.trim();
    if (!name) return toast('أدخل الاسم', 'error');
    const col = type === 'customer' ? 'customers' : 'suppliers';
    if (DB[col].some(p => p.name === name)) return toast('الاسم موجود مسبقاً', 'error');
    await saveToCloud(col, Date.now(), { id: Date.now(), name, phone: $('party-phone').value.trim() });
    closeModal(); toast('تم الحفظ', 'success');
}
window.saveParty = saveParty;

async function delParty(col, id) {
    if (!confirm('حذف؟')) return;
    await deleteFromCloud(col, id);
}
window.delParty = delParty;

// ============================================================
// 17. دفعات العملاء/الموردين (تسوية الذمم)
// ============================================================
let payCtx = { type: 'customer', name: '' };
function openPaymentForm(partyType, partyName) {
    payCtx = { type: partyType, name: partyName };
    openModal({
        title: partyType === 'customer' ? 'تحصيل من عميل' : 'سداد لمورد', icon: 'fa-money-bill-wave',
        body: `
            <div class="form-grid">
                <div class="fgroup"><label class="flabel">الطرف</label><input class="finput" value="${esc(partyName)}" readonly></div>
                <div class="fgroup"><label class="flabel">المبلغ *</label><div style="display:flex;gap:6px"><input class="finput" type="number" step="0.01" min="0.01" id="pay-amt"><select class="fselect" id="pay-curr" style="width:90px">${currOptions('USD')}</select></div></div>
                <div class="fgroup"><label class="flabel">من/إلى حساب</label><select class="fselect" id="pay-acc">${acctOptions('101', ['الأصول'])}</select></div>
                <div class="fgroup"><label class="flabel">التاريخ</label><input class="finput" type="date" id="pay-date" value="${today().slice(0, 10)}"></div>
                <div class="fgroup full"><label class="flabel">البيان</label><input class="finput" id="pay-notes" placeholder="دفعة على الحساب"></div>
            </div>`,
        foot: `<button class="btn btn-ghost" onclick="closeModal()">إلغاء</button>
               <button class="btn ${partyType === 'customer' ? 'btn-success' : 'btn-warning'}" onclick="savePayment()">تسجيل الدفعة</button>`
    });
}
window.openPaymentForm = openPaymentForm;
window.openPaymentFor = (col, id) => { const p = DB[col].find(x => x.id === id); if (p) openPaymentForm(col === 'customers' ? 'customer' : 'supplier', p.name); };

async function savePayment() {
    const partyType = payCtx.type, partyName = payCtx.name;
    const amt = parseFloat($('pay-amt').value);
    const curr = $('pay-curr').value;
    if (!isFinite(amt) || amt <= 0) return toast('أدخل مبلغاً صحيحاً', 'error');
    const p = {
        id: Date.now(), payNo: nextNo('PY', 'payments', 'payNo'),
        date: new Date($('pay-date').value || today()).toISOString(),
        partyType, party: partyName, accCode: $('pay-acc').value,
        notes: $('pay-notes').value.trim(),
        amtOrig: amt, amtUSD: toUSD(amt, curr), curr,
        display: amt.toFixed(2) + ' ' + CURR_SYM[curr]
    };
    await saveToCloud('payments', p.id, p);
    closeModal(); toast('تم تسجيل الدفعة', 'success');
}
window.savePayment = savePayment;

// ============================================================
// 18. التقارير
// ============================================================
function renderReports() {
    const bal = computeBalances();
    const accs = allAccounts().sort((a, b) => a.code.localeCompare(b.code));

    // قائمة الدخل
    const revenue = -(bal['401'] || 0) - (bal['402'] || 0);
    const cogs = bal['501'] || 0;
    const expenses = accs.filter(a => a.type === 'المصروفات' && a.code !== '501').reduce((s, a) => s + Math.max(0, bal[a.code] || 0), 0);
    const net = revenue - cogs - expenses;

    $('rep-stats').innerHTML = `
        <div class="stat-card c-green"><div class="stat-label">إجمالي الإيرادات</div><div class="stat-value">$${fmt(revenue)}</div></div>
        <div class="stat-card c-red"><div class="stat-label">تكلفة المبيعات</div><div class="stat-value">$${fmt(cogs)}</div></div>
        <div class="stat-card c-amber"><div class="stat-label">المصروفات</div><div class="stat-value">$${fmt(expenses)}</div></div>
        <div class="stat-card ${net >= 0 ? 'c-blue' : 'c-red'}"><div class="stat-label">صافي الربح</div><div class="stat-value" style="color:${net >= 0 ? 'var(--success)' : 'var(--danger)'}">$${fmt(net)}</div></div>`;

    $('rep-pnl').innerHTML = `
        <div class="rep-line"><span>المبيعات (401)</span><span class="pos">$${fmt(-(bal['401'] || 0))}</span></div>
        <div class="rep-line"><span>إيرادات أخرى (402)</span><span class="pos">$${fmt(-(bal['402'] || 0))}</span></div>
        <div class="rep-line main"><span>إجمالي الإيرادات</span><span>$${fmt(revenue)}</span></div>
        <div class="rep-line"><span>تكلفة البضاعة المباعة (501)</span><span class="neg">-$${fmt(cogs)}</span></div>
        ${accs.filter(a => a.type === 'المصروفات' && a.code !== '501' && (bal[a.code] || 0) !== 0).map(a => `<div class="rep-line sub"><span>${esc(a.name)}</span><span>-$${fmt(bal[a.code] || 0)}</span></div>`).join('')}
        <div class="rep-line main"><span>صافي الربح / الخسارة</span><span style="color:${net >= 0 ? 'var(--success)' : 'var(--danger)'}">$${fmt(net)}</span></div>`;

    // ميزان المراجعة
    let totD = 0, totC = 0;
    const rows = accs.map(a => {
        const b = bal[a.code] || 0;
        const normal = NORMAL_SIDE[a.type] || 'D';
        const disp = normal === 'D' ? b : -b;
        const dr = disp > 0.004 ? disp : 0, cr = disp < -0.004 ? -disp : 0;
        totD += dr; totC += cr;
        return `<tr><td class="num">${a.code}</td><td>${esc(a.name)}</td><td class="num">${dr ? '$' + fmt(dr) : '—'}</td><td class="num">${cr ? '$' + fmt(cr) : '—'}</td></tr>`;
    }).join('');
    $('rep-tb').innerHTML = rows + `<tr style="background:var(--primary-soft);font-weight:800"><td colspan="2">الإجمالي</td><td class="num">$${fmt(totD)}</td><td class="num">$${fmt(totC)}</td></tr>`;

    // أرصدة الأطراف
    const pb = partyBalances();
    const cRows = Object.entries(pb.customers).filter(([, v]) => Math.abs(v) > 0.004);
    const sRows = Object.entries(pb.suppliers).filter(([, v]) => Math.abs(v) > 0.004);
    $('rep-parties').innerHTML = (cRows.length === 0 && sRows.length === 0)
        ? '<p class="empty-state" style="padding:16px">لا توجد أرصدة آجلة</p>'
        : `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>الاسم</th><th>النوع</th><th>الرصيد ($)</th></tr></thead><tbody>
            ${cRows.map(([n, v]) => `<tr><td>${esc(n)}</td><td><span class="badge b-blue">عميل</span></td><td class="num ${v > 0 ? 'neg' : 'pos'}">$${fmt(Math.abs(v))} ${v > 0 ? '(عليه)' : '(له)'}</td></tr>`).join('')}
            ${sRows.map(([n, v]) => `<tr><td>${esc(n)}</td><td><span class="badge b-amber">مورد</span></td><td class="num ${v > 0 ? 'neg' : 'pos'}">$${fmt(Math.abs(v))} ${v > 0 ? '(له علينا)' : '(سلفة له)'}</td></tr>`).join('')}
            </tbody></table></div>`;
}
window.renderReports = renderReports;

// ============================================================
// 19. سجل العمليات الشامل
// ============================================================
function renderTransactions() {
    const filter = $('tx-filter')?.value || 'ALL';
    const search = ($('tx-search')?.value || '').toLowerCase();
    const all = [];
    const add = (arr, kind, label, noF, partyF, dF, amtF, color) => arr.forEach(x => all.push({
        kind, label, no: x[noF], party: x[partyF], date: x[dF || 'date'], amt: x[amtF] || x.display || '', color
    }));

    if (filter === 'ALL' || filter === 'SALES') add(DB.sales, 'SALES', 'مبيعات', 'invNo', 'customer', 'date', 'display');
    if (filter === 'ALL' || filter === 'PURCH') add(DB.purch, 'PURCH', 'مشتريات', 'invNo', 'supplier', 'date', 'display');
    if (filter === 'ALL' || filter === 'EXPENSE') add(DB.expenses, 'EXPENSE', 'مصروف', 'expNo', 'notes', 'date', 'display');
    if (filter === 'ALL' || filter === 'VOUCHER') add(DB.vouchers, 'VOUCHER', 'سند', 'vouchNo', 'party', 'date', 'display');
    if (filter === 'ALL' || filter === 'TRANSFER') DB.transfers.forEach(t => all.push({ kind: 'TRANSFER', label: 'تحويل', no: t.trNo, party: `${t.fromName} ← ${t.toName}`, date: t.date, amt: t.display, color: '#7c3aed' }));
    if (filter === 'ALL' || filter === 'JOURNAL') DB.journal.forEach(j => all.push({ kind: 'JOURNAL', label: 'قيد', no: j.jeNo, party: j.memo || j.notes || '', date: j.date, amt: '$' + fmt(j.total ?? j.amtUSD ?? 0), color: '#dc2626' }));
    if (filter === 'ALL' || filter === 'PAYMENT') add(DB.payments, 'PAYMENT', 'دفعة', 'payNo', 'party', 'date', 'display');

    let result = all.sort((a, b) => new Date(b.date) - new Date(a.date));
    if (search) result = result.filter(it => (it.no || '').toLowerCase().includes(search) || (it.party || '').toLowerCase().includes(search));

    $('tx-list').innerHTML = result.length === 0
        ? '<p class="empty-state" style="padding:20px">لا توجد عمليات</p>'
        : result.map(it => `
            <div class="doc-item" onclick="txDetail('${it.kind}', '${esc(it.no)}')">
                <div class="di-main"><div class="di-no">${esc(it.no)} <span class="badge" style="background:${it.color || '#1d4ed8'}22;color:${it.color || '#1d4ed8'}">${it.label}</span></div>
                <div class="di-sub">${esc(it.party || '')} — ${dstrT(it.date)}</div></div>
                <div class="di-amt">${esc(it.amt)}</div>
            </div>`).join('');
}
window.renderTransactions = renderTransactions;

// ============================================================
// 20. الطباعة العامة + المشاركة
// ============================================================
function shareText(text) {
    if (navigator.share) navigator.share({ title: 'محاسب المذيوب', text }).catch(() => {});
    else window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
}
window.shareText = shareText;

// ============================================================
// 21. النسخ الاحتياطي والاستعادة
// ============================================================
function exportBackup() {
    toggleDrawer(false);
    const backup = {
        app: 'MahasibAlMadhyoub', version: '9.0', timestamp: new Date().toISOString(),
        rates: DB.rates,
        ...Object.fromEntries(COLS.map(c => [c, DB[c]]))
    };
    const a = document.createElement('a');
    a.href = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(backup, null, 2));
    a.download = 'Mahasib_Backup_' + Date.now() + '.json';
    a.click();
    toast('تم تصدير النسخة الاحتياطية', 'success');
}
window.exportBackup = exportBackup;

async function importBackup(event) {
    const file = event.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async e => {
        try {
            const data = JSON.parse(e.target.result);
            if (!currentUser) return toast('سجّل الدخول أولاً', 'error');
            if (!confirm('سيتم استبدال جميع البيانات الحالية ببيانات الملف. متابعة؟')) return;
            let total = 0;
            for (const col of COLS) {
                const arr = Array.isArray(data[col]) ? data[col] : [];
                total += arr.length;
                for (const d of arr) {
                    const key = String(d.id ?? d.code);
                    try { await setDoc(doc(db, 'users', currentUser.uid, col, key), d); } catch (err) { console.error(err); }
                }
            }
            if (data.rates) {
                DB.rates = { ...DB.rates, ...data.rates };
                try { await setDoc(doc(db, 'users', currentUser.uid, 'settings', 'main'), { rates: DB.rates }); } catch {}
            }
            toast(`تم استيراد ${total} سجل — جاري المزامنة`, 'success');
        } catch { toast('ملف غير صالح', 'error'); }
    };
    reader.readAsText(file);
    event.target.value = '';
}
window.importBackup = importBackup;

async function clearCache() {
    toggleDrawer(false);
    if (!confirm('سيتم مسح الكاش وإعادة تحميل التطبيق. بياناتك محفوظة سحابياً. متابعة؟')) return;
    try {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
        if ('serviceWorker' in navigator) { const r = await navigator.serviceWorker.getRegistration(); if (r) await r.unregister(); }
        toast('جاري إعادة التحميل...', 'success');
        setTimeout(() => location.reload(), 800);
    } catch { toast('فشل مسح الكاش', 'error'); }
}
window.clearCache = clearCache;

function openRatesModal() {
    toggleDrawer(false);
    openModal({
        title: 'أسعار الصرف', icon: 'fa-money-bill-wave',
        body: `
            <div class="fgroup"><label class="flabel">ريال يمني (YER مقابل $1)</label><input class="finput" type="number" step="0.01" min="1" id="rate-yer" value="${DB.rates.YER}"></div>
            <div class="fgroup"><label class="flabel">ريال سعودي (SAR مقابل $1)</label><input class="finput" type="number" step="0.01" min="0.1" id="rate-sar" value="${DB.rates.SAR}"></div>`,
        foot: `<button class="btn btn-ghost" onclick="closeModal()">إلغاء</button>
               <button class="btn btn-primary" onclick="saveRates()">حفظ الأسعار</button>`
    });
}
window.openRatesModal = openRatesModal;

async function saveRates() {
    DB.rates.YER = parseFloat($('rate-yer').value) || 530;
    DB.rates.SAR = parseFloat($('rate-sar').value) || 3.75;
    try { localStorage.setItem('alm_rates', JSON.stringify(DB.rates)); } catch {}
    if (currentUser) { try { await setDoc(doc(db, 'users', currentUser.uid, 'settings', 'main'), { rates: DB.rates }); } catch {} }
    closeModal(); toast('تم حفظ أسعار الصرف', 'success'); renderAll();
}
window.saveRates = saveRates;

// ============================================================
// 22. إدارة المستخدمين
// ============================================================
async function renderAdmin() {
    const el = $('admin-users-list');
    try {
        const snap = await getDocs(collection(db, 'all_users'));
        if (snap.empty) { el.innerHTML = '<p class="empty-state">لا يوجد مستخدمون</p>'; return; }
        el.innerHTML = `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>البريد</th><th>تاريخ التسجيل</th></tr></thead><tbody>
            ${snap.docs.map(d => { const u = d.data(); return `<tr><td>${esc(u.email)}</td><td>${dstr(u.createdAt)}</td></tr>`; }).join('')}
            </tbody></table></div>`;
    } catch { el.innerHTML = '<p class="empty-state" style="color:var(--danger)">فشل التحميل — تحقق من قواعد Firebase</p>'; }
}
window.renderAdmin = renderAdmin;

async function saveUserDirectory(user) {
    try { await setDoc(doc(db, 'all_users', user.uid), { uid: user.uid, email: user.email, createdAt: new Date().toISOString() }); } catch {}
}

// ============================================================
// 23. المصادقة
// ============================================================
function showAuthError(msg) {
    const e = $('auth-error'); e.textContent = msg; e.style.display = 'block';
    setTimeout(() => e.style.display = 'none', 5000);
}

async function handleLogin() {
    const email = $('auth-email').value.trim(), pass = $('auth-password').value;
    if (!email || !pass) return showAuthError('أدخل البريد وكلمة المرور');
    $('auth-loading').style.display = 'block';
    try { await signInWithEmailAndPassword(auth, email, pass); }
    catch (err) {
        $('auth-loading').style.display = 'none';
        showAuthError(err.code === 'auth/invalid-credential' ? 'بيانات الدخول غير صحيحة' : err.message);
    }
}
window.handleLogin = handleLogin;

async function handleSignup() {
    const email = $('auth-email').value.trim(), pass = $('auth-password').value;
    if (!email || !pass) return showAuthError('أدخل البريد وكلمة المرور');
    if (pass.length < 6) return showAuthError('كلمة المرور 6 أحرف على الأقل');
    $('auth-loading').style.display = 'block';
    try {
        const cred = await createUserWithEmailAndPassword(auth, email, pass);
        await saveUserDirectory(cred.user);
        toast('تم إنشاء الحساب — مرحباً بك', 'success');
    } catch (err) {
        $('auth-loading').style.display = 'none';
        if (err.code === 'auth/email-already-in-use') showAuthError('البريد مسجل — جرب تسجيل الدخول');
        else if (err.code === 'auth/invalid-email') showAuthError('بريد غير صالح');
        else showAuthError(err.message);
    }
}
window.handleSignup = handleSignup;

async function handleLogout() {
    if (!confirm('تسجيل الخروج؟')) return;
    await signOut(auth);
}
window.handleLogout = handleLogout;

// ============================================================
// 24. المزامنة التلقائية للأطراف + العرض الشامل
// ============================================================
// عند حفظ فاتورة باسم جديد، نضيفه تلقائياً لقائمة العملاء/الموردين
function renderAll() {
    // لا نعيد رسم الصفحة النشطة بالكامل — فقط العناصر المشتركة
    renderHome();
    const active = document.querySelector('.view.active')?.id;
    if (active === 'view-sales') renderSales();
    if (active === 'view-purchases') renderPurchases();
    if (active === 'view-inventory') renderItems();
    if (active === 'view-accounts') renderAccountsPage();
    if (active === 'view-reports') renderReports();
    if (active === 'view-expenses') renderExpenses();
    if (active === 'view-customers') renderCustomers();
    if (active === 'view-suppliers') renderSuppliers();
    if (active === 'view-transactions') renderTransactions();
    if (active === 'view-admin') renderAdmin();
}

// ============================================================
// 25. تسجيل Service Worker + حالة المصادقة
// ============================================================
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

function openAuthModal() {
    toggleDrawer(false);
    $('auth-screen').style.display = 'flex';
    $('auth-error').style.display = 'none';
    $('auth-loading').style.display = 'none';
}
function skipAuth() { $('auth-screen').style.display = 'none'; }
window.openAuthModal = openAuthModal;
window.skipAuth = skipAuth;

onAuthStateChanged(auth, async user => {
    if (user) {
        currentUser = user;
        $('auth-screen').style.display = 'none';
        $('app').classList.add('active');
        $('drawer-user-email').textContent = user.email;
        $('auth-menu-item').style.display = 'none';
        $('admin-menu-item').style.display = user.email === ADMIN_EMAIL ? 'flex' : 'none';
        saveUserDirectory(user);

        // رفع بيانات وضع الضيف إلى السحابة ثم بدء المزامنة
        toast('جاري مزامنة بياناتك...', 'info');
        try { await pushLocalToCloud(user.uid); } catch (e) { console.error(e); }
        startListeners(user.uid);
        showView('home');
        toast('مرحباً ' + user.email, 'success');
    } else {
        currentUser = null;
        unsubs.forEach(u => u()); unsubs = [];
        loadLocalData();
        $('auth-screen').style.display = 'none';
        $('app').classList.add('active');
        $('drawer-user-email').textContent = 'ضيف — بيانات محلية (سجّل الدخول للمزامنة)';
        $('auth-menu-item').style.display = 'flex';
        $('admin-menu-item').style.display = 'none';
        $('auth-password').value = '';
        $('auth-loading').style.display = 'none';
        renderAll();
    }
});

// Enter في شاشة الدخول
$('auth-password').addEventListener('keydown', e => { if (e.key === 'Enter') handleLogin(); });
$('auth-email').addEventListener('keydown', e => { if (e.key === 'Enter') $('auth-password').focus(); });
