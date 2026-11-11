const MAX_FILE_BYTES = 2 * 1024 * 1024; // Aceita arquivo bruto até 2 MB e reamostra para <= 500 KB
const MAX_WIDTH = 600;
const MAX_HEIGHT = 240;

export async function processLogoImageFile(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Selecione um arquivo de imagem válido (PNG, JPG, WebP ou SVG).');
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error('A imagem selecionada excede 2 MB. Escolha um arquivo menor.');
  }

  const rawDataUrl = await readFileAsDataUrl(file);
  const img = await loadImageElement(rawDataUrl);

  const naturalW = img.naturalWidth || img.width || 300;
  const naturalH = img.naturalHeight || img.height || 120;

  const scale = Math.min(1, MAX_WIDTH / naturalW, MAX_HEIGHT / naturalH);
  const targetW = Math.max(1, Math.round(naturalW * scale));
  const targetH = Math.max(1, Math.round(naturalH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Não foi possível processar a imagem no navegador.');
  }

  ctx.clearRect(0, 0, targetW, targetH);
  ctx.drawImage(img, 0, 0, targetW, targetH);

  const pngDataUrl = canvas.toDataURL('image/png');
  if (pngDataUrl.length > 680_000) {
    throw new Error('O logo processado ficou grande demais (> 500 KB). Tente uma imagem mais simples.');
  }

  return pngDataUrl;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Falha ao ler arquivo de imagem.'));
      }
    };
    reader.onerror = () => reject(new Error('Erro ao ler arquivo de imagem.'));
    reader.readAsDataURL(file);
  });
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Não foi possível decodificar a imagem selecionada.'));
    img.src = src;
  });
}
