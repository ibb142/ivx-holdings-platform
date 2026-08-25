// IVX credential bridge — environment-only credentials.
// No provider credentials are embedded in source control.

interface Env {
  IVX_TWILIO_ACCOUNT_SID?: string;
  IVX_TWILIO_AUTH_TOKEN?: string;
  IVX_TWILIO_API_KEY_SID?: string;
  IVX_TWILIO_API_KEY_SECRET?: string;
  IVX_TWILIO_API_HOST?: string;
  IVX_TWILIO_MESSAGING_SERVICE_SID?: string;
  IVX_TWILIO_FROM_PHONE?: string;
  SUPABASE_URL?: string;
  IVX_SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SUPABASE_DB_URL?: string;
  SUPABASE_ACCESS_TOKEN?: string;
  AI_GATEWAY_API_KEY?: string;
  IVX_AI_GATEWAY_KEY?: string;
  IVX_AI_SYSTEM_SECRET?: string;
  AWS_ACCESS_KEY_ID?: string;
  AWS_SECRET_ACCESS_KEY?: string;
  AWS_REGION?: string;
  CLOUDFRONT_DISTRIBUTION_ID?: string;
  IVX_OWNER_TOKEN?: string;
  IVX_OWNER_EMAIL?: string;
  IVX_OWNER_REGISTRATION_EMAILS?: string;
  IVX_OWNER_PASSWORD?: string;
  IVX_OWNER_TOKEN_SESSION?: string;
  IVX_OWNER_SUPABASE_ACCESS_TOKEN?: string;
  RENDER_API_KEY?: string;
  RENDER_SERVICE_ID?: string;
}

function mask(val: string | undefined): string {
  if (!val) return "NOT_SET";
  if (val.length <= 8) return "***";
  return val.slice(0, 4) + "..." + val.slice(-4);
}

