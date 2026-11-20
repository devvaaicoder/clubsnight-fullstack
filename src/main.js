function escapeHTML(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
// CLIENT FIREWALL
        document.addEventListener('contextmenu', e => e.preventDefault());
        document.addEventListener('keydown', e => {
            if (e.keyCode === 123 || (e.ctrlKey && e.shiftKey && (e.keyCode === 73 || e.keyCode === 74 || e.keyCode === 67)) || (e.ctrlKey && (e.keyCode === 85 || e.keyCode === 83))) {
                e.preventDefault();
            }
        });

        // Safe LocalStorage Wrapper
        window._memStorage = {};
        function safeGetItem(key) {
            try {
                return localStorage.getItem(key);
            } catch (e) {
                return window._memStorage[key] || null;
            }
        }
        function safeSetItem(key, val) {
            try {
                localStorage.setItem(key, val);
            } catch (e) {
                window._memStorage[key] = val;
            }
        }

        /* LOGIK ANALITIK KUNJUNGAN USER REALTIME */
        function recordUserVisitAnalytics() {
            let userToken = safeGetItem('nighty_user_token');
            if (!userToken) {
                userToken = 'USR-' + Math.random().toString(36).substring(2, 9).toUpperCase();
                safeSetItem('nighty_user_token', userToken);
            }

            let logs = [];
            try {
                logs = JSON.parse(safeGetItem('nighty_analytics_logs') || '[]');
            } catch(e) { logs = []; }

            const nowStr = new Date().toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'medium' });
            const userAgentStr = navigator.userAgent.includes('Mobile') ? 'Mobile' : 'Desktop/PC';

            let userRecord = logs.find(item => item.token === userToken);
            if (userRecord) {
                userRecord.hits += 1;
                userRecord.lastActive = nowStr;
            } else {
                userRecord = {
                    token: userToken,
                    firstVisit: nowStr,
                    lastActive: nowStr,
                    device: userAgentStr,
                    hits: 1
                };
                logs.unshift(userRecord);
            }

            safeSetItem('nighty_analytics_logs', JSON.stringify(logs));
        }

        function refreshAnalyticsView() {
            let logs = [];
            try {
                logs = JSON.parse(safeGetItem('nighty_analytics_logs') || '[]');
            } catch(e) { logs = []; }

            const totalUsers = logs.length;
            const totalHits = logs.reduce((acc, curr) => acc + (curr.hits || 1), 0);
            const lastActive = logs.length > 0 ? logs[0].lastActive : 'Belum ada';

            document.getElementById('statTotalUsers').innerText = totalUsers;
            document.getElementById('statTotalHits').innerText = totalHits;
            document.getElementById('statLastActive').innerText = lastActive;

            const tbody = document.getElementById('analyticsTableBody');
            if (!tbody) return;

            if (logs.length === 0) {
                tbody.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-purple-400">Belum ada data kunjungan tercatat.</td></tr>`;
                return;
            }

            tbody.innerHTML = logs.map(item => `
                <tr class="hover:bg-purple-900/20 font-mono">
                    <td class="p-2.5 font-bold text-pink-400">${escapeHTML(item.token)}</td>
                    <td class="p-2.5 text-purple-200">${escapeHTML(item.firstVisit)}</td>
                    <td class="p-2.5 text-cyan-300">${escapeHTML(item.device)}</td>
                    <td class="p-2.5 text-center font-bold text-emerald-400">${Number(item.hits) || 1} Sesi</td>
                </tr>
            `).join('');
        }

        const TELEGRAM_BOT_USERNAME = "CLUBSNIGHTCS_BOT";
        const TELEGRAM_ORDER_LINK = `https://t.me/${TELEGRAM_BOT_USERNAME}?start=booking`;
        const TELEGRAM_APP_LINK = `tg://resolve?domain=${TELEGRAM_BOT_USERNAME}&start=booking`;

        // Admin credentials diverifikasi via Cloudflare Worker

        const VCS_PRICING = {
            "Rekomendasi Admin (Bebas Pilih)": { "3": 110000, "5": 130000, "10": 220000, "15": 300000 },
            "Katalog Talent Tocil": { "3": 90000, "5": 120000, "10": 200000, "15": 280000 },
            "Katalog Talent Toge": { "3": 145000, "5": 165000, "10": 290000, "15": 400000 },
            "Booking Service Offline Privat": { "3": 110000, "5": 130000, "10": 220000, "15": 300000 }
        };

        const SERVICE_CALL_PRICING = { "30": 35000, "60": 75000, "120": 135000, "360": 160000 };

        const OFFLINE_PRIVAT_PRICING = {
            "1jam": { label: "1 Jam (60 Menit)", text: "Rp 1.000.000" },
            "3jam": { label: "3 Jam", text: "Rp 2.500.000 - Rp 3.000.000" },
            "6jam": { label: "6 Jam", text: "Rp 4.000.000 - Rp 5.500.000" },
            "12jam": { label: "12 Jam", text: "Rp 7.500.000 - Rp 8.000.000" },
            "ons": { label: "Satu Malam (ONS)", text: "Rp 9.500.000 - Rp 10.000.000" },
            "24jam": { label: "24 Jam (Long Time)", text: "Price Request Only" }
        };

        /* FITUR PEMBATASAN UMUR */
        function checkAgeVerification() {
            const modal = document.getElementById('ageVerificationModal');
            if (!modal) return;
            
            const isVerified = safeGetItem('nighty_age_verified');
            if (isVerified === 'true') {
                modal.classList.add('hidden');
                modal.style.display = 'none';
                document.body.style.overflow = 'auto';
            } else {
                modal.classList.remove('hidden');
                modal.style.display = 'flex';
                document.body.style.overflow = 'hidden';
            }
        }

        function confirmAge() {
            safeSetItem('nighty_age_verified', 'true');
            const modal = document.getElementById('ageVerificationModal');
            if (modal) {
                modal.classList.add('hidden');
                modal.style.display = 'none';
            }
            document.body.style.overflow = 'auto';
            showToast("Verifikasi Berhasil", "Selamat datang di Nighty by CLUBS' NIGHT.");
        }

        function rejectAge() {
            window.location.href = "https://www.google.com";
        }

        /* CANVAS STARS */
        const canvas = document.getElementById('starsCanvas');
        const ctx = canvas ? canvas.getContext('2d') : null;
        let stars = [], lastFrameTime = 0, isPageVisible = true;

        function resizeCanvas() {
            if (!canvas) return;
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
            initStars();
        }

        function initStars() {
            stars = [];
            const count = Math.floor((canvas.width * canvas.height) / 22000);
            for (let i = 0; i < count; i++) {
                stars.push({
                    x: Math.random() * canvas.width,
                    y: Math.random() * canvas.height,
                    radius: Math.random() * 1.2,
                    alpha: Math.random(),
                    speed: Math.random() * 0.008 + 0.002
                });
            }
        }

        function drawStars(currentTime) {
            if (!isPageVisible || !ctx) return;
            requestAnimationFrame(drawStars);

            if (currentTime - lastFrameTime < 33) return; 
            lastFrameTime = currentTime;

            ctx.clearRect(0, 0, canvas.width, canvas.height);
            stars.forEach(star => {
                star.alpha += star.speed;
                if (star.alpha > 1 || star.alpha < 0) star.speed = -star.speed;
                ctx.beginPath();
                ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(244, 114, 182, ${Math.abs(star.alpha)})`;
                ctx.fill();
            });
        }

        document.addEventListener("visibilitychange", () => {
            isPageVisible = !document.hidden;
            if (isPageVisible) requestAnimationFrame(drawStars);
        });

        function updateDurationDropdown() {
            const serviceEl = document.getElementById("calcService");
            const durationSelect = document.getElementById("calcDuration");
            if (!serviceEl || !durationSelect) return;

            const service = serviceEl.value;
            const currentVal = durationSelect.value;

            if (service === "Video call service") {
                if (!durationSelect.querySelector('option[value="10"]')) {
                    durationSelect.innerHTML = `
                        <option value="3" ${currentVal === "3" ? "selected" : ""}>3 Menit</option>
                        <option value="5" ${currentVal === "5" ? "selected" : ""}>5 Menit</option>
                        <option value="10" ${currentVal === "10" ? "selected" : ""}>10 Menit</option>
                        <option value="15" ${currentVal === "15" ? "selected" : ""}>15 Menit</option>
                    `;
                }
            } else if (service === "Booking Service Offline Privat") {
                if (!durationSelect.querySelector('option[value="1jam"]')) {
                    durationSelect.innerHTML = `
                        <option value="1jam" ${currentVal === "1jam" ? "selected" : ""}>1 Jam (60 Menit) - Rp 1.000.000</option>
                        <option value="3jam" ${currentVal === "3jam" ? "selected" : ""}>3 Jam - Rp 2.500.000 - Rp 3.000.000</option>
                        <option value="6jam" ${currentVal === "6jam" ? "selected" : ""}>6 Jam - Rp 4.000.000 - Rp 5.500.000</option>
                        <option value="12jam" ${currentVal === "12jam" ? "selected" : ""}>12 Jam - Rp 7.500.000 - Rp 8.000.000</option>
                        <option value="ons" ${currentVal === "ons" ? "selected" : ""}>Satu Malam (ONS) - Rp 9.500.000 - Rp 10.000.000</option>
                        <option value="24jam" ${currentVal === "24jam" ? "selected" : ""}>24 Jam (Long Time) - Price Request Only</option>
                    `;
                }
            } else {
                if (!durationSelect.querySelector('option[value="30"]')) {
                    durationSelect.innerHTML = `
                        <option value="30" ${currentVal === "30" ? "selected" : ""}>30 Menit</option>
                        <option value="60" ${currentVal === "60" || (currentVal !== "30" && currentVal !== "120" && currentVal !== "360") ? "selected" : ""}>1 Jam (60 Menit)</option>
                        <option value="120" ${currentVal === "120" ? "selected" : ""}>2 Jam (120 Menit)</option>
                        <option value="360" ${currentVal === "360" ? "selected" : ""}>Semalaman / Sleep Call (6 Jam)</option>
                    `;
                }
            }
        }

        function calculatePrice() {
            updateDurationDropdown();
            const talentEl = document.getElementById("calcTalent");
            const serviceEl = document.getElementById("calcService");
            const durationEl = document.getElementById("calcDuration");
            if (!talentEl || !serviceEl || !durationEl) return;

            const talent = talentEl.value;
            const service = serviceEl.value;
            const duration = durationEl.value;

            let totalDisplay = "";
            let durationLabel = duration + " Menit";

            if (service === "Video call service") {
                const rates = VCS_PRICING[talent] || VCS_PRICING["Rekomendasi Admin (Bebas Pilih)"];
                const total = rates[duration] || 110000;
                totalDisplay = "Rp " + total.toLocaleString("id-ID");
            } else if (service === "Booking Service Offline Privat") {
                const item = OFFLINE_PRIVAT_PRICING[duration] || OFFLINE_PRIVAT_PRICING["1jam"];
                totalDisplay = item.text;
                durationLabel = item.label;
            } else {
                const total = SERVICE_CALL_PRICING[duration] || 75000;
                totalDisplay = "Rp " + total.toLocaleString("id-ID");
                if (duration === "30") durationLabel = "30 Menit";
                else if (duration === "60") durationLabel = "1 Jam (60 Menit)";
                else if (duration === "120") durationLabel = "2 Jam (120 Menit)";
                else if (duration === "360") durationLabel = "Semalaman / Sleep Call (6 Jam)";
            }

            document.getElementById("summaryTalentText").innerText = talent;
            document.getElementById("summaryServiceText").innerText = service;
            document.getElementById("summaryDurationText").innerText = durationLabel;
            document.getElementById("summaryTotalText").innerText = totalDisplay;
        }

        function selectServiceType(serviceName) {
            const selectEl = document.getElementById("calcService");
            if (!selectEl) return;
            for (let i = 0; i < selectEl.options.length; i++) {
                if (selectEl.options[i].value.includes(serviceName)) {
                    selectEl.selectedIndex = i;
                    break;
                }
            }
            calculatePrice();
        }

        function generateBookingMessage() {
            const talent = document.getElementById("calcTalent").value;
            const service = document.getElementById("calcService").value;
            const durationText = document.getElementById("summaryDurationText").innerText;
            const totalText = document.getElementById("summaryTotalText").innerText;
            const notes = document.getElementById("calcNotes").value || "Tidak ada catatan khusus";

            return `Halo Admin CLUBS' NIGHT! 🌙\nSaya ingin memesan layanan Nighty:\n\n` +
                `• Kategori Order: ${talent}\n` +
                `• Layanan: ${service}\n` +
                `• Waktu / Durasi: ${durationText}\n` +
                `• Total Estimasi: ${totalText}\n` +
                `• Catatan/Topik: ${notes}\n\n` +
                `Apakah slot untuk paket ini sedang ready? ✨`;
        }

        function sendToTelegram() {
            const message = generateBookingMessage();
            document.getElementById("bookingMessagePreview").value = message;
            copyTextToClipboard(message);
            document.getElementById("bookingModal").classList.remove("hidden");
            if (window.lucide) window.lucide.createIcons();
        }

        function copyTextToClipboard(text) {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text);
            } else {
                const tempInput = document.createElement("textarea");
                tempInput.value = text;
                document.body.appendChild(tempInput);
                tempInput.select();
                document.execCommand("copy");
                document.body.removeChild(tempInput);
            }
        }

        function executeTelegramRedirect(mode) {
            copyTextToClipboard(document.getElementById("bookingMessagePreview").value);
            const link = (mode === 'app') ? TELEGRAM_APP_LINK : TELEGRAM_ORDER_LINK;
            showToast("Pesanan Disalin!", "Mengarahkan ke Telegram CS Bot...");
            setTimeout(() => window.open(link, "_blank", "noopener,noreferrer"), 600);
        }

        function copyBookingMessageOnly() {
            copyTextToClipboard(document.getElementById("bookingMessagePreview").value);
            showToast("Teks Pesanan Disalin!", "Tempelkan (paste) pesan pada obrolan Telegram.");
        }

        function closeBookingModal() {
            document.getElementById("bookingModal").classList.add("hidden");
        }

        function showToast(title, msg) {
            const toast = document.getElementById("toast");
            if (!toast) return;
            document.getElementById("toastTitle").innerText = title;
            document.getElementById("toastMsg").innerText = msg;
            toast.classList.remove("translate-y-20", "opacity-0");
            toast.classList.add("translate-y-0", "opacity-100");
            setTimeout(() => {
                toast.classList.remove("translate-y-0", "opacity-100");
                toast.classList.add("translate-y-20", "opacity-0");
            }, 2500);
        }

        async function handleAdminLogin() {
            const userVal = document.getElementById("adminUser").value.trim();
            const passVal = document.getElementById("adminPass").value;
            const errBox = document.getElementById("loginErrorMsg");
            if (!userVal || !passVal) {
                errBox.innerText = "Username dan password wajib diisi!";
                errBox.classList.remove("hidden");
                return;
            }
            try {
                const res = await fetch(`${WORKER_API_URL}/api/verify-auth`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${passVal}`
                    },
                    body: JSON.stringify({ username: userVal })
                });
                const data = await res.json();
                if (res.ok && data.success) {
                    sessionStorage.setItem("cn_admin_token", passVal);
                    errBox.classList.add("hidden");
                    document.getElementById("adminLoginForm").classList.add("hidden");
                    document.getElementById("adminDashboard").classList.remove("hidden");
                    refreshAnalyticsView();
                    showToast("Login Admin Terverifikasi!", "Sesi aman terhubung ke Cloudflare Worker.");
                } else {
                    errBox.innerText = data.error || "Username atau password/token tidak sah!";
                    errBox.classList.remove("hidden");
                }
            } catch (e) {
    const isLocal = ["localhost", "127.0.0.1"].includes(window.location.hostname);
    const localToken = import.meta.env.VITE_LOCAL_ADMIN_TOKEN;
    if (isLocal && localToken && passVal === localToken) {
      sessionStorage.setItem("cn_admin_token", passVal);
      errBox.classList.add("hidden");
      document.getElementById("adminLoginForm").classList.add("hidden");
      document.getElementById("adminDashboard").classList.remove("hidden");
      refreshAnalyticsView();
      showToast("Login Lokal Aktif", "Deploy backend/worker.js untuk verifikasi server.");
    } else {
      errBox.innerText = "Gagal terhubung ke server autentikasi. Pastikan backend/worker.js sudah di-deploy.";
      errBox.classList.remove("hidden");
    }
  }
        }

        function handleAdminLogout() {
            sessionStorage.removeItem("cn_admin_token");
            document.getElementById("adminDashboard").classList.add("hidden");
            document.getElementById("adminLoginForm").classList.remove("hidden");
            document.getElementById("adminPass").value = "";
            showToast("Admin Logout", "Token sesi dihapus.");
        }

        function publishAnnouncement() {
            const badge = document.getElementById("inputBadge").value.trim() || "PENGUMUMAN RESMI";
            const title = document.getElementById("inputTitle").value.trim() || "Info Terbaru";
            const body = document.getElementById("inputBody").value.trim() || "";
            if (!body) return alert("Isi pesan pengumuman tidak boleh kosong!");

            document.getElementById("announcementBadge").innerText = badge;
            document.getElementById("announcementTitle").innerText = title;
            document.getElementById("announcementBody").innerText = body;
            document.getElementById("floatingAnnouncement").classList.remove("hidden");

            safeSetItem("nighty_announcement", JSON.stringify({ badge, title, body, visible: true }));
            showToast("Pengumuman Diterbitkan!", "Pengumuman melayang sekarang aktif.");
        }

        function hideAnnouncement() {
            document.getElementById("floatingAnnouncement").classList.add("hidden");
            const saved = safeGetItem("nighty_announcement");
            if (saved) {
                try {
                    let data = JSON.parse(saved);
                    data.visible = false;
                    safeSetItem("nighty_announcement", JSON.stringify(data));
                } catch(e) {}
            }
            showToast("Pengumuman Disembunyikan", "Widget melayang ditutup.");
        }

        function closeFloatingAnnouncement() {
            document.getElementById("floatingAnnouncement").classList.add("hidden");
        }

        function loadAnnouncementOnStart() {
            const saved = safeGetItem("nighty_announcement");
            if (saved) {
                try {
                    const data = JSON.parse(saved);
                    if (data.visible) {
                        document.getElementById("announcementBadge").innerText = data.badge;
                        document.getElementById("announcementTitle").innerText = data.title;
                        document.getElementById("announcementBody").innerText = data.body;
                        document.getElementById("floatingAnnouncement").classList.remove("hidden");
                    }
                } catch(e) {}
            } else {
                document.getElementById("floatingAnnouncement").classList.remove("hidden");
            }
        }

        function toggleFaq(btn) {
            const content = btn.nextElementSibling;
            const icon = btn.querySelector('[data-lucide="chevron-down"]');
            if (content.classList.contains('hidden')) {
                content.classList.remove('hidden');
                if(icon) icon.style.transform = 'rotate(180deg)';
            } else {
                content.classList.add('hidden');
                if(icon) icon.style.transform = 'rotate(0deg)';
            }
        }

        // INITIALIZATION ON DOM READY
        document.addEventListener('DOMContentLoaded', () => {
            recordUserVisitAnalytics();
            checkAgeVerification();
            
            const btnMobile = document.getElementById('mobileMenuBtn');
            if (btnMobile) {
                btnMobile.addEventListener('click', () => {
                    document.getElementById('mobileMenu').classList.toggle('hidden');
                });
            }

            window.addEventListener('resize', resizeCanvas, { passive: true });
            resizeCanvas();
            requestAnimationFrame(drawStars);
            calculatePrice();
            loadAnnouncementOnStart();

            if (window.lucide) {
                window.lucide.createIcons();
            } else {
                window.addEventListener('load', () => {
                    if (window.lucide) window.lucide.createIcons();
                });
            }
        });

Object.assign(window, {
    confirmAge, rejectAge, closeBookingModal, executeTelegramRedirect,
    copyBookingMessageOnly, selectServiceType, calculatePrice, sendToTelegram,
    handleAdminLogin, handleAdminLogout, refreshAnalyticsView,
    publishAnnouncement, hideAnnouncement, closeFloatingAnnouncement, toggleFaq
  });

// ==================== SINKRONISASI CLOUDFLARE D1 REALTIME ====================
const WORKER_API_URL = import.meta.env.VITE_API_URL || "https://clubsnight-fullstack.clubsnight.workers.dev";
let d1TalentsCache = [];

function getMinTalentPrice(talent) {
  if (!talent || !talent.customServices) return 0;
  let prices = [];
  Object.values(talent.customServices).forEach(item => {
    if (typeof item === 'object' && item !== null) {
      prices.push(...Object.values(item).map(Number).filter(p => p > 0));
    } else if (Number(item) > 0) {
      prices.push(Number(item));
    }
  });
  return prices.length > 0 ? Math.min(...prices) : 0;
}

function getCompressedAvatar(url) {
  if (!url || typeof url !== 'string' || !url.trim()) return "";
  if (url.includes('wsrv.nl') || url.includes('placehold.co')) return url;
  return `https://wsrv.nl/?url=${encodeURIComponent(url.trim())}&w=160&q=75&output=webp`;
}

function renderHeroPreviewFromD1(talentsList) {
  const grid = document.getElementById('heroPreviewGrid');
  if (!grid || !Array.isArray(talentsList) || talentsList.length === 0) return;

  const readyTalents = talentsList.filter(t => (t.status || 'ready') === 'ready').slice(0, 3);
  if (readyTalents.length === 0) return;

  const borders = ['border-pink-500/30', 'border-purple-500/30', 'border-sky-500/30'];
  const badges = [
    'bg-pink-950/80 text-pink-300 border-pink-500/40',
    'bg-purple-950/80 text-purple-300 border-purple-500/40',
    'bg-sky-950/80 text-sky-300 border-sky-500/40'
  ];

  grid.innerHTML = readyTalents.map((t, idx) => {
    const minPrice = getMinTalentPrice(t);
    const priceLabel = minPrice > 0 ? `Mulai Rp ${minPrice.toLocaleString('id-ID')}` : (t.category || 'VCS & Call');
    const avatarUrl = getCompressedAvatar(t.img);
    const colSpan = (idx === 2) ? 'col-span-2 sm:col-span-1' : '';

    return `
      <a href="katalog.html" class="glass-card glass-card-hover rounded-2xl p-3 ${borders[idx % 3]} flex flex-col items-center text-center group transition-all ${colSpan}">
        <div class="relative w-12 h-12 rounded-full bg-gradient-to-tr from-purple-600 to-pink-500 p-0.5 mb-2 shadow-glow-pink group-hover:scale-105 transition-transform">
          <div class="w-full h-full bg-midnight rounded-full flex items-center justify-center overflow-hidden">
            ${avatarUrl ? `<img src="${avatarUrl}" alt="${t.name}" class="w-full h-full object-cover">` : `<i data-lucide="user" class="w-6 h-6 text-pink-400"></i>`}
          </div>
          <span class="absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 border-2 border-midnight rounded-full" title="Ready"></span>
        </div>
        <span class="font-bold text-xs text-white group-hover:text-pink-300 transition-colors truncate w-full">${t.name}</span>
        <span class="text-[10px] text-purple-300/80 truncate w-full">${priceLabel}</span>
        <span class="mt-2 text-[9px] font-bold px-2 py-0.5 rounded-full border ${badges[idx % 3]}">Pilih Talent →</span>
      </a>
    `;
  }).join('');

  if (window.lucide) window.lucide.createIcons();
}

function syncCalculatorTalentOptions(talentsList) {
  const calcTalent = document.getElementById('calcTalent');
  if (!calcTalent || !Array.isArray(talentsList) || talentsList.length === 0) return;

  const currentVal = calcTalent.value;
  const baseOptions = `
    <option value="Rekomendasi Admin (Bebas Pilih)">Rekomendasi Admin (Bebas Pilih)</option>
    <option value="Katalog Talent Tocil">Katalog Talent Tocil</option>
    <option value="Katalog Talent Toge">Katalog Talent Toge</option>
    <option value="Booking Service Offline Privat">Booking Service Offline Privat</option>
  `;

  const dynamicOptions = talentsList
    .filter(t => (t.status || 'ready') !== 'offline')
    .map(t => `<option value="Talent: ${t.name} (${t.agency || "Clubs'Night"})">Talent: ${t.name} — ${t.agency || "Clubs'Night"}</option>`)
    .join('');

  calcTalent.innerHTML = baseOptions + (dynamicOptions ? `<optgroup label="Talent Ready dari D1">${dynamicOptions}</optgroup>` : '');
  if ([...calcTalent.options].some(o => o.value === currentVal)) {
    calcTalent.value = currentVal;
  }
}

async function syncMainPageWithD1() {
  // 1. Baca cache localStorage dulu agar tampil instan
  try {
    const cached = JSON.parse(safeGetItem('cn_talents') || '[]');
    if (Array.isArray(cached) && cached.length > 0) {
      d1TalentsCache = cached;
      renderHeroPreviewFromD1(cached);
      syncCalculatorTalentOptions(cached);
    }
  } catch (e) {}

  // 2. Fetch data terbaru dari Cloudflare Worker D1
  try {
    const res = await fetch(`${WORKER_API_URL}/api/get?t=${Date.now()}`, {
      method: "GET",
      cache: "no-store",
      headers: { "Accept": "application/json" }
    });
    if (!res.ok) return;
    const result = await res.json();
    if (result && result.success && result.data && Array.isArray(result.data.talents)) {
      d1TalentsCache = result.data.talents;
      safeSetItem('cn_talents', JSON.stringify(result.data.talents));
      if (result.data.banners) safeSetItem('cn_banners', JSON.stringify(result.data.banners));
      if (result.data.vouchers) safeSetItem('cn_vouchers', JSON.stringify(result.data.vouchers));
      renderHeroPreviewFromD1(result.data.talents);
      syncCalculatorTalentOptions(result.data.talents);
    }
  } catch (err) {}
}

// Dengarkan pembaruan realtime antar tab (katalog.html <-> index.html)
if ('BroadcastChannel' in window) {
  const syncChan = new BroadcastChannel('clubsnight_live_sync');
  syncChan.onmessage = (event) => {
    if (event.data && event.data.type === 'CN_DATA_UPDATED' && event.data.payload?.talents) {
      d1TalentsCache = event.data.payload.talents;
      renderHeroPreviewFromD1(d1TalentsCache);
      syncCalculatorTalentOptions(d1TalentsCache);
    }
  };
}

document.addEventListener('DOMContentLoaded', () => {
  syncMainPageWithD1();
});
