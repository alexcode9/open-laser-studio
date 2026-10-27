use std::collections::VecDeque;

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Direction {
    Tx,
    Rx,
    Info,
    Error,
    Blocked,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolLogEntry {
    pub seq: u64,
    pub t_s: f64,
    pub channel: String,
    pub direction: Direction,
    pub text: String,
}

/// Bounded, timestamped protocol log (raw traffic and decisions).
#[derive(Debug, Clone)]
pub struct ProtocolLog {
    entries: VecDeque<ProtocolLogEntry>,
    limit: usize,
    next_seq: u64,
}

impl Default for ProtocolLog {
    fn default() -> Self {
        Self::new(5000)
    }
}

impl ProtocolLog {
    pub fn new(limit: usize) -> Self {
        Self { entries: VecDeque::new(), limit, next_seq: 1 }
    }

    pub fn push(&mut self, t_s: f64, channel: &str, direction: Direction, text: impl Into<String>) {
        if self.entries.len() >= self.limit {
            self.entries.pop_front();
        }
        self.entries.push_back(ProtocolLogEntry {
            seq: self.next_seq,
            t_s,
            channel: channel.into(),
            direction,
            text: text.into(),
        });
        self.next_seq += 1;
    }

    /// Entries with `seq > after`.
    pub fn since(&self, after: u64) -> Vec<ProtocolLogEntry> {
        self.entries.iter().filter(|e| e.seq > after).cloned().collect()
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}
