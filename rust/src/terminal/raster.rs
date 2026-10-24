//! `recording.gif` (issue #231): every frame is drawn straight from its text
//! grid with 8x8 bitmap glyphs, so no SVG rasteriser or font loader is needed.
//! Like `recording.svg`, the GIF holds the plain text of each frame in the
//! same colours; each glyph row is doubled to fill an 8x16 cell.

use super::types::{TerminalCaptureError, TerminalFrame};
use font8x8::UnicodeFonts;

const CELL_WIDTH: usize = 8;
const CELL_HEIGHT: usize = 16;
const PADDING: usize = 12;
/// Index 0 is the background (`#111827`), 1 the foreground (`#e5e7eb`).
const PALETTE: [u8; 6] = [0x11, 0x18, 0x27, 0xe5, 0xe7, 0xeb];
/// Shortest frame delay in centiseconds (10 ms, as in the JS renderer).
const MINIMUM_DELAY: u16 = 1;
/// Delay of the last frame, which has no successor to time it against.
const LAST_FRAME_DELAY: u16 = 10;

fn glyph(character: char) -> Option<[u8; 8]> {
    font8x8::BASIC_FONTS
        .get(character)
        .or_else(|| font8x8::LATIN_FONTS.get(character))
        .or_else(|| font8x8::BOX_FONTS.get(character))
        .or_else(|| font8x8::BLOCK_FONTS.get(character))
        .or_else(|| font8x8::GREEK_FONTS.get(character))
        .or_else(|| font8x8::MISC_FONTS.get(character))
        .or_else(|| font8x8::HIRAGANA_FONTS.get(character))
}

/// Draw `frame` into `pixels`, a `width`-wide canvas of palette indices.
fn draw_frame(frame: &TerminalFrame, pixels: &mut [u8], width: usize) {
    pixels.fill(0);
    for (row, line) in frame.screen.iter().enumerate() {
        for (column, character) in line.chars().enumerate() {
            let Some(bitmap) = glyph(character) else {
                continue;
            };
            let left = PADDING + column * CELL_WIDTH;
            let top = PADDING + row * CELL_HEIGHT;
            for (glyph_row, bits) in bitmap.iter().enumerate() {
                for bit in 0..CELL_WIDTH {
                    // The least significant bit is the leftmost pixel.
                    if bits & (1 << bit) == 0 {
                        continue;
                    }
                    for repeat in 0..CELL_HEIGHT / 8 {
                        let y = top + glyph_row * (CELL_HEIGHT / 8) + repeat;
                        if let Some(pixel) = pixels.get_mut(y * width + left + bit) {
                            *pixel = 1;
                        }
                    }
                }
            }
        }
    }
}

fn delay(frames: &[TerminalFrame], index: usize) -> u16 {
    frames.get(index + 1).map_or(LAST_FRAME_DELAY, |next| {
        let centiseconds = ((next.time - frames[index].time) * 100.0).round();
        centiseconds.clamp(f64::from(MINIMUM_DELAY), f64::from(u16::MAX)) as u16
    })
}

fn encoding_error(error: impl std::fmt::Display) -> TerminalCaptureError {
    TerminalCaptureError::new(format!("could not encode recording.gif: {error}"), None)
}

/// Encode `frames` as a looping GIF sized for the largest frame.
pub(crate) fn render_recording_gif(
    frames: &[TerminalFrame],
) -> Result<Vec<u8>, TerminalCaptureError> {
    let columns = frames.iter().map(|frame| frame.cols).max().unwrap_or(1);
    let rows = frames.iter().map(|frame| frame.rows).max().unwrap_or(1);
    let width = usize::from(columns) * CELL_WIDTH + PADDING * 2;
    let height = usize::from(rows) * CELL_HEIGHT + PADDING * 2;
    let gif_width = u16::try_from(width).map_err(encoding_error)?;
    let gif_height = u16::try_from(height).map_err(encoding_error)?;

    let mut bytes = Vec::new();
    {
        let mut encoder = gif::Encoder::new(&mut bytes, gif_width, gif_height, &PALETTE)
            .map_err(encoding_error)?;
        encoder
            .set_repeat(gif::Repeat::Infinite)
            .map_err(encoding_error)?;
        let mut pixels = vec![0_u8; width * height];
        for (index, frame) in frames.iter().enumerate() {
            draw_frame(frame, &mut pixels, width);
            let mut image =
                gif::Frame::from_indexed_pixels(gif_width, gif_height, pixels.clone(), None);
            image.delay = delay(frames, index);
            encoder.write_frame(&image).map_err(encoding_error)?;
        }
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::terminal::TerminalCursor;

    fn frame(time: f64, screen: &[&str]) -> TerminalFrame {
        TerminalFrame {
            time,
            cols: 4,
            rows: 2,
            cursor: TerminalCursor { x: 0, y: 0 },
            alternate: false,
            lines: screen.iter().map(|line| line.to_string()).collect(),
            screen: screen.iter().map(|line| line.to_string()).collect(),
        }
    }

    #[test]
    fn glyph_bits_start_at_the_left_edge() {
        // `L` has its stem on the left of the cell, which only holds when
        // bit 0 is the leftmost pixel.
        let mut pixels = vec![0_u8; 56 * 56];
        draw_frame(&frame(0.0, &["L"]), &mut pixels, 56);
        let lit_columns = (0..56)
            .filter(|x| (0..56).any(|y| pixels[y * 56 + x] == 1))
            .collect::<Vec<_>>();
        assert!(!lit_columns.is_empty());
        assert!(lit_columns[0] <= PADDING + 1, "{lit_columns:?}");
        assert!(lit_columns.iter().all(|x| *x < PADDING + CELL_WIDTH));
    }

    #[test]
    fn delays_follow_frame_times() {
        let frames = [frame(0.0, &["a"]), frame(0.5, &["b"]), frame(0.501, &["c"])];
        assert_eq!(delay(&frames, 0), 50);
        assert_eq!(delay(&frames, 1), MINIMUM_DELAY);
        assert_eq!(delay(&frames, 2), LAST_FRAME_DELAY);
    }

    #[test]
    fn gif_has_one_image_per_frame() {
        let frames = [frame(0.0, &["ab"]), frame(0.2, &["ab", "cd"])];
        let bytes = render_recording_gif(&frames).unwrap();
        let mut decoder = gif::DecodeOptions::new()
            .read_info(bytes.as_slice())
            .unwrap();
        assert_eq!(
            (decoder.width(), decoder.height()),
            (4 * 8 + 24, 2 * 16 + 24),
            "sized for 4x2 cells plus padding"
        );
        let mut delays = Vec::new();
        while let Some(image) = decoder.read_next_frame().unwrap() {
            assert!(image.buffer.contains(&1), "every frame shows its text");
            delays.push(image.delay);
        }
        assert_eq!(delays, [20, LAST_FRAME_DELAY]);
    }
}