function resolveApiHost(customHost?: string): { host: string; provider: "twilio" | "signalwire" } {
  if (customHost) {
    const normalized = customHost.replace(/^https?:\/\//, "").replace(/\/$/, "");
    return {
      host: `https://${normalized}`,
      provider: normalized.toLowerCase().endsWith("signalwire.com") ? "signalwire" : "twilio",
    };
  }
  return { host: "https://api.twilio.com", provider: "twilio" };
}

function pushIfSet(envVars: Array<{ key: string; value: string }>, key: string, value?: string) {
  const trimmed = value?.trim();
  if (trimmed) envVars.push({ key, value: trimmed });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/ping") {
      return Response.json({ ok: true, now: new Date().toISOString() });
    }

    if (url.pathname === "/bridge-to-render") {
      const renderKey = env.RENDER_API_KEY?.trim();
      const renderService = env.RENDER_SERVICE_ID?.trim();
      if (!renderKey || !renderService) {
        return Response.json({ ok: false, error: "RENDER_API_KEY or RENDER_SERVICE_ID not set in Worker env" }, { status: 400 });
      }

      const envVars: Array<{ key: string; value: string }> = [];
      pushIfSet(envVars, "SUPABASE_URL", env.SUPABASE_URL);
      pushIfSet(envVars, "IVX_SUPABASE_URL", env.IVX_SUPABASE_URL);
      pushIfSet(envVars, "SUPABASE_SERVICE_ROLE_KEY", env.SUPABASE_SERVICE_ROLE_KEY);
      pushIfSet(envVars, "SUPABASE_DB_URL", env.SUPABASE_DB_URL);
      pushIfSet(envVars, "SUPABASE_ACCESS_TOKEN", env.SUPABASE_ACCESS_TOKEN);
      pushIfSet(envVars, "AI_GATEWAY_API_KEY", env.AI_GATEWAY_API_KEY);
      pushIfSet(envVars, "IVX_AI_GATEWAY_KEY", env.IVX_AI_GATEWAY_KEY);
      pushIfSet(envVars, "IVX_AI_SYSTEM_SECRET", env.IVX_AI_SYSTEM_SECRET);
      pushIfSet(envVars, "AWS_ACCESS_KEY_ID", env.AWS_ACCESS_KEY_ID);
      pushIfSet(envVars, "AWS_SECRET_ACCESS_KEY", env.AWS_SECRET_ACCESS_KEY);
      pushIfSet(envVars, "AWS_REGION", env.AWS_REGION);
      pushIfSet(envVars, "CLOUDFRONT_DISTRIBUTION_ID", env.CLOUDFRONT_DISTRIBUTION_ID);
      pushIfSet(envVars, "IVX_OWNER_TOKEN", env.IVX_OWNER_TOKEN);
      pushIfSet(envVars, "IVX_OWNER_EMAIL", env.IVX_OWNER_EMAIL);
      pushIfSet(envVars, "IVX_OWNER_REGISTRATION_EMAILS", env.IVX_OWNER_REGISTRATION_EMAILS);
      pushIfSet(envVars, "IVX_OWNER_PASSWORD", env.IVX_OWNER_PASSWORD);
      pushIfSet(envVars, "IVX_OWNER_TOKEN_SESSION", env.IVX_OWNER_TOKEN_SESSION);
      pushIfSet(envVars, "IVX_OWNER_SUPABASE_ACCESS_TOKEN", env.IVX_OWNER_SUPABASE_ACCESS_TOKEN);
      pushIfSet(envVars, "IVX_TWILIO_ACCOUNT_SID", env.IVX_TWILIO_ACCOUNT_SID);
      pushIfSet(envVars, "IVX_TWILIO_AUTH_TOKEN", env.IVX_TWILIO_AUTH_TOKEN);
      pushIfSet(envVars, "IVX_TWILIO_API_KEY_SID", env.IVX_TWILIO_API_KEY_SID);
      pushIfSet(envVars, "IVX_TWILIO_API_KEY_SECRET", env.IVX_TWILIO_API_KEY_SECRET);
      pushIfSet(envVars, "IVX_TWILIO_API_HOST", env.IVX_TWILIO_API_HOST);
      pushIfSet(envVars, "IVX_TWILIO_MESSAGING_SERVICE_SID", env.IVX_TWILIO_MESSAGING_SERVICE_SID);
      pushIfSet(envVars, "IVX_TWILIO_FROM_PHONE", env.IVX_TWILIO_FROM_PHONE);

      const renderRes = await fetch(`https://api.render.com/v1/services/${renderService}/env-vars`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${renderKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(envVars),
      });
      const renderText = await renderRes.text();
      const keysBridged = envVars.map((v) => v.key);

      if (renderRes.ok) {
        return Response.json({ ok: true, step: "env_bridge", count: envVars.length, keys: keysBridged });
      }
      return Response.json({ ok: false, step: "env_bridge", httpStatus: renderRes.status, error: renderText.slice(0, 500), keysAttempted: keysBridged }, { status: renderRes.status });
    }

    if (url.pathname === "/verify-and-send") {
      const accountSid = env.IVX_TWILIO_ACCOUNT_SID?.trim();
      const authToken = env.IVX_TWILIO_AUTH_TOKEN?.trim();
      const apiHost = env.IVX_TWILIO_API_HOST?.trim();
      const fromPhone = env.IVX_TWILIO_FROM_PHONE?.trim();
      const toPhone = url.searchParams.get("to")?.trim();
      const { host, provider } = resolveApiHost(apiHost);

      if (!accountSid || !authToken) {
        return Response.json({ ok: false, step: "credential_check", error: `Need provider credentials for ${provider}`, provider, host, accountSid: mask(accountSid), authToken: mask(authToken) }, { status: 400 });
      }
      if (!fromPhone || !toPhone) {
        return Response.json({ ok: false, step: "phone_check", error: "Both configured From phone and explicit to query parameter are required" }, { status: 400 });
      }

      const authHeader = "Basic " + btoa(`${accountSid}:${authToken}`);
      const acctRes = await fetch(`${host}/2010-04-01/Accounts/${accountSid}.json`, { headers: { Authorization: authHeader } });
      if (!acctRes.ok) {
        const acctText = await acctRes.text();
        return Response.json({ ok: false, step: "auth_verification", provider, host, httpStatus: acctRes.status, error: acctText.slice(0, 300) }, { status: 401 });
      }

      const messageBody = url.searchParams.get("body") || `IVX AI Verification: SMS system is LIVE. ${new Date().toISOString()}`;
      const params = new URLSearchParams({ To: toPhone, From: fromPhone, Body: messageBody });
      const smsRes = await fetch(`${host}/2010-04-01/Accounts/${accountSid}/Messages.json`, {
        method: "POST",
        headers: { Authorization: authHeader, "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });
      const smsText = await smsRes.text();
      if (smsRes.ok) {
        const data = JSON.parse(smsText);
        return Response.json({ ok: true, step: "sms_sent", provider, host, messageSid: data.sid, status: data.status, to: data.to, from: data.from, timestamp: new Date().toISOString() });
      }
      return Response.json({ ok: false, step: "sms_send", provider, host, httpStatus: smsRes.status, error: smsText.slice(0, 500) }, { status: smsRes.status });
    }

    return Response.json({ ok: true, message: "IVX credential bridge ready. Endpoints: /ping, /bridge-to-render, /verify-and-send" });
  },
};
