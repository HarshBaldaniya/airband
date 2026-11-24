//! What the app does when started with a flag instead of as Roger.
use crate::{setup, uninstall};

/// `--check scan|node|engine|connect`: runs one setup step and prints what it found, without any
/// window. For testing on a computer, and in CI.
pub fn run() -> Option<i32> {
    let args: Vec<String> = std::env::args().collect();
    // The Windows uninstaller runs this first (windows/hooks.nsh): Airband comes out of every agent.
    if args.iter().any(|a| a == "--uninstall") {
        for l in uninstall::take_out(args.iter().any(|a| a == "--purge")) {
            println!("{l}");
        }
        return Some(0);
    }
    let what = args.iter().position(|a| a == "--check").and_then(|i| args.get(i + 1))?.clone();
    let print = |r: Result<serde_json::Value, String>| match r {
        Ok(v) => {
            println!("{}", serde_json::to_string_pretty(&v).unwrap_or_default());
            0
        }
        Err(e) => {
            eprintln!("error: {e}");
            1
        }
    };
    let progress = |step: &str, got: u64, total: u64| eprintln!("{step}: {got} of about {total} bytes");
    Some(match what.as_str() {
        "scan" => print(serde_json::to_value(setup::look()).map_err(|e| e.to_string())),
        "node" => print(setup::node_from_nodejs(&progress).map(serde_json::Value::from)),
        "engine" => print(setup::engine_from_npm(&progress).map(serde_json::Value::from)),
        "connect" => print(setup::connect()),
        _ => {
            eprintln!("--check scan, node, engine or connect");
            2
        }
    })
}
