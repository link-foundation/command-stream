// EventEmitter-like implementation for stream events
// Provides a minimal event emitter for ProcessRunner

import { trace } from './$.trace.mjs';

/**
 * Simple EventEmitter-like implementation for stream events
 * Used as base class for ProcessRunner
 */
export class StreamEmitter {
  constructor() {
    this.listeners = new Map();
  }

  /**
   * Register a listener for an event
   * @param {string} event - Event name
   * @param {function} listener - Event handler
   * @returns {this} For chaining
   */
  on(event, listener) {
    trace(
      'StreamEmitter',
      () =>
        `on() called | ${JSON.stringify({
          event,
          hasExistingListeners: this.listeners.has(event),
          listenerCount: this.listeners.get(event)?.length || 0,
        })}`
    );

    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(listener);

    // No auto-start - explicit start() or await will start the process

    return this;
  }

  /**
   * Register a one-time listener for an event
   * @param {string} event - Event name
   * @param {function} listener - Event handler
   * @returns {this} For chaining
   */
  once(event, listener) {
    trace('StreamEmitter', () => `once() called for event: ${event}`);
    const onceWrapper = (...args) => {
      this.off(event, onceWrapper);
      listener(...args);
    };
    return this.on(event, onceWrapper);
  }

  /**
   * Emit an event to all registered listeners
   * @param {string} event - Event name
   * @param {...*} args - Arguments to pass to listeners
   * @returns {this} For chaining
   */
  emit(event, ...args) {
    const eventListeners = this.listeners.get(event);
    trace(
      'StreamEmitter',
      () =>
        `Emitting event | ${JSON.stringify({
          event,
          hasListeners: !!eventListeners,
          listenerCount: eventListeners?.length || 0,
        })}`
    );
    if (eventListeners) {
      // Create a copy to avoid issues if listeners modify the array
      const listenersToCall = [...eventListeners];
      for (const listener of listenersToCall) {
        listener(...args);
      }
    }
    return this;
  }

  /**
   * Remove a listener for an event
   * @param {string} event - Event name
   * @param {function} listener - Event handler to remove
   * @returns {this} For chaining
   */
  off(event, listener) {
    trace(
      'StreamEmitter',
      () =>
        `off() called | ${JSON.stringify({
          event,
          hasListeners: !!this.listeners.get(event),
          listenerCount: this.listeners.get(event)?.length || 0,
        })}`
    );

    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      const index = eventListeners.indexOf(listener);
      if (index !== -1) {
        eventListeners.splice(index, 1);
        trace('StreamEmitter', () => `Removed listener at index ${index}`);
      }
    }
    return this;
  }
}
