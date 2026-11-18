// Nocturnal Editorial Scrollytelling & Ambient Canvas Engine (No Top Hairline + Top Scroll Lock)
(function initClubsNightScrollytelling() {
  if (typeof window === 'undefined') return;

  // Pastikan halaman selalu dimulai dari paling atas saat reload
  if ('scrollRestoration' in history) {
    history.scrollRestoration = 'manual';
  }
  window.scrollTo(0, 0);

  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Hapus top progress hairline jika masih tersisa
  const oldHairline = document.querySelector('.cn-scroll-progress');
  if (oldHairline) oldHairline.remove();

  // Ambient Canvas Layer (Partikel Halus Crimson & Gold)
  let canvas = document.getElementById('cn-ambient-canvas');
  if (!canvas && !prefersReduced) {
    canvas = document.createElement('canvas');
    canvas.id = 'cn-ambient-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.prepend(canvas);
  }

  let scrollY = 0;

  if (canvas && !prefersReduced) {
    const ctx = canvas.getContext('2d');
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const orbs = Array.from({ length: 20 }, (_, i) => ({
      x: Math.random() * width,
      y: Math.random() * height,
      r: Math.random() * 2 + 0.8,
      speedY: Math.random() * 0.22 + 0.08,
      driftX: (Math.random() - 0.5) * 0.18,
      isGold: i % 3 !== 0,
      alpha: Math.random() * 0.4 + 0.15
    }));

    window.addEventListener('resize', () => {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    }, { passive: true });

    function renderCanvas() {
      ctx.clearRect(0, 0, width, height);

      const scrollRatio = Math.min(1, scrollY / Math.max(1, document.body.scrollHeight - height));
      const grad = ctx.createRadialGradient(
        width * (0.25 + scrollRatio * 0.5),
        height * 0.18,
        20,
        width * 0.5,
        height * 0.25,
        Math.max(width, height) * 0.72
      );
      grad.addColorStop(0, 'rgba(236, 24, 100, 0.10)');
      grad.addColorStop(0.55, 'rgba(245, 194, 107, 0.05)');
      grad.addColorStop(1, 'rgba(9, 5, 18, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);

      for (const orb of orbs) {
        orb.y -= orb.speedY;
        orb.x += orb.driftX;
        if (orb.y < -10) orb.y = height + 10;
        if (orb.x < -10) orb.x = width + 10;
        if (orb.x > width + 10) orb.x = -10;

        const parallaxOffset = (scrollY * (orb.r * 0.035)) % height;
        const drawY = (orb.y - parallaxOffset + height) % height;

        ctx.beginPath();
        ctx.arc(orb.x, drawY, orb.r, 0, Math.PI * 2);
        ctx.fillStyle = orb.isGold
          ? `rgba(245, 194, 107, ${orb.alpha})`
          : `rgba(236, 24, 100, ${orb.alpha * 0.85})`;
        ctx.fill();
      }

      requestAnimationFrame(renderCanvas);
    }
    requestAnimationFrame(renderCanvas);
  }

  function setupScrollytellingNodes() {
    window.scrollTo(0, 0);

    const sections = Array.from(document.querySelectorAll('main > section, section, .glass-card, form, footer'));
    sections.forEach((sec) => {
      if (sec.closest('header') || sec.closest('nav') || sec.closest('#bannerSlider') || sec.classList.contains('carousel-container')) return;

      const rect = sec.getBoundingClientRect();
      // Elemen yang sudah terlihat di layar awal langsung tampil tanpa delay
      if (rect.top < window.innerHeight * 0.9) {
        sec.classList.add('cn-reveal', 'is-inview');
      } else {
        sec.classList.add('cn-reveal');
      }

      const children = sec.querySelectorAll(':scope > div > a, :scope > div > div.glass-card, .talent-card');
      children.forEach((child, idx) => {
        child.classList.add('cn-stagger-item');
        child.style.setProperty('--stagger-idx', String(idx % 6));
      });
    });

    const majorSections = Array.from(document.querySelectorAll('section')).filter(s => s.offsetHeight > 140);
    if (majorSections.length >= 2 && !document.querySelector('.cn-chapter-rail')) {
      const rail = document.createElement('nav');
      rail.className = 'cn-chapter-rail';
      rail.setAttribute('aria-label', 'Navigasi Bagian Halaman');

      majorSections.forEach((sec, idx) => {
        const dot = document.createElement('button');
        dot.type = 'button';
        dot.className = 'cn-chapter-dot' + (idx === 0 ? ' is-active' : '');
        dot.setAttribute('aria-label', `Bagian ${idx + 1}`);
        dot.addEventListener('click', () => {
          sec.scrollIntoView({ behavior: prefersReduced ? 'auto' : 'smooth', block: 'start' });
        });
        rail.appendChild(dot);
      });
      document.body.appendChild(rail);
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-inview');
          entry.target.style.willChange = 'auto';

          const idx = majorSections.indexOf(entry.target);
          if (idx !== -1) {
            document.querySelectorAll('.cn-chapter-dot').forEach((d, i) => {
              d.classList.toggle('is-active', i === idx);
            });
          }
        }
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -20px 0px' });

    document.querySelectorAll('.cn-reveal, .cn-stagger-item').forEach((el) => observer.observe(el));

    const mutationObs = new MutationObserver(() => {
      document.querySelectorAll('#heroPreviewGrid > a, .talent-card').forEach((card, idx) => {
        if (!card.classList.contains('cn-stagger-item')) {
          card.classList.add('cn-stagger-item');
          card.style.setProperty('--stagger-idx', String(idx % 6));
          observer.observe(card);
        }
      });
    });
    mutationObs.observe(document.body, { childList: true, subtree: true });
  }

  function onScroll() {
    scrollY = window.scrollY || 0;
    const header = document.querySelector('header, nav');
    if (header) {
      header.classList.toggle('is-scrolled', scrollY > 24);
    }
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('load', () => window.scrollTo(0, 0));

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setupScrollytellingNodes();
      onScroll();
    });
  } else {
    setupScrollytellingNodes();
    onScroll();
  }
})();
