//! ANSI control character utilities for command-stream
//!
//! This module handles stripping and processing of ANSI escape codes
//! and control characters from text output.

/// ANSI control character utilities
pub struct AnsiUtils;

impl AnsiUtils {
    /// Strip ANSI escape sequences from text
    ///
    /// Removes color codes, cursor movement, and other ANSI escape sequences
    /// while preserving the actual text content.
    ///
    /// # Examples
    ///
    /// ```
    /// use command_stream::ansi::AnsiUtils;
    ///
    /// let text = "\x1b[31mRed text\x1b[0m";
    /// assert_eq!(AnsiUtils::strip_ansi(text), "Red text");
    /// ```
    pub fn strip_ansi(text: &str) -> String {
        let re = regex::Regex::new(r"\x1b\[[0-9;]*[mGKHFJ]").unwrap();
        re.replace_all(text, "").to_string()
    }

    /// Strip control characters from text, preserving newlines, carriage returns, and tabs
    ///
    /// Removes control characters (ASCII 0x00-0x1F and 0x7F) except:
    /// - Newlines (\n = 0x0A)
    /// - Carriage returns (\r = 0x0D)
    /// - Tabs (\t = 0x09)
    ///
    /// # Examples
    ///
    /// ```
    /// use command_stream::ansi::AnsiUtils;
    ///
    /// let text = "Hello\x00World\nNew line\tTab";
    /// assert_eq!(AnsiUtils::strip_control_chars(text), "HelloWorld\nNew line\tTab");
    /// ```
    pub fn strip_control_chars(text: &str) -> String {
        text.chars()
            .filter(|c| {
                // Preserve newlines (\n = \x0A), carriage returns (\r = \x0D), and tabs (\t = \x09)
                !matches!(*c as u32,
                    0x00..=0x08 | 0x0B | 0x0C | 0x0E..=0x1F | 0x7F
                )
            })
            .collect()
    }

    /// Strip both ANSI sequences and control characters
    ///
    /// Combines `strip_ansi` and `strip_control_chars` for complete text cleaning.
    pub fn strip_all(text: &str) -> String {
        Self::strip_control_chars(&Self::strip_ansi(text))
    }

    /// Clean data for processing (strips ANSI and control chars)
    ///
    /// Alias for `strip_all` - provides semantic clarity when processing
    /// data that needs to be cleaned for further processing.
    pub fn clean_for_processing(data: &str) -> String {
        Self::strip_all(data)
    }
}

/// Configuration for ANSI handling
///
/// Controls how ANSI escape codes and control characters are processed
/// in command output.
#[derive(Debug, Clone)]
pub struct AnsiConfig {
    /// Whether to preserve ANSI escape sequences in output
    pub preserve_ansi: bool,
    /// Whether to preserve control characters in output
    pub preserve_control_chars: bool,
}

impl Default for AnsiConfig {
    fn default() -> Self {
        AnsiConfig {
            preserve_ansi: true,
            preserve_control_chars: true,
        }
    }
}

impl AnsiConfig {
    /// Create a new AnsiConfig that preserves everything (default)
    pub fn new() -> Self {
        Self::default()
    }

    /// Create a config that strips all ANSI and control characters
    pub fn strip_all() -> Self {
        AnsiConfig {
            preserve_ansi: false,
            preserve_control_chars: false,
        }
    }

    /// Process output according to config settings
    ///
    /// Applies the configured stripping rules to the input data.
    pub fn process_output(&self, data: &str) -> String {
        if !self.preserve_ansi && !self.preserve_control_chars {
            AnsiUtils::clean_for_processing(data)
        } else if !self.preserve_ansi {
            AnsiUtils::strip_ansi(data)
        } else if !self.preserve_control_chars {
            AnsiUtils::strip_control_chars(data)
        } else {
            data.to_string()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_strip_ansi() {
        let text = "\x1b[31mRed text\x1b[0m";
        assert_eq!(AnsiUtils::strip_ansi(text), "Red text");
    }

    #[test]
    fn test_strip_ansi_multiple_codes() {
        let text = "\x1b[1m\x1b[32mBold Green\x1b[0m Normal";
        assert_eq!(AnsiUtils::strip_ansi(text), "Bold Green Normal");
    }

    #[test]
    fn test_strip_control_chars() {
        let text = "Hello\x00World\nNew line\tTab";
        assert_eq!(
            AnsiUtils::strip_control_chars(text),
            "HelloWorld\nNew line\tTab"
        );
    }

    #[test]
    fn test_strip_control_chars_preserves_whitespace() {
        let text = "Line1\nLine2\r\nLine3\tTabbed";
        assert_eq!(
            AnsiUtils::strip_control_chars(text),
            "Line1\nLine2\r\nLine3\tTabbed"
        );
    }

    #[test]
    fn test_strip_all() {
        let text = "\x1b[31mRed\x00text\x1b[0m";
        assert_eq!(AnsiUtils::strip_all(text), "Redtext");
    }

    #[test]
    fn test_ansi_config_default() {
        let config = AnsiConfig::default();
        let text = "\x1b[31mRed\x00text\x1b[0m";
        assert_eq!(config.process_output(text), text);
    }

    #[test]
    fn test_ansi_config_strip_all() {
        let config = AnsiConfig::strip_all();
        let text = "\x1b[31mRed\x00text\x1b[0m";
        assert_eq!(config.process_output(text), "Redtext");
    }

    #[test]
    fn test_ansi_config_strip_ansi_only() {
        let config = AnsiConfig {
            preserve_ansi: false,
            preserve_control_chars: true,
        };
        let text = "\x1b[31mRed text\x1b[0m";
        assert_eq!(config.process_output(text), "Red text");
    }

    #[test]
    fn test_ansi_config_strip_control_only() {
        let config = AnsiConfig {
            preserve_ansi: true,
            preserve_control_chars: false,
        };
        let text = "Hello\x00World";
        assert_eq!(config.process_output(text), "HelloWorld");
    }
}
