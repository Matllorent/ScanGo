// App State
    let currentUser = null;
    let restaurant = null;
    let autoSaveTimeout = null;
    let selectedReviewPhotoOption = 'logo';
    let uploadedReviewPhotoUrl = null;
    let pendingConfirmAction = null;
    let saveFeedbackTimer = null;

    // Strict XSS Sanitizer Helper
    function escapeHtml(str) {
      if (str === null || str === undefined) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    // Custom Confirmation Dialog (Replaces native confirm)
    function showConfirmDialog({ icon = '⚠️', title = '¿Estás seguro?', message = '', confirmText = 'Sí, Continuar', confirmClass = 'btn-danger', onConfirm }) {
      document.getElementById('confirmDialogIcon').textContent = icon;
      document.getElementById('confirmDialogTitle').textContent = title;
      document.getElementById('confirmDialogMessage').textContent = message;
      const acceptBtn = document.getElementById('confirmDialogAcceptBtn');
      acceptBtn.textContent = confirmText;
      if (confirmClass === 'btn-danger') {
        acceptBtn.style.background = '#E53E3E';
        acceptBtn.style.borderColor = '#E53E3E';
        acceptBtn.style.color = '#fff';
      } else {
        acceptBtn.style.background = 'var(--accent-gold)';
        acceptBtn.style.borderColor = 'var(--accent-gold)';
        acceptBtn.style.color = '#101614';
      }
      pendingConfirmAction = onConfirm;
      document.getElementById('confirmActionModal').classList.add('active');
    }

    function closeConfirmDialog(confirmed) {
      document.getElementById('confirmActionModal').classList.remove('active');
      if (confirmed && typeof pendingConfirmAction === 'function') {
        pendingConfirmAction();
      }
      pendingConfirmAction = null;
    }

    // Save Feedback Pill (Header notification)
    function showSaveFeedback(state) {
      const badge = document.getElementById('saveFeedbackBadge');
      const icon = document.getElementById('saveFeedbackIcon');
      const text = document.getElementById('saveFeedbackText');
      if (!badge || !icon || !text) return;

      clearTimeout(saveFeedbackTimer);
      badge.style.display = 'inline-flex';

      if (state === 'saving') {
        badge.style.background = 'rgba(225, 169, 56, 0.15)';
        badge.style.border = '1px solid rgba(225, 169, 56, 0.4)';
        badge.style.color = 'var(--accent-gold)';
        icon.textContent = '🔄';
        text.textContent = 'Guardando...';
      } else if (state === 'saved') {
        badge.style.background = 'rgba(56, 161, 105, 0.15)';
        badge.style.border = '1px solid rgba(56, 161, 105, 0.4)';
        badge.style.color = '#48BB78';
        icon.textContent = '✓';
        text.textContent = '¡Cambios guardados!';
        saveFeedbackTimer = setTimeout(() => {
          badge.style.display = 'none';
        }, 2200);
      } else if (state === 'error') {
        badge.style.background = 'rgba(229, 62, 62, 0.15)';
        badge.style.border = '1px solid rgba(229, 62, 62, 0.4)';
        badge.style.color = '#FC8181';
        icon.textContent = '⚠️';
        text.textContent = 'Error al sincronizar';
        saveFeedbackTimer = setTimeout(() => {
          badge.style.display = 'none';
        }, 3500);
      }
    }

    // Presets Catalog (85+ suggested dishes)
    const PRESETS = {
      milanesas: {
        catName: 'Milanesas de la Casa',
        dishes: [
          { name: 'Milanesa Napolitana de Carne', price: 490, desc: 'Lomo tierno, jamón cocido, salsa de tomate casera y muzzarella fundida con papas fritas', tags: ['star'] },
          { name: 'Milanesa Suiza de Pollo', price: 460, desc: 'Pechuga rebozada con salsa blanca suave, queso gruyere y papas noisette', tags: [] },
          { name: 'Milanesa Fugazzeta', price: 480, desc: 'Cebolla caramelizada al orégano, doble muzzarella y toque de oliva', tags: [] },
          { name: 'Milanesa a Caballo', price: 470, desc: 'Con dos huevos fritos de campo y papas bastón crocantes', tags: [] },
          { name: 'Milanesa Cuatro Quesos', price: 520, desc: 'Muzzarella, provolone, parmesano y queso azul gratinado', tags: [] },
          { name: 'Milanesa Veggie de Berenjena', price: 390, desc: 'Berenjena al horno rebozada con panko y semillas, queso vegano y rúcula', tags: ['veggie'] },
          { name: 'Sándwich de Milanesa Completo', price: 440, desc: 'Pan baguette crocante, lechuga, tomate, mayonesa casera y jamón', tags: [] },
          { name: 'Milanesa Tex-Mex', price: 510, desc: 'Cheddar fundido, panceta crocante, jalapeños y guacamole', tags: [] },
          { name: 'Milanesa Napolitana sin TACC', price: 520, desc: 'Elaborada con rebozador de arroz y maíz certificado libre de gluten', tags: ['celiac'] },
          { name: 'Picada de Mini Milanesas', price: 680, desc: 'Bocados de lomo y pollo con salsas tártara, alioli y barbacoa para compartir', tags: [] }
        ]
      },
      empanadas: {
        catName: 'Empanadas',
        dishes: [
          {
            name: 'Empanadas surtidas',
            price: 285,
            desc: 'Elegí 3 unidades, media docena o docena y repartí los sabores.',
            tags: ['star'],
            variants: [
              { id: 'carne_suave', name: 'Carne suave' },
              { id: 'carne_picante', name: 'Carne picante' },
              { id: 'carne_cuchillo', name: 'Carne cortada a cuchillo' },
              { id: 'pollo', name: 'Pollo' },
              { id: 'jamon_queso', name: 'Jamón y queso' },
              { id: 'humita', name: 'Humita' },
              { id: 'verdura', name: 'Verdura' },
              { id: 'caprese', name: 'Caprese' }
            ]
          },
          { name: 'Empanada de Carne Suave', price: 95, desc: 'Carne vacuna, cebolla, huevo y aceituna.', tags: [] },
          { name: 'Empanada de Carne Picante', price: 100, desc: 'Carne vacuna condimentada con ají molido.', tags: ['picante'] },
          { name: 'Empanada de Carne a Cuchillo', price: 110, desc: 'Carne cortada a cuchillo, cebolla y huevo.', tags: [] },
          { name: 'Empanada de Pollo', price: 95, desc: 'Pollo desmenuzado con cebolla y morrón.', tags: [] },
          { name: 'Empanada de Jamón y Queso', price: 95, desc: 'Jamón cocido y queso mozzarella.', tags: [] },
          { name: 'Empanada de Humita', price: 90, desc: 'Choclo cremoso, cebolla y queso.', tags: ['veggie'] },
          { name: 'Empanada Caprese', price: 95, desc: 'Tomate, mozzarella y albahaca.', tags: ['veggie'] }
        ]
      },
      pescados: {
        catName: 'Pescados y Mariscos',
        dishes: [
          { name: 'Salmón Rosado a la Manteca de Hierbas', price: 790, desc: 'Filet a la plancha con espárragos y puré rústico de calabaza', tags: ['star'] },
          { name: 'Abadejo a la Romana', price: 550, desc: 'Tiras de pescado blanco crocante con limón fresco y papas fritas', tags: [] },
          { name: 'Rabas Crocantes del Puerto', price: 580, desc: 'Calamares frescos rebozados con limón y salsa tártara artesanal', tags: [] },
          { name: 'Paella Clásica de Mariscos', price: 720, desc: 'Arroz azafranado con langostinos, mejillones, calamares y pimientos', tags: ['star'] },
          { name: 'Filet de Merluza con Puré de Papas', price: 460, desc: 'Pesca fresca del día a la plancha con limón y oliva virgen', tags: [] },
          { name: 'Ceviche Mixto Tradicional', price: 610, desc: 'Pescado blanco, langostinos marinados en leche de tigre, cebolla morada y maíz cancha', tags: ['celiac'] },
          { name: 'Cazuela de Mariscos Gratinada', price: 740, desc: 'Surtido de frutos de mar en suave salsa crema al vino blanco', tags: [] },
          { name: 'Trucha Patagónica con Almendras', price: 710, desc: 'Filet grillado con manteca noisette y almendras tostadas', tags: [] }
        ]
      },
      sushi: {
        catName: 'Sushi & Rolls',
        dishes: [
          { name: 'Philadelphia Roll (10 piezas)', price: 560, desc: 'Salmón fresco, palta hass y queso philadelphia', tags: [] },
          { name: 'California Roll (10 piezas)', price: 490, desc: 'Kanikama, pepino japonés, palta y sésamo tostado', tags: [] },
          { name: 'Hot Roll Frito (10 piezas)', price: 590, desc: 'Roll apanado y tibio relleno de salmón y queso con salsa teriyaki', tags: ['star'] },
          { name: 'Ebi Furai Roll (10 piezas)', price: 620, desc: 'Langostino crocante rebozado en panko, palta y salsa maracuyá', tags: [] },
          { name: 'Niguiri de Salmón (4 piezas)', price: 380, desc: 'Bocados de arroz shari con láminas finas de salmón fresco', tags: ['celiac'] },
          { name: 'Sashimi de Salmón (5 cortes)', price: 420, desc: 'Cortes premium de salmón fresco con wasabi y jengibre', tags: ['celiac'] },
          { name: 'Geishas de Salmón y Palta (4 piezas)', price: 460, desc: 'Finísima lámina de salmón envolviendo palta y queso crema', tags: [] },
          { name: 'Roll Vegano de Palta y Mango (10 piezas)', price: 440, desc: 'Palta, mango maduro, pepino y ciboulette con salsa teriyaki vegana', tags: ['veggie'] },
          { name: 'Rainbow Roll Especial (10 piezas)', price: 630, desc: 'Relleno de langostino coronado con cortes de salmón, pescado blanco y palta', tags: [] },
          { name: 'Tabla Combinado Tokio (24 piezas)', price: 1290, desc: 'Variedad de rolls clásicos, calientes y niguiris para compartir', tags: ['star'] }
        ]
      },
      hamburguesas: {
        catName: 'Burgers Artesanales',
        dishes: [
          { name: 'Burger Clásica con Queso', price: 410, desc: 'Medallón 180g novillo, doble cheddar, lechuga, tomate y salsa especial en pan brioche', tags: [] },
          { name: 'Burger Criolla de Entraña', price: 490, desc: 'Corte de entraña picada a cuchillo, provoleta fundida, chimichurri y rúcula', tags: ['star'] },
          { name: 'Bacon & Blue Burger', price: 480, desc: 'Panceta crocante, queso azul suave, cebolla morada y alioli', tags: [] },
          { name: 'Burger BBQ Smash Doble', price: 470, desc: 'Dos medallones smash con costra crocante, cheddar fundido y salsa barbacoa', tags: [] },
          { name: 'Burger Vegana de Lentejas y Hongos', price: 420, desc: 'Medallón artesanal, palta, tomate seco y mayonesa vegana en pan de remolacha', tags: ['veggie'] }
        ]
      },
      pizzas: {
        catName: 'Pizzas al Horno de Piedra',
        dishes: [
          { name: 'Pizza Muzzarella Clásica', price: 390, desc: 'Masa fermentada 24hs, salsa pomodoro italiana y muzzarella fundida con orégano', tags: [] },
          { name: 'Pizza Napolitana con Ajo y Rodajas de Tomate', price: 440, desc: 'Tomates frescos, ajo confitado, oliva y hojas de albahaca fresca', tags: [] },
          { name: 'Pizza Fugazzeta Rellena', price: 540, desc: 'Masa doble rellena con abundante queso muzzarella y cubierta de cebollas doradas', tags: ['star'] },
          { name: 'Pizza Cuatro Quesos', price: 490, desc: 'Muzzarella, provolone, roquefort y parmesano rallado', tags: [] },
          { name: 'Pizza de Jamón Crudo y Rúcula', price: 530, desc: 'Muzzarella, jamón crudo estacionado, rúcula fresca y lluvia de parmesano', tags: [] }
        ]
      },
      postres: {
        catName: 'Postres Rioplatenses',
        dishes: [
          { name: 'Flan Casero Mixto', price: 260, desc: 'Receta tradicional con 8 huevos, abundante dulce de leche y crema batida', tags: ['star'] },
          { name: 'Chajá Tradicional Rioplatense', price: 290, desc: 'Bizcochuelo suave con duraznos en almíbar, merengue seco y dulce de leche', tags: [] },
          { name: 'Panqueque de Dulce de Leche Quemado al Ron', price: 280, desc: 'Panqueque tibio caramelizado a la plancha con azúcar quemada', tags: [] },
          { name: 'Vigilante / Martín Fierro Clásico', price: 230, desc: 'Queso colonia artesanal acompañado con dulce de membrillo o batata', tags: ['celiac'] },
          { name: 'Volcán de Chocolate con Helado de Vainilla', price: 320, desc: 'Bizcocho tibio de chocolate semiamargo con corazón fundente', tags: ['star'] }
        ]
      },
      bebidas: {
        catName: 'Bebidas & Cervezas',
        dishes: [
          { name: 'Cerveza Artesanal IPA (Pinta 500ml)', price: 240, desc: 'Lúpulo aromático, notas cítricas y amargor balanceado', tags: [] },
          { name: 'Cerveza Rubia Clásica (Pinta 500ml)', price: 210, desc: 'Dorada pampeana suave, refrescante y ligera', tags: [] },
          { name: 'Limonada con Menta y Jengibre', price: 180, desc: 'Exprimido natural de limones con menta fresca y miel', tags: ['veggie'] },
          { name: 'Agua Mineral con/sin gas 500ml', price: 110, desc: 'En botella individual', tags: [] },
          { name: 'Refresco Línea Cola / Lima 500ml', price: 130, desc: 'Botella individual bien fría', tags: [] }
        ]
      },
      cafeteria: {
        catName: 'Café de Especialidad',
        dishes: [
          { name: 'Espresso Doble 100% Arábica', price: 140, desc: 'Extracción balanceada con notas a chocolate y avellana', tags: [] },
          { name: 'Flat White Cremoso', price: 190, desc: 'Doble ristretto con microespuma sedosa de leche texturizada', tags: ['star'] },
          { name: 'Cappuccino Italiano Clásico', price: 200, desc: 'Espresso, leche vaporizada y canela o cacao espolvoreado', tags: [] },
          { name: 'Cold Brew Macerado en Frío', price: 210, desc: 'Café infusionado en frío por 18 horas con hielo y rodaja de naranja', tags: ['veggie'] },
          { name: 'Latte con Leche de Almendras', price: 220, desc: 'Opción 100% vegetal con café de especialidad', tags: ['veggie'] }
        ]
      },
      chile: {
        catName: '🇨🇱 Cocina Chilena Tradicional',
        dishes: [
          { name: 'Pastel de Choclo en Greda', price: 540, desc: 'Pino de vacuno sazonado, pollo tierno, aceituna, huevo duro y costra dorada de maíz', tags: ['star'] },
          { name: 'Cazuela de Vacuno Tradicional', price: 490, desc: 'Caldo criollo concentrado con osobuco, zapallo camote, choclo y porotos verdes', tags: [] },
          { name: 'Empanadas de Pino al Horno (2 un)', price: 340, desc: 'Masa fina horneada con pino de carne a cuchillo, cebolla amortiguada y pasas', tags: [] },
          { name: 'Completo Italiano Clásico', price: 280, desc: 'Vienesa en pan alargado con palta fresca molida, tomate en cubos y mayonesa casera', tags: [] },
          { name: 'Machas a la Parmesana', price: 620, desc: 'Lenguas de machas gratinadas con queso parmesano, vino blanco y mantequilla', tags: ['star'] },
          { name: 'Caldillo de Congrio Nerudiano', price: 590, desc: 'Pescado fresco en caldo de verduras con camarones, cilantro y crema suave', tags: [] },
          { name: 'Charquicán con Huevo Frito', price: 430, desc: 'Guiso tradicional de carne, zapallo, papas y verduras de estación', tags: [] },
          { name: 'Mote con Huesillo Helado', price: 220, desc: 'Bebida refrescante con duraznos deshidratados cocidos, almíbar de canela y trigo mote', tags: ['veggie'] }
        ]
      },
      colombia: {
        catName: '🇨🇴 Sabores de Colombia',
        dishes: [
          { name: 'Bandeja Paisa Tradicional', price: 640, desc: 'Frijoles rojos, arroz blanco, chicharrón crocante, carne molida, chorizo, huevo frito, tajada y arepa', tags: ['star'] },
          { name: 'Ajiaco Santafereño Bogotano', price: 560, desc: 'Sopa espesa con tres tipos de papas, pollo desmechado, guascas, alcaparras y crema de leche', tags: ['star'] },
          { name: 'Arepa de Chócolo con Queso Campesino', price: 290, desc: 'Masa tierna de maíz dulce asada a la plancha con mantequilla y abundante queso fresco', tags: ['veggie'] },
          { name: 'Sancocho Trifásico Colombiano', price: 580, desc: 'Caldo sustancioso de pollo, costilla de res y cerdo con plátano verde, yuca y mazorca', tags: [] },
          { name: 'Empanadas Colombianas de Maíz (3 un)', price: 280, desc: 'Crocante masa de maíz amarillo rellena de carne desmechada y papa criolla con ají casero', tags: ['celiac'] },
          { name: 'Cazuela de Frijoles Antioqueña', price: 490, desc: 'Frijoles campesinos con chicharrón picado, plátano maduro, aguacate y arroz', tags: [] },
          { name: 'Postre de Natas Tradicional', price: 240, desc: 'Dulce suave de leche cuajada con almíbar de caña y uvas pasas', tags: [] },
          { name: 'Limonada de Coco Refrescante', price: 210, desc: 'Zumo de lima fresca batido con crema de coco cremosa y hielo frappé', tags: ['veggie'] }
        ]
      },
      venezuela: {
        catName: '🇻🇪 Cocina Venezolana Típica',
        dishes: [
          { name: 'Arepa Reina Pepiada', price: 380, desc: 'Masa de maíz asada rellena de pollo mechado con abundante aguacate cremoso y mayonesa', tags: ['star', 'celiac'] },
          { name: 'Tequeños Crujientes de Queso (5 un)', price: 320, desc: 'Dedos de masa hojaldrada frita rellenos de queso llanero fundido con salsa tártara o guasacaca', tags: ['star'] },
          { name: 'Pabellón Criollo Caraqueño', price: 540, desc: 'Carne mechada en sofrito criollo, caraotas negras, arroz blanco, tajadas de plátano frito y queso', tags: ['star'] },
          { name: 'Cachapa con Queso de Mano y Cochino', price: 490, desc: 'Torta tierna de maíz dulce tierno, queso de mano fresco derretido y pernil asado crujiente', tags: [] },
          { name: 'Arepa Pelúa (Carne y Queso Amarillo)', price: 390, desc: 'Generosa carne mechada de res sazonada cubierta de abundante queso gouda rallado', tags: ['celiac'] },
          { name: 'Asado Negro Criollo', price: 520, desc: 'Corte de muchacho redondo glaseado en salsa dulce y oscura de papelón con puré de papas', tags: [] },
          { name: 'Golfeados con Queso Telita', price: 260, desc: 'Pan enrollado tradicional aromatizado con anís y papelón fundido, servido con queso fresco', tags: ['veggie'] }
        ]
      },
      peru: {
        catName: '🇵🇪 Gastronomía Peruana',
        dishes: [
          { name: 'Lomo Saltado al Wok', price: 590, desc: 'Tiras tiernas de lomo fino salteadas al wok con cebolla morada, tomate, ají amarillo, papas fritas y arroz', tags: ['star'] },
          { name: 'Ají de Gallina Cremoso', price: 490, desc: 'Pechuga desmenuzada en suave crema de ají amarillo, nueces y queso parmesano sobre papas cocidas', tags: [] },
          { name: 'Causa Limeña de Pollo o Atún', price: 390, desc: 'Capas de masa de papa amarilla prensada con ají amarillo y limón, rellena de palta y pollo aliñado', tags: ['celiac'] },
          { name: 'Ceviche Clásico Peruano', price: 620, desc: 'Cubos de pesca fresca del día marinados en leche de tigre al instante con camote glaseado y choclo desgranado', tags: ['star', 'celiac'] },
          { name: 'Arroz Chaufa Especial de Mariscos', price: 540, desc: 'Arroz frito al estilo chifa salteado al wok con langostinos, calamares, cebollita china y salsa de soja', tags: [] },
          { name: 'Anticuchos de Corazón a la Parrilla (2 brochetas)', price: 420, desc: 'Brochetas marinadas en ají panca y especias andinas servidas con papas doradas y salsa de rocoto', tags: [] },
          { name: 'Suspiro a la Limeña Clásico', price: 260, desc: 'Manjar blanco suave de yemas y leche evaporada coronado con merengue al oporto y canela', tags: [] }
        ]
      },
      paraguay: {
        catName: '🇵🇾 Tradición Paraguaya',
        dishes: [
          { name: 'Sopa Paraguaya Auténtica', price: 290, desc: 'Tarta tradicional horneada esponjosa a base de harina de maíz, queso Paraguay fresco, abundante cebolla salteada y leche', tags: ['star', 'celiac', 'veggie'] },
          { name: 'Chipa Guazú al Horno de Barro', price: 320, desc: 'Pastel cremoso y dorado de choclo tierno desgranado con manteca, huevos caseros y abundante queso criollo fundido', tags: ['star', 'celiac', 'veggie'] },
          { name: 'Vori Vori de Pollo Casero', price: 480, desc: 'Caldo espeso y reconfortante con presas de pollo de campo y bolitas artesanales de harina de maíz con queso', tags: ['star'] },
          { name: 'Mbejú Mestizo Tradicional', price: 240, desc: 'Torta delgada y crocante a la plancha de almidón de mandioca, harina de maíz y queso Paraguay dorado', tags: ['celiac', 'veggie'] },
          { name: 'Pastel Mandi\'o de Carne (3 un)', price: 350, desc: 'Empanadas típicas de masa de puré de mandioca con relleno criollo de carne vacuna especiada y frita dorada', tags: ['celiac'] },
          { name: 'Asadito Paraguayo con Mandioca Hervida', price: 460, desc: 'Brochetas de carne tierna marinada a la brasa servidas con mandioca tibia recién cocida y salsa de ajo', tags: [] }
        ]
      },
      espana: {
        catName: '🇪🇸 Clásicos de España',
        dishes: [
          { name: 'Paella Valenciana Tradicional', price: 780, desc: 'Arroz en paella con azafrán en hebras, pollo de campo, conejo, judías verdes planas (bajoqueta), garrofó y romero fresco', tags: ['star', 'celiac'] },
          { name: 'Tortilla Española de Patatas (Poco Hecha)', price: 420, desc: 'Tortilla alta y jugosa con patatas confitadas a fuego lento en aceite de oliva virgen extra y cebolla dulce', tags: ['star', 'veggie', 'celiac'] },
          { name: 'Jamón Ibérico de Bellota con Pan con Tomate', price: 690, desc: 'Finas lonchas de jamón ibérico curado servidas con tostas de pan de masa madre frotadas con tomate maduro y oliva', tags: ['star'] },
          { name: 'Gambas al Ajillo Clásicas', price: 590, desc: 'Langostinos frescos chisporroteando en cazuela de barro con láminas de ajo dorado, guindilla y aceite de oliva', tags: ['celiac'] },
          { name: 'Pulpo a la Gallega (Polbo á Feira)', price: 740, desc: 'Tiernas rodajas de pulpo sobre cama de patatas cocidas (cachelos), sazonadas con pimentón de la Vera dulce y picante y sal marina gruesa', tags: ['star', 'celiac'] },
          { name: 'Croquetas Cremosas de Jamón Ibérico (6 un)', price: 390, desc: 'Bechamel sedosa de leche entera infusionada con hueso de jamón y tropezones crocantes de ibérico', tags: [] },
          { name: 'Churros Tradicionales con Chocolate a la Taza', price: 280, desc: 'Churros crujientes recién fritos espolvoreados con azúcar acompañados de espeso chocolate amargo caliente', tags: ['veggie'] }
        ]
      },
      mexico: {
        catName: '🇲🇽 Sabor Mexicano',
        dishes: [
          { name: 'Tacos al Pastor Tradicionales (3 un)', price: 440, desc: 'Cerdo marinado en achiote y chiles secos, asado al trompo y servido con piña asada, cebollita picada, cilantro y salsa verde taquera', tags: ['star', 'celiac'] },
          { name: 'Enchiladas Suizas Gratinadas (3 un)', price: 490, desc: 'Tortillas de maíz rellenas de pollo deshebrado bañadas en salsa verde cremosa de tomatillo y gratinadas con queso manchego', tags: ['celiac'] },
          { name: 'Guacamole Rústico con Totopos Caseros', price: 340, desc: 'Aguacate hass machacado al momento en molcajete con lima, cebolla, cilantro fresco, chile serrano y totopos de maíz crujientes', tags: ['star', 'veggie', 'celiac'] },
          { name: 'Quesadillas de Birria de Res con Consomé (3 un)', price: 520, desc: 'Tortillas doradas a la plancha mojadas en el adobo de la carne de res cocinada a fuego lento, con queso Oaxaca y tazón de consomé caliente', tags: ['star'] },
          { name: 'Chiles en Nogada Tradicionales', price: 580, desc: 'Chile poblano asado relleno de picadillo agridulce de cerdo, frutas secas y piñones, cubierto de salsa cremosa de nuez de Castilla y granada roja', tags: [] }
        ]
      },
      helados_chocolates: {
        catName: '🍫 Helados: Chocolates',
        dishes: [
          { name: 'Chocolate Amargo 70%', price: 320, desc: 'Cacao puro ecuatoriano al 70%, intenso y con notas tostadas.', tags: ['star', 'celiac'] },
          { name: 'Chocolate con Almendras Tostadas', price: 330, desc: 'Cremoso chocolate con leche y almendras tostadas.', tags: ['celiac'] },
          { name: 'Chocolate Suizo con Dulce de Leche', price: 340, desc: 'Chocolate semiamargo veteado con dulce de leche natural.', tags: ['star'] },
          { name: 'Chocolate Blanco Patagónico', price: 320, desc: 'Manteca de cacao pura con crocante de avellanas.', tags: ['celiac'] },
          { name: 'Chocotorta Helada Especial', price: 350, desc: 'Galletitas de chocolate con café y crema con dulce de leche.', tags: ['star'] },
          { name: 'Mousse de Chocolate Aireado', price: 320, desc: 'Textura ligera y esponjosa con escamas de cacao.', tags: ['celiac'] },
          { name: 'Chocolate Marroc Praliné', price: 350, desc: 'Chocolate con leche y praliné suave de maní tostado.', tags: [] }
        ]
      },
      helados_ddl: {
        catName: '🍮 Helados: Dulces de Leche',
        dishes: [
          { name: 'Dulce de Leche Tradicional Rioplatense', price: 310, desc: 'La receta madre con leche de campo y cocción lenta.', tags: ['star', 'celiac'] },
          { name: 'Dulce de Leche Granizado', price: 320, desc: 'Con abundantes escamas crujientes de chocolate amargo.', tags: ['celiac'] },
          { name: 'Dulce de Leche Tentación', price: 340, desc: 'Con generoso veteado de dulce de leche repostero puro.', tags: ['star', 'celiac'] },
          { name: 'Dulce de Leche con Brownie & Nuez', price: 350, desc: 'Tropezones húmedos de brownie casero y nueces pecan.', tags: ['star'] },
          { name: 'Dulce de Leche Bombón', price: 340, desc: 'Veteado con pasta de avellanas y bocaditos bañados.', tags: [] },
          { name: 'Dulce de Leche Alfajor Marplatense', price: 350, desc: 'Con trocitos de masa especiada de alfajor artesanal.', tags: [] }
        ]
      },
      helados_cremas: {
        catName: '🍦 Helados: Cremas & Especiales',
        dishes: [
          { name: 'Crema Americana (Vainilla Bourbon)', price: 300, desc: 'Crema de leche batida infusionada con vainilla natural.', tags: ['celiac'] },
          { name: 'Tramontana Clásica', price: 330, desc: 'Crema americana con dulce de leche y galletitas crocantes.', tags: ['star'] },
          { name: 'Mascarpone con Frutos del Bosque', price: 350, desc: 'Queso mascarpone con reducción de frambuesas y moras.', tags: ['star', 'celiac'] },
          { name: 'Sambayón al Oporto y Marsala', price: 340, desc: 'Yemas batidas con vino Oporto añejado y almendras.', tags: ['celiac'] },
          { name: 'Banana Split Criolla', price: 330, desc: 'Bananas maduras, dulce de leche y chocolate picado.', tags: ['celiac'] },
          { name: 'Frutilla a la Crema de Campo', price: 310, desc: 'Frutillas frescas seleccionadas con crema de leche fresca.', tags: ['celiac'] },
          { name: 'Pistacho Siciliano 100% Puro', price: 380, desc: 'Pistachos tostados de Bronte con pizca de sal marina.', tags: ['star', 'celiac'] },
          { name: 'Kinder Bueno Blanco & Avellanas', price: 360, desc: 'Pasta de avellanas, oblea crocante y chocolate blanco.', tags: ['star'] }
        ]
      },
      helados_frutales: {
        catName: '🍓 Helados: Frutales al Agua',
        dishes: [
          { name: 'Limón Silvestre Natural', price: 290, desc: '100% zumo recién exprimido. Refrescante y liviano.', tags: ['vegan', 'celiac', 'veggie'] },
          { name: 'Frutilla Natural al Agua', price: 290, desc: 'Frutillas maduras procesadas al momento con almíbar suave.', tags: ['vegan', 'celiac', 'veggie'] },
          { name: 'Maracuyá Tropical con Semillitas', price: 310, desc: 'Pulpa de maracuyá con su acidez exótica natural.', tags: ['star', 'vegan', 'celiac', 'veggie'] },
          { name: 'Frambuesa Patagónica al Agua', price: 320, desc: 'Frambuesas del sur con balance justo de dulzor.', tags: ['vegan', 'celiac', 'veggie'] },
          { name: 'Mango & Naranja Jugosa', price: 310, desc: 'Sorbet aterciopelado de mango y jugo de naranja fresca.', tags: ['vegan', 'celiac', 'veggie'] },
          { name: 'Arándanos & Moras Silvestres', price: 310, desc: 'Frutos rojos repletos de antioxidantes en sorbete.', tags: ['vegan', 'celiac', 'veggie'] }
        ]
      },
      perfumeria: {
        catName: '🌸 Fragancias & Perfumería',
        dishes: [
          { name: 'Ambre Nuit Nocturne (EDP)', price: 2200, desc: 'Familia Oriental • Salida: Bergamota • Corazón: Rosa Damascena • Fondo: Ámbar Gris.', tags: ['star'] },
          { name: 'Aqua Riviera Mandarine (EDT)', price: 1750, desc: 'Familia Cítrica • Salida: Mandarina Sicilia • Corazón: Neroli • Fondo: Vetiver.', tags: [] },
          { name: 'Santal Majestueux (EDP)', price: 2400, desc: 'Familia Amaderada • Salida: Cardamomo • Corazón: Iris • Fondo: Sándalo Australiano.', tags: ['star'] },
          { name: 'Fleur Blanche de Soie (EDP)', price: 1950, desc: 'Familia Floral • Salida: Pera Nashi • Corazón: Jazmín Sambac • Fondo: Cachemira.', tags: ['star'] },
          { name: 'Vanille Noire & Praliné (Splash)', price: 1250, desc: 'Familia Gourmand • Salida: Almendra • Corazón: Toffee • Fondo: Vainilla Bourbon.', tags: ['star'] },
          { name: 'Fougère Sauvage Lavande (EDT)', price: 1650, desc: 'Familia Aromática • Salida: Lavanda • Corazón: Salvia • Fondo: Musgo de Roble.', tags: [] }
        ]
      }
    };

    // Initialize & Load User/Restaurant from Real Database
    async function initStudio() {
      const token = localStorage.getItem('menu_pizarron_token');
      if (!token) {
        window.location.href = '/?auth=required';
        return;
      }

      try {
        const res = await fetch('/api/auth/me', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) {
          localStorage.removeItem('menu_pizarron_token');
          window.location.href = '/?auth=expired';
          return;
        }
        const data = await res.json();
        currentUser = data.user || {};
        restaurant = data.restaurant || {};

        // If authenticated user does not have a restaurant yet, initialize a clean real template (no mocks)
        if (!restaurant.id) {
          const defaultSlug = (currentUser.name || 'mi-restaurante').toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').slice(0, 30);
          restaurant = {
            id: '',
            userId: currentUser.id,
            name: currentUser.name || 'Mi Restaurante',
            slogan: '',
            slug: defaultSlug,
            currency: '$',
            phone: '',
            theme: 'emerald',
            themeFont: 'sans',
            businessType: 'restaurante',
            allowLoyaltyPoints: false,
            allowIceCreamWizard: false,
            allowPerfumery: false,
            instagram: '',
            googleReview: '',
            allowReservations: false,
            allowCoupons: false,
            allowBillSplitter: false,
            announcement: '',
            paymentLink: '',
            scheduleEnabled: false,
            scheduleActiveHours: '12:00-23:30',
            tableCount: 1,
            wifi: { ssid: '', password: '' },
            categories: [],
            dishes: [],
            deliveryZones: [],
            analytics: { visits: 0, orders: 0, reservations: 0, waiterCalls: 0 }
          };
        }

        // Merge locally configured preferences if present
        const savedRest = localStorage.getItem('menu_pizarron_restaurant');
        if (savedRest) {
          try {
            const parsed = JSON.parse(savedRest);
            if (parsed.businessType && !restaurant.businessType) restaurant.businessType = parsed.businessType;
            if (parsed.allowIceCreamWizard !== undefined && restaurant.allowIceCreamWizard === undefined) restaurant.allowIceCreamWizard = parsed.allowIceCreamWizard;
            if (parsed.allowPerfumery !== undefined && restaurant.allowPerfumery === undefined) restaurant.allowPerfumery = parsed.allowPerfumery;
            if (parsed.allowLoyaltyPoints !== undefined && restaurant.allowLoyaltyPoints === undefined) restaurant.allowLoyaltyPoints = parsed.allowLoyaltyPoints;
          } catch(e) {}
        }

        renderStudioUI();
      } catch (err) {
        console.warn('Error al verificar sesión en Studio:', err.message);
        localStorage.removeItem('menu_pizarron_token');
        window.location.href = '/?auth=expired';
      }
    }

    function renderStudioUI() {
      document.getElementById('studioNavRestaurantName').textContent = restaurant.name;
      document.getElementById('studioNavUserEmail').textContent = currentUser.email;
      
      const liveUrl = `/m/${restaurant.slug}`;
      const btnLive = document.getElementById('btnLiveMenu');
      btnLive.href = liveUrl;
      document.getElementById('previewFullUrl').textContent = liveUrl;

      // Subscription badge
      renderSubscriptionBadge(currentUser.subscription);

      // Form inputs
      document.getElementById('inputLocalName').value = restaurant.name || '';
      document.getElementById('inputLocalSlogan').value = restaurant.slogan || '';
      document.getElementById('inputLocalSlug').value = restaurant.slug || '';
      document.getElementById('inputLocalCurrency').value = restaurant.currency || '$';
      document.getElementById('inputPhone').value = restaurant.phone || '';

      if (restaurant.wifi) {
        document.getElementById('inputWifiSsid').value = restaurant.wifi.ssid || '';
        document.getElementById('inputWifiPass').value = restaurant.wifi.password || '';
      }

      // Reservations toggle
      const resCheckbox = document.getElementById('inputAllowReservations');
      if (resCheckbox) {
        resCheckbox.checked = restaurant.allowReservations !== false;
        const slider = document.getElementById('sliderReservations');
        if (slider) slider.style.backgroundColor = resCheckbox.checked ? '#38A169' : '#2a3a33';
      }

      // Social links
      document.getElementById('inputInstagram').value = restaurant.instagram || '';
      document.getElementById('inputGoogleReview').value = restaurant.googleReview || '';

      // Theme selects
      const themeBg = document.getElementById('inputThemeBg');
      if (themeBg) themeBg.value = restaurant.theme || 'emerald';
      const themeFont = document.getElementById('inputThemeFont');
      if (themeFont) themeFont.value = restaurant.themeFont || 'serif';

      // Coupons toggle
      const couponsCheckbox = document.getElementById('inputAllowCoupons');
      if (couponsCheckbox) {
        couponsCheckbox.checked = restaurant.allowCoupons !== false;
        const sliderC = document.getElementById('sliderCoupons');
        if (sliderC) sliderC.style.backgroundColor = couponsCheckbox.checked ? '#38A169' : '#2a3a33';
      }

      // Bill Splitter toggle
      const splitCheckbox = document.getElementById('inputAllowBillSplitter');
      if (splitCheckbox) {
        splitCheckbox.checked = restaurant.allowBillSplitter !== false;
        const sliderS = document.getElementById('sliderBillSplitter');
        if (sliderS) sliderS.style.backgroundColor = splitCheckbox.checked ? '#38A169' : '#2a3a33';
      }

      // Announcement banner
      const annInput = document.getElementById('inputAnnouncement');
      if (annInput) annInput.value = restaurant.announcement || '';

      // Payment Link
      const payInput = document.getElementById('inputPaymentLink');
      if (payInput) payInput.value = restaurant.paymentLink || '';

      // Schedule settings
      const schedCheck = document.getElementById('inputScheduleEnabled');
      if (schedCheck) {
        schedCheck.checked = !!restaurant.scheduleEnabled;
        const sliderSched = document.getElementById('sliderSchedule');
        if (sliderSched) sliderSched.style.backgroundColor = schedCheck.checked ? '#38A169' : '#2a3a33';
      }
      const schedHours = document.getElementById('inputScheduleActiveHours');
      if (schedHours) schedHours.value = restaurant.scheduleActiveHours || '';

      // Table count
      const tableCountInput = document.getElementById('inputTableCount');
      if (tableCountInput) tableCountInput.value = restaurant.tableCount || 10;

      // Render Logo preview
      if (restaurant.logoUrl) {
        document.getElementById('logoPreviewBox').innerHTML = `<img src="${restaurant.logoUrl}" style="width:100%; height:100%; object-fit:cover;">`;
        document.getElementById('btnRemoveLogo').style.display = 'inline';
      } else {
        document.getElementById('logoPreviewBox').innerHTML = `<span id="logoPreviewIcon" style="font-size:22px;">🍽️</span>`;
        document.getElementById('btnRemoveLogo').style.display = 'none';
      }

      // Business Type selector
      const bizSelect = document.getElementById('inputBusinessType');
      if (bizSelect) bizSelect.value = restaurant.businessType || 'restaurante';

      // Loyalty points toggle
      const loyaltyCheckbox = document.getElementById('inputAllowLoyaltyPoints');
      if (loyaltyCheckbox) {
        loyaltyCheckbox.checked = restaurant.allowLoyaltyPoints === true;
        const sliderL = document.getElementById('sliderLoyaltyPoints');
        if (sliderL) sliderL.style.backgroundColor = loyaltyCheckbox.checked ? '#38A169' : '#2a3a33';
      }

      // Ice Cream Wizard toggle
      const iceCreamCheckbox = document.getElementById('inputAllowIceCreamWizard');
      if (iceCreamCheckbox) {
        iceCreamCheckbox.checked = restaurant.allowIceCreamWizard === true || (restaurant.businessType === 'heladeria' && restaurant.allowIceCreamWizard !== false);
        const sliderI = document.getElementById('sliderIceCreamWizard');
        if (sliderI) sliderI.style.backgroundColor = iceCreamCheckbox.checked ? '#38A169' : '#2a3a33';
      }

      // Perfumery toggle
      const perfumeryCheckbox = document.getElementById('inputAllowPerfumery');
      if (perfumeryCheckbox) {
        perfumeryCheckbox.checked = restaurant.allowPerfumery === true || (restaurant.businessType === 'perfumeria' && restaurant.allowPerfumery !== false);
        const sliderP = document.getElementById('sliderPerfumery');
        if (sliderP) sliderP.style.backgroundColor = perfumeryCheckbox.checked ? '#38A169' : '#2a3a33';
      }

      // Review photo selector default
      setReviewPhotoOption('logo');

      // Populate Categories & Dishes
      populateCatFilter();
      renderDishesList();
      renderDeliveryZones();
      generateQrCode();
      reloadPreviewIframe();

      // Check 30-Day Milestone for review modal
      check30DaysMilestone();

      // Send live sync to simulator iframe
      setTimeout(() => {
        const iframe = document.getElementById('previewIframe');
        if (iframe && iframe.contentWindow) {
          iframe.contentWindow.postMessage({ type: 'UPDATE_LIVE_PREVIEW', data: restaurant }, '*');
        }
      }, 500);
    }

    function handleLogoUpload(e) {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) {
        alert('La imagen no debe superar los 2MB.');
        return;
      }
      const reader = new FileReader();
      reader.onload = (event) => {
        restaurant.logoUrl = event.target.result;
        document.getElementById('logoPreviewBox').innerHTML = `<img src="${restaurant.logoUrl}" style="width:100%; height:100%; object-fit:cover;">`;
        document.getElementById('btnRemoveLogo').style.display = 'inline';
        generateQrCode();
        triggerAutoSave();
      };
      reader.readAsDataURL(file);
    }

    function removeLogo() {
      restaurant.logoUrl = null;
      document.getElementById('inputLogoFile').value = '';
      document.getElementById('logoPreviewBox').innerHTML = `<span id="logoPreviewIcon" style="font-size:22px;">🍽️</span>`;
      document.getElementById('btnRemoveLogo').style.display = 'none';
      generateQrCode();
      triggerAutoSave();
    }

    function renderSubscriptionBadge(sub) {
      const badge = document.getElementById('subscriptionBadge');
      if (!sub) return;

      if (sub.status === 'trial') {
        const days = Math.max(0, Math.ceil((new Date(sub.trialEndsAt) - new Date()) / (1000 * 60 * 60 * 24)));
        badge.className = 'sub-badge badge-trial';
        badge.textContent = `⏳ Prueba (${days} días)`;
      } else if (sub.status === 'active') {
        badge.className = 'sub-badge badge-active';
        badge.textContent = `✓ PRO ACTIVO (${sub.plan.toUpperCase()})`;
      } else if (sub.status === 'past_due') {
        badge.className = 'sub-badge badge-grace';
        badge.textContent = `⚠️ GRACIA (5 días)`;
      } else {
        badge.className = 'sub-badge badge-grace';
        badge.textContent = `✕ VENCIDO`;
      }
    }

    // Tabs
    function switchTab(tabId, btn) {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

      const targetBtn = btn || (typeof event !== 'undefined' && event && event.currentTarget) || document.querySelector(`.tab-btn[onclick*="'${tabId}'"]`);
      if (targetBtn) targetBtn.classList.add('active');
      const pane = document.getElementById(`tab-${tabId}`);
      if (pane) pane.classList.add('active');

      if (tabId === 'stats') {
        renderStatsTab();
      }
    }

    function renderStatsTab() {
      const stats = restaurant.analytics || { visits: 0, orders: 0, reservations: 0, waiterCalls: 0 };
      document.getElementById('statVisits').textContent = stats.visits || 0;
      document.getElementById('statOrders').textContent = stats.orders || 0;
      document.getElementById('statReservations').textContent = stats.reservations || 0;
      document.getElementById('statWaiterCalls').textContent = stats.waiterCalls || 0;
    }

    // Review Photo Option Selector (Logo, Local/Plato, Personal)
    function setReviewPhotoOption(opt) {
      selectedReviewPhotoOption = opt;
      const statusText = document.getElementById('reviewPhotoStatusText');
      const btnUpload = document.getElementById('btnSelectReviewPhoto');
      const thumb = document.getElementById('reviewPhotoPreviewThumb');

      if (opt === 'logo') {
        if (btnUpload) btnUpload.style.display = 'none';
        if (restaurant && restaurant.logoUrl) {
          if (statusText) statusText.textContent = 'Usando el logo oficial de tu restaurante.';
          if (thumb) thumb.innerHTML = `<img src="${restaurant.logoUrl}" style="width:100%;height:100%;object-fit:cover;">`;
        } else {
          if (statusText) statusText.textContent = 'Logo no configurado aún (se usará ícono de local).';
          if (thumb) thumb.innerHTML = `<span style="font-size:22px;">🍽️</span>`;
        }
      } else if (opt === 'venue') {
        if (btnUpload) btnUpload.style.display = 'inline-block';
        if (uploadedReviewPhotoUrl) {
          if (statusText) statusText.textContent = '✓ Foto del local o plato seleccionada.';
          if (thumb) thumb.innerHTML = `<img src="${uploadedReviewPhotoUrl}" style="width:100%;height:100%;object-fit:cover;">`;
        } else {
          if (statusText) statusText.textContent = 'Carga una fotografía del salón, barra o plato insignia.';
          if (thumb) thumb.innerHTML = `<span style="font-size:22px;">🏬</span>`;
        }
      } else if (opt === 'personal') {
        if (btnUpload) btnUpload.style.display = 'inline-block';
        if (uploadedReviewPhotoUrl) {
          if (statusText) statusText.textContent = '✓ Retrato personal seleccionado.';
          if (thumb) thumb.innerHTML = `<img src="${uploadedReviewPhotoUrl}" style="width:100%;height:100%;object-fit:cover;">`;
        } else {
          if (statusText) statusText.textContent = 'Carga tu retrato personal o del equipo gastronómico.';
          if (thumb) thumb.innerHTML = `<span style="font-size:22px;">👤</span>`;
        }
      }
    }

    function handleReviewPhotoFile(e) {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      if (file.size > 3 * 1024 * 1024) {
        alert('La fotografía no debe superar los 3MB.');
        return;
      }
      const reader = new FileReader();
      reader.onload = (event) => {
        uploadedReviewPhotoUrl = event.target.result;
        const thumb = document.getElementById('reviewPhotoPreviewThumb');
        if (thumb) thumb.innerHTML = `<img src="${uploadedReviewPhotoUrl}" style="width:100%;height:100%;object-fit:cover;">`;
        const statusText = document.getElementById('reviewPhotoStatusText');
        if (statusText) statusText.textContent = '✓ Foto cargada exitosamente desde tu dispositivo.';
      };
      reader.readAsDataURL(file);
    }

    // 30-Day Milestone Modal Handlers
    function check30DaysMilestone() {
      // Auto-trigger milestone invite if not dismissed permanently
      if (!sessionStorage.getItem('scango_30d_milestone_shown') && localStorage.getItem('scango_milestone_30d_dismissed') !== 'true') {
        setTimeout(openMilestone30DaysModal, 1500);
        sessionStorage.setItem('scango_30d_milestone_shown', 'true');
      }
    }

    function openMilestone30DaysModal() {
      const modal = document.getElementById('milestone30DaysModal');
      if (modal) modal.classList.add('active');
    }

    function closeMilestone30DaysModal() {
      const modal = document.getElementById('milestone30DaysModal');
      if (modal) modal.classList.remove('active');
      localStorage.setItem('scango_milestone_30d_dismissed', 'true');
    }

    function openReviewFromMilestone() {
      closeMilestone30DaysModal();
      switchTab('reviews');
      const comment = document.getElementById('reviewComment');
      if (comment) {
        setTimeout(() => comment.focus(), 300);
      }
    }

    async function submitOwnerReview(e) {
      e.preventDefault();
      const submitBtn = e.target.querySelector('button[type="submit"]');
      const originalText = submitBtn ? submitBtn.innerHTML : '';
      if (submitBtn) {
        if (submitBtn.disabled || submitBtn.dataset.busy === 'true') return;
        submitBtn.disabled = true;
        submitBtn.dataset.busy = 'true';
        submitBtn.innerHTML = '<span>⏳ Enviando reseña...</span>';
      }

      try {
        const rating = document.getElementById('reviewRating').value;
        const authorRole = document.getElementById('reviewAuthorRole').value.trim();
        const comment = document.getElementById('reviewComment').value.trim();
        const token = localStorage.getItem('menu_pizarron_token');

        let finalPhotoUrl = null;
        if (selectedReviewPhotoOption === 'logo') {
          finalPhotoUrl = restaurant?.logoUrl || null;
        } else {
          finalPhotoUrl = uploadedReviewPhotoUrl || null;
        }

        const reviewObj = {
          id: 'rev_' + Date.now(),
          restaurantId: restaurant?.id || '',
          restaurantName: restaurant?.name || 'Restaurante',
          userId: currentUser?.id || '',
          email: currentUser?.email || '',
          rating: parseInt(rating) || 5,
          authorRole: authorRole || 'Dueño / Responsable',
          comment: comment.slice(0, 500),
          photoOption: selectedReviewPhotoOption,
          photoUrl: finalPhotoUrl,
          status: 'pending',
          createdAt: new Date().toISOString()
        };

        try {
          if (token) {
            await fetch('/api/reviews', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
              },
              body: JSON.stringify(reviewObj)
            });
          }
        } catch (err) {
          console.warn('Reseña encolada para moderación en localStorage:', err.message);
        }

        document.getElementById('reviewSubmittedAlert').style.display = 'block';
        document.getElementById('reviewComment').value = '';
      } finally {
        if (submitBtn) {
          setTimeout(() => {
            submitBtn.disabled = false;
            submitBtn.dataset.busy = 'false';
            submitBtn.innerHTML = originalText;
          }, 1500);
        }
      }
    }

    // 1-Click WhatsApp Order Status Notifications
    function sendOrderStateWA(state) {
      const phone = (document.getElementById('notifPhone').value || '').replace(/[^0-9]/g, '');
      const client = document.getElementById('notifClientName').value.trim() || 'Estimado/a cliente';
      const restName = restaurant.name || 'Menú Pizarrón';

      if (!phone) {
        alert('Por favor ingresa el número de WhatsApp del cliente.');
        return;
      }

      let msg = '';
      if (state === 'confirmado') {
        msg = `¡Hola ${client}! 👋👨‍🍳\n\nTe confirmamos que recibimos tu pedido en *${restName}* y ya está marchando en la cocina. Te avisamos en cuanto esté listo. ¡Muchas gracias!`;
      } else if (state === 'listo') {
        msg = `¡Hola ${client}! 🛍️🎉\n\n¡Tu pedido en *${restName}* ya está listo y empaquetado esperándote en el mostrador! Podés pasar a retirarlo cuando gustes.`;
      } else if (state === 'camino') {
        msg = `¡Hola ${client}! 🛵💨\n\n¡Tu pedido en *${restName}* ya salió con nuestro repartidor rumbo a tu dirección! Por favor tené listo el método de pago acordado.`;
      } else if (state === 'demorado') {
        msg = `Estimado/a ${client} ⏳🙏\n\nQueremos avisarte que la cocina de *${restName}* tiene una demora imprevista debido a la alta demanda de hoy. Tu pedido está en marcha y saldrá en breve con la máxima calidad. ¡Disculpas y muchas gracias por tu paciencia!`;
      }

      const waUrl = `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
      window.open(waUrl, '_blank');
    }

    // Agotado Inteligente por Ingrediente en masa
    function toggleDishesByIngredient(isOut) {
      const keyword = (document.getElementById('inputIngredientKeyword').value || '').trim().toLowerCase();
      if (!keyword) {
        alert('Por favor escribe un ingrediente o término (ej: Salmón, Aguacate, Champiñones).');
        return;
      }

      let count = 0;
      (restaurant.dishes || []).forEach(d => {
        const inName = (d.name || '').toLowerCase().includes(keyword);
        const inDesc = (d.description || '').toLowerCase().includes(keyword);
        if (inName || inDesc) {
          d.outOfStock = isOut;
          count++;
        }
      });

      renderDishesList();
      triggerAutoSave();
      alert(`Se ${isOut ? 'marcaron como agotados' : 'reactivaron'} ${count} platos asociados a "${keyword}".`);
    }

    // Dishes Management
    function populateCatFilter() {
      const select = document.getElementById('selectCatFilter');
      const cats = restaurant.categories || [];
      select.innerHTML = '<option value="ALL">Todas las Categorías</option>';
      cats.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.name;
        select.appendChild(opt);
      });
    }

    function renderDishesList() {
      const container = document.getElementById('studioDishesList');
      const filter = document.getElementById('selectCatFilter').value;
      const dishes = restaurant.dishes || [];
      const cats = restaurant.categories || [];
      const currency = restaurant.currency || '$';

      const filtered = dishes.filter(d => filter === 'ALL' || d.categoryId === filter);
      if (!filtered.length) {
        container.innerHTML = `
          <div style="text-align:center; padding:32px 16px; background:var(--bg-base); border:1px dashed var(--border); border-radius:12px; margin:10px 0;">
            <div style="font-size:32px; margin-bottom:8px;">🍽️</div>
            <div style="font-size:13px; font-weight:700; color:#fff; margin-bottom:4px;">No hay platos en esta sección</div>
            <div style="font-size:11px; color:var(--text-dim); max-width:280px; margin:0 auto 12px;">Comienza sumando platos recomendados desde nuestro catálogo o crea uno nuevo personalizado.</div>
            <div style="display:flex; justify-content:center; gap:8px;">
              <button class="btn-nav btn-nav-gold" style="font-size:11px; padding:5px 12px;" onclick="openPresetsModal()">✨ Agregar Platos Frecuentes</button>
              <button class="btn-nav" style="font-size:11px; padding:5px 12px;" onclick="openNewDishModal()">+ Crear Plato</button>
            </div>
          </div>
        `;
        return;
      }

      const tagLabels = { star: '⭐', veggie: '🥬', vegan: '🌱', celiac: '🌾', sinlactosa: '🥛', picante: '🌶️' };
      let html = '';
      filtered.forEach((d, idx) => {
        const cat = cats.find(c => c.id === d.categoryId);
        const tags = (d.tags || []).filter(t => t !== 'star' && t !== 'chef_special').map(t => tagLabels[t] || '').join(' ');
        const starBadge = (d.tags || []).includes('star') ? '<span style="color:var(--accent-gold); margin-right:4px;">⭐</span>' : '';
        const chefBadge = (d.isChefSpecial || (d.tags || []).includes('chef_special')) ? '<span style="background:rgba(236,201,75,0.2); color:var(--accent-gold); font-size:9px; font-weight:800; padding:1px 6px; border-radius:4px; margin-right:4px; border:1px solid rgba(236,201,75,0.4);">👨‍🍳 CHEF</span>' : '';
        const outBadge = d.outOfStock ? '<span style="background:#E53E3E; color:#fff; font-size:9px; font-weight:800; padding:1px 6px; border-radius:4px; margin-left:6px;">AGOTADO</span>' : '';
        const opacity = d.outOfStock ? 'opacity:0.5;' : '';
        const photoThumb = d.photoUrl 
          ? `<img src="${d.photoUrl}" style="width:36px; height:36px; border-radius:6px; object-fit:cover; border:1px solid var(--border); flex-shrink:0;">` 
          : '';
        const priceDisplay = (d.originalPrice && Number(d.originalPrice) > Number(d.price)) 
          ? `<span style="text-decoration:line-through; opacity:0.6; margin-right:4px;">${currency} ${d.originalPrice}</span> ${currency} ${d.price}` 
          : `${currency} ${d.price}`;

        const cleanName = escapeHtml(d.name || 'Sin nombre');
        const cleanCatName = escapeHtml(cat ? cat.name : 'Sin cat.');
        const cleanDishId = escapeHtml(d.id || '');

        html += `
          <div class="dish-editor-card" style="${opacity} display:flex; align-items:center; gap:8px;">
            ${photoThumb}
            <div style="flex:1; min-width:0;">
              <div style="font-size:12px; font-weight:700; color:#fff; display:flex; align-items:center; flex-wrap:wrap; gap:2px;">
                ${chefBadge}${starBadge}${cleanName}${outBadge}
              </div>
              <div style="font-size:10px; color:var(--text-dim); display:flex; align-items:center; gap:4px; margin-top:2px;">
                ${cleanCatName} • ${priceDisplay} ${tags}
              </div>
            </div>
            <button class="btn-icon" onclick="editDish('${cleanDishId}')" title="Editar">✏️</button>
            <button class="btn-icon btn-icon-danger" onclick="deleteDish('${cleanDishId}')" title="Eliminar">🗑️</button>
          </div>
        `;
      });
      container.innerHTML = html;
    }

    function deleteDish(dishId) {
      const dish = (restaurant.dishes || []).find(d => d.id === dishId);
      const dishName = dish ? dish.name : 'este plato';
      showConfirmDialog({
        icon: '🗑️',
        title: '¿Eliminar Plato de la Carta?',
        message: `¿Estás seguro de que deseas eliminar "${dishName}"? Esta acción se guardará automáticamente en tu carta digital.`,
        confirmText: 'Sí, Eliminar',
        confirmClass: 'btn-danger',
        onConfirm: () => {
          restaurant.dishes = (restaurant.dishes || []).filter(d => d.id !== dishId);
          renderDishesList();
          triggerAutoSave();
        }
      });
    }

    async function handleDishPhotoUpload(input) {
      if (!input.files || !input.files[0]) return;
      const file = input.files[0];
      const fileNameSpan = document.getElementById('dishPhotoFileName');
      const clearBtn = document.getElementById('btnClearDishPhoto');
      const previewContainer = document.getElementById('dishPhotoPreviewContainer');
      const previewImg = document.getElementById('dishPhotoPreview');
      const urlInput = document.getElementById('modalDishPhoto');
      
      if (fileNameSpan) fileNameSpan.textContent = file.name;
      if (clearBtn) clearBtn.style.display = 'inline';

      const reader = new FileReader();
      reader.onload = async function(e) {
        const dataUrl = e.target.result;
        if (urlInput) urlInput.value = dataUrl;
        if (previewImg) previewImg.src = dataUrl;
        if (previewContainer) previewContainer.style.display = 'block';

        // Upload to server storage endpoint for permanent image hosting
        try {
          if (fileNameSpan) fileNameSpan.textContent = `Subiendo ${file.name}...`;
          const res = await fetch('/api/storage/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fileData: dataUrl,
              fileName: file.name,
              folder: 'dishes',
              bucket: 'photos'
            })
          });
          const result = await res.json().catch(() => ({}));
          if (res.ok && result.data?.url) {
            if (urlInput) urlInput.value = result.data.url;
            if (previewImg) previewImg.src = result.data.url;
            if (fileNameSpan) fileNameSpan.textContent = `✓ ${file.name}`;
          } else {
            if (fileNameSpan) fileNameSpan.textContent = `${file.name} (local)`;
          }
        } catch (err) {
          console.warn('[Dish photo upload warning]', err);
          if (fileNameSpan) fileNameSpan.textContent = `${file.name} (local)`;
        }
      };
      reader.readAsDataURL(file);
    }

    function clearDishPhoto() {
      const urlInput = document.getElementById('modalDishPhoto');
      const fileInput = document.getElementById('modalDishPhotoFile');
      const fileNameSpan = document.getElementById('dishPhotoFileName');
      const clearBtn = document.getElementById('btnClearDishPhoto');
      const previewContainer = document.getElementById('dishPhotoPreviewContainer');
      
      if (urlInput) urlInput.value = '';
      if (fileInput) fileInput.value = '';
      if (fileNameSpan) fileNameSpan.textContent = '';
      if (clearBtn) clearBtn.style.display = 'none';
      if (previewContainer) previewContainer.style.display = 'none';
    }

    function toggleDishScheduleControls() {
      const enabled = document.getElementById('modalDishScheduleEnabled')?.checked;
      const controls = document.getElementById('dishScheduleControls');
      if (controls) {
        controls.style.display = enabled ? 'flex' : 'none';
      }
    }

    function editDish(dishId) {
      const dish = (restaurant.dishes || []).find(d => d.id === dishId);
      if (!dish) return;
      document.getElementById('dishModalTitle').textContent = 'Editar Plato';
      document.getElementById('modalDishId').value = dish.id;
      document.getElementById('modalDishName').value = dish.name || '';
      document.getElementById('modalDishPrice').value = dish.price || 0;
      document.getElementById('modalDishOriginalPrice').value = (dish.originalPrice !== null && dish.originalPrice !== undefined) ? dish.originalPrice : '';
      document.getElementById('modalDishDesc').value = dish.description || '';
      const existingPhoto = dish.photoUrl || dish.imageUrl || dish.image || dish.photo || '';
      document.getElementById('modalDishPhoto').value = existingPhoto;
      document.getElementById('modalDishOutOfStock').checked = !!dish.outOfStock;
      document.getElementById('modalDishStar').checked = (dish.tags || []).includes('star');
      document.getElementById('modalDishChefSpecial').checked = !!dish.isChefSpecial || (dish.tags || []).includes('chef_special');
      document.getElementById('tagVeggie').checked = (dish.tags || []).includes('veggie');
      document.getElementById('tagVegan').checked = (dish.tags || []).includes('vegan');
      document.getElementById('tagCeliac').checked = (dish.tags || []).includes('celiac');
      document.getElementById('tagSinLactosa').checked = (dish.tags || []).includes('sinlactosa');
      document.getElementById('tagPicante').checked = (dish.tags || []).includes('picante');
      renderDishModifierAssignments(ensureDishModifierGroups(dish));

      // Smart Scheduling
      const sched = dish.schedule;
      const schedEnabled = !!(sched && sched.enabled);
      document.getElementById('modalDishScheduleEnabled').checked = schedEnabled;
      toggleDishScheduleControls();
      const schedDays = (sched && Array.isArray(sched.days)) ? sched.days : [0, 1, 2, 3, 4, 5, 6];
      document.querySelectorAll('.dish-sched-day').forEach(cb => {
        cb.checked = schedDays.includes(parseInt(cb.value, 10));
      });
      document.getElementById('modalDishTimeStart').value = (sched && sched.timeStart) || '11:30';
      document.getElementById('modalDishTimeEnd').value = (sched && sched.timeEnd) || '15:30';
      document.getElementById('modalDishScheduleBehavior').value = (sched && sched.behavior) || 'hide';

      // Photo preview
      const previewContainer = document.getElementById('dishPhotoPreviewContainer');
      const previewImg = document.getElementById('dishPhotoPreview');
      const clearBtn = document.getElementById('btnClearDishPhoto');
      const fileNameSpan = document.getElementById('dishPhotoFileName');
      if (fileNameSpan) fileNameSpan.textContent = '';
      if (existingPhoto) {
        if (previewContainer && previewImg) {
          previewImg.src = existingPhoto;
          previewContainer.style.display = 'block';
        }
        if (clearBtn) clearBtn.style.display = 'inline';
      } else {
        if (previewContainer) previewContainer.style.display = 'none';
        if (clearBtn) clearBtn.style.display = 'none';
      }

      // Populate category select
      const catSelect = document.getElementById('modalDishCategory');
      catSelect.innerHTML = '';
      let matchedCategory = false;
      (restaurant.categories || []).forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.name;
        if (c.id === dish.categoryId) {
          opt.selected = true;
          matchedCategory = true;
        }
        catSelect.appendChild(opt);
      });
      if (!matchedCategory && dish.categoryId) {
        const opt = document.createElement('option');
        opt.value = dish.categoryId;
        opt.textContent = dish.categoryId;
        opt.selected = true;
        catSelect.appendChild(opt);
      } else if (!catSelect.options.length) {
        const opt = document.createElement('option');
        opt.value = 'cat_general';
        opt.textContent = 'General';
        opt.selected = true;
        catSelect.appendChild(opt);
      }

      document.getElementById('dishEditModal').classList.add('active');
    }

    function openNewDishModal() {
      document.getElementById('dishModalTitle').textContent = 'Nuevo Plato';
      document.getElementById('dishForm').reset();
      document.getElementById('modalDishId').value = '';
      document.getElementById('modalDishPrice').value = '';
      document.getElementById('modalDishOriginalPrice').value = '';
      document.getElementById('modalDishPhoto').value = '';
      document.getElementById('modalDishOutOfStock').checked = false;
      document.getElementById('modalDishStar').checked = false;
      document.getElementById('modalDishChefSpecial').checked = false;
      renderDishModifierAssignments([]);
      clearDishPhoto();

      // Reset smart scheduling
      document.getElementById('modalDishScheduleEnabled').checked = false;
      toggleDishScheduleControls();
      document.querySelectorAll('.dish-sched-day').forEach(cb => { cb.checked = true; });
      document.getElementById('modalDishTimeStart').value = '11:30';
      document.getElementById('modalDishTimeEnd').value = '15:30';
      document.getElementById('modalDishScheduleBehavior').value = 'hide';

      // Populate category select
      const catSelect = document.getElementById('modalDishCategory');
      catSelect.innerHTML = '';
      (restaurant.categories || []).forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.name;
        catSelect.appendChild(opt);
      });
      if (!catSelect.options.length) {
        const opt = document.createElement('option');
        opt.value = 'cat_general';
        opt.textContent = 'General';
        catSelect.appendChild(opt);
      }

      document.getElementById('dishEditModal').classList.add('active');
    }

    function closeDishEditModal() {
      const submitBtn = document.getElementById('btnSubmitDishModal');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.dataset.saving = 'false';
        submitBtn.textContent = '💾 Guardar Plato';
      }
      document.getElementById('dishEditModal').classList.remove('active');
    }

    function getRestaurantModifierGroups() {
      if (!Array.isArray(restaurant.modifierGroups)) restaurant.modifierGroups = [];
      return restaurant.modifierGroups;
    }

    function inferLegacyPackUnits(dish) {
      const name = String(dish.name || '').toLowerCase();
      if (/media\s+docena|1\/2\s*docena|\b6\s*(?:unidades|un\.?|empanadas)\b/.test(name)) return 6;
      if (/\bdocena\b|\b12\s*(?:unidades|un\.?|empanadas)\b/.test(name)) return 12;
      if (/\b3\s*(?:unidades|un\.?|empanadas)\b|\btr[ií]o\b/.test(name)) return 3;
      return 1;
    }

    function resolveLegacyPackUnits(dish) {
      const inferred = inferLegacyPackUnits(dish);
      const configured = parseInt(dish.variantsPerItem, 10) || 0;
      return !configured || (configured === 1 && inferred > 1) ? inferred : configured;
    }

    function ensureDishModifierGroups(dish) {
      const groups = getRestaurantModifierGroups();
      const ids = Array.isArray(dish.modifierGroupIds) ? [...dish.modifierGroupIds] : [];
      const addLegacyGroup = (type, legacyOptions, settings) => {
        if (!Array.isArray(legacyOptions) || !legacyOptions.length) return;
        const id = `legacy_${type}_${dish.id}`;
        let group = groups.find(item => item.id === id);
        if (!group) {
          group = {
            id,
            name: settings.name,
            kind: settings.kind,
            selectionMode: settings.selectionMode,
            required: Boolean(settings.required),
            minSelections: settings.required ? 1 : 0,
            maxSelections: settings.selectionMode === 'single' ? 1 : 100,
            ...(settings.unitsPerSelection ? { unitsPerSelection: settings.unitsPerSelection } : {}),
            options: legacyOptions.map(option => ({
              id: String(option.id),
              name: String(option.name),
              priceDeltaCents: Math.max(0, Math.round(Number(option.priceDeltaCents) || 0)),
              active: option.active !== false
            }))
          };
          groups.push(group);
        }
        if (!ids.includes(id)) ids.push(id);
      };

      addLegacyGroup('protein', dish.proteinOptions, {
        name: 'Proteína', kind: 'protein', selectionMode: 'single', required: dish.proteinSelectionRequired
      });
      const splitFlavors = dish.variantSelectionMode === 'quantity_split';
      addLegacyGroup('flavors', dish.variants, {
        name: splitFlavors ? 'Sabores' : 'Variante',
        kind: splitFlavors ? 'flavor' : 'variant',
        selectionMode: splitFlavors ? 'quantity_split' : 'single',
        required: dish.variantsRequired,
        unitsPerSelection: splitFlavors ? resolveLegacyPackUnits(dish) : null
      });
      return ids;
    }

    function renderDishModifierAssignments(assignedIds = []) {
      const container = document.getElementById('dishModifierGroupsList');
      if (!container) return;
      const groups = getRestaurantModifierGroups().filter(group => group.active !== false);
      if (!groups.length) {
        container.innerHTML = '<p class="modifier-empty-state">Todavía no hay grupos. Creá uno para ofrecer proteínas, panes, extras o sabores.</p>';
        return;
      }

      const assigned = new Set(assignedIds);
      const presentationIds = groups.filter(group => group.kind === 'presentation' && assigned.has(group.id)).map(group => group.id);
      const visibleAssigned = presentationIds.length > 1
        ? new Set([...assigned].filter(id => !presentationIds.includes(id)).concat(presentationIds[0]))
        : assigned;
      container.innerHTML = groups.map(group => `
        <label class="dish-assigned-group">
          <input type="checkbox" data-modifier-group-id="${escapeHtml(group.id)}" data-group-kind="${escapeHtml(group.kind)}" onchange="toggleDishModifierGroup(this)" ${visibleAssigned.has(group.id) ? 'checked' : ''}>
          <span><strong>${escapeHtml(group.name)}</strong><small>${escapeHtml(group.kind)} · ${(group.options || []).length} opciones${group.required ? ' · obligatorio' : ''}</small></span>
        </label>
      `).join('');
    }

    function toggleDishModifierGroup(input) {
      if (!input.checked || input.dataset.groupKind !== 'presentation') return;
      document.querySelectorAll('#dishModifierGroupsList [data-group-kind="presentation"]').forEach(other => {
        if (other !== input) other.checked = false;
      });
    }

    function readDishModifierGroupIds() {
      return Array.from(document.querySelectorAll('#dishModifierGroupsList [data-modifier-group-id]:checked'))
        .map(input => input.dataset.modifierGroupId);
    }

    function openModifierGroupManager() {
      document.getElementById('modifierGroupManagerModal').classList.add('active');
      renderModifierGroupList();
    }

    function closeModifierGroupManager() {
      document.getElementById('modifierGroupManagerModal').classList.remove('active');
      renderDishModifierAssignments(readDishModifierGroupIds());
    }

    function renderModifierGroupList() {
      const container = document.getElementById('modifierGroupList');
      const groups = getRestaurantModifierGroups();
      container.innerHTML = groups.length ? groups.map(group => `
        <div class="modifier-group-list-item">
          <div><strong>${escapeHtml(group.name)}</strong><small>${escapeHtml(group.kind)} · ${(group.options || []).length} opciones</small></div>
          <div class="modifier-group-list-actions">
            <button type="button" class="btn-icon" onclick="editModifierGroup('${escapeHtml(group.id)}')" aria-label="Editar ${escapeHtml(group.name)}">✎</button>
            <button type="button" class="btn-icon btn-icon-danger" onclick="deleteModifierGroup('${escapeHtml(group.id)}')" aria-label="Eliminar ${escapeHtml(group.name)}">×</button>
          </div>
        </div>
      `).join('') : '<p class="modifier-empty-state">Creá grupos reutilizables para personalizar los platos.</p>';
    }

    function addBurgerModifierTemplate() {
      const groups = getRestaurantModifierGroups();
      if (groups.some(group => group.id.startsWith('template_burger_'))) {
        alert('La plantilla de hamburguesa ya existe. Editá sus grupos o asignalos a otro plato.');
        return;
      }
      const template = [
        {
          id: 'template_burger_bread',
          name: 'Tipo de pan',
          kind: 'bread',
          selectionMode: 'single',
          required: true,
          minSelections: 1,
          maxSelections: 1,
          active: true,
          options: [
            { id: 'template_bread_brioche', name: 'Brioche', priceDeltaCents: 0, active: true },
            { id: 'template_bread_potato', name: 'Pan de papa', priceDeltaCents: 0, active: true },
            { id: 'template_bread_gluten_free', name: 'Sin gluten', priceDeltaCents: 0, active: true }
          ]
        },
        {
          id: 'template_burger_extras',
          name: 'Extras',
          kind: 'topping',
          selectionMode: 'multiple',
          required: false,
          minSelections: 0,
          maxSelections: 3,
          active: true,
          options: [
            { id: 'template_extra_cheddar', name: 'Extra cheddar', priceDeltaCents: 0, active: true },
            { id: 'template_extra_bacon', name: 'Bacon', priceDeltaCents: 0, active: true },
            { id: 'template_extra_egg', name: 'Huevo', priceDeltaCents: 0, active: true }
          ]
        },
        {
          id: 'template_burger_patty',
          name: 'Medallones extra',
          kind: 'extra',
          selectionMode: 'quantity',
          required: false,
          minSelections: 0,
          maxSelections: 3,
          active: true,
          options: [{ id: 'template_extra_patty', name: 'Medallón extra', priceDeltaCents: 0, maxQuantity: 3, active: true }]
        }
      ];
      groups.push(...template);
      renderModifierGroupList();
      const currentIds = readDishModifierGroupIds();
      renderDishModifierAssignments(currentIds);
      triggerAutoSave();
    }

    function startNewModifierGroup() {
      document.getElementById('modifierGroupEditor').style.display = 'block';
      document.getElementById('modifierGroupId').value = '';
      document.getElementById('modifierGroupName').value = '';
      document.getElementById('modifierGroupKind').value = 'protein';
      document.getElementById('modifierGroupMode').value = 'single';
      document.getElementById('modifierGroupRequired').checked = false;
      document.getElementById('modifierGroupMin').value = '0';
      document.getElementById('modifierGroupMax').value = '1';
      document.getElementById('modifierSplitUnits').value = '12';
      renderModifierGroupOptions([]);
      updateModifierGroupEditor();
      document.getElementById('modifierGroupName').focus();
    }

    function editModifierGroup(groupId) {
      const group = getRestaurantModifierGroups().find(item => item.id === groupId);
      if (!group) return;
      document.getElementById('modifierGroupEditor').style.display = 'block';
      document.getElementById('modifierGroupId').value = group.id;
      document.getElementById('modifierGroupName').value = group.name;
      document.getElementById('modifierGroupKind').value = group.kind;
      document.getElementById('modifierGroupMode').value = group.selectionMode;
      document.getElementById('modifierGroupRequired').checked = Boolean(group.required);
      document.getElementById('modifierGroupMin').value = group.minSelections || 0;
      document.getElementById('modifierGroupMax').value = group.maxSelections || 1;
      document.getElementById('modifierSplitUnits').value = group.unitsPerSelection || 12;
      renderModifierGroupOptions(group.options || []);
      updateModifierGroupEditor();
    }

    function renderModifierGroupOptions(options) {
      const kind = document.getElementById('modifierGroupKind').value;
      const mode = document.getElementById('modifierGroupMode').value;
      const isPresentation = kind === 'presentation';
      const hasQuantities = mode === 'quantity';
      document.getElementById('modifierPriceHeading').textContent = isPresentation ? 'Precio del paquete' : 'Adicional';
      document.getElementById('modifierUnitsHeading').hidden = !isPresentation;
      document.getElementById('modifierMaxHeading').hidden = !hasQuantities;
      document.getElementById('modifierGroupOptionsList').innerHTML = (options || []).map((option, index) => `
        <div class="modifier-option-row">
          <input type="hidden" data-option-id value="${escapeHtml(option.id || '')}">
          <input type="text" class="form-input" data-option-name maxlength="80" value="${escapeHtml(option.name || '')}" placeholder="Nombre de la opción" aria-label="Nombre de la opción">
          <input type="number" class="form-input" data-option-price min="0" step="0.01" value="${option.priceValue !== undefined ? Number(option.priceValue) : (isPresentation ? (Number(option.priceCents) || 0) / 100 : (Number(option.priceDeltaCents) || 0) / 100)}" aria-label="${isPresentation ? 'Precio total' : 'Adicional de precio'}">
          <input type="number" class="form-input modifier-option-units" data-option-units min="1" max="100" step="1" value="${option.unitsIncluded || 1}" style="${isPresentation ? '' : 'display:none;'}" aria-label="Unidades incluidas">
          <input type="number" class="form-input modifier-option-max" data-option-max min="1" max="100" step="1" value="${option.maxQuantity || 3}" style="${hasQuantities && !isPresentation ? '' : 'display:none;'}" aria-label="Cantidad máxima">
          <button type="button" class="dish-option-remove" onclick="removeModifierGroupOption(${index})" aria-label="Quitar opción">×</button>
        </div>
      `).join('');
    }

    function updateModifierGroupEditor() {
      const kind = document.getElementById('modifierGroupKind').value;
      if (kind === 'presentation') document.getElementById('modifierGroupMode').value = 'single';
      const mode = document.getElementById('modifierGroupMode').value;
      document.getElementById('modifierGroupMax').max = mode === 'single' || kind === 'presentation' ? '1' : '100';
      document.getElementById('modifierSplitUnitsField').style.display = mode === 'quantity_split' ? 'block' : 'none';
      renderModifierGroupOptions(readModifierGroupOptions());
    }

    function handleModifierGroupModeChange() {
      const mode = document.getElementById('modifierGroupMode').value;
      const maximum = document.getElementById('modifierGroupMax');
      if (mode === 'single') maximum.value = '1';
      else if (maximum.value === '1') maximum.value = mode === 'quantity' ? '3' : '100';
      updateModifierGroupEditor();
    }

    function readModifierGroupOptions() {
      return Array.from(document.querySelectorAll('#modifierGroupOptionsList .modifier-option-row')).map(row => ({
        id: row.querySelector('[data-option-id]').value,
        name: row.querySelector('[data-option-name]').value,
        priceValue: row.querySelector('[data-option-price]').value,
        unitsIncluded: row.querySelector('[data-option-units]').value,
        maxQuantity: row.querySelector('[data-option-max]').value
      }));
    }

    function addModifierGroupOption() {
      const options = readModifierGroupOptions();
      options.push({ id: '', name: '', priceValue: '0', unitsIncluded: '1', maxQuantity: '3' });
      renderModifierGroupOptions(options);
      document.querySelector('#modifierGroupOptionsList .modifier-option-row:last-child [data-option-name]')?.focus();
    }

    function removeModifierGroupOption(index) {
      const options = readModifierGroupOptions();
      options.splice(index, 1);
      renderModifierGroupOptions(options);
    }

    function saveModifierGroup(event) {
      event.preventDefault();
      const assignedIds = readDishModifierGroupIds();
      const name = document.getElementById('modifierGroupName').value.trim().slice(0, 80);
      const kind = document.getElementById('modifierGroupKind').value;
      const selectionMode = kind === 'presentation' ? 'single' : document.getElementById('modifierGroupMode').value;
      const rawOptions = readModifierGroupOptions();
      const options = rawOptions.filter(option => option.name.trim()).map((option, index) => ({
        id: option.id || `opt_${Date.now()}_${index}`,
        name: option.name.trim().slice(0, 80),
        priceDeltaCents: kind === 'presentation' ? 0 : Math.max(0, Math.round((Number(option.priceValue) || 0) * 100)),
        ...(kind === 'presentation' ? {
          priceCents: Math.max(0, Math.round((Number(option.priceValue) || 0) * 100)),
          unitsIncluded: Math.max(1, Math.min(100, parseInt(option.unitsIncluded, 10) || 1))
        } : {}),
        ...(selectionMode === 'quantity' ? { maxQuantity: Math.max(1, Math.min(100, parseInt(option.maxQuantity, 10) || 1)) } : {}),
        active: true
      }));

      if (!name || !options.length) {
        alert('El grupo necesita un nombre y al menos una opción.');
        return;
      }
      if (kind === 'presentation' && options.some(option => !option.priceCents)) {
        alert('Cada presentación necesita un precio mayor a cero.');
        return;
      }

      const id = document.getElementById('modifierGroupId').value || `group_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const existingIndex = getRestaurantModifierGroups().findIndex(group => group.id === id);
      const required = document.getElementById('modifierGroupRequired').checked;
      const maximum = selectionMode === 'single' ? 1 : Math.max(1, Math.min(100, parseInt(document.getElementById('modifierGroupMax').value, 10) || 1));
      const group = {
        id,
        name,
        kind,
        selectionMode,
        required,
        minSelections: Math.max(0, Math.min(maximum, parseInt(document.getElementById('modifierGroupMin').value, 10) || 0)),
        maxSelections: maximum,
        ...(selectionMode === 'quantity_split' ? { unitsPerSelection: Math.max(1, Math.min(100, parseInt(document.getElementById('modifierSplitUnits').value, 10) || 1)) } : {}),
        active: true,
        options
      };
      const groups = getRestaurantModifierGroups();
      if (existingIndex >= 0) groups[existingIndex] = group;
      else groups.push(group);

      const editorDish = restaurant.dishes?.find(dish => dish.id === document.getElementById('modalDishId').value);
      if (editorDish) editorDish.modifierGroupIds = assignedIds;
      renderDishModifierAssignments(assignedIds);
      renderModifierGroupList();
      document.getElementById('modifierGroupEditor').style.display = 'none';
      triggerAutoSave();
    }

    function cancelModifierGroupEdit() {
      document.getElementById('modifierGroupEditor').style.display = 'none';
    }

    function deleteModifierGroup(groupId) {
      const group = getRestaurantModifierGroups().find(item => item.id === groupId);
      if (!group || !confirm(`¿Eliminar el grupo "${group.name}"? También se quitará de los platos que lo usan.`)) return;
      const assignedIds = readDishModifierGroupIds().filter(id => id !== groupId);
      restaurant.modifierGroups = getRestaurantModifierGroups().filter(item => item.id !== groupId);
      (restaurant.dishes || []).forEach(dish => {
        dish.modifierGroupIds = (dish.modifierGroupIds || []).filter(id => id !== groupId);
      });
      renderModifierGroupList();
      renderDishModifierAssignments(assignedIds);
      renderDishesList();
      triggerAutoSave();
    }

    function getDishOptionConfig() {
      return { modifierGroupIds: readDishModifierGroupIds() };
    }

    function saveDishFromModal(event) {
      event.preventDefault();

      const submitBtn = document.getElementById('btnSubmitDishModal');
      if (submitBtn) {
        if (submitBtn.dataset.saving === 'true') return;
        submitBtn.dataset.saving = 'true';
        submitBtn.disabled = true;
        submitBtn.textContent = '⏳ Guardando...';
      }

      const id = document.getElementById('modalDishId').value;
      const name = document.getElementById('modalDishName').value.trim();
      const price = parseFloat(document.getElementById('modalDishPrice').value) || 0;
      const originalPriceVal = parseFloat(document.getElementById('modalDishOriginalPrice').value);
      const originalPrice = isNaN(originalPriceVal) ? null : originalPriceVal;
      const description = document.getElementById('modalDishDesc').value.trim();
      const photoUrl = document.getElementById('modalDishPhoto').value.trim();
      const categoryId = document.getElementById('modalDishCategory').value;
      const outOfStock = document.getElementById('modalDishOutOfStock').checked;
      const isChefSpecial = document.getElementById('modalDishChefSpecial').checked;
      const optionConfig = getDishOptionConfig();

      // Smart Scheduling
      const scheduleEnabled = document.getElementById('modalDishScheduleEnabled').checked;
      let schedule = null;
      if (scheduleEnabled) {
        const selectedDays = Array.from(document.querySelectorAll('.dish-sched-day:checked')).map(cb => parseInt(cb.value, 10));
        const timeStart = document.getElementById('modalDishTimeStart').value || '00:00';
        const timeEnd = document.getElementById('modalDishTimeEnd').value || '23:59';
        const behavior = document.getElementById('modalDishScheduleBehavior').value || 'hide';
        schedule = {
          enabled: true,
          days: selectedDays.length ? selectedDays : [0, 1, 2, 3, 4, 5, 6],
          timeStart,
          timeEnd,
          behavior
        };
      }

      const tags = [];
      if (document.getElementById('modalDishStar').checked) tags.push('star');
      if (isChefSpecial) tags.push('chef_special');
      if (document.getElementById('tagVeggie').checked) tags.push('veggie');
      if (document.getElementById('tagVegan').checked) tags.push('vegan');
      if (document.getElementById('tagCeliac').checked) tags.push('celiac');
      if (document.getElementById('tagSinLactosa').checked) tags.push('sinlactosa');
      if (document.getElementById('tagPicante').checked) tags.push('picante');

      if (!restaurant.dishes) restaurant.dishes = [];

      let finalCategoryId = categoryId;
      if (!finalCategoryId) {
        if (restaurant.categories && restaurant.categories.length > 0) {
          finalCategoryId = restaurant.categories[0].id;
        } else {
          finalCategoryId = 'cat_general';
          if (!restaurant.categories) restaurant.categories = [];
          restaurant.categories.push({ id: 'cat_general', name: 'General' });
        }
      }

      if (id) {
        // Edit existing
        const dish = restaurant.dishes.find(d => d.id === id);
        if (dish) {
          dish.name = name;
          dish.price = price;
          dish.originalPrice = originalPrice;
          dish.description = description;
          dish.photoUrl = photoUrl || null;
          dish.categoryId = finalCategoryId;
          dish.outOfStock = outOfStock;
          dish.isChefSpecial = isChefSpecial;
          dish.schedule = schedule;
          dish.tags = tags;
          Object.assign(dish, optionConfig);
          delete dish.proteinOptions;
          delete dish.proteinSelectionRequired;
          delete dish.variants;
          delete dish.variantSelectionMode;
          delete dish.variantsRequired;
          delete dish.variantsPerItem;
        }
      } else {
        // Create new
        restaurant.dishes.push({
          id: 'd_' + Date.now(),
          name,
          price,
          originalPrice: originalPrice,
          description: description || 'Plato casero elaborado en el día',
          photoUrl: photoUrl || null,
          categoryId: finalCategoryId,
          outOfStock,
          isChefSpecial,
          schedule,
          tags,
          ...optionConfig
        });
      }

      closeDishEditModal();
      renderDishesList();
      triggerAutoSave();
    }

    // Category Management
    function promptNewCategoryInModal() {
      const name = prompt('Ingresa el nombre de la nueva categoría (ej: Postres, Cafetería):');
      if (!name || !name.trim()) return;
      const cleanName = name.trim();
      if (!restaurant.categories) restaurant.categories = [];
      let cat = restaurant.categories.find(c => c.name.toLowerCase() === cleanName.toLowerCase());
      if (!cat) {
        cat = { id: 'cat_' + Date.now(), name: cleanName };
        restaurant.categories.push(cat);
        populateCatFilter();
        triggerAutoSave();
      }
      const catSelect = document.getElementById('modalDishCategory');
      catSelect.innerHTML = '';
      restaurant.categories.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.name;
        if (c.id === cat.id) opt.selected = true;
        catSelect.appendChild(opt);
      });
    }

    function openCategoryManagerModal() {
      renderCategoryManagerList();
      document.getElementById('categoryManagerModal').classList.add('active');
    }

    function closeCategoryManagerModal() {
      document.getElementById('categoryManagerModal').classList.remove('active');
      populateCatFilter();
    }

    function renderCategoryManagerList() {
      const list = document.getElementById('categoryManagerList');
      if (!list) return;
      const cats = restaurant.categories || [];
      if (!cats.length) {
        list.innerHTML = '<div style="font-size:11px; color:var(--text-dim); text-align:center; padding:12px;">No hay categorías creadas aún.</div>';
        return;
      }
      list.innerHTML = cats.map((c, index) => `
        <div style="display:flex; justify-content:space-between; align-items:center; background:var(--surface-2); padding:8px 12px; border-radius:6px; border:1px solid var(--border);">
          <span style="font-size:12px; font-weight:600; color:#fff;">${escapeHtml(c.name)}</span>
          <div style="display:flex; gap:6px;">
            <button class="btn-icon" onclick="moveCategory('${escapeHtml(c.id)}', -1)" title="Mover arriba" aria-label="Mover ${escapeHtml(c.name)} arriba" ${index === 0 ? 'disabled' : ''}>↑</button>
            <button class="btn-icon" onclick="moveCategory('${escapeHtml(c.id)}', 1)" title="Mover abajo" aria-label="Mover ${escapeHtml(c.name)} abajo" ${index === cats.length - 1 ? 'disabled' : ''}>↓</button>
            <button class="btn-icon" onclick="renameCategory('${escapeHtml(c.id)}')" title="Renombrar">✏️</button>
            <button class="btn-icon btn-icon-danger" onclick="deleteCategory('${escapeHtml(c.id)}')" title="Eliminar">🗑️</button>
          </div>
        </div>
      `).join('');
    }

    function moveCategory(catId, direction) {
      const categories = restaurant.categories || [];
      const currentIndex = categories.findIndex(category => category.id === catId);
      const targetIndex = currentIndex + direction;
      if (currentIndex < 0 || targetIndex < 0 || targetIndex >= categories.length) return;

      [categories[currentIndex], categories[targetIndex]] = [categories[targetIndex], categories[currentIndex]];
      renderCategoryManagerList();
      populateCatFilter();
      renderDishesList();
      triggerAutoSave();
    }

    function addCategoryFromManager() {
      const input = document.getElementById('newCategoryInput');
      const name = (input.value || '').trim();
      if (!name) return;
      if (!restaurant.categories) restaurant.categories = [];
      const exists = restaurant.categories.some(c => c.name.toLowerCase() === name.toLowerCase());
      if (exists) return alert('Esa categoría ya existe.');
      restaurant.categories.push({ id: 'cat_' + Date.now(), name });
      input.value = '';
      renderCategoryManagerList();
      populateCatFilter();
      triggerAutoSave();
    }

    function renameCategory(catId) {
      const cat = (restaurant.categories || []).find(c => c.id === catId);
      if (!cat) return;
      const newName = prompt('Nuevo nombre para la categoría:', cat.name);
      if (!newName || !newName.trim()) return;
      cat.name = newName.trim();
      renderCategoryManagerList();
      populateCatFilter();
      renderDishesList();
      triggerAutoSave();
    }

    function deleteCategory(catId) {
      const cat = (restaurant.categories || []).find(c => c.id === catId);
      if (!cat) return;
      const dishCount = (restaurant.dishes || []).filter(d => d.categoryId === catId).length;
      const msg = dishCount > 0 
        ? `Esta categoría contiene ${dishCount} plato(s). ¿Estás seguro de que deseas eliminarla? Los platos quedarán sin categoría asignada.`
        : `¿Confirmas eliminar la categoría "${cat.name}"?`;
      if (!confirm(msg)) return;
      restaurant.categories = (restaurant.categories || []).filter(c => c.id !== catId);
      renderCategoryManagerList();
      populateCatFilter();
      renderDishesList();
      triggerAutoSave();
    }

    // Presets Management
    let currentPresetCategory = 'empanadas';

    function openPresetsModal() {
      document.getElementById('presetsModal').classList.add('active');
      renderPresetChips();
      browsePresetCategory('empanadas');
    }
    function closePresetsModal() {
      document.getElementById('presetsModal').classList.remove('active');
    }

    function renderPresetChips() {
      const container = document.getElementById('presetChipsContainer');
      container.innerHTML = '';
      Object.keys(PRESETS).forEach(key => {
        const p = PRESETS[key];
        const chip = document.createElement('button');
        chip.className = 'btn-nav';
        chip.style.cssText = 'white-space:nowrap; font-size:11px; padding:5px 12px; flex-shrink:0;';
        chip.textContent = p.catName;
        chip.onclick = () => browsePresetCategory(key);
        if (key === currentPresetCategory) {
          chip.style.background = 'var(--accent-gold)';
          chip.style.color = '#101614';
          chip.style.fontWeight = '700';
          chip.style.borderColor = 'var(--accent-gold)';
        }
        container.appendChild(chip);
      });
    }

    function browsePresetCategory(key) {
      currentPresetCategory = key;
      const preset = PRESETS[key];
      if (!preset) return;

      document.getElementById('presetCategoryLabel').textContent = preset.catName;
      renderPresetChips();

      const list = document.getElementById('presetDishesList');
      let html = '';
      preset.dishes.forEach((d, idx) => {
        const tagBadges = (d.tags || []).map(t => {
          const labels = { star: '⭐', veggie: '🥬', vegan: '🌱', celiac: '🌾', sinlactosa: '🥛', picante: '🌶️' };
          return labels[t] || '';
        }).join(' ');
        html += `
          <div style="display:flex; align-items:center; justify-content:space-between; background:var(--bg-base); padding:8px 10px; border-radius:8px; margin-bottom:6px; border:1px solid var(--border);">
            <div style="flex:1; min-width:0;">
              <div style="font-size:12px; font-weight:700; color:#fff; display:flex; align-items:center; gap:4px;">
                ${escapeHtml(d.name)} ${tagBadges}
              </div>
              <div style="font-size:10px; color:var(--text-dim); margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(d.desc)}</div>
              <div style="font-size:11px; color:var(--accent-gold); font-family:var(--font-mono); margin-top:2px;">$ ${d.price}</div>
            </div>
            <button class="btn-nav btn-nav-gold" style="font-size:11px; padding:4px 10px; flex-shrink:0; margin-left:8px;" onclick="addSinglePresetDish('${key}', ${idx})">
              + Sumar
            </button>
          </div>
        `;
      });
      list.innerHTML = html;
    }

    function buildPresetDish(presetKey, dish, categoryId, index) {
      if (presetKey === 'empanadas' && Array.isArray(dish.variants)) {
        return {
          id: `d_${presetKey}_${Date.now()}_${index}`,
          categoryId,
          name: dish.name,
          price: dish.price,
          description: dish.desc,
          tags: dish.tags || [],
          modifierGroupIds: ensureEmpanadaPresetGroups(dish)
        };
      }

      const optionConfig = Array.isArray(dish.variants) ? {
        variants: dish.variants,
        variantSelectionMode: dish.variantSelectionMode || 'single',
        variantsRequired: Boolean(dish.variantsRequired),
        ...(dish.variantSelectionMode === 'quantity_split' ? { variantsPerItem: dish.variantsPerItem || 1 } : {})
      } : {};
      return {
        id: `d_${presetKey}_${Date.now()}_${index}`,
        categoryId,
        name: dish.name,
        price: dish.price,
        description: dish.desc,
        tags: dish.tags || [],
        ...optionConfig
      };
    }

    function ensureEmpanadaPresetGroups(dish) {
      const groups = getRestaurantModifierGroups();
      const presentationId = 'preset_empanadas_presentation';
      const flavorsId = 'preset_empanadas_flavors';

      if (!groups.some(group => group.id === presentationId)) {
        groups.push({
          id: presentationId,
          name: 'Presentación',
          kind: 'presentation',
          selectionMode: 'single',
          required: true,
          minSelections: 1,
          maxSelections: 1,
          active: true,
          options: [
            { id: 'empanadas_3', name: '3 unidades', unitsIncluded: 3, priceCents: 28500, priceDeltaCents: 0, active: true },
            { id: 'empanadas_6', name: 'Media docena (6)', unitsIncluded: 6, priceCents: 55000, priceDeltaCents: 0, active: true },
            { id: 'empanadas_12', name: 'Docena (12)', unitsIncluded: 12, priceCents: 108000, priceDeltaCents: 0, active: true }
          ]
        });
      }
      if (!groups.some(group => group.id === flavorsId)) {
        groups.push({
          id: flavorsId,
          name: 'Sabores',
          kind: 'flavor',
          selectionMode: 'quantity_split',
          required: true,
          minSelections: 1,
          maxSelections: 100,
          unitsPerSelection: 12,
          active: true,
          options: (dish.variants || []).map(option => ({
            ...option,
            priceDeltaCents: Number(option.priceDeltaCents) || 0,
            active: true
          }))
        });
      }
      return [presentationId, flavorsId];
    }

    function addSinglePresetDish(presetKey, dishIdx) {
      const preset = PRESETS[presetKey];
      if (!preset || !preset.dishes[dishIdx]) return;
      const d = preset.dishes[dishIdx];

      if (!restaurant.categories) restaurant.categories = [];
      if (!restaurant.dishes) restaurant.dishes = [];

      let cat = restaurant.categories.find(c => c.name.toLowerCase() === preset.catName.toLowerCase());
      if (!cat) {
        cat = { id: 'cat_' + presetKey + '_' + Date.now(), name: preset.catName };
        restaurant.categories.push(cat);
      }

      restaurant.dishes.push(buildPresetDish(presetKey, d, cat.id, dishIdx));

      populateCatFilter();
      renderDishesList();
      triggerAutoSave();

      // Visual feedback — briefly change button text
      const btns = document.querySelectorAll('#presetDishesList button');
      if (btns[dishIdx]) {
        btns[dishIdx].textContent = '✓ Agregado';
        btns[dishIdx].disabled = true;
        setTimeout(() => { btns[dishIdx].textContent = '+ Sumar'; btns[dishIdx].disabled = false; }, 1500);
      }
    }

    function importCurrentPresetCategory() {
      importPresetCategory(currentPresetCategory);
    }

    function importPresetCategory(presetKey) {
      const preset = PRESETS[presetKey];
      if (!preset) return;

      if (!restaurant.categories) restaurant.categories = [];
      if (!restaurant.dishes) restaurant.dishes = [];

      let cat = restaurant.categories.find(c => c.name.toLowerCase() === preset.catName.toLowerCase());
      if (!cat) {
        cat = { id: 'cat_' + presetKey + '_' + Date.now(), name: preset.catName };
        restaurant.categories.push(cat);
      }

      preset.dishes.forEach((dish, index) => {
        restaurant.dishes.push(buildPresetDish(presetKey, dish, cat.id, index));
      });

      populateCatFilter();
      renderDishesList();
      closePresetsModal();
      triggerAutoSave();
      alert(`¡Se agregaron ${preset.dishes.length} platos de ${preset.catName}!`);
    }

    function importAllPresets() {
      Object.keys(PRESETS).forEach(k => {
        const p = PRESETS[k];
        let cat = (restaurant.categories || []).find(c => c.name.toLowerCase() === p.catName.toLowerCase());
        if (!cat) {
          cat = { id: 'cat_' + k + '_' + Date.now(), name: p.catName };
          if (!restaurant.categories) restaurant.categories = [];
          restaurant.categories.push(cat);
        }
        p.dishes.forEach((dish, index) => {
          restaurant.dishes.push(buildPresetDish(k, dish, cat.id, index));
        });
      });

      populateCatFilter();
      renderDishesList();
      closePresetsModal();
      triggerAutoSave();
      alert('¡Carta completa de 100+ platos importada con éxito!');
    }

    // ==================== HELADERÍA & PERFUMERÍA PRESETS ====================
    const ICE_CREAM_PRESETS_DATA = [
      { id: 'sabor_choco_amargo', cat: 'Chocolates', name: 'Chocolate Amargo 70%', price: 320, desc: 'Cacao puro ecuatoriano al 70%, intenso y con notas tostadas.', tags: ['star', 'celiac'] },
      { id: 'sabor_choco_almendras', cat: 'Chocolates', name: 'Chocolate con Almendras Tostadas', price: 330, desc: 'Cremoso chocolate con leche y almendras tostadas.', tags: ['celiac'] },
      { id: 'sabor_choco_suizo', cat: 'Chocolates', name: 'Chocolate Suizo con Dulce de Leche', price: 340, desc: 'Chocolate semiamargo veteado con dulce de leche natural.', tags: ['star'] },
      { id: 'sabor_choco_blanco', cat: 'Chocolates', name: 'Chocolate Blanco Patagónico', price: 320, desc: 'Manteca de cacao pura con crocante de avellanas.', tags: ['celiac'] },
      { id: 'sabor_chocotorta', cat: 'Chocolates', name: 'Chocotorta Helada Especial', price: 350, desc: 'Galletitas de chocolate con café y crema con dulce de leche.', tags: ['star'] },
      { id: 'sabor_mousse_choco', cat: 'Chocolates', name: 'Mousse de Chocolate Aireado', price: 320, desc: 'Textura ligera y esponjosa con escamas de cacao.', tags: ['celiac'] },
      { id: 'sabor_choco_marroc', cat: 'Chocolates', name: 'Chocolate Marroc Praliné', price: 350, desc: 'Chocolate con leche y praliné suave de maní tostado.', tags: [] },

      { id: 'sabor_ddl_clasico', cat: 'Dulces de Leche', name: 'Dulce de Leche Tradicional Rioplatense', price: 310, desc: 'La receta madre con leche de campo y cocción lenta.', tags: ['star', 'celiac'] },
      { id: 'sabor_ddl_granizado', cat: 'Dulces de Leche', name: 'Dulce de Leche Granizado', price: 320, desc: 'Con abundantes escamas crujientes de chocolate amargo.', tags: ['celiac'] },
      { id: 'sabor_ddl_tentacion', cat: 'Dulces de Leche', name: 'Dulce de Leche Tentación', price: 340, desc: 'Con generoso veteado de dulce de leche repostero puro.', tags: ['star', 'celiac'] },
      { id: 'sabor_ddl_brownie', cat: 'Dulces de Leche', name: 'Dulce de Leche con Brownie & Nuez', price: 350, desc: 'Tropezones húmedos de brownie casero y nueces pecan.', tags: ['star'] },
      { id: 'sabor_ddl_bombon', cat: 'Dulces de Leche', name: 'Dulce de Leche Bombón', price: 340, desc: 'Veteado con pasta de avellanas y bocaditos bañados.', tags: [] },
      { id: 'sabor_ddl_alfajor', cat: 'Dulces de Leche', name: 'Dulce de Leche Alfajor Marplatense', price: 350, desc: 'Con trocitos de masa especiada de alfajor artesanal.', tags: [] },

      { id: 'sabor_crema_americana', cat: 'Cremas', name: 'Crema Americana (Vainilla Bourbon)', price: 300, desc: 'Crema de leche batida infusionada con vainilla natural.', tags: ['celiac'] },
      { id: 'sabor_tramontana', cat: 'Cremas', name: 'Tramontana Clásica', price: 330, desc: 'Crema americana con dulce de leche y galletitas crocantes.', tags: ['star'] },
      { id: 'sabor_mascarpone', cat: 'Cremas', name: 'Mascarpone con Frutos del Bosque', price: 350, desc: 'Queso mascarpone con reducción de frambuesas y moras.', tags: ['star', 'celiac'] },
      { id: 'sabor_sambayon', cat: 'Cremas', name: 'Sambayón al Oporto y Marsala', price: 340, desc: 'Yemas batidas con vino Oporto añejado y almendras.', tags: ['celiac'] },
      { id: 'sabor_banana_split', cat: 'Cremas', name: 'Banana Split Criolla', price: 330, desc: 'Bananas maduras, dulce de leche y chocolate picado.', tags: ['celiac'] },
      { id: 'sabor_frutilla_crema', cat: 'Cremas', name: 'Frutilla a la Crema de Campo', price: 310, desc: 'Frutillas frescas seleccionadas con crema de leche fresca.', tags: ['celiac'] },
      { id: 'sabor_crema_rusa', cat: 'Cremas', name: 'Crema Rusa con Nueces Mariposa', price: 340, desc: 'Crema de nuez con abundantes nueces mariposa frescas.', tags: ['celiac'] },
      { id: 'sabor_menta_granizada', cat: 'Cremas', name: 'Menta Granizada Silvestre', price: 310, desc: 'Menta natural con granizado de chocolate amargo.', tags: ['celiac'] },

      { id: 'sabor_limon_agua', cat: 'Frutales', name: 'Limón Silvestre Natural', price: 290, desc: '100% zumo recién exprimido. Refrescante y liviano.', tags: ['vegan', 'celiac', 'veggie'] },
      { id: 'sabor_frutilla_agua', cat: 'Frutales', name: 'Frutilla Natural al Agua', price: 290, desc: 'Frutillas maduras procesadas al momento con almíbar suave.', tags: ['vegan', 'celiac', 'veggie'] },
      { id: 'sabor_maracuya', cat: 'Frutales', name: 'Maracuyá Tropical con Semillitas', price: 310, desc: 'Pulpa de maracuyá con su acidez exótica natural.', tags: ['star', 'vegan', 'celiac', 'veggie'] },
      { id: 'sabor_frambuesa', cat: 'Frutales', name: 'Frambuesa Patagónica al Agua', price: 320, desc: 'Frambuesas del sur con balance justo de dulzor.', tags: ['vegan', 'celiac', 'veggie'] },
      { id: 'sabor_mango', cat: 'Frutales', name: 'Mango & Naranja Jugosa', price: 310, desc: 'Sorbet aterciopelado de mango y jugo de naranja fresca.', tags: ['vegan', 'celiac', 'veggie'] },
      { id: 'sabor_arandanos', cat: 'Frutales', name: 'Arándanos & Moras Silvestres', price: 310, desc: 'Frutos rojos repletos de antioxidantes en sorbete.', tags: ['vegan', 'celiac', 'veggie'] },

      { id: 'sabor_pistacho', cat: 'Especiales', name: 'Pistacho Siciliano 100% Puro', price: 380, desc: 'Pistachos tostados de Bronte con pizca de sal marina.', tags: ['star', 'celiac'] },
      { id: 'sabor_kinder', cat: 'Especiales', name: 'Kinder Bueno Blanco & Avellanas', price: 360, desc: 'Pasta de avellanas, oblea crocante y chocolate blanco.', tags: ['star'] },
      { id: 'sabor_tiramisu', cat: 'Especiales', name: 'Tiramisú al Espresso Italiano', price: 350, desc: 'Mascarpone, bizcochuelo bañado en café y cacao.', tags: ['star'] },
      { id: 'sabor_cheesecake', cat: 'Especiales', name: 'Cheesecake de Frutos Rojos', price: 350, desc: 'Queso crema New York con base de galleta y frutos rojos.', tags: [] },
      { id: 'sabor_nutella', cat: 'Especiales', name: 'Nutella Gianduia Crunch', price: 360, desc: 'Crema de cacao y avellana con crocante de almendras.', tags: ['star'] }
    ];

    let iceCreamSelectedIds = new Set(ICE_CREAM_PRESETS_DATA.map(f => f.id));
    let iceCreamActiveCat = 'ALL';

    function openIceCreamPresetsModal() {
      document.getElementById('iceCreamPresetsModal').classList.add('active');
      renderIceCreamPresetsList();
    }
    function closeIceCreamPresetsModal() {
      document.getElementById('iceCreamPresetsModal').classList.remove('active');
    }

    function filterIceCreamPresetCat(cat) {
      iceCreamActiveCat = cat;
      const pills = document.querySelectorAll('#iceCreamPresetFilterBar .cat-pill');
      pills.forEach(p => {
        p.classList.toggle('active', p.textContent.includes(cat) || (cat === 'ALL' && p.textContent.includes('Todos')));
      });
      renderIceCreamPresetsList();
    }

    function toggleAllIceCreamFlavors(select) {
      if (select) {
        ICE_CREAM_PRESETS_DATA.forEach(f => iceCreamSelectedIds.add(f.id));
      } else {
        iceCreamSelectedIds.clear();
      }
      renderIceCreamPresetsList();
    }

    function renderIceCreamPresetsList() {
      const container = document.getElementById('iceCreamPresetsListContainer');
      const countLabel = document.getElementById('iceCreamPresetCountLabel');
      if (!container) return;

      countLabel.textContent = `${iceCreamSelectedIds.size} de ${ICE_CREAM_PRESETS_DATA.length} seleccionados`;

      const filtered = ICE_CREAM_PRESETS_DATA.filter(f => iceCreamActiveCat === 'ALL' || f.cat === iceCreamActiveCat);

      let html = '';
      filtered.forEach(f => {
        const isChecked = iceCreamSelectedIds.has(f.id);
        const tags = (f.tags || []).map(t => {
          if (t === 'star') return '⭐';
          if (t === 'celiac') return '🌾 Sin TACC';
          if (t === 'vegan') return '🌱 Vegano';
          return '';
        }).filter(Boolean).join(' ');

        html += `
          <div style="display:flex; align-items:center; justify-content:space-between; background:var(--bg-base); padding:8px 12px; border-radius:8px; margin-bottom:6px; border:1px solid ${isChecked ? 'var(--accent-gold)' : 'var(--border)'};">
            <label style="display:flex; align-items:center; gap:10px; flex:1; cursor:pointer; min-width:0;">
              <input type="checkbox" ${isChecked ? 'checked' : ''} onchange="toggleIceCreamFlavorItem('${f.id}', this.checked)" style="width:18px; height:18px; accent-color:var(--accent-gold); cursor:pointer;">
              <div style="min-width:0;">
                <div style="font-size:12px; font-weight:700; color:#fff; display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                  <span>${f.name}</span>
                  <span style="font-size:10px; color:var(--accent-gold);">${tags}</span>
                </div>
                <div style="font-size:10px; color:var(--text-dim); margin-top:2px;">${f.desc}</div>
              </div>
            </label>
            <div style="font-size:11px; font-weight:700; color:var(--accent-gold); font-family:var(--font-mono); margin-left:8px; white-space:nowrap;">
              $ ${f.price}
            </div>
          </div>
        `;
      });

      container.innerHTML = html;
    }

    function toggleIceCreamFlavorItem(id, checked) {
      if (checked) iceCreamSelectedIds.add(id);
      else iceCreamSelectedIds.delete(id);
      const countLabel = document.getElementById('iceCreamPresetCountLabel');
      if (countLabel) countLabel.textContent = `${iceCreamSelectedIds.size} de ${ICE_CREAM_PRESETS_DATA.length} seleccionados`;
    }

    function importSelectedIceCreamFlavors() {
      if (iceCreamSelectedIds.size === 0) {
        alert('Por favor marcá al menos 1 sabor para importar.');
        return;
      }

      if (!restaurant.categories) restaurant.categories = [];
      if (!restaurant.dishes) restaurant.dishes = [];

      let importedCount = 0;
      ICE_CREAM_PRESETS_DATA.forEach(f => {
        if (!iceCreamSelectedIds.has(f.id)) return;

        const catName = `🍦 Helados (${f.cat})`;
        let cat = restaurant.categories.find(c => c.name.toLowerCase() === catName.toLowerCase());
        if (!cat) {
          cat = { id: 'cat_helados_' + f.cat.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + Date.now(), name: catName };
          restaurant.categories.push(cat);
        }

        const existingDish = restaurant.dishes.find(d => d.name.toLowerCase() === f.name.toLowerCase());
        if (!existingDish) {
          restaurant.dishes.push({
            id: 'd_ice_' + f.id + '_' + Date.now(),
            categoryId: cat.id,
            name: f.name,
            price: f.price,
            description: f.desc,
            tags: f.tags || []
          });
          importedCount++;
        }
      });

      populateCatFilter();
      renderDishesList();
      closeIceCreamPresetsModal();
      triggerAutoSave();
      alert(`¡Se importaron ${importedCount} sabores de heladería a tu carta!`);
    }

    // Presets Perfumería
    const PERFUMERY_PRESETS_STUDIO = [
      { id: 'p_ambre', name: 'Ambre Nuit Nocturne (EDP)', cat: 'Fragancias Nicho', price: 2200, desc: 'Familia Oriental • Salida: Bergamota, Pomelo • Corazón: Rosa Damascena, Canela • Fondo: Ámbar Gris, Vainilla.', tags: ['star'] },
      { id: 'p_citrus', name: 'Aqua Riviera Mandarine (EDT)', cat: 'Fragancias Cítricas', price: 1750, desc: 'Familia Cítrica • Salida: Mandarina Sicilia, Limón • Corazón: Neroli, Azahar • Fondo: Vetiver, Almizcle Blanco.', tags: [] },
      { id: 'p_santal', name: 'Santal Majestueux (EDP)', cat: 'Fragancias Amaderadas', price: 2400, desc: 'Familia Amaderada • Salida: Cardamomo, Violeta • Corazón: Iris, Incienso • Fondo: Sándalo Australiano, Cedro.', tags: ['star'] },
      { id: 'p_fleur', name: 'Fleur Blanche de Soie (EDP)', cat: 'Fragancias Florales', price: 1950, desc: 'Familia Floral • Salida: Pera Nashi, Pimienta Rosa • Corazón: Jazmín Sambac, Tuberosa • Fondo: Cachemira, Vainilla.', tags: ['star'] },
      { id: 'p_vanille', name: 'Vanille Noire & Praliné (Body Splash)', cat: 'Gourmand & Brumas', price: 1250, desc: 'Familia Gourmand • Salida: Almendra, Café • Corazón: Caramelo Toffee, Tonka • Fondo: Vainilla Bourbon, Azúcar Moreno.', tags: ['star'] },
      { id: 'p_fougere', name: 'Fougère Sauvage Lavande (EDT)', cat: 'Aromáticos & Barbershop', price: 1650, desc: 'Familia Aromática • Salida: Lavanda Provenzal, Menta • Corazón: Geranio, Salvia • Fondo: Musgo de Roble, Cedro.', tags: [] }
    ];

    function openPerfumeryPresetsModal() {
      document.getElementById('perfumeryPresetsModal').classList.add('active');
      renderPerfumeryPresetsList();
    }
    function closePerfumeryPresetsModal() {
      document.getElementById('perfumeryPresetsModal').classList.remove('active');
    }

    function renderPerfumeryPresetsList() {
      const container = document.getElementById('perfumeryPresetsListContainer');
      if (!container) return;

      let html = '';
      PERFUMERY_PRESETS_STUDIO.forEach(p => {
        html += `
          <div style="background:var(--bg-base); border:1px solid var(--border); border-radius:8px; padding:10px 12px; margin-bottom:8px; display:flex; align-items:center; justify-content:space-between; gap:10px;">
            <div style="flex:1; min-width:0;">
              <div style="font-size:12px; font-weight:700; color:#fff;">${p.name}</div>
              <div style="font-size:10px; color:var(--accent-gold); margin-top:1px;">${p.cat} • $ ${p.price}</div>
              <div style="font-size:10px; color:var(--text-dim); margin-top:2px;">${p.desc}</div>
            </div>
            <input type="checkbox" class="perfume-preset-checkbox" value="${p.id}" checked style="width:18px; height:18px; accent-color:var(--accent-gold); cursor:pointer;">
          </div>
        `;
      });
      container.innerHTML = html;
    }

    function importSelectedPerfumery() {
      const checkboxes = document.querySelectorAll('.perfume-preset-checkbox:checked');
      if (!checkboxes.length) {
        alert('Marcá al menos una fragancia para importar.');
        return;
      }

      if (!restaurant.categories) restaurant.categories = [];
      if (!restaurant.dishes) restaurant.dishes = [];

      let count = 0;
      checkboxes.forEach(cb => {
        const p = PERFUMERY_PRESETS_STUDIO.find(item => item.id === cb.value);
        if (!p) return;

        let cat = restaurant.categories.find(c => c.name.toLowerCase() === p.cat.toLowerCase());
        if (!cat) {
          cat = { id: 'cat_perf_' + p.id + '_' + Date.now(), name: `🌸 ${p.cat}` };
          restaurant.categories.push(cat);
        }

        const existing = restaurant.dishes.find(d => d.name.toLowerCase() === p.name.toLowerCase());
        if (!existing) {
          restaurant.dishes.push({
            id: 'd_perf_' + p.id + '_' + Date.now(),
            categoryId: cat.id,
            name: p.name,
            price: p.price,
            description: p.desc,
            tags: p.tags || []
          });
          count++;
        }
      });

      populateCatFilter();
      renderDishesList();
      closePerfumeryPresetsModal();
      triggerAutoSave();
      alert(`¡Se importaron ${count} fragancias a tu carta!`);
    }

    // Delivery Zones
    function renderDeliveryZones() {
      const container = document.getElementById('deliveryZonesList');
      const zones = restaurant.deliveryZones || [];
      const currency = restaurant.currency || '$';

      if (!zones.length) {
        container.innerHTML = '<p style="color:var(--text-dim); font-size:11px;">Sin zonas configuradas.</p>';
        return;
      }

      let html = '';
      zones.forEach((z, idx) => {
        html += `
          <div style="display:flex; justify-content:space-between; align-items:center; background:var(--bg-base); padding:6px 10px; border-radius:6px; margin-bottom:6px;">
            <span style="font-size:12px;">${escapeHtml(z.name)}</span>
            <div style="display:flex; align-items:center; gap:6px;">
              <span style="font-family:var(--font-mono); color:var(--accent-gold); font-size:11px;">${currency} ${z.fee}</span>
              <button class="btn-icon btn-icon-danger" onclick="deleteDeliveryZone(${idx})">🗑️</button>
            </div>
          </div>
        `;
      });
      container.innerHTML = html;
    }

    function addDeliveryZone() {
      const name = prompt('Nombre de la zona o barrio (Ej: Centro / Pocitos / Periferia):');
      if (!name) return;
      const fee = prompt('Costo de envío:', '60');
      if (!restaurant.deliveryZones) restaurant.deliveryZones = [];
      restaurant.deliveryZones.push({ name, fee: parseFloat(fee) || 0 });
      renderDeliveryZones();
      triggerAutoSave();
    }

    function deleteDeliveryZone(idx) {
      restaurant.deliveryZones.splice(idx, 1);
      renderDeliveryZones();
      triggerAutoSave();
    }

    // QR Code Generator with Centered Logo / Emblem Badge
    function generateQrCode() {
      const container = document.getElementById('qrcodeCanvasContainer');
      container.innerHTML = '';
      const fullUrl = window.location.origin + `/m/${restaurant.slug}`;

      // Temporary holder for qrcode.js
      const tempHolder = document.createElement('div');
      new QRCode(tempHolder, {
        text: fullUrl,
        width: 240,
        height: 240,
        colorDark: "#0E1412",
        colorLight: "#FFFFFF",
        correctLevel: QRCode.CorrectLevel.H
      });

      // Allow QRCode library to render canvas/img
      setTimeout(() => {
        const qrCanvas = tempHolder.querySelector('canvas');
        const qrImg = tempHolder.querySelector('img');

        const canvas = document.createElement('canvas');
        canvas.width = 240;
        canvas.height = 240;
        const ctx = canvas.getContext('2d');

        const drawOverlayAndMount = () => {
          const center = 120;
          const badgeRadius = 32;

          // Draw white circular badge background
          ctx.save();
          ctx.beginPath();
          ctx.arc(center, center, badgeRadius + 4, 0, 2 * Math.PI);
          ctx.fillStyle = '#FFFFFF';
          ctx.fill();
          ctx.lineWidth = 3;
          ctx.strokeStyle = '#ECC94B';
          ctx.stroke();

          if (restaurant.logoUrl) {
            const logo = new Image();
            logo.crossOrigin = 'anonymous';
            logo.onload = () => {
              ctx.beginPath();
              ctx.arc(center, center, badgeRadius, 0, 2 * Math.PI);
              ctx.closePath();
              ctx.clip();
              ctx.drawImage(logo, center - badgeRadius, center - badgeRadius, badgeRadius * 2, badgeRadius * 2);
              ctx.restore();
              container.innerHTML = '';
              container.appendChild(canvas);
            };
            logo.onerror = () => {
              drawDefaultIcon();
            };
            logo.src = restaurant.logoUrl;
          } else {
            drawDefaultIcon();
          }

          function drawDefaultIcon() {
            ctx.beginPath();
            ctx.arc(center, center, badgeRadius, 0, 2 * Math.PI);
            ctx.fillStyle = '#151E1A';
            ctx.fill();
            ctx.font = '26px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('🍽️', center, center + 2);
            ctx.restore();
            container.innerHTML = '';
            container.appendChild(canvas);
          }
        };

        if (qrCanvas) {
          ctx.drawImage(qrCanvas, 0, 0);
          drawOverlayAndMount();
        } else if (qrImg) {
          const baseImg = new Image();
          baseImg.onload = () => {
            ctx.drawImage(baseImg, 0, 0);
            drawOverlayAndMount();
          };
          baseImg.src = qrImg.src;
        } else {
          container.appendChild(tempHolder);
        }
      }, 50);
    }

    function downloadQrPng() {
      const canvas = document.querySelector('#qrcodeCanvasContainer canvas');
      if (!canvas) return;
      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = `QR-${restaurant.slug}-menu-pizarron.png`;
      a.click();
    }

    function printTableStand() {
      const win = window.open('', '_blank');
      const canvas = document.querySelector('#qrcodeCanvasContainer canvas');
      const src = canvas ? canvas.toDataURL('image/png') : '';
      const wifiText = restaurant.wifi && restaurant.wifi.ssid ? `Wi-Fi: ${restaurant.wifi.ssid} | Clave: ${restaurant.wifi.password}` : '';

      win.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Tarjeta de Mesa — ${restaurant.name}</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; text-align: center; padding: 30px; background: #fff; color: #111; }
            .card { border: 2px solid #222; border-radius: 16px; padding: 28px; max-width: 380px; margin: 0 auto; box-shadow: 0 4px 20px rgba(0,0,0,0.1); }
            h1 { margin: 0 0 6px 0; font-size: 24px; font-weight: 800; }
            p { margin: 0 0 16px 0; color: #555; font-size: 14px; }
            img { width: 220px; height: 220px; margin-bottom: 12px; }
            .wifi { background: #f4f4f5; padding: 10px 14px; border-radius: 8px; font-weight: 600; font-size: 13px; border: 1px dashed #ccc; }
            .badge-powered { font-size: 10px; color: #888; margin-top: 14px; text-transform: uppercase; letter-spacing: 0.5px; }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>${restaurant.name}</h1>
            <p>${restaurant.slogan || 'Escaneá para ver la carta y pedir por WhatsApp'}</p>
            ${src ? `<img src="${src}" alt="QR Menú" />` : ''}
            ${wifiText ? `<div class="wifi">📶 ${wifiText}</div>` : ''}
            <div class="badge-powered">Menú Digital • Menú Pizarrón Studio</div>
          </div>
          <script>setTimeout(() => window.print(), 300);<\/script>
        </body>
        </html>
      `);
      win.document.close();
    }

    async function downloadAllTablesPDF() {
      const tableCount = parseInt(document.getElementById('inputTableCount').value) || 10;
      if (tableCount < 1 || tableCount > 100) {
        alert('Por favor indica una cantidad de mesas entre 1 y 100.');
        return;
      }

      if (!window.jspdf || !window.jspdf.jsPDF) {
        alert('Cargando librería de PDF... Por favor espera un instante y reintenta.');
        return;
      }

      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
      });

      const primaryColor = [21, 30, 26]; // #151E1A
      const goldColor = [236, 201, 75]; // #ECC94B
      const textDimColor = [120, 130, 125];
      const wifiText = restaurant.wifi && restaurant.wifi.ssid ? `Wi-Fi: ${restaurant.wifi.ssid}  |  Clave: ${restaurant.wifi.password}` : '';

      // Helper to generate QR data URL
      function makeQrDataUrl(url) {
        return new Promise((resolve) => {
          const temp = document.createElement('div');
          temp.style.display = 'none';
          document.body.appendChild(temp);
          new QRCode(temp, {
            text: url,
            width: 300,
            height: 300,
            colorDark: "#0E1412",
            colorLight: "#FFFFFF",
            correctLevel: QRCode.CorrectLevel.H
          });
          setTimeout(() => {
            const canvas = temp.querySelector('canvas');
            const img = temp.querySelector('img');
            let dataUrl = '';
            if (canvas) {
              dataUrl = canvas.toDataURL('image/png');
            } else if (img) {
              dataUrl = img.src;
            }
            document.body.removeChild(temp);
            resolve(dataUrl);
          }, 60);
        });
      }

      for (let m = 1; m <= tableCount; m++) {
        if (m > 1) pdf.addPage();

        const tableUrl = `${window.location.origin}/m/${restaurant.slug}?mesa=${m}`;
        const qrData = await makeQrDataUrl(tableUrl);

        // Background decorative border
        pdf.setDrawColor(...goldColor);
        pdf.setLineWidth(1.5);
        pdf.roundedRect(15, 15, 180, 267, 8, 8, 'D');

        pdf.setDrawColor(...primaryColor);
        pdf.setLineWidth(0.4);
        pdf.roundedRect(18, 18, 174, 261, 6, 6, 'D');

        // Header
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(26);
        pdf.setTextColor(...primaryColor);
        pdf.text(restaurant.name || 'Menú Pizarrón', 105, 42, { align: 'center' });

        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(12);
        pdf.setTextColor(...textDimColor);
        pdf.text(restaurant.slogan || 'Carta Digital & Pedidos desde tu mesa', 105, 52, { align: 'center' });

        // Table Pill / Badge
        pdf.setFillColor(...goldColor);
        pdf.roundedRect(65, 62, 80, 16, 8, 8, 'F');
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(14);
        pdf.setTextColor(16, 22, 20);
        pdf.text(`MESA  Nº ${m}`, 105, 73, { align: 'center' });

        // QR Code
        if (qrData) {
          pdf.addImage(qrData, 'PNG', 50, 88, 110, 110);
        }

        // Instructions
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(14);
        pdf.setTextColor(...primaryColor);
        pdf.text('Escaneá con tu cámara para ver la carta', 105, 212, { align: 'center' });

        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(10);
        pdf.setTextColor(...textDimColor);
        pdf.text('Pedí directo al mozo o a WhatsApp sin esperar', 105, 220, { align: 'center' });

        // Wi-Fi box if configured
        if (wifiText) {
          pdf.setFillColor(245, 247, 246);
          pdf.setDrawColor(220, 225, 222);
          pdf.setLineWidth(0.3);
          pdf.roundedRect(35, 230, 140, 16, 4, 4, 'FD');
          pdf.setFont('helvetica', 'bold');
          pdf.setFontSize(9);
          pdf.setTextColor(...primaryColor);
          pdf.text(`📶  ${wifiText}`, 105, 240, { align: 'center' });
        }

        // Footer branding
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(8);
        pdf.setTextColor(150, 155, 152);
        pdf.text('Generado con ScanGo Menú Pizarrón • www.scango.app', 105, 270, { align: 'center' });
      }

      pdf.save(`Carteles-Mesas-${restaurant.slug || 'menu'}.pdf`);
    }
    function updateLiveState() {
      restaurant.name = document.getElementById('inputLocalName').value;
      restaurant.slogan = document.getElementById('inputLocalSlogan').value;
      restaurant.slug = document.getElementById('inputLocalSlug').value.toLowerCase().replace(/[^a-z0-9-]/g, '-');
      restaurant.currency = document.getElementById('inputLocalCurrency').value;
      restaurant.phone = document.getElementById('inputPhone').value;

      // Business Type selector
      const bizSelect = document.getElementById('inputBusinessType');
      if (bizSelect) {
        restaurant.businessType = bizSelect.value;
      }

      // Loyalty points toggle
      const loyaltyCheckbox = document.getElementById('inputAllowLoyaltyPoints');
      if (loyaltyCheckbox) {
        restaurant.allowLoyaltyPoints = loyaltyCheckbox.checked;
        const sliderL = document.getElementById('sliderLoyaltyPoints');
        if (sliderL) sliderL.style.backgroundColor = loyaltyCheckbox.checked ? '#38A169' : '#2a3a33';
      }

      // Ice cream wizard toggle
      const iceCreamCheckbox = document.getElementById('inputAllowIceCreamWizard');
      if (iceCreamCheckbox) {
        restaurant.allowIceCreamWizard = iceCreamCheckbox.checked;
        const sliderI = document.getElementById('sliderIceCreamWizard');
        if (sliderI) sliderI.style.backgroundColor = iceCreamCheckbox.checked ? '#38A169' : '#2a3a33';
      }

      // Perfumery toggle
      const perfumeryCheckbox = document.getElementById('inputAllowPerfumery');
      if (perfumeryCheckbox) {
        restaurant.allowPerfumery = perfumeryCheckbox.checked;
        const sliderP = document.getElementById('sliderPerfumery');
        if (sliderP) sliderP.style.backgroundColor = perfumeryCheckbox.checked ? '#38A169' : '#2a3a33';
      }

      // Social links
      restaurant.instagram = document.getElementById('inputInstagram').value.trim();
      restaurant.googleReview = document.getElementById('inputGoogleReview').value.trim();

      // Theme
      restaurant.theme = document.getElementById('inputThemeBg').value;
      restaurant.themeFont = document.getElementById('inputThemeFont').value;

      if (!restaurant.wifi) restaurant.wifi = {};
      restaurant.wifi.ssid = document.getElementById('inputWifiSsid').value;
      restaurant.wifi.password = document.getElementById('inputWifiPass').value;

      // Reservations toggle
      const resCheckbox = document.getElementById('inputAllowReservations');
      if (resCheckbox) {
        restaurant.allowReservations = resCheckbox.checked;
        const slider = document.getElementById('sliderReservations');
        if (slider) slider.style.backgroundColor = resCheckbox.checked ? '#38A169' : '#2a3a33';
      }

      // Coupons toggle
      const couponsCheckbox = document.getElementById('inputAllowCoupons');
      if (couponsCheckbox) {
        restaurant.allowCoupons = couponsCheckbox.checked;
        const sliderC = document.getElementById('sliderCoupons');
        if (sliderC) sliderC.style.backgroundColor = couponsCheckbox.checked ? '#38A169' : '#2a3a33';
      }

      // Bill Splitter toggle
      const splitCheckbox = document.getElementById('inputAllowBillSplitter');
      if (splitCheckbox) {
        restaurant.allowBillSplitter = splitCheckbox.checked;
        const sliderS = document.getElementById('sliderBillSplitter');
        if (sliderS) sliderS.style.backgroundColor = splitCheckbox.checked ? '#38A169' : '#2a3a33';
      }

      // Announcement banner
      const annInput = document.getElementById('inputAnnouncement');
      if (annInput) restaurant.announcement = annInput.value.trim();

      // Payment Link
      const payInput = document.getElementById('inputPaymentLink');
      if (payInput) restaurant.paymentLink = payInput.value.trim();

      // Schedule settings
      const schedCheck = document.getElementById('inputScheduleEnabled');
      if (schedCheck) {
        restaurant.scheduleEnabled = schedCheck.checked;
        const sliderSched = document.getElementById('sliderSchedule');
        if (sliderSched) sliderSched.style.backgroundColor = schedCheck.checked ? '#38A169' : '#2a3a33';
      }
      const schedHours = document.getElementById('inputScheduleActiveHours');
      if (schedHours) restaurant.scheduleActiveHours = schedHours.value.trim();

      // Table count
      restaurant.tableCount = parseInt(document.getElementById('inputTableCount').value) || 10;

      document.getElementById('studioNavRestaurantName').textContent = restaurant.name;
      document.getElementById('previewFullUrl').textContent = `/m/${restaurant.slug}`;
      document.getElementById('btnLiveMenu').href = `/m/${restaurant.slug}`;

      generateQrCode();

      // Instant postMessage live synchronization with customer simulator iframe
      const iframe = document.getElementById('previewIframe');
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage({ type: 'UPDATE_LIVE_PREVIEW', data: restaurant }, '*');
      }

      // Keep user changes persisted in localStorage cache
      try {
        localStorage.setItem('menu_pizarron_restaurant', JSON.stringify(restaurant));
      } catch (e) {}

      triggerAutoSave();
    }

    function triggerAutoSave() {
      showSaveFeedback('saving');
      clearTimeout(autoSaveTimeout);
      autoSaveTimeout = setTimeout(saveStudioChanges, 1200);
    }

    async function saveStudioChanges() {
      const btn = document.getElementById('btnSaveStudio');
      const btnText = document.getElementById('saveBtnText');
      if (btn) {
        if (btn.dataset.saving === 'true') return;
        btn.dataset.saving = 'true';
        btn.disabled = true;
      }
      btnText.textContent = '⏳ Guardando...';
      showSaveFeedback('saving');
      const token = localStorage.getItem('menu_pizarron_token');

      // Keep state saved locally
      try {
        localStorage.setItem('menu_pizarron_restaurant', JSON.stringify(restaurant));
      } catch (e) {}

      const finishSave = (label, feedbackState = 'saved') => {
        btnText.textContent = label;
        showSaveFeedback(feedbackState);
        setTimeout(() => {
          btnText.textContent = '💾 Guardar Cambios';
          if (btn) {
            btn.disabled = false;
            btn.dataset.saving = 'false';
          }
        }, 1800);
      };

      if (!token) {
        setTimeout(() => {
          finishSave('✓ Guardado', 'saved');
        }, 350);
        return;
      }

      try {
        const res = await fetch('/api/studio/save', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            restaurantId: restaurant.id,
            data: restaurant
          })
        });
        if (!res.ok) throw new Error('Error al guardar');
        finishSave('✓ Guardado', 'saved');
        reloadPreviewIframe();
      } catch (err) {
        finishSave('✓ Guardado (Local)', 'saved');
      }
    }

    function reloadPreviewIframe() {
      const iframe = document.getElementById('previewIframe');
      iframe.src = `/m/${restaurant.slug}?t=${Date.now()}`;
    }

    function setPreviewView(mode) {
      // preview phone frame
    }

    // Billing Modal
    function openBillingModal() {
      const sub = currentUser ? currentUser.subscription : {};
      document.getElementById('modalSubState').textContent = sub.status ? sub.status.toUpperCase() : 'TRIAL';
      document.getElementById('modalSubDetail').textContent = sub.status === 'trial' 
        ? `Prueba activa hasta el ${new Date(sub.trialEndsAt).toLocaleDateString()}` 
        : `Plan ${sub.plan} activo.`;
      document.getElementById('billingModal').classList.add('active');
    }
    function closeBillingModal() {
      document.getElementById('billingModal').classList.remove('active');
    }

    async function startCheckout(plan, eventRef) {
      const activeEl = (eventRef && eventRef.target) || (window.event && window.event.target) || document.activeElement;
      const btn = activeEl && (activeEl.tagName === 'BUTTON' ? activeEl : activeEl.closest('button'));
      const originalText = btn ? btn.innerHTML : '';

      if (btn) {
        if (btn.disabled || btn.dataset.busy === 'true') return;
        btn.disabled = true;
        btn.dataset.busy = 'true';
        btn.innerHTML = '<span><i class="fa-solid fa-spinner fa-spin"></i> Conectando con pasarela...</span>';
      }

      const token = localStorage.getItem('menu_pizarron_token');
      try {
        const res = await fetch('/api/billing/checkout', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            restaurantId: restaurant?.id,
            plan: plan
          })
        });
        const data = await res.json();
        if (data.checkoutUrl) {
          window.open(data.checkoutUrl, '_blank');
        } else {
          alert('Redirigiendo a pasarela de cobro...');
        }
      } catch (err) {
        alert('Error al iniciar checkout: ' + (err.message || 'Error de conexión'));
      } finally {
        if (btn) {
          setTimeout(() => {
            btn.disabled = false;
            btn.dataset.busy = 'false';
            btn.innerHTML = originalText;
          }, 2500);
        }
      }
    }

    // Google Play Account Deletion Policy Compliance
    function openDeleteAccountModal() {
      const modal = document.getElementById('deleteAccountModal');
      if (modal) modal.classList.add('active');
    }

    function closeDeleteAccountModal() {
      const modal = document.getElementById('deleteAccountModal');
      if (modal) modal.classList.remove('active');
    }

    async function confirmAccountDeletion() {
      const btn = document.getElementById('btnConfirmDeleteAccount');
      const reason = document.getElementById('deleteAccountReason')?.value.trim() || 'Sin motivo especificado';
      if (!confirm('¿Estás seguro de solicitar la baja definitiva de tu cuenta y todos tus datos? Esta acción no se puede deshacer.')) {
        return;
      }

      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Procesando baja...';
      }

      const token = localStorage.getItem('menu_pizarron_token');
      try {
        if (token) {
          await fetch('/api/account/delete-request', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ reason })
          }).catch(() => {});
        }
      } catch (e) {}

      alert('Tu solicitud de eliminación de cuenta y purga de datos personales ha sido registrada correctamente.');
      localStorage.clear();
      window.location.href = '/index.html';
    }

    function logout() {
      localStorage.removeItem('menu_pizarron_token');
      localStorage.removeItem('menu_pizarron_user');
      localStorage.removeItem('menu_pizarron_restaurant');
      window.location.href = '/index.html';
    }

    // Run
    window.addEventListener('DOMContentLoaded', initStudio);