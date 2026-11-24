//! What the app does when started with a flag instead of as Roger. `--update` needs the app
//! running, so app.rs handles that one.
use crate::error::Result;
use crate::{setup, uninstall};

/// Runs the flag given, if there is one, and returns the exit code.
///
/// - `--uninstall [--purge]`: takes Airband out of every agent (the Windows uninstaller runs this
///   first, windows/hooks.nsh), and with `--purge` removes ~/.airband too.
/// - `--check scan|node|engine|connect`: runs one setup step and prints what it found, without any
///   window. For testing on a computer, and in CI.
pub fn run() -> Option<i32> {
    let args: Vec<String> = std::env::args().collect();
    let has = |flag: &str| args.iter().any(|a| a == flag);
    if has("--uninstall") {
        for l in uninstall::take_out(has("--purge")) {
            println!("{l}");
        }
        return Some(0);
    }
    let what = args.iter().position(|a| a == "--check").and_then(|i| args.get(i + 1))?;
    let print = |r: Result<serde_json::Value>| match r {
        Ok(v) => {
            println!("{}", serde_json::to_string_pretty(&v).unwrap_or_default());
            0
        }
        Err(e) => {
            eprintln!("error: {e}");
            1
        }
    };
    let progress = |step: setup::Step, got: u64, total: u64| eprintln!("{}: {got} of about {total} bytes", step.name());
    Some(match what.as_str() {
        "scan" => print(serde_json::to_value(setup::look()).map_err(|e| e.to_string().into())),
        "node" => print(setup::node_from_nodejs(&progress).map(serde_json::Value::from)),
        "engine" => print(setup::engine_from_npm(&progress).map(serde_json::Value::from)),
        "connect" => print(setup::connect()),
        _ => {
            eprintln!("--check scan, node, engine or connect");
            2
        }
    })
}
