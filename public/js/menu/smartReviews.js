/**
 * public/js/menu/smartReviews.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Smart Google Reviews & Feedback Filter
 * Bifurcates reviews: 5 stars redirect to Google Maps, 1-4 stars open a private
 * feedback form submitted to /api/reviews/feedback to protect public reputation.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export let selectedStarRating = 0;

// i18n del modal (manager del menú si existe; fallback español inline).
function rt(key, fallback) {
  try {
    const m = window.i18nManager;
    if (m && typeof m.t === 'function') {
      const v = m.t(key);
      if (v && v !== key) return v;
    }
  } catch (e) {}
  return fallback;
}

/**
 * Opens the Smart Review modal and prepares form state.
 * @param {object} restaurantData Restaurant metadata (name, googleReview url)
 */
export function openSmartReviewModal(restaurantData = {}) {
  selectedStarRating = 0;

  const modal = document.getElementById('smartReviewModal');
  if (!modal) return;

  const box5Stars = document.getElementById('review5StarsBox');
  const boxPrivate = document.getElementById('reviewPrivateFeedbackBox');
  const successMsg = document.getElementById('feedbackSuccessMessage');
  const hintText = document.getElementById('starHintText');
  const nameEl = document.getElementById('smartReviewRestName');
  const googleBtn = document.getElementById('btnGoogleReviewRedirect');
  const form = document.getElementById('privateFeedbackForm');
  const submitBtn = document.getElementById('btnSubmitFeedback');

  if (box5Stars) box5Stars.style.display = 'none';
  if (boxPrivate) boxPrivate.style.display = 'none';
  const googleAlt0 = document.getElementById('btnGoogleReviewAlt');
  if (googleAlt0) googleAlt0.style.display = 'none';

  // Copys i18n (los estáticos del HTML son el fallback español).
  const setText = (id, key, fallback) => {
    const node = document.getElementById(id);
    if (node) node.textContent = rt(key, fallback);
  };
  const setPh = (id, key, fallback) => {
    const node = document.getElementById(id);
    if (node) node.placeholder = rt(key, fallback);
  };
  setText('smartReviewTitle', 'reviewTitle', '¿Cómo estuvo tu experiencia?');
  setText('reviewGoogleTitle', 'reviewGoogleTitle', '¡Nos alegra un montón que te haya encantado!');
  setText('reviewGoogleText', 'reviewGoogleText', '¿Nos regalarías 10 segundos de tu tiempo para dejar tu reseña en Google Maps? Tu calificación nos impulsa enormemente.');
  setText('googleCtaText', 'reviewGoogleCta', '⭐ Publicar Reseña en Google Maps ➔');
  setText('reviewDismissBtn', 'reviewDismiss', 'Listo, ¡muchas gracias!');
  setText('reviewAltPrivateBtn', 'reviewAltPrivate', 'o contanos en privado →');
  setText('reviewPrivateTitle', 'reviewPrivateTitle', 'Queremos escucharte y mejorar');
  setText('reviewPrivateText', 'reviewPrivateText', 'Lamentamos no haber alcanzado la perfección. Tu mensaje llegará de forma directa y privada a la administración:');
  setText('reviewCommentLabel', 'reviewCommentLabel', '¿En qué podemos mejorar o qué sucedió?');
  setPh('feedbackCommentInput', 'reviewCommentPh', 'Contanos tu experiencia (atención, tiempos, sabor, presentación…)');
  setText('reviewNameLabel', 'reviewNameLabel', 'Tu Nombre (opcional)');
  setPh('feedbackNameInput', 'reviewNamePh', 'Ej: Juan');
  setText('reviewContactLabel', 'reviewContactLabel', 'WhatsApp o E-mail (opcional)');
  setPh('feedbackContactInput', 'reviewContactPh', 'Para contactarte…');
  setText('reviewSuccessTitle', 'reviewSuccessTitle', '✓ ¡Mensaje recibido!');
  setText('reviewSuccessText', 'reviewSuccessText', 'Tu comentario fue enviado directamente a la gerencia. Gracias por ayudarnos a perfeccionar nuestro servicio.');
  if (successMsg) successMsg.style.display = 'none';
  if (hintText) hintText.textContent = 'Tocá las estrellas para calificar';

  document.querySelectorAll('.star-btn').forEach(btn => {
    btn.classList.remove('active', 'hover-active');
    btn.setAttribute('aria-pressed', 'false');
  });

  if (nameEl) nameEl.textContent = restaurantData.name || 'nuestro local';
  if (googleBtn) googleBtn.href = restaurantData.googleReview || '#';
  const googleAltBtn = document.getElementById('btnGoogleReviewAlt');
  if (googleAltBtn) googleAltBtn.href = restaurantData.googleReview || '#';

  if (form) {
    form.reset();
    form.style.display = 'block';
  }
  if (submitBtn) {
    submitBtn.disabled = false;
    const span = submitBtn.querySelector('span');
    if (span) span.textContent = rt('reviewPrivateSubmit', '📩 Enviar Comentario Privado a la Gerencia');
  }

  modal.classList.add('active');
  modal.setAttribute('aria-hidden', 'false');
}

/**
 * Closes the Smart Review modal.
 */
export function closeSmartReviewModal() {
  const modal = document.getElementById('smartReviewModal');
  if (modal) {
    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
  }
  selectedStarRating = 0;
}

/**
 * Handles star selection with visual rating hint and branch logic.
 * Pro-política Google: el camino a Google existe para TODOS (4-5★ directo,
 * 1-3★ vía link alternativo), y el canal privado siempre visible. La entrada
 * ("¿Cómo estuvo tu experiencia?") es neutral: nunca se pide solo lo positivo.
 * @param {number} rating Selected rating 1-5
 */
