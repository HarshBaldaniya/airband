//! Where Roger lands after a drag, and how he gets there. Everything is measured on the figure, not
//! on the window around it: the window is mostly empty, and its corner is not where Roger is.
//! Near an edge he is pulled onto it (a magnet), never off the screen, and the cards open towards
//! the middle of the screen from wherever he sits.
use super::{FIG_H, FIG_PAD, FIG_W, WIN_H, WIN_W};
use crate::state::{Side, Vertical};
use std::time::Duration;

/// The screen's area without the menu bar and the Dock or taskbar (logical pixels).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Area {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// The figure's top-left corner on the screen (logical pixels).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Spot {
    pub x: f64,
    pub y: f64,
}

/// Left this close to an edge, Roger is pulled onto it.
pub const MAGNET: f64 = 110.0;
/// How far from an edge he sits once there: the dock's own padding, so he looks the same as before.
pub const MARGIN: f64 = FIG_PAD;

/// Where the figure is, in a window at `win` docked to `side` and `vertical`.
pub fn figure_in(win: (f64, f64), side: Side, vertical: Vertical) -> Spot {
    Spot {
        x: if side == Side::Right { win.0 + WIN_W - FIG_PAD - FIG_W } else { win.0 + FIG_PAD },
        y: if vertical == Vertical::Bottom { win.1 + WIN_H - FIG_PAD - FIG_H } else { win.1 + FIG_PAD },
    }
}

/// Where the window goes so that the figure, docked to `side` and `vertical`, is at `at`.
pub fn window_for(at: Spot, side: Side, vertical: Vertical) -> (f64, f64) {
    (
        if side == Side::Right { at.x + FIG_W + FIG_PAD - WIN_W } else { at.x - FIG_PAD },
        if vertical == Vertical::Bottom { at.y + FIG_H + FIG_PAD - WIN_H } else { at.y - FIG_PAD },
    )
}

/// Which way the cards open from `at`: towards the middle of the screen.
pub fn dock_for(at: Spot, a: Area) -> (Side, Vertical) {
    let side = if at.x + FIG_W / 2.0 > a.x + a.w / 2.0 { Side::Right } else { Side::Left };
    let vertical = if at.y + FIG_H / 2.0 > a.y + a.h / 2.0 { Vertical::Bottom } else { Vertical::Top };
    (side, vertical)
}

/// `at`, moved just enough to be wholly on the screen.
pub fn on_screen(at: Spot, a: Area) -> Spot {
    let (x0, x1) = (a.x + MARGIN, (a.x + a.w - MARGIN - FIG_W).max(a.x + MARGIN));
    let (y0, y1) = (a.y + MARGIN, (a.y + a.h - MARGIN - FIG_H).max(a.y + MARGIN));
    Spot { x: at.x.clamp(x0, x1), y: at.y.clamp(y0, y1) }
}

/// Where Roger lands when let go at `at`: on the screen, and pulled onto any edge within reach,
/// two at once in a corner.
pub fn landing(at: Spot, a: Area) -> Spot {
    let s = on_screen(at, a);
    let pull = |v: f64, lo: f64, hi: f64| {
        if v - lo < MAGNET {
            lo
        } else if hi - v < MAGNET {
            hi
        } else {
            v
        }
    };
    Spot {
        x: pull(s.x, a.x + MARGIN, (a.x + a.w - MARGIN - FIG_W).max(a.x + MARGIN)),
        y: pull(s.y, a.y + MARGIN, (a.y + a.h - MARGIN - FIG_H).max(a.y + MARGIN)),
    }
}

/// How the glide eases: fast at first, as if pulled, then a small settle past the mark and back.
pub fn ease(t: f64) -> f64 {
    const S: f64 = 1.2;
    let t = t.clamp(0.0, 1.0) - 1.0;
    1.0 + t * t * ((S + 1.0) * t + S)
}

/// A short way is quick and a long one a little slower, never sluggish.
pub fn glide_time(distance: f64) -> Duration {
    Duration::from_millis((170.0 + distance * 0.5).clamp(170.0, 320.0) as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCREEN: Area = Area { x: 0.0, y: 25.0, w: 1512.0, h: 920.0 };

    #[test]
    fn the_window_and_the_figure_agree_on_every_side() {
        for side in [Side::Left, Side::Right] {
            for vertical in [Vertical::Top, Vertical::Bottom] {
                let at = Spot { x: 300.0, y: 400.0 };
                assert_eq!(figure_in(window_for(at, side, vertical), side, vertical), at);
            }
        }
    }

    #[test]
    fn near_an_edge_he_is_pulled_onto_it_and_in_a_corner_onto_both() {
        let right = SCREEN.x + SCREEN.w - MARGIN - FIG_W;
        let bottom = SCREEN.y + SCREEN.h - MARGIN - FIG_H;
        assert_eq!(landing(Spot { x: right - 60.0, y: 400.0 }, SCREEN), Spot { x: right, y: 400.0 });
        assert_eq!(landing(Spot { x: 40.0, y: bottom - 30.0 }, SCREEN), Spot { x: MARGIN, y: bottom });
        // In the open, he stays where he was let go.
        assert_eq!(landing(Spot { x: 600.0, y: 400.0 }, SCREEN), Spot { x: 600.0, y: 400.0 });
    }

    #[test]
    fn he_is_never_left_off_the_screen() {
        let s = landing(Spot { x: -500.0, y: 5000.0 }, SCREEN);
        assert_eq!(s, Spot { x: MARGIN, y: SCREEN.y + SCREEN.h - MARGIN - FIG_H });
        assert_eq!(on_screen(Spot { x: 700.0, y: -90.0 }, SCREEN).y, SCREEN.y + MARGIN);
    }

    #[test]
    fn the_cards_open_towards_the_middle() {
        assert_eq!(dock_for(Spot { x: 10.0, y: 40.0 }, SCREEN), (Side::Left, Vertical::Top));
        assert_eq!(dock_for(Spot { x: 1400.0, y: 800.0 }, SCREEN), (Side::Right, Vertical::Bottom));
    }

    #[test]
    fn the_glide_starts_and_ends_on_its_marks_and_settles_a_little_past() {
        assert!(ease(0.0).abs() < 1e-9);
        assert!((ease(1.0) - 1.0).abs() < 1e-9);
        let most = (0..=100).map(|i| ease(i as f64 / 100.0)).fold(0.0, f64::max);
        assert!(most > 1.0 && most < 1.1, "a small settle past the mark: {most}");
        assert!(glide_time(0.0) < glide_time(400.0) && glide_time(5000.0) == Duration::from_millis(320));
    }
}
