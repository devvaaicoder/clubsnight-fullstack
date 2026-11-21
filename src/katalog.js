import "./katalog.css";
document.addEventListener('keydown', function(e) {
  const isF12 = e.keyCode === 123;
  const isDevTools = e.ctrlKey && e.shiftKey && [73, 74, 67].includes(e.keyCode);
  const isViewSource = e.ctrlKey && e.keyCode === 85;
  if (isF12 || isDevTools || isViewSource) {
    e.preventDefault();
    return false;
  }
});

const LIVECHAT_WORKER_URL = import.meta.env.VITE_LIVECHAT_URL || "https://clubsnight-livechat.clubsnight.workers.dev";
const TELEGRAM_CS_BOT_URL = "https://t.me/clubsnightcs_bot";
const WORKER_API_URL = import.meta.env.VITE_API_URL || "https://clubsnight-fullstack.clubsnight.workers.dev";
const MEDIA_WORKER_URL = import.meta.env.VITE_MEDIA_URL || "https://clubsnight-media.clubsnight.workers.dev";
function escapeHTML(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
const PLACEHOLDER_IMG = "https://placehold.co/400x533/180d28/ff1744?text=Clubs+Night";

// ==================== MATA UANG & KURS REGIONAL ====================
let currentCurrency = 'IDR';
const currencyRates = {
  IDR: { symbol: 'Rp ', rate: 1 },
  USD: { symbol: '$ ', rate: 0.000064 },
  MYR: { symbol: 'RM ', rate: 0.00030 },
  THB: { symbol: '฿ ', rate: 0.0023 },
  SGD: { symbol: 'S$ ', rate: 0.000086 }
};

// Cross-Tab Sync Channel
const syncChannel = ('BroadcastChannel' in window) ? new BroadcastChannel('clubsnight_live_sync') : null;

let cnSessionId = localStorage.getItem("cn_chat_session");
if (!cnSessionId) {
  cnSessionId = "sess_" + Math.random().toString(36).substring(2, 9) + "_" + Date.now();
  localStorage.setItem("cn_chat_session", cnSessionId);
}

let visitorId = localStorage.getItem('cn_visitor_id');
if (!visitorId) {
  visitorId = 'visitor_' + Math.random().toString(36).substring(2, 11) + '_' + Date.now();
  localStorage.setItem('cn_visitor_id', visitorId);
}

const CATEGORY_NAMES = {
  a: "a. atas saja tanpa face",
  b: "b. atas saja dengan face",
  c: "c. bawah saja tanpa face",
  d: "d. bawah saja dengan face",
  e: "e. fullbody tanpa face",
  f: "f. fullbody dengan face",
  g: "g. BOP /+ Dengan Request",
  h: "h. BOP /- tanpa Request"
};

const DURATION_LABELS = {
  m3: "a. 3 menit",
  m5: "b. 5 menit (Rekomendasi)",
  m7: "c. 7 menit",
  m10: "d. 10 menit"
};

const AVAILABLE_VIBES = ["GFE", "Deep Talk", "Cosplay", "Manja"];

const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); }

function encodeSecretPin(str) {
  try { return btoa(btoa(str)); } catch (err) { return ""; }
}

function parseMarkdownToHtml(text) {
  if (!text) return "";
  const safe = escapeHTML(text);
  return safe
    .replace(/\*\*(.*?)\*\*/g, "<b>$1</b>")
    .replace(/\*(.*?)\*/g, "<i>$1</i>")
    .replace(/\n/g, "<br>");
}

function getCompressedImageUrl(url, width = 400, quality = 72) {
  if (!url || typeof url !== 'string' || !url.trim()) return PLACEHOLDER_IMG;
  url = url.trim();
  if (url.includes('placehold.co') || url.includes('wsrv.nl')) return url;
  return `https://wsrv.nl/?url=${encodeURIComponent(url)}&w=${width}&q=${quality}&output=webp`;
}

// DATA INITIAL DEFAULT
const initialBanners = [
  { id: 1791575950009, title: "PROMO SPESIAL CLUBS'NIGHT", sub: "Layanan Video Call & Booking Service Privat", img: "https://i.ibb.co.com/5W8yQJmQ/625116.jpg" },
  { id: 1791609020704, title: "TALENT STANDBY 24/7", sub: "Garansi Sesi Privat Amanah & Terpercaya", img: "https://i.ibb.co.com/V0rL0CrD/625809-80kb.jpg" },
  { id: 1791609090989, title: "EKSKLUSIF AGENSI PARTNER", sub: "Lotus & Noctis Angel Showcase", img: "https://i.ibb.co.com/675cRvpM/1791606841165.jpg" },
  { id: 1792128731584, title: "PEMESANAN INSTAN TELEGRAM", sub: "Proses Cepat Dan Bebas Ribet", img: "https://i.ibb.co.com/r2hxFWzQ/IMG-20261016-123127.jpg" }
];

const initialVouchers = [
  { id: 1, code: "CLUBS10", discount: 10, active: true },
  { id: 2, code: "CLUBS25", discount: 25, active: true },
  { id: 3, code: "FREE100", discount: 100, active: true },
  { id: 1792214238325, code: "CN5000", discount: 0, fixedAmount: 5000, active: true }
];

const initialMockTalents = [
  {
    id: 1791690811405, img: "https://media-cn.my.id/assets-pict/1791690811405_IMG-20261011-105102-470.jpg", name: "Ara Lotus", category: "VCService", agency: "Lotus", status: "ready", vibe: ["GFE", "Manja"], video: "https://media-cn.my.id/assets-video/1791690755_pcvtwew6lpm3zjvkbg35.mp4", audio: "", rating: 4.9, sessions: 40, likes: 113,
    comments: [{ author: "Danang jogja", text: "Aura cantiknya mahal parah!" }], customServices: { a: { m3: 0, m5: 65000, m7: 0, m10: 90000 }, b: { m3: 0, m5: 165000, m7: 0, m10: 260000 }, e: { m3: 0, m5: 105000, m7: 0, m10: 150000 }, f: { m3: 0, m5: 220000, m7: 0, m10: 315000 } }
  },
  {
    id: 1791538967196, img: "https://media-cn.my.id/assets-pict/1791538967196_7rba0n.jpg", name: "Nativa", category: "VCService", agency: "Clubs'Night", status: "ready", vibe: ["Deep Talk"], video: "https://media-cn.my.id/assets-video/1791538888_j0mhve215yr2hjira0yf.mp4", audio: "", rating: 4.9, sessions: 19, likes: 41,
    comments: [{ author: "Sultan Pasopati", text: "Cantiknya dapet, seksoynya juga dapet." }], customServices: { a: 70000, b: 160000, c: 100000, d: 190000, e: 110000, f: 200000 }
  },
  {
    id: 1791692499507, img: "https://media-cn.my.id/assets-pict/1791692499507_IMG-20261011-110222-483.jpg", name: "Rubyy", category: "VCService", agency: "Lotus", status: "ready", vibe: ["Manja"], video: "https://media-cn.my.id/assets-video/1791692394_odrnybkmyyzmvamkbpoh.mp4", audio: "", rating: 4.9, sessions: 40, likes: 97,
    comments: [{ author: "Mahesa Samudra", text: "Manis banget senyumnya" }], customServices: { a: 65000, b: 145000, c: 70000, e: 105000, f: 190000 }
  },
  {
    id: 1791520427694, img: "https://media-cn.my.id/assets-pict/1791520427694_623638-50kb.jpg", name: "Kiky", category: "VCService", agency: "Clubs'Night", status: "busy", vibe: ["Cosplay"], video: "https://media-cn.my.id/assets-video/1791520331_mkioon007wngwkuxhg2j.mp4", audio: "", rating: 4.9, sessions: 63, likes: 115,
    comments: [{ author: "Damar Galih", text: "Mulus, seksi, montok." }], customServices: { a: 55000, b: 115000, c: 60000, d: 120000, e: 75000, f: 135000 }
  }
];

// ==================== TESTIMONI & REAL-TIME ORDER TELEGRAM ====================
let testimonialList = [
  { name: "Meja hijau", service: "Ara Lotus (VCService - Atas saja dengan face)", session: "5 menit", total: "Rp 65.000", datetime: "2026-10-18 21:15" },
  { name: "fth", service: "Nativa (VCService - Fullbody tanpa face)", session: "7 menit", total: "Rp 110.000", datetime: "2026-10-18 21:02" },
  { name: "yuda", service: "Rubyy (BOP Service - /+ Dengan Request)", session: "10 menit", total: "Rp 190.000", datetime: "2026-10-18 20:45" },
  { name: "누르", service: "Kiky (VCService - Bawah saja dengan face)", session: "3 menit", total: "Rp 120.000", datetime: "2026-10-18 20:12" },
  { name: "biang kerok", service: "Ara Lotus (VCService - Atas saja tanpa face)", session: "5 menit", total: "Rp 65.000", datetime: "2026-10-18 19:50" },
  { name: "setan judi", service: "Nativa (BOP Service - /- Tanpa Request)", session: "7 menit", total: "Rp 150.000", datetime: "2026-10-18 19:25" },
  { name: "pucuk", service: "Rubyy (VCService - Fullbody dengan face)", session: "10 menit", total: "Rp 190.000", datetime: "2026-10-18 19:00" }
];

