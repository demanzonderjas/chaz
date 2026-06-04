'use client';

let moveAudio: HTMLAudioElement | null = null;
let captureAudio: HTMLAudioElement | null = null;
let errorAudio: HTMLAudioElement | null = null;

function getAudio(type: 'move' | 'capture' | 'error'): HTMLAudioElement | null {
  if (typeof window === 'undefined') return null;
  
  if (type === 'move') {
    if (!moveAudio) moveAudio = new Audio('/sounds/move.mp3');
    return moveAudio;
  }
  if (type === 'capture') {
    if (!captureAudio) captureAudio = new Audio('/sounds/capture.mp3');
    return captureAudio;
  }
  if (type === 'error') {
    if (!errorAudio) errorAudio = new Audio('/sounds/error.mp3');
    return errorAudio;
  }
  return null;
}

export function playMoveSound(isCapture = false) {
  try {
    const audio = getAudio(isCapture ? 'capture' : 'move');
    if (audio) {
      audio.currentTime = 0;
      audio.play().catch(() => {
        // Ignore autoplay blocks
      });
    }
  } catch (e) {
    // Ignore audio play errors
  }
}

export function playErrorSound() {
  try {
    const audio = getAudio('error');
    if (audio) {
      audio.currentTime = 0;
      audio.play().catch(() => {
        // Ignore autoplay blocks
      });
    }
  } catch (e) {
    // Ignore audio play errors
  }
}
