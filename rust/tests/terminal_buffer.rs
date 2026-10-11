use command_stream::terminal::TerminalBuffer;

#[test]
fn snapshots_and_frame_changes() {
    let mut buffer = TerminalBuffer::new(3, 12);
    let mut frames = buffer.subscribe();
    buffer.write(b"\x1b[31mold\r\x1b[32mnew\x1b[0m");
    assert_eq!(buffer.text(false), "new");
    assert!(buffer.text(true).contains('\x1b'));
    assert_eq!(frames.try_recv().unwrap().text, "new");
    buffer.write(b"");
    assert!(frames.try_recv().is_err());
}
