/** Complete a text turn only after the persistence requested by its caller.
 * The surrounding owner admission ledger owns retries and terminal replay.
 */
export async function deliverOwnerTextTurn<T>(input: {
  persistUserMessage: boolean;
  persistAssistantMessage: boolean;
  persistOwner: () => Promise<unknown>;
  generate: () => Promise<T>;
  persistAssistant: (result: T) => Promise<string>;
}): Promise<{ result: T; assistantMessageId: string | null }> {
  if (input.persistUserMessage) await input.persistOwner();
  const result = await input.generate();
  const assistantMessageId = input.persistAssistantMessage ? await input.persistAssistant(result) : null;
  if (input.persistAssistantMessage && !assistantMessageId) {
    throw new Error('OWNER_TEXT_HISTORY_PERSISTENCE_FAILED');
  }
  return { result, assistantMessageId };
}
