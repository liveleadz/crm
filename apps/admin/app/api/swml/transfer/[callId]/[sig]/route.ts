// SWML response for an in-progress call that the agent has chosen to
// transfer to a third party.
//
// Flow:
//   1. Agent clicks "Transfer Call" + types a number in the popup.
//   2. transferCall server action verifies the call belongs to the active
//      member, signs a path token, and calls
//      redirectInProgressCall({ newUrl: <this route> }).
//   3. SignalWire's LaML Modify Call replaces the running SWML on the
//      parent call with the response from this route.
//   4. We respond with a `connect` to the transfer target — the lead leg
//      drops, then the new connect bridges from the brand caller-ID to
//      the transfer target. The agent's WebRTC leg ends as the parent
//      script exits, which is the desired blind-transfer behavior.
//
// Why path-signed instead of a JWT-style token: SignalWire's URL field on
// Modify Call rejects the dot-separated tokens we use elsewhere. Path
// segments survive the round-trip cleanly. The signature is namespaced
// "tx:" so a leaked recording / status sig can't redirect calls.

import { NextResponse, type NextRequest } from 'next/server';
import { verifyTransferPath } from '@/lib/dial-token';
import { createAdminClient } from '@leadpilot/db/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function jsonSwmlResponse(swml: object) {
  return new NextResponse(JSON.stringify(swml), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

const HANGUP_SWML = {
  version: '1.0.0',
  sections: { main: [{ hangup: { reason: 'rejected' } }] },
};

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ callId: string; sig: string }> },
) {
  return handle(req, ctx);
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ callId: string; sig: string }> },
) {
  return handle(req, ctx);
}

async function handle(
  req: NextRequest,
  { params }: { params: Promise<{ callId: string; sig: string }> },
) {
  const { callId, sig } = await params;
  const url = new URL(req.url);
  const target = url.searchParams.get('to');
  if (!target || !verifyTransferPath(callId, target, sig)) {
    return jsonSwmlResponse(HANGUP_SWML);
  }

  // Look up the originating brand caller-ID so the transfer target sees
  // the brand's number, not the lead's. Failing closed (hangup) is
  // safer than dialing without a caller-ID and tripping carrier filters.
  const supabase = createAdminClient();
  const { data: call } = await supabase
    .from('calls')
    .select('from_number')
    .eq('id', callId)
    .maybeSingle();
  if (!call?.from_number) return jsonSwmlResponse(HANGUP_SWML);

  return jsonSwmlResponse({
    version: '1.0.0',
    sections: {
      main: [
        {
          connect: {
            from: call.from_number,
            to: target,
            timeout: 25,
          },
        },
      ],
    },
  });
}
