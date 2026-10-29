import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { IGameTransport, TransportOptions } from '@game-multi-sdk/core';

interface GameContextValue {
  transport: IGameTransport | null;
  peers: string[];
  isHost: boolean;
  send: (event: string, payload: any) => void;
  connected: boolean;
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

  useEffect(() => {
    let mounted = true;
    transport.connect(options).then(() => {
      if (mounted) {
        setConnected(true);
        setPeers(transport.getPeers());
      }
    });

    transport.onMessage(() => {
      if (mounted) setPeers(transport.getPeers());
    });

    return () => {
      mounted = false;
      transport.disconnect();
    };
  }, [transport, options]);

  const value: GameContextValue = {
    transport,
    peers,
    isHost: transport.isHost(),
    send: (event, payload) => transport.send(event, payload),
    connected,
  };

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function useGameRoom() {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error('useGameRoom must be used within GameProvider');
  return ctx;
}
