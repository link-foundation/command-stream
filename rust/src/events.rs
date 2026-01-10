//! Event emitter for stream events
//!
//! This module provides an EventEmitter-like implementation for ProcessRunner
//! events, similar to the JavaScript StreamEmitter class.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::trace::trace_lazy;

/// Event types that can be emitted by ProcessRunner
#[derive(Debug, Clone, Hash, Eq, PartialEq)]
pub enum EventType {
    /// Stdout data received
    Stdout,
    /// Stderr data received
    Stderr,
    /// Combined data event (contains type and data)
    Data,
    /// Process ended
    End,
    /// Process exited with code
    Exit,
    /// Error occurred
    Error,
    /// Process spawned
    Spawn,
}

impl std::fmt::Display for EventType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            EventType::Stdout => write!(f, "stdout"),
            EventType::Stderr => write!(f, "stderr"),
            EventType::Data => write!(f, "data"),
            EventType::End => write!(f, "end"),
            EventType::Exit => write!(f, "exit"),
            EventType::Error => write!(f, "error"),
            EventType::Spawn => write!(f, "spawn"),
        }
    }
}

/// Event data variants
#[derive(Debug, Clone)]
pub enum EventData {
    /// String data (for stdout, stderr)
    String(String),
    /// Exit code
    ExitCode(i32),
    /// Data event with type and content
    TypedData { data_type: String, data: String },
    /// Command result
    Result(crate::CommandResult),
    /// Error message
    Error(String),
    /// No data
    None,
}

/// Type alias for event listeners
type Listener = Arc<dyn Fn(EventData) + Send + Sync>;

/// Event emitter for ProcessRunner events
///
/// Provides on(), once(), off(), and emit() methods similar to Node.js EventEmitter.
pub struct StreamEmitter {
    listeners: RwLock<HashMap<EventType, Vec<Listener>>>,
}

impl Default for StreamEmitter {
    fn default() -> Self {
        Self::new()
    }
}

impl StreamEmitter {
    /// Create a new event emitter
    pub fn new() -> Self {
        StreamEmitter {
            listeners: RwLock::new(HashMap::new()),
        }
    }

    /// Register a listener for an event
    ///
    /// # Arguments
    /// * `event` - The event type to listen for
    /// * `listener` - The callback function to invoke
    ///
    /// # Example
    /// ```ignore
    /// emitter.on(EventType::Stdout, |data| {
    ///     if let EventData::String(s) = data {
    ///         println!("Got stdout: {}", s);
    ///     }
    /// });
    /// ```
    pub async fn on<F>(&self, event: EventType, listener: F)
    where
        F: Fn(EventData) + Send + Sync + 'static,
    {
        trace_lazy("StreamEmitter", || {
            format!("on() called for event: {}", event)
        });

        let mut listeners = self.listeners.write().await;
        listeners
            .entry(event)
            .or_default()
            .push(Arc::new(listener));
    }

    /// Register a one-time listener for an event
    ///
    /// The listener will be removed after it is invoked once.
    pub async fn once<F>(&self, event: EventType, listener: F)
    where
        F: Fn(EventData) + Send + Sync + 'static,
    {
        trace_lazy("StreamEmitter", || {
            format!("once() called for event: {}", event)
        });

        // Wrap the listener to track if it's been called
        let called = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let called_clone = called.clone();

        let once_listener = move |data: EventData| {
            if !called_clone.swap(true, std::sync::atomic::Ordering::SeqCst) {
                listener(data);
            }
        };

        self.on(event, once_listener).await;
    }

    /// Emit an event to all registered listeners
    ///
    /// # Arguments
    /// * `event` - The event type to emit
    /// * `data` - The event data to pass to listeners
    pub async fn emit(&self, event: EventType, data: EventData) {
        let listeners = self.listeners.read().await;

        if let Some(event_listeners) = listeners.get(&event) {
            trace_lazy("StreamEmitter", || {
                format!(
                    "Emitting event {} to {} listeners",
                    event,
                    event_listeners.len()
                )
            });

            for listener in event_listeners {
                listener(data.clone());
            }
        }
    }

