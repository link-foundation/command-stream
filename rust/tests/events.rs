//! Integration tests for the events module

use command_stream::{EventData, EventType, StreamEmitter};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

#[tokio::test]
async fn test_stream_emitter_creation() {
    let emitter = StreamEmitter::new();
    assert_eq!(emitter.listener_count(&EventType::Stdout).await, 0);
}

#[tokio::test]
async fn test_stream_emitter_on_emit() {
    let emitter = StreamEmitter::new();
    let counter = Arc::new(AtomicUsize::new(0));
    let counter_clone = counter.clone();

    emitter
        .on(EventType::Stdout, move |data| {
            if let EventData::String(s) = data {
                assert_eq!(s, "hello");
                counter_clone.fetch_add(1, Ordering::SeqCst);
            }
        })
        .await;

    emitter
        .emit(EventType::Stdout, EventData::String("hello".to_string()))
        .await;

    assert_eq!(counter.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn test_stream_emitter_multiple_listeners() {
    let emitter = StreamEmitter::new();
    let counter1 = Arc::new(AtomicUsize::new(0));
    let counter2 = Arc::new(AtomicUsize::new(0));
    let c1 = counter1.clone();
    let c2 = counter2.clone();

    emitter
        .on(EventType::Stdout, move |_| {
            c1.fetch_add(1, Ordering::SeqCst);
        })
        .await;

    emitter
        .on(EventType::Stdout, move |_| {
            c2.fetch_add(1, Ordering::SeqCst);
        })
        .await;

    emitter
        .emit(EventType::Stdout, EventData::String("test".to_string()))
        .await;

    assert_eq!(counter1.load(Ordering::SeqCst), 1);
    assert_eq!(counter2.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn test_stream_emitter_once() {
    let emitter = StreamEmitter::new();
    let counter = Arc::new(AtomicUsize::new(0));
    let counter_clone = counter.clone();

    emitter
        .once(EventType::Exit, move |_| {
            counter_clone.fetch_add(1, Ordering::SeqCst);
        })
        .await;

    // Emit multiple times
    emitter.emit(EventType::Exit, EventData::ExitCode(0)).await;
    emitter.emit(EventType::Exit, EventData::ExitCode(0)).await;
    emitter.emit(EventType::Exit, EventData::ExitCode(0)).await;

    // Should only count once
    assert_eq!(counter.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn test_stream_emitter_off() {
    let emitter = StreamEmitter::new();
    let counter = Arc::new(AtomicUsize::new(0));
    let counter_clone = counter.clone();

    emitter
        .on(EventType::Stderr, move |_| {
            counter_clone.fetch_add(1, Ordering::SeqCst);
        })
        .await;

    assert_eq!(emitter.listener_count(&EventType::Stderr).await, 1);

    emitter.off(EventType::Stderr).await;

    assert_eq!(emitter.listener_count(&EventType::Stderr).await, 0);

    // Emit after off - should not trigger listener
    emitter
        .emit(EventType::Stderr, EventData::String("error".to_string()))
        .await;

    assert_eq!(counter.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn test_stream_emitter_different_events() {
    let emitter = StreamEmitter::new();
    let stdout_counter = Arc::new(AtomicUsize::new(0));
    let stderr_counter = Arc::new(AtomicUsize::new(0));
    let exit_counter = Arc::new(AtomicUsize::new(0));

    let out = stdout_counter.clone();
    let err = stderr_counter.clone();
    let exit = exit_counter.clone();

    emitter
        .on(EventType::Stdout, move |_| {
            out.fetch_add(1, Ordering::SeqCst);
        })
        .await;

    emitter
        .on(EventType::Stderr, move |_| {
            err.fetch_add(1, Ordering::SeqCst);
        })
        .await;

    emitter
        .on(EventType::Exit, move |_| {
            exit.fetch_add(1, Ordering::SeqCst);
        })
        .await;

    emitter
        .emit(EventType::Stdout, EventData::String("out1".to_string()))
        .await;
    emitter
        .emit(EventType::Stdout, EventData::String("out2".to_string()))
        .await;
    emitter
        .emit(EventType::Stderr, EventData::String("err".to_string()))
        .await;
    emitter.emit(EventType::Exit, EventData::ExitCode(0)).await;

    assert_eq!(stdout_counter.load(Ordering::SeqCst), 2);
    assert_eq!(stderr_counter.load(Ordering::SeqCst), 1);
    assert_eq!(exit_counter.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn test_stream_emitter_remove_all_listeners() {
    let emitter = StreamEmitter::new();

    emitter.on(EventType::Stdout, |_| {}).await;
    emitter.on(EventType::Stderr, |_| {}).await;
    emitter.on(EventType::Exit, |_| {}).await;

    assert!(emitter.listener_count(&EventType::Stdout).await > 0);
    assert!(emitter.listener_count(&EventType::Stderr).await > 0);
    assert!(emitter.listener_count(&EventType::Exit).await > 0);

    emitter.remove_all_listeners().await;

    assert_eq!(emitter.listener_count(&EventType::Stdout).await, 0);
    assert_eq!(emitter.listener_count(&EventType::Stderr).await, 0);
    assert_eq!(emitter.listener_count(&EventType::Exit).await, 0);
}

#[tokio::test]
async fn test_event_data_variants() {
    let emitter = StreamEmitter::new();

    let string_received = Arc::new(std::sync::Mutex::new(None));
    let code_received = Arc::new(std::sync::Mutex::new(None));

    let str_clone = string_received.clone();
    let code_clone = code_received.clone();

    emitter
        .on(EventType::Stdout, move |data| {
            if let EventData::String(s) = data {
                *str_clone.lock().unwrap() = Some(s);
            }
        })
        .await;

    emitter
        .on(EventType::Exit, move |data| {
            if let EventData::ExitCode(code) = data {
                *code_clone.lock().unwrap() = Some(code);
            }
        })
        .await;

    emitter
        .emit(EventType::Stdout, EventData::String("test data".to_string()))
        .await;
    emitter.emit(EventType::Exit, EventData::ExitCode(42)).await;

    assert_eq!(*string_received.lock().unwrap(), Some("test data".to_string()));
    assert_eq!(*code_received.lock().unwrap(), Some(42));
}
