pub(crate) fn parse_molfile_positions(text: &str) -> Result<Vec<[f32; 4]>, String> {
    let lines = text.lines().collect::<Vec<_>>();
    if lines.len() < 4 {
        return Err("molfile header is truncated".into());
    }
    let positions = if lines[3].contains("V3000") {
        parse_v3000(&lines)?
    } else {
        parse_v2000(&lines)?
    };
    if positions
        .iter()
        .flatten()
        .any(|coordinate| !coordinate.is_finite())
    {
        return Err("molfile coordinates must be finite".into());
    }
    Ok(positions)
}

fn parse_v2000(lines: &[&str]) -> Result<Vec<[f32; 4]>, String> {
    let atom_count = lines[3]
        .get(..3)
        .ok_or("V2000 counts line is truncated")?
        .trim()
        .parse::<usize>()
        .map_err(|_| "invalid V2000 atom count")?;
    if atom_count == 0 || lines.len() < 4 + atom_count {
        return Err("V2000 atom block is empty or truncated".into());
    }
    lines[4..4 + atom_count]
        .iter()
        .map(|line| {
            if line.len() < 30 {
                return Err("V2000 atom line is truncated".into());
            }
            Ok([
                parse_v2000_coordinate(line, 0)?,
                parse_v2000_coordinate(line, 10)?,
                parse_v2000_coordinate(line, 20)?,
                0.0,
            ])
        })
        .collect()
}

fn parse_v2000_coordinate(line: &str, start: usize) -> Result<f32, String> {
    line.get(start..start + 10)
        .ok_or("V2000 coordinate is truncated")?
        .trim()
        .parse::<f32>()
        .map_err(|_| "invalid V2000 coordinate".into())
}

fn parse_v3000(lines: &[&str]) -> Result<Vec<[f32; 4]>, String> {
    let begin = lines
        .iter()
        .position(|line| line.trim() == "M  V30 BEGIN ATOM")
        .ok_or("V3000 atom block is missing")?;
    let end = lines
        .iter()
        .skip(begin + 1)
        .position(|line| line.trim() == "M  V30 END ATOM")
        .map(|offset| begin + 1 + offset)
        .ok_or("V3000 atom block is truncated")?;
    if end == begin + 1 {
        return Err("V3000 atom block is empty".into());
    }
    lines[begin + 1..end]
        .iter()
        .map(|line| {
            let tokens = line.split_whitespace().collect::<Vec<_>>();
            if tokens.len() < 7 || tokens[0] != "M" || tokens[1] != "V30" {
                return Err("invalid V3000 atom record".into());
            }
            Ok([
                tokens[4]
                    .parse::<f32>()
                    .map_err(|_| "invalid V3000 x coordinate")?,
                tokens[5]
                    .parse::<f32>()
                    .map_err(|_| "invalid V3000 y coordinate")?,
                tokens[6]
                    .parse::<f32>()
                    .map_err(|_| "invalid V3000 z coordinate")?,
                0.0,
            ])
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_v2000_and_rejects_non_finite_coordinates() {
        let mol = "x\n  Burette\n\n  1  0  0  0  0  0            999 V2000\n    1.2500   -2.5000    3.7500 C   0  0  0  0  0  0  0  0  0  0  0  0\nM  END";
        assert_eq!(
            parse_molfile_positions(mol).unwrap(),
            [[1.25, -2.5, 3.75, 0.0]]
        );
        assert!(parse_molfile_positions(&mol.replace("    1.2500", "       NaN")).is_err());
    }
}
