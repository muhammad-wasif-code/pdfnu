/**
 * Keyword landing pages: a tool opened with a preset (e.g. "compress PDF to 100KB").
 * Each page has its own copy so it answers that exact search, not a duplicate of the tool page.
 */
import type { QA } from '../components/FAQ.astro';

interface Base {
  slug: string;
  /** short label used in breadcrumbs and sibling links, e.g. "100KB" */
  name: string;
  title: string; // ≤ 60 chars
  description: string;
  h1: string;
  lead: string;
  /** 2 short paragraphs specific to this size */
  intro: string[];
  uses: string[];
  tips: string[];
  faqs: QA[];
}
export type Landing =
  | (Base & { tool: 'compress-pdf'; target: '50' | '100' | '200' | '300' | '500' | '1024' | '2048' })
  | (Base & { tool: 'compress-image'; target: '10' | '20' | '30' | '50' | '100' | '200' })
  | (Base & { tool: 'resize-image'; size: { w: number; h: number } })
  | (Base & { tool: 'pdf-to-jpg'; format: 'png' })
  | (Base & { tool: 'jpg-to-pdf' })
  | (Base & { tool: 'image-converter'; format: 'image/jpeg' | 'image/png' | 'image/webp' })
  | (Base & { tool: 'ocr-pdf'; mode: 'image' });

const privacyFaq: QA = { q: 'Is my file uploaded?', a: 'No. Everything happens inside your browser, so the file never leaves your device. It works offline after the first visit.' };

