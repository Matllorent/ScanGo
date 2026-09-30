// public/js/studio/utils/image.js
// Comprime archivo de imagen a WebP <= 150KB, max 1080px.
// Devuelve { blob, dataUrl }.

export async function compressImageFile(file) {
  const bitmap = await createImageBitmap(file);
  const maxDimension = 1080;
  let scale = Math.min(1, maxDimension / bitmap.width, maxDimension / bitmap.height);
  let blob;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No se pudo procesar la imagen en este navegador.');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    blob = await new Promise((resolve, reject) => {
      canvas.toBlob(result => result ? resolve(result) : reject(new Error('No se pudo comprimir la imagen.')), 'image/webp', 0.8);
    });
    if (blob.type === 'image/webp' && blob.size <= 150 * 1024) break;
    if (blob.type !== 'image/webp') throw new Error('Este navegador no permite exportar imágenes WebP.');
    scale *= 0.85;
  }
  bitmap.close();

  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('No se pudo leer la imagen comprimida.'));
    reader.readAsDataURL(blob);
  });
  return { blob, dataUrl };
}