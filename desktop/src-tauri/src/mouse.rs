//! The mouse button, asked of the system directly: while the app moves Roger's window under the
//! pointer, the window may let clicks through, so the page can't be relied on to hear the button
//! let go.

/// Whether the main mouse button is held now; None where it can't be asked (Linux).
pub fn main_button_down() -> Option<bool> {
    imp::main_button_down()
}

#[cfg(target_os = "macos")]
mod imp {
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventSourceButtonState(state: i32, button: u32) -> bool;
    }

    /// kCGEventSourceStateCombinedSessionState.
    const COMBINED_SESSION: i32 = 0;
    /// kCGMouseButtonLeft: the main button, whichever side the person set it to.
    const MAIN_BUTTON: u32 = 0;

    pub fn main_button_down() -> Option<bool> {
        // SAFETY: a plain query of the system's event state, with no pointers.
        Some(unsafe { CGEventSourceButtonState(COMBINED_SESSION, MAIN_BUTTON) })
    }
}

#[cfg(target_os = "windows")]
mod imp {
    #[link(name = "user32")]
    extern "system" {
        fn GetAsyncKeyState(key: i32) -> i16;
        fn GetSystemMetrics(index: i32) -> i32;
    }

    const VK_LBUTTON: i32 = 0x01;
    const VK_RBUTTON: i32 = 0x02;
    /// The buttons are swapped for a left-handed mouse: the main one is then the right.
    const SM_SWAPBUTTON: i32 = 23;

    pub fn main_button_down() -> Option<bool> {
        // SAFETY: plain queries of the system's input state, with no pointers.
        unsafe {
            let key = if GetSystemMetrics(SM_SWAPBUTTON) != 0 { VK_RBUTTON } else { VK_LBUTTON };
            Some(GetAsyncKeyState(key) as u16 & 0x8000 != 0)
        }
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod imp {
    pub fn main_button_down() -> Option<bool> {
        None
    }
}