function renderTestimonials() {
  const tbody = document.getElementById('testimonialTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  
  testimonialList.forEach((item, index) => {
    let tr = document.createElement('tr');
    tr.innerHTML = `
      <td><b>#${index + 1}</b></td>
      <td><span style="color:var(--neon-cyan); font-weight:700;">${item.name}</span></td>
      <td>${item.service}</td>
      <td><span class="talent-tag">${item.session}</span></td>
      <td><b style="color:var(--neon-green);">${item.total}</b></td>
      <td style="font-size:0.68rem; color:var(--text-muted);">${item.datetime}</td>
    `;
    tbody.appendChild(tr);
  });
}

function showTestimonials() {
  const gallery = document.getElementById('galleryView');
  const detail = document.getElementById('detailView');
  const blog = document.getElementById('blogView');
  const testimoni = document.getElementById('testimoniView');
  
  if (gallery) gallery.style.display = 'none';
  if (detail) detail.style.display = 'none';
  if (blog) blog.style.display = 'none';
  if (testimoni) testimoni.style.display = 'block';
  
  renderTestimonials();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function logRealTimeOrder(clientName, talentName, serviceType, durationText, totalPrice) {
  let now = new Date();
  let dateStr = now.toISOString().slice(0, 10) + ' ' + now.toTimeString().slice(0, 5);
  let newOrder = {
    name: clientName || "Anonymous User",
    service: `${talentName} (${serviceType})`,
    session: durationText,
    total: formatCurrency(totalPrice),
    datetime: dateStr
  };
  testimonialList.unshift(newOrder);
}

function safeParseLocal(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

let talents = safeParseLocal('cn_talents', initialMockTalents);
let banners = safeParseLocal('cn_banners', initialBanners);
let vouchers = safeParseLocal('cn_vouchers', initialVouchers);
let favorites = safeParseLocal('cn_favs', [1791692499507, 1791610333708, 1791624444788, 1791526362715]);

let currentCategory = 'All';
let currentVibeFilter = 'All';
let visibleCount = 6;
let activeTalent = null;
let activeCommentTalentId = null;
let selectedCustomPrice = 0;
let activeAppliedVoucher = null;
let logoClickCount = 0;
let logoClickTimer = null;

let reelObserver = null;
let isGlobalMuted = false;
let currentBannerIndex = 0;
let isDragging = false;
let startX = 0;
let currentTranslate = 0;
let prevTranslate = 0;
let animationID = 0;
let bannerAutoTimer = null;

let isAdDismissed = false;
let scrollStopTimer = null;
let isSyncingCloud = false;

// ==================== TOUR SYSTEM ====================
let currentTourStep = 0;
const TOUR_STORAGE_KEY = 'cn_has_seen_tour_v1';

const tourSteps = [
  { step: 1, selector: '#mainHeader', title: 'Header & Akses Cepat 🧭', desc: 'Di sini Anda dapat mengakses menu utama, mengganti mata uang, dan melihat agensi partner resmi.' },
  { step: 2, selector: '#bannerContainer', title: 'Banner Promosi 🔥', desc: 'Geser banner ini untuk melihat penawaran spesial dan diskon voucher.' },
  { step: 3, selector: '.unified-icon-nav-box', title: 'Navigasi & Filter Karakter 🔍', desc: 'Gunakan ikon-ikon ini untuk menyaring talent berdasarkan Kategori maupun Vibe.' },
  { step: 4, selector: '#reelsFeedSection', title: 'Reels Video Showcase 🎬', desc: 'Nikmati cuplikan video nyata dari talent! Anda dapat menyukai dan booking.' },
  { step: 5, selector: '#cn-chat-btn', title: 'Live Chat CS & Clubsnight Asisstant 🤖', desc: 'Butuh bantuan order atau chat langsung dengan Admin Telegram? Klik di sini.' }
];

function checkAndStartWebsiteTour() {
  const hasSeenTour = localStorage.getItem(TOUR_STORAGE_KEY);
  const ageVerified = localStorage.getItem('cn_age_verified');
  if (!hasSeenTour && ageVerified) {
    setTimeout(() => { startWebsiteTour(); }, 1000);
  }
}

function startWebsiteTour() { return; }

function renderTourStep() {
  document.querySelectorAll('.tour-highlight').forEach(el => el.classList.remove('tour-highlight'));

  if (currentTourStep >= tourSteps.length) {
    endWebsiteTour();
    return;
  }

  const data = tourSteps[currentTourStep];
  const targetEl = document.querySelector(data.selector);
  const badgeEl = document.getElementById('tourStepBadge');
  const titleEl = document.getElementById('tourTitle');
  const descEl = document.getElementById('tourDesc');
  const nextBtn = document.getElementById('tourNextBtn');

  if (badgeEl) badgeEl.innerText = `Langkah ${data.step} / ${tourSteps.length}`;
  if (titleEl) titleEl.innerText = data.title;
  if (descEl) descEl.innerText = data.desc;

  if (nextBtn) {
    nextBtn.innerHTML = (currentTourStep === tourSteps.length - 1) ? 
      `Selesai <i class="fa-solid fa-check"></i>` : 
      `Lanjut <i class="fa-solid fa-arrow-right"></i>`;
  }

  if (targetEl) {
    targetEl.classList.add('tour-highlight');
    targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });

    setTimeout(() => {
      updateTourSpotlight(targetEl);
      positionTourCard(targetEl);
    }, 300);
  } else {
    nextTourStep();
  }
}

function updateTourSpotlight(targetEl) {
  const rect = targetEl.getBoundingClientRect();
  const cutout = document.getElementById('tourMaskCutout');
  const border = document.getElementById('tourSpotlightBorder');

  if (cutout && border) {
    const padding = 6;
    const x = Math.max(0, rect.left - padding);
    const y = Math.max(0, rect.top - padding);
    const w = rect.width + (padding * 2);
    const h = rect.height + (padding * 2);

    cutout.setAttribute('x', x);
    cutout.setAttribute('y', y);
    cutout.setAttribute('width', w);
    cutout.setAttribute('height', h);

    border.setAttribute('x', x);
    border.setAttribute('y', y);
    border.setAttribute('width', w);
    border.setAttribute('height', h);
  }
}

function positionTourCard(targetEl) {
  const box = document.getElementById('cnTourBox');
  if (!box) return;

  const rect = targetEl.getBoundingClientRect();
  const viewportHeight = window.innerHeight;
  const viewportWidth = window.innerWidth;
  const boxHeight = box.offsetHeight || 180;
  const boxWidth = box.offsetWidth || 300;

  let leftPos = (viewportWidth - boxWidth) / 2;
  let topPos = 0;
  const spaceBelow = viewportHeight - rect.bottom;
  const spaceAbove = rect.top;

  if (spaceBelow >= boxHeight + 20) {
    topPos = rect.bottom + 16;
  } else if (spaceAbove >= boxHeight + 20) {
    topPos = rect.top - boxHeight - 16;
  } else {
    topPos = Math.max(20, (viewportHeight - boxHeight) / 2);
  }

  topPos = Math.max(16, Math.min(topPos, viewportHeight - boxHeight - 16));

  box.style.left = `${leftPos}px`;
  box.style.top = `${topPos}px`;
  box.style.transform = 'none';
}

function nextTourStep() {
  currentTourStep++;
  renderTourStep();
}

function skipTour() {
  endWebsiteTour();
}

function endWebsiteTour() {
  document.body.classList.remove('tour-active');
  document.querySelectorAll('.tour-highlight').forEach(el => el.classList.remove('tour-highlight'));
  
  const overlay = document.getElementById('cnTourSvgOverlay');
  const box = document.getElementById('cnTourBox');
  if (overlay) overlay.style.display = 'none';
  if (box) box.style.display = 'none';

  localStorage.setItem(TOUR_STORAGE_KEY, 'true');
  showToast("Panduan selesai! Selamat menjelajah ✨");
}

window.addEventListener('resize', () => {
  const box = document.getElementById('cnTourBox');
  if (box && box.style.display !== 'none') {
    const data = tourSteps[currentTourStep];
    const targetEl = document.querySelector(data?.selector);
    if (targetEl) {
      updateTourSpotlight(targetEl);
      positionTourCard(targetEl);
    }
  }
});

function applyStateAndRefreshUI(dataObj) {
  if (!dataObj) return;
  if (Array.isArray(dataObj.talents)) talents = dataObj.talents;
  if (Array.isArray(dataObj.banners)) banners = dataObj.banners;
  if (Array.isArray(dataObj.vouchers)) vouchers = dataObj.vouchers;
  if (Array.isArray(dataObj.favorites)) favorites = dataObj.favorites;

  renderBanners();
  renderTalents();
  const devPanel = document.getElementById('devPanelView');
  if (devPanel && devPanel.style.display === 'block') {
    renderDevTable();
    renderBannerTable();
    renderVoucherTable();
  }
}

if (syncChannel) {
  syncChannel.onmessage = (event) => {
    if (event.data && event.data.type === 'CN_DATA_UPDATED') {
      applyStateAndRefreshUI(event.data.payload);
    }
  };
}

window.addEventListener('storage', (event) => {
  if (event.key === 'cn_talents' || event.key === 'cn_banners' || event.key === 'cn_vouchers') {
    talents = safeParseLocal('cn_talents', talents);
    banners = safeParseLocal('cn_banners', banners);
    vouchers = safeParseLocal('cn_vouchers', vouchers);
    favorites = safeParseLocal('cn_favs', favorites);
    applyStateAndRefreshUI({ talents, banners, vouchers, favorites });
  }
});

function saveToLocalStorage(timestampIso) {
  const ts = timestampIso || new Date().toISOString();
  localStorage.setItem('cn_talents', JSON.stringify(talents));
  localStorage.setItem('cn_banners', JSON.stringify(banners));
  localStorage.setItem('cn_vouchers', JSON.stringify(vouchers));
  localStorage.setItem('cn_favs', JSON.stringify(favorites));
  localStorage.setItem('cn_updated_at', ts);

  if (syncChannel) {
    syncChannel.postMessage({
      type: 'CN_DATA_UPDATED',
      payload: { talents, banners, vouchers, favorites, updatedAt: ts }
    });
  }
}

async function loadCloudflareData(forceAccept = false) {
  try {
    const res = await fetch(`${WORKER_API_URL}/api/get?t=${Date.now()}`, {
      method: "GET", cache: "no-store", headers: { "Accept": "application/json" }
    });
    if (!res.ok) return;
    const result = await res.json();
    if (result && result.success && result.data) {
      const serverData = result.data;
      if (Array.isArray(serverData.talents) && serverData.talents.length > 0) talents = serverData.talents;
      if (Array.isArray(serverData.banners) && serverData.banners.length > 0) banners = serverData.banners;
      if (Array.isArray(serverData.vouchers) && serverData.vouchers.length > 0) vouchers = serverData.vouchers;
      if (Array.isArray(serverData.favorites)) favorites = serverData.favorites;

      saveToLocalStorage(serverData.updatedAt || new Date().toISOString());
      applyStateAndRefreshUI({ talents, banners, vouchers, favorites });
    }
  } catch (err) {}
}

async function saveToCloudflareD1(silent = false) {
  const nowIso = new Date().toISOString();
  saveToLocalStorage(nowIso);
  if (isSyncingCloud) return true;
  isSyncingCloud = true;
  const payload = { talents, banners, vouchers, favorites, updatedAt: nowIso };

  let success = false;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(`${WORKER_API_URL}/api/save?t=${Date.now()}`, {
        method: "POST", cache: "no-store", headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${sessionStorage.getItem("cn_admin_token") || ""}`
        },
        body: JSON.stringify(payload)
      });
      if (res.ok) { success = true; break; }
    } catch (err) {}
  }
  isSyncingCloud = false;
  return success;
}

window.addEventListener('DOMContentLoaded', async () => {
  if (!localStorage.getItem('cn_age_verified')) {
    const ageModal = document.getElementById('ageGateModal');
    if (ageModal) ageModal.style.display = 'flex';
  }
  
  injectVibeSelectorIntoDevForm();

  if (sessionStorage.getItem('cn_dev_logged_in') === 'true') {
    const devPanel = document.getElementById('devPanelView');
    if (devPanel) { devPanel.style.display = 'block'; renderDevTable(); }
  }

  renderBanners();
  initBannerDrag();
  startBannerAutoPlay();
  renderTalents();
  initScrollAdEngine();
  initAdSwipeGestures();
  initDraggableChatWidget();
  initHighContrastCanvas();
  initBackToTopButton();

  await loadCloudflareData();
  checkAndStartWebsiteTour();
});

function initAdSwipeGestures() {
  const adCard = document.getElementById('floatingMediaAd');
  if (!adCard) return;
  let startX = 0, startY = 0, moveX = 0, moveY = 0, isSwiping = false;

  function handleStart(e) {
    if (e.target.closest('.floating-ad-btn') || e.target.closest('.floating-ad-close')) return;
    const point = e.touches ? e.touches[0] : e;
    startX = point.clientX; startY = point.clientY;
    moveX = 0; moveY = 0; isSwiping = true;
    adCard.classList.add('swiping');
  }

  function handleMove(e) {
    if (!isSwiping) return;
    const point = e.touches ? e.touches[0] : e;
    moveX = point.clientX - startX; moveY = point.clientY - startY;
    adCard.style.transform = `translate(calc(-50% + ${moveX}px), ${moveY}px)`;
  }

  function handleEnd() {
    if (!isSwiping) return;
    isSwiping = false;
    adCard.classList.remove('swiping');
    adCard.style.transform = ''; adCard.style.opacity = '';
    if (moveX < -75 || moveX > 75 || moveY > 60) {
      adCard.classList.add('dismissed-left');
      closeMediaAdPermanently();
    }
  }

  adCard.addEventListener('touchstart', handleStart, { passive: true });
  adCard.addEventListener('touchmove', handleMove, { passive: true });
  adCard.addEventListener('touchend', handleEnd, { passive: true });
  adCard.addEventListener('mousedown', handleStart);
  document.addEventListener('mousemove', handleMove);
  document.addEventListener('mouseup', handleEnd);
}

// ==================== DRAWER INFORMASI & TOMBOL LEPAS FILTER ====================
function updateNavInfoDrawer(title, desc) {
  const titleEl = document.getElementById('navInfoTitle');
  const descEl = document.getElementById('navInfoDesc');
  const resetBtn = document.getElementById('btnResetFilter');

  if (titleEl) titleEl.innerHTML = `<i class="fa-solid fa-circle-info"></i> ${title}`;
  if (descEl) descEl.innerText = desc;

  if (resetBtn) {
    if (currentCategory !== 'All' || currentVibeFilter !== 'All') {
      resetBtn.style.display = 'inline-flex';
    } else {
      resetBtn.style.display = 'none';
    }
  }
}

// Klik 1x: Pasang Filter | Klik Ulang Tombol yang Sama: Lepas Filter
function setCategory(cat, el, title, desc) {
  if (currentCategory === cat && cat !== 'All') {
    resetAllFilters();
    return;
  }

  currentCategory = cat;

  const firstRow = document.querySelector('.icon-nav-row:not(.sub-row)');
  if (firstRow) {
    firstRow.querySelectorAll('.icon-chip').forEach(b => b.classList.remove('active', 'active-gradient'));
  }
  const favBtn = document.querySelector(".sub-row .icon-chip[onclick*=\"'Favorit'\"]");
  if (favBtn) favBtn.classList.remove('active', 'active-gradient');

  if (el) el.classList.add('active-gradient');

  updateNavInfoDrawer(title || cat, desc || '');
  filterTalents();
}

// Klik 1x: Pasang Vibe | Klik Ulang Tombol yang Sama: Lepas Vibe
function filterByVibe(vibe, el, title, desc) {
  if (currentVibeFilter === vibe && vibe !== 'All') {
    currentVibeFilter = 'All';
    const subRow = document.querySelector('.icon-nav-row.sub-row');
    if (subRow) subRow.querySelectorAll('.icon-chip').forEach(c => c.classList.remove('active', 'active-gradient'));
    const allVibeBtn = document.querySelector(".sub-row .icon-chip[onclick*=\"filterByVibe('All'\"]");
    if (allVibeBtn) allVibeBtn.classList.add('active-gradient');

    updateNavInfoDrawer(currentCategory === 'All' ? 'Semua Reels Feed' : currentCategory, 'Filter karakter dinonaktifkan.');
    filterTalents();
    return;
  }

  currentVibeFilter = vibe;
  const subRow = document.querySelector('.icon-nav-row.sub-row');
  if (subRow) {
    subRow.querySelectorAll('.icon-chip:not([onclick*="setCategory"])').forEach(c => c.classList.remove('active', 'active-gradient'));
  }
  if (el) el.classList.add('active-gradient');

  updateNavInfoDrawer(title || vibe, desc || '');
  filterTalents();
}

// Fungsi Melepas Seluruh Filter Sekaligus
function resetAllFilters() {
  currentCategory = 'All';
  currentVibeFilter = 'All';

  document.querySelectorAll('.icon-chip').forEach(c => c.classList.remove('active', 'active-gradient'));

  const defaultCatBtn = document.querySelector(".icon-nav-row:not(.sub-row) .icon-chip[onclick*=\"'All'\"]");
  const defaultVibeBtn = document.querySelector(".sub-row .icon-chip[onclick*=\"filterByVibe('All'\"]");

  if (defaultCatBtn) defaultCatBtn.classList.add('active-gradient');
  if (defaultVibeBtn) defaultVibeBtn.classList.add('active-gradient');

  const searchInput = document.getElementById('searchInput');
  if (searchInput) searchInput.value = '';

  updateNavInfoDrawer('Semua Reels Feed', 'Menampilkan seluruh koleksi video reels & talent.');
  filterTalents();
  showToast("Filter dilepas, menampilkan semua talent ✨");
}

function initDraggableChatWidget() {
  const widget = document.getElementById('cn-chat-widget');
  const trigger = document.getElementById('cn-chat-btn');
  const chatHeader = document.getElementById('cnChatHeaderDrag');
  if (!widget || !trigger) return;

  let isDraggingWidget = false, currentX, currentY, initialX, initialY, xOffset = 0, yOffset = 0;

  function dragStart(e) {
    if (e.type === "touchstart") {
      initialX = e.touches[0].clientX - xOffset; initialY = e.touches[0].clientY - yOffset;
    } else {
      initialX = e.clientX - xOffset; initialY = e.clientY - yOffset;
    }
    if (e.target === trigger || trigger.contains(e.target) || e.target === chatHeader || chatHeader?.contains(e.target)) {
      isDraggingWidget = true;
    }
  }

  function dragEnd() { initialX = currentX; initialY = currentY; isDraggingWidget = false; }

  function drag(e) {
    if (isDraggingWidget) {
      e.preventDefault();
      if (e.type === "touchmove") {
        currentX = e.touches[0].clientX - initialX; currentY = e.touches[0].clientY - initialY;
      } else {
        currentX = e.clientX - initialX; currentY = e.clientY - initialY;
      }
      xOffset = currentX; yOffset = currentY;
      widget.style.transform = `translate3d(${currentX}px, ${currentY}px, 0)`;
    }
  }

  widget.addEventListener("touchstart", dragStart, { passive: false });
  widget.addEventListener("touchend", dragEnd, { passive: true });
  widget.addEventListener("touchmove", drag, { passive: false });
  widget.addEventListener("mousedown", dragStart);
  document.addEventListener("mouseup", dragEnd);
  document.addEventListener("mousemove", drag);
}

function initHighContrastCanvas() {
  const canvas = document.getElementById('ambientCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d', { alpha: true });
  let width = 0, height = 0;
  
  const PARTICLE_COUNT = window.innerWidth < 768 ? 14 : 24;
  const particles = [];

  function resizeCanvas() { width = canvas.width = window.innerWidth; height = canvas.height = window.innerHeight; }
  window.addEventListener('resize', resizeCanvas, { passive: true });
  resizeCanvas();

  const neonColors = ['rgba(255, 23, 68, 0.35)', 'rgba(124, 58, 237, 0.4)', 'rgba(56, 189, 248, 0.35)'];

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    particles.push({
      x: Math.random() * width, y: Math.random() * height,
      r: Math.random() * 2.8 + 1, vx: (Math.random() - 0.5) * 0.3, vy: -Math.random() * 0.4 - 0.15,
      waveAngle: Math.random() * Math.PI, color: neonColors[i % neonColors.length]
    });
  }

  function renderLoop() {
    ctx.clearRect(0, 0, width, height);
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const p = particles[i];
      p.waveAngle += 0.02;
      p.x += p.vx + Math.sin(p.waveAngle) * 0.3;
      p.y += p.vy;

      if (p.y < -10) { p.y = height + 10; p.x = Math.random() * width; }
      if (p.x < -10) p.x = width + 10;
      if (p.x > width + 10) p.x = -10;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.shadowBlur = 8; 
      ctx.shadowColor = p.color;
      ctx.fill();
    }
    requestAnimationFrame(renderLoop);
  }
  requestAnimationFrame(renderLoop);
}

function initBackToTopButton() {
  const btn = document.getElementById('btnBackToTop');
  if (!btn) return;
  window.addEventListener('scroll', () => {
    if (window.scrollY > 300) btn.classList.add('show');
    else btn.classList.remove('show');
  }, { passive: true });
}

function scrollToTopPage() { window.scrollTo({ top: 0, behavior: 'smooth' }); }

function toggleCnChat() {
  const box = document.getElementById("cn-chat-box");
  if (!box) return;
  box.style.display = box.style.display === "none" ? "flex" : "none";
  if (box.style.display === "flex") {
    const container = document.getElementById("cn-messages");
    if (container) container.scrollTop = container.scrollHeight;
  }
}

function sendQuickMsg(text) {
  const input = document.getElementById("cn-input");
  if (!input) return;
  input.value = text;
  sendCnMessage();
}

async function connectToAdminTelegram() {
  appendCnMessage("Meminta terhubung langsung ke Admin CS Telegram...", "user");
  const loadingDivId = "loading-msg-" + Date.now();
  appendCnMessage("Menghubungkan ke Admin...", "bot", loadingDivId);
  try {
    await fetch(`${LIVECHAT_WORKER_URL}/api/chat`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: cnSessionId, message: "[SYSTEM ALERT] Pengunjung meminta sambungan langsung ke Admin CS Telegram.", connect_admin: true })
    });
  } catch (e) {}
  const loadingEl = document.getElementById(loadingDivId);
  if (loadingEl) loadingEl.remove();
  appendCnMessage(
    `Permintaan Anda diterima. Klik tombol di bawah ini untuk membuka chat langsung dengan Admin CS kami di Telegram:<br><br>` +
    `<a href="${TELEGRAM_CS_BOT_URL}" target="_blank" style="display:inline-block; padding:8px 14px; background:linear-gradient(135deg, var(--neon-purple), var(--crimson-red)); color:#fff; font-weight:800; border-radius:8px; text-decoration:none;">➔ Buka Chat Admin Telegram</a>`,
    "bot"
  );
  setTimeout(() => { window.open(TELEGRAM_CS_BOT_URL, "_blank"); }, 1000);
}

// ==================== LIVECHAT AI LLAMA 3.1 REAL-TIME CALL ====================
async function sendCnMessage() {
  const input = document.getElementById("cn-input");
  if (!input) return;
  const msg = input.value.trim();
  if (!msg) return;

  appendCnMessage(msg, "user");
  input.value = "";

  const loadingDivId = "loading-msg-" + Date.now();
  appendCnMessage("Sedang mengetik...", "bot", loadingDivId);

  // Saring talent yang aktif ready untuk dikirim ke instruksi AI
  const readyTalentsList = talents
    .filter(t => (t.status || 'ready') === 'ready')
    .map(t => ({ name: t.name, agency: t.agency || "Clubs'Night", category: t.category }));

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const res = await fetch(`${LIVECHAT_WORKER_URL}/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      signal: controller.signal,
      body: JSON.stringify({
        session_id: cnSessionId,
        message: msg,
        talentsData: readyTalentsList
      })
    });

    clearTimeout(timeoutId);
    const loadingEl = document.getElementById(loadingDivId);
    if (loadingEl) loadingEl.remove();

    if (!res.ok) throw new Error(`HTTP error ${res.status}`);

    const data = await res.json();
    const botReply = data.response || data.reply || data.reply_text || data.message;

    if (botReply) {
      appendCnMessage(botReply, "bot");
    } else {
      appendCnMessage("Halo! Ada yang bisa dibantu seputar pemesanan talent?", "bot");
    }
  } catch (err) {
    console.error("AI Error:", err);
    const loadingEl = document.getElementById(loadingDivId);
    if (loadingEl) loadingEl.remove();
    appendCnMessage("Koneksi AI sedang lambat. Silakan hubungi <b>Admin CS</b> Telegram langsung ya!", "bot");
  }
}

