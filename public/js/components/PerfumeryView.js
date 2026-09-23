/**
 * PerfumeryView.js
 * Vista alternativa y catálogo especializado para Perfumería, Fragancias de Autor y Cosmética.
 * 
 * Incluye:
 * - Filtros por Familias Olfativas (Cítrico, Floral, Amaderado, Oriental, Gourmand, Aromático)
 * - Filtros por Tipo de Concentración (EDP, EDT, EDC, Body Splash)
 * - Selector de Volumen con ajuste de precio en vivo (30ml, 50ml, 100ml)
 * - Desglose visual interactivo de Pirámide Olfativa (Salida, Corazón, Fondo)
 */

export const PERFUMERY_PRESETS = [
  {
    id: 'perfume_ambre_noir',
    categoryId: 'perfumes_nicho',
    name: 'Ambre Nuit Nocturne',
    brand: 'Maison ScanGo',
    concentration: 'EDP', // Eau de Parfum
    family: 'Oriental',
    description: 'Un viaje sensorial cálido y seductor. La rosa damascena se entrelaza con el ámbar gris brillante.',
    prices: {
      '30ml': 1450,
      '50ml': 2200,
      '100ml': 3600
    },
    defaultVolume: '50ml',
    tags: ['star', 'nicho'],
    photoUrl: 'https://images.unsplash.com/photo-1592945403244-b3fbafd7f539?w=400&q=80',
    pyramid: {
      top: ['Bergamota de Calabria', 'Pomelo Rosado', 'Pimienta Rosa'],
      heart: ['Rosa Damascena de Grasse', 'Canela de Ceilán', 'Geranio Bourbon'],
      base: ['Ámbar Gris Mítico', 'Pachulí de Indonesia', 'Cedro del Atlas', 'Vainilla Bourbon']
    }
  },
  {
    id: 'perfume_citrus_riviera',
    categoryId: 'perfumes_frescos',
    name: 'Aqua Riviera Mandarine',
    brand: 'ScanGo Fragrances',
    concentration: 'EDT', // Eau de Toilette
    family: 'Cítrico',
    description: 'Brisa fresca mediterránea en un día soleado de verano. Radiante, limpio y revitalizante.',
    prices: {
      '30ml': 1100,
      '50ml': 1750,
      '100ml': 2800
    },
    defaultVolume: '100ml',
    tags: ['vegano'],
    photoUrl: 'https://images.unsplash.com/photo-1547887537-6158d64c35b3?w=400&q=80',
    pyramid: {
      top: ['Mandarina de Sicilia', 'Limón Amalfi', 'Albahaca Genovesa'],
      heart: ['Neroli de Túnez', 'Flor de Azahar', 'Brisa Marina Salina'],
      base: ['Vetiver de Haití', 'Almizcle Blanco Suave', 'Madera Flotante']
    }
  },
  {
    id: 'perfume_santal_majeste',
    categoryId: 'perfumes_maderas',
    name: 'Santal Majestueux',
    brand: 'Atelier Botánico',
    concentration: 'EDP',
    family: 'Amaderado',
    description: 'Cremoso sándalo de Mysore con toques ahumados de cuero suave e iris empolvado.',
    prices: {
      '30ml': 1600,
      '50ml': 2400,
      '100ml': 3900
    },
    defaultVolume: '50ml',
    tags: ['star'],
    photoUrl: 'https://images.unsplash.com/photo-1523293182086-7651a899d37f?w=400&q=80',
    pyramid: {
      top: ['Cardamomo de Guatemala', 'Violeta Silvestre', 'Papiro'],
      heart: ['Iris de Florencia', 'Incienso Olibanum', 'Cuero Suave'],
      base: ['Sándalo Cremoso Australiano', 'Cedro de Virginia', 'Ámbar Cálido']
    }
  },
  {
    id: 'perfume_fleur_soie',
    categoryId: 'perfumes_florales',
    name: 'Fleur Blanche de Soie',
    brand: 'Maison ScanGo',
    concentration: 'EDP',
    family: 'Floral',
    description: 'Ramo exuberante de flores blancas nocturnas bañadas por la luz de la luna.',
    prices: {
      '30ml': 1300,
      '50ml': 1950,
      '100ml': 3200
    },
    defaultVolume: '50ml',
    tags: ['star'],
    photoUrl: 'https://images.unsplash.com/photo-1594035910387-fea47794261f?w=400&q=80',
    pyramid: {
      top: ['Pera Nashi Jugosa', 'Pimienta Rosa', 'Mandarina Verde'],
      heart: ['Jazmín Sambac Imperial', 'Tuberosa de la India', 'Flor de Naranjo'],
      base: ['Madera de Cachemira', 'Vainilla Blanca', 'Almizcle Sedoso']
    }
  },
  {
    id: 'perfume_vanille_gourmand',
    categoryId: 'perfumes_gourmand',
    name: 'Vanille Noire & Praliné',
    brand: 'Atelier Botánico',
    concentration: 'Body Splash',
    family: 'Gourmand',
    description: 'Adicción dulce y envolvente de vaina de vainilla caramelizada y café espresso recién tostado.',
    prices: {
      '30ml': 850,
      '50ml': 1250,
      '100ml': 1950
    },
    defaultVolume: '100ml',
    tags: ['star'],
    photoUrl: 'https://images.unsplash.com/photo-1588405748880-12d1d2a59f75?w=400&q=80',
    pyramid: {
      top: ['Almendra Amarga', 'Granos de Café Tostado', 'Cacao Puro'],
      heart: ['Caramelo Toffee Suave', 'Haba Tonka de Brasil', 'Heliotropo'],
      base: ['Vainilla Bourbon de Madagascar', 'Azúcar Moreno', 'Sándalo Blanco']
    }
  },
  {
    id: 'perfume_fougere_sauvage',
    categoryId: 'perfumes_aromaticos',
    name: 'Fougère Sauvage Lavande',
    brand: 'ScanGo Fragrances',
    concentration: 'EDT',
    family: 'Aromático',
    description: 'El clásico barbershop contemporáneo. Fresco, limpio, con lavanda alpina y musgo de roble.',
    prices: {
      '30ml': 1050,
      '50ml': 1650,
      '100ml': 2600
    },
    defaultVolume: '50ml',
    tags: [],
    photoUrl: 'https://images.unsplash.com/photo-1527632984437-993ac409bb62?w=400&q=80',
    pyramid: {
      top: ['Lavanda de Provenza', 'Menta Piperita', 'Romero Silvestre'],
      heart: ['Geranio Bourbon', 'Salvia Esclarea', 'Manzana Verde Crocante'],
      base: ['Musgo de Roble Húmedo', 'Haba Tonka', 'Cedro', 'Ámbar Mineral']
    }
  }
];

