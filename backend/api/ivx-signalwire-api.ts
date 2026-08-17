/**
 * IVX SignalWire API
 *
 * HTTP endpoints for autonomous SMS and voice calls through SignalWire.
 * Voice calls use the ChatGPT-level Smart Voice Brain — with conversation
 * memory, context awareness, and follow-up question handling.
 *
 *   GET  /api/ivx/signalwire/status       — service health + capabilities
 *   POST /api/ivx/signalwire/sms           — send an SMS message
 *   GET  /api/ivx/signalwire/sms           — list recent SMS messages
 *   POST /api/ivx/signalwire/voice         — make a voice call
 *   GET  /api/ivx/signalwire/voice         — list recent voice calls
 *   POST /api/ivx/signalwire/voice/laml    — LaML webhook (greeting + Gather)
 *   POST /api/ivx/signalwire/voice/respond  — Smart AI response (with conversation memory)
 *   POST /api/ivx/signalwire/verify        — end-to-end cert: SMS + voice
 *   POST /api/ivx/signalwire/conversational — start a smart conversational voice call
 *   GET  /api/ivx/signalwire/voice/brain    — Smart Voice Brain status + active conversations
 */
import {
  sendSMS,
  makeVoiceCall,
  listSMS,
  listCalls,
  getSignalWireStatus,
  runSignalWireVerify,
  buildVoiceLaML,
  buildConversationalLaML,
  buildConversationResponseLaML,
  IVX_SIGNALWIRE_MARKER,
} from '../services/ivx-signalwire-service';
import {
  answerSmartVoiceQuestion,
  getVoiceBrainStatus,
  getConversationSummary,
  endSession,
  IVX_VOICE_BRAIN_MARKER,
} from '../services/ivx-voice-brain';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

