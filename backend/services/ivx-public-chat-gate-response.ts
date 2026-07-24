export type IVXPublicChatGateBlock = {
  taskId: string;
  blockerCode: string;
  exactBlocker: string;
  nextOwnerAction: string;
  marker: string;
};

/** Formats a policy block as a visible, successful chat turn. */
export function formatPublicChatGateBlock(block: IVXPublicChatGateBlock): string {
  return [
    'STATE: BLOCKED',
    `TASK_ID: ${block.taskId}`,
    `BLOCKER_CODE: ${block.blockerCode}`,
    `EXACT_BLOCKER: ${block.exactBlocker}`,
    `NEXT_OWNER_ACTION: ${block.nextOwnerAction}`,
    `MARKER: ${block.marker}`,
  ].join('\n');
}
