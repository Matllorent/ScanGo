/**
 * tests/test-ai-menu-import.js
 * Automated test suite for Gemini Flash multi-page physical menu import feature
 */

const assert = require('assert');
const { parseMenuWithGemini, sanitizeParsedMenu, getFallbackDemoMenu, MENU_RESPONSE_SCHEMA } = require('../api/services/geminiMenuParser');

async function runAiImportTests() {
  console.log('🧪 Iniciando verificación del Importador de Cartas con IA (Gemini Flash)...');

  // 1. Verify Schema structure
  assert(MENU_RESPONSE_SCHEMA.properties.detectedStyle, 'El esquema debe contener detectedStyle');
  assert(MENU_RESPONSE_SCHEMA.properties.categories, 'El esquema debe contener categories');
  assert.deepStrictEqual(MENU_RESPONSE_SCHEMA.required, ['detectedStyle', 'categories']);
  console.log('✓ Esquema JSON de Gemini Flash estructurado correctamente');

  // 2. Verify fallback demo menu
  const fallbackMenu = getFallbackDemoMenu();
  assert(fallbackMenu.detectedStyle.primaryColor, 'Debe incluir primaryColor');
  assert(fallbackMenu.detectedStyle.accentColor, 'Debe incluir accentColor');
  assert(fallbackMenu.detectedStyle.vibe, 'Debe incluir vibe');
  assert(Array.isArray(fallbackMenu.categories) && fallbackMenu.categories.length > 0, 'Debe contener categorías');
  assert(fallbackMenu.categories[0].items.length > 0, 'La categoría debe contener platos con precios');
  console.log('✓ Fallback de menú físico responde con categorías y platos estructurados');

  // 3. Verify sanitizer logic
  const dirtyData = {
    detectedStyle: {
      primaryColor: '#ff0000',
      accentColor: '#00ff00',
      vibe: '  Bodegón Tradicional Porteño  '
    },
    categories: [
      {
        name: '  Pastas Caseras  ',
        items: [
          { name: 'Ravioles de Espinaca', description: 'Con salsa bolognesa', price: '450.50' },
          { name: '', price: 100 }, // Invalid empty dish
          { name: 'Ñoquis del 29', price: 'sin precio' } // Invalid price
        ]
      },
      {
        name: 'Categoría Vacía',
        items: [] // Empty category
      }
    ]
  };

  const sanitized = sanitizeParsedMenu(dirtyData);
  assert.strictEqual(sanitized.detectedStyle.primaryColor, '#ff0000');
  assert.strictEqual(sanitized.detectedStyle.vibe, 'Bodegón Tradicional Porteño');
  assert.strictEqual(sanitized.categories.length, 1, 'Debe descartar categorías vacías');
  assert.strictEqual(sanitized.categories[0].name, 'Pastas Caseras');
  assert.strictEqual(sanitized.categories[0].items.length, 2, 'Debe descartar platos sin nombre');
  assert.strictEqual(sanitized.categories[0].items[0].price, 450.50);
  assert.strictEqual(sanitized.categories[0].items[1].price, 0, 'Precio inválido debe normalizarse a 0');
  console.log('✓ Sanitización y validación defensiva de platos, precios y estilos validada');

  // 4. Verify parseMenuWithGemini accepts multi-page array
  const samplePages = [
    { data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', mimeType: 'image/png' },
    { data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', mimeType: 'image/png' }
  ];

  const parsed = await parseMenuWithGemini(samplePages);
  assert(parsed.detectedStyle, 'El resultado debe incluir detectedStyle');
  assert(Array.isArray(parsed.categories), 'El resultado debe incluir categories');
  assert(parsed.categories.length > 0, 'Debe extraer categorías de las páginas');
  console.log(`✓ Procesamiento multi-página con ${samplePages.length} imágenes verificado exitosamente`);

  // 5. Verify router and endpoint registration
  const fs = require('fs');
  const path = require('path');
  const apiIndexSrc = fs.readFileSync(path.join(__dirname, '../api/index.js'), 'utf8');
  assert.ok(apiIndexSrc.includes("app.use('/api/ai', aiRouter)"), 'api/index.js debe montar /api/ai');
  assert.ok(apiIndexSrc.includes("app.post('/api/studio/ai-import'"), 'api/index.js debe exponer POST /api/studio/ai-import');
  assert.ok(apiIndexSrc.includes("limit: '25mb'"), 'api/index.js debe admitir payloads de hasta 25mb para imágenes');
  console.log('✓ Endpoints /api/ai y /api/studio/ai-import registrados con límite ampliado (25mb)');

  // 6. Verify Studio UI Modals and Button
  const studioHtmlSrc = fs.readFileSync(path.join(__dirname, '../public/studio.html'), 'utf8');
  assert.ok(studioHtmlSrc.includes('aiMenuImportModal'), 'studio.html debe contener el modal #aiMenuImportModal');
  assert.ok(studioHtmlSrc.includes('aiMenuPreviewModal'), 'studio.html debe contener el modal #aiMenuPreviewModal');
  assert.ok(studioHtmlSrc.includes('openAiMenuImportModal()'), 'studio.html debe contener botón para invocar openAiMenuImportModal');
  console.log('✓ Modales de carga multi-página y previsualización interactiva presentes en studio.html');

  // 7. Verify Studio ES Module and globalExports
  const studioJsSrc = fs.readFileSync(path.join(__dirname, '../public/js/studio.js'), 'utf8');
  assert.ok(studioJsSrc.includes('openAiMenuImportModal'), 'studio.js debe exportar openAiMenuImportModal');
  assert.ok(studioJsSrc.includes('runAiMenuAnalysis'), 'studio.js debe exportar runAiMenuAnalysis');
  assert.ok(studioJsSrc.includes('removeDetectedAiDish'), 'studio.js debe exportar removeDetectedAiDish');
  assert.ok(studioJsSrc.includes('confirmAiMenuImportAction'), 'studio.js debe exportar confirmAiMenuImportAction');
  console.log('✓ Funciones del importador enlazadas globalmente en studio.js');

  console.log('\n🎉 ¡TODAS LAS PRUEBAS DE IMPORTACIÓN CON GEMINI FLASH PASARON AL 100%!');
}

runAiImportTests().catch(err => {
  console.error('❌ Error en pruebas de AI menu import:', err);
  process.exit(1);
});