function appendCnMessage(text, sender, elementId = null) {
  const container = document.getElementById("cn-messages");
  if (!container) return;
  const msgDiv = document.createElement("div");
  if (elementId) msgDiv.id = elementId;
  msgDiv.style.padding = "10px 12px";
  msgDiv.style.borderRadius = "12px";
  msgDiv.style.maxWidth = "88%";
  msgDiv.style.lineHeight = "1.45";
  msgDiv.style.wordBreak = "break-word";

  const formattedText = parseMarkdownToHtml(text);

  if (sender === "user") {
    msgDiv.style.background = "linear-gradient(135deg, var(--neon-purple), var(--crimson-red))";
    msgDiv.style.color = "#ffffff"; 
    msgDiv.style.alignSelf = "flex-end";
    msgDiv.innerHTML = formattedText;
  } else {
    msgDiv.style.background = "rgba(124, 58, 237, 0.14)";
    msgDiv.style.border = "1px solid var(--card-border)";
    msgDiv.style.color = "#ffffff"; 
    msgDiv.style.alignSelf = "flex-start";
    msgDiv.innerHTML = formattedText;
  }
  container.appendChild(msgDiv);
  container.scrollTop = container.scrollHeight;
}

function getStatusBadgeHTML(status) {
  if (status === 'busy') return `<span class="status-badge busy"><span class="status-dot-busy"></span> Antrean</span>`;
  if (status === 'offline') return `<span class="status-badge offline"><span class="status-dot-offline"></span> Close Order</span>`;
  return `<span class="status-badge ready"><span class="status-dot-ready"></span> Ready</span>`;
}

function showToast(msg) {
  const box = document.getElementById('toastBox');
  const textEl = document.getElementById('toastMsg');
  if (!box || !textEl) return;
  textEl.innerText = msg;
  box.style.display = 'inline-flex';
  clearTimeout(box._hideTimer);
  box._hideTimer = setTimeout(() => { box.style.display = 'none'; }, 2600);
}

function exportDataJSON() {
  const backupData = { talents, banners, vouchers, favorites, updatedAt: new Date().toISOString() };
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(backupData, null, 2));
  const downloadAnchor = document.createElement('a');
  downloadAnchor.setAttribute("href", dataStr);
  downloadAnchor.setAttribute("download", `clubsnight_backup_${new Date().toISOString().slice(0, 10)}.json`);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
  showToast("Backup JSON berhasil diunduh!");
}

function triggerImportJSON() {
  const fileInput = document.getElementById('jsonFileInput');
  if (fileInput) fileInput.click();
}

async function importDataJSON(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async function(e) {
    try {
      const parsed = JSON.parse(e.target.result);
      if (parsed && Array.isArray(parsed.talents)) {
        talents = parsed.talents;
        banners = parsed.banners || banners;
        vouchers = parsed.vouchers || vouchers;
        favorites = parsed.favorites || favorites;
        await saveToCloudflareD1();
        applyStateAndRefreshUI({ talents, banners, vouchers, favorites });
        showToast("Data berhasil disinkronkan ke server!");
      }
    } catch (err) { alert("File JSON tidak valid!"); }
  };
  reader.readAsText(file);
  event.target.value = '';
}

function changeCurrency(val) {
  currentCurrency = val;
  renderTalents();
  if (activeTalent) openDetail(activeTalent);
  updateTotalDisplay();
}

function formatCurrency(amountInIDR) {
  let curr = currencyRates[currentCurrency] || currencyRates['IDR'];
  let converted = amountInIDR * curr.rate;
  if (currentCurrency === 'IDR') {
    return curr.symbol + Math.round(converted).toLocaleString('id-ID');
  } else {
    return curr.symbol + converted.toFixed(2);
  }
}

function formatPrice(amount) {
  return formatCurrency(amount);
}

function getMinPrice(talent) {
  if (!talent || !talent.customServices) return 0;
  let prices = [];
  Object.values(talent.customServices).forEach(item => {
    if (typeof item === 'object' && item !== null) {
      prices.push(...Object.values(item).map(Number).filter(p => p > 0));
    } else if (Number(item) > 0) { prices.push(Number(item)); }
  });
  return prices.length > 0 ? Math.min(...prices) : 0;
}

function getAdminFee(basePrice) {
  if (basePrice <= 0) return 0;
  if (basePrice < 100000) return 10000;
  if (basePrice >= 100000 && basePrice < 250000) return 15000;
  return 20000;
}

function renderBanners() {
  const wrapper = document.getElementById('bannerWrapper');
  const dots = document.getElementById('bannerDots');
  if (!wrapper || !dots) return;
  wrapper.innerHTML = ''; dots.innerHTML = '';
  const activeBanners = banners.slice(0, 4);

  activeBanners.forEach((b, i) => {
    const slide = document.createElement('div');
    slide.className = 'banner-slide';
    slide.style.backgroundImage = `url('${getCompressedImageUrl(b.img, 800, 75)}')`;
    wrapper.appendChild(slide);

    const dot = document.createElement('div');
    dot.className = `banner-dot ${i === 0 ? 'active' : ''}`;
    dot.onclick = () => { setBannerIndex(i); resetBannerAutoPlay(); };
    dots.appendChild(dot);
  });
  setBannerIndex(currentBannerIndex);
}

function startBannerAutoPlay() {
  clearInterval(bannerAutoTimer);
  bannerAutoTimer = setInterval(() => {
    const count = Math.min(banners.length, 4);
    if (count <= 1) return;
    currentBannerIndex = (currentBannerIndex + 1) % count;
    setBannerIndex(currentBannerIndex);
  }, 3800);
}

function resetBannerAutoPlay() { clearInterval(bannerAutoTimer); startBannerAutoPlay(); }

function initBannerDrag() {
  const container = document.getElementById('bannerContainer');
  if (!container) return;
  container.addEventListener('touchstart', touchStart, { passive: true });
  container.addEventListener('touchend', touchEnd, { passive: true });
  container.addEventListener('touchmove', touchMove, { passive: true });
}

function touchStart(event) {
  clearInterval(bannerAutoTimer); isDragging = true; startX = getPositionX(event);
  animationID = requestAnimationFrame(animation);
}

function touchMove(event) {
  if (isDragging) {
    const currentPosition = getPositionX(event);
    currentTranslate = prevTranslate + currentPosition - startX;
  }
}

