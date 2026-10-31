import { useEffect, useRef, useState, type FormEvent } from 'react';
import { RtcHostTransport } from '@game-multi-sdk/transport-rtc-host';
import { SDK_VERSION } from '@game-multi-sdk/core';
import { createRtcConfiguration, explainConnectionError } from './rtc-settings';

interface ChatMessage {
  id: number;
  senderId: string;
  text: string;
}

const defaultEndpoint = 'https://0.peerjs.com';
const DEMO_VERSION = '0.2.4';

export function ChatRoom() {
  const [roomId, setRoomId] = useState('game-room');
  const [userId, setUserId] = useState(() => `player-${Math.random().toString(36).slice(2, 7)}`);
  const [endpoint, setEndpoint] = useState(defaultEndpoint);
  const [role, setRole] = useState<'host' | 'client'>('host');
  const [topology, setTopology] = useState<'full-mesh' | 'star'>('full-mesh');
  const [hostPeerId, setHostPeerId] = useState('');
  const [currentHostPeerId, setCurrentHostPeerId] = useState('');
  const [migrationMode, setMigrationMode] = useState<'auto' | 'manual' | 'disabled'>('auto');
  const [hostName, setHostName] = useState('');
  const [amHost, setAmHost] = useState(false);
  const [stunUrls, setStunUrls] = useState('');
  const [turnUrls, setTurnUrls] = useState('');
  const [turnUsername, setTurnUsername] = useState('');
  const [turnCredential, setTurnCredential] = useState('');
  const [relayOnly, setRelayOnly] = useState(false);
  const [transport, setTransport] = useState<RtcHostTransport | null>(null);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [peers, setPeers] = useState<string[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const nextMessageId = useRef(0);
  const transportRef = useRef<RtcHostTransport | null>(null);
  const closingRef = useRef(false);
  transportRef.current = transport;

  useEffect(() => {
    const current = transport;
    if (!current) return;
    const unsubscribeMessages = current.onMessage((event, payload, senderId) => {
      if (event !== 'chat' || !isChatPayload(payload)) return;
      setMessages((current) => [...current, {
        id: nextMessageId.current++,
        senderId,
        text: payload.text,
      }]);
    });
    const unsubscribePeers = current.onPeersChanged((nextPeers) => {
      setPeers(nextPeers);
      setHostName(current.getHost()?.userId ?? '');
      setCurrentHostPeerId(current.getHost()?.peerId ?? '');
      setAmHost(current.isHost());
      setConnected(current.isConnected());
    });
    const unsubscribeHost = current.onHostChanged((event) => {
      setHostName(event.userId);
      setCurrentHostPeerId(event.peerId);
      setAmHost(current.isHost());
      setConnected(current.isConnected());
      if (event.migrating) setError(`Migrating to host ${event.userId}...`);
      else setError('');
    });
    const unsubscribeErrors = current.onError((reason) => setError(explainConnectionError(reason.message)));
    return () => {
      unsubscribeMessages();
      unsubscribePeers();
      unsubscribeErrors();
      unsubscribeHost();
      // React StrictMode runs cleanup once on mount. Disconnect only if this
      // transport is actually being replaced, otherwise dev remount kills the room.
      queueMicrotask(() => {
        if (transportRef.current !== current) current.disconnect();
      });
    };
  }, [transport]);

  async function connect() {
    if (connecting || transport) return;
    setError('');
    try {
      const rtcConfiguration = await createRtcConfiguration({
        stunUrls, turnUrls, turnUsername, turnCredential, relayOnly,
      });
      setMessages([]);
      setConnecting(true);
      const nextTransport = new RtcHostTransport();
      setTransport(nextTransport);
      await nextTransport.connect({
        role, roomId, userId, endpoint, rtcConfiguration, topology,
        ...(hostPeerId.trim() ? { hostPeerId: hostPeerId.trim() } : {}),
        hostMigration: { mode: migrationMode },
      });
      setConnected(true);
      setPeers(nextTransport.getPeers());
      setAmHost(nextTransport.isHost());
      setHostName(nextTransport.getHost()?.userId ?? '');
      setCurrentHostPeerId(nextTransport.getHost()?.peerId ?? '');
    } catch (reason) {
      if (!closingRef.current) {
        setError(explainConnectionError(reason instanceof Error ? reason.message : String(reason)));
      }
      closingRef.current = false;
      setTransport(null);
      setConnected(false);
      setConnecting(false);
    } finally {
      setConnecting(false);
    }
  }

  function disconnect() {
    closingRef.current = true;
    transport?.disconnect();
    setTransport(null);
    setConnecting(false);
    setConnected(false);
    setError('');
    setPeers([]);
    setHostName('');
    setCurrentHostPeerId('');
    setAmHost(false);
  }

  function transferHost(targetId: string) {
    try {
      transport?.transferHost(targetId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
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
            <p className="eyebrow">GAME MULTI SDK v{SDK_VERSION}</p>
            <h1>RTC Chat Room</h1>
            <p className="form-note">Demo v{DEMO_VERSION}</p>
          </div>
          <span className={`connection-badge${connected ? ' is-connected' : ''}`}>
            <span className="status-dot" />
            {connected ? 'Connected' : 'Offline'}
          </span>
        </header>

        {!connected ? (
          <form className="connection-form" onSubmit={(event) => { event.preventDefault(); void connect(); }}>
            <fieldset className="connection-fields" disabled={connecting || transport !== null}>
              <label>
                <span>Connection role</span>
                <select value={role} onChange={(event) => setRole(event.target.value === 'client' ? 'client' : 'host')}>
                  <option value="host">Create room (host)</option>
                  <option value="client">Join room (client)</option>
                </select>
              </label>
              <label>
                <span>Network topology</span>
                <select value={topology} onChange={(event) => {
                  const value = event.target.value;
                  if (value === 'full-mesh' || value === 'star') setTopology(value);
                }}>
                  <option value="full-mesh">Full Mesh (default, direct peer-to-peer)</option>
                  <option value="star">Star (host relays messages)</option>
                </select>
              </label>
              <label>
                <span>Host migration</span>
                <select value={migrationMode} onChange={(event) => {
                  const value = event.target.value;
                  if (value === 'auto' || value === 'manual' || value === 'disabled') setMigrationMode(value);
                }}>
                  <option value="auto">Automatic (default)</option>
                  <option value="manual">Manual handoff only</option>
                  <option value="disabled">Disabled</option>
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
              {role === 'client' && (
                <label>
                  <span>Current host PeerJS ID (optional, for migrated rooms)</span>
                  <input value={hostPeerId} onChange={(event) => setHostPeerId(event.target.value)} placeholder="Defaults to Room ID" />
                </label>
              )}
              <label>
                <span>PeerJS signaling endpoint</span>
                <input type="url" value={endpoint} onChange={(event) => setEndpoint(event.target.value)} required />
              </label>
              <details className="rtc-settings">
                <summary>Advanced WebRTC / TURN settings</summary>
                <label>
                  <span>STUN URLs (optional, comma-separated)</span>
                  <input value={stunUrls} onChange={(event) => setStunUrls(event.target.value)} placeholder="stun:stun.example.com:3478" />
                </label>
                <label>
                  <span>TURN URLs (comma-separated)</span>
                  <input value={turnUrls} onChange={(event) => setTurnUrls(event.target.value)} placeholder="turns:turn.example.com:443?transport=tcp" />
                </label>
                <label>
                  <span>TURN username</span>
                  <input value={turnUsername} onChange={(event) => setTurnUsername(event.target.value)} autoComplete="off" />
                </label>
                <label>
                  <span>TURN credential</span>
                  <input type="password" value={turnCredential} onChange={(event) => setTurnCredential(event.target.value)} autoComplete="off" />
                </label>
                <label className="checkbox-label">
                  <input type="checkbox" checked={relayOnly} onChange={(event) => setRelayOnly(event.target.checked)} />
                  <span>Relay only (require TURN)</span>
                </label>
                <p className="form-note">Leave this panel empty to fetch standard iceServers from /turn (short-lived credentials; the provider stays on the server). If /turn is unavailable, the demo falls back to Google STUN plus the public Open Relay. Custom URLs replace both. Use the same settings on every window. Credentials stay in memory and are not saved.</p>
              </details>
              <button className="primary-button" type="submit">Connect to room <span aria-hidden="true">→</span></button>
            </fieldset>
            {transport && <button className="text-button" type="button" onClick={disconnect}>Disconnect / stop reconnecting</button>}
            {(connecting || transport) && <p className="form-note" role="status">{connecting ? 'Connecting...' : migrationMode === 'auto' ? 'Connection lost. Reconnecting or electing a new host...' : 'Connection lost. Waiting for the selected host to reconnect...'}</p>}
            {error && <p className="error-message" role="alert">{error}</p>}
            <p className="form-note">Use the same topology in every window. Full Mesh sends directly between peers; Star relays through the host. Start with 4-6 players and load-test. Neither mode replicates game state. Hosted rooms on different networks need TURN. An empty Advanced panel requests /turn, then falls back to a public relay. A local PeerJS broker only changes signaling. PeerJS signaling stays on the endpoint above.</p>
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
            <div className="host-controls">
              <p className="form-note">Topology: {topology === 'full-mesh' ? 'Full Mesh' : 'Star'} | {topology === 'full-mesh' ? 'Coordinator' : 'Host'}: {hostName}{amHost ? ' (you)' : ''} | Migration: {migrationMode}</p>
              <p className="party-heading">Party · {peers.length + 1}</p>
              <ul className="party-list" aria-label="Party members">
                <li className="party-member is-you">{userId} (you){amHost ? ' · host' : ''}</li>
                {peers.map((peerId) => (
                  <li className="party-member" key={peerId}>{peerId}</li>
                ))}
              </ul>
              <p className="form-note">Current host PeerJS ID: {currentHostPeerId} (share with new joiners; keep the same Room ID)</p>
              {amHost && migrationMode !== 'disabled' && peers.map((peerId) => (
                <button className="text-button" type="button" key={peerId} onClick={() => transferHost(peerId)}>
                  Transfer host to {peerId}
                </button>
              ))}
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
      <footer>Peer-to-peer chat · Powered by WebRTC · SDK v{SDK_VERSION} · Demo v{DEMO_VERSION}</footer>
    </main>
  );
}

function isChatPayload(value: unknown): value is { text: string } {
  return typeof value === 'object' && value !== null && 'text' in value &&
    typeof value.text === 'string';
}
