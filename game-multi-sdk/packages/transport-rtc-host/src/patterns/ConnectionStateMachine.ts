/**
 * Connection lifecycle State pattern.
 * Explicit states prevent invalid transitions scattered across callbacks.
 * See https://refactoring.guru/design-patterns/state
 */
export type ConnectionStateName =
  | 'idle'
  | 'signaling'
  | 'connecting'
  | 'connected'
  | 'degraded'
  | 'reconnecting'
  | 'failed'
  | 'closed';

export interface ConnectionStateMachine {
  readonly state: ConnectionStateName;
  canTransition(to: ConnectionStateName): boolean;
  transition(to: ConnectionStateName, reason?: string): void;
  onTransition(listener: (from: ConnectionStateName, to: ConnectionStateName, reason?: string) => void): () => void;
}

const allowed: Record<ConnectionStateName, ConnectionStateName[]> = {
  idle: ['signaling', 'closed'],
  signaling: ['connecting', 'failed', 'closed'],
  connecting: ['connected', 'failed', 'closed'],
  connected: ['degraded', 'reconnecting', 'failed', 'closed'],
  degraded: ['connected', 'reconnecting', 'failed', 'closed'],
  reconnecting: ['connecting', 'connected', 'failed', 'closed'],
  failed: ['reconnecting', 'closed'],
  closed: [],
};

export class DefaultConnectionStateMachine implements ConnectionStateMachine {
  private current: ConnectionStateName = 'idle';
  private listeners = new Set<(from: ConnectionStateName, to: ConnectionStateName, reason?: string) => void>();

  get state(): ConnectionStateName {
    return this.current;
  }

  canTransition(to: ConnectionStateName): boolean {
    return allowed[this.current].includes(to);
  }

  transition(to: ConnectionStateName, reason?: string): void {
    if (!this.canTransition(to)) {
      throw new Error(`Invalid connection state transition: ${this.current} → ${to}`);
    }
    const from = this.current;
    this.current = to;
    for (const listener of this.listeners) listener(from, to, reason);
  }

  onTransition(listener: (from: ConnectionStateName, to: ConnectionStateName, reason?: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
