//! What the app keeps while it runs.
use crate::prefs::Prefs;
use serde::Deserialize;
use std::sync::{Arc, Mutex};
use std::time::Instant;

#[derive(Deserialize, Clone, Copy)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// What the app keeps while it runs.
pub struct Shared {
    pub prefs: Prefs,
    /// The screen's clickable parts (logical pixels in the window).
    pub hits: Vec<Rect>,
    /// Clicks pass through right now.
    pub passing: bool,
    pub asleep: bool,
    /// Which way the cards open: towards the middle of the screen.
    pub side: &'static str,
    pub vertical: &'static str,
    pub last_move: Option<Instant>,
}

pub type State = Arc<Mutex<Shared>>;
