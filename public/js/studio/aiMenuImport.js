/**
 * public/js/studio/aiMenuImport.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Multi-page physical menu AI importer using Gemini Flash
 * Handles multi-file uploads, thumbnail reordering/deletion, multimodal API call,
 * and structured preview & confirmation before applying to the restaurant menu.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { state } from './state.js';

let selectedPages = []; // Array of { id, file, dataUrl, base64, mimeType, name }
let parsedResult = null; // Store result from AI { detectedStyle, categories }

/**
 * Opens the AI Menu Import Modal
 */
export function openAiMenuImportModal() {
  const modal = document.getElementById('aiMenuImportModal');
  if (!modal) return;
  modal.classList.add('active');
  resetAiImportState();
}

/**
 * Closes the AI Menu Import Modal
 */
export function closeAiMenuImportModal() {
  const modal = document.getElementById('aiMenuImportModal');
  if (modal) modal.classList.remove('active');
  resetAiImportState();
}

/**
 * Resets upload state and UI elements
 */
function resetAiImportState() {
  selectedPages = [];
  parsedResult = null;
  const list = document.getElementById('aiMenuPagesList');
  if (list) list.innerHTML = '';
  const dropzone = document.getElementById('aiMenuDropzone');
  if (dropzone) dropzone.style.display = 'block';
  const previewContainer = document.getElementById('aiMenuPreviewContainer');
  if (previewContainer) previewContainer.style.display = 'none';
  const loading = document.getElementById('aiMenuLoadingState');
  if (loading) loading.style.display = 'none';
  const btnRun = document.getElementById('btnRunAiMenuImport');
  if (btnRun) {
    btnRun.disabled = true;
    btnRun.innerHTML = '✨ Analizar y Crear Carta con IA';
  }
  const fileInput = document.getElementById('aiMenuFilesInput');
  if (fileInput) fileInput.value = '';
}

/**
 * Handles files selected via input or drop
 */
export async function handleAiMenuFiles(files) {
  if (!files || files.length === 0) return;

  const validFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
  if (validFiles.length === 0) {
    alert('Por favor selecciona únicamente archivos de imagen (JPEG, PNG, WEBP).');
    return;
  }

  if (selectedPages.length + validFiles.length > 10) {
    alert('Puedes subir hasta un máximo de 10 páginas de menú por análisis.');
    return;
  }

  for (const file of validFiles) {
    try {
      const { dataUrl, base64, mimeType } = await processAndCompressImage(file);
      selectedPages.push({
        id: 'page_' + Math.random().toString(36).substr(2, 9),
        file,
        dataUrl,
        base64,
        mimeType,
        name: file.name
      });
    } catch (e) {
      console.error('[AI-IMPORT] Error procesando imagen:', e);
    }
  }

  renderAiMenuPages();
}

/**
 * Compresses/resizes image if necessary to prevent oversized payloads
 */
function processAndCompressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const maxDim = 1600;
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        const mimeType = 'image/jpeg';
        const dataUrl = canvas.toDataURL(mimeType, 0.85);
        const base64 = dataUrl.split(';base64,')[1];
        resolve({ dataUrl, base64, mimeType });
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Renders thumbnail gallery of selected pages
 */
export function renderAiMenuPages() {
  const list = document.getElementById('aiMenuPagesList');
  const dropzone = document.getElementById('aiMenuDropzone');
  const previewContainer = document.getElementById('aiMenuPreviewContainer');
  const btnRun = document.getElementById('btnRunAiMenuImport');
  const pagesCountBadge = document.getElementById('aiMenuPagesCount');

  if (!list) return;

  if (selectedPages.length === 0) {
    if (previewContainer) previewContainer.style.display = 'none';
    if (btnRun) btnRun.disabled = true;
    return;
  }

  if (previewContainer) previewContainer.style.display = 'block';
  if (pagesCountBadge) pagesCountBadge.textContent = `${selectedPages.length} página${selectedPages.length > 1 ? 's' : ''}`;
  if (btnRun) btnRun.disabled = false;

  list.innerHTML = selectedPages.map((page, index) => `
    <div class="ai-page-card" style="position:relative; background:var(--surface-2); border:1px solid var(--border); border-radius:8px; overflow:hidden; display:flex; flex-direction:column; width:130px; box-shadow:0 2px 6px rgba(0,0,0,0.3);">
      <div style="position:relative; width:100%; height:130px; background:#000;">
        <img src="${page.dataUrl}" alt="Página ${index + 1}" style="width:100%; height:100%; object-fit:cover;">
        <span style="position:absolute; top:6px; left:6px; background:rgba(0,0,0,0.75); color:var(--accent-gold); font-size:10px; font-weight:700; padding:2px 6px; border-radius:4px; border:1px solid rgba(236,201,75,0.4);">
          Pág. ${index + 1}
        </span>
        <button type="button" onclick="window.removeAiMenuPage(${index})" title="Eliminar página" style="position:absolute; top:6px; right:6px; background:#e53e3e; color:#fff; border:none; border-radius:50%; width:22px; height:22px; cursor:pointer; font-size:11px; display:flex; align-items:center; justify-content:center;">
          ✕
        </button>
      </div>
      <div style="padding:6px; display:flex; justify-content:space-between; align-items:center; background:var(--bg-base);">
        <button type="button" class="btn-nav" style="padding:2px 6px; font-size:10px;" onclick="window.moveAiMenuPage(${index}, -1)" ${index === 0 ? 'disabled' : ''} title="Mover a la izquierda">
          ◀
        </button>
        <span style="font-size:9px; color:var(--text-dim); text-overflow:ellipsis; overflow:hidden; white-space:nowrap; max-width:60px;">
          ${page.name}
        </span>
        <button type="button" class="btn-nav" style="padding:2px 6px; font-size:10px;" onclick="window.moveAiMenuPage(${index}, 1)" ${index === selectedPages.length - 1 ? 'disabled' : ''} title="Mover a la derecha">
          ▶
        </button>
      </div>
    </div>
  `).join('');
}

