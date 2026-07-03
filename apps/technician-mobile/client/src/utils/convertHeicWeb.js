// client/src/utils/convertHeicWeb.js
// Конвертирует File(.heic) → Blob(JPEG)
import heic2any from "heic2any";

export async function convertIfHeic(file) {
  const isHeic =
    file &&
    (file.type === "image/heic" ||
      file.type === "image/heif" ||
      /\.heic$/i.test(file.name) ||
      /\.heif$/i.test(file.name));

  if (!isHeic) return file; // не HEIC — возвращаем как есть

  // Конвертация в JPEG (качество можно подправить)
  const jpegBlob = await heic2any({
    blob: file,
    toType: "image/jpeg",
    quality: 0.9,
  });

  // Сохраняем имя *.jpg для красоты
  const jpegFile = new File([jpegBlob], file.name.replace(/\.(heic|heif)$/i, ".jpg"), {
    type: "image/jpeg",
    lastModified: Date.now(),
  });

  return jpegFile;
}
