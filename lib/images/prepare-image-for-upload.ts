import imageCompression from "browser-image-compression";
import {
  IMAGE_PRESETS,
  type ImagePreset,
  type ImageOutputFormatPolicy,
} from "@/lib/images/image-presets";

type PreparedImageFormat = "jpeg" | "png" | "webp";
type PreparedImageContentType = "image/jpeg" | "image/png" | "image/webp";
type PreparedImageExtension = "jpg" | "png" | "webp";

export type PreparedImage = {
  file: File;
  originalName: string;
  contentType: PreparedImageContentType;
  extension: PreparedImageExtension;
  preset: ImagePreset;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  originalSize: number;
  finalSize: number;
  targetSizeMet: boolean;
};

export type PrepareImageForUploadOptions = {
  preset: ImagePreset;
  signal?: AbortSignal;
};

type ImageDimensions = {
  width: number;
  height: number;
};

function getAbortError(signal?: AbortSignal) {
  return signal?.reason instanceof Error
    ? signal.reason
    : new DOMException("Operația a fost anulată.", "AbortError");
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw getAbortError(signal);
  }
}

function loadImage(
  file: File,
  signal?: AbortSignal,
): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(getAbortError(signal));
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    let settled = false;

    const cleanup = () => {
      URL.revokeObjectURL(objectUrl);
      signal?.removeEventListener("abort", handleAbort);
    };

    const handleAbort = () => {
      if (settled) return;
      settled = true;
      image.src = "";
      cleanup();
      reject(getAbortError(signal));
    };

    image.onload = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(image);
    };
    image.onerror = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("Imaginea nu a putut fi decodată."));
    };
    signal?.addEventListener("abort", handleAbort, { once: true });
    image.src = objectUrl;
  });
}

function hasTransparency(
  image: HTMLImageElement,
  signal?: AbortSignal,
): boolean {
  throwIfAborted(signal);
  const scale = Math.min(
    1,
    512 / Math.max(image.naturalWidth, image.naturalHeight),
  );
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");

  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d", { willReadFrequently: true });

  if (!context) {
    throw new Error("Canvas nu este disponibil pentru procesarea imaginii.");
  }

  try {
    context.drawImage(image, 0, 0, width, height);

    const pixels = context.getImageData(0, 0, width, height).data;

    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] < 255) {
        return true;
      }
    }

    return false;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
    throwIfAborted(signal);
  }
}

function replaceExtension(fileName: string, extension: PreparedImageExtension) {
  const baseName = fileName.replace(/\.[^/.]+$/, "") || "image";
  return `${baseName}.${extension}`;
}

function getFormatMetadata(format: PreparedImageFormat): {
  contentType: PreparedImageContentType;
  extension: PreparedImageExtension;
} {
  if (format === "png") {
    return { contentType: "image/png", extension: "png" };
  }

  if (format === "webp") {
    return { contentType: "image/webp", extension: "webp" };
  }

  return { contentType: "image/jpeg", extension: "jpg" };
}

function getSourceFormat(file: File): PreparedImageFormat {
  if (file.type === "image/jpeg" || file.type === "image/jpg") return "jpeg";
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";

  throw new Error(
    `Formatul sursă "${file.type || "necunoscut"}" nu poate fi păstrat.`,
  );
}

function getOutputFormat(
  policy: ImageOutputFormatPolicy,
  file: File,
  transparentPng: boolean,
): PreparedImageFormat {
  if (policy === "source") return getSourceFormat(file);
  if (policy === "transparentPngOtherwiseJpeg" && transparentPng) return "png";
  return "jpeg";
}

function isHeicOrHeif(file: File) {
  return (
    file.type === "image/heic" ||
    file.type === "image/heif" ||
    (!file.type && /\.(heic|heif)$/i.test(file.name))
  );
}

function normalizeHeicMimeType(file: File) {
  if (file.type || !/\.(heic|heif)$/i.test(file.name)) return file;

  const contentType = /\.heif$/i.test(file.name) ? "image/heif" : "image/heic";
  return new File([file], file.name, {
    type: contentType,
    lastModified: file.lastModified,
  });
}

