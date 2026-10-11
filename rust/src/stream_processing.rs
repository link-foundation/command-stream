//! Bounded, composable asynchronous data streams and online analytics.
use crate::{OutputChunk, OutputStream};
use std::collections::VecDeque;
use std::future::Future;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

struct Task(JoinHandle<()>);
impl Drop for Task {
    fn drop(&mut self) {
        self.0.abort();
    }
}

/// Each stage has at most 32 queued values; dropping a consumer stops its producer.
pub struct DataStream<T> {
    receiver: mpsc::Receiver<T>,
    task: Arc<Task>,
}

#[derive(Debug, Clone, Default)]
pub struct StreamStats {
    pub count: u64,
    pub errors: u64,
    pub error_rate: f64,
    pub throughput: f64,
    pub elapsed: f64,
    pub response_count: u64,
    pub response_mean: f64,
    pub response_min: Option<f64>,
    pub response_max: Option<f64>,
}

impl<T: Send + 'static> DataStream<T> {
    fn spawn<F, Fut>(producer: F) -> Self
    where
        F: FnOnce(mpsc::Sender<T>) -> Fut,
        Fut: Future<Output = ()> + Send + 'static,
    {
        let (tx, receiver) = mpsc::channel(32);
        let task = Arc::new(Task(tokio::spawn(producer(tx))));
        Self { receiver, task }
    }
    pub fn from_values<I>(values: I) -> Self
    where
        I: IntoIterator<Item = T> + Send + 'static,
        I::IntoIter: Send,
    {
        Self::spawn(|tx| async move {
            for value in values {
                if tx.send(value).await.is_err() {
                    break;
                }
            }
        })
    }
    pub async fn next(&mut self) -> Option<T> {
        self.receiver.recv().await
    }
    pub fn map<U, F>(self, mut transform: F) -> DataStream<U>
    where
        U: Send + 'static,
        F: FnMut(T) -> U + Send + 'static,
    {
        self.map_async(move |value| std::future::ready(transform(value)))
    }
    pub fn map_async<U, F, Fut>(mut self, mut transform: F) -> DataStream<U>
    where
        U: Send + 'static,
        F: FnMut(T) -> Fut + Send + 'static,
        Fut: Future<Output = U> + Send,
    {
        DataStream::spawn(|tx| async move {
            while let Some(value) = self.next().await {
                if tx.send(transform(value).await).await.is_err() {
                    break;
                }
            }
        })
    }
    pub fn filter<F>(mut self, mut predicate: F) -> Self
    where
        F: FnMut(&T) -> bool + Send + 'static,
    {
        Self::spawn(|tx| async move {
            while let Some(value) = self.next().await {
                if predicate(&value) && tx.send(value).await.is_err() {
                    break;
                }
            }
        })
    }
    pub fn batch(mut self, size: usize) -> DataStream<Vec<T>> {
        assert!(size > 0);
        DataStream::spawn(|tx| async move {
            let mut values = Vec::with_capacity(size);
            while let Some(value) = self.next().await {
                values.push(value);
                if values.len() == size
                    && tx
                        .send(std::mem::replace(&mut values, Vec::with_capacity(size)))
                        .await
                        .is_err()
                {
                    return;
                }
            }
            if !values.is_empty() {
                let _ = tx.send(values).await;
            }
        })
    }
    pub fn window(mut self, size: usize) -> DataStream<Vec<T>>
    where
        T: Clone,
    {
        assert!(size > 0);
        DataStream::spawn(|tx| async move {
            let mut values = VecDeque::with_capacity(size);
            while let Some(value) = self.next().await {
                values.push_back(value);
                if values.len() > size {
                    values.pop_front();
                }
                if values.len() == size && tx.send(values.iter().cloned().collect()).await.is_err()
                {
                    break;
                }
            }
        })
    }
    pub fn split<F>(mut self, mut predicate: F) -> (Self, Self)
    where
        F: FnMut(&T) -> bool + Send + 'static,
    {
        let (yes_tx, yes) = mpsc::channel(32);
        let (no_tx, no) = mpsc::channel(32);
        let task = Arc::new(Task(tokio::spawn(async move {
            while let Some(value) = self.next().await {
                if yes_tx.is_closed() && no_tx.is_closed() {
                    break;
                }
                let tx = if predicate(&value) { &yes_tx } else { &no_tx };
                let _ = tx.send(value).await;
            }
        })));
        (
            Self {
                receiver: yes,
                task: task.clone(),
            },
            Self { receiver: no, task },
        )
    }
    pub fn merge(mut self, mut other: Self) -> Self {
        Self::spawn(|tx| async move {
            let mut left = true;
            let mut right = true;
            while left || right {
                let value = tokio::select! { value = self.next(), if left => { if value.is_none() { left = false; } value },
                value = other.next(), if right => { if value.is_none() { right = false; } value } };
                if let Some(value) = value {
                    if tx.send(value).await.is_err() {
                        break;
                    }
                }
            }
        })
    }
    pub async fn collect(mut self) -> Vec<T> {
        let mut values = Vec::new();
        while let Some(value) = self.next().await {
            values.push(value);
        }
        values
    }
    pub async fn reduce<U, F>(mut self, mut initial: U, mut reducer: F) -> U
    where
        F: FnMut(U, T) -> U,
    {
        while let Some(value) = self.next().await {
            initial = reducer(initial, value);
        }
        initial
    }
    pub async fn for_each<F, Fut>(mut self, mut callback: F)
    where
        F: FnMut(T) -> Fut,
        Fut: Future<Output = ()>,
    {
        while let Some(value) = self.next().await {
            callback(value).await;
        }
    }
    pub async fn analyze<E, R, U>(
        mut self,
        mut error: E,
        mut response: R,
        mut update: U,
    ) -> StreamStats
    where
        E: FnMut(&T) -> bool,
        R: FnMut(&T) -> Option<f64>,
        U: FnMut(&StreamStats),
    {
        let started = Instant::now();
        let mut stats = StreamStats::default();
        let mut sum = 0.0;
        while let Some(value) = self.next().await {
            stats.count += 1;
            stats.errors += u64::from(error(&value));
            if let Some(time) = response(&value).filter(|time| time.is_finite()) {
                stats.response_count += 1;
                sum += time;
                stats.response_min = Some(stats.response_min.map_or(time, |min| min.min(time)));
                stats.response_max = Some(stats.response_max.map_or(time, |max| max.max(time)));
                stats.response_mean = sum / stats.response_count as f64;
            }
            stats.elapsed = started.elapsed().as_secs_f64();
            stats.error_rate = stats.errors as f64 / stats.count as f64;
            stats.throughput = stats.count as f64 / stats.elapsed.max(0.001);
            update(&stats);
        }
        stats
    }
}

impl<T> Drop for DataStream<T> {
    fn drop(&mut self) {
        self.receiver.close();
        let _ = &self.task;
    }
}

impl OutputStream {
    /// Frame stdout bytes into UTF-8 lines, retaining split codepoints until newline.
    pub fn lines(mut self) -> DataStream<String> {
        DataStream::spawn(|tx| async move {
            let mut pending = Vec::new();
            while let Some(chunk) = self.next().await {
                if let OutputChunk::Stdout(bytes) = chunk {
                    pending.extend(bytes);
                    while let Some(end) = pending.iter().position(|byte| *byte == b'\n') {
                        let mut line = pending.drain(..=end).collect::<Vec<_>>();
                        line.pop();
                        if line.last() == Some(&b'\r') {
                            line.pop();
                        }
                        if tx
                            .send(String::from_utf8_lossy(&line).into_owned())
                            .await
                            .is_err()
                        {
                            return;
                        }
                    }
                }
            }
            if !pending.is_empty() {
                let _ = tx
                    .send(String::from_utf8_lossy(&pending).into_owned())
                    .await;
            }
        })
    }
}
