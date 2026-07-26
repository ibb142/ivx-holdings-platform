import { describe, expect, test } from 'bun:test';
import { splitTaskIntoBlocks } from './ivx-task-block-splitter';
describe('splitTaskIntoBlocks — explicit Block/Step headers', () => {
    test('splits on "Block N" headers', () => {
        const task = [
            'Build the orchestrator.',
            'Block 1: create the store',
            'persist task metadata',
            'Block 2: create the engine',
            'execute blocks one at a time',
            'Block 3: wire the API',
        ].join('\n');
        const blocks = splitTaskIntoBlocks(task);
        expect(blocks.length).toBe(3);
        expect(blocks[0].goal).toContain('create the store');
        expect(blocks[1].goal).toContain('execute blocks one at a time');
        expect(blocks[2].goal).toContain('wire the API');
    });
    test('splits on "Step N" headers', () => {
        const blocks = splitTaskIntoBlocks('Step 1: do A\nStep 2: do B');
        expect(blocks.length).toBe(2);
    });
});
describe('splitTaskIntoBlocks — numbered lists', () => {
    test('each numbered item becomes a block', () => {
        const task = '1. Receive owner task\n2. Save the original\n3. Split into blocks\n4. Execute block 1';
        const blocks = splitTaskIntoBlocks(task);
        expect(blocks.length).toBe(4);
        expect(blocks[0].goal).toContain('Receive owner task');
        expect(blocks[3].goal).toContain('Execute block 1');
    });
    test('wrapped continuation lines stay with their item', () => {
        const task = '1. First item\n   continues here\n2. Second item';
        const blocks = splitTaskIntoBlocks(task);
        expect(blocks.length).toBe(2);
        expect(blocks[0].goal).toContain('continues here');
    });
});
describe('splitTaskIntoBlocks — bullets + paragraphs', () => {
    test('bullet list items become blocks', () => {
        const blocks = splitTaskIntoBlocks('- alpha task\n- beta task\n- gamma task');
        expect(blocks.length).toBe(3);
    });
    test('blank-line paragraphs become blocks when no list markers', () => {
        const blocks = splitTaskIntoBlocks('First paragraph of work.\n\nSecond paragraph of work.');
        expect(blocks.length).toBe(2);
    });
});
describe('splitTaskIntoBlocks — edge cases', () => {
    test('empty task yields no blocks', () => {
        expect(splitTaskIntoBlocks('   ')).toEqual([]);
    });
    test('un-splittable single sentence yields one block', () => {
        const blocks = splitTaskIntoBlocks('Just fix the login button color.');
        expect(blocks.length).toBe(1);
        expect(blocks[0].goal).toBe('Just fix the login button color.');
    });
    test('derives a short title from the first line', () => {
        const blocks = splitTaskIntoBlocks('1. Create the durable task state store now\n2. next');
        expect(blocks[0].title.length).toBeGreaterThan(0);
        expect(blocks[0].title.length).toBeLessThanOrEqual(81);
    });
    test('caps an enormous numbered paste at 40 blocks, folding the remainder', () => {
        const lines = Array.from({ length: 60 }, (_, i) => `${i + 1}. task number ${i + 1}`);
        const blocks = splitTaskIntoBlocks(lines.join('\n'));
        expect(blocks.length).toBe(40);
        // The final block folds the remaining 21 items.
        expect(blocks[39].goal).toContain('task number 60');
    });
});