function touchEnd() {
  if (!isDragging) return;
  isDragging = false; cancelAnimationFrame(animationID);
  const movedBy = currentTranslate - prevTranslate;
  const count = Math.min(banners.length, 4);
  if (movedBy < -40 && currentBannerIndex < count - 1) currentBannerIndex += 1;
  if (movedBy > 40 && currentBannerIndex > 0) currentBannerIndex -= 1;
  setBannerIndex(currentBannerIndex);
  startBannerAutoPlay();
}

function getPositionX(event) { return event.type.includes('mouse') ? event.pageX : event.touches[0].clientX; }
function animation() { setSliderPosition(); if (isDragging) requestAnimationFrame(animation); }
function setSliderPosition() {
  const wrapper = document.getElementById('bannerWrapper');
  if (wrapper) wrapper.style.transform = `translate3d(${currentTranslate}px, 0, 0)`;
}

function setBannerIndex(idx) {
  const count = Math.min(banners.length, 4);
  if (idx >= count) idx = 0;
  currentBannerIndex = idx;
  const container = document.getElementById('bannerContainer');
  if (!container) return;
  const width = container.clientWidth;
  currentTranslate = currentBannerIndex * -width;
  prevTranslate = currentTranslate;
  setSliderPosition();
  document.querySelectorAll('.banner-dot').forEach((d, i) => {
    if (i === currentBannerIndex) d.classList.add('active');
    else d.classList.remove('active');
  });
}

function initScrollAdEngine() {
  const adCard = document.getElementById('floatingMediaAd');
  if (!adCard) return;
  window.addEventListener('scroll', () => {
    if (isAdDismissed) return;
    adCard.style.opacity = '0.3';
    clearTimeout(scrollStopTimer);
    scrollStopTimer = setTimeout(() => { if (!isAdDismissed) adCard.style.opacity = '1'; }, 1100);
  }, { passive: true });
}

function closeMediaAdPermanently() {
  isAdDismissed = true;
  const adCard = document.getElementById('floatingMediaAd');
  if (adCard) { adCard.style.opacity = '0'; setTimeout(() => { adCard.style.display = 'none'; }, 300); }
  clearTimeout(scrollStopTimer);
  showToast("Iklan promosi ditutup.");
}

function trackMediaAdClick() { showToast("Mengarahkan ke Media Bot Telegram..."); }

function injectVibeSelectorIntoDevForm() {
  const statusEl = document.getElementById('devTalentStatus');
  if (!statusEl || document.getElementById('devTalentVibeContainer')) return;
  const statusGroup = statusEl.closest('.form-group');
  if (!statusGroup) return;

  const vibeGroup = document.createElement('div');
  vibeGroup.id = 'devTalentVibeContainer';
  vibeGroup.className = 'form-group';
  vibeGroup.style.marginTop = '8px';
  vibeGroup.innerHTML = `
    <label style="color:var(--amethyst-light); font-weight:700;">Karakter / Vibe Sesi Talent:</label>
    <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:4px;">
      ${AVAILABLE_VIBES.map(v => `
        <label style="display:inline-flex; align-items:center; gap:5px; background:rgba(124,58,237,0.14); border:1px solid var(--card-border); padding:6px 11px; border-radius:99px; font-size:0.72rem; color:#fff; cursor:pointer;">
          <input type="checkbox" class="dev-vibe-chk" value="${v}" style="accent-color:var(--crimson-red);">
          <span>${v}</span>
        </label>
      `).join('')}
    </div>
  `;
  statusGroup.insertAdjacentElement('afterend', vibeGroup);
}

function openBannerManager() {
  const bannerCard = document.getElementById('devBannerCard');
  if (bannerCard) bannerCard.style.display = 'block';
  renderBannerTable();
}

function hideBannerForm() {
  const bannerCard = document.getElementById('devBannerCard');
  if (bannerCard) bannerCard.style.display = 'none';
}

function renderBannerTable() {
  const tbody = document.getElementById('devBannerTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  banners.forEach(b => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><img src="${getCompressedImageUrl(b.img, 80, 50)}" style="width:44px; height:26px; object-fit:cover; border-radius:4px;"></td>
      <td><b>${b.title}</b></td>
      <td><button class="btn-danger" onclick="deleteBanner(${b.id})">Hapus</button></td>
    `;
    tbody.appendChild(tr);
  });
}

async function saveBannerData(e) {
  e.preventDefault();
  if (banners.length >= 4) { alert("Maksimal banner tertampil adalah 4!"); return; }
  const title = document.getElementById('devBannerTitle').value.trim();
  const sub = document.getElementById('devBannerSub').value.trim();
  const img = document.getElementById('devBannerImg').value.trim();
  banners.push({ id: Date.now(), title, sub, img });
  renderBanners(); renderBannerTable();
  document.getElementById('bannerForm')?.reset();
  await saveToCloudflareD1();
  showToast("Banner baru langsung aktif!");
}

async function deleteBanner(id) {
  banners = banners.filter(b => b.id !== id);
  renderBanners(); renderBannerTable();
  await saveToCloudflareD1();
  showToast("Banner dihapus!");
}

function openVoucherManager() {
  const voucherCard = document.getElementById('devVoucherCard');
  if (voucherCard) voucherCard.style.display = 'block';
  renderVoucherTable();
}

function hideVoucherForm() {
  const voucherCard = document.getElementById('devVoucherCard');
  if (voucherCard) voucherCard.style.display = 'none';
}

function renderVoucherTable() {
  const tbody = document.getElementById('devBannerTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  vouchers.forEach(v => {
    const tr = document.createElement('tr');
    const discLabel = v.fixedAmount ? `Potongan ${formatPrice(v.fixedAmount)}` : `Diskon ${v.discount}%`;
    tr.innerHTML = `
      <td><b style="color:var(--neon-green);">${v.code}</b></td>
      <td>${discLabel}</td>
      <td>${v.active ? '🟢 Aktif' : '🔴 Nonaktif'}</td>
      <td><button class="btn-danger" onclick="deleteVoucher(${v.id})">Hapus</button></td>
    `;
    tbody.appendChild(tr);
  });
}

async function saveVoucherData(e) {
  e.preventDefault();
  const code = document.getElementById('devVoucherCode').value.trim().toUpperCase();
  const val = document.getElementById('devVoucherType').value;
  if (!code) return;
  let newVoucher = val === '5000_fixed' ? 
    { id: Date.now(), code, discount: 0, fixedAmount: 5000, active: true } : 
    { id: Date.now(), code, discount: parseInt(val) || 10, active: true };

  vouchers.push(newVoucher);
  renderVoucherTable();
  document.getElementById('voucherForm')?.reset();
  await saveToCloudflareD1();
  showToast("Voucher berhasil diaktifkan!");
}

async function deleteVoucher(id) {
  vouchers = vouchers.filter(v => v.id !== id);
  renderVoucherTable();
  await saveToCloudflareD1();
  showToast("Voucher dihapus!");
}

function toggleCatInput(code) {
  const chk = document.querySelector(`.cat-chk[value="${code}"]`);
  const minBox = document.getElementById(`boxMinutes_${code}`);
  if (!chk || !minBox) return;
  if (chk.checked) minBox.classList.add('active');
  else minBox.classList.remove('active');
}

function toggleMinInput(code, m) {
  const chk = document.getElementById(`chk_${code}_${m}`);
  const input = document.getElementById(`catPrice_${code}_${m}`);
  if (chk && input) { input.disabled = !chk.checked; if (!chk.checked) input.value = ''; }
}

function handleLogoClick() {
  logoClickCount++;
  clearTimeout(logoClickTimer);
  if (logoClickCount >= 5) { logoClickCount = 0; openDevPinModal(); }
  else { logoClickTimer = setTimeout(() => { logoClickCount = 0; }, 1500); }
}

function openDevPinModal() { document.getElementById('devPinModal').style.display = 'flex'; }
function closeDevPinModal() { document.getElementById('devPinModal').style.display = 'none'; }

async function verifyDevPin() {
  const pinInput = document.getElementById("devPinInput");
  const inputVal = pinInput ? pinInput.value.trim() : "";
  if (!inputVal) { alert("Masukkan PIN Akses!"); return; }

  try {
    const res = await fetch(`${WORKER_API_URL}/api/verify-auth`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${inputVal}`
      },
      body: JSON.stringify({ role: "developer" })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      sessionStorage.setItem("cn_dev_logged_in", "true");
      sessionStorage.setItem("cn_admin_token", inputVal);
      closeDevPinModal();
      document.getElementById("devPanelView").style.display = "block";
      renderDevTable();
      if (pinInput) pinInput.value = "";
      showToast("Login Developer Panel Terverifikasi!");
    } else {
      alert(data.error || "PIN Akses Salah!");
      if (pinInput) pinInput.value = "";
    }
  } catch (err) {
    const isLocal = ["localhost", "127.0.0.1"].includes(window.location.hostname);
    const localToken = import.meta.env.VITE_LOCAL_ADMIN_TOKEN;
    if (isLocal && localToken && inputVal === localToken) {
      sessionStorage.setItem("cn_dev_logged_in", "true");
      sessionStorage.setItem("cn_admin_token", inputVal);
      closeDevPinModal();
      document.getElementById("devPanelView").style.display = "block";
      renderDevTable();
      if (pinInput) pinInput.value = "";
      showToast("Login Lokal Aktif (Deploy backend/worker.js untuk mode production)");
    } else {
      alert("Gagal terhubung ke server verifikasi. Pastikan backend/worker.js sudah di-deploy di Cloudflare.");
    }
  }
}

function logoutDevPanel() { sessionStorage.removeItem('cn_dev_logged_in'); closeDevPanel(); showToast("Sesi Admin Berakhir"); }
function closeDevPanel() { document.getElementById('devPanelView').style.display = 'none'; }

async function quickCycleStatus(id) {
  const idx = talents.findIndex(t => t.id === id);
  if (idx === -1) return;
  const order = ['ready', 'busy', 'offline'];
  const nextStatus = order[(order.indexOf(talents[idx].status || 'ready') + 1) % order.length];
  talents[idx].status = nextStatus;
  renderDevTable(); renderTalents();
  await saveToCloudflareD1();
  showToast(`Status diubah ke ${nextStatus}`);
}

function renderDevTable() {
  const tbody = document.getElementById('devTalentTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  talents.forEach(t => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><img src="${getCompressedImageUrl(t.img, 60, 50)}" style="width:32px; height:42px; object-fit:cover; border-radius:6px;"></td>
      <td><b>${t.name}</b></td>
      <td>${t.agency || "Clubs'Night"}</td>
      <td onclick="quickCycleStatus(${t.id})" style="cursor:pointer;">${getStatusBadgeHTML(t.status || 'ready')}</td>
      <td>
        <div style="display:flex; gap:5px;">
          <button class="btn-edit" onclick="openEditTalentForm(${t.id})">Edit</button>
          <button class="btn-danger" onclick="deleteTalent(${t.id})">Hapus</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function openAddTalentForm() {
  injectVibeSelectorIntoDevForm();
  document.getElementById('devFormTitle').innerText = "✨ Tambah Talent Baru";
  document.getElementById('editTalentId').value = "";
  document.getElementById('talentEditorForm')?.reset();
  document.getElementById('devFormCard').style.display = 'block';
}

function openEditTalentForm(id) {
  injectVibeSelectorIntoDevForm();
  const t = talents.find(item => item.id === id);
  if (!t) return;
  document.getElementById('devFormTitle').innerText = `✏️ Edit Talent: ${t.name}`;
  document.getElementById('editTalentId').value = t.id;
  document.getElementById('devTalentImg').value = t.img;
  document.getElementById('devTalentName').value = t.name;
  document.getElementById('devTalentCategory').value = t.category;
  document.getElementById('devTalentAgency').value = t.agency || "Clubs'Night";
  document.getElementById('devTalentStatus').value = t.status || 'ready';
  document.getElementById('devTalentVideo').value = t.video || '';
  document.getElementById('devTalentAudio').value = t.audio || '';

  const talentVibes = Array.isArray(t.vibe) ? t.vibe : ['GFE'];
  document.querySelectorAll('.dev-vibe-chk').forEach(chk => { chk.checked = talentVibes.includes(chk.value); });

  ['a','b','c','d','e','f','g','h'].forEach(code => {
    const chk = document.querySelector(`.cat-chk[value="${code}"]`);
    if (t.customServices && t.customServices[code]) {
      if (chk) chk.checked = true;
      toggleCatInput(code);
      const serviceObj = t.customServices[code];
      if (typeof serviceObj === 'object') {
        ['m3','m5','m7','m10'].forEach(m => {
          const minInput = document.getElementById(`catPrice_${code}_${m}`);
          if (minInput && serviceObj[m]) minInput.value = serviceObj[m];
        });
      } else {
        const minInput = document.getElementById(`catPrice_${code}_m5`);
        if (minInput) minInput.value = serviceObj;
      }
    }
  });
  document.getElementById('devFormCard').style.display = 'block';
}

function hideTalentForm() { document.getElementById('devFormCard').style.display = 'none'; }

async function uploadImageToCatbox() {
  const fileInput = document.getElementById('devImageFileInput');
  const imageUrlInput = document.getElementById('devTalentImg');
  const statusText = document.getElementById('uploadImageStatusText');
  
  if (!fileInput || !fileInput.files[0]) {
    alert("Pilih file foto terlebih dahulu!");
    return;
  }

  const formData = new FormData();
  formData.append("file", fileInput.files[0]);
  formData.append("type", "image");

  try {
    statusText.innerText = "⏳ Mengunggah foto ke R2...";
    const res = await fetch(`${MEDIA_WORKER_URL}/upload`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${sessionStorage.getItem("cn_admin_token") || ""}` },
      body: formData
    });
    const data = await res.json();
    if (data.success && data.url) {
      imageUrlInput.value = data.url;
      statusText.innerText = "✅ Upload foto ke R2 sukses!";
      showToast("Foto berhasil disimpan ke Cloudflare R2!");
    } else {
      throw new Error(data.message || "Gagal upload foto.");
    }
  } catch (e) {
    statusText.innerText = "❌ Gagal upload foto ke R2.";
    alert("Gagal mengunggah foto: " + e.message);
  }
}

async function uploadVideoToCloudinary() {
  const fileInput = document.getElementById('devVideoFileInput');
  const videoUrlInput = document.getElementById('devTalentVideo');
  const statusText = document.getElementById('uploadStatusText');

  if (!fileInput || !fileInput.files[0]) {
    alert("Pilih file video terlebih dahulu!");
    return;
  }

  const formData = new FormData();
  formData.append("file", fileInput.files[0]);
  formData.append("type", "video");

  try {
    statusText.innerText = "⏳ Mengunggah video ke R2...";
    const res = await fetch(`${MEDIA_WORKER_URL}/upload`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${sessionStorage.getItem("cn_admin_token") || ""}` },
      body: formData
    });
    const data = await res.json();
    if (data.success && data.url) {
      videoUrlInput.value = data.url;
      statusText.innerText = "✅ Upload video ke R2 sukses!";
      showToast("Video Reels berhasil disimpan ke R2!");
    } else {
      throw new Error(data.message || "Gagal upload video.");
    }
  } catch (e) {
    statusText.innerText = "❌ Gagal upload video ke R2.";
    alert("Gagal mengunggah video: " + e.message);
  }
}

