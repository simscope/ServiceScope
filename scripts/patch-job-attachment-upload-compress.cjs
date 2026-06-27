const fs = require('fs');
const path = require('path');

const filePath = path.resolve(__dirname, '../src/components/JobDetailPanel.tsx');
let content = fs.readFileSync(filePath, 'utf8');

if (!content.includes('IMAGE_UPLOAD_MAX_DIMENSION')) {
  content = content.replace(
    `const acceptedFileTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];
const acceptedExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.pdf'];
const materialStatuses: MaterialStatus[] = ['Needed', 'Ordered', 'Received', 'Installed', 'Returned'];`,
    `const acceptedFileTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];
const acceptedExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.pdf'];
const materialStatuses: MaterialStatus[] = ['Needed', 'Ordered', 'Received', 'Installed', 'Returned'];
const IMAGE_UPLOAD_MAX_DIMENSION = 1920;
const IMAGE_UPLOAD_QUALITY = 0.9;`,
  );
}

if (!content.includes('function replaceFileExtension')) {
  content = content.replace(
    `function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}
`,
    `function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

function replaceFileExtension(name: string, extension: string) {
  const cleanName = name.trim() || 'photo';
  const dotIndex = cleanName.lastIndexOf('.');
  return \`\${dotIndex > 0 ? cleanName.slice(0, dotIndex) : cleanName}\${extension}\`;
}

function loadImageElement(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Image could not be loaded'));
    image.src = url;
  });
}

async function compressImageFile(file: File) {
  const isHeic = /\.(heic|heif)$/i.test(file.name) || /heic|heif/i.test(file.type);
  if (!fileKind(file).startsWith('photo') || isHeic) return file;

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImageElement(objectUrl);
    const scale = Math.min(1, IMAGE_UPLOAD_MAX_DIMENSION / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
    const width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
    const height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return file;

    context.drawImage(image, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', IMAGE_UPLOAD_QUALITY));
    if (!blob) return file;

    return new File([blob], replaceFileExtension(file.name, '.jpg'), {
      type: 'image/jpeg',
      lastModified: Date.now(),
    });
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
`,
  );
}

const oldUpload = `    const attachments = await Promise.all(
      files.map(async (file): Promise<JobAttachment> => ({
        id: crypto.randomUUID(),
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
        kind: fileKind(file),
        uploadedAt: new Date().toISOString(),
        dataUrl: fileKind(file) === 'photo' ? await readFileAsDataUrl(file) : undefined,
      })),
    );`;
const newUpload = `    const attachments = await Promise.all(
      files.map(async (file): Promise<JobAttachment> => {
        const preparedFile = fileKind(file) === 'photo' ? await compressImageFile(file) : file;
        const kind = fileKind(preparedFile);

        return {
          id: crypto.randomUUID(),
          name: preparedFile.name,
          mimeType: preparedFile.type || file.type || 'application/octet-stream',
          sizeBytes: preparedFile.size,
          kind,
          uploadedAt: new Date().toISOString(),
          file: preparedFile,
          dataUrl: kind === 'photo' ? await readFileAsDataUrl(preparedFile) : undefined,
        };
      }),
    );`;
content = content.replace(oldUpload, newUpload);

fs.writeFileSync(filePath, content);
console.log('Job attachment upload and photo compression patch applied.');
