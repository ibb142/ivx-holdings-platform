/**
 * IVX IA Memory Commands — routing + parsing tests.
 *
 * Verifies the owner's reported bug: "my name is Ivan Perez" / "what is my name"
 * were not recognized by the intent router and fell through to clarification.
 */
import { describe, test, expect } from 'bun:test';
import { parseMemoryCommand, executeMemoryCommand } from './ivx-ia-memory-commands';
import { classifyIntent } from './ivx-authoritative-intent-router';

describe('IVX IA Memory Commands', () => {
  describe('parseMemoryCommand', () => {
    test('remembers explicit "remember my name is X"', () => {
      const cmd = parseMemoryCommand('remember my name is Ivan Perez');
      expect(cmd).toEqual({ kind: 'remember_name', value: 'Ivan Perez' });
    });

    test('remembers plain "my name is X"', () => {
      const cmd = parseMemoryCommand('my name is Ivan Perez');
      expect(cmd).toEqual({ kind: 'remember_name', value: 'Ivan Perez' });
    });

    test('remembers "my name is X and save it"', () => {
      const cmd = parseMemoryCommand('my name is Ivan Perez and save it');
      expect(cmd).toEqual({ kind: 'remember_name', value: 'Ivan Perez' });
    });

    test('remembers long owner phrase "I will tell you ... save this now"', () => {
      const cmd = parseMemoryCommand('I will tell you and I want you to saving in you brain my name is Ivan Perez owner and ceo ivxholding can you save this now');
      expect(cmd).toEqual({ kind: 'remember_name', value: 'Ivan Perez owner and ceo ivxholding' });
    });

    test('recalls "what is my name"', () => {
      const cmd = parseMemoryCommand('What is my name?');
      expect(cmd).toEqual({ kind: 'show_memory', value: '' });
    });

    test('recalls "who am i"', () => {
      const cmd = parseMemoryCommand('who am I');
      expect(cmd).toEqual({ kind: 'show_memory', value: '' });
    });

    test('recalls "show what you remember"', () => {
      const cmd = parseMemoryCommand('show what you remember');
      expect(cmd).toEqual({ kind: 'show_memory', value: '' });
    });

    test('handles "change my name to X"', () => {
      const cmd = parseMemoryCommand('change my name to Ivan P.');
      expect(cmd).toEqual({ kind: 'change_name', value: 'Ivan P' });
    });

    test('handles "call me X"', () => {
      const cmd = parseMemoryCommand('call me Ivan');
      expect(cmd).toEqual({ kind: 'change_name', value: 'Ivan' });
    });

    test('handles forget command', () => {
      const cmd = parseMemoryCommand('forget my name');
      expect(cmd).toEqual({ kind: 'forget_name', value: '' });
    });

    test('does not classify unrelated questions as memory', () => {
      expect(parseMemoryCommand('What is the weather?')).toBeNull();
      expect(parseMemoryCommand('Deploy the app')).toBeNull();
      expect(parseMemoryCommand('Can you save money?')).toBeNull();
    });
  });

  describe('authoritative intent router — memory routes', () => {
    test('routes "my name is Ivan Perez" to MEMORY_WRITE', () => {
      const d = classifyIntent({ message: 'my name is Ivan Perez', isOwner: true, isPublicPath: false });
      expect(d.selectedRoute).toBe('MEMORY_WRITE');
      expect(d.intent).toBe('memory_write');
    });

    test('routes "remember my name is Ivan Perez" to MEMORY_WRITE', () => {
      const d = classifyIntent({ message: 'remember my name is Ivan Perez', isOwner: true, isPublicPath: false });
      expect(d.selectedRoute).toBe('MEMORY_WRITE');
      expect(d.intent).toBe('memory_write');
    });

    test('routes "what is my name" to MEMORY_READ', () => {
      const d = classifyIntent({ message: 'what is my name', isOwner: true, isPublicPath: false });
      expect(d.selectedRoute).toBe('MEMORY_READ');
      expect(d.intent).toBe('memory_read');
    });

    test('routes "who am I" to MEMORY_READ', () => {
      const d = classifyIntent({ message: 'who am I', isOwner: true, isPublicPath: false });
      expect(d.selectedRoute).toBe('MEMORY_READ');
      expect(d.intent).toBe('memory_read');
    });

    test('routes "show what you remember" to MEMORY_READ', () => {
      const d = classifyIntent({ message: 'show what you remember', isOwner: true, isPublicPath: false });
      expect(d.selectedRoute).toBe('MEMORY_READ');
      expect(d.intent).toBe('memory_read');
    });

    test('does not route memory commands on public path', () => {
      const d = classifyIntent({ message: 'my name is Ivan Perez', isOwner: false, isPublicPath: true });
      expect(d.selectedRoute).not.toBe('MEMORY_WRITE');
      expect(d.intent).not.toBe('memory_write');
    });
  });

  describe('executeMemoryCommand', () => {
    test('stores and recalls a name end-to-end', async () => {
      const userId = 'test-owner-memory-' + Date.now();
      const write = await executeMemoryCommand(userId, { kind: 'remember_name', value: 'Ivan Perez' });
      expect(write.answer).toContain('Ivan Perez');
      const read = await executeMemoryCommand(userId, { kind: 'show_memory', value: '' });
      expect(read.answer).toContain('Ivan Perez');
      expect(read.profile).not.toBeNull();
      expect(read.profile?.fullName).toBe('Ivan Perez');
    });
  });
});
