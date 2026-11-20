use jiff::{tz::Offset, Timestamp};

// Keep the precision and numeric UTC offset used in trace and benchmark output.
pub(crate) fn utc_rfc3339(timestamp: Timestamp) -> String {
    let nanos = timestamp.subsec_nanosecond();
    let precision = if nanos == 0 {
        0
    } else if nanos % 1_000_000 == 0 {
        3
    } else if nanos % 1_000 == 0 {
        6
    } else {
        9
    };
    let utc = timestamp.display_with_offset(Offset::UTC);
    format!("{utc:.precision$}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utc_rfc3339_preserves_fractional_width_and_offset() {
        for (instant, expected) in [
            ("1970-01-01T00:00:00Z", "1970-01-01T00:00:00+00:00"),
            ("1969-12-31T23:59:59.1Z", "1969-12-31T23:59:59.100+00:00"),
            (
                "2024-03-01T00:29:59.0001+00:30",
                "2024-02-29T23:59:59.000100+00:00",
            ),
            (
                "2024-03-01T00:00:00.99999999Z",
                "2024-03-01T00:00:00.999999990+00:00",
            ),
        ] {
            assert_eq!(utc_rfc3339(instant.parse().unwrap()), expected);
        }
    }
}