async function saveTalentData(e) {
  e.preventDefault();
  const idVal = document.getElementById('editTalentId')?.value;
  const customServices = {};
  ['a','b','c','d','e','f','g','h'].forEach(code => {
    const chk = document.querySelector(`.cat-chk[value="${code}"]`);
    if (chk && chk.checked) {
      const m3 = parseInt(document.getElementById(`catPrice_${code}_m3`)?.value) || 0;
      const m5 = parseInt(document.getElementById(`catPrice_${code}_m5`)?.value) || 0;
      const m7 = parseInt(document.getElementById(`catPrice_${code}_m7`)?.value) || 0;
      const m10 = parseInt(document.getElementById(`catPrice_${code}_m10`)?.value) || 0;
      if (m3 > 0 || m5 > 0 || m7 > 0 || m10 > 0) customServices[code] = { m3, m5, m7, m10 };
    }
  });

  const selectedVibes = Array.from(document.querySelectorAll('.dev-vibe-chk:checked')).map(el => el.value);
  const talentData = {
    id: idVal ? parseInt(idVal) : Date.now(),
    img: document.getElementById('devTalentImg')?.value.trim() || '',
    name: document.getElementById('devTalentName')?.value.trim() || '',
    category: document.getElementById('devTalentCategory')?.value || 'VCService',
    agency: document.getElementById('devTalentAgency')?.value || "Clubs'Night",
    status: document.getElementById('devTalentStatus')?.value || 'ready',
    vibe: selectedVibes.length > 0 ? selectedVibes : ["GFE"],
    video: document.getElementById('devTalentVideo')?.value.trim() || '',
    audio: document.getElementById('devTalentAudio')?.value.trim() || '',
    rating: 4.9, sessions: 40, likes: 0, comments: [], customServices
  };

  if (idVal) {
    const idx = talents.findIndex(t => t.id === parseInt(idVal));
    if (idx !== -1) {
      talentData.likes = talents[idx].likes || 0; 
      talentData.comments = talents[idx].comments || [];
      talents[idx] = talentData;
    }
  } else { talents.unshift(talentData); }

  renderDevTable(); renderTalents(); hideTalentForm();
  await saveToCloudflareD1();
  showToast("Talent berhasil disimpan!");
}

async function deleteTalent(id) {
  if (confirm("Hapus talent ini?")) {
    talents = talents.filter(t => t.id !== id);
    renderDevTable(); renderTalents();
    await saveToCloudflareD1();
    showToast("Talent dihapus!");
  }
}

function confirmAge() {
  try {
    localStorage.setItem("cn_age_verified", "true");
    localStorage.setItem("cn_age_verified_v1", "true");
    sessionStorage.setItem("cn_age_verified", "true");
  } catch (_) {}
  const ageModal = document.getElementById("ageGateModal");
  if (ageModal) {
    ageModal.style.setProperty("display", "none", "important");
    ageModal.classList.remove("open", "active", "show");
  }
  document.body.style.overflow = "";
  
}

// ==================== FILTER TALENTS ====================
function filterTalents() {
  const query = document.getElementById('searchInput')?.value.toLowerCase().trim() || '';
  const filtered = talents.filter(t => {
    let match = true;
    if (currentCategory === 'All') {
      match = true;
    } else if (currentCategory === 'Status:ready') {
      match = (t.status || 'ready') === 'ready';
    } else if (currentCategory === 'Favorit') {
      match = favorites.includes(t.id);
    } else if (currentCategory.startsWith('Agency:')) {
      match = (t.agency || "Clubs'Night").toLowerCase() === currentCategory.replace('Agency:', '').toLowerCase();
    } else {
      const talentCat = (t.category || '').toLowerCase().replace(/[\s_-]/g, '');
      const filterCat = currentCategory.toLowerCase().replace(/[\s_-]/g, '');
      match = talentCat.includes(filterCat) || filterCat.includes(talentCat);
    }

    let vibeMatch = currentVibeFilter === 'All' ? true : (Array.isArray(t.vibe) && t.vibe.includes(currentVibeFilter));
    return match && vibeMatch && (t.name || '').toLowerCase().includes(query);
  });

  const reelsSec = document.getElementById('reelsFeedSection');
  const gridSec = document.getElementById('gridFeedSection');

  if (currentCategory === 'All') {
    if (reelsSec) reelsSec.style.display = 'block';
    if (gridSec) gridSec.style.display = 'none';
    renderReelsFeed(filtered);
  } else {
    if (reelsSec) reelsSec.style.display = 'none';
    if (gridSec) gridSec.style.display = 'block';
    renderGrid(filtered);
  }
}

function renderTalents() { filterTalents(); }

// ==================== REELS FEED ====================
function renderReelsFeed(list) {
  const container = document.getElementById('reelsFeedContainer');
  if (!container) return;
  container.innerHTML = '';
  if (list.length === 0) {
    container.innerHTML = `<div style="text-align:center; padding:40px; color:var(--text-muted);">Tidak ada talent ditemukan.</div>`;
    return;
  }

  list.slice(0, visibleCount).forEach(talent => {
    const minP = getMinPrice(talent);
    const isFav = favorites.includes(talent.id);
    const card = document.createElement('div');
    card.className = 'reel-card';
    card.innerHTML = `
      ${talent.video ? `
        <video class="reel-video" data-src="${talent.video}" poster="${getCompressedImageUrl(talent.img, 600, 78)}" loop playsinline preload="metadata"></video>
      ` : `<img src="${getCompressedImageUrl(talent.img, 600, 78)}" class="reel-video" style="object-fit:cover;">`}
      <div class="reel-overlay">
        <div class="reel-top-bar">
          <span class="reel-agency-badge">${talent.agency || "Clubs'Night"}</span>
          ${getStatusBadgeHTML(talent.status || 'ready')}
        </div>
        <div class="reel-bottom-info">
          <div class="reel-talent-name">${talent.name}</div>
          <div class="reel-price-tag">Mulai dari ${formatPrice(minP)} /sesi</div>
          <button class="btn-neon" onclick="openDetailById(${talent.id})" style="margin-top:8px; padding:11px;">Lihat Detail & Booking</button>
        </div>
      </div>
      <div class="reel-actions-side">
        <button class="reel-action-btn" onclick="toggleFavorite(event, ${talent.id})" title="Suka">
          <span>${isFav ? '❤️' : '🤍'}</span>
          <span class="reel-action-count">${talent.likes || 0}</span>
        </button>
        <button class="reel-action-btn" onclick="openCommentsModal(${talent.id})" title="Komentar">
          <span>💬</span>
          <span class="reel-action-count">${talent.comments?.length || 0}</span>
        </button>
        ${talent.video ? `
          <button class="reel-sound-btn" onclick="toggleReelSound(event, this)" title="${isGlobalMuted ? 'Aktifkan Suara' : 'Matikan Suara'}">
            <i class="${isGlobalMuted ? 'fa-solid fa-volume-xmark' : 'fa-solid fa-volume-high'}"></i>
          </button>
        ` : ''}
      </div>
    `;

    const videoEl = card.querySelector('video');
    if (videoEl) {
      let tapTimer = null;
      let tapCount = 0;

      videoEl.addEventListener('click', (event) => {
        tapCount++;
        if (tapCount === 1) {
          tapTimer = setTimeout(() => {
            toggleReelSound(event);
            tapCount = 0;
          }, 260);
        } else if (tapCount === 2) {
          clearTimeout(tapTimer);
          tapCount = 0;
          if (!favorites.includes(talent.id)) {
            toggleFavorite(event, talent.id);
            showToast(`❤️ ${talent.name} ditambahkan ke Favorit!`);
          } else {
            showToast(`❤️ ${talent.name} sudah ada di Favorit!`);
          }
        }
      });
    }

    container.appendChild(card);
  });
  requestAnimationFrame(() => initReelAutoplayObserver());
}

function toggleReelSound(event, btnEl, videoTarget = null) {
  if (event) event.stopPropagation();

  isGlobalMuted = !isGlobalMuted;

  document.querySelectorAll('video').forEach(video => {
    video.muted = isGlobalMuted;
    if (!isGlobalMuted && video.paused) {
      video.play().catch(() => {});
    }
  });

  document.querySelectorAll('.reel-sound-btn').forEach(btn => {
    const icon = btn.querySelector('i');
    if (icon) {
      icon.className = isGlobalMuted ? 'fa-solid fa-volume-xmark' : 'fa-solid fa-volume-high';
    }
    btn.title = isGlobalMuted ? "Aktifkan Suara" : "Matikan Suara";
  });

  showToast(isGlobalMuted ? "🔇 Suara dimatikan" : "🔊 Suara diaktifkan");
}

function initReelAutoplayObserver() {
  if (reelObserver) reelObserver.disconnect();
  reelObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      const video = entry.target.querySelector('video');
      const soundBtn = entry.target.querySelector('.reel-sound-btn');
      if (!video) return;

      if (entry.isIntersecting) {
        if (!video.src && video.dataset.src) video.src = video.dataset.src;
        video.muted = isGlobalMuted;

        video.play().then(() => {
          if (soundBtn) {
            const icon = soundBtn.querySelector('i');
            if (icon) {
              icon.className = isGlobalMuted ? 'fa-solid fa-volume-xmark' : 'fa-solid fa-volume-high';
            }
            soundBtn.title = isGlobalMuted ? "Aktifkan Suara" : "Matikan Suara";
          }
        }).catch(() => {
          video.muted = true;
          video.play().catch(() => {});
          if (soundBtn) {
            const icon = soundBtn.querySelector('i');
            if (icon) icon.className = 'fa-solid fa-volume-xmark';
            soundBtn.title = "Aktifkan Suara";
          }
        });
      } else {
        video.pause();
      }
    });
  }, { threshold: 0.6 });

  document.querySelectorAll('.reel-card').forEach(card => reelObserver.observe(card));
}

function openCommentsModal(talentId) {
  activeCommentTalentId = talentId;
  const t = talents.find(item => item.id === talentId);
  const listEl = document.getElementById('commentsList');
  if (!t || !listEl) return;
  listEl.innerHTML = t.comments?.length ? t.comments.map(c => `<div class="comment-item"><div class="comment-author">${escapeHTML(c.author)}</div><div class="comment-text">${escapeHTML(c.text)}</div></div>`).join('') : '<p style="text-align:center; color:var(--text-muted); padding:10px;">Belum ada ulasan.</p>';
  document.getElementById('commentsModal').style.display = 'flex';
}

function closeCommentsModal() { document.getElementById('commentsModal').style.display = 'none'; }

async function submitComment() {
  const author = document.getElementById('commentAuthorInput')?.value.trim() || "Pengunjung";
  const text = document.getElementById('commentTextInput')?.value.trim();
  if (!text) return;
  const idx = talents.findIndex(t => t.id === activeCommentTalentId);
  if (idx !== -1) {
    if (!talents[idx].comments) talents[idx].comments = [];
    talents[idx].comments.push({ author, text });
    openCommentsModal(activeCommentTalentId);
    document.getElementById('commentTextInput').value = '';
    await saveToCloudflareD1();
    showToast("Ulasan dikirim!");
  }
}

