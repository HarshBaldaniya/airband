//! The app's one error type. What it displays is a sentence for the person: the setup tour shows it
//! as it is, so a command that fails sends it to the page as a plain string.
use std::borrow::Cow;
use std::fmt;

#[derive(Debug)]
pub enum Error {
    /// Something to say to the person, as it is.
    Say(Cow<'static, str>),
    /// A file or a program that couldn't be read, written or started.
    Io(std::io::Error),
    /// The app's own updater.
    Updater(tauri_plugin_updater::Error),
}

pub type Result<T, E = Error> = std::result::Result<T, E>;

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Say(s) => f.write_str(s),
            Error::Io(e) => e.fmt(f),
            Error::Updater(e) => e.fmt(f),
        }
    }
}

impl std::error::Error for Error {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Error::Say(_) => None,
            Error::Io(e) => Some(e),
            Error::Updater(e) => Some(e),
        }
    }
}

impl From<&'static str> for Error {
    fn from(s: &'static str) -> Self {
        Error::Say(Cow::Borrowed(s))
    }
}

impl From<String> for Error {
    fn from(s: String) -> Self {
        Error::Say(Cow::Owned(s))
    }
}

impl From<std::io::Error> for Error {
    fn from(e: std::io::Error) -> Self {
        Error::Io(e)
    }
}

impl From<tauri_plugin_updater::Error> for Error {
    fn from(e: tauri_plugin_updater::Error) -> Self {
        Error::Updater(e)
    }
}

/// A command's error reaches the page as its sentence.
impl serde::Serialize for Error {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.collect_str(self)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reaches_the_page_as_its_sentence() {
        let e = Error::from("the download stopped. Try again.");
        assert_eq!(serde_json::to_string(&e).unwrap(), r#""the download stopped. Try again.""#);
    }
}
