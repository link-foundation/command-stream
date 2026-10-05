use super::*;

#[tokio::test]
async fn channel_backpressure_and_eof() {
    let ch = Channel::new();
    // Under the high-water mark the write completes immediately.
    ch.write(vec![b'a'; HIGH_WATER]).await.unwrap();
    // Over it, the writer waits until the reader drains.
    let w = {
        let ch = ch.clone();
        tokio::spawn(async move { ch.write(vec![b'b'; 10]).await })
    };
    tokio::time::sleep(Duration::from_millis(20)).await;
    assert!(!w.is_finished());
    assert_eq!(ch.read().await.unwrap().len(), HIGH_WATER);
    w.await.unwrap().unwrap();
    assert_eq!(ch.read().await.unwrap(), b"b".repeat(10));
    ch.close();
    assert_eq!(ch.read().await, None);
}

#[tokio::test]
async fn channel_close_read_is_epipe() {
    let ch = Channel::new();
    ch.write(vec![0; HIGH_WATER]).await.unwrap();
    let w = {
        let ch = ch.clone();
        tokio::spawn(async move { ch.write(vec![1; 1]).await })
    };
    tokio::time::sleep(Duration::from_millis(10)).await;
    ch.close_read();
    let err = w.await.unwrap().unwrap_err();
    assert_eq!(err.code, "EPIPE");
    assert_eq!(err.message(), "Broken pipe");
    assert_eq!(ch.write(vec![2]).await.unwrap_err().code, "EPIPE");
    assert_eq!(ch.read().await, None);
}

#[tokio::test]
async fn writer_capture_sticky_error_and_close() {
    let ch = Channel::new();
    let reader = Reader::channel(ch.clone());
    let writer = Writer::channel(ch);
    let cap = SharedBuf::new();
    writer.write(b"hi", Some(&cap)).await.unwrap();
    assert_eq!(cap.to_vec(), b"hi");
    assert_eq!(reader.read_chunk().await.unwrap().unwrap(), b"hi");
    // Dropping the last writer clone closes the channel: EOF.
    let w2 = writer.clone();
    drop(writer);
    w2.write(b"x", None).await.unwrap();
    drop(w2);
    assert_eq!(reader.read_chunk().await.unwrap().unwrap(), b"x");
    assert_eq!(reader.read_chunk().await.unwrap(), None);

    // Dropping the reader breaks the pipe; the error sticks.
    let ch = Channel::new();
    let reader = Reader::channel(ch.clone());
    let writer = Writer::channel(ch);
    drop(reader);
    let e = writer.write(b"a", Some(&cap)).await.unwrap_err();
    assert_eq!((e.code, e.syscall), ("EPIPE", "write"));
    assert_eq!(writer.write(b"b", None).await.unwrap_err().code, "EPIPE");
    assert_eq!(cap.to_vec(), b"hi");
}

#[tokio::test]
async fn writer_and_reader_files() {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("f");
    let w = Writer::file(File::create(&p).unwrap());
    w.write(b"one ", None).await.unwrap();
    w.write(b"two", None).await.unwrap();
    drop(w);
    let r = Reader::file(File::open(&p).unwrap());
    assert_eq!(r.read_to_end().await.unwrap(), b"one two");
}

#[test]
fn sys_error_from_io() {
    // 2 is ENOENT on unix and ERROR_FILE_NOT_FOUND on Windows.
    let e = ShellSysError::from_io(&io::Error::from_raw_os_error(2), "x");
    assert_eq!(e.code, "ENOENT");
    assert_eq!(e.message(), "No such file or directory");
    assert_eq!(e.display(), "bun: No such file or directory: x");
    let e = ShellSysError::from_io(&io::Error::other("boom"), "");
    assert_eq!(e.code, "EIO");
    assert!(redirects_elsewhere(redirect_flags::STDOUT, Which::Stdout));
    assert!(!redirects_elsewhere(redirect_flags::STDOUT, Which::Stderr));
    let dup = redirect_flags::DUPLICATE_OUT | redirect_flags::STDOUT;
    assert!(!redirects_elsewhere(dup, Which::Stdout));
    assert!(redirects_elsewhere(dup, Which::Stderr));
}