// ==================== SHOWCASE CARD TALENT GRID ====================
function renderGrid(list) {
  const vcsGrid = document.getElementById('vcsGrid');
  const bopGrid = document.getElementById('bopGrid');
  const vcsSection = document.getElementById('vcsSection');
  const bopSection = document.getElementById('bopSection');
  if (!vcsGrid || !bopGrid) return;

  vcsGrid.innerHTML = ''; 
  bopGrid.innerHTML = '';

  const vcsList = list.filter(t => (t.category || '').toLowerCase().includes('vc'));
  const bopList = list.filter(t => (t.category || '').toLowerCase().includes('bop'));

  if (currentCategory.startsWith('Agency:') || currentCategory === 'Favorit' || currentCategory === 'Status:ready') {
    if (vcsSection) vcsSection.style.display = 'block';
    if (bopSection) bopSection.style.display = bopList.length > 0 ? 'block' : 'none';
    
    if (list.length === 0) {
      vcsGrid.innerHTML = `<div style="grid-column: 1/-1; text-align:center; padding:30px; color:var(--text-muted);">Tidak ada talent ready yang standby saat ini.</div>`;
    } else {
      list.forEach(t => {
        if ((t.category || '').toLowerCase().includes('bop')) bopGrid.appendChild(createCard(t));
        else vcsGrid.appendChild(createCard(t));
      });
    }
    return;
  }

  if (currentCategory.toLowerCase().includes('vc')) {
    if (vcsSection) vcsSection.style.display = 'block';
    if (bopSection) bopSection.style.display = 'none';

    if (vcsList.length === 0) {
      vcsGrid.innerHTML = `<div style="grid-column: 1/-1; text-align:center; padding:30px; color:var(--text-muted);">Tidak ada talent VCService yang cocok dengan karakter/pencarian ini.</div>`;
    } else {
      vcsList.forEach(t => vcsGrid.appendChild(createCard(t)));
    }
    return;
  }

  if (currentCategory.toLowerCase().includes('bop')) {
    if (vcsSection) vcsSection.style.display = 'none';
    if (bopSection) bopSection.style.display = 'block';

    if (bopList.length === 0) {
      bopGrid.innerHTML = `<div style="grid-column: 1/-1; text-align:center; padding:30px; color:var(--text-muted);">Tidak ada talent BOP Service yang cocok dengan karakter/pencarian ini.</div>`;
    } else {
      bopList.forEach(t => bopGrid.appendChild(createCard(t)));
    }
    return;
  }

  if (vcsSection) vcsSection.style.display = 'block';
  if (bopSection) bopSection.style.display = bopList.length > 0 ? 'block' : 'none';
  vcsList.forEach(t => vcsGrid.appendChild(createCard(t)));
  bopList.forEach(t => bopGrid.appendChild(createCard(t)));
}

function toggleFavorite(event, id) {
  if (event) event.stopPropagation();
  const idx = favorites.indexOf(id);
  if (idx !== -1) favorites.splice(idx, 1);
  else favorites.push(id);
  saveToLocalStorage();
  renderTalents();
}

function createCard(talent) {
  const card = document.createElement('div');
  card.className = 'talent-card';
  card.onclick = () => openDetail(talent);
  const isFav = favorites.includes(talent.id);
  card.innerHTML = `
    <div class="talent-thumb-wrapper">
      <img src="${getCompressedImageUrl(talent.img, 360, 72)}" class="talent-thumb" loading="lazy">
      <div style="position:absolute; top:7px; left:7px;">${getStatusBadgeHTML(talent.status || 'ready')}</div>
      <div class="start-price-badge">Mulai ${formatPrice(getMinPrice(talent))}</div>
      <button class="fav-btn ${isFav ? 'active' : ''}">${isFav ? '❤️' : '🤍'}</button>
    </div>
    <div class="talent-info">
      <div class="talent-agency-tag">${talent.agency || "Clubs'Night"}</div>
      <div class="talent-name">${talent.name}</div>
      <div class="talent-stats">⭐ ${talent.rating || 4.9}</div>
      <button class="btn-card-order" onclick="event.stopPropagation(); openDetailById(${talent.id});">
        <i class="fa-solid fa-calendar-check"></i> Order Talent
      </button>
    </div>
  `;
  return card;
}

function openDetailById(id) { const t = talents.find(item => item.id === id); if (t) openDetail(t); }

function openDetail(talent) {
  activeTalent = talent;
  document.getElementById('galleryView').style.display = 'none';
  document.getElementById('testimoniView').style.display = 'none';
  document.getElementById('blogView').style.display = 'none';
  document.getElementById('detailView').style.display = 'block';

  const calcInline = document.getElementById('calculatorCardInline');
  if (calcInline) calcInline.style.display = 'none';

  document.getElementById('detailImg').src = getCompressedImageUrl(talent.img, 500, 78);
  document.getElementById('detailName').innerText = talent.name;
  document.getElementById('detailAgency').innerText = `AGENSI: ${talent.agency || "Clubs'Night"}`;
  document.getElementById('detailCategory').innerText = `LAYANAN: ${talent.category}`;
  
  renderVisitorCategoryDropdown();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderVisitorCategoryDropdown() {
  if (!activeTalent) return;
  const selectOpt = document.getElementById('detailBagianOption');
  if (!selectOpt) return;
  selectOpt.innerHTML = '';
  
  if (activeTalent.customServices) {
    const validCodes = Object.keys(activeTalent.customServices).filter(code => {
      const s = activeTalent.customServices[code];
      if (typeof s === 'object' && s !== null) {
        return Object.values(s).some(v => Number(v) > 0);
      }
      return Number(s) > 0;
    });

    validCodes.forEach(code => {
      const option = document.createElement('option');
      option.value = code;
      option.innerText = CATEGORY_NAMES[code] || code;
      selectOpt.appendChild(option);
    });
  }

  if (selectOpt.options.length === 0) {
    const opt = document.createElement('option');
    opt.value = "";
    opt.innerText = "Tidak ada paket tersedia";
    selectOpt.appendChild(opt);
  }

  renderVisitorDurationDropdown();
}

function renderVisitorDurationDropdown() {
  if (!activeTalent) return;
  const catCode = document.getElementById('detailBagianOption')?.value;
  const minuteSelect = document.getElementById('detailMinuteOption');
  const durationWrapper = document.getElementById('detailDurationWrapper');
  if (!minuteSelect) return;
  
  minuteSelect.innerHTML = '';
  const serviceObj = activeTalent.customServices ? activeTalent.customServices[catCode] : null;

  if (serviceObj && typeof serviceObj === 'object') {
    const availableMinutes = ['m3', 'm5', 'm7', 'm10'].filter(m => Number(serviceObj[m]) > 0);
    
    if (availableMinutes.length > 0) {
      if (durationWrapper) durationWrapper.style.display = 'flex';
      availableMinutes.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m;
        opt.innerText = DURATION_LABELS[m] || `${m.replace('m', '')} Menit`;
        if (m === 'm5') opt.selected = true;
        minuteSelect.appendChild(opt);
      });
      if (!minuteSelect.value && minuteSelect.options.length > 0) {
        minuteSelect.selectedIndex = 0;
      }
    } else {
      if (durationWrapper) durationWrapper.style.display = 'none';
    }
  } else if (serviceObj && Number(serviceObj) > 0) {
    if (durationWrapper) durationWrapper.style.display = 'none';
    const opt = document.createElement('option');
    opt.value = 'default';
    opt.innerText = 'Sesi Panggilan Standar (5-10 Menit)';
    minuteSelect.appendChild(opt);
  } else {
    if (durationWrapper) durationWrapper.style.display = 'none';
  }

  onVisitorSelectCategory();
}

function onVisitorSelectCategory() {
  if (!activeTalent) return;
  const catCode = document.getElementById('detailBagianOption')?.value;
  const minuteSelect = document.getElementById('detailMinuteOption');
  const serviceObj = activeTalent.customServices ? activeTalent.customServices[catCode] : null;

  let price = 0;
  if (serviceObj) {
    if (typeof serviceObj === 'object' && serviceObj !== null) {
      const selectedMinute = minuteSelect ? minuteSelect.value : null;
      if (selectedMinute && Number(serviceObj[selectedMinute]) > 0) {
        price = parseInt(serviceObj[selectedMinute]);
      } else {
        const validMinute = Object.keys(serviceObj).find(k => Number(serviceObj[k]) > 0);
        if (validMinute) {
          price = parseInt(serviceObj[validMinute]);
          if (minuteSelect) minuteSelect.value = validMinute;
        }
      }
    } else {
      price = parseInt(serviceObj) || 0;
    }
  }

  selectedCustomPrice = price;
  const priceInput = document.getElementById('detailPriceDisplay');
  if (priceInput) {
    priceInput.value = price > 0 ? `${formatPrice(price)}` : "Tidak Tersedia";
  }
}

