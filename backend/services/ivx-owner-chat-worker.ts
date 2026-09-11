import { chatWorkerIdentity } from './ivx-chat-worker-identity';
import { enqueueOrAttachSeniorDeveloperJob, type IVXWorkerJobInput } from './ivx-senior-developer-worker';

/** Bind every owner-chat worker route to its originating command before admission. */
export function enqueueOwnerChatWorkerJob(input: IVXWorkerJobInput, conversationId: string | null, sourceMessageId: string) {
  return enqueueOrAttachSeniorDeveloperJob({
    ...input,
    conversationId,
    ...chatWorkerIdentity(input.ownerId ?? '', conversationId, sourceMessageId),
  });
}
