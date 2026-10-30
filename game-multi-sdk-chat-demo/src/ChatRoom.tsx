import { useEffect, useRef, useState, type FormEvent } from 'react';
import { RtcHostTransport } from '@game-multi-sdk/transport-rtc-host';

interface ChatMessage {
  id: number;
  senderId: string;
  text: string;
}

const defaultEndpoint = 'https://0.peerjs.com';

export function ChatRoom() {
  const [roomId, setRoomId] = useState('game-room');
  const [userId, setUserId] = useState(() => `player-${Math.random().toString(36).slice(2, 7)}`);
  const [endpoint, setEndpoint] = useState(defaultEndpoint);
  const [role, setRole] = useState<'host' | 'client'>('host');
  const [transport, setTransport] = useState<RtcHostTransport | null>(null);
  const [connected, setConnected] = useState(false);
  const [peers, setPeers] = useState<string[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const nextMessageId = useRef(0);

  useEffect(() => {
    if (!transport) return;
    const unsubscribeMessages = transport.onMessage((event, payload, senderId) => {
      if (event !== 'chat' || !isChatPayload(payload)) return;
      setMessages((current) => [...current, {
        id: nextMessageId.current++,
        senderId,
        text: payload.text,
      }]);
    });
    const unsubscribePeers = transport.onPeersChanged((nextPeers) => {
      setPeers(nextPeers);
      if (role === 'client') setConnected(nextPeers.length > 0);
    });
    const unsubscribeErrors = transport.onError((reason) => setError(reason.message));
    return () => {
      unsubscribeMessages();
      unsubscribePeers();
      unsubscribeErrors();
      transport.disconnect();
    };
  }, [transport, role]);

  async function connect() {
    setError('');
    setMessages([]);
    const nextTransport = new RtcHostTransport();
    setTransport(nextTransport);
    try {
      await nextTransport.connect({ role, roomId, userId, endpoint });
      setConnected(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      nextTransport.disconnect();
      setTransport(null);
      setConnected(false);
    }
  }

  function disconnect() {
    transport?.disconnect();
    setTransport(null);
    setConnected(false);
    setPeers([]);
  }

  function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !transport) return;
    try {
      transport.send('chat', { text });
      setMessages((current) => [...current, {
        id: nextMessageId.current++,
        senderId: userId,
        text,
      }]);
      setDraft('');
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  return (
    <main className="page-shell">
      <section className="chat-card" aria-label="Multiplayer chat room">
        <header className="card-header">
          <div className="brand-mark" aria-hidden="true">GM</div>
          <div>
            <p className="eyebrow">GAME MULTI SDK</p>
            <h1>RTC Chat Room</h1>
          </div>
          <span className={`connection-badge${connected ? ' is-connected' : ''}`}>
            <span className="status-dot" />
            {connected ? 'Connected' : 'Offline'}
          </span>
        </header>

        {!connected ? (
          <form className="connection-form" onSubmit={(event) => { event.preventDefault(); void connect(); }}>
            <label>
              <span>Connection role</span>
              <select value={role} onChange={(event) => setRole(event.target.value as 'host' | 'client')}>
                <option value="host">Create room (host)</option>
                <option value="client">Join room (client)</option>
              </select>
            </label>
            <div className="form-row">
              <label>
                <span>Room ID</span>
                <input value={roomId} onChange={(event) => setRoomId(event.target.value)} required />
              </label>
              <label>
                <span>Your name</span>
                <input value={userId} onChange={(event) => setUserId(event.target.value)} required />
              </label>
            </div>
            <label>
              <span>PeerJS signaling endpoint</span>
              <input type="url" value={endpoint} onChange={(event) => setEndpoint(event.target.value)} required />
            </label>
            <button className="primary-button" type="submit">Connect to room <span aria-hidden="true">→</span></button>
            {error && <p className="error-message" role="alert">{error}</p>}
            <p className="form-note">The signaling server helps peers connect. Chat messages travel directly over WebRTC.</p>
          </form>
        ) : (
          <div className="room-panel">
            <div className="room-toolbar">
              <div>
                <p className="eyebrow">ROOM</p>
                <strong>{roomId}</strong>
              </div>
              <div className="peer-count"><span className="status-dot" />{peers.length} connected peer{peers.length === 1 ? '' : 's'}</div>
              <button className="text-button" type="button" onClick={disconnect}>Disconnect</button>
            </div>
            <div className="message-list" aria-live="polite" aria-label="Chat messages">
              {messages.length === 0 ? (
                <div className="empty-state">
                  <span className="empty-icon" aria-hidden="true">✦</span>
                  <strong>You’re connected</strong>
                  <p>Say hello to everyone in the room.</p>
                </div>
              ) : messages.map((message) => (
                <article className={`message${message.senderId === userId ? ' own-message' : ''}`} key={message.id}>
                  <span className="message-sender">{message.senderId}</span>
                  <p>{message.text}</p>
                </article>
              ))}
            </div>
            {error && <p className="error-message inline-error" role="alert">{error}</p>}
            <form className="message-form" onSubmit={sendMessage}>
              <label className="visually-hidden" htmlFor="chat-message">Message</label>
              <input
                id="chat-message"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Write a message..."
                autoComplete="off"
              />
              <button className="primary-button send-button" type="submit" disabled={!draft.trim()}>Send <span aria-hidden="true">↑</span></button>
            </form>
          </div>
        )}
      </section>
      <footer>Peer-to-peer chat · Powered by WebRTC</footer>
    </main>
  );
}

function isChatPayload(value: unknown): value is { text: string } {
  return typeof value === 'object' && value !== null && 'text' in value &&
    typeof value.text === 'string';
}