function processToCalculator() {
  if (!activeTalent || selectedCustomPrice <= 0) {
    alert("Kategori atau durasi service ini belum memiliki tarif yang tersedia!"); 
    return; 
  }
  
  const catCode = document.getElementById('detailBagianOption')?.value;
  const minuteSelect = document.getElementById('detailMinuteOption');
  let durationText = "Sesi Standar";
  if (minuteSelect && minuteSelect.selectedOptions && minuteSelect.selectedOptions[0]) {
    durationText = minuteSelect.selectedOptions[0].innerText;
  }

  document.getElementById('calcTalent').value = `${activeTalent.name} - ${activeTalent.agency || "Clubs'Night"}`;
  document.getElementById('calcCategory').value = activeTalent.category;
  document.getElementById('calcBagian').value = `${CATEGORY_NAMES[catCode] || catCode} (${durationText})`;
  document.getElementById('calcCustomRequest').value = document.getElementById('clientCustomRequest')?.value.trim() || "-";
  document.getElementById('calcHarga').value = selectedCustomPrice;

  const clientNameVal = document.getElementById('clientName')?.value.trim();
  document.getElementById('calcClient').value = clientNameVal || "Anonymous";
  
  const clientNoteVal = document.getElementById('clientNote')?.value.trim();
  document.getElementById('calcNote').value = clientNoteVal || "-";

  activeAppliedVoucher = null;
  const voucherInput = document.getElementById('calcVoucherInput');
  if (voucherInput) voucherInput.value = '';
  const voucherStatus = document.getElementById('voucherStatusText');
  if (voucherStatus) voucherStatus.innerText = '';

  updateTotalDisplay();

  const calcInline = document.getElementById('calculatorCardInline');
  if (calcInline) {
    calcInline.style.display = 'block';
    calcInline.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function applyVoucherCode() {
  const code = document.getElementById('calcVoucherInput')?.value.trim().toUpperCase();
  const match = vouchers.find(v => v.code === code && v.active);
  const statusText = document.getElementById('voucherStatusText');
  if (match) {
    activeAppliedVoucher = match;
    statusText.innerText = `✅ Voucher ${match.code} Aktif!`;
    statusText.style.color = "var(--neon-green)";
  } else {
    activeAppliedVoucher = null;
    statusText.innerText = "❌ Voucher Tidak Valid!";
    statusText.style.color = "var(--crimson-red)";
  }
  updateTotalDisplay();
}

function updateTotalDisplay() {
  const hargaBase = parseInt(document.getElementById('calcHarga')?.value || 0) || 0;
  let discountedBase = hargaBase;
  if (activeAppliedVoucher) {
    let disc = activeAppliedVoucher.fixedAmount ? activeAppliedVoucher.fixedAmount : Math.round((hargaBase * activeAppliedVoucher.discount) / 100);
    discountedBase = Math.max(0, hargaBase - disc);
  }
  const feeAdmin = getAdminFee(discountedBase);
  const grandTotal = discountedBase + feeAdmin;

  const totalEl = document.getElementById('displayTotal');
  if (totalEl) {
    totalEl.innerText = hargaBase > 0 ? `${formatPrice(grandTotal)} (Inc. Adm ${formatPrice(feeAdmin)})` : "Rp 0";
  }
}

async function copyAndRedirectToBot(e) {
  e.preventDefault();
  const hargaBase = parseInt(document.getElementById('calcHarga')?.value || 0) || 0;
  if (hargaBase <= 0) { alert("Pilih layanan terlebih dahulu!"); return; }

  // === HARD PAYMENT GATE (CN WALLET WAJIB SEBELUM TELEGRAM) ===
  const WORKER_API = "https://clubsnight-fullstack.devvaaicoder.workers.dev";
  const formatRp = (n) => "Rp " + Number(n || 0).toLocaleString("id-ID");

  // Pastikan CSS & Luxury Modal Card + Paywall Page selalu tersedia di DOM
  const ensureLuxuryPaywallAndModal = () => {
    if (!document.getElementById("cnLuxuryGateStyles")) {
      const st = document.createElement("style");
      st.id = "cnLuxuryGateStyles";
      st.textContent = `
        .cn-lux-modal-backdrop {
          position: fixed; inset: 0; z-index: 99999;
          background: rgba(5, 3, 10, 0.84);
          display: flex; align-items: center; justify-content: center;
          padding: 18px;
          animation: cnFadeIn 0.18s ease-out;
        }
        @keyframes cnFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes cnSlideUp { from { opacity: 0; transform: translateY(16px) scale(0.97); } to { opacity: 1; transform: translateY(0) scale(1); } }
        .cn-lux-card {
          width: 100%; max-width: 390px;
          border-radius: 22px;
          background: linear-gradient(155deg, #171024 0%, #120b1a 55%, #220d1b 100%);
          border: 1px solid rgba(255, 64, 129, 0.38);
          box-shadow: 0 24px 60px rgba(0, 0, 0, 0.72), 0 0 0 1px rgba(255,255,255,0.05) inset;
          padding: 22px 20px 20px;
          color: #fff;
          animation: cnSlideUp 0.22s cubic-bezier(0.16, 1, 0.3, 1);
          position: relative;
          overflow: hidden;
        }
        .cn-lux-card::before {
          content: ""; position: absolute; top: -60px; right: -60px;
          width: 150px; height: 150px; border-radius: 50%;
          background: radial-gradient(circle, rgba(255, 23, 68, 0.26), transparent 70%);
          pointer-events: none;
        }
        .cn-lux-icon-wrap {
          width: 52px; height: 52px; border-radius: 16px;
          background: linear-gradient(135deg, rgba(255,23,68,0.22), rgba(139,92,246,0.24));
          border: 1px solid rgba(255,64,129,0.45);
          display: flex; align-items: center; justify-content: center;
          font-size: 21px; color: #ff4081;
          margin-bottom: 14px;
        }
        .cn-lux-pill {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 4px 10px; border-radius: 999px;
          background: rgba(255, 23, 68, 0.14);
          border: 1px solid rgba(255, 64, 129, 0.35);
          color: #ff80ab; font-size: 10px; font-weight: 800;
          letter-spacing: 0.6px; text-transform: uppercase;
          margin-bottom: 8px;
        }
        .cn-lux-title {
          font-size: 18px; font-weight: 900; line-height: 1.25;
          margin: 0 0 8px; color: #fff;
        }
        .cn-lux-desc {
          font-size: 12px; line-height: 1.5;
          color: rgba(255, 255, 255, 0.72);
          margin: 0 0 14px;
        }
        .cn-lux-breakdown {
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.09);
          border-radius: 14px;
          padding: 12px 14px;
          margin-bottom: 16px;
          display: flex; flex-direction: column; gap: 8px;
        }
        .cn-lux-row {
          display: flex; align-items: center; justify-content: space-between;
          font-size: 12px; color: rgba(255, 255, 255, 0.72);
        }
        .cn-lux-row strong { font-weight: 800; color: #fff; }
        .cn-lux-divider { height: 1px; background: rgba(255,255,255,0.08); margin: 2px 0; }
        .cn-lux-actions {
          display: flex; flex-direction: column; gap: 9px;
        }
        .cn-lux-btn-primary {
          width: 100%; padding: 13px 16px; border-radius: 13px; border: none;
          background: linear-gradient(135deg, #ff1744 0%, #c2185b 50%, #7c3aed 100%);
          color: #fff; font-size: 13.5px; font-weight: 800;
          display: inline-flex; align-items: center; justify-content: center; gap: 8px;
          cursor: pointer;
          box-shadow: 0 10px 24px rgba(255, 23, 68, 0.35);
        }
        .cn-lux-btn-primary:active { transform: scale(0.98); }
        .cn-lux-btn-ghost {
          width: 100%; padding: 11px 14px; border-radius: 12px;
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(255, 255, 255, 0.12);
          color: rgba(255, 255, 255, 0.78);
          font-size: 12.5px; font-weight: 700; cursor: pointer;
        }
      `;
      document.head.appendChild(st);
    }

    // Pastikan Paywall Page selalu ada bahkan jika HTML tertinggal
    if (!document.getElementById("cnPagePaywall")) {
      const sec = document.createElement("section");
      sec.id = "cnPagePaywall";
      sec.className = "cn-pwa-page";
      sec.style.cssText = "display:none;max-width:540px;margin:0 auto;padding:16px 14px 110px;color:#fff;";
      sec.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:14px;">
          <button type="button" id="cnPwBackBtn" style="display:inline-flex;align-items:center;gap:7px;padding:8px 13px;border-radius:999px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.14);color:#fff;font-size:12px;font-weight:700;cursor:pointer;">
            <i class="fa-solid fa-arrow-left"></i> Kembali ke Booking
          </button>
          <span style="padding:5px 11px;border-radius:999px;background:rgba(255,23,68,0.16);border:1px solid rgba(255,23,68,0.45);color:#ff80ab;font-size:10.5px;font-weight:800;">CN WALLET PAYWALL</span>
        </div>
        <div style="padding:16px;border-radius:18px;background:linear-gradient(145deg,rgba(24,14,38,0.96),rgba(38,12,28,0.94));border:1px solid rgba(255,64,129,0.35);margin-bottom:14px;">
          <div style="font-size:11px;font-weight:800;color:#ff80ab;margin-bottom:4px;">TOP-UP SALDO INSTAN</div>
          <h2 style="font-size:19px;font-weight:900;margin:0 0 8px;">Isi Saldo CN Wallet</h2>
          <p id="cnPwFallbackNote" style="font-size:11.5px;color:rgba(255,255,255,0.78);line-height:1.5;margin:0 0 12px;"></p>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            <div style="padding:10px 12px;border-radius:12px;background:rgba(255,255,255,0.05);">
              <small style="display:block;font-size:10.5px;color:rgba(255,255,255,0.6);">Saldo Saat Ini</small>
              <strong id="cnPwCurrentBal" style="font-size:15px;color:#fb7185;">Rp 0</strong>
            </div>
            <div style="padding:10px 12px;border-radius:12px;background:rgba(255,255,255,0.05);">
              <small style="display:block;font-size:10.5px;color:rgba(255,255,255,0.6);">Target Tagihan</small>
              <strong id="cnPwRequiredBal" style="font-size:15px;color:#34d399;">Rp 0</strong>
            </div>
          </div>
        </div>
        <div id="cnPwMarqueeFallback"></div>
        <div style="padding:15px;border-radius:18px;background:rgba(18,14,28,0.94);border:1px solid rgba(255,255,255,0.1);">
          <label style="font-size:11.5px;font-weight:700;color:rgba(255,255,255,0.8);display:block;margin-bottom:6px;">Nominal Top-Up (Rp)</label>
          <input type="number" id="cnPwAmountInput" class="form-control" min="10000" step="1000" value="100000" style="margin-bottom:10px;" />
          <button type="button" id="cnPwGenBtnFallback" class="btn-neon" style="width:100%;padding:13px;">
            <i class="fa-solid fa-qrcode"></i> Buat Tagihan QRIS &amp; Transfer Bank
          </button>
          <div id="cnPwQrResultFallback" style="margin-top:12px;text-align:center;"></div>
        </div>
      `;
      document.body.appendChild(sec);
      document.getElementById("cnPwBackBtn").onclick = () => {
        sec.style.display = "none";
        const m = document.querySelector("main");
        if (m) m.style.display = "block";
      };
    }
  };

  // Tampilkan Luxury Modal Card interaktif (menggantikan alert/confirm bawaan browser)
  const showLuxuryWalletModal = ({ pill, title, desc, rows = [], primaryText, primaryIcon = "fa-plus", secondaryText = "Tutup" }) => {
    ensureLuxuryPaywallAndModal();
    return new Promise((resolve) => {
      const old = document.getElementById("cnActiveLuxModal");
      if (old) old.remove();

      const backdrop = document.createElement("div");
      backdrop.id = "cnActiveLuxModal";
      backdrop.className = "cn-lux-modal-backdrop";

      const rowsHtml = rows.length
        ? `<div class="cn-lux-breakdown">${rows.map((r) =>
            r.divider
              ? '<div class="cn-lux-divider"></div>'
              : `<div class="cn-lux-row"><span>${r.label}</span><strong style="color:${r.color || '#fff'};">${r.value}</strong></div>`
          ).join("")}</div>`
        : "";

      backdrop.innerHTML = `
        <div class="cn-lux-card" role="dialog" aria-modal="true">
          <div class="cn-lux-icon-wrap"><i class="fa-solid fa-wallet"></i></div>
          <div class="cn-lux-pill"><i class="fa-solid fa-shield-halved"></i> ${pill}</div>
          <h3 class="cn-lux-title">${title}</h3>
          <p class="cn-lux-desc">${desc}</p>
          ${rowsHtml}
          <div class="cn-lux-actions">
            <button type="button" id="cnLuxPrimaryBtn" class="cn-lux-btn-primary">
              <i class="fa-solid ${primaryIcon}"></i> ${primaryText}
            </button>
            <button type="button" id="cnLuxSecondaryBtn" class="cn-lux-btn-ghost">${secondaryText}</button>
          </div>
        </div>
      `;

      document.body.appendChild(backdrop);

      const close = (result) => {
        backdrop.remove();
        resolve(result);
      };

      backdrop.addEventListener("click", (ev) => {
        if (ev.target === backdrop) close(false);
      });
      document.getElementById("cnLuxPrimaryBtn").onclick = () => close(true);
      document.getElementById("cnLuxSecondaryBtn").onclick = () => close(false);
    });
  };

  // Fungsi langsung membuka Paywall Page beserta Marquee 3 baris Bank & E-Wallet
  const openDirectPaywallPage = async (opts = {}) => {
    ensureLuxuryPaywallAndModal();
    if (typeof window.openCnPaywallPage === "function") {
      return window.openCnPaywallPage(opts);
    }
    // Fallback langsung jika halaman paywall dirender dinamis
    const sec = document.getElementById("cnPagePaywall");
    const bal = Number(opts.currentBalance || 0);
    const req = Number(opts.requiredAmount || 100000);
    const shortage = Math.max(10000, req - bal);

    const curEl = document.getElementById("cnPwCurrentBal");
    const reqEl = document.getElementById("cnPwRequiredBal");
    const noteEl = document.getElementById("cnPwFallbackNote");
    const inpEl = document.getElementById("cnPwAmountInput");
    if (curEl) curEl.textContent = formatRp(bal);
    if (reqEl) reqEl.textContent = formatRp(req);
    if (inpEl) inpEl.value = shortage;
    if (noteEl) {
      noteEl.innerHTML = `Saldo Anda kurang <b>${formatRp(shortage)}</b> untuk menyelesaikan order <b>${opts.serviceLabel || "Sesi Privat"}</b>. Pilih nominal di bawah untuk Top-Up instan via Bank / QRIS.`;
    }

    document.querySelectorAll("main, .cn-pwa-page, #cnPubProfilePage").forEach((el) => {
      if (el.id !== "cnPagePaywall") el.style.display = "none";
    });
    sec.style.display = "block";
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const getActiveUser = () => {
    const keys = ["cn_talent_session_v1", "cn_talent_session", "cn_active_talent", "cn_pwa_session_v1", "cn_auth_session_v1"];
    for (const k of keys) {
      try {
        const raw = localStorage.getItem(k);
        if (!raw) continue;
        const obj = JSON.parse(raw);
        if (obj && obj.username) {
          return {
            username: String(obj.username).replace(/^@/, "").toLowerCase(),
            name: obj.name || obj.displayName || obj.username,
            token: obj.sessionToken || obj.token || ""
          };
        }
      } catch (_) {}
    }
    return null;
  };

  const activeUser = getActiveUser();
  if (!activeUser) {
    const goLogin = await showLuxuryWalletModal({
      pill: "AKSES MEMBER DIPERLUKAN",
      title: "Masuk ke Akun CN Wallet",
      desc: "Pemesanan sesi kini menggunakan sistem Saldo CN Wallet agar transaksi terverifikasi otomatis sebelum masuk ke Telegram.",
      primaryText: "Masuk / Daftar Sekarang",
      primaryIcon: "fa-right-to-bracket",
      secondaryText: "Kembali"
    });
    if (goLogin) window.location.href = "/login.html";
    return;
  }

  let discountedBase = hargaBase;
  if (typeof activeAppliedVoucher !== "undefined" && activeAppliedVoucher) {
    const disc = activeAppliedVoucher.fixedAmount
      ? activeAppliedVoucher.fixedAmount
      : Math.round((hargaBase * activeAppliedVoucher.discount) / 100);
    discountedBase = Math.max(0, hargaBase - disc);
  }
  const totalTagihan = discountedBase + getAdminFee(discountedBase);

  const submitBtn = document.querySelector("#calculatorCardInline .btn-submit-telegram");
  const origBtnHtml = submitBtn ? submitBtn.innerHTML : "";
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Memeriksa Saldo CN Wallet...';
  }

  try {
    let currentBal = 0;
    try {
      const bRes = await fetch(`${WORKER_API}/api/wallet/balance?username=${encodeURIComponent(activeUser.username)}`);
      const bData = await bRes.json();
      if (bRes.ok && bData && bData.success && typeof bData.balance === "number") {
        currentBal = bData.balance;
      }
    } catch (_) {}

    if (currentBal < totalTagihan) {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = origBtnHtml;
      }
      const shortage = totalTagihan - currentBal;
      const tName = document.getElementById('calcTalent')?.value.trim() || 'Talent';
      const bName = document.getElementById('calcBagian')?.value.trim() || 'Service';

      const goTopup = await showLuxuryWalletModal({
        pill: "SALDO CN WALLET KURANG",
        title: "Top-Up Terlebih Dahulu",
        desc: "Pemesanan kini menggunakan Saldo CN Wallet sebelum diteruskan ke Telegram agar jadwal langsung terkunci otomatis.",
        rows: [
          { label: "Saldo Anda Saat Ini", value: formatRp(currentBal), color: "#fb7185" },
          { label: "Total Tagihan Sesi", value: formatRp(totalTagihan), color: "#ffffff" },
          { divider: true },
          { label: "Kekurangan Saldo", value: formatRp(shortage), color: "#fbbf24" }
        ],
        primaryText: "+ Top Up Terlebih Dahulu",
        primaryIcon: "fa-circle-plus",
        secondaryText: "Nanti Saja"
      });

      if (goTopup) {
        await openDirectPaywallPage({
          currentBalance: currentBal,
          requiredAmount: totalTagihan,
          serviceLabel: `${tName} • ${bName} (${formatRp(totalTagihan)})`
        });
      }
      return;
    }

    const okPay = await showLuxuryWalletModal({
      pill: "KONFIRMASI PEMBAYARAN",
      title: "Bayar dengan CN Wallet",
      desc: `Saldo akun @${activeUser.username} akan dipotong otomatis dan bukti pembayaran LUNAS disertakan ke format order Telegram.`,
      rows: [
        { label: "Saldo Saat Ini", value: formatRp(currentBal), color: "#34d399" },
        { label: "Total Pembayaran", value: formatRp(totalTagihan), color: "#ff80ab" },
        { divider: true },
        { label: "Sisa Saldo Setelah Bayar", value: formatRp(currentBal - totalTagihan), color: "#ffffff" }
      ],
      primaryText: `Bayar ${formatRp(totalTagihan)} & Lanjut ke Telegram`,
      primaryIcon: "fa-lock",
      secondaryText: "Batalkan"
    });

    if (!okPay) {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = origBtnHtml;
      }
      return;
    }

    if (submitBtn) {
      submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Memotong Saldo CN Wallet...';
    }

    let sessTok = localStorage.getItem("cn_session_token") || activeUser.token || "";
    if (!sessTok) {
      const gRes = await fetch(`${WORKER_API}/api/session/guest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: activeUser.username })
      });
      const gData = await gRes.json().catch(() => ({}));
      if (gData && gData.sessionToken) {
        sessTok = gData.sessionToken;
        localStorage.setItem("cn_session_token", sessTok);
      }
    }

    const spendRes = await fetch(`${WORKER_API}/api/wallet/spend`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Session-Token": sessTok },
      body: JSON.stringify({
        username: activeUser.username,
        amount: totalTagihan,
        service: `${document.getElementById('calcTalent')?.value || 'Talent'} • ${document.getElementById('calcBagian')?.value || 'Service'}`
      })
    });
    const spendData = await spendRes.json().catch(() => ({}));

    if (!spendRes.ok || !spendData.success) {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = origBtnHtml;
      }
      const latestBal = typeof spendData.balance === "number" ? spendData.balance : currentBal;
      const goTopup = await showLuxuryWalletModal({
        pill: "SALDO TIDAK MENCUKUPI",
        title: "Top-Up Terlebih Dahulu",
        desc: spendData.error || "Saldo CN Wallet Anda belum mencukupi untuk melanjutkan transaksi ini.",
        rows: [
          { label: "Saldo Terverifikasi", value: formatRp(latestBal), color: "#fb7185" },
          { label: "Total Tagihan", value: formatRp(totalTagihan), color: "#ffffff" }
        ],
        primaryText: "+ Top Up Terlebih Dahulu",
        primaryIcon: "fa-circle-plus",
        secondaryText: "Tutup"
      });
      if (goTopup) {
        await openDirectPaywallPage({
          currentBalance: latestBal,
          requiredAmount: totalTagihan,
          serviceLabel: `${document.getElementById('calcTalent')?.value || 'Talent'} • ${document.getElementById('calcBagian')?.value || 'Service'}`
        });
      }
      return;
    }

    const receiptCode = "CN-PAID-" + Date.now();
    const noteInput = document.getElementById('calcNote');
    if (noteInput && !noteInput.value.includes("CN-PAID-")) {
      noteInput.value = (noteInput.value ? noteInput.value + " | " : "") + `LUNAS WALLET (${receiptCode})`;
    }
  } catch (err) {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = origBtnHtml;
    }
    await showLuxuryWalletModal({
      pill: "GANGGUAN KONEKSI",
      title: "Gagal Memverifikasi Saldo",
      desc: "Koneksi ke server CN Wallet terputus sementara. Periksa jaringan internet Anda lalu coba kembali.",
      primaryText: "Coba Lagi",
      primaryIcon: "fa-rotate-right",
      secondaryText: "Tutup"
    });
    return;
  }
  // === END HARD PAYMENT GATE ===

  const clientNameVal = document.getElementById('calcClient')?.value.trim() || 'Anonymous';
  const talentNameVal = document.getElementById('calcTalent')?.value.trim() || 'Talent';
  const serviceCatVal = document.getElementById('calcBagian')?.value.trim() || 'VC';
  const requestKhususVal = document.getElementById('calcCustomRequest')?.value.trim() || '-';
  const catatanTambahanVal = document.getElementById('calcNote')?.value.trim() || '-';
  const totalAkhirText = document.getElementById('displayTotal')?.innerText || formatPrice(hargaBase);

  const durationTextVal = document.getElementById('detailMinuteOption')?.selectedOptions[0]?.innerText || '5 menit';

  logRealTimeOrder(clientNameVal, talentNameVal, serviceCatVal, durationTextVal, hargaBase);

  const orderText = `FORM ORDER CLUBS'NIGHT AGENCY\n` +
                    `• Talent: ${talentNameVal}\n` +
                    `• Layanan: ${serviceCatVal}\n` +
                    `• Request Khusus: ${requestKhususVal}\n` +
                    `• Catatan Tambahan: ${catatanTambahanVal}\n` +
                    `• Total: ${totalAkhirText}\n` +
                    `• Client: ${clientNameVal}`;

  try { 
    await navigator.clipboard.writeText(orderText); 
  } catch (err) {}

  showToast("Pesanan tercatat ke Testimoni! Mengarahkan ke Telegram...");

  setTimeout(() => {
    if (tg && tg.initData) { 
      tg.sendData(orderText); 
      tg.close(); 
    } else { 
      window.location.href = TELEGRAM_CS_BOT_URL; 
    }
  }, 900);
}