/**
 * Reorders a page in the array
 */
export function moveAiMenuPage(index, direction) {
  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= selectedPages.length) return;
  const temp = selectedPages[index];
  selectedPages[index] = selectedPages[targetIndex];
  selectedPages[targetIndex] = temp;
  renderAiMenuPages();
}

/**
 * Removes a page from the array
 */
export function removeAiMenuPage(index) {
  selectedPages.splice(index, 1);
  renderAiMenuPages();
}

/**
 * Sends pages to Gemini Flash backend endpoint
 */
export async function runAiMenuAnalysis() {
  if (selectedPages.length === 0) {
    alert('Por favor agrega al menos una imagen de tu menú.');
    return;
  }

  const btnRun = document.getElementById('btnRunAiMenuImport');
  const loading = document.getElementById('aiMenuLoadingState');
  const loadingText = document.getElementById('aiMenuLoadingText');

  if (btnRun) {
    btnRun.disabled = true;
    btnRun.innerHTML = '⏳ Procesando...';
  }
  if (loading) loading.style.display = 'flex';

  const updateStatus = (text) => {
    if (loadingText) loadingText.textContent = text;
  };

  updateStatus(`Enviando ${selectedPages.length} página${selectedPages.length > 1 ? 's' : ''} a Gemini Flash...`);

  try {
    const payload = {
      images: selectedPages.map(p => ({
        data: p.base64,
        mimeType: p.mimeType
      }))
    };

    const token = localStorage.getItem('menu_pizarron_token') || localStorage.getItem('scango_token');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    updateStatus('Gemini Flash está analizando platos, categorías y precios...');

    const res = await fetch('/api/studio/ai-import', {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.error || 'No se pudo procesar la carta con IA');
    }

    parsedResult = data.data || data;

    // Close import modal and open preview modal
    closeAiMenuImportModal();
    openAiMenuPreviewModal(parsedResult);
  } catch (err) {
    console.error('[AI-IMPORT-ERROR]', err);
    alert(`Error al procesar la carta: ${err.message || 'Error de conexión'}`);
    if (btnRun) {
      btnRun.disabled = false;
      btnRun.innerHTML = '✨ Analizar y Crear Carta con IA';
    }
    if (loading) loading.style.display = 'none';
  }
}

/**
 * Opens confirmation and preview modal
 */
export function openAiMenuPreviewModal(result) {
  const modal = document.getElementById('aiMenuPreviewModal');
  if (!modal) return;

  const styleBox = document.getElementById('aiPreviewStyleBox');
  const statsBox = document.getElementById('aiPreviewStats');
  const categoriesList = document.getElementById('aiPreviewCategoriesList');

  // Render detected style
  if (styleBox && result.detectedStyle) {
    const { primaryColor, accentColor, vibe } = result.detectedStyle;
    styleBox.innerHTML = `
      <div style="display:flex; align-items:center; gap:12px; background:var(--bg-base); padding:10px 14px; border-radius:8px; border:1px solid var(--border);">
        <div style="display:flex; gap:6px;">
          <span style="width:24px; height:24px; border-radius:50%; background:${primaryColor || '#1F2937'}; border:1px solid rgba(255,255,255,0.3); display:inline-block;" title="Color primario: ${primaryColor}"></span>
          <span style="width:24px; height:24px; border-radius:50%; background:${accentColor || '#ECC94B'}; border:1px solid rgba(255,255,255,0.3); display:inline-block;" title="Color de acento: ${accentColor}"></span>
        </div>
        <div>
          <div style="font-size:12px; font-weight:700; color:#fff;">Estilo Sugerido: <span style="color:var(--accent-gold);">${vibe || 'Bistró Moderno'}</span></div>
          <div style="font-size:10px; color:var(--text-dim);">Primario: <code>${primaryColor}</code> | Acento: <code>${accentColor}</code></div>
        </div>
      </div>
    `;
  }

  // Count total dishes
  let totalDishes = 0;
  if (Array.isArray(result.categories)) {
    result.categories.forEach(c => {
      totalDishes += (c.items ? c.items.length : 0);
    });
  }

  if (statsBox) {
    statsBox.textContent = `Se detectaron ${result.categories?.length || 0} categorías y ${totalDishes} platos en total.`;
  }

  // Render categories and dishes preview
  if (categoriesList && Array.isArray(result.categories)) {
    categoriesList.innerHTML = result.categories.map((cat, cIdx) => `
      <div style="background:var(--bg-base); border:1px solid var(--border); border-radius:8px; padding:10px 12px; margin-bottom:8px;">
        <div style="font-size:12px; font-weight:700; color:var(--accent-gold); margin-bottom:6px; display:flex; justify-content:space-between;">
          <span>📁 ${cat.name}</span>
          <span style="font-size:10px; color:var(--text-dim);">${cat.items?.length || 0} platos</span>
        </div>
        <div style="display:flex; flex-direction:column; gap:4px; max-height:160px; overflow-y:auto;">
          ${(cat.items || []).map(item => `
            <div style="display:flex; justify-content:space-between; align-items:baseline; font-size:11px; padding:3px 0; border-bottom:1px dashed rgba(255,255,255,0.06);">
              <div style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:70%;">
                <strong style="color:#fff;">${item.name}</strong>
                ${item.description ? `<span style="color:var(--text-dim); font-size:10px; display:block; text-overflow:ellipsis; overflow:hidden;">${item.description}</span>` : ''}
              </div>
              <span style="color:#68D391; font-weight:700; font-family:var(--font-mono); white-space:nowrap;">
                $ ${item.price.toFixed(2)}
              </span>
            </div>
          `).join('')}
        </div>
      </div>
    `).join('');
  }

  modal.classList.add('active');
}

