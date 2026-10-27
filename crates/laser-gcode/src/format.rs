use crate::parser::{Block, Code};

/// Deterministic number formatting: up to 3 decimals, trailing zeros removed, no `-0`.
pub fn fmt_num(v: f64) -> String {
    let r = (v * 1000.0).round() / 1000.0;
    let r = if r == 0.0 { 0.0 } else { r };
    let s = format!("{r:.3}");
    let s = s.trim_end_matches('0').trim_end_matches('.');
    s.to_string()
}

/// Canonical text for a parsed block (codes, then params, then comment).
pub fn format_block(block: &Block) -> String {
    let mut parts: Vec<String> = Vec::new();
    for c in &block.codes {
        parts.push(match c {
            Code::G(v) => format!("G{}", fmt_num(*v)),
            Code::M(v) => format!("M{}", fmt_num(*v)),
            Code::Dollar(s) => format!("${s}"),
        });
    }
    for (l, v) in &block.params {
        parts.push(format!("{l}{}", fmt_num(*v)));
    }
    let mut out = parts.join(" ");
    if let Some(c) = &block.comment {
        if !out.is_empty() {
            out.push(' ');
        }
        out.push_str("; ");
        out.push_str(c);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parse_line;

    #[test]
    fn numbers() {
        assert_eq!(fmt_num(1.0), "1");
        assert_eq!(fmt_num(1.23456), "1.235");
        assert_eq!(fmt_num(-0.0001), "0");
        assert_eq!(fmt_num(-2.5), "-2.5");
    }

    #[test]
    fn roundtrip() {
        for line in ["G1 X10.5 Y-2 S500 F9600", "M116 A2 B-4", "$L", "G0 X1 ; c"] {
            let b = parse_line(line, 1);
            let again = parse_line(&format_block(&b), 1);
            assert_eq!(b.codes, again.codes);
            assert_eq!(b.params, again.params);
            assert_eq!(b.comment, again.comment);
        }
    }
}