function showGallery() {
  const detail = document.getElementById('detailView');
  const testimoni = document.getElementById('testimoniView');
  const blog = document.getElementById('blogView');
  const gallery = document.getElementById('galleryView');

  if (detail) detail.style.display = 'none';
  if (testimoni) testimoni.style.display = 'none';
  if (blog) blog.style.display = 'none';
  if (gallery) gallery.style.display = 'block';

  if (typeof resetAllFilters === 'function') {
    resetAllFilters();
  }
  document.getElementById('galeri')?.scrollIntoView({ behavior: 'smooth' });
}

function showHomeReels() {
  const detail = document.getElementById('detailView');
  const testimoni = document.getElementById('testimoniView');
  const blog = document.getElementById('blogView');
  const gallery = document.getElementById('galleryView');

  if (detail) detail.style.display = 'none';
  if (testimoni) testimoni.style.display = 'none';
  if (blog) blog.style.display = 'none';
  if (gallery) gallery.style.display = 'block';

  currentVibeFilter = 'All';
  document.querySelectorAll('.sub-row .icon-chip').forEach(c => c.classList.remove('active', 'active-gradient'));
  const allVibeChip = document.querySelector(".sub-row .icon-chip[onclick*=\"filterByVibe('All'\"]");
  if (allVibeChip) allVibeChip.classList.add('active-gradient');

  const allChip = document.querySelector(".icon-chip[onclick*=\"'All'\"]");
  setCategory(
    'All',
    allChip,
    'Semua Reels Feed',
    'Menampilkan seluruh koleksi video reels & talent.'
  );

  const searchInput = document.getElementById('searchInput');
  if (searchInput) searchInput.value = '';

  setTimeout(() => {
    const galeriSec = document.getElementById('galeri');
    if (galeriSec) {
      galeriSec.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, 100);
}

function showVcsGallery() {
  const detail = document.getElementById('detailView');
  const testimoni = document.getElementById('testimoniView');
  const blog = document.getElementById('blogView');
  const gallery = document.getElementById('galleryView');

  if (detail) detail.style.display = 'none';
  if (testimoni) testimoni.style.display = 'none';
  if (blog) blog.style.display = 'none';
  if (gallery) gallery.style.display = 'block';

  currentVibeFilter = 'All';
  document.querySelectorAll('.sub-row .icon-chip').forEach(c => c.classList.remove('active', 'active-gradient'));
  const allVibeChip = document.querySelector(".sub-row .icon-chip[onclick*=\"filterByVibe('All'\"]");
  if (allVibeChip) allVibeChip.classList.add('active-gradient');

  const vcsBtn = document.querySelector(".icon-chip[onclick*='VCService']");
  setCategory(
    'VCService',
    vcsBtn,
    'VCService (Virtual Call)',
    'Layanan panggilan video privat 1-on-1 via Telegram.'
  );

  setTimeout(() => {
    const targetTitle = document.getElementById('vcsSectionTitle') || document.getElementById('vcsSection');
    if (targetTitle) {
      targetTitle.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, 120);
}

// ==================== BLOG & DOKUMEN CONTROLLER ====================
function showBlogView() {
  const gallery = document.getElementById('galleryView');
  const detail = document.getElementById('detailView');
  const blog = document.getElementById('blogView');
  const testimoni = document.getElementById('testimoniView');

  if (gallery) gallery.style.display = 'none';
  if (detail) detail.style.display = 'none';
  if (testimoni) testimoni.style.display = 'none';
  if (blog) blog.style.display = 'block';

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function resetBlogTabs(activeBtn) {
  document.querySelectorAll('.article-tab-btn').forEach(b => b.classList.remove('active'));
  if (activeBtn) activeBtn.classList.add('active');

  const pdfFrame = document.getElementById('pdfViewerFrame');
  const rulesBox = document.getElementById('rulesContentBox');
  const serverBox = document.getElementById('serverContentBox');

  const editorialBox = document.getElementById('editorialArticlesBox');
  if (editorialBox) editorialBox.style.display = 'none';
  if (pdfFrame) pdfFrame.style.display = 'none';
  if (rulesBox) rulesBox.style.display = 'none';
  if (serverBox) serverBox.style.display = 'none';
}

function showEditorialArticlesTab(btnElement) {
  resetBlogTabs(btnElement);
  const editorialBox = document.getElementById('editorialArticlesBox');
  const titleEl = document.getElementById('activeArticleName');
  const fullscreenBtn = document.getElementById('btnPdfFullscreen');
  if (titleEl) titleEl.innerHTML = '<i class="fa-solid fa-feather-pointed"></i> Editorial: New Article Project &amp; Clubs\'Night';
  if (fullscreenBtn) {
    fullscreenBtn.style.display = 'inline-flex';
    fullscreenBtn.href = '/artikel.html';
    fullscreenBtn.innerHTML = '<i class="fa-solid fa-up-right-from-square"></i> Halaman Penuh';
  }
  if (editorialBox) editorialBox.style.display = 'block';
}

function showPdfTab(pdfUrl, articleTitle, btnElement) {
  resetBlogTabs(btnElement);

  const pdfFrame = document.getElementById('pdfViewerFrame');
  const embedFrame = document.getElementById('pdfEmbedFrame');
  const titleEl = document.getElementById('activeArticleName');
  const fullscreenBtn = document.getElementById('btnPdfFullscreen');

  if (embedFrame) embedFrame.src = pdfUrl;
  if (titleEl) titleEl.innerHTML = `<i class="fa-solid fa-file-lines"></i> ${articleTitle}`;
  if (fullscreenBtn) {
    fullscreenBtn.style.display = 'inline-flex';
    fullscreenBtn.href = pdfUrl.replace('/preview', '/view');
  }
  if (pdfFrame) pdfFrame.style.display = 'block';
}

function showRulesTab(btnElement) {
  resetBlogTabs(btnElement);

  const rulesBox = document.getElementById('rulesContentBox');
  const titleEl = document.getElementById('activeArticleName');
  const fullscreenBtn = document.getElementById('btnPdfFullscreen');

  if (titleEl) titleEl.innerHTML = `<i class="fa-solid fa-file-shield"></i> Peraturan Resmi Agensi`;
  if (fullscreenBtn) {
    fullscreenBtn.style.display = 'inline-flex';
    fullscreenBtn.href = 'https://telegra.ph/PERATURAN-AGENCY-10-18';
  }
  if (rulesBox) rulesBox.style.display = 'block';
}

function showServerInfoTab(btnElement) {
  resetBlogTabs(btnElement);

  const serverBox = document.getElementById('serverContentBox');
  const titleEl = document.getElementById('activeArticleName');
  const fullscreenBtn = document.getElementById('btnPdfFullscreen');

  if (titleEl) titleEl.innerHTML = `<i class="fa-solid fa-server"></i> Status Server & Keamanan`;
  if (fullscreenBtn) fullscreenBtn.style.display = 'none';
  if (serverBox) serverBox.style.display = 'block';
}

function loadMore() { visibleCount += 6; filterTalents(); }
function handleImgError(el) { el.onerror = null; el.src = PLACEHOLDER_IMG; }
Object.assign(window, {
  skipTour, nextTourStep, startWebsiteTour, closeMediaAdPermanently, trackMediaAdClick,
  confirmAge, verifyDevPin, closeDevPinModal, closeCommentsModal, submitComment,
  handleLogoClick, changeCurrency, showHomeReels, showVcsGallery, showTestimonials,
  showBlogView, showGallery, showEditorialArticlesTab, showPdfTab, showRulesTab, showServerInfoTab,
  logoutDevPanel, closeDevPanel, openAddTalentForm, openBannerManager, openVoucherManager,
  exportDataJSON, triggerImportJSON, importDataJSON, saveVoucherData, hideVoucherForm,
  deleteVoucher, saveBannerData, hideBannerForm, deleteBanner, saveTalentData,
  hideTalentForm, uploadImageToCatbox, uploadVideoToCloudinary, toggleCatInput,
  toggleMinInput, quickCycleStatus, openEditTalentForm, deleteTalent,
  filterTalents, setCategory, filterByVibe, resetAllFilters, loadMore,
  openDetailById, openDetail, toggleFavorite, openCommentsModal, toggleReelSound,
  renderVisitorDurationDropdown, onVisitorSelectCategory, processToCalculator,
  applyVoucherCode, copyAndRedirectToBot, toggleCnChat, sendQuickMsg,
  connectToAdminTelegram, sendCnMessage, scrollToTopPage, handleImgError
});

import "./luxury-theme.css";


// Ekspos openDetail & openDetailById ke global agar tombol Booking di Lounge langsung membuka halaman mandiri Detail Booking
window.openDetail = openDetail;
window.openDetailById = openDetailById;