async function readDimensions(
  file: File,
  signal?: AbortSignal,
): Promise<ImageDimensions> {
  const image = await loadImage(file, signal);
  const dimensions = {
    width: image.naturalWidth,
    height: image.naturalHeight,
  };

  image.src = "";
  return dimensions;
}

async function validateFileSignature(
  file: File,
  format: PreparedImageFormat,
  signal?: AbortSignal,
) {
  throwIfAborted(signal);
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  throwIfAborted(signal);

  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng =
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a;
  const isWebp =
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";

  if (
    (format === "jpeg" && !isJpeg) ||
    (format === "png" && !isPng) ||
    (format === "webp" && !isWebp)
  ) {
    throw new Error(
      "Conținutul binar al imaginii nu corespunde formatului declarat.",
    );
  }
}

function normalizeFile(
  file: File,
  originalName: string,
  format: PreparedImageFormat,
): Pick<PreparedImage, "file" | "contentType" | "extension"> {
  const { contentType, extension } = getFormatMetadata(format);

  return {
    file: new File([file], replaceExtension(originalName, extension), {
      type: contentType,
      lastModified: file.lastModified,
    }),
    contentType,
    extension,
  };
}

export async function prepareImageForUpload(
  file: File,
  options: PrepareImageForUploadOptions,
): Promise<PreparedImage> {
  const heicOrHeif = isHeicOrHeif(file);

  if (!file.type.startsWith("image/") && !(heicOrHeif && !file.type)) {
    throw new TypeError("Fișierul selectat nu este o imagine.");
  }

  const config = IMAGE_PRESETS[options.preset];
  const inputFile = normalizeHeicMimeType(file);

  try {
    throwIfAborted(options.signal);
    const sourceImage = await loadImage(inputFile, options.signal);
    const originalWidth = sourceImage.naturalWidth;
    const originalHeight = sourceImage.naturalHeight;
    let transparentPng = false;

    try {
      transparentPng =
        config.outputFormat === "transparentPngOtherwiseJpeg" &&
        inputFile.type === "image/png" &&
        hasTransparency(sourceImage, options.signal);
    } finally {
      sourceImage.src = "";
    }

    const format = getOutputFormat(
      config.outputFormat,
      inputFile,
      transparentPng,
    );
    const { contentType } = getFormatMetadata(format);
    const compressedFile = await imageCompression(inputFile, {
      maxSizeMB: config.maxSizeMB,
      maxWidthOrHeight: config.maxLongEdge,
      initialQuality: config.quality,
      fileType: contentType,
      preserveExif: false,
      signal: options.signal,
      useWebWorker: true,
    });

    if (compressedFile.type !== contentType) {
      throw new Error(
        `Compresorul a returnat "${compressedFile.type}" în loc de "${contentType}".`,
      );
    }

    await validateFileSignature(compressedFile, format, options.signal);
    const normalized = normalizeFile(compressedFile, file.name, format);
    const finalDimensions = await readDimensions(normalized.file, options.signal);
    const targetSizeBytes = config.maxSizeMB * 1024 * 1024;

    return {
      ...normalized,
      originalName: file.name,
      preset: options.preset,
      width: finalDimensions.width,
      height: finalDimensions.height,
      originalWidth,
      originalHeight,
      originalSize: file.size,
      finalSize: normalized.file.size,
      targetSizeMet: normalized.file.size <= targetSizeBytes,
    };
  } catch (error) {
    if (options.signal?.aborted) {
      throw getAbortError(options.signal);
    }

    if (heicOrHeif) {
      throw new Error(
        `Imaginea HEIC/HEIF "${file.name}" nu poate fi decodată de acest browser.`,
        { cause: error },
      );
    }

    throw new Error(
      `Imaginea "${file.name}" nu a putut fi pregătită pentru upload.`,
      { cause: error },
    );
  }
}
