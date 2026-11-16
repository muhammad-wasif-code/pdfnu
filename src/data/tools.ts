export type Category = 'Optimize' | 'Organize' | 'Convert' | 'Security' | 'Edit';

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
  { slug: 'compress-image', name: 'Compress Image', short: 'Compress Image', tagline: 'Reduce image size', category: 'Optimize', from: '#4ade80', to: '#0d9488', icon: 'imgcompress', keywords: 'compress image jpg png reduce size kb 20kb 50kb photo' },
  { slug: 'resize-image', name: 'Resize Image', short: 'Resize Image', tagline: 'Change dimensions', category: 'Optimize', from: '#c084fc', to: '#9333ea', icon: 'resize', keywords: 'resize image pixels dimensions passport photo signature' },
];

export const categories: { name: Category; accent: string }[] = [
  { name: 'Optimize', accent: 'text-rose-600 dark:text-rose-400' },
  { name: 'Organize', accent: 'text-blue-600 dark:text-blue-400' },
  { name: 'Convert', accent: 'text-amber-600 dark:text-amber-400' },
  { name: 'Edit', accent: 'text-pink-600 dark:text-pink-400' },
  { name: 'Security', accent: 'text-violet-600 dark:text-violet-400' },
];

export const getTool = (slug: string) => {
  const t = tools.find((x) => x.slug === slug);
  if (!t) throw new Error(`Unknown tool ${slug}`);
  return t;
};
