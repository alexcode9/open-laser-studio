/// Splits a byte stream into newline-terminated lines. Handles partial frames, multiple
/// frames per read, `\r\n`, and oversize lines (which are discarded and reported).
#[derive(Debug, Default)]
pub struct LineFramer {
    buf: Vec<u8>,
    max_len: usize,
    overflowed: bool,
    pub dropped_oversize: usize,
}

impl LineFramer {
    pub fn new(max_len: usize) -> Self {
        Self { buf: Vec::new(), max_len, overflowed: false, dropped_oversize: 0 }
    }

    pub fn push(&mut self, data: &[u8]) -> Vec<String> {
        let mut out = Vec::new();
        for &b in data {
            if b == b'\n' {
                if self.overflowed {
                    self.overflowed = false;
                    self.dropped_oversize += 1;
                } else {
                    let mut line = std::mem::take(&mut self.buf);
                    if line.last() == Some(&b'\r') {
                        line.pop();
                    }
                    out.push(String::from_utf8_lossy(&line).into_owned());
                }
                self.buf.clear();
                continue;
            }
            if self.overflowed {
                continue;
            }
            if self.buf.len() >= self.max_len {
                self.overflowed = true;
                self.buf.clear();
                continue;
            }
            self.buf.push(b);
        }
        out
    }

    /// Bytes buffered without a terminator.
    pub fn pending(&self) -> usize {
        self.buf.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn partial_and_multiple_frames() {
        let mut f = LineFramer::new(64);
        assert!(f.push(b"ok\r\nerr").len() == 1);
        assert_eq!(f.pending(), 3);
        assert_eq!(f.push(b"or\nok\nok\n"), vec!["error", "ok", "ok"]);
    }

    #[test]
    fn oversize_discarded() {
        let mut f = LineFramer::new(4);
        assert_eq!(f.push(b"toolong\nok\n"), vec!["ok"]);
        assert_eq!(f.dropped_oversize, 1);
    }
}
