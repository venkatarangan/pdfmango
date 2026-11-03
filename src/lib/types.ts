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
} & PageEdit & {
  /**
   * Crop chosen in the Crop editor, 0..1 within the page as it shows before any added rotation
   * (within the half, for a split page). Kept apart from `crop`, which Split owns; the worker gets
   * the two combined (see editOf).
   */
  trim?: Crop;
  /** Set by Split book spreads when the split needs a look ("Check split" badge). */
  review?: boolean;
  /** The two halves of a split spread share an id, so the split can be adjusted or undone. */
  spread?: SpreadInfo;
};

/** A rectangle in 0..1 page coordinates (x to the right, y down) of the page as drawn before any added rotation. */
export type Crop = { x0: number; y0: number; x1: number; y1: number };
export type Point = [x: number, y: number];
/** Four corners, normalised like Crop, in the order top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Point, Point, Point, Point];

/**
 * Optional edits on a page. All absent means an untouched page, which exports exactly as before.
 * Applied in this order: corners (photo pages), fineRotation (degrees, clockwise), crop, addedRotation.
 */
export type PageEdit = { fineRotation?: number; crop?: Crop; corners?: Quad };

/** `at` is the spine position (0..1 across the page as it showed when split); `side` says which half this is. */
export type SpreadInfo = { id: string; at: number; overlap: number; side: 'left' | 'right'; rotation: Rotation };

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

export type ExportPage = { sourceId: string; srcIndex: number; addedRotation: Rotation; edit?: PageEdit };

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