export class PerfumeryView {
  constructor(options = {}) {
    this.currency = options.currency || '$';
    this.onAddToCart = options.onAddToCart || (() => {});
    
    // Filtros activos
    this.activeFamily = 'ALL'; // ALL, Cítrico, Floral, Amaderado, Oriental, Gourmand, Aromático
    this.activeConcentration = 'ALL'; // ALL, EDP, EDT, Body Splash
    this.selectedVolumes = {}; // { [perfumeId]: '50ml' }
    
    // Inicializar volúmenes por defecto
    PERFUMERY_PRESETS.forEach(p => {
      this.selectedVolumes[p.id] = p.defaultVolume || '50ml';
    });
  }

  getFilteredList() {
    return PERFUMERY_PRESETS.filter(p => {
      const matchFamily = (this.activeFamily === 'ALL' || p.family === this.activeFamily);
      const matchConc = (this.activeConcentration === 'ALL' || p.concentration === this.activeConcentration);
      return matchFamily && matchConc;
    });
  }

  renderToContainer(targetElementId) {
    const container = document.getElementById(targetElementId);
    if (!container) return;

    const list = this.getFilteredList();

    const families = [
      { id: 'ALL', label: 'Todas las Familias' },
      { id: 'Cítrico', label: '🍋 Cítrico' },
      { id: 'Floral', label: '🌸 Floral' },
      { id: 'Amaderado', label: '🌲 Amaderado' },
      { id: 'Oriental', label: '🏺 Oriental / Ámbar' },
      { id: 'Gourmand', label: '🍫 Gourmand' },
      { id: 'Aromático', label: '🌿 Aromático' }
    ];

    const concentrations = [
      { id: 'ALL', label: 'Todas las Concentraciones' },
      { id: 'EDP', label: 'Eau de Parfum (EDP)' },
      { id: 'EDT', label: 'Eau de Toilette (EDT)' },
      { id: 'Body Splash', label: 'Body Splash / Bruma' }
    ];

    container.innerHTML = `
      <div class="perfumery-catalog-wrapper" style="margin-bottom: 24px;">
        
        <!-- Header de Perfumería -->
        <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--border-gold); border-radius: 14px; padding: 16px; margin-bottom: 16px; text-align: center;">
          <div style="font-size: 2rem; margin-bottom: 4px;">✨ 🌸 💎</div>
          <h2 style="font-family: var(--font-heading); font-size: 1.4rem; color: #fff; margin-bottom: 4px;">
            Colección de Perfumería & Fragancias de Autor
          </h2>
          <p style="font-size: 0.85rem; color: var(--chalk-gold); font-family: var(--font-chalk);">
            Explorá notas olfativas, acordes y presentaciones en distintos volúmenes
          </p>
        </div>

        <!-- Filtros de Familia Olfativa -->
        <div style="margin-bottom: 10px;">
          <div style="font-size: 0.78rem; font-weight: 700; color: var(--chalk-dim); margin-bottom: 6px; text-transform: uppercase;">
            Familia Olfativa:
          </div>
          <div class="category-pills" style="display: flex; gap: 6px; overflow-x: auto; padding-bottom: 4px; scrollbar-width: none;">
            ${families.map(f => `
              <button class="cat-pill ${this.activeFamily === f.id ? 'active' : ''}" 
                      onclick="window.activePerfumeryView.setFamilyFilter('${f.id}', '${targetElementId}')">
                ${f.label}
              </button>
            `).join('')}
          </div>
        </div>

        <!-- Filtros de Concentración -->
        <div style="margin-bottom: 16px;">
          <div style="font-size: 0.78rem; font-weight: 700; color: var(--chalk-dim); margin-bottom: 6px; text-transform: uppercase;">
            Tipo de Concentración:
          </div>
          <div style="display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none;">
            ${concentrations.map(c => `
              <button class="cat-pill ${this.activeConcentration === c.id ? 'active' : ''}" 
                      style="font-size: 0.76rem; padding: 4px 10px;"
                      onclick="window.activePerfumeryView.setConcentrationFilter('${c.id}', '${targetElementId}')">
                ${c.label}
              </button>
            `).join('')}
          </div>
        </div>

        <!-- Grilla de Perfumes -->
        <div class="perfumes-grid" style="display: grid; grid-template-columns: 1fr; gap: 14px;">
          ${list.map(p => this.renderPerfumeCard(p)).join('')}
        </div>

      </div>
    `;

    window.activePerfumeryView = this;
  }

