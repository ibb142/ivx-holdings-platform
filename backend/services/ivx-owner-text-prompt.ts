import type { IVXAITextMessage } from '../ivx-ai-runtime';
import { buildSeniorEngineerSystemPrompt } from './ivx-senior-engineer-persona';

/** Preserve conversational roles and make the current request the final turn.
 * History is context, not a fresh owner instruction or a trusted system rule.
 * This only prepares input; the owner routes must still call the real runtime.
 */
export function buildOwnerTextModelInput(input: {
  request: string;
  history: readonly IVXAITextMessage[];
  liveContext?: string;
}): { system: string; messages: IVXAITextMessage[] } {
  const history = input.history
    .filter((message) => (message.role === 'user' || message.role === 'assistant') && message.content.trim().length > 0)
    .slice(-12)
    .map((message) => ({ role: message.role, content: message.content }));

  return {
    system: buildSeniorEngineerSystemPrompt(input.liveContext),
    messages: [...history, { role: 'user', content: input.request }],
  };
}
