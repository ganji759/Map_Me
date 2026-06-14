'use client'

import { useReducer, useCallback, useEffect, useRef, useState } from 'react'
import {
  cancelSpeech,
  emitActivity,
  isSpeechInputSupported,
  pauseSpeech,
  resumeSpeech,
  startRecording,
  stopSpeech,
  subscribeVoiceActivity,
  subscribeLiveTranscript,
} from '@/lib/voice'

export type VoiceState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'paused'

type Action =
  | { type: 'LISTEN' }
  | { type: 'THINK' }
  | { type: 'SPEAK' }
  | { type: 'PAUSE' }
  | { type: 'IDLE' }
  | { type: 'ERROR' }

function reducer(_: VoiceState, action: Action): VoiceState {
  switch (action.type) {
    case 'LISTEN': return 'listening'
    case 'THINK': return 'thinking'
    case 'SPEAK': return 'speaking'
    case 'PAUSE': return 'paused'
    case 'IDLE':
    case 'ERROR':
      return 'idle'
    default: return 'idle'
  }
}

interface Options {
  onTranscript: (text: string) => void
  disabled?: boolean
  autoResumeAfterSpeak?: boolean
  /** Voice mode: use the browser recognizer for live text + instant (no-delay) echo. */
  preferBrowserStt?: boolean
}

export function useVoice({ onTranscript, disabled, autoResumeAfterSpeak = true, preferBrowserStt }: Options) {
  const [state, dispatch] = useReducer(reducer, 'idle')
  const [supported, setSupported] = useState(true)
  const [warning, setWarning] = useState('')
  const [liveText, setLiveText] = useState('')
  const recorderRef = useRef<Awaited<ReturnType<typeof startRecording>> | null>(null)
  const lastSpeechAtRef = useRef(0)
  const rafRef = useRef(0)
  const levelRef = useRef(0)
  const resumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const suppressAutoResumeRef = useRef(false)
  const stateRef = useRef(state)
  stateRef.current = state
  // Keep the latest value so startListening (a stable callback) reads it live.
  const preferBrowserRef = useRef(preferBrowserStt)
  preferBrowserRef.current = preferBrowserStt

  const stopListening = useCallback(async () => {
    const rec = recorderRef.current
    if (!rec) return
    recorderRef.current = null
    dispatch({ type: 'THINK' })
    emitActivity('thinking', 0.12)

    try {
      const text = await rec.stop()
      if (text) {
        onTranscript(text)
        dispatch({ type: 'THINK' })
      } else {
        setWarning('No speech detected. Try speaking clearly in Chrome or Edge.')
        dispatch({ type: 'IDLE' })
        emitActivity('idle', 0)
      }
    } catch {
      setWarning('Voice transcription failed. Please try again.')
      dispatch({ type: 'ERROR' })
      emitActivity('idle', 0)
    }
  }, [onTranscript])

  const startListening = useCallback(async () => {
    if (disabled) return
    setWarning('')
    setLiveText('')
    stopSpeech()
    dispatch({ type: 'IDLE' })

    if (!isSpeechInputSupported()) {
      setSupported(false)
      setWarning('Microphone is blocked or not supported.')
      return
    }

    try {
      recorderRef.current = await startRecording({ preferBrowser: preferBrowserRef.current })
      lastSpeechAtRef.current = performance.now()
      dispatch({ type: 'LISTEN' })
      emitActivity('listening', 0)
    } catch {
      setSupported(false)
      setWarning('Microphone permission denied.')
      dispatch({ type: 'ERROR' })
      emitActivity('idle', 0)
    }
  }, [disabled])

  const stopAll = useCallback(() => {
    stopSpeech()
    recorderRef.current?.cancel()
    recorderRef.current = null
    dispatch({ type: 'IDLE' })
    emitActivity('idle', 0)
  }, [])

  const pauseSpeaking = useCallback(() => {
    if (pauseSpeech()) {
      dispatch({ type: 'PAUSE' })
    }
  }, [])

  const resumeSpeaking = useCallback(() => {
    if (resumeSpeech()) {
      dispatch({ type: 'SPEAK' })
    }
  }, [])

  const stopSpeakingAndListen = useCallback(() => {
    if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current)
    suppressAutoResumeRef.current = true
    stopSpeech()
    void startListening().finally(() => {
      suppressAutoResumeRef.current = false
    })
  }, [startListening])

  const toggleVoice = useCallback(() => {
    if (state === 'listening') {
      void stopListening()
      return
    }
    if (state === 'paused') {
      resumeSpeaking()
      return
    }
    if (state === 'speaking') {
      stopSpeakingAndListen()
      return
    }
    if (state === 'thinking') return
    void startListening()
  }, [state, startListening, stopListening, stopSpeakingAndListen, resumeSpeaking])

  useEffect(() => setSupported(isSpeechInputSupported()), [])

  useEffect(() => subscribeLiveTranscript(setLiveText), [])

  useEffect(() => {
    return subscribeVoiceActivity((s, level) => {
      levelRef.current = level
      if (s === 'speaking') dispatch({ type: 'SPEAK' })
      if (s === 'paused') dispatch({ type: 'PAUSE' })
      if (s === 'thinking') dispatch({ type: 'THINK' })
      if (s === 'idle' && stateRef.current !== 'listening') {
        const wasSpeaking = stateRef.current === 'speaking'
        dispatch({ type: 'IDLE' })
        if (autoResumeAfterSpeak && wasSpeaking && !disabled && !suppressAutoResumeRef.current) {
          if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current)
          resumeTimerRef.current = setTimeout(() => {
            resumeTimerRef.current = null
            void startListening()
          }, 700)
        }
      }
    })
  }, [disabled, autoResumeAfterSpeak, startListening])

  useEffect(() => {
    if (state !== 'listening') {
      cancelAnimationFrame(rafRef.current)
      return
    }
    const tick = () => {
      const now = performance.now()
      if (levelRef.current > 0.035) lastSpeechAtRef.current = now
      if (now - lastSpeechAtRef.current > 1500) {
        void stopListening()
        return
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [state, stopListening])

  useEffect(() => () => {
    cancelAnimationFrame(rafRef.current)
    if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current)
    recorderRef.current?.cancel()
  }, [])

  return {
    voiceState: state,
    supported,
    warning,
    liveText,
    toggleVoice,
    startListening,
    stopAll,
    pauseSpeaking,
    resumeSpeaking,
    stopSpeakingAndListen,
    isBusy: state === 'thinking' || state === 'speaking' || state === 'paused',
  }
}
