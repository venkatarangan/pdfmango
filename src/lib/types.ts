import type { CompressionPlan } from './compression';

// Shared types for the main thread and the worker.

export type Rotation = 0 | 90 | 180 | 270;
/**
 * 'blank' is a page PDFMango made itself (Insert blank page); 'converted' is a Word or text file
 * turned into PDF pages when it was added. The engine treats both as PDFs.
 */
export type SourceKind = 'pdf' | 'image' | 'blank' | 'converted';

export type Source = {
  id: string;
  name: string;
  kind: SourceKind;
  pageCount: number;
  sizeBytes: number;
};

export type PageRef = {
  uid: string;
  sourceId: string;
  srcIndex: number;
  addedRotation: Rotation;
};

/** Size of a source page in points as it displays (original /Rotate already applied). */
export type PageSize = [width: number, height: number];

export type CompressionLevel = 'lossless' | 'balanced' | 'strong' | 'scan';
export type ImagePageSize = 'A4' | 'original';
export type ImageMargin = 'none' | 'small' | 'medium';

/** Facts about an opened PDF that the UI turns into notices. */
export type PdfNotices = {
  wasRepaired: boolean;
  hasOutline: boolean;
  hasForm: boolean;
  isSigned: boolean;
  wasEncrypted: boolean;
  restricted: boolean;
};

export type OpenResult =
  | { status: 'needs-password'; sourceId: string; wrongPassword?: boolean }
  | { status: 'restricted'; sourceId: string }
  | { status: 'ok'; sourceId: string; pageCount: number; pageSizes: PageSize[]; notices: PdfNotices };

export type AddImageResult = { sourceId: string; widthPx: number; heightPx: number; pageSize: PageSize };

export type ExportPage = { sourceId: string; srcIndex: number; addedRotation: Rotation };

export type ExportOptions = {
  plan: CompressionPlan;
  imagePageSize: ImagePageSize;
  /** Margin around image pages, in points. */
  marginPt: number;
  /** Written to the output's Producer field; empty leaves it unset. */
  creditLine: string;
  /** Written to the output's Title field; empty or missing leaves it unset. */
  title?: string;
};

/** 'auto' picks per page: PNG for text and drawings, JPG for photos. */
export type ImageFormat = 'auto' | 'png' | 'jpg';

export type ImageExportOptions = { dpi: number; format: ImageFormat; jpegQuality: number; maxPixels: number };

export type PageImage = { bytes: ArrayBuffer; ext: 'png' | 'jpg' };

export type ExportProgress = { done: number; total: number; step: string };

export type ExportResult = {
  bytes: ArrayBuffer;
  outputSize: number;
  /** True when the chosen level came out larger than Lossless and the Lossless file was delivered instead. */
  fellBackToLossless: boolean;
};

/** Error codes the worker reports; the UI maps them to friendly messages and analytics `error` events. */
export type EngineErrorCode =
  | 'wrong-password'
  | 'not-a-pdf'
  | 'unreadable'
  | 'image-unreadable'
  | 'word-unreadable'
  | 'out-of-memory'
  | 'cancelled'
  | 'export-failed';
