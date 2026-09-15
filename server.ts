/**
 * IVX Holdings — Vercel Hono entrypoint
 *
 * Vercel detects this file as the backend entrypoint and invokes the exported
 * Hono application for each request. Local hosting belongs in a separate
 * development launcher rather than starting a listener at module load time.
 */
import { Hono } from 'hono';
import app from './backend/hono';

// Keep the framework import in the entrypoint for Vercel's backend detector.
void Hono;

export default app;