export function handleStarSelect(rating) {
  selectedStarRating = rating;

  document.querySelectorAll('.star-btn').forEach(btn => {
    const star = parseInt(btn.dataset.star, 10);
    btn.classList.toggle('active', star <= rating);
    btn.setAttribute('aria-pressed', String(star === rating));
  });

  const hintTexts = ['', rt('reviewStar1', '😞 Muy mala'), rt('reviewStar2', '😕 Regular'), rt('reviewStar3', '🙂 Buena'), rt('reviewStar4', '😊 Muy buena'), rt('reviewStar5', '🤩 ¡Excelente!')];
  const hintText = document.getElementById('starHintText');
  if (hintText) hintText.textContent = hintTexts[rating] || '';

  showReviewBranch(rating >= 4 ? 'google' : 'private');
}

/**
 * Muestra una rama del modal (google|private) con su link alternativo.
 * La rama Google sin link configurado cae al canal privado (nunca a un '#').
 */
export function showReviewBranch(which) {
  const box5Stars = document.getElementById('review5StarsBox');
  const boxPrivate = document.getElementById('reviewPrivateFeedbackBox');
  const googleAlt = document.getElementById('btnGoogleReviewAlt');
  const googleBtn = document.getElementById('btnGoogleReviewRedirect');
  const hasGoogle = Boolean(googleBtn && googleBtn.getAttribute('href') && googleBtn.getAttribute('href') !== '#');

  const showGoogle = which === 'google' && hasGoogle;
  if (box5Stars) box5Stars.style.display = showGoogle ? 'block' : 'none';
  if (boxPrivate) boxPrivate.style.display = showGoogle ? 'none' : 'block';
  if (googleAlt) googleAlt.style.display = (!showGoogle && hasGoogle) ? '' : 'none';
}

/** Atajo del link alternativo: ver el canal privado. */
export function showPrivateFeedbackBox() {
  showReviewBranch('private');
}

/** Atajo del link alternativo: ver el camino a Google. */
export function showGoogleReviewBox() {
  showReviewBranch('google');
}

/**
 * Tracks click on the official Google Review redirect button.
 * @param {Function} getSlugFn Function returning the restaurant slug
 */
export function handleGoogleReviewClick(getSlugFn = () => '') {
  fetch('/api/public/analytics/event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug: getSlugFn(), event: 'google_review_click' })
  }).catch(() => {});
}

/**
 * Submits negative or constructive feedback directly to the backend.
 * @param {Event} e Form submission event
 * @param {object} restaurantData Current restaurant data
 * @param {Function} getSlugFn Function returning current restaurant slug
 */
export async function submitPrivateFeedback(e, restaurantData = {}, getSlugFn = () => '') {
  if (e && e.preventDefault) e.preventDefault();

  const btn = document.getElementById('btnSubmitFeedback');
  const span = btn ? btn.querySelector('span') : null;
  if (btn) btn.disabled = true;
  if (span) span.textContent = '⏳ Enviando...';

  const comment = document.getElementById('feedbackCommentInput')?.value.trim();
  const customerName = document.getElementById('feedbackNameInput')?.value.trim();
  const customerContact = document.getElementById('feedbackContactInput')?.value.trim();

  if (!comment) {
    if (btn) btn.disabled = false;
    if (span) span.textContent = rt('reviewPrivateSubmit', '📩 Enviar Comentario Privado a la Gerencia');
    alert(rt('reviewNeedComment', 'Por favor escribí un comentario antes de enviar.'));
    return;
  }

  try {
    const response = await fetch('/api/reviews/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        restaurantId: restaurantData.id,
        rating: selectedStarRating,
        comment,
        customerName: customerName || 'Anónimo',
        customerContact: customerContact || ''
      })
    });

    if (response.ok) {
      const form = document.getElementById('privateFeedbackForm');
      const successMsg = document.getElementById('feedbackSuccessMessage');
      if (form) form.style.display = 'none';
      if (successMsg) successMsg.style.display = 'block';

      fetch('/api/public/analytics/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: getSlugFn(), event: 'private_feedback' })
      }).catch(() => {});
    } else {
      const data = await response.json().catch(() => ({}));
      alert(data.error || rt('reviewSendError', 'No se pudo enviar el comentario. Intentá nuevamente.'));
      if (btn) btn.disabled = false;
      if (span) span.textContent = rt('reviewPrivateSubmit', '📩 Enviar Comentario Privado a la Gerencia');
    }
  } catch (err) {
    alert(rt('reviewConnError', 'Error de conexión. Por favor, intentá nuevamente.'));
    if (btn) btn.disabled = false;
    if (span) span.textContent = rt('reviewPrivateSubmit', '📩 Enviar Comentario Privado a la Gerencia');
  }
}

/**
 * Initializes hover effect for star buttons.
 */
export function initStarHover() {
  const wrap = document.getElementById('starsSelectorWrap');
  if (!wrap) return;

  wrap.addEventListener('mouseover', e => {
    const btn = e.target.closest('.star-btn');
    if (!btn) return;
    const hoverStar = parseInt(btn.dataset.star, 10);
    document.querySelectorAll('.star-btn').forEach(b => {
      b.classList.toggle('hover-active', parseInt(b.dataset.star, 10) <= hoverStar);
    });
  });

  wrap.addEventListener('mouseout', () => {
    document.querySelectorAll('.star-btn').forEach(b => {
      b.classList.remove('hover-active');
    });
  });
}