  renderPerfumeCard(p) {
    const selectedVol = this.selectedVolumes[p.id] || p.defaultVolume || '50ml';
    const currentPrice = p.prices[selectedVol] || p.prices['50ml'];

    return `
      <div class="dish-card perfume-product-card" id="perfume_card_${p.id}" 
           style="background: var(--surface-card); border: 1px solid var(--border-chalk); border-radius: 14px; padding: 16px; display: flex; flex-direction: column; gap: 12px; transition: all 0.2s;">
        
        <div style="display: flex; gap: 14px; align-items: flex-start;">
          <!-- Foto o Frasco -->
          <img src="${p.photoUrl}" alt="${p.name}" 
               style="width: 88px; height: 88px; border-radius: 10px; object-fit: cover; border: 1px solid var(--border-gold); background: #16201b; flex-shrink: 0;">

          <!-- Info Principal -->
          <div style="flex: 1;">
            <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 4px;">
              <span style="font-size: 0.72rem; color: var(--chalk-gold); font-family: var(--font-mono); text-transform: uppercase; font-weight: 700;">${p.brand}</span>
              <span class="dish-badge" style="background: rgba(99, 179, 237, 0.2); color: #90CDF4; border: 1px solid rgba(99, 179, 237, 0.4);">${p.concentration}</span>
              <span class="dish-badge" style="background: rgba(236, 201, 75, 0.15); color: var(--chalk-gold);">${p.family}</span>
            </div>
            
            <h4 style="font-size: 1.1rem; color: #fff; font-family: var(--font-heading); margin-bottom: 4px;">
              ${p.name}
            </h4>

            <p style="font-size: 0.83rem; color: var(--chalk-dim); line-height: 1.35; margin-bottom: 6px;">
              ${p.description}
            </p>
          </div>
        </div>

        <!-- Selector de Volumen (30ml, 50ml, 100ml) -->
        <div style="display: flex; align-items: center; justify-content: space-between; background: rgba(0,0,0,0.25); padding: 8px 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.06);">
          <span style="font-size: 0.8rem; color: var(--chalk-muted); font-weight: 600;">Presentación:</span>
          <div style="display: flex; gap: 6px;">
            ${Object.keys(p.prices).map(vol => `
              <button type="button" 
                      class="btn-vol-pill ${selectedVol === vol ? 'active' : ''}" 
                      style="background: ${selectedVol === vol ? 'var(--chalk-gold)' : 'var(--surface-card)'}; color: ${selectedVol === vol ? '#101614' : '#fff'}; border: 1px solid ${selectedVol === vol ? 'var(--chalk-gold)' : 'var(--border-chalk)'}; border-radius: 14px; padding: 2px 10px; font-size: 0.75rem; font-weight: 700; cursor: pointer;"
                      onclick="window.activePerfumeryView.selectVolume('${p.id}', '${vol}')">
                ${vol}
              </button>
            `).join('')}
          </div>
        </div>

        <!-- Acordeón / Visualizador de Pirámide Olfativa -->
        <div class="scent-pyramid-box" style="background: rgba(236, 201, 75, 0.05); border: 1px dashed var(--border-gold); border-radius: 10px; padding: 10px 12px;">
          <div style="font-size: 0.78rem; font-weight: 700; color: var(--chalk-gold); margin-bottom: 8px; display: flex; align-items: center; gap: 6px;">
            <span>🔺 Pirámide Olfativa Detallada</span>
          </div>

          <div style="display: flex; flex-direction: column; gap: 6px; font-size: 0.8rem;">
            <!-- Salida -->
            <div style="display: flex; align-items: baseline; gap: 8px;">
              <span style="color: #68D391; font-weight: 700; font-size: 0.75rem; min-width: 60px;">🍋 Salida:</span>
              <span style="color: var(--chalk-white); font-size: 0.78rem;">${p.pyramid.top.join(' • ')}</span>
            </div>
            <!-- Corazón -->
            <div style="display: flex; align-items: baseline; gap: 8px;">
              <span style="color: #F6AD55; font-weight: 700; font-size: 0.75rem; min-width: 60px;">🌸 Corazón:</span>
              <span style="color: var(--chalk-white); font-size: 0.78rem;">${p.pyramid.heart.join(' • ')}</span>
            </div>
            <!-- Fondo -->
            <div style="display: flex; align-items: baseline; gap: 8px;">
              <span style="color: #B794F4; font-weight: 700; font-size: 0.75rem; min-width: 60px;">🪵 Fondo:</span>
              <span style="color: var(--chalk-white); font-size: 0.78rem;">${p.pyramid.base.join(' • ')}</span>
            </div>
          </div>
        </div>

        <!-- Precio y Botón Agregar -->
        <div style="display: flex; align-items: center; justify-content: space-between; border-top: 1px solid var(--border-chalk); padding-top: 10px; margin-top: 2px;">
          <div>
            <div style="font-size: 0.72rem; color: var(--chalk-dim);">Precio (${selectedVol}):</div>
            <div class="dish-price" style="font-family: var(--font-mono); font-size: 1.25rem; font-weight: 700; color: var(--chalk-gold);">
              ${this.currency} ${currentPrice}
            </div>
          </div>

          <button class="btn-wa-submit" 
                  style="width: auto; padding: 8px 16px; font-size: 0.88rem; background: var(--chalk-green); color: #0E1412; gap: 6px;"
                  onclick="window.activePerfumeryView.addToCart('${p.id}')">
            <span>+ Agregar Frasco</span>
          </button>
        </div>

      </div>
    `;
  }