function xml(content: string, status = 200): Response {
  return new Response(content, {
    status,
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

function readString(val: unknown): string {
  return typeof val === 'string' ? val.trim() : '';
}

interface ParsedBody {
  to?: string;
  from?: string;
  body?: string;
  message?: string;
  toNumber?: string;
  smsBody?: string;
  voiceMessage?: string;
  speechResult?: string;
  callSid?: string;
}

async function parseBody(req: Request): Promise<ParsedBody> {
  try {
    const ct = req.headers.get('Content-Type') || '';
    if (ct.includes('application/json')) {
      const data = await req.json() as Record<string, unknown>;
      return {
        to: typeof data['to'] === 'string' ? data['to'] : undefined,
        from: typeof data['from'] === 'string' ? data['from'] : undefined,
        body: typeof data['body'] === 'string' ? data['body'] : undefined,
        message: typeof data['message'] === 'string' ? data['message'] : undefined,
        toNumber: typeof data['toNumber'] === 'string' ? data['toNumber'] : undefined,
        smsBody: typeof data['smsBody'] === 'string' ? data['smsBody'] : undefined,
        voiceMessage: typeof data['voiceMessage'] === 'string' ? data['voiceMessage'] : undefined,
        speechResult: typeof data['speechResult'] === 'string' ? data['speechResult']
          : typeof data['SpeechResult'] === 'string' ? data['SpeechResult'] as string : undefined,
        callSid: typeof data['callSid'] === 'string' ? data['callSid']
          : typeof data['CallSid'] === 'string' ? data['CallSid'] as string : undefined,
      };
    }
    // application/x-www-form-urlencoded (SignalWire webhooks use this)
    const formData = await req.formData();
    return {
      to: (formData.get('To') as string) || undefined,
      from: (formData.get('From') as string) || undefined,
      body: (formData.get('Body') as string) || undefined,
      message: (formData.get('Message') as string) || undefined,
      speechResult: (formData.get('SpeechResult') as string) || undefined,
      callSid: (formData.get('CallSid') as string) || undefined,
    };
  } catch {
    return {};
  }
}

/**
 * GET /api/ivx/signalwire/status
 */
export function handleSignalWireStatus(): Response {
  const status = getSignalWireStatus();
  return json(status);
}

/**
 * POST /api/ivx/signalwire/sms
 * Body: { to: string, body: string, from?: string }
 */
export async function handleSignalWireSendSMS(req: Request): Promise<Response> {
  const body = await parseBody(req);
  const to = readString(body.to) || readString(body.toNumber);

  if (!to) {
    return json({ ok: false, error: 'Missing "to" phone number (E.164 format, e.g. +15616443503)' }, 400);
  }

  const smsBody = readString(body.body) || readString(body.smsBody);
  if (!smsBody) {
    return json({ ok: false, error: 'Missing "body" for SMS message' }, 400);
  }

  const result = await sendSMS(to, smsBody, { from: body.from });
  return json(result);
}

/**
 * GET /api/ivx/signalwire/sms
 * Query: ?pageSize=10
 */
export async function handleSignalWireListSMS(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const pageSize = parseInt(url.searchParams.get('pageSize') || '10', 10);
  const result = await listSMS(pageSize);
  return json(result);
}

/**
 * POST /api/ivx/signalwire/voice
 * Body: { to: string, message?: string, from?: string, conversational?: boolean }
 *
 * If conversational=true, the call uses the conversational LaML with Gather
 * for speech input, creating a real back-and-forth conversation with the AI brain.
 */
export async function handleSignalWireMakeVoiceCall(req: Request): Promise<Response> {
  const body = await parseBody(req);
  const to = readString(body.to) || readString(body.toNumber);

  if (!to) {
    return json({ ok: false, error: 'Missing "to" phone number (E.164 format, e.g. +15616443503)' }, 400);
  }

  const message = readString(body.message) || readString(body.voiceMessage) || '';
  const result = await makeVoiceCall(to, { message, from: body.from });
  return json(result);
}

/**
 * GET /api/ivx/signalwire/voice
 * Query: ?pageSize=10
 */
export async function handleSignalWireListCalls(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const pageSize = parseInt(url.searchParams.get('pageSize') || '10', 10);
  const result = await listCalls(pageSize);
  return json(result);
}

/**
 * POST /api/ivx/signalwire/voice/laml
 *
 * SignalWire webhook endpoint — returns conversational LaML when a call connects.
 * The LaML includes a <Gather> element so the caller can speak their question,
 * and the result is posted to /api/ivx/signalwire/voice/respond for AI processing.
 */
export function handleSignalWireVoiceLaML(req: Request): Response {
  const url = new URL(req.url);
  const conversational = url.searchParams.get('conversational') !== 'false';

  console.log(`[IVX SignalWire] LaML webhook called — conversational=${conversational}`);

  if (conversational) {
    const laMl = buildConversationalLaML({
      greeting: 'Hello, this is I V X Holdings autonomous assistant. I can answer questions about I V X Holdings, our 112 I A agents, our platform, act as a developer agent, or answer any question you have. What would you like to know?',
      gatherPrompt: 'Go ahead, ask me anything.',
    });
    return xml(laMl);
  }

  // Non-conversational (verification call)
  const defaultMessage = 'This is I V X Holdings autonomous verification call. SignalWire voice integration is now certified.';
  const laMl = buildVoiceLaML(defaultMessage);
  return xml(laMl);
}

/**
 * GET /api/ivx/signalwire/voice/brain
 *
 * Smart Voice Brain status — shows active conversations, total turns,
 * and conversation summaries for debugging/monitoring.
 */
export function handleVoiceBrainStatus(): Response {
  const brainStatus = getVoiceBrainStatus();
  return json({
    ok: true,
    ...brainStatus,
    timestamp: new Date().toISOString(),
  });
}

/**
 * POST /api/ivx/signalwire/voice/respond
 *
 * SignalWire posts the speech recognition result here after the caller speaks.
 * We pass the caller's question to the IVX Smart Voice Brain, which:
 *   1. Looks up the conversation history for this CallSid
 *   2. Passes prior Q&A turns as context to GPT-4o
 *   3. Gets a context-aware, ChatGPT-level answer
 *   4. Records the new turn in the conversation memory
 *   5. Returns LaML that says the answer then loops back to Gather
 *
 * This is the SMART CONVERSATIONAL LOOP:
 *   Caller speaks → SignalWire transcribes → Smart Brain (with memory) → Say + Gather again
 */
export async function handleSignalWireVoiceRespond(req: Request): Promise<Response> {
  const body = await parseBody(req);
  const url = new URL(req.url);
  const loopCount = parseInt(url.searchParams.get('loop') || '0', 10);

  const question = readString(body.speechResult) || readString(body.body);
  const callSid = readString(body.callSid) || 'unknown';

  console.log(`[IVX SignalWire] Voice respond — CallSid: ${callSid}, loop: ${loopCount}, question: "${question.substring(0, 100)}"`);

  if (!question) {
    const laMl = buildConversationResponseLaML({
      aiResponse: "I didn't hear a question. Could you please repeat that?",
      loopCount,
    });
    return xml(laMl);
  }

  // Send the question to the IVX Smart Voice Brain (with conversation memory)
  const result = await answerSmartVoiceQuestion(question, { callSid, loopCount });

  console.log(`[IVX SignalWire] Smart AI response — ok: ${result.ok}, turn: ${result.turnCount}, hadContext: ${result.hadContext}, topic: ${result.topicDetected || 'none'}, answer: "${result.answer.substring(0, 100)}"`);

  const laMl = buildConversationResponseLaML({
    aiResponse: result.answer,
    loopCount,
  });

  return xml(laMl);
}

/**
 * POST /api/ivx/signalwire/conversational
 * Body: { to?: string }
 *
 * Starts a conversational voice call where the caller can ask questions
 * and the IVX AI brain answers in real-time.
 */
export async function handleSignalWireConversationalCall(req: Request): Promise<Response> {
  const body = await parseBody(req);
  const to = readString(body.to) || readString(body.toNumber);

  if (!to) {
    return json({ ok: false, error: 'Missing "to" phone number' }, 400);
  }

  const result = await makeVoiceCall(to, {
    message: '',
    from: body.from,
  });

  // The call will use the conversational LaML webhook by default
  return json({
    ...result,
    conversational: true,
    description: 'Conversational voice call started. The caller can ask questions and the IVX AI brain will answer in real-time.',
  });
}

/**
 * POST /api/ivx/signalwire/verify
 * Body: { to?: string, smsBody?: string, voiceMessage?: string }
 *
 * End-to-end certification: sends a real SMS and makes a real voice call
 * through SignalWire, returns certification evidence.
 */
export async function handleSignalWireVerify(req: Request): Promise<Response> {
  const body = await parseBody(req);

  const result = await runSignalWireVerify({
    to: body.to || body.toNumber,
    smsBody: body.smsBody,
    voiceMessage: body.voiceMessage,
  });

  const certEvidence = {
    certId: result.certId,
    certified: result.certified,
    proofHash: result.proofHash,
    totalDurationMs: result.totalDurationMs,
    summary: result.summary,
    sms: {
      ok: result.sms.ok,
      sid: result.sms.sid,
      status: result.sms.status,
      from: result.sms.from,
      to: result.sms.to,
      body: result.sms.body,
      errorCode: result.sms.errorCode,
      errorMessage: result.sms.errorMessage,
      durationMs: result.sms.durationMs,
    },
    voice: {
      ok: result.voice.ok,
      sid: result.voice.sid,
      status: result.voice.status,
      from: result.voice.from,
      to: result.voice.to,
      lamlUrl: result.voice.lamlUrl,
      conversational: true,
      errorCode: result.voice.errorCode,
      errorMessage: result.voice.errorMessage,
      durationMs: result.voice.durationMs,
    },
    timestamp: new Date().toISOString(),
    marker: IVX_SIGNALWIRE_MARKER,
  };

  return json(certEvidence);
}
