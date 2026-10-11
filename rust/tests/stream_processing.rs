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
