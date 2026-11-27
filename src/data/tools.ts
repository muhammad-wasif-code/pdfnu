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
  { slug: 'pdf-to-word', name: 'PDF to Word', short: 'PDF to Word', tagline: 'Editable DOCX', category: 'Convert', from: '#93c5fd', to: '#1d4ed8', icon: 'word', keywords: 'pdf to word docx doc convert editable document microsoft word' },
  { slug: 'word-to-pdf', name: 'Word to PDF', short: 'Word to PDF', tagline: 'DOCX to PDF', category: 'Convert', from: '#bfdbfe', to: '#1e40af', icon: 'wordpdf', keywords: 'word to pdf docx to pdf doc convert document microsoft word save as pdf' },
  { slug: 'pdf-to-excel', name: 'PDF to Excel', short: 'PDF to Excel', tagline: 'Tables to XLSX', category: 'Convert', from: '#86efac', to: '#15803d', icon: 'excel', keywords: 'pdf to excel xlsx xls spreadsheet table convert bank statement invoice csv google sheets' },
  { slug: 'excel-to-pdf', name: 'Excel to PDF', short: 'Excel to PDF', tagline: 'XLSX to PDF', category: 'Convert', from: '#bbf7d0', to: '#166534', icon: 'excelpdf', keywords: 'excel to pdf xlsx to pdf xls csv spreadsheet convert fit to page sheet microsoft excel save as pdf' },
  { slug: 'pdf-to-powerpoint', name: 'PDF to PowerPoint', short: 'PDF to PPT', tagline: 'Pages to slides', category: 'Convert', from: '#fdba74', to: '#c2410c', icon: 'ppt', keywords: 'pdf to powerpoint ppt pptx slides convert presentation' },
  { slug: 'pdf-to-pdfa', name: 'PDF to PDF/A', short: 'PDF/A', tagline: 'Archive-ready PDF', category: 'Convert', from: '#7dd3fc', to: '#0369a1', icon: 'pdfa', keywords: 'pdf to pdf/a pdfa archive convert iso 19005 long term court filing' },
  { slug: 'ocr-pdf', name: 'OCR PDF', short: 'OCR', tagline: 'Scan to searchable text', category: 'Convert', from: '#5eead4', to: '#0f766e', icon: 'ocr', keywords: 'ocr pdf image to text scanned pdf searchable recognise text extract text from image urdu hindi' },
  { slug: 'heic-to-jpg', name: 'HEIC to JPG', short: 'HEIC to JPG', tagline: 'iPhone photos to JPG', category: 'Image', from: '#f9a8d4', to: '#be185d', icon: 'heic', keywords: 'heic to jpg iphone photo convert heif to jpeg png' },
  { slug: 'combine-images', name: 'Combine Images', short: 'Combine Images', tagline: 'Join photos into one', category: 'Image', from: '#fcd34d', to: '#d97706', icon: 'combine', keywords: 'combine images merge photos join pictures side by side collage stack' },
  { slug: 'resize-pdf', name: 'Resize PDF', short: 'Resize PDF', tagline: 'Change page size', category: 'Edit', from: '#a5f3fc', to: '#0e7490', icon: 'resizepdf', keywords: 'resize pdf page size a4 letter legal change paper size scale pdf' },
  { slug: 'flatten-pdf', name: 'Flatten PDF', short: 'Flatten', tagline: 'Lock forms & comments', category: 'Edit', from: '#cbd5e1', to: '#475569', icon: 'flatten', keywords: 'flatten pdf form fields annotations comments lock make uneditable' },
  { slug: 'header-footer-pdf', name: 'Header & Footer', short: 'Header/Footer', tagline: 'Add text to every page', category: 'Edit', from: '#fde68a', to: '#b45309', icon: 'headerfooter', keywords: 'add header footer pdf text every page date file name page x of y' },
  { slug: 'annotate-pdf', name: 'Annotate PDF', short: 'Annotate', tagline: 'Highlight & comment', category: 'Edit', from: '#fde047', to: '#ca8a04', icon: 'annotate', keywords: 'annotate pdf highlight text comment notes underline strikethrough draw markup review sticky note' },
  { slug: 'add-image-to-pdf', name: 'Add Image to PDF', short: 'Add Image', tagline: 'Logo or photo on pages', category: 'Edit', from: '#c4b5fd', to: '#6d28d9', icon: 'addimage', keywords: 'add image to pdf insert picture logo photo png jpg every page letterhead' },
  { slug: 'stamp-pdf', name: 'Stamp PDF', short: 'Stamp', tagline: 'Approved, Paid, Draft…', category: 'Edit', from: '#fca5a5', to: '#b91c1c', icon: 'stamp', keywords: 'stamp pdf approved paid draft confidential received rubber stamp seal date' },
  { slug: 'edit-pdf-metadata', name: 'Edit PDF Metadata', short: 'Metadata', tagline: 'Title, author, keywords', category: 'Edit', from: '#a5b4fc', to: '#3730a3', icon: 'metadata', keywords: 'pdf metadata editor change title author subject keywords creation date remove metadata properties' },
  { slug: 'reverse-pdf', name: 'Reverse PDF', short: 'Reverse', tagline: 'Last page first', category: 'Organize', from: '#99f6e4', to: '#0f766e', icon: 'reverse', keywords: 'reverse pdf page order flip backwards invert order last page first' },
  { slug: 'alternate-merge-pdf', name: 'Alternate & Mix', short: 'Alternate Mix', tagline: 'Merge front & back scans', category: 'Organize', from: '#93c5fd', to: '#1d4ed8', icon: 'alternate', keywords: 'alternate merge pdf interleave odd even pages double sided scan duplex front back collate mix' },
  { slug: 'insert-blank-page-pdf', name: 'Insert Blank Page', short: 'Add Blank', tagline: 'Add empty pages', category: 'Organize', from: '#e2e8f0', to: '#64748b', icon: 'blankadd', keywords: 'insert blank page pdf add empty page between pages duplex printing even pages notes' },
  { slug: 'remove-blank-pages', name: 'Remove Blank Pages', short: 'Remove Blank', tagline: 'Auto-find empty pages', category: 'Organize', from: '#fecaca', to: '#dc2626', icon: 'blankremove', keywords: 'remove blank pages pdf delete empty pages scanner white pages detect automatically' },
  { slug: 'powerpoint-to-pdf', name: 'PowerPoint to PDF', short: 'PPT to PDF', tagline: 'PPTX to PDF', category: 'Convert', from: '#fed7aa', to: '#c2410c', icon: 'pptpdf', keywords: 'powerpoint to pdf pptx to pdf ppt slides presentation convert save as pdf google slides keynote' },
  { slug: 'html-to-pdf', name: 'HTML to PDF', short: 'HTML to PDF', tagline: 'Web page to PDF', category: 'Convert', from: '#bae6fd', to: '#0369a1', icon: 'html', keywords: 'html to pdf web page to pdf htm convert save webpage as pdf code invoice template' },
  { slug: 'n-up-pdf', name: 'N-up PDF', short: 'N-up', tagline: 'Several pages per sheet', category: 'Organize', from: '#a5f3fc', to: '#0891b2', icon: 'nup', keywords: 'n-up pdf multiple pages per sheet 2 4 6 9 16 pages on one page print handouts save paper' },
  { slug: 'booklet-pdf', name: 'Booklet PDF', short: 'Booklet', tagline: 'Print, fold, staple', category: 'Organize', from: '#fcd34d', to: '#b45309', icon: 'booklet', keywords: 'booklet pdf print booklet saddle stitch fold imposition zine program a5' },
  { slug: 'split-pdf-by-size', name: 'Split PDF by Size', short: 'Split by Size', tagline: 'Parts under 5, 10, 20 MB', category: 'Organize', from: '#86efac', to: '#047857', icon: 'splitsize', keywords: 'split pdf by size file size mb email attachment limit upload limit parts' },
  { slug: 'split-pdf-by-bookmarks', name: 'Split by Bookmarks', short: 'Split by Chapter', tagline: 'One file per chapter', category: 'Organize', from: '#bbf7d0', to: '#15803d', icon: 'splitbook', keywords: 'split pdf by bookmarks chapters outline sections table of contents separate files' },
  { slug: 'add-bookmarks-to-pdf', name: 'Add Bookmarks', short: 'Bookmarks', tagline: 'Clickable table of contents', category: 'Edit', from: '#93c5fd', to: '#4338ca', icon: 'bookmark', keywords: 'add bookmarks to pdf edit outline table of contents navigation chapters headings create bookmarks' },
  { slug: 'invert-pdf-colors', name: 'Invert PDF Colors', short: 'Invert', tagline: 'Black ↔ white, dark mode', category: 'Edit', from: '#6b7280', to: '#030712', icon: 'invert', keywords: 'invert pdf colors negative dark mode black background white text night reading save ink' },
  { slug: 'pdf-background-color', name: 'PDF Background Color', short: 'Background', tagline: 'Coloured paper look', category: 'Edit', from: '#fef08a', to: '#ca8a04', icon: 'background', keywords: 'pdf background color change page color paper colour cream yellow reading dyslexia tint' },
  { slug: 'remove-pdf-annotations', name: 'Remove Annotations', short: 'Remove Comments', tagline: 'Delete comments & markup', category: 'Edit', from: '#fecdd3', to: '#be123c', icon: 'noannot', keywords: 'remove annotations pdf delete comments highlights markup sticky notes clean pdf links form fields' },
  { slug: 'deskew-pdf', name: 'Deskew PDF', short: 'Deskew', tagline: 'Straighten tilted scans', category: 'Optimize', from: '#c7d2fe', to: '#4f46e5', icon: 'deskew', keywords: 'deskew pdf straighten scanned pages tilted crooked skewed scan fix angle' },
  { slug: 'pdf-page-counter', name: 'PDF Page Counter', short: 'Page Counter', tagline: 'Count pages in many PDFs', category: 'Organize', from: '#e9d5ff', to: '#7e22ce', icon: 'counter', keywords: 'pdf page counter count pages multiple pdfs how many pages total printing cost bulk' },
  { slug: 'add-links-to-pdf', name: 'Add Links to PDF', short: 'Add Links', tagline: 'Make text clickable', category: 'Edit', from: '#7dd3fc', to: '#0369a1', icon: 'link', keywords: 'add links to pdf hyperlink clickable url email make links clickable internal link go to page' },
  { slug: 'text-to-pdf', name: 'Text to PDF', short: 'TXT to PDF', tagline: 'TXT to PDF', category: 'Convert', from: '#e5e7eb', to: '#4b5563', icon: 'txtpdf', keywords: 'text to pdf txt to pdf convert notepad plain text log file save as pdf' },
  { slug: 'markdown-to-pdf', name: 'Markdown to PDF', short: 'MD to PDF', tagline: 'MD to PDF', category: 'Convert', from: '#ddd6fe', to: '#6d28d9', icon: 'mdpdf', keywords: 'markdown to pdf md to pdf readme github convert export notes obsidian' },
  { slug: 'epub-to-pdf', name: 'EPUB to PDF', short: 'EPUB to PDF', tagline: 'E-book to PDF', category: 'Convert', from: '#fde68a', to: '#a16207', icon: 'epubpdf', keywords: 'epub to pdf ebook convert e-book print read book pdf' },
  { slug: 'odt-to-pdf', name: 'ODT to PDF', short: 'ODT to PDF', tagline: 'OpenDocument to PDF', category: 'Convert', from: '#bfdbfe', to: '#1e3a8a', icon: 'odtpdf', keywords: 'odt to pdf opendocument libreoffice writer openoffice convert document' },
  { slug: 'csv-to-pdf', name: 'CSV to PDF', short: 'CSV to PDF', tagline: 'Data as a neat table', category: 'Convert', from: '#a7f3d0', to: '#047857', icon: 'csvpdf', keywords: 'csv to pdf convert table data export spreadsheet print comma separated tsv' },
  { slug: 'tiff-to-pdf', name: 'TIFF to PDF', short: 'TIFF to PDF', tagline: 'Scans & faxes to PDF', category: 'Convert', from: '#fecaca', to: '#991b1b', icon: 'tiffpdf', keywords: 'tiff to pdf tif convert multipage fax scan g4 ccitt lossless' },
  { slug: 'svg-to-pdf', name: 'SVG to PDF', short: 'SVG to PDF', tagline: 'Vector, stays sharp', category: 'Convert', from: '#fbcfe8', to: '#9d174d', icon: 'svgpdf', keywords: 'svg to pdf vector convert logo icon illustration print sharp' },
  { slug: 'pdf-to-html', name: 'PDF to HTML', short: 'PDF to HTML', tagline: 'Web page from PDF', category: 'Convert', from: '#fed7aa', to: '#9a3412', icon: 'pdfhtml', keywords: 'pdf to html convert web page website code text selectable responsive' },
  { slug: 'pdf-to-epub', name: 'PDF to EPUB', short: 'PDF to EPUB', tagline: 'PDF to e-book', category: 'Convert', from: '#fef3c7', to: '#92400e', icon: 'pdfepub', keywords: 'pdf to epub ebook convert kindle kobo apple books reflowable e-reader' },
  { slug: 'rotate-image', name: 'Rotate Image', short: 'Rotate Image', tagline: 'Turn or straighten photos', category: 'Image', from: '#5eead4', to: '#0f766e', icon: 'rotimg', keywords: 'rotate image photo 90 degrees straighten tilted picture online batch' },
  { slug: 'flip-image', name: 'Flip Image', short: 'Flip Image', tagline: 'Mirror photos', category: 'Image', from: '#a5f3fc', to: '#0e7490', icon: 'flipimg', keywords: 'flip image mirror photo horizontal vertical selfie reverse picture' },
  { slug: 'photo-editor', name: 'Photo Editor', short: 'Photo Editor', tagline: 'Filters & adjustments', category: 'Image', from: '#f9a8d4', to: '#a21caf', icon: 'photoedit', keywords: 'photo editor online free filters brightness contrast saturation enhance picture edit' },
  { slug: 'watermark-image', name: 'Watermark Image', short: 'Watermark Img', tagline: 'Protect your photos', category: 'Image', from: '#cbd5e1', to: '#334155', icon: 'wmimg', keywords: 'watermark image photo add logo copyright text batch protect pictures' },
  { slug: 'add-text-to-image', name: 'Add Text to Image', short: 'Text on Image', tagline: 'Captions & labels', category: 'Image', from: '#fcd34d', to: '#c2410c', icon: 'textimg', keywords: 'add text to image photo caption write on picture quote font' },
  { slug: 'meme-generator', name: 'Meme Generator', short: 'Meme Maker', tagline: 'Top & bottom text', category: 'Image', from: '#fde047', to: '#a16207', icon: 'meme', keywords: 'meme generator maker caption top bottom text impact own photo' },
  { slug: 'blur-image', name: 'Blur & Pixelate Image', short: 'Blur Image', tagline: 'Hide faces & details', category: 'Image', from: '#c7d2fe', to: '#4338ca', icon: 'blurimg', keywords: 'blur image pixelate face censor number plate hide details photo privacy' },
  { slug: 'collage-maker', name: 'Collage Maker', short: 'Collage', tagline: 'Photo grids & layouts', category: 'Image', from: '#fbcfe8', to: '#be185d', icon: 'collage', keywords: 'collage maker photo grid layout instagram pictures together frame' },
  { slug: 'gif-maker', name: 'GIF Maker', short: 'GIF Maker', tagline: 'Images to animated GIF', category: 'Image', from: '#bbf7d0', to: '#15803d', icon: 'gif', keywords: 'gif maker animated gif from images photos to gif slideshow animation' },
  { slug: 'image-to-svg', name: 'Image to SVG', short: 'Image to SVG', tagline: 'Vectorize PNG / JPG', category: 'Image', from: '#ddd6fe', to: '#5b21b6', icon: 'vectorize', keywords: 'image to svg png to svg jpg to svg vectorize trace logo vector converter' },
  { slug: 'circle-crop-image', name: 'Circle Crop', short: 'Circle Crop', tagline: 'Round profile pictures', category: 'Image', from: '#fbcfe8', to: '#db2777', icon: 'circle', keywords: 'circle crop image round profile picture avatar dp transparent png' },
  { slug: 'image-splitter', name: 'Image Grid Splitter', short: 'Grid Split', tagline: 'Tiles for Instagram', category: 'Image', from: '#bae6fd', to: '#0369a1', icon: 'gridsplit', keywords: 'split image grid instagram 3x3 tiles cut photo into pieces panorama carousel' },
  { slug: 'remove-exif', name: 'Remove EXIF Data', short: 'Remove EXIF', tagline: 'Strip location & camera info', category: 'Image', from: '#fecaca', to: '#b91c1c', icon: 'noexif', keywords: 'remove exif metadata photo gps location strip camera data privacy view exif' },
  { slug: 'color-picker-from-image', name: 'Image Color Picker', short: 'Color Picker', tagline: 'HEX, RGB from any image', category: 'Image', from: '#fde68a', to: '#db2777', icon: 'picker', keywords: 'color picker from image hex code rgb eyedropper palette extractor colour' },
  { slug: 'signature-maker', name: 'Signature Maker', short: 'Signature Maker', tagline: 'Draw or type a signature', category: 'Image', from: '#c7d2fe', to: '#3730a3', icon: 'sigmaker', keywords: 'signature maker online draw type signature transparent png electronic signature generator' },
  { slug: 'favicon-generator', name: 'Favicon Generator', short: 'Favicon', tagline: 'ICO & app icons', category: 'Image', from: '#a5b4fc', to: '#4338ca', icon: 'favicon', keywords: 'favicon generator ico apple touch icon android pwa icon website from image text emoji' },
  { slug: 'qr-code-generator', name: 'QR Code Generator', short: 'QR Generator', tagline: 'Links, Wi-Fi, contacts', category: 'Image', from: '#cbd5e1', to: '#111827', icon: 'qr', keywords: 'qr code generator free link wifi vcard whatsapp logo no expiry svg png' },
  { slug: 'qr-code-scanner', name: 'QR Code Scanner', short: 'QR Scanner', tagline: 'Scan from camera or photo', category: 'Image', from: '#99f6e4', to: '#0f766e', icon: 'qrscan', keywords: 'qr code scanner reader online camera image screenshot decode wifi qr' },
  { slug: 'barcode-generator', name: 'Barcode Generator', short: 'Barcode', tagline: 'EAN, UPC, Code 128', category: 'Image', from: '#e5e7eb', to: '#374151', icon: 'barcode', keywords: 'barcode generator ean 13 upc code 128 code 39 itf 14 png svg free' },
  { slug: 'add-border-to-image', name: 'Add Border to Image', short: 'Image Border', tagline: 'Frames & rounded corners', category: 'Image', from: '#fed7aa', to: '#c2410c', icon: 'border', keywords: 'add border to image photo frame white border polaroid rounded corners outline' },
  { slug: 'image-to-base64', name: 'Image to Base64', short: 'Base64', tagline: 'Data URI encoder/decoder', category: 'Image', from: '#d9f99d', to: '#4d7c0f', icon: 'base64', keywords: 'image to base64 converter data uri encode decode html css png jpg svg' },
  { slug: 'change-image-dpi', name: 'Change Image DPI', short: 'Change DPI', tagline: '300 DPI without quality loss', category: 'Image', from: '#a7f3d0', to: '#065f46', icon: 'dpi', keywords: 'change image dpi 300 dpi 200 dpi photo resolution print form jpg png converter' },
  { slug: 'video-to-gif', name: 'Video to GIF', short: 'Video to GIF', tagline: 'Clip to animated GIF', category: 'Image', from: '#fbcfe8', to: '#9d174d', icon: 'vidgif', keywords: 'video to gif converter mp4 to gif webm mov clip animated gif maker' },
  { slug: 'pdf-letterhead', name: 'Add Letterhead to PDF', short: 'Letterhead', tagline: 'Overlay a template PDF', category: 'Edit', from: '#bfdbfe', to: '#1d4ed8', icon: 'letterhead', keywords: 'add letterhead to pdf overlay pdf template background merge pages stationery' },
  { slug: 'split-pdf-pages-in-half', name: 'Split Pages in Half', short: 'Split in Half', tagline: 'Two-up scans to single pages', category: 'Organize', from: '#bbf7d0', to: '#166534', icon: 'halves', keywords: 'split pdf pages in half scanned book two pages per sheet cut page vertically a3 to a4' },
  { slug: 'poster-pdf', name: 'Poster PDF', short: 'Poster', tagline: 'Print big on many sheets', category: 'Organize', from: '#fca5a5', to: '#991b1b', icon: 'poster', keywords: 'poster pdf print large tile pages a4 sheets enlarge banner plan rasterbator' },
  { slug: 'pdf-to-image-pdf', name: 'Flatten PDF to Images', short: 'Image PDF', tagline: 'Non-editable picture PDF', category: 'Security', from: '#d1d5db', to: '#1f2937', icon: 'rasterize', keywords: 'convert pdf to image pdf rasterize flatten non editable cannot copy text scan look' },
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
