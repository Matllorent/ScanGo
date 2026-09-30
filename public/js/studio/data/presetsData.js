// public/js/studio/data/presetsData.js
// Catálogo completo de presets de platos para el Studio.

export const PRESETS = {
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
