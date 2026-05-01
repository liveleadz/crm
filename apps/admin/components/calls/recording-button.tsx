'use client';

// Compact recording playback control — single button that toggles
// play/pause for one call's recording. Used inline in places like the
// lead detail timeline and the power-dialer "Done" sidebar where we
// don't have room for a full scrubber.
//
// The /calls page has its own richer player with shared audio + scrubber;
// this one is intentionally minimal and stands alone (own <audio>) so it
// can drop into any list without coordination.

import { useEffect, useRef, useState } from 'react';

function fmt(sec: number | null | undefined): string {
  if (!sec || !Number.isFinite(sec) || sec <= 0) return '';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function RecordingButton({
  callId,
  durationSec = null,
  size = 'sm',
}: {
  callId: string;
  durationSec?: number | null;
  size?: 'sm' | 'xs';
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => setPlaying(false);
    const onError = () => {
      setPlaying(false);
      setError(true);
    };
    a.addEventListener('play', onPlay);
    a.addEventListener('pause', onPause);
    a.addEventListener('ended', onEnded);
    a.addEventListener('error', onError);
    return () => {
      a.removeEventListener('play', onPlay);
      a.removeEventListener('pause', onPause);
      a.removeEventListener('ended', onEnded);
      a.removeEventListener('error', onError);
    };
  }, []);

  function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      setError(false);
      void a.play().catch(() => setError(true));
    } else {
      a.pause();
    }
  }

  const dim = size === 'xs' ? 'h-5 w-5' : 'h-6 w-6';
  const icon = size === 'xs' ? 8 : 9;

  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? 'Pause recording' : 'Play recording'}
        title={error ? 'Recording not available yet' : playing ? 'Pause' : 'Play recording'}
        className={`grid ${dim} shrink-0 place-items-center rounded-full border border-line bg-canvas text-txt-2 hover:border-teal/60 hover:text-teal disabled:opacity-50`}
      >
        {playing ? (
          <svg width={icon} height={icon} viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
          </svg>
        ) : (
          <svg width={icon + 1} height={icon + 1} viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>
      {durationSec ? (
        <span className="font-mono text-[10.5px] text-txt-3">{fmt(durationSec)}</span>
      ) : null}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={audioRef} preload="none" src={`/api/calls/recording/${callId}`} className="hidden" />
    </span>
  );
}
