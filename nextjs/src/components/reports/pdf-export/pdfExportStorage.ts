import {
  DEFAULT_PDF_EXPORT_OPTIONS,
  detectMatchingTemplate,
  type InkSaverMode,
  type PdfExportOptions,
} from './pdfExportOptions';

const PREFS_STORAGE_KEY = 'codex:report-pdf-prefs:v1';
const LOGO_STORAGE_KEY = 'codex:report-pdf-logo:v1';

interface StoredPrefsV1 {
  sections?: Partial<PdfExportOptions['sections']>;
  questionQualityMode?: PdfExportOptions['questionQualityMode'];
  inkSaverMode?: InkSaverMode;
  /** Campo legado booleano migrado automaticamente para inkSaverMode */
  inkSaver?: boolean;
  sectionPerPage?: boolean;
  density?: PdfExportOptions['density'];
  footerText?: string;
}

function normalizeInkSaverMode(stored: StoredPrefsV1): InkSaverMode {
  if (
    stored.inkSaverMode === 'original' ||
    stored.inkSaverMode === 'eco' ||
    stored.inkSaverMode === 'max'
  ) {
    return stored.inkSaverMode;
  }
  if (typeof stored.inkSaver === 'boolean') {
    return stored.inkSaver ? 'eco' : 'original';
  }
  return DEFAULT_PDF_EXPORT_OPTIONS.inkSaverMode;
}

export function loadPdfExportOptions(): PdfExportOptions {
  if (typeof window === 'undefined') {
    return {
      ...DEFAULT_PDF_EXPORT_OPTIONS,
      sections: { ...DEFAULT_PDF_EXPORT_OPTIONS.sections },
    };
  }

  let storedPrefs: StoredPrefsV1 = {};
  let storedLogo: string | null = null;

  try {
    const raw = window.localStorage.getItem(PREFS_STORAGE_KEY);
    if (raw) {
      storedPrefs = JSON.parse(raw) as StoredPrefsV1;
    }
  } catch {
    storedPrefs = {};
  }

  try {
    const rawLogo = window.localStorage.getItem(LOGO_STORAGE_KEY);
    if (rawLogo && rawLogo.startsWith('data:image/')) {
      storedLogo = rawLogo;
    }
  } catch {
    storedLogo = null;
  }

  const sections: PdfExportOptions['sections'] = {
    ...DEFAULT_PDF_EXPORT_OPTIONS.sections,
    ...(storedPrefs.sections ?? {}),
  };

  const questionQualityMode =
    storedPrefs.questionQualityMode === 'highlights' ? 'highlights' : 'full';
  const inkSaverMode = normalizeInkSaverMode(storedPrefs);
  const sectionPerPage = Boolean(
    storedPrefs.sectionPerPage ?? DEFAULT_PDF_EXPORT_OPTIONS.sectionPerPage,
  );
  const density = storedPrefs.density === 'compact' ? 'compact' : 'comfortable';
  const footerText =
    typeof storedPrefs.footerText === 'string' ? storedPrefs.footerText.slice(0, 140) : '';

  const templateId = detectMatchingTemplate({
    sections,
    questionQualityMode,
    inkSaverMode,
    sectionPerPage,
    density,
  });

  return {
    templateId,
    sections,
    questionQualityMode,
    inkSaverMode,
    sectionPerPage,
    density,
    footerText,
    logoDataUrl: storedLogo,
  };
}

export function savePdfExportOptions(options: PdfExportOptions): void {
  if (typeof window === 'undefined') return;

  try {
    const payload: StoredPrefsV1 = {
      sections: options.sections,
      questionQualityMode: options.questionQualityMode,
      inkSaverMode: options.inkSaverMode,
      sectionPerPage: options.sectionPerPage,
      density: options.density,
      footerText: options.footerText.slice(0, 140),
    };
    window.localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignora quota exceeded em ambientes restritos
  }

  try {
    if (options.logoDataUrl) {
      window.localStorage.setItem(LOGO_STORAGE_KEY, options.logoDataUrl);
    } else {
      window.localStorage.removeItem(LOGO_STORAGE_KEY);
    }
  } catch {
    // Ignora quota exceeded
  }
}

export function resetPdfExportOptionsStorage(): PdfExportOptions {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem(PREFS_STORAGE_KEY);
      window.localStorage.removeItem(LOGO_STORAGE_KEY);
    } catch {
      // Ignora
    }
  }
  return {
    ...DEFAULT_PDF_EXPORT_OPTIONS,
    sections: { ...DEFAULT_PDF_EXPORT_OPTIONS.sections },
  };
}
