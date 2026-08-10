export type ImagePreset =
  | "request"
  | "chat"
  | "review"
  | "workProgress"
  | "workshopGallery"
  | "logo";

export type ImageOutputFormatPolicy =
  | "jpeg"
  | "source"
  | "transparentPngOtherwiseJpeg";

export type ImagePresetConfig = {
  maxLongEdge: number;
  maxSizeMB: number;
  quality: number;
  outputFormat: ImageOutputFormatPolicy;
};

export const IMAGE_PRESETS: Record<ImagePreset, ImagePresetConfig> = {
  request: {
    maxLongEdge: 2048,
    maxSizeMB: 1.5,
    quality: 0.82,
    outputFormat: "jpeg",
  },
  chat: {
    maxLongEdge: 1600,
    maxSizeMB: 0.8,
    // Size settings match Chat today, but this preset intentionally normalizes
    // PNG and browser-decodable HEIC/HEIF inputs to JPEG.
    quality: 1,
    outputFormat: "jpeg",
  },
  review: {
    maxLongEdge: 1600,
    maxSizeMB: 0.8,
    quality: 0.8,
    outputFormat: "jpeg",
  },
  workProgress: {
    maxLongEdge: 1600,
    maxSizeMB: 0.8,
    quality: 0.8,
    outputFormat: "jpeg",
  },
  workshopGallery: {
    maxLongEdge: 1600,
    maxSizeMB: 1,
    quality: 0.82,
    outputFormat: "jpeg",
  },
  logo: {
    maxLongEdge: 768,
    maxSizeMB: 0.5,
    quality: 0.85,
    outputFormat: "transparentPngOtherwiseJpeg",
  },
};
