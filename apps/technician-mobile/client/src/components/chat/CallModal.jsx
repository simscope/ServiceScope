// client/src/components/chat/CallModal.jsx
import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { sendMessage } from '../../api/chat';

export default function CallModal({ state, user, channelName, onClose }) {
  const pcRef = useRef(null);
  const chanRef = useRef(null);
  const [micOn, setMicOn] = useState(false);

  const selfId = user?.id || null;
  const isCaller = state?.role === 'caller';
  const targetId = state?.to || null; // для исходящего

  useEffect(() => {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    pcRef.current = pc;

    const ch = supabase.channel(channelName, { config: { broadcast: { ack: false } } });
    chanRef.current = ch;

    ch.on('broadcast', { event: 'call' }, async ({ payload }) => {
      const msg = payload || {};
      // фильтруем по адресату
      if (msg.to && selfId && msg.to !== selfId) return;

      if (msg.type === 'answer' && isCaller) {
        await pc.setRemoteDescription(new RTCSessionDescription(msg.answer));
      } else if (msg.type === 'offer' && !isCaller) {
        await pc.setRemoteDescription(new RTCSessionDescription(msg.offer));
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        stream.getTracks().forEach(t => pc.addTrack(t, stream));
        setMicOn(true);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        ch.send({ type: 'broadcast', event: 'call', payload: { type: 'answer', from: selfId, to: msg.from, answer } });
      } else if (msg.type === 'candidate' && msg.from && msg.from !== selfId) {
        try { await pc.addIceCandidate(new RTCIceCandidate(msg.candidate)); } catch {}
      } else if (msg.type === 'bye') {
        onClose?.();
      }
    });

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        ch.send({ type: 'broadcast', event: 'call', payload: { type: 'candidate', from: selfId, to: targetId || null, candidate: e.candidate } });
      }
    };

    pc.ontrack = (e) => {
      const audio = document.getElementById('call-audio');
      if (audio) audio.srcObject = e.streams[0];
    };

    ch.subscribe();

    (async () => {
      if (isCaller) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        stream.getTracks().forEach(t => pc.addTrack(t, stream));
        setMicOn(true);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        ch.send({ type: 'broadcast', event: 'call', payload: { type: 'offer', from: selfId, to: targetId, offer } });
      } else if (state?.offer) {
        // callee стартует, когда придет offer в подписке
      }
    })();

    return () => {
      try { pc.getSenders().forEach(s => s.track && s.track.stop()); } catch {}
      try { pc.close(); } catch {}
      supabase.removeChannel(ch);
    };
  }, [channelName, isCaller, onClose, selfId, targetId, state?.offer]);

  return (
    <div style={{
      position:'fixed', inset:0, background:'rgba(0,0,0,.35)',
      display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999
    }}>
      <div style={{background:'#fff', padding:16, borderRadius:10, minWidth:300}}>
        <h3 style={{marginTop:0}}>Аудио звонок</h3>
        <audio id="call-audio" autoPlay />
        <div style={{display:'flex', gap:8, marginTop:12}}>
          <button onClick={() => setMicOn(m => !m)} disabled={!pcRef.current}>
            {micOn ? '🔇 Выключить микрофон' : '🎙 Включить микрофон'}
          </button>
          <button onClick={() => {
            chanRef.current?.send({ type:'broadcast', event:'call', payload:{ type:'bye', from:selfId, to: targetId || null } });
            onClose?.();
          }}>Завершить</button>
        </div>
      </div>
    </div>
  );
}