/**
 * Closes confirmation and preview modal
 */
export function closeAiMenuPreviewModal() {
  const modal = document.getElementById('aiMenuPreviewModal');
  if (modal) modal.classList.remove('active');
}

/**
 * Confirms and commits the AI extracted menu to state.restaurant
 */
export function confirmAiMenuImport(callbacks = {}) {
  if (!parsedResult || !Array.isArray(parsedResult.categories)) {
    alert('No hay datos válidos para importar.');
    return;
  }

  const { renderDishesList, populateCatFilter, triggerAutoSave, updateLiveState } = callbacks;

  const replaceMode = document.querySelector('input[name="aiImportMode"]:checked')?.value === 'replace';
  const applyStyle = document.getElementById('aiApplyStyleCheckbox')?.checked;

  if (!state.restaurant) state.restaurant = {};
  if (!Array.isArray(state.restaurant.categories)) state.restaurant.categories = [];
  if (!Array.isArray(state.restaurant.dishes)) state.restaurant.dishes = [];

  if (replaceMode) {
    // Clear existing
    state.restaurant.categories = [];
    state.restaurant.dishes = [];
  }

  let addedDishesCount = 0;

  parsedResult.categories.forEach((cat) => {
    // Check if category already exists (case-insensitive)
    let existingCat = state.restaurant.categories.find(
      c => c.name.trim().toLowerCase() === cat.name.trim().toLowerCase()
    );

    if (!existingCat) {
      existingCat = {
        id: 'cat_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
        name: cat.name.trim()
      };
      state.restaurant.categories.push(existingCat);
    }

    if (Array.isArray(cat.items)) {
      cat.items.forEach((item) => {
        const newDish = {
          id: 'd_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
          categoryId: existingCat.id,
          name: item.name.trim(),
          description: item.description ? item.description.trim() : '',
          price: item.price || 0,
          originalPrice: null,
          photoUrl: null,
          outOfStock: false,
          isChefSpecial: false,
          weatherTags: [],
          tags: []
        };
        state.restaurant.dishes.push(newDish);
        addedDishesCount++;
      });
    }
  });

  // Apply style / theme if requested
  if (applyStyle && parsedResult.detectedStyle) {
    const vibeLower = (parsedResult.detectedStyle.vibe || '').toLowerCase();
    if (vibeLower.includes('rústic') || vibeLower.includes('asador') || vibeLower.includes('parrilla')) {
      state.restaurant.theme = 'rustic';
    } else if (vibeLower.includes('taquer')) {
      state.restaurant.theme = 'taqueria';
    } else if (vibeLower.includes('bar') || vibeLower.includes('nocturn')) {
      state.restaurant.theme = 'bar';
    } else if (vibeLower.includes('café') || vibeLower.includes('modern')) {
      state.restaurant.theme = 'moderna';
    } else if (vibeLower.includes('burger') || vibeLower.includes('truck')) {
      state.restaurant.theme = 'foodtruck';
    }

    const selectTheme = document.getElementById('inputThemeBg');
    if (selectTheme && state.restaurant.theme) {
      selectTheme.value = state.restaurant.theme;
    }
  }

  // Close preview modal
  closeAiMenuPreviewModal();

  // Refresh Studio UI
  if (typeof populateCatFilter === 'function') populateCatFilter();
  if (typeof renderDishesList === 'function') renderDishesList();
  if (typeof updateLiveState === 'function') updateLiveState();
  if (typeof triggerAutoSave === 'function') triggerAutoSave();

  alert(`¡Menú importado con éxito! Se cargaron ${addedDishesCount} platos en ${state.restaurant.categories.length} categorías.`);
}
