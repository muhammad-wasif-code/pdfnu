export type Category = 'Optimize' | 'Organize' | 'Convert' | 'Security' | 'Edit' | 'Image';

export interface Tool {
  slug: string;
  name: string;
  /** Short name used on compact (mobile) cards */
  short: string;
  /** Card subtitle */
  tagline: string;
  category: Category;
  /** Two gradient stops for the icon tile */
  from: string;
  to: string;
  /** Icon glyph key (see ToolIcon) */
  icon: string;
  keywords: string;
}

export const tools: Tool[] = [
  { slug: 'compress-pdf', name: 'Compress PDF', short: 'Compress PDF', tagline: 'Reduce file size', category: 'Optimize', from: '#fb7185', to: '#e11d48', icon: 'compress', keywords: 'compress pdf reduce shrink size kb mb smaller' },
  { slug: 'merge-pdf', name: 'Merge PDF', short: 'Merge PDF', tagline: 'Combine files', category: 'Organize', from: '#60a5fa', to: '#2563eb', icon: 'merge', keywords: 'merge pdf combine join files' },
  { slug: 'split-pdf', name: 'Split PDF', short: 'Split PDF', tagline: 'Extract pages', category: 'Organize', from: '#4ade80', to: '#16a34a', icon: 'split', keywords: 'split pdf extract pages separate ranges' },
  { slug: 'jpg-to-pdf', name: 'JPG to PDF', short: 'JPG to PDF', tagline: 'Convert images', category: 'Convert', from: '#fbbf24', to: '#ea580c', icon: 'img2pdf', keywords: 'jpg to pdf image png webp convert photo' },
  { slug: 'pdf-to-jpg', name: 'PDF to JPG', short: 'PDF to JPG', tagline: 'Extract images', category: 'Convert', from: '#a78bfa', to: '#7c3aed', icon: 'pdf2img', keywords: 'pdf to jpg image png convert export pages' },
  { slug: 'rotate-pdf', name: 'Rotate PDF', short: 'Rotate PDF', tagline: 'Rotate pages', category: 'Organize', from: '#2dd4bf', to: '#0d9488', icon: 'rotate', keywords: 'rotate pdf turn pages orientation landscape' },
  { slug: 'organize-pdf', name: 'Organize Pages', short: 'Organize', tagline: 'Reorder pages', category: 'Organize', from: '#34d399', to: '#059669', icon: 'organize', keywords: 'organize pdf reorder delete remove pages sort' },
  { slug: 'watermark-pdf', name: 'Watermark', short: 'Watermark', tagline: 'Add watermark', category: 'Edit', from: '#f472b6', to: '#db2777', icon: 'watermark', keywords: 'watermark pdf stamp text image logo' },
  { slug: 'protect-pdf', name: 'Protect PDF', short: 'Protect', tagline: 'Add password', category: 'Security', from: '#60a5fa', to: '#4f46e5', icon: 'protect', keywords: 'protect pdf password encrypt lock secure' },
  { slug: 'add-page-numbers', name: 'Page Numbers', short: 'Page #', tagline: 'Add page numbers', category: 'Edit', from: '#fdba74', to: '#f97316', icon: 'numbers', keywords: 'page numbers pdf numbering footer header' },
  { slug: 'compress-image', name: 'Compress Image', short: 'Compress Image', tagline: 'Reduce image size', category: 'Image', from: '#4ade80', to: '#0d9488', icon: 'imgcompress', keywords: 'compress image jpg png reduce size kb 20kb 50kb photo' },
  { slug: 'resize-image', name: 'Resize Image', short: 'Resize Image', tagline: 'Change dimensions', category: 'Image', from: '#c084fc', to: '#9333ea', icon: 'resize', keywords: 'resize image pixels dimensions passport photo signature' },
  { slug: 'edit-pdf', name: 'Edit PDF', short: 'Edit PDF', tagline: 'Add text & images', category: 'Edit', from: '#f472b6', to: '#be185d', icon: 'edit', keywords: 'edit pdf add text image highlight shape free editor no watermark write on pdf' },
  { slug: 'sign-pdf', name: 'Sign PDF', short: 'Sign PDF', tagline: 'Add your signature', category: 'Edit', from: '#818cf8', to: '#4338ca', icon: 'sign', keywords: 'sign pdf signature esign draw type electronic signature fill' },
  { slug: 'unlock-pdf', name: 'Unlock PDF', short: 'Unlock', tagline: 'Remove a password you know', category: 'Security', from: '#fbbf24', to: '#d97706', icon: 'unlock', keywords: 'unlock pdf remove password decrypt open protected' },
  { slug: 'passport-photo-maker', name: 'Passport Photo', short: 'Passport Photo', tagline: 'Size, crop & print', category: 'Image', from: '#38bdf8', to: '#0284c7', icon: 'passport', keywords: 'passport photo maker size 35x45 2x2 visa id photo form kb crop print' },
  { slug: 'crop-image', name: 'Crop Image', short: 'Crop Image', tagline: 'Trim photos', category: 'Image', from: '#f87171', to: '#dc2626', icon: 'crop', keywords: 'crop image photo trim cut signature aspect ratio' },
  { slug: 'image-converter', name: 'Image Converter', short: 'Convert Image', tagline: 'JPG, PNG, WebP', category: 'Convert', from: '#2dd4bf', to: '#0891b2', icon: 'convert', keywords: 'image converter jpg to png png to jpg webp to jpg convert format' },
  { slug: 'grayscale-pdf', name: 'Grayscale PDF', short: 'Grayscale', tagline: 'Black & white PDF', category: 'Optimize', from: '#9ca3af', to: '#4b5563', icon: 'grayscale', keywords: 'grayscale pdf black and white convert color remove colour' },
  { slug: 'pdf-to-text', name: 'PDF to Text', short: 'PDF to Text', tagline: 'Extract text', category: 'Convert', from: '#a3e635', to: '#4d7c0f', icon: 'text', keywords: 'pdf to text extract text copy txt convert' },
  { slug: 'fill-pdf-form', name: 'Fill PDF Form', short: 'Fill Form', tagline: 'Complete form fields', category: 'Edit', from: '#60a5fa', to: '#1d4ed8', icon: 'form', keywords: 'fill pdf form fillable fields online type answers application' },
  { slug: 'delete-pdf-pages', name: 'Delete Pages', short: 'Delete Pages', tagline: 'Remove pages', category: 'Organize', from: '#fca5a5', to: '#b91c1c', icon: 'delete', keywords: 'delete pdf pages remove pages blank' },
  { slug: 'extract-pdf-pages', name: 'Extract Pages', short: 'Extract Pages', tagline: 'Save chosen pages', category: 'Organize', from: '#86efac', to: '#15803d', icon: 'extract', keywords: 'extract pdf pages save selected pages new pdf' },
  { slug: 'extract-images-from-pdf', name: 'Extract Images', short: 'PDF Images', tagline: 'Save photos from PDF', category: 'Convert', from: '#fdba74', to: '#c2410c', icon: 'extractimg', keywords: 'extract images from pdf save pictures photos get images' },
  { slug: 'repair-pdf', name: 'Repair PDF', short: 'Repair', tagline: 'Fix damaged files', category: 'Optimize', from: '#94a3b8', to: '#334155', icon: 'repair', keywords: 'repair pdf fix corrupted damaged broken pdf wont open recover' },
  { slug: 'signature-cleaner', name: 'Signature Cleaner', short: 'Clean Signature', tagline: 'Clear background', category: 'Image', from: '#a5b4fc', to: '#4338ca', icon: 'signclean', keywords: 'signature background remove transparent signature png clean scan signature white' },
  { slug: 'crop-pdf', name: 'Crop PDF', short: 'Crop PDF', tagline: 'Trim page margins', category: 'Edit', from: '#fda4af', to: '#be123c', icon: 'croppdf', keywords: 'crop pdf trim margins cut page area whitespace' },
  { slug: 'redact-pdf', name: 'Redact PDF', short: 'Redact', tagline: 'Black out text for real', category: 'Security', from: '#64748b', to: '#0f172a', icon: 'redact', keywords: 'redact pdf black out hide remove sensitive text names numbers censor' },
  { slug: 'scan-to-pdf', name: 'Scan to PDF', short: 'Scan to PDF', tagline: 'Phone camera to PDF', category: 'Convert', from: '#fcd34d', to: '#b45309', icon: 'scan', keywords: 'scan to pdf camera phone photo document scanner scan paper' },
  { slug: 'compare-pdf', name: 'Compare PDF', short: 'Compare', tagline: 'Spot text changes', category: 'Organize', from: '#93c5fd', to: '#1e40af', icon: 'compare', keywords: 'compare pdf diff differences two versions changes text' },
  { slug: 'pdf-to-markdown', name: 'PDF to Markdown', short: 'PDF to MD', tagline: 'Text with headings', category: 'Convert', from: '#c4b5fd', to: '#5b21b6', icon: 'markdown', keywords: 'pdf to markdown md convert headings notes llm chatgpt' },
  { slug: 'pdf-to-powerpoint', name: 'PDF to PowerPoint', short: 'PDF to PPT', tagline: 'Pages to slides', category: 'Convert', from: '#fdba74', to: '#c2410c', icon: 'ppt', keywords: 'pdf to powerpoint ppt pptx slides convert presentation' },
  { slug: 'pdf-to-pdfa', name: 'PDF to PDF/A', short: 'PDF/A', tagline: 'Archive-ready PDF', category: 'Convert', from: '#7dd3fc', to: '#0369a1', icon: 'pdfa', keywords: 'pdf to pdf/a pdfa archive convert iso 19005 long term court filing' },
  { slug: 'ocr-pdf', name: 'OCR PDF', short: 'OCR', tagline: 'Scan to searchable text', category: 'Convert', from: '#5eead4', to: '#0f766e', icon: 'ocr', keywords: 'ocr pdf image to text scanned pdf searchable recognise text extract text from image urdu hindi' },
  { slug: 'heic-to-jpg', name: 'HEIC to JPG', short: 'HEIC to JPG', tagline: 'iPhone photos to JPG', category: 'Image', from: '#f9a8d4', to: '#be185d', icon: 'heic', keywords: 'heic to jpg iphone photo convert heif to jpeg png' },
  { slug: 'combine-images', name: 'Combine Images', short: 'Combine Images', tagline: 'Join photos into one', category: 'Image', from: '#fcd34d', to: '#d97706', icon: 'combine', keywords: 'combine images merge photos join pictures side by side collage stack' },
  { slug: 'resize-pdf', name: 'Resize PDF', short: 'Resize PDF', tagline: 'Change page size', category: 'Edit', from: '#a5f3fc', to: '#0e7490', icon: 'resizepdf', keywords: 'resize pdf page size a4 letter legal change paper size scale pdf' },
  { slug: 'flatten-pdf', name: 'Flatten PDF', short: 'Flatten', tagline: 'Lock forms & comments', category: 'Edit', from: '#cbd5e1', to: '#475569', icon: 'flatten', keywords: 'flatten pdf form fields annotations comments lock make uneditable' },
  { slug: 'header-footer-pdf', name: 'Header & Footer', short: 'Header/Footer', tagline: 'Add text to every page', category: 'Edit', from: '#fde68a', to: '#b45309', icon: 'headerfooter', keywords: 'add header footer pdf text every page date file name page x of y' },
];

export const categories: { name: Category; accent: string }[] = [
  { name: 'Optimize', accent: 'text-rose-600 dark:text-rose-400' },
  { name: 'Organize', accent: 'text-blue-600 dark:text-blue-400' },
  { name: 'Convert', accent: 'text-amber-600 dark:text-amber-400' },
  { name: 'Edit', accent: 'text-pink-600 dark:text-pink-400' },
  { name: 'Security', accent: 'text-violet-600 dark:text-violet-400' },
  { name: 'Image', accent: 'text-sky-600 dark:text-sky-400' },
];

export const getTool = (slug: string) => {
  const t = tools.find((x) => x.slug === slug);
  if (!t) throw new Error(`Unknown tool ${slug}`);
  return t;
};
