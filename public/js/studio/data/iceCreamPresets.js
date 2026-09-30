// public/js/studio/data/iceCreamPresets.js
// Presets de heladería (34 sabores).
// Copiado literalmente desde studio.js original. Sin modificaciones.

export const ICE_CREAM_PRESETS_DATA = [
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