    /// Remove all listeners for an event
    ///
    /// # Arguments
    /// * `event` - The event type to clear listeners for
    pub async fn off(&self, event: EventType) {
        trace_lazy("StreamEmitter", || {
            format!("off() called for event: {}", event)
        });

        let mut listeners = self.listeners.write().await;
        listeners.remove(&event);
    }

    /// Get the number of listeners for an event
    pub async fn listener_count(&self, event: &EventType) -> usize {
        let listeners = self.listeners.read().await;
        listeners.get(event).map(|v| v.len()).unwrap_or(0)
    }

    /// Remove all listeners for all events
    pub async fn remove_all_listeners(&self) {
        trace_lazy("StreamEmitter", || "Removing all listeners".to_string());
        let mut listeners = self.listeners.write().await;
        listeners.clear();
    }
}

impl std::fmt::Debug for StreamEmitter {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("StreamEmitter")
            .field("listeners", &"<RwLock<HashMap<...>>>")
            .finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[tokio::test]
    async fn test_emit_basic() {
        let emitter = StreamEmitter::new();
        let counter = Arc::new(AtomicUsize::new(0));
        let counter_clone = counter.clone();

        emitter
            .on(EventType::Stdout, move |_| {
                counter_clone.fetch_add(1, Ordering::SeqCst);
            })
            .await;

        emitter
            .emit(EventType::Stdout, EventData::String("test".to_string()))
            .await;

        assert_eq!(counter.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn test_once() {
        let emitter = StreamEmitter::new();
        let counter = Arc::new(AtomicUsize::new(0));
        let counter_clone = counter.clone();

        emitter
            .once(EventType::Exit, move |_| {
                counter_clone.fetch_add(1, Ordering::SeqCst);
            })
            .await;

        // Emit twice
        emitter.emit(EventType::Exit, EventData::ExitCode(0)).await;
        emitter.emit(EventType::Exit, EventData::ExitCode(0)).await;

        // Should only be called once
        assert_eq!(counter.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn test_off() {
        let emitter = StreamEmitter::new();
        let counter = Arc::new(AtomicUsize::new(0));
        let counter_clone = counter.clone();

        emitter
            .on(EventType::Stdout, move |_| {
                counter_clone.fetch_add(1, Ordering::SeqCst);
            })
            .await;

        emitter.off(EventType::Stdout).await;
        emitter
            .emit(EventType::Stdout, EventData::String("test".to_string()))
            .await;

        assert_eq!(counter.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn test_listener_count() {
        let emitter = StreamEmitter::new();

        assert_eq!(emitter.listener_count(&EventType::Stdout).await, 0);

        emitter.on(EventType::Stdout, |_| {}).await;
        assert_eq!(emitter.listener_count(&EventType::Stdout).await, 1);

        emitter.on(EventType::Stdout, |_| {}).await;
        assert_eq!(emitter.listener_count(&EventType::Stdout).await, 2);
    }

    #[tokio::test]
    async fn test_multiple_events() {
        let emitter = StreamEmitter::new();
        let stdout_counter = Arc::new(AtomicUsize::new(0));
        let stderr_counter = Arc::new(AtomicUsize::new(0));

        let stdout_clone = stdout_counter.clone();
        let stderr_clone = stderr_counter.clone();

        emitter
            .on(EventType::Stdout, move |_| {
                stdout_clone.fetch_add(1, Ordering::SeqCst);
            })
            .await;

        emitter
            .on(EventType::Stderr, move |_| {
                stderr_clone.fetch_add(1, Ordering::SeqCst);
            })
            .await;

        emitter
            .emit(EventType::Stdout, EventData::String("out".to_string()))
            .await;
        emitter
            .emit(EventType::Stderr, EventData::String("err".to_string()))
            .await;

        assert_eq!(stdout_counter.load(Ordering::SeqCst), 1);
        assert_eq!(stderr_counter.load(Ordering::SeqCst), 1);
    }
}
