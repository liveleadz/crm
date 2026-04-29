// Whisper-based transcription. Optional — if OPENAI_API_KEY is not set
// we mark the call's transcript_status as 'skipped' and the UI shows the
// recording without a transcript.
//
// Recording URLs from SignalWire require Basic auth with the project ID
// and token. We download the audio with that auth and POST it to OpenAI.

import 'server-only';

export type TranscribeResult =
  | { ok: true; text: string }
  | { ok: false; error: string; reason: 'no_key' | 'fetch_failed' | 'whisper_failed' };

export async function transcribeRecording(
  signalwireRecordingUrl: string,
): Promise<TranscribeResult> {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    return { ok: false, error: 'OPENAI_API_KEY not set', reason: 'no_key' };
  }
  const swProject = process.env.SIGNALWIRE_PROJECT_ID;
  const swToken = process.env.SIGNALWIRE_TOKEN;
  if (!swProject || !swToken) {
    return { ok: false, error: 'SignalWire credentials missing', reason: 'fetch_failed' };
  }

  const basic = Buffer.from(`${swProject}:${swToken}`).toString('base64');

  let audioBlob: Blob;
  try {
    const res = await fetch(signalwireRecordingUrl, {
      headers: { Authorization: `Basic ${basic}` },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return {
        ok: false,
        error: `SignalWire ${res.status}: ${body.slice(0, 200)}`,
        reason: 'fetch_failed',
      };
    }
    audioBlob = await res.blob();
  } catch (e) {
    return { ok: false, error: (e as Error).message, reason: 'fetch_failed' };
  }

  const fd = new FormData();
  fd.append('file', audioBlob, 'call.mp3');
  fd.append('model', 'whisper-1');
  fd.append('response_format', 'text');

  try {
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openaiKey}` },
      body: fd,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return {
        ok: false,
        error: `Whisper ${res.status}: ${body.slice(0, 200)}`,
        reason: 'whisper_failed',
      };
    }
    const text = (await res.text()).trim();
    return { ok: true, text };
  } catch (e) {
    return { ok: false, error: (e as Error).message, reason: 'whisper_failed' };
  }
}
