import { IVX_CHAT_UPLOAD_BUCKET } from '@/shared/ivx';

const DEFAULT_CHAT_UPLOAD_BUCKET = IVX_CHAT_UPLOAD_BUCKET;

let chatUploadBucketName = DEFAULT_CHAT_UPLOAD_BUCKET;

type ChatUploadConfig = {
  bucketName?: string;
};

export function configureChatUploads(config: ChatUploadConfig): void {
  const normalizedBucketName = config.bucketName?.trim();

  if (!normalizedBucketName) {
    chatUploadBucketName = DEFAULT_CHAT_UPLOAD_BUCKET;
    console.log('[ChatUploadConfig] Using default chat upload bucket:', chatUploadBucketName);
    return;
  }

  chatUploadBucketName = normalizedBucketName;
  console.log('[ChatUploadConfig] Chat upload bucket configured:', chatUploadBucketName);
}

export function getChatUploadBucketName(): string {
  return chatUploadBucketName;
}

export function getDefaultChatUploadBucketName(): string {
  return DEFAULT_CHAT_UPLOAD_BUCKET;
}