  selectVolume(perfumeId, vol) {
    this.selectedVolumes[perfumeId] = vol;
    // Volver a renderizar la tarjeta o actualizar precio
    const card = document.getElementById(`perfume_card_${perfumeId}`);
    if (card) {
      const p = PERFUMERY_PRESETS.find(item => item.id === perfumeId);
      if (p) {
        card.outerHTML = this.renderPerfumeCard(p);
      }
    }
  }

  setFamilyFilter(family, targetElementId) {
    this.activeFamily = family;
    this.renderToContainer(targetElementId);
  }

  setConcentrationFilter(concentration, targetElementId) {
    this.activeConcentration = concentration;
    this.renderToContainer(targetElementId);
  }

  addToCart(perfumeId) {
    const p = PERFUMERY_PRESETS.find(item => item.id === perfumeId);
    if (!p) return;

    const vol = this.selectedVolumes[perfumeId] || p.defaultVolume || '50ml';
    const price = p.prices[vol] || p.prices['50ml'];

    const dishItem = {
      id: `perfume_${p.id}_${vol}`,
      categoryId: p.categoryId,
      name: `${p.name} (${p.concentration}) [${vol}]`,
      price: price,
      description: `Familia: ${p.family} • Salida: ${p.pyramid.top.slice(0,2).join(', ')} • Corazón: ${p.pyramid.heart.slice(0,2).join(', ')}`,
      photoUrl: p.photoUrl,
      tags: ['star']
    };

    this.onAddToCart(dishItem);
  }
}
