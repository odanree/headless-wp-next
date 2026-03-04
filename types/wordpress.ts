// WordPress REST API response shapes.
// Mirrors what the headless-wp WordPress plugin exposes.

export interface WordPressArticle {
  id: number;
  slug: string;
  title: string;
  excerpt: string;   // plain text, stripped of HTML
  content: string;   // safe HTML
  date: string;      // ISO 8601
  readTime: number;  // minutes, computed by plugin
  category: string;
}

export interface WordPressArticlesResponse {
  articles: WordPressArticle[];
  total: number;
  totalPages: number;
}

export type ArticleSummary = Pick<
  WordPressArticle,
  'id' | 'slug' | 'title' | 'excerpt' | 'date' | 'readTime' | 'category'
>;
