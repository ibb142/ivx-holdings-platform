export const IVX_OWNER_AI_ROOM_ID = '8f5a9c42-1cb5-4f81-b2d8-6f3a0a8b9d41';
export const IVX_OWNER_AI_ROOM_SLUG = 'ivx-owner-room';
export const IVX_OWNER_AI_FEATURE_LABELS = {
    ai_chat: 'AI chat',
    inbox: 'Inbox',
    shared_room: 'Shared room',
    file_upload: 'File upload',
    knowledge_base: 'Knowledge base',
    owner_commands: 'Owner commands',
};
export const IVX_OWNER_AI_PROFILE = {
    name: 'IVX Owner AI',
    platform: 'web_and_mobile',
    audience: 'owner_only',
    codeAccess: 'no',
    stack: ['Next.js', 'Expo', 'Supabase'],
    features: [
        'ai_chat',
        'inbox',
        'shared_room',
        'file_upload',
    ],
    sharedRoom: {
        id: IVX_OWNER_AI_ROOM_ID,
        slug: IVX_OWNER_AI_ROOM_SLUG,
        title: 'IVX Owner AI Room',
        subtitle: 'Owner-only shared room for AI chat, inbox, uploads, knowledge, and commands.',
        badgeText: 'Owner AI',
        emptyTitle: 'No owner messages yet',
        emptyText: 'Start with a note, message, image, video, or document.',
        capabilityPills: ['AI chat', 'Inbox sync', 'Shared room', 'File upload'],
    },
    support: {
        assistantDisplayName: 'IVX Owner AI',
        welcomeMessage: 'Hello - I am IVX Owner AI. I can help with owner chat, inbox triage, shared-room updates, and file uploads across web and mobile.',
        quickReplies: [
            'Show my owner inbox',
            'Summarize the shared room',
            'Help me upload a file',
            'What can you help with?',
        ],
    },
};
export const IVX_OWNER_AI_BRIEF_DEFAULTS = {
    platform: IVX_OWNER_AI_PROFILE.platform,
    audience: IVX_OWNER_AI_PROFILE.audience,
    codeAccess: 'no',
    aiName: IVX_OWNER_AI_PROFILE.name,
    selectedFeatures: [...IVX_OWNER_AI_PROFILE.features],
    customFeatures: '',
    stack: [...IVX_OWNER_AI_PROFILE.stack],
};
