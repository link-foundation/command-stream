use command_stream::DataStream;

#[tokio::test]
async fn transforms_batches_and_online_statistics() {
    let result = DataStream::from_values(1..=5)
        .filter(|n| n % 2 == 1)
        .map(|n| n * 2)
        .batch(2)
        .collect()
        .await;
    assert_eq!(result, vec![vec![2, 6], vec![10]]);
    let stats = DataStream::from_values([10.0, 30.0])
        .analyze(|n| *n > 20.0, |n| Some(*n), |_| {})
        .await;
    assert_eq!(stats.count, 2);
    assert_eq!(stats.error_rate, 0.5);
    assert_eq!(stats.response_mean, 20.0);
}

#[tokio::test]
async fn split_merge_and_sliding_windows() {
    let (odd, even) = DataStream::from_values(1..=4).split(|n| n % 2 == 1);
    let (odd, even) = tokio::join!(odd.collect(), even.collect());
    assert_eq!(odd, vec![1, 3]);
    assert_eq!(even, vec![2, 4]);
    let windows = DataStream::from_values(1..=4).window(3).collect().await;
    assert_eq!(windows, vec![vec![1, 2, 3], vec![2, 3, 4]]);
}

#[tokio::test]
async fn transforms_and_deadline_batches_match_tokio_stream() {
    use std::time::Duration;
    use tokio_stream::StreamExt;
    let deadline = Duration::from_millis(500);
    let reference = tokio_stream::iter(1..=4)
        .filter(|value| value % 2 == 0)
        .map(|value| value * 2)
        .chunks_timeout(2, deadline)
        .collect::<Vec<_>>()
        .await;
    let actual = DataStream::from_values(1..=4)
        .filter(|value| value % 2 == 0)
        .map(|value| value * 2)
        .batch_with_timeout(2, deadline)
        .collect()
        .await;
    assert_eq!(reference, vec![vec![4, 8]]);
    assert_eq!(actual, reference);
}

#[tokio::test]
async fn timed_batches_flush_idle_sources_without_losing_values() {
    use std::{sync::Arc, time::Duration};
    use tokio::sync::Notify;
    let gate = Arc::new(Notify::new());
    let source_gate = gate.clone();
    let source = DataStream::from_values([1, 2, 3]).map_async(move |value| {
        let gate = source_gate.clone();
        async move {
            if value == 2 {
                gate.notified().await;
            }
            value
        }
    });
    let mut batches = source.batch_with_timeout(10, Duration::from_millis(20));
    let first = tokio::time::timeout(Duration::from_millis(200), batches.next()).await;
    gate.notify_one();
    assert_eq!(
        first.expect("batch must flush while source is idle"),
        Some(vec![1])
    );
    assert_eq!(batches.collect().await, vec![vec![2, 3]]);
}

#[tokio::test]
async fn timed_batches_flush_full_final_and_empty_sources() {
    use std::time::Duration;
    let batches = DataStream::from_values(1..=5)
        .batch_with_timeout(2, Duration::from_secs(1))
        .collect()
        .await;
    assert_eq!(batches, vec![vec![1, 2], vec![3, 4], vec![5]]);
    assert!(DataStream::from_values(Vec::<i32>::new())
        .batch_with_timeout(2, Duration::from_millis(10))
        .collect()
        .await
        .is_empty());
    assert_eq!(
        DataStream::from_values([1, 2])
            .batch_with_timeout(1, Duration::from_secs(1))
            .collect()
            .await,
        vec![vec![1], vec![2]]
    );
    assert_eq!(
        DataStream::from_values(1..=4)
            .sliding_window(3)
            .collect()
            .await,
        vec![vec![1, 2, 3], vec![2, 3, 4]]
    );
}

#[tokio::test]
async fn timed_batches_bound_production_and_stop_when_dropped() {
    use std::{
        sync::{
            atomic::{AtomicUsize, Ordering},
            Arc,
        },
        time::Duration,
    };
    let produced = Arc::new(AtomicUsize::new(0));
    let seen = produced.clone();
    let mut batches = DataStream::from_values((0..1000).inspect(move |_| {
        seen.fetch_add(1, Ordering::SeqCst);
    }))
    .batch_with_timeout(2, Duration::from_millis(10));
    assert_eq!(batches.next().await, Some(vec![0, 1]));
    tokio::time::sleep(Duration::from_millis(30)).await;
    // 32 output batches, one in-flight batch and one bounded input channel.
    assert!(produced.load(Ordering::SeqCst) <= 103);
    drop(batches);
    tokio::time::sleep(Duration::from_millis(30)).await;
    let stopped = produced.load(Ordering::SeqCst);
    tokio::time::sleep(Duration::from_millis(30)).await;
    assert_eq!(produced.load(Ordering::SeqCst), stopped);
    assert!(stopped < 1000);
}

#[tokio::test]
#[should_panic(expected = "time window must be positive")]
async fn timed_batches_reject_zero_deadlines() {
    let _ = DataStream::from_values([1]).batch_with_timeout(1, std::time::Duration::ZERO);
}

#[tokio::test]
async fn merge_reduce_callbacks_and_split_cancellation() {
    let total = DataStream::from_values([1, 3])
        .merge(DataStream::from_values([2, 4]))
        .reduce(0, |sum, value| sum + value)
        .await;
    assert_eq!(total, 10);
    let (odd, even) = DataStream::from_values(0..100).split(|value| value % 2 == 1);
    drop(even);
    assert_eq!(
        odd.collect().await,
        (0..100).filter(|value| value % 2 == 1).collect::<Vec<_>>()
    );
    let mut values = Vec::new();
    DataStream::from_values([1, 2])
        .for_each(|value| {
            values.push(value);
            std::future::ready(())
        })
        .await;
    assert_eq!(values, vec![1, 2]);
}

#[test]
#[ignore = "finite child-process fixture"]
fn unicode_log_fixture() {
    use std::io::Write;
    let mut output = std::io::stdout().lock();
    output.write_all(b"OK \xe2").unwrap();
    output.flush().unwrap();
    std::thread::sleep(std::time::Duration::from_millis(20));
    output.write_all(b"\x82\xac 10\r\nERROR 30\n").unwrap();
    output.flush().unwrap();
}

#[tokio::test]
async fn native_command_lines_frame_unicode_and_update_analytics() {
    use command_stream::StreamingRunner;
    let executable = std::env::current_exe().unwrap();
    let lines = StreamingRunner::from_argv(
        executable,
        ["--ignored", "--exact", "unicode_log_fixture", "--nocapture"],
    )
    .stream()
    .lines()
    .filter(|line| line.starts_with("OK ") || line.starts_with("ERROR "));
    let mut updates = Vec::new();
    let stats = lines
        .map(|line| {
            if line.starts_with("OK ") {
                assert_eq!(line, "OK € 10");
            }
            line
        })
        .analyze(
            |line| line.starts_with("ERROR"),
            |line| line.split_whitespace().last()?.parse::<f64>().ok(),
            |stats| updates.push(stats.count),
        )
        .await;
    assert_eq!(stats.count, 2);
    assert_eq!(stats.error_rate, 0.5);
    assert_eq!(stats.response_mean, 20.0);
    assert_eq!(updates, [1, 2]);
}
