/**
 * public/js/menu/smartReviews.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Smart Google Reviews & Feedback Filter
 * Bifurcates reviews: 5 stars redirect to Google Maps, 1-4 stars open a private
 * feedback form submitted to /api/reviews/feedback to protect public reputation.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export let selectedStarRating = 0;

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
  if (successMsg) successMsg.style.display = 'none';
  if (hintText) hintText.textContent = 'Tocá las estrellas para calificar';

  document.querySelectorAll('.star-btn').forEach(btn => btn.classList.remove('active', 'hover-active'));

  if (nameEl) nameEl.textContent = restaurantData.name || 'nuestro local';
  if (googleBtn) googleBtn.href = restaurantData.googleReview || '#';

  if (form) {
    form.reset();
    form.style.display = 'block';
  }
  if (submitBtn) {
    submitBtn.disabled = false;
    const span = submitBtn.querySelector('span');
    if (span) span.textContent = '📩 Enviar Comentario Privado a la Gerencia';
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
 * @param {number} rating Selected rating 1-5
 */
export function handleStarSelect(rating) {
  selectedStarRating = rating;

  document.querySelectorAll('.star-btn').forEach(btn => {
    const star = parseInt(btn.dataset.star, 10);
    btn.classList.toggle('active', star <= rating);
  });

  const hintTexts = ['', '😞 Muy mala', '😕 Regular', '🙂 Buena', '😊 Muy buena', '🤩 ¡Excelente!'];
  const hintText = document.getElementById('starHintText');
  if (hintText) hintText.textContent = hintTexts[rating] || '';

  const box5Stars = document.getElementById('review5StarsBox');
  const boxPrivate = document.getElementById('reviewPrivateFeedbackBox');

  if (rating === 5) {
    if (box5Stars) box5Stars.style.display = 'block';
    if (boxPrivate) boxPrivate.style.display = 'none';
  } else {
    if (box5Stars) box5Stars.style.display = 'none';
    if (boxPrivate) boxPrivate.style.display = 'block';
  }
}

/**
 * Tracks click on the official Google Review redirect button.
 * @param {Function} getSlugFn Function returning the restaurant slug
 */
export function handleGoogleReviewClick(getSlugFn = () => '') {
  fetch('/api/analytics/event', {
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
    if (span) span.textContent = '📩 Enviar Comentario Privado a la Gerencia';
    alert('Por favor escribí un comentario antes de enviar.');
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

      fetch('/api/analytics/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: getSlugFn(), event: 'private_feedback' })
      }).catch(() => {});
    } else {
      const data = await response.json().catch(() => ({}));
      alert(data.error || 'No se pudo enviar el comentario. Intentá nuevamente.');
      if (btn) btn.disabled = false;
      if (span) span.textContent = '📩 Enviar Comentario Privado a la Gerencia';
    }
  } catch (err) {
    alert('Error de conexión. Por favor, intentá nuevamente.');
    if (btn) btn.disabled = false;
    if (span) span.textContent = '📩 Enviar Comentario Privado a la Gerencia';
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
