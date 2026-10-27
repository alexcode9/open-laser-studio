use serde::Serialize;

/// A command code in a block, in source order.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", content = "value")]
pub enum Code {
    G(f64),
    M(f64),
    /// `$L`, `$P`, ... (GRBL-style system command). Stored without the `$`.
    Dollar(String),
}

/// One parsed line. Syntax only.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Block {
    pub line_no: usize,
    pub raw: String,
    pub codes: Vec<Code>,
    /// Parameter words (X, Y, Z, A, B, U, F, S, P, I, J, ...) in source order.
    pub params: Vec<(char, f64)>,
    pub comment: Option<String>,
    /// Syntax errors encountered on this line.
    pub errors: Vec<String>,
}

impl Block {
    pub fn param(&self, letter: char) -> Option<f64> {
        self.params.iter().rev().find(|(l, _)| *l == letter).map(|(_, v)| *v)
    }

    pub fn has_g(&self, code: f64) -> bool {
        self.codes.iter().any(|c| matches!(c, Code::G(v) if (*v - code).abs() < 1e-9))
    }

    pub fn is_empty(&self) -> bool {
        self.codes.is_empty() && self.params.is_empty()
    }
}

fn parse_number(chars: &[char], i: &mut usize) -> Option<f64> {
    let start = *i;
    while *i < chars.len() && chars[*i] == ' ' {
        *i += 1;
    }
    let num_start = *i;
    if *i < chars.len() && (chars[*i] == '-' || chars[*i] == '+') {
        *i += 1;
    }
    while *i < chars.len() && (chars[*i].is_ascii_digit() || chars[*i] == '.') {
        *i += 1;
    }
    let s: String = chars[num_start..*i].iter().collect();
    match s.parse::<f64>() {
        Ok(v) if v.is_finite() => Some(v),
        _ => {
            *i = start;
            None
        }
    }
}

pub fn parse_line(line: &str, line_no: usize) -> Block {
    let raw = line.trim_end_matches(['\r', '\n']).to_string();
    let mut block = Block {
        line_no,
        raw: raw.clone(),
        codes: Vec::new(),
        params: Vec::new(),
        comment: None,
        errors: Vec::new(),
    };
    let chars: Vec<char> = raw.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let ch = chars[i];
        match ch {
            ' ' | '\t' => i += 1,
            ';' => {
                let c: String = chars[i + 1..].iter().collect();
                block.comment = Some(c.trim().to_string());
                break;
            }
            '(' => {
                let end = chars[i..].iter().position(|c| *c == ')').map(|p| p + i);
                let stop = end.unwrap_or(chars.len());
                let c: String = chars[i + 1..stop].iter().collect();
                block.comment = Some(c.trim().to_string());
                if end.is_none() {
                    block.errors.push("unterminated comment".into());
                }
                i = stop + 1;
            }
            '$' => {
                let rest: String = chars[i + 1..].iter().take_while(|c| !c.is_whitespace()).collect();
                i += 1 + rest.chars().count();
                if rest.is_empty() {
                    block.errors.push("empty $ command".into());
                } else {
                    block.codes.push(Code::Dollar(rest));
                }
            }
            c if c.is_ascii_alphabetic() => {
                let letter = c.to_ascii_uppercase();
                i += 1;
                match parse_number(&chars, &mut i) {
                    Some(v) => match letter {
                        'G' => block.codes.push(Code::G(v)),
                        'M' => block.codes.push(Code::M(v)),
                        'N' => {}
                        _ => block.params.push((letter, v)),
                    },
                    None => block.errors.push(format!("missing number after '{letter}'")),
                }
            }
            '*' => {
                // Checksum suffix: ignored by the parser, preserved in `raw`.
                break;
            }
            other => {
                block.errors.push(format!("unexpected character '{other}'"));
                i += 1;
            }
        }
    }
    block
}

pub fn parse(text: &str) -> Vec<Block> {
    text.lines().enumerate().map(|(n, l)| parse_line(l, n + 1)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compact_and_spaced_words() {
        let b = parse_line("G1X10.5Y-2S500F9600", 1);
        assert_eq!(b.codes, vec![Code::G(1.0)]);
        assert_eq!(b.param('X'), Some(10.5));
        assert_eq!(b.param('Y'), Some(-2.0));
        assert_eq!(b.param('S'), Some(500.0));
        let b = parse_line("G0 X1 Y2 ; travel", 2);
        assert_eq!(b.comment.as_deref(), Some("travel"));
    }

    #[test]
    fn m116_axis_substitution() {
        let b = parse_line("M116A2B-4", 1);
        assert_eq!(b.codes, vec![Code::M(116.0)]);
        assert_eq!(b.param('A'), Some(2.0));
        assert_eq!(b.param('B'), Some(-4.0));
    }

    #[test]
    fn dollar_and_multiple_codes() {
        assert_eq!(parse_line("$L", 1).codes, vec![Code::Dollar("L".into())]);
        let b = parse_line("G91 G1 Z10 F600 S0", 1);
        assert_eq!(b.codes, vec![Code::G(91.0), Code::G(1.0)]);
    }

    #[test]
    fn paren_comment_and_errors() {
        let b = parse_line("G0 (move) X1", 1);
        assert_eq!(b.comment.as_deref(), Some("move"));
        assert_eq!(b.param('X'), Some(1.0));
        assert!(!parse_line("G0 X", 1).errors.is_empty());
        assert!(!parse_line("G0 #1", 1).errors.is_empty());
    }
}
