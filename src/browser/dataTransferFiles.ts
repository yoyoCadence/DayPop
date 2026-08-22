/** Browser-only text file IO for DP-056. Domain parsing stays in dataTransfer.ts. */

export class BrowserFileError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'BrowserFileError';
    this.cause = cause;
  }
}

export function downloadTextFile(fileName: string, text: string, mimeType: string): void {
  if (typeof URL.createObjectURL !== 'function') {
    throw new BrowserFileError('此瀏覽器無法建立下載檔案。');
  }
  const url = URL.createObjectURL(new Blob([text], { type: mimeType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.hidden = true;
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_500);
  }
}

export function readTextFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new BrowserFileError(`無法讀取「${file.name}」的文字內容。`));
    };
    reader.onerror = () => {
      reject(new BrowserFileError(`讀取「${file.name}」失敗。`, reader.error));
    };
    reader.onabort = () => reject(new BrowserFileError(`已取消讀取「${file.name}」。`));
    reader.readAsText(file, 'UTF-8');
  });
}
