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

#[test]
fn compact_changes_replay_colors_cursor_and_resize() {
    let mut buffer = TerminalBuffer::new(3, 12);
    let mut changes = buffer.subscribe_changes();
    let mut replay = vt100::Parser::new(3, 12, 0);
    for data in [
        b"hello".as_slice(),
        b"\r\x1b[31mH",
        b"\x1b[2;2H",
        b"\x1b[2J",
        "界e\u{301}".as_bytes(),
        b"\x1b[?1049hALT",
        b"\x1b[?1049l",
    ] {
        buffer.write(data);
        let change = changes.try_recv().unwrap();
        replay.process(&change.ansi);
        assert_eq!(replay.screen().contents(), buffer.text(false));
        assert_eq!(replay.screen().cursor_position(), buffer.snapshot().cursor);
        assert_eq!(replay.screen().state_formatted(), buffer.snapshot().ansi);
    }
    buffer.resize(4, 16);
    let change = changes.try_recv().unwrap();
    assert!(change.reset);
    assert_eq!((change.rows, change.cols), (4, 16));
    buffer.write(b"");
    assert!(changes.try_recv().is_err());
}

#[test]
fn terminal_queries_reply_at_the_position_the_query_was_received() {
    let mut buffer = TerminalBuffer::new(3, 12);
    buffer.write(b"hello\x1b[6");
    assert!(buffer.take_input().is_empty());
    buffer.write(b"n\x1b[5n\x1b[18t");
    assert_eq!(buffer.take_input(), b"\x1b[1;6R\x1b[0n\x1b[8;3;12t");
    assert!(buffer.take_input().is_empty());
}
