/**
 * IVX Knowledge Base — Data Model Tests
 *
 * Verifies all 10 categories exist with correct article counts,
 * search functionality, and helper functions.
 */
import { describe, expect, test } from 'bun:test';
import {
  KB_CATEGORIES,
  KB_ARTICLES,
  KB_TOTAL_ARTICLES,
  KB_TOTAL_CATEGORIES,
  getCategoryById,
  getArticlesByCategory,
  getArticleById,
  searchArticles,
} from '../lib/knowledge-base-data';

const EXPECTED_CATEGORY_IDS = [
  'arquitectura',
  'reglas-miembros',
  'reglas-inversion',
  'documentacion-interna',
  'proyectos',
  'propiedades',
  'errores-anteriores',
  'soluciones-aprobadas',
  'procedimientos-qa',
  'politicas-seguridad',
] as const;

describe('IVX Knowledge Base Data', () => {
  test('has exactly 10 categories', () => {
    expect(KB_TOTAL_CATEGORIES).toBe(10);
    expect(KB_CATEGORIES).toHaveLength(10);
  });

  test('all 10 expected category IDs are present', () => {
    const ids = KB_CATEGORIES.map((c) => c.id);
    for (const expectedId of EXPECTED_CATEGORY_IDS) {
      expect(ids).toContain(expectedId);
    }
  });

  test('every category has required fields', () => {
    for (const cat of KB_CATEGORIES) {
      expect(cat.id).toBeTruthy();
      expect(cat.title).toBeTruthy();
      expect(cat.subtitle).toBeTruthy();
      expect(cat.icon).toBeTruthy();
      expect(cat.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(cat.articleCount).toBeGreaterThan(0);
    }
  });

  test('category articleCount matches actual article count', () => {
    for (const cat of KB_CATEGORIES) {
      const actualCount = getArticlesByCategory(cat.id).length;
      expect(cat.articleCount).toBe(actualCount);
    }
  });

  test('every article has valid structure', () => {
    for (const article of KB_ARTICLES) {
      expect(article.id).toBeTruthy();
      expect(article.categoryId).toBeTruthy();
      expect(article.title).toBeTruthy();
      expect(article.summary).toBeTruthy();
      expect(article.tags).toBeInstanceOf(Array);
      expect(article.tags.length).toBeGreaterThan(0);
      expect(article.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(article.author).toBeTruthy();
      expect(article.readTimeMin).toBeGreaterThan(0);
      expect(article.blocks).toBeInstanceOf(Array);
      expect(article.blocks.length).toBeGreaterThan(0);
    }
  });

  test('every article references a valid category', () => {
    for (const article of KB_ARTICLES) {
      const cat = getCategoryById(article.categoryId);
      expect(cat).toBeDefined();
    }
  });

  test('every block has a valid type', () => {
    const validTypes = ['heading', 'paragraph', 'list', 'code', 'callout', 'divider'];
    for (const article of KB_ARTICLES) {
      for (const block of article.blocks) {
        expect(validTypes).toContain(block.type);
      }
    }
  });

  test('callout blocks have valid variants', () => {
    const validVariants = ['info', 'warning', 'danger', 'success'];
    for (const article of KB_ARTICLES) {
      for (const block of article.blocks) {
        if (block.type === 'callout') {
          expect(validVariants).toContain(block.variant);
          expect(block.text).toBeTruthy();
        }
      }
    }
  });

  test('list blocks have non-empty items array', () => {
    for (const article of KB_ARTICLES) {
      for (const block of article.blocks) {
        if (block.type === 'list') {
          expect(block.items).toBeInstanceOf(Array);
          expect(block.items.length).toBeGreaterThan(0);
        }
      }
    }
  });

  test('code blocks have language and code', () => {
    for (const article of KB_ARTICLES) {
      for (const block of article.blocks) {
        if (block.type === 'code') {
          expect(block.language).toBeTruthy();
          expect(block.code).toBeTruthy();
        }
      }
    }
  });

  test('getCategoryById returns undefined for unknown ID', () => {
    expect(getCategoryById('nonexistent')).toBeUndefined();
  });

  test('getArticlesByCategory returns empty array for unknown category', () => {
    expect(getArticlesByCategory('nonexistent')).toEqual([]);
  });

  test('getArticleById returns undefined for unknown ID', () => {
    expect(getArticleById('nonexistent')).toBeUndefined();
  });

  test('searchArticles returns results for "arquitectura"', () => {
    const results = searchArticles('arquitectura');
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      const cat = getCategoryById(r.categoryId);
      const matchesTitle = r.title.toLowerCase().includes('arquitectura');
      const matchesSummary = r.summary.toLowerCase().includes('arquitectura');
      const matchesTags = r.tags.some((t) => t.toLowerCase().includes('arquitectura'));
      const matchesContent = r.blocks.some(
        (b) =>
          (b.type === 'paragraph' && b.text.toLowerCase().includes('arquitectura')) ||
          (b.type === 'heading' && b.text.toLowerCase().includes('arquitectura')) ||
          (b.type === 'list' && b.items.some((i) => i.toLowerCase().includes('arquitectura')))
      );
      const matchesCategory = cat?.title.toLowerCase().includes('arquitectura') ?? false;
      const matchesCatSubtitle = cat?.subtitle.toLowerCase().includes('arquitectura') ?? false;
      expect(matchesTitle || matchesSummary || matchesTags || matchesContent || matchesCategory || matchesCatSubtitle).toBe(true);
    }
  });

  test('searchArticles returns results for "seguridad"', () => {
    const results = searchArticles('seguridad');
    expect(results.length).toBeGreaterThan(0);
  });

  test('searchArticles returns results for "likes"', () => {
    const results = searchArticles('likes');
    expect(results.length).toBeGreaterThan(0);
  });

  test('searchArticles returns empty array for empty query', () => {
    expect(searchArticles('')).toEqual([]);
    expect(searchArticles('   ')).toEqual([]);
  });

  test('searchArticles is case-insensitive', () => {
    const lower = searchArticles('supabase');
    const upper = searchArticles('SUPABASE');
    const mixed = searchArticles('SuPaBaSe');
    expect(lower.length).toBe(upper.length);
    expect(lower.length).toBe(mixed.length);
  });

  test('searchArticles matches tag content', () => {
    const results = searchArticles('approved');
    expect(results.length).toBeGreaterThan(0);
  });

  test('all article IDs are unique', () => {
    const ids = KB_ARTICLES.map((a) => a.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  test('all category IDs are unique', () => {
    const ids = KB_CATEGORIES.map((c) => c.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  test('KB_TOTAL_ARTICLES matches actual count', () => {
    expect(KB_TOTAL_ARTICLES).toBe(KB_ARTICLES.length);
  });

  test('arquitectura category has at least 3 articles', () => {
    const articles = getArticlesByCategory('arquitectura');
    expect(articles.length).toBeGreaterThanOrEqual(3);
  });

  test('errores-anteriores category has at least 3 articles', () => {
    const articles = getArticlesByCategory('errores-anteriores');
    expect(articles.length).toBeGreaterThanOrEqual(3);
  });

  test('procedimientos-qa category has at least 3 articles', () => {
    const articles = getArticlesByCategory('procedimientos-qa');
    expect(articles.length).toBeGreaterThanOrEqual(3);
  });

  test('politicas-seguridad category has at least 3 articles', () => {
    const articles = getArticlesByCategory('politicas-seguridad');
    expect(articles.length).toBeGreaterThanOrEqual(3);
  });

  test('reglas-inversion category has at least 3 articles', () => {
    const articles = getArticlesByCategory('reglas-inversion');
    expect(articles.length).toBeGreaterThanOrEqual(3);
  });
});
