import { describe, expect, it } from 'bun:test';
import { extractForms, detectNamesFromHeadings } from './ivx-web-navigator';
describe('extractForms — real form inspection', () => {
    it('parses method, resolved action, fields, and required flags', () => {
        const html = `
      <form method="POST" action="/api/contact">
        <input type="email" name="email" required />
        <input type="text" name="fullName" />
        <select name="interest"><option>Invest</option></select>
        <textarea name="message"></textarea>
        <button type="submit">Send message</button>
      </form>`;
        const forms = extractForms(html, 'https://ivxholding.com/contact');
        expect(forms).toHaveLength(1);
        const form = forms[0];
        expect(form.method).toBe('post');
        expect(form.action).toBe('https://ivxholding.com/api/contact');
        const names = form.fields.map((f) => f.name);
        expect(names).toContain('email');
        expect(names).toContain('fullName');
        expect(names).toContain('interest');
        expect(names).toContain('message');
        const email = form.fields.find((f) => f.name === 'email');
        expect(email.required).toBe(true);
        expect(form.submitLabels).toContain('Send message');
    });
    it('defaults to GET and self-action when omitted', () => {
        const forms = extractForms('<form><input name="q" /></form>', 'https://ivxholding.com');
        expect(forms[0].method).toBe('get');
        expect(forms[0].action).toBeNull();
    });
});
describe('detectNamesFromHeadings — project-name heuristic', () => {
    it('keeps multi-word proper nouns and drops nav chrome', () => {
        const names = detectNamesFromHeadings(['Casa Rosario', 'The Highlands Residences', 'About Us', 'Login', 'Contact']);
        expect(names).toContain('Casa Rosario');
        expect(names).toContain('The Highlands Residences');
        expect(names).not.toContain('About Us');
        expect(names).not.toContain('Login');
    });
});
