/**
 * REAL user feedback only, shown on the home page.
 *
 * Rules (do not break these, search engines penalise fake reviews):
 *  - Add a review only if a real person actually wrote it (email, Reddit, LinkedIn, Product Hunt, GitHub…).
 *  - Ask their permission before publishing. Use the name they agree to (first name or handle is fine).
 *  - Copy their words; you may shorten, but don't change the meaning.
 *  - Put a public link in `url` when the comment is public, so visitors can verify it.
 *  - No star ratings and no Review/AggregateRating schema.
 *
 * The section stays hidden while this list is empty.
 */
export interface UserReview {
  text: string;
  name: string;
  /** Where it was written, e.g. "Email", "Reddit", "LinkedIn", "Product Hunt". */
  source: string;
  /** Public link to the original comment, when there is one. */
  url?: string;
  /** Tool they used, e.g. "Compress PDF" (optional). */
  tool?: string;
  /** YYYY-MM-DD */
  date: string;
}

export const reviews: UserReview[] = [
  // Example (keep commented out until you have a real one):
  // { text: 'Compressed my CV to under 200 KB on my phone in seconds.', name: 'Ali', source: 'Email', tool: 'Compress PDF', date: '2026-11-22' },
];
