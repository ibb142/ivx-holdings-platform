import { describe, expect, test } from 'bun:test';
import { extractLandingProjectsFromHtml } from './ivx-landing-inspector';
import { resolveLandingInspectionIntent, resolveMediaAnalysisIntent, } from './ivx-owner-ai-intent-router';
const SAMPLE_HTML = `
<html>
<head><title>IVX Holding — Real Estate Investment</title>
<meta name="description" content="Invest in curated real estate projects." /></head>
<body>
  <nav><a href="/login">Login</a><a href="/projects">Projects</a></nav>
  <h1>Our Projects</h1>
  <section>
    <h2>Casa Rosario</h2>
    <p>Location: Lisbon, Portugal. Price: $1,200,000. ROI: 14% annual.
       Timeline: 18 months. Ownership minimum: $50,000.</p>
    <a href="/invest/casa-rosario">Invest now</a>
  </section>
  <section>
    <h2>The Highlands Residences</h2>
    <p>Location: Aspen, USA. Price: $3.5 million. ROI: 11% yield. Timeline: 24 months.</p>
  </section>
  <footer><a href="/contact">Contact us</a></footer>
</body>
</html>`;
describe('extractLandingProjectsFromHtml', () => {
    test('extracts Casa Rosario with its details', () => {
        const projects = extractLandingProjectsFromHtml(SAMPLE_HTML);
        const names = projects.map((p) => p.name);
        expect(names).toContain('Casa Rosario');
        expect(names).toContain('The Highlands Residences');
        const casa = projects.find((p) => p.name === 'Casa Rosario');
        expect(casa).toBeDefined();
        expect(casa?.location).toContain('Lisbon');
        expect(casa?.price).toContain('$');
        expect(casa?.roi).toContain('%');
    });
    test('does not treat nav/marketing headings as projects', () => {
        const projects = extractLandingProjectsFromHtml(SAMPLE_HTML);
        const names = projects.map((p) => p.name.toLowerCase());
        expect(names).not.toContain('our projects');
        expect(names).not.toContain('projects');
    });
});
describe('resolveLandingInspectionIntent', () => {
    test('fires on landing-page / project / Casa Rosario prompts', () => {
        expect(resolveLandingInspectionIntent('Can you see Casa Rosario on landing page?')).toBe(true);
        expect(resolveLandingInspectionIntent('What are the 3 projects on my page?')).toBe(true);
        expect(resolveLandingInspectionIntent('Audit Casa Rosario')).toBe(true);
        expect(resolveLandingInspectionIntent('list the projects on ivxholding.com')).toBe(true);
        expect(resolveLandingInspectionIntent('can you view the landing page')).toBe(true);
    });
    test('does not fire on unrelated prompts', () => {
        expect(resolveLandingInspectionIntent('what time is it')).toBe(false);
        expect(resolveLandingInspectionIntent('how is revenue trending')).toBe(false);
    });
});
describe('resolveMediaAnalysisIntent', () => {
    test('detects image vs video analysis requests', () => {
        expect(resolveMediaAnalysisIntent('analyze this screenshot')).toBe('image');
        expect(resolveMediaAnalysisIntent('what is in the attached image?')).toBe('image');
        expect(resolveMediaAnalysisIntent('can you analyze this video clip?')).toBe('video');
    });
    test('returns null for non-media prompts', () => {
        expect(resolveMediaAnalysisIntent('list the projects')).toBeNull();
    });
});
