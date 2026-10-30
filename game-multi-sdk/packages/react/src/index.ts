import { createContext, createElement, useContext, useEffect, useState, type ReactNode } from 'react';
import type { IGameTransport, TransportOptions } from '@game-multi-sdk/core';

interface GameContextValue {
  transport: IGameTransport | null;
  peers: string[];
  isHost: boolean;
  send: (event: string, payload: any) => void;
  connected: boolean;
  error: Error | null;
}

const GameContext = createContext<GameContextValue | null>(null);

interface GameProviderProps {
  transport: IGameTransport;
  options: TransportOptions;
  children: ReactNode;
}

export function GameProvider({ transport, options, children }: GameProviderProps) {
  const [peers, setPeers] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let mounted = true;
    setError(null);
    setConnected(false);
    const updateRoom = () => {
      if (!mounted) return;
      setPeers(transport.getPeers());
      if (transport.isConnected) setConnected(transport.isConnected());
    };
    const unsubscribePeers = transport.onPeersChanged?.(updateRoom);
    const unsubscribeHost = transport.onHostChanged?.((event) => {
      if (!mounted) return;
      setConnected(transport.isConnected?.() ?? !event.migrating);
      setPeers(transport.getPeers());
    });
    const unsubscribeErrors = transport.onError?.((reason) => {
      if (mounted) setError(reason);
    });
    transport.connect(options).then(() => {
      if (mounted) {
        setConnected(true);
        setPeers(transport.getPeers());
      }
    }).catch((reason: unknown) => {
      if (!mounted) return;
      setError(reason instanceof Error ? reason : new Error(String(reason)));
      setConnected(false);
    });

    const unsubscribeMessages = transport.onMessage(updateRoom);

    return () => {
      mounted = false;
      unsubscribePeers?.();
      unsubscribeHost?.();
      unsubscribeErrors?.();
      unsubscribeMessages();
      transport.disconnect();
    };
  }, [transport, options]);

  const value: GameContextValue = {
    transport,
    peers,
    isHost: transport.isHost(),
    send: (event, payload) => transport.send(event, payload),
    connected,
    error,
  };

  return createElement(GameContext.Provider, { value }, children);
}

export function useGameRoom() {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error('useGameRoom must be used within GameProvider');
  return ctx;
}
