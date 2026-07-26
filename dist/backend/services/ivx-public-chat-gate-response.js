/** Formats a policy block as a visible, successful chat turn. */
export function formatPublicChatGateBlock(block) {
    return [
        'STATE: BLOCKED',
        `TASK_ID: ${block.taskId}`,
        `BLOCKER_CODE: ${block.blockerCode}`,
        `EXACT_BLOCKER: ${block.exactBlocker}`,
        `NEXT_OWNER_ACTION: ${block.nextOwnerAction}`,
        `MARKER: ${block.marker}`,
    ].join('\n');
}