export const landings: Landing[] = [
  /* ---------------- Compress PDF to … ---------------- */
  {
    tool: 'compress-pdf', target: '100', slug: 'compress-pdf-to-100kb', name: '100KB',
    title: 'Compress PDF to 100KB Online Free (No Upload) | PDFSherpa',
    description: 'Shrink a PDF to under 100KB for strict upload limits. Target size is preset: just drop your file. Free, private, no signup.',
    h1: 'Compress PDF to 100KB',
    lead: 'Drop your PDF and it’s compressed to fit under 100KB, the strictest limit on many application and exam portals. Nothing is uploaded.',
    intro: [
      '100KB is one of the tightest limits you’ll meet. It’s common on government, exam and scholarship portals where every applicant uploads several documents. The 100KB target is already selected below, so PDFSherpa keeps lowering image quality until the file fits.',
      'Text-only PDFs usually get there easily. Scans and photos are harder: a one- or two-page scan normally fits, but a long scanned document may need to be split first.',
    ],
    uses: ['ID card and certificate scans for online application forms', 'Mark sheets and transcripts on admission portals', 'Fee receipts, domicile and character certificates', 'One-page letters and declarations'],
    tips: [
      'Crop away scanner borders with <a href="/crop-pdf">Crop PDF</a> first. Less empty area means more bytes for the text.',
      'Convert colour scans to black and white with <a href="/grayscale-pdf">Grayscale PDF</a>. That alone can halve the size.',
      'If the portal takes several files, use <a href="/split-pdf">Split PDF</a> and upload each part separately.',
      'Remove blank or unneeded pages with <a href="/delete-pdf-pages">Delete Pages</a> before compressing.',
    ],
    faqs: [
      { q: 'Will the text still be readable at 100KB?', a: 'For typed documents, yes: text stays sharp because it isn’t an image. For scans, PDFSherpa lowers image resolution only as far as needed, so check the result before you upload it.' },
      { q: 'What if my PDF can’t get under 100KB?', a: 'The result shows how close it got. Remove pages, convert to grayscale, or split the document, then compress again.' },
      privacyFaq,
    ],
  },
  {
    tool: 'compress-pdf', target: '200', slug: 'compress-pdf-to-200kb', name: '200KB',
    title: 'Compress PDF to 200KB Online Free (No Upload) | PDFSherpa',
    description: 'Get any PDF under 200KB for job, admission and form uploads. Target size preset, text stays sharp. Free and private, no signup.',
    h1: 'Compress PDF to 200KB',
    lead: 'Fit a PDF under 200KB in one step. The target is preset, so just drop the file and download. Your document never leaves your device.',
    intro: [
      '200KB is a typical limit on job applications, university admission forms and online banking uploads. It’s generous enough for a CV or a few typed pages, but scans and phone photos often need compressing to fit.',
      'With the 200KB target selected, PDFSherpa tries lossless optimisation first and only reduces image quality as much as needed to get under the limit.',
    ],
    uses: ['CVs and cover letters on job portals', 'Degree and experience certificates', 'Admission documents and recommendation letters', 'Bank and KYC forms with a scanned signature'],
    tips: [
      'A typed CV is usually already small. If it isn’t, it probably contains a large photo. Compressing fixes that without touching the text.',
      'For scans, a 2–4 page document normally fits under 200KB.',
      'Merging several documents into one upload? Merge first with <a href="/merge-pdf">Merge PDF</a>, then compress the combined file.',
    ],
    faqs: [
      { q: 'Will my CV lose quality?', a: 'Text and vector graphics aren’t affected. Only embedded photos are recompressed, and only as much as needed to reach 200KB.' },
      { q: 'Is 200KB the same as 0.2MB?', a: 'Almost. Portals usually mean 200 × 1024 bytes. PDFSherpa uses the same definition, so a file shown as under 200KB will be accepted.' },
      privacyFaq,
    ],
  },
  {
    tool: 'compress-pdf', target: '500', slug: 'compress-pdf-to-500kb', name: '500KB',
    title: 'Compress PDF to 500KB Online Free | PDFSherpa',
    description: 'Reduce a PDF to under 500KB for visa, embassy and university uploads while keeping scans readable. Free, private, no upload.',
    h1: 'Compress PDF to 500KB',
    lead: 'Bring a PDF under 500KB while keeping scanned pages clear. The 500KB target is preset, and your file stays on your device.',
    intro: [
      '500KB is common on visa and embassy portals, university applications and insurance claims. It leaves room for multi-page scans, so quality can stay high.',
      'PDFSherpa keeps text vector-sharp and lowers photo quality step by step until the file is just under 500KB, not far below it.',
    ],
    uses: ['Passport and visa document scans', 'Bank statements for visa or loan applications', 'Multi-page university transcripts', 'Insurance and medical claim documents'],
    tips: [
      'A 5–10 page scan usually fits under 500KB at good quality.',
      'If a statement is password-protected, unlock it first with <a href="/unlock-pdf">Unlock PDF</a> using its password. Protected files can’t be compressed.',
      'Scans made with a phone? <a href="/scan-to-pdf">Scan to PDF</a> creates cleaner, smaller pages from the start.',
    ],
    faqs: [
      { q: 'Can I compress a bank statement to 500KB?', a: 'Yes. Bank statements are mostly text, so they shrink well. If it’s password-protected, unlock it first with the password from your bank.' },
      { q: 'Will stamps and signatures stay visible?', a: 'Yes. At 500KB there’s enough room to keep stamps, signatures and photos clearly visible on typical documents.' },
      privacyFaq,
    ],
  },
  {
    tool: 'compress-pdf', target: '1024', slug: 'compress-pdf-to-1mb', name: '1MB',
    title: 'Compress PDF to 1MB Online Free | PDFSherpa',
    description: 'Shrink large PDFs under 1MB for email and online forms. Long scans and photo-heavy reports stay readable. Free, no upload.',
    h1: 'Compress PDF to 1MB',
    lead: 'Get big PDFs under 1MB for email attachments and form uploads, with quality to spare. The 1MB target is preset and nothing is uploaded.',
    intro: [
      'A 1MB limit is common on application forms, and many people aim for it so documents open quickly on phones and pass through email filters.',
      'At 1MB, most documents keep near-original quality: PDFSherpa removes waste and reduces photos only if the file is still too big.',
    ],
    uses: ['Reports and assignments with charts and photos', 'Scanned contracts of 10–20 pages', 'Portfolios and brochures for email', 'Theses and project files for submission portals'],
    tips: [
      'Photo-heavy brochures shrink the most. A 10MB file often ends up well under 1MB.',
      'If you need to email something larger than 1MB, consider splitting it into parts with <a href="/split-pdf">Split PDF</a>.',
      'For archiving rather than sending, keep the original. Compression is one-way.',
    ],
    faqs: [
      { q: 'How much quality is lost at 1MB?', a: 'For most documents, none you’ll notice. Text stays sharp and photos are resized to screen and print-friendly resolutions.' },
      { q: 'My 50MB PDF won’t reach 1MB. Why?', a: 'Very long or very photo-heavy PDFs may simply contain too much. Split the document, or remove pages you don’t need, then compress each part.' },
      privacyFaq,
    ],
  },
  {
    tool: 'compress-pdf', target: '2048', slug: 'compress-pdf-to-2mb', name: '2MB',
    title: 'Compress PDF to 2MB Online Free | PDFSherpa',
    description: 'Reduce a PDF to under 2MB for portals and email with minimal quality loss. Large scans and presentations included. Free, no upload.',
    h1: 'Compress PDF to 2MB',
    lead: 'Fit a PDF under 2MB with almost no visible quality loss. The 2MB target is preset, and your file is processed on your device.',
    intro: [
      '2MB is a common upload cap for college portals, job sites and government services. It’s large enough that most documents only need light compression.',
      'PDFSherpa starts with lossless clean-up, which alone often removes several megabytes, and touches photo quality only if needed.',
    ],
    uses: ['Slides and presentations exported as PDF', 'Long scanned documents and books', 'Design proofs and portfolios', 'Project reports with many images'],
    tips: [
      'Presentations exported from PowerPoint often contain full-size photos. Compressing to 2MB usually keeps them crisp on screen.',
      'If a portal rejects the file for another reason, it might need PDF/A. Try <a href="/pdf-to-pdfa">PDF to PDF/A</a>.',
      'For a slightly smaller file, try the 1MB target on the <a href="/compress-pdf-to-1mb">Compress PDF to 1MB</a> page.',
    ],
    faqs: [
      { q: 'Is 2MB the same as 2000KB?', a: 'Portals usually mean 2 × 1024 × 1024 bytes (2048KB). PDFSherpa targets that, so the result is accepted by limits written either way.' },
      { q: 'Will my presentation slides look blurry?', a: 'No. At 2MB there’s enough room to keep photos at screen resolution, and text and shapes stay vector-sharp.' },
      privacyFaq,
    ],
  },

  /* ---------------- Compress image to … ---------------- */
  {
    tool: 'compress-image', target: '20', slug: 'compress-image-to-20kb', name: '20KB',
    title: 'Compress Image to 20KB Online Free (JPG) | PDFSherpa',
    description: 'Reduce a photo or signature to under 20KB for exam and job forms. Target preset, smart resizing keeps it clear. Free, no upload.',
    h1: 'Compress Image to 20KB',
    lead: 'Shrink a photo or signature to under 20KB, the limit many exam and job forms use for signatures. The 20KB target is preset.',
    intro: [
      '20KB is typical for signature uploads and small photos on exam and recruitment portals. At that size, getting the pixel dimensions right matters as much as compression.',
      'With the 20KB target selected, PDFSherpa lowers JPG quality and, if needed, the pixel size until the image fits, without turning it into a blurry mess.',
    ],
    uses: ['Signature images for recruitment and exam forms', 'Small applicant photos', 'Thumb impression scans', 'Small profile pictures'],
    tips: [
      'Crop tightly first with <a href="/crop-image">Crop Image</a>. Empty space wastes bytes.',
      'For signatures, clean the paper background with <a href="/signature-cleaner">Signature Cleaner</a> and pick its 20KB option.',
      'If the form also demands exact pixels, resize with <a href="/resize-image">Resize Image</a> and set a 20KB maximum there.',
    ],
    faqs: [
      { q: 'Why does my 20KB photo look soft?', a: '20KB is very small for a photo. Crop to just the face or signature first. A smaller area at the same KB looks much sharper.' },
      { q: 'Can I keep it as PNG?', a: 'PNG is rarely small enough for 20KB with photos. JPG is used here because forms almost always accept it and it compresses far better.' },
      privacyFaq,
    ],
  },
  {
    tool: 'compress-image', target: '50', slug: 'compress-image-to-50kb', name: '50KB',
    title: 'Compress Image to 50KB Online Free (JPG) | PDFSherpa',
    description: 'Get a photo under 50KB for passport-size uploads and online forms while keeping the face sharp. Target preset. Free, private.',
    h1: 'Compress Image to 50KB',
    lead: 'Get a photo under 50KB, a common limit for passport-size photos on online forms. The target is preset and the photo never leaves your device.',
    intro: [
      '50KB is the limit most forms set for an applicant photo. It’s enough for a clear passport-size image if the photo is cropped and sized sensibly.',
      'PDFSherpa compresses to just under 50KB, keeping as much quality as the limit allows, and resizes only when quality alone isn’t enough.',
    ],
    uses: ['Passport-size photos for application forms', 'Photos for ID and membership cards', 'Document photos for portals', 'Profile pictures for official accounts'],
    tips: [
      'Need an exact passport size too? <a href="/passport-photo-maker">Passport Photo</a> crops to size and can cap the file at 50KB in one go.',
      'Use a plain, light background. Busy backgrounds take more bytes.',
      'Several photos? Drop them all at once and download each.',
    ],
    faqs: [
      { q: 'What size in pixels fits in 50KB?', a: 'A typical passport-size photo of around 400×500 pixels fits comfortably in 50KB as a good-quality JPG.' },
      { q: 'The form says 20–50KB. Will it be too small?', a: 'PDFSherpa aims for just under 50KB, not as small as possible, so it lands within a 20–50KB range for typical photos.' },
      privacyFaq,
    ],
  },
  {
    tool: 'compress-image', target: '100', slug: 'compress-image-to-100kb', name: '100KB',
    title: 'Compress Image to 100KB Online Free | PDFSherpa',
    description: 'Reduce JPG, PNG or WebP images to under 100KB for forms, websites and email while keeping them sharp. Free, no upload.',
    h1: 'Compress Image to 100KB',
    lead: 'Reduce any photo to under 100KB with quality that still looks good full-screen. The 100KB target is preset and nothing is uploaded.',
    intro: [
      '100KB is a comfortable size for document photos, website images and forms that allow a little more room. Phone photos are often 3–5MB, so this is a big reduction that still looks good.',
      'PDFSherpa reduces quality first and pixel size second, stopping as soon as the photo is under 100KB.',
    ],
    uses: ['Photos of documents for upload forms', 'Product photos for small online shops', 'Images for blog posts and websites', 'Photos for email newsletters'],
    tips: [
      'Choose WebP output for websites. It looks better than JPG at the same size.',
      'Convert PNG screenshots of photos to JPG with <a href="/image-converter">Image Converter</a>. They shrink much more.',
      'Turning several document photos into one file? Use <a href="/jpg-to-pdf">JPG to PDF</a> after compressing.',
    ],
    faqs: [
      { q: 'Can I compress many images to 100KB at once?', a: 'Yes. Drop several images and each one is compressed to under 100KB separately.' },
      { q: 'Does it work with phone photos?', a: 'Yes. Rotation from your phone is respected, and large 12MP photos are resized smartly to fit.' },
      privacyFaq,
    ],
  },
  {
    tool: 'compress-image', target: '200', slug: 'compress-image-to-200kb', name: '200KB',
    title: 'Compress Image to 200KB Online Free | PDFSherpa',
    description: 'Shrink large photos to under 200KB with almost no visible quality loss. JPG or WebP output. Free, private, no upload.',
    h1: 'Compress Image to 200KB',
    lead: 'Shrink large photos to under 200KB with almost no visible difference. The 200KB target is preset and your photos stay on your device.',
    intro: [
      'At 200KB, a photo still looks sharp on a laptop screen. It’s a good size for portals that allow larger images, for email, and for most website images.',
      'PDFSherpa keeps the original pixel size whenever it can and only lowers quality as far as needed to reach 200KB.',
    ],
    uses: ['Photos for job and visa portals with higher limits', 'Website hero and gallery images', 'Images for presentations', 'Photos to email without huge attachments'],
    tips: [
      'If you also need exact dimensions, resize first with <a href="/resize-image">Resize Image</a>.',
      'For the web, WebP at 200KB looks noticeably better than JPG at the same size.',
    ],
    faqs: [
      { q: 'Will I notice quality loss at 200KB?', a: 'For typical photos viewed on screen, rarely. Fine detail at full zoom may be slightly softer.' },
      { q: 'Is the image resized?', a: 'Only if quality reduction alone can’t reach 200KB. Most phone photos fit without heavy resizing.' },
      privacyFaq,
    ],
  },

  /* ---------------- Resize image to … ---------------- */
  {
    tool: 'resize-image', size: { w: 600, h: 600 }, slug: 'resize-image-to-600x600', name: '600×600',
    title: 'Resize Image to 600×600 Pixels Online Free | PDFSherpa',
    description: 'Resize any photo to exactly 600×600 px, the 2×2 inch photo size at 300 DPI, with smart cropping. Free, no upload.',
    h1: 'Resize Image to 600×600 Pixels',
    lead: 'Turn any photo into an exact 600×600 pixel square, the digital size of a 2×2 inch photo at 300 DPI. Your photo stays on your device.',
    intro: [
      '600×600 pixels is the digital size of a 2×2 inch photo, used for US passport and visa applications, and a common square size for product photos.',
      'The size is preset below. The photo is cropped to a square from the centre, so nothing gets squashed. Adjust fit or format before saving if you need to.',
    ],
    uses: ['Digital 2×2 inch passport and visa photos', 'Square product photos for online shops', 'Profile pictures and avatars', 'Album and podcast cover drafts'],
    tips: [
      'For a passport photo with a face guide and print sheet, use <a href="/passport-photo-maker">Passport Photo</a> and choose 2×2 inch.',
      'If the form also has a KB limit, set a maximum size before saving.',
      'Want a different crop than the centre? Crop it yourself first with <a href="/crop-image">Crop Image</a> using the 1:1 ratio.',
    ],
    faqs: [
      { q: 'Will my photo be stretched?', a: 'No. By default it’s cropped to fill the square, so proportions are kept. Switch the fit option to add borders instead of cropping.' },
      { q: 'Is 600×600 the same as 2×2 inches?', a: 'At 300 DPI, yes: 2 inches × 300 = 600 pixels.' },
      privacyFaq,
    ],
  },
  {
    tool: 'resize-image', size: { w: 413, h: 531 }, slug: 'resize-image-to-35x45-mm', name: '35×45 mm',
    title: 'Resize Photo to 35×45 mm (413×531 px) Free | PDFSherpa',
    description: 'Resize a photo to 35×45 mm, 413×531 pixels at 300 DPI, the passport photo size used by many countries. Free, no upload.',
    h1: 'Resize Photo to 35×45 mm',
    lead: 'Resize a photo to 35×45 mm (413×531 pixels at 300 DPI), the passport photo size used by many countries. Nothing is uploaded.',
    intro: [
      '35×45 mm is the passport and visa photo size used in the UK, EU, and much of Asia. At 300 DPI, that is 413×531 pixels.',
      'The size is preset below and the photo is cropped from the centre to the right shape. For face positioning help, use the passport photo tool instead.',
    ],
    uses: ['Passport and visa application photos', 'ID card and driving licence photos', 'Exam admit card photos', 'Residence permit applications'],
    tips: [
      'Prefer guided framing? <a href="/passport-photo-maker">Passport Photo</a> shows an oval for your face and makes a printable sheet.',
      'Check the official rules for your application. Background colour and head size requirements vary.',
      'Need it under 50KB? Set the maximum size before saving, or use <a href="/compress-image-to-50kb">Compress Image to 50KB</a>.',
    ],
    faqs: [
      { q: 'How many pixels is 35×45 mm?', a: 'At 300 DPI, 35×45 mm is 413×531 pixels. At 600 DPI it would be 827×1063 pixels.' },
      { q: 'Can I print it?', a: 'Yes. Print at 300 DPI, or use Passport Photo for a ready-made 4×6 inch sheet with several copies.' },
      privacyFaq,
    ],
  },
  {
    tool: 'resize-image', size: { w: 200, h: 200 }, slug: 'resize-image-to-200x200', name: '200×200',
    title: 'Resize Image to 200×200 Pixels Online Free | PDFSherpa',
    description: 'Resize any image to exactly 200×200 px for avatars, thumbnails and form uploads, cropped neatly to a square. Free, no upload.',
    h1: 'Resize Image to 200×200 Pixels',
    lead: 'Make a neat 200×200 pixel square from any image, for avatars, thumbnails and small form uploads. Your image stays on your device.',
    intro: [
      '200×200 pixels is a common size for profile pictures, forum avatars, thumbnails and some application forms that want a small square photo.',
      'The size is preset below. The image is centre-cropped to a square so faces and logos keep their proportions.',
    ],
    uses: ['Forum and app avatars', 'Thumbnails for websites and catalogues', 'Small square photos for forms', 'Logos for directories'],
    tips: [
      'Choose PNG for logos with transparency, JPG for photos.',
      'Crop around the face first with <a href="/crop-image">Crop Image</a> for a tighter portrait.',
    ],
    faqs: [
      { q: 'Will a large photo look good at 200×200?', a: 'Yes. Downscaling uses high-quality smoothing. Crop to the important part first so it isn’t too small.' },
      { q: 'Can I make it smaller in KB too?', a: 'Yes. Set a maximum file size before saving. A 200×200 JPG is usually only a few KB anyway.' },
      privacyFaq,
    ],
  },
  {
    tool: 'resize-image', size: { w: 1080, h: 1080 }, slug: 'resize-image-to-1080x1080', name: '1080×1080',
    title: 'Resize Image to 1080×1080 for Instagram Free | PDFSherpa',
    description: 'Resize any photo to 1080×1080 px, the standard square size for Instagram and social posts, without stretching. Free, no upload.',
    h1: 'Resize Image to 1080×1080 Pixels',
    lead: 'Resize photos to a 1080×1080 square, the standard size for Instagram and other social posts, without stretching. No upload.',
    intro: [
      '1080×1080 pixels is the standard square post size on Instagram and works well on Facebook, LinkedIn and WhatsApp status.',
      'The size is preset below. Photos are centre-cropped to a square so nothing looks squashed. Switch to fit with borders if you want the whole photo visible.',
    ],
    uses: ['Instagram square posts', 'Facebook and LinkedIn images', 'Product photos for social shops', 'Quote graphics and announcements'],
    tips: [
      'Want the whole photo with no crop? Change the fit option to add borders.',
      'Save as JPG for photos. Social apps recompress images anyway.',
      'For a vertical post, crop to 4:5 first with <a href="/crop-image">Crop Image</a>.',
    ],
    faqs: [
      { q: 'Why does Instagram use 1080 pixels?', a: 'It’s the width Instagram displays posts at. Uploading exactly 1080 wide avoids extra resizing by the app.' },
      { q: 'Will my photo lose quality?', a: 'Large phone photos are downscaled with high-quality smoothing, so they stay sharp at 1080×1080.' },
      privacyFaq,
    ],
  },
  {
    tool: 'resize-image', size: { w: 1280, h: 720 }, slug: 'resize-image-to-1280x720', name: '1280×720',
    title: 'Resize Image to 1280×720 (YouTube Thumbnail) | PDFSherpa',
    description: 'Resize images to 1280×720 px, the recommended YouTube thumbnail size and standard 16:9 HD frame. Free, no upload.',
    h1: 'Resize Image to 1280×720 Pixels',
    lead: 'Resize any image to 1280×720, the recommended YouTube thumbnail size and standard 16:9 HD frame. Processed on your device.',
    intro: [
      '1280×720 pixels (720p) is YouTube’s recommended thumbnail size and a common 16:9 size for slides, blog headers and video frames.',
      'The size is preset below. Images are centre-cropped to 16:9 so they fill the frame without stretching.',
    ],
    uses: ['YouTube thumbnails', '16:9 slides and presentation backgrounds', 'Blog and article header images', 'Video title cards'],
    tips: [
      'Thumbnails often have a 2MB upload limit. Set a maximum size before saving if needed.',
      'To choose exactly which part stays, crop to 16:9 first with <a href="/crop-image">Crop Image</a>.',
    ],
    faqs: [
      { q: 'What aspect ratio is 1280×720?', a: '16:9, the same as HD and Full HD video.' },
      { q: 'Should I save as JPG or PNG?', a: 'JPG for photo thumbnails, which keeps them small. PNG if the image is mostly text and flat colours.' },
      privacyFaq,
    ],
  },
  /* ---------------- added: more sizes ---------------- */
  {
    tool: 'compress-pdf', target: '50', slug: 'compress-pdf-to-50kb', name: '50KB',
    title: 'Compress PDF to 50KB Online Free (No Upload) | PDFSherpa',
    description: 'Shrink a PDF to under 50KB for the strictest upload forms. Target preset, honest result if it can’t fit. Free, private, no signup.',
    h1: 'Compress PDF to 50KB',
    lead: 'Squeeze a PDF under 50KB for forms with very strict limits. The 50KB target is preset and your file stays on your device.',
    intro: [
      '50KB is an extreme limit, usually set for a single scanned certificate, a photo ID or a one-page receipt. Typed one-page documents fit easily. Scans need everything else to be right too.',
      'PDFSherpa lowers image quality step by step until the file is under 50KB, and tells you honestly if a document simply has too much in it to fit.',
    ],
    uses: ['A single scanned certificate or ID card', 'One-page receipts and challans', 'Typed one-page letters and affidavits', 'Small declarations for exam forms'],
    tips: [
      'Keep it to one page. Remove the rest with <a href="/delete-pdf-pages">Delete Pages</a>.',
      'Crop scanner borders with <a href="/crop-pdf">Crop PDF</a> and convert to black and white with <a href="/grayscale-pdf">Grayscale PDF</a> before compressing.',
      'Scanning again? <a href="/scan-to-pdf">Scan to PDF</a> with the Document look produces very small pages.',
    ],
    faqs: [
      { q: 'Can a scanned page really fit in 50KB?', a: 'Usually yes for one page in black and white, at a lower resolution that is still readable. Colour photos and multi-page scans rarely fit.' },
      { q: 'What if it still doesn’t fit?', a: 'The result shows the smallest size reached. Try one page at a time, grayscale, or a tighter crop.' },
      privacyFaq,
    ],
  },
  {
    tool: 'compress-pdf', target: '300', slug: 'compress-pdf-to-300kb', name: '300KB',
    title: 'Compress PDF to 300KB Online Free | PDFSherpa',
    description: 'Get a PDF under 300KB for application portals while keeping scans clear. Target preset. Free, private, no upload.',
    h1: 'Compress PDF to 300KB',
    lead: 'Bring a PDF under 300KB with clear, readable pages. The 300KB target is preset and nothing is uploaded.',
    intro: [
      '300KB is a common limit for application documents: experience letters, transcripts and identity proofs that are a few pages long.',
      'With the 300KB target selected, PDFSherpa removes waste first and only lowers photo quality as much as needed.',
    ],
    uses: ['Experience and salary certificates', 'Two- to five-page scanned transcripts', 'Address proof such as utility bills', 'Signed application forms'],
    tips: [
      'Merging documents for one upload? Use <a href="/merge-pdf">Merge PDF</a> first, then compress the combined file.',
      'Password-protected bills must be unlocked first with <a href="/unlock-pdf">Unlock PDF</a>.',
    ],
    faqs: [
      { q: 'How many scanned pages fit in 300KB?', a: 'Typically 3–6 black-and-white pages, or 2–3 colour pages, at good readable quality.' },
      { q: 'Will text stay selectable?', a: 'In typed PDFs, yes. Scans are images already, so they stay images.' },
      privacyFaq,
    ],
  },
  {
    tool: 'compress-image', target: '10', slug: 'compress-image-to-10kb', name: '10KB',
    title: 'Compress Image to 10KB Online Free (Signature) | PDFSherpa',
    description: 'Reduce a signature or small photo to under 10KB for exam and bank forms, with smart resizing. Free, private, no upload.',
    h1: 'Compress Image to 10KB',
    lead: 'Get a signature or thumbnail under 10KB, the limit some exam and bank forms use. The 10KB target is preset and nothing is uploaded.',
    intro: [
      '10KB is tiny: it’s meant for signatures, thumb impressions and very small photos. Getting there cleanly depends on cropping tightly and using small pixel dimensions.',
      'PDFSherpa lowers JPG quality first, then pixel size, and stops as soon as the image is under 10KB.',
    ],
    uses: ['Signature uploads on exam and recruitment forms', 'Thumb impressions', 'Tiny ID thumbnails', 'Bank form signatures'],
    tips: [
      'Clean the signature first with <a href="/signature-cleaner">Signature Cleaner</a>. A white background compresses far better than grey paper.',
      'Crop to just the signature with <a href="/crop-image">Crop Image</a>.',
      'If the form also wants exact pixels, use <a href="/resize-image-to-140x60">Resize to 140×60</a>.',
    ],
    faqs: [
      { q: 'Can a photo of my face fit in 10KB?', a: 'Only at a small size, around 150–200 pixels wide. For face photos, 20–50KB is more usual.' },
      { q: 'Why JPG and not PNG?', a: 'JPG is much smaller for scanned signatures and is accepted by almost every form.' },
      privacyFaq,
    ],
  },
  {
    tool: 'compress-image', target: '30', slug: 'compress-image-to-30kb', name: '30KB',
    title: 'Compress Image to 30KB Online Free (JPG) | PDFSherpa',
    description: 'Reduce a photo or signature to under 30KB for online application forms while keeping it clear. Free, private, no upload.',
    h1: 'Compress Image to 30KB',
    lead: 'Shrink a photo or signature to under 30KB for application forms. The 30KB target is preset and your image stays on your device.',
    intro: [
      'Many forms ask for a photo between 20KB and 50KB, or a signature under 30KB. Aiming for 30KB keeps you safely inside both kinds of rule.',
      'PDFSherpa compresses to just under 30KB, keeping as much detail as that allows.',
    ],
    uses: ['Applicant photos with a 20–50KB range', 'Signatures with a 30KB limit', 'Photos for student and staff ID forms', 'Profile photos on government portals'],
    tips: [
      'For an exact passport size, use <a href="/passport-photo-maker">Passport Photo</a> and set a 50KB limit there.',
      'A plain light background makes faces sharper at small sizes.',
    ],
    faqs: [
      { q: 'The form says minimum 20KB. Will 30KB be accepted?', a: 'Yes. PDFSherpa aims just under 30KB, not as small as possible, so it stays above a 20KB minimum for typical photos.' },
      { q: 'Can I do several photos at once?', a: 'Yes. Drop them together and each is compressed separately.' },
      privacyFaq,
    ],
  },
  {
    tool: 'resize-image', size: { w: 140, h: 60 }, slug: 'resize-image-to-140x60', name: '140×60',
    title: 'Resize Signature to 140×60 Pixels Online Free | PDFSherpa',
    description: 'Resize a signature image to exactly 140×60 pixels for bank and exam application forms. Free, private, no upload.',
    h1: 'Resize Signature to 140×60 Pixels',
    lead: 'Resize a signature to exactly 140×60 pixels, a size several bank and exam forms ask for. Your image never leaves your device.',
    intro: [
      '140×60 pixels is a signature size used by some bank recruitment and exam forms. Rules differ between forms, so always check the size on the official notification.',
      'The size is preset below and the signature is centre-cropped to the right shape. Set a KB limit too if the form has one.',
    ],
    uses: ['Bank recruitment exam signatures', 'Exam and admission form signatures', 'Signature fields on online applications'],
    tips: [
      'Photograph the signature on white paper and clean it with <a href="/signature-cleaner">Signature Cleaner</a> first.',
      'Crop it tightly with <a href="/crop-image">Crop Image</a> so the centre crop doesn’t cut any strokes.',
      'Most forms also have a KB limit, often 10–20KB. Set it before saving, or use <a href="/compress-image-to-10kb">Compress to 10KB</a>.',
    ],
    faqs: [
      { q: 'Will my signature be squashed?', a: 'No. It’s cropped to the 140×60 shape from the centre. Crop it yourself first if you want to choose exactly what stays.' },
      { q: 'Is 140×60 right for my form?', a: 'Check the official notification. Signature sizes vary between forms and years, and portals reject the wrong size.' },
      privacyFaq,
    ],
  },

  /* ---------------- added: format conversions ---------------- */
  {
    tool: 'pdf-to-jpg', format: 'png', slug: 'pdf-to-png', name: 'PDF to PNG',
    title: 'PDF to PNG Converter – High Quality, Free | PDFSherpa',
    description: 'Convert PDF pages to lossless PNG images with sharp text, at 72–300 DPI. One page or all as a zip. Free, no upload.',
    h1: 'PDF to PNG',
    lead: 'Turn PDF pages into lossless PNG images with crisp text and lines. Choose the resolution, download one or all. Nothing is uploaded.',
    intro: [
      'PNG keeps every pixel exactly, so text, tables and diagrams stay razor-sharp. That makes it better than JPG for screenshots of documents, slides and charts.',
      'PNG is preselected below. Pick 150 DPI for screens or 300 DPI for print and zooming.',
    ],
    uses: ['Slides and diagrams for presentations', 'Document pages for websites and wikis', 'Charts and tables for reports', 'Pages with transparent-looking line art'],
    tips: [
      'PNG files are larger than JPG. If size matters more than sharpness, switch to JPG.',
      'To get the original photos out of a PDF rather than whole pages, use <a href="/extract-images-from-pdf">Extract Images</a>.',
    ],
    faqs: [
      { q: 'PNG or JPG for PDF pages?', a: 'PNG for text, charts and diagrams, because it’s lossless and sharp. JPG for photo-heavy pages, because files are much smaller.' },
      { q: 'Can I convert only some pages?', a: 'Yes. Type the page numbers or ranges you want before converting.' },
      privacyFaq,
    ],
  },
  {
    tool: 'jpg-to-pdf', slug: 'png-to-pdf', name: 'PNG to PDF',
    title: 'PNG to PDF Converter – Combine PNGs Free | PDFSherpa',
    description: 'Convert PNG images, screenshots and scans into one PDF. Reorder pages, choose page size and margins. Free, no upload.',
    h1: 'PNG to PDF',
    lead: 'Combine PNG screenshots and images into one PDF. Reorder, pick A4 or Letter, and download. Your images never leave your device.',
    intro: [
      'PNG is the usual format for screenshots and graphics. Turning a set of them into one PDF makes them easy to send, print or upload as a single file.',
      'The converter accepts PNG, JPG and WebP together, so mixed images become one PDF in the order you choose.',
    ],
    uses: ['Screenshots of payments, chats or receipts', 'Scanned pages saved as PNG', 'Design mock-ups and diagrams', 'Certificates downloaded as images'],
    tips: [
      'Large PNG screenshots make big PDFs. Run the result through <a href="/compress-pdf">Compress PDF</a> if needed.',
      'Use A4 for printing and “Fit” to keep each image’s own size.',
    ],
    faqs: [
      { q: 'Is transparency kept?', a: 'Transparent areas appear white in the PDF, which is how they would print.' },
      { q: 'Can I mix PNG and JPG?', a: 'Yes. Add any mix of PNG, JPG and WebP images.' },
      privacyFaq,
    ],
  },
  {
    tool: 'image-converter', format: 'image/png', slug: 'jpg-to-png', name: 'JPG to PNG',
    title: 'JPG to PNG Converter Online Free | PDFSherpa',
    description: 'Convert JPG photos to PNG in your browser, one or many at once. Lossless output for editing and graphics. Free, no upload.',
    h1: 'JPG to PNG',
    lead: 'Convert JPG images to PNG, one or many at once. PNG is lossless, so nothing more is lost when you edit and save again.',
    intro: [
      'PNG is the better format when an image will be edited, layered or saved several times, because it doesn’t add compression each time.',
      'PNG is preselected below. Note that converting can’t restore detail a JPG already lost, and PNG files are bigger.',
    ],
    uses: ['Images you will edit further', 'Logos and graphics for design tools', 'Forms or apps that only accept PNG', 'Screenshots you want to keep lossless'],
    tips: [
      'Need a transparent background for a signature? Use <a href="/signature-cleaner">Signature Cleaner</a>. Converting alone doesn’t remove a background.',
      'If the PNG is too large for a form, convert to JPG instead or compress it.',
    ],
    faqs: [
      { q: 'Does JPG to PNG improve quality?', a: 'No. It stops further loss, but can’t bring back detail the JPG already discarded.' },
      { q: 'Why is the PNG bigger?', a: 'PNG stores pixels without lossy compression, so photos take more space.' },
      privacyFaq,
    ],
  },
  {
    tool: 'image-converter', format: 'image/jpeg', slug: 'png-to-jpg', name: 'PNG to JPG',
    title: 'PNG to JPG Converter Online Free | PDFSherpa',
    description: 'Convert PNG images to smaller JPG files in your browser, one or many at once. Choose quality. Free, private, no upload.',
    h1: 'PNG to JPG',
    lead: 'Turn large PNG images into much smaller JPG files that every form and app accepts. Converted on your device.',
    intro: [
      'PNG photos and screenshots can be several megabytes. Converting to JPG often makes them five to ten times smaller with little visible difference.',
      'JPG is preselected below. Transparent areas become white, since JPG has no transparency.',
    ],
    uses: ['Upload forms that only accept JPG', 'Shrinking screenshots before emailing', 'Photos saved as PNG by mistake', 'Images for websites and chat apps'],
    tips: [
      'Need a specific KB size? Use <a href="/compress-image">Compress Image</a> after converting.',
      'Keep logos with transparency as PNG. JPG fills the background with white.',
    ],
    faqs: [
      { q: 'Will I lose quality?', a: 'Slightly, because JPG is lossy, but at high quality the difference is hard to see for photos.' },
      { q: 'What happens to transparent areas?', a: 'They become white.' },
      privacyFaq,
    ],
  },
  {
    tool: 'image-converter', format: 'image/jpeg', slug: 'webp-to-jpg', name: 'WebP to JPG',
    title: 'WebP to JPG Converter Online Free | PDFSherpa',
    description: 'Convert WebP images from websites into JPG that every app and form accepts. Batch conversion, free, no upload.',
    h1: 'WebP to JPG',
    lead: 'Convert WebP images saved from websites into JPG files that work everywhere. Batch conversion, all on your device.',
    intro: [
      'Many websites serve images as WebP. When you save one, older apps, some editors and many upload forms refuse to open it.',
      'JPG is preselected below. Drop one or many WebP files and save them as JPG.',
    ],
    uses: ['Images saved from websites', 'Product photos from online shops', 'Images for forms that reject WebP', 'Photos for older editing apps'],
    tips: [
      'Want lossless output instead? Choose PNG.',
      'For more on formats, read the <a href="/guides/convert-webp-to-jpg">WebP to JPG guide</a>.',
    ],
    faqs: [
      { q: 'Why do websites use WebP?', a: 'It’s smaller than JPG at the same quality, so pages load faster.' },
      { q: 'Can I convert many WebP files at once?', a: 'Yes. Drop them all and save each converted JPG.' },
      privacyFaq,
    ],
  },
  /* ---------------- OCR ---------------- */
  {
    tool: 'ocr-pdf', mode: 'image', slug: 'image-to-text', name: 'Image to Text',
    title: 'Image to Text Converter (OCR) – Free, No Upload | PDFSherpa',
    description: 'Extract text from photos, screenshots and scans in English, Urdu or Hindi. Copy it or save as .txt. Free OCR that runs on your device.',
    h1: 'Image to Text',
    lead: 'Copy the text out of any photo, screenshot or scanned page. Works in English, Urdu and Hindi, and the image never leaves your device.',
    intro: [
      'Image to Text uses OCR (optical character recognition) to read the letters in a picture and turn them into text you can copy, edit and search.',
      'Recognition runs entirely in your browser. The first time, the recognition engine downloads once (a few MB). After that it works offline.',
    ],
    uses: ['Copy text from a screenshot or photo of a notice', 'Type up a printed page without retyping it', 'Get the text of a scanned letter or receipt', 'Pull quotes out of photos of books and slides'],
    tips: [
      'Use a sharp, well-lit photo taken straight on. Blur is the biggest cause of mistakes.',
      'Crop to just the text with <a href="/crop-image">Crop Image</a> so pictures and edges aren’t read as letters.',
      'For a whole scanned document, drop the PDF instead and download a searchable PDF.',
      'Choose the right language. English OCR can’t read Urdu or Hindi letters.',
    ],
    faqs: [
      { q: 'Which languages are supported?', a: 'English, Urdu and Hindi. Pick the language before you start.' },
      { q: 'How accurate is it?', a: 'For clear printed text, very accurate. Handwriting, very small text and blurry photos give more mistakes, so check the result. The confidence score helps.' },
      privacyFaq,
    ],
  },
];

export const landingsForTool = (tool: string) => landings.filter((l) => l.tool === tool);